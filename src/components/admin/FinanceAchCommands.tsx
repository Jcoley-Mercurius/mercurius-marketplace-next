"use client";

import { useState } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import type { Accepted, Run } from "@/components/admin/FinanceCommands";
import {
  achOutcomeLabel,
  achOutcomes,
  achStatusLabel,
  blockerLabel,
  canRecordOutcome,
  canRequestRetry,
  canRequestWithdrawal,
  formatDay,
  weekEnd,
  type AchItem,
  type AchOutcome,
  type FinanceOperations,
  type ReviewOperation,
  type WithdrawableStatus,
} from "@/lib/financeCommands";
import { formatCents } from "@/lib/financeReconciliation";
import { createClient } from "@/lib/supabase/client";

// TRACE-078 weekly ACH. Mercurius sends each transfer from its own bank; this panel records
// permission and evidence only. A batch and a retry need a second finance operator; a bank
// outcome needs one. Recording a submission re-checks the payout, so it comes before sending.
// TRACE-079: a second operator also approves withdrawing a transfer the bank does not hold, so a
// later weekly batch can prepare its replacement statement.
// TRACE-080: a withdrawn transfer the bank paid after all shows its late payment here; it is
// recorded under Amounts providers owe.

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

const outcomeConsequence: Record<AchOutcome, string> = {
  submitted: "Re-checks that this payout is still payable at its statement amount and records it as submitted under your name. Send it at the bank only after this succeeds; if it is refused, do not send it.",
  settled: "Records the transfer as settled and posts the payout to the ledger. It cannot be undone here; a later return is recorded separately.",
  failed: "Records the failure. The payout can then be retried once a second finance operator approves.",
  unknown: "Records that the bank has not shown an outcome. An unknown transfer is never retried; record its outcome when the bank shows it.",
  returned: "Records the return and reverses the payout in the ledger. The payout can then be retried once a second finance operator approves.",
};

const withdrawalConsequence: Record<WithdrawableStatus, string> = {
  prepared: "Takes this unsent transfer off its statement. Check the bank portal first: if it was sent, withdrawing it and preparing a replacement would pay the provider twice.",
  failed: "Takes this failed transfer off its statement instead of retrying it, for example because the provider's bank authorization changed.",
  returned: "Takes this returned transfer off its statement instead of retrying it, for example because the provider's bank authorization changed.",
};

type SubmitRequest = (
  operation: ReviewOperation,
  entity: string,
  call: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
) => Promise<void>;

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export function FinanceAchCommands({
  ops,
  busy,
  run,
  accepted,
  submitRequest,
  commandKey,
}: {
  ops: FinanceOperations;
  busy: boolean;
  run: Run;
  accepted: Accepted;
  submitRequest: SubmitRequest;
  commandKey: (operation: string) => string;
}) {
  const ach = ops.ach;
  const [weekStart, setWeekStart] = useState(() => ach.next_period_start ?? today());
  const [selected, setSelected] = useState<string[]>([]);
  const [bankBatch, setBankBatch] = useState("");
  const [transfer, setTransfer] = useState("");
  const [outcome, setOutcome] = useState<AchOutcome | "">("");
  const [bankReference, setBankReference] = useState("");
  const [bankEvidence, setBankEvidence] = useState("");
  const [withdrawTransfer, setWithdrawTransfer] = useState("");
  const [withdrawEvidence, setWithdrawEvidence] = useState("");

  const selectable = ach.ready.filter((payout) => payout.blocker === null && payout.open_request_id === null);
  const chosen = selectable.filter((payout) => selected.includes(payout.obligation_id));
  const total = chosen.reduce((sum, payout) => sum + payout.amount, 0);
  const validWeek = /^\d{4}-\d{2}-\d{2}$/.test(weekStart);
  const label = (invoice: string | null, obligation: string) => invoice ?? `Obligation ${obligation.slice(0, 8)}`;

  const items = ach.batches.flatMap((batch) => batch.items);
  const recordable = items.filter(canRecordOutcome);
  const item = recordable.find((candidate) => candidate.attempt_id === transfer);
  const referenceRequired = outcome === "submitted" && !item?.bank_reference_hint;
  const withdrawable = items.filter(canRequestWithdrawal);
  const withdrawing = withdrawable.find((candidate) => candidate.attempt_id === withdrawTransfer);
  const itemLabel = (payout: AchItem) =>
    `${label(payout.invoice_number, payout.obligation_id)} · ${payout.payee_name ?? "Provider"} · ${formatCents(payout.amount)}`;

  return (
    <section aria-labelledby="finance-ach" className="space-y-4">
      <div>
        <h3 id="finance-ach" className="font-medium">Weekly ACH</h3>
        <p className="text-sm text-muted-foreground">
          Mercurius sends each transfer from its bank; nothing here moves money. Record a submission immediately before sending it: that re-checks the payout is still payable, and if it is refused, do not send it. Never enter account or routing numbers.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h4 className="font-medium">Prepare a weekly batch</h4>
          <FormField label="Week starts" required help={validWeek ? `Seven days, ending before ${formatDay(weekEnd(weekStart))}.` : "Choose the first day of the week."}>
            {(control) => <Input {...control} type="date" value={weekStart} disabled={busy} onChange={(event) => setWeekStart(event.target.value)} />}
          </FormField>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Payouts ready for ACH ({ach.ready.length})</legend>
            {ach.ready.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payout is ready. Payouts appear 48 hours after the homeowner confirms completion, once nothing holds them.</p>
            ) : (
              <>
                <ul className="space-y-2">
                  {ach.ready.map((payout) => {
                    const disabled = busy || payout.blocker !== null || payout.open_request_id !== null;
                    return (
                      <li key={payout.obligation_id}>
                        <label className="flex items-start gap-2 text-sm [overflow-wrap:anywhere]">
                          <input
                            type="checkbox"
                            className="mt-1 size-4"
                            checked={selected.includes(payout.obligation_id) && payout.blocker === null && payout.open_request_id === null}
                            disabled={disabled}
                            onChange={(event) => setSelected((value) => event.target.checked ? [...value, payout.obligation_id] : value.filter((id) => id !== payout.obligation_id))}
                          />
                          <span className="flex flex-col">
                            <span className="tabular-nums">{label(payout.invoice_number, payout.obligation_id)} · {payout.payee_name ?? "Provider"} · {formatCents(payout.amount)}</span>
                            <span className="text-xs text-muted-foreground">
                              {payout.open_request_id ? "Already in a requested batch; see reviews" : payout.blocker ? blockerLabel[payout.blocker] : `Eligible since ${new Date(payout.eligible_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`}
                            </span>
                            {payout.replaces && (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                Replaces the withdrawn statement for the week of {formatDay(payout.replaces.period_start)} ({formatCents(payout.replaces.amount)})
                              </span>
                            )}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                <button type="button" className="text-sm underline underline-offset-4 disabled:opacity-50" disabled={busy || selectable.length === 0} onClick={() => setSelected(selectable.map((payout) => payout.obligation_id))}>
                  Select all {selectable.length} available
                </button>
              </>
            )}
          </fieldset>
          <FormField label="Bank batch reference" required help="The reference your bank gives this batch or its approval. Not an account or routing number.">
            {(control) => <Input {...control} value={bankBatch} maxLength={200} disabled={busy} onChange={(event) => setBankBatch(event.target.value)} />}
          </FormField>
          <p className="text-sm tabular-nums">{chosen.length} payout{chosen.length === 1 ? "" : "s"} · {formatCents(total)}</p>
          <ConfirmAction
            disabled={busy || !validWeek || chosen.length === 0 || !bankBatch.trim()}
            requireReason
            reasonLabel="Batch reason"
            confirmationTone="commitment"
            triggerLabel="Request batch"
            title="Request this weekly ACH batch?"
            entity={`Week of ${validWeek ? formatDay(weekStart) : ""} · ${chosen.length} payout${chosen.length === 1 ? "" : "s"} · ${formatCents(total)}`}
            consequence={`Creates a review request for ${chosen.map((payout) => `${label(payout.invoice_number, payout.obligation_id)} ${formatCents(payout.amount)}`).join(", ")}. A different finance operator must approve it within 24 hours; you then run it to prepare the statement. If any amount, provider or bank authorization changes first, it cannot run.`}
            confirmLabel="Request batch"
            onConfirm={(reason) => {
              const period = weekStart;
              const obligations = chosen.map((payout) => payout.obligation_id);
              const reference = bankBatch.trim();
              return submitRequest("ach_preparation", `Week of ${formatDay(period)}`, () => createClient().rpc("money_operator_request_ach", {
                p_period: period, p_obligations: obligations, p_bank_ref: reference, p_reason: reason, p_key: commandKey(`ach:${period}`),
              })).then(() => { setSelected([]); setBankBatch(""); });
            }}
          />
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h4 className="font-medium">Record a bank outcome</h4>
          <p className="text-sm text-muted-foreground">What the bank shows for one transfer. One finance operator records it.</p>
          <FormField label="Transfer" required>
            {(control) => (
              <select {...control} className={selectClass} value={transfer} disabled={busy || recordable.length === 0} onChange={(event) => { setTransfer(event.target.value); setOutcome(""); setBankReference(""); }}>
                <option value="">{recordable.length ? "Select a transfer" : "No transfer is waiting for an outcome"}</option>
                {recordable.map((payout) => <option key={payout.attempt_id} value={payout.attempt_id}>{itemLabel(payout)} · {achStatusLabel[payout.status]}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Outcome" required>
            {(control) => (
              <select {...control} className={selectClass} value={outcome} disabled={busy || !item} onChange={(event) => setOutcome(event.target.value as AchOutcome | "")}>
                <option value="">{item ? "Select an outcome" : "Select a transfer first"}</option>
                {item && achOutcomes(item.status).map((value) => <option key={value} value={value}>{achOutcomeLabel[value]}</option>)}
              </select>
            )}
          </FormField>
          <FormField
            label="Bank reference"
            required={referenceRequired}
            help={item?.bank_reference_hint ? `Recorded reference ends ${item.bank_reference_hint}. Leave blank to use it.` : "The reference you send this transfer under, such as its trace or batch line."}
          >
            {(control) => <Input {...control} value={bankReference} maxLength={200} disabled={busy || !item} onChange={(event) => setBankReference(event.target.value)} />}
          </FormField>
          <FormField label="Bank evidence" required help="What the bank shows, for example the portal batch or statement line. Never account details.">
            {(control) => <Input {...control} value={bankEvidence} maxLength={1000} disabled={busy || !item} onChange={(event) => setBankEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !item || !outcome || !bankEvidence.trim() || (referenceRequired && !bankReference.trim())}
            confirmationTone={outcome === "settled" || outcome === "returned" ? "destructive" : "commitment"}
            triggerLabel="Record outcome"
            title={outcome ? `Record: ${achOutcomeLabel[outcome].toLowerCase()}?` : "Record this bank outcome?"}
            entity={item ? `${itemLabel(item)} · attempt ${item.attempt_number}` : ""}
            consequence={outcome ? outcomeConsequence[outcome] : ""}
            confirmLabel="Record"
            onConfirm={() => {
              const attempt = item!.attempt_id;
              const status = outcome as AchOutcome;
              const reference = bankReference.trim();
              const evidence = bankEvidence.trim();
              return run(
                async () => {
                  await accepted(createClient().rpc("money_operator_record_ach", {
                    p_attempt: attempt, p_status: status, p_bank_ref: reference || undefined, p_evidence: evidence, p_key: commandKey(`ach-outcome:${attempt}:${status}`),
                  }));
                },
                (next) => next.ach.batches.some((batch) => batch.items.some((candidate) => candidate.attempt_id === attempt && candidate.status === status)),
                { title: "Bank outcome recorded", description: `${achOutcomeLabel[status]} · ${itemLabel(item!)}.` },
              ).then(() => { setTransfer(""); setOutcome(""); setBankReference(""); setBankEvidence(""); });
            }}
          />
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h4 className="font-medium">Withdraw a transfer from its statement</h4>
          <p className="text-sm text-muted-foreground">
            For a transfer the bank does not hold: never sent, failed or returned. The payout then goes on a later weekly batch at its current amount and bank authorization. A submitted, unknown or settled transfer cannot be withdrawn. A second finance operator approves.
          </p>
          <FormField label="Transfer to withdraw" required>
            {(control) => (
              <select {...control} className={selectClass} value={withdrawTransfer} disabled={busy || withdrawable.length === 0} onChange={(event) => setWithdrawTransfer(event.target.value)}>
                <option value="">{withdrawable.length ? "Select a transfer" : "No transfer can be withdrawn"}</option>
                {withdrawable.map((payout) => <option key={payout.attempt_id} value={payout.attempt_id}>{itemLabel(payout)} · {achStatusLabel[payout.status]}</option>)}
              </select>
            )}
          </FormField>
          <FormField
            label="What the bank shows"
            required
            help={!withdrawing
              ? "For an unsent transfer, that no transfer went out; for a failed or returned one, the failure or return. Never account details."
              : withdrawing.status === "prepared"
                ? "What the bank portal shows: that no transfer went out for this payout. Never account details."
                : "What the bank shows for the failure or return. Never account details."}
          >
            {(control) => <Input {...control} value={withdrawEvidence} maxLength={1000} disabled={busy || !withdrawing} onChange={(event) => setWithdrawEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !withdrawing || !withdrawEvidence.trim()}
            requireReason
            reasonLabel="Withdrawal reason"
            reasonHelp="Why this transfer should not be sent or retried, for example a changed bank authorization or an agreed refund."
            confirmationTone="commitment"
            triggerLabel="Request withdrawal"
            title="Request withdrawal of this transfer?"
            entity={withdrawing ? `${itemLabel(withdrawing)} · attempt ${withdrawing.attempt_number} ${achStatusLabel[withdrawing.status].toLowerCase()}` : ""}
            consequence={withdrawing
              ? `${withdrawalConsequence[withdrawing.status as WithdrawableStatus]} A different finance operator must approve it within 24 hours; you then run it. If the transfer's bank status changes first, it cannot run.`
              : ""}
            confirmLabel="Request withdrawal"
            onConfirm={(reason) => {
              const payout = withdrawing!;
              const evidence = withdrawEvidence.trim();
              return submitRequest("ach_withdrawal", itemLabel(payout), () => createClient().rpc("money_operator_request_ach_withdrawal", {
                p_attempt: payout.attempt_id, p_reason: reason, p_evidence: evidence, p_key: commandKey(`ach-withdrawal:${payout.attempt_id}`),
              })).then(() => { setWithdrawTransfer(""); setWithdrawEvidence(""); });
            }}
          />
        </div>
      </div>

      {ach.batches.length === 0 ? (
        <PageState kind="empty" title="No ACH batches" description="Prepared batches appear here with each transfer's latest bank outcome." />
      ) : ach.batches.map((batch) => (
        <div key={batch.batch_id} className="space-y-2">
          <h4 className="font-medium tabular-nums">
            Week of {formatDay(batch.period_start)} · {batch.items.length} payout{batch.items.length === 1 ? "" : "s"} · {formatCents(batch.total)}
            {batch.withdrawn_total > 0 && <> · {formatCents(batch.withdrawn_total)} withdrawn</>}
          </h4>
          <div className="overflow-hidden rounded-xl border bg-card">
            <ResponsiveDataList
              label={`ACH batch for the week of ${formatDay(batch.period_start)}`}
              rows={batch.items}
              rowKey={(payout) => payout.item_id}
              rowLabel={itemLabel}
              columns={[
                {
                  key: "payout",
                  label: "Payout",
                  render: (payout) => (
                    <span className="flex flex-col gap-0.5 tabular-nums [overflow-wrap:anywhere]">
                      <span className="font-medium">{label(payout.invoice_number, payout.obligation_id)} · {formatCents(payout.amount)}</span>
                      <span className="text-xs text-muted-foreground">{payout.payee_name ?? "Provider"}</span>
                      {payout.replaces_period && <span className="text-xs text-muted-foreground">Replaces the withdrawn week of {formatDay(payout.replaces_period)}</span>}
                    </span>
                  ),
                },
                {
                  key: "transfer",
                  label: "Bank",
                  render: (payout) => (
                    <span className="flex flex-col gap-0.5 [overflow-wrap:anywhere]">
                      <span>{achStatusLabel[payout.status]}{payout.attempt_number > 1 ? ` · attempt ${payout.attempt_number}` : ""}</span>
                      {payout.withdrawal ? (
                        <span className="text-xs text-muted-foreground">
                          Was {achStatusLabel[payout.withdrawal.previous_status].toLowerCase()}
                          {payout.bank_reference_hint && ` · reference ends ${payout.bank_reference_hint}`}
                          {` · ${payout.withdrawal.reason} · bank showed: ${payout.withdrawal.evidence} · ${payout.withdrawal.by_me ? "you requested or approved it" : "requested and approved by other operators"}`}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {payout.bank_reference_hint ? `Reference ends ${payout.bank_reference_hint}` : "No bank reference yet"}
                          {payout.last_event && ` · ${payout.last_event.evidence} · ${payout.last_event.by_me ? "recorded by you" : "recorded by another operator"}`}
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: "next",
                  label: "Next step",
                  render: (payout) => {
                    if (payout.status === "withdrawn") {
                      if (payout.late_settlement) {
                        return `The bank paid it after the withdrawal (reference ends ${payout.late_settlement.bank_reference_hint ?? "—"}); recorded as paid`;
                      }
                      return payout.replaced_in
                        ? `Replaced in the week of ${formatDay(payout.replaced_in)}`
                        : "Off this statement; a later weekly batch prepares its replacement";
                    }
                    if (payout.open_withdrawal_request_id) return "Withdrawal requested; see reviews";
                    const blocker = payout.status === "prepared" ? payout.submit_blocker : payout.retry_blocker;
                    if (blocker) return <span className="text-muted-foreground">{blockerLabel[blocker]}</span>;
                    if (payout.status === "prepared") return "Record the submission, then send it at the bank";
                    if (payout.status === "submitted" || payout.status === "unknown") return "Record what the bank shows";
                    if (payout.status === "settled") return "Paid";
                    return payout.open_retry_request_id ? "Retry requested; see reviews" : "Can be retried or withdrawn";
                  },
                },
                {
                  key: "action",
                  label: "Action",
                  render: (payout) => !canRequestRetry(payout) ? <span className="text-muted-foreground">—</span> : (
                    <ConfirmAction
                      disabled={busy}
                      requireReason
                      reasonLabel="Retry reason"
                      reasonHelp="What changed since the failure, for example the provider confirmed the account."
                      confirmationTone="commitment"
                      triggerLabel="Request retry"
                      title="Request a retry of this transfer?"
                      entity={`${itemLabel(payout)} · attempt ${payout.attempt_number} ${payout.status}`}
                      consequence="Creates a review request for a new attempt at the statement amount. A different finance operator must approve it within 24 hours; you then run it. Nothing is sent until you record the submission and send it at the bank."
                      confirmLabel="Request retry"
                      onConfirm={(reason) => submitRequest("ach_retry", itemLabel(payout), () => createClient().rpc("money_operator_request_ach_retry", {
                        p_attempt: payout.attempt_id, p_reason: reason, p_key: commandKey(`ach-retry:${payout.attempt_id}`),
                      }))}
                    />
                  ),
                },
              ]}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
