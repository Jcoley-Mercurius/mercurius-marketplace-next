"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CalendarClock, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EasternDateTimeField, easternInstant, type EasternDateTimeValue } from "@/components/ui/eastern-date-time-field";
import { actorLabel, appointmentState, easternParts, formatAppointment, historyLine, localStartParam, recordedInHistory, scheduleErrorMessage, type ScheduleReadback, type ScheduleViewer } from "@/lib/appointments";
import { createClient } from "@/lib/supabase/client";

const requestStatuses = new Set(["pending", "matched", "quoted", "scheduled", "in_progress"]);
const emptyEntry: EasternDateTimeValue = { date: "", time: "", choice: "" };
type Load = { state: "loading" } | { state: "error"; permission: boolean } | { state: "ready"; schedule: ScheduleReadback };

// TRACE-121: the appointment, any open reschedule request and the schedule history, read from
// job_schedule for every role. Operations records, changes or keeps the appointment; a homeowner
// or provider asks for a different time through the existing record_job_operation request.
export function AppointmentPanel({ jobId, role, readOnly = false, onChanged }: { jobId: string; role: ScheduleViewer; readOnly?: boolean; onChanged?: () => void }) {
  const headingId = useId();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [entry, setEntry] = useState<EasternDateTimeValue>(emptyEntry);
  const [request, setRequest] = useState<EasternDateTimeValue>(emptyEntry);
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
    const { key, forget } = keyFor([jobId, "reschedule_request", starts.toISOString(), reason]);
    await save(key, () => createClient().rpc("record_job_operation", {
      _job_id: jobId, _operation_key: key, _kind: "reschedule_request", _reason: reason, _scheduled_at: starts.toISOString(), _waived: false,
    }), `Request sent for ${formatAppointment(starts)}. ${current ? `The appointment stays ${current} until Mercurius changes it.` : "Mercurius will review it."}`);
    forget();
    setRequest(emptyEntry);
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
    {canRecord && <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <h4 className="text-sm font-semibold">{current ? "Change appointment" : "Record appointment"}</h4>
      {schedule.open_request && <Button variant="outline" size="sm" onClick={() => setEntry({ ...easternParts(new Date(schedule.open_request!.requested_start)), choice: formatAppointment(schedule.open_request!.requested_start)?.endsWith("EDT") ? "EDT" : "EST" })}>Use requested time</Button>}
      <EasternDateTimeField legend={current ? "New appointment" : "Appointment"} value={entry} onChange={setEntry} />
      <ConfirmAction requireReason triggerLabel={current ? "Review change" : "Review appointment"} disabled={!entryInstant} confirmationTone="commitment"
        title={current ? "Change this appointment?" : "Record this appointment?"} entity={formatAppointment(entryInstant) ?? "Choose a date and time"}
        consequence={`The homeowner and provider will see this time in Eastern Time, with your reason.${current ? ` It replaces ${current}; the earlier time stays in the history.` : ""} No charge, refund or fee is processed.`}
        reasonHelp="The homeowner and provider see this reason." confirmLabel={current ? "Change appointment" : "Record appointment"}
        onConfirm={reason => recordAppointment(reason, entryInstant!, localStartParam(entry.date, entry.time))} />
      {schedule.open_request && schedule.appointment && <ConfirmAction requireReason triggerLabel="Keep current appointment" title="Keep the current appointment?" entity={current!}
        consequence={`This answers the request for ${formatAppointment(schedule.open_request.requested_start)}. The appointment stays ${current}.`}
        reasonHelp="The homeowner and provider see this reason." confirmLabel="Keep appointment" confirmationTone="commitment"
        onConfirm={reason => { const starts = new Date(schedule.appointment!); const parts = easternParts(starts); return recordAppointment(reason, starts, localStartParam(parts.date, parts.time)); }} />}
    </div>}

    {canRequest && <div className="space-y-3 rounded-lg border p-3">
      <h4 className="text-sm font-semibold">Request a different time</h4>
      <p className="text-sm text-muted-foreground">{current ? `A request doesn’t change the appointment. It stays ${current} until Mercurius changes it.` : "A request isn’t an appointment. Mercurius reviews it and records the appointment."}</p>
      <EasternDateTimeField legend="Requested time" value={request} onChange={setRequest} />
      {role !== "vendor" && <p className="text-sm text-muted-foreground">Rescheduling policy: 48 or more hours before the appointment, free; 24–48 hours, $25; under 24 hours, handled case by case and not guaranteed. No charge is processed by this request.</p>}
      <ConfirmAction requireReason triggerLabel="Review request" disabled={!requestInstant} confirmationTone="commitment" title="Send this time request?"
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
          <p className="break-words text-muted-foreground">Reason: {item.reason}</p>
        </li>)}</ol>}
    </div>
  </section>;
}
