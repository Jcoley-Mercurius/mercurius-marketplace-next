"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CalendarClock, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EasternDateTimeField, easternInstant, type EasternDateTimeValue } from "@/components/ui/eastern-date-time-field";
import { actorLabel, appointmentState, easternParts, formatAppointment, historyLine, localStartParam, recordedInHistory, scheduleErrorMessage, type ScheduleReadback, type ScheduleViewer } from "@/lib/appointments";
import { createClient } from "@/lib/supabase/client";
import { proposalAnswerLine, replacementLine, requestFeeLine, type RescheduleInitiator } from "@/lib/exceptionResolutions";
import { LaterWaiver } from "@/components/admin/LaterWaiver";

const requestStatuses = new Set(["pending", "matched", "quoted", "scheduled", "in_progress"]);
const emptyEntry: EasternDateTimeValue = { date: "", time: "", choice: "" };
type Load = { state: "loading" } | { state: "error"; permission: boolean } | { state: "ready"; schedule: ScheduleReadback };

// TRACE-121: the appointment, any open reschedule request and the schedule history, read from
// job_schedule for every role. Operations records, changes or keeps the appointment; a homeowner
// or provider asks for a different time through the existing record_job_operation request.
// TRACE-132: a provider's proposed time is answered by the homeowner before operations can record
// it; after a provider withdrawal the homeowner accepts or declines the proposed replacement and time.
export function AppointmentPanel({ jobId, role, readOnly = false, onChanged }: { jobId: string; role: ScheduleViewer; readOnly?: boolean; onChanged?: () => void }) {
  const headingId = useId();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [entry, setEntry] = useState<EasternDateTimeValue>(emptyEntry);
  const [request, setRequest] = useState<EasternDateTimeValue>(emptyEntry);
  const [initiator, setInitiator] = useState<RescheduleInitiator | "">("");
  const [replacementEntry, setReplacementEntry] = useState<EasternDateTimeValue>(emptyEntry);
  const [problem, setProblem] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const keys = useRef(new Map<string, string>());
  const problemRef = useRef<HTMLParagraphElement>(null);

  const read = useCallback(async (): Promise<ScheduleReadback | null> => {
    const result = await createClient().rpc("job_schedule", { _job_id: jobId });
    if (result.error) {
      setLoad({ state: "error", permission: result.error.code === "42501" });
      return null;
    }
    const schedule = result.data as unknown as ScheduleReadback;
    setLoad({ state: "ready", schedule });
    return schedule;
  }, [jobId]);

  useEffect(() => {
    let active = true;
    createClient().rpc("job_schedule", { _job_id: jobId }).then(result => {
      if (!active) return;
      setLoad(result.error ? { state: "error", permission: result.error.code === "42501" } : { state: "ready", schedule: result.data as unknown as ScheduleReadback });
    }, () => { if (active) setLoad({ state: "error", permission: false }); });
    return () => { active = false; };
  }, [jobId]);

  // An open confirmation keeps focus on its own error; the panel's alert is read after it closes.
  useEffect(() => { if (problem && !document.querySelector("[role=alertdialog]")) problemRef.current?.focus(); }, [problem]);

  function keyFor(intent: unknown[]) {
    const text = JSON.stringify(intent);
    let key = keys.current.get(text);
    if (!key) { key = crypto.randomUUID(); keys.current.set(text, key); }
    return { key, forget: () => keys.current.delete(text) };
  }

  /** Runs a command; a failed or lost response counts as saved only when the readback shows it. */
  async function save(key: string, run: () => PromiseLike<{ error: unknown }>, done: string) {
    setProblem("");
    let failure: unknown = null;
    try {
      const result = await run();
      failure = result.error;
    } catch (error) {
      failure = error ?? new Error("No response");
    }
    const latest = await read().catch(() => null);
    if (failure && !recordedInHistory(latest, key)) {
      setProblem(scheduleErrorMessage(failure));
      throw failure;
    }
    setAnnouncement(done);
    onChanged?.();
  }

  if (load.state === "loading") {
    return <section aria-labelledby={headingId} aria-busy="true" className="space-y-2 rounded-xl border p-4">
      <h3 id={headingId} className="font-semibold">Appointment</h3>
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading the appointment…</p>
    </section>;
  }
  if (load.state === "error") {
    return <section aria-labelledby={headingId} className="space-y-3 rounded-xl border p-4">
      <h3 id={headingId} className="font-semibold">Appointment</h3>
      <p role="alert" className="text-sm text-destructive">{load.permission ? "You don’t have access to this service’s schedule." : "The appointment couldn’t be loaded. Nothing was changed."}</p>
      {!load.permission && <Button variant="outline" size="sm" onClick={() => { setLoad({ state: "loading" }); void read().catch(() => setLoad({ state: "error", permission: false })); }}><RefreshCw />Try again</Button>}
    </section>;
  }

  const schedule = load.schedule;
  const state = appointmentState(schedule);
  const current = formatAppointment(schedule.appointment);
  const canRecord = !readOnly && role === "admin" && schedule.status === "scheduled" && schedule.has_provider && !schedule.recurring;
  const open = schedule.open_request;
  const awaitingAnswer = Boolean(open?.requires_homeowner_acceptance && !open.answer);
  const canUseRequested = Boolean(open && (!open.requires_homeowner_acceptance || open.answer?.accepted));
  const replacement = schedule.replacement ?? null;
  const replacementText = replacementLine(replacement, role);
  const canPropose = !readOnly && role === "admin" && (replacement?.state === "awaiting_proposal" || replacement?.state === "awaiting_homeowner");
  const replacementInstant = easternInstant(replacementEntry);
  const canRequest = !readOnly && requestStatuses.has(schedule.status) && (role !== "vendor" || ["scheduled", "in_progress"].includes(schedule.status));
  const entryInstant = easternInstant(entry);
  const requestInstant = easternInstant(request);

  async function recordAppointment(reason: string, starts: Date, local: string) {
    const expected = schedule.appointment;
    const { key, forget } = keyFor([jobId, "appointment", starts.toISOString(), expected, reason]);
    await save(key, () => createClient().rpc("admin_record_appointment", {
      _job_id: jobId, _operation_key: key, _starts_at: starts.toISOString(), _local_start: local, _expected_start: expected ?? undefined, _reason: reason,
    }), `Appointment saved: ${formatAppointment(starts)}.`);
    forget();
    setEntry(emptyEntry);
  }

  async function requestTime(reason: string, starts: Date) {
    const asked = role === "admin" ? initiator || undefined : undefined;
    const { key, forget } = keyFor([jobId, "reschedule_request", starts.toISOString(), reason, asked]);
    await save(key, () => createClient().rpc("record_job_operation", {
      _job_id: jobId, _operation_key: key, _kind: "reschedule_request", _reason: reason, _scheduled_at: starts.toISOString(), _waived: false,
      _initiator: asked,
    }), `Request sent for ${formatAppointment(starts)}. ${current ? `The appointment stays ${current} until Mercurius changes it.` : "Mercurius will review it."}`);
    forget();
    setRequest(emptyEntry);
  }

  async function answerTime(accept: boolean, reason: string) {
    const { key, forget } = keyFor([jobId, "reschedule_response", open!.id, accept, reason]);
    await save(key, () => createClient().rpc("respond_to_reschedule_request", {
      _job_id: jobId, _request_id: open!.id, _response_key: key, _accept: accept, _expected: open!.expected as never, _reason: reason || undefined,
    }), accept ? `You accepted ${formatAppointment(open!.requested_start)}. The appointment changes when Mercurius records it.`
      : `You declined ${formatAppointment(open!.requested_start)}. The current appointment stays.`);
    forget();
  }

  async function proposeReplacement(reason: string, starts: Date, local: string) {
    const expected = replacement?.admin_expected ?? null;
    const { key, forget } = keyFor([jobId, "replacement_proposal", starts.toISOString(), reason, expected]);
    await save(key, () => createClient().rpc("admin_propose_replacement", {
      _job_id: jobId, _proposal_key: key, _starts_at: starts.toISOString(), _local_start: local, _expected: expected as never, _reason: reason,
    }), `Replacement proposed for ${formatAppointment(starts)}. Nothing is scheduled until the homeowner accepts.`);
    forget();
    setReplacementEntry(emptyEntry);
  }

  async function answerReplacement(accept: boolean, reason: string) {
    const proposal = replacement!.proposal!;
    const { key, forget } = keyFor([jobId, "replacement_response", proposal.id, accept, reason]);
    await save(key, () => createClient().rpc("homeowner_respond_replacement", {
      _proposal_id: proposal.id, _response_key: key, _accept: accept, _expected: replacement!.expected as never, _reason: reason || undefined,
    }), accept ? `Accepted: ${proposal.provider_name ?? "the replacement provider"} on ${formatAppointment(proposal.starts_at)}. Your service is scheduled.`
      : "You declined the replacement. Mercurius continues the search or refunds you in full if no one else is available.");
    forget();
  }

  return <section aria-labelledby={headingId} className="space-y-4 rounded-xl border p-4">
    <div className="flex items-start gap-3">
      <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 space-y-1">
        <h3 id={headingId} className="font-semibold">Appointment</h3>
        <p className="font-medium" data-testid="appointment-state">{state.heading}</p>
        <p className="text-sm text-muted-foreground">{state.detail}</p>
        <p className="text-xs text-muted-foreground">Appointment times are shown in Eastern Time (America/New_York).</p>
      </div>
    </div>
    {problem && <p ref={problemRef} tabIndex={-1} role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">{problem}</p>}
    <p role="status" className="text-sm text-sage-dark">{announcement}</p>

    {role === "admin" && schedule.recurring && <p className="text-sm text-muted-foreground">Recurring visits are scheduled separately; this panel shows their history only.</p>}

    {open && <div className="space-y-1 rounded-lg border p-3 text-sm" data-testid="open-request">
      <p className="font-medium">{open.initiator === "provider" ? "The provider proposed a different time" : "A different time was requested"}: {formatAppointment(open.requested_start)}</p>
      {role !== "vendor" && <p className="text-muted-foreground">{requestFeeLine(open)}</p>}
      {proposalAnswerLine(open, role) && <p className="text-muted-foreground" data-testid="proposal-answer">{proposalAnswerLine(open, role)}</p>}
      {!readOnly && role === "homeowner" && awaitingAnswer && <div className="flex flex-wrap gap-2 pt-1">
        <ConfirmAction triggerLabel="Accept proposed time" triggerVariant="commitment" confirmationTone="commitment" title="Accept the provider’s proposed time?"
          entity={formatAppointment(open.requested_start) ?? "Proposed time"}
          consequence={`You agree to ${formatAppointment(open.requested_start)}. ${current ? `Your appointment stays ${current} until Mercurius records the new time.` : "Mercurius records it as your appointment."} No fee applies.`}
          confirmLabel="Accept time" onConfirm={reason => answerTime(true, reason)} />
        <ConfirmAction triggerLabel="Decline" title="Decline the provider’s proposed time?" entity={formatAppointment(open.requested_start) ?? "Proposed time"}
          consequence={`${current ? `Your appointment stays ${current}.` : "No appointment changes."} If the provider can’t keep it, Mercurius looks for a replacement you accept, or refunds you in full.`}
          confirmLabel="Decline time" onConfirm={reason => answerTime(false, reason)} />
      </div>}
    </div>}

    {replacementText && <div className="space-y-2 rounded-lg border p-3 text-sm" data-testid="replacement">
      <p className="font-medium">{replacementText.heading}</p>
      <p className="text-muted-foreground">{replacementText.detail}</p>
      {!readOnly && role === "homeowner" && replacement?.state === "awaiting_homeowner" && replacement.proposal && <div className="flex flex-wrap gap-2">
        <ConfirmAction triggerLabel="Accept replacement" triggerVariant="commitment" confirmationTone="commitment" title="Accept this provider and time?"
          entity={`${replacement.proposal.provider_name ?? "Replacement provider"} · ${formatAppointment(replacement.proposal.starts_at)}`}
          consequence="Your service is scheduled with this provider at this time, for the price you already agreed. You can still cancel under the policy afterwards."
          confirmLabel="Accept replacement" onConfirm={reason => answerReplacement(true, reason)} />
        <ConfirmAction triggerLabel="Decline replacement" title="Decline this replacement?" entity={replacement.proposal.provider_name ?? "Replacement provider"}
          consequence="Mercurius continues looking for another provider you’d accept. If there isn’t one, you get a full refund. Nothing is charged."
          confirmLabel="Decline replacement" onConfirm={reason => answerReplacement(false, reason)} />
      </div>}
      {canPropose && <div className="space-y-3 pt-1">
        {replacement?.original_start && <Button variant="outline" size="sm" onClick={() => setReplacementEntry({ ...easternParts(new Date(replacement.original_start!)), choice: formatAppointment(replacement.original_start)?.endsWith("EDT") ? "EDT" : "EST" })}>Use original time</Button>}
        <EasternDateTimeField legend="Proposed appointment" value={replacementEntry} onChange={setReplacementEntry} />
        <ConfirmAction requireReason triggerLabel={replacement?.state === "awaiting_homeowner" ? "Replace the proposal" : "Review proposal"} disabled={!replacementInstant}
          confirmationTone="commitment" title="Propose this replacement to the homeowner?" entity={formatAppointment(replacementInstant) ?? "Choose a date and time"}
          consequence="The homeowner is asked to accept both the replacement provider and this time. Nothing is scheduled until they accept. The replacement works for the price already agreed; a different price is refused."
          reasonHelp="The homeowner sees this reason." confirmLabel="Send proposal"
          onConfirm={reason => proposeReplacement(reason, replacementInstant!, localStartParam(replacementEntry.date, replacementEntry.time))} />
      </div>}
    </div>}
    {canRecord && <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <h4 className="text-sm font-semibold">{current ? "Change appointment" : "Record appointment"}</h4>
      {open && canUseRequested && <Button variant="outline" size="sm" onClick={() => setEntry({ ...easternParts(new Date(open.requested_start)), choice: formatAppointment(open.requested_start)?.endsWith("EDT") ? "EDT" : "EST" })}>Use requested time</Button>}
      <EasternDateTimeField legend={current ? "New appointment" : "Appointment"} value={entry} onChange={setEntry} />
      <ConfirmAction requireReason triggerLabel={current ? "Review change" : "Review appointment"} disabled={!entryInstant} confirmationTone="commitment"
        title={current ? "Change this appointment?" : "Record this appointment?"} entity={formatAppointment(entryInstant) ?? "Choose a date and time"}
        consequence={`The homeowner and provider will see this time in Eastern Time, with your reason.${current ? ` It replaces ${current}; the earlier time stays in the history.` : ""} No charge, refund or fee is processed.`}
        reasonHelp="The homeowner and provider see this reason." confirmLabel={current ? "Change appointment" : "Record appointment"}
        onConfirm={reason => recordAppointment(reason, entryInstant!, localStartParam(entry.date, entry.time))} />
      {open && schedule.appointment && <ConfirmAction requireReason triggerLabel="Keep current appointment" title="Keep the current appointment?" entity={current!}
        consequence={`This answers the request for ${formatAppointment(open.requested_start)}. The appointment stays ${current}.`}
        reasonHelp="The homeowner and provider see this reason." confirmLabel="Keep appointment" confirmationTone="commitment"
        onConfirm={reason => { const starts = new Date(schedule.appointment!); const parts = easternParts(starts); return recordAppointment(reason, starts, localStartParam(parts.date, parts.time)); }} />}
    </div>}

    {canRequest && <div className="space-y-3 rounded-lg border p-3">
      <h4 className="text-sm font-semibold">Request a different time</h4>
      <p className="text-sm text-muted-foreground">{current ? `A request doesn’t change the appointment. It stays ${current} until Mercurius changes it.` : "A request isn’t an appointment. Mercurius reviews it and records the appointment."}</p>
      {role === "admin" && <FormField label="Who asked for the new time?" required>{control => <select {...control} className="min-h-11 w-full rounded-md border bg-background px-3"
        value={initiator} onChange={event => setInitiator(event.target.value as RescheduleInitiator | "")}>
        <option value="">Choose</option><option value="homeowner">The homeowner</option><option value="provider">The provider</option>
      </select>}</FormField>}
      <EasternDateTimeField legend="Requested time" value={request} onChange={setRequest} />
      {role === "vendor" ? <p className="text-sm text-muted-foreground">The homeowner pays no fee when you ask. They accept or decline the time; your appointment stays until a new time is agreed. If you can’t keep it and they don’t accept another time, report that you can’t do the service.</p>
        : <p className="text-sm text-muted-foreground">Rescheduling policy when the homeowner asks: 48 or more hours before the appointment, free; 24–48 hours, $25; under 24 hours, handled case by case and not guaranteed. A provider’s request carries no homeowner fee. No charge is processed by this request.</p>}
      <ConfirmAction requireReason triggerLabel="Review request" disabled={!requestInstant || (role === "admin" && !initiator)} confirmationTone="commitment" title="Send this time request?"
        entity={formatAppointment(requestInstant) ?? "Choose a date and time"}
        consequence={current ? `Mercurius will review this request. The appointment stays ${current} until it is changed.` : "Mercurius will review this request. It isn’t an appointment until Mercurius records one."}
        reasonHelp="Mercurius, the homeowner and the provider see this reason." confirmLabel="Send request" onConfirm={reason => requestTime(reason, requestInstant!)} />
    </div>}

    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Schedule history</h4>
      {schedule.history.length === 0 ? <p className="text-sm text-muted-foreground">No appointment changes recorded yet.</p>
        : <ol className="space-y-3">{[...schedule.history].reverse().map(item => <li key={item.id} className="border-l-2 border-border pl-3 text-sm">
          <p className="font-medium">{historyLine(item)}</p>
          <p className="text-muted-foreground">{actorLabel(item.actor, role)} · {formatAppointment(item.at)}</p>
          {item.reason && <p className="break-words text-muted-foreground">Reason: {item.reason}</p>}
          {item.kind === "reschedule_request" && item.fee_waived_later && <p className="text-muted-foreground">Fee waived later by an accepted exception.</p>}
          {role === "admin" && item.kind === "reschedule_request" && item.fee === 25 && !item.fee_waived_later && <LaterWaiver operationId={item.id} onDone={() => void read()} />}
        </li>)}</ol>}
    </div>
  </section>;
}
