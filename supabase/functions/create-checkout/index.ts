// Create a Stripe Checkout session for a service request invoice.
// Charges customer up-front; the webhook will mark the invoice paid on success.
import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { findCatalogEntry, catalogPriceFor } from "../_shared/catalogPricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    // Verify the calling user
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) throw new Error("Unauthorized");
    const user = userData.user;

    const body = await req.json();
    const invoiceId: string | undefined = body.invoice_id;
    if (!invoiceId) throw new Error("invoice_id is required");

    // Service-role client to read the invoice without RLS friction
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .select("id, invoice_number, amount, customer_id, status, service_request_id")
      .eq("id", invoiceId)
      .single();
    if (invErr || !invoice) throw new Error("Invoice not found");
    if (invoice.customer_id !== user.id) throw new Error("Forbidden");
    if (!["draft", "pending"].includes(invoice.status)) {
      throw new Error(`Invoice not payable (status: ${invoice.status})`);
    }

    // ── Price integrity check ───────────────────────────────────────────────
    // Invoice rows can only be inserted by admins or the service role (RLS),
    // so `invoice.amount` is server-authored. For invoices attached to a
    // fixed-price catalog job we still re-derive the price server-side and
    // block + log any divergence rather than charging the wrong amount.
    if (invoice.service_request_id) {
      const { data: sr } = await admin
        .from("service_requests")
        .select("pricing_mode, quote_only, frequency, service_type, service_catalog_id, package_tier_id, quote_amount, quote_approved_at")
        .eq("id", invoice.service_request_id)
        .maybeSingle();

      if (sr?.pricing_mode === "fixed" && !sr.package_tier_id) {
        const match = findCatalogEntry(sr.service_catalog_id, sr.service_type);
        const expected = match ? catalogPriceFor(match.entry, sr.frequency) : null;
        if (expected && Math.abs(expected - Number(invoice.amount)) > 0.005) {
          console.error("PRICE_MISMATCH: blocked invoice checkout", {
            invoice_id: invoice.id,
            service_request_id: invoice.service_request_id,
            invoice_amount: Number(invoice.amount),
            server_amount: expected,
            price_source: `catalog:${match!.id}`,
          });
          return new Response(
            JSON.stringify({
              error: "PRICE_MISMATCH",
              message: "This invoice doesn't match current pricing. Our team has been notified — please refresh and try again.",
              current_amount: expected,
            }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      // Custom-quote jobs are only chargeable once an authorized quote amount
      // has been set and approved server-side.
      if ((sr?.pricing_mode === "custom_quote" || sr?.quote_only) &&
          !(Number(sr?.quote_amount) > 0 && sr?.quote_approved_at)) {
        console.error("QUOTE_NOT_APPROVED: blocked invoice checkout", {
          invoice_id: invoice.id,
          service_request_id: invoice.service_request_id,
        });
        throw new Error("This quote hasn't been approved yet, so it can't be paid.");
      }
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    // Look up or create a Stripe Customer so saved cards persist across invoices
    const { data: profile } = await admin
      .from("profiles")
      .select("stripe_customer_id, full_name")
      .eq("user_id", user.id)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id ?? null;
    if (!customerId) {
      if (user.email) {
        const existing = await stripe.customers.list({ email: user.email, limit: 1 });
        if (existing.data.length > 0) customerId = existing.data[0].id;
      }
      if (!customerId) {
        const created = await stripe.customers.create({
          email: user.email ?? undefined,
          name: profile?.full_name || undefined,
          metadata: { supabase_user_id: user.id },
        });
        customerId = created.id;
      }
      await admin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", user.id);
    }

    const origin = req.headers.get("origin") ?? "https://brandinghousepreview.com";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer: customerId!,
      // Save the card on the customer for faster future checkouts
      payment_intent_data: {
        setup_future_usage: "on_session",
        metadata: {
          invoice_id: invoice.id,
          service_request_id: invoice.service_request_id ?? "",
          customer_id: invoice.customer_id,
        },
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Mercurius Invoice ${invoice.invoice_number}`,
            },
            unit_amount: Math.round(Number(invoice.amount) * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        invoice_id: invoice.id,
        service_request_id: invoice.service_request_id ?? "",
        customer_id: invoice.customer_id,
      },
      success_url: `${origin}/dashboard?paid=${invoice.id}`,
      cancel_url: `${origin}/dashboard?cancelled=${invoice.id}`,
    });

    // Persist session id so we can correlate webhook events
    await admin
      .from("invoices")
      .update({ stripe_session_id: session.id })
      .eq("id", invoice.id);

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("create-checkout error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
