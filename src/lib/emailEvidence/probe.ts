import "server-only";

// TRACE-155 (Phase 7.3D-1, R3D-4): the controlled delivery-evidence probe. One invocation sends at
// most one fixed synthetic email to one Resend test address chosen from a fixed list. The caller
// chooses only the enumerated probe; the recipient, sender, subject, body, headers and key are all
// resolved here. The email carries no tags, so its provider reports are stored `unmatched` and can
// never link to, or be rematched with, a ledger row (R3D-3). Nothing is retried: a failure is
// returned as it happened.
import { type ProbeChoice } from "@/lib/emailEvidence/acceptance";
import { getEmailEvidenceProbeEnvironment, getOwnerNotificationEnvironment, getResendWebhookEnvironment } from "@/lib/env/server";
import { sendNotificationEmail, type NotificationResult } from "@/lib/ownerNotifications";

/** Resend's documented test addresses (plan §4.1). Never taken from a request or the environment. */
const PROBE_RECIPIENTS: Readonly<Record<ProbeChoice, string>> = Object.freeze({
  delivered: "delivered@resend.dev",
  bounced: "bounced@resend.dev",
  complained: "complained@resend.dev",
  suppressed: "suppressed@resend.dev",
});

export const PROBE_SUBJECT = "Mercurius delivery-evidence test (synthetic)";
export const PROBE_TEXT =
  "This is a synthetic delivery-evidence test from Mercurius Marketplace to a Resend test address. It contains no customer information. No action is needed.";

/**
 * The probe's stable identity: one key per test address per UTC day. A repeated invocation on the
 * same day reuses the key, so Resend replays the first response instead of sending again; the
 * body is fixed, so the replay is never refused as a changed payload.
 */
export function probeIdempotencyKey(choice: ProbeChoice, now: Date): string {
  return `email-evidence-probe:v1:${choice}:${now.toISOString().slice(0, 10)}`;
}

/** The recipient for a probe choice. Exposed for tests. */
export function probeRecipient(choice: ProbeChoice): string {
  return PROBE_RECIPIENTS[choice];
}

export type ProbeGate =
  | { open: true }
  | { open: false; reason: "disabled" | "environment" };

/**
 * Whether this deployment may run probes at all. Checked before anything else is read. Open only
 * when the enable flag is exactly "true" AND VERCEL_ENV is exactly "production" (7.3D-1 review
 * fixes, D-8). A missing VERCEL_ENV (a local or CI process), Preview, Development or any other
 * value fails closed. There is no other bypass: tests mock a Production configuration and stub
 * every send.
 */
export function probeGate(): ProbeGate {
  const environment = getEmailEvidenceProbeEnvironment();
  if (!environment.enabled) return { open: false, reason: "disabled" };
  if (!environment.production) return { open: false, reason: "environment" };
  return { open: true };
}

/**
 * Whether the provider and the receiver are configured: a probe is pointless, and refused, when
 * its reports could not be received. Reads presence only; no value is returned.
 */
export function probeConfigured(): boolean {
  try {
    getOwnerNotificationEnvironment();
  } catch {
    return false;
  }
  return Boolean(getResendWebhookEnvironment().current);
}

/** Sends one probe. One provider request at most; no tags; no retry. */
export function sendProbe(choice: ProbeChoice, now: Date): Promise<NotificationResult> {
  return sendNotificationEmail(
    { subject: PROBE_SUBJECT, text: PROBE_TEXT, idempotencyKey: probeIdempotencyKey(choice, now) },
    PROBE_RECIPIENTS[choice],
  );
}
