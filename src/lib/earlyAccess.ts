import type { SupabaseClient } from "@supabase/supabase-js";
import {
  INTAKE_REFUSAL_MESSAGE,
  intakeGuardRefusal,
  recordIntakeSubmission,
} from "./intakeProtection";

// TRACE-102 (DEC-2026-022, CFG-014): R0 homeowner early-access and expansion interest.
// The form collects only email, a five-digit ZIP, service interests or "still exploring",
// an optional first name and an independent, unchecked marketing choice. Any other field
// (phone, address, photos, payment, SMS) is refused rather than silently dropped. The
// database decides the Lee County boundary, deduplication, consent and retention; this
// module validates input and maps outcomes to responses.

export type InterestKind = "early_access" | "expansion";

export type InterestInput = {
  kind: InterestKind;
  email: string;
  firstName: string | null;
  zipCode: string;
  serviceIds: string[];
  stillExploring: boolean;
};

export type EarlyAccessSubmission = InterestInput & { marketingOptIn: boolean };

export type RouteResult = { status: number; body: Record<string, unknown> };

export class EarlyAccessValidationError extends Error {}

const SUBMISSION_KEYS = new Set([
  "kind",
  "email",
  "first_name",
  "zip_code",
  "service_ids",
  "still_exploring",
  "marketing_opt_in",
  "intake",
]);
const MANAGE_KEYS = new Set([
  "token",
  "action",
  "first_name",
  "zip_code",
  "service_ids",
  "still_exploring",
]);
const SERVICE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TOKEN = /^[0-9a-f]{64}$/;
export const MAX_SERVICES = 30;

export const BOUNDARY_MESSAGE: Record<InterestKind, string> = {
  early_access:
    "Mercurius is opening in Lee County, Florida first. That ZIP code is outside Lee County, so it is not eligible for early access. You can join expansion interest instead.",
  expansion:
    "That ZIP code is in Lee County, where early access is open. Join early access instead.",
};

function record(value: unknown, keys: Set<string>): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EarlyAccessValidationError("The form is invalid.");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !keys.has(key))) {
    throw new EarlyAccessValidationError("The form includes a field that is not collected.");
  }
  return input;
}

function interestContent(input: Record<string, unknown>) {
  const zipCode = typeof input.zip_code === "string" ? input.zip_code.trim() : "";
  if (!/^[0-9]{5}$/.test(zipCode)) {
    throw new EarlyAccessValidationError("Enter a five-digit ZIP code.");
  }
  const rawFirst = input.first_name ?? null;
  if (rawFirst !== null && typeof rawFirst !== "string") {
    throw new EarlyAccessValidationError("First name is invalid.");
  }
  const firstName = rawFirst?.trim() || null;
  if (firstName && firstName.length > 100) {
    throw new EarlyAccessValidationError("First name is too long.");
  }
  if (typeof input.still_exploring !== "boolean") {
    throw new EarlyAccessValidationError("Choose services of interest or still exploring.");
  }
  const services = input.service_ids ?? [];
  if (
    !Array.isArray(services) ||
    services.length > MAX_SERVICES ||
    services.some((id) => typeof id !== "string" || !SERVICE_ID.test(id))
  ) {
    throw new EarlyAccessValidationError("Choose services from the current catalog.");
  }
  const serviceIds = [...new Set(services as string[])].sort();
  if (input.still_exploring === serviceIds.length > 0) {
    throw new EarlyAccessValidationError("Choose services of interest or still exploring.");
  }
  return { zipCode, firstName, serviceIds, stillExploring: input.still_exploring };
}

export function parseEarlyAccessSubmission(value: unknown): EarlyAccessSubmission {
  const input = record(value, SUBMISSION_KEYS);
  if (input.kind !== "early_access" && input.kind !== "expansion") {
    throw new EarlyAccessValidationError("Choose early access or expansion interest.");
  }
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new EarlyAccessValidationError("Enter a valid email address.");
  }
  // The marketing choice is independent and must be sent explicitly; it defaults to
  // unchecked in the form and is never inferred.
  if (typeof input.marketing_opt_in !== "boolean") {
    throw new EarlyAccessValidationError("The marketing choice is missing.");
  }
  return {
    kind: input.kind,
    email,
    ...interestContent(input),
    marketingOptIn: input.marketing_opt_in,
  };
}

function isDatabaseValidation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "22023";
}

// The anonymous join. Every accepted submission returns the same saved response whether
// or not the email already had interest, so the form cannot be used to test membership.
export async function submitEarlyAccess(
  supabase: SupabaseClient,
  body: unknown,
  ip: string | null,
): Promise<RouteResult> {
  const refusal = intakeGuardRefusal(
    typeof body === "object" && body !== null ? (body as Record<string, unknown>).intake : null,
  );
  if (refusal) {
    console.warn("Early-access submission refused", { reason: refusal });
    return { status: 429, body: { error: INTAKE_REFUSAL_MESSAGE } };
  }
  let submission: EarlyAccessSubmission;
  try {
    submission = parseEarlyAccessSubmission(body);
  } catch (error) {
    if (error instanceof EarlyAccessValidationError) return { status: 400, body: { error: error.message } };
    throw error;
  }

  // The boundary answer is public policy, so it is given before a limit slot is used.
  const { data: inLee, error: boundaryError } = await supabase.rpc("r0_zip_in_lee", {
    p_zip: submission.zipCode,
  });
  if (boundaryError) throw boundaryError;
  if ((inLee === true) !== (submission.kind === "early_access")) {
    return {
      status: 409,
      body: { outcome: "boundary", kind: submission.kind, error: BOUNDARY_MESSAGE[submission.kind] },
    };
  }

  const limit = await recordIntakeSubmission(supabase, "early_access", submission.email, ip);
  if (limit !== "accepted") {
    console.warn("Early-access submission refused", { reason: limit });
    return { status: 429, body: { error: INTAKE_REFUSAL_MESSAGE } };
  }

  const { data, error } = await supabase.rpc("r0_submit_interest", {
    p_kind: submission.kind,
    p_email: submission.email,
    p_first_name: submission.firstName,
    p_zip: submission.zipCode,
    p_service_ids: submission.serviceIds,
    p_still_exploring: submission.stillExploring,
    p_marketing: submission.marketingOptIn,
  });
  if (error) {
    if (isDatabaseValidation(error)) {
      return { status: 400, body: { error: "Check the form and try again." } };
    }
    throw error;
  }
  const outcome = (data as { outcome?: unknown } | null)?.outcome;
  if (outcome === "boundary") {
    return {
      status: 409,
      body: { outcome: "boundary", kind: submission.kind, error: BOUNDARY_MESSAGE[submission.kind] },
    };
  }
  if (outcome !== "saved") throw new Error("Unexpected early-access outcome");
  return { status: 201, body: { outcome: "saved", kind: submission.kind } };
}

export type ManageAction = "read" | "update" | "withdraw";

// Email-link management. Possession of an unexpired link sent to the address is the
// verification; an unknown, expired or withdrawn link gets one generic answer.
export async function manageEarlyAccess(supabase: SupabaseClient, body: unknown): Promise<RouteResult> {
  let input: Record<string, unknown>;
  try {
    input = record(body, MANAGE_KEYS);
  } catch (error) {
    if (error instanceof EarlyAccessValidationError) return { status: 400, body: { error: error.message } };
    throw error;
  }
  const token = typeof input.token === "string" ? input.token : "";
  const action = input.action;
  if (!TOKEN.test(token) || (action !== "read" && action !== "update" && action !== "withdraw")) {
    return { status: 404, body: { error: "This link is invalid or has expired." } };
  }
  const params: Record<string, unknown> = { p_token: token, p_action: action };
  if (action === "update") {
    try {
      const content = interestContent(input);
      Object.assign(params, {
        p_first_name: content.firstName,
        p_zip: content.zipCode,
        p_service_ids: content.serviceIds,
        p_still_exploring: content.stillExploring,
      });
    } catch (error) {
      if (error instanceof EarlyAccessValidationError) return { status: 400, body: { error: error.message } };
      throw error;
    }
  }
  const { data, error } = await supabase.rpc("r0_manage_interest", params);
  if (error) {
    if (isDatabaseValidation(error)) return { status: 400, body: { error: "Check the form and try again." } };
    throw error;
  }
  const result = (data ?? {}) as { outcome?: unknown; interest?: unknown };
  switch (result.outcome) {
    case "found":
    case "updated":
      return { status: 200, body: { outcome: result.outcome, interest: result.interest } };
    case "boundary":
      return {
        status: 409,
        body: { outcome: "boundary", error: "Use a ZIP code in the same area as this interest." },
      };
    case "withdrawn":
    case "withdrawn_held":
      // A held record is withdrawn from mail but kept for the hold; both are withdrawn to the person.
      return { status: 200, body: { outcome: "withdrawn" } };
    case "invalid":
      return { status: 404, body: { error: "This link is invalid or has expired." } };
    default:
      throw new Error("Unexpected early-access management outcome");
  }
}

// Promotional unsubscribe. Supports RFC 8058 one-click POSTs, where the token is in the
// link's query string and the body is the form field List-Unsubscribe=One-Click.
export async function unsubscribeMarketing(supabase: SupabaseClient, token: string | null): Promise<RouteResult> {
  if (!token || !TOKEN.test(token)) {
    return { status: 404, body: { error: "This link is invalid or has expired." } };
  }
  const { data, error } = await supabase.rpc("r0_unsubscribe_marketing", { p_token: token });
  if (error) throw error;
  const outcome = (data as { outcome?: unknown } | null)?.outcome;
  if (outcome === "unsubscribed") return { status: 200, body: { outcome } };
  if (outcome === "invalid") return { status: 404, body: { error: "This link is invalid or has expired." } };
  throw new Error("Unexpected unsubscribe outcome");
}
