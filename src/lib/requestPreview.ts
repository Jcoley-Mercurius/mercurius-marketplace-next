// TRACE-098: browser side of preview_service_request_selections. The database evaluates
// coverage, eligibility and price for the homeowner's ZIP; this module only shapes the call and
// validates the response. A preview is never a booking: submission re-checks everything.

import type { PackageQualifyingQuestion } from "@/lib/vendorPricing";
import type { SelectionOutcome } from "@/lib/requestSubmission";

export type PreviewStage = "availability" | "final";

export type PreviewSelection = {
  service_id: string;
  frequency: string;
  preferred_contractor_id?: string;
  package_id?: string;
  tier_id?: string;
  answers?: Record<string, string>;
};

export type OfferingScope = {
  package_name: string | null;
  package_description: string | null;
  tier_name: string | null;
  tier_includes: string[];
};

export type PreviewOutcome = {
  selection_index: number;
  service_id: string;
  outcome: SelectionOutcome;
  reason?: string;
  questions?: string[];
  pricing_mode?: "fixed" | "quote";
  offering_mode?: "fixed" | "deposit_quote" | "custom_quote";
  /** Exact amount the submission would store; null while it still depends on answers. */
  total?: number | null;
  /** Lowest amount among answer-based price levels, shown as “From”. */
  from_total?: number | null;
  depends_on_answers?: boolean;
  /** An effective promotion backs this price (DEC-2026-015: none may be offered at beta). */
  promotion?: boolean;
  package_id?: string | null;
  tier_id?: string | null;
  question_details?: PackageQualifyingQuestion[];
  scope?: OfferingScope | null;
};

export type PreviewResult = {
  stage: PreviewStage;
  coverage: "covered" | "uncovered" | "waitlist";
  outcomes: PreviewOutcome[];
};

const outcomes = new Set<SelectionOutcome>([
  "eligible_fixed", "eligible_quote", "unavailable", "invalid_provider", "invalid_package",
  "package_unavailable", "preferred_provider_unavailable", "answers_required", "price_changed",
]);

/** An unrecognized or partial response is a verification error, never availability. */
export function parsePreviewResult(value: unknown, expectedCount: number): PreviewResult {
  const result = value as Partial<PreviewResult> | null;
  const valid = Boolean(result)
    && (result!.stage === "availability" || result!.stage === "final")
    && (result!.coverage === "covered" || result!.coverage === "uncovered" || result!.coverage === "waitlist")
    && Array.isArray(result!.outcomes)
    && result!.outcomes.every((item) => outcomes.has(item?.outcome) && typeof item.service_id === "string"
      && Number.isInteger(item.selection_index))
    && (result!.coverage !== "covered" || result!.outcomes.length === expectedCount);
  if (!valid) throw new Error("The availability service returned an unexpected response.");
  return result as PreviewResult;
}

export type ServiceAvailability =
  | { kind: "fixed"; total: number; exact: true; outcome: PreviewOutcome }
  | { kind: "fixed"; total: number; exact: false; outcome: PreviewOutcome }
  | { kind: "quote"; offeringMode: "deposit_quote" | "custom_quote"; outcome: PreviewOutcome }
  | { kind: "promotion"; outcome: PreviewOutcome }
  | { kind: "unavailable"; outcome: PreviewOutcome }
  | { kind: "needs_attention"; outcome: PreviewOutcome };

/** One per-service state the intake can show without inventing a price or a fallback. */
export function serviceAvailability(outcome: PreviewOutcome): ServiceAvailability {
  if (outcome.outcome === "unavailable") return { kind: "unavailable", outcome };
  if (outcome.outcome === "eligible_fixed" || outcome.outcome === "eligible_quote") {
    // A promotion reaching intake pricing fails safe instead of advertising or booking it.
    if (outcome.promotion) return { kind: "promotion", outcome };
    if (outcome.pricing_mode === "fixed") {
      if (typeof outcome.total === "number" && outcome.total > 0) return { kind: "fixed", total: outcome.total, exact: true, outcome };
      if (typeof outcome.from_total === "number" && outcome.from_total > 0) return { kind: "fixed", total: outcome.from_total, exact: false, outcome };
      return { kind: "needs_attention", outcome };
    }
    return { kind: "quote", offeringMode: outcome.offering_mode === "deposit_quote" ? "deposit_quote" : "custom_quote", outcome };
  }
  return { kind: "needs_attention", outcome };
}

/** A plan can proceed to submission only when every selection is exactly eligible. */
export function planIsSubmittable(result: PreviewResult) {
  return result.coverage === "covered" && result.outcomes.length > 0 && result.outcomes.every((outcome) => {
    const availability = serviceAvailability(outcome);
    return (availability.kind === "fixed" && availability.exact) || availability.kind === "quote";
  });
}

/** Stable identity of a preview input, so an answer from an older input is never applied. */
export function previewSignature(stage: PreviewStage, zipCode: string, selections: PreviewSelection[]) {
  return JSON.stringify([stage, zipCode.trim().slice(0, 5), selections]);
}
