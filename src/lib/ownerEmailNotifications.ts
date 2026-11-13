import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { outcomeState, providerErrorCode } from "@/lib/applicationNotifications";
import { sendOwnerNotification } from "@/lib/ownerNotifications";
import { renewalDocumentKindLabel, type RenewalDocumentKind } from "@/lib/renewalDocuments";
import {
  createCorrelationId,
  elapsedSince,
  logOperationalEvent,
  type OperationalOutcome,
  type OperationalRoute,
} from "@/lib/observability/operationalLog";

// TRACE-154 (Phase 7.2C): the owner email for a saved contact submission (7.2C-1) or a
// provider's renewal-document submission (7.2C-2). The database creates the delivery record
// with the business record, hands one sender a claim and the saved record, and records the
// outcome against that claim. The vendor-application helper (TRACE-104) is unchanged; its
// provider classification is reused as-is.
//
// A claim error is not proof that nothing happened: a timeout or lost connection may follow
// a committed claim. Without a received claim nothing is sent, and the ledger is never reset
// from here. A committed claim stays `sending` and reads `unknown` after the claim window,
// where only an operator's attested resend can permit another attempt.

export type OwnerEmailKind = "contact_submission" | "renewal_document";
export type OwnerEmailMode = "initial" | "resend";

export type ClaimedContactSubmission = {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
};

/** The saved document and the provider's current business name (null when missing). */
export type ClaimedRenewalDocument = {
  id: string;
  created_at: string;
  kind: string;
  business_name: string | null;
};

type Claim =
  | { claimed: true; claim_id: string; attempt: number; kind: "contact_submission"; source: ClaimedContactSubmission }
  | { claimed: true; claim_id: string; attempt: number; kind: "renewal_document"; source: ClaimedRenewalDocument }
  | { claimed: false; state: string };

export type OwnerEmailOutcome =
  | { state: "sent" | "failed" | "unknown"; attempt: number }
  | { state: "not_claimed"; current: string }
  | { state: "unrecorded"; attempt: number }
  /** The claim result was not received. Nothing was sent; the claim may have committed. */
  | { state: "claim_failed" };

export type OwnerEmailTrace = { correlationId: string; route: OperationalRoute };

/**
 * The owner email for a saved contact submission. Subject, body lines, labels, fallbacks and
 * reply-to match the pre-7.2C route. "Submitted" is the saved row's time (Codex C-6).
 */
export function contactNotificationMessage(submission: ClaimedContactSubmission) {
  const fullName = `${submission.first_name} ${submission.last_name ?? ""}`.trim();
  const subjectSummary = submission.subject.replace(/\s+/g, " ").slice(0, 100);
  return {
    subject: `New contact submission — ${subjectSummary}`,
    replyTo: submission.email,
    text: [
      "New Mercurius contact form submission",
      "",
      `Submitted: ${new Date(submission.created_at).toISOString()}`,
      `Name: ${fullName}`,
      `Email: ${submission.email}`,
      `Phone: ${submission.phone ?? "Not provided"}`,
      `Subject: ${submission.subject}`,
      "",
      "Message:",
      submission.message,
    ].join("\n"),
  };
}

/**
 * The owner email for a provider's renewal-document submission. Subject, body lines, labels
 * and the "A provider" / "Compliance" fallbacks match the pre-7.2C-2 route; no reply-to.
 * "Submitted" is the saved row's time and "Business" the current name at claim time (C-6).
 */
export function renewalNotificationMessage(document: ClaimedRenewalDocument) {
  const business = (document.business_name ?? "A provider").replace(/\s+/g, " ").slice(0, 100);
  const kind = renewalDocumentKindLabel[document.kind as RenewalDocumentKind] ?? "Compliance";
  return {
    subject: `Renewal document submitted — ${business}`,
    text: [
      "A provider submitted a renewed compliance document",
      "",
      `Submitted: ${new Date(document.created_at).toISOString()}`,
      `Business: ${business}`,
      `Item: ${kind}`,
      "",
      "Review it from Admin → Compliance Expiry. Nothing changes until an operator accepts or declines it.",
    ].join("\n"),
  };
}

const KEY_PREFIX: Record<OwnerEmailKind, string> = {
  contact_submission: "contact-submission-notification",
  renewal_document: "renewal-document-notification",
};

/** Resend replays the first result for a repeated key; each permitted attempt has its own. */
export function ownerEmailKey(kind: OwnerEmailKind, sourceId: string, attempt: number) {
  return `${KEY_PREFIX[kind]}:${sourceId}:${attempt}`;
}

function isClaim(value: unknown, kind: OwnerEmailKind): value is Claim {
  if (typeof value !== "object" || value === null) return false;
  const claim = value as Record<string, unknown>;
  if (claim.claimed === false) return typeof claim.state === "string";
  if (
    claim.claimed !== true ||
    claim.kind !== kind ||
    typeof claim.claim_id !== "string" ||
    typeof claim.attempt !== "number" ||
    typeof claim.source !== "object" ||
    claim.source === null
  ) {
    return false;
  }
  const source = claim.source as Record<string, unknown>;
  if (kind === "renewal_document") {
    return (
      typeof source.created_at === "string" &&
      typeof source.kind === "string" &&
      (source.business_name === null || source.business_name === undefined || typeof source.business_name === "string")
    );
  }
  return true;
}

function ownerEmailMessage(claim: Extract<Claim, { claimed: true }>) {
  return claim.kind === "renewal_document"
    ? renewalNotificationMessage({ ...claim.source, business_name: claim.source.business_name ?? null })
    : contactNotificationMessage(claim.source);
}

export async function deliverOwnerEmail(
  serviceClient: SupabaseClient,
  kind: OwnerEmailKind,
  sourceId: string,
  mode: OwnerEmailMode,
  send: typeof sendOwnerNotification = sendOwnerNotification,
  trace: OwnerEmailTrace = { correlationId: createCorrelationId(), route: "unattributed" },
): Promise<OwnerEmailOutcome> {
  const context = { route: trace.route, correlationId: trace.correlationId, sourceKind: kind, sourceId, mode };
  let data: unknown;
  try {
    const result = await serviceClient.rpc("owner_email_claim", { p_kind: kind, p_source: sourceId, p_mode: mode });
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    // No claim result was received. Send nothing, change nothing: the database holds the truth.
    logOperationalEvent({ ...context, event: "owner_email.claim_failed", outcome: "failed", error });
    return { state: "claim_failed" };
  }
  if (!isClaim(data, kind)) {
    logOperationalEvent({ ...context, event: "owner_email.claim_failed", outcome: "failed", errorCode: "unexpected" });
    return { state: "claim_failed" };
  }
  if (!data.claimed) {
    logOperationalEvent({
      ...context,
      event: "owner_email.not_claimed",
      // An unexpected state string is dropped by the logger's runtime allowlist.
      outcome: data.state as OperationalOutcome,
    });
    return { state: "not_claimed", current: data.state };
  }
  const { attempt, claim_id: claimId } = data;
  logOperationalEvent({ ...context, attempt, event: "owner_email.claimed", outcome: "claimed" });

  const sendStarted = Date.now();
  const result = await send({
    ...ownerEmailMessage(data),
    idempotencyKey: ownerEmailKey(kind, sourceId, attempt),
  });
  const state = outcomeState(result);
  const errorCode = providerErrorCode(result);
  logOperationalEvent({
    ...context,
    attempt,
    event: "owner_email.provider_result",
    outcome: state,
    errorCode,
    durationMs: elapsedSince(sendStarted),
  });

  let recordError: unknown = null;
  try {
    const recorded = await serviceClient.rpc("owner_email_record", {
      p_kind: kind,
      p_source: sourceId,
      p_claim: claimId,
      p_outcome: state,
      p_provider_id: result.ok ? result.id : null,
      p_error_code: errorCode,
    });
    recordError = recorded.error;
  } catch (error) {
    recordError = error;
  }
  if (recordError) {
    // The ledger stays `sending` and reads `unknown` after the window: an email may have gone out.
    logOperationalEvent({ ...context, attempt, event: "owner_email.record_failed", outcome: "unrecorded", error: recordError });
    return { state: "unrecorded", attempt };
  }
  logOperationalEvent({ ...context, attempt, event: "owner_email.recorded", outcome: state });
  return { state, attempt };
}
