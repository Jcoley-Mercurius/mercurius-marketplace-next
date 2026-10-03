"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

// TRACE-105 operator surface for an existing provider with no application: record the
// owner-confirmed contact, prepare and send access, reconcile, close, then bind the
// account that accepted. Every state shown is read back from the server. Sending is not
// mailbox delivery, and binding gives profile-setup access only: no approval, listing,
// eligibility or activation.

type Attempt = {
  attempt_id: string;
  mode: "new_account" | "existing_account";
  status: string;
  expires_at: string;
  expired: boolean;
  live: boolean;
  existing_account_id: string | null;
  dispatch_state: string | null;
  auth_user_id: string | null;
  refusal_code: string | null;
  accepted: boolean;
  accepted_at: string | null;
  accepted_by: string | null;
  accepted_account_confirmed: boolean;
  for_current_contact: boolean;
};

type Overview = {
  contractor_id: string;
  name: string;
  application_onboarding: boolean;
  excluded: boolean;
  account_linked: boolean;
  linked_user_id: string | null;
  bound_by_access: boolean;
  vendor_role_held: boolean;
  eligible: boolean;
  contact: { contact_id: string; email: string; confirmation: string; recorded_at: string } | null;
  attempt: Attempt | null;
  prior_attempts: { attempt_id: string; mode: string; status: string; created_at: string }[];
  bindings: { action: string; auth_user_id: string; vendor_role_changed: boolean; reason: string; created_at: string }[];
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function messageOf(value: unknown, fallback: string) {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    const { message } = value as { message?: unknown };
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

async function invocationError(error: unknown, data: unknown) {
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string")
    return (data as { error: string }).error;
  if (!error) return null;
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: unknown };
      if (typeof body?.error === "string") return body.error;
    } catch {
      // Fall through to the SDK message.
    }
  }
  return messageOf(error, "The invitation function returned an error.");
}

const when = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : "Not recorded");

export function attemptLabel(attempt: Attempt, boundUserId: string | null = null): string {
  if (attempt.status === "prepared")
    return attempt.mode === "existing_account"
      ? "Prepared for an existing account — waiting for the owner to sign in and accept"
      : "Prepared — nothing sent";
  if (attempt.status === "submitted")
    return attempt.dispatch_state === "provider_accepted"
      ? "Accepted by Auth for sending — mailbox delivery not confirmed"
      : "Send reserved — outcome not yet recorded";
  if (attempt.status === "unknown") return "Send result unknown — reconcile before any further action";
  if (attempt.status === "failed")
    return attempt.refusal_code === "email_exists"
      ? "Refused: the address already holds an account — nothing sent"
      : "Failed — nothing sent";
  if (attempt.status === "accepted")
    return boundUserId && attempt.accepted_by === boundUserId
      ? "Accepted by the recipient — account bound"
      : "Accepted by the recipient — awaiting reviewed binding";
  if (attempt.status === "expired") return "Expired without acceptance";
  if (attempt.status === "revoked") return "Revoked";
  return attempt.status;
}

export function ExistingProviderAccess({ contractorId }: { contractorId: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(false);
  const [email, setEmail] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [days, setDays] = useState("7");
  const [existingAccount, setExistingAccount] = useState("");
  const [reconcileAccount, setReconcileAccount] = useState("");
  // Binding is unique to an attempt. Repeatable commands retain their own keys
  // until readback confirms success, including the exact prepare expiry.
  const [nonce] = useState(() => crypto.randomUUID());
  const contactKey = useRef<string | null>(null);
  const releaseKey = useRef<string | null>(null);
  const preparation = useRef<{ key: string; expires: string } | null>(null);

  const read = useCallback(async () => {
    const { data, error } = await createClient().rpc("r0_provider_access_overview", { p_contractor: contractorId });
    if (error) throw error;
    return data as unknown as Overview;
  }, [contractorId]);

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      setOverview(await read());
    } catch (error) {
      setLoadError(messageOf(error, "Access status could not be loaded."));
    }
  }, [read]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const run = useCallback(
    async (call: () => Promise<string | null>, confirmed: (next: Overview) => boolean, success: string) => {
      setPending(true);
      try {
        const failure = await call();
        if (failure) throw new Error(failure);
        const next = await read();
        setOverview(next);
        if (!confirmed(next)) throw new Error("The server did not confirm this change. Review the current state before retrying.");
        toast.success(success);
      } catch (error) {
        toast.error("Access action could not be completed", { description: messageOf(error, "Please try again.") });
        void refresh();
        throw error;
      } finally {
        setPending(false);
      }
    },
    [read, refresh],
  );

  const rpc = (name: string, args: Record<string, unknown>) => async () => {
    const { error } = await createClient().rpc(name as never, args as never);
    return error ? error.message : null;
  };
  const edge = (body: Record<string, unknown>) => async () => {
    const { data, error } = await createClient().functions.invoke("vendor-invite", {
      body: { source: "existing_provider", ...body },
    });
    return invocationError(error, data);
  };

  if (loadError)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">{loadError}</p>
        <Button size="sm" variant="outline" onClick={() => void refresh()}><RefreshCw />Try again</Button>
      </div>
    );
  if (!overview)
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />Loading access status...
      </p>
    );
  if (overview.application_onboarding)
    return (
      <p className="text-sm leading-6 text-muted-foreground">
        This provider is under application onboarding. Use the invitation and account panels for its application.
      </p>
    );
  if (overview.excluded)
    return <p className="text-sm leading-6 text-muted-foreground">This provider is hidden as a test or excluded record and cannot receive access.</p>;

  const busy = pending;
  const attempt = overview.attempt;
  const bound = overview.bound_by_access;
  const trimmedEmail = email.trim();
  const expiryDays = Number(days);
  const expiryValid = Number.isInteger(expiryDays) && expiryDays >= 1 && expiryDays <= 30;
  const existingId = existingAccount.trim();
  const reconcileId = reconcileAccount.trim();
  const canPrepare = !!overview.contact && !overview.account_linked && !attempt?.live;

  return (
    <div className="space-y-5 text-sm">
      <section aria-labelledby={`access-contact-${contractorId}`} className="space-y-2">
        <h3 id={`access-contact-${contractorId}`} className="font-medium">Owner-confirmed contact</h3>
        {overview.contact ? (
          <p className="leading-6 text-muted-foreground">
            <span className="font-medium text-foreground">{overview.contact.email}</span> — {overview.contact.confirmation} (
            {when(overview.contact.recorded_at)})
          </p>
        ) : (
          <p className="text-muted-foreground">No confirmed contact yet. Access cannot be prepared without one.</p>
        )}
        {!overview.account_linked && !attempt?.live && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id={`access-email-${contractorId}`} label="Confirmed business email">
              {(control) => <Input {...control} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />}
            </FormField>
            <FormField id={`access-confirmation-${contractorId}`} label="Owner confirmation" help="Who confirmed this mapping and when.">
              {(control) => <Input {...control} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />}
            </FormField>
            <div className="sm:col-span-2">
              <ConfirmAction
                triggerLabel={overview.contact ? "Replace contact" : "Record contact"}
                title="Record the owner-confirmed contact"
                consequence="Access invitations for this provider will go only to this address. The provider's legacy active flag stops counting as approval."
                entity={overview.name}
                confirmLabel="Record contact"
                confirmationTone="commitment"
                requireReason
                disabled={busy || !trimmedEmail || !confirmation.trim()}
                onConfirm={(reason) =>
                  run(
                    rpc("r0_record_provider_contact", {
                      p_contractor: contractorId,
                      p_email: trimmedEmail,
                      p_confirmation: confirmation.trim(),
                      p_reason: reason,
                      p_key: (contactKey.current ??= `provider-contact:${crypto.randomUUID()}`),
                    }),
                    (next) => next.contact?.email === trimmedEmail.toLowerCase(),
                    "Contact recorded",
                  ).then(() => { contactKey.current = null; })
                }
              />
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby={`access-state-${contractorId}`} className="space-y-3">
        <h3 id={`access-state-${contractorId}`} className="font-medium">Access</h3>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{bound ? "Bound — profile setup access" : overview.account_linked ? "Linked outside this path" : "No account bound"}</Badge>
          <Badge variant="outline">{overview.eligible ? "Eligible for matching" : "Not approved or eligible"}</Badge>
        </div>
        {attempt && (
          <div className="rounded-lg border border-border p-3" role="status">
            <p className="font-medium">{attemptLabel(attempt, overview.bound_by_access ? overview.linked_user_id : null)}</p>
            <p className="mt-1 text-muted-foreground">
              {attempt.mode === "existing_account" ? `Existing account ${attempt.existing_account_id}` : "New account"} · expires{" "}
              {when(attempt.expires_at)}
              {attempt.expired && attempt.live ? " (expired)" : ""}
            </p>
            {attempt.mode === "existing_account" && attempt.status === "prepared" && attempt.live && !attempt.expired && (
              <FormField id={`access-url-${contractorId}`} label="Acceptance URL" help="Share this link with the owner to sign in and accept.">
                {(control) => (
                  <Input
                    {...control}
                    readOnly
                    value={`${window.location.origin}/invitation?attempt=${encodeURIComponent(attempt.attempt_id)}&kind=existing_provider`}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                )}
              </FormField>
            )}
          </div>
        )}

        {canPrepare && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id={`access-days-${contractorId}`} label="Invitation expiry (days)" help="1 to 30. The emailed link itself lasts 3 hours.">
              {(control) => <Input {...control} inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />}
            </FormField>
            <FormField id={`access-account-${contractorId}`} label="Existing account ID (optional)" help="Only when the owner already has a confirmed account at this address.">
              {(control) => <Input {...control} value={existingAccount} onChange={(event) => setExistingAccount(event.target.value)} />}
            </FormField>
            <div className="sm:col-span-2">
              <Button
                variant="outline"
                disabled={busy || !expiryValid || (!!existingId && !uuidPattern.test(existingId))}
                onClick={() => {
                  const operation = preparation.current ??= {
                    key: `provider-access:${crypto.randomUUID()}`,
                    expires: new Date(Date.now() + expiryDays * 86_400_000).toISOString(),
                  };
                  void run(
                    edge({
                      action: "prepare",
                      contractor_id: contractorId,
                      business_key: operation.key,
                      expires_at: operation.expires,
                      ...(existingId ? { existing_account_id: existingId } : {}),
                    }),
                    (next) => next.attempt?.live === true,
                    "Access prepared. Nothing has been sent.",
                  ).then(() => { preparation.current = null; }).catch(() => undefined);
                }}
              >
                Prepare access
              </Button>
            </div>
          </div>
        )}

        {attempt?.status === "prepared" && attempt.mode === "new_account" && !attempt.expired && (
          <ConfirmAction
            triggerLabel="Send access invitation"
            title="Send the access invitation"
            consequence={`Supabase Auth will email ${overview.contact?.email ?? "the confirmed contact"} a link to set a password. It is sent once; an uncertain result must be reconciled, never resent.`}
            entity={overview.name}
            confirmLabel="Send invitation"
            confirmationTone="commitment"
            disabled={busy}
            onConfirm={() =>
              run(edge({ action: "send", attempt_id: attempt.attempt_id }), (next) => next.attempt?.attempt_id === attempt.attempt_id && next.attempt.status !== "prepared", "Sent to Auth. Mailbox delivery is not confirmed.")
            }
          />
        )}

        {attempt && (attempt.status === "unknown" || (attempt.status === "submitted" && attempt.dispatch_state !== "provider_accepted")) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id={`access-reconcile-${contractorId}`} label="Auth account ID" help="From the Auth dashboard, for this exact address.">
              {(control) => <Input {...control} value={reconcileAccount} onChange={(event) => setReconcileAccount(event.target.value)} />}
            </FormField>
            <div className="flex flex-wrap items-end gap-2">
              <Button variant="outline" disabled={busy || !uuidPattern.test(reconcileId)} onClick={() => void run(edge({ action: "reconcile", attempt_id: attempt.attempt_id, auth_user_id: reconcileId }), (next) => next.attempt?.dispatch_state === "provider_accepted", "Reconciled as accepted by Auth.").catch(() => undefined)}>
                Record as invited
              </Button>
              <Button variant="outline" disabled={busy || !uuidPattern.test(reconcileId)} onClick={() => void run(edge({ action: "refuse", attempt_id: attempt.attempt_id, auth_user_id: reconcileId }), (next) => next.attempt?.status === "failed", "Recorded as refused; nothing was sent.").catch(() => undefined)}>
                Record as refused (existing account)
              </Button>
            </div>
          </div>
        )}

        {attempt && ["prepared", "submitted"].includes(attempt.status) && attempt.dispatch_state !== "started" && attempt.dispatch_state !== "unknown" && (
          <ConfirmAction
            triggerLabel={attempt.expired ? "Record expiry" : "Revoke access invitation"}
            title={attempt.expired ? "Record that the invitation expired" : "Revoke the access invitation"}
            consequence="The link can no longer be accepted. A new invitation can be prepared afterwards."
            entity={overview.name}
            confirmLabel={attempt.expired ? "Record expiry" : "Revoke"}
            requireReason
            disabled={busy}
            onConfirm={(reason) =>
              run(edge({ action: "close", attempt_id: attempt.attempt_id, status: attempt.expired ? "expired" : "revoked", reason }), (next) => next.attempt?.live === false, "Access invitation closed.")
            }
          />
        )}

        {attempt?.status === "accepted" && !overview.account_linked && (
          <ConfirmAction
            triggerLabel="Bind accepted account"
            title="Bind the accepted account to this profile"
            consequence="The database re-checks the account, its confirmed email, the contact and the receipt, links the account and grants vendor portal access for profile setup. It does not approve, list, activate or make the provider eligible for work."
            entity={overview.name}
            confirmLabel="Bind account"
            confirmationTone="commitment"
            requireReason
            disabled={busy || !attempt.accepted_account_confirmed || !attempt.for_current_contact}
            onConfirm={(reason) =>
              run(
                rpc("r0_bind_provider_access", {
                  p_contractor: contractorId,
                  p_attempt: attempt.attempt_id,
                  p_reason: reason,
                  p_key: `provider-access-bind:${nonce}:${attempt.attempt_id}`,
                }),
                (next) => next.bound_by_access,
                "Account bound for profile setup.",
              )
            }
          />
        )}

        {bound && (
          <ConfirmAction
            triggerLabel="Release binding"
            title="Release this account binding"
            consequence="The account loses access to this profile. A vendor role granted by the binding is removed. History is kept."
            entity={overview.name}
            confirmLabel="Release"
            requireReason
            disabled={busy}
            onConfirm={(reason) =>
              run(
                rpc("r0_release_provider_access", { p_contractor: contractorId, p_reason: reason, p_key: (releaseKey.current ??= `provider-access-release:${crypto.randomUUID()}`) }),
                (next) => !next.account_linked,
                "Binding released.",
              ).then(() => { releaseKey.current = null; })
            }
          />
        )}
      </section>

      {(overview.prior_attempts.length > 0 || overview.bindings.length > 0) && (
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer font-medium">History</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {overview.bindings.map((binding) => (
              <li key={binding.created_at + binding.action}>
                {when(binding.created_at)} — {binding.action === "bind" ? "Bound" : "Released"} {binding.auth_user_id}: {binding.reason}
              </li>
            ))}
            {overview.prior_attempts.map((prior) => (
              <li key={prior.attempt_id}>
                {when(prior.created_at)} — {prior.mode === "existing_account" ? "Existing-account" : "New-account"} attempt {prior.status}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
