// TRACE-135 (Phase 6.12B, DEC-2026-056) presentation for a provider's own earnings. The server
// decides each job's provider-funds state from the canonical payment records
// (vendor_own_earnings); this module only words it. No expected payout date is shown (item 2),
// holds are named by category only (item 3), amounts appear only once the payment is captured
// (item 4), and an unknown, failed or returned transfer is never counted as paid (item 5).

import { formatEasternDate } from "./vendorCompliance";

export type EarningsState =
  | "waiting_payment"
  | "awaiting_confirmation"
  | "confirmation_window"
  | "eligible"
  | "held"
  | "in_transfer"
  | "sent"
  | "unknown"
  | "paid"
  | "failed"
  | "returned"
  | "nothing_payable"
  | "unavailable";

export type HoldCategory = "dispute" | "payment_review" | "refund" | "payout_onboarding" | "mercurius";

export type EarningsAmounts = {
  service: number;
  platform_fee: number;
  platform_subsidy: number;
  tips: number;
  payout: number;
};

export type EarningsJob = {
  job_id: string;
  invoice_number: string | null;
  service: string;
  completed_at: string | null;
  confirmed_at: string | null;
  state: EarningsState;
  holds: HoldCategory[];
  eligible_at: string | null;
  amounts: EarningsAmounts | null;
  received: number | null;
  transfer: { week_start: string; week_end: string; amount: number } | null;
};

export type TransferStatus = "prepared" | "submitted" | "unknown" | "settled" | "failed" | "returned" | "withdrawn";

export type StatementItem = {
  job_id: string;
  invoice_number: string;
  service: string;
  service_amount: number;
  platform_fee: number;
  platform_subsidy: number;
  tips: number;
  payout: number;
  status: TransferStatus;
};

export type Statement = {
  week_start: string;
  week_end: string;
  payout_total: number;
  paid_total: number;
  items: StatementItem[];
};

export type VendorEarnings = {
  evaluated_at: string;
  provider_found: boolean;
  payout_onboarding_current: boolean;
  jobs: EarningsJob[];
  totals: Partial<Record<EarningsState, { count: number; amount: number | null }>>;
  statements: Statement[];
};

export const formatCents = (minor: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);

/** A moment as Mercurius counts it, in Eastern Time, with the time of day. */
export function formatEasternDateTime(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} ET`;
}

export function formatWeek(start: string, end: string) {
  return `${formatEasternDate(start)} – ${formatEasternDate(end)}`;
}

export const earningsStateLabel: Record<EarningsState, string> = {
  waiting_payment: "Waiting for payment",
  awaiting_confirmation: "Awaiting homeowner confirmation",
  confirmation_window: "Not yet eligible",
  eligible: "Eligible",
  held: "On hold",
  in_transfer: "In a transfer being prepared",
  sent: "Sent to your bank",
  unknown: "Confirming with the bank",
  paid: "Paid",
  failed: "Not paid",
  returned: "Returned",
  nothing_payable: "Nothing payable",
  unavailable: "Status unavailable",
};

export const holdCategoryLabel: Record<HoldCategory, string> = {
  dispute: "Dispute",
  payment_review: "Payment not complete or under review",
  refund: "Refund in progress",
  payout_onboarding: "Payout onboarding",
  mercurius: "Held by Mercurius",
};

export const transferStatusLabel: Record<TransferStatus, string> = {
  prepared: "Being prepared",
  submitted: "Sent",
  unknown: "Confirming with the bank",
  settled: "Paid",
  failed: "Not paid",
  returned: "Returned",
  withdrawn: "Removed from this transfer",
};

export type EarningsTone = "success" | "warning" | "danger" | "neutral";

export const earningsStateTone: Record<EarningsState, EarningsTone> = {
  waiting_payment: "neutral",
  awaiting_confirmation: "neutral",
  confirmation_window: "neutral",
  eligible: "success",
  held: "warning",
  in_transfer: "neutral",
  sent: "neutral",
  unknown: "warning",
  paid: "success",
  failed: "danger",
  returned: "danger",
  nothing_payable: "neutral",
  unavailable: "warning",
};

export const transferStatusTone: Record<TransferStatus, EarningsTone> = {
  prepared: "neutral",
  submitted: "neutral",
  unknown: "warning",
  settled: "success",
  failed: "danger",
  returned: "danger",
  withdrawn: "neutral",
};

/** What a job's state means, in one or two sentences, without promising a date or outcome. */
export function earningsStateDetail(job: Pick<EarningsJob, "state" | "eligible_at" | "transfer">) {
  const week = job.transfer ? formatWeek(job.transfer.week_start, job.transfer.week_end) : "";
  switch (job.state) {
    case "waiting_payment":
      return "The homeowner's payment is not complete. Amounts appear once it is collected.";
    case "awaiting_confirmation":
      return "Your payout becomes eligible 48 hours after the homeowner confirms the work is complete.";
    case "confirmation_window":
      return `Becomes eligible ${formatEasternDateTime(job.eligible_at)}, 48 hours after the homeowner confirmed.`;
    case "eligible":
      return `Eligible since ${formatEasternDate(job.eligible_at)}; paid in a weekly transfer Mercurius prepares.`;
    case "held":
      return "Not paid while on hold. Contact Mercurius with questions.";
    case "in_transfer":
      return `In the transfer for the week of ${week}. Not yet sent to your bank.`;
    case "sent":
      return `Sent in the transfer for the week of ${week}. It is counted as paid once the bank confirms it.`;
    case "unknown":
      return "Mercurius is confirming this transfer with the bank. It isn't counted as paid.";
    case "paid":
      return week ? `Paid in the transfer for the week of ${week}.` : "Paid.";
    case "failed":
      return "Not paid. Mercurius will review a retry.";
    case "returned":
      return "Returned by your bank. Mercurius will contact you.";
    case "nothing_payable":
      return "After refunds, nothing is payable for this job.";
    case "unavailable":
      return "This job's payout status could not be read. Contact Mercurius if it continues.";
  }
}

export type EarningsSummary = {
  paid: number;
  eligible: number;
  onTheWay: number;
  held: number;
  heldCount: number;
  notYetEligible: number;
  waitingPayment: number;
  attention: number;
};

const amountOf = (totals: VendorEarnings["totals"], ...states: EarningsState[]) =>
  states.reduce((sum, state) => sum + (totals[state]?.amount ?? 0), 0);
const countOf = (totals: VendorEarnings["totals"], ...states: EarningsState[]) =>
  states.reduce((sum, state) => sum + (totals[state]?.count ?? 0), 0);

/**
 * Totals by group, from the server's per-state totals. Paid is what the bank paid; transfers that
 * are sent or being confirmed are on the way, never paid; failed and returned need attention.
 */
export function summarizeEarnings(totals: VendorEarnings["totals"]): EarningsSummary {
  return {
    paid: amountOf(totals, "paid"),
    eligible: amountOf(totals, "eligible"),
    onTheWay: amountOf(totals, "in_transfer", "sent", "unknown"),
    held: amountOf(totals, "held"),
    heldCount: countOf(totals, "held"),
    notYetEligible: amountOf(totals, "awaiting_confirmation", "confirmation_window"),
    waitingPayment: countOf(totals, "waiting_payment"),
    attention: countOf(totals, "failed", "returned"),
  };
}
