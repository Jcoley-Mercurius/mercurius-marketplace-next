// TRACE-098: honest per-service confirmation. Every statement is derived from the returned
// request identities and what the database says now (MPS §6.1/§6.2, CFG-002/009, D4/D5):
// a preferred provider is not an assignment, a fixed request awaiting operations is not
// "matching", and a failed or exhausted quote dispatch is not success.

import type { SubmittedRequest } from "@/lib/requestSubmission";
import type { requestStatusPresentation } from "@/components/ui/status";
import { canonicalRequestState, type RequestState } from "./lifecycle";
import { serviceRequestStatuses } from "./serviceRequestStatus";

export type RequestReadback = {
  id: string;
  status: string;
  matching_status: string | null;
  pricing_mode: string | null;
  total_amount: number | null;
  contractor_id: string | null;
  payment_status: string | null;
  quote_status: string | null;
  quote_amount: number | null;
};

export type MatchingStart = "not_needed" | "started" | "failed";
export type CheckoutState =
  | { kind: "not_offered"; reason: "quote" | "multiple" }
  | { kind: "failed" }
  | { kind: "pending" };

export type ServiceConfirmation = {
  requestId: string;
  serviceId: string;
  serviceName: string;
  mode: "fixed" | "deposit_quote" | "custom_quote";
  amount: number | null;
  status: keyof typeof requestStatusPresentation;
  summary: string;
  provider: string;
  payment: string;
  canRetryMatching: boolean;
};

export type ConfirmationInput = {
  requests: SubmittedRequest[];
  serviceNames: Record<string, string>;
  preferredProviderNames: Record<string, string>;
  /** null when the read-back failed: say so instead of guessing. */
  readback: RequestReadback[] | null;
  matching: Record<string, MatchingStart>;
  checkout: CheckoutState;
  formatMoney: (value: number) => string;
};

// P6-R2: once a request moves past intake, the database lifecycle wins over the initial
// matching state and the submission-time terms. Details the intake doesn't read stay in
// the dashboard rather than being guessed here.
const laterStates = {
  // DEC-2026-007: acceptance schedules the service; an appointment time is recorded separately.
  scheduled: "Scheduled with your provider. Any appointment time appears in your dashboard once it’s recorded.",
  in_progress: "Work is in progress. See your dashboard for updates.",
  completion_pending: "The provider reported the work complete. Review it in your dashboard.",
  completed: "This request is complete.",
  closed: "This request is closed.",
  cancelled: "This request was cancelled. Nothing further is scheduled.",
  disputed: "An issue was reported on this request. See your dashboard for its status.",
  resolved: "The reported issue was resolved. See your dashboard for details.",
} as const satisfies Partial<Record<RequestState, string>>;

const quoteSummaries: Record<string, string> = {
  submitted: "A quote is ready for you to review in your dashboard. Nothing is scheduled until you accept it.",
  accepted: "You accepted a quote. Nothing is scheduled until a time is confirmed with you.",
  declined: "You declined the quote. Mercurius will follow up; the request hasn’t been cancelled.",
  expired: "The quote expired. Contact Mercurius for a new quote; the request hasn’t been cancelled.",
  legacy_review: "Mercurius must resend this quote with current terms before you can approve it.",
};

type StoredStatus = (typeof serviceRequestStatuses)[number];
const isStoredStatus = (status: string): status is StoredStatus => (serviceRequestStatuses as readonly string[]).includes(status);
const paid = (row: RequestReadback) => row.payment_status === "captured" || row.payment_status === "released";

/** Still at intake: nothing has happened to it since submission except matching. */
function atIntake(row: RequestReadback) {
  return (row.status === "pending" || row.status === "matched") && row.quote_status == null && row.payment_status === "pending";
}

/** Checkout from the intake only for a request still at intake; the command revalidates. */
export function intakeCheckoutAllowed(row: RequestReadback | null | undefined) {
  return Boolean(row && atIntake(row));
}

/** The intake starts matching only for an untouched pending request. */
export function intakeMatchingAllowed(row: RequestReadback | null | undefined) {
  return Boolean(row && row.status === "pending" && row.matching_status === "awaiting_match" && row.quote_status == null);
}

export function describeConfirmation(input: ConfirmationInput): ServiceConfirmation[] {
  return input.requests.map((request) => {
    const row = input.readback?.find((item) => item.id === request.request_id) ?? null;
    const mode = request.pricing_mode;
    const serviceName = input.serviceNames[request.service_id] ?? request.service_id;
    const preferred = input.preferredProviderNames[request.service_id];
    const matching = input.matching[request.request_id] ?? "not_needed";
    const amount = mode === "fixed" ? request.total_amount : null;

    const base = { requestId: request.request_id, serviceId: request.service_id, serviceName, mode, amount, canRetryMatching: false };
    const payment = paymentLine(mode, amount, row, input.checkout, input.formatMoney);

    if (!row) {
      return { ...base, status: "submitted", summary: "Saved. We couldn’t load its current status, so check your dashboard for the latest.",
        provider: preferred ? `Preferred provider: ${preferred}. Not assigned yet.` : "No provider assigned yet.", payment };
    }
    if (!isStoredStatus(row.status)) {
      return { ...base, status: "submitted", summary: "Saved. Check your dashboard for its current status.", provider: "See your dashboard for provider details.", payment };
    }

    const assigned = row.matching_status === "matched" && Boolean(row.contractor_id);
    const lifecycle = canonicalRequestState(row.status, row.matching_status ?? undefined);
    if (lifecycle in laterStates) {
      const state = lifecycle as keyof typeof laterStates;
      const provider = state === "cancelled" ? "No provider will visit for this request."
        : row.contractor_id ? "A provider is assigned. See your dashboard for details." : "See your dashboard for provider details.";
      return { ...base, status: state, summary: laterStates[state], provider, payment };
    }

    const provider = assigned
      ? "A provider accepted this request."
      : preferred
        ? `Preferred provider: ${preferred}. This is a preference, not an assignment.`
        : "No provider assigned yet.";

    if (row.quote_status != null || row.status === "quoted") {
      const summary = quoteSummaries[row.quote_status ?? "legacy_review"] ?? "Check your dashboard for this request’s quote.";
      const status = row.quote_status === "accepted" ? (assigned ? "provider_confirmed" : "submitted") : "quote_required";
      return { ...base, status, summary, provider, payment };
    }
    if (assigned) return { ...base, status: "provider_confirmed", summary: "A provider accepted this request.", provider, payment };
    if (row.matching_status === "exhausted" || row.matching_status === "sourcing") {
      return { ...base, status: "unavailable", summary: "No eligible provider accepted this request. It stays saved, but nothing is scheduled.", provider, payment };
    }
    if (row.matching_status === "awaiting_consent") {
      return { ...base, status: "submitted", summary: "Your preferred provider can’t take this request. It won’t be offered to anyone else without your consent; review it in your dashboard.", provider, payment };
    }
    if (row.matching_status === "offered") {
      return { ...base, status: "matching", summary: mode === "fixed"
        ? "Offered to an eligible provider. No provider has accepted yet."
        : "Offered to an eligible provider for a quote. No provider has accepted yet.", provider, payment };
    }
    if (row.matching_status === "quote_pending") {
      return { ...base, status: "quote_required", summary: "Waiting for a quote. Nothing is scheduled until you accept one.", provider, payment };
    }
    if (mode !== "fixed" && matching === "failed" && intakeMatchingAllowed(row)) {
      return { ...base, status: "submitted", summary: "Saved, but we couldn’t start finding a provider. Try again below.", provider, payment, canRetryMatching: true };
    }
    if (mode === "fixed") {
      return { ...base, status: "submitted", summary: "Received. Mercurius confirms a provider for fixed-price requests; none is assigned yet.", provider, payment };
    }
    return { ...base, status: "quote_required", summary: "Saved. A quote is required before anything is scheduled.", provider, payment };
  });
}

function paymentLine(mode: ServiceConfirmation["mode"], amount: number | null, row: RequestReadback | null, checkout: CheckoutState, formatMoney: (value: number) => string) {
  const price = amount != null ? `${formatMoney(amount)} fixed price` : "Fixed price";
  if (row && paid(row)) return "Payment confirmed.";
  if (row?.payment_status === "refunded") return "Payment refunded. See your dashboard for details.";
  // Unknown or no longer at intake: never infer "no charge" from a missing or non-captured state.
  if (!row) {
    return mode === "fixed"
      ? `${price} when submitted. We couldn’t load its payment status, so check your dashboard before paying.`
      : "Quote required. We couldn’t load its payment status, so check your dashboard.";
  }
  if (!atIntake(row)) {
    const quote = row.quote_amount != null && (row.quote_status === "submitted" || row.quote_status === "accepted")
      ? `${row.quote_status === "accepted" ? "Accepted quote" : "Quote"}: ${formatMoney(row.quote_amount)}. ` : "";
    const submitted = mode === "fixed" && !quote ? `Submitted at ${price}. ` : "";
    return `${quote}${submitted}See your dashboard for the current price and payment status.`;
  }
  if (mode === "deposit_quote") return "Quote required. Any deposit is set only when you accept a quote. Nothing has been charged.";
  if (mode === "custom_quote") return "Quote required. No amount is set yet and nothing has been charged.";
  if (checkout.kind === "failed") return `${price}. Payment didn’t start from this page. Check this request in your dashboard before paying.`;
  if (checkout.kind === "not_offered" && checkout.reason === "multiple") return `${price}. Online payment isn’t available for a plan with more than one service, so payment wasn’t requested.`;
  return `${price}. Payment isn’t complete until secure checkout confirms it.`;
}
