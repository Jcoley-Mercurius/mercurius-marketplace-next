"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

// TRACE-069 operator surface for the MPS §8 activation checklist and onboarding
// decisions. Every decision is the server's: evidence is recorded through
// vendor_record_checklist_evidence, decisions through vendor_decide_onboarding, and
// both are confirmed only by reading the checklist back.

type Kind =
  | "identity"
  | "agreement"
  | "coverage"
  | "license"
  | "insurance"
  | "bank_authorization"
  | "profile_pricing"
  | "availability"
  | "test_notification";

type Item = {
  kind: Kind;
  evidence_id: string | null;
  requirement_version: string | null;
  evidence_ref: string | null;
  accepted_at: string | null;
  expires_at: string | null;
  state: "missing" | "current" | "expired" | "superseded_version";
  // TRACE-072: current evidence inside the renewal notice window.
  renewal_due?: boolean;
};

type Checklist = {
  contractor_id: string;
  onboarding_status: "review" | "active" | "suspended" | "rejected";
  onboarding_revision: number;
  version_current: boolean;
  application_open: boolean;
  documents: string[];
  checklist_current: boolean;
  eligible: boolean;
  scoped_compliance_current: boolean;
  cutover_enforced: boolean;
  account_linked: boolean;
  account_reviewed: boolean;
  account_email: string | null;
  vendor_role_held: boolean;
  renewal_notice_days?: number;
  items: Item[];
  events: {
    revision: number;
    action: string;
    before_status: string;
    after_status: string;
    reason: string;
    created_at: string;
  }[];
  last_role_decision: { outcome: string; onboarding_revision: number } | null;
};

type Action = "activate" | "suspend" | "renew" | "reject";

// Labels restate MPS §8 and describe only what the operator records here.
const itemLabel: Record<Kind, string> = {
  identity: "Identity and business contact verified",
  agreement: "Terms and marketplace agreement accepted",
  coverage: "Service categories and coverage approved",
  license: "Licensing reviewed",
  insurance: "Insurance reviewed",
  bank_authorization: "Payout onboarding complete",
  profile_pricing: "Profile and pricing claims reviewed",
  availability: "Availability and response expectations accepted",
  test_notification: "Test notification received",
};

const referenceHelp: Record<Kind, string> = {
  identity: "Where the verification is recorded, such as a case or ticket reference.",
  agreement: "The accepted agreement record. Put the agreement version in the requirement version.",
  coverage: "The review record for the approved services and ZIP codes.",
  license: "Select the reviewed application document.",
  insurance: "Select the reviewed application document.",
  bank_authorization:
    "A reference to where the authorization is held. Never enter account or routing numbers.",
  profile_pricing: "The review record for the profile and pricing claims.",
  availability: "The record of the accepted availability and response expectations.",
  test_notification: "The record of the received test notification.",
};

const stateLabel: Record<Item["state"], string> = {
  missing: "Missing",
  current: "Current",
  expired: "Expired",
  superseded_version: "Earlier application version",
};

const statusLabel: Record<Checklist["onboarding_status"], string> = {
  review: "Under review",
  active: "Active",
  suspended: "Suspended",
  rejected: "Rejected",
};

const actionLabel: Record<string, string> = {
  activate: "Activated",
  suspend: "Suspended",
  renew: "Renewed",
  reject: "Rejected",
  application_revision: "New application revision",
  account_linked: "Account linked",
  account_released: "Account released",
};

const documentKinds: Kind[] = ["license", "insurance"];

// Supabase rejects with a PostgrestError, a plain object rather than an Error.
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
  return Number.isNaN(parsed.getTime()) ? "Not recorded" : parsed.toLocaleString();
}

function toIso(value: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// Short, stable fingerprint of the entered evidence, so a retry of the same entry
// replays one key and a corrected entry gets a new one.
function fingerprint(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

export function VendorOnboardingChecklist({
  contractorId,
  businessName,
  disabled = false,
}: {
  contractorId: string;
  businessName: string;
  disabled?: boolean;
}) {
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState(false);
  const [kind, setKind] = useState<Kind | "">("");
  const [requirement, setRequirement] = useState("");
  const [reference, setReference] = useState("");
  const [accepted, setAccepted] = useState("");
  const [expires, setExpires] = useState("");
  const [nonce] = useState(() => crypto.randomUUID());

  const read = useCallback(async () => {
    const { data, error } = await createClient().rpc("vendor_onboarding_checklist", {
      p_contractor: contractorId,
    });
    if (error) throw error;
    return data as unknown as Checklist;
  }, [contractorId]);

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      setChecklist(await read());
    } catch (error) {
      setLoadError(messageOf(error, "The checklist could not be loaded."));
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
      confirmed: (next: Checklist) => boolean,
      success: { title: string; description: string },
    ) => {
      setPending(true);
      try {
        const { error } = await call();
        if (error) throw new Error(error.message);
        const next = await read();
        setChecklist(next);
        if (!confirmed(next)) {
          throw new Error(
            "The server did not confirm this change. Review the current checklist before retrying.",
          );
        }
        toast.success(success.title, { description: success.description });
      } catch (error) {
        toast.error("Onboarding action could not be completed", {
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

  const selected = checklist?.items.find((item) => item.kind === kind) ?? null;
  const acceptedIso = toIso(accepted);
  const expiresIso = toIso(expires);
  const needsDocument = kind !== "" && documentKinds.includes(kind);
  const acceptedError = !accepted
    ? ""
    : !acceptedIso
      ? "Enter a valid date and time."
      : new Date(acceptedIso) > new Date()
        ? "The review time cannot be in the future."
        : "";
  const expiresError = !expires
    ? ""
    : !expiresIso
      ? "Enter a valid date and time."
      : new Date(expiresIso) <= new Date()
        ? "Enter an expiry in the future."
        : acceptedIso && new Date(expiresIso) <= new Date(acceptedIso)
          ? "The expiry must be after the review time."
          : "";
  const entryReady =
    kind !== "" &&
    requirement.trim() !== "" &&
    reference.trim() !== "" &&
    Boolean(acceptedIso) &&
    !acceptedError &&
    !expiresError &&
    (!needsDocument || Boolean(expiresIso));

  const evidenceKey = useMemo(() => {
    if (!entryReady) return null;
    return [
      "checklist",
      nonce,
      kind,
      selected?.evidence_id ?? "new",
      fingerprint(
        JSON.stringify([requirement.trim(), reference.trim(), acceptedIso, expiresIso]),
      ),
    ].join(":");
  }, [entryReady, kind, nonce, selected, requirement, reference, acceptedIso, expiresIso]);

  const choose = (next: Kind | "") => {
    setKind(next);
    setRequirement("");
    setReference("");
    setAccepted("");
    setExpires("");
  };

  const recordEvidence = async () => {
    if (!checklist || kind === "" || !evidenceKey) return;
    const previous = selected?.evidence_id ?? null;
    const entered = { requirement: requirement.trim(), reference: reference.trim() };
    await run(
      () =>
        createClient().rpc("vendor_record_checklist_evidence", {
          p_contractor: contractorId,
          p_kind: kind,
          p_requirement: entered.requirement,
          p_reference: entered.reference,
          p_accepted: acceptedIso!,
          p_expires: expiresIso ?? undefined,
          p_supersedes: previous ?? undefined,
          p_key: evidenceKey,
        }),
      (next) => {
        const item = next.items.find((candidate) => candidate.kind === kind);
        return Boolean(
          item?.evidence_id &&
            item.evidence_id !== previous &&
            item.requirement_version === entered.requirement &&
            item.evidence_ref === entered.reference,
        );
      },
      {
        title: "Checklist evidence recorded",
        description: `${itemLabel[kind]}. No decision, role or listing followed.`,
      },
    );
    choose("");
  };

  const decide = (action: Action, expectedStatus: Checklist["onboarding_status"]) =>
    async (reason: string) => {
      if (!checklist) return;
      const revision = checklist.onboarding_revision;
      await run(
        () =>
          createClient().rpc("vendor_decide_onboarding", {
            p_contractor: contractorId,
            p_expected_revision: revision,
            p_action: action,
            p_reason: reason,
            p_key: `onboarding-decision:${nonce}:${revision}:${action}`,
          }),
        (next) =>
          next.onboarding_revision === revision + 1 &&
          next.onboarding_status === expectedStatus,
        {
          title: `Provider ${actionLabel[action].toLowerCase()}`,
          description: "The decision was recorded at a new onboarding revision.",
        },
      );
    };

  if (loadError) {
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
            ? "This provider is not under onboarding review, so there is no activation checklist. Existing provider records follow the compliance cutover path."
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

  if (!checklist) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading checklist...
      </p>
    );
  }

  const busy = disabled || pending;
  const status = checklist.onboarding_status;
  const currentCount = checklist.items.filter((item) => item.state === "current").length;
  const evidenceBlocked =
    status === "rejected"
      ? "This provider was rejected, so it takes no further evidence."
      : !checklist.version_current
        ? "A newer application revision exists. Rebind onboarding to the current version before recording evidence."
        : !checklist.application_open
          ? "The application is closed, so no evidence can be recorded against it."
          : "";
  const roleConsequence = checklist.account_reviewed
    ? `Grants the vendor role to ${checklist.account_email ?? "the reviewed account"} unless it already holds it.`
    : checklist.account_linked
      ? "The bound account is inherited, so no vendor role is granted."
      : "No reviewed account is bound, so no vendor role is granted and the provider cannot open the vendor portal.";
  const incomplete = "Every checklist item must be current first.";

  return (
    <div className="space-y-4">
      <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        <Fact label="Onboarding" value={`${statusLabel[status]} · revision ${checklist.onboarding_revision}`} />
        <Fact label="Checklist" value={`${currentCount} of ${checklist.items.length} current`} />
        <Fact
          label="Vendor portal access"
          value={checklist.vendor_role_held ? "Vendor role held" : "No vendor role"}
        />
        <Fact
          label="Scoped license and insurance"
          value={
            checklist.scoped_compliance_current
              ? "Bound for every active service area"
              : "Not bound to service areas yet"
          }
        />
      </dl>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {checklist.items.map((item) => (
          <li key={item.kind} className="space-y-1 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">{itemLabel[item.kind]}</span>
              <span className="flex flex-wrap gap-1.5">
                {item.state === "current" && item.renewal_due && (
                  <Badge variant="outline" className="border-status-warning bg-status-warning-bg text-status-warning">
                    Renewal due
                  </Badge>
                )}
                <Badge variant={item.state === "current" ? "secondary" : "outline"}>
                  {stateLabel[item.state]}
                </Badge>
              </span>
            </div>
            {item.state === "current" && item.renewal_due && (
              <p className="text-xs leading-5 text-muted-foreground">
                Expires within {checklist.renewal_notice_days ?? 30} days. Record renewed evidence before it lapses. A lapsed item makes the checklist incomplete, which takes an active provider out of matching; it does not change the provider&apos;s status or hold payouts, except when payout onboarding lapses.
              </p>
            )}
            {item.evidence_id && (
              <p className="break-words text-xs leading-5 text-muted-foreground">
                {item.requirement_version} · {item.evidence_ref} · reviewed{" "}
                {formatDateTime(item.accepted_at)}
                {item.expires_at ? ` · expires ${formatDateTime(item.expires_at)}` : ""}
              </p>
            )}
          </li>
        ))}
      </ul>

      {evidenceBlocked ? (
        <p className="text-sm leading-6 text-muted-foreground">{evidenceBlocked}</p>
      ) : (
        <div className="space-y-3 border-t border-border pt-4">
          <FormField label="Checklist item" required>
            {(control) => (
              <select
                {...control}
                className={selectClass}
                value={kind}
                disabled={busy}
                onChange={(event) => choose(event.target.value as Kind | "")}
              >
                <option value="">Select an item</option>
                {checklist.items.map((item) => (
                  <option key={item.kind} value={item.kind}>
                    {itemLabel[item.kind]} ({stateLabel[item.state].toLowerCase()})
                  </option>
                ))}
              </select>
            )}
          </FormField>
          {kind !== "" && (
            <>
              <FormField
                label="Requirement version"
                required
                help="The version of the rule or agreement this evidence satisfies."
              >
                {(control) => (
                  <Input
                    {...control}
                    value={requirement}
                    disabled={busy}
                    onChange={(event) => setRequirement(event.target.value)}
                  />
                )}
              </FormField>
              <FormField
                label={needsDocument ? "Application document" : "Evidence reference"}
                required
                help={referenceHelp[kind]}
              >
                {(control) =>
                  needsDocument ? (
                    <select
                      {...control}
                      className={selectClass}
                      value={reference}
                      disabled={busy}
                      onChange={(event) => setReference(event.target.value)}
                    >
                      <option value="">
                        {checklist.documents.length ? "Select a document" : "No documents in this application"}
                      </option>
                      {checklist.documents.map((path) => (
                        <option key={path} value={path}>
                          {path.split("/").at(-1)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      {...control}
                      value={reference}
                      disabled={busy}
                      onChange={(event) => setReference(event.target.value)}
                    />
                  )
                }
              </FormField>
              <FormField
                label="Reviewed at"
                required
                help="When the operator reviewed this evidence. There is no default."
                error={acceptedError || undefined}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="datetime-local"
                    value={accepted}
                    disabled={busy}
                    onChange={(event) => setAccepted(event.target.value)}
                  />
                )}
              </FormField>
              <FormField
                label="Expires"
                required={needsDocument}
                help={
                  needsDocument
                    ? "Required for licensing and insurance. Entered by the operator; there is no default."
                    : "Only if this evidence lapses. Entered by the operator; there is no default."
                }
                error={expiresError || undefined}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="datetime-local"
                    value={expires}
                    disabled={busy}
                    onChange={(event) => setExpires(event.target.value)}
                  />
                )}
              </FormField>
              <ConfirmAction
                disabled={busy || !evidenceKey}
                confirmationTone="commitment"
                triggerLabel={selected?.evidence_id ? "Replace evidence" : "Record evidence"}
                title="Record this checklist evidence?"
                entity={`${businessName} · ${itemLabel[kind]}`}
                consequence={
                  (selected?.evidence_id
                    ? "Supersedes the current evidence for this item, which stays in history. "
                    : "") +
                  "Records the evidence against the reviewed application revision. It activates nothing, grants no role and publishes no listing."
                }
                confirmLabel="Record"
                onConfirm={recordEvidence}
              />
            </>
          )}
        </div>
      )}

      {status !== "rejected" && (
        <div className="space-y-3 border-t border-border pt-4">
          <h4 className="text-sm font-medium">Onboarding decision</h4>
          {(status === "review" || status === "suspended") && !checklist.checklist_current && (
            <p className="text-xs leading-5 text-muted-foreground">
              {status === "review" ? "Activation" : "Reactivation"} is unavailable. {incomplete}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(status === "review" || status === "suspended") && (
              <ConfirmAction
                disabled={busy || !checklist.checklist_current}
                requireReason
                confirmationTone="commitment"
                triggerLabel={status === "review" ? "Activate provider" : "Reactivate provider"}
                title={status === "review" ? "Activate this provider?" : "Reactivate this provider?"}
                entity={businessName}
                consequence={`Records activation at revision ${checklist.onboarding_revision + 1} with your reason. ${roleConsequence} Matching also requires active packages and coverage; no listing or marketing setting changes.`}
                confirmLabel={status === "review" ? "Activate" : "Reactivate"}
                onConfirm={decide("activate", "active")}
              />
            )}
            {status === "active" && (
              <ConfirmAction
                disabled={busy}
                requireReason
                triggerLabel="Suspend provider"
                title="Suspend this provider?"
                entity={businessName}
                consequence="Removes the provider from matching and offer acceptance and records your reason. The vendor role is kept so assigned work and payout status stay visible."
                confirmLabel="Suspend"
                onConfirm={decide("suspend", "suspended")}
              />
            )}
            {(status === "active" || status === "suspended") && (
              <ConfirmAction
                disabled={busy || !checklist.checklist_current}
                requireReason
                confirmationTone="commitment"
                triggerLabel="Record renewal"
                title="Record renewal for this provider?"
                entity={businessName}
                consequence={`Records that the current checklist was renewed. ${status === "suspended" ? "It does not lift the suspension. " : ""}No role or listing changes.`}
                confirmLabel="Record renewal"
                onConfirm={decide("renew", status)}
              />
            )}
            {status === "review" && (
              <ConfirmAction
                disabled={busy}
                requireReason
                triggerLabel="Reject provider"
                title="Reject this provider?"
                entity={businessName}
                consequence="Closes this review and records your reason. A rejected provider takes no further evidence or decisions until a new application revision reopens review."
                confirmLabel="Reject"
                onConfirm={decide("reject", "rejected")}
              />
            )}
          </div>
          {(status === "active" || status === "suspended") && !checklist.checklist_current && (
            <p className="text-xs leading-5 text-muted-foreground">
              Renewal is unavailable. {incomplete}
            </p>
          )}
        </div>
      )}

      {checklist.events.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Onboarding history ({checklist.events.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {checklist.events.map((event) => (
              <li key={event.revision} className="break-words">
                Revision {event.revision} · {actionLabel[event.action] ?? event.action} ·{" "}
                {formatDateTime(event.created_at)} · {event.reason}
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
