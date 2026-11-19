// TRACE-154 (Phase 7.2C): presentation of the owner-email ledger for operators. The
// database decides every state and permission; these only label it.
import type { BounceSubtype, EvidenceFact, EvidenceSummary, ExclusionReason } from "@/lib/emailEvidence/labels";
import { notificationStateLabel, type NotificationState } from "@/lib/recruitingReadiness";

export type OwnerEmailState = Exclude<NotificationState, "untracked">;

export type OwnerEmailErrorCode =
  | "provider_refused"
  | "provider_rate_limited"
  | "provider_conflict"
  | "provider_server_error"
  | "provider_timeout_or_network"
  | "provider_not_configured";

export type OwnerEmailKind = "contact_submission" | "renewal_document";
export type OwnerEmailFilter = "all" | OwnerEmailKind;

/**
 * An overview row. It never carries submitted contact content or an actor ID. A contact row's
 * label is the fixed "Contact submission"; a renewal row's is "<business> — <item>".
 */
export type OwnerEmailItem = {
  kind: OwnerEmailKind;
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

// TRACE-155 (Phase 7.3C-1): provider delivery evidence for the visible rows, from
// owner_email_evidence. It carries labels' inputs only: never a provider ID, tag or svix-id.
export type OwnerEmailEvidenceReport = {
  fact: EvidenceFact;
  provider_created_at: string | null;
  bounce_type: "permanent" | "transient" | "undetermined" | "other" | null;
  bounce_subtype: BounceSubtype | null;
  excluded: ExclusionReason | null;
};

export type OwnerEmailEvidenceAttempt = EvidenceSummary & {
  attempt: number;
  has_conflict: boolean;
  reports: OwnerEmailEvidenceReport[];
};

export type OwnerEmailEvidenceItem = {
  kind: OwnerEmailKind;
  source_id: string;
  attempt: number;
  summary: EvidenceSummary;
  has_conflict: boolean;
  conflict_reasons: ExclusionReason[];
  attempts: OwnerEmailEvidenceAttempt[];
};

export type OwnerEmailEvidence = { checked_at: string; items: OwnerEmailEvidenceItem[] };

export type OwnerEmailEvidenceCounts = {
  checked_at: string;
  receiver_armed: boolean;
  not_delivered: number;
  to_review: number;
  conflicting_rows: number;
  conflicting_reports: { conflict_disagree: number; conflict_id_ambiguous: number; conflict_tag_invalid: number; content_conflict: number };
  unmatched_reports: { total: number; by_type: Record<string, number> };
  retention_backlog: { expired: number; expired_over_cap: boolean; oldest_expires_at: string | null };
};

export function ownerEmailStateLabel(state: OwnerEmailState): string {
  // A previous release may have sent without claiming the ledger row during rollout.
  // `missed` proves there is no recorded attempt, not that no email was sent.
  if (state === "missed") return "No recorded attempt";
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

export const ownerEmailFilters: ReadonlyArray<{ value: OwnerEmailFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "contact_submission", label: "Contact form" },
  { value: "renewal_document", label: "Renewal documents" },
];

export const ownerEmailKindLabel: Record<OwnerEmailKind, string> = {
  contact_submission: "Contact form",
  renewal_document: "Renewal document",
};

/** What the email was about, as the confirmation copy names it. */
export const ownerEmailRecordNoun: Record<OwnerEmailKind, string> = {
  contact_submission: "submission",
  renewal_document: "renewal document",
};

/** Renewal documents are reviewed from Compliance Expiry; the link carries no record ID. */
export const RENEWAL_REVIEW_PATH = "/admin/compliance/renewals";

export function resendAttestation(kind: OwnerEmailKind) {
  return `I checked the owner inbox and the Resend log and found no email for this ${ownerEmailRecordNoun[kind]}.`;
}
export function acknowledgeAttestation(kind: OwnerEmailKind) {
  return `I checked the owner inbox and the Resend log for this ${ownerEmailRecordNoun[kind]}.`;
}
