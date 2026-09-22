// TRACE-075 presentation for the finance reconciliation readback. The server derives every
// expected amount, check, funds state and exception from the ledger kernels; this module
// only words them. Amounts are integer cents.

export type FundsState = "not_eligible" | "held" | "eligible" | "scheduled" | "paid" | "payout_failed";

export type NotEligibleReason =
  | "payment_incomplete"
  | "awaiting_confirmation"
  | "replacement_reconciliation"
  | "confirmation_window"
  | "no_payable";

export type HoldReason =
  | "dispute"
  | "chargeback"
  | "reconciliation"
  | "provider_event"
  | "payout_hold"
  | "pending_refund"
  | "payout_onboarding";

export type LedgerIssue =
  | "charge_attempts"
  | "charge_ledger"
  | "refund_counters"
  | "refund_ledger"
  | "earnings_posting"
  | "platform_fee"
  | "tax_liability"
  | "customer_advance"
  | "provider_payable"
  | "bank_ledger"
  | "statement_stale"
  | "chargeback_suspense"
  | "stripe_clearing"
  | "recovery_ledger";

export type BankStatus = "prepared" | "submitted" | "unknown" | "settled" | "failed" | "returned";

export type ObligationReconciliation = {
  obligation_id: string;
  service_request_id: string;
  invoice_number: string | null;
  created_at: string;
  payee: { contractor_id: string; name: string | null; reassigned: boolean };
  terms: { subtotal: number; tax: number; tip: number; deposit: number; total: number } | null;
  charges: {
    captured: number;
    attempts_captured: number;
    ledger_captured: number;
    fully_captured: boolean;
    payments: { payment_id: string; mode: "full" | "deposit" | "balance"; amount: number }[];
  };
  refunds: { service: number; tax: number; tip: number; settled: number; pending: number };
  earnings: { platform_fee: number; platform_fee_ledger: number; tax: number; tax_ledger: number; provider_proceeds: number };
  payout: {
    funds_state: FundsState;
    not_eligible: NotEligibleReason[];
    held: HoldReason[];
    eligible_at: string | null;
    paid: number;
    returned: number;
    payable: number;
    payable_ledger: number;
    /** The live statement; null when there is none or every statement was withdrawn. */
    statement: { amount: number; period_start: string; attempt_number: number; bank_status: BankStatus } | null;
    /** Statements withdrawn from this payout (TRACE-079). */
    withdrawn_statements: number;
    /** What the provider owes after a refund, chargeback or late payment beyond the proceeds, and how it was recovered (TRACE-080). */
    recovery: { owed: number; late_settled: number; repaid: number; written_off: number };
  };
  chargebacks: { suspense: number; suspense_ledger: number; lost: number };
  processor_costs: number;
  readback:
    | { state: "none" }
    | { state: "matched" | "mismatch" | "outdated"; observed: number; expected: number; recorded_at: string };
  reconciliation_open: boolean;
  issues: LedgerIssue[];
};

export type FinanceException =
  | { kind: "ledger_mismatch"; obligation_id: string; invoice_number: string | null; codes: LedgerIssue[]; since: string }
  | {
      kind: "provider_event";
      event_id: string;
      event_type: string;
      status: string;
      attempts: number;
      error_code: string | null;
      holds_all_payouts: boolean;
      obligation_id: string | null;
      since: string;
    }
  | { kind: "checkout_reconcile"; obligation_id: string; attempt_id: string; mode: string; amount: number; error_code: string | null; since: string }
  | {
      kind: "refund_pending";
      obligation_id: string;
      authorization_id: string;
      payment_id: string;
      amount: number;
      attempt_status: "not_started" | "prepared" | "pending" | "succeeded" | "failed" | "reconcile";
      since: string;
    }
  | { kind: "reconciliation_open"; obligation_id: string; since: string }
  | { kind: "chargeback"; obligation_id: string; dispute_id: string; payment_id: string; amount: number; status: "open" | "lost"; since: string }
  | { kind: "payout_hold"; obligation_id: string; hold_id: string; since: string }
  | { kind: "bank_outcome"; obligation_id: string; item_id: string; attempt_number: number; amount: number; status: "unknown" | "failed" | "returned"; since: string }
  | { kind: "provider_owes"; obligation_id: string; invoice_number: string | null; payee_name: string | null; amount: number; since: string }
  /** A bank statement line that matches no recorded movement, or matches one at another amount (TRACE-081). */
  | {
      kind: "bank_line";
      line_id: string;
      statement_id: string;
      period_start: string;
      period_end: string;
      line_number: number;
      direction: "debit" | "credit";
      amount: number;
      state: "unmatched" | "amount_mismatch";
      obligation_id: string | null;
      since: string;
    }
  /** A recorded settlement, return, late payment or repayment no imported statement line shows (TRACE-081). */
  | {
      kind: "bank_unevidenced";
      movement: string;
      movement_kind: "settled" | "returned" | "late" | "repayment";
      obligation_id: string;
      direction: "debit" | "credit";
      amount: number;
      since: string;
    };

export type LedgerAccount =
  | "stripe_clearing"
  | "customer_advance"
  | "platform_revenue"
  | "provider_payable"
  | "tax_liability"
  | "processor_expense"
  | "chargeback_suspense"
  | "bank"
  | "provider_recovery_loss";

export type FinanceReconciliation = {
  evaluated_at: string;
  fee_percent: number;
  obligation_count: number;
  listed_limit: number;
  accounts: { account: LedgerAccount; debit: number; credit: number }[];
  totals: {
    captured: number;
    refunded: number;
    platform_fee: number;
    tax: number;
    provider_payable: number;
    paid_out: number;
    processor_costs: number;
    chargeback_suspense: number;
    provider_owed: number;
    with_issues: number;
  };
  global_event_holds: number;
  exceptions: FinanceException[];
  obligations: ObligationReconciliation[];
};

export const fundsStateLabel: Record<FundsState, string> = {
  not_eligible: "Not yet eligible",
  held: "Held",
  eligible: "Eligible for ACH",
  scheduled: "Scheduled",
  paid: "Paid",
  payout_failed: "Payout failed",
};

export const fundsStateTone: Record<FundsState, "neutral" | "info" | "success" | "warning" | "danger"> = {
  not_eligible: "neutral",
  held: "warning",
  eligible: "info",
  scheduled: "info",
  paid: "success",
  payout_failed: "danger",
};

export const bankStatusLabel: Record<BankStatus, string> = {
  prepared: "prepared",
  submitted: "submitted to the bank",
  unknown: "bank outcome unknown",
  settled: "settled",
  failed: "failed",
  returned: "returned",
};

export const reasonLabel: Record<NotEligibleReason | HoldReason, string> = {
  payment_incomplete: "Customer payment not complete",
  awaiting_confirmation: "Awaiting homeowner confirmation",
  replacement_reconciliation: "Replacement provider needs commercial reconciliation",
  confirmation_window: "Inside 48 hours of homeowner confirmation",
  no_payable: "No provider proceeds remain",
  dispute: "Open dispute or appeal",
  chargeback: "Chargeback open or loss not allocated",
  reconciliation: "Stripe readback mismatch unresolved",
  provider_event: "Stripe event not processed",
  payout_hold: "Payout hold",
  pending_refund: "Refund not yet settled",
  payout_onboarding: "Payout onboarding not current",
};

export const issueLabel: Record<LedgerIssue, string> = {
  charge_attempts: "Captured amount differs from captured checkouts",
  charge_ledger: "Captured amount differs from capture journals",
  refund_counters: "Refunded amounts differ from settled refunds",
  refund_ledger: "Settled refunds are not each posted once",
  earnings_posting: "Earnings allocation missing or unexpected",
  platform_fee: "Platform revenue differs from the fee on retained service",
  tax_liability: "Tax liability differs from retained tax",
  customer_advance: "Customer advance does not clear",
  provider_payable: "Provider payable differs from proceeds less recorded payouts and recoveries",
  bank_ledger: "Bank postings differ from recorded settlements and returns",
  statement_stale: "ACH statement no longer matches retained amounts or payee",
  chargeback_suspense: "Chargeback suspense differs from open disputes",
  stripe_clearing: "Stripe clearing differs from charges less refunds, chargebacks and costs",
  recovery_ledger: "Recovery loss differs from recorded write-offs",
};

export const accountLabel: Record<LedgerAccount, string> = {
  stripe_clearing: "Stripe clearing",
  customer_advance: "Customer advance",
  platform_revenue: "Platform revenue",
  provider_payable: "Provider payable",
  tax_liability: "Tax liability",
  processor_expense: "Processor expense",
  chargeback_suspense: "Chargeback suspense",
  bank: "Bank",
  provider_recovery_loss: "Provider recovery loss",
};

export function labelOf<K extends string>(labels: Record<K, string>, key: string) {
  return labels[key as K] ?? key;
}

export const formatCents = (minor: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);

/** What a recorded bank movement was (TRACE-081). */
export const bankMovementLabel: Record<"settled" | "returned" | "late" | "repayment", string> = {
  settled: "ACH transfer settled",
  returned: "ACH transfer returned",
  late: "Late payment of a withdrawn transfer",
  repayment: "Provider repayment",
};

/** Title and next action for one exception. Actions describe the existing reviewed kernels. */
export function exceptionPresentation(exception: FinanceException): { title: string; action: string } {
  switch (exception.kind) {
    case "ledger_mismatch":
      return {
        title: "Ledger mismatch",
        action: "Do not prepare a payout for this invoice. Escalate to the finance owner; corrections are appended through a reviewed command, never edited.",
      };
    case "provider_event":
      return {
        title: exception.holds_all_payouts ? "Unsupported Stripe event" : "Stripe event not processed",
        action: exception.holds_all_payouts
          ? "Every payout is held until this event is read back from Stripe and excluded with a second reviewer."
          : "Read the event back from Stripe, then replay it or exclude it with a second reviewer.",
      };
    case "checkout_reconcile":
      return {
        title: "Checkout outcome uncertain",
        action: "Read the checkout session back from Stripe before the customer is asked to pay again.",
      };
    case "refund_pending":
      return {
        title: "Refund not settled",
        action:
          exception.attempt_status === "not_started"
            ? "The reviewed refund has not been sent to Stripe yet."
            : exception.attempt_status === "failed" || exception.attempt_status === "reconcile"
              ? "Read the refund back from Stripe. Do not create a second refund."
              : "Waiting for Stripe's refund event. If it does not arrive, read the refund back from Stripe.",
      };
    case "reconciliation_open":
      return {
        title: "Stripe readback mismatch",
        action: "Record a current Stripe readback. A matching readback is resolved with a second reviewer.",
      };
    case "chargeback":
      return exception.status === "open"
        ? { title: "Chargeback open", action: "Respond to the dispute in Stripe. The payout stays held." }
        : { title: "Chargeback lost", action: "Allocate the lost amount to service, tax and tip with a second reviewer." };
    case "payout_hold":
      return { title: "Payout hold", action: "Resolve the hold with its reason and evidence once the cause is cleared." };
    case "provider_owes":
      return {
        title: "Provider owes Mercurius",
        action: "Ask the provider to repay, then record the repayment, or record a write-off, each with a second reviewer. Never debit the provider's bank or hold back other earnings.",
      };
    case "bank_line":
      return exception.state === "amount_mismatch"
        ? {
            title: "Statement amount differs",
            action: "The bank statement shows a different amount for a recorded transfer. Do not close the statement; escalate to the finance owner.",
          }
        : {
            title: "Statement line unmatched",
            action: "Resolve it under Bank statements: record the outcome the bank shows, match it to a recorded movement, or dismiss a line that is not a provider payout.",
          };
    case "bank_unevidenced":
      return {
        title: "Not on a bank statement",
        action: "The bank statement for this date has no line for a recorded bank movement. Import the missing line or check the recorded outcome with the bank.",
      };
    case "bank_outcome":
      return exception.status === "unknown"
        ? { title: "Bank outcome unknown", action: "Confirm the transfer with the bank. Do not resend it." }
        : {
            title: exception.status === "returned" ? "Transfer returned" : "Transfer failed",
            action: "Record the bank's confirmation, then retry the transfer or withdraw it for a replacement statement, each with a second reviewer.",
          };
  }
}

export function exceptionAmount(exception: FinanceException): number | null {
  return "amount" in exception ? exception.amount : null;
}

/** Stripe readback wording. "Outdated" means money moved after the last readback. */
export function readbackLabel(readback: ObligationReconciliation["readback"]) {
  switch (readback.state) {
    case "none":
      return "No Stripe readback recorded";
    case "matched":
      return "Matches Stripe readback";
    case "mismatch":
      return `Stripe readback ${formatCents(readback.observed)}, ledger ${formatCents(readback.expected)}`;
    case "outdated":
      return "Money moved since the last Stripe readback";
  }
}

export function needsAttention(row: ObligationReconciliation) {
  return row.issues.length > 0 || row.payout.funds_state === "held" || row.payout.funds_state === "payout_failed"
    || row.readback.state === "mismatch" || row.reconciliation_open || row.payout.recovery.owed > 0;
}
