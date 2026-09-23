import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { requireEdgeEnvironment } from "../_shared/env.ts";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
// TRACE-076: the actor is always the user Auth verifies from the bearer token, never a body field.
// "send" submits a separately approved refund; "readback" reads that refund back from Stripe
// and records what Stripe shows. Neither marks a refund settled: only Stripe's refund event does.
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
    const actor = identity.data.user.id;
    const body = await request.json().catch(() => null);
    const action = body?.action ?? "send";
    if (action !== "send" && action !== "readback") return json({ error: "INVALID_REQUEST" }, 400);
    if (!body?.authorization_id || (action === "readback" && !uuid(body.authorization_id))) return json({ error: "REVIEWED_REFUND_REQUIRED", message: "An exact, separately approved refund allocation is required." }, 409);
    const stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });
    if (action === "readback") {
      const target = await admin.rpc("money_refund_readback_target", { p_authorization: body.authorization_id, p_actor: actor });
      if (target.error?.code === "42501") return json({ error: "FINANCE_AUTHORITY_REQUIRED" }, 403);
      if (target.error || !target.data) return json({ error: "REFUND_REVIEW_REQUIRED" }, 409);
      const current = target.data as { payment_id: string; attempt_status: string; provider_reference: string | null; failed_references?: string[] };
      // TRACE-082: a refund that an earlier send created and Stripe failed is not the current send's refund.
      const earlier = new Set(current.failed_references ?? []);
      if (current.attempt_status === "not_started") return json({ error: "REFUND_NOT_SENT", message: "This refund has not been sent to Stripe, so there is nothing to read back." }, 409);
      let refund: Stripe.Refund | undefined;
      if (current.provider_reference) {
        refund = await stripe.refunds.retrieve(current.provider_reference);
      } else {
        const listed = await stripe.refunds.list({ payment_intent: current.payment_id, limit: 100 });
        refund = listed.data.find(item => item.metadata?.money_authorization_id === body.authorization_id && !earlier.has(item.id));
        if (!refund && listed.has_more) return json({ error: "REFUND_READBACK_INCOMPLETE", message: "Stripe has more refunds on this payment than one readback covers. Nothing was recorded; find the refund in Stripe." }, 409);
      }
      const intent = typeof refund?.payment_intent === "string" ? refund.payment_intent : refund?.payment_intent?.id;
      if (refund && (refund.metadata?.money_authorization_id !== body.authorization_id || intent !== current.payment_id)) {
        return json({ error: "REFUND_PROVIDER_MISMATCH", message: "Stripe's refund does not belong to this reviewed refund. Nothing was recorded; escalate to the finance owner." }, 409);
      }
      const recorded = await admin.rpc("money_record_refund_readback", { p_authorization: body.authorization_id, p_actor: actor, p_reference: refund?.id ?? null, p_status: refund?.status ?? null, p_amount: refund?.amount ?? null });
      if (recorded.error || !recorded.data) return json({ error: "REFUND_PROVIDER_MISMATCH", message: "Stripe's refund does not match the reviewed refund. Nothing was recorded; escalate to the finance owner." }, 409);
      const result = recorded.data as { attempt_status: string; settled: boolean };
      return json({ status: result.attempt_status, settled: result.settled, found: Boolean(refund), refund_id: refund?.id ?? null, provider_status: refund?.status ?? null });
    }
    const prepared = await admin.rpc("money_prepare_refund", { p_authorization: body.authorization_id, p_actor: actor });
    if (prepared.error || !prepared.data) return json({ error: "REFUND_REVIEW_REQUIRED" }, 409);
    const attempt = prepared.data;
    if (attempt.status === "succeeded") return json({ status: "succeeded", already_refunded: true });
    if (attempt.status === "failed") return json({ status: "failed", message: "Stripe reported this refund failed. Read it back from Stripe, then resend or release it." });
    if (attempt.status !== "prepared") return json({ status: attempt.status, message: "Awaiting refund reconciliation; do not submit another refund." });
    const refund = await stripe.refunds.create({ payment_intent: attempt.payment_id, amount: Number(attempt.amount), metadata: { money_authorization_id: body.authorization_id } }, { idempotencyKey: attempt.idempotency_key });
    const recorded = await admin.rpc("money_record_refund_result", { p_authorization: body.authorization_id, p_reference: refund.id, p_status: refund.status ?? "pending", p_amount: refund.amount });
    if (recorded.error) throw new Error("REFUND_RESULT_RECONCILIATION_REQUIRED");
    return json({ status: "awaiting_webhook", refund_id: refund.id });
  } catch { return json({ error: "REFUND_RECONCILIATION_REQUIRED", message: "The refund outcome could not be confirmed. The durable attempt must be reconciled before a new refund." }, 503); }
});
