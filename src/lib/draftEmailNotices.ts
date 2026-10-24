import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowserEnvironment } from "@/lib/env/browser";
import { outcomeState } from "@/lib/applicationNotifications";
import { sendNotificationEmail, type NotificationResult } from "@/lib/ownerNotifications";

// DEC-2026-041 item 6: when no vendor account is bound to a provider, a price sent for
// approval is announced to the contact email on file. Same claim/record pattern as the
// TRACE-104 owner email. The notice is not approval: it names no price, says approval needs
// the linked vendor account, and has no reply-to, so a reply cannot approve anything.
// DEC-2026-046: approval is optional, so the email says Mercurius may publish without it.

export type DraftEmailMode = "initial" | "resend";

type Claim =
  | { claimed: true; claim_id: string; attempt: number; recipient: string; vendor_name: string }
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

export function draftEmailKey(draftId: string, attempt: number) {
  return `package-draft-email:${draftId}:${attempt}`;
}

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
  const result: NotificationResult = await send(
    { ...draftEmailMessage(claim.vendor_name, siteUrl), idempotencyKey: draftEmailKey(draftId, claim.attempt) },
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
