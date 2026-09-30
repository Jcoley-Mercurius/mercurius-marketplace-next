"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, MapPin, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ServiceInterestPicker, useInterestCatalog, type InterestCatalog } from "@/components/early-access/ServiceInterestPicker";
import { useMyInterest } from "@/components/early-access/useMyInterest";
import { parseInterestView, type InterestView, type MyInterest } from "@/lib/earlyAccessExperience";
import { createClient } from "@/lib/supabase/client";

// TRACE-103 (R0.3): "Your interests" on the waiting home. Reads and saves only through the
// verified-account commands (TRACE-102). Never shows a queue position or invitation promise.
export function InterestsCard() {
  const { state, reload, replace } = useMyInterest();
  const catalog = useInterestCatalog();
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  const interest = state.status === "ready" && state.value.verified ? state.value.earlyAccess : null;
  const missing = state.status === "ready" && state.value.verified && (!interest || interest.status === "withdrawn");

  function saved(next: InterestView, message: string) {
    if (state.status === "ready" && state.value.verified) replace({ ...state.value, earlyAccess: next });
    else reload();
    setEditing(false);
    setNotice(message);
    heading.current?.focus();
  }

  async function leave() {
    const { data, error } = await createClient().rpc("r0_withdraw_my_interest", { p_kind: "early_access" });
    if (error) throw error;
    if (!["withdrawn", "withdrawn_held", "deidentified"].includes(String((data as { outcome?: unknown } | null)?.outcome))) {
      throw new Error("Withdrawal was not confirmed");
    }
    setEditing(false);
    setNotice("You’ve left the early-access list. You can join again at any time.");
    reload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle><h2 ref={heading} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold"><MapPin aria-hidden="true" className="size-4 text-sage-dark" />Your interests</h2></CardTitle>
        <CardDescription>Where and what you’d like to book when invitations reach your area.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p role="status" className={notice ? "rounded-lg bg-accent-soft px-3 py-2 text-sm text-commitment" : "sr-only"}>{notice}</p>
        {state.status === "loading" && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />Loading your interests…</p>}
        {state.status === "error" && (
          <div role="alert" className="space-y-2 text-sm">
            <p>Your early-access details couldn’t be loaded. Nothing has changed.</p>
            <Button type="button" variant="outline" size="sm" onClick={reload}><RefreshCw aria-hidden="true" />Try again</Button>
          </div>
        )}
        {state.status === "ready" && !state.value.verified && (
          <p className="text-sm">Verify your email address to add or change early-access interests. Open the verification link we sent, then sign in again.</p>
        )}
        {state.status === "ready" && state.value.verified && (
          <>
            {interest?.status === "active" && !editing && <InterestSummary interest={interest} catalog={catalog} />}
            {missing && !editing && (
              <div className="rounded-lg border border-dashed border-border p-4 text-sm">
                <p className="font-medium">{interest?.status === "withdrawn" ? "You’ve left the early-access list" : "Add your ZIP code and services"}</p>
                <p className="mt-1 text-muted-foreground">{interest?.status === "withdrawn"
                  ? "Join again to be considered when services open in your area."
                  : "Tell us where and what you’d like to book, so we can consider you when services open in your area."}</p>
              </div>
            )}
            <OutsideArea value={state.value} />
            {editing ? (
              <InterestEditor initial={interest?.status === "active" ? interest : null} catalog={catalog}
                onCancel={() => setEditing(false)} onSaved={(next) => saved(next, "Saved. Your early-access interests are up to date.")} />
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button type="button" variant={missing ? "commitment" : "outline"} className="h-11" onClick={() => { setNotice(""); setEditing(true); }}>
                  {missing ? (interest?.status === "withdrawn" ? "Join early access again" : "Add my interests") : "Update interests"}
                </Button>
                {interest?.status === "active" && (
                  <ConfirmAction triggerLabel="Leave the early-access list" title="Leave the early-access list?" entity="Early access"
                    consequence="You won’t be considered for a booking invitation or get early-access emails. Your account stays open."
                    confirmLabel="Leave the list" onConfirm={leave} />
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function serviceNames(ids: string[], catalog: InterestCatalog) {
  if (catalog.status !== "ready") return ids;
  return ids.map((id) => catalog.services.find((service) => service.id === id)?.name ?? id);
}

function InterestSummary({ interest, catalog }: { interest: InterestView; catalog: InterestCatalog }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">ZIP code</dt><dd className="font-medium">{interest.zipCode}</dd>
      <dt className="text-muted-foreground">Services</dt>
      <dd className="font-medium">{interest.stillExploring ? "Still exploring" : serviceNames(interest.serviceIds, catalog).join(", ")}</dd>
      {interest.firstName && <><dt className="text-muted-foreground">First name</dt><dd className="font-medium">{interest.firstName}</dd></>}
    </dl>
  );
}

function OutsideArea({ value }: { value: Extract<MyInterest, { verified: true }> }) {
  if (!value.expansion || value.expansion.status !== "active") return null;
  return <p className="text-sm text-muted-foreground">You’ve also told us you’d like Mercurius in {value.expansion.zipCode}, outside Lee County. That doesn’t make you eligible for an early-access invitation.</p>;
}

function InterestEditor({ initial, catalog, onCancel, onSaved }: {
  initial: InterestView | null;
  catalog: InterestCatalog;
  onCancel: () => void;
  onSaved: (interest: InterestView) => void;
}) {
  const [zipCode, setZipCode] = useState(initial?.zipCode ?? "");
  const [serviceIds, setServiceIds] = useState(initial?.serviceIds ?? []);
  const [stillExploring, setStillExploring] = useState(initial?.stillExploring ?? false);
  const [firstName, setFirstName] = useState(initial?.firstName ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const failureRef = useRef<HTMLParagraphElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  // Fields are disabled while saving, so focus moves to a field error once saving ends.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => { zipRef.current?.focus(); }, []);
  useEffect(() => { if (failure) failureRef.current?.focus(); }, [failure]);
  useEffect(() => {
    if (busy || !pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  }, [busy, errors]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!/^[0-9]{5}$/.test(zipCode)) next["interest-zip"] = "Enter a five-digit ZIP code.";
    if (!stillExploring && serviceIds.length === 0) next["interest-services"] = "Choose at least one service, or choose “I’m still exploring.”";
    setErrors(next);
    setFailure("");
    if (Object.keys(next).length) { pendingFocus.current = Object.keys(next)[0]; return; }
    setBusy(true);
    try {
      const { data, error } = await createClient().rpc("r0_save_my_interest", {
        p_kind: "early_access", p_first_name: firstName.trim() || null, p_zip: zipCode,
        p_service_ids: stillExploring ? [] : serviceIds, p_still_exploring: stillExploring,
      });
      if (error) {
        const code = (error as { code?: unknown }).code;
        setFailure(code === "42501" ? "Verify your email address before changing early-access interests. Nothing was saved."
          : code === "22023" ? `${error.message} Nothing was saved.` : "Your changes weren’t saved. Please try again.");
        return;
      }
      const result = (data ?? {}) as { outcome?: unknown; interest?: unknown };
      if (result.outcome === "boundary") {
        pendingFocus.current = "interest-zip";
        setErrors({ "interest-zip": "That ZIP code is outside Lee County, so it can’t be used for early access." });
        return;
      }
      if (result.outcome !== "saved") throw new Error("Save was not confirmed");
      onSaved(parseInterestView(result.interest));
    } catch {
      setFailure("We couldn’t confirm your changes were saved. Reload the page to check before trying again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate onSubmit={save} aria-label="Update early-access interests" aria-busy={busy} className="space-y-4">
      {failure && <p ref={failureRef} tabIndex={-1} role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">{failure}</p>}
      <FormField id="interest-zip" label="ZIP code" required help="Early access is for Lee County, Florida." error={errors["interest-zip"]}>
        {(control) => <Input {...control} ref={zipRef} inputMode="numeric" autoComplete="postal-code" maxLength={5} value={zipCode} disabled={busy}
          onChange={(event) => setZipCode(event.target.value.replace(/\D/g, "").slice(0, 5))} className="h-11 max-w-40" />}
      </FormField>
      <ServiceInterestPicker id="interest-services" catalog={catalog} selected={serviceIds} stillExploring={stillExploring} disabled={busy}
        error={errors["interest-services"]} onChange={(next) => { setServiceIds(next.serviceIds); setStillExploring(next.stillExploring); }} />
      <FormField id="interest-first-name" label="First name (optional)">
        {(control) => <Input {...control} autoComplete="given-name" maxLength={100} value={firstName} disabled={busy} onChange={(event) => setFirstName(event.target.value)} className="h-11" />}
      </FormField>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="commitment" className="h-11" disabled={busy}>{busy ? <><Loader2 aria-hidden="true" className="animate-spin" />Saving…</> : "Save interests"}</Button>
        <Button type="button" variant="ghost" className="h-11" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
