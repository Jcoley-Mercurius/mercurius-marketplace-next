"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { createClient } from "@/lib/supabase/client";
import { formatRenewalDate } from "@/lib/evidenceRenewal";
import {
  closureOutcomeLabel,
  closureSourceLabel,
  type ApplicationRetentionOverview,
  type ClosureOutcome,
} from "@/lib/applicationRetention";

// TRACE-084: records a rejection or abandonment with a reason, which starts the CFG-011
// 90-day retention clock for the application's documents, and places or releases an
// application retention hold. Replaces the direct status update. Quarantine, restore and
// deletion run from Admin → Document Retention. Every change is confirmed by rereading.

function messageOf(value: unknown, fallback: string) {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    const { message } = value as { message?: unknown };
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export function ApplicationClosure({
  applicationId,
  businessName,
  disabled,
  onOverview,
}: {
  applicationId: string;
  businessName: string;
  disabled: boolean;
  /** Receives every successful read, so the page can show the status and file states. */
  onOverview: (overview: ApplicationRetentionOverview) => void;
}) {
  const [overview, setOverview] = useState<ApplicationRetentionOverview | null>(null);
  const [loadError, setLoadError] = useState("");
  const [nonce] = useState(() => crypto.randomUUID());
  const [holdGeneration, setHoldGeneration] = useState(0);

  const read = useCallback(async () => {
    setLoadError("");
    try {
      const { data, error } = await createClient().rpc("vendor_application_retention_overview", { p_application: applicationId });
      if (error) throw error;
      const next = data as unknown as ApplicationRetentionOverview;
      setOverview(next);
      onOverview(next);
      return next;
    } catch (reason) {
      setLoadError(messageOf(reason, "Closure and retention status could not be loaded."));
      return null;
    }
  }, [applicationId, onOverview]);

  useEffect(() => {
    const timer = window.setTimeout(() => void read(), 0);
    return () => window.clearTimeout(timer);
  }, [read]);

  const close = (outcome: ClosureOutcome) => async (reason: string) => {
    try {
      const { error } = await createClient().rpc("vendor_close_application", {
        p_application: applicationId,
        p_outcome: outcome,
        p_reason: reason,
        p_key: `application-close:${nonce}:${applicationId}:${outcome}`,
      });
      if (error) throw new Error(error.message);
      const next = await read();
      if (next?.closure?.outcome !== outcome) {
        throw new Error("The server did not confirm this closure. Review the application before retrying.");
      }
      toast.success(outcome === "rejected" ? "Application rejected" : "Application marked abandoned", {
        description: `${businessName}. Its documents are kept ${next.retention_days} days from today.`,
      });
    } catch (reason) {
      toast.error("Application could not be closed", { description: messageOf(reason, "Please try again.") });
      throw reason;
    }
  };

  const changeHold = (action: "place" | "release") => async (reason: string) => {
    try {
      const { error } = await createClient().rpc(
        action === "place" ? "vendor_place_application_retention_hold" : "vendor_release_application_retention_hold",
        { p_application: applicationId, p_reason: reason, p_key: `application-hold:${nonce}:${applicationId}:${action}:${holdGeneration}` },
      );
      if (error) throw new Error(error.message);
      const next = await read();
      if (Boolean(next?.hold) !== (action === "place")) {
        throw new Error("The server did not confirm the hold. Review the application before retrying.");
      }
      setHoldGeneration((value) => value + 1);
      toast.success(action === "place" ? "Application hold placed" : "Application hold released", { description: businessName });
    } catch (reason) {
      toast.error(action === "place" ? "Hold could not be placed" : "Hold could not be released", {
        description: messageOf(reason, "Please try again."),
      });
      throw reason;
    }
  };

  if (loadError && !overview) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">{loadError}</p>
        <Button size="sm" variant="outline" onClick={() => void read()}>
          <RefreshCw />
          Try again
        </Button>
      </div>
    );
  }
  if (!overview) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading closure and retention status...
      </p>
    );
  }

  const legacy = overview.close_outcomes.length === 1 && overview.application_status === overview.close_outcomes[0];
  const keptFiles = overview.files.filter((file) => file.bound_to_evidence).length;

  return (
    <div className="space-y-3">
      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}

      {overview.closure ? (
        <div className="space-y-1 rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">
            {closureOutcomeLabel[overview.closure.outcome]}
            {overview.closure.closed_at ? ` · ${formatRenewalDate(overview.closure.closed_at)}` : ""}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {closureSourceLabel[overview.closure.source]}
            {overview.closure.reason ? `: ${overview.closure.reason}` : ""}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {overview.closure.closed_at
              ? `Documents are kept ${overview.retention_days} days, until ${formatRenewalDate(
                  new Date(new Date(overview.closure.closed_at).getTime() + overview.retention_days * 86_400_000).toISOString(),
                )}, then may be quarantined from Document Retention.`
              : "No rejection time is recorded, so these documents are not due for retention."}
            {keptFiles > 0 ? ` ${keptFiles} document${keptFiles === 1 ? " is" : "s are"} compliance evidence and ${keptFiles === 1 ? "is" : "are"} kept.` : ""}
          </p>
        </div>
      ) : overview.has_provider ? (
        <p className="text-sm leading-6 text-muted-foreground">
          This application has a provider record. Reject it through onboarding review in the provider&apos;s activation checklist.
        </p>
      ) : overview.close_outcomes.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">This application cannot be closed here.</p>
      ) : (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-xs leading-5 text-muted-foreground">
            {legacy
              ? `This application was marked ${overview.application_status} without a recorded time or reason, so its documents are not due for retention. Recording it starts the ${overview.retention_days}-day clock today.`
              : `Closing records who closed the application, when and why. Its documents are then kept ${overview.retention_days} days before they may be quarantined.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {overview.close_outcomes.includes("rejected") && (
              <ConfirmAction
                disabled={disabled}
                requireReason
                reasonHelp="Recorded with the rejection. Explain why the application does not meet Mercurius requirements."
                triggerLabel={legacy ? "Record rejection" : "Reject"}
                title={legacy ? "Record this rejection?" : "Reject this application?"}
                entity={businessName}
                consequence={`Records the application as rejected. It cannot start onboarding review, and its documents are kept ${overview.retention_days} days from today before they may be quarantined. No email is sent.`}
                confirmLabel={legacy ? "Record rejection" : "Reject"}
                onConfirm={close("rejected")}
              />
            )}
            {overview.close_outcomes.includes("abandoned") && (
              <ConfirmAction
                disabled={disabled}
                requireReason
                reasonHelp="Recorded with the closure. For example: applicant stopped responding after two follow-ups."
                triggerLabel="Mark abandoned"
                title="Mark this application abandoned?"
                entity={businessName}
                consequence={`Records the application as abandoned. It cannot start onboarding review, and its documents are kept ${overview.retention_days} days from today before they may be quarantined. No email is sent.`}
                confirmLabel="Mark abandoned"
                onConfirm={close("abandoned")}
              />
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border p-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">{overview.hold ? "Application hold in force" : "No application hold"}</p>
          <p className="break-words text-xs leading-5 text-muted-foreground">
            {overview.hold
              ? `${overview.hold.reason} · placed ${formatRenewalDate(overview.hold.placed_at)}. This application's documents cannot be quarantined or deleted.`
              : overview.provider_held
                ? "The linked provider is on a retention hold, which also covers this application's documents."
                : "Place a hold when an investigation or legal hold applies to this application's documents."}
          </p>
        </div>
        {overview.hold ? (
          <ConfirmAction
            disabled={disabled}
            requireReason
            reasonHelp="Recorded with the release. Explain why the hold no longer applies."
            triggerLabel="Release application hold"
            title="Release this application hold?"
            entity={businessName}
            consequence="Quarantine and permanent deletion open again for this application's documents once their periods end, unless a provider hold applies."
            confirmLabel="Release application hold"
            onConfirm={changeHold("release")}
          />
        ) : (
          <ConfirmAction
            disabled={disabled}
            requireReason
            reasonHelp="Recorded with the hold and shown to operators. Name the investigation or legal hold."
            triggerLabel="Place application hold"
            title="Place an application hold?"
            entity={businessName}
            consequence="Stops quarantine and permanent deletion of this application's documents until an operator releases the hold. Nothing else about the application changes."
            confirmLabel="Place application hold"
            confirmationTone="commitment"
            onConfirm={changeHold("place")}
          />
        )}
      </div>
    </div>
  );
}
