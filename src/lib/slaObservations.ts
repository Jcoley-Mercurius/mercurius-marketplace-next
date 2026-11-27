// Phase 7.5F-2 (TRACE-159): the operator page for SLA-breach observations. DEC-2026-069 approved the
// rules (OD-1), manual scans only (OD-2), any admin scanning and purging (P-3, P-7) and 90-day
// logical retention (P-2). The database decides everything (migrations 20261203001000 and
// 20261204001000, unchanged here); this module only reads its answers and words them.
//
// Three different facts (plan §3.1), never mixed:
// - Overdue now: the existing queues, at the moment they are opened. Not this page.
// - Recorded observation: a detector run's reader listed the item past `due_at` under rule T-n. It
//   does not say the item is still overdue, how long the breach lasted, or that unobserved items
//   never breached. Counts are a lower bound.
// - First-response fact: `first_response_at` on support tickets (7.5D). Not an observation; this
//   page does not derive first-reply lateness (P-4).
//
// Outcomes (plan §4.10). An ATTEMPT is one call; the RUN is everything done under one key. Only a
// visible result settles a run: the detector's own answer, or the run-key lookup. A definite
// refusal settles only that attempt (nothing it wrote). A cancellation (57014), a lost answer, an
// unreadable answer and any other error leave the run UNKNOWN; the page resolves it through the
// lookup, and `not_visible` keeps it unknown, never "failed" or "did not run".

export const SLA_RULES = ["T-3", "T-4", "T-5", "T-8", "T-10"] as const;
export type SlaRule = (typeof SLA_RULES)[number];

/** The limit sent with every scan and every same-key retry (a different limit is refused). */
export const SCAN_LIMIT = 200;
/** The largest purge batch the database accepts; one confirmation sends exactly this. */
export const PURGE_LIMIT = 1000;
/** The database counts remaining expired items up to this many per class. */
export const PURGE_REMAINING_CAP = 10000;
export const OBSERVATION_PAGE_SIZE = 50;
export const RUNS_PAGE_SIZE = 20;
/** The runs readback has no cursor; it returns at most this many. */
export const RUNS_MAX = 100;

type RuleInfo = { label: string; target: string; queue: { label: string; href: string } };

// Targets as approved (OD-1, DEC-2026-069); the database holds the rule logic. The queue links are
// the existing overview routes (adminOperations SUMMARY_QUEUES).
export const RULE_INFO: Record<SlaRule, RuleInfo> = {
  "T-3": { label: "Quote follow-up", target: "Proposal missing 24 h, proposal review 4 h, homeowner decision 12 h",
    queue: { label: "Quote exceptions", href: "/admin/requests#quote-exceptions" } },
  "T-4": { label: "Failed payment aging", target: "Payment not completed 24 h",
    queue: { label: "Quote exceptions", href: "/admin/requests#quote-exceptions" } },
  "T-5": { label: "Completion confirmation", target: "Completion unanswered 72 h",
    queue: { label: "Fulfillment follow-up", href: "/admin/requests#fulfillment-follow-up" } },
  "T-8": { label: "Support first reply", target: "First reply within one business day",
    queue: { label: "Support tickets", href: "/admin/tickets" } },
  "T-10": { label: "Offers at other terms", target: "Homeowner answer 24 h after the provider accepts",
    queue: { label: "Offers at other terms", href: "/admin/requests#offer-terms-queue" } },
};

/** Each queue once, in rule order: where overdue-now work is handled. */
export const OVERDUE_NOW_QUEUES = SLA_RULES.map((rule) => RULE_INFO[rule].queue)
  .filter((queue, index, all) => all.findIndex((other) => other.href === queue.href) === index);

const KIND_LABEL: Record<string, string> = {
  proposal_missing: "Provider proposal missing",
  proposal_review: "Proposal waiting to be sent",
  quote_decision: "Homeowner hasn’t decided",
  payment_failed: "Payment not completed",
  confirmation_overdue: "Completion unanswered",
  first_reply_overdue: "Awaiting first reply",
  unanswered: "Offer at other terms unanswered",
};
const TICKET_KIND_LABEL: Record<string, string> = {
  general: "Support request", dispute: "Service dispute", dispute_appeal: "Dispute appeal", review_appeal: "Review appeal",
  schedule_exception: "Service exception", plan_stop_request: "Plan stop request",
};

export function kindLabel(kind: string) {
  return KIND_LABEL[kind] ?? "Other item";
}
export function ticketKindLabel(kind: string | null) {
  return kind ? TICKET_KIND_LABEL[kind] ?? "Support request" : null;
}

// ---------------------------------------------------------------------------------------------------
// Statements shown wherever observations appear (plan §3.2, F-5). The wording test rejects any claim
// of completeness.

export const LOWER_BOUND_STATEMENT =
  "Observation counts are a lower bound. A breach that begins and ends between two scans is never recorded, and no record is not evidence that nothing breached.";
export const INTERVAL_STATEMENT =
  "Intervals between scans describe when scans ran. They do not bound, estimate or count missed breaches, and how often scans run does not establish complete coverage.";
export const LAG_STATEMENT = "Lag is how long past due the item was when a scan observed it, not how long the breach lasted.";
export const NOT_STILL_OVERDUE =
  "An observation is a record of what a scan saw. It doesn’t say the item is still overdue; open the queue for its current state.";

// ---------------------------------------------------------------------------------------------------
// Parsing. Anything not in the documented shape is unreadable: for a scan that means unknown.

export type RuleStatus = "ok" | "error" | "skipped";
export type RunOutcome = "complete" | "partial" | "failed" | "skipped";

export type RuleResult = {
  rule: SlaRule;
  status: RuleStatus;
  sqlstate: string | null;
  observedAt: string | null;
  listed: number | null;
  alreadyRecorded: number | null;
  inserted: number | null;
  conflicted: number | null;
  overLimit: number | null;
};

export type Totals = { listed: number; alreadyRecorded: number; inserted: number; conflicted: number; overLimit: number };

export type SlaRun = {
  runKey: string;
  appliedLimit: number;
  ruleSet: string;
  evaluatedAt: string;
  startedAt: string;
  finishedAt: string;
  outcome: RunOutcome;
  rules: RuleResult[];
  totals: Totals;
  actorName: string | null;
};

export type Observation = {
  id: number;
  runKey: string;
  rule: SlaRule;
  queue: string;
  kind: string;
  subjectId: string;
  subjectKind: string | null;
  requestId: string | null;
  dueAt: string;
  evaluatedAt: string;
  observedAt: string;
  lagSeconds: number;
};

export type ObservationPage = { checkedAt: string; items: Observation[]; nextBeforeId: number | null };

export type RuleSummary = {
  rule: SlaRule;
  observations: number;
  minLagSeconds: number | null;
  maxLagSeconds: number | null;
  runStatus: { ok: number; error: number; skipped: number };
  firstCompletedAt: string | null;
  lastCompletedAt: string | null;
  largestIntervalSeconds: number | null;
};

export type SlaSummary = {
  checkedAt: string;
  statement: string;
  runs: { total: number; complete: number; partial: number; failed: number; skipped: number };
  rules: RuleSummary[];
};

export type PurgeResult =
  | { outcome: "skipped"; checkedAt: string; limit: number }
  | {
    outcome: "complete";
    checkedAt: string;
    limit: number;
    deletedLogical: { observations: number; runs: number; purgeLogs: number };
    deletedPhysical: { observations: number; runResults: number; runStarts: number; purgeLogs: number };
    remaining: { observations: number; runs: number; runsStillReferenced: number; purgeLogs: number; overCap: boolean };
    oldestRemainingExpiredAt: string | null;
  };

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isTime = (value: unknown): value is string => typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
const isCount = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
const isRule = (value: unknown): value is SlaRule => typeof value === "string" && (SLA_RULES as readonly string[]).includes(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const optionalTime = (value: unknown): value is string | null => value === null || value === undefined || isTime(value);
const optionalNumber = (value: unknown): value is number | null => value === null || value === undefined || (typeof value === "number" && Number.isFinite(value));

function parseRuleResult(value: unknown): RuleResult | null {
  if (!isObject(value) || !isRule(value.rule)) return null;
  const status = value.status;
  if (status === "skipped") {
    return { rule: value.rule, status, sqlstate: null, observedAt: null, listed: null, alreadyRecorded: null, inserted: null, conflicted: null, overLimit: null };
  }
  if (status === "error") {
    if (typeof value.sqlstate !== "string" || !/^[0-9A-Z]{5}$/.test(value.sqlstate)) return null;
    if (!optionalTime(value.observed_at)) return null;
    return { rule: value.rule, status, sqlstate: value.sqlstate, observedAt: value.observed_at ?? null,
      listed: null, alreadyRecorded: null, inserted: null, conflicted: null, overLimit: null };
  }
  if (status !== "ok" || !isTime(value.observed_at)) return null;
  const { listed, already_recorded, inserted, conflicted, over_limit } = value;
  if (![listed, already_recorded, inserted, conflicted, over_limit].every((n) => isCount(n))) return null;
  const [l, a, i, c, o] = [listed, already_recorded, inserted, conflicted, over_limit] as number[];
  // The detector's invariant per rule (plan §4.2): every listed item is accounted for once.
  if (l !== a + i + c + o) return null;
  return { rule: value.rule, status, sqlstate: null, observedAt: value.observed_at, listed: l, alreadyRecorded: a, inserted: i, conflicted: c, overLimit: o };
}

function outcomeMatches(outcome: RunOutcome, rules: RuleResult[]) {
  const ok = rules.filter((rule) => rule.status === "ok").length;
  const error = rules.filter((rule) => rule.status === "error").length;
  const skipped = rules.filter((rule) => rule.status === "skipped").length;
  if (outcome === "skipped") return skipped === rules.length;
  if (skipped > 0) return false;
  if (outcome === "complete") return error === 0;
  if (outcome === "failed") return ok === 0;
  return ok > 0 && error > 0;
}

/** A run start and its result, as every readback and the detector return them; null if not that shape. */
export function parseRun(value: unknown): SlaRun | null {
  if (!isObject(value)) return null;
  const outcome = value.outcome;
  if (outcome !== "complete" && outcome !== "partial" && outcome !== "failed" && outcome !== "skipped") return null;
  if (!isUuid(value.run_key) || !isCount(value.applied_limit, 500) || value.applied_limit < 1) return null;
  if (typeof value.rule_set !== "string") return null;
  if (!isTime(value.evaluated_at) || !isTime(value.started_at) || !isTime(value.finished_at)) return null;
  if (!Array.isArray(value.rules) || value.rules.length !== SLA_RULES.length) return null;
  const rules = value.rules.map(parseRuleResult);
  if (rules.some((rule) => rule === null)) return null;
  const parsed = rules as RuleResult[];
  if (parsed.some((rule, index) => rule.rule !== SLA_RULES[index])) return null;
  if (!outcomeMatches(outcome, parsed)) return null;
  const totals = value.totals;
  if (!isObject(totals)) return null;
  const sum = (key: "listed" | "alreadyRecorded" | "inserted" | "conflicted" | "overLimit") =>
    parsed.reduce((total, rule) => total + (rule.status === "ok" ? rule[key] ?? 0 : 0), 0);
  const expected: Totals = { listed: sum("listed"), alreadyRecorded: sum("alreadyRecorded"), inserted: sum("inserted"), conflicted: sum("conflicted"), overLimit: sum("overLimit") };
  if (totals.listed !== expected.listed || totals.already_recorded !== expected.alreadyRecorded || totals.inserted !== expected.inserted
    || totals.conflicted !== expected.conflicted || totals.over_limit !== expected.overLimit) return null;
  const actorName = typeof value.actor_name === "string" && value.actor_name.trim() ? value.actor_name.trim() : null;
  return {
    runKey: value.run_key.toLowerCase(), appliedLimit: value.applied_limit, ruleSet: value.rule_set,
    evaluatedAt: value.evaluated_at, startedAt: value.started_at, finishedAt: value.finished_at,
    outcome, rules: parsed, totals: expected, actorName,
  };
}

export type DetectorAnswer =
  | { state: "visible"; replayed: boolean; run: SlaRun }
  | { state: "expired"; runKey: string };

/** The detector's answer for `key`; null when it is not the documented shape or names another key. */
export function parseDetectorAnswer(value: unknown, key: string): DetectorAnswer | null {
  if (!isObject(value) || !isUuid(value.run_key) || value.run_key.toLowerCase() !== key.toLowerCase()) return null;
  if (value.state === "expired") return value.replayed === true ? { state: "expired", runKey: key } : null;
  if (value.state !== "visible" || typeof value.replayed !== "boolean") return null;
  const run = parseRun(value);
  return run ? { state: "visible", replayed: value.replayed, run } : null;
}

export type LookupAnswer =
  | { state: "visible"; run: SlaRun }
  | { state: "expired" }
  | { state: "not_visible"; retryUntil: string };

/** The run-key lookup's answer for `key`; null when it is not the documented shape. */
export function parseLookup(value: unknown, key: string): LookupAnswer | null {
  if (!isObject(value) || !isUuid(value.run_key) || value.run_key.toLowerCase() !== key.toLowerCase()) return null;
  if (value.state === "expired") return { state: "expired" };
  if (value.state === "not_visible") return isTime(value.retry_until) ? { state: "not_visible", retryUntil: value.retry_until } : null;
  if (value.state !== "visible") return null;
  const run = parseRun(value.run);
  return run && run.runKey === key.toLowerCase() ? { state: "visible", run } : null;
}

export function parseRuns(value: unknown): SlaRun[] | null {
  if (!isObject(value) || !Array.isArray(value.items)) return null;
  const runs = value.items.map(parseRun);
  return runs.some((run) => run === null) ? null : (runs as SlaRun[]);
}

function parseObservation(value: unknown): Observation | null {
  if (!isObject(value) || !isCount(value.id) || !isUuid(value.run_key) || !isRule(value.rule)) return null;
  if (typeof value.queue !== "string" || typeof value.kind !== "string" || !isUuid(value.subject_id)) return null;
  if (value.subject_kind !== null && typeof value.subject_kind !== "string") return null;
  if (value.request_id !== null && !isUuid(value.request_id)) return null;
  if (!isTime(value.due_at) || !isTime(value.evaluated_at) || !isTime(value.observed_at)) return null;
  if (typeof value.lag_seconds !== "number" || !Number.isFinite(value.lag_seconds) || value.lag_seconds < 0) return null;
  return {
    id: value.id, runKey: value.run_key, rule: value.rule, queue: value.queue, kind: value.kind, subjectId: value.subject_id,
    subjectKind: value.subject_kind, requestId: value.request_id, dueAt: value.due_at, evaluatedAt: value.evaluated_at,
    observedAt: value.observed_at, lagSeconds: value.lag_seconds,
  };
}

export function parseObservationPage(value: unknown): ObservationPage | null {
  if (!isObject(value) || !isTime(value.checked_at) || !Array.isArray(value.items)) return null;
  const items = value.items.map(parseObservation);
  if (items.some((item) => item === null)) return null;
  const next = value.next_before_id;
  if (next !== null && next !== undefined && !isCount(next)) return null;
  return { checkedAt: value.checked_at, items: items as Observation[], nextBeforeId: next ?? null };
}

export function parseSummary(value: unknown): SlaSummary | null {
  if (!isObject(value) || !isTime(value.checked_at) || typeof value.statement !== "string" || !isObject(value.runs) || !Array.isArray(value.rules)) return null;
  const runs = value.runs;
  if (!["total", "complete", "partial", "failed", "skipped"].every((key) => isCount(runs[key]))) return null;
  const rules: RuleSummary[] = [];
  for (const [index, entry] of value.rules.entries()) {
    if (!isObject(entry) || entry.rule !== SLA_RULES[index] || !isCount(entry.observations) || !isObject(entry.run_status)) return null;
    const status = entry.run_status;
    if (!isCount(status.ok) || !isCount(status.error) || !isCount(status.skipped)) return null;
    if (!optionalNumber(entry.min_lag_seconds) || !optionalNumber(entry.max_lag_seconds) || !optionalNumber(entry.descriptive_largest_interval_seconds)) return null;
    if (!optionalTime(entry.first_completed_at) || !optionalTime(entry.last_completed_at)) return null;
    rules.push({
      rule: entry.rule as SlaRule, observations: entry.observations,
      minLagSeconds: entry.min_lag_seconds ?? null, maxLagSeconds: entry.max_lag_seconds ?? null,
      runStatus: { ok: status.ok, error: status.error, skipped: status.skipped },
      firstCompletedAt: entry.first_completed_at ?? null, lastCompletedAt: entry.last_completed_at ?? null,
      largestIntervalSeconds: entry.descriptive_largest_interval_seconds ?? null,
    });
  }
  if (rules.length !== SLA_RULES.length) return null;
  return {
    checkedAt: value.checked_at, statement: value.statement,
    runs: { total: runs.total as number, complete: runs.complete as number, partial: runs.partial as number, failed: runs.failed as number, skipped: runs.skipped as number },
    rules,
  };
}

export function parsePurgeResult(value: unknown): PurgeResult | null {
  if (!isObject(value) || !isTime(value.checked_at) || !isCount(value.limit, PURGE_LIMIT) || value.limit < 1) return null;
  if (value.outcome === "skipped") return { outcome: "skipped", checkedAt: value.checked_at, limit: value.limit };
  if (value.outcome !== "complete") return null;
  const logical = value.deleted_logical, physical = value.deleted_physical_rows, remaining = value.remaining_expired_logical;
  if (!isObject(logical) || !isObject(physical) || !isObject(remaining)) return null;
  const n = value.limit;
  if (!isCount(logical.observations, n) || !isCount(logical.runs, n) || !isCount(logical.purge_logs, n)) return null;
  if (!isCount(physical.observations, n) || !isCount(physical.run_results, n) || !isCount(physical.run_starts, n) || !isCount(physical.purge_logs, n)) return null;
  // One logical run is exactly one start row and one result row; observations and log entries are one row each.
  if (physical.observations !== logical.observations || physical.run_starts !== logical.runs || physical.run_results !== logical.runs
    || physical.purge_logs !== logical.purge_logs) return null;
  const cap = PURGE_REMAINING_CAP;
  if (!isCount(remaining.observations, cap) || !isCount(remaining.runs, cap) || !isCount(remaining.runs_still_referenced, cap)
    || !isCount(remaining.purge_logs, cap) || typeof remaining.over_cap !== "boolean") return null;
  if (!optionalTime(value.oldest_remaining_expired_at)) return null;
  return {
    outcome: "complete", checkedAt: value.checked_at, limit: n,
    deletedLogical: { observations: logical.observations, runs: logical.runs, purgeLogs: logical.purge_logs },
    deletedPhysical: { observations: physical.observations, runResults: physical.run_results, runStarts: physical.run_starts, purgeLogs: physical.purge_logs },
    remaining: { observations: remaining.observations, runs: remaining.runs, runsStillReferenced: remaining.runs_still_referenced,
      purgeLogs: remaining.purge_logs, overCap: remaining.over_cap },
    oldestRemainingExpiredAt: value.oldest_remaining_expired_at ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------
// Errors.

export type RpcError = { code: string; message: string };

export function readError(error: unknown): RpcError {
  const record = isObject(error) ? error : {};
  const message = typeof record.message === "string" && record.message.trim() ? record.message.trim() : "No answer was received";
  const code = typeof record.code === "string" || typeof record.code === "number" ? String(record.code).trim() : "";
  return { code, message };
}

/**
 * Codes that prove an attempt changed nothing. The detector and purge raise 42501 (not an admin),
 * 22023 (bad or retired key, mismatched parameters) and 55000 (wrong isolation; purge with retention
 * undecided) before writing; PostgREST answers PGRST202 (no such function) and PGRST301/PGRST302
 * (JWT rejected or missing) before calling the database. Every other code, and no code, is unknown:
 * 57014 cancels one attempt but another attempt under the same key may have committed (F-7), and a
 * code in a gateway's own answer shows only that something answered.
 */
export const DEFINITE_REFUSALS: ReadonlySet<string> = new Set(["42501", "22023", "55000", "PGRST202", "PGRST301", "PGRST302"]);
/** The purge also raises XX000 on a damaged ledger, but a code alone cannot prove a rollback here. */
export const PURGE_DEFINITE_REFUSALS: ReadonlySet<string> = DEFINITE_REFUSALS;

export const KEY_TOO_OLD_MESSAGE = "Run key is too old to start a scan";

export type ScanErrorClass =
  | { kind: "refused"; code: string; message: string; keyRetired: boolean }
  | { kind: "cancelled"; code: string; message: string }
  | { kind: "unknown"; code: string; message: string };

export function classifyScanError(error: unknown): ScanErrorClass {
  const { code, message } = readError(error);
  if (code === "57014") return { kind: "cancelled", code, message };
  if (DEFINITE_REFUSALS.has(code)) {
    return { kind: "refused", code, message, keyRetired: code === "22023" && message.startsWith(KEY_TOO_OLD_MESSAGE) };
  }
  return { kind: "unknown", code, message };
}

/** The 24-hour retry lifetime of a version-7 key, from its embedded issue time; null for any other key. */
export function keyRetryUntil(key: string): string | null {
  if (!isUuid(key)) return null;
  const hex = key.replace(/-/g, "");
  if (hex[12] !== "7" || !"89ab".includes(hex[16].toLowerCase())) return null;
  const issued = Number.parseInt(hex.slice(0, 12), 16);
  return new Date(issued + 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------------------------------
// Wording.

export const OUTCOME_LABEL: Record<RunOutcome, string> = {
  complete: "Complete", partial: "Partial", failed: "Failed", skipped: "Skipped",
};
export const OUTCOME_TONE: Record<RunOutcome, "success" | "warning" | "danger" | "neutral"> = {
  complete: "success", partial: "warning", failed: "danger", skipped: "neutral",
};
export const OUTCOME_DESCRIPTION: Record<RunOutcome, string> = {
  complete: "Every rule was read and recorded.",
  partial: "Some rules failed. They recorded nothing in this run; the other rules were recorded.",
  failed: "Every rule failed. Nothing was recorded in this run.",
  skipped: "Another scan or purge was running. Nothing was read or recorded.",
};

const count = (n: number) => n.toLocaleString("en-US");
export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

export function ruleResultText(result: RuleResult): string {
  if (result.status === "skipped") return "Not read: the scan was skipped.";
  if (result.status === "error") return `Failed (${result.sqlstate}). Nothing was recorded for this rule in this run.`;
  const parts = [`${count(result.listed ?? 0)} listed`, `${count(result.inserted ?? 0)} newly recorded`, `${count(result.alreadyRecorded ?? 0)} already recorded`];
  if ((result.overLimit ?? 0) > 0) parts.push(`${count(result.overLimit ?? 0)} over this run’s limit, left for a later scan`);
  if ((result.conflicted ?? 0) > 0) parts.push(`${count(result.conflicted ?? 0)} conflicted`);
  return parts.join(" · ");
}

export function lagText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "under 1 min";
  const days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}

const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
export function formatTime(value: string): string {
  return `${TIME.format(new Date(value))} ET`;
}

/** The existing admin record for an observation: the request record, or the support queue for a ticket. */
export function observationDestination(observation: Pick<Observation, "rule" | "requestId">): { href: string; label: string } {
  if (observation.rule === "T-8") return { href: "/admin/tickets", label: "Open Support tickets" };
  if (observation.requestId && isUuid(observation.requestId)) {
    return { href: `/admin/requests?request=${observation.requestId.toLowerCase()}`, label: "Open the service request" };
  }
  return { href: RULE_INFO[observation.rule].queue.href, label: `Open ${RULE_INFO[observation.rule].queue.label}` };
}

export function purgeDeletedText(result: Extract<PurgeResult, { outcome: "complete" }>): { logical: string; physical: string } {
  const l = result.deletedLogical, p = result.deletedPhysical;
  return {
    logical: `Records deleted: ${plural(l.observations, "observation")}, ${plural(l.runs, "run")}, ${plural(l.purgeLogs, "purge-log entry", "purge-log entries")}.`,
    physical: `Database rows deleted: ${plural(p.observations, "observation row")}, ${plural(p.runResults, "run-result row")}, ${plural(p.runStarts, "run-start row")}, ${plural(p.purgeLogs, "purge-log row")}.`,
  };
}

export function purgeRemainingText(result: Extract<PurgeResult, { outcome: "complete" }>): string {
  const r = result.remaining;
  const capped = (n: number, one: string, many?: string) => (n >= PURGE_REMAINING_CAP ? `more than ${count(PURGE_REMAINING_CAP)} ${many ?? `${one}s`}` : plural(n, one, many));
  if (!r.overCap && r.observations === 0 && r.runs === 0 && r.purgeLogs === 0) return "No expired records remain.";
  const parts = [capped(r.observations, "observation"), capped(r.runs, "run"), capped(r.purgeLogs, "purge-log entry", "purge-log entries")];
  const referenced = r.runsStillReferenced > 0
    ? ` ${capped(r.runsStillReferenced, "expired run is", "expired runs are")} still referenced by expired observations and can be deleted once those are.`
    : "";
  return `Expired and still stored: ${parts.join(", ")}.${referenced} Run the purge again to delete more.`;
}
