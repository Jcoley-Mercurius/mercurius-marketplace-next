import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { checkout, type CheckoutAttempt } from "./money.ts";
import { requireEdgeEnvironment } from "./env.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function moneyCheckoutHandler(request: Request): Promise<Response> {
  const configured = Deno.env.get("SITE_URL") ?? "http://localhost:3000";
  const origin = new URL(configured).origin;
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (request.headers.has("origin") && request.headers.get("origin") !== origin) return json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const authorization = request.headers.get("authorization");
  if (!authorization) return json({ error: "UNAUTHORIZED" }, 401);
  // This task authorizes no real-money activation. Test mode also requires an explicit future environment opt-in.
  if (Deno.env.get("MERCURIUS_MONEY_MODE") !== "test") return json({ error: "MONEY_NOT_ACTIVATED", message: "Online payment is awaiting verification. No payment was collected. Contact Mercurius for next steps." }, 503);
  try {
    const key = requireEdgeEnvironment("STRIPE_SECRET_KEY");
    if (!key.startsWith("sk_test_")) return json({ error: "TEST_PROVIDER_REQUIRED" }, 503);
    const url = requireEdgeEnvironment("SUPABASE_URL");
    const userClient = createClient(url, requireEdgeEnvironment("SUPABASE_ANON_KEY"), { global: { headers: { Authorization: authorization } } });
    const { data: identity, error: identityError } = await userClient.auth.getUser();
    if (identityError || !identity.user) return json({ error: "UNAUTHORIZED" }, 401);
    const body = await request.json();
    const mode = body.mode ?? "full";
    if (!["full", "deposit", "balance"].includes(mode)) return json({ error: "INVALID_MODE" }, 400);
    let snapshotId = body.snapshot_id;
    if (!snapshotId) {
      let requestId = body.request_id;
      if (body.invoice_id && uuid.test(body.invoice_id)) {
        const result = await userClient.from("invoices").select("service_request_id").eq("id", body.invoice_id).single();
        if (result.error) return json({ error: "INVOICE_NOT_AVAILABLE" }, 404);
        requestId = result.data.service_request_id;
      }
      if (!uuid.test(requestId ?? "")) return json({ error: "REQUEST_REQUIRED" }, 400);
      const obligation = await userClient.from("money_obligations").select("current_snapshot_id").eq("service_request_id", requestId).single();
      if (obligation.error || !obligation.data.current_snapshot_id) return json({ error: "COMMERCIAL_REVIEW_REQUIRED", message: "Mercurius must verify the complete price and policy breakdown before payment." }, 409);
      snapshotId = obligation.data.current_snapshot_id;
      return json({ review_url: `${origin}/checkout/${snapshotId}?mode=${mode}` });
    }
    if (!uuid.test(snapshotId)) return json({ error: "INVALID_SNAPSHOT" }, 400);
    const admin = createClient(url, requireEdgeEnvironment("SUPABASE_SERVICE_ROLE_KEY"));
    const stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });
    const session = await checkout({
      prepare: async () => {
        const { data, error } = await userClient.rpc("money_prepare_checkout", { p_snapshot: snapshotId, p_mode: mode });
        if (error || !data) throw new Error("COMMERCIAL_REVIEW_REQUIRED");
        return { id: data.id, snapshotId: data.snapshot_id, amount: Number(data.amount), currency: data.currency, idempotencyKey: data.stripe_idempotency_key, createdAt: data.created_at, expiresAt: data.expires_at, status: data.status, sessionId: data.stripe_session_id, url: data.checkout_url } as CheckoutAttempt;
      },
      attach: async (attempt, id, checkoutUrl) => {
        const { error } = await admin.rpc("money_attach_checkout", { p_attempt: attempt, p_session: id, p_url: checkoutUrl });
        if (error) throw new Error("CHECKOUT_ATTACHMENT_PENDING");
      },
      flag: async (attempt, code) => {
        const { error } = await admin.rpc("money_flag_checkout", { p_attempt: attempt, p_code: code });
        if (error) throw new Error("RECONCILIATION_WRITE_FAILED");
      },
    }, {
      create: async input => {
        const created = await stripe.checkout.sessions.create({
          mode: "payment", payment_method_types: ["card"],
          expires_at: Math.floor(Date.parse(input.expiresAt) / 1000),
          client_reference_id: input.attemptId,
          metadata: { money_attempt_id: input.attemptId },
          payment_intent_data: { metadata: { money_attempt_id: input.attemptId } },
          line_items: [{ price_data: { currency: input.currency, unit_amount: input.amount, product_data: { name: "Mercurius service payment" } }, quantity: 1 }],
          success_url: `${origin}/checkout/${snapshotId}?mode=${mode}&submitted=1`,
          cancel_url: `${origin}/checkout/${snapshotId}?mode=${mode}`,
        }, { idempotencyKey: input.idempotencyKey });
        if (!created.url) throw new Error("CHECKOUT_URL_MISSING");
        return { id: created.id, url: created.url };
      },
    }, identity.user.id, snapshotId, mode, new Date());
    return json({ url: session.url });
  } catch {
    return json({ error: "CHECKOUT_NOT_READY", message: "Payment could not be started. Review the current terms or contact Mercurius; retries preserve the same checkout attempt." }, 409);
  }
}
