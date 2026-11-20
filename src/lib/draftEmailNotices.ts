import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowserEnvironment } from "@/lib/env/browser";
import { outcomeState } from "@/lib/applicationNotifications";
import { buildCorrelationTags } from "@/lib/emailEvidence/correlationTags";
import { sendNotificationEmail, type NotificationResult } from "@/lib/ownerNotifications";

// DEC-2026-041 item 6: when no vendor account is bound to a provider, a price sent for
// approval is announced to the contact email on file. Same claim/record pattern as the
// TRACE-104 owner email. The notice is not approval: it names no price, says approval needs
// the linked vendor account, and has no reply-to, so a reply cannot approve anything.
// DEC-2026-046: approval is optional, so the email says Mercurius may publish without it.

export type DraftEmailMode = "initial" | "resend";

// pricing_claim_draft_email also returns the claimed notice's ID (migration 20261018004000);
// TRACE-155 (7.3C-2) tags the attempt with exactly that notice.
type Claim =
  | { claimed: true; claim_id: string; attempt: number; notice_id: string; recipient: string; vendor_name: string }
  | { claimed: false; state: string };

export type DraftEmailOutcome =
  | { state: "sent" | "failed" | "unknown"; attempt: number }
  | { state: "not_claimed"; current: string }
  | { state: "unrecorded"; attempt: number };

const DEFAULT_SITE_URL = "https://mercuriusmarketplace.com";

export function draftEmailMessage(vendorName: string, siteUrl: string) {
  const name = vendorName.replace(/\s+/g, " ").trim().slice(0, 100) || "there";
  const base = siteUrl.replace(/\/+$/, "");
  return {
    subject: "Mercurius: a price is waiting for your approval",
    text: [
      `Hello ${name},`,
      "",
      "Mercurius has prepared a price for your business and asks you to review it. It is not live yet. Mercurius can publish it without your approval, so please review it soon.",
      "",
      "This email cannot approve it, and replying does nothing. To review it:",
      "1. Link your Mercurius vendor account using your vendor invitation. If you don't have one, ask Mercurius for it.",
      `2. Sign in and open Pricing & Packages: ${base}/vendor/packages#price-approvals`,
      "3. Approve the price there, or ask for changes.",
      "",
      "Mercurius Marketplace",
    ].join("\n"),
  };
}

// TRACE-155 (7.3C-2, D-3): the Idempotency-Key names the exact claimed notice and attempt. The
// earlier `package-draft-email:<draft>:<attempt>` was per draft, so a later revision's attempt
// reused an earlier revision's key within Resend's 24-hour retention (a replayed response, or a
// 409 once bodies differ). The `v2` prefix keeps every new key distinct from any legacy key still
// inside that window. The notice and attempt are validated exactly as the correlation tags are
// (a canonical lowercase UUID; an integer attempt from 1 to 10,000); otherwise there is no key.
export function draftEmailKey(noticeId: unknown, attempt: unknown): string | null {
  if (!buildCorrelationTags("package_draft", noticeId, attempt)) return null;
  return `package-draft-email:v2:${noticeId as string}:${attempt as number}`;
}

// Recorded on the claimed notice when the claim did not return a usable notice reference: nothing
// was sent, so the operator may resend directly (the existing `failed` path).
export const DRAFT_EMAIL_CLAIM_INVALID = "Not sent: the claim did not return a valid notice reference and attempt";

export async function deliverDraftEmail(
  serviceClient: SupabaseClient,
  draftId: string,
  mode: DraftEmailMode,
  send: typeof sendNotificationEmail = sendNotificationEmail,
): Promise<DraftEmailOutcome> {
  const { data, error } = await serviceClient.rpc("pricing_claim_draft_email", { p_draft: draftId, p_mode: mode });
  if (error) throw error;
  const claim = data as Claim;
  if (!claim.claimed) return { state: "not_claimed", current: claim.state };

  let siteUrl = DEFAULT_SITE_URL;
  try { siteUrl = getBrowserEnvironment().siteUrl ?? DEFAULT_SITE_URL; } catch { /* keep the default */ }
  // TRACE-155 (7.3C-2): the key and tags name the notice this claim locked, as the claim returned
  // it: never the draft ID, and never a later lookup of the draft's current revision, which may
  // have moved on while this email was in flight.
  const idempotencyKey = draftEmailKey(claim.notice_id, claim.attempt);
  if (!idempotencyKey) {
    // D-3: no stable per-notice key means no send. A fallback key could collide with another
    // notice's. Record `failed` (truthful: nothing left) against this claim through the existing
    // record function; if even that is refused, the notice stays `sending` and reads `unknown`
    // after the TRACE-104 interval, which needs the operator's confirmation to resend.
    console.error("Price approval email not sent: invalid claim reference", { draftId });
    const attempt = typeof claim.attempt === "number" && Number.isInteger(claim.attempt) ? claim.attempt : 0;
    const { error: contractRecordError } = await serviceClient.rpc("pricing_record_draft_email", {
      p_draft: draftId,
      p_claim: claim.claim_id,
      p_outcome: "failed",
      p_provider_id: null,
      p_error: DRAFT_EMAIL_CLAIM_INVALID,
    });
    if (contractRecordError) {
      console.error("Price approval email outcome was not recorded", { draftId, outcome: "failed", code: contractRecordError.code });
      return { state: "unrecorded", attempt };
    }
    return { state: "failed", attempt };
  }
  // A valid key implies a valid tag set (same validation), so price-draft sends are always tagged.
  const tags = buildCorrelationTags("package_draft", claim.notice_id, claim.attempt);
  const result: NotificationResult = await send(
    {
      ...draftEmailMessage(claim.vendor_name, siteUrl),
      idempotencyKey,
      ...(tags ? { tags } : {}),
    },
    claim.recipient,
  );
  const state = outcomeState(result);
  const { error: recordError } = await serviceClient.rpc("pricing_record_draft_email", {
    p_draft: draftId,
    p_claim: claim.claim_id,
    p_outcome: state,
    p_provider_id: result.ok ? result.id : null,
    p_error: result.ok ? null : result.error,
  });
  if (recordError) {
    // No address in logs: the draft id is enough to find the record.
    console.error("Price approval email outcome was not recorded", { draftId, attempt: claim.attempt, outcome: state, code: recordError.code });
    return { state: "unrecorded", attempt: claim.attempt };
  }
  if (state !== "sent") console.error("Price approval email not confirmed", { draftId, attempt: claim.attempt, outcome: state });
  return { state, attempt: claim.attempt };
}
