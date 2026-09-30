import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { invitationDeliverySite } from "./delivery.ts";

const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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
  // TRACE-105: an existing provider with no application reaches its profile through an
  // owner-confirmed contact. Same transport and protections, separate evidence tables.
  if (body.source !== undefined && body.source !== "existing_provider")
    return json({ error: "Invalid request" }, 400);
  const existing = body.source === "existing_provider";
  const rpc = existing
    ? {
        prepare: "r0_prepare_provider_access",
        claim: "r0_claim_provider_access",
        finish: "r0_finish_provider_access",
        refuse: "r0_refuse_provider_access",
        accept: "r0_accept_provider_access",
        close: "r0_close_provider_access",
        status: "r0_provider_access_status",
      }
    : {
        prepare: "vendor_prepare_invitation",
        claim: "vendor_claim_invitation",
        finish: "vendor_finish_invitation",
        refuse: "vendor_refuse_invitation",
        accept: "vendor_accept_invitation",
        close: "vendor_close_dispatched_invitation",
        status: "vendor_invitation_status",
      };
  // Dispatch is off unless an explicit, pinned delivery mode matches this environment.
  const site = invitationDeliverySite((name) => Deno.env.get(name));
  if (body.action === "send" && !site)
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
      const result = await client.rpc(rpc.accept, {
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
      if (existing) {
        // An existing confirmed account is named by exact ID, never looked up by address.
        if (body.existing_account_id !== undefined && !uuid(body.existing_account_id))
          return json({ error: "Preparation fields required" }, 400);
        const result = await client.rpc(rpc.prepare, {
          p_contractor: body.contractor_id,
          p_key: body.business_key,
          p_expires: body.expires_at,
          p_existing_account: body.existing_account_id ?? null,
        });
        if (result.error) return json({ error: "INVITATION_NOT_READY" }, 409);
        return json({
          attempt_id: result.data?.attempt_id,
          mode: result.data?.mode,
          status: result.data?.status,
          emailed: false,
        });
      }
      const result = await client.rpc(rpc.prepare, {
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
    if (
      !["send", "status", "reconcile", "refuse", "close"].includes(
        String(body.action),
      )
    )
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
      const result = await client.rpc(rpc.close, {
        p_attempt: attempt,
        p_status: body.status,
        p_reason: body.reason,
      });
      return result.error
        ? json({ error: "INVITATION_NOT_CLOSABLE" }, 409)
        : json({ status: body.status });
    }
    if (body.action === "status") {
      const result = await client.rpc(rpc.status, {
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
      const result = await admin.rpc(rpc.finish, {
        p_attempt: attempt,
        p_auth_user: readback.data.user.id,
        p_actor: identity.data.user.id,
      });
      return result.error
        ? json({ error: "INVITATION_RECONCILIATION_REQUIRED" }, 409)
        : json({ status: "provider_accepted", delivered: false });
    }
    // An unknown outcome whose recipient already held a confirmed account before the
    // dispatch: the database proves Auth must have refused it. Read by exact ID only.
    if (body.action === "refuse") {
      if (!uuid(body.auth_user_id))
        return json({ error: "Verified Auth user ID required" }, 400);
      const readback = await admin.auth.admin.getUserById(body.auth_user_id);
      if (readback.error || !readback.data.user)
        return json({ error: "AUTH_READBACK_REQUIRED" }, 409);
      const result = await admin.rpc(rpc.refuse, {
        p_attempt: attempt,
        p_code: "email_exists",
        p_actor: identity.data.user.id,
        p_existing_account: readback.data.user.id,
      });
      return result.error
        ? json({ error: "INVITATION_REFUSAL_NOT_PROVEN" }, 409)
        : json({ status: "failed", refusal: "email_exists", dispatched: false });
    }
    if (!site)
      return json({ error: "INVITATION_DELIVERY_DISABLED", emailed: false }, 503);
    const claim = await client.rpc(rpc.claim, {
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
        await admin.rpc(rpc.finish, {
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
      // `invitation_attempt` is read only while Auth renders the reviewed email
      // template, which builds the recipient's link from the project's Site URL. It
      // is not an authorization input: acceptance re-verifies the attempt server-side.
      const invited = await admin.auth.admin.inviteUserByEmail(
        claim.data.recipient_email,
        {
          redirectTo: redirect.toString(),
          // The reviewed template chooses its wording by kind; the business name
          // tells the owner which existing profile the access is for.
          data: existing
            ? {
                invitation_attempt: attempt,
                invitation_kind: "existing_provider",
                business_name: String(claim.data.business_name ?? ""),
              }
            : { invitation_attempt: attempt },
        },
      );
      // Auth's structured refusal of an address that already holds a confirmed
      // account is definite: no user was created and nothing was sent. Every other
      // error, including a lost response, stays unknown.
      if (
        invited.error?.status === 422 &&
        invited.error.code === "email_exists"
      ) {
        const refusal = await admin.rpc(rpc.refuse, {
          p_attempt: attempt,
          p_code: "email_exists",
          p_actor: identity.data.user.id,
        });
        if (refusal.error) {
          await markUnknown();
          return json(
            { error: "INVITATION_RECONCILIATION_REQUIRED", status: "unknown" },
            409,
          );
        }
        return json(
          {
            error: "INVITATION_RECIPIENT_HAS_ACCOUNT",
            status: "failed",
            dispatched: false,
          },
          409,
        );
      }
      if (invited.error || !invited.data.user) {
        await markUnknown();
        return json(
          { error: "INVITATION_RECONCILIATION_REQUIRED", status: "unknown" },
          409,
        );
      }
      const receipt = await admin.rpc(rpc.finish, {
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
