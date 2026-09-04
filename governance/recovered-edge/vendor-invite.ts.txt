import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Supabase invite/recovery links expire after 24h by default
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // ---- Authorization: caller must be a signed-in admin ----
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) {
    console.warn("vendor-invite: invalid token", { ip: req.headers.get("x-forwarded-for") });
    return json({ error: "Unauthorized" }, 401);
  }
  const callerId = userData.user.id;
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: callerId, _role: "admin" });
  if (!isAdmin) {
    console.warn("vendor-invite: non-admin attempt", { callerId, ip: req.headers.get("x-forwarded-for") });
    return json({ error: "Forbidden" }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* noop */ }
  const action = String(body.action ?? "");
  const applicationId = body.application_id ? String(body.application_id) : null;
  const origin = typeof body.origin === "string" && body.origin.startsWith("http")
    ? body.origin.replace(/\/$/, "")
    : null;
  const redirectTo = `${origin ?? SUPABASE_URL}/set-password`;

  const findUserByEmail = async (email: string) => {
    // paginate a bounded number of pages looking for an exact email match
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw error;
      const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
      if (hit) return hit;
      if (data.users.length < 200) break;
    }
    return null;
  };

  /** Creates/links the auth account, grants the vendor role, links the contractor record. */
  const provision = async (app: any, contractorId: string) => {
    const email = String(app.email).trim().toLowerCase();
    let user = await findUserByEmail(email);
    let status: string;
    let expires: string | null = null;

    if (!user) {
      // Brand-new vendor → invite email, they set their own password
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { full_name: `${app.first_name} ${app.last_name}`, business_name: app.business_name },
      });
      if (error) throw error;
      user = data.user;
      status = "invite_sent";
      expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    } else if (!user.last_sign_in_at && !user.email_confirmed_at) {
      // Previously invited but never accepted → re-invite
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
      if (error) throw error;
      user = data.user ?? user;
      status = "invite_sent";
      expires = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    } else {
      // Existing account (e.g. signed up as a homeowner first): keep it, add vendor access,
      // and email them a link so they can set/refresh a password if they want one.
      const pub = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
      await pub.auth.resetPasswordForEmail(email, { redirectTo });
      status = "account_active";
    }

    // Vendor role (additive — an existing homeowner keeps their homeowner role)
    await admin.from("user_roles").upsert(
      { user_id: user!.id, role: "vendor" },
      { onConflict: "user_id,role", ignoreDuplicates: true },
    );

    // Link the business record to the auth account
    const { error: linkErr } = await admin
      .from("contractors")
      .update({ user_id: user!.id, updated_at: new Date().toISOString() })
      .eq("id", contractorId);
    if (linkErr) throw linkErr;

    return {
      user_id: user!.id,
      invite_status: status,
      invited_at: new Date().toISOString(),
      invite_expires_at: expires,
      activated_at: status === "account_active" ? new Date().toISOString() : null,
    };
  };

  try {
    if (action === "approve" || action === "resend") {
      if (!applicationId) return json({ error: "application_id required" }, 400);

      const { data: app, error: appErr } = await admin
        .from("vendor_applications").select("*").eq("id", applicationId).maybeSingle();
      if (appErr) throw appErr;
      if (!app) return json({ error: "Application not found" }, 404);
      if (action === "resend" && app.status !== "approved") {
        return json({ error: "Application is not approved yet" }, 400);
      }

      // Reuse the contractor record if this application already created one
      let contractorId: string | null = app.contractor_id;
      if (!contractorId) {
        const { data: existing } = await admin
          .from("contractors").select("id").ilike("email", app.email).maybeSingle();
        contractorId = existing?.id ?? null;
      }
      if (!contractorId) {
        const { data: created, error: cErr } = await admin.from("contractors").insert({
          name: app.business_name,
          email: app.email,
          phone: app.phone,
          location: app.address,
          services: app.services,
          years_experience: app.years_experience,
          bio: app.service_areas ? `Service areas: ${app.service_areas}` : null,
          is_active: true,
          marketing_enabled: false,
        }).select("id").single();
        if (cErr) throw cErr;
        contractorId = created.id;
      }

      let result;
      try {
        result = await provision(app, contractorId!);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("vendor-invite: provisioning failed", { applicationId, msg });
        await admin.from("vendor_applications").update({
          status: "approved",
          contractor_id: contractorId,
          invite_status: "failed",
          invite_error: msg,
        }).eq("id", applicationId);
        return json({ error: `Account provisioning failed: ${msg}`, contractor_id: contractorId }, 500);
      }

      const { error: updErr } = await admin.from("vendor_applications").update({
        status: "approved",
        contractor_id: contractorId,
        invited_user_id: result.user_id,
        invite_status: result.invite_status,
        invited_at: result.invited_at,
        invite_expires_at: result.invite_expires_at,
        activated_at: result.activated_at,
        invite_error: null,
      }).eq("id", applicationId);
      if (updErr) throw updErr;

      return json({ ok: true, contractor_id: contractorId, ...result });
    }

    if (action === "sync") {
      // Refresh pipeline state: detect accepted invites and expired ones
      const { data: apps, error } = await admin
        .from("vendor_applications")
        .select("id, invited_user_id, invite_status, invite_expires_at")
        .eq("status", "approved")
        .not("invited_user_id", "is", null);
      if (error) throw error;

      const updates: Record<string, string>[] = [];
      for (const a of apps ?? []) {
        if (a.invite_status === "account_active") continue;
        const { data: u } = await admin.auth.admin.getUserById(a.invited_user_id!);
        const acc = u?.user;
        if (acc && (acc.last_sign_in_at || acc.email_confirmed_at)) {
          await admin.from("vendor_applications").update({
            invite_status: "account_active",
            activated_at: acc.last_sign_in_at ?? acc.email_confirmed_at,
          }).eq("id", a.id);
          updates.push({ id: a.id, invite_status: "account_active" });
        } else if (a.invite_expires_at && new Date(a.invite_expires_at) < new Date()) {
          if (a.invite_status !== "invite_expired") {
            await admin.from("vendor_applications")
              .update({ invite_status: "invite_expired" }).eq("id", a.id);
            updates.push({ id: a.id, invite_status: "invite_expired" });
          }
        }
      }
      return json({ ok: true, updated: updates });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("vendor-invite error", msg);
    return json({ error: msg }, 500);
  }
});
