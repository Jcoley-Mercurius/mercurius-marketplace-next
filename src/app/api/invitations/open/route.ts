import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";
import {
  INVITATION_LINK_INVALID_MESSAGE,
  invitationSetPasswordPath,
  parseInvitationOpenRequest,
} from "@/lib/invitationOpenLink";

export const runtime = "nodejs";

function serviceClient() {
  const env = getServiceSupabaseEnvironment();
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// DEC-2026-029 follow-up: a provider used the link in their invitation email. The database
// checks the key against a live attempt and records the open; Auth then mints a single-use
// sign-in for that attempt's recipient (generateLink sends no email). Only POST spends
// anything, so a mail scanner that fetches the page cannot.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const open =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? parseInvitationOpenRequest(body as Record<string, unknown>)
      : null;
  if (!open) {
    return NextResponse.json({ error: INVITATION_LINK_INVALID_MESSAGE }, { status: 410 });
  }

  try {
    const supabase = serviceClient();
    const { data, error } = await supabase.rpc("provider_invitation_open", {
      p_source: open.source,
      p_attempt: open.attempt,
      p_key_hash: createHash("sha256").update(open.key).digest("hex"),
    });
    if (error) {
      // A refusal (wrong key, closed, accepted, expired or over the hourly limit) raises
      // P0001; anything else is an outage. The key itself is never logged.
      if (error.code === "P0001") {
        console.warn("Invitation link refused", { attempt: open.attempt, detail: error.details ?? null });
        return NextResponse.json({ error: INVITATION_LINK_INVALID_MESSAGE }, { status: 410 });
      }
      throw error;
    }
    const email = (data as { email?: unknown } | null)?.email;
    if (typeof email !== "string" || !email) throw new Error("Invitation open returned no recipient");

    const link = await supabase.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link.data?.properties?.hashed_token;
    if (link.error || !tokenHash) throw link.error ?? new Error("Auth returned no sign-in link");

    return NextResponse.json(
      { redirect: invitationSetPasswordPath(open, tokenHash) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Invitation link could not be opened", {
      attempt: open.attempt,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { error: "We couldn't open your invitation just now. Please try again in a few minutes." },
      { status: 503 },
    );
  }
}
