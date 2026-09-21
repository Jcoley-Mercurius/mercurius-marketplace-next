// TRACE-076/077/078 presentation for the finance operator command gateway. The database decides who
// may act, what is actionable and which approver counts; this module only words its answers.
// Amounts are integer cents.

export type ReviewOperation =
  | "event_exclusion"
  | "reconciliation_resolution"
  | "hold_resolution"
  | "refund_authorization"
  | "cancellation_refund"
  | "chargeback_allocation"
  | "ach_preparation"
  | "ach_retry";
export type ReviewState = "awaiting_approval" | "approved" | "executed" | "stale" | "expired";
export type ReviewBlocker =
  | "not_found"
  | "completed"
  | "event_not_failed"
  | "event_has_effects"
  | "readback_mismatch"
  | "readback_outdated"
  | "readback_superseded"
  | "not_open"
  | "refund_amount_invalid"
  | "payment_not_captured"
  | "deposit_service_only"
  | "refund_exceeds_components"
  | "refund_exceeds_payment"
  | "on_ach_statement"
  | "chargeback_open"
  | "not_eligible"
  | "no_refund_due"
  | "amount_changed"
  | "dispute_not_lost"
  | "refund_pending"
  | "allocation_invalid"
  | AchBlocker;
/** Why a payout cannot be batched, sent or retried, or a bank outcome recorded (TRACE-078). */
export type AchBlocker =
  | "awaiting_confirmation"
  | "replacement_reconciliation"
  | "dispute_hold"
  | "confirmation_conflict"
  | "payment_incomplete"
  | "chargeback_hold"
  | "reconciliation_hold"
  | "provider_event_hold"
  | "confirmation_window"
  | "payout_hold"
  | "refund_hold"
  | "payout_onboarding"
  | "no_payable"
  | "bank_authorization_ambiguous"
  | "payable_changed"
  | "payee_changed"
  | "bank_authorization_changed"
  | "statement_stale"
  | "period_taken"
  | "bank_outcome_open"
  | "failure_evidence_missing"
  | "transition_invalid"
  | "bank_reference_required"
  | "bank_reference_conflict"
  | "bank_reference_used";
export type ReissueBlocker =
  | "refund_not_sent"
  | "refund_settled"
  | "refund_not_uncertain"
  | "refund_found_at_stripe"
  | "readback_required"
  | "readback_too_early";

export type Components = { service: number; tax: number; tip: number };
export type RefundAttemptStatus = "not_started" | "prepared" | "pending" | "succeeded" | "failed" | "reconcile";

export type MoneyDetails = Components & { payment_id?: string; dispute_id?: string };
export type AchBatchDetails = {
  period_start: string;
  period_end: string;
  bank_ref: string;
  total: number;
  items: { obligation_id: string; amount: number; invoice_number: string | null; payee_name: string | null; blocker: ReviewBlocker | null }[];
};
export type AchRetryDetails = {
  item_id: string;
  attempt_number: number;
  status: AchStatus;
  amount: number;
  payee_name: string | null;
  period_start: string;
};

export type ReviewRequest = {
  request_id: string;
  operation: ReviewOperation;
  subject: string;
  obligation_id: string | null;
  invoice_number: string | null;
  reason: string;
  evidence: string | null;
  details: MoneyDetails | AchBatchDetails | AchRetryDetails | null;
  requested_by_me: boolean;
  approved_by_me: boolean;
  recorded_by_me: boolean;
  state: ReviewState;
  blocker: ReviewBlocker | null;
  created_at: string;
  expires_at: string;
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
  generation: number;
  reissue_blocker: ReissueBlocker | null;
  last_readback: { found: boolean; provider_status: string | null; by_me: boolean; created_at: string } | null;
  created_at: string;
};

export type CancellationRefund = Components & {
  operation_id: string;
  kind: "customer_cancel" | "provider_cancel" | "no_show";
  payment_id: string;
  obligation_id: string;
  invoice_number: string | null;
  refund_percent: number;
  blocker: ReviewBlocker | null;
  open_request_id: string | null;
  cancelled_at: string;
};

export type LostChargeback = {
  dispute_id: string;
  obligation_id: string;
  payment_id: string;
  amount: number;
  invoice_number: string | null;
  retained: Components;
  blocker: ReviewBlocker | null;
  open_request_id: string | null;
  created_at: string;
};

export type AchStatus = "prepared" | "submitted" | "unknown" | "settled" | "failed" | "returned";
export type AchOutcome = Exclude<AchStatus, "prepared">;

export type ReadyPayout = {
  obligation_id: string;
  invoice_number: string | null;
  payee_id: string;
  payee_name: string | null;
  amount: number;
  eligible_at: string;
  blocker: ReviewBlocker | null;
  open_request_id: string | null;
};

export type AchItem = {
  item_id: string;
  obligation_id: string;
  invoice_number: string | null;
  payee_name: string | null;
  amount: number;
  attempt_id: string;
  attempt_number: number;
  status: AchStatus;
  /** The last four characters of the bank reference; the full reference is never returned. */
  bank_reference_hint: string | null;
  last_event: { status: AchStatus; evidence: string; by_me: boolean; created_at: string } | null;
  submit_blocker: ReviewBlocker | null;
  retry_blocker: ReviewBlocker | null;
  open_retry_request_id: string | null;
};

export type AchBatch = {
  batch_id: string;
  period_start: string;
  period_end: string;
  created_by_me: boolean;
  approved_by_me: boolean;
  created_at: string;
  total: number;
  items: AchItem[];
};

export type AchOperations = { next_period_start: string | null; ready: ReadyPayout[]; batches: AchBatch[] };

export type FinanceOperations = {
  evaluated_at: string;
  requests: ReviewRequest[];
  holds: OpenHold[];
  readbacks: OpenReadback[];
  events: UnprocessedEvent[];
  refunds: PendingRefund[];
  cancellations: CancellationRefund[];
  chargebacks: LostChargeback[];
  ach: AchOperations;
};

export const operationLabel: Record<ReviewOperation, string> = {
  event_exclusion: "Exclude Stripe event",
  reconciliation_resolution: "Resolve Stripe readback",
  hold_resolution: "Release payout hold",
  refund_authorization: "Authorize refund",
  cancellation_refund: "Authorize cancellation refund",
  chargeback_allocation: "Allocate lost chargeback",
  ach_preparation: "Prepare weekly ACH batch",
  ach_retry: "Retry ACH transfer",
};

export const reviewStateLabel: Record<ReviewState, string> = {
  awaiting_approval: "Awaiting a second operator",
  approved: "Approved",
  executed: "Done",
  stale: "No longer applies",
  expired: "Expired",
};

export const cancellationKindLabel: Record<CancellationRefund["kind"], string> = {
  customer_cancel: "Customer cancellation",
  provider_cancel: "Provider cancellation, no replacement",
  no_show: "Provider no-show, no replacement",
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
  refund_amount_invalid: "Enter a service, tax and tip amount greater than zero in total.",
  payment_not_captured: "That payment was not captured on this invoice.",
  deposit_service_only: "Only a deposit was collected, so the refund can include service only.",
  refund_exceeds_components: "It is more than the service, tax or tip still refundable on this invoice.",
  refund_exceeds_payment: "It is more than is still refundable on this payment.",
  on_ach_statement: "The payout is already on an ACH statement. Work the bank outcome first.",
  chargeback_open: "A chargeback is open or its loss is not allocated. Resolve the chargeback first.",
  not_eligible: "The cancellation policy produces no refund that can be computed for this payment.",
  no_refund_due: "The cancellation policy gives no refund for this payment.",
  amount_changed: "The policy amount changed after this was requested. Request it again.",
  dispute_not_lost: "The chargeback is not recorded as lost.",
  refund_pending: "A refund on this invoice has not settled. Settle it before allocating the chargeback.",
  allocation_invalid: "The allocation must equal the chargeback and stay within the retained service, tax and tip.",
  awaiting_confirmation: "The homeowner has not confirmed completion, or the confirmation does not match the job.",
  replacement_reconciliation: "The replacement provider's payout needs its reviewed reconciliation first.",
  dispute_hold: "A dispute or appeal on this job is open.",
  confirmation_conflict: "Recorded completion evidence conflicts with the homeowner's confirmation. Reconcile it first.",
  payment_incomplete: "The invoice is not fully paid.",
  chargeback_hold: "A chargeback on this payment is open.",
  reconciliation_hold: "A Stripe readback hold is open on this invoice.",
  provider_event_hold: "An unprocessed Stripe event holds this payout.",
  confirmation_window: "Less than 48 hours have passed since the homeowner confirmed completion.",
  payout_hold: "A payout hold is open. Release it first if its cause is cleared.",
  refund_hold: "A refund on this invoice has not settled.",
  payout_onboarding: "The provider's payout onboarding or bank authorization is not current.",
  no_payable: "Nothing is payable to the provider.",
  bank_authorization_ambiguous: "The provider has more than one current bank authorization. Resolve it in compliance first.",
  payable_changed: "A payout amount changed after this was requested. Request the batch again.",
  payee_changed: "A payout's provider changed after this was requested. Request the batch again.",
  bank_authorization_changed: "The provider's bank authorization changed. This statement cannot be sent or retried; it needs a replacement statement, which is not available yet.",
  statement_stale: "The payable amount no longer matches the statement. It cannot be sent or retried; it needs a replacement statement, which is not available yet.",
  period_taken: "An ACH batch already covers part of this week.",
  bank_outcome_open: "The bank outcome is not failed or returned. Record it first; an unknown outcome is never retried.",
  failure_evidence_missing: "The failure has no recorded bank evidence.",
  transition_invalid: "That outcome does not follow the transfer's current status. Refresh the page.",
  bank_reference_required: "Enter the bank reference for this transfer.",
  bank_reference_conflict: "That reference differs from the one recorded when the transfer was submitted.",
  bank_reference_used: "That reference is already recorded for another transfer.",
};

export const achStatusLabel: Record<AchStatus, string> = {
  prepared: "Prepared, not sent",
  submitted: "Submitted at the bank",
  unknown: "Outcome unknown",
  settled: "Settled",
  failed: "Failed",
  returned: "Returned after settlement",
};

export const achOutcomeLabel: Record<AchOutcome, string> = {
  submitted: "Submitted",
  settled: "Settled",
  failed: "Failed",
  unknown: "Outcome unknown",
  returned: "Returned",
};

/** The bank outcomes that can follow a transfer's current status (money_record_ach transitions). */
export function achOutcomes(status: AchStatus): AchOutcome[] {
  if (status === "prepared") return ["submitted"];
  if (status === "submitted" || status === "unknown") return ["settled", "failed", "unknown"];
  if (status === "settled") return ["returned"];
  return [];
}

/** Whether a bank outcome can be recorded now. A prepared transfer must still be payable to be sent. */
export function canRecordOutcome(item: AchItem) {
  return item.status === "prepared" ? item.submit_blocker === null : achOutcomes(item.status).length > 0;
}

/** Whether a retry of a failed or returned transfer can be requested from this session. */
export function canRequestRetry(item: AchItem) {
  return (item.status === "failed" || item.status === "returned") && item.retry_blocker === null && item.open_retry_request_id === null;
}

/** A YYYY-MM-DD date as a calendar day, never shifted by the viewer's time zone. */
export const formatDay = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** The exclusive end of a seven-day week that starts on a YYYY-MM-DD date. */
export function weekEnd(start: string): string {
  const day = new Date(`${start}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 7);
  return day.toISOString().slice(0, 10);
}

export const moneyDetails = (request: ReviewRequest): MoneyDetails | null =>
  ["refund_authorization", "cancellation_refund", "chargeback_allocation"].includes(request.operation) ? (request.details as MoneyDetails | null) : null;
export const batchDetails = (request: ReviewRequest): AchBatchDetails | null =>
  request.operation === "ach_preparation" ? (request.details as AchBatchDetails | null) : null;
export const retryDetails = (request: ReviewRequest): AchRetryDetails | null =>
  request.operation === "ach_retry" ? (request.details as AchRetryDetails | null) : null;

export const reissueBlockerLabel: Record<ReissueBlocker, string> = {
  refund_not_sent: "It has not been sent to Stripe.",
  refund_settled: "It has already settled.",
  refund_not_uncertain: "Its outcome is not uncertain.",
  refund_found_at_stripe: "Stripe has a refund for it. Read it back instead.",
  readback_required: "Read it back from Stripe first. A reissue needs a readback that finds no refund.",
  readback_too_early: "Read it back again: the readback must be at least 24 hours after the refund was prepared.",
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
  if (request.state === "expired") return { kind: "none", note: "Not run within 24 hours. Request it again if it still applies." };
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

/** Whether an uncertain refund may be sent again under a new Stripe key from this session. */
export function canReissueRefund(refund: PendingRefund) {
  return refund.can_send && refund.attempt_status === "reconcile" && refund.reissue_blocker === null;
}

/** The only ways to split a lost chargeback: the three parts add up to it and stay within what is retained. */
export function allocationError(amount: number, retained: Components, parts: Components): string | null {
  if (parts.service + parts.tax + parts.tip !== amount) return "Service, tax and tip must add up to the chargeback.";
  if (parts.service > retained.service || parts.tax > retained.tax || parts.tip > retained.tip) {
    return "A part is more than the invoice still retains.";
  }
  return null;
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
  [/Finance review request expired/, "This request was not run within 24 hours and has expired. Request it again if it still applies."],
  [/Payout hold already released/, "This hold was already released."],
  [/Payout hold not found|Cancellation not found|Chargeback not found|Refund authorization not found/, "It no longer exists. Refresh the page."],
  [/Only the refund's author or approver can reissue/, "Only the refund's author or approver can reissue it."],
  [/Service, tax and tip amounts in cents required/, "Enter service, tax and tip amounts, greater than zero in total."],
  [/Stripe payment required/, "Choose the Stripe payment to refund."],
  [/Weekly period start required/, "Choose the date the week starts."],
  [/Between 1 and 500 payouts required/, "Choose between 1 and 500 payouts."],
  [/Bank batch reference of up to 200 characters required/, "Enter the bank's reference for this batch, up to 200 characters."],
  [/Bank reference of up to 200 characters required/, "Enter a bank reference of up to 200 characters, or leave it blank to use the recorded one."],
  [/Bank outcome required/, "Choose the bank outcome."],
  [/Bank attempt not found/, "It no longer exists. Refresh the page."],
  [/Evidence of up to 1000 characters required/, "Enter evidence of up to 1000 characters."],
];

/** Operator wording for a gateway refusal. Unknown database text is not shown verbatim. */
export function commandErrorMessage(message: string): string {
  const blocker = /Finance review not actionable: ([a-z_]+)/.exec(message)?.[1];
  if (blocker && blocker in blockerLabel) return blockerLabel[blocker as ReviewBlocker];
  const bank = /Bank outcome not recordable: ([a-z_]+)/.exec(message)?.[1];
  if (bank && bank in blockerLabel) return blockerLabel[bank as ReviewBlocker];
  const reissue = /Refund reissue not allowed: ([a-z_]+)/.exec(message)?.[1];
  if (reissue && reissue in reissueBlockerLabel) return reissueBlockerLabel[reissue as ReissueBlocker];
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
