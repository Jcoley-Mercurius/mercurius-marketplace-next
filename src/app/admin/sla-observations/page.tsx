"use client";

// Phase 7.5F-2 (TRACE-159): the operator page for SLA-breach observations (DEC-2026-069). It reads
// the four 7.5F readbacks and offers two explicit actions: "Scan now" (the detector) and the manual
// retention purge, behind a confirmation. Opening, refreshing, filtering, paging and retrying a
// failed read never scan or purge; nothing polls. The admin layout's has_role('admin') guard runs
// first, and every database function checks admin again on every call.
//
// Three facts are kept apart (plan §3.1): overdue-now work is in the existing queues (linked here,
// not restated); this page lists recorded observations, which are a lower bound; first-response
// facts are on Support tickets, and first-reply lateness is not derived (P-4).

import { type ReactNode, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Info, Loader2, RefreshCw, ScanSearch } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import { Select } from "@/components/ui/select";
import { useSlaObservations } from "@/hooks/useSlaObservations";
import {
  INTERVAL_STATEMENT, LAG_STATEMENT, LOWER_BOUND_STATEMENT, NOT_STILL_OVERDUE, OUTCOME_DESCRIPTION, OUTCOME_LABEL, OUTCOME_TONE,
  OVERDUE_NOW_QUEUES, PURGE_LIMIT, RULE_INFO, RUNS_MAX, SLA_RULES, type Observation, type RuleSummary, type SlaRule, type SlaRun, type SlaSummary,
  formatTime, kindLabel, lagText, observationDestination, plural, purgeDeletedText, purgeRemainingText, ruleResultText, ticketKindLabel,
} from "@/lib/slaObservations";
import type { PurgeState, ReadStatus, ScanState, SlaObservationsController, SlaPageState, SummaryWindow } from "@/lib/slaObservationsController";
import { cn } from "@/lib/utils";

const TONE = {
  success: "border-status-success bg-status-success-bg text-status-success",
  warning: "border-status-warning bg-status-warning-bg text-status-warning",
  danger: "border-status-danger bg-status-danger-bg text-status-danger",
  neutral: "border-status-neutral bg-status-neutral-bg text-status-neutral",
  info: "border-status-info bg-status-info-bg text-status-info",
};
const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring";

// Page-local state (focus, announcements, dialogs) belongs to one account: another account or a
// sign-out gets a fresh page, and the controller discards the previous account's answers.
export default function AdminSlaObservationsPage() {
  const { user } = useAuth();
  return <SlaObservations key={user?.id ?? "signed-out"} />;
}

function SlaObservations() {
  const { state, controller } = useSlaObservations();
  const { runs, observations, summary, scan, purge } = state;
  const busy = controller.busy;
  const denied = runs.status === "denied" || observations.status === "denied" || summary.status === "denied";

  if (denied) {
    return <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 md:p-8">
      <PageState kind="permission" title="Admin access required" description="This account can’t read SLA observations. Nothing was scanned or changed." />
    </div>;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        eyebrow="Operations"
        title="SLA observations"
        description="Records of items that a manual scan found past an approved response target. Scans run only when an admin presses Scan now."
        actions={<>
          <Button onClick={() => void controller.scan()} disabled={busy} loading={scan.phase === "starting" || scan.phase === "running"}>
            {scan.phase === "starting" || scan.phase === "running" ? "Scanning…" : <><ScanSearch aria-hidden="true" className="h-4 w-4" />Scan now</>}
          </Button>
          <Button variant="outline" onClick={() => void controller.loadAll()} disabled={busy}>
            <RefreshCw aria-hidden="true" className="h-4 w-4" />Refresh
          </Button>
        </>}
      />

      <Explainer />
      <ScanStatus scan={scan} controller={controller} />
      <SummarySection status={summary.status} window={summary.window} data={summary.data} message={summary.message} controller={controller} />
      <RunsSection status={runs.status} items={runs.items} limit={runs.limit} message={runs.message} controller={controller} />
      <ObservationsSection state={observations} controller={controller} />
      <PurgeSection purge={purge} busy={busy} controller={controller} />
    </div>
  );
}

function Explainer() {
  return (
    <section aria-labelledby="sla-facts-heading" className={cn("rounded-lg border p-4 text-sm", TONE.info)}>
      <h2 id="sla-facts-heading" className="flex items-center gap-2 font-semibold"><Info aria-hidden="true" className="h-4 w-4 shrink-0" />What this page shows, and what it doesn’t</h2>
      <dl className="mt-3 space-y-3">
        <div>
          <dt className="font-semibold">Overdue now</dt>
          <dd>
            Work past its target right now is in the queues, not here:{" "}
            {OVERDUE_NOW_QUEUES.map((queue, index) => <span key={queue.href}>
              {index > 0 && (index === OVERDUE_NOW_QUEUES.length - 1 ? " and " : ", ")}
              <Link href={queue.href} className="font-semibold underline underline-offset-2">{queue.label}</Link>
            </span>)}.
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Recorded observations</dt>
          <dd>Each one says a scan saw the item past its target. {NOT_STILL_OVERDUE} {LOWER_BOUND_STATEMENT}</dd>
        </div>
        <div>
          <dt className="font-semibold">First-response facts</dt>
          <dd>
            When a support ticket got its first reply is shown in the First reply column of{" "}
            <Link href="/admin/tickets" className="font-semibold underline underline-offset-2">Support tickets</Link>. It isn’t an observation, and this page doesn’t report whether a first reply was late.
          </dd>
        </div>
      </dl>
      <p className="mt-3">{INTERVAL_STATEMENT} Nothing here sends an alert or notifies anyone.</p>
    </section>
  );
}

// ---- Scan -------------------------------------------------------------------------------------

function ScanStatus({ scan, controller }: { scan: ScanState; controller: SlaObservationsController }) {
  const ref = useRef<HTMLDivElement>(null);
  const settledKey = scan.phase === "idle" || scan.phase === "starting" || scan.phase === "running" ? null
    : `${scan.phase}:${"key" in scan ? scan.key : ""}:${scan.phase === "unknown" ? scan.lookup : ""}`;
  useEffect(() => {
    if (settledKey && !settledKey.endsWith(":checking")) ref.current?.focus();
  }, [settledKey]);

  if (scan.phase === "idle") {
    return <p className="text-sm text-muted-foreground">No scan has been started on this page. Opening or refreshing it never runs one.</p>;
  }
  if (scan.phase === "starting" || scan.phase === "running") {
    return <div role="status" data-testid="scan-status" className={cn("rounded-lg border p-4 text-sm", TONE.info)}>
      <p className="flex items-center gap-2 font-semibold"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        {scan.phase === "running" && scan.attempt > 1 ? "Trying again with the same key…" : "Scanning…"}</p>
      <p className="mt-1">Each rule’s queue is read once. If you leave this page, the scan may still finish; its result will be listed under Recent runs.</p>
    </div>;
  }

  const box = (tone: keyof typeof TONE, alert: boolean, children: ReactNode) =>
    <div ref={ref} tabIndex={-1} role={alert ? "alert" : "status"} data-testid="scan-status" className={cn("space-y-2 rounded-lg border p-4 text-sm", TONE[tone], focusRing)}>{children}</div>;

  if (scan.phase === "start_failed") {
    return box("danger", true, <>
      <p className="font-semibold">The scan couldn’t start</p>
      <p>No run key was issued ({scan.message.replace(/[.\s]+$/, "")}), so nothing was scanned or recorded. Press Scan now to try again.</p>
    </>);
  }
  if (scan.phase === "result") {
    const { run } = scan;
    return box(OUTCOME_TONE[run.outcome] === "danger" ? "danger" : OUTCOME_TONE[run.outcome] === "warning" ? "warning" : run.outcome === "skipped" ? "neutral" : "success", false, <>
      <p className="font-semibold">Scan {OUTCOME_LABEL[run.outcome].toLowerCase()}</p>
      <p>{OUTCOME_DESCRIPTION[run.outcome]}{run.outcome === "skipped" ? " This key is used up; press Scan now to start a new scan." : ""}</p>
      {scan.replayed && <p>This scan had already run. This is its stored result; nothing was scanned again.</p>}
      {scan.via === "lookup" && <p>Confirmed by looking up the scan’s run key.</p>}
      {run.outcome !== "skipped" && <p>{plural(run.totals.inserted, "item")} newly recorded, {plural(run.totals.alreadyRecorded, "item")} already recorded{run.totals.overLimit > 0 ? `, ${plural(run.totals.overLimit, "item")} left for a later scan by the per-rule limit` : ""}.</p>}
      <RuleResults run={run} />
    </>);
  }
  if (scan.phase === "expired") {
    return box("neutral", false, <>
      <p className="font-semibold">This scan’s record is past its retention period</p>
      <p>The run exists, but its result is no longer shown. Nothing was scanned again.</p>
    </>);
  }
  if (scan.phase === "refused") {
    return box("danger", true, <>
      <p className="font-semibold">The scan was refused</p>
      <p>{scan.message.replace(/[.\s]+$/, "")}. This attempt recorded nothing.</p>
      {scan.keyRetired && <p>This key can no longer be retried. Press Scan now to start a new scan; any earlier result under this key is listed under Recent runs while it is retained.</p>}
    </>);
  }

  // Unknown: never "failed" and never "nothing was recorded".
  const canRetry = controller.canRetry();
  const title = scan.cause === "cancelled" ? "This attempt was cancelled before it finished"
    : scan.cause === "unreadable" ? "The scan’s answer couldn’t be read" : "We couldn’t confirm whether the scan ran";
  return box("warning", true, <>
    <p className="font-semibold">{title}</p>
    <p>{scan.detail.replace(/[.\s]+$/, "")}. The scan may or may not have run{scan.cause === "cancelled" ? ": another attempt with the same key may have finished" : ""}.</p>
    {scan.lookup === "checking" && <p className="flex items-center gap-2"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Looking up this scan’s run key…</p>}
    {scan.lookup === "not_visible" && <p>No result is visible yet. An attempt may still be running, may not have reached the database, or may have rolled back.</p>}
    {scan.lookup === "failed" && <p>The lookup didn’t answer either, so the outcome is still unknown.</p>}
    {scan.lookup !== "checking" && (canRetry
      ? <p>You can try again with the same key until {formatTime(scan.retryUntil as string)}. A retry never scans twice: it waits for any attempt still running and returns its result, or runs if none was recorded.</p>
      : <p>This key can no longer be retried. Press Scan now to start a new scan; if the earlier attempt did run, both runs are listed and no item is recorded twice.</p>)}
    {scan.lookup !== "checking" && <div className="flex flex-wrap gap-2 pt-1">
      {canRetry && <Button size="sm" onClick={() => void controller.retry()}>Try again with the same key</Button>}
      <Button size="sm" variant="outline" onClick={() => void controller.checkAgain()}>Check again</Button>
    </div>}
  </>);
}

function RuleResults({ run }: { run: SlaRun }) {
  return <ul aria-label="Result by rule" className="space-y-1">
    {run.rules.map((rule) => <li key={rule.rule} className="break-words">
      <span className="font-medium">{rule.rule} {RULE_INFO[rule.rule].label}:</span> {ruleResultText(rule)}
    </li>)}
  </ul>;
}

// ---- Summary ----------------------------------------------------------------------------------

const WINDOW_LABEL: Record<SummaryWindow, string> = { retained: "All retained records", "30d": "Last 30 days", "7d": "Last 7 days" };
const seconds = (value: number | null) => (value === null ? "—" : lagText(value));
const time = (value: string | null) => (value ? formatTime(value) : "—");

function SummarySection({ status, window, data, message, controller }: {
  status: ReadStatus; window: SummaryWindow; data: SlaSummary | null; message: string | null; controller: SlaObservationsController;
}) {
  return (
    <section aria-labelledby="sla-summary-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="sla-summary-heading" className="text-xl font-semibold">Summary</h2>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Period
          <Select density="compact" value={window} onChange={(event) => void controller.loadSummary(event.target.value as SummaryWindow)}>
            {(Object.keys(WINDOW_LABEL) as SummaryWindow[]).map((key) => <option key={key} value={key}>{WINDOW_LABEL[key]}</option>)}
          </Select>
        </label>
      </div>
      <p className="text-sm text-muted-foreground">{LOWER_BOUND_STATEMENT} {LAG_STATEMENT}</p>
      {status === "loading" ? <PageState kind="loading" title="Loading the summary" />
        : status === "error" || !data ? <PageState kind="error" title="The summary couldn’t be loaded" description={`${message ?? ""} Nothing was scanned or changed.`.trim()}
          action={<Button variant="outline" onClick={() => void controller.loadSummary()}><RefreshCw aria-hidden="true" className="h-4 w-4" />Try again</Button>} />
          : <>
            <p data-testid="summary-runs" className="text-sm">
              {data.runs.total === 0 ? "No retained scans in this period." : <>
                {plural(data.runs.total, "scan")} in this period: {data.runs.complete} complete, {data.runs.partial} partial, {data.runs.failed} failed, {data.runs.skipped} skipped.
              </>}
            </p>
            <ResponsiveDataList<RuleSummary>
              label="Observations by rule"
              rows={data.rules}
              rowKey={(row) => row.rule}
              rowLabel={(row) => `${row.rule} ${RULE_INFO[row.rule].label}`}
              columns={[
                { key: "rule", label: "Rule", render: (row) => <span><span className="font-medium">{row.rule} {RULE_INFO[row.rule].label}</span><span className="block text-xs text-muted-foreground">{RULE_INFO[row.rule].target}</span></span> },
                { key: "observations", label: "Recorded (lower bound)", render: (row) => (row.observations === 0 ? "None recorded" : `At least ${row.observations.toLocaleString("en-US")}`) },
                { key: "lag", label: "Lag when observed", render: (row) => (row.observations === 0 ? "—" : `${seconds(row.minLagSeconds)} to ${seconds(row.maxLagSeconds)}`) },
                { key: "runs", label: "Rule in scans", render: (row) => `${row.runStatus.ok} read, ${row.runStatus.error} failed, ${row.runStatus.skipped} skipped` },
                { key: "completed", label: "First and last read", render: (row) => (row.firstCompletedAt ? `${time(row.firstCompletedAt)} – ${time(row.lastCompletedAt)}` : "Not read in this period") },
                { key: "interval", label: "Longest gap between reads (descriptive)", render: (row) => seconds(row.largestIntervalSeconds) },
              ]}
            />
            <p className="text-sm text-muted-foreground">{INTERVAL_STATEMENT}</p>
            <p className="text-xs text-muted-foreground">Database statement: {data.statement} Checked {formatTime(data.checkedAt)}.</p>
          </>}
    </section>
  );
}

// ---- Runs -------------------------------------------------------------------------------------

function OutcomeBadge({ outcome }: { outcome: SlaRun["outcome"] }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", TONE[OUTCOME_TONE[outcome]])}>{OUTCOME_LABEL[outcome]}</span>;
}

function RunsSection({ status, items, limit, message, controller }: {
  status: ReadStatus; items: SlaRun[]; limit: number; message: string | null; controller: SlaObservationsController;
}) {
  return (
    <section aria-labelledby="sla-runs-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
      <h2 id="sla-runs-heading" className="text-xl font-semibold">Recent runs</h2>
      {status === "loading" ? <PageState kind="loading" title="Loading recent runs" />
        : status === "error" ? <PageState kind="error" title="Recent runs couldn’t be loaded" description={`${message ?? ""} Nothing was scanned or changed.`.trim()}
          action={<Button variant="outline" onClick={() => void controller.loadRuns()}><RefreshCw aria-hidden="true" className="h-4 w-4" />Try again</Button>} />
          : items.length === 0 ? <PageState kind="empty" title="No retained scans" description="No scan has run, or every run is past its retention period. Press Scan now to run one." />
            : <>
              <ul aria-label="Recent runs" className="divide-y rounded-lg border">
                {items.map((run) => <li key={run.runKey} className="space-y-2 p-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <OutcomeBadge outcome={run.outcome} />
                    <span className="font-medium">{formatTime(run.evaluatedAt)}</span>
                    <span className="text-muted-foreground">by {run.actorName ?? "Operator"}</span>
                  </div>
                  <p>{OUTCOME_DESCRIPTION[run.outcome]}{run.outcome !== "skipped" && ` ${plural(run.totals.inserted, "item")} newly recorded.`}</p>
                  <details>
                    <summary className="cursor-pointer font-medium">Rule details</summary>
                    <div className="mt-2 space-y-2">
                      <RuleResults run={run} />
                      <p className="text-xs text-muted-foreground">Limit {run.appliedLimit} new items per rule · started {formatTime(run.startedAt)} · finished {formatTime(run.finishedAt)} · key {run.runKey}</p>
                    </div>
                  </details>
                </li>)}
              </ul>
              {items.length >= limit && limit < RUNS_MAX
                ? <Button variant="outline" onClick={() => void controller.loadRuns(RUNS_MAX)}>Show up to {RUNS_MAX} runs</Button>
                : <p className="text-sm text-muted-foreground">{items.length >= RUNS_MAX ? `Showing the ${RUNS_MAX} most recent retained runs; older retained runs aren’t listed here.` : "These are all the retained runs."}</p>}
            </>}
    </section>
  );
}

// ---- Observations -----------------------------------------------------------------------------

function ObservationsSection({ state, controller }: { state: SlaPageState["observations"]; controller: SlaObservationsController }) {
  const [announcement, setAnnouncement] = useState("");
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const focusNext = useRef<number | null>(null);

  useEffect(() => {
    const id = focusNext.current;
    if (id === null) return;
    focusNext.current = null;
    rowRefs.current.get(id)?.focus();
  }, [state.items]);

  async function older() {
    const result = await controller.loadOlderObservations();
    if (!result) return;
    setAnnouncement(result.added > 0 ? `Loaded ${plural(result.added, "older observation")}.` : "No older observations.");
    if (result.firstId !== null) {
      const node = rowRefs.current.get(result.firstId);
      if (node) node.focus();
      else focusNext.current = result.firstId;
    }
  }

  return (
    <section aria-labelledby="sla-observations-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="sla-observations-heading" className="text-xl font-semibold">Recorded observations</h2>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Rule
          <Select density="compact" value={state.rule ?? ""} onChange={(event) => void controller.loadObservations((event.target.value || null) as SlaRule | null)}>
            <option value="">All rules</option>
            {SLA_RULES.map((rule) => <option key={rule} value={rule}>{rule} {RULE_INFO[rule].label}</option>)}
          </Select>
        </label>
      </div>
      <p className="text-sm text-muted-foreground">Newest first. {NOT_STILL_OVERDUE} {LAG_STATEMENT}</p>
      {state.status === "loading" ? <PageState kind="loading" title="Loading observations" />
        : state.status === "error" ? <PageState kind="error" title="Observations couldn’t be loaded" description={`${state.message ?? ""} Nothing was scanned or changed.`.trim()}
          action={<Button variant="outline" onClick={() => void controller.loadObservations()}><RefreshCw aria-hidden="true" className="h-4 w-4" />Try again</Button>} />
          : state.items.length === 0 ? <PageState kind="empty" title={state.rule ? `No retained observations for ${state.rule}` : "No retained observations"}
            description={`${LOWER_BOUND_STATEMENT} Check the queues for anything overdue now.`} />
            : <>
              <ul aria-label="Observations" className="divide-y rounded-lg border">
                {state.items.map((item) => <ObservationRow key={item.id} item={item} refCallback={(node) => {
                  if (node) rowRefs.current.set(item.id, node);
                  else rowRefs.current.delete(item.id);
                }} />)}
              </ul>
              {state.moreFailed && <div role="alert" className={cn("rounded-lg border p-4 text-sm", TONE.danger)}>
                <p className="font-semibold">Older observations couldn’t be loaded</p>
                <p className="mt-1">The observations above are unchanged. Try again.</p>
              </div>}
              {state.nextBeforeId !== null
                ? <div className="flex justify-center"><Button variant="outline" onClick={() => void older()} disabled={state.loadingMore} loading={state.loadingMore}>
                  {state.loadingMore ? "Loading older observations…" : state.moreFailed ? "Try loading older observations again" : "Load older observations"}
                </Button></div>
                : <p className="text-center text-sm text-muted-foreground">You’ve reached the oldest retained observation.</p>}
            </>}
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </section>
  );
}

function ObservationRow({ item, refCallback }: { item: Observation; refCallback: (node: HTMLLIElement | null) => void }) {
  const destination = observationDestination(item);
  const ticket = ticketKindLabel(item.subjectKind);
  return <li ref={refCallback} tabIndex={-1} className={cn("space-y-1 p-4 text-sm", focusRing)}>
    <p className="font-medium">{item.rule} {RULE_INFO[item.rule].label}: {kindLabel(item.kind)}{ticket ? ` (${ticket})` : ""}</p>
    <p>Due {formatTime(item.dueAt)} · observed {formatTime(item.observedAt)}, {lagText(item.lagSeconds)} past due</p>
    <p className="text-xs text-muted-foreground">Scan evaluated at {formatTime(item.evaluatedAt)} · record {item.subjectId}</p>
    <Link href={destination.href} className="inline-block font-medium text-accent underline underline-offset-2">{destination.label}</Link>
  </li>;
}

// ---- Purge ------------------------------------------------------------------------------------

const number = (value: number) => value.toLocaleString("en-US");

function PurgeSection({ purge, busy, controller }: { purge: PurgeState; busy: boolean; controller: SlaObservationsController }) {
  // One confirmation, one call. ConfirmAction keeps the dialog open and disabled until it settles;
  // anything but a completed purge is shown in the dialog and recorded below.
  const runPurge = async () => {
    const outcome = await controller.purge();
    if (outcome.kind === "complete" || outcome.kind === "stale") return;
    if (outcome.kind === "busy") throw new Error("A scan is running. Nothing was deleted. Purge after it finishes.");
    if (outcome.kind === "skipped") throw new Error("Another scan or purge was running, so nothing was deleted. The skip was logged. Try again after it finishes.");
    if (outcome.kind === "refused") throw new Error(`The purge was refused: ${outcome.message?.replace(/[.\s]+$/, "")}. Nothing was deleted.`);
    throw new Error(`We couldn’t confirm whether the purge ran: ${outcome.message?.replace(/[.\s]+$/, "")}. Expired records may have been deleted; no unexpired record can be. Refresh before running it again.`);
  };

  return (
    <section aria-labelledby="sla-retention-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
      <h2 id="sla-retention-heading" className="text-xl font-semibold">Retention and purge</h2>
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>Observations, runs and purge-log entries are operational records with 90-day retention (DEC-2026-069). Once a record’s retention passes it is hidden from this page, and it is deleted only when an admin runs the purge. Nothing runs the purge automatically.</p>
        <p>The purge deletes expired records only, oldest first: up to {number(PURGE_LIMIT)} observations, {number(PURGE_LIMIT)} runs and {number(PURGE_LIMIT)} purge-log entries each time it is confirmed. A run is two database rows, so one purge deletes at most {number(PURGE_LIMIT * 4)} rows. This page can’t show how many expired records are waiting until a purge reports it.</p>
      </div>
      <ConfirmAction
        triggerLabel="Purge expired records"
        title="Permanently delete expired SLA records?"
        entity={`Up to ${number(PURGE_LIMIT)} expired observations, ${number(PURGE_LIMIT)} expired runs and ${number(PURGE_LIMIT)} expired purge-log entries`}
        consequence="Deletes only records whose retention period has passed, oldest first, in this one run. Deletion is permanent and cannot be undone. Unexpired records, the queues and every booking, ticket, quote and payment are not changed. If expired records remain, the result says so; run it again to delete more."
        confirmLabel="Delete expired records"
        disabled={busy}
        describeError={(caught) => (caught instanceof Error ? caught.message : undefined)}
        onConfirm={() => runPurge()}
      />
      <div role="status" aria-live="polite" data-testid="purge-result" className="text-sm">
        <PurgeResultText purge={purge} />
      </div>
    </section>
  );
}

function PurgeResultText({ purge }: { purge: PurgeState }) {
  if (purge.phase === "idle" || purge.phase === "pending") return null;
  if (purge.phase === "refused") return <p className="text-status-danger">The last purge was refused: {purge.message.replace(/[.\s]+$/, "")}. Nothing was deleted.</p>;
  if (purge.phase === "unknown") {
    return <p className="flex items-start gap-2 text-status-warning"><AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      The last purge’s outcome is unknown ({purge.message.replace(/[.\s]+$/, "")}). Expired records may have been deleted; no unexpired record can be.</p>;
  }
  const { result } = purge;
  if (result.outcome === "skipped") return <p>The last purge was skipped at {formatTime(result.checkedAt)}: a scan or another purge was running. Nothing was deleted; the skip was logged.</p>;
  const deleted = purgeDeletedText(result);
  return <div className="space-y-1">
    <p className="font-medium">Purge complete · {formatTime(result.checkedAt)}</p>
    <p>{deleted.logical}</p>
    <p>{deleted.physical}</p>
    <p>{purgeRemainingText(result)}{result.oldestRemainingExpiredAt ? ` The oldest expired ${formatTime(result.oldestRemainingExpiredAt)}.` : ""}</p>
  </div>;
}
