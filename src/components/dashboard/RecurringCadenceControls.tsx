"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EasternDateTimeField, easternInstant, type EasternDateTimeValue } from "@/components/ui/eastern-date-time-field";
import { Input } from "@/components/ui/input";
import { formatAppointment, localStartParam, resolveEasternTime } from "@/lib/appointments";
import {
  anchorHistoryLine, cadenceErrorMessage, dstNote, emptyProposalMessage, formatCadenceDate, lifecycleConsequence, lifecycleLine,
  replacementCandidates, resolutionLine, type CadenceProposal, type LifecycleAction,
} from "@/lib/recurringCadence";
import { blockMessage, cadenceLabel, recordedAttempt, visitState, type CreateResult, type SeriesReadback } from "@/lib/recurringVisits";
import { createClient } from "@/lib/supabase/client";

type Rpc = { data: unknown; error: unknown };
const emptyEntry: EasternDateTimeValue = { date: "", time: "", choice: "" };
const inPlace = new Set(["cancelled", "completed", "homeowner_confirmed", "resolved", "review_requested", "reviewed", "closed"]);

// TRACE-124 (operations only): the plan's cadence anchor, proposed visits, skipped and replaced
// cadence dates, and pause / resume / stop future visits. Proposals are previews; a visit exists
// only after an operator adds it, through the same server path as a manual visit.
export function RecurringCadenceControls({ seriesId, series, reread, onChanged }: {
  seriesId: string; series: SeriesReadback; reread: () => Promise<SeriesReadback | null>; onChanged?: () => void;
}) {
  const headingId = useId();
  const [problem, setProblem] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [anchorEntry, setAnchorEntry] = useState<EasternDateTimeValue>(emptyEntry);
  const [basis, setBasis] = useState("");
  const [dstTimes, setDstTimes] = useState<Record<string, string>>({});
  const [dstChoices, setDstChoices] = useState<Record<string, "EDT" | "EST" | "">>({});
  const [links, setLinks] = useState<Record<string, string>>({});
  const keys = useRef(new Map<string, string>());
  const problemRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (problem && !document.querySelector("[role=alertdialog]")) problemRef.current?.focus(); }, [problem]);

  const state = series.plan_state;
  const cadence = series.cadence;
  const anchorId = series.anchor_id ?? null;
  const anchorDate = series.anchor?.local_start.slice(0, 10) ?? null;

  const keyFor = (intent: string) => {
    let key = keys.current.get(intent);
    if (!key) { key = crypto.randomUUID(); keys.current.set(intent, key); }
    return key;
  };

  /** Sends a command; a lost response counts as saved when the readback holds this caller's key. */
  async function run(intent: string, call: (key: string) => PromiseLike<Rpc>,
    recorded: (latest: SeriesReadback | null, key: string) => boolean, success: string) {
    const key = keyFor(intent);
    setProblem("");
    let failure: unknown = null;
    try { failure = (await call(key)).error; } catch (error) { failure = error ?? new Error("No response"); }
    const latest = await reread().catch(() => null);
    if (failure && !recorded(latest, key)) {
      setProblem(cadenceErrorMessage(failure));
      throw failure;
    }
    keys.current.delete(intent);
    setAnnouncement(success);
    onChanged?.();
  }

  async function addProposed(proposal: CadenceProposal, starts: Date, local: string, reason: string) {
    const intent = JSON.stringify(["cadence", anchorId, proposal.cadence_date, starts.toISOString(), reason]);
    const key = keyFor(intent);
    setProblem("");
    let failure: unknown = null;
    let result: CreateResult | null = null;
    try {
      const response = await createClient().rpc("admin_create_cadence_visit", {
        _series_id: seriesId, _operation_key: key, _anchor_id: anchorId!, _cadence_date: proposal.cadence_date,
        _starts_at: starts.toISOString(), _local_start: local, _reason: reason,
      });
      failure = response.error;
      result = (response.data as unknown as CreateResult) ?? null;
    } catch (error) {
      failure = error ?? new Error("No response");
    }
    const latest = await reread().catch(() => null);
    const recorded = recordedAttempt(latest, key);
    if (failure && !recorded) {
      setProblem(cadenceErrorMessage(failure));
      throw failure;
    }
    keys.current.delete(intent);
    const outcome = recorded?.outcome ?? result?.outcome;
    if (outcome === "blocked") setProblem(blockMessage(recorded?.code ?? result?.code ?? null));
    else setAnnouncement(outcome === "existing" ? `That visit was already added: ${formatAppointment(starts)}. Nothing new was created.`
      : `Proposed visit added: ${formatAppointment(starts)}. The provider accepts it separately.`);
    onChanged?.();
  }

  const setState = (action: LifecycleAction, reason: string) => run(JSON.stringify(["lifecycle", action, state, reason]),
    key => createClient().rpc("admin_set_recurring_plan_state", { _series_id: seriesId, _operation_key: key, _action: action, _expected_state: state, _reason: reason }),
    (latest, key) => Boolean(latest?.lifecycle?.some(entry => entry.operation_key === key)),
    action === "pause" ? "Plan paused. No new visits can be added." : action === "resume" ? "Plan resumed." : "Future visits stopped. Existing visits remain in place.");

  const resolve = (date: string, kind: "skipped" | "replaced", visitId: string | null, reason: string) =>
    run(JSON.stringify(["resolve", anchorId, date, kind, visitId, reason]),
      key => createClient().rpc("admin_resolve_cadence_date", {
        _series_id: seriesId, _operation_key: key, _anchor_id: anchorId!, _cadence_date: date, _kind: kind,
        _occurrence_id: visitId as string, _reason: reason,
      }),
      (latest, key) => Boolean(latest?.resolutions?.some(entry => entry.operation_key === key)),
      kind === "skipped" ? `Cadence date skipped: ${formatCadenceDate(date)}.` : `The visit now replaces the cadence date ${formatCadenceDate(date)}.`);

  const anchorInstant = easternInstant(anchorEntry);
  const recordAnchor = (reason: string) => run(JSON.stringify(["anchor", anchorId, anchorInstant?.toISOString(), basis.trim(), reason]),
    key => createClient().rpc("admin_record_recurring_anchor", {
      _series_id: seriesId, _operation_key: key, _expected_anchor_id: anchorId as string, _starts_at: anchorInstant!.toISOString(),
      _local_start: localStartParam(anchorEntry.date, anchorEntry.time), _basis: basis.trim(), _reason: reason,
    }),
    (latest, key) => Boolean(latest?.anchors?.some(entry => entry.operation_key === key)),
    "Cadence anchor recorded. The proposals below count from it.").then(() => { setAnchorEntry(emptyEntry); setBasis(""); });

  // Dates handled under the current anchor: any visit on the date, or a skip/replacement.
  const handled = new Set([...series.visits.map(visit => visit.local_start.slice(0, 10)),
    ...(series.resolutions ?? []).filter(entry => entry.current_anchor).map(entry => entry.cadence_date)]);
  const offCadence = series.visits.filter(visit => visit.on_cadence === false && !visit.replaces && visit.status !== "cancelled");
  const remaining = series.visits.filter(visit => !inPlace.has(visit.status));
  const history = [
    ...(series.anchors ?? []).map(entry => ({ id: entry.id, at: entry.at, line: anchorHistoryLine(entry), detail: `How it was agreed: ${entry.basis}`, reason: entry.reason })),
    ...(series.lifecycle ?? []).map(entry => ({ id: entry.id, at: entry.at, line: lifecycleLine(entry), detail: null, reason: entry.reason })),
    ...(series.resolutions ?? []).map(entry => ({ id: entry.id, at: entry.at, line: resolutionLine(entry), detail: null, reason: entry.reason })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  function proposalTime(proposal: CadenceProposal): { starts: Date; local: string } | null {
    if (proposal.kind === "ok" && proposal.starts_at) return { starts: new Date(proposal.starts_at), local: proposal.local_start };
    if (proposal.kind === "ambiguous") {
      const chosen = proposal.choices.find(choice => choice.abbreviation === dstChoices[proposal.cadence_date]);
      return chosen ? { starts: new Date(chosen.starts_at), local: proposal.local_start } : null;
    }
    const time = dstTimes[proposal.cadence_date] ?? "";
    const resolution = resolveEasternTime(proposal.cadence_date, time);
    return resolution.kind === "ok" ? { starts: resolution.instant, local: localStartParam(proposal.cadence_date, time) } : null;
  }

  return <section aria-labelledby={headingId} className="space-y-4 rounded-lg border bg-muted/30 p-3">
    <h4 id={headingId} className="text-sm font-semibold">Plan schedule</h4>
    {problem && <p ref={problemRef} tabIndex={-1} role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">{problem}</p>}
    <p role="status" className="text-sm text-sage-dark">{announcement}</p>

    {state !== "ended" && <div className="flex flex-wrap gap-2">
      {state === "active" && <ConfirmAction requireReason triggerLabel="Pause plan" title="Pause this plan?" entity={cadenceLabel(series.frequency)}
        consequence={lifecycleConsequence("pause")} confirmLabel="Pause plan" onConfirm={reason => setState("pause", reason)} />}
      {state === "paused" && <ConfirmAction requireReason triggerLabel="Resume plan" title="Resume this plan?" entity={cadenceLabel(series.frequency)}
        confirmationTone="commitment" consequence={lifecycleConsequence("resume")} confirmLabel="Resume plan" onConfirm={reason => setState("resume", reason)} />}
      <ConfirmAction requireReason triggerLabel="Stop future visits" title="Stop future visits for this plan?" entity={cadenceLabel(series.frequency)}
        consequence={`${lifecycleConsequence("stop")} ${remaining.length === 1 ? "1 visit is" : `${remaining.length} visits are`} in place now.`}
        confirmLabel="Stop future visits" onConfirm={reason => setState("stop", reason)} />
    </div>}

    {state === "ended" && <div className="space-y-2" data-testid="visits-in-place">
      <h5 className="text-sm font-semibold">Visits still in place</h5>
      <p className="text-sm text-muted-foreground">Stopping future visits didn’t cancel these visits or their open offers. Handle each one individually.</p>
      {remaining.length === 0 ? <p className="text-sm text-muted-foreground">None.</p>
        : <ul className="space-y-1 text-sm">{remaining.map(visit => <li key={visit.id}>{formatAppointment(visit.starts_at)} · {visitState(visit)}</li>)}</ul>}
    </div>}

    {cadence && <div className="space-y-2">
      <h5 className="text-sm font-semibold">Proposed visits</h5>
      <p className="text-sm text-muted-foreground">From the anchor, through the next 60 days, at least 24 hours ahead, up to two upcoming visits. Nothing is added until you add it.</p>
      {cadence.proposals.length === 0 ? <p className="text-sm text-muted-foreground" data-testid="no-proposals">{emptyProposalMessage(cadence)}</p>
        : <ol className="space-y-3">{cadence.proposals.map(proposal => {
          const chosen = proposalTime(proposal);
          const note = dstNote(proposal);
          const timeId = `${headingId}-${proposal.cadence_date}`;
          return <li key={proposal.cadence_date} className="space-y-2 border-l-2 border-border pl-3 text-sm">
            <p className="font-medium">{proposal.kind === "ok" && proposal.starts_at ? formatAppointment(proposal.starts_at) : formatCadenceDate(proposal.cadence_date)}</p>
            {note && <p className="text-status-warning">{note}</p>}
            {proposal.kind === "ambiguous" && <fieldset className="space-y-1">
              <legend className="sr-only">Which {formatCadenceDate(proposal.cadence_date)} time</legend>
              {proposal.choices.map(choice => <label key={choice.abbreviation} className="flex min-h-11 items-center gap-3">
                <input type="radio" className="h-5 w-5" name={timeId} checked={dstChoices[proposal.cadence_date] === choice.abbreviation}
                  onChange={() => setDstChoices(current => ({ ...current, [proposal.cadence_date]: choice.abbreviation }))} />
                {formatAppointment(choice.starts_at)}
              </label>)}
            </fieldset>}
            {proposal.kind === "nonexistent" && <div className="space-y-1">
              <label htmlFor={timeId} className="block font-medium">Time on {formatCadenceDate(proposal.cadence_date)} (Eastern Time)</label>
              <Input id={timeId} type="time" step={60} className="max-w-40" value={dstTimes[proposal.cadence_date] ?? ""}
                onChange={event => setDstTimes(current => ({ ...current, [proposal.cadence_date]: event.target.value }))} />
            </div>}
            <div className="flex flex-wrap gap-2">
              <ConfirmAction requireReason triggerLabel="Review proposed visit" disabled={!chosen} confirmationTone="commitment" triggerVariant="commitment"
                title="Add this proposed visit?" entity={chosen ? formatAppointment(chosen.starts) ?? "" : "Choose a time"}
                consequence="Added from the plan’s cadence. The plan’s provider receives an exclusive offer at the accepted plan price and accepts it separately. If the price, package, property, the homeowner’s access or the provider’s eligibility changed, nothing is added and no other provider or price is used. No charge is made."
                reasonHelp="The homeowner sees this reason." confirmLabel="Add visit"
                onConfirm={reason => addProposed(proposal, chosen!.starts, chosen!.local, reason)} />
              <ConfirmAction requireReason triggerLabel="Skip this date" title="Skip this cadence date?" entity={formatCadenceDate(proposal.cadence_date)}
                consequence="No visit is added for this date and no make-up visit is created. The cadence and later dates don’t move."
                confirmLabel="Skip date" onConfirm={reason => resolve(proposal.cadence_date, "skipped", null, reason)} />
            </div>
          </li>;
        })}</ol>}
    </div>}

    {state !== "ended" && <div className="space-y-3">
      <h5 className="text-sm font-semibold">{series.anchor ? "Change the cadence anchor" : "Record the agreed first visit"}</h5>
      <p className="text-sm text-muted-foreground">The cadence counts from this Eastern date and time. Recording it adds no visit and doesn’t confirm an appointment with the homeowner or provider.</p>
      <EasternDateTimeField legend={series.anchor ? "New anchor" : "Agreed first visit"} value={anchorEntry} onChange={setAnchorEntry} />
      <div className="space-y-1">
        <label htmlFor={`${headingId}-basis`} className="block text-sm font-medium">How this time was agreed</label>
        <Input id={`${headingId}-basis`} value={basis} onChange={event => setBasis(event.target.value)} aria-describedby={`${headingId}-basis-help`} />
        <p id={`${headingId}-basis-help`} className="text-xs text-muted-foreground">For example, who agreed it and how. Kept in the plan history for operations.</p>
      </div>
      <ConfirmAction requireReason triggerLabel={series.anchor ? "Review new anchor" : "Review anchor"} disabled={!anchorInstant || !basis.trim()} confirmationTone="commitment"
        title={series.anchor ? "Re-anchor this plan?" : "Record this anchor?"} entity={formatAppointment(anchorInstant) ?? "Choose a date and time"}
        consequence={series.anchor
          ? "Future proposals count from the new anchor. Existing visits, earlier anchors and earlier skip or replacement decisions are kept; decisions made under the earlier anchor don’t apply to the new dates."
          : "Proposals count from this date and time. No visit is added."}
        reasonHelp="Kept in the plan history for operations." confirmLabel={series.anchor ? "Re-anchor" : "Record anchor"} onConfirm={recordAnchor} />
    </div>}

    {anchorDate && offCadence.length > 0 && <div className="space-y-2">
      <h5 className="text-sm font-semibold">Off-cadence visits</h5>
      <p className="text-sm text-muted-foreground">If one of these visits stands in for a cadence date (for example a make-up visit), link it so that date isn’t proposed again. Linking changes nothing about the visit.</p>
      <ul className="space-y-3">{offCadence.map(visit => {
        const candidates = replacementCandidates(anchorDate, series.frequency, visit.local_start.slice(0, 10), handled);
        const selectId = `${headingId}-link-${visit.id}`;
        const date = links[visit.id] ?? "";
        return <li key={visit.id} className="space-y-2 border-l-2 border-border pl-3 text-sm">
          <p className="font-medium">{formatAppointment(visit.starts_at)}</p>
          {candidates.length === 0 ? <p className="text-muted-foreground">No open cadence date next to this visit.</p> : <>
            <label htmlFor={selectId} className="block">Replaces the cadence date</label>
            <select id={selectId} className="min-h-11 rounded-md border bg-background px-3" value={date}
              onChange={event => setLinks(current => ({ ...current, [visit.id]: event.target.value }))}>
              <option value="">Not a replacement</option>
              {candidates.map(candidate => <option key={candidate} value={candidate}>{formatCadenceDate(candidate)}</option>)}
            </select>
            <ConfirmAction requireReason triggerLabel="Link visit" disabled={!date} confirmationTone="commitment" title="Link this visit to a cadence date?"
              entity={date ? `${formatAppointment(visit.starts_at)} replaces ${formatCadenceDate(date)}` : "Choose a cadence date"}
              consequence="That cadence date is treated as handled. The visit’s appointment, provider, price and payment don’t change. One visit can replace one cadence date."
              confirmLabel="Link visit" onConfirm={reason => resolve(date, "replaced", visit.id, reason)} />
          </>}
        </li>;
      })}</ul>
    </div>}

    <div className="space-y-2">
      <h5 className="text-sm font-semibold">Schedule history</h5>
      {history.length === 0 ? <p className="text-sm text-muted-foreground">No anchor, pause or skipped date has been recorded.</p>
        : <ol className="space-y-3">{history.map(item => <li key={item.id} className="border-l-2 border-border pl-3 text-sm">
          <p className="font-medium">{item.line}</p>
          {item.detail && <p className="break-words text-muted-foreground">{item.detail}</p>}
          <p className="text-muted-foreground">Operations · {formatAppointment(item.at)}</p>
          <p className="break-words text-muted-foreground">Reason: {item.reason}</p>
        </li>)}</ol>}
    </div>
  </section>;
}
