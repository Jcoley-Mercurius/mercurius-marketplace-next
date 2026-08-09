// Stripe webhook handler — verifies signature, deduplicates by event.id,
// and maps Stripe events to internal invoice/service_request status.
//
// ┌─────────────────────────────────────┬──────────────────────────────┬──────────────────────────────┐
// │ Stripe event                        │ invoice.status               │ service_request.status       │
// ├─────────────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
// │ checkout.session.completed          │ → paid                       │ → in_progress (if pending)   │
// │ payment_intent.payment_failed       │ → pending (rollback)         │ → pending (rollback)         │
// │ charge.refunded                     │ → refunded                   │ (unchanged)                  │
// │ charge.dispute.created              │ → disputed                   │ disputed=true; pause vendor  │
// │ charge.dispute.closed (won)         │ → pending_release (+24h)     │ disputed=false, resolved     │
// │ charge.dispute.closed (lost)        │ → refunded                   │ (unchanged)                  │
// └─────────────────────────────────────┴──────────────────────────────┴──────────────────────────────┘
// The pending_release → released transition on job completion is handled by
// the DB trigger `sync_invoice_on_request_change` (not by Stripe).

import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { platformFeeFromAmount, vendorPayoutFromAmount } from "../_shared/platformFee.ts";

const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")!;
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function notify(
  userId: string,
  type: string,
  title: string,
  body: string,
  link?: string,
  severity: "info" | "warning" | "success" | "critical" = "info",
  relatedRequestId?: string | null,
) {
  await admin.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body,
    link: link ?? null,
    severity,
    related_request_id: relatedRequestId ?? null,
  });
}

// Marks the linked service_request as captured after a successful payment and
// sends the homeowner an in-app confirmation exactly once (the .eq on
// payment_status makes the update a no-op on replays).
// Guarded to only move from 'pending' so refunded/released never get clobbered.
async function markPaymentCaptured(serviceRequestId: string | null | undefined) {
  if (!serviceRequestId) return;
  const { data, error } = await admin
    .from("service_requests")
    .update({
      payment_status: "captured",
      payment_captured_at: new Date().toISOString(),
    })
    .eq("id", serviceRequestId)
    .eq("payment_status", "pending")
    .select("id, customer_id, service_type")
    .maybeSingle();

  if (error) {
    console.warn("payment_status capture failed:", error.message);
    return;
  }
  if (!data?.customer_id) return;

  await notify(
    data.customer_id,
    "payment_captured",
    "Payment Confirmed",
    `Your payment for ${data.service_type} is confirmed. We're getting your job scheduled now — you'll see updates right here.`,
    "/dashboard",
    "success",
    data.id,
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing stripe-signature", { status: 400 });
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return new Response("Server misconfigured", { status: 500 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid signature";
    console.error("Signature verification failed:", msg);
    return new Response(`Webhook Error: ${msg}`, { status: 400 });
  }

  // ── Idempotency guard ───────────────────────────────────────────────
  // Insert event.id into stripe_webhook_events. PK conflict = already
  // processed → ack 200 immediately so Stripe stops retrying.
  const { error: dedupeErr } = await admin
    .from("stripe_webhook_events")
    .insert({ event_id: event.id, event_type: event.type });

  if (dedupeErr) {
    if (dedupeErr.code === "23505") {
      console.log(`↻ Duplicate event ${event.id} ignored`);
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("Dedup insert failed:", dedupeErr);
    return new Response("DB error", { status: 500 });
  }

  console.log(`✓ Processing event ${event.id} type=${event.type}`);

  try {
    switch (event.type) {
      // ── Successful payment (one-time checkout) ──────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Subscription checkouts: stamp the subscription id on the request.
        // Actual invoice creation happens in `invoice.paid` below.
        if (session.mode === "subscription") {
          const subId = typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
          const srId = session.metadata?.service_request_id;
          if (subId && srId) {
            await admin
              .from("service_requests")
              .update({
                stripe_subscription_id: subId,
                stripe_subscription_status: "active",
              })
              .eq("id", srId);
          }
          break;
        }

        const invoiceId = session.metadata?.invoice_id;
        if (!invoiceId) {
          console.warn("checkout.session.completed missing invoice_id metadata");
          break;
        }
        const piId = typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;

        // Only flip if not already paid (idempotency on top of dedup table)
        const { data: inv } = await admin
          .from("invoices")
          .update({
            status: "paid",
            stripe_payment_intent_id: piId,
            stripe_session_id: session.id,
            paid_at: new Date().toISOString(),
            paid_by_customer_at: new Date().toISOString(),
          })
          .eq("id", invoiceId)
          .in("status", ["draft", "pending"])
          .select("service_request_id, customer_id, invoice_number")
          .maybeSingle();

        if (!inv) break;

        await markPaymentCaptured(inv.service_request_id);

        if (inv.service_request_id) {
          // Single source of truth: the state machine validates + logs the move.
          const { error: trErr } = await admin.rpc("transition_job_status", {
            _job_id: inv.service_request_id,
            _to_status: "in_progress",
            _reason: "Payment received",
            _metadata: { source: "stripe-webhook", event: event.type },
          });
          if (trErr) console.warn("payment transition rejected:", trErr.message);
        }

        if (inv.customer_id) {
          await notify(
            inv.customer_id,
            "payment_received",
            "Payment Received",
            `We've received your payment for invoice ${inv.invoice_number}. Your job is now scheduled.`,
            "/dashboard",
            "info",
            inv.service_request_id,
          );
        }
        break;
      }

      // ── Subscription renewal paid → create internal invoice row ─────
      case "invoice.paid": {
        const stripeInvoice = event.data.object as Stripe.Invoice;
        const subId = typeof stripeInvoice.subscription === "string"
          ? stripeInvoice.subscription
          : stripeInvoice.subscription?.id;
        if (!subId) break;

        const { data: sr } = await admin
          .from("service_requests")
          .select("id, customer_id, contractor_id, service_type, frequency")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        if (!sr) {
          console.warn(`invoice.paid for unknown subscription ${subId}`);
          break;
        }

        const amount = (stripeInvoice.amount_paid ?? 0) / 100;
        const platformFee = platformFeeFromAmount(amount);
        const vendorPayout = vendorPayoutFromAmount(amount);

        const { count } = await admin.from("invoices").select("*", { count: "exact", head: true });
        const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(5, "0")}`;

        const piId = typeof stripeInvoice.payment_intent === "string"
          ? stripeInvoice.payment_intent
          : stripeInvoice.payment_intent?.id;

        await admin.from("invoices").insert({
          invoice_number: invoiceNumber,
          service_request_id: sr.id,
          customer_id: sr.customer_id,
          contractor_id: sr.contractor_id,
          amount,
          platform_fee: platformFee,
          vendor_payout: vendorPayout,
          status: "paid",
          is_deposit: false,
          stripe_payment_intent_id: piId,
          paid_at: new Date().toISOString(),
          paid_by_customer_at: new Date().toISOString(),
          notes: `Recurring billing (${sr.frequency}) — Stripe invoice ${stripeInvoice.id}`,
        });

        // Advance the service request out of pending on first paid invoice
        await admin
          .from("service_requests")
          .update({ stripe_subscription_status: "active" })
          .eq("id", sr.id);
        await markPaymentCaptured(sr.id);
        {
          const { error: trErr } = await admin.rpc("transition_job_status", {
            _job_id: sr.id,
            _to_status: "in_progress",
            _reason: "Recurring payment received",
            _metadata: { source: "stripe-webhook", event: event.type },
          });
          if (trErr) console.warn("recurring payment transition rejected:", trErr.message);
        }

        if (sr.customer_id) {
          await notify(
            sr.customer_id,
            "payment_received",
            "Payment Received",
            `Your ${sr.frequency} payment of $${amount.toFixed(2)} for ${sr.service_type} was processed successfully.`,
            "/dashboard",
            "info",
            sr.id,
          );
        }
        break;
      }

      // ── Subscription renewal failed ─────────────────────────────────
      case "invoice.payment_failed": {
        const stripeInvoice = event.data.object as Stripe.Invoice;
        const subId = typeof stripeInvoice.subscription === "string"
          ? stripeInvoice.subscription
          : stripeInvoice.subscription?.id;
        if (!subId) break;

        const { data: sr } = await admin
          .from("service_requests")
          .select("id, customer_id, service_type")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();
        if (!sr?.customer_id) break;

        await admin
          .from("service_requests")
          .update({ stripe_subscription_status: "past_due" })
          .eq("id", sr.id);

        await notify(
          sr.customer_id,
          "payment_failed",
          "Recurring Payment Failed",
          `We couldn't process your recurring payment for ${sr.service_type}. Please update your payment method to keep service active.`,
          "/dashboard",
          "critical",
          sr.id,
        );
        break;
      }

      // ── Subscription cancelled (by customer, admin, or after retries) ─
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const { data: sr } = await admin
          .from("service_requests")
          .select("id, customer_id, service_type")
          .eq("stripe_subscription_id", sub.id)
          .maybeSingle();
        if (!sr) break;

        await admin
          .from("service_requests")
          .update({ stripe_subscription_status: "canceled" })
          .eq("id", sr.id);
        {
          const { error: trErr } = await admin.rpc("transition_job_status", {
            _job_id: sr.id,
            _to_status: "cancelled",
            _reason: "Stripe subscription cancelled",
            _metadata: { source: "stripe-webhook", event: event.type },
          });
          if (trErr) console.warn("cancellation transition rejected:", trErr.message);
        }

        if (sr.customer_id) {
          await notify(
            sr.customer_id,
            "subscription_cancelled",
            "Subscription Cancelled",
            `Your recurring plan for ${sr.service_type} has been cancelled. You can request a new service anytime.`,
            "/dashboard",
            "info",
            sr.id,
          );
        }
        break;
      }

      // ── Failed payment → rollback ────────────────────────────────────
      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const invoiceId = pi.metadata?.invoice_id;
        const reason = pi.last_payment_error?.message ?? "Card was declined";
        console.warn(`payment_failed pi=${pi.id} invoice=${invoiceId} reason=${reason}`);

        if (!invoiceId) break;

        // Roll back invoice (only if it isn't already paid by a later retry)
        const { data: inv } = await admin
          .from("invoices")
          .update({
            status: "pending",
            paid_at: null,
            paid_by_customer_at: null,
            stripe_payment_intent_id: pi.id,
          })
          .eq("id", invoiceId)
          .in("status", ["paid", "pending_release", "draft", "pending"])
          .select("service_request_id, customer_id, invoice_number")
          .maybeSingle();

        if (!inv) break;

        // Roll back service request if it was auto-advanced to in_progress
        if (inv.service_request_id) {
          const { error: trErr } = await admin.rpc("transition_job_status", {
            _job_id: inv.service_request_id,
            _to_status: "pending",
            _reason: `Payment failed: ${reason}`,
            _metadata: { source: "stripe-webhook", event: event.type },
          });
          if (trErr) console.warn("payment-failure rollback rejected:", trErr.message);
        }

        if (inv.customer_id) {
          await notify(
            inv.customer_id,
            "payment_failed",
            "Payment Failed",
            `Your payment for invoice ${inv.invoice_number} could not be processed: ${reason}. Please update your payment method to keep your job on schedule.`,
            "/dashboard",
            "critical",
            inv.service_request_id,
          );
        }
        break;
      }

      // ── Refund issued ────────────────────────────────────────────────
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const piId = typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id;
        if (!piId) break;

        const { data: inv } = await admin
          .from("invoices")
          .update({ status: "refunded" })
          .eq("stripe_payment_intent_id", piId)
          .neq("status", "refunded")
          .select("customer_id, invoice_number, service_request_id")
          .maybeSingle();

        if (inv?.customer_id) {
          await notify(
            inv.customer_id,
            "payment_refunded",
            "Refund Issued",
            `Your refund for invoice ${inv.invoice_number} has been processed.`,
            "/dashboard",
            "info",
            inv.service_request_id,
          );
        }
        break;
      }

      // ── Customer opened a Stripe dispute ─────────────────────────────
      case "charge.dispute.created": {
        const dispute = event.data.object as Stripe.Dispute;
        const piId = typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
        if (!piId) break;

        const { data: inv } = await admin
          .from("invoices")
          .update({ status: "disputed", release_eligible_at: null })
          .eq("stripe_payment_intent_id", piId)
          .select("contractor_id, service_request_id")
          .maybeSingle();

        if (inv?.service_request_id) {
          const { error: trErr } = await admin.rpc("transition_job_status", {
            _job_id: inv.service_request_id,
            _to_status: "disputed",
            _reason: `Stripe dispute: ${dispute.reason}`,
            _metadata: { source: "stripe-webhook", event: event.type },
          });
          if (trErr) {
            // Job may not be in a disputable state; still flag the payment side.
            console.warn("dispute transition rejected:", trErr.message);
            await admin
              .from("service_requests")
              .update({
                disputed: true,
                disputed_at: new Date().toISOString(),
                dispute_reason: `Stripe dispute: ${dispute.reason}`,
              })
              .eq("id", inv.service_request_id);
          }
        }

        if (inv?.contractor_id) {
          await admin
            .from("contractors")
            .update({
              payouts_paused: true,
              payouts_paused_at: new Date().toISOString(),
              payouts_paused_reason: `Active Stripe dispute (${dispute.id})`,
            })
            .eq("id", inv.contractor_id);
        }
        break;
      }

      // ── Dispute resolved ─────────────────────────────────────────────
      case "charge.dispute.closed": {
        const dispute = event.data.object as Stripe.Dispute;
        const piId = typeof dispute.payment_intent === "string"
          ? dispute.payment_intent
          : dispute.payment_intent?.id;
        if (!piId) break;

        const won = dispute.status === "won";

        const { data: inv } = await admin
          .from("invoices")
          .update({
            status: won ? "pending_release" : "refunded",
            release_eligible_at: won
              ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
              : null,
          })
          .eq("stripe_payment_intent_id", piId)
          .select("service_request_id")
          .maybeSingle();

        if (inv?.service_request_id) {
          const { error: trErr } = await admin.rpc("transition_job_status", {
            _job_id: inv.service_request_id,
            _to_status: "resolved",
            _reason: won ? "resolved_for_vendor" : "refunded_to_customer",
            _metadata: { source: "stripe-webhook", event: event.type },
          });
          if (trErr) {
            console.warn("dispute-resolution transition rejected:", trErr.message);
            await admin
              .from("service_requests")
              .update({
                disputed: false,
                dispute_resolved_at: new Date().toISOString(),
                dispute_resolution: won ? "resolved_for_vendor" : "refunded_to_customer",
              })
              .eq("id", inv.service_request_id);
          }
        }
        break;
      }

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`Handler error for ${event.type}:`, msg);

    // IMPORTANT: roll back the dedup row so Stripe's retry can re-attempt.
    await admin.from("stripe_webhook_events").delete().eq("event_id", event.id);

    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
