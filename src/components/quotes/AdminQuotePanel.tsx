"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { QuoteBreakdown, QuoteItemsEditor, QuoteLines } from "@/components/quotes/QuoteItems";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { formatEastern } from "@/lib/offerStatus";
import {
  cents, draftsFromItems, draftsFromPricingInputs, emptyItem, maxQuoteScopeLength, parseQuoteItems, proposalColumns,
  proposalSendable, proposalStatusLabel, taxPendingLabel, termsColumns,
  type QuoteItemDraft, type QuoteProposal, type QuoteTerms,
} from "@/lib/quoteProposals";
import { createClient } from "@/lib/supabase/client";

export type AdminQuoteRequest = {
  id: string;
  contractor_id: string | null;
  quote_revision?: number | null;
  quote_status?: string | null;
  quote_expires_at?: string | null;
  quote_amount: number | null;
  current_quote_id?: string | null;
  pricing_mode?: string | null;
  pricing_inputs?: unknown;
};

type Exception = { id: string; kind: string; subject: string; reason: string; opened_at: string; closed_at: string | null; resolution: string | null };

const quoteStateLabel: Record<string, string> = {
  submitted: "awaiting homeowner", accepted: "accepted by homeowner", declined: "declined by homeowner",
  expired: "expired unanswered", legacy_review: "legacy quote; send an itemized quote",
};

/** Mirrors private.quote_deposit_required for display; the server decides. */
const asksForDeposit = (request: AdminQuoteRequest) => request.pricing_mode === "deposit_quote"
  || Number((request.pricing_inputs as { deposit_cents?: unknown } | null)?.deposit_cents ?? 0) > 0;

// TRACE-119 / DEC-2026-045: operator review and itemized send. Accepted terms are final (G3);
// a job asking for a deposit needs a recorded review first (G2); the server rechecks provider
// eligibility (G5) and recomputes every total.
export function AdminQuotePanel({ request, providerName, onChanged }: { request: AdminQuoteRequest; providerName: string; onChanged: () => void }) {
  const [proposals, setProposals] = useState<QuoteProposal[]>([]);
  const [terms, setTerms] = useState<QuoteTerms | null>(null);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loadError, setLoadError] = useState("");
  const [drafts, setDrafts] = useState<QuoteItemDraft[]>(() => {
    const prefill = draftsFromPricingInputs(request.pricing_inputs);
    return prefill.length ? prefill : [emptyItem()];
  });
  const [scope, setScope] = useState("");
  const [reason, setReason] = useState("");
  const [itemsError, setItemsError] = useState<{ text: string; row: number | null } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ scope?: string; reason?: string }>({});
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    const supabase = createClient();
    const [proposalResult, exceptionResult, termsResult] = await Promise.all([
      supabase.from("request_quote_proposals").select(proposalColumns).eq("request_id", request.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("request_quote_exceptions").select("id, kind, subject, reason, opened_at, closed_at, resolution").eq("request_id", request.id).order("opened_at", { ascending: false }),
      request.current_quote_id
        ? supabase.from("request_quote_terms").select(termsColumns).eq("quote_id", request.current_quote_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const error = proposalResult.error ?? exceptionResult.error ?? termsResult.error;
    if (error) { setLoadError(error.message); return; }
    setProposals((proposalResult.data ?? []) as unknown as QuoteProposal[]);
    setExceptions((exceptionResult.data ?? []) as Exception[]);
    setTerms((termsResult.data ?? null) as unknown as QuoteTerms | null);
  }, [request.id, request.current_quote_id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const pending = proposals.find((row) => row.status === "pending") ?? null;
  const sendable = proposalSendable(pending, request);
  const accepted = request.quote_status === "accepted";
  const depositReviewed = exceptions.some((row) => row.kind === "deposit_review" && row.closed_at);
  const openChange = exceptions.find((row) => row.kind === "accepted_change" && !row.closed_at) ?? null;
  const deadline = formatEastern(request.quote_expires_at);

  async function run(operation: () => PromiseLike<{ error: { message: string } | null }>, success: string) {
    setActionError("");
    setBusy(true);
    try {
      const result = await operation();
      await load();
      if (result.error) { setActionError(result.error.message); return false; }
      toast.success(success);
      onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const parsed = parseQuoteItems(drafts);
    const errors = { scope: scope.trim() ? undefined : "Describe what this quote covers.", reason: reason.trim() ? undefined : "Explain why this quote is being sent." };
    setItemsError(parsed.ok ? null : { text: parsed.error, row: parsed.row });
    setFieldErrors(errors);
    if (!parsed.ok) { document.getElementById(parsed.row ? `admin-quote-${request.id}-line-${parsed.row}` : "admin-quote-items-error")?.focus(); return; }
    if (errors.scope) { document.getElementById("quote-scope")?.focus(); return; }
    if (errors.reason) { document.getElementById("quote-reason")?.focus(); return; }
    await run(() => createClient().rpc("admin_send_itemized_quote", {
      _job_id: request.id, _items: parsed.items, _scope: scope.trim(), _reason: reason.trim(),
      _expected_revision: request.quote_revision ?? 0, ...(sendable && pending ? { _proposal_id: pending.id } : {}),
    }), sendable ? "The itemized quote was sent and the provider was told." : "The itemized quote was sent to the homeowner.");
  }

  const confirmResult = async (ok: Promise<boolean>) => { if (!await ok) throw new Error("Not recorded"); };

  return (
    <div className="space-y-4">
      {request.quote_status && (
        <p className="text-xs text-muted-foreground">
          Current quote: revision {request.quote_revision ?? 0}
          {request.quote_amount != null && ` · ${cents(Math.round(request.quote_amount * 100))}${terms?.tax_status === "confirmed" ? "" : ` before tax`}`}
          {` · ${quoteStateLabel[request.quote_status] ?? request.quote_status}`}
          {request.quote_status === "submitted" && deadline && ` until ${deadline}`}
        </p>
      )}
      {loadError && <div role="alert" className="space-y-2 rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">
        <p>Quote records unavailable: {loadError}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}><RefreshCw />Try again</Button>
      </div>}
      {actionError && <p role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">{actionError}</p>}
      {terms && <details className="rounded-lg border bg-card p-3 text-sm" open={accepted}>
        <summary className="cursor-pointer font-medium">Revision {request.quote_revision} terms</summary>
        <div className="mt-3"><QuoteBreakdown terms={terms} /></div>
      </details>}

      {accepted ? (
        <div className="space-y-3 rounded-lg border border-status-success bg-status-success-bg p-3 text-sm text-status-success">
          <p className="font-semibold">Accepted terms are final</p>
          <p>No new revision can replace them, and a reason alone never authorizes a higher charge. If the work must change, open an exception and resolve it through the approved resolution or cancellation process.</p>
          {openChange ? <p>Open exception: {openChange.reason}</p> : (
            <ConfirmAction disabled={busy} requireReason reasonLabel="What needs to change" reasonHelp="Recorded for operations; the accepted terms stay as they are."
              triggerLabel="Open change exception" title="Open an exception for this accepted quote?" entity={`Revision ${request.quote_revision}`}
              consequence="Nothing changes for the homeowner or the price. The exception stays in the queue until it is resolved."
              confirmLabel="Open exception" onConfirm={(text) => confirmResult(run(() => createClient().rpc("admin_open_quote_exception", { _job_id: request.id, _reason: text }), "Exception opened."))} />
          )}
        </div>
      ) : (
        <>
          {asksForDeposit(request) && !depositReviewed && (
            <div className="space-y-2 rounded-lg border border-status-warning bg-status-warning-bg p-3 text-sm text-status-warning">
              <p className="font-semibold">Deposit review needed before sending</p>
              <p>This job’s offering asks for a deposit. Beta quotes carry a $0 deposit and use the existing invoice and checkout; record that you reviewed it.</p>
              <ConfirmAction disabled={busy} requireReason reasonLabel="Review note" reasonHelp="For example, what the provider was told about the $0 deposit."
                triggerLabel="Record deposit review" title="Record the deposit review?" entity="Deposit requirement"
                consequence="The quote will carry a $0 deposit. Existing deposit records are not changed."
                confirmLabel="Record review" onConfirm={(text) => confirmResult(run(() => createClient().rpc("admin_record_quote_review", { _job_id: request.id, _kind: "deposit_review", _note: text }), "Deposit review recorded."))} />
            </div>
          )}
          {pending ? (
            <div className="space-y-2 rounded-lg border bg-card p-3 text-sm">
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{providerName} proposed {cents(pending.subtotal_cents)} · {taxPendingLabel}</span>
                <span className="text-xs text-muted-foreground">{formatEastern(pending.created_at)}</span>
              </p>
              <QuoteLines items={pending.items} />
              <p className="whitespace-pre-wrap text-muted-foreground">{pending.scope}</p>
              <p className={sendable ? "text-xs text-muted-foreground" : "text-xs text-status-warning"}>
                {sendable
                  ? "Sending answers this proposal. Changed lines or scope are recorded as a correction, and the provider sees them with your reason."
                  : "This proposal is out of date (the quote, provider or request changed). Sending will not use it; return it or ask the provider to propose again."}
              </p>
              <div className="flex flex-wrap gap-2">
                {sendable && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setDrafts(draftsFromItems(pending.items)); setScope(pending.scope); }}>Use proposed lines</Button>}
                <ConfirmAction disabled={busy} requireReason reasonLabel="Reason for the provider" reasonHelp="The provider sees this reason and can propose again."
                  triggerLabel="Return to provider" title="Return this quote proposal?" entity={`${cents(pending.subtotal_cents)} from ${providerName}`}
                  consequence="Nothing is sent to the homeowner. The provider is told why and can propose again."
                  confirmLabel="Return proposal" onConfirm={(text) => confirmResult(run(() => createClient().rpc("admin_return_quote_proposal", { _proposal_id: pending.id, _reason: text }), "The proposal was returned to the provider."))} />
              </div>
            </div>
          ) : proposals[0] ? (
            <p className="text-xs text-muted-foreground">Latest provider proposal: {cents(proposals[0].subtotal_cents)} · {proposalStatusLabel[proposals[0].status] ?? proposals[0].status}{proposals[0].decision_reason ? ` · ${proposals[0].decision_reason}` : ""}</p>
          ) : (
            <p className="text-xs text-muted-foreground">No provider proposal yet.</p>
          )}

          <form noValidate className="space-y-3" onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <QuoteItemsEditor idPrefix={`admin-quote-${request.id}`} drafts={drafts} onChange={setDrafts} disabled={busy} errorRow={itemsError?.row} />
            {itemsError && <p id="admin-quote-items-error" tabIndex={-1} role="alert" className="text-sm text-destructive">{itemsError.text}</p>}
            <FormField id="quote-scope" label="What this quote covers" error={fieldErrors.scope} required help={`${scope.length} of ${maxQuoteScopeLength} characters.`}>
              {(control) => <Textarea {...control} rows={3} maxLength={maxQuoteScopeLength} value={scope} onChange={(event) => setScope(event.target.value)} />}
            </FormField>
            <FormField id="quote-reason" label="Quote reason" error={fieldErrors.reason} required>
              {(control) => <Textarea {...control} rows={2} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />}
            </FormField>
            <p className="text-xs text-muted-foreground">The homeowner sees every line with tax pending confirmation and a $0 deposit. A quote can’t be approved until tax is confirmed.</p>
            <Button type="submit" className="bg-commitment text-commitment-foreground hover:bg-commitment-hover" disabled={busy} aria-busy={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Send />}Send itemized quote
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
