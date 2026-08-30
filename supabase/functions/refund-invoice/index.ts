import Stripe from "npm:stripe@17.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { requireEdgeEnvironment } from "../_shared/env.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class RefundError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function syncRefundedInvoice(
  admin: ReturnType<typeof createClient>,
  invoiceId: string,
) {
  const { error } = await admin
    .from("invoices")
    .update({ status: "refunded", release_eligible_at: null })
    .eq("id", invoiceId);
  if (error) {
    throw new RefundError(
      "LEDGER_SYNC_FAILED",
      "Stripe confirms the refund, but the invoice ledger could not be updated. Refresh before retrying so the same payment is not refunded twice.",
      502,
    );
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED", message: "Method not allowed." }, 405);

  try {
    const supabaseUrl = requireEdgeEnvironment("SUPABASE_URL");
    const serviceRoleKey = requireEdgeEnvironment("SUPABASE_SERVICE_ROLE_KEY", { minLength: 20 });
    const stripeKey = requireEdgeEnvironment("STRIPE_SECRET_KEY", { minLength: 10 });

    const authorization = request.headers.get("Authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) throw new RefundError("UNAUTHORIZED", "Sign in as an administrator to issue a refund.", 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userError } = await admin.auth.getUser(token);
    if (userError || !userData.user) throw new RefundError("UNAUTHORIZED", "Your session is not valid.", 401);

    const { data: isAdmin, error: roleError } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (roleError) throw new RefundError("ROLE_CHECK_FAILED", "Administrator access could not be verified.", 503);
    if (!isAdmin) throw new RefundError("FORBIDDEN", "Only administrators can issue invoice refunds.", 403);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      throw new RefundError("INVALID_REQUEST", "A valid refund request is required.", 400);
    }
    const invoiceId = text(body.invoice_id, 100);
    const reason = text(body.reason, 500);
    if (!invoiceId) throw new RefundError("INVOICE_REQUIRED", "invoice_id is required.", 400);

    const { data: invoice, error: invoiceError } = await admin
      .from("invoices")
      .select("id, invoice_number, amount, status, stripe_payment_intent_id")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invoiceError) throw invoiceError;
    if (!invoice) throw new RefundError("INVOICE_NOT_FOUND", "Invoice not found.", 404);
    if (!["paid", "pending_release", "refunded"].includes(invoice.status)) {
      throw new RefundError(
        "INVOICE_NOT_REFUNDABLE",
        `Invoice ${invoice.invoice_number} is not refundable from status “${invoice.status}”. Released, disputed, unpaid, and cancelled invoices require manual review.`,
      );
    }

    const paymentIntentId = text(invoice.stripe_payment_intent_id, 255);
    if (!paymentIntentId || !paymentIntentId.startsWith("pi_")) {
      throw new RefundError(
        "STRIPE_PAYMENT_MISSING",
        "This invoice has no supported Stripe PaymentIntent ID. No refund was attempted.",
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== "succeeded" || paymentIntent.amount_received <= 0) {
      throw new RefundError("PAYMENT_NOT_CAPTURED", "Stripe does not show a successfully captured payment for this invoice.");
    }
    const chargedAmount = paymentIntent.amount_received;
    const currency = paymentIntent.currency;
    const refunds = await stripe.refunds.list({ payment_intent: paymentIntent.id, limit: 100 });

    if (refunds.has_more) {
      throw new RefundError("REFUND_HISTORY_TOO_LARGE", "This payment has extensive refund history and must be reviewed in Stripe.");
    }

    const invoiceAmount = Math.round(Number(invoice.amount) * 100);
    if (!Number.isFinite(invoiceAmount) || invoiceAmount <= 0 || invoiceAmount !== chargedAmount) {
      throw new RefundError(
        "AMOUNT_MISMATCH",
        "The invoice amount does not match the amount captured by Stripe. No refund was attempted; review the payment in Stripe.",
      );
    }

    const succeededAmount = refunds.data
      .filter((refund) => refund.status === "succeeded")
      .reduce((total, refund) => total + refund.amount, 0);
    const pendingRefund = refunds.data.find((refund) => refund.status === "pending");
    const alreadyFullyRefunded = succeededAmount >= chargedAmount;

    if (alreadyFullyRefunded) {
      await syncRefundedInvoice(admin, invoice.id);
      return json({
        ok: true,
        already_refunded: true,
        invoice_id: invoice.id,
        refund_status: "succeeded",
        amount: chargedAmount / 100,
        currency,
      });
    }
    if (pendingRefund) {
      throw new RefundError(
        "REFUND_PENDING",
        `Stripe refund ${pendingRefund.id} is still pending. Wait for Stripe before attempting another refund.`,
      );
    }
    if (succeededAmount > 0) {
      throw new RefundError(
        "PARTIAL_REFUND_EXISTS",
        "This payment already has a partial Stripe refund. Complete or review it in Stripe; the launch Admin UI only supports one full refund.",
      );
    }

    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntent.id,
        amount: chargedAmount,
        metadata: {
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          initiated_by: userData.user.id,
          admin_reason: reason || "Admin full refund",
        },
      },
      { idempotencyKey: `mercurius-invoice-full-refund-${invoice.id}` },
    );

    if (refund.status === "succeeded") {
      await syncRefundedInvoice(admin, invoice.id);
    } else if (refund.status !== "pending") {
      throw new RefundError(
        "REFUND_NOT_ACCEPTED",
        `Stripe returned refund status “${refund.status ?? "unknown"}”. The invoice was not marked refunded.`,
        502,
      );
    }

    console.log("Stripe invoice refund created", {
      invoiceId: invoice.id,
      refundId: refund.id,
      status: refund.status,
    });
    return json({
      ok: true,
      already_refunded: false,
      invoice_id: invoice.id,
      refund_id: refund.id,
      refund_status: refund.status,
      amount: refund.amount / 100,
      currency: refund.currency,
      ledger_status: refund.status === "succeeded" ? "refunded" : "awaiting_webhook",
    });
  } catch (error) {
    const known = error instanceof RefundError;
    const message = error instanceof Error ? error.message : "Refund processing failed.";
    if (!known) console.error("refund-invoice failed", { message });
    return json(
      {
        error: known ? error.code : "REFUND_FAILED",
        message: known ? message : "Stripe could not process this refund. No invoice status was changed by this request.",
      },
      known ? error.status : 500,
    );
  }
});
