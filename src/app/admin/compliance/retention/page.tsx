"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList, type DataColumn } from "@/components/ui/responsive-data-list";
import { createClient } from "@/lib/supabase/client";
import { formatRenewalDate } from "@/lib/evidenceRenewal";
import { renewalDocumentKindLabel, type RenewalDocumentKind } from "@/lib/renewalDocuments";
import {
  daysUntil,
  objectLocationLabel,
  requestRetentionStep,
  type ObjectLocation,
  type RetentionAction,
} from "@/lib/renewalRetention";
import { cn } from "@/lib/utils";
import {
  ApplicationDocumentRetention,
  type ApplicationRetentionTotals,
} from "@/components/admin/ApplicationDocumentRetention";

// TRACE-074 CFG-011 retention queue for declined renewal documents; TRACE-084 adds the
// documents of rejected or abandoned applications below it. Each step is run by an
// operator behind ConfirmAction and confirmed by rereading this queue. Nothing here
// changes a submission, decision, evidence, status or listing. TRACE-085: the totals
// count both queues and are withheld until the application queue has loaded.

type Entry = {
  id: string;
  contractor_id: string;
  name: string;
  kind: RenewalDocumentKind;
  file_name: string;
  decided_at: string;
  retention_state: "retained" | "quarantined";
  retention_since: string | null;
  retention_ends_at: string;
  quarantine_ends_at: string | null;
  object_location: ObjectLocation;
  held: boolean;
};

type Hold = { contractor_id: string; name: string; reason: string; placed_at: string };

type Queue = {
  evaluated_at: string;
  retention_days: number;
  quarantine_days: number;
  due: Entry[];
  quarantined: Entry[];
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

const linkClass = "font-medium text-foreground underline underline-offset-4 hover:text-accent";

export default function DocumentRetentionPage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nonce] = useState(() => crypto.randomUUID());
  const [applicationTotals, setApplicationTotals] = useState<ApplicationRetentionTotals>(null);
  const [applicationRefresh, setApplicationRefresh] = useState(0);

  const read = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data, error: rpcError } = await createClient().rpc("vendor_document_retention_queue");
      if (rpcError) throw rpcError;
      const next = data as unknown as Queue;
      setQueue(next);
      return next;
    } catch (reason) {
      setError(messageOf(reason, "The document retention queue could not be loaded."));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void read(), 0);
    return () => window.clearTimeout(timer);
  }, [read]);

  const step = (entry: Entry, action: RetentionAction) => async (reason: string) => {
    const titles = { quarantine: "Document quarantined", restore: "Document restored", delete: "Document permanently deleted" };
    try {
      const result = await requestRetentionStep({ documentId: entry.id, action, reason, key: `renewal-retention:${nonce}:${action}:${entry.id}:${entry.retention_since ?? "declined"}` });
      const next = await read();
      const inQuarantine = next?.quarantined.some((candidate) => candidate.id === entry.id);
      const due = next?.due.some((candidate) => candidate.id === entry.id);
      const confirmed = next !== null && (action === "quarantine" ? inQuarantine : action === "restore" ? !inQuarantine : !inQuarantine && !due);
      if (!confirmed) throw new Error("The server did not confirm this step. Review the queue before retrying.");
      toast.success(titles[action], {
        description: result.underHold
          ? `${entry.name} · ${entry.file_name}. Recorded while the provider is on a retention hold.`
          : `${entry.name} · ${renewalDocumentKindLabel[entry.kind]} · ${entry.file_name}`,
      });
    } catch (reason) {
      toast.error("Retention step not completed", { description: messageOf(reason, "Please try again.") });
      throw reason;
    }
  };

  const release = (hold: Hold) => async (reason: string) => {
    try {
      const { error: rpcError } = await createClient().rpc("vendor_release_retention_hold", {
        p_contractor: hold.contractor_id,
        p_reason: reason,
        p_key: `retention-hold-release:${nonce}:${hold.contractor_id}:${hold.placed_at}`,
      });
      if (rpcError) throw new Error(rpcError.message);
      const next = await read();
      if (!next || next.holds.some((candidate) => candidate.contractor_id === hold.contractor_id)) {
        throw new Error("The server did not confirm the release. Review the queue before retrying.");
      }
      toast.success("Retention hold released", { description: hold.name });
    } catch (reason) {
      toast.error("Hold could not be released", { description: messageOf(reason, "Please try again.") });
      throw reason;
    }
  };

  const refresh = (
    <Button
      variant="outline"
      disabled={loading}
      onClick={() => {
        void read();
        setApplicationRefresh((count) => count + 1);
      }}
    >
      <RefreshCw />
      Refresh
    </Button>
  );

  const header = (
    <PageHeader
      eyebrow="Provider compliance"
      title="Document retention"
      description={`Declined renewal documents, and the documents of rejected or abandoned applications, are kept for ${queue?.retention_days ?? 90} days after the decline or closure. After that an operator may move the file to quarantine, where it can be restored for ${queue?.quarantine_days ?? 14} days before it may be deleted permanently. A retention hold stops quarantine and deletion.`}
      actions={refresh}
    />
  );

  if (!queue) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
        {header}
        {error ? (
          <PageState
            kind="error"
            title="Document retention queue unavailable"
            description={error}
            action={
              <Button onClick={() => void read()}>
                <RefreshCw />
                Try again
              </Button>
            }
          />
        ) : (
          <PageState kind="loading" title="Loading document retention queue" />
        )}
      </div>
    );
  }

  const provider = (entry: { contractor_id: string; name: string }) => (
    <Link href={`/admin/vendors/${entry.contractor_id}`} className={linkClass}>
      {entry.name}
    </Link>
  );
  const documentLabel = (entry: Entry) => `${renewalDocumentKindLabel[entry.kind]} · ${entry.file_name}`;
  const location = (entry: Entry, expected: ObjectLocation) =>
    entry.object_location === expected ? null : (
      <span className="block text-xs text-status-danger">{objectLocationLabel[entry.object_location]}</span>
    );

  const dueColumns: DataColumn<Entry>[] = [
    { key: "provider", label: "Provider", render: provider },
    { key: "document", label: "Document", render: documentLabel },
    {
      key: "declined",
      label: "Declined",
      render: (entry) => (
        <span className="flex flex-col gap-0.5">
          <span>{formatRenewalDate(entry.decided_at)}</span>
          <span className="text-xs text-muted-foreground">Retention ended {formatRenewalDate(entry.retention_ends_at)}</span>
        </span>
      ),
    },
    {
      key: "action",
      label: "Next action",
      render: (entry) => (
        <span className="flex flex-col items-start gap-1">
          {location(entry, "documents")}
          {entry.held ? (
            <span className="text-sm">On retention hold. Release the hold before quarantining.</span>
          ) : entry.object_location === "missing" || entry.object_location === "both" ? (
            <span className="text-sm">Investigate the stored file before any retention step.</span>
          ) : (
            <ConfirmAction
              disabled={loading}
              requireReason
              reasonHelp="Recorded with the step. For example: CFG-011 retention period ended; no hold or investigation."
              triggerLabel="Quarantine"
              title="Move this document to quarantine?"
              entity={`${entry.name} · ${documentLabel(entry)}`}
              consequence={`Moves the file out of document storage into quarantine, where operators cannot open it. It can be restored for ${queue.quarantine_days} days and may then be deleted permanently. The decline, evidence and provider status do not change.`}
              confirmLabel="Quarantine"
              onConfirm={step(entry, "quarantine")}
            />
          )}
        </span>
      ),
    },
  ];

  const quarantineColumns: DataColumn<Entry>[] = [
    { key: "provider", label: "Provider", render: provider },
    { key: "document", label: "Document", render: documentLabel },
    {
      key: "quarantined",
      label: "Quarantined",
      render: (entry) => {
        const days = daysUntil(entry.quarantine_ends_at, queue.evaluated_at);
        return (
          <span className="flex flex-col gap-0.5">
            <span>{entry.retention_since ? formatRenewalDate(entry.retention_since) : ""}</span>
            <span className="text-xs text-muted-foreground">
              {days ? `Deletion opens in ${days} day${days === 1 ? "" : "s"}` : "Deletion is open"}
            </span>
          </span>
        );
      },
    },
    {
      key: "action",
      label: "Actions",
      render: (entry) => {
        const days = daysUntil(entry.quarantine_ends_at, queue.evaluated_at);
        const completedElsewhere = entry.object_location === "missing";
        return (
          <span className="flex flex-col items-start gap-2">
            {location(entry, "quarantine")}
            <span className="flex flex-wrap gap-2">
              {(entry.object_location === "quarantine" || entry.object_location === "documents") && (
                <ConfirmAction
                  disabled={loading}
                  requireReason
                  reasonHelp="Recorded with the step. Explain why the file must be kept."
                  triggerLabel="Restore"
                  title="Restore this document?"
                  entity={`${entry.name} · ${documentLabel(entry)}`}
                  consequence="Moves the file back to document storage. It stays declined, and because its retention period has ended it returns to the due list."
                  confirmLabel="Restore"
                  confirmationTone="commitment"
                  onConfirm={step(entry, "restore")}
                />
              )}
              {days === 0 && (!entry.held || completedElsewhere) && (
                <ConfirmAction
                  disabled={loading}
                  requireReason
                  reasonHelp="Recorded with the deletion. For example: quarantine period ended; no hold or investigation."
                  triggerLabel="Delete permanently"
                  title="Delete this document permanently?"
                  entity={`${entry.name} · ${documentLabel(entry)}`}
                  consequence="Removes the file from quarantine. This cannot be undone. The submission and decline records remain; the file cannot be opened or restored."
                  confirmLabel="Delete permanently"
                  onConfirm={step(entry, "delete")}
                />
              )}
            </span>
            {entry.held && !completedElsewhere && (
              <span className="text-sm">On retention hold. Deletion stays closed until the hold is released.</span>
            )}
          </span>
        );
      },
    },
  ];

  const section = (id: string, title: string, rows: Entry[], columns: DataColumn<Entry>[], empty: string) => (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-lg font-semibold">
        {title} ({rows.length})
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <ResponsiveDataList
            label={title}
            rows={rows}
            columns={columns}
            rowKey={(entry) => entry.id}
            rowLabel={(entry) => `${entry.name} · ${renewalDocumentKindLabel[entry.kind]}`}
          />
        </div>
      )}
    </section>
  );

  // Renewal and application documents together; unknown until both queues have loaded.
  const combined = (renewal: number, application: number | undefined) =>
    application === undefined ? null : renewal + application;
  const due = combined(queue.due.length, applicationTotals?.due);
  const quarantined = combined(queue.quarantined.length, applicationTotals?.quarantined);
  const holds = combined(queue.holds.length, applicationTotals?.holds);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      {header}

      <section aria-label="Queue totals" className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        <Total label="Due for quarantine" value={due} tone={due ? "warning" : undefined} />
        <Total label="In quarantine" value={quarantined} />
        <Total label="Retention holds" value={holds} />
        <div className="bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Evaluated</p>
          <p className="mt-1 text-sm font-medium">{new Date(queue.evaluated_at).toLocaleString()}</p>
        </div>
      </section>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} The queue below is from the last successful load.
        </p>
      )}

      <section aria-labelledby="retention-holds" className="space-y-3">
        <h2 id="retention-holds" className="text-lg font-semibold">
          Retention holds ({queue.holds.length})
        </h2>
        <p className="text-sm text-muted-foreground">
          Place a hold from the provider&apos;s activation checklist when an investigation or legal hold applies.
        </p>
        {queue.holds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No provider is on a retention hold.</p>
        ) : (
          <ul aria-label="Retention holds" className="divide-y rounded-xl border bg-card">
            {queue.holds.map((hold) => (
              <li key={hold.contractor_id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1">
                  {provider(hold)}
                  <p className="break-words text-sm">{hold.reason}</p>
                  <p className="text-xs text-muted-foreground">Placed {formatRenewalDate(hold.placed_at)}</p>
                </div>
                <ConfirmAction
                  disabled={loading}
                  requireReason
                  reasonHelp="Recorded with the release. Explain why the hold no longer applies."
                  triggerLabel="Release hold"
                  title="Release this retention hold?"
                  entity={hold.name}
                  consequence="Quarantine and permanent deletion open again for this provider's declined documents once their periods end."
                  confirmLabel="Release hold"
                  onConfirm={release(hold)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {section("retention-due", "Due for quarantine", queue.due, dueColumns, `No declined document has passed its ${queue.retention_days}-day retention period.`)}
      {section("retention-quarantined", "In quarantine", queue.quarantined, quarantineColumns, "No document is in quarantine.")}

      {/* TRACE-084: documents of rejected or abandoned applications. */}
      <section aria-labelledby="application-retention" className="space-y-4 border-t pt-6">
        <h2 id="application-retention" className="text-lg font-semibold">
          Application documents
        </h2>
        <ApplicationDocumentRetention refreshKey={applicationRefresh} onTotals={setApplicationTotals} />
      </section>
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: number | null; tone?: "warning" }) {
  return (
    <div className="bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {value === null ? (
        <p className="mt-1 text-sm text-muted-foreground">Application queue not loaded</p>
      ) : (
        <p className={cn("mt-1 text-xl font-semibold", tone === "warning" && "text-status-warning")}>{value}</p>
      )}
    </div>
  );
}
