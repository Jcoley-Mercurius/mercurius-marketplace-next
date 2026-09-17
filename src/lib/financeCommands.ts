// TRACE-076 presentation for the finance operator command gateway. The database decides who
// may act, what is actionable and which approver counts; this module only words its answers.
// Amounts are integer cents.

export type ReviewOperation = "event_exclusion" | "reconciliation_resolution" | "hold_resolution";
export type ReviewState = "awaiting_approval" | "approved" | "executed" | "stale";
export type ReviewBlocker =
  | "not_found"
  | "completed"
  | "event_not_failed"
  | "event_has_effects"
  | "readback_mismatch"
  | "readback_outdated"
  | "readback_superseded"
  | "not_open";
export type RefundAttemptStatus = "not_started" | "prepared" | "pending" | "succeeded" | "failed" | "reconcile";

export type ReviewRequest = {
  request_id: string;
  operation: ReviewOperation;
  subject: string;
  obligation_id: string | null;
  invoice_number: string | null;
  reason: string;
  evidence: string | null;
  requested_by_me: boolean;
  approved_by_me: boolean;
  recorded_by_me: boolean;
  state: ReviewState;
  blocker: ReviewBlocker | null;
  created_at: string;
  executed_at: string | null;
};

export type OpenHold = {
  hold_id: string;
  obligation_id: string;
  invoice_number: string | null;
  reason: string;
  evidence: string;
  placed_by_me: boolean;
  created_at: string;
};

export type OpenReadback = {
  obligation_id: string;
  invoice_number: string | null;
  reconciliation_open: boolean;
  net_collected: number;
  observation_id: string | null;
  observed: number | null;
  expected: number | null;
  currency: string | null;
  evidence: string | null;
  attributed: boolean;
  recorded_by_me: boolean | null;
  recorded_at: string | null;
  resolution_blocker: ReviewBlocker | null;
};

export type UnprocessedEvent = {
  event_id: string;
  event_type: string;
  status: string;
  attempts: number;
  holds_all_payouts: boolean;
  exclusion_blocker: ReviewBlocker | null;
  received_at: string;
};

export type PendingRefund = {
  authorization_id: string;
  obligation_id: string;
  invoice_number: string | null;
  payment_id: string;
  amount: number;
  attempt_status: RefundAttemptStatus;
  provider_reference: string | null;
  can_send: boolean;
  last_readback: { found: boolean; provider_status: string | null; by_me: boolean; created_at: string } | null;
  created_at: string;
};

export type FinanceOperations = {
  evaluated_at: string;
  requests: ReviewRequest[];
  holds: OpenHold[];
  readbacks: OpenReadback[];
  events: UnprocessedEvent[];
  refunds: PendingRefund[];
};

export const operationLabel: Record<ReviewOperation, string> = {
  event_exclusion: "Exclude Stripe event",
  reconciliation_resolution: "Resolve Stripe readback",
  hold_resolution: "Release payout hold",
};

export const reviewStateLabel: Record<ReviewState, string> = {
  awaiting_approval: "Awaiting a second operator",
  approved: "Approved",
  executed: "Done",
  stale: "No longer applies",
};

export const blockerLabel: Record<ReviewBlocker, string> = {
  not_found: "It no longer exists.",
  completed: "It has already been done.",
  event_not_failed: "The event has not failed. Replay it first; only a failed event can be excluded.",
  event_has_effects: "The event already moved money in the ledger, so it cannot be excluded.",
  readback_mismatch: "The readback does not match the ledger. Record a matching readback first.",
  readback_outdated: "Money moved since this readback. Record a new one.",
  readback_superseded: "A newer readback was recorded. Resolve that one instead.",
  not_open: "No reconciliation hold is open for this invoice.",
};

export const refundAttemptLabel: Record<RefundAttemptStatus, string> = {
  not_started: "Not sent to Stripe",
  prepared: "Prepared, not confirmed by Stripe",
  pending: "Sent; waiting for Stripe's refund event",
  succeeded: "Settled",
  failed: "Stripe reported failure",
  reconcile: "Outcome uncertain; read back from Stripe",
};

/** What the signed-in operator can do with a review request, and why not otherwise. */
export function reviewAction(request: ReviewRequest): { kind: "approve" | "execute" | "none"; note: string } {
  if (request.state === "executed") return { kind: "none", note: "Done." };
  if (request.state === "stale") return { kind: "none", note: request.blocker ? blockerLabel[request.blocker] : "It no longer applies." };
  if (request.requested_by_me) {
    return request.state === "approved"
      ? { kind: "execute", note: "Approved by another finance operator. You can run it." }
      : { kind: "none", note: "Waiting for a different finance operator to approve it." };
  }
  if (request.recorded_by_me) return { kind: "none", note: "You recorded this readback, so a different operator must approve it." };
  if (request.approved_by_me) return { kind: "none", note: "You approved it. The requester runs it." };
  return { kind: "approve", note: "Check the reason and evidence before approving." };
}

/** Whether a refund may be sent from this session: reviewed, not yet at Stripe, and the operator is its author or approver. */
export function canSendRefund(refund: PendingRefund) {
  return refund.can_send && (refund.attempt_status === "not_started" || refund.attempt_status === "prepared");
}

export function canReadBackRefund(refund: PendingRefund) {
  return refund.attempt_status !== "not_started";
}

/** Dollars typed by an operator, to integer cents. Null unless it is a plain non-negative amount. */
export function parseCents(value: string): number | null {
  const text = value.trim().replace(/^\$/, "").replaceAll(",", "");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

const refusals: [RegExp, string][] = [
  [/Restricted finance authority required/, "You need restricted finance authority for this."],
  [/A different finance operator must approve/, "You requested this command, so a different finance operator must approve it."],
  [/recorded this readback cannot approve/, "You recorded this readback, so a different finance operator must approve its resolution."],
  [/Only the requesting finance operator/, "Only the operator who requested this command can run it."],
  [/Separate authenticated approval of exact financial command required/, "A different finance operator must approve this exact command before it can run."],
  [/idempotency conflict/i, "This form was already submitted with different details. Refresh and start again."],
  [/Payout already on an ACH statement/, "This payout is already on an ACH statement, so a hold cannot stop it. Work the bank outcome instead."],
  [/Stripe event already processed/, "Stripe's event was already processed. Nothing was replayed."],
  [/Excluded event requires/, "This event was excluded, so it cannot be replayed."],
  [/Finance review subject not found|Finance obligation not found|Stripe event not found|Finance review request not found/, "It no longer exists. Refresh the page."],
  [/Finance review already executed/, "It has already been done."],
];

/** Operator wording for a gateway refusal. Unknown database text is not shown verbatim. */
export function commandErrorMessage(message: string): string {
  const blocker = /Finance review not actionable: ([a-z_]+)/.exec(message)?.[1];
  if (blocker && blocker in blockerLabel) return blockerLabel[blocker as ReviewBlocker];
  for (const [pattern, text] of refusals) if (pattern.test(message)) return text;
  return "The command was not completed. Refresh the page and check the current state before trying again.";
}

const refundErrors: Record<string, string> = {
  MONEY_NOT_ACTIVATED: "Refund execution is not activated in this environment. No refund was sent or read back.",
  TEST_PROVIDER_REQUIRED: "Refunds run only against Stripe test mode until money movement is activated. Nothing was sent.",
  FINANCE_AUTHORITY_REQUIRED: "You need restricted finance authority for this.",
  REFUND_REVIEW_REQUIRED: "Only the refund's author or approver can send it, and it must be separately approved.",
  REFUND_NOT_SENT: "This refund has not been sent to Stripe, so there is nothing to read back.",
  REFUND_PROVIDER_MISMATCH: "Stripe's refund does not match the reviewed refund. Nothing was recorded; escalate to the finance owner.",
  REFUND_READBACK_INCOMPLETE: "Stripe has more refunds on this payment than one readback covers. Nothing was recorded; find the refund in Stripe.",
  REFUND_RECONCILIATION_REQUIRED: "The outcome could not be confirmed. Read the refund back from Stripe before doing anything else; do not create a second refund.",
};

export function refundErrorMessage(code: string | undefined): string {
  return (code && refundErrors[code]) || refundErrors.REFUND_RECONCILIATION_REQUIRED;
}
