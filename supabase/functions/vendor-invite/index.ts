import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
// Shipping this adapter cannot send real mail: only an explicitly enabled local
// Supabase stack and loopback site may dispatch. Hosted rollout is a later gate.
function localDispatchEnabled(url: string, site: string) {
  try {
    const backend = new URL(url);
    const target = new URL(site);
    return (
      Deno.env.get("MERCURIUS_INVITATION_MODE") === "local-test" &&
      backend.protocol === "http:" &&
      ["127.0.0.1", "localhost", "kong"].includes(backend.hostname) &&
      target.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(target.hostname) &&
      !target.username &&
      !target.password &&
      target.pathname === "/" &&
      !target.search &&
      !target.hash
    );
  } catch {
    return false;
  }
}
Deno.serve(async (request) => {
  const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: corsHeaders });
  if (request.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const site = Deno.env.get("SITE_URL") ?? "";
  if (body.action === "send" && !localDispatchEnabled(url, site))
    return json({ error: "INVITATION_DELIVERY_DISABLED", emailed: false }, 503);
  try {
    const admin = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const identity = await admin.auth.getUser(token);
    if (identity.error || !identity.data.user)
      return json({ error: "Unauthorized" }, 401);
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // The authenticated recipient owns acceptance. Admin permission is not a substitute.
    if (body.action === "accept") {
      if (!uuid(body.attempt_id))
        return json({ error: "attempt_id required" }, 400);
      const result = await client.rpc("vendor_accept_invitation", {
        p_attempt: body.attempt_id,
      });
      return result.error
        ? json({ error: "INVITATION_NOT_ACCEPTABLE" }, 409)
        : json({ status: "accepted", activated: false });
    }
    const role = await admin.rpc("has_role", {
      _user_id: identity.data.user.id,
      _role: "admin",
    });
    if (role.error || !role.data) return json({ error: "Forbidden" }, 403);
    if (body.action === "prepare") {
      if (
        !uuid(body.contractor_id) ||
        typeof body.business_key !== "string" ||
        !body.business_key.trim() ||
        typeof body.expires_at !== "string" ||
        !Number.isFinite(Date.parse(body.expires_at))
      )
        return json({ error: "Preparation fields required" }, 400);
      const result = await client.rpc("vendor_prepare_invitation", {
        p_contractor: body.contractor_id,
        p_key: body.business_key,
        p_expires: body.expires_at,
      });
      if (result.error) return json({ error: "INVITATION_NOT_READY" }, 409);
      return json({
        attempt_id: result.data,
        status: "prepared",
        emailed: false,
      });
    }
    if (!["send", "status", "reconcile", "close"].includes(String(body.action)))
      return json(
        {
          error: "ONBOARDING_REVIEW_REQUIRED",
          message:
            "Use versioned invitation actions. Approval and invitation do not activate a provider.",
        },
        409,
      );
    if (!uuid(body.attempt_id))
      return json({ error: "attempt_id required" }, 400);
    const attempt = body.attempt_id;
    if (body.action === "close") {
      if (
        !["revoked", "expired"].includes(String(body.status)) ||
        typeof body.reason !== "string" ||
        !body.reason.trim()
      )
        return json({ error: "Closure status and reason required" }, 400);
      const result = await client.rpc("vendor_close_dispatched_invitation", {
        p_attempt: attempt,
        p_status: body.status,
        p_reason: body.reason,
      });
      return result.error
        ? json({ error: "INVITATION_NOT_CLOSABLE" }, 409)
        : json({ status: body.status });
    }
    if (body.action === "status") {
      const result = await client.rpc("vendor_invitation_status", {
        p_attempt: attempt,
      });
      return result.error
        ? json({ error: "INVITATION_UNAVAILABLE" }, 409)
        : json(result.data);
    }
    if (body.action === "reconcile") {
      if (!uuid(body.auth_user_id))
        return json({ error: "Verified Auth user ID required" }, 400);
      const readback = await admin.auth.admin.getUserById(body.auth_user_id);
      if (readback.error || !readback.data.user)
        return json({ error: "AUTH_READBACK_REQUIRED" }, 409);
      const result = await admin.rpc("vendor_finish_invitation", {
        p_attempt: attempt,
        p_auth_user: readback.data.user.id,
        p_actor: identity.data.user.id,
      });
      return result.error
        ? json({ error: "INVITATION_RECONCILIATION_REQUIRED" }, 409)
        : json({ status: "provider_accepted", delivered: false });
    }
    const claim = await client.rpc("vendor_claim_invitation", {
      p_attempt: attempt,
    });
    if (claim.error) return json({ error: "INVITATION_NOT_READY" }, 409);
    if (!claim.data?.claimed)
      return json(
        {
          status: claim.data?.status,
          dispatched: false,
          message:
            "Attempt already reserved; inspect its status before further action.",
        },
        409,
      );
    // Persist reservation before the non-idempotent Auth API. Never automatically
    // retry this call, even after a timeout or a failed receipt write.
    const markUnknown = async () => {
      try {
        await admin.rpc("vendor_finish_invitation", {
          p_attempt: attempt,
          p_auth_user: null,
          p_actor: identity.data.user.id,
        });
      } catch {
        /* durable reservation still prevents a resend */
      }
    };
    const redirect = new URL("/set-password", site);
    redirect.searchParams.set("invitation", attempt);
    try {
      const invited = await admin.auth.admin.inviteUserByEmail(
        claim.data.recipient_email,
        { redirectTo: redirect.toString() },
      );
      if (invited.error || !invited.data.user) {
        await markUnknown();
        return json(
          { error: "INVITATION_RECONCILIATION_REQUIRED", status: "unknown" },
          409,
        );
      }
      const receipt = await admin.rpc("vendor_finish_invitation", {
        p_attempt: attempt,
        p_auth_user: invited.data.user.id,
        p_actor: identity.data.user.id,
      });
      if (receipt.error) {
        await markUnknown();
        return json(
          { error: "INVITATION_RECONCILIATION_REQUIRED", status: "unknown" },
          409,
        );
      }
      return json({
        attempt_id: attempt,
        status: "provider_accepted",
        delivered: false,
        activated: false,
      });
    } catch {
      await markUnknown();
      return json(
        { error: "INVITATION_RECONCILIATION_REQUIRED", status: "unknown" },
        409,
      );
    }
  } catch {
    return json({ error: "ONBOARDING_UNAVAILABLE" }, 503);
  }
});
