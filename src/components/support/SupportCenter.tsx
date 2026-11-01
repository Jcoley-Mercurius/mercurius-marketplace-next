"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { formatAppointment } from "@/lib/appointments";
import {
  describeSupportError, newRequestKey, responseDueText, ticketKindLabel, ticketStatusLabel, type SupportTicket,
} from "@/lib/support";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// TRACE-133: one support area for homeowners and providers. Requests go through
// open_support_ticket; replies through post_support_message. Neither changes a service, opens a
// dispute, authorizes a refund or releases a hold, and the page says so.
export function SupportCenter({ audience }: { audience: "homeowner" | "provider" }) {
  const params = useSearchParams();
  const linkedJob = params.get("job");
  const [tickets, setTickets] = useState<SupportTicket[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const result = await createClient().rpc("my_support_tickets");
    setLoading(false);
    if (result.error) { setLoadError(describeSupportError(result.error)); return; }
    setTickets(((result.data as { items?: SupportTicket[] } | null)?.items) ?? []);
  }, []);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);

  return <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
    <PageHeader eyebrow="Help" title="Support"
      description="Mercurius support works Monday to Friday, 9 a.m. to 5 p.m. Eastern. We aim to reply within one business day, and issues about an appointment happening today get same-day priority during those hours."
      actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" />Refresh</Button>} />
    <p className="rounded-xl border bg-muted/40 p-4 text-sm">
      Contacting support doesn&apos;t change your service, open a dispute, start a refund or release a payment.
      {audience === "homeowner"
        ? " To dispute a completed service within its 48-hour window, use “Dispute completed service” on that service."
        : " Mercurius will tell you if a request needs anything from you."}
    </p>
    <NewRequest linkedJob={linkedJob && UUID.test(linkedJob) ? linkedJob : null} onOpened={async (id) => { await load(); setOpenId(id); }} />
    <section aria-labelledby="support-requests" className="space-y-3">
      <h2 id="support-requests" className="text-xl font-semibold">Your requests</h2>
      {loading && !tickets && <PageState kind="loading" title="Loading your requests" />}
      {loadError && <PageState kind="error" title="Your requests couldn't be loaded" description={loadError}
        action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} />}
      {tickets && tickets.length === 0 && !loadError && <PageState kind="empty" title="No support requests yet" description="Requests you send appear here with every reply." />}
      {tickets?.map((ticket) => <TicketCard key={ticket.ticket_id} ticket={ticket} open={openId === ticket.ticket_id}
        onToggle={() => setOpenId((current) => current === ticket.ticket_id ? null : ticket.ticket_id)} onChanged={load} />)}
    </section>
  </div>;
}

function NewRequest({ linkedJob, onOpened }: { linkedJob: string | null; onOpened: (ticketId: string) => Promise<void> }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [linkJob, setLinkJob] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  // One key per draft: a retry after a lost response returns the same request instead of a second one.
  const key = useRef(newRequestKey());
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!subject.trim() || !description.trim()) { setError("Add a subject and describe what you need."); return; }
    setPending(true); setError(""); setDone("");
    const result = await createClient().rpc("open_support_ticket", {
      _request_key: key.current, _subject: subject.trim(), _description: description.trim(), _job_id: linkedJob && linkJob ? linkedJob : null,
    });
    setPending(false);
    if (result.error) { setError(describeSupportError(result.error)); return; }
    const data = result.data as { ticket_id: string; ticket_number: string };
    key.current = newRequestKey();
    setSubject(""); setDescription("");
    setDone(`Request ${data.ticket_number} sent. Replies appear below.`);
    await onOpened(data.ticket_id);
  }

  return <Card><CardContent className="space-y-4 p-4 sm:p-6">
    <h2 className="text-xl font-semibold">New request</h2>
    <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
      <FormField label="Subject" required>{(control) => <Input {...control} value={subject} maxLength={160}
        onChange={(event) => { setSubject(event.target.value); key.current = newRequestKey(); }} />}</FormField>
      <FormField label="What do you need help with?" required help="Up to 4,000 characters. Don't include card or bank details.">
        {(control) => <Textarea {...control} value={description} maxLength={4000} rows={5}
          onChange={(event) => { setDescription(event.target.value); key.current = newRequestKey(); }} />}
      </FormField>
      {linkedJob && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={linkJob} onChange={(event) => { setLinkJob(event.target.checked); key.current = newRequestKey(); }} />
        About the service you came from
      </label>}
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
      {done && <p role="status" className="text-sm">{done}</p>}
      <Button type="submit" variant="commitment" disabled={pending}>{pending && <Loader2 className="animate-spin" aria-hidden="true" />}Send request</Button>
    </form>
  </CardContent></Card>;
}

function TicketCard({ ticket, open, onToggle, onChanged }: { ticket: SupportTicket; open: boolean; onToggle: () => void; onChanged: () => Promise<void> }) {
  const due = responseDueText(ticket);
  const panelId = `ticket-${ticket.ticket_id}`;
  return <Card><CardContent className="space-y-3 p-4 sm:p-6">
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="font-mono text-xs text-muted-foreground">{ticket.ticket_number} · {ticketKindLabel(ticket.kind)}</p>
        <h3 className="font-semibold break-words">{ticket.subject}</h3>
        {ticket.job && <p className="text-sm text-muted-foreground">About: {ticket.job.service_type}</p>}
        {due && <p className="text-sm">{due}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-full border px-3 py-1 text-sm">{ticketStatusLabel[ticket.status]}</span>
        <Button variant="outline" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>{open ? "Hide" : "View"}</Button>
      </div>
    </div>
    {open && <div id={panelId} className="space-y-4 border-t pt-4">
      <p className="text-sm whitespace-pre-wrap break-words">{ticket.description}</p>
      <ol className="space-y-3" aria-label="Conversation">
        {ticket.messages.length === 0 && <li className="text-sm text-muted-foreground">No replies yet.</li>}
        {ticket.messages.map((message) => <li key={message.id} className={`rounded-xl border p-3 text-sm ${message.role === "operations" ? "bg-muted/40" : ""}`}>
          <p className="mb-1 font-medium">{message.mine ? "You" : "Mercurius support"} · <span className="font-normal text-muted-foreground">{formatAppointment(message.at)}</span></p>
          <p className="whitespace-pre-wrap break-words">{message.body}</p>
        </li>)}
      </ol>
      {ticket.can_reply ? <Reply ticketId={ticket.ticket_id} onSent={onChanged} />
        : <p className="text-sm">This request is {ticketStatusLabel[ticket.status].toLowerCase()}. If you still need help, send a new request.</p>}
    </div>}
  </CardContent></Card>;
}

function Reply({ ticketId, onSent }: { ticketId: string; onSent: () => Promise<void> }) {
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const key = useRef(newRequestKey());
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !body.trim()) { if (!body.trim()) setError("Write a reply first."); return; }
    setPending(true); setError("");
    const result = await createClient().rpc("post_support_message", { _ticket_id: ticketId, _request_key: key.current, _body: body.trim() });
    setPending(false);
    if (result.error) { setError(describeSupportError(result.error)); return; }
    key.current = newRequestKey();
    setBody("");
    await onSent();
  }

  return <form className="space-y-3" onSubmit={(event) => void send(event)} noValidate>
    <FormField label="Reply">{(control) => <Textarea {...control} value={body} maxLength={4000} rows={3}
      onChange={(event) => { setBody(event.target.value); key.current = newRequestKey(); }} />}</FormField>
    {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" aria-hidden="true" />}Send reply</Button>
  </form>;
}
