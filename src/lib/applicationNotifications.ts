import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendOwnerNotification, type NotificationResult } from "@/lib/ownerNotifications";
import {
  createCorrelationId,
  elapsedSince,
  logOperationalEvent,
  type OperationalErrorCode,
  type OperationalOutcome,
  type OperationalRoute,
} from "@/lib/observability/operationalLog";

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

// TRACE-151: the route request this delivery belongs to. Correlation is transport metadata
// only; the claim ID and idempotency key stay out of logs.
export type DeliveryTrace = { correlationId: string; route: OperationalRoute };

/**
 * The provider result as an enumerated code. Reads only the status the shared sender
 * puts at the start of its error ("Resend returned NNN"); the provider body is not kept.
 */
export function providerErrorCode(result: NotificationResult): OperationalErrorCode | null {
  if (result.ok) return null;
  const status = /^Resend returned (\d{3})\b/.exec(result.error)?.[1];
  if (!status) return result.definite ? "provider_not_configured" : "provider_timeout_or_network";
  const code = Number(status);
  if (code === 429) return "provider_rate_limited";
  if (code === 409) return "provider_conflict";
  if (code >= 500) return "provider_server_error";
  return "provider_refused";
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
  trace: DeliveryTrace = { correlationId: createCorrelationId(), route: "unattributed" },
): Promise<DeliveryOutcome> {
  const context = { route: trace.route, correlationId: trace.correlationId, applicationId, mode };
  const { data, error } = await serviceClient.rpc("r0_claim_application_notification", {
    p_application: applicationId,
    p_mode: mode,
  });
  if (error) {
    logOperationalEvent({ ...context, event: "application_notification.claim_failed", outcome: "failed", error });
    throw error;
  }
  const claim = data as Claim;
  if (!claim.claimed) {
    logOperationalEvent({
      ...context,
      event: "application_notification.not_claimed",
      // An unexpected state string is dropped by the logger's runtime allowlist.
      outcome: claim.state as OperationalOutcome,
    });
    return { state: "not_claimed", current: claim.state };
  }
  const attempt = claim.attempt;
  logOperationalEvent({ ...context, attempt, event: "application_notification.claimed", outcome: "claimed" });

  const sendStarted = Date.now();
  const result = await send({
    ...applicationNotificationMessage(claim.application),
    idempotencyKey: applicationNotificationKey(applicationId, attempt),
  });
  const state = outcomeState(result);
  logOperationalEvent({
    ...context,
    attempt,
    event: "application_notification.provider_result",
    outcome: state,
    errorCode: providerErrorCode(result),
    durationMs: elapsedSince(sendStarted),
  });
  const { error: recordError } = await serviceClient.rpc("r0_record_application_notification", {
    p_application: applicationId,
    p_claim: claim.claim_id,
    p_outcome: state,
    p_provider_id: result.ok ? result.id : null,
    p_error: result.ok ? null : result.error,
  });
  if (recordError) {
    logOperationalEvent({
      ...context,
      attempt,
      event: "application_notification.record_failed",
      outcome: "unrecorded",
      error: recordError,
    });
    return { state: "unrecorded", attempt };
  }
  logOperationalEvent({ ...context, attempt, event: "application_notification.recorded", outcome: state });
  return { state, attempt };
}
