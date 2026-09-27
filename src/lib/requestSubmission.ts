// TRACE-095: browser side of the submit_service_requests contract. The database derives
// coverage, eligibility and price; this module only shapes the payload and explains outcomes.

export const UNAVAILABLE_IN_AREA = "Not available yet in your area.";

export type SubmissionPricingMode = "fixed" | "quote";

export type SubmissionSelection = {
  service_id: string;
  frequency: string;
  description?: string;
  preferred_contractor_id?: string;
  package_id?: string;
  tier_id?: string;
  answers?: Record<string, string>;
  /** What the homeowner was shown. Compared on the server, never stored as the price. */
  expected: { pricing_mode: SubmissionPricingMode; total?: number };
};

export type SubmissionPayload = {
  location: { address: string; city: string; state: string; zip_code: string };
  preferred_date?: string;
  preferred_time?: string;
  selections: SubmissionSelection[];
};

export type SelectionOutcome =
  | "eligible_fixed"
  | "eligible_quote"
  | "unavailable"
  | "invalid_provider"
  | "invalid_package"
  | "package_unavailable"
  | "preferred_provider_unavailable"
  | "answers_required"
  | "price_changed";

export type SelectionResult = {
  selection_index: number;
  service_id: string;
  outcome: SelectionOutcome;
  reason?: string;
  questions?: string[];
  pricing_mode?: SubmissionPricingMode;
  total?: number | null;
};

export type SubmittedRequest = {
  selection_index: number;
  request_id: string;
  service_id: string;
  pricing_mode: "fixed" | "deposit_quote" | "custom_quote";
  quote_only: boolean;
  total_amount: number | null;
  package_id: string | null;
  package_tier_id: string | null;
};

export type SubmissionResult = {
  status: "submitted" | "refused";
  coverage: "covered" | "uncovered" | "waitlist";
  outcomes: SelectionResult[];
  requests: SubmittedRequest[];
  reused: boolean;
};

const submissionKeyPattern = /^[A-Za-z0-9_-]{16,128}$/;
const outcomes = new Set<SelectionOutcome>([
  "eligible_fixed", "eligible_quote", "unavailable", "invalid_provider", "invalid_package",
  "package_unavailable", "preferred_provider_unavailable", "answers_required", "price_changed",
]);

export function newSubmissionKey() {
  return crypto.randomUUID();
}

export function isSubmissionKey(value: unknown): value is string {
  return typeof value === "string" && submissionKeyPattern.test(value);
}

/** An unrecognized response is a verification error, never a success. */
export function parseSubmissionResult(value: unknown): SubmissionResult {
  const result = value as Partial<SubmissionResult> | null;
  const valid = Boolean(result)
    && (result!.status === "submitted" || result!.status === "refused")
    && (result!.coverage === "covered" || result!.coverage === "uncovered" || result!.coverage === "waitlist")
    && Array.isArray(result!.outcomes)
    && Array.isArray(result!.requests)
    && result!.outcomes.every((item) => outcomes.has(item?.outcome) && typeof item.service_id === "string")
    && result!.requests.every((item) => typeof item?.request_id === "string" && typeof item.service_id === "string")
    && (result!.status === "refused" || result!.requests.length > 0);
  if (!valid) throw new Error("The request service returned an unexpected response.");
  return { ...(result as SubmissionResult), reused: result!.reused === true };
}

export function isSubmissionKeyConflict(reason: unknown) {
  const error = reason as { code?: unknown; message?: unknown } | null;
  return error?.code === "22023" && typeof error.message === "string"
    && error.message.includes("Submission key reused");
}

/** Server validation messages (22023) are written for the homeowner; others are not shown. */
export function submissionValidationMessage(reason: unknown) {
  const error = reason as { code?: unknown; message?: unknown } | null;
  return error?.code === "22023" && typeof error.message === "string" ? error.message : null;
}

export function refusalMessage(
  result: SelectionResult,
  serviceName: string,
  formatMoney: (value: number) => string,
) {
  switch (result.outcome) {
    case "eligible_fixed":
    case "eligible_quote":
      return null;
    case "unavailable":
      return `${serviceName}: ${UNAVAILABLE_IN_AREA}`;
    case "invalid_provider":
      return `${serviceName}: we couldn’t find the provider you selected. Remove the provider preference to continue.`;
    case "preferred_provider_unavailable":
      return `${serviceName}: the provider you selected isn’t available for this service at this address. Choose another eligible provider or remove this service.`;
    case "invalid_package":
    case "package_unavailable":
      return `${serviceName}: the package you chose isn’t available for this address. Go back to Services to choose again.`;
    case "answers_required":
      return `${serviceName}: answer the package questions on the Your Home step.`;
    case "price_changed":
      return result.pricing_mode === "fixed" && typeof result.total === "number"
        ? `${serviceName}: the current price for this address is ${formatMoney(result.total)}. Review it, then submit again.`
        : `${serviceName}: this service needs a quote at this address. Review it, then submit again.`;
  }
}
