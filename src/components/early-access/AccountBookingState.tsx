"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarCheck, CalendarClock, CircleAlert, Compass, Loader2, LogOut, Plus, RefreshCw, Settings } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InterestsCard } from "@/components/early-access/InterestsCard";
import { activeCells, describeCells, type BookingState, type TrialAccess } from "@/lib/earlyAccessExperience";
import { cn } from "@/lib/utils";

// TRACE-103 (R0.3): signed-in account states from HOMEOWNER-EARLY-ACCESS-EXPERIENCE §3.
// Nothing here opens booking; it presents the R0.1 admission readback.

const waitingCopy: Record<Exclude<BookingState, "invited">, { label: string; body: string; next: string }> = {
  waiting: {
    label: "Early access · Waiting for an invitation",
    body: "Booking is opening in stages across Lee County.",
    next: "We’ll email you if your area and service are selected for a trial. Your account is ready; no booking is active.",
  },
  revoked: {
    label: "Early access · Invitation ended",
    body: "Your invitation to book has ended, so new requests are closed for this account.",
    next: "You can keep your interests up to date. Contact us if you have questions about your invitation. No booking is active.",
  },
  unavailable: {
    label: "Early access · Invited service not available",
    body: "The service or area in your invitation isn’t active right now, so new requests are closed.",
    next: "We’ll email you if it opens again. You can update your interests or contact us in the meantime. No booking is active.",
  },
};

export function WaitingHome({ booking, firstName }: { booking: Exclude<BookingState, "invited">; firstName: string }) {
  const copy = waitingCopy[booking];
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Homeowner account</p>
        <h1 id="homeowner-dashboard-heading" tabIndex={-1} className="mt-2 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">Welcome, {firstName}</h1>
      </header>
      <section aria-labelledby="early-access-status" className="rounded-2xl border border-status-info bg-status-info-bg p-5 text-status-info sm:p-6">
        <p id="early-access-status" className="flex items-center gap-2 text-lg font-semibold"><CalendarClock aria-hidden="true" className="size-5 shrink-0" />{copy.label}</p>
        <p className="mt-1">{copy.body}</p>
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <InterestsCard />
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle><h2 className="flex items-center gap-2 text-base font-semibold"><Compass aria-hidden="true" className="size-4 text-sage-dark" />Explore</h2></CardTitle>
              <CardDescription>See the services and approved local providers Mercurius works with.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 sm:flex-row">
              <Link href="/services" className={cn(buttonVariants({ variant: "outline" }), "h-11")}>Browse services</Link>
              <Link href="/providers" className={cn(buttonVariants({ variant: "outline" }), "h-11")}>Explore providers</Link>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle><h2 className="text-base font-semibold">Next steps</h2></CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>{copy.next}</p>
              {booking !== "waiting" && <Link href="/contact" className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">Contact us</Link>}
            </CardContent>
          </Card>
          <AccountCard />
        </div>
      </div>
    </div>
  );
}

function AccountCard() {
  const { signOut } = useAuth();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <Card>
      <CardHeader><CardTitle><h2 className="text-base font-semibold">Account</h2></CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Link href="/account" className={cn(buttonVariants({ variant: "outline" }), "h-11")}><Settings aria-hidden="true" />Profile settings</Link>
        <Link href="/account#email-preferences" className={cn(buttonVariants({ variant: "outline" }), "h-11")}>Email preferences</Link>
        <Button type="button" variant="ghost" className="h-11" disabled={signingOut} onClick={async () => {
          setSigningOut(true);
          try { await signOut(); router.replace("/login"); router.refresh(); } finally { setSigningOut(false); }
        }}>{signingOut ? <Loader2 aria-hidden="true" className="animate-spin" /> : <LogOut aria-hidden="true" />}Sign out</Button>
      </CardContent>
    </Card>
  );
}

export function InvitedBanner({ access }: { access: TrialAccess }) {
  return (
    <section aria-labelledby="invited-status" className="mb-6 flex flex-col gap-4 rounded-2xl border border-status-success bg-status-success-bg p-5 text-status-success sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p id="invited-status" className="flex items-center gap-2 text-lg font-semibold"><CalendarCheck aria-hidden="true" className="size-5 shrink-0" />Invited to book</p>
        <p className="mt-1">Your invitation covers {describeCells(activeCells(access))}.</p>
      </div>
      <Link href="/request" className={cn(buttonVariants({ variant: "commitment" }), "h-11 w-full shrink-0 sm:w-auto")}><Plus aria-hidden="true" />Request a service</Link>
    </section>
  );
}

const closedCopy: Record<Exclude<BookingState, "invited">, string> = {
  waiting: "Booking is opening by invitation, so new requests are closed for now. Your existing services, invoices and support history are below.",
  revoked: "Your invitation to book has ended, so new requests and payments are closed. Your existing services, invoices and support history are below.",
  unavailable: "The service or area in your invitation isn’t active right now, so new requests are closed. Your existing services, invoices and support history are below.",
};

export function ClosedBookingBanner({ booking }: { booking: Exclude<BookingState, "invited"> }) {
  return (
    <section aria-labelledby="closed-status" className="mb-6 rounded-2xl border border-status-info bg-status-info-bg p-5 text-status-info">
      <p id="closed-status" className="flex items-center gap-2 font-semibold"><CalendarClock aria-hidden="true" className="size-5 shrink-0" />New bookings are closed for your account</p>
      <p className="mt-1 text-sm">{closedCopy[booking]}</p>
      <Link href="/contact" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">Contact support</Link>
    </section>
  );
}

export function AccessCheckFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <section role="alert" className="mb-6 flex flex-col gap-3 rounded-2xl border border-status-warning bg-status-warning-bg p-5 text-status-warning sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="flex items-center gap-2 font-semibold"><CircleAlert aria-hidden="true" className="size-5 shrink-0" />We couldn’t check your booking access</p>
        <p className="mt-1 text-sm">Requesting service is unavailable until we can. Your existing records aren’t affected.</p>
      </div>
      <Button type="button" variant="outline" className="h-11 shrink-0" onClick={onRetry}><RefreshCw aria-hidden="true" />Try again</Button>
    </section>
  );
}
