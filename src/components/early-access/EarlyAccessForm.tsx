"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { IntakeTrapField, useIntakeGuard } from "@/components/marketing/IntakeGuard";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormErrorSummary, FormErrorsContext, type FormErrors } from "@/components/ui/form-errors";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ServiceInterestPicker, useInterestCatalog } from "@/components/early-access/ServiceInterestPicker";
import { EARLY_ACCESS_EMAIL_KEY, joinOutcome, type InterestKind } from "@/lib/earlyAccessExperience";
import { cn } from "@/lib/utils";

type Phase =
  | { kind: "editing" }
  | { kind: "submitting" }
  | { kind: "saved"; interestKind: InterestKind; zipCode: string }
  | { kind: "boundary"; zipCode: string }
  | { kind: "refused" }
  | { kind: "not_saved" }
  | { kind: "unconfirmed" };

type Payload = {
  kind: InterestKind;
  email: string;
  first_name: string | null;
  zip_code: string;
  service_ids: string[];
  still_exploring: boolean;
  marketing_opt_in: boolean;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIMEOUT_MS = 15_000;

// TRACE-103 (R0.3): the approved early-access form and result. The TRACE-102 route owns the
// Lee County boundary, deduplication, consent and limits; a duplicate address gets the same
// saved answer, so this page never reveals whether someone already joined or has an account.
export function EarlyAccessForm({ preselected }: { preselected: string[] }) {
  const { user } = useAuth();
  const catalog = useInterestCatalog();
  const { trapRef, intakePayload } = useIntakeGuard();
  const [email, setEmail] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [firstName, setFirstName] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [stillExploring, setStillExploring] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });
  const [message, setMessage] = useState("");
  const lastPayload = useRef<Payload | null>(null);
  const inFlight = useRef(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  // Keep only preselected services that exist in the live catalog.
  const known = useMemo(() => new Set(catalog.status === "ready" ? catalog.services.map((service) => service.id) : []), [catalog]);
  const appliedPreselection = useRef(false);
  useEffect(() => {
    if (appliedPreselection.current || catalog.status !== "ready") return;
    appliedPreselection.current = true;
    const valid = preselected.filter((id) => known.has(id));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (valid.length) setServiceIds(valid);
  }, [catalog.status, known, preselected]);

  useEffect(() => {
    if (phase.kind === "saved") resultHeading.current?.focus();
    else if (["boundary", "refused", "not_saved", "unconfirmed"].includes(phase.kind)) alertRef.current?.focus();
  }, [phase]);

  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!EMAIL.test(email.trim()) || email.trim().length > 254) next["ea-email"] = "Enter a valid email address.";
    if (!/^[0-9]{5}$/.test(zipCode.trim())) next["ea-zip"] = "Enter a five-digit ZIP code.";
    if (!stillExploring && serviceIds.length === 0) next["ea-services"] = "Choose at least one service, or choose “I’m still exploring.”";
    if (firstName.trim().length > 100) next["ea-first-name"] = "First name must be 100 characters or fewer.";
    return next;
  }

  async function send(payload: Payload) {
    if (inFlight.current) return;
    inFlight.current = true;
    lastPayload.current = payload;
    setPhase({ kind: "submitting" });
    setMessage("");
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, intake: intakePayload() }),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      const outcome = joinOutcome(response.status, body);
      switch (outcome.kind) {
        case "saved":
          try { window.sessionStorage.setItem(EARLY_ACCESS_EMAIL_KEY, payload.email); } catch { /* The account step works without the prefill. */ }
          setPhase({ kind: "saved", interestKind: outcome.interestKind, zipCode: payload.zip_code });
          break;
        case "boundary":
          setPhase({ kind: "boundary", zipCode: payload.zip_code });
          break;
        case "invalid":
          setMessage(outcome.message);
          setPhase({ kind: "not_saved" });
          break;
        default:
          setPhase({ kind: outcome.kind });
      }
    } catch {
      // No answer: the interest may or may not have been saved. A repeat is safe because the
      // same email never creates a second entry.
      setPhase({ kind: "unconfirmed" });
    } finally {
      window.clearTimeout(timer);
      inFlight.current = false;
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = validate();
    setErrors(next);
    if (Object.keys(next).length) return;
    void send({
      kind: "early_access",
      email: email.trim().toLowerCase(),
      first_name: firstName.trim() || null,
      zip_code: zipCode.trim(),
      service_ids: stillExploring ? [] : serviceIds,
      still_exploring: stillExploring,
      marketing_opt_in: marketing,
    });
  }

  if (phase.kind === "saved") return <SavedResult phase={phase} headingRef={resultHeading} />;

  const busy = phase.kind === "submitting";
  const zipBoundary = phase.kind === "boundary";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-lg sm:p-8">
      <h2 id="early-access-form-heading" className="text-2xl font-semibold tracking-tight">Join early access</h2>
      <p className="mt-2 text-sm text-muted-foreground">No password or payment needed. Fields marked required must be filled in.</p>
      {user && (
        <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">
          You’re signed in. You can also update your interests from{" "}
          <Link href="/dashboard" className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">your dashboard</Link>.
        </p>
      )}

      <div aria-live="polite" className="sr-only">{busy ? "Saving your interest…" : ""}</div>

      {zipBoundary && (
        <div ref={alertRef} tabIndex={-1} role="alert" className="mt-5 rounded-xl border border-status-warning bg-status-warning-bg p-4 text-sm text-status-warning">
          <p className="font-semibold">That ZIP code is outside Lee County</p>
          <p className="mt-1">Mercurius is opening in Lee County, Florida first, so {phase.zipCode} isn’t eligible for early access or a booking invitation. You can tell us you’d like Mercurius in your area instead. Nothing has been saved yet.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="h-11" onClick={() => lastPayload.current && void send({ ...lastPayload.current, kind: "expansion" })}>Save interest for my area</Button>
            <Button type="button" variant="ghost" className="h-11" onClick={() => { setPhase({ kind: "editing" }); document.getElementById("ea-zip")?.focus(); }}>Change ZIP code</Button>
          </div>
        </div>
      )}
      {(phase.kind === "refused" || phase.kind === "not_saved" || phase.kind === "unconfirmed") && (
        <div ref={alertRef} tabIndex={-1} role="alert" className="mt-5 rounded-xl border border-status-danger bg-status-danger-bg p-4 text-sm text-status-danger">
          <p className="flex items-center gap-2 font-semibold"><CircleAlert aria-hidden="true" className="size-4 shrink-0" />{
            phase.kind === "unconfirmed" ? "We couldn’t confirm your submission" : phase.kind === "refused" ? "We couldn’t accept this right now" : "Your interest was not saved"
          }</p>
          <p className="mt-1">{
            phase.kind === "unconfirmed"
              ? "The connection ended before we heard back, so we can’t say whether you joined. Checking again is safe: the same email is never added twice."
              : phase.kind === "refused"
                ? "Please wait a few minutes and try again. Your answers are still here."
                : message || "Nothing was confirmed. Your answers are still here; please try again."
          }</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            {phase.kind === "unconfirmed" && (
              <Button type="button" variant="outline" className="h-11" onClick={() => lastPayload.current && void send(lastPayload.current)}><RefreshCw aria-hidden="true" />Check submission</Button>
            )}
            <Link href="/contact" className="inline-flex min-h-11 items-center font-medium underline underline-offset-4">Contact us</Link>
          </div>
        </div>
      )}

      <FormErrorsContext.Provider value={errors}>
        <form noValidate onSubmit={submit} aria-labelledby="early-access-form-heading" aria-busy={busy} className="mt-6 space-y-5">
          <FormErrorSummary errors={errors} />
          <IntakeTrapField inputRef={trapRef} />
          <FormField id="ea-email" label="Email address" required>
            {(control) => <Input {...control} type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={busy} className="h-11" />}
          </FormField>
          <FormField id="ea-zip" label="ZIP code" required help="Early access is for Lee County, Florida." error={zipBoundary ? "This ZIP code is outside Lee County." : undefined}>
            {(control) => <Input {...control} aria-invalid={zipBoundary || control["aria-invalid"] ? true : undefined} inputMode="numeric" autoComplete="postal-code" maxLength={5} value={zipCode} onChange={(event) => { setZipCode(event.target.value.replace(/\D/g, "").slice(0, 5)); if (zipBoundary) setPhase({ kind: "editing" }); }} disabled={busy} className="h-11 max-w-40" />}
          </FormField>
          <ServiceInterestPicker
            id="ea-services"
            catalog={catalog}
            selected={serviceIds}
            stillExploring={stillExploring}
            disabled={busy}
            error={errors["ea-services"]}
            onChange={(next) => { setServiceIds(next.serviceIds); setStillExploring(next.stillExploring); }}
          />
          <FormField id="ea-first-name" label="First name (optional)">
            {(control) => <Input {...control} autoComplete="given-name" maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} disabled={busy} className="h-11" />}
          </FormField>
          <div className="rounded-xl border border-border p-3">
            <Checkbox label="Also send me Mercurius news, offers and product updates (optional)" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} disabled={busy} aria-describedby="ea-marketing-help" />
            <p id="ea-marketing-help" className="pl-8 text-xs text-muted-foreground">Separate from early access. You can unsubscribe at any time.</p>
          </div>
          <Button type="submit" variant="commitment" size="lg" className="h-12 w-full text-base" disabled={busy} aria-describedby="ea-joining-note">
            {busy ? <><Loader2 aria-hidden="true" className="animate-spin" />Saving…</> : "Join early access"}
          </Button>
          <p id="ea-joining-note" className="text-sm text-muted-foreground">
            Joining does not create a service request or guarantee an invitation.{" "}
            <Link href="/privacy" className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4">Privacy policy</Link>
          </p>
        </form>
      </FormErrorsContext.Provider>
    </div>
  );
}

function SavedResult({ phase, headingRef }: { phase: Extract<Phase, { kind: "saved" }>; headingRef: React.RefObject<HTMLHeadingElement | null> }) {
  const expansion = phase.interestKind === "expansion";
  return (
    <section aria-labelledby="early-access-result-heading" className="rounded-2xl border border-accent-border bg-card p-5 text-card-foreground shadow-lg sm:p-8">
      <div role="status" className="sr-only">{expansion ? "Your interest in your area was saved." : "Your early-access interest was saved."}</div>
      <CheckCircle2 aria-hidden="true" className="mb-4 size-9 text-sage-dark" />
      <h2 id="early-access-result-heading" ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight">
        {expansion ? "We’ve saved your interest in your area." : "You’re on the early-access list."}
      </h2>
      {expansion ? (
        <p className="mt-3 leading-7 text-muted-foreground">
          Mercurius is opening in Lee County, Florida first. We’ve noted that you’d like us in {phase.zipCode}. This doesn’t make you eligible for an early-access invitation, and it didn’t book a service.
        </p>
      ) : (
        <>
          <p className="mt-3 leading-7 text-muted-foreground">
            We’ll invite homeowners in stages when services are ready in their area. Joining did not book a service.
          </p>
          <div className="mt-5 rounded-xl bg-muted p-4 text-sm">
            <p className="font-medium">Optional: create an account</p>
            <p className="mt-1 text-muted-foreground">Keep your account ready and see your early-access status. You don’t need an account to stay on the list, and creating one doesn’t move you up or guarantee an invitation.</p>
          </div>
        </>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        {!expansion && <Link href="/register?from=early-access" className={cn(buttonVariants({ variant: "commitment", size: "lg" }), "h-12")}>Create my account</Link>}
        <Link href="/services" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-12")}>Continue exploring</Link>
      </div>
    </section>
  );
}
