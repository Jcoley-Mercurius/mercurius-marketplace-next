"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, CircleAlert, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { EARLY_ACCESS_CTA, earlyAccessHref } from "@/lib/earlyAccessExperience";
import { cn } from "@/lib/utils";

export type ClosedReason = "signed_out" | "waiting" | "revoked" | "unavailable" | "not_homeowner" | "error";

// TRACE-103: the closed booking explanation shown on direct /request navigation. The
// request command refuses unadmitted cells regardless of what this page shows.
const copy: Record<ClosedReason, { title: string; body: string }> = {
  signed_out: {
    title: "Booking is opening by invitation",
    body: "We’re inviting Lee County homeowners to book in stages as approved providers become available. Join early access and we’ll let you know if your area and service are selected. You can still explore services and providers now.",
  },
  waiting: {
    title: "Booking is opening by invitation",
    body: "Your account is ready, but it hasn’t been invited to book yet, so no request can be sent from here. We’ll email you if your area and service are selected for a trial.",
  },
  revoked: {
    title: "Your invitation to book has ended",
    body: "New requests are closed for this account. Your existing requests, invoices and support history stay available from your dashboard.",
  },
  unavailable: {
    title: "Your invited service isn’t available right now",
    body: "The service or area in your invitation isn’t active at the moment, so new requests are closed. Your existing requests and support history stay available.",
  },
  not_homeowner: {
    title: "A homeowner account is needed to request service",
    body: "This account doesn’t have homeowner access. Booking is also opening by invitation, so homeowners join early access first.",
  },
  error: {
    title: "We couldn’t check your booking access",
    body: "Nothing was submitted. Try again in a moment. If this keeps happening, contact us.",
  },
};

export function BookingClosedState({ reason, serviceIds = [], onRetry, focusOnMount = true }: {
  reason: ClosedReason;
  serviceIds?: string[];
  onRetry?: () => void;
  focusOnMount?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (focusOnMount) heading.current?.focus(); }, [focusOnMount, reason]);
  const { title, body } = copy[reason];
  const Icon = reason === "error" ? CircleAlert : CalendarClock;
  const primary = "h-11 w-full sm:w-auto";

  let actions: ReactNode;
  if (reason === "error") {
    actions = <>
      <Button type="button" onClick={onRetry} className={primary}><RefreshCw aria-hidden="true" />Try again</Button>
      <Link href="/contact" className={cn(buttonVariants({ variant: "outline" }), primary)}>Contact us</Link>
    </>;
  } else if (reason === "signed_out" || reason === "not_homeowner") {
    actions = <>
      <Link href={earlyAccessHref(serviceIds)} className={cn(buttonVariants({ variant: "commitment" }), primary)}>{EARLY_ACCESS_CTA}</Link>
      <Link href="/services" className={cn(buttonVariants({ variant: "outline" }), primary)}>Browse services</Link>
    </>;
  } else if (reason === "waiting") {
    actions = <>
      <Link href="/dashboard" className={cn(buttonVariants({ variant: "commitment" }), primary)}>See my early-access status</Link>
      <Link href="/services" className={cn(buttonVariants({ variant: "outline" }), primary)}>Browse services</Link>
    </>;
  } else {
    actions = <>
      <Link href="/dashboard" className={cn(buttonVariants(), primary)}>Go to my dashboard</Link>
      <Link href="/contact" className={cn(buttonVariants({ variant: "outline" }), primary)}>Contact support</Link>
    </>;
  }

  return (
    <section aria-labelledby="booking-closed-heading" className="container-narrow px-4 py-12 sm:py-16">
      <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-status-info bg-status-info-bg px-3 py-1 text-sm font-medium text-status-info">
          <Icon aria-hidden="true" className="size-4" /> Lee County early access
        </p>
        <h1 id="booking-closed-heading" ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-3 text-base leading-7 text-muted-foreground">{body}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">{actions}</div>
        {reason === "signed_out" && (
          <p className="mt-6 border-t border-border pt-4 text-sm text-muted-foreground">
            Invited to book?{" "}
            <Link href="/login?redirect=%2Frequest" className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4">Sign in to request service</Link>
          </p>
        )}
      </div>
    </section>
  );
}
