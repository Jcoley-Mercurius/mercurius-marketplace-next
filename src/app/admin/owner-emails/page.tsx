"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Eye, EyeOff, History, Mail, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { ContactSubmissionDetail } from "@/components/admin/ContactSubmissionDetail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { createClient } from "@/lib/supabase/client";
import {
  ACKNOWLEDGE_ATTESTATION,
  OWNER_EMAIL_PAGE_SIZE,
  RESEND_ATTESTATION,
  ownerEmailErrorLabel,
  ownerEmailIsUncertain,
  ownerEmailStateLabel,
  type OwnerEmailCursor,
  type OwnerEmailItem,
  type OwnerEmailOverview,
} from "@/lib/ownerEmails";
import { cn } from "@/lib/utils";

// TRACE-154 (Phase 7.2C-1): owner emails for saved contact submissions. Every read and
// command is admin-only in the database; this page only presents it. Rows carry a fixed
// label and a reference, never submitted content (R-1). Pages are bounded; the attention
// count is exact for the whole ledger (C-8). After any action the list reloads from the
// database; nothing is optimistic.
type Data = {
  checkedAt: string;
  attention: number;
  items: OwnerEmailItem[];
  cursor: OwnerEmailCursor | null;
};

const tone: Record<string, string> = {
  sent: "border-status-success bg-status-success-bg text-status-success",
  acknowledged: "border-border bg-muted text-muted-foreground",
  pending: "border-border bg-muted text-muted-foreground",
  sending: "border-border bg-muted text-muted-foreground",
};

async function fetchPage(includeSettled: boolean, cursor: OwnerEmailCursor | null) {
  const { data, error } = await createClient().rpc("owner_email_overview", {
    p_kind: "contact_submission",
    p_include_settled: includeSettled,
    p_before_created_at: cursor?.created_at ?? null,
    p_before_id: cursor?.id ?? null,
    p_limit: OWNER_EMAIL_PAGE_SIZE,
  });
  if (error) throw error;
  return data as OwnerEmailOverview;
}

function reason(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message
    : typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : fallback;
}

export default function AdminOwnerEmailsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState("");
  // Responses for an earlier filter or refresh are discarded.
  const generation = useRef(0);

  const load = useCallback(async (includeSettled: boolean) => {
    const ticket = ++generation.current;
    setError("");
    setOlderError("");
    try {
      const page = await fetchPage(includeSettled, null);
      if (ticket !== generation.current) return;
      setData({
        checkedAt: page.checked_at,
        attention: page.attention_count.contact_submission,
        items: page.items,
        cursor: page.next_cursor,
      });
    } catch (caught) {
      if (ticket === generation.current) setError(reason(caught, "Owner emails could not be loaded."));
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(showAll), 0);
    return () => window.clearTimeout(timer);
  }, [load, showAll]);

  const reload = () => load(showAll);

  const loadOlder = async () => {
    if (!data?.cursor || loadingOlder) return;
    const ticket = generation.current;
    setLoadingOlder(true);
    setOlderError("");
    try {
      const page = await fetchPage(showAll, data.cursor);
      if (ticket !== generation.current) return;
      setData((current) => current && {
        checkedAt: page.checked_at,
        attention: page.attention_count.contact_submission,
        items: [...current.items, ...page.items],
        cursor: page.next_cursor,
      });
    } catch (caught) {
      if (ticket === generation.current) setOlderError(reason(caught, "Older emails could not be loaded."));
    } finally {
      setLoadingOlder(false);
    }
  };

  if (error) return <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 md:p-8"><AdminError title="Owner emails could not be loaded" message={error} retry={() => void reload()} /></div>;
  if (!data) return <AdminLoading label="Loading owner emails..." />;

  const resend = async (item: OwnerEmailItem, attested: boolean) => {
    let response: Response;
    let body: { error?: string; message?: string; state?: string } | null;
    try {
      response = await fetch("/api/admin/owner-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, sourceId: item.source_id, confirmNoEmail: attested }),
      });
      body = await response.json().catch(() => null);
    } catch {
      const message = "The resend result could not be confirmed. Review the refreshed state before acting again.";
      toast.error("Resend result unknown", { description: message });
      throw new Error(message);
    } finally {
      // A lost response may follow a committed claim or send. Always read the ledger,
      // including when fetch rejects before an HTTP response is available.
      await reload();
    }
    if (!response.ok) {
      const message = body?.error ?? body?.message ?? "Refresh and try again.";
      toast.error("Email was not resent", { description: message });
      throw new Error(message);
    }
    (body?.state === "sent" ? toast.success : toast.warning)("Resend recorded", { description: body?.message });
  };

  const acknowledge = async (item: OwnerEmailItem, text: string, attested: boolean) => {
    let ackError: { message: string } | null;
    try {
      const result = await createClient().rpc("owner_email_acknowledge", {
        p_kind: item.kind,
        p_source: item.source_id,
        p_reason: text,
        p_inbox_checked: attested,
      });
      ackError = result.error;
    } catch {
      const message = "The acknowledgement result could not be confirmed. Review the refreshed state before acting again.";
      toast.error("Acknowledgement not confirmed", { description: message });
      throw new Error(message);
    } finally {
      await reload();
    }
    if (ackError) {
      // Supabase may return a transport error instead of throwing after a commit.
      toast.error("Acknowledgement not confirmed", { description: ackError.message });
      throw new Error(ackError.message);
    }
    toast.success("Acknowledged", { description: "No email was sent. The submission stays saved." });
  };

  const loadedAttention = data.items.filter((item) => item.needs_attention).length;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Support</p>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Owner emails</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Every saved message stays saved whatever happens to its email. “Accepted by Resend” means Resend accepted it, not that it reached the inbox.
            Checked {formatDateTime(data.checkedAt)}.
          </p>
        </div>
        <Button variant="outline" className="min-h-11" onClick={() => void reload()}><RefreshCw />Refresh</Button>
      </header>

      <Card className={cn(data.attention > 0 && "border-status-warning")}>
        <CardContent className="flex items-center justify-between gap-3 py-4">
          <div>
            <p className="text-sm font-medium">Contact form emails needing attention</p>
            {data.attention > 0 && (
              <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-status-warning">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />Needs attention
              </p>
            )}
          </div>
          <p className="font-heading text-2xl font-semibold tabular-nums">{data.attention}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg"><Mail className="h-5 w-5 text-accent" />Contact form emails</CardTitle>
          <CardDescription>
            Each row is a saved contact submission. Open a submission to read it; the list never shows its content.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" size="sm" className="min-h-11 self-start" aria-pressed={showAll} onClick={() => setShowAll((value) => !value)}>
              {showAll ? <EyeOff /> : <Eye />}
              {showAll ? "Show only emails needing attention" : "Show all tracked emails"}
            </Button>
            {!showAll && loadedAttention < data.attention && (
              <p role="status" className="text-sm text-muted-foreground">Showing {loadedAttention} of {data.attention} needing attention</p>
            )}
          </div>
          <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <History className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Messages saved before email tracking began are not listed here and cannot be resent.
          </p>

          {data.items.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              {showAll ? "No tracked owner emails yet." : "No owner emails need attention."}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border" aria-label="Contact form emails">
              {data.items.map((item) => <Row key={item.source_id} item={item} onResend={resend} onAcknowledge={acknowledge} />)}
            </ul>
          )}

          {olderError && <p role="alert" className="text-sm text-destructive">{olderError}</p>}
          {data.cursor && (
            <Button variant="outline" className="min-h-11" loading={loadingOlder} disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "Loading older…" : "Load older"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ item, onResend, onAcknowledge }: {
  item: OwnerEmailItem;
  onResend: (item: OwnerEmailItem, attested: boolean) => Promise<void>;
  onAcknowledge: (item: OwnerEmailItem, reason: string, attested: boolean) => Promise<void>;
}) {
  const uncertain = ownerEmailIsUncertain(item.state);
  const error = item.last_error_code ? ownerEmailErrorLabel[item.last_error_code] : null;
  const entity = `${item.label} · Ref ${item.reference}`;
  return (
    <li className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">{item.label}</p>
          <span className="font-mono text-xs text-muted-foreground">Ref {item.reference}</span>
          <Badge className={cn("border", tone[item.state] ?? "border-status-warning bg-status-warning-bg text-status-warning")}>
            {ownerEmailStateLabel(item.state)}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Submitted {formatDateTime(item.submitted_at)} · {item.attempts} attempt{item.attempts === 1 ? "" : "s"}
          {item.sent_at ? ` · accepted ${formatDateTime(item.sent_at)}` : ""}
          {item.acknowledged_at ? ` · acknowledged ${formatDateTime(item.acknowledged_at)}` : ""}
        </p>
        {error && item.state !== "sent" && item.state !== "acknowledged" && (
          <p className="mt-1 break-words text-xs"><span className="font-medium text-destructive">{error.label}.</span> <span className="text-muted-foreground">{error.next}</span></p>
        )}
        {uncertain && (
          <p className="mt-1 text-xs text-muted-foreground">
            {item.state === "missed"
              ? "No sender claimed this email. A previous release may have sent it. Check the owner inbox and the Resend log first."
              : "The email may have been accepted. Check the owner inbox and the Resend log first."}
          </p>
        )}
        {item.acknowledged_reason && <p className="mt-1 break-words text-xs text-muted-foreground">Reason: {item.acknowledged_reason}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <ContactSubmissionDetail sourceId={item.source_id} reference={item.reference} />
        {item.needs_attention && (
          <>
            <ConfirmAction
              triggerLabel="Resend email"
              title="Resend the owner email?"
              entity={entity}
              consequence={uncertain
                ? "An earlier email may already have arrived. Resend only if the owner inbox and the Resend log show no email for this submission. This sends one owner email; it creates no submission."
                : "Sends one owner email for this saved submission. It creates no submission."}
              confirmLabel="Resend"
              confirmationTone="commitment"
              attestation={uncertain ? RESEND_ATTESTATION : undefined}
              describeError={(caught) => (caught instanceof Error ? caught.message : undefined)}
              onConfirm={(_reason, _choice, attested) => onResend(item, attested)}
            />
            <ConfirmAction
              triggerLabel="Acknowledge"
              title="Acknowledge without email?"
              entity={entity}
              consequence={uncertain
                ? "Records that no further email is needed. Check the owner inbox and the Resend log first, then say what you found, including if the email did arrive. Nothing is sent."
                : "Records that no further email is needed, for example because you read the submission here. Nothing is sent."}
              confirmLabel="Acknowledge"
              confirmationTone="commitment"
              requireReason
              reasonLabel={uncertain ? "What you found and why no further email is needed" : "Reason"}
              reasonHelp="Describe what you checked. Don't include the submitter's personal details."
              attestation={uncertain ? ACKNOWLEDGE_ATTESTATION : undefined}
              describeError={(caught) => (caught instanceof Error ? caught.message : undefined)}
              onConfirm={(text, _choice, attested) => onAcknowledge(item, text, attested)}
            />
          </>
        )}
      </div>
    </li>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
}
