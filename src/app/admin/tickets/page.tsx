"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, Search, Ticket } from "lucide-react";
import { toast } from "sonner";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { formatAppointment } from "@/lib/appointments";
import {
  describeSupportError, disputeStatusLabel, newRequestKey, ticketFollowsDecision, ticketKindLabel, ticketStatusLabel,
  type QueueItem, type SupportQueue, type SupportTicket, type TicketStatus,
} from "@/lib/support";

const statuses: TicketStatus[] = ["open", "in-progress", "resolved", "closed"];

// TRACE-133: the operations support queue. Every change goes through a versioned, reasoned command
// with history; dispute tickets follow the dispute decision; nothing here moves money or a hold.
export default function AdminTicketsPage() {
  const [queue, setQueue] = useState<SupportQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const result = await createClient().rpc("admin_support_queue", { _include_closed: includeClosed });
    setLoading(false);
    if (result.error) { setError(describeSupportError(result.error)); return; }
    setQueue(result.data as SupportQueue);
  }, [includeClosed]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (queue?.items ?? []).filter((item) => !term
      || [item.ticket_number, item.subject, ticketKindLabel(item.kind), item.requester ?? "", item.assignee ?? ""].join(" ").toLowerCase().includes(term));
  }, [queue, search]);

  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Customer support</p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Support queue</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Mon–Fri 9–5 Eastern; reply within one business day; same-day priority for today&apos;s appointments (CFG-010). Closing a request never refunds, pays out or releases a hold.</p>
      </div>
      <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" />Refresh</Button>
    </header>
    {queue && <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {([["Open", queue.counts.open], ["Overdue", queue.counts.overdue], ["Same-day", queue.counts.same_day], ["Unassigned", queue.counts.unassigned]] as const)
        .map(([label, value]) => <div key={label} className="rounded-xl border bg-card p-4"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-2xl font-semibold">{value}</dd></div>)}
    </dl>}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search requests" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search number, subject, type, requester or assignee" className="pl-9" />
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={includeClosed} onChange={(event) => setIncludeClosed(event.target.checked)} />Include resolved and closed</label>
    </div>
    <Card><CardContent className="p-0">
      {loading && !queue ? <AdminLoading label="Loading the support queue" />
        : error ? <AdminError message={error} retry={() => void load()} />
        : rows.length === 0 ? <AdminEmpty icon={Ticket} title={queue?.items.length ? "No requests match this search" : "No open support requests"} description="New requests, disputes, appeals and service exceptions appear here." />
        : <ResponsiveDataList<QueueItem> label="Support requests" rows={rows} rowKey={(row) => row.ticket_id}
          rowLabel={(row) => `${row.ticket_number} · ${row.subject}`}
          columns={[
            { key: "ticket", label: "Request", render: (row) => <Button variant="link" className="h-auto p-0 text-left whitespace-normal" onClick={() => setSelected(row.ticket_id)}>
              <span className="font-mono text-xs">{row.ticket_number}</span> <span className="font-medium">{row.subject}</span></Button> },
            { key: "kind", label: "Type", render: (row) => <>{ticketKindLabel(row.kind)}{row.dispute_status && <span className="block text-xs text-muted-foreground">Dispute: {disputeStatusLabel[row.dispute_status]}</span>}</> },
            { key: "requester", label: "Requester", render: (row) => row.requester ?? "—" },
            { key: "age", label: "Opened", render: (row) => formatAppointment(row.created_at) },
            { key: "due", label: "Response due", render: (row) => <span className={row.overdue ? "font-semibold text-destructive" : ""}>
              {row.response_due_at ? formatAppointment(row.response_due_at) : "—"}{row.overdue ? " · overdue" : ""}{row.priority === "same_day" ? " · same-day" : ""}</span> },
            { key: "owner", label: "Owner", render: (row) => row.assignee ?? "Unassigned (project owner)" },
            { key: "next", label: "Next action", render: (row) => row.next_action },
            { key: "status", label: "Status", render: (row) => ticketStatusLabel[row.status] },
          ]} />}
    </CardContent></Card>
    <TicketDialog key={selected ?? "none"} ticketId={selected} operators={queue?.operators ?? []} onClose={() => setSelected(null)} onChanged={load} />
  </div>;
}

function TicketDialog({ ticketId, operators, onClose, onChanged }: { ticketId: string | null; operators: SupportQueue["operators"]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!ticketId) return;
    setError("");
    const result = await createClient().rpc("support_ticket_detail", { _ticket_id: ticketId });
    if (result.error) { setError(describeSupportError(result.error)); return; }
    setTicket(result.data as SupportTicket);
  }, [ticketId]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  const refresh = async () => { await Promise.all([load(), onChanged()]); };

  return <Dialog open={Boolean(ticketId)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
      {!ticket && !error && <><DialogHeader><DialogTitle>Loading request</DialogTitle><DialogDescription>Fetching the latest version.</DialogDescription></DialogHeader><AdminLoading label="Loading request" /></>}
      {error && <><DialogHeader><DialogTitle>Request unavailable</DialogTitle><DialogDescription>{error}</DialogDescription></DialogHeader><Button variant="outline" onClick={() => void load()}>Try again</Button></>}
      {ticket && <div className="space-y-5">
        <DialogHeader>
          <DialogTitle className="break-words">{ticket.ticket_number}: {ticket.subject}</DialogTitle>
          <DialogDescription>{ticketKindLabel(ticket.kind)} · {ticketStatusLabel[ticket.status]} · from {ticket.requester?.name ?? "Unknown"} ({ticket.requester?.role}){ticket.opened_by && ticket.opened_by !== ticket.requester?.name ? ` · opened by ${ticket.opened_by}` : ""}</DialogDescription>
        </DialogHeader>
        <p className="whitespace-pre-wrap break-words rounded-xl bg-muted/40 p-4 text-sm">{ticket.description}</p>
        {ticket.job && <p className="text-sm">Service: {ticket.job.service_type} ({ticket.job.status.replaceAll("_", " ")}) · <Link className="underline" href="/admin/requests">Open request</Link></p>}
        {ticket.dispute && <p className="rounded-xl border p-3 text-sm">Dispute {disputeStatusLabel[ticket.dispute.status].toLowerCase()} (decision version {ticket.dispute.resolution_version}). This ticket closes with the dispute decision. <Link className="underline" href="/admin/disputes">Go to disputes</Link></p>}
        {ticket.review_appeal && <p className="rounded-xl border p-3 text-sm">{ticket.review_appeal.decided ? "The review appeal is decided; this ticket can be closed." : "Decide the review appeal first. "}<Link className="underline" href="/admin/reviews">Go to reviews</Link></p>}
        <section aria-labelledby="ticket-thread" className="space-y-2">
          <h3 id="ticket-thread" className="font-semibold">Conversation and notes</h3>
          <ol className="space-y-2">
            {ticket.messages.length === 0 && <li className="text-sm text-muted-foreground">No messages yet.</li>}
            {ticket.messages.map((message) => <li key={message.id} className={`rounded-xl border p-3 text-sm ${message.visibility === "internal" ? "border-dashed bg-amber-50 dark:bg-amber-950/30" : ""}`}>
              <p className="mb-1 font-medium">{message.visibility === "internal" ? "Internal note" : message.role === "operations" ? "Reply" : "Requester"} · {message.author ?? "Unknown"} · <span className="font-normal text-muted-foreground">{formatAppointment(message.at)}</span></p>
              <p className="whitespace-pre-wrap break-words">{message.body}</p>
            </li>)}
          </ol>
          <MessageForm ticketId={ticket.ticket_id} onSent={refresh} />
        </section>
        <Triage key={`${ticket.ticket_id}:${ticket.version}`} ticket={ticket} operators={operators} onSaved={refresh} />
        <section aria-labelledby="ticket-history" className="space-y-2">
          <h3 id="ticket-history" className="font-semibold">History</h3>
          <ol className="space-y-1 text-sm">{(ticket.history ?? []).map((entry, index) => <li key={index}>
            {formatAppointment(entry.at)} · {entry.by ?? "System"} · {entry.action === "opened" ? "opened" : `${entry.action.replace("_", " ")}: ${entry.from ?? "—"} → ${entry.to ?? "—"}`}{entry.reason ? ` · “${entry.reason}”` : ""}
          </li>)}</ol>
        </section>
      </div>}
    </DialogContent>
  </Dialog>;
}

function MessageForm({ ticketId, onSent }: { ticketId: string; onSent: () => Promise<void> }) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<"reply" | "note" | null>(null);
  const key = useRef(newRequestKey());
  async function send(kind: "reply" | "note") {
    if (!body.trim() || pending) return;
    setPending(kind);
    const result = await createClient().rpc(kind === "reply" ? "post_support_message" : "add_support_note", { _ticket_id: ticketId, _request_key: key.current, _body: body.trim() });
    setPending(null);
    if (result.error) { toast.error("Not saved", { description: describeSupportError(result.error) }); return; }
    key.current = newRequestKey(); setBody("");
    toast.success(kind === "reply" ? "Reply sent to the requester" : "Internal note saved");
    await onSent();
  }
  return <div className="space-y-2">
    <FormField label="Message" help="A reply is visible to the requester. An internal note is visible to operations only.">
      {(control) => <Textarea {...control} rows={3} maxLength={4000} value={body} onChange={(event) => { setBody(event.target.value); key.current = newRequestKey(); }} />}
    </FormField>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void send("reply")} disabled={!body.trim() || Boolean(pending)}>{pending === "reply" && <Loader2 className="animate-spin" aria-hidden="true" />}Send reply</Button>
      <Button variant="outline" onClick={() => void send("note")} disabled={!body.trim() || Boolean(pending)}>{pending === "note" && <Loader2 className="animate-spin" aria-hidden="true" />}Save internal note</Button>
    </div>
  </div>;
}

function Triage({ ticket, operators, onSaved }: { ticket: SupportTicket; operators: SupportQueue["operators"]; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [assignee, setAssignee] = useState(ticket.assigned_to ?? "");
  const [nextAction, setNextAction] = useState(ticket.next_action ?? "");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(newRequestKey());
  const locked = ticketFollowsDecision({ kind: ticket.kind, decision_recorded: ticket.review_appeal ? ticket.review_appeal.decided : null });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!reason.trim()) { setError("Record a reason for this change."); return; }
    setPending(true); setError("");
    const result = await createClient().rpc("admin_update_support_ticket", {
      _ticket_id: ticket.ticket_id, _request_key: key.current, _expected_version: ticket.version,
      _status: status === ticket.status ? null : status, _assigned_to: assignee || null, _unassign: !assignee && Boolean(ticket.assigned_to),
      _next_action: nextAction.trim() === (ticket.next_action ?? "") ? null : nextAction.trim(), _reason: reason.trim(),
    });
    setPending(false);
    if (result.error) { setError(describeSupportError(result.error)); return; }
    toast.success("Request updated");
    await onSaved();
  }

  return <form onSubmit={(event) => void save(event)} className="space-y-3 rounded-xl border p-4" noValidate>
    <h3 className="font-semibold">Triage</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label="Status" help={locked ?? undefined}>{(control) => <Select {...control} value={status} disabled={Boolean(locked) && status === ticket.status}
        onChange={(event) => setStatus(event.target.value as TicketStatus)}>
        {statuses.map((value) => <option key={value} value={value} disabled={Boolean(locked) && value !== ticket.status}>{ticketStatusLabel[value]}</option>)}
      </Select>}</FormField>
      <FormField label="Owner">{(control) => <Select {...control} value={assignee} onChange={(event) => setAssignee(event.target.value)}>
        <option value="">Unassigned (project owner)</option>
        {operators.map((operator) => <option key={operator.user_id} value={operator.user_id}>{operator.name}</option>)}
      </Select>}</FormField>
    </div>
    <FormField label="Next action">{(control) => <Input {...control} value={nextAction} onChange={(event) => setNextAction(event.target.value)} />}</FormField>
    <FormField label="Reason" required help="Kept in the request history.">{(control) => <Input {...control} value={reason} onChange={(event) => setReason(event.target.value)} />}</FormField>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" aria-hidden="true" />}Save change</Button>
  </form>;
}
