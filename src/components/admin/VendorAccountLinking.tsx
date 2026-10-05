"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

// TRACE-067 operator surface over the reviewed account-link commands. Every
// decision is the server's: this panel reads state back and reports it. Linking
// binds an identity and records why; it grants no role, accepts no compliance
// evidence and activates no provider. TRACE-068: activation grants the vendor role
// to a reviewed binding, and releasing that binding withdraws it. TRACE-070: the
// account that accepted this provider's invitation can be bound from its receipt.
// TRACE-105 (DEC-2026-028): a suspended provider can also be bound, so one activated
// with no account is repaired by suspend, bind, activate.

type Decision = {
  action: string;
  auth_user_id: string;
  invitation_attempt_id: string | null;
  recipient_email: string;
  onboarding_revision: number;
  reason: string;
  created_at: string;
};

type RoleDecision = {
  action: string;
  outcome: string;
  auth_user_id: string | null;
  onboarding_revision: number;
  created_at: string;
};

type AcceptedInvitation = {
  attempt_id: string;
  auth_user_id: string;
  accepted_at: string;
  account_email: string | null;
  account_confirmed: boolean;
  for_current_version: boolean;
  bound: boolean;
};

type Overview = {
  contractor_id: string;
  onboarding_status: string;
  onboarding_revision: number;
  application_version_id: string;
  version_current: boolean;
  recipient_email: string | null;
  recipient_valid: boolean;
  linked: boolean;
  linked_user_id: string | null;
  linked_email: string | null;
  link_reviewed: boolean;
  link_source: "stated_identity" | "accepted_invitation" | null;
  accepted_invitation: AcceptedInvitation | null;
  invitation_live: boolean;
  vendor_role_held: boolean;
  vendor_role_from_activation: boolean;
  decisions: Decision[];
  role_decisions: RoleDecision[];
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const decisionLabel: Record<string, string> = {
  link: "Account linked",
  release: "Account released",
};

const roleOutcomeLabel: Record<string, string> = {
  granted: "Vendor role granted at activation",
  already_held: "Activated; vendor role already held",
  no_account: "Activated with no bound account; no role granted",
  inherited_link: "Activated with an inherited link; no role granted",
  revoked: "Vendor role withdrawn with the account release",
  already_absent: "Account released; vendor role was already absent",
};

// Supabase rejects with a PostgrestError, which is a plain object rather than an
// Error, so the server's own wording only survives if it is read off the object.
function messageOf(value: unknown, fallback: string) {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    const { message } = value as { message?: unknown };
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Not recorded"
    : parsed.toLocaleString();
}

export function VendorAccountLinking({
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
  const [pending, setPending] = useState(false);
  const [authUserId, setAuthUserId] = useState("");
  // One nonce per opened provider. Combined with the onboarding revision below it
  // makes a retry replay the same decision instead of recording a second one.
  const [nonce] = useState(() => crypto.randomUUID());

  const read = useCallback(async () => {
    const { data, error } = await createClient().rpc(
      "vendor_account_link_overview",
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
      setLoadError(messageOf(error, "Account status could not be loaded."));
    }
  }, [read]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // Run one command, then take the server's word for what happened.
  const run = useCallback(
    async (
      // The Supabase RPC builder is a thenable, not a Promise.
      call: () => PromiseLike<{ error: { message: string } | null }>,
      confirmed: (next: Overview) => boolean,
      success: { title: string; description: string },
    ) => {
      setPending(true);
      try {
        const { error } = await call();
        if (error) throw new Error(error.message);
        const next = await read();
        setOverview(next);
        if (!confirmed(next)) {
          throw new Error(
            "The server did not confirm this account change. Review the current state before retrying.",
          );
        }
        toast.success(success.title, { description: success.description });
      } catch (error) {
        toast.error("Account action could not be completed", {
          description: messageOf(error, "Please try again."),
        });
        void refresh();
        throw error;
      } finally {
        setPending(false);
      }
    },
    [read, refresh],
  );

  const link = async (reason: string) => {
    if (!overview) return;
    const identity = authUserId.trim();
    await run(
      () =>
        createClient().rpc("vendor_link_existing_account", {
          p_contractor: contractorId,
          p_expected_revision: overview.onboarding_revision,
          p_auth_user: identity,
          p_reason: reason,
          p_key: `account-link:${nonce}:${overview.onboarding_revision}:${identity}`,
        }),
      (next) => next.link_reviewed && next.linked_user_id === identity,
      {
        title: "Account linked",
        description:
          "The identity was verified against the reviewed application recipient. No role, evidence or activation followed.",
      },
    );
    setAuthUserId("");
  };

  const bindInvited = async (reason: string) => {
    const receipt = overview?.accepted_invitation;
    if (!overview || !receipt) return;
    await run(
      () =>
        createClient().rpc("vendor_bind_invited_account", {
          p_contractor: contractorId,
          p_expected_revision: overview.onboarding_revision,
          p_attempt: receipt.attempt_id,
          p_reason: reason,
          p_key: `invitation-bind:${nonce}:${overview.onboarding_revision}:${receipt.attempt_id}`,
        }),
      (next) =>
        next.link_reviewed &&
        next.link_source === "accepted_invitation" &&
        next.linked_user_id === receipt.auth_user_id,
      {
        title: "Accepted account bound",
        description:
          "The account that accepted this provider's invitation was re-verified and bound. No role, evidence or activation followed.",
      },
    );
  };

  const release = async (reason: string) => {
    if (!overview) return;
    await run(
      () =>
        createClient().rpc("vendor_release_linked_account", {
          p_contractor: contractorId,
          p_expected_revision: overview.onboarding_revision,
          p_reason: reason,
          p_key: `account-release:${nonce}:${overview.onboarding_revision}`,
        }),
      (next) => !next.linked,
      {
        title: "Account released",
        description:
          "The binding was removed and recorded. A vendor role granted at activation was withdrawn; no evidence was retracted.",
      },
    );
  };

  if (loadError) {
    // A provider with no onboarding record is not an error to retry at; it is the
    // legacy boundary this panel deliberately refuses to cross.
    const unreviewed = loadError.includes("Onboarding record not found");
    return (
      <div className="space-y-2">
        <p
          role={unreviewed ? undefined : "alert"}
          className={
            unreviewed
              ? "text-sm leading-6 text-muted-foreground"
              : "text-sm text-destructive"
          }
        >
          {unreviewed
            ? "This provider is not under onboarding review, so its account cannot be bound here. Existing provider records follow the compliance cutover path."
            : loadError}
        </p>
        {!unreviewed && (
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            <RefreshCw />
            Try again
          </Button>
        )}
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
        Loading account status...
      </p>
    );
  }

  const busy = disabled || pending;
  const identity = authUserId.trim();
  // Blocking facts the server also enforces; showing them avoids offering an
  // action that can only fail, without becoming a second copy of its rules.
  const linkBlocked = overview.linked
    ? ""
    : !overview.recipient_valid
      ? "The reviewed application snapshot has no usable recipient address, so no identity can be verified against it."
      : !overview.version_current
        ? "A newer application revision exists. Rebind onboarding to the current version before linking an account."
        : overview.onboarding_status === "active"
          ? "This provider is active with no bound account, so it holds no vendor role. An account is never bound to a live provider: suspend it, bind the account here, then activate it again. Activation re-checks the checklist and grants the vendor role."
          : overview.onboarding_status !== "review" &&
              overview.onboarding_status !== "suspended"
            ? "Account linking is part of vetting. Onboarding is " +
              overview.onboarding_status +
              "."
            : overview.invitation_live
            ? "An invitation is live for this provider. Close it before linking an existing account; the two paths are mutually exclusive."
            : "";
  // The receipt facts the server will check again; an unbindable receipt is
  // explained rather than offered.
  const receipt = overview.accepted_invitation;
  const receiptBlocked = !receipt
    ? ""
    : !receipt.for_current_version
      ? "The recipient accepted an invitation for an earlier application revision, so that acceptance cannot be bound to the current review. The account already exists and cannot be re-invited; link it by account ID below."
      : !receipt.account_confirmed
        ? "The account that accepted the invitation is no longer confirmed, so it cannot be bound."
        : receipt.account_email !== overview.recipient_email
          ? "The account that accepted the invitation no longer matches the reviewed application recipient, so it cannot be bound."
          : "";
  const releasable =
    overview.linked &&
    overview.link_reviewed &&
    (overview.onboarding_status === "review" ||
      overview.onboarding_status === "suspended");

  return (
    <div className="space-y-4">
      <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <Fact
          label="Reviewed recipient"
          value={overview.recipient_email ?? "Not recorded"}
        />
        <Fact
          label="Bound account"
          value={overview.linked_email ?? "None linked"}
        />
        {overview.linked && (
          <Fact
            label="Vendor role"
            value={
              overview.vendor_role_from_activation
                ? "Granted at activation"
                : overview.vendor_role_held
                  ? "Held before activation"
                  : "Not granted"
            }
          />
        )}
      </dl>

      {overview.linked ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" />
            <Badge variant="secondary">
              {overview.link_reviewed ? "Reviewed link" : "Inherited link"}
            </Badge>
          </div>
          <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <Fact
              label="Account identity"
              value={overview.linked_user_id ?? "Not recorded"}
            />
            {overview.link_source && (
              <Fact
                label="Bound through"
                value={
                  overview.link_source === "accepted_invitation"
                    ? "Accepted invitation"
                    : "Stated account identity"
                }
              />
            )}
          </dl>
          {overview.link_reviewed ? (
            <p className="text-xs leading-5 text-muted-foreground">
              {overview.vendor_role_from_activation
                ? "Activation granted this account the vendor role. Suspension keeps it; releasing the account withdraws it."
                : overview.vendor_role_held
                  ? "This account held the vendor role before activation. Releasing the account does not withdraw a role activation did not grant."
                  : "This account holds no vendor role yet. Linking grants none: the role follows only from a reviewed activation with its own evidence."}
            </p>
          ) : (
            <p className="text-xs leading-5 text-muted-foreground">
              No reviewed decision created this link, so it is inherited
              evidence. It is neither replaced nor released here; it follows the
              compliance cutover path.
            </p>
          )}
          {releasable && (
            <ConfirmAction
              disabled={busy}
              requireReason
              triggerLabel="Release account"
              title="Release this linked account?"
              entity={businessName + " · " + (overview.linked_email ?? "")}
              consequence={
                overview.vendor_role_from_activation
                  ? "Removes the binding, withdraws the vendor role activation granted to it, and records your reason. No compliance evidence is withdrawn."
                  : "Removes the binding and records your reason. The account keeps any role it already holds, and no compliance evidence is withdrawn."
              }
              confirmLabel="Release"
              onConfirm={release}
            />
          )}
          {overview.linked && overview.link_reviewed && !releasable && (
            <p className="text-xs leading-5 text-muted-foreground">
              Suspend this provider before releasing its account, so a release
              is never what takes a live provider offline.
            </p>
          )}
        </div>
      ) : linkBlocked ? (
        <p className="text-sm leading-6 text-muted-foreground">{linkBlocked}</p>
      ) : (
        <>
          {overview.onboarding_status === "suspended" && (
            <p className="text-sm leading-6 text-muted-foreground">
              This provider is suspended. Bind its account here, then activate
              it again from the checklist to grant the vendor role.
            </p>
          )}
          {receipt && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-accent" />
                <Badge variant="secondary">Invitation accepted</Badge>
              </div>
              <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <Fact
                  label="Accepting account"
                  value={receipt.account_email ?? "Not recorded"}
                />
                <Fact
                  label="Accepted"
                  value={formatDateTime(receipt.accepted_at)}
                />
              </dl>
              {receiptBlocked ? (
                <>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {receiptBlocked}
                  </p>
                  {/* Fills the stated-identity form only; the link command still
                      verifies the account and the operator still confirms. */}
                  {!receipt.for_current_version &&
                    receipt.account_confirmed &&
                    receipt.account_email === overview.recipient_email && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setAuthUserId(receipt.auth_user_id)}
                      >
                        Use this account ID
                      </Button>
                    )}
                </>
              ) : (
                <>
                  <p className="text-xs leading-5 text-muted-foreground">
                    The recipient explicitly accepted this provider&apos;s
                    invitation. Binding records that account from the acceptance
                    receipt; no role, compliance evidence, activation or public
                    listing results from it.
                  </p>
                  <ConfirmAction
                    disabled={busy}
                    requireReason
                    confirmationTone="commitment"
                    triggerLabel="Bind accepted account"
                    title="Bind the account that accepted the invitation?"
                    entity={
                      businessName + " · " + (receipt.account_email ?? "")
                    }
                    consequence="Binds the accepting account to this provider at the reviewed application revision and records your reason. The database re-verifies the receipt, the application revision and the account before anything is written."
                    confirmLabel="Bind account"
                    onConfirm={bindInvited}
                  />
                </>
              )}
            </div>
          )}
          <div className="space-y-3 border-t border-border pt-4">
            <FormField
              label="Account identity"
              required
              help="The exact Auth user ID of the account the applicant already holds. The database verifies it against the reviewed application recipient; no directory is searched from here."
              error={
                authUserId && !uuidPattern.test(identity)
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
            <p className="text-xs leading-5 text-muted-foreground">
              Linking records the binding only. No vendor role, compliance
              evidence, activation or public listing results from it; a later
              reviewed activation grants the vendor role to this account.
            </p>
            <ConfirmAction
              disabled={busy || !uuidPattern.test(identity)}
              requireReason
              confirmationTone="commitment"
              triggerLabel="Link existing account"
              title="Link this existing account?"
              entity={businessName + " · " + (overview.recipient_email ?? "")}
              consequence="Binds the stated account to this provider at the reviewed application revision and records your reason. The database refuses an identity that is not the reviewed recipient, is unconfirmed, or already belongs to another provider."
              confirmLabel="Link account"
              onConfirm={link}
            />
          </div>
        </>
      )}

      {overview.decisions.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Recorded decisions ({overview.decisions.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {overview.decisions.map((decision) => (
              <li key={decision.onboarding_revision}>
                {decision.invitation_attempt_id
                  ? "Accepted invitation bound"
                  : (decisionLabel[decision.action] ?? decision.action)}{" "}
                · {formatDateTime(decision.created_at)} · {decision.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {overview.role_decisions.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Role decisions ({overview.role_decisions.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {overview.role_decisions.map((decision) => (
              <li key={decision.action + decision.onboarding_revision}>
                {roleOutcomeLabel[decision.outcome] ?? decision.outcome} ·{" "}
                {formatDateTime(decision.created_at)}
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
      <dd className="mt-0.5 break-words font-medium text-foreground">
        {value}
      </dd>
    </div>
  );
}
