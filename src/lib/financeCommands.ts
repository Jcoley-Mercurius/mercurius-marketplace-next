// TRACE-076/077/078/079/080/081/082/083 presentation for the finance operator command gateway. The database decides who
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
  | "ach_retry"
  | "ach_withdrawal"
  | "ach_late_settlement"
  | "payout_recovery"
  | "bank_statement_close"
  | "refund_release"
  | "refund_late_failure"
  | "refund_late_resend"
  | "refund_late_release"
  | "repayment_reversal";
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
  | "recovery_invalid"
  | "nothing_owed"
  | "owed_changed"
  | "exceeds_owed"
  | "not_withdrawn"
  | "period_open"
  | "statement_changed"
  | "statement_exceptions"
  | FailedRefundBlocker
  | "refund_changed"
  | LateRefundBlocker
  | "reversal_invalid"
  | "nothing_returnable"
  | "returnable_changed"
  | "exceeds_returnable"
  | AchBlocker;
/** Why a payout cannot be batched, sent, retried or withdrawn, or a bank outcome recorded (TRACE-078/079). */
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
  | "bank_reference_used"
  | "withdrawn"
  | "status_changed"
  | "paid"
  | "already_paid";
export type ReissueBlocker =
  | "refund_not_sent"
  | "refund_settled"
  | "refund_not_uncertain"
  | "refund_found_at_stripe"
  | "readback_required"
  | "readback_too_early";

/** Why a refund Stripe reported failed cannot be resent or released yet (TRACE-082). */
export type FailedRefundBlocker =
  | "refund_not_sent"
  | "refund_settled"
  | "refund_released"
  | "refund_not_failed"
  | "readback_required";

/** Why a step on a refund Stripe failed after it settled cannot be taken yet (TRACE-083). */
export type LateRefundBlocker =
  | "refund_not_settled"
  | "late_failure_open"
  | "no_late_failure"
  | "refund_in_flight"
  | "refund_found_at_stripe"
  | "readback_too_early"
  | "payout_paid"
  | "advance_captured";

export type Components = { service: number; tax: number; tip: number };
export type RefundAttemptStatus = "not_started" | "prepared" | "pending" | "succeeded" | "failed" | "reconcile";

export type MoneyDetails = Components & { payment_id?: string; dispute_id?: string };
/** The withdrawn statement a payout's next statement replaces (TRACE-079). */
export type WithdrawnStatement = {
  item_id: string;
  period_start: string;
  amount: number;
  previous_status: WithdrawableStatus;
  withdrawn_at: string;
};
export type AchBatchDetails = {
  period_start: string;
  period_end: string;
  bank_ref: string;
  total: number;
  items: {
    obligation_id: string;
    amount: number;
    invoice_number: string | null;
    payee_name: string | null;
    replaces: WithdrawnStatement | null;
    blocker: ReviewBlocker | null;
  }[];
};
export type AchRetryDetails = {
  item_id: string;
  attempt_number: number;
  status: AchStatus;
  amount: number;
  payee_name: string | null;
  period_start: string;
};
export type AchWithdrawalDetails = {
  item_id: string;
  attempt_number: number;
  /** The status the request withdraws; it goes stale if the transfer moves on first. */
  status: WithdrawableStatus;
  current_status: AchStatus;
  amount: number;
  payee_name: string | null;
  invoice_number: string | null;
  period_start: string;
  bank_reference_hint: string | null;
  /** What the bank showed when the failure or return was recorded. */
  bank_evidence: string | null;
};

/** A bank payment of a withdrawn transfer shown after the withdrawal (TRACE-080). */
export type AchLateSettlementDetails = {
  item_id: string;
  attempt_number: number;
  amount: number;
  payee_name: string | null;
  invoice_number: string | null;
  period_start: string;
  previous_status: WithdrawableStatus | null;
  withdrawn_at: string | null;
  bank_reference_hint: string | null;
  /** The payout's live replacement statement, if one was prepared; a settled one means a duplicate payment. */
  replacement: { period_start: string; amount: number; status: AchStatus } | null;
};
export type RecoveryKind = "repayment" | "write_off";
/** A statement close binds the statement's lines and totals when it was requested (TRACE-081). */
export type BankCloseDetails = {
  period_start: string;
  period_end: string;
  lines: number;
  debits: number;
  credits: number;
  exceptions_now: number;
};
/** A release names the Stripe refund that failed; it goes stale if the refund is resent first (TRACE-082). */
export type RefundReleaseDetails = Components & {
  authorization_id: string;
  payment_id: string;
  amount: number;
  provider_reference: string | null;
  provider_status: string | null;
  refund_created_at: string;
};
/** A late refund step names the Stripe refund it acts on and the send's key; a resend makes it stale (TRACE-083). */
export type LateRefundDetails = Components & {
  authorization_id: string;
  payment_id: string;
  amount: number;
  provider_reference: string | null;
  attempt_status: RefundAttemptStatus | null;
  provider_status: string | null;
  /** For a release: the provider share it restores. */
  restores_provider: number | null;
};
/** A repayment reversal binds what was returnable when it was requested (TRACE-083). */
export type RepaymentReversalDetails = {
  amount: number;
  returnable: number;
  returnable_now: number;
  payee_name: string | null;
};
export type PayoutRecoveryDetails = {
  kind: RecoveryKind;
  amount: number;
  /** What the provider owed when this was requested; it goes stale if that changes first. */
  owed: number;
  owed_now: number;
  payee_name: string | null;
};

export type ReviewRequest = {
  request_id: string;
  operation: ReviewOperation;
  subject: string;
  obligation_id: string | null;
  invoice_number: string | null;
  reason: string;
  evidence: string | null;
  details:
    | MoneyDetails
    | AchBatchDetails
    | AchRetryDetails
    | AchWithdrawalDetails
    | AchLateSettlementDetails
    | PayoutRecoveryDetails
    | BankCloseDetails
    | RefundReleaseDetails
    | LateRefundDetails
    | RepaymentReversalDetails
    | null;
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
  /** Set only for a refund Stripe reported failed: why it cannot be resent or released yet, or null. */
  resend_blocker: FailedRefundBlocker | null;
  release_blocker: ReviewBlocker | null;
  open_release_request_id: string | null;
  last_readback: { found: boolean; provider_status: string | null; by_me: boolean; created_at: string } | null;
  created_at: string;
};

/** A failed refund taken off the books in the last 30 days (TRACE-082). */
export type RefundRelease = {
  authorization_id: string;
  obligation_id: string;
  invoice_number: string | null;
  payment_id: string;
  amount: number;
  provider_reference: string;
  reason: string;
  evidence: string;
  by_me: boolean;
  /** True when the refund had settled and the release reversed it (TRACE-083). */
  reversed: boolean;
  created_at: string;
};

export type LateRefundState = "failure_signal" | "customer_owed" | "redelivered" | "released";
/** A settled refund Stripe failed, or may have failed, after it settled (TRACE-083). */
export type LateRefund = {
  authorization_id: string;
  obligation_id: string;
  invoice_number: string | null;
  payment_id: string;
  amount: number;
  state: LateRefundState;
  /** The Stripe refund that delivered it now; null while it is owed to the customer or released. */
  delivered_reference: string | null;
  attempt_status: RefundAttemptStatus;
  provider_reference: string | null;
  generation: number;
  /** Stripe's refund.updated event saying it failed: a reason to read it back, not evidence. */
  signal: { event_id: string; status: string; received_at: string } | null;
  last_readback: { found: boolean; provider_reference: string | null; provider_status: string | null; by_me: boolean; created_at: string } | null;
  late_failure: { failed_reference: string; reason: string; evidence: string; by_me: boolean; created_at: string } | null;
  can_send: boolean;
  failure_blocker: ReviewBlocker | null;
  resend_blocker: ReviewBlocker | null;
  release_blocker: ReviewBlocker | null;
  open_failure_request_id: string | null;
  open_resend_request_id: string | null;
  open_release_request_id: string | null;
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

export type AchStatus = "prepared" | "submitted" | "unknown" | "settled" | "failed" | "returned" | "withdrawn";
export type AchOutcome = Exclude<AchStatus, "prepared" | "withdrawn">;
/** Transfers the bank does not hold, which a reviewed withdrawal can take off their statement. */
export type WithdrawableStatus = "prepared" | "failed" | "returned";

export type ReadyPayout = {
  obligation_id: string;
  invoice_number: string | null;
  payee_id: string;
  payee_name: string | null;
  amount: number;
  eligible_at: string;
  /** Set when an earlier statement for this payout was withdrawn; the next batch replaces it. */
  replaces: WithdrawnStatement | null;
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
  withdraw_blocker: ReviewBlocker | null;
  open_withdrawal_request_id: string | null;
  withdrawal: { previous_status: WithdrawableStatus; reason: string; evidence: string; by_me: boolean; created_at: string } | null;
  /** The week of the statement that replaced this withdrawn one, if any. */
  replaced_in: string | null;
  /** The week of the withdrawn statement this one replaces, if any. */
  replaces_period: string | null;
  /** Set when the bank showed this withdrawn transfer as paid after all (TRACE-080). */
  late_settlement: { bank_reference_hint: string | null; by_me: boolean; created_at: string } | null;
};

export type AchBatch = {
  batch_id: string;
  period_start: string;
  period_end: string;
  created_by_me: boolean;
  approved_by_me: boolean;
  created_at: string;
  total: number;
  withdrawn_total: number;
  items: AchItem[];
};

export type AchOperations = { next_period_start: string | null; ready: ReadyPayout[]; batches: AchBatch[] };

/** A payout whose provider owes Mercurius, or that had a recent recovery (TRACE-080). */
export type OwedPayout = {
  obligation_id: string;
  invoice_number: string | null;
  payee_id: string;
  payee_name: string | null;
  owed: number;
  paid: number;
  returned: number;
  late_settled: number;
  repaid: number;
  written_off: number;
  refunded: number;
  chargebacks_lost: number;
  recoveries: { kind: RecoveryKind; amount: number; owed_before: number; reason: string; evidence: string; by_me: boolean; created_at: string }[];
  open_request_id: string | null;
};
/** A withdrawn transfer the bank could still show as paid. */
export type WithdrawnTransfer = {
  attempt_id: string;
  item_id: string;
  obligation_id: string;
  invoice_number: string | null;
  payee_name: string | null;
  amount: number;
  attempt_number: number;
  previous_status: WithdrawableStatus;
  period_start: string;
  bank_reference_hint: string | null;
  withdrawn_at: string;
  open_request_id: string | null;
};
export type LateSettlement = {
  attempt_id: string;
  obligation_id: string;
  invoice_number: string | null;
  amount: number;
  bank_reference_hint: string | null;
  reason: string;
  evidence: string;
  by_me: boolean;
  created_at: string;
};
export type RecoveryOperations = { owed_total: number; owed: OwedPayout[]; withdrawn: WithdrawnTransfer[]; late_settlements: LateSettlement[] };

/** A payout whose provider repaid an amount they no longer owe, or with a recent reversal (TRACE-083). */
export type RepaymentReturn = {
  obligation_id: string;
  invoice_number: string | null;
  payee_name: string | null;
  returnable: number;
  repaid: number;
  reversed: number;
  /** What the bank paid and kept on this payout, and the proceeds it is owed. */
  paid: number;
  proceeds: number;
  reversals: { amount: number; returnable_before: number; reason: string; evidence: string; by_me: boolean; created_at: string }[];
  open_request_id: string | null;
};
export type RepaymentReturnOperations = { returnable_total: number; payouts: RepaymentReturn[] };

/** A recorded bank movement a statement line can evidence (TRACE-081). */
export type BankMovementKind = "settled" | "returned" | "late" | "repayment" | "reversal";
export type BankMovement = {
  movement: string;
  kind: BankMovementKind;
  direction: "debit" | "credit";
  amount: number;
  bank_reference_hint: string | null;
  obligation_id: string;
  invoice_number: string | null;
  payee_name: string | null;
  attempt_number: number | null;
  recorded_at: string;
};
export type BankLineState = "matched" | "amount_mismatch" | "dismissed" | "unmatched";
export type BankSuggestionAction =
  | "record_settled"
  | "record_returned"
  | "request_late_settlement"
  | "match_repayment"
  | "match_reversal"
  | "amount_mismatch"
  | "outcome_conflict"
  | "already_evidenced"
  | "no_transfer";
/** The actions that record through an existing command, filled in from the line. */
export type BankResolution = Extract<BankSuggestionAction, "record_settled" | "record_returned" | "request_late_settlement">;
export type StatementLine = {
  line_id: string;
  line_number: number;
  posted_on: string;
  direction: "debit" | "credit";
  amount: number;
  /** The last four characters of the bank reference; the full reference is never returned. */
  bank_reference_hint: string;
  state: BankLineState;
  match: (BankMovement & { how: "reference" | "manual" }) | null;
  suggestion: {
    action: BankSuggestionAction;
    attempt_id?: string;
    status?: AchStatus;
    obligation_id?: string;
    amount?: number;
    attempt_number?: number;
    invoice_number?: string | null;
    payee_name?: string | null;
  } | null;
  dismissal: { reason: string; by_me: boolean; created_at: string } | null;
};
export type BankStatement = {
  statement_id: string;
  period_start: string;
  period_end: string;
  created_by_me: boolean;
  created_at: string;
  line_count: number;
  debit_total: number;
  credit_total: number;
  imports: number;
  exceptions: number;
  closed: { by_me: boolean; reason: string; created_at: string } | null;
  close_blocker: ReviewBlocker | null;
  open_request_id: string | null;
  lines: StatementLine[];
};
export type StatementOperations = {
  /** Mercurius's business day, YYYY-MM-DD. */
  today: string;
  statements: BankStatement[];
  /** Recorded movements no statement line evidences, with the statement whose period covers them. */
  unevidenced: (BankMovement & { statement_id: string | null })[];
};

export type FinanceOperations = {
  evaluated_at: string;
  requests: ReviewRequest[];
  holds: OpenHold[];
  readbacks: OpenReadback[];
  events: UnprocessedEvent[];
  refunds: PendingRefund[];
  refund_releases: RefundRelease[];
  late_refunds: LateRefund[];
  cancellations: CancellationRefund[];
  chargebacks: LostChargeback[];
  ach: AchOperations;
  recoveries: RecoveryOperations;
  repayment_returns: RepaymentReturnOperations;
  statements: StatementOperations;
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
  ach_withdrawal: "Withdraw ACH transfer",
  ach_late_settlement: "Record late payment of withdrawn transfer",
  payout_recovery: "Record provider recovery",
  bank_statement_close: "Close bank statement",
  refund_release: "Release failed refund",
  refund_late_failure: "Record refund that failed after it settled",
  refund_late_resend: "Resend refund that failed after it settled",
  refund_late_release: "Release refund that failed after it settled",
  repayment_reversal: "Return a provider repayment",
};

export const recoveryKindLabel: Record<RecoveryKind, string> = {
  repayment: "Repayment from the provider",
  write_off: "Write-off absorbed by Mercurius",
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
  on_ach_statement: "The payout is already on an ACH statement. Work the bank outcome first, or withdraw an unsent, failed or returned transfer.",
  chargeback_open: "A chargeback is open or its loss is not allocated. Resolve the chargeback first.",
  not_eligible: "The cancellation policy produces no refund that can be computed for this payment.",
  no_refund_due: "The cancellation policy gives no refund for this payment.",
  amount_changed: "The policy amount changed after this was requested. Request it again.",
  dispute_not_lost: "The chargeback is not recorded as lost.",
  refund_pending: "A refund on this invoice has not settled. Settle it before allocating the chargeback.",
  allocation_invalid: "The allocation must equal the chargeback and stay within the retained service, tax and tip.",
  recovery_invalid: "Choose a repayment or a write-off and an amount greater than zero.",
  nothing_owed: "The provider owes nothing on this payout.",
  owed_changed: "The amount the provider owes changed after this was requested. Refresh the page and request it again if it still applies.",
  exceeds_owed: "That is more than the provider owes on this payout.",
  not_withdrawn: "Only a transfer withdrawn from its statement takes a late payment. Record other outcomes on the transfer itself.",
  period_open: "The statement period has not ended. Close it after its last day.",
  statement_changed: "Lines were added to the statement after this was requested. Request the close again.",
  statement_exceptions: "The statement has unresolved lines, or recorded bank movements in its period that no line shows. Resolve them first.",
  refund_not_sent: "The refund has not been sent to Stripe.",
  refund_settled: "The refund has settled.",
  refund_released: "The refund was already released.",
  refund_not_failed: "Stripe has not reported this refund failed, or it was resent. Read it back from Stripe first.",
  readback_required: "Read the refund back from Stripe first. This needs a readback showing the current refund failed or was canceled, or, for an uncertain send, that Stripe has no refund.",
  refund_changed: "The refund was resent, or a different Stripe refund failed, after this was requested. Request it again if it still applies.",
  refund_not_settled: "Stripe has not settled this refund. A refund that fails before it settles is resent or released under Reviewed refunds not settled.",
  late_failure_open: "This refund's failure is already recorded. Resend or release it.",
  no_late_failure: "No failure is open on this refund: it was delivered again or released.",
  refund_in_flight: "A resend of this refund is with Stripe. Read it back, or wait for Stripe's refund event.",
  refund_found_at_stripe: "Stripe has a refund for this send. Read it back instead.",
  readback_too_early: "Read it back again: the readback must be at least 24 hours after the refund was prepared.",
  payout_paid: "The provider's payout was already paid at the refunded amount. Restoring their share would leave them owed proceeds that cannot be paid again, so resend the refund instead.",
  advance_captured: "The refund was of a deposit, and the invoice has since been paid in full. A release cannot restore the deposit; resend the refund.",
  reversal_invalid: "Enter an amount greater than zero.",
  nothing_returnable: "Mercurius owes this provider none of their repayment back.",
  returnable_changed: "What Mercurius owes back changed after this was requested. Refresh the page and request it again if it still applies.",
  exceeds_returnable: "That is more of the repayment than Mercurius owes back.",
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
  bank_authorization_changed: "The provider's bank authorization changed. This statement cannot be sent or retried. Withdraw the transfer with a second operator; a later weekly batch then prepares a replacement statement.",
  statement_stale: "The payable amount no longer matches the statement. It cannot be sent or retried. Withdraw the transfer with a second operator; a later weekly batch then prepares a replacement statement.",
  period_taken: "An ACH batch already covers part of this week.",
  bank_outcome_open: "The bank outcome is not failed or returned. Record it first; an unknown outcome is never retried.",
  failure_evidence_missing: "The failure has no recorded bank evidence.",
  transition_invalid: "That outcome does not follow the transfer's current status. Refresh the page.",
  bank_reference_required: "Enter the bank reference for this transfer.",
  bank_reference_conflict: "That reference differs from the one recorded when the transfer was submitted.",
  bank_reference_used: "That reference is already recorded for another transfer.",
  withdrawn: "The transfer was withdrawn from its statement. A later weekly batch prepares its replacement.",
  status_changed: "The transfer's bank status changed after this was requested. Refresh the page and request it again if it still applies.",
  paid: "The transfer settled. A settled transfer cannot be withdrawn; record a return if the bank shows one.",
  already_paid: "The bank has already paid this payout, for example through a late payment of a withdrawn transfer. Do not send it; withdraw an unsent or failed transfer instead.",
};

export const achStatusLabel: Record<AchStatus, string> = {
  prepared: "Prepared, not sent",
  submitted: "Submitted at the bank",
  unknown: "Outcome unknown",
  settled: "Settled",
  failed: "Failed",
  returned: "Returned after settlement",
  withdrawn: "Withdrawn from this statement",
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

/** Whether a withdrawal of this transfer can be requested from this session (TRACE-079). */
export function canRequestWithdrawal(item: AchItem) {
  return (item.status === "prepared" || item.status === "failed" || item.status === "returned")
    && item.withdraw_blocker === null && item.open_withdrawal_request_id === null;
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
export const withdrawalDetails = (request: ReviewRequest): AchWithdrawalDetails | null =>
  request.operation === "ach_withdrawal" ? (request.details as AchWithdrawalDetails | null) : null;
export const lateSettlementDetails = (request: ReviewRequest): AchLateSettlementDetails | null =>
  request.operation === "ach_late_settlement" ? (request.details as AchLateSettlementDetails | null) : null;
export const recoveryDetails = (request: ReviewRequest): PayoutRecoveryDetails | null =>
  request.operation === "payout_recovery" ? (request.details as PayoutRecoveryDetails | null) : null;
export const closeDetails = (request: ReviewRequest): BankCloseDetails | null =>
  request.operation === "bank_statement_close" ? (request.details as BankCloseDetails | null) : null;
export const releaseDetails = (request: ReviewRequest): RefundReleaseDetails | null =>
  request.operation === "refund_release" ? (request.details as RefundReleaseDetails | null) : null;
export const lateRefundDetails = (request: ReviewRequest): LateRefundDetails | null =>
  ["refund_late_failure", "refund_late_resend", "refund_late_release"].includes(request.operation) ? (request.details as LateRefundDetails | null) : null;
export const reversalDetails = (request: ReviewRequest): RepaymentReversalDetails | null =>
  request.operation === "repayment_reversal" ? (request.details as RepaymentReversalDetails | null) : null;

export const bankLineStateLabel: Record<BankLineState, string> = {
  matched: "Matched",
  amount_mismatch: "Amount differs",
  dismissed: "Not a payout",
  unmatched: "Unmatched",
};

export const bankMovementKindLabel: Record<BankMovementKind, string> = {
  settled: "Settled transfer",
  returned: "Returned transfer",
  late: "Late payment of a withdrawn transfer",
  repayment: "Provider repayment",
  reversal: "Repayment returned to the provider",
};

/** What an unmatched line tells the operator to do. */
export const bankSuggestionLabel: Record<BankSuggestionAction, string> = {
  record_settled: "The bank paid this transfer. Record it settled.",
  record_returned: "The bank returned this transfer. Record the return.",
  request_late_settlement: "The bank paid this withdrawn transfer. Request a late payment record with a second operator.",
  match_repayment: "Match it to the provider repayment it shows.",
  match_reversal: "Match it to the repayment Mercurius returned to the provider.",
  amount_mismatch: "The bank shows a different amount from the transfer. Do not record it; escalate to the finance owner.",
  outcome_conflict: "The bank shows something the transfer's recorded outcome contradicts. Check with the bank and escalate; nothing can be recorded from this line.",
  already_evidenced: "Another statement line already shows this transfer. Check the bank for a duplicate.",
  no_transfer: "No transfer has this reference. Match it to a recorded movement, or dismiss it if it is not a provider payout.",
};

export const bankResolutionLabel: Record<BankResolution, string> = {
  record_settled: "Record settled",
  record_returned: "Record return",
  request_late_settlement: "Request late payment record",
};

/** A statement line resolvable through an existing command from this session. */
export function lineResolution(line: StatementLine): BankResolution | null {
  const action = line.state === "unmatched" ? line.suggestion?.action : undefined;
  return action === "record_settled" || action === "record_returned" || action === "request_late_settlement" ? action : null;
}

/** Recorded movements a line could be matched to by hand: same direction and amount. */
export function matchCandidates(line: StatementLine, movements: BankMovement[]): BankMovement[] {
  if (line.state !== "unmatched") return [];
  return movements.filter((movement) => movement.direction === line.direction && movement.amount === line.amount);
}

/** Whether an unmatched line may be dismissed: never one whose reference names a transfer. */
export function canDismissLine(line: StatementLine) {
  const action = line.suggestion?.action;
  return line.state === "unmatched" && (action === "no_transfer" || action === "match_repayment" || action === "match_reversal");
}

/** Why a recovery of this amount cannot be requested, or null. The server re-checks against the ledger. */
export function recoveryError(owed: number, amount: number | null): string | null {
  if (amount === null || amount <= 0) return "Enter an amount greater than zero.";
  if (amount > owed) return "That is more than the provider owes on this payout.";
  return null;
}

/** Why a repayment reversal of this amount cannot be requested, or null. The server re-checks against the ledger. */
export function reversalError(returnable: number, amount: number | null): string | null {
  if (amount === null || amount <= 0) return "Enter an amount greater than zero.";
  if (amount > returnable) return "That is more of the repayment than Mercurius owes back.";
  return null;
}

export const reissueBlockerLabel: Record<ReissueBlocker, string> = {
  refund_not_sent: "It has not been sent to Stripe.",
  refund_settled: "It has already settled.",
  refund_not_uncertain: "Its outcome is not uncertain.",
  refund_found_at_stripe: "Stripe has a refund for it. Read it back instead.",
  readback_required: "Read it back from Stripe first. A reissue needs a readback that finds no refund.",
  readback_too_early: "Read it back again: the readback must be at least 24 hours after the refund was prepared.",
};

export const failedRefundBlockerLabel: Record<FailedRefundBlocker, string> = {
  refund_not_sent: "It has not been sent to Stripe.",
  refund_settled: "It has already settled.",
  refund_released: "It was released.",
  refund_not_failed: "Stripe has not reported this send failed.",
  readback_required: "Read it back from Stripe first. Resending or releasing needs a readback showing this send failed or canceled.",
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

/** Whether a refund Stripe reported failed may be sent again under a new Stripe key from this session (TRACE-082). */
export function canResendRefund(refund: PendingRefund) {
  return refund.can_send && refund.attempt_status === "failed" && refund.resend_blocker === null;
}

/** Whether a release of a refund Stripe reported failed can be requested from this session (TRACE-082). */
export function canRequestRefundRelease(refund: PendingRefund) {
  return refund.attempt_status === "failed" && refund.release_blocker === null && refund.open_release_request_id === null;
}

export const lateRefundStateLabel: Record<LateRefundState, string> = {
  failure_signal: "Stripe may have failed it after it settled",
  customer_owed: "Failed after it settled; owed to the customer",
  redelivered: "Delivered again after a late failure",
  released: "Released after a late failure; the refund is reversed",
};

/** The late refund steps, each a second-person request (TRACE-083). */
export type LateRefundStep = "failure" | "resend" | "release";

/** Whether this late refund step can be requested from this session. */
export function canRequestLateStep(item: LateRefund, step: LateRefundStep) {
  if (step === "failure") return item.state === "failure_signal" && item.failure_blocker === null && item.open_failure_request_id === null;
  if (item.state !== "customer_owed") return false;
  return step === "resend"
    ? item.resend_blocker === null && item.open_resend_request_id === null
    : item.release_blocker === null && item.open_release_request_id === null;
}

/** Whether a resent late refund may be sent to Stripe from this session: prepared, and by its author or approver. */
export function canSendLateRefund(item: LateRefund) {
  return item.can_send && item.state === "customer_owed" && item.attempt_status === "prepared";
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
  [/Payout already on an ACH statement/, "This payout is already on an ACH statement, so a hold cannot stop it. Work the bank outcome, or withdraw an unsent, failed or returned transfer first."],
  [/Stripe event already processed/, "Stripe's event was already processed. Nothing was replayed."],
  [/Excluded event requires/, "This event was excluded, so it cannot be replayed."],
  [/Finance review subject not found|Finance obligation not found|Stripe event not found|Finance review request not found/, "It no longer exists. Refresh the page."],
  [/Finance review already executed/, "It has already been done."],
  [/Finance review request expired/, "This request was not run within 24 hours and has expired. Request it again if it still applies."],
  [/Payout hold already released/, "This hold was already released."],
  [/Payout hold not found|Cancellation not found|Chargeback not found|Refund authorization not found/, "It no longer exists. Refresh the page."],
  [/Only the refund's author or approver can reissue/, "Only the refund's author or approver can reissue it."],
  [/Only the refund's author or approver can resend/, "Only the refund's author or approver can resend it."],
  [/failed on an earlier send of this refund/, "Stripe's refund is the one an earlier send created, which failed. Read back the current send."],
  [/A released refund cannot be sent again/, "This refund was released, so it cannot be sent again. Request a new refund if one is still owed."],
  [/Service, tax and tip amounts in cents required/, "Enter service, tax and tip amounts, greater than zero in total."],
  [/Stripe payment required/, "Choose the Stripe payment to refund."],
  [/Weekly period start required/, "Choose the date the week starts."],
  [/Between 1 and 500 payouts required/, "Choose between 1 and 500 payouts."],
  [/Bank batch reference of up to 200 characters required/, "Enter the bank's reference for this batch, up to 200 characters."],
  [/Bank reference of up to 200 characters required/, "Enter a bank reference of up to 200 characters, or leave it blank to use the recorded one."],
  [/Bank outcome required/, "Choose the bank outcome."],
  [/Bank attempt not found/, "It no longer exists. Refresh the page."],
  [/Evidence of up to 1000 characters required/, "Enter evidence of up to 1000 characters."],
  [/Recovery must be a repayment or a write-off/, "Choose a repayment or a write-off."],
  [/Recovery amount in cents required/, "Enter an amount greater than zero."],
  [/Reversal amount in cents required/, "Enter an amount greater than zero."],
  [/Late refund step must be/, "Choose whether to record the failure, resend or release the refund."],
  [/Statement period of up to 32 days required/, "Enter a statement period of up to 32 days, ending on or after its start."],
  [/Statement period cannot start in the future/, "The statement period cannot start after today."],
  [/Another statement already covers part of this period/, "Another statement already covers part of this period. Use its exact dates, or choose a period that does not overlap."],
  [/Bank statement is closed/, "This statement is closed. Nothing can be added or changed."],
  [/Bank statement not found|Statement line not found/, "It no longer exists. Refresh the page."],
  [/Up to 1000 statement lines required/, "Import up to 1000 lines at a time."],
  [/File fingerprint must be/, "The file could not be read. Choose it again."],
  [/Note of up to 500 characters required/, "Enter a note of up to 500 characters."],
  [/Reason of up to 1000 characters required/, "Enter a reason of up to 1000 characters."],
];

const lineRefusals: Record<string, string> = {
  line_matched: "This line is already matched. Refresh the page.",
  dismissed: "This line was dismissed as not a payout.",
  movement_not_found: "That recorded movement no longer exists. Refresh the page.",
  movement_matched: "Another statement line already shows that movement.",
  direction_mismatch: "A debit matches only a payment, and a credit only a return or repayment.",
  amount_mismatch: "The amounts differ, so they cannot be matched.",
  line_names_transfer: "This line's reference names a recorded transfer, so it is a payout line and cannot be dismissed.",
  suggestion_changed: "What this line shows changed since the page loaded. Refresh and check it again.",
};

/** Operator wording for a gateway refusal. Unknown database text is not shown verbatim. */
export function commandErrorMessage(message: string): string {
  const blocker = /Finance review not actionable: ([a-z_]+)/.exec(message)?.[1];
  if (blocker && blocker in blockerLabel) return blockerLabel[blocker as ReviewBlocker];
  const bank = /Bank outcome not recordable: ([a-z_]+)/.exec(message)?.[1];
  if (bank && bank in blockerLabel) return blockerLabel[bank as ReviewBlocker];
  const line = /Statement line not (?:matchable|dismissable|resolvable): ([a-z_]+)/.exec(message)?.[1];
  if (line && line in lineRefusals) return lineRefusals[line];
  const imported = /Statement line (\d+) (?:is already imported|needs|has an invalid|is posted outside)/.exec(message);
  if (imported) {
    if (/is already imported/.test(message)) return `Line ${imported[1]} is already on a bank statement. Leave it out and import the rest.`;
    if (/outside the statement period/.test(message)) return `Line ${imported[1]} is dated outside the statement period.`;
    if (/invalid posting date/.test(message)) return `Line ${imported[1]} has a date that could not be read.`;
    if (/posting date, direction/.test(message)) return `Line ${imported[1]} needs a date, debit or credit, amount and reference.`;
    if (/amount/.test(message)) return `Line ${imported[1]} needs an amount greater than zero.`;
    return `Line ${imported[1]} needs the bank's reference, up to 200 characters.`;
  }
  const reissue = /Refund reissue not allowed: ([a-z_]+)/.exec(message)?.[1];
  if (reissue && reissue in reissueBlockerLabel) return reissueBlockerLabel[reissue as ReissueBlocker];
  const late = /(?:Refund late failure|Refund release|Repayment reversal) not allowed: ([a-z_]+)/.exec(message)?.[1];
  if (late && late in blockerLabel) return blockerLabel[late as ReviewBlocker];
  const resend = /Refund resend not allowed: ([a-z_]+)/.exec(message)?.[1];
  if (resend && resend in failedRefundBlockerLabel) return failedRefundBlockerLabel[resend as FailedRefundBlocker];
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
