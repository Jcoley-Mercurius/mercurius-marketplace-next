"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList, type DataColumn } from "@/components/ui/responsive-data-list";
import { createClient } from "@/lib/supabase/client";
import { formatRenewalDate } from "@/lib/evidenceRenewal";
import { daysUntil, objectLocationLabel, type ObjectLocation, type RetentionAction } from "@/lib/renewalRetention";
import {
  closureOutcomeLabel,
  requestApplicationRetentionStep,
  type ApplicationRetentionFile,
} from "@/lib/applicationRetention";

// TRACE-084 CFG-011 retention queue for the documents of rejected or abandoned vendor
// applications, on the Document Retention page below the TRACE-074 renewal queue. Each
// step runs behind ConfirmAction and is confirmed by rereading. Nothing here changes an
// application's terms, version, evidence, onboarding status or listing.

type Hold = { application_id: string; business_name: string; reason: string; placed_at: string };
type Unrecorded = { application_id: string; business_name: string; status: string; has_provider: boolean };

// Counts the Document Retention page adds to its totals; null while unloaded or failed.
export type ApplicationRetentionTotals = { due: number; quarantined: number; holds: number } | null;

type Queue = {
  evaluated_at: string;
  retention_days: number;
  quarantine_days: number;
  due: ApplicationRetentionFile[];
  quarantined: ApplicationRetentionFile[];
  kept: ApplicationRetentionFile[];
  unrecorded: Unrecorded[];
  holds: Hold[];
};

function messageOf(value: unknown, fallback: string) {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    const { message } = value as { message?: unknown };
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

const kindLabel: Record<string, string> = { license: "License", insurance: "Insurance", other: "Other document" };

const linkClass = "font-medium text-foreground underline underline-offset-4 hover:text-accent";

export function ApplicationDocumentRetention({
  refreshKey = 0,
  onTotals,
}: {
  refreshKey?: number;
  onTotals?: (totals: ApplicationRetentionTotals) => void;
}) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nonce] = useState(() => crypto.randomUUID());
  const totals = useRef(onTotals);
  useEffect(() => {
    totals.current = onTotals;
  }, [onTotals]);

  const read = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: rpcError } = await createClient().rpc("vendor_application_retention_queue");
      if (rpcError) throw rpcError;
      const next = data as unknown as Queue;
      setQueue(next);
      totals.current?.({ due: next.due.length, quarantined: next.quarantined.length, holds: next.holds.length });
      return next;
    } catch (reason) {
      setError(messageOf(reason, "The application document retention queue could not be loaded."));
      totals.current?.(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void read(), 0);
    return () => window.clearTimeout(timer);
  }, [read, refreshKey]);

  const step = (file: ApplicationRetentionFile, action: RetentionAction) => async (reason: string) => {
    const titles = { quarantine: "Document quarantined", restore: "Document restored", delete: "Document permanently deleted" };
    try {
      const result = await requestApplicationRetentionStep({
        applicationId: file.application_id,
        path: file.path,
        action,
        reason,
        key: `application-retention:${nonce}:${action}:${file.path}:${file.retention_since ?? "closed"}`,
      });
      const next = await read();
      const inQuarantine = next?.quarantined.some((candidate) => candidate.path === file.path);
      const due = next?.due.some((candidate) => candidate.path === file.path);
      const confirmed = next !== null && (action === "quarantine" ? inQuarantine : action === "restore" ? !inQuarantine : !inQuarantine && !due);
      if (!confirmed) throw new Error("The server did not confirm this step. Review the queue before retrying.");
      toast.success(titles[action], {
        description: result.underHold
          ? `${file.business_name} · ${file.file_name}. Recorded while the application is on a retention hold.`
          : `${file.business_name} · ${file.file_name}`,
      });
    } catch (reason) {
      toast.error("Retention step not completed", { description: messageOf(reason, "Please try again.") });
      throw reason;
    }
  };

  const release = (hold: Hold) => async (reason: string) => {
    try {
      const { error: rpcError } = await createClient().rpc("vendor_release_application_retention_hold", {
        p_application: hold.application_id,
        p_reason: reason,
        p_key: `application-hold-release:${nonce}:${hold.application_id}:${hold.placed_at}`,
      });
      if (rpcError) throw new Error(rpcError.message);
      const next = await read();
      if (!next || next.holds.some((candidate) => candidate.application_id === hold.application_id)) {
        throw new Error("The server did not confirm the release. Review the queue before retrying.");
      }
      toast.success("Retention hold released", { description: hold.business_name });
    } catch (reason) {
      toast.error("Hold could not be released", { description: messageOf(reason, "Please try again.") });
      throw reason;
    }
  };

  if (!queue) {
    return error ? (
      <PageState
        kind="error"
        title="Application document retention unavailable"
        description={error}
        action={
          <Button onClick={() => void read()}>
            <RefreshCw />
            Try again
          </Button>
        }
      />
    ) : (
      <PageState kind="loading" title="Loading application document retention" />
    );
  }

  const application = (entry: { business_name: string }) => <span className="font-medium">{entry.business_name}</span>;
  const documentLabel = (file: ApplicationRetentionFile) => `${kindLabel[file.kind] ?? file.kind} · ${file.file_name}`;
  const location = (file: ApplicationRetentionFile, expected: ObjectLocation) =>
    file.object_location === expected ? null : (
      <span className="block text-xs text-status-danger">{objectLocationLabel[file.object_location]}</span>
    );
  const closed = (file: ApplicationRetentionFile) => (
    <span className="flex flex-col gap-0.5">
      <span>
        {file.closure_outcome ? closureOutcomeLabel[file.closure_outcome] : "Reopened"}
        {file.closed_at ? ` ${formatRenewalDate(file.closed_at)}` : ""}
      </span>
      {file.retention_ends_at && (
        <span className="text-xs text-muted-foreground">
          {new Date(file.retention_ends_at).getTime() <= new Date(queue.evaluated_at).getTime() ? "Retention ended" : "Retention ends"} {formatRenewalDate(file.retention_ends_at)}
        </span>
      )}
    </span>
  );

  const dueColumns: DataColumn<ApplicationRetentionFile>[] = [
    { key: "application", label: "Application", render: application },
    { key: "document", label: "Document", render: documentLabel },
    { key: "closed", label: "Closed", render: closed },
    {
      key: "action",
      label: "Next action",
      render: (file) => (
        <span className="flex flex-col items-start gap-1">
          {location(file, "documents")}
          {file.held ? (
            <span className="text-sm">On retention hold. Release the hold before quarantining.</span>
          ) : file.object_location === "missing" || file.object_location === "both" ? (
            <span className="text-sm">Investigate the stored file before any retention step.</span>
          ) : (
            <ConfirmAction
              disabled={loading}
              requireReason
              reasonHelp="Recorded with the step. For example: CFG-011 retention period ended; no hold or investigation."
              triggerLabel="Quarantine"
              title="Move this document to quarantine?"
              entity={`${file.business_name} · ${documentLabel(file)}`}
              consequence={`Moves the file out of document storage into quarantine, where operators cannot open it. It can be restored for ${queue.quarantine_days} days and may then be deleted permanently. The application and its closure do not change.`}
              confirmLabel="Quarantine"
              onConfirm={step(file, "quarantine")}
            />
          )}
        </span>
      ),
    },
  ];

  const quarantineColumns: DataColumn<ApplicationRetentionFile>[] = [
    { key: "application", label: "Application", render: application },
    { key: "document", label: "Document", render: documentLabel },
    {
      key: "quarantined",
      label: "Quarantined",
      render: (file) => {
        const days = daysUntil(file.quarantine_ends_at, queue.evaluated_at);
        return (
          <span className="flex flex-col gap-0.5">
            <span>{file.retention_since ? formatRenewalDate(file.retention_since) : ""}</span>
            <span className="text-xs text-muted-foreground">
              {!file.closure_outcome
                ? "Application reopened; deletion is closed"
                : days
                  ? `Deletion opens in ${days} day${days === 1 ? "" : "s"}`
                  : "Deletion is open"}
            </span>
          </span>
        );
      },
    },
    {
      key: "action",
      label: "Actions",
      render: (file) => {
        const days = daysUntil(file.quarantine_ends_at, queue.evaluated_at);
        const completedElsewhere = file.object_location === "missing";
        return (
          <span className="flex flex-col items-start gap-2">
            {location(file, "quarantine")}
            <span className="flex flex-wrap gap-2">
              {(file.object_location === "quarantine" || file.object_location === "documents") && (
                <ConfirmAction
                  disabled={loading}
                  requireReason
                  reasonHelp="Recorded with the step. Explain why the file must be kept."
                  triggerLabel="Restore"
                  title="Restore this document?"
                  entity={`${file.business_name} · ${documentLabel(file)}`}
                  consequence="Moves the file back to document storage. The application stays closed, and if its retention period has ended the file returns to the due list."
                  confirmLabel="Restore"
                  confirmationTone="commitment"
                  onConfirm={step(file, "restore")}
                />
              )}
              {days === 0 && file.closure_outcome && (!file.held || completedElsewhere) && (
                <ConfirmAction
                  disabled={loading}
                  requireReason
                  reasonHelp="Recorded with the deletion. For example: quarantine period ended; no hold or investigation."
                  triggerLabel="Delete permanently"
                  title="Delete this document permanently?"
                  entity={`${file.business_name} · ${documentLabel(file)}`}
                  consequence="Removes the file from quarantine. This cannot be undone. The application and its closure remain; the file cannot be opened or restored."
                  confirmLabel="Delete permanently"
                  onConfirm={step(file, "delete")}
                />
              )}
            </span>
            {file.held && !completedElsewhere && (
              <span className="text-sm">On retention hold. Deletion stays closed until the hold is released.</span>
            )}
          </span>
        );
      },
    },
  ];

  const keptColumns: DataColumn<ApplicationRetentionFile>[] = [
    { key: "application", label: "Application", render: application },
    { key: "document", label: "Document", render: documentLabel },
    { key: "closed", label: "Closed", render: closed },
  ];

  const section = (
    id: string,
    title: string,
    rows: ApplicationRetentionFile[],
    columns: DataColumn<ApplicationRetentionFile>[],
    empty: string,
    note?: string,
  ) => (
    <section aria-labelledby={id} className="space-y-3">
      <h3 id={id} className="text-base font-semibold">
        {title} ({rows.length})
      </h3>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <ResponsiveDataList
            label={title}
            rows={rows}
            columns={columns}
            rowKey={(file) => file.path}
            rowLabel={(file) => `${file.business_name} · ${file.file_name}`}
          />
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} The queue below is from the last successful load.
        </p>
      )}

      <section aria-labelledby="application-retention-holds" className="space-y-3">
        <h3 id="application-retention-holds" className="text-base font-semibold">
          Application retention holds ({queue.holds.length})
        </h3>
        <p className="text-sm text-muted-foreground">
          Place a hold from the application in{" "}
          <Link href="/admin/applications" className={linkClass}>
            Applications
          </Link>
          . A provider hold also covers the documents of that provider&apos;s applications.
        </p>
        {queue.holds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No application is on a retention hold.</p>
        ) : (
          <ul aria-label="Application retention holds" className="divide-y rounded-xl border bg-card">
            {queue.holds.map((hold) => (
              <li key={hold.application_id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  {application(hold)}
                  <p className="break-words text-sm">{hold.reason}</p>
                  <p className="text-xs text-muted-foreground">Placed {formatRenewalDate(hold.placed_at)}</p>
                </div>
                <ConfirmAction
                  disabled={loading}
                  requireReason
                  reasonHelp="Recorded with the release. Explain why the hold no longer applies."
                  triggerLabel="Release hold"
                  title="Release this retention hold?"
                  entity={hold.business_name}
                  consequence="Quarantine and permanent deletion open again for this application's documents once their periods end, unless a provider hold applies."
                  confirmLabel="Release hold"
                  onConfirm={release(hold)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {section("application-retention-due", "Application documents due for quarantine", queue.due, dueColumns,
        `No closed application's documents have passed the ${queue.retention_days}-day retention period.`)}
      {section("application-retention-quarantined", "Application documents in quarantine", queue.quarantined, quarantineColumns,
        "No application document is in quarantine.")}
      {section("application-retention-kept", "Kept as compliance evidence", queue.kept, keptColumns,
        "No closed application's document is compliance evidence.",
        "These documents are referenced by provider compliance evidence, so they are never quarantined or deleted.")}

      <section aria-labelledby="application-retention-unrecorded" className="space-y-3">
        <h3 id="application-retention-unrecorded" className="text-base font-semibold">
          Closed without a recorded time ({queue.unrecorded.length})
        </h3>
        <p className="text-sm text-muted-foreground">
          These applications were marked rejected or abandoned before closures were recorded, so their documents are not due.
          Record the closure from the application in Applications to start the {queue.retention_days}-day clock.
        </p>
        {queue.unrecorded.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every closed application has a recorded closure.</p>
        ) : (
          <ul aria-label="Closed without a recorded time" className="divide-y rounded-xl border bg-card">
            {queue.unrecorded.map((entry) => (
              <li key={entry.application_id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
                {application(entry)}
                <span className="text-muted-foreground">
                  {closureOutcomeLabel[entry.status as keyof typeof closureOutcomeLabel] ?? entry.status}
                  {entry.has_provider ? " · has a provider record; decide through onboarding review" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
