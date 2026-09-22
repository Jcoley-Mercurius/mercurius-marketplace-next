"use client";

import { useState } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import {
  achStatusLabel,
  formatDay,
  parseCents,
  recoveryError,
  recoveryKindLabel,
  type FinanceOperations,
  type OwedPayout,
  type RecoveryKind,
  type ReviewOperation,
  type WithdrawnTransfer,
} from "@/lib/financeCommands";
import { formatCents } from "@/lib/financeReconciliation";
import { createClient } from "@/lib/supabase/client";

// TRACE-080 already-paid recovery. A refund or lost chargeback after a payout settled, or a
// withdrawn transfer the bank paid after all, leaves the provider owing Mercurius. Nothing here
// moves money: operators record a repayment the provider sent, or a write-off Mercurius absorbs,
// each with a second finance operator. Other payouts are never held back or netted.

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

const recoveryConsequence: Record<RecoveryKind, string> = {
  repayment: "Records money the provider sent back to Mercurius's bank and reduces what they owe. Record it only once the bank shows the credit.",
  write_off: "Records that Mercurius absorbs this amount as a recovery loss, and reduces what the provider owes. It is not collected later.",
};

type SubmitRequest = (
  operation: ReviewOperation,
  entity: string,
  call: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
) => Promise<void>;

export function FinanceRecoveryCommands({
  ops,
  busy,
  submitRequest,
  commandKey,
}: {
  ops: FinanceOperations;
  busy: boolean;
  submitRequest: SubmitRequest;
  commandKey: (operation: string) => string;
}) {
  const recoveries = ops.recoveries;
  const [payout, setPayout] = useState("");
  const [kind, setKind] = useState<RecoveryKind | "">("");
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");
  const [lateTransfer, setLateTransfer] = useState("");
  const [lateReference, setLateReference] = useState("");
  const [lateEvidence, setLateEvidence] = useState("");

  const label = (invoice: string | null, obligation: string) => invoice ?? `Obligation ${obligation.slice(0, 8)}`;
  const owedLabel = (row: OwedPayout) => `${label(row.invoice_number, row.obligation_id)} · ${row.payee_name ?? "Provider"} · owes ${formatCents(row.owed)}`;
  const transferLabel = (row: WithdrawnTransfer) =>
    `${label(row.invoice_number, row.obligation_id)} · ${row.payee_name ?? "Provider"} · ${formatCents(row.amount)} · week of ${formatDay(row.period_start)}`;

  const recoverable = recoveries.owed.filter((row) => row.owed > 0 && row.open_request_id === null);
  const chosen = recoverable.find((row) => row.obligation_id === payout);
  const cents = amount.trim() ? parseCents(amount) : null;
  const amountError = chosen && amount.trim() ? recoveryError(chosen.owed, cents) : null;
  const lateable = recoveries.withdrawn.filter((row) => row.open_request_id === null);
  const late = lateable.find((row) => row.attempt_id === lateTransfer);

  return (
    <section aria-labelledby="finance-recovery" className="space-y-4">
      <div>
        <h3 id="finance-recovery" className="font-medium">Amounts providers owe</h3>
        <p className="text-sm text-muted-foreground">
          A refund or lost chargeback after a payout settled, or a withdrawn transfer the bank paid after all, leaves the provider owing Mercurius. Ask the provider to repay, then record the repayment, or record a write-off. Never debit a provider&apos;s bank account or hold back their other earnings.
        </p>
        <p className="mt-1 text-sm font-medium tabular-nums">Owed now: {formatCents(recoveries.owed_total)}</p>
      </div>

      {recoveries.owed.length === 0 ? (
        <PageState kind="empty" title="No provider owes Mercurius" description="Payouts appear here when a refund, chargeback or late bank payment leaves a provider holding more than their proceeds." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <ResponsiveDataList
            label="Amounts providers owe"
            rows={recoveries.owed}
            rowKey={(row) => row.obligation_id}
            rowLabel={owedLabel}
            columns={[
              {
                key: "payout",
                label: "Payout",
                render: (row) => (
                  <span className="flex flex-col gap-0.5 tabular-nums [overflow-wrap:anywhere]">
                    <span className="font-medium">{label(row.invoice_number, row.obligation_id)}</span>
                    <span className="text-xs text-muted-foreground">{row.payee_name ?? "Provider"}</span>
                  </span>
                ),
              },
              {
                key: "why",
                label: "Why",
                render: (row) => (
                  <span className="flex flex-col gap-0.5 text-xs tabular-nums [overflow-wrap:anywhere]">
                    <span>Paid {formatCents(row.paid - row.returned)}{row.late_settled > 0 && ` · includes ${formatCents(row.late_settled)} the bank paid late on a withdrawn transfer`}</span>
                    {row.refunded > 0 && <span>Customer refunded {formatCents(row.refunded)}</span>}
                    {row.chargebacks_lost > 0 && <span>Chargebacks lost {formatCents(row.chargebacks_lost)}</span>}
                  </span>
                ),
              },
              {
                key: "owed",
                label: "Owed",
                render: (row) => (
                  <span className="flex flex-col gap-0.5 tabular-nums">
                    <span className="font-medium">{row.owed > 0 ? formatCents(row.owed) : "Nothing owed"}</span>
                    {(row.repaid > 0 || row.written_off > 0) && (
                      <span className="text-xs text-muted-foreground">
                        {row.repaid > 0 && `Repaid ${formatCents(row.repaid)}`}{row.repaid > 0 && row.written_off > 0 && " · "}{row.written_off > 0 && `written off ${formatCents(row.written_off)}`}
                      </span>
                    )}
                    {row.open_request_id && <span className="text-xs text-muted-foreground">Recovery requested; see reviews</span>}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h4 className="font-medium">Record a repayment or write-off</h4>
          <p className="text-sm text-muted-foreground">A part amount is allowed. A second finance operator approves; if what the provider owes changes first, it cannot run.</p>
          <FormField label="Payout owed" required>
            {(control) => (
              <select {...control} className={selectClass} value={payout} disabled={busy || recoverable.length === 0} onChange={(event) => { setPayout(event.target.value); setAmount(""); }}>
                <option value="">{recoverable.length ? "Select a payout" : "Nothing is owed"}</option>
                {recoverable.map((row) => <option key={row.obligation_id} value={row.obligation_id}>{owedLabel(row)}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Recovery" required>
            {(control) => (
              <select {...control} className={selectClass} value={kind} disabled={busy || !chosen} onChange={(event) => setKind(event.target.value as RecoveryKind | "")}>
                <option value="">{chosen ? "Select how it was recovered" : "Select a payout first"}</option>
                {(Object.keys(recoveryKindLabel) as RecoveryKind[]).map((value) => <option key={value} value={value}>{recoveryKindLabel[value]}</option>)}
              </select>
            )}
          </FormField>
          <FormField label="Amount (USD)" required error={amountError ?? undefined} help={chosen ? `Up to ${formatCents(chosen.owed)}.` : undefined}>
            {(control) => <Input {...control} inputMode="decimal" placeholder="0.00" value={amount} disabled={busy || !chosen} onChange={(event) => setAmount(event.target.value)} />}
          </FormField>
          <FormField
            label="Recovery evidence"
            required
            help={kind === "write_off" ? "The finance decision to absorb it, for example a ticket or owner approval." : "What the bank shows for the provider's repayment, such as the credit line. Never account details."}
          >
            {(control) => <Input {...control} value={evidence} maxLength={1000} disabled={busy || !chosen} onChange={(event) => setEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !chosen || !kind || cents === null || amountError !== null || !evidence.trim()}
            requireReason
            reasonLabel="Recovery reason"
            confirmationTone="commitment"
            triggerLabel="Request recovery"
            title={kind ? `Request: ${recoveryKindLabel[kind].toLowerCase()}?` : "Request this recovery?"}
            entity={chosen && cents !== null ? `${label(chosen.invoice_number, chosen.obligation_id)} · ${chosen.payee_name ?? "Provider"} · ${formatCents(cents)} of ${formatCents(chosen.owed)} owed` : ""}
            consequence={kind ? `${recoveryConsequence[kind]} A different finance operator must approve it within 24 hours; you then run it.` : ""}
            confirmLabel="Request recovery"
            onConfirm={(reason) => {
              const row = chosen!;
              const recovery = kind as RecoveryKind;
              const value = cents!;
              const proof = evidence.trim();
              return submitRequest("payout_recovery", owedLabel(row), () => createClient().rpc("money_operator_request_payout_recovery", {
                p_obligation: row.obligation_id, p_kind: recovery, p_amount: value, p_reason: reason, p_evidence: proof,
                p_key: commandKey(`recovery:${row.obligation_id}:${recovery}:${value}`),
              })).then(() => { setPayout(""); setKind(""); setAmount(""); setEvidence(""); });
            }}
          />
        </div>

        <div className="space-y-3 rounded-xl border bg-card p-4">
          <h4 className="font-medium">Record a late payment of a withdrawn transfer</h4>
          <p className="text-sm text-muted-foreground">
            When the bank shows a transfer paid after it was withdrawn from its statement. If a replacement was also paid, the provider then owes the duplicate; if not, the payout counts as paid and no replacement can be sent. A second finance operator approves.
          </p>
          <FormField label="Withdrawn transfer paid late" required>
            {(control) => (
              <select {...control} className={selectClass} value={lateTransfer} disabled={busy || lateable.length === 0} onChange={(event) => { setLateTransfer(event.target.value); setLateReference(""); }}>
                <option value="">{lateable.length ? "Select a transfer" : "No withdrawn transfer"}</option>
                {lateable.map((row) => <option key={row.attempt_id} value={row.attempt_id}>{transferLabel(row)} · was {achStatusLabel[row.previous_status].toLowerCase()}</option>)}
              </select>
            )}
          </FormField>
          <FormField
            label="Reference the bank paid it under"
            required
            help={late?.bank_reference_hint ? `Recorded reference ends ${late.bank_reference_hint}; enter it in full.` : "Such as the trace number on the bank statement."}
          >
            {(control) => <Input {...control} value={lateReference} maxLength={200} disabled={busy || !late} onChange={(event) => setLateReference(event.target.value)} />}
          </FormField>
          <FormField label="Late payment evidence" required help="What the bank shows: the statement or portal line with the payment. Never account details.">
            {(control) => <Input {...control} value={lateEvidence} maxLength={1000} disabled={busy || !late} onChange={(event) => setLateEvidence(event.target.value)} />}
          </FormField>
          <ConfirmAction
            disabled={busy || !late || !lateReference.trim() || !lateEvidence.trim()}
            requireReason
            reasonLabel="Reason"
            reasonHelp="How the late payment came to light, for example the weekly statement check."
            confirmationTone="commitment"
            triggerLabel="Request late payment record"
            title="Record this late payment?"
            entity={late ? `${transferLabel(late)} · attempt ${late.attempt_number}` : ""}
            consequence="Creates a review request. Once a different finance operator approves it within 24 hours and you run it, the payment is posted as paid to the provider. It cannot be undone here."
            confirmLabel="Request record"
            onConfirm={(reason) => {
              const row = late!;
              const reference = lateReference.trim();
              const proof = lateEvidence.trim();
              return submitRequest("ach_late_settlement", transferLabel(row), () => createClient().rpc("money_operator_request_ach_late_settlement", {
                p_attempt: row.attempt_id, p_bank_ref: reference, p_reason: reason, p_evidence: proof, p_key: commandKey(`ach-late:${row.attempt_id}`),
              })).then(() => { setLateTransfer(""); setLateReference(""); setLateEvidence(""); });
            }}
          />
        </div>
      </div>
    </section>
  );
}
