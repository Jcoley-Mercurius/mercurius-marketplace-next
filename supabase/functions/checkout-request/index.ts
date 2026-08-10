// Create checkout for a package-based service request.
// - fixed: full upfront charge
// - deposit_quote: refundable deposit charge
// - custom_quote: skip checkout (handled client-side)
import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { findCatalogEntry, catalogPriceFor } from "../_shared/catalogPricing.ts";
import { platformFeeFromAmount, vendorPayoutFromAmount } from "../_shared/platformFee.ts";
import { SOFT_LAUNCH_FIXED_PACKAGES_ONLY, SOFT_LAUNCH_MESSAGE } from "../_shared/softLaunch.ts";

const PRODUCTION_ORIGIN = "https://mercurius.com";
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const baseCorsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

type CheckoutOrigin = {
  allowed: boolean;
  checkoutOrigin: string;
  responseOrigin: string;
};

function normalizedOrigin(value: string | undefined | null) {
  const raw = value?.trim();
  if (!raw) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configuredOrigins() {
  const siteUrl = normalizedOrigin(Deno.env.get("SITE_URL"));
  const publicSiteUrl = normalizedOrigin(Deno.env.get("NEXT_PUBLIC_SITE_URL"));
  const vercelUrl = normalizedOrigin(Deno.env.get("VERCEL_URL"));
  const primary = siteUrl ?? publicSiteUrl ?? vercelUrl ?? PRODUCTION_ORIGIN;

  return {
    primary,
    allowed: new Set(
      [siteUrl, publicSiteUrl, vercelUrl, PRODUCTION_ORIGIN].filter(
        (origin): origin is string => Boolean(origin),
      ),
    ),
  };
}

function resolveCheckoutOrigin(req: Request): CheckoutOrigin {
  const configured = configuredOrigins();
  const requestOrigin = normalizedOrigin(req.headers.get("origin"));
  const requestIsAllowed =
    !requestOrigin ||
    configured.allowed.has(requestOrigin) ||
    LOCAL_ORIGIN.test(requestOrigin);

  return {
    allowed: requestIsAllowed,
    checkoutOrigin:
      requestOrigin && requestIsAllowed ? requestOrigin : configured.primary,
    responseOrigin:
      requestOrigin && requestIsAllowed ? requestOrigin : configured.primary,
  };
}

function corsHeaders(origin: string) {
  return {
    ...baseCorsHeaders,
    "Access-Control-Allow-Origin": origin,
  };
}

type PackagePriceSnapshot = {
  baseAmount: number;
  effectiveAmount: number;
  promotionId: string | null;
  promotionLabel: string | null;
};

class CheckoutError extends Error {
  constructor(public code: string, message: string, public status = 409) {
    super(message);
  }
}

async function resolvePackagePrice(
  admin: ReturnType<typeof createClient>,
  packageId: string,
  tierId: string,
): Promise<PackagePriceSnapshot> {
  const { data, error } = await admin
    .rpc("resolve_package_tier_price", { p_package_id: packageId, p_tier_id: tierId })
    .maybeSingle();

  if (error) {
    console.error("PRICE_REVALIDATION_RPC_FAILED", { packageId, tierId, error: error.message });
    throw new CheckoutError(
      "PRICE_REVALIDATION_FAILED",
      "We couldn't verify the current package price. No checkout was created. Please refresh and try again.",
      503,
    );
  }
  if (!data) {
    throw new CheckoutError(
      "PRICE_NOT_BOOKABLE",
      "This package or price is no longer available for online booking. No checkout was created.",
    );
  }

  const row = data as Record<string, unknown>;
  const baseAmount = currencyAmount(row.base_price);
  const effectiveAmount = currencyAmount(row.effective_price);
  if (!baseAmount || !effectiveAmount || effectiveAmount > baseAmount) {
    console.error("PRICE_REVALIDATION_INVALID_RESULT", { packageId, tierId, data });
    throw new CheckoutError(
      "PRICE_NOT_BOOKABLE",
      "The current package price is invalid. No checkout was created.",
    );
  }

  return {
    baseAmount,
    effectiveAmount,
    promotionId: typeof row.promotion_id === "string" ? row.promotion_id : null,
    promotionLabel: typeof row.promotion_label === "string" ? row.promotion_label : null,
  };
}

function currencyAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

Deno.serve(async (req) => {
  const checkoutOrigin = resolveCheckoutOrigin(req);
  const responseCorsHeaders = corsHeaders(checkoutOrigin.responseOrigin);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: checkoutOrigin.allowed ? 204 : 403,
      headers: responseCorsHeaders,
    });
  }

  try {
    if (!checkoutOrigin.allowed) {
      throw new CheckoutError(
        "ORIGIN_NOT_ALLOWED",
        "Checkout is not available from this website origin.",
        403,
      );
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing Authorization header");

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supa.auth.getUser();
    if (userErr || !userData.user) throw new Error("Unauthorized");
    const user = userData.user;

    const body = await req.json();
    const requestId: string = body.request_id;
    if (!requestId) throw new Error("request_id required");
    // NOTE: no amount/price is ever read from the request body. The client may
    // only identify *what* is being bought (via the request row it created);
    // every charged figure below is resolved server-side.

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: sr, error: srErr } = await admin
      .from("service_requests")
      .select("*")
      .eq("id", requestId)
      .single();
    if (srErr || !sr) throw new Error("Request not found");
    if (sr.customer_id !== user.id) throw new Error("Forbidden");

    // ── Soft launch: only fixed-price packages are bookable/chargeable online.
    //    Deposit and custom-quote requests are rejected outright (no silent skip)
    //    so ops handles them manually via admin invoices/quotes.
    if (SOFT_LAUNCH_FIXED_PACKAGES_ONLY && (sr.pricing_mode !== "fixed" || sr.quote_only)) {
      console.warn("SOFT_LAUNCH_BLOCK: non-fixed checkout attempt", {
        requestId, pricing_mode: sr.pricing_mode, quote_only: sr.quote_only, customer_id: sr.customer_id,
      });
      return new Response(
        JSON.stringify({ error: "SOFT_LAUNCH_FIXED_ONLY", message: SOFT_LAUNCH_MESSAGE }),
        { status: 403, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Custom-quote jobs are never chargeable from this endpoint. They are
    //    billed only through an admin-created invoice (invoices INSERT is
    //    admin-only by RLS) via the `create-checkout` function.
    if (sr.pricing_mode === "custom_quote" || sr.quote_only) {
      return new Response(JSON.stringify({ skip: true, reason: "custom_quote" }), {
        status: 200, headers: { ...responseCorsHeaders, "Content-Type": "application/json" },
      });
    }

    let amount = 0;
    let isDeposit = false;
    let lineLabel = "Mercurius Service";
    let priceSource = "";
    let baseAmount: number | null = null;
    let promotionId: string | null = null;
    let promotionLabel: string | null = null;
    let packageSelection: { packageId: string; tierId: string } | null = null;

    if (sr.pricing_mode === "fixed" && sr.package_tier_id) {
      // Vendor package tier → price comes from the vendor's live price table.
      const { data: tier } = await admin
        .from("package_tiers")
        .select("name, package_id")
        .eq("id", sr.package_tier_id)
        .maybeSingle();
      if (!tier) throw new Error("Tier not found");
      if (!sr.package_id || tier.package_id !== sr.package_id) {
        console.error("PRICE_TAMPER: tier does not belong to package", { requestId, tier: sr.package_tier_id, package: sr.package_id });
        throw new Error("Selected package tier is invalid for this package");
      }
      const { data: pkg } = await admin
        .from("vendor_packages")
        .select("id, contractor_id")
        .eq("id", tier.package_id)
        .maybeSingle();
      if (!pkg) throw new Error("This package is no longer available. Please refresh and try again.");
      if (sr.contractor_id && sr.contractor_id !== pkg.contractor_id) {
        console.error("PRICE_TAMPER: request contractor does not own package", { requestId, requestContractor: sr.contractor_id, packageContractor: pkg.contractor_id });
        throw new Error("Selected package is invalid for this provider");
      }
      packageSelection = { packageId: sr.package_id, tierId: sr.package_tier_id };
      lineLabel = `${sr.service_type} — ${tier.name}`;
      priceSource = "rpc:resolve_package_tier_price";
    } else if (sr.pricing_mode === "fixed") {
      // Catalog-priced service (no vendor package/tier selected).
      // Price is resolved from the server-owned catalog — NEVER from
      // sr.total_amount, which the client wrote when creating the request.
      const match = findCatalogEntry(sr.service_catalog_id, sr.service_type);
      if (!match) {
        console.error("PRICE_BLOCKED: unknown catalog service", { requestId, service_catalog_id: sr.service_catalog_id, service_type: sr.service_type });
        throw new Error("We couldn't verify the price for this service. Please refresh and try again.");
      }
      const catalogAmount = catalogPriceFor(match.entry, sr.frequency);
      if (!catalogAmount || catalogAmount <= 0) {
        console.error("PRICE_BLOCKED: no catalog price for frequency", { requestId, service: match.id, frequency: sr.frequency });
        throw new Error("This service isn't available for upfront checkout. Our team will send you a quote.");
      }
      amount = Number(catalogAmount);
      lineLabel = `${sr.service_type}${sr.frequency ? ` — ${sr.frequency}` : ""}`;
      priceSource = `catalog:${match.id}`;
    } else if (sr.pricing_mode === "deposit_quote" && sr.package_id) {
      const { data: pkg } = await admin
        .from("vendor_packages")
        .select("deposit_amount, name, is_active")
        .eq("id", sr.package_id)
        .maybeSingle();
      if (!pkg || !pkg.deposit_amount) throw new Error("Package missing deposit amount");
      if (!pkg.is_active) throw new Error("This package is no longer available. Please refresh and try again.");
      amount = Number(pkg.deposit_amount);
      isDeposit = true;
      lineLabel = `Deposit — ${pkg.name}`;
      priceSource = "vendor_packages.deposit_amount";
    } else {
      throw new Error("Request not eligible for checkout");
    }

    // Determine if this is a recurring subscription (deposits are always one-time)
    const RECURRING: Record<string, { interval: "day" | "week" | "month" | "year"; interval_count: number }> = {
      "weekly": { interval: "week", interval_count: 1 },
      "bi-weekly": { interval: "week", interval_count: 2 },
      "monthly": { interval: "month", interval_count: 1 },
      "bi-monthly": { interval: "month", interval_count: 2 },
      "quarterly": { interval: "month", interval_count: 3 },
      "yearly": { interval: "year", interval_count: 1 },
    };
    const recurring = !isDeposit && sr.frequency ? RECURRING[sr.frequency] : undefined;

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });

    const { data: profile } = await admin
      .from("profiles").select("stripe_customer_id, full_name").eq("user_id", user.id).maybeSingle();

    let customerId = profile?.stripe_customer_id ?? null;
    if (!customerId) {
      const created = await stripe.customers.create({
        email: user.email ?? undefined,
        name: profile?.full_name || undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = created.id;
      await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("user_id", user.id);
    }

    // Resolve package pricing with database time as close as possible to Stripe
    // session creation. The RPC validates package/tier eligibility and applies
    // only a promotion that is still effective at this exact server-side check.
    const clientAmount = sr.total_amount == null ? null : Number(sr.total_amount);
    if (packageSelection) {
      const snapshot = await resolvePackagePrice(admin, packageSelection.packageId, packageSelection.tierId);
      amount = snapshot.effectiveAmount;
      baseAmount = snapshot.baseAmount;
      promotionId = snapshot.promotionId;
      promotionLabel = snapshot.promotionLabel;

      const { error: snapshotError } = await admin
        .from("service_requests")
        .update({
          base_amount: baseAmount,
          total_amount: amount,
          promotion_id: promotionId,
        })
        .eq("id", sr.id);
      if (snapshotError) {
        console.error("PRICE_SNAPSHOT_FAILED", { requestId, error: snapshotError.message });
        throw new CheckoutError(
          "PRICE_SNAPSHOT_FAILED",
          "We couldn't save the verified price. No checkout was created. Please try again.",
          503,
        );
      }
    }

    if (amount <= 0) throw new CheckoutError("INVALID_AMOUNT", "This request no longer has a valid checkout amount.");

    // sr.total_amount is browser-written. A changed/expired promotion resolves
    // to the current base price above; if that differs, save the new snapshot
    // but require the customer to review it before a retry can create Checkout.
    if (clientAmount != null && Math.abs(clientAmount - amount) > 0.005) {
      console.error("PRICE_MISMATCH: blocked checkout", {
        requestId,
        customer_id: sr.customer_id,
        service_type: sr.service_type,
        client_amount: clientAmount,
        server_amount: amount,
        base_amount: baseAmount,
        promotion_id: promotionId,
        price_source: priceSource,
      });
      if (!packageSelection) await admin.from("service_requests").update({ total_amount: amount }).eq("id", sr.id);
      return new Response(
        JSON.stringify({
          error: "PRICE_MISMATCH",
          message: "Pricing for this service has changed. Please refresh and review the updated total before paying.",
          current_amount: amount,
        }),
        { status: 409, headers: { ...responseCorsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (clientAmount == null && !packageSelection) {
      await admin.from("service_requests").update({ total_amount: amount }).eq("id", sr.id);
    }

    const pricingMetadata = {
      pricing_base_amount: String(baseAmount ?? amount),
      pricing_effective_amount: String(amount),
      promotion_id: promotionId ?? "",
      promotion_label: promotionLabel ?? "",
    };

    // A discounted Stripe subscription price would persist after the Mercurius
    // promotion expires. Until renewal repricing is implemented, fail closed
    // instead of turning a scheduled overlay into a permanent discount.
    if (recurring && promotionId) {
      throw new CheckoutError(
        "PROMOTION_RECURRING_CHECKOUT_UNAVAILABLE",
        "This limited-time price cannot be used for recurring online checkout yet. No checkout was created. Please contact Mercurius to book this service.",
      );
    }

    const origin = checkoutOrigin.checkoutOrigin;

    // ── Recurring plan → Stripe subscription. Invoices are created per renewal
    //    by the `invoice.paid` webhook handler.
    if (recurring) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        customer: customerId!,
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: lineLabel },
            unit_amount: Math.round(amount * 100),
            recurring,
          },
          quantity: 1,
        }],
        subscription_data: {
          metadata: {
            service_request_id: sr.id,
            customer_id: sr.customer_id,
            contractor_id: sr.contractor_id ?? "",
            frequency: sr.frequency,
            ...pricingMetadata,
          },
        },
        metadata: {
          service_request_id: sr.id,
          customer_id: sr.customer_id,
          frequency: sr.frequency,
          mode: "subscription",
          ...pricingMetadata,
        },
        success_url: `${origin}/dashboard?subscribed=${sr.id}`,
        cancel_url: `${origin}/dashboard?cancelled=${sr.id}`,
      });

      return new Response(JSON.stringify({ url: session.url, subscription: true }), {
        status: 200, headers: { ...responseCorsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── One-time payment (or deposit) → create invoice row + Checkout payment
    const { count } = await admin.from("invoices").select("*", { count: "exact", head: true });
    const invoiceNumber = `INV-${String((count ?? 0) + 1).padStart(5, "0")}`;
    const platformFee = platformFeeFromAmount(amount);
    const vendorPayout = vendorPayoutFromAmount(amount);

    const { data: invoice, error: invErr } = await admin
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        service_request_id: sr.id,
        customer_id: sr.customer_id,
        contractor_id: sr.contractor_id,
        amount,
        platform_fee: platformFee,
        vendor_payout: vendorPayout,
        status: "pending",
        is_deposit: isDeposit,
        ...(packageSelection ? { base_amount: baseAmount, promotion_id: promotionId } : {}),
      })
      .select("*")
      .single();
    if (invErr || !invoice) throw new Error(invErr?.message || "Could not create invoice");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer: customerId!,
      payment_intent_data: {
        setup_future_usage: "on_session",
        metadata: {
          invoice_id: invoice.id,
          service_request_id: sr.id,
          customer_id: sr.customer_id,
          is_deposit: String(isDeposit),
          ...pricingMetadata,
        },
      },
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: { name: lineLabel },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      metadata: {
        invoice_id: invoice.id,
        service_request_id: sr.id,
        customer_id: sr.customer_id,
        is_deposit: String(isDeposit),
        ...pricingMetadata,
      },
      success_url: `${origin}/dashboard?paid=${invoice.id}`,
      cancel_url: `${origin}/dashboard?cancelled=${invoice.id}`,
    });

    await admin.from("invoices").update({ stripe_session_id: session.id }).eq("id", invoice.id);

    return new Response(JSON.stringify({ url: session.url, invoice_id: invoice.id }), {
      status: 200, headers: { ...responseCorsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("checkout-request error:", msg);
    return new Response(JSON.stringify(err instanceof CheckoutError ? { error: err.code, message: err.message } : { error: msg }), {
      status: err instanceof CheckoutError ? err.status : 400, headers: { ...responseCorsHeaders, "Content-Type": "application/json" },
    });
  }
});
