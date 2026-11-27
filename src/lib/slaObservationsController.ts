// Phase 7.5F-2 (TRACE-159): state for the SLA observation page. Every read, scan and purge is bound to
// the signed-in account it was started for (as 7.5E F-1): changing the owner (another account signs
// in, the account signs out, the page unmounts) starts a new epoch, resets the state, drops any
// pending run key, and discards every answer that arrives for the old epoch.
//
// Nothing here scans or purges by itself. Loading, refreshing, changing a filter, paging and
// retrying a failed read call only the four readbacks. A scan starts only from scan() (the "Scan
// now" button), a same-key retry only from retry() ("Try again with the same key"), a purge only
// from purge() (after the confirmation dialog). There is no polling and no timer.
//
// Scan outcomes follow plan §4.10 (see slaObservations.ts): only a visible result settles a run; a
// cancellation, a lost or unreadable answer or any other error is unknown and is resolved through
// the run-key lookup; `not_visible` stays unknown; a retry reuses the key only within its 24-hour
// lifetime, and an expired run's content is never shown.

import {
  type LookupAnswer,
  type Observation,
  OBSERVATION_PAGE_SIZE,
  PURGE_LIMIT,
  type PurgeResult,
  RUNS_MAX,
  RUNS_PAGE_SIZE,
  SCAN_LIMIT,
  type SlaRule,
  type SlaRun,
  type SlaSummary,
  classifyScanError,
  isUuid,
  keyRetryUntil,
  parseDetectorAnswer,
  parseLookup,
  parseObservationPage,
  parsePurgeResult,
  parseRuns,
  parseSummary,
  PURGE_DEFINITE_REFUSALS,
  readError,
} from "@/lib/slaObservations";

export type RpcAnswer = { data: unknown; error: unknown };
export type SlaClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcAnswer> };

export type ReadStatus = "loading" | "ready" | "error" | "denied";
export type SummaryWindow = "retained" | "30d" | "7d";

export type ScanState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "start_failed"; message: string }
  | { phase: "running"; key: string; attempt: number }
  | { phase: "result"; key: string; run: SlaRun; replayed: boolean; via: "answer" | "lookup" }
  | { phase: "expired"; key: string; via: "answer" | "lookup" }
  | { phase: "refused"; key: string; code: string; message: string; keyRetired: boolean }
  | {
    phase: "unknown"; key: string; attempt: number;
    cause: "cancelled" | "no_answer" | "unreadable";
    detail: string;
    lookup: "checking" | "not_visible" | "failed";
    retryUntil: string | null;
  };

export type PurgeState =
  | { phase: "idle" }
  | { phase: "pending" }
  | { phase: "done"; result: PurgeResult }
  | { phase: "refused"; code: string; message: string }
  | { phase: "unknown"; message: string };

export type PurgeOutcome = { kind: "complete" | "skipped" | "refused" | "unknown" | "stale" | "busy"; message?: string };

export type SlaPageState = {
  owner: string | null;
  runs: { status: ReadStatus; items: SlaRun[]; limit: number; message: string | null };
  observations: {
    status: ReadStatus; rule: SlaRule | null; items: Observation[]; nextBeforeId: number | null;
    loadingMore: boolean; moreFailed: boolean; message: string | null;
  };
  summary: { status: ReadStatus; window: SummaryWindow; data: SlaSummary | null; message: string | null };
  scan: ScanState;
  purge: PurgeState;
};

export function initialSlaPageState(owner: string | null): SlaPageState {
  return {
    owner,
    runs: { status: "loading", items: [], limit: RUNS_PAGE_SIZE, message: null },
    observations: { status: "loading", rule: null, items: [], nextBeforeId: null, loadingMore: false, moreFailed: false, message: null },
    summary: { status: "loading", window: "retained", data: null, message: null },
    scan: { phase: "idle" },
    purge: { phase: "idle" },
  };
}

const DAY = 24 * 60 * 60 * 1000;
// The summary's upper bound is exclusive and compared with database times; a day ahead tolerates a
// browser clock behind the database's. Nothing stored can be in the future.
const WINDOW_AHEAD = DAY;
const WINDOW_START: Record<SummaryWindow, (now: number) => number> = {
  retained: () => 0, // every record still retained: the readbacks exclude expired rows themselves
  "30d": (now) => now - 30 * DAY,
  "7d": (now) => now - 7 * DAY,
};

const UNREADABLE = "The answer couldn’t be read.";
const NO_ANSWER = "No answer was received";

async function call(client: SlaClient, fn: string, args?: Record<string, unknown>): Promise<RpcAnswer> {
  try {
    return await client.rpc(fn, args);
  } catch (caught) {
    // A thrown request is a lost answer, never a refusal.
    return { data: null, error: { message: caught instanceof Error && caught.message ? caught.message : NO_ANSWER } };
  }
}

function readFailure(error: unknown): { status: ReadStatus; message: string } {
  const { code, message } = readError(error);
  if (code === "42501") return { status: "denied", message };
  return { status: "error", message: code ? `${message.replace(/[.\s]+$/, "")} (${code})` : message };
}

export class SlaObservationsController {
  private state: SlaPageState = initialSlaPageState(null);
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private runsSeq = 0;
  private observationsSeq = 0;
  private summarySeq = 0;

  constructor(private readonly client: SlaClient, private readonly now: () => number = Date.now) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.state;

  private update(patch: Partial<SlaPageState> | ((state: SlaPageState) => Partial<SlaPageState>)) {
    const next = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  private current(epoch: number) {
    return epoch === this.epoch;
  }

  /** null signs out: nothing is shown or read until an owner is set again. */
  setOwner(owner: string | null) {
    if (owner === this.state.owner) return;
    this.epoch += 1;
    this.runsSeq += 1;
    this.observationsSeq += 1;
    this.summarySeq += 1;
    this.state = initialSlaPageState(owner);
    for (const listener of this.listeners) listener();
    if (owner) void this.loadAll();
  }

  // ---- Reads (readbacks only) ------------------------------------------------------------------

  loadAll = async () => {
    if (!this.state.owner) return;
    await Promise.all([this.loadRuns(this.state.runs.limit), this.loadObservations(this.state.observations.rule), this.loadSummary(this.state.summary.window)]);
  };

  loadRuns = async (limit: number = this.state.runs.limit) => {
    if (!this.state.owner) return;
    const epoch = this.epoch;
    const seq = ++this.runsSeq;
    const bounded = Math.min(RUNS_MAX, Math.max(1, limit));
    this.update((state) => ({ runs: { ...state.runs, status: "loading", limit: bounded, message: null } }));
    const answer = await call(this.client, "admin_sla_detector_runs", { p_limit: bounded });
    if (!this.current(epoch) || seq !== this.runsSeq) return;
    if (answer.error) {
      const failure = readFailure(answer.error);
      this.update((state) => ({ runs: { ...state.runs, items: [], ...failure } }));
      return;
    }
    const items = parseRuns(answer.data);
    this.update((state) => ({ runs: items
      ? { ...state.runs, status: "ready", items, message: null }
      : { ...state.runs, status: "error", items: [], message: UNREADABLE } }));
  };

  loadObservations = async (rule: SlaRule | null = this.state.observations.rule) => {
    if (!this.state.owner) return;
    const epoch = this.epoch;
    const seq = ++this.observationsSeq;
    this.update({ observations: { status: "loading", rule, items: [], nextBeforeId: null, loadingMore: false, moreFailed: false, message: null } });
    const answer = await call(this.client, "admin_sla_observations", { p_rule: rule, p_before_id: null, p_limit: OBSERVATION_PAGE_SIZE });
    if (!this.current(epoch) || seq !== this.observationsSeq) return;
    if (answer.error) {
      const failure = readFailure(answer.error);
      this.update((state) => ({ observations: { ...state.observations, ...failure } }));
      return;
    }
    const page = parseObservationPage(answer.data);
    this.update((state) => ({ observations: page
      ? { ...state.observations, status: "ready", items: page.items, nextBeforeId: page.nextBeforeId }
      : { ...state.observations, status: "error", message: UNREADABLE } }));
  };

  /** The next page under the current filter; null when superseded, signed out or already loading. */
  loadOlderObservations = async (): Promise<{ added: number; firstId: number | null } | null> => {
    const { owner, observations } = this.state;
    if (!owner || observations.status !== "ready" || observations.loadingMore || observations.nextBeforeId === null) return null;
    const epoch = this.epoch;
    const seq = this.observationsSeq;
    const rule = observations.rule;
    this.update((state) => ({ observations: { ...state.observations, loadingMore: true, moreFailed: false } }));
    const answer = await call(this.client, "admin_sla_observations", { p_rule: rule, p_before_id: observations.nextBeforeId, p_limit: OBSERVATION_PAGE_SIZE });
    if (!this.current(epoch) || seq !== this.observationsSeq) return null;
    const page = answer.error ? null : parseObservationPage(answer.data);
    if (!page) {
      this.update((state) => ({ observations: { ...state.observations, loadingMore: false, moreFailed: true } }));
      return null;
    }
    const seen = new Set(this.state.observations.items.map((item) => item.id));
    const fresh = page.items.filter((item) => !seen.has(item.id));
    this.update((state) => ({ observations: { ...state.observations, loadingMore: false, items: [...state.observations.items, ...fresh], nextBeforeId: page.nextBeforeId } }));
    return { added: fresh.length, firstId: fresh[0]?.id ?? null };
  };

  loadSummary = async (window: SummaryWindow = this.state.summary.window) => {
    if (!this.state.owner) return;
    const epoch = this.epoch;
    const seq = ++this.summarySeq;
    this.update((state) => ({ summary: { ...state.summary, status: "loading", window, message: null } }));
    const now = this.now();
    const answer = await call(this.client, "admin_sla_observation_summary", {
      p_from: new Date(WINDOW_START[window](now)).toISOString(), p_to: new Date(now + WINDOW_AHEAD).toISOString(),
    });
    if (!this.current(epoch) || seq !== this.summarySeq) return;
    if (answer.error) {
      const failure = readFailure(answer.error);
      this.update((state) => ({ summary: { ...state.summary, data: null, ...failure } }));
      return;
    }
    const data = parseSummary(answer.data);
    this.update((state) => ({ summary: data
      ? { ...state.summary, status: "ready", data, message: null }
      : { ...state.summary, status: "error", data: null, message: UNREADABLE } }));
  };

  // ---- Scan ---------------------------------------------------------------------------------------

  get busy() {
    const { scan, purge } = this.state;
    return scan.phase === "starting" || scan.phase === "running" || (scan.phase === "unknown" && scan.lookup === "checking") || purge.phase === "pending";
  }

  /** "Scan now": a new key from the database clock, then one detector call. */
  scan = async () => {
    if (!this.state.owner || this.busy) return;
    const epoch = this.epoch;
    this.update({ scan: { phase: "starting" } });
    const issued = await call(this.client, "admin_sla_new_run_key");
    if (!this.current(epoch)) return;
    const key = typeof issued.data === "string" ? issued.data.toLowerCase() : null;
    if (issued.error || !key || !isUuid(key) || keyRetryUntil(key) === null) {
      // The key issuer writes nothing and the detector was not called.
      const reason = issued.error ? readError(issued.error).message : UNREADABLE;
      this.update({ scan: { phase: "start_failed", message: reason } });
      return;
    }
    await this.attempt(key, 1, epoch);
  };

  /** "Try again with the same key": only while the outcome is unknown and the key is within its lifetime. */
  retry = async () => {
    const scan = this.state.scan;
    if (!this.state.owner || this.busy || scan.phase !== "unknown") return;
    const until = scan.retryUntil ?? keyRetryUntil(scan.key);
    if (!until || this.now() >= Date.parse(until)) {
      // Past its lifetime the database refuses the key; nothing is sent.
      this.update({ scan: { ...scan, retryUntil: until } });
      return;
    }
    await this.attempt(scan.key, scan.attempt + 1, this.epoch);
  };

  /** "Check again": the run-key lookup only. */
  checkAgain = async () => {
    const scan = this.state.scan;
    if (!this.state.owner || this.busy || scan.phase !== "unknown") return;
    await this.lookup(scan, this.epoch);
  };

  /** Whether a same-key retry may still be sent, by the key's lifetime. */
  canRetry(now: number = this.now()) {
    const scan = this.state.scan;
    if (scan.phase !== "unknown" || scan.lookup === "checking") return false;
    const until = scan.retryUntil ?? keyRetryUntil(scan.key);
    return Boolean(until) && now < Date.parse(until as string);
  }

  private async attempt(key: string, attempt: number, epoch: number) {
    this.update({ scan: { phase: "running", key, attempt } });
    const answer = await call(this.client, "admin_detect_sla_breaches", { p_run_key: key, p_limit: SCAN_LIMIT });
    if (!this.current(epoch)) return;
    if (answer.error) {
      const failure = classifyScanError(answer.error);
      if (failure.kind === "refused") {
        this.update({ scan: { phase: "refused", key, code: failure.code, message: failure.message, keyRetired: failure.keyRetired } });
        return;
      }
      const detail = failure.code ? `${failure.message.replace(/[.\s]+$/, "")} (${failure.code})` : failure.message;
      await this.unknown({ key, attempt, cause: failure.kind === "cancelled" ? "cancelled" : "no_answer", detail }, epoch);
      return;
    }
    const parsed = parseDetectorAnswer(answer.data, key);
    if (!parsed) {
      await this.unknown({ key, attempt, cause: "unreadable", detail: UNREADABLE }, epoch);
      return;
    }
    if (parsed.state === "expired") {
      this.update({ scan: { phase: "expired", key, via: "answer" } });
      return;
    }
    this.update({ scan: { phase: "result", key, run: parsed.run, replayed: parsed.replayed, via: "answer" } });
    void this.loadAll();
  }

  private async unknown(base: { key: string; attempt: number; cause: "cancelled" | "no_answer" | "unreadable"; detail: string }, epoch: number) {
    const scan: Extract<ScanState, { phase: "unknown" }> = { phase: "unknown", ...base, lookup: "checking", retryUntil: null };
    this.update({ scan });
    await this.lookup(scan, epoch);
  }

  private async lookup(scan: Extract<ScanState, { phase: "unknown" }>, epoch: number) {
    const key = scan.key;
    this.update({ scan: { ...scan, lookup: "checking" } });
    const answer = await call(this.client, "admin_sla_detector_run", { p_run_key: key });
    if (!this.current(epoch)) return;
    const current = this.state.scan;
    if (current.phase !== "unknown" || current.key !== key) return;
    const parsed: LookupAnswer | null = answer.error ? null : parseLookup(answer.data, key);
    if (!parsed) {
      // The lookup itself failed: still unknown. The lifetime comes from the key until the database says.
      this.update({ scan: { ...current, lookup: "failed", retryUntil: current.retryUntil ?? keyRetryUntil(key) } });
      return;
    }
    if (parsed.state === "visible") {
      this.update({ scan: { phase: "result", key, run: parsed.run, replayed: false, via: "lookup" } });
      void this.loadAll();
      return;
    }
    if (parsed.state === "expired") {
      this.update({ scan: { phase: "expired", key, via: "lookup" } });
      return;
    }
    this.update({ scan: { ...current, lookup: "not_visible", retryUntil: parsed.retryUntil } });
  }

  // ---- Purge --------------------------------------------------------------------------------------

  /** One confirmed purge: exactly one call with the largest batch, never repeated here. */
  purge = async (): Promise<PurgeOutcome> => {
    if (!this.state.owner) return { kind: "stale" };
    if (this.busy) return { kind: "busy" };
    const epoch = this.epoch;
    this.update({ purge: { phase: "pending" } });
    const answer = await call(this.client, "admin_purge_sla_records", { p_limit: PURGE_LIMIT });
    if (!this.current(epoch)) return { kind: "stale" };
    if (answer.error) {
      const { code, message } = readError(answer.error);
      if (PURGE_DEFINITE_REFUSALS.has(code)) {
        this.update({ purge: { phase: "refused", code, message } });
        return { kind: "refused", message };
      }
      const detail = code ? `${message.replace(/[.\s]+$/, "")} (${code})` : message;
      this.update({ purge: { phase: "unknown", message: detail } });
      void this.loadAll();
      return { kind: "unknown", message: detail };
    }
    const result = parsePurgeResult(answer.data);
    if (!result) {
      this.update({ purge: { phase: "unknown", message: UNREADABLE } });
      void this.loadAll();
      return { kind: "unknown", message: UNREADABLE };
    }
    this.update({ purge: { phase: "done", result } });
    if (result.outcome === "skipped") return { kind: "skipped" };
    void this.loadAll();
    return { kind: "complete" };
  };
}
