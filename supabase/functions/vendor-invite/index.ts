import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
Deno.serve(async request => {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const identity = await admin.auth.getUser(token);
    if (identity.error || !identity.data.user) return json({ error: "Unauthorized" }, 401);
    const role = await admin.rpc("has_role", { _user_id: identity.data.user.id, _role: "admin" });
    if (role.error || !role.data) return json({ error: "Forbidden" }, 403);
    const body = await request.json();
    if (body.action !== "prepare") return json({ error: "ONBOARDING_REVIEW_REQUIRED", message: "Use the versioned onboarding review. Approval and invitation do not activate a provider. No email was sent." }, 409);
    const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const result = await client.rpc("vendor_prepare_invitation", { p_contractor: body.contractor_id, p_key: body.business_key, p_expires: body.expires_at });
    if (result.error) return json({ error: "INVITATION_NOT_READY" }, 409);
    return json({ attempt_id: result.data, status: "prepared", emailed: false });
  } catch { return json({ error: "ONBOARDING_UNAVAILABLE" }, 503); }
});
