import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { acceptMoneyEvent, normalizeMoneyEvent, type VerifiedStripeEvent } from "../_shared/moneyWebhook.ts";
import { requireEdgeEnvironment } from "../_shared/env.ts";

Deno.serve(async request => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Signature required", { status: 400 });
  if (Deno.env.get("MERCURIUS_MONEY_MODE") !== "test") return new Response("Money processing not activated", { status: 503 });
  try {
    const key = requireEdgeEnvironment("STRIPE_SECRET_KEY");
    if (!key.startsWith("sk_test_")) return new Response("Test provider required", { status: 503 });
    const stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });
    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(await request.text(), signature, requireEdgeEnvironment("STRIPE_WEBHOOK_SECRET"));
    } catch { return new Response("Invalid signature", { status: 400 }); }
    if (event.livemode) return new Response("Live events disabled", { status: 400 });
    const admin = createClient(requireEdgeEnvironment("SUPABASE_URL"), requireEdgeEnvironment("SUPABASE_SERVICE_ROLE_KEY"));
    let normalized;
    try { normalized = normalizeMoneyEvent(event as unknown as VerifiedStripeEvent); }
    catch {
      normalized = { id: event.id, type: "reconciliation_required", payload: { source_type: event.type } };
    }
    await acceptMoneyEvent(normalized, {
      receive: async received => {
        const { error } = await admin.rpc("money_receive_event", { p_id: received.id, p_type: received.type, p_payload: received.payload });
        if (error) throw new Error("RECEIPT_FAILED");
      },
      process: async id => {
        const { data, error } = await admin.rpc("money_process_event", { p_event: id });
        if (error) throw new Error("PROCESS_FAILED");
        return data;
      },
    });
    return Response.json({ received: true });
  } catch { return new Response("Event receipt or processing did not complete; retry required", { status: 500 }); }
});
