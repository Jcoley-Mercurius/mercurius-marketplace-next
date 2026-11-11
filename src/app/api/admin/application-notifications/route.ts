import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { deliverApplicationNotification } from "@/lib/applicationNotifications";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";
import {
  createCorrelationId,
  elapsedSince,
  logOperationalEvent,
  type OperationalOutcome,
} from "@/lib/observability/operationalLog";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const resultMessage: Record<string, string> = {
  sent: "Resend accepted the notification. Confirm it arrived in the owner inbox.",
  failed: "Resend refused the notification. The application is still in the queue.",
  unknown: "The notification result is unknown. Check the owner inbox before trying again.",
  unrecorded: "The notification was attempted but its result was not saved. Check the owner inbox.",
};

// TRACE-104: an operator resends the owner email for a saved vendor application. The
// operator's session asks the database to allow one more attempt (admin only, with an
// explicit confirmation when an earlier email may have arrived); the service client then
// claims that attempt and sends. Nothing here creates an application, account or grant.
const ROUTE = "application_notification_resend" as const;

const refusedOutcome: Record<number, OperationalOutcome> = {
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
};

// TRACE-151: each operator request has its own server-generated correlation ID; it joins
// the original submission through the application ID, never through a client value.
export async function POST(request: Request) {
  const correlationId = createCorrelationId();
  const startedAt = Date.now();
  const trace = { route: ROUTE, correlationId } as const;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const applicationId =
    typeof body?.applicationId === "string" ? body.applicationId.toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(applicationId)) {
    // The rejected input is not logged.
    logOperationalEvent({
      ...trace,
      event: "application_notification_resend.refused",
      outcome: "invalid",
      errorCode: "validation_failed",
      durationMs: elapsedSince(startedAt),
    });
    return NextResponse.json({ error: "Choose an application." }, { status: 400 });
  }
  const confirmUnknown = body?.confirmUnknown === true;
  const context = { ...trace, applicationId, mode: "resend" as const };

  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      logOperationalEvent({
        ...context,
        event: "application_notification_resend.refused",
        outcome: refusedOutcome[401],
        durationMs: elapsedSince(startedAt),
      });
      return NextResponse.json({ error: "Sign in to manage notifications." }, { status: 401 });
    }

    const { error: requestError } = await supabase.rpc(
      "r0_request_application_notification_resend",
      { p_application: applicationId, p_confirm_unknown: confirmUnknown },
    );
    if (requestError) {
      const status =
        requestError.code === "42501" ? 403
          : requestError.code === "P0002" ? 404
            : requestError.code === "55000" ? 409
              : 0;
      if (status) {
        logOperationalEvent({
          ...context,
          event: "application_notification_resend.refused",
          outcome: refusedOutcome[status],
          error: requestError,
          durationMs: elapsedSince(startedAt),
        });
        return NextResponse.json({ error: requestError.message }, { status });
      }
      throw requestError;
    }
    logOperationalEvent({
      ...context,
      event: "application_notification_resend.requested",
      outcome: "resend_requested",
    });

    const env = getServiceSupabaseEnvironment();
    const service = createServiceClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const outcome = await deliverApplicationNotification(service, applicationId, "resend", undefined, trace);
    if (outcome.state === "not_claimed") {
      logOperationalEvent({
        ...context,
        event: "application_notification_resend.completed",
        outcome: "conflict",
        durationMs: elapsedSince(startedAt),
      });
      return NextResponse.json(
        { state: outcome.current, message: "Another resend is already in progress. Refresh to see its result." },
        { status: 409 },
      );
    }
    logOperationalEvent({
      ...context,
      attempt: outcome.attempt,
      event: "application_notification_resend.completed",
      outcome: outcome.state,
      durationMs: elapsedSince(startedAt),
    });
    return NextResponse.json({ state: outcome.state, message: resultMessage[outcome.state] });
  } catch (error) {
    logOperationalEvent({
      ...context,
      event: "application_notification_resend.failed",
      outcome: "failed",
      error,
      durationMs: elapsedSince(startedAt),
    });
    return NextResponse.json(
      { error: "The resend could not be completed. Refresh to see the current state." },
      { status: 500 },
    );
  }
}
