// Returns a Stripe Billing Portal URL for the authenticated homeowner.
// Lazily creates a Stripe Customer and persists stripe_customer_id on profiles.
import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) throw new Error("Unauthorized");
    const user = userData.user;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    // Find or create the Stripe customer
    const { data: profile } = await admin
      .from("profiles")
      .select("id, stripe_customer_id, full_name")
      .eq("user_id", user.id)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id ?? null;

    if (!customerId) {
      // Try matching by email first to avoid duplicates if a customer was created via Checkout
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

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId!,
      return_url: `${origin}/dashboard?tab=payment-methods`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("customer-portal error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
