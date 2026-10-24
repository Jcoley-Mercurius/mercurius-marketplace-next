"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2, RefreshCw, Send } from "lucide-react";
import { QuoteItemsEditor, QuoteLines } from "@/components/quotes/QuoteItems";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import {
  cents, draftsFromPricingInputs, emptyItem, maxQuoteScopeLength, parseQuoteItems, proposalColumns, proposalStatusLabel,
  taxPendingLabel, vendorQuoteView, type QuoteItemDraft, type QuoteProposal, type VendorQuoteJob,
} from "@/lib/quoteProposals";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Job = VendorQuoteJob & { id: string; pricing_inputs?: unknown };
type Load = "loading" | "ready" | "error";

const toneClass = {
  info: "border-status-info bg-status-info-bg text-status-info",
  success: "border-status-success bg-status-success-bg text-status-success",
  warning: "border-status-warning bg-status-warning-bg text-status-warning",
};

// TRACE-119 / DEC-2026-045: the assigned provider proposes an itemized estimate for Mercurius
// to review (MPS §4). The homeowner sees only quotes Mercurius sends.
export function VendorQuotePanel({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const [proposals, setProposals] = useState<QuoteProposal[]>([]);
  const [load, setLoad] = useState<Load>("loading");
  const [now, setNow] = useState(0);
  const [drafts, setDrafts] = useState<QuoteItemDraft[]>(() => {
    const prefill = draftsFromPricingInputs(job.pricing_inputs);
    return prefill.length ? prefill : [emptyItem()];
  });
  const prefilled = draftsFromPricingInputs(job.pricing_inputs).length > 0;
  const [scope, setScope] = useState("");
  const [itemsError, setItemsError] = useState<{ text: string; row: number | null } | null>(null);
  const [scopeError, setScopeError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const read = useCallback(async () => {
    const result = await createClient().from("request_quote_proposals").select(proposalColumns)
      .eq("request_id", job.id).order("created_at", { ascending: false }).limit(5);
    if (result.error) return null;
    return (result.data ?? []) as unknown as QuoteProposal[];
  }, [job.id]);

  const refresh = useCallback(async () => {
    setLoad("loading");
    const rows = await read();
    if (rows) setProposals(rows);
    setLoad(rows ? "ready" : "error");
  }, [read]);

  useEffect(() => {
    // The quote window clock starts after hydration; the server still decides expiry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    void refresh();
  }, [refresh]);

  const view = vendorQuoteView(job, proposals[0] ?? null, now);
  if (!view.quoteWork) return null;

  async function submit() {
    setSubmitError("");
    setSaved(false);
    const parsed = parseQuoteItems(drafts);
    const text = scope.trim();
    setItemsError(parsed.ok ? null : { text: parsed.error, row: parsed.row });
    setScopeError(text ? "" : "Describe what this price covers.");
    if (!parsed.ok) {
      document.getElementById(parsed.row ? `vendor-quote-${job.id}-line-${parsed.row}` : `vendor-quote-${job.id}-items-error`)?.focus();
      return;
    }
    if (!text) { document.getElementById(`quote-proposal-scope-${job.id}`)?.focus(); return; }
    setSaving(true);
    try {
      const call = await createClient().rpc("vendor_propose_quote", {
        _job_id: job.id, _items: parsed.items, _scope: text, _expected_revision: job.quote_revision ?? 0,
      });
      // Read back whether the call succeeded, failed or lost its response.
      const rows = await read();
      if (rows) setProposals(rows);
      const recorded = rows?.some((row) => row.status === "pending" && row.scope === text && row.subtotal_cents === parsed.subtotal_cents);
      if (recorded) {
        setSaved(true);
        setScope("");
        onChanged();
        return;
      }
      setSubmitError(call.error
        ? /refresh/i.test(call.error.message)
          ? "The quote changed since this page loaded, so your proposal wasn’t sent. Refresh the job and propose again."
          : `Your proposal wasn’t sent. ${call.error.message}`
        : "We couldn’t confirm your proposal was saved. Check again before resending.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby={`quote-panel-${job.id}`} className="space-y-4 rounded-xl border p-4">
      <h3 id={`quote-panel-${job.id}`} className="flex items-center gap-2 text-sm font-semibold"><FileText className="h-4 w-4 text-accent" />Quote</h3>
      {load === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading quote…</p>
      ) : load === "error" ? (
        <div role="alert" className="space-y-2 rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">
          <p>We couldn’t load your quote proposals, so proposing is paused.</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw />Try again</Button>
        </div>
      ) : (
        <>
          <div role="status" className={cn("rounded-lg border p-3 text-sm", toneClass[view.tone])}>
            <p className="font-semibold">{view.title}</p>
            <p className="mt-1">{view.detail}</p>
          </div>
          {saved && <p role="status" className="rounded-lg border border-status-success bg-status-success-bg p-3 text-sm text-status-success">Estimate sent to Mercurius for review. The homeowner sees a quote only once Mercurius sends it.</p>}
          {view.canPropose && (
            <form noValidate className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              {prefilled && <p className="text-xs text-muted-foreground">Lines start from the homeowner’s selection. Check every line; estimates start at their lowest price.</p>}
              <QuoteItemsEditor idPrefix={`vendor-quote-${job.id}`} drafts={drafts} onChange={setDrafts} disabled={saving} errorRow={itemsError?.row} />
              {itemsError && <p id={`vendor-quote-${job.id}-items-error`} tabIndex={-1} role="alert" className="text-sm text-destructive">{itemsError.text}</p>}
              <FormField id={`quote-proposal-scope-${job.id}`} label="What this price covers" error={scopeError} required
                help={`${scope.length} of ${maxQuoteScopeLength} characters.`}>
                {(control) => <Textarea {...control} maxLength={maxQuoteScopeLength} rows={3} value={scope} onChange={(event) => setScope(event.target.value)} disabled={saving} />}
              </FormField>
              {submitError && <div role="alert" className="space-y-2 rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">
                <p>{submitError}</p>
                <Button type="button" variant="outline" size="sm" onClick={() => { setSubmitError(""); onChanged(); void refresh(); }}><RefreshCw />Check again</Button>
              </div>}
              <Button type="submit" disabled={saving} aria-busy={saving}>{saving ? <Loader2 className="animate-spin" /> : <Send />}Send estimate to Mercurius</Button>
            </form>
          )}
          {proposals.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your estimates</h4>
              <ul className="space-y-3 text-sm">
                {proposals.map((row) => (
                  <li key={row.id} className="space-y-2 rounded-lg border p-3">
                    <p className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-medium">{cents(row.subtotal_cents)} · {taxPendingLabel}</span><span className="text-xs text-muted-foreground">{proposalStatusLabel[row.status] ?? row.status} · {new Date(row.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></p>
                    <QuoteLines items={row.items} />
                    <p className="whitespace-pre-wrap text-muted-foreground">{row.scope}</p>
                    {row.status === "sent" && row.corrected && <p>Mercurius corrected it before sending: {row.decision_reason}</p>}
                    {row.status === "returned" && <p>Returned: {row.decision_reason}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
