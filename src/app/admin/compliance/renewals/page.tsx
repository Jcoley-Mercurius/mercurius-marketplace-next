"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList, type DataColumn } from "@/components/ui/responsive-data-list";
import { createClient } from "@/lib/supabase/client";
import {
  formatRenewalDate,
  kindLabel,
  renewalTiming,
  type RenewalState,
} from "@/lib/evidenceRenewal";
import { renewalDocumentKindLabel, type RenewalDocumentKind } from "@/lib/renewalDocuments";
import { cn } from "@/lib/utils";

// TRACE-072 MPS §9 compliance expiry queue. Read-only: renewal is recorded in the
// provider's activation checklist, and lapsed evidence suspends nobody.

type Entry = {
  contractor_id: string;
  name: string;
  onboarding_status: "active" | "suspended";
  onboarding_revision: number;
  eligible: boolean;
  scoped_compliance_current: boolean;
  kind: string;
  evidence_id: string;
  requirement_version: string;
  accepted_at: string;
  expires_at: string;
  state: RenewalState;
};

type Queue = {
  evaluated_at: string;
  notice_days: number;
  cutover_enforced: boolean;
  entries: Entry[];
};

type Filter = "all" | RenewalState;

// TRACE-073: undecided renewal submissions across providers.
type PendingDocument = {
  id: string;
  contractor_id: string;
  name: string;
  onboarding_status: string;
  kind: RenewalDocumentKind;
  file_name: string;
  submitted_as: "provider" | "operator";
  created_at: string;
};

const stateTone: Record<RenewalState, string> = {
  expiring: "border-status-warning bg-status-warning-bg text-status-warning",
  lapsed: "border-status-danger bg-status-danger-bg text-status-danger",
};

function messageOf(value: unknown, fallback: string) {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    const { message } = value as { message?: unknown };
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export default function ComplianceExpiryPage() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [pending, setPending] = useState<PendingDocument[] | null>(null);
  const [pendingError, setPendingError] = useState("");

  const loadPending = useCallback(async () => {
    try {
      const { data, error: rpcError } = await createClient().rpc("vendor_renewal_document_queue");
      if (rpcError) throw rpcError;
      setPending((data as unknown as { entries: PendingDocument[] }).entries);
      setPendingError("");
    } catch (reason) {
      setPendingError(messageOf(reason, "Renewal documents awaiting review could not be loaded."));
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    void loadPending();
    try {
      const { data, error: rpcError } = await createClient().rpc("vendor_evidence_renewal_queue");
      if (rpcError) throw rpcError;
      setQueue(data as unknown as Queue);
    } catch (reason) {
      setError(messageOf(reason, "The compliance expiry queue could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, [loadPending]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const refresh = (
    <Button variant="outline" disabled={loading} onClick={() => void load()}>
      <RefreshCw />
      Refresh
    </Button>
  );

  const header = (
    <PageHeader
      eyebrow="Provider compliance"
      title="Compliance expiry"
      description={`Evidence for active and suspended providers that expires within ${queue?.notice_days ?? 30} days or has lapsed. Lapsed evidence takes the provider out of matching until it is renewed; it does not suspend them or hold payouts, except lapsed payout onboarding.`}
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
            title="Compliance expiry queue unavailable"
            description={error}
            action={
              <Button onClick={() => void load()}>
                <RefreshCw />
                Try again
              </Button>
            }
          />
        ) : (
          <PageState kind="loading" title="Loading compliance expiry queue" />
        )}
      </div>
    );
  }

  const lapsed = queue.entries.filter((entry) => entry.state === "lapsed").length;
  const expiring = queue.entries.length - lapsed;
  const rows = filter === "all" ? queue.entries : queue.entries.filter((entry) => entry.state === filter);

  const pendingColumns: DataColumn<PendingDocument>[] = [
    {
      key: "provider",
      label: "Provider",
      render: (document) => (
        <Link
          href={`/admin/vendors/${document.contractor_id}`}
          className="font-medium text-foreground underline underline-offset-4 hover:text-accent"
        >
          {document.name}
        </Link>
      ),
    },
    { key: "document", label: "Document", render: (document) => `${renewalDocumentKindLabel[document.kind]} · ${document.file_name}` },
    {
      key: "submitted",
      label: "Submitted",
      render: (document) => (
        <span className="flex flex-col gap-0.5">
          <span>{formatRenewalDate(document.created_at)}</span>
          <span className="text-xs text-muted-foreground">
            {document.submitted_as === "provider" ? "By the provider" : "Uploaded by an operator"}
          </span>
        </span>
      ),
    },
    {
      key: "next",
      label: "Next action",
      render: () => "Open the provider's activation checklist to review, then accept it as evidence or decline it with a note.",
    },
  ];

  const pendingSection = (
    <section aria-labelledby="pending-renewal-documents" className="space-y-3">
      <h2 id="pending-renewal-documents" className="text-lg font-semibold">
        Renewal documents awaiting review{pending ? ` (${pending.length})` : ""}
      </h2>
      {pendingError ? (
        <p role="alert" className="text-sm text-destructive">{pendingError}</p>
      ) : !pending ? (
        <p role="status" className="text-sm text-muted-foreground">Loading renewal documents...</p>
      ) : pending.length === 0 ? (
        <p className="text-sm text-muted-foreground">No renewal documents are awaiting review.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <ResponsiveDataList
            label="Renewal documents awaiting review"
            rows={pending}
            columns={pendingColumns}
            rowKey={(document) => document.id}
            rowLabel={(document) => `${document.name} · ${renewalDocumentKindLabel[document.kind]}`}
          />
        </div>
      )}
    </section>
  );

  const columns: DataColumn<Entry>[] = [
    {
      key: "provider",
      label: "Provider",
      render: (entry) => (
        <Link
          href={`/admin/vendors/${entry.contractor_id}`}
          className="font-medium text-foreground underline underline-offset-4 hover:text-accent"
        >
          {entry.name}
        </Link>
      ),
    },
    { key: "item", label: "Evidence", render: (entry) => `${kindLabel(entry.kind)} · ${entry.requirement_version}` },
    {
      key: "expiry",
      label: "Expiry",
      render: (entry) => (
        <span className="flex flex-col items-start gap-1">
          <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-medium", stateTone[entry.state])}>
            {renewalTiming(entry.state, entry.expires_at, queue.evaluated_at)}
          </span>
          <span className="text-xs text-muted-foreground">{formatRenewalDate(entry.expires_at)}</span>
        </span>
      ),
    },
    {
      key: "provider-state",
      label: "Provider state",
      render: (entry) => (
        <span className="flex flex-col gap-0.5">
          <span>{entry.onboarding_status === "active" ? "Active" : "Suspended"}</span>
          <span className="text-xs text-muted-foreground">
            {entry.eligible ? "Onboarding evidence current" : "Matching on hold"}
          </span>
        </span>
      ),
    },
    {
      key: "next",
      label: "Next action",
      render: (entry) => (
        <span className="flex flex-col gap-0.5">
          <span>
            {entry.state === "lapsed"
              ? "Record renewed evidence in the activation checklist, then record renewal."
              : `Collect renewed evidence before ${formatRenewalDate(entry.expires_at)}.`}
          </span>
          {entry.kind === "bank_authorization" && (
            <span className="text-xs text-muted-foreground">
              {entry.state === "lapsed" ? "Payouts are held until payout onboarding is renewed." : "Payouts will be held if payout onboarding lapses."}
            </span>
          )}
          {queue.cutover_enforced && ["license", "insurance"].includes(entry.kind) && (
            <span className="text-xs text-muted-foreground">
              Strict matching is on: bind the renewed document to its service areas in Provider compliance.
            </span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      {header}

      <section aria-label="Queue totals" className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        <Total label="Lapsed" value={lapsed} tone={lapsed ? "danger" : undefined} />
        <Total label={`Expiring within ${queue.notice_days} days`} value={expiring} tone={expiring ? "warning" : undefined} />
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

      <div role="group" aria-label="Filter by expiry state" className="flex flex-wrap gap-2">
        {(
          [
            ["all", `All (${queue.entries.length})`],
            ["lapsed", `Lapsed (${lapsed})`],
            ["expiring", `Expiring (${expiring})`],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? "default" : "outline"}
            aria-pressed={filter === value}
            className="min-h-10"
            onClick={() => setFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {pendingSection}

      <h2 className="text-lg font-semibold">Evidence needing renewal</h2>

      {queue.entries.length === 0 ? (
        <PageState
          kind="empty"
          title="No evidence needs renewal"
          description={`No live provider's evidence lapses within the next ${queue.notice_days} days.`}
        />
      ) : rows.length === 0 ? (
        <PageState kind="empty" title={`No ${filter} evidence`} description="Choose another filter to see the rest of the queue." />
      ) : (
        <section className="overflow-hidden rounded-xl border bg-card">
          <ResponsiveDataList
            label="Evidence needing renewal"
            rows={rows}
            columns={columns}
            rowKey={(entry) => entry.evidence_id}
            rowLabel={(entry) => `${entry.name} · ${kindLabel(entry.kind)}`}
          />
        </section>
      )}
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: number; tone?: "warning" | "danger" }) {
  return (
    <div className="bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold",
          tone === "warning" && "text-status-warning",
          tone === "danger" && "text-status-danger",
        )}
      >
        {value}
      </p>
    </div>
  );
}
