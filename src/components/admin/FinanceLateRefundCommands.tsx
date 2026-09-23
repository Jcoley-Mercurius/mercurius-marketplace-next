"use client";

import { useState } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import type { Refund, Run } from "@/components/admin/FinanceCommands";
import {
  blockerLabel,
  canRequestLateStep,
  canSendLateRefund,
  lateRefundStateLabel,
  refundAttemptLabel,
  type FinanceOperations,
  type LateRefund,
  type LateRefundStep,
  type ReviewOperation,
} from "@/lib/financeCommands";
import { formatCents } from "@/lib/financeReconciliation";
import { createClient } from "@/lib/supabase/client";

// TRACE-083 refunds Stripe failed after they settled. The refund stands: its fee, tax and provider
// share stay posted, and what Stripe returned is owed to the customer. Two finance operators record
// the failure from a Stripe readback, then resend the refund or release it, which reverses it and
// restores the provider's share.

const formatDate = (value: string) =>
  new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

type SubmitRequest = (
  operation: ReviewOperation,
  entity: string,
  call: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
) => Promise<void>;

const stepOperation: Record<LateRefundStep, ReviewOperation> = {
  failure: "refund_late_failure",
  resend: "refund_late_resend",
  release: "refund_late_release",
};

const stepCopy: Record<LateRefundStep, { trigger: string; title: string; consequence: string; evidence?: { label: string; help: string } }> = {
  failure: {
    trigger: "Request failure record",
    title: "Record that this settled refund failed?",
    consequence:
      "Creates a review request. Once a different finance operator approves it within 24 hours and you run it, the money Stripe returned is held as owed to the customer. The refund stands: its fee, tax and provider share stay as they are. Then resend or release it.",
    evidence: { label: "Stripe failure evidence", help: "What Stripe shows for the refund, for example the failure reason on the readback." },
  },
  resend: {
    trigger: "Request resend",
    title: "Resend this refund to the customer?",
    consequence:
      "Creates a review request. Once a different finance operator approves it and you run it, the same approved amount is prepared again under a new Stripe key; its author or approver then sends it. It never changes the amount.",
  },
  release: {
    trigger: "Request release",
    title: "Release this refund?",
    consequence:
      "Creates a review request. Once a different finance operator approves it and you run it, the refund is reversed: the customer is no longer shown as refunded, and the platform fee and the provider's share are restored. It can never be sent again. It cannot be undone here.",
    evidence: { label: "Customer outcome evidence", help: "Why the customer no longer needs this refund, for example how they were made whole. Never card or account details." },
  },
};

export function FinanceLateRefundCommands({
  ops,
  busy,
  run,
  refund,
  submitRequest,
  commandKey,
}: {
  ops: FinanceOperations;
  busy: boolean;
  run: Run;
  refund: Refund;
  submitRequest: SubmitRequest;
  commandKey: (operation: string) => string;
}) {
  const rows = ops.late_refunds;
  const label = (item: LateRefund) => `${item.invoice_number ?? `Obligation ${item.obligation_id.slice(0, 8)}`} · ${formatCents(item.amount)}`;
  const owed = rows.filter((item) => item.state === "customer_owed").reduce((total, item) => total + item.amount, 0);

  return (
    <section aria-labelledby="finance-late-refunds" className="space-y-4">
      <div>
        <h3 id="finance-late-refunds" className="font-medium">Refunds that failed after they settled ({rows.length})</h3>
        <p className="text-sm text-muted-foreground">
          Stripe can fail a refund after reporting it succeeded, and returns the money to Mercurius. Stripe&apos;s event is only a reason to read the refund back. Once a readback shows it failed, record the failure with a second operator, then resend the refund or release it. A resend or release also needs a second operator.
        </p>
        <p className="mt-1 text-sm font-medium tabular-nums">Owed to customers now: {formatCents(owed)}</p>
      </div>
      {rows.length === 0 ? (
        <PageState kind="empty" title="No late refund failures" description="A settled refund appears here when Stripe's event or a readback shows it failed, and stays for 30 days after it is resolved." />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <ResponsiveDataList
            label="Refunds that failed after they settled"
            rows={rows}
            rowKey={(item) => item.authorization_id}
            rowLabel={label}
            columns={[
              {
                key: "refund",
                label: "Refund",
                render: (item) => (
                  <span className="flex flex-col gap-0.5 tabular-nums [overflow-wrap:anywhere]">
                    <span className="font-medium">{label(item)}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.payment_id}{item.delivered_reference ? ` · delivered by ${item.delivered_reference}` : item.late_failure ? ` · ${item.late_failure.failed_reference} failed` : ""}
                    </span>
                  </span>
                ),
              },
              {
                key: "status",
                label: "Status",
                render: (item) => (
                  <span className="flex flex-col gap-0.5">
                    <span>{lateRefundStateLabel[item.state]}</span>
                    {item.state === "customer_owed" && (
                      <span className="text-xs text-muted-foreground">
                        {refundAttemptLabel[item.attempt_status]}{item.generation > 1 ? ` · send ${item.generation}` : ""}
                      </span>
                    )}
                    {item.signal && (
                      <span className="text-xs text-muted-foreground">Stripe event {formatDate(item.signal.received_at)}: {item.signal.status}</span>
                    )}
                    {item.last_readback && (
                      <span className="text-xs text-muted-foreground">
                        Last Stripe readback {formatDate(item.last_readback.created_at)}: {item.last_readback.found ? `${item.last_readback.provider_reference} ${item.last_readback.provider_status}` : "not found at Stripe"}
                      </span>
                    )}
                    {item.late_failure && (
                      <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        Failure recorded {formatDate(item.late_failure.created_at)}: {item.late_failure.reason}{item.late_failure.by_me ? " · you took part" : ""}
                      </span>
                    )}
                  </span>
                ),
              },
              {
                key: "action",
                label: "Action",
                render: (item) => <LateRefundActions item={item} busy={busy} run={run} refund={refund} submitRequest={submitRequest} commandKey={commandKey} entity={label(item)} />,
              },
            ]}
          />
        </div>
      )}
    </section>
  );
}

function LateRefundActions({
  item,
  busy,
  run,
  refund,
  submitRequest,
  commandKey,
  entity,
}: {
  item: LateRefund;
  busy: boolean;
  run: Run;
  refund: Refund;
  submitRequest: SubmitRequest;
  commandKey: (operation: string) => string;
  entity: string;
}) {
  if (item.state === "released" || item.state === "redelivered") {
    return item.state === "redelivered" ? <LateReadback item={item} busy={busy} run={run} refund={refund} /> : <span className="text-muted-foreground">—</span>;
  }
  const blocked = (blocker: LateRefund["failure_blocker"]) => blocker && <span className="text-xs text-muted-foreground">{blockerLabel[blocker]}</span>;
  return (
    <span className="flex flex-col items-start gap-2">
      <LateReadback item={item} busy={busy} run={run} refund={refund} />
      {item.state === "failure_signal" && (canRequestLateStep(item, "failure")
        ? <LateStep step="failure" item={item} busy={busy} entity={entity} submitRequest={submitRequest} commandKey={commandKey} />
        : item.open_failure_request_id ? <span className="text-xs text-muted-foreground">Failure record requested; see reviews.</span> : blocked(item.failure_blocker))}
      {canSendLateRefund(item) && <LateSend item={item} busy={busy} run={run} refund={refund} />}
      {item.state === "customer_owed" && (canRequestLateStep(item, "resend")
        ? <LateStep step="resend" item={item} busy={busy} entity={entity} submitRequest={submitRequest} commandKey={commandKey} />
        : item.open_resend_request_id ? <span className="text-xs text-muted-foreground">Resend requested; see reviews.</span> : blocked(item.resend_blocker))}
      {item.state === "customer_owed" && (canRequestLateStep(item, "release")
        ? <LateStep step="release" item={item} busy={busy} entity={entity} submitRequest={submitRequest} commandKey={commandKey} />
        : item.open_release_request_id ? <span className="text-xs text-muted-foreground">Release requested; see reviews.</span>
          : item.release_blocker !== item.resend_blocker && blocked(item.release_blocker))}
    </span>
  );
}

function LateStep({
  step,
  item,
  busy,
  entity,
  submitRequest,
  commandKey,
}: {
  step: LateRefundStep;
  item: LateRefund;
  busy: boolean;
  entity: string;
  submitRequest: SubmitRequest;
  commandKey: (operation: string) => string;
}) {
  const [evidence, setEvidence] = useState("");
  const copy = stepCopy[step];
  return (
    <span className="flex w-full flex-col gap-2">
      {copy.evidence && (
        <FormField label={copy.evidence.label} required help={copy.evidence.help}>
          {(control) => <Input {...control} value={evidence} maxLength={1000} disabled={busy} onChange={(event) => setEvidence(event.target.value)} />}
        </FormField>
      )}
      <ConfirmAction
        disabled={busy || (copy.evidence !== undefined && !evidence.trim())}
        requireReason
        reasonLabel="Reason"
        confirmationTone="commitment"
        triggerLabel={copy.trigger}
        title={copy.title}
        entity={`${entity} · ${item.payment_id}`}
        consequence={copy.consequence}
        confirmLabel={copy.trigger}
        onConfirm={(reason) => submitRequest(stepOperation[step], entity, () => createClient().rpc("money_operator_request_late_refund", {
          p_action: step, p_authorization: item.authorization_id, p_reason: reason,
          p_evidence: copy.evidence ? evidence.trim() : undefined, p_key: commandKey(`late-refund:${step}:${item.authorization_id}`),
        })).then(() => setEvidence(""))}
      />
    </span>
  );
}

function LateReadback({ item, busy, run, refund }: { item: LateRefund; busy: boolean; run: Run; refund: Refund }) {
  return (
    <ConfirmAction
      disabled={busy}
      confirmationTone="commitment"
      triggerLabel="Read back from Stripe"
      title="Read this refund back from Stripe?"
      entity={`${item.payment_id} · ${formatCents(item.amount)}`}
      consequence="Looks up the refund's current send at Stripe and records what Stripe shows under your name. It never creates a refund and never records a failure by itself."
      confirmLabel="Read back"
      onConfirm={() => {
        const previous = item.last_readback?.created_at ?? null;
        return run(
          async () => { await refund({ action: "readback", authorization_id: item.authorization_id }); },
          (next) => {
            const after = next.late_refunds.find((candidate) => candidate.authorization_id === item.authorization_id);
            return !after || (after.last_readback !== null && after.last_readback.created_at !== previous);
          },
          { title: "Stripe refund read back", description: "The refund's Stripe status is recorded." },
        );
      }}
    />
  );
}

function LateSend({ item, busy, run, refund }: { item: LateRefund; busy: boolean; run: Run; refund: Refund }) {
  return (
    <ConfirmAction
      disabled={busy}
      triggerLabel="Send refund to Stripe"
      title="Send this refund to Stripe again?"
      entity={`${item.payment_id} · ${formatCents(item.amount)}`}
      consequence="Asks Stripe to refund the same approved amount to the customer's original payment under the new key. What was held for the customer is paid out only when Stripe's refund event arrives."
      confirmLabel="Send refund"
      onConfirm={() => run(
        async () => {
          const result = await refund({ action: "send", authorization_id: item.authorization_id });
          if (result.status !== "awaiting_webhook") {
            throw new Error("Stripe was not asked again: this refund's outcome is uncertain. Read it back from Stripe; do not create a second refund.");
          }
        },
        (next) => !next.late_refunds.some((candidate) => candidate.authorization_id === item.authorization_id && candidate.attempt_status === "prepared"),
        { title: "Refund sent to Stripe", description: "Waiting for Stripe's refund event to settle it." },
      )}
    />
  );
}
