"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { paymentFunctionError } from "@/lib/payments";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { MoneySummary, formatMoney, type MoneySummaryValues } from "@/components/ui/money-summary";

type Review = MoneySummaryValues & { invoice_number: string; policy_version: string; expires_at: string; current: boolean };
export function CheckoutReview({ snapshotId, mode, submitted }: { snapshotId: string; mode: string; submitted: boolean }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => {
    let active = true;
    const client = createClient();
    async function load() {
      try {
        const { data: identity, error: identityError } = await client.auth.getUser();
        if (identityError || !identity.user) throw new Error("Sign in as the homeowner to review this payment.");
        const snapshot = await client.from("money_snapshots").select("id,obligation_id,invoice_number,service,addons,discount,adjustment,tax,tip,deposit,total,policy_version,expires_at").eq("id", snapshotId).single();
        if (snapshot.error || !snapshot.data) throw new Error("This payment breakdown is unavailable. Contact Mercurius for a reviewed invoice.");
        const obligation = await client.from("money_obligations").select("current_snapshot_id,captured,refunded_service,refunded_tax,refunded_tip").eq("id", snapshot.data.obligation_id).single();
        if (obligation.error || !obligation.data) throw new Error("Payment confirmation could not be verified. Please refresh.");
        const row = snapshot.data;
        if (active) setReview({ ...row, paid: obligation.data.captured, refunded: obligation.data.refunded_service + obligation.data.refunded_tax + obligation.data.refunded_tip, current: obligation.data.current_snapshot_id === snapshotId });
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : "Payment review could not be loaded."); }
    }
    void load();
    return () => { active = false; };
  }, [snapshotId]);
  useEffect(() => {
    if (!review) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, Date.parse(review.expires_at) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [review]);
  const amount = review ? mode === "deposit" ? review.deposit : mode === "balance" ? review.total - review.paid : review.total : 0;
  const payable = review && review.current && review.refunded === 0 && !expired && amount > 0 &&
    ((mode === "full" && review.paid === 0) || (mode === "deposit" && review.paid === 0 && review.deposit > 0) || (mode === "balance" && review.deposit > 0 && review.paid === review.deposit));
  async function pay() {
    setPaymentError("");
    const { data, error: failure } = await createClient().functions.invoke("checkout-request", { body: { snapshot_id: snapshotId, mode } });
    if (failure) { const detail = await paymentFunctionError(failure); setPaymentError(detail.message); throw new Error(detail.message); }
    if (typeof data?.url !== "string" || !data.url.startsWith("https://checkout.stripe.com/")) {
      setPaymentError("A secure checkout link was not returned. No payment confirmation is available."); throw new Error("Checkout link unavailable");
    }
    window.location.assign(data.url);
  }
  return <main id="main-content" tabIndex={-1} className="mx-auto min-h-screen w-full max-w-2xl space-y-6 px-4 py-10 sm:px-6">
    <PageHeader title="Review your payment" description="You pay Mercurius directly. Review the full breakdown before continuing to secure checkout." />
    {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-destructive p-4 text-destructive">{error}</p>}
    {!review && !error && <p role="status">Loading your payment breakdown…</p>}
    {review && <>
      <p className="break-words text-sm text-muted-foreground">Invoice {review.invoice_number} · Policy {review.policy_version}</p>
      <MoneySummary values={review} />
      {paymentError && <p role="alert" className="text-destructive">{paymentError}</p>}
      {submitted && <p role="status">Checkout was submitted. Only confirmed payments in the breakdown above count as received. Refresh to check for updates.</p>}
      <p className="text-sm text-muted-foreground">A deposit counts toward the service total. Your provider receives the full tip. Cancellation and accepted exceptions follow the policy recorded with this invoice.</p>
      {payable ? <ConfirmAction triggerLabel={`Continue with ${formatMoney(amount)}`} title="Continue to secure checkout?" entity={`${review.invoice_number} — ${formatMoney(amount)}`} consequence="Stripe will ask you to authorize this payment to Mercurius. Returning to this page does not itself confirm a successful payment." confirmLabel="Continue to Stripe" confirmationTone="commitment" onConfirm={pay} />
        : <p role="status">This payment is already recorded, expired, or requires updated terms. Contact Mercurius if you need help.</p>}
    </>}
    <Link href="/dashboard" className="inline-flex min-h-11 items-center underline underline-offset-4">Back to your dashboard</Link>
  </main>;
}
