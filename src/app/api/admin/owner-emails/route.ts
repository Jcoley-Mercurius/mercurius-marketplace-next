import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";
import { deliverOwnerEmail } from "@/lib/ownerEmailNotifications";
import {
  createCorrelationId,
  elapsedSince,
  logOperationalEvent,
  type OperationalOutcome,
} from "@/lib/observability/operationalLog";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// TRACE-154 (Phase 7.2C-1): an operator resends the owner email for a saved, tracked contact
// submission. The operator's session asks the database to allow one more attempt (admin
// only; a missed or unknown email needs the operator's attestation that they checked the
// owner inbox and the Resend log and found no matching email). The service client then
// claims that attempt and sends. Nothing here creates a submission, and nothing is retried.
const ROUTE = "owner_email_resend" as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const resultMessage: Record<string, string> = {
  sent: "Resend accepted the email. Confirm it arrived in the owner inbox.",
  failed: "Resend refused the email. The submission is still saved.",
  unknown: "The email result is unknown. Check the owner inbox and the Resend log before trying again.",
  unrecorded: "The email was attempted but its result was not saved. Check the owner inbox and the Resend log.",
};

const refusedOutcome: Record<number, OperationalOutcome> = {
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
};

export async function POST(request: Request) {
  const correlationId = createCorrelationId();
  const startedAt = Date.now();
  const trace = { route: ROUTE, correlationId } as const;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId.toLowerCase() : "";
  if (body?.kind !== "contact_submission" || !UUID.test(sourceId)) {
    // The rejected input is not logged.
    logOperationalEvent({
      ...trace,
      event: "owner_email_resend.refused",
      outcome: "invalid",
      errorCode: "validation_failed",
      durationMs: elapsedSince(startedAt),
    });
    return NextResponse.json({ error: "Choose a contact submission." }, { status: 400 });
  }
  const kind = "contact_submission" as const;
  const confirmNoEmail = body?.confirmNoEmail === true;
  const context = { ...trace, sourceKind: kind, sourceId, mode: "resend" as const };

  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      logOperationalEvent({
        ...context,
        event: "owner_email_resend.refused",
        outcome: refusedOutcome[401],
        durationMs: elapsedSince(startedAt),
      });
      return NextResponse.json({ error: "Sign in to manage owner emails." }, { status: 401 });
    }

    const { error: requestError } = await supabase.rpc("owner_email_request_resend", {
      p_kind: kind,
      p_source: sourceId,
      p_confirm_no_email: confirmNoEmail,
    });
    if (requestError) {
      const status =
        requestError.code === "42501" ? 403
          : requestError.code === "P0002" ? 404
            : requestError.code === "55000" ? 409
              : 0;
      if (status) {
        logOperationalEvent({
          ...context,
          event: "owner_email_resend.refused",
          outcome: refusedOutcome[status],
          error: requestError,
          durationMs: elapsedSince(startedAt),
        });
        return NextResponse.json({ error: requestError.message }, { status });
      }
      throw requestError;
    }
    logOperationalEvent({ ...context, event: "owner_email_resend.requested", outcome: "resend_requested" });

    const env = getServiceSupabaseEnvironment();
    const service = createServiceClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const outcome = await deliverOwnerEmail(service, kind, sourceId, "resend", undefined, trace);
    if (outcome.state === "not_claimed") {
      logOperationalEvent({
        ...context,
        event: "owner_email_resend.completed",
        outcome: "conflict",
        durationMs: elapsedSince(startedAt),
      });
      return NextResponse.json(
        { state: outcome.current, message: "Another resend is already in progress. Refresh to see its result." },
        { status: 409 },
      );
    }
    if (outcome.state === "claim_failed") {
      // The resend was allowed, but its claim result never arrived. It may or may not have
      // committed, so nothing was sent and nothing is assumed: the page reloads the ledger.
      logOperationalEvent({
        ...context,
        event: "owner_email_resend.failed",
        outcome: "failed",
        errorCode: "db_error",
        durationMs: elapsedSince(startedAt),
      });
      return NextResponse.json(
        {
          error:
            "The resend was allowed, but the database did not confirm the send attempt. Nothing was sent from this request. Refresh to see the current state before acting again.",
        },
        { status: 500 },
      );
    }
    logOperationalEvent({
      ...context,
      attempt: outcome.attempt,
      event: "owner_email_resend.completed",
      outcome: outcome.state,
      durationMs: elapsedSince(startedAt),
    });
    return NextResponse.json({ state: outcome.state, message: resultMessage[outcome.state] });
  } catch (error) {
    logOperationalEvent({
      ...context,
      event: "owner_email_resend.failed",
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
