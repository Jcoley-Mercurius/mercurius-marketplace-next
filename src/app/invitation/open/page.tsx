"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  INVITATION_LINK_INVALID_MESSAGE,
  parseInvitationOpenRequest,
  type InvitationOpenRequest,
} from "@/lib/invitationOpenLink";

// DEC-2026-029 follow-up: the landing page for the link in a provider invitation email.
// Loading it spends nothing, so a mail scanner that opens the link cannot use it up; the
// Continue button asks the server for a fresh sign-in and moves on to the password step.
export default function InvitationOpenPage() {
  const [open, setOpen] = useState<InvitationOpenRequest | null>(null);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const timer = window.setTimeout(() => {
      setOpen(
        parseInvitationOpenRequest({
          invitation: params.get("invitation") ?? undefined,
          kind: params.get("kind") ?? undefined,
          key: params.get("key") ?? undefined,
        }),
      );
      setChecked(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function continueToPassword() {
    if (!open || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/invitations/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invitation: open.attempt,
          kind: open.source === "existing_provider" ? "existing_provider" : undefined,
          key: open.key,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { redirect?: unknown; error?: unknown };
      if (response.ok && typeof result.redirect === "string" && result.redirect.startsWith("/set-password?")) {
        window.location.assign(result.redirect);
        return;
      }
      if (response.status === 410) setInvalid(true);
      else setError(typeof result.error === "string" ? result.error : "Please try again in a few minutes.");
    } catch {
      setError("We couldn't reach Mercurius. Check your connection and try again.");
    }
    inFlight.current = false;
    setPending(false);
  }

  const existing = open?.source === "existing_provider";
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-screen items-center justify-center bg-muted p-4 sm:p-8"
    >
      <section
        aria-labelledby="invitation-open-title"
        className="w-full max-w-md space-y-6 rounded-xl border bg-card p-6 text-card-foreground"
      >
        <Link href="/" className="inline-flex items-center gap-2 font-semibold">
          <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          Mercurius
        </Link>
        <h1 id="invitation-open-title" className="text-2xl font-semibold">
          {existing ? "Set up access to your business profile" : "Set up your Mercurius provider account"}
        </h1>
        {!checked ? (
          <p role="status" className="flex items-center gap-2">
            <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
            Checking your invitation…
          </p>
        ) : !open || invalid ? (
          <div role="alert" className="space-y-3">
            <p>{open ? INVITATION_LINK_INVALID_MESSAGE : "This invitation link is incomplete. Open the link in your invitation email."}</p>
            <p>
              For a new invitation, contact Mercurius at{" "}
              <a className="font-medium text-accent hover:underline" href="mailto:hello@mercuriusmarketplace.com">
                hello@mercuriusmarketplace.com
              </a>{" "}
              or <a className="font-medium text-accent hover:underline" href="tel:+12393393895">239-339-3895</a>.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p>
              {existing
                ? "Continue to choose a password. Then you can confirm that you manage this business and set up its existing Mercurius profile."
                : "Continue to choose a password. Then you can accept your invitation and continue onboarding with Mercurius."}
            </p>
            <p className="text-sm text-muted-foreground">This link works until your invitation expires.</p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button
              variant="commitment"
              loading={pending}
              disabled={pending}
              onClick={() => void continueToPassword()}
            >
              {pending ? "Opening your invitation…" : "Continue"}
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
