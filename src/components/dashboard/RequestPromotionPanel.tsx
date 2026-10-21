"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CodeEntry, OfferChoices } from "@/components/pricing/OfferChoices";
import { createClient } from "@/lib/supabase/client";
import {
  centsLabel,
  codeMessage,
  parseRequestPromotion,
  promotionReason,
  type PromotionOption,
  type RequestPromotionState,
} from "@/lib/promotionSelection";

// TRACE-116 (DEC-2026-042): after submission the homeowner sees the offer on their request,
// and until checkout starts can replace it, remove it or confirm the price without one. When
// an offer no longer applies, checkout waits for this choice: it never substitutes another
// offer or charges the undiscounted price on its own.
export function RequestPromotionPanel({ requestId, enabled }: { requestId: string; enabled: boolean }) {
  const [state, setState] = useState<RequestPromotionState | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const load = useCallback(async (withCode: string | null) => {
    setLoading(true);
    try {
      const { data, error } = await createClient().rpc("homeowner_request_promotion", { p_request: requestId, p_code: withCode });
      // Before the TRACE-116 migration reaches the database the function is missing: no offers.
      if (error?.code === "PGRST202") { setState(null); setLoadError(false); return; }
      if (error) throw error;
      setState(parseRequestPromotion(data));
      setLoadError(false);
    } catch {
      // The last answer stays on screen; the failure is said, never hidden.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(null); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const retry = loadError && (
    <div role="status" className="rounded-lg border border-status-warning bg-status-warning-bg p-3 text-sm text-foreground">
      <p>We couldn’t {state ? "refresh" : "load"} this request’s offer. Checkout still checks it.</p>
      <Button type="button" variant="outline" size="sm" className="mt-2 min-h-11" loading={loading} onClick={() => void load(code)}>Try again</Button>
    </div>
  );
  if (loadError && !state) {
    return <section aria-labelledby={`offer-${requestId}`} className="space-y-3 rounded-xl border p-4">
      <h3 id={`offer-${requestId}`} className="text-sm font-semibold">Offer</h3>
      {retry}
    </section>;
  }
  // Offers are optional here: with promotions closed and nothing applied nothing is shown, and
  // checkout still checks the request's offer on the server.
  if (!state?.available) return null;
  const applied = state.applied;
  const service = state.serviceCents;
  if (!applied && !state.state && !state.editable) return null;

  async function choose(option: PromotionOption | null) {
    if (service == null) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await createClient().rpc("homeowner_choose_request_promotion", {
        p_request: requestId, p_offer: option?.offerId ?? null, p_fingerprint: option?.fingerprint ?? null,
        p_code: option?.requiresCode ? code : null, p_expected_cents: option ? option.totalAfterCents : service, p_key: crypto.randomUUID(),
      });
      if (error) throw error;
      const result = data as { status?: string; reason?: string } | null;
      if (result?.status === "applied" && option) setMessage(`${option.label} applied. Your service total is ${centsLabel(option.totalAfterCents)}.`);
      else if (result?.status === "declined") setMessage(`No offer. Your service total is ${centsLabel(service)}.`);
      else setMessage(`Nothing changed: ${promotionReason(result?.reason)}. Review the current offers.`);
    } catch (reason) {
      const text = (reason as { message?: unknown } | null)?.message;
      setMessage(typeof text === "string" && text ? `${text}.` : "The offer couldn’t be changed. Try again.");
    } finally {
      setBusy(false);
      await load(code);
    }
  }

  const needsChoice = state.state === "needs_homeowner" || Boolean(applied?.problem);
  return <section aria-labelledby={`offer-${requestId}`} className="space-y-3 rounded-xl border p-4">
    <h3 id={`offer-${requestId}`} className="text-sm font-semibold">Offer</h3>
    {retry}
    {applied && !applied.problem && (
      <p className="text-sm">
        <span className="font-medium">{applied.label}</span>: save {centsLabel(applied.discountCents)}. Service total{" "}
        <span className="font-medium tabular-nums">{centsLabel(applied.totalAfterCents)}</span> instead of {centsLabel(applied.serviceCents)}.
        {applied.committed ? " Applied to your payment." : ""}
      </p>
    )}
    {needsChoice && (
      <div role="status" className="rounded-lg border border-status-warning bg-status-warning-bg p-3 text-sm text-foreground">
        <p className="font-medium">Your offer no longer applies</p>
        <p className="mt-1">
          {applied?.problem ? `${applied.label}: ${promotionReason(applied.problem)}.` : state.reason ? `${state.reason}.` : ""}
          {" "}Checkout waits until you choose another offer or confirm the price without one{service != null ? ` (${centsLabel(service)})` : ""}.
        </p>
      </div>
    )}
    {state.state === "declined" && !applied && (
      <p className="text-sm text-muted-foreground">You chose no offer. Your service total is {centsLabel(state.confirmedServiceCents ?? service ?? 0)}.</p>
    )}
    {!applied && !needsChoice && state.state !== "declined" && state.editable && <p className="text-sm text-muted-foreground">No offer is applied.</p>}
    {!state.editable && state.lockedReason === "checkout_started" && <p className="text-sm text-muted-foreground">Checkout has started, so the offer can no longer change.</p>}
    {enabled && state.editable && service != null && (
      <div className="space-y-4">
        {state.options.length > 0 && (
          <OfferChoices name={`request-offer-${requestId}`} legend={applied && !applied.problem ? "Replace it with another offer" : "Choose an offer"}
            serviceCents={service} options={state.options} chosenOfferId={null} disabled={busy}
            onChoose={(option) => { if (option) void choose(option); }} />
        )}
        {state.offersOpen && <CodeEntry id={`request-code-${requestId}`} busy={busy} disabled={busy} message={codeMessage(state.code)}
          onApply={(value) => { setCode(value); setMessage(null); void load(value); }} />}
        {(applied || needsChoice) && (
          <Button type="button" variant="outline" className="min-h-11" loading={busy} onClick={() => void choose(null)}>
            {needsChoice ? `Continue without an offer at ${centsLabel(service)}` : "Remove the offer"}
          </Button>
        )}
      </div>
    )}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}
