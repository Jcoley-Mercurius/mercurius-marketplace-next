"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import { FinanceAchCommands } from "@/components/admin/FinanceAchCommands";
import { FinanceRecoveryCommands } from "@/components/admin/FinanceRecoveryCommands";
import { FinanceStatementCommands } from "@/components/admin/FinanceStatementCommands";
import {
  allocationError,
  batchDetails,
  blockerLabel,
  canReadBackRefund,
  canReissueRefund,
  canRequestRefundRelease,
  canResendRefund,
  canSendRefund,
  cancellationKindLabel,
  closeDetails,
  commandErrorMessage,
  failedRefundBlockerLabel,
  formatDay,
  lateSettlementDetails,
  moneyDetails,
  operationLabel,
  parseCents,
  refundAttemptLabel,
  refundErrorMessage,
  recoveryDetails,
  recoveryKindLabel,
  reissueBlockerLabel,
  releaseDetails,
  retryDetails,
  reviewAction,
  withdrawalDetails,
  reviewStateLabel,
  type Components,
  type FinanceOperations,
  type PendingRefund,
  type ReviewOperation,
  type ReviewRequest,
} from "@/lib/financeCommands";
import { formatCents, type ObligationReconciliation } from "@/lib/financeReconciliation";
import { paymentFunctionError } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";

// TRACE-076/077/078/079/080/081/082 finance operator commands. The signed-in session is the actor; the database refuses
// anyone without finance authority, binds second-person commands to their exact text, expires them
// after 24 hours and picks the approver. Every command is confirmed by re-reading the server before
// it is reported done.

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

const formatDate = (value: string) =>
  new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const shortId = (value: string) => value.slice(0, 8);

const components = (parts: Components) =>
  `service ${formatCents(parts.service)} · tax ${formatCents(parts.tax)} · tip ${formatCents(parts.tip)}`;

// A refund or chargeback on a paid payout leaves the provider's share owed (TRACE-080).
const paidNote = (what: "refund" | "chargeback") =>
  `The provider was already paid for this invoice. Their share of this ${what} becomes an amount they owe, listed under Amounts providers owe; it is recovered only by a reviewed repayment or write-off.`;

const executeConsequence: Record<ReviewOperation, string> = {
  hold_resolution: "Releases this payout hold. The payout still needs every other check before ACH preparation.",
  reconciliation_resolution: "Closes the Stripe readback hold for this invoice. Other holds stay in place.",
  event_exclusion: "Excludes this Stripe event permanently. It will never be processed or replayed, and it stops holding payouts.",
  refund_authorization: "Authorizes this exact refund with you as author and the approver as reviewer. Nothing is sent to Stripe until one of you sends it, and the payout stays held until it settles.",
  cancellation_refund: "Authorizes the cancellation policy refund with you as author and the approver as reviewer. Nothing is sent to Stripe until one of you sends it.",
  chargeback_allocation: "Allocates the lost chargeback to service, tax and tip in the ledger and reduces provider proceeds and the platform fee to match. It cannot be undone here.",
  ach_preparation: "Prepares the weekly ACH statement for these payouts at these amounts, with you as author and the approver as reviewer. Nothing is sent: record each submission here immediately before sending it at the bank.",
  ach_retry: "Prepares a new attempt for this transfer at its statement amount. Nothing is sent: record the submission here immediately before sending it at the bank.",
  ach_withdrawal: "Withdraws this transfer from its statement, with you as author and the approver as reviewer. It can then never be sent, retried or given a bank outcome. The payout returns to the ready list, where a later weekly batch prepares its replacement statement at its current amount and bank authorization.",
  ach_late_settlement: "Records that the bank paid this withdrawn transfer and posts it as paid to the provider, with you as author and the approver as reviewer. If a replacement was also paid, the provider then owes the duplicate; if not, no replacement can be sent. It cannot be undone here.",
  payout_recovery: "Records this repayment or write-off against what the provider owes, with you as author and the approver as reviewer. It cannot be undone here.",
  bank_statement_close: "Closes this bank statement with you as author and the approver as reviewer, and fixes how each of its lines is matched. It then takes no more lines and cannot change.",
  refund_release: "Takes this failed refund off the books with you as author and the approver as reviewer. It stops holding the payout and frees its amount; it can never be sent again. If the customer is still owed, request a new refund. It cannot be undone here.",
};

export function FinanceCommands({
  obligations,
  onChanged,
}: {
  obligations: ObligationReconciliation[];
  onChanged: () => Promise<void>;
}) {
  const [ops, setOps] = useState<FinanceOperations | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(false);
  // One key per confirmed command: a retry after a lost response replays instead of repeating.
  const [nonce] = useState(() => crypto.randomUUID());
  const [sequence, setSequence] = useState(0);
  const key = (operation: string) => `finance:${nonce}:${sequence}:${operation}`;

  const [holdInvoice, setHoldInvoice] = useState("");
  const [holdEvidence, setHoldEvidence] = useState("");
  const [releaseHold, setReleaseHold] = useState("");
  const [releaseEvidence, setReleaseEvidence] = useState("");
  const [refundInvoice, setRefundInvoice] = useState("");
  const [refundPayment, setRefundPayment] = useState("");
  const [refundParts, setRefundParts] = useState({ service: "", tax: "", tip: "" });
  const [refundPolicy, setRefundPolicy] = useState("");
  const [chargebackDispute, setChargebackDispute] = useState("");
  const [chargebackParts, setChargebackParts] = useState({ service: "", tax: "", tip: "" });
  const [readbackInvoice, setReadbackInvoice] = useState("");
  const [readbackAmount, setReadbackAmount] = useState("");
  const [readbackEvidence, setReadbackEvidence] = useState("");
  const [excludeEvent, setExcludeEvent] = useState("");
  const [excludeEvidence, setExcludeEvidence] = useState("");

  const read = useCallback(async () => {
    const { data, error } = await createClient().rpc("money_finance_operations");
    if (error) throw new Error(error.message);
    return data as unknown as FinanceOperations;
  }, []);

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      setOps(await read());
    } catch {
      setLoadError("Finance commands could not be loaded. Refresh before acting.");
    }
  }, [read]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const run = async (
    call: () => Promise<void>,
    confirmed: (next: FinanceOperations) => boolean,
    success: { title: string; description: string },
  ) => {
    setPending(true);
    try {
      await call();
      const next = await read();
      setOps(next);
      void onChanged();
      if (!confirmed(next)) throw new Error("The server did not confirm this command. Review the current state before retrying.");
      setSequence((value) => value + 1);
      toast.success(success.title, { description: success.description });
    } catch (error) {
      toast.error("Finance command not completed", {
        description: error instanceof Error ? error.message : "Refresh the page before trying again.",
      });
      void refresh();
      throw error;
    } finally {
      setPending(false);
    }
  };

  // The Supabase RPC builder is a thenable; every command shares one refusal wording.
  const accepted = async <T,>(call: PromiseLike<{ data: T; error: { message: string } | null }>) => {
    const { data, error } = await call;
    if (error) throw new Error(commandErrorMessage(error.message));
    return data as unknown as Record<string, unknown> | null;
  };

  const refund = async (body: Record<string, unknown>) => {
    const { data, error } = await createClient().functions.invoke("refund-invoice", { body });
    if (error) throw new Error(refundErrorMessage((await paymentFunctionError(error)).code));
    return data as { status?: string; found?: boolean; provider_status?: string | null };
  };

  if (!ops) {
    return loadError ? (
      <PageState
        kind="error"
        title="Finance commands unavailable"
        description={loadError}
        action={<Button onClick={() => void refresh()}><RefreshCw />Try again</Button>}
      />
    ) : (
      <PageState kind="loading" title="Loading finance commands" />
    );
  }

  const invoiceLabel = (id: string | null, invoice: string | null) =>
    invoice ?? (id ? `Obligation ${shortId(id)}` : "No invoice linked");
  const holdable = obligations.filter((row) => !row.payout.statement);
  const amountCents = parseCents(readbackAmount);
  const busy = pending;
  const partsCents = (parts: { service: string; tax: string; tip: string }): Components | null => {
    const service = parseCents(parts.service || "0");
    const tax = parseCents(parts.tax || "0");
    const tip = parseCents(parts.tip || "0");
    return service === null || tax === null || tip === null ? null : { service, tax, tip };
  };
  const refundable = obligations.filter((row) => row.charges.payments.length > 0);
  const refundRow = refundable.find((row) => row.obligation_id === refundInvoice);
  const refundCents = partsCents(refundParts);
  const refundTotal = refundCents ? refundCents.service + refundCents.tax + refundCents.tip : 0;
  const chargeback = ops.chargebacks.find((item) => item.dispute_id === chargebackDispute);
  const chargebackCents = partsCents(chargebackParts);
  const chargebackError = chargeback && chargebackCents ? allocationError(chargeback.amount, chargeback.retained, chargebackCents) : null;

  // Every second-person request confirms the same way: the new request reads back as mine.
  const submitRequest = (operation: ReviewOperation, entity: string, call: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    let requestId = "";
    return run(
      async () => {
        const data = await accepted(call());
        requestId = typeof data?.request_id === "string" ? data.request_id : "";
      },
      (next) => next.requests.some((item) => item.request_id === requestId && item.requested_by_me && item.state !== "expired"),
      { title: "Review requested", description: `${operationLabel[operation]} · ${entity}. A different finance operator must approve it within 24 hours; then you run it.` },
    );
  };

  const requestReview = (operation: ReviewOperation, subject: string, evidence: string | null, entity: string) =>
    (reason: string) => submitRequest(operation, entity, () => createClient().rpc("money_operator_request_review", {
      p_operation: operation, p_subject: subject, p_reason: reason, p_key: key(`${operation}:${subject}`), p_evidence: evidence ?? undefined,
    }));

  const reviewEntity = (request: ReviewRequest) => {
    const batch = batchDetails(request);
    const retry = retryDetails(request);
    const withdrawal = withdrawalDetails(request);
    const late = lateSettlementDetails(request);
    const recovery = recoveryDetails(request);
    const close = closeDetails(request);
    const money = moneyDetails(request);
    const release = releaseDetails(request);
    if (close) return `Statement ${formatDay(close.period_start)} to ${formatDay(close.period_end)}`;
    if (release) return `${invoiceLabel(request.obligation_id, request.invoice_number)} · ${release.payment_id}`;
    if (request.operation === "event_exclusion") {
      return `${request.subject}${request.obligation_id ? ` · ${invoiceLabel(request.obligation_id, request.invoice_number)}` : ""}`;
    }
    if (batch) return `Week of ${formatDay(batch.period_start)} · ${batch.items.length} payout${batch.items.length === 1 ? "" : "s"}`;
    if (retry) return `${invoiceLabel(request.obligation_id, request.invoice_number)} · ${retry.payee_name ?? "Provider"} · attempt ${retry.attempt_number} ${retry.status}`;
    if (withdrawal) {
      return `${invoiceLabel(request.obligation_id, request.invoice_number)} · ${withdrawal.payee_name ?? "Provider"} · week of ${formatDay(withdrawal.period_start)} · attempt ${withdrawal.attempt_number} ${withdrawal.status}`;
    }
    if (late) {
      return `${invoiceLabel(request.obligation_id, request.invoice_number)} · ${late.payee_name ?? "Provider"} · withdrawn from the week of ${formatDay(late.period_start)} · attempt ${late.attempt_number}`;
    }
    if (recovery) return `${invoiceLabel(request.obligation_id, request.invoice_number)} · ${recovery.payee_name ?? "Provider"} · ${recoveryKindLabel[recovery.kind].toLowerCase()}`;
    return money?.dispute_id ? `${money.dispute_id} · ${invoiceLabel(request.obligation_id, request.invoice_number)}` : invoiceLabel(request.obligation_id, request.invoice_number);
  };
  const reviewAmounts = (request: ReviewRequest) => {
    const batch = batchDetails(request);
    const retry = retryDetails(request);
    const withdrawal = withdrawalDetails(request);
    const late = lateSettlementDetails(request);
    const recovery = recoveryDetails(request);
    const close = closeDetails(request);
    const money = moneyDetails(request);
    const release = releaseDetails(request);
    if (release) {
      return `${formatCents(release.amount)} (${components(release)}) · Stripe refund ${release.provider_reference ?? "unknown"}${release.provider_status ? ` ${release.provider_status}` : ""}`;
    }
    if (close) {
      return `${close.lines} line${close.lines === 1 ? "" : "s"} · debits ${formatCents(close.debits)} · credits ${formatCents(close.credits)}${close.exceptions_now > 0 ? ` · ${close.exceptions_now} open exception${close.exceptions_now === 1 ? "" : "s"} now` : ""}`;
    }
    if (batch) return `${formatCents(batch.total)} · bank batch ${batch.bank_ref}`;
    if (retry) return formatCents(retry.amount);
    if (withdrawal) {
      return `${formatCents(withdrawal.amount)}${withdrawal.bank_reference_hint ? ` · reference ends ${withdrawal.bank_reference_hint}` : ""}${withdrawal.bank_evidence ? ` · bank showed: ${withdrawal.bank_evidence}` : ""}`;
    }
    if (late) {
      const replacement = late.replacement
        ? ` · replacement for the week of ${formatDay(late.replacement.period_start)} ${late.replacement.status === "settled" ? "was also paid, so the provider will owe the duplicate" : `is ${late.replacement.status}`}`
        : " · no replacement was prepared";
      return `${formatCents(late.amount)}${late.bank_reference_hint ? ` · reference ends ${late.bank_reference_hint}` : ""}${replacement}`;
    }
    if (recovery) {
      return `${formatCents(recovery.amount)} of ${formatCents(recovery.owed)} owed${recovery.owed_now !== recovery.owed ? ` (now ${formatCents(recovery.owed_now)})` : ""}`;
    }
    return money ? `${money.payment_id ? `${money.payment_id} · ` : ""}${formatCents(money.service + money.tax + money.tip)} (${components(money)})` : null;
  };

  return (
    <section aria-labelledby="finance-commands" className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="finance-commands" className="text-lg font-semibold">Finance commands</h2>
          <p className="text-sm text-muted-foreground">
            Recorded as you, with your finance authority. Authorizing a refund, releasing a refund Stripe failed, allocating a lost chargeback, resolving a readback and excluding a Stripe event need a different finance operator to approve the exact command in their own session within 24 hours; you then run it. Preparing a weekly ACH batch, retrying a failed transfer, withdrawing a transfer from its statement, recording a late payment of a withdrawn transfer and recording a provider repayment or write-off need a second operator too, and so does closing a bank statement. Resending a failed refund, placing and releasing a payout hold, recording a bank outcome, and importing, matching or dismissing bank statement lines need one operator.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw />Refresh commands</Button>
      </div>
      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}

      <div className="space-y-3">
        <h3 className="font-medium">Second-person reviews ({ops.requests.filter((item) => item.state !== "executed").length} open)</h3>
        {ops.requests.length === 0 ? (
          <PageState kind="empty" title="No review requests" description="Requests to prepare ACH batches, retry or withdraw transfers, record late payments and provider recoveries, close bank statements, authorize or release refunds, allocate chargebacks, resolve readbacks or exclude events appear here for a second operator." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Second-person reviews"
              rows={ops.requests}
              rowKey={(item) => item.request_id}
              rowLabel={(item) => `${operationLabel[item.operation]} · ${reviewEntity(item)}`}
              columns={[
                {
                  key: "command",
                  label: "Command",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <span className="font-medium">{operationLabel[item.operation]}</span>
                      <span className="text-xs text-muted-foreground">{reviewEntity(item)}</span>
                      {reviewAmounts(item) && <span className="text-xs tabular-nums">{reviewAmounts(item)}</span>}
                      {batchDetails(item) && (
                        <ul className="text-xs text-muted-foreground tabular-nums">
                          {batchDetails(item)!.items.map((payout) => (
                            <li key={payout.obligation_id}>
                              {invoiceLabel(payout.obligation_id, payout.invoice_number)} · {payout.payee_name ?? "Provider"} · {formatCents(payout.amount)}
                              {payout.replaces && <> · replaces the withdrawn week of {formatDay(payout.replaces.period_start)} ({formatCents(payout.replaces.amount)})</>}
                              {payout.blocker && <> · {blockerLabel[payout.blocker]}</>}
                            </li>
                          ))}
                        </ul>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Requested {item.requested_by_me ? "by you" : "by another operator"} · {formatDate(item.created_at)}
                        {item.state !== "executed" && ` · ${item.state === "expired" ? "expired" : "expires"} ${formatDate(item.expires_at)}`}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "why",
                  label: "Reason and evidence",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <span>{item.reason}</span>
                      {item.evidence && <span className="text-xs text-muted-foreground">Evidence: {item.evidence}</span>}
                    </span>
                  ),
                },
                {
                  key: "state",
                  label: "Status",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5">
                      <span className="font-medium">{reviewStateLabel[item.state]}</span>
                      <span className="text-xs text-muted-foreground">{reviewAction(item).note}</span>
                    </span>
                  ),
                },
                {
                  key: "action",
                  label: "Action",
                  render: (item) => {
                    const action = reviewAction(item);
                    if (action.kind === "approve") {
                      return (
                        <ConfirmAction
                          disabled={busy}
                          requireReason
                          reasonLabel="Approval note"
                          reasonHelp="What you checked, for example the Stripe or ticket reference you read."
                          confirmationTone="commitment"
                          triggerLabel="Approve"
                          title={`Approve: ${operationLabel[item.operation].toLowerCase()}?`}
                          entity={reviewEntity(item)}
                          consequence={`Approves exactly this command as a second finance operator: "${item.reason}"${item.evidence ? ` with evidence "${item.evidence}"` : ""}${reviewAmounts(item) ? ` for ${reviewAmounts(item)}` : ""}. Nothing changes until the requester runs it, it cannot run if anything has changed, and it expires ${formatDate(item.expires_at)}.`}
                          confirmLabel="Approve"
                          onConfirm={(note) => run(
                            async () => { await accepted(createClient().rpc("money_operator_approve_review", { p_request: item.request_id, p_reason: note })); },
                            (next) => next.requests.some((candidate) => candidate.request_id === item.request_id && candidate.approved_by_me),
                            { title: "Command approved", description: `${operationLabel[item.operation]} · ${reviewEntity(item)}. The requester can now run it.` },
                          )}
                        />
                      );
                    }
                    if (action.kind === "execute") {
                      return (
                        <ConfirmAction
                          disabled={busy}
                          confirmationTone={item.operation === "hold_resolution" ? "commitment" : "destructive"}
                          triggerLabel="Run approved command"
                          title={`Run: ${operationLabel[item.operation].toLowerCase()}?`}
                          entity={reviewAmounts(item) ? `${reviewEntity(item)} · ${reviewAmounts(item)}` : reviewEntity(item)}
                          consequence={executeConsequence[item.operation]}
                          confirmLabel="Run"
                          onConfirm={() => run(
                            async () => { await accepted(createClient().rpc("money_operator_execute_review", { p_request: item.request_id })); },
                            (next) => next.requests.some((candidate) => candidate.request_id === item.request_id && candidate.state === "executed"),
                            { title: "Approved command run", description: `${operationLabel[item.operation]} · ${reviewEntity(item)}.` },
                          )}
                        />
                      );
                    }
                    return <span className="text-muted-foreground">—</span>;
                  },
                },
              ]}
            />
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-medium">Place a payout hold</h3>
          <p className="text-sm text-muted-foreground">Stops ACH preparation for one invoice. A payout on an ACH statement cannot be held unless its transfer is withdrawn first.</p>
          <FormField label="Invoice" required>
            {(control) => (
              <select {...control} className={selectClass} value={holdInvoice} disabled={busy} onChange={(event) => setHoldInvoice(event.target.value)}>
                <option value="">{holdable.length ? "Select an invoice" : "No invoice can be held"}</option>
                {holdable.map((row) => <option key={row.obligation_id} value={row.obligation_id}>{invoiceLabel(row.obligation_id, row.invoice_number)} · {row.payee.name ?? "Provider"}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Evidence" required help="Ticket, dispute or message reference that supports the hold.">
            {(control) => <Input {...control} value={holdEvidence} maxLength={1000} disabled={busy} onChange={(event) => setHoldEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !holdInvoice || !holdEvidence.trim()}
            requireReason
            reasonLabel="Hold reason"
            triggerLabel="Place hold"
            title="Hold this provider payout?"
            entity={invoiceLabel(holdInvoice, holdable.find((row) => row.obligation_id === holdInvoice)?.invoice_number ?? null)}
            consequence="Stops ACH preparation for this invoice until a finance operator releases it. The provider is not notified by this action."
            confirmLabel="Place hold"
            onConfirm={(reason) => {
              const invoice = holdInvoice;
              const evidence = holdEvidence.trim();
              return run(
                async () => { await accepted(createClient().rpc("money_operator_place_hold", { p_obligation: invoice, p_reason: reason, p_evidence: evidence, p_key: key(`hold:${invoice}`) })); },
                (next) => next.holds.some((hold) => hold.obligation_id === invoice && hold.placed_by_me && hold.evidence === evidence && hold.reason === reason),
                { title: "Payout hold placed", description: "ACH preparation is stopped for this invoice." },
              ).then(() => { setHoldInvoice(""); setHoldEvidence(""); });
            }}
          />
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-medium">Release a payout hold</h3>
          <p className="text-sm text-muted-foreground">
            {ops.holds.length === 0 ? "No payout hold is open." : `${ops.holds.length} open hold${ops.holds.length === 1 ? "" : "s"}.`} One finance operator can release a hold.
          </p>
          <FormField label="Hold" required>
            {(control) => (
              <select {...control} className={selectClass} value={releaseHold} disabled={busy || ops.holds.length === 0} onChange={(event) => setReleaseHold(event.target.value)}>
                <option value="">{ops.holds.length ? "Select a hold" : "No open holds"}</option>
                {ops.holds.map((hold) => <option key={hold.hold_id} value={hold.hold_id}>{invoiceLabel(hold.obligation_id, hold.invoice_number)} · {hold.reason}</option>)}
              </select>
            )}
          </FormField>
          {releaseHold && (() => {
            const hold = ops.holds.find((item) => item.hold_id === releaseHold);
            return hold ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">Placed {hold.placed_by_me ? "by you" : "by another operator"} {formatDate(hold.created_at)} · Evidence: {hold.evidence}</p> : null;
          })()}
          <FormField label="Release evidence" required help="What shows the cause is cleared.">
            {(control) => <Input {...control} value={releaseEvidence} maxLength={1000} disabled={busy} onChange={(event) => setReleaseEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !releaseHold || !releaseEvidence.trim()}
            requireReason
            reasonLabel="Release reason"
            confirmationTone="commitment"
            triggerLabel="Release hold"
            title="Release this payout hold?"
            entity={invoiceLabel(ops.holds.find((hold) => hold.hold_id === releaseHold)?.obligation_id ?? null, ops.holds.find((hold) => hold.hold_id === releaseHold)?.invoice_number ?? null)}
            consequence="Releases the hold under your name now. The payout still needs every other check before ACH preparation."
            confirmLabel="Release hold"
            onConfirm={(reason) => {
              const hold = releaseHold;
              const evidence = releaseEvidence.trim();
              return run(
                async () => { await accepted(createClient().rpc("money_operator_release_hold", { p_hold: hold, p_reason: reason, p_evidence: evidence })); },
                (next) => !next.holds.some((item) => item.hold_id === hold),
                { title: "Payout hold released", description: "Other payout checks still apply." },
              ).then(() => { setReleaseHold(""); setReleaseEvidence(""); });
            }}
          />
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-medium">Record a Stripe readback</h3>
          <p className="text-sm text-muted-foreground">Enter what Stripe shows as collected for the invoice after refunds. A mismatch holds the payout; a match never clears a hold on its own.</p>
          <FormField label="Invoice" required>
            {(control) => (
              <select {...control} className={selectClass} value={readbackInvoice} disabled={busy} onChange={(event) => setReadbackInvoice(event.target.value)}>
                <option value="">{obligations.length ? "Select an invoice" : "No invoices"}</option>
                {obligations.map((row) => <option key={row.obligation_id} value={row.obligation_id}>{invoiceLabel(row.obligation_id, row.invoice_number)} · ledger {formatCents(row.charges.captured - row.refunds.service - row.refunds.tax - row.refunds.tip)}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Amount at Stripe (USD)" required help="Collected less refunded, for example 117.00." error={readbackAmount && amountCents === null ? "Enter dollars and cents, for example 117.00." : undefined}>
            {(control) => <Input {...control} inputMode="decimal" value={readbackAmount} disabled={busy} onChange={(event) => setReadbackAmount(event.target.value)} />}
          </FormField>
          <FormField label="Stripe reference" required help="The payment or balance transaction you read, for example pi_…">
            {(control) => <Input {...control} value={readbackEvidence} maxLength={1000} disabled={busy} onChange={(event) => setReadbackEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !readbackInvoice || amountCents === null || !readbackEvidence.trim()}
            confirmationTone="commitment"
            triggerLabel="Record readback"
            title="Record this Stripe readback?"
            entity={`${invoiceLabel(readbackInvoice, obligations.find((row) => row.obligation_id === readbackInvoice)?.invoice_number ?? null)} · ${amountCents === null ? "" : formatCents(amountCents)}`}
            consequence="Records the amount as observed at Stripe under your name. If it differs from the ledger, the payout is held until a matching readback is resolved by two operators."
            confirmLabel="Record"
            onConfirm={() => {
              const invoice = readbackInvoice;
              const observed = amountCents!;
              const evidence = readbackEvidence.trim();
              let matched = false;
              return run(
                async () => {
                  const data = await accepted(createClient().rpc("money_operator_record_readback", {
                    p_obligation: invoice, p_observed: observed, p_currency: "usd", p_evidence: evidence, p_key: key(`readback:${invoice}`),
                  }));
                  matched = data?.matched === true;
                },
                (next) => matched || next.readbacks.some((item) => item.obligation_id === invoice && item.observed === observed && item.recorded_by_me === true),
                { title: "Stripe readback recorded", description: "Check the invoice's readback state below." },
              ).then(() => { setReadbackInvoice(""); setReadbackAmount(""); setReadbackEvidence(""); });
            }}
          />
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-medium">Request a Stripe event exclusion</h3>
          <p className="text-sm text-muted-foreground">Only for a failed event you have read back at Stripe that moved no money. An unsupported event holds every payout until it is excluded.</p>
          <FormField label="Event" required>
            {(control) => (
              <select {...control} className={selectClass} value={excludeEvent} disabled={busy || ops.events.length === 0} onChange={(event) => setExcludeEvent(event.target.value)}>
                <option value="">{ops.events.length ? "Select an event" : "No unprocessed events"}</option>
                {ops.events.map((event) => <option key={event.event_id} value={event.event_id} disabled={event.exclusion_blocker !== null}>{event.event_id} · {event.event_type}{event.exclusion_blocker ? " (not excludable)" : ""}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Stripe readback evidence" required help="What Stripe shows for this event and why it moved no money.">
            {(control) => <Input {...control} value={excludeEvidence} maxLength={1000} disabled={busy} onChange={(event) => setExcludeEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !excludeEvent || !excludeEvidence.trim()}
            requireReason
            reasonLabel="Exclusion reason"
            triggerLabel="Request exclusion"
            title="Request exclusion of this Stripe event?"
            entity={excludeEvent}
            consequence="Creates a review request. Once a different finance operator approves it and you run it, the event is never processed or replayed."
            confirmLabel="Request exclusion"
            onConfirm={(reason) => requestReview("event_exclusion", excludeEvent, excludeEvidence.trim(), excludeEvent)(reason).then(() => { setExcludeEvent(""); setExcludeEvidence(""); })}
          />
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-medium">Request a refund</h3>
          <p className="text-sm text-muted-foreground">An exact refund of service, tax and tip on one captured payment, for a decision such as a dispute outcome. For a cancellation, use the policy refund below.</p>
          <FormField label="Refund invoice" required>
            {(control) => (
              <select {...control} className={selectClass} value={refundInvoice} disabled={busy} onChange={(event) => { setRefundInvoice(event.target.value); setRefundPayment(""); }}>
                <option value="">{refundable.length ? "Select an invoice" : "No invoice has a captured payment"}</option>
                {refundable.map((row) => <option key={row.obligation_id} value={row.obligation_id}>{invoiceLabel(row.obligation_id, row.invoice_number)} · {row.payee.name ?? "Provider"}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Payment" required>
            {(control) => (
              <select {...control} className={selectClass} value={refundPayment} disabled={busy || !refundRow} onChange={(event) => setRefundPayment(event.target.value)}>
                <option value="">{refundRow ? "Select a payment" : "Select an invoice first"}</option>
                {refundRow?.charges.payments.map((payment) => <option key={payment.payment_id} value={payment.payment_id}>{payment.payment_id} · {payment.mode} · {formatCents(payment.amount)}</option>)}
              </select>
            )}
          </FormField>
          {refundRow && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {refundRow.terms && <>Invoice terms: {components({ service: refundRow.terms.subtotal, tax: refundRow.terms.tax, tip: refundRow.terms.tip })} · </>}refunded so far {components(refundRow.refunds)}
            </p>
          )}
          {refundRow?.payout.funds_state === "paid" && (
            <p className="text-sm text-status-warning">{paidNote("refund")}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
            {(["service", "tax", "tip"] as const).map((part) => (
              <FormField key={part} label={`Refund ${part} (USD)`} error={refundParts[part] && parseCents(refundParts[part]) === null ? "Enter dollars and cents." : undefined}>
                {(control) => <Input {...control} inputMode="decimal" placeholder="0.00" value={refundParts[part]} disabled={busy} onChange={(event) => setRefundParts((value) => ({ ...value, [part]: event.target.value }))} />}
              </FormField>
            ))}
          </div>
          <FormField label="Policy reference" required help="The decision this refund carries out, for example a dispute ticket or rework agreement.">
            {(control) => <Input {...control} value={refundPolicy} maxLength={1000} disabled={busy} onChange={(event) => setRefundPolicy(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !refundRow || !refundPayment || !refundCents || refundTotal === 0 || !refundPolicy.trim()}
            requireReason
            reasonLabel="Refund reason"
            confirmationTone="commitment"
            triggerLabel="Request refund"
            title="Request this refund?"
            entity={`${invoiceLabel(refundInvoice, refundRow?.invoice_number ?? null)} · ${refundPayment} · ${formatCents(refundTotal)}`}
            consequence={`Creates a review request for ${refundCents ? components(refundCents) : ""}. A different finance operator must approve it within 24 hours; you then run it to authorize the refund. Nothing is sent to Stripe until the refund is sent.`}
            confirmLabel="Request refund"
            onConfirm={(reason) => {
              const invoice = refundInvoice;
              const payment = refundPayment;
              const parts = refundCents!;
              const policy = refundPolicy.trim();
              return submitRequest("refund_authorization", invoiceLabel(invoice, refundRow?.invoice_number ?? null), () => createClient().rpc("money_operator_request_refund", {
                p_obligation: invoice, p_payment: payment, p_service: parts.service, p_tax: parts.tax, p_tip: parts.tip,
                p_policy: policy, p_reason: reason, p_key: key(`refund:${invoice}:${payment}`),
              })).then(() => { setRefundInvoice(""); setRefundPayment(""); setRefundParts({ service: "", tax: "", tip: "" }); setRefundPolicy(""); });
            }}
          />
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h3 className="font-medium">Allocate a lost chargeback</h3>
          <p className="text-sm text-muted-foreground">
            {ops.chargebacks.length === 0 ? "No lost chargeback is waiting." : `${ops.chargebacks.length} lost chargeback${ops.chargebacks.length === 1 ? "" : "s"} to allocate.`} Split the lost principal across the service, tax and tip the invoice still retains. Dispute costs stay with Mercurius.
          </p>
          <FormField label="Chargeback" required>
            {(control) => (
              <select {...control} className={selectClass} value={chargebackDispute} disabled={busy || ops.chargebacks.length === 0} onChange={(event) => setChargebackDispute(event.target.value)}>
                <option value="">{ops.chargebacks.length ? "Select a chargeback" : "No lost chargebacks"}</option>
                {ops.chargebacks.map((item) => <option key={item.dispute_id} value={item.dispute_id} disabled={item.blocker !== null || item.open_request_id !== null}>{item.dispute_id} · {invoiceLabel(item.obligation_id, item.invoice_number)} · {formatCents(item.amount)}{item.open_request_id ? " (requested)" : item.blocker ? " (blocked)" : ""}</option>)}
              </select>
            )}
          </FormField>
          {chargeback && <p className="text-xs text-muted-foreground tabular-nums">Lost {formatCents(chargeback.amount)} · retained {components(chargeback.retained)}</p>}
          {chargeback && obligations.find((row) => row.obligation_id === chargeback.obligation_id)?.payout.funds_state === "paid" && (
            <p className="text-sm text-status-warning">{paidNote("chargeback")}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
            {(["service", "tax", "tip"] as const).map((part) => (
              <FormField key={part} label={`Chargeback ${part} (USD)`} error={chargebackParts[part] && parseCents(chargebackParts[part]) === null ? "Enter dollars and cents." : undefined}>
                {(control) => <Input {...control} inputMode="decimal" placeholder="0.00" value={chargebackParts[part]} disabled={busy} onChange={(event) => setChargebackParts((value) => ({ ...value, [part]: event.target.value }))} />}
              </FormField>
            ))}
          </div>
          {chargeback && chargebackCents && chargebackError && <p className="text-sm text-muted-foreground">{chargebackError}</p>}
          <ConfirmAction
            disabled={busy || !chargeback || !chargebackCents || chargebackError !== null}
            requireReason
            reasonLabel="Allocation reason"
            confirmationTone="commitment"
            triggerLabel="Request allocation"
            title="Request this chargeback allocation?"
            entity={`${chargebackDispute} · ${chargebackCents ? components(chargebackCents) : ""}`}
            consequence="Creates a review request. A different finance operator must approve it within 24 hours; you then run it to post the loss to the ledger."
            confirmLabel="Request allocation"
            onConfirm={(reason) => {
              const dispute = chargebackDispute;
              const parts = chargebackCents!;
              return submitRequest("chargeback_allocation", dispute, () => createClient().rpc("money_operator_request_chargeback", {
                p_dispute: dispute, p_service: parts.service, p_tax: parts.tax, p_tip: parts.tip, p_reason: reason, p_key: key(`chargeback:${dispute}`),
              })).then(() => { setChargebackDispute(""); setChargebackParts({ service: "", tax: "", tip: "" }); });
            }}
          />
        </div>
      </div>

      {ops.ach ? (
        <FinanceAchCommands ops={ops} busy={busy} run={run} accepted={accepted} submitRequest={submitRequest} commandKey={key} />
      ) : (
        <PageState kind="error" title="Weekly ACH unavailable" description="The server did not return ACH batches. Do not send transfers until this page shows them." />
      )}

      {ops.recoveries ? (
        <FinanceRecoveryCommands ops={ops} busy={busy} submitRequest={submitRequest} commandKey={key} />
      ) : (
        <PageState kind="error" title="Provider recoveries unavailable" description="The server did not return what providers owe. Refresh before recording a repayment or write-off." />
      )}

      {ops.statements ? (
        <FinanceStatementCommands ops={ops} busy={busy} run={run} accepted={accepted} submitRequest={submitRequest} commandKey={key} />
      ) : (
        <PageState kind="error" title="Bank statements unavailable" description="The server did not return bank statements. Refresh before importing or closing a statement." />
      )}

      <div className="space-y-3">
        <h3 className="font-medium">Cancellation refunds due ({ops.cancellations.length})</h3>
        {ops.cancellations.length === 0 ? (
          <PageState kind="empty" title="No cancellation refunds due" description="Cancellations whose policy gives a refund appear here. A provider cancellation appears once a no-replacement decision is recorded." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Cancellation refunds due"
              rows={ops.cancellations}
              rowKey={(item) => `${item.operation_id}:${item.payment_id}`}
              rowLabel={(item) => `${invoiceLabel(item.obligation_id, item.invoice_number)} · ${item.payment_id}`}
              columns={[
                {
                  key: "cancellation",
                  label: "Cancellation",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <span className="font-medium">{invoiceLabel(item.obligation_id, item.invoice_number)}</span>
                      <span className="text-xs text-muted-foreground">{cancellationKindLabel[item.kind]} · {formatDate(item.cancelled_at)}</span>
                    </span>
                  ),
                },
                {
                  key: "refund",
                  label: "Policy refund",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5 tabular-nums [overflow-wrap:anywhere]">
                      <span>{item.refund_percent}% · {formatCents(item.service + item.tax + item.tip)}</span>
                      <span className="text-xs text-muted-foreground">{item.payment_id} · {components(item)}</span>
                    </span>
                  ),
                },
                {
                  key: "action",
                  label: "Action",
                  render: (item) => item.open_request_id ? <span className="text-muted-foreground">Requested; see reviews</span>
                    : item.blocker ? <span className="text-muted-foreground">{blockerLabel[item.blocker]}</span> : (
                      <ConfirmAction
                        disabled={busy}
                        requireReason
                        reasonLabel="Refund reason"
                        confirmationTone="commitment"
                        triggerLabel="Request policy refund"
                        title="Request this cancellation refund?"
                        entity={`${invoiceLabel(item.obligation_id, item.invoice_number)} · ${item.payment_id} · ${formatCents(item.service + item.tax + item.tip)}`}
                        consequence={`Creates a review request for the ${item.refund_percent}% policy refund: ${components(item)}. The amounts come from the recorded cancellation, not from you. A different finance operator must approve it within 24 hours.`}
                        confirmLabel="Request refund"
                        onConfirm={(reason) => submitRequest("cancellation_refund", invoiceLabel(item.obligation_id, item.invoice_number), () => createClient().rpc("money_operator_request_cancellation_refund", {
                          p_operation: item.operation_id, p_payment: item.payment_id, p_reason: reason, p_key: key(`cancellation:${item.operation_id}:${item.payment_id}`),
                        }))}
                      />
                    ),
                },
              ]}
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Stripe readbacks needing resolution ({ops.readbacks.length})</h3>
        {ops.readbacks.length === 0 ? (
          <PageState kind="empty" title="No open readback holds" description="Invoices with a Stripe readback mismatch or an open reconciliation appear here." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Stripe readbacks"
              rows={ops.readbacks}
              rowKey={(item) => item.obligation_id}
              rowLabel={(item) => invoiceLabel(item.obligation_id, item.invoice_number)}
              columns={[
                { key: "invoice", label: "Invoice", render: (item) => <span className="font-medium tabular-nums">{invoiceLabel(item.obligation_id, item.invoice_number)}</span> },
                {
                  key: "readback",
                  label: "Latest readback",
                  render: (item) => item.observation_id === null ? <span className="text-muted-foreground">None recorded</span> : (
                    <span className="flex flex-col gap-0.5 tabular-nums [overflow-wrap:anywhere]">
                      <span>Stripe {formatCents(item.observed ?? 0)} · ledger then {formatCents(item.expected ?? 0)} · now {formatCents(item.net_collected)}</span>
                      <span className="text-xs text-muted-foreground">{item.evidence} · {item.attributed ? (item.recorded_by_me ? "recorded by you" : "recorded by another operator") : "recorded by an automated path"}{item.recorded_at ? ` · ${formatDate(item.recorded_at)}` : ""}</span>
                    </span>
                  ),
                },
                { key: "state", label: "Resolution", render: (item) => item.resolution_blocker ? <span className="text-muted-foreground">{blockerLabel[item.resolution_blocker]}</span> : <span>Ready to request resolution</span> },
                {
                  key: "action",
                  label: "Action",
                  render: (item) => item.resolution_blocker || !item.observation_id ? <span className="text-muted-foreground">—</span> : (
                    <ConfirmAction
                      disabled={busy}
                      requireReason
                      reasonLabel="Resolution reason"
                      confirmationTone="commitment"
                      triggerLabel="Request resolution"
                      title="Request resolution of this readback?"
                      entity={invoiceLabel(item.obligation_id, item.invoice_number)}
                      consequence={`Creates a review request to close the readback hold on the matching ${formatCents(item.observed ?? 0)} readback. ${item.recorded_by_me ? "You recorded it, so a different operator must approve." : "A different finance operator must approve."}`}
                      confirmLabel="Request resolution"
                      onConfirm={requestReview("reconciliation_resolution", item.observation_id, null, invoiceLabel(item.obligation_id, item.invoice_number))}
                    />
                  ),
                },
              ]}
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Unprocessed Stripe events ({ops.events.length})</h3>
        {ops.events.length === 0 ? (
          <PageState kind="empty" title="No unprocessed Stripe events" description="Every received Stripe event is processed or excluded." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Unprocessed Stripe events"
              rows={ops.events}
              rowKey={(item) => item.event_id}
              rowLabel={(item) => `${item.event_id} · ${item.event_type}`}
              columns={[
                {
                  key: "event",
                  label: "Event",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <span className="font-medium">{item.event_id}</span>
                      <span className="text-xs text-muted-foreground">{item.event_type}{item.holds_all_payouts ? " · holds every payout" : ""}</span>
                    </span>
                  ),
                },
                { key: "status", label: "Status", render: (item) => `${item.status === "dead_letter" ? "Stopped retrying" : item.status} after ${item.attempts} attempt${item.attempts === 1 ? "" : "s"}` },
                { key: "exclusion", label: "Exclusion", render: (item) => item.exclusion_blocker ? <span className="text-muted-foreground">{blockerLabel[item.exclusion_blocker]}</span> : "Can be requested" },
                {
                  key: "action",
                  label: "Action",
                  render: (item) => (
                    <ConfirmAction
                      disabled={busy}
                      requireReason
                      reasonLabel="Replay reason"
                      confirmationTone="commitment"
                      triggerLabel="Replay event"
                      title="Replay this Stripe event?"
                      entity={item.event_id}
                      consequence={item.holds_all_payouts
                        ? "Runs the stored event through processing again. An unsupported event cannot be processed, so it will fail again; exclusion is how it stops holding payouts."
                        : "Runs the stored event through processing again. Processing re-checks the event, so a replay applies it only if it now matches the ledger."}
                      confirmLabel="Replay"
                      onConfirm={(reason) => {
                        const attempts = item.attempts;
                        return run(
                          async () => { await accepted(createClient().rpc("money_operator_replay_event", { p_event: item.event_id, p_reason: reason })); },
                          (next) => {
                            const after = next.events.find((candidate) => candidate.event_id === item.event_id);
                            return !after || after.attempts > attempts;
                          },
                          { title: "Stripe event replayed", description: `${item.event_id}. Check whether it is still listed.` },
                        );
                      }}
                    />
                  ),
                },
              ]}
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Reviewed refunds not settled ({ops.refunds.length})</h3>
        {ops.refunds.length === 0 ? (
          <PageState kind="empty" title="No unsettled refunds" description="Separately approved refunds appear here until Stripe's refund event settles them, or until a refund Stripe failed is released." />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label="Unsettled refunds"
              rows={ops.refunds}
              rowKey={(item) => item.authorization_id}
              rowLabel={(item) => `${invoiceLabel(item.obligation_id, item.invoice_number)} · ${formatCents(item.amount)}`}
              columns={[
                {
                  key: "refund",
                  label: "Refund",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5 tabular-nums [overflow-wrap:anywhere]">
                      <span className="font-medium">{invoiceLabel(item.obligation_id, item.invoice_number)} · {formatCents(item.amount)}</span>
                      <span className="text-xs text-muted-foreground">{item.payment_id}{item.provider_reference ? ` · ${item.provider_reference}` : ""}</span>
                    </span>
                  ),
                },
                {
                  key: "status",
                  label: "Status",
                  render: (item) => (
                    <span className="flex flex-col gap-0.5">
                      <span>{refundAttemptLabel[item.attempt_status]}{item.generation > 1 ? ` · sent again (send ${item.generation})` : ""}</span>
                      {item.last_readback && (
                        <span className="text-xs text-muted-foreground">
                          Last Stripe readback {formatDate(item.last_readback.created_at)}: {item.last_readback.found ? `Stripe status ${item.last_readback.provider_status}` : "not found at Stripe"}
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: "action",
                  label: "Action",
                  render: (item) => (
                    <span className="flex flex-col items-start gap-2">
                      {canSendRefund(item) && <RefundSend item={item} busy={busy} run={run} refund={refund} />}
                      {canReadBackRefund(item) && <RefundReadback item={item} busy={busy} run={run} refund={refund} />}
                      {canReissueRefund(item) && <RefundReissue item={item} busy={busy} run={run} accepted={accepted} />}
                      {item.attempt_status === "reconcile" && item.can_send && item.reissue_blocker && <span className="text-xs text-muted-foreground">{reissueBlockerLabel[item.reissue_blocker]}</span>}
                      {canResendRefund(item) && <RefundResend item={item} busy={busy} run={run} accepted={accepted} />}
                      {canRequestRefundRelease(item) && (
                        <RefundRelease item={item} busy={busy} entity={invoiceLabel(item.obligation_id, item.invoice_number)} submitRequest={submitRequest} commandKey={key} />
                      )}
                      {item.attempt_status === "failed" && item.resend_blocker && <span className="text-xs text-muted-foreground">{failedRefundBlockerLabel[item.resend_blocker]}</span>}
                      {item.open_release_request_id && <span className="text-xs text-muted-foreground">Release requested; see reviews.</span>}
                      {!canSendRefund(item) && !canReadBackRefund(item) && <span className="text-muted-foreground">Only the refund&apos;s author or approver can send it.</span>}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        )}
        {ops.refund_releases.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Failed refunds released in the last 30 days ({ops.refund_releases.length})</h4>
            <ul className="space-y-1 text-sm">
              {ops.refund_releases.map((item) => (
                <li key={item.authorization_id} className="[overflow-wrap:anywhere]">
                  <span className="font-medium tabular-nums">{invoiceLabel(item.obligation_id, item.invoice_number)} · {formatCents(item.amount)}</span>
                  <span className="text-muted-foreground"> · Stripe refund {item.provider_reference} · {item.reason} · {formatDate(item.created_at)}{item.by_me ? " · you took part" : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

export type Run = (
  call: () => Promise<void>,
  confirmed: (next: FinanceOperations) => boolean,
  success: { title: string; description: string },
) => Promise<void>;
type Refund = (body: Record<string, unknown>) => Promise<{ status?: string; found?: boolean; provider_status?: string | null }>;
export type Accepted = <T>(call: PromiseLike<{ data: T; error: { message: string } | null }>) => Promise<Record<string, unknown> | null>;

function RefundSend({ item, busy, run, refund }: { item: PendingRefund; busy: boolean; run: Run; refund: Refund }) {
  return (
    <ConfirmAction
      disabled={busy}
      triggerLabel="Send refund to Stripe"
      title="Send this refund to Stripe?"
      entity={`${item.payment_id} · ${formatCents(item.amount)}`}
      consequence="Asks Stripe to refund the separately approved amount to the customer's original payment. It is recorded as settled only when Stripe's refund event arrives."
      confirmLabel="Send refund"
      onConfirm={() => run(
        async () => {
          const result = await refund({ action: "send", authorization_id: item.authorization_id });
          if (result.status !== "awaiting_webhook" && result.status !== "succeeded") {
            throw new Error("Stripe was not asked again: this refund's outcome is uncertain. Read it back from Stripe; do not create a second refund.");
          }
        },
        (next) => !next.refunds.some((candidate) => candidate.authorization_id === item.authorization_id && candidate.attempt_status === "not_started"),
        { title: "Refund sent to Stripe", description: "Waiting for Stripe's refund event to settle it." },
      )}
    />
  );
}

function RefundReadback({ item, busy, run, refund }: { item: PendingRefund; busy: boolean; run: Run; refund: Refund }) {
  return (
    <ConfirmAction
      disabled={busy}
      confirmationTone="commitment"
      triggerLabel="Read back from Stripe"
      title="Read this refund back from Stripe?"
      entity={`${item.payment_id} · ${formatCents(item.amount)}`}
      consequence="Looks up this refund at Stripe and records what Stripe shows under your name. It never creates a refund and never marks one settled."
      confirmLabel="Read back"
      onConfirm={() => {
        const previous = item.last_readback?.created_at ?? null;
        return run(
          async () => { await refund({ action: "readback", authorization_id: item.authorization_id }); },
          (next) => {
            const after = next.refunds.find((candidate) => candidate.authorization_id === item.authorization_id);
            return !after || (after.last_readback !== null && after.last_readback.created_at !== previous);
          },
          { title: "Stripe refund read back", description: "The refund's Stripe status is recorded." },
        );
      }}
    />
  );
}

function RefundReissue({ item, busy, run, accepted }: { item: PendingRefund; busy: boolean; run: Run; accepted: Accepted }) {
  return (
    <ConfirmAction
      disabled={busy}
      requireReason
      reasonLabel="Reissue reason"
      reasonHelp="What the Stripe readback showed, for example no refund for this payment."
      triggerLabel="Reissue refund"
      title="Reissue this refund?"
      entity={`${item.payment_id} · ${formatCents(item.amount)}`}
      consequence="Stripe's readback found no refund, taken after its 24-hour idempotency window. This prepares the same approved amount again under a new Stripe key; send it next. It never changes the amount."
      confirmLabel="Reissue"
      onConfirm={(reason) => {
        const generation = item.generation;
        return run(
          async () => { await accepted(createClient().rpc("money_operator_reissue_refund", { p_authorization: item.authorization_id, p_reason: reason })); },
          (next) => next.refunds.some((candidate) => candidate.authorization_id === item.authorization_id && candidate.generation > generation && candidate.attempt_status === "prepared"),
          { title: "Refund reissued", description: "Send it to Stripe to complete the refund." },
        );
      }}
    />
  );
}

// TRACE-082: a refund Stripe reported failed, sent again under a new Stripe key by one operator.
function RefundResend({ item, busy, run, accepted }: { item: PendingRefund; busy: boolean; run: Run; accepted: Accepted }) {
  return (
    <ConfirmAction
      disabled={busy}
      requireReason
      reasonLabel="Resend reason"
      reasonHelp="Why sending it again should succeed, for example the customer's card was updated."
      triggerLabel="Resend refund"
      title="Resend this refund?"
      entity={`${item.payment_id} · ${formatCents(item.amount)}`}
      consequence="Stripe's readback shows this refund failed or was canceled. This prepares the same approved amount again under a new Stripe key; send it next. It never changes the amount."
      confirmLabel="Resend"
      onConfirm={(reason) => {
        const generation = item.generation;
        return run(
          async () => { await accepted(createClient().rpc("money_operator_resend_refund", { p_authorization: item.authorization_id, p_reason: reason })); },
          (next) => next.refunds.some((candidate) => candidate.authorization_id === item.authorization_id && candidate.generation > generation && candidate.attempt_status === "prepared"),
          { title: "Refund ready to resend", description: "Send it to Stripe to complete the refund." },
        );
      }}
    />
  );
}

// TRACE-082: a refund Stripe reported failed, taken off the books with a second operator.
function RefundRelease({
  item,
  busy,
  entity,
  submitRequest,
  commandKey,
}: {
  item: PendingRefund;
  busy: boolean;
  entity: string;
  submitRequest: (operation: ReviewOperation, entity: string, call: () => PromiseLike<{ data: unknown; error: { message: string } | null }>) => Promise<void>;
  commandKey: (operation: string) => string;
}) {
  const [evidence, setEvidence] = useState("");
  return (
    <span className="flex w-full flex-col gap-2">
      <FormField label="Release evidence" required help="What Stripe shows for the failed refund, and how the customer is being made whole, if they are.">
        {(control) => <Input {...control} value={evidence} maxLength={1000} disabled={busy} onChange={(event) => setEvidence(event.target.value)} />}
      </FormField>
      <ConfirmAction
        disabled={busy || !evidence.trim()}
        requireReason
        reasonLabel="Release reason"
        confirmationTone="commitment"
        triggerLabel="Request release"
        title="Release this failed refund?"
        entity={`${entity} · ${item.payment_id} · ${formatCents(item.amount)}`}
        consequence="Creates a review request. Once a different finance operator approves it within 24 hours and you run it, the refund is taken off the books: it stops holding the payout and its amount can be refunded again only through a new reviewed refund. It can never be sent again."
        confirmLabel="Request release"
        onConfirm={(reason) => submitRequest("refund_release", `${entity} · ${formatCents(item.amount)}`, () => createClient().rpc("money_operator_request_refund_release", {
          p_authorization: item.authorization_id, p_reason: reason, p_evidence: evidence.trim(), p_key: commandKey(`refund-release:${item.authorization_id}`),
        })).then(() => setEvidence(""))}
      />
    </span>
  );
}
