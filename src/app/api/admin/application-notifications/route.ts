import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { deliverApplicationNotification } from "@/lib/applicationNotifications";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";
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
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const applicationId =
    typeof body?.applicationId === "string" ? body.applicationId.toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(applicationId)) {
    return NextResponse.json({ error: "Choose an application." }, { status: 400 });
  }
  const confirmUnknown = body?.confirmUnknown === true;

  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
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
      if (status) return NextResponse.json({ error: requestError.message }, { status });
      throw requestError;
    }

    const env = getServiceSupabaseEnvironment();
    const service = createServiceClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const outcome = await deliverApplicationNotification(service, applicationId, "resend");
    if (outcome.state === "not_claimed") {
      return NextResponse.json(
        { state: outcome.current, message: "Another resend is already in progress. Refresh to see its result." },
        { status: 409 },
      );
    }
    return NextResponse.json({ state: outcome.state, message: resultMessage[outcome.state] });
  } catch (error) {
    console.error("Vendor application notification resend failed", {
      applicationId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "The resend could not be completed. Refresh to see the current state." },
      { status: 500 },
    );
  }
}
