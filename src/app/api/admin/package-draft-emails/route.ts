import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { deliverDraftEmail } from "@/lib/draftEmailNotices";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const resultMessage: Record<string, string> = {
  sent: "Email sent to the contact on file. It is a notice only: the vendor still has to link their account and approve.",
  failed: "The email was refused. The vendor has not been told; resend it or contact them another way.",
  unknown: "The email result is unknown. Ask the vendor whether it arrived before resending.",
  unrecorded: "The email was attempted but its result was not saved. Ask the vendor whether it arrived.",
};

// DEC-2026-041 item 6: the operator's session checks the draft's email notice (and, for a
// resend, allows one more attempt); the service client then claims the attempt and sends.
// Nothing here approves, publishes or changes a price.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const draftId = typeof body?.draftId === "string" ? body.draftId.toLowerCase() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(draftId)) {
    return NextResponse.json({ error: "Choose a draft." }, { status: 400 });
  }
  const resend = body?.resend === true;
  const confirmUnknown = body?.confirmUnknown === true;

  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return NextResponse.json({ error: "Sign in to send price notices." }, { status: 401 });

    const { error: requestError } = await supabase.rpc("admin_request_draft_email", {
      p_draft: draftId, p_resend: resend, p_confirm_unknown: confirmUnknown,
    });
    if (requestError) {
      const status = requestError.code === "42501" ? 403 : requestError.code === "P0002" ? 404 : requestError.code === "55000" ? 409 : 0;
      if (status) return NextResponse.json({ error: requestError.message }, { status });
      throw requestError;
    }

    const env = getServiceSupabaseEnvironment();
    const service = createServiceClient(env.supabaseUrl, env.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const outcome = await deliverDraftEmail(service, draftId, resend ? "resend" : "initial");
    if (outcome.state === "not_claimed") {
      return NextResponse.json({ state: outcome.current, message: `No email was sent: the notice is ${outcome.current.replace("_", " ")}.` }, { status: 409 });
    }
    return NextResponse.json({ state: outcome.state, message: resultMessage[outcome.state] });
  } catch (error) {
    console.error("Price approval email failed", { draftId, message: error instanceof Error ? error.message : "Unknown error" });
    return NextResponse.json({ error: "The email could not be completed. Refresh to see its current state." }, { status: 500 });
  }
}
