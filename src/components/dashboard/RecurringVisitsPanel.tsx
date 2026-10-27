"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, Repeat, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EasternDateTimeField, easternInstant, type EasternDateTimeValue } from "@/components/ui/eastern-date-time-field";
import { formatAppointment, localStartParam } from "@/lib/appointments";
import { blockMessage, historyLine, paymentLabel, recordedAttempt, seriesErrorMessage, termsLine, visitState, type CreateResult, type SeriesReadback, type SeriesViewer } from "@/lib/recurringVisits";
import { createClient } from "@/lib/supabase/client";

const emptyEntry: EasternDateTimeValue = { date: "", time: "", choice: "" };
type Load = { state: "loading" } | { state: "error"; permission: boolean } | { state: "ready"; series: SeriesReadback };

// TRACE-123: the plan's accepted terms, its visits (each with its own acceptance, work and
// payment) and the history of every attempt to add one. Operations adds one visit at a time at an
// Eastern wall time; nothing is scheduled automatically.
export function RecurringVisitsPanel({ seriesId, role, onChanged }: { seriesId: string; role: SeriesViewer; onChanged?: () => void }) {
  const headingId = useId();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [entry, setEntry] = useState<EasternDateTimeValue>(emptyEntry);
  const [problem, setProblem] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const keys = useRef(new Map<string, string>());
  const problemRef = useRef<HTMLParagraphElement>(null);

  const read = useCallback(async (): Promise<SeriesReadback | null> => {
    const result = await createClient().rpc("recurring_series", { _series_id: seriesId });
    if (result.error) {
      setLoad({ state: "error", permission: result.error.code === "42501" });
      return null;
    }
    const series = result.data as unknown as SeriesReadback;
    setLoad({ state: "ready", series });
    return series;
  }, [seriesId]);

  useEffect(() => {
    let active = true;
    createClient().rpc("recurring_series", { _series_id: seriesId }).then(result => {
      if (!active) return;
      setLoad(result.error ? { state: "error", permission: result.error.code === "42501" } : { state: "ready", series: result.data as unknown as SeriesReadback });
    }, () => { if (active) setLoad({ state: "error", permission: false }); });
    return () => { active = false; };
  }, [seriesId]);

  useEffect(() => { if (problem && !document.querySelector("[role=alertdialog]")) problemRef.current?.focus(); }, [problem]);

  if (load.state === "loading") {
    return <section aria-labelledby={headingId} aria-busy="true" className="space-y-2 rounded-xl border p-4">
      <h3 id={headingId} className="font-semibold">Recurring visits</h3>
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Loading the visits…</p>
    </section>;
  }
  if (load.state === "error") {
    return <section aria-labelledby={headingId} className="space-y-3 rounded-xl border p-4">
      <h3 id={headingId} className="font-semibold">Recurring visits</h3>
      <p role="alert" className="text-sm text-destructive">{load.permission ? "You don’t have access to this plan’s visits." : "The visits couldn’t be loaded. Nothing was changed."}</p>
      {!load.permission && <Button variant="outline" size="sm" onClick={() => { setLoad({ state: "loading" }); void read().catch(() => setLoad({ state: "error", permission: false })); }}><RefreshCw />Try again</Button>}
    </section>;
  }

  const series = load.series;
  const canAdd = role === "admin" && series.status === "scheduled" && series.has_provider;
  const entryInstant = easternInstant(entry);
  const upcoming = series.visits;

  async function addVisit(reason: string, starts: Date, local: string) {
    const intent = JSON.stringify([seriesId, starts.toISOString(), reason]);
    let key = keys.current.get(intent);
    if (!key) { key = crypto.randomUUID(); keys.current.set(intent, key); }
    setProblem("");
    let failure: unknown = null;
    let result: CreateResult | null = null;
    try {
      const response = await createClient().rpc("admin_create_recurring_visit", {
        _series_id: seriesId, _operation_key: key, _starts_at: starts.toISOString(), _local_start: local, _reason: reason,
      });
      failure = response.error;
      result = (response.data as unknown as CreateResult) ?? null;
    } catch (error) {
      failure = error ?? new Error("No response");
    }
    const latest = await read().catch(() => null);
    const recorded = recordedAttempt(latest, key);
    if (failure && !recorded) {
      setProblem(seriesErrorMessage(failure));
      throw failure;
    }
    // The attempt is recorded; a new attempt (after fixing a blocked cause) needs a new key.
    keys.current.delete(intent);
    const outcome = recorded?.outcome ?? result?.outcome;
    const code = recorded?.code ?? result?.code ?? null;
    if (outcome === "blocked") {
      setProblem(blockMessage(code));
    } else {
      setAnnouncement(outcome === "existing"
        ? `That visit was already added: ${formatAppointment(starts)}. Nothing new was created.`
        : `Visit added: ${formatAppointment(starts)}. The provider accepts it separately.`);
      setEntry(emptyEntry);
    }
    onChanged?.();
  }

  return <section aria-labelledby={headingId} className="space-y-4 rounded-xl border p-4">
    <div className="flex items-start gap-3">
      <Repeat className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 space-y-1">
        <h3 id={headingId} className="font-semibold">Recurring visits</h3>
        <p className="font-medium" data-testid="series-terms">{series.terms ? termsLine(series.terms) : "No accepted plan terms yet"}</p>
        <p className="text-sm text-muted-foreground">Each visit is a separate service: the provider accepts it, does the work and records evidence for that visit alone{role === "vendor" ? "." : ", and each visit is paid on its own."}</p>
        <p className="text-xs text-muted-foreground">Visit times are shown in Eastern Time (America/New_York).</p>
      </div>
    </div>
    {problem && <p ref={problemRef} tabIndex={-1} role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">{problem}</p>}
    <p role="status" className="text-sm text-sage-dark">{announcement}</p>

    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Visits</h4>
      {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">No visits have been added yet.</p>
        : <ol className="space-y-3">{upcoming.map(visit => <li key={visit.id} className="border-l-2 border-border pl-3 text-sm">
          <p className="font-medium">{formatAppointment(visit.starts_at)}</p>
          <p className="text-muted-foreground">{visitState(visit)}</p>
          {paymentLabel(visit.payment) && <p className="text-muted-foreground">Payment: {paymentLabel(visit.payment)}</p>}
        </li>)}</ol>}
    </div>

    {role === "admin" && <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <h4 className="text-sm font-semibold">Add a visit</h4>
      <p className="text-sm text-muted-foreground">Visits are added one at a time. Automatic scheduling, missed-visit handling and when each visit is charged aren’t set up yet.</p>
      {canAdd ? <>
        <EasternDateTimeField legend="Visit time" value={entry} onChange={setEntry} />
        <ConfirmAction requireReason triggerLabel="Review visit" disabled={!entryInstant} confirmationTone="commitment"
          title="Add this visit?" entity={formatAppointment(entryInstant) ?? "Choose a date and time"}
          consequence="The plan’s provider receives an exclusive offer for this visit at the accepted plan price; they accept it separately. If the price, package, property or provider’s eligibility changed, nothing is added and no other provider or price is used. No charge is made."
          reasonHelp="The homeowner sees this reason." confirmLabel="Add visit"
          onConfirm={reason => addVisit(reason, entryInstant!, localStartParam(entry.date, entry.time))} />
      </> : <p className="text-sm text-muted-foreground">A visit can be added only while the plan is active with an accepted provider.</p>}
    </div>}

    {role === "admin" && <div className="space-y-2">
      <h4 className="text-sm font-semibold">Visit history</h4>
      {series.history.length === 0 ? <p className="text-sm text-muted-foreground">No visits have been attempted yet.</p>
        : <ol className="space-y-3">{[...series.history].reverse().map(item => <li key={item.id} className="border-l-2 border-border pl-3 text-sm">
          <p className="font-medium">{historyLine(item)}</p>
          {item.outcome === "blocked" && <p className="text-status-danger">{blockMessage(item.code)}</p>}
          <p className="text-muted-foreground">Operations · {formatAppointment(item.at)}</p>
          <p className="break-words text-muted-foreground">Reason: {item.reason}</p>
        </li>)}</ol>}
    </div>}
  </section>;
}
