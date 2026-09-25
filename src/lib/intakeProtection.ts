import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Abuse protection for the public intake routes (TRACE-088; DEC-2026-012 item 1 as amended
// by DEC-2026-013): a honeypot field, a minimum fill time and a per-email limit recorded in
// the database. Every refusal gets the same response, so a sender cannot tell which check
// refused it.

export type IntakeForm = "contact" | "vendor_application";

export const MIN_FILL_MS = 3_000;

export const INTAKE_REFUSAL_MESSAGE = "Please try again later.";

export type IntakeGuardRefusal = "trap" | "too_fast";

// The browser sends { trap, elapsedMs }: the honeypot's value and how long the form was open,
// measured by the browser's own clock so clock skew between browser and server does not
// matter. Anything missing or malformed is treated as too fast.
export function intakeGuardRefusal(value: unknown): IntakeGuardRefusal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "too_fast";
  }
  const guard = value as Record<string, unknown>;
  if (typeof guard.trap !== "string" || guard.trap.length > 0) return "trap";
  const elapsed = guard.elapsedMs;
  if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) {
    return "too_fast";
  }
  return null;
}

export function intakeEmailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// Records the submission against the email's limit and returns false when the limit is
// already reached. Call it after validation and immediately before the insert.
export async function recordIntakeSubmission(
  supabase: SupabaseClient,
  form: IntakeForm,
  email: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("intake_record_submission", {
    p_form: form,
    p_email_hash: intakeEmailHash(email),
  });
  if (error) throw error;
  return data === true;
}
