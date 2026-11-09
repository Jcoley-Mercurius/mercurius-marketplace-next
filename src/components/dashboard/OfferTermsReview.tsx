"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { createClient } from "@/lib/supabase/client";
import { offerTermsErrorMessage, offerTermsView, type OfferTermsRecord } from "@/lib/offerTerms";

type Load =
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; terms: OfferTermsRecord | null; answered: boolean };

// TRACE-150 (DEC-2026-063): a provider accepted this request at terms other than the price the
// homeowner was shown. The homeowner sees the complete terms (provider, offering, level, scope, every
// charge, and what isn't included) and accepts or declines that exact offer. The answer names the
// terms row and its consent hash; a lost response counts as saved only when the readback shows it.
export function OfferTermsReview({ jobId, enabled, onAnswered }: { jobId: string; enabled: boolean; onAnswered: (accepted: boolean) => void }) {
  const headingId = useId();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [problem, setProblem] = useState("");
  const keys = useRef(new Map<string, string>());
  const problemRef = useRef<HTMLParagraphElement>(null);

  const read = useCallback(async () => {
    const supabase = createClient();
    const attempt = await supabase.from("job_match_attempts").select("id").eq("service_request_id", jobId).eq("outcome", "accepted")
      .order("accepted_at", { ascending: false }).limit(1).maybeSingle();
    if (attempt.error) throw attempt.error;
    if (!attempt.data) return { terms: null, answered: false };
    const terms = await supabase.from("job_offer_terms").select("id, consent_hash, total_cents, terms").eq("offer_id", attempt.data.id).maybeSingle();
    if (terms.error) throw terms.error;
    if (!terms.data) return { terms: null, answered: false };
    const answer = await supabase.from("job_offer_terms_responses").select("id").eq("terms_id", terms.data.id).maybeSingle();
    if (answer.error) throw answer.error;
    return { terms: terms.data as OfferTermsRecord, answered: Boolean(answer.data) };
  }, [jobId]);

  const refresh = useCallback(async () => {
    try {
      const result = await read();
      setLoad({ state: "ready", ...result });
    } catch {
      setLoad({ state: "error" });
    }
  }, [read]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);
  useEffect(() => { if (problem && !document.querySelector("[role=alertdialog]")) problemRef.current?.focus(); }, [problem]);

  async function answer(terms: OfferTermsRecord, accept: boolean, reason: string) {
    const intent = JSON.stringify([jobId, terms.id, accept, reason]);
    let key = keys.current.get(intent);
    if (!key) { key = crypto.randomUUID(); keys.current.set(intent, key); }
    setProblem("");
    const supabase = createClient();
    let failure: unknown = null;
    try {
      const result = await supabase.rpc("homeowner_respond_offer_terms", {
        _terms_id: terms.id, _response_key: key, _accept: accept,
        _expected: { terms_id: terms.id, consent_hash: terms.consent_hash }, _reason: reason || undefined,
      });
      failure = result.error;
    } catch (error) {
      failure = error ?? new Error("No response");
    }
    if (failure) {
      const saved = await supabase.from("job_offer_terms_responses").select("accepted").eq("terms_id", terms.id).eq("response_key", key).maybeSingle();
      if (!saved.data || saved.data.accepted !== accept) {
        setProblem(offerTermsErrorMessage(failure));
        await refresh();
        throw failure;
      }
    }
    keys.current.delete(intent);
    onAnswered(accept);
  }

  if (load.state === "loading") {
    return <section aria-labelledby={headingId} aria-busy="true" className="space-y-2 rounded-xl border p-4">
      <h3 id={headingId} className="font-semibold">Provider&apos;s terms</h3>
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading the terms…</p>
    </section>;
  }
  if (load.state === "error") {
    return <section aria-labelledby={headingId} className="space-y-3 rounded-xl border p-4">
      <h3 id={headingId} className="font-semibold">Provider&apos;s terms</h3>
      <p role="alert" className="text-sm text-destructive">The terms couldn&apos;t be loaded. Nothing was changed.</p>
      <Button variant="outline" size="sm" onClick={() => { setLoad({ state: "loading" }); void refresh(); }}><RefreshCw />Try again</Button>
    </section>;
  }
  if (!load.terms) return null;

  const view = offerTermsView(load.terms);
  return <section aria-labelledby={headingId} className="space-y-4 rounded-xl border p-4" data-testid="offer-terms">
    <div className="space-y-1">
      <h3 id={headingId} className="font-semibold">{view.provider}&apos;s terms</h3>
      <p className="text-sm text-muted-foreground">These differ from the price you were shown when you submitted the request. Nothing is scheduled or charged until you accept them.</p>
    </div>
    {problem && <p ref={problemRef} tabIndex={-1} role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">{problem}</p>}

    <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
      <dt className="text-muted-foreground">Service</dt><dd>{view.service}</dd>
      <dt className="text-muted-foreground">Offering</dt><dd>{view.offering}{view.level ? ` · ${view.level}` : ""} · {view.frequency}</dd>
      {view.description && <><dt className="text-muted-foreground">Description</dt><dd>{view.description}</dd></>}
      {view.included.length > 0 && <><dt className="text-muted-foreground">Included</dt><dd>{view.included.join(", ")}</dd></>}
      {view.answers.length > 0 && <><dt className="text-muted-foreground">Based on your answers</dt><dd>{view.answers.join("; ")}</dd></>}
    </dl>

    <div className="space-y-1 text-sm">
      <h4 className="font-medium">Price</h4>
      <ul className="space-y-1">
        {view.lines.map((line) => <li key={line.key} className="flex justify-between gap-4"><span>{line.label}</span><span className="tabular-nums">{line.amount}</span></li>)}
        <li className="flex justify-between gap-4 border-t pt-1 font-medium"><span>Service total</span><span className="tabular-nums">{view.total}</span></li>
      </ul>
      {view.earlierTotal && <p className="text-muted-foreground">The price you were shown at submission was {view.earlierTotal}.</p>}
    </div>

    <div className="space-y-1 text-sm">
      <h4 className="font-medium">Not included</h4>
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        {view.omitted.map((item) => <li key={item}>{item}</li>)}
        <li>No promotion applies to these terms.</li>
        <li>{view.tax}</li>
        <li>Tip: {view.tip}</li>
      </ul>
      {view.policy && <p className="text-muted-foreground">Provider policy: {view.policy}</p>}
    </div>

    {load.answered
      ? <p role="status" className="text-sm text-muted-foreground">You already answered these terms.</p>
      : <div className="flex flex-wrap gap-2">
        <ConfirmAction triggerLabel="Accept these terms" triggerVariant="commitment" confirmationTone="commitment" disabled={!enabled}
          title="Accept these terms?" entity={`${view.provider} · ${view.total}`}
          consequence={`Your request is scheduled with ${view.provider} at a service total of ${view.total}. Mercurius confirms any tax before you pay at checkout. Anything listed as not included is not part of this service.`}
          confirmLabel="Accept terms" onConfirm={(reason) => answer(load.terms!, true, reason)} />
        <ConfirmAction triggerLabel="Decline these terms" disabled={!enabled} title="Decline these terms?" entity={view.provider}
          consequence={`${view.provider} is no longer assigned and won't be offered this request again. Mercurius offers it to another eligible provider, or shows it as not available yet in your area.`}
          confirmLabel="Decline terms" onConfirm={(reason) => answer(load.terms!, false, reason)} />
      </div>}
  </section>;
}
