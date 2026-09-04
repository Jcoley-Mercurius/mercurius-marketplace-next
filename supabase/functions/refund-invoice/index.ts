import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { requireEdgeEnvironment } from "../_shared/env.ts";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
Deno.serve(async request => {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "UNAUTHORIZED" }, 401);
  if (Deno.env.get("MERCURIUS_MONEY_MODE") !== "test") return json({ error: "MONEY_NOT_ACTIVATED", message: "Refund execution is awaiting verification. No refund was initiated." }, 503);
  try {
    const key = requireEdgeEnvironment("STRIPE_SECRET_KEY");
    if (!key.startsWith("sk_test_")) return json({ error: "TEST_PROVIDER_REQUIRED" }, 503);
    const admin = createClient(requireEdgeEnvironment("SUPABASE_URL"), requireEdgeEnvironment("SUPABASE_SERVICE_ROLE_KEY"));
    const identity = await admin.auth.getUser(token);
    if (identity.error || !identity.data.user) return json({ error: "UNAUTHORIZED" }, 401);
    const body = await request.json();
    if (!body.authorization_id) return json({ error: "REVIEWED_REFUND_REQUIRED", message: "An exact, separately approved refund allocation is required." }, 409);
    const prepared = await admin.rpc("money_prepare_refund", { p_authorization: body.authorization_id, p_actor: identity.data.user.id });
    if (prepared.error || !prepared.data) return json({ error: "REFUND_REVIEW_REQUIRED" }, 409);
    const attempt = prepared.data;
    if (attempt.status === "succeeded") return json({ status: "succeeded", already_refunded: true });
    if (attempt.status !== "prepared") return json({ status: attempt.status, message: "Awaiting refund reconciliation; do not submit another refund." });
    const stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });
    const refund = await stripe.refunds.create({ payment_intent: attempt.payment_id, amount: Number(attempt.amount), metadata: { money_authorization_id: body.authorization_id } }, { idempotencyKey: attempt.idempotency_key });
    const recorded = await admin.rpc("money_record_refund_result", { p_authorization: body.authorization_id, p_reference: refund.id, p_status: refund.status ?? "pending", p_amount: refund.amount });
    if (recorded.error) throw new Error("REFUND_RESULT_RECONCILIATION_REQUIRED");
    return json({ status: "awaiting_webhook", refund_id: refund.id });
  } catch { return json({ error: "REFUND_RECONCILIATION_REQUIRED", message: "The refund outcome could not be confirmed. The durable attempt must be reconciled before a new refund." }, 503); }
});
