// TRACE-154 (Phase 7.2C-1): presentation of the owner-email ledger for operators. The
// database decides every state and permission; these only label it.
import { notificationStateLabel, type NotificationState } from "@/lib/recruitingReadiness";

export type OwnerEmailState = Exclude<NotificationState, "untracked">;

export type OwnerEmailErrorCode =
  | "provider_refused"
  | "provider_rate_limited"
  | "provider_conflict"
  | "provider_server_error"
  | "provider_timeout_or_network"
  | "provider_not_configured";

/** An overview row. It never carries submitted content or an actor ID. */
export type OwnerEmailItem = {
  kind: "contact_submission";
  source_id: string;
  label: string;
  reference: string;
  submitted_at: string;
  state: OwnerEmailState;
  attempts: number;
  last_error_code: OwnerEmailErrorCode | null;
  sent_at: string | null;
  requested_at: string | null;
  acknowledged_at: string | null;
  acknowledged_reason: string | null;
  needs_attention: boolean;
};

export type OwnerEmailCursor = { created_at: string; id: string };

export type OwnerEmailOverview = {
  checked_at: string;
  stale_after_minutes: number;
  limit: number;
  attention_count: { total: number; contact_submission: number; renewal_document: number };
  next_cursor: OwnerEmailCursor | null;
  items: OwnerEmailItem[];
};

/** DEC-2026-066: fetched only when an operator opens one submission. */
export type ContactSubmissionDetail = {
  id: string;
  submitted_at: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
};

export const OWNER_EMAIL_PAGE_SIZE = 50;

export function ownerEmailStateLabel(state: OwnerEmailState): string {
  return notificationStateLabel[state] ?? state;
}

export const ownerEmailErrorLabel: Record<OwnerEmailErrorCode, { label: string; next: string }> = {
  provider_refused: { label: "Resend refused the email", next: "Check the Resend dashboard for the reason, then resend." },
  provider_rate_limited: { label: "Resend rate limit", next: "Resend later." },
  provider_not_configured: {
    label: "Email is not configured",
    next: "No email was sent. Configuration needs fixing before a resend.",
  },
  provider_conflict: { label: "Result unknown", next: "Check the owner inbox and Resend log before resending." },
  provider_server_error: { label: "Result unknown", next: "Check the owner inbox and Resend log before resending." },
  provider_timeout_or_network: { label: "Result unknown", next: "Check the owner inbox and Resend log before resending." },
};

/**
 * A missed or unknown email may already be in the owner inbox (a previous release may have
 * sent it, or a claim committed without its result arriving). The database refuses a
 * resend or acknowledgement of one without the operator's attestation.
 */
export function ownerEmailIsUncertain(state: OwnerEmailState) {
  return state === "missed" || state === "unknown";
}

export const RESEND_ATTESTATION =
  "I checked the owner inbox and the Resend log and found no email for this submission.";
export const ACKNOWLEDGE_ATTESTATION =
  "I checked the owner inbox and the Resend log for this submission.";
