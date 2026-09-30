"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button, buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function InvitationPage() {
  const { user, loading } = useAuth();
  const [attempt, setAttempt] = useState<string | null>(null);
  // TRACE-105: access to an existing business profile, not an application invitation.
  const [existing, setExisting] = useState(false);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("attempt");
    const timer = window.setTimeout(() => {
      setExisting(params.get("kind") === "existing_provider");
      setAttempt(
        id &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id,
          )
          ? id
          : null,
      );
      setChecked(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  async function accept() {
    if (!attempt || !user || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const result = await createClient().functions.invoke("vendor-invite", {
        body: existing
          ? { action: "accept", source: "existing_provider", attempt_id: attempt }
          : { action: "accept", attempt_id: attempt },
      });
      if (result.error || result.data?.status !== "accepted") throw new Error();
      setAccepted(true);
    } catch {
      setError(
        existing
          ? "Your access could not be confirmed. Check that you signed in with the email address that received this invitation. If the invitation expired, contact Mercurius at hello@mercuriusmarketplace.com for a new one."
          : "Your invitation could not be accepted. Check that you signed in with the invited email address. If the link expired or your application changed, contact Mercurius for review.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-screen items-center justify-center bg-muted p-4 sm:p-8"
    >
      <section
        aria-labelledby="invitation-title"
        className="w-full max-w-md space-y-6 rounded-xl border bg-card p-6 text-card-foreground"
      >
        <Link href="/" className="inline-flex items-center gap-2 font-semibold">
          <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          Mercurius
        </Link>
        <h1 id="invitation-title" className="text-2xl font-semibold">
          {accepted
            ? "Invitation accepted"
            : existing
              ? "Confirm access to your business profile"
              : "Accept your provider invitation"}
        </h1>
        {loading || !checked ? (
          <p role="status" className="flex items-center gap-2">
            <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
            Checking your invitation…
          </p>
        ) : !attempt ? (
          <p role="alert">
            This invitation link is incomplete. Open the link in your invitation
            email or contact Mercurius.
          </p>
        ) : accepted ? (
          <div role="status" className="space-y-4">
            {existing ? (
              <p>
                Your acceptance has been recorded. Mercurius will confirm the
                connection to your business profile, then you can sign in to set
                it up. Profile setup is separate from compliance approval and does
                not list your business or make it eligible for work.
              </p>
            ) : (
              <p>
                Your acceptance has been recorded. Provider access and activation
                still require a separate onboarding review.
              </p>
            )}
            <Link href="/" className={buttonVariants({ variant: "outline" })}>
              Return to Mercurius
            </Link>
          </div>
        ) : !user ? (
          <div className="space-y-4">
            <p>Sign in with the email address that received this invitation.</p>
            <Link
              href={`/login?redirect=${encodeURIComponent(`/invitation?attempt=${attempt}${existing ? "&kind=existing_provider" : ""}`)}`}
              className={buttonVariants({ variant: "commitment" })}
            >
              Sign in to continue
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {existing ? (
              <p>
                Accept to confirm that you manage this business and want access
                to its existing Mercurius profile. This records your acceptance;
                it does not approve your business, list it publicly or make it
                eligible for work.
              </p>
            ) : (
              <p>
                Accept this invitation to continue onboarding with Mercurius. This
                records your acceptance; it does not approve your application or
                activate your provider account.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              variant="commitment"
              loading={pending}
              disabled={pending}
              onClick={() => void accept()}
            >
              {pending ? "Recording acceptance…" : "Accept invitation"}
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
