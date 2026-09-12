"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

// TRACE-066 operator surface over the TRACE-053/063 invitation commands. Every
// decision is the server's: this panel reads state back and reports it. Preparing,
// dispatching, reconciling or closing an invitation grants no role, links no
// account and activates no provider.

type Attempt = {
  attempt_id: string;
  status: string;
  expires_at: string;
  created_at: string;
  expired: boolean;
  live: boolean;
  dispatch_state: string | null;
  auth_user_id: string | null;
  accepted: boolean;
};

type PriorAttempt = {
  attempt_id: string;
  status: string;
  expires_at: string;
  created_at: string;
};

type Overview = {
  contractor_id: string;
  onboarding_status: string;
  onboarding_revision: number;
  application_version_id: string;
  version_current: boolean;
  recipient_email: string | null;
  recipient_valid: boolean;
  account_linked: boolean;
  attempt: Attempt | null;
  prior_attempts: PriorAttempt[];
};

type Action = "prepare" | "send" | "reconcile" | "close";

const attemptLabel: Record<string, string> = {
  prepared: "Prepared, not sent",
  submitted: "Dispatch reserved",
  unknown: "Provider result unknown",
  delivered: "Recorded as delivered",
  accepted: "Accepted by recipient",
  failed: "Failed",
  expired: "Expired",
  revoked: "Revoked",
};

const dispatchLabel: Record<string, string> = {
  started: "Reserved before the Auth call",
  unknown: "Unknown — reconcile before any further dispatch",
  provider_accepted: "Auth accepted the invitation (delivery not asserted)",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function invocationError(error: unknown, data: unknown) {
  if (isRecord(data) && typeof data.error === "string") return data.error;
  if (!error) return null;
  if (isRecord(error) && error.context instanceof Response) {
    try {
      const body = (await error.context.clone().json()) as unknown;
      if (isRecord(body) && typeof body.error === "string") return body.error;
    } catch {
      // Fall through to the SDK error message.
    }
  }
  return error instanceof Error
    ? error.message
    : "The invitation function returned an error.";
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Not recorded"
    : parsed.toLocaleString();
}

export function VendorInvitation({
  contractorId,
  businessName,
  disabled = false,
}: {
  contractorId: string;
  businessName: string;
  disabled?: boolean;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  // Operator-entered expiry. There is no default: an invitation lifetime is an
  // operational decision, not something this panel may invent.
  const [expiry, setExpiry] = useState("");
  const [authUserId, setAuthUserId] = useState("");
  // One nonce per opened provider, so retrying the same expiry replays the same
  // preparation instead of racing a second attempt.
  const [nonce] = useState(() => crypto.randomUUID());

  const read = useCallback(async () => {
    const { data, error } = await createClient().rpc(
      "vendor_invitation_overview",
      { p_contractor: contractorId },
    );
    if (error) throw error;
    return data as unknown as Overview;
  }, [contractorId]);

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      setOverview(await read());
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Invitation status could not be loaded.",
      );
    }
  }, [read]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const expiryIso = useMemo(() => {
    if (!expiry) return null;
    const parsed = new Date(expiry);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }, [expiry]);
  const expiryError = !expiry
    ? ""
    : !expiryIso
      ? "Enter a valid date and time."
      : new Date(expiryIso) <= new Date()
        ? "Enter an expiry in the future."
        : "";
  const businessKey = expiryIso
    ? `invitation:${nonce}:${expiryIso}`
    : null;

  // Run one command, then take the server's word for what happened.
  const run = useCallback(
    async (
      action: Action,
      body: Record<string, unknown>,
      confirmed: (next: Overview) => boolean,
      success: { title: string; description: string },
    ) => {
      setPending(action);
      try {
        const { data, error } = await createClient().functions.invoke(
          "vendor-invite",
          { body: { action, ...body } },
        );
        const failure = await invocationError(error, data);
        if (failure) throw new Error(failure);
        const next = await read();
        setOverview(next);
        if (!confirmed(next)) {
          throw new Error(
            "The server did not confirm this invitation change. Review the current state before retrying.",
          );
        }
        toast.success(success.title, { description: success.description });
      } catch (error) {
        toast.error("Invitation action could not be completed", {
          description:
            error instanceof Error ? error.message : "Please try again.",
        });
        void refresh();
        throw error;
      } finally {
        setPending(null);
      }
    },
    [read, refresh],
  );

  const prepare = async () => {
    if (!expiryIso || !businessKey) return;
    await run(
      "prepare",
      {
        contractor_id: contractorId,
        business_key: businessKey,
        expires_at: expiryIso,
      },
      (next) => next.attempt?.status === "prepared",
      {
        title: "Invitation prepared",
        description:
          "No email was sent. Dispatch is a separate reviewed action.",
      },
    );
  };

  const send = async (attemptId: string) => {
    await run(
      "send",
      { attempt_id: attemptId },
      (next) => next.attempt?.dispatch_state === "provider_accepted",
      {
        title: "Auth accepted the invitation",
        description:
          "Mailbox delivery is not asserted and no provider was activated.",
      },
    );
  };

  const reconcile = async (attemptId: string) => {
    await run(
      "reconcile",
      { attempt_id: attemptId, auth_user_id: authUserId.trim() },
      (next) => next.attempt?.dispatch_state === "provider_accepted",
      {
        title: "Invitation reconciled",
        description:
          "The Auth identity was verified against the recorded recipient.",
      },
    );
    setAuthUserId("");
  };

  const close = (attemptId: string, status: "revoked" | "expired") =>
    async (reason: string) => {
      await run(
        "close",
        { attempt_id: attemptId, status, reason },
        (next) => next.attempt?.status === status,
        {
          title: status === "revoked" ? "Invitation revoked" : "Invitation expired",
          description: "The closure and its reason were recorded.",
        },
      );
    };

  if (loadError) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>
          <RefreshCw />
          Try again
        </Button>
      </div>
    );
  }

  if (!overview) {
    return (
      <p
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading invitation status...
      </p>
    );
  }

  const attempt = overview.attempt;
  const busy = disabled || pending !== null;
  // Blocking facts the server also enforces; showing them avoids an action that
  // can only fail, without becoming a second copy of the server's rules.
  const blocked = overview.account_linked
    ? "This provider already has an account. New-account invitations are blocked; existing-account linking is a separate reviewed path."
    : !overview.recipient_valid
      ? "The reviewed application snapshot has no usable recipient address, so no invitation can be prepared."
      : !overview.version_current
        ? "A newer application revision exists. Rebind onboarding to the current version before inviting."
        : overview.onboarding_status === "suspended" ||
            overview.onboarding_status === "rejected"
          ? "Invitations are not permitted while onboarding is " +
            overview.onboarding_status +
            "."
          : "";

  return (
    <div className="space-y-4">
      {/* The account binding itself is reported by the TRACE-067 account panel;
          repeating it here would be a second, divergible copy of one fact. Its
          consequence for invitations is still stated in `blocked` below. */}
      <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <Fact label="Recipient" value={overview.recipient_email ?? "Not recorded"} />
      </dl>

      {attempt ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Mail className="h-4 w-4 text-accent" />
            <Badge variant="secondary">
              {attemptLabel[attempt.status] ?? attempt.status}
            </Badge>
            {attempt.expired && attempt.live && (
              <Badge variant="outline">Past expiry</Badge>
            )}
            {attempt.accepted && <Badge variant="outline">Recipient receipt</Badge>}
          </div>
          <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <Fact label="Prepared" value={formatDateTime(attempt.created_at)} />
            <Fact label="Expires" value={formatDateTime(attempt.expires_at)} />
            <Fact
              label="Dispatch"
              value={
                attempt.dispatch_state
                  ? dispatchLabel[attempt.dispatch_state] ??
                    attempt.dispatch_state
                  : "Not dispatched"
              }
            />
            <Fact
              label="Auth identity"
              value={attempt.auth_user_id ?? "Not recorded"}
            />
          </dl>

          {attempt.live && (
            <div className="flex flex-col gap-3">
              {attempt.status === "prepared" && (
                <ConfirmAction
                  disabled={busy}
                  confirmationTone="commitment"
                  triggerLabel="Send invitation"
                  title="Send this invitation?"
                  entity={businessName + " · " + (overview.recipient_email ?? "")}
                  consequence="Reserves the attempt and asks Auth to invite the reviewed recipient. It is never retried automatically, asserts no mailbox delivery, and grants no vendor access."
                  confirmLabel="Send"
                  onConfirm={() => send(attempt.attempt_id)}
                />
              )}

              {attempt.dispatch_state === "unknown" && (
                <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
                  <p className="text-xs leading-5">
                    The provider result is unknown. Reconcile it with the exact
                    Auth user ID; it cannot be closed simply to release another
                    send.
                  </p>
                  <FormField
                    label="Auth user ID"
                    required
                    help="Read from the Auth provider. The database verifies it against the recorded recipient and invitation timing."
                    error={
                      authUserId && !uuidPattern.test(authUserId.trim())
                        ? "Enter the exact Auth user ID."
                        : undefined
                    }
                  >
                    {(control) => (
                      <Input
                        {...control}
                        value={authUserId}
                        disabled={busy}
                        onChange={(event) => setAuthUserId(event.target.value)}
                      />
                    )}
                  </FormField>
                  <ConfirmAction
                    disabled={busy || !uuidPattern.test(authUserId.trim())}
                    confirmationTone="commitment"
                    triggerLabel="Reconcile result"
                    title="Reconcile this invitation?"
                    entity={businessName}
                    consequence="Records the verified Auth identity as the provider receipt. The database rejects an identity that does not match the recorded recipient."
                    confirmLabel="Reconcile"
                    onConfirm={() => reconcile(attempt.attempt_id)}
                  />
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <ConfirmAction
                  disabled={busy}
                  requireReason
                  triggerLabel="Revoke invitation"
                  title="Revoke this invitation?"
                  entity={businessName}
                  consequence="Closes the attempt with your reason. The recipient can no longer accept it. Reconciled results only."
                  confirmLabel="Revoke"
                  onConfirm={close(attempt.attempt_id, "revoked")}
                />
                {attempt.expired && (
                  <ConfirmAction
                    disabled={busy}
                    requireReason
                    triggerLabel="Record expiry"
                    title="Record this invitation as expired?"
                    entity={businessName}
                    consequence="Closes the attempt with your reason once its operator-entered expiry has passed."
                    confirmLabel="Record expiry"
                    onConfirm={close(attempt.attempt_id, "expired")}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          No invitation has been prepared for this provider.
        </p>
      )}

      {blocked ? (
        <p className="text-sm leading-6 text-muted-foreground">{blocked}</p>
      ) : (
        !attempt?.live && (
          <div className="space-y-3 border-t border-border pt-4">
            <FormField
              label="Invitation expiry"
              required
              help="Entered by the operator for this invitation. There is no default expiry and none is implied by the Auth provider's own link lifetime."
              error={expiryError || undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  type="datetime-local"
                  value={expiry}
                  disabled={busy}
                  onChange={(event) => setExpiry(event.target.value)}
                />
              )}
            </FormField>
            <p className="text-xs leading-5 text-muted-foreground">
              Preparing records the attempt only. No email, account, vendor
              access or public listing is created.
            </p>
            <ConfirmAction
              disabled={busy || !expiryIso || Boolean(expiryError)}
              confirmationTone="commitment"
              triggerLabel="Prepare invitation"
              title="Prepare this invitation?"
              entity={
                businessName +
                (expiryIso ? " · expires " + formatDateTime(expiryIso) : "")
              }
              consequence="Records one invitation attempt against the reviewed application snapshot, using the expiry you entered. Nothing is sent and no vendor access is granted."
              confirmLabel="Prepare"
              onConfirm={prepare}
            />
          </div>
        )
      )}

      {overview.prior_attempts.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Earlier attempts ({overview.prior_attempts.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {overview.prior_attempts.map((prior) => (
              <li key={prior.attempt_id}>
                {attemptLabel[prior.status] ?? prior.status} ·{" "}
                {formatDateTime(prior.created_at)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt>{label}</dt>
      <dd className="mt-0.5 break-words font-medium text-foreground">{value}</dd>
    </div>
  );
}
