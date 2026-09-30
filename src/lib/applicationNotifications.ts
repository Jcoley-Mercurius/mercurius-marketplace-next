import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendOwnerNotification, type NotificationResult } from "@/lib/ownerNotifications";

// TRACE-104: the owner email for a saved vendor application. The database hands one
// sender a claim and the saved application; the outcome is recorded against that claim.
// A lost process leaves the record claimed, which operators read as unknown.

export type ApplicationNotificationMode = "initial" | "resend";

export type ClaimedApplication = {
  id: string;
  created_at: string;
  business_name: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string;
  primary_category: string | null;
  services: string[];
  service_areas: string | null;
};

type Claim =
  | { claimed: true; claim_id: string; attempt: number; application: ClaimedApplication }
  | { claimed: false; state: string };

export type DeliveryOutcome =
  | { state: "sent" | "failed" | "unknown"; attempt: number }
  | { state: "not_claimed"; current: string }
  | { state: "unrecorded"; attempt: number };

export function applicationNotificationMessage(application: ClaimedApplication) {
  const businessSummary = application.business_name.replace(/\s+/g, " ").slice(0, 100);
  return {
    subject: `New vendor application — ${businessSummary}`,
    replyTo: application.email,
    text: [
      "New Mercurius vendor application",
      "",
      `Submitted: ${application.created_at}`,
      `Business: ${application.business_name}`,
      `Contact: ${`${application.first_name} ${application.last_name ?? ""}`.trim()}`,
      `Email: ${application.email}`,
      `Phone: ${application.phone}`,
      `Primary category: ${application.primary_category ?? "Not provided"}`,
      `Services: ${application.services.join(", ") || "Not provided"}`,
      `Service areas: ${application.service_areas ?? "Not provided"}`,
      "",
      "Review it in the Mercurius admin: Vendor Applications.",
    ].join("\n"),
  };
}

export function applicationNotificationKey(applicationId: string, attempt: number) {
  return `vendor-application-notification:${applicationId}:${attempt}`;
}

export function outcomeState(result: NotificationResult): "sent" | "failed" | "unknown" {
  if (result.ok) return "sent";
  return result.definite ? "failed" : "unknown";
}

export async function deliverApplicationNotification(
  serviceClient: SupabaseClient,
  applicationId: string,
  mode: ApplicationNotificationMode,
  send: typeof sendOwnerNotification = sendOwnerNotification,
): Promise<DeliveryOutcome> {
  const { data, error } = await serviceClient.rpc("r0_claim_application_notification", {
    p_application: applicationId,
    p_mode: mode,
  });
  if (error) throw error;
  const claim = data as Claim;
  if (!claim.claimed) return { state: "not_claimed", current: claim.state };

  const result = await send({
    ...applicationNotificationMessage(claim.application),
    idempotencyKey: applicationNotificationKey(applicationId, claim.attempt),
  });
  const state = outcomeState(result);
  const { error: recordError } = await serviceClient.rpc("r0_record_application_notification", {
    p_application: applicationId,
    p_claim: claim.claim_id,
    p_outcome: state,
    p_provider_id: result.ok ? result.id : null,
    p_error: result.ok ? null : result.error,
  });
  if (recordError) {
    console.error("Vendor application notification outcome was not recorded", {
      applicationId,
      attempt: claim.attempt,
      outcome: state,
      code: recordError.code,
    });
    return { state: "unrecorded", attempt: claim.attempt };
  }
  if (state !== "sent") {
    console.error("Vendor application owner notification not confirmed", {
      applicationId,
      attempt: claim.attempt,
      outcome: state,
    });
  }
  return { state, attempt: claim.attempt };
}
