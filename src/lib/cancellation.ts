import type { Json } from "@/lib/supabase/database.types";

// TRACE-131: wording for exception previews and cancellation outcomes. The server computes every
// assessment and state (job_cancellation_preview / job_cancellation_outcome); this file only names
// them. Entitlement, authorization and money movement are always described separately, and nothing
// says a refund was made unless the payment provider's refund is recorded.

export type OperationKind = "customer_cancel" | "reschedule_request" | "provider_cancel" | "no_show"
  | "partial_completion" | "customer_unavailable" | "unable_to_complete";

export type Assessment = {
  refund_percent?: number | null; basis?: string | null; fee?: number | null; waived?: boolean;
  requires_operations?: boolean; next_action?: string; replacement_providers?: boolean; quality_event?: boolean;
  appointment?: string | null; hours_before?: number | null;
};

export type OperationPreview = {
  job_id: string; kind: OperationKind; allowed: boolean; plan: boolean; visit: boolean;
  refusal: { code: string; message: string } | null; expected: Json;
  assessment: Assessment | null;
  payment: { captured: number; total: number | null; open_checkout: boolean } | null;
};

export type CancellationOutcome = {
  job_id: string; status: string; cancelled: boolean; cancelled_at?: string | null; visit?: boolean;
  entitlement?: { state: string; refund_percent: number | null; basis: string | null; amount?: number; captured?: number };
  authorization?: { state: string; amount?: number; released?: number };
  movement?: { state: string; settled?: number; in_flight?: number; failed?: number; unknown?: number; not_sent?: number };
  follow_up?: { code: string; message: string }[];
};

export const operationLabels: Record<OperationKind, string> = {
  customer_cancel: "Cancel this service",
  reschedule_request: "Ask for a different time",
  provider_cancel: "Provider can't do this service",
  no_show: "Provider didn't arrive",
  partial_completion: "Partly completed",
  customer_unavailable: "Homeowner unavailable",
  unable_to_complete: "Unable to complete",
};

const basisLabels: Record<string, string> = {
  notice_72_hours_or_more: "72 or more hours before the appointment",
  notice_24_to_72_hours: "24 to 72 hours before the appointment",
  notice_under_24_hours: "less than 24 hours before the appointment",
  no_appointment: "no appointment time had been set",
  provider_withdrawal_open: "the provider withdrew and no replacement is in place",
  exception_accepted: "Mercurius accepted a weather or emergency exception",
  no_acceptable_replacement: "no acceptable replacement provider was found",
  cancellation_policy: "the cancellation policy",
};

export const money = (cents: number | null | undefined) =>
  typeof cents === "number" ? (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—";

/** The policy consequence the server will record, in words. */
export function describeAssessment(kind: OperationKind, assessment: Assessment | null): string {
  if (!assessment) return "";
  if (kind === "customer_cancel") {
    const basis = basisLabels[assessment.basis ?? ""] ?? "the cancellation policy";
    return `Refund under the policy: ${assessment.refund_percent ?? 0}% of what was paid, because ${basis}. `
      + "A refund is reviewed by Mercurius before it is sent; this action doesn't send money.";
  }
  if (kind === "reschedule_request") {
    const fee = assessment.fee === null || assessment.fee === undefined
      ? "Less than 24 hours' notice: Mercurius decides case by case and can't guarantee a new time."
      : assessment.fee === 0 ? "No rescheduling fee applies." : `A $${assessment.fee} rescheduling fee applies under the policy; it isn't charged by this request.`;
    return `${fee} Mercurius confirms any new time.`;
  }
  if (kind === "provider_cancel" || kind === "no_show") {
    return assessment.replacement_providers === false
      ? "This is a plan visit, so it isn't offered to another provider. Mercurius will refund it in full or arrange a new visit with the plan's provider."
      : "Mercurius looks for an acceptable replacement first. If there isn't one, the homeowner gets a full refund.";
  }
  return "Mercurius reviews what happened and follows up.";
}

export function entitlementText(outcome: CancellationOutcome): string {
  const e = outcome.entitlement;
  if (!e) return outcome.cancelled ? "This service was cancelled." : "";
  switch (e.state) {
    case "not_cancelled": return "";
    case "awaiting_replacement_decision": return "The provider withdrew. Mercurius is looking for a replacement or will decide the refund.";
    case "awaiting_operations": return "Mercurius will decide what is owed.";
    case "no_payment": return "Nothing was paid, so there is nothing to refund.";
    case "payment_outcome_pending": return "A payment was in progress when this was cancelled. If it goes through, it is owed back under the policy.";
    case "no_refund_under_policy": return `No refund is owed under the policy (${basisLabels[e.basis ?? ""] ?? "cancellation policy"}).`;
    default: return `Owed under the policy: ${e.refund_percent ?? 0}%${typeof e.amount === "number" ? ` (${money(e.amount)})` : ""}.`;
  }
}

export function authorizationText(outcome: CancellationOutcome): string {
  switch (outcome.authorization?.state) {
    case "authorized": return "Refund approved by Mercurius.";
    case "partly_authorized": return `Part of the refund is approved${typeof outcome.authorization.amount === "number" ? ` (${money(outcome.authorization.amount)})` : ""}.`;
    default: return outcome.entitlement?.state === "refund_due" ? "Refund not yet approved." : "";
  }
}

export function movementText(outcome: CancellationOutcome): string {
  const m = outcome.movement;
  switch (m?.state) {
    case "settled": return `Refunded${typeof m.settled === "number" ? `: ${money(m.settled)}` : ""}. The payment provider confirmed it.`;
    case "partly_settled": return `Partly refunded${typeof m.settled === "number" ? `: ${money(m.settled)}` : ""}. The rest isn't confirmed yet.`;
    case "in_flight": return "Refund sent; waiting for the payment provider to confirm it.";
    case "not_sent": return "Refund approved but not sent yet.";
    case "failed": return "A refund failed at the payment provider. Mercurius will follow up.";
    case "unknown": return "A refund's result isn't known yet. Mercurius is checking with the payment provider.";
    default: return outcome.entitlement?.state === "refund_due" ? "No money has been returned yet." : "";
  }
}

/** A refusal because the details changed after the preview was loaded. */
export function isStale(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "40001";
}

export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}
