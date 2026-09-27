// TRACE-098: honest per-service confirmation. Every statement is derived from the returned
// request identities and what the database says now (MPS §6.1/§6.2, CFG-002/009, D4/D5):
// a preferred provider is not an assignment, a fixed request awaiting operations is not
// "matching", and a failed or exhausted quote dispatch is not success.

import type { SubmittedRequest } from "@/lib/requestSubmission";
import type { requestStatusPresentation } from "@/components/ui/status";

export type RequestReadback = {
  id: string;
  status: string;
  matching_status: string | null;
  pricing_mode: string | null;
  total_amount: number | null;
  contractor_id: string | null;
  payment_status: string | null;
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

    const assigned = row.matching_status === "matched" && Boolean(row.contractor_id);
    const provider = assigned
      ? "A provider accepted this request."
      : preferred
        ? `Preferred provider: ${preferred}. This is a preference, not an assignment.`
        : "No provider assigned yet.";

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
    if (mode !== "fixed" && matching === "failed") {
      return { ...base, status: "submitted", summary: "Saved, but we couldn’t start finding a provider. Try again below.", provider, payment, canRetryMatching: true };
    }
    if (mode === "fixed") {
      return { ...base, status: "submitted", summary: "Received. Mercurius confirms a provider for fixed-price requests; none is assigned yet.", provider, payment };
    }
    return { ...base, status: "quote_required", summary: "Saved. A quote is required before anything is scheduled.", provider, payment };
  });
}

function paymentLine(mode: ServiceConfirmation["mode"], amount: number | null, row: RequestReadback | null, checkout: CheckoutState, formatMoney: (value: number) => string) {
  if (row?.payment_status === "captured") return "Payment confirmed.";
  if (mode === "deposit_quote") return "Quote required. Any deposit is set only when you accept a quote. Nothing has been charged.";
  if (mode === "custom_quote") return "Quote required. No amount is set yet and nothing has been charged.";
  const price = amount != null ? `${formatMoney(amount)} fixed price` : "Fixed price";
  if (checkout.kind === "failed") return `${price}. Payment didn’t start from this page. Check this request in your dashboard before paying.`;
  if (checkout.kind === "not_offered" && checkout.reason === "multiple") return `${price}. Online payment isn’t available for a plan with more than one service, so payment wasn’t requested.`;
  return `${price}. Payment isn’t complete until secure checkout confirms it.`;
}
