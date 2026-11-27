import { describe, expect, it } from "vitest";
import {
  INTERVAL_STATEMENT, LAG_STATEMENT, LOWER_BOUND_STATEMENT, NOT_STILL_OVERDUE, OUTCOME_DESCRIPTION, OVERDUE_NOW_QUEUES, RULE_INFO, SLA_RULES,
  classifyScanError, keyRetryUntil, kindLabel, lagText, observationDestination, parseDetectorAnswer, parseLookup, parseObservationPage,
  parsePurgeResult, parseRun, parseRuns, parseSummary, purgeDeletedText, purgeRemainingText, ruleResultText,
} from "@/lib/slaObservations";
import { COMPLETE, KEY, SKIPPED, T, errRule, okRule, runJson, v7 } from "../fixtures/sla-observations";

// Phase 7.5F-2 (TRACE-159): the pure half of the operator page: the database answers it accepts,
// how errors are classified (plan §4.10) and the wording (plan §3.2, F-5). Synthetic values only.

describe("parsing the documented answers", () => {
  it("accepts complete, partial, failed and skipped runs and keeps every rule in order", () => {
    expect(parseRun(COMPLETE)?.totals).toEqual({ listed: 5, alreadyRecorded: 1, inserted: 3, conflicted: 0, overLimit: 1 });
    const partial = parseRun(runJson("partial", [okRule("T-3", { listed: 1, inserted: 1 }), errRule("T-4", "42P01"), okRule("T-5"), okRule("T-8"), okRule("T-10")]));
    expect(partial?.outcome).toBe("partial");
    expect(partial?.rules[1]).toMatchObject({ rule: "T-4", status: "error", sqlstate: "42P01", listed: null });
    expect(parseRun(runJson("failed", SLA_RULES.map((r) => errRule(r))))?.outcome).toBe("failed");
    expect(parseRun(SKIPPED)?.rules.every((rule) => rule.status === "skipped")).toBe(true);
  });

  it("refuses an incomplete or inconsistent run instead of guessing (F208-1 shape, invariant, outcome, totals, order)", () => {
    // The merged-but-repaired race returned a start with no result: outcome, rules and finish all null.
    expect(parseRun({ ...COMPLETE, outcome: null, rules: null, finished_at: null })).toBeNull();
    expect(parseRun(runJson("complete", [okRule("T-3", { listed: 2, inserted: 1 }), okRule("T-4"), okRule("T-5"), okRule("T-8"), okRule("T-10")]))).toBeNull();
    expect(parseRun(runJson("complete", [errRule("T-3"), okRule("T-4"), okRule("T-5"), okRule("T-8"), okRule("T-10")]))).toBeNull();
    expect(parseRun(runJson("partial", SLA_RULES.map((r) => okRule(r))))).toBeNull();
    expect(parseRun(runJson("failed", [okRule("T-3"), ...SLA_RULES.slice(1).map((r) => errRule(r))]))).toBeNull();
    expect(parseRun({ ...COMPLETE, totals: { ...COMPLETE.totals, inserted: 99 } })).toBeNull();
    expect(parseRun({ ...COMPLETE, rules: [...COMPLETE.rules].reverse() })).toBeNull();
    expect(parseRun({ ...COMPLETE, rules: COMPLETE.rules.slice(1) })).toBeNull();
    expect(parseRun({ ...COMPLETE, rules: [{ ...okRule("T-3"), sqlstate: "not a code", status: "error" }, ...COMPLETE.rules.slice(1)] })).toBeNull();
  });

  it("reads the detector's visible, replayed and expired answers, only for the key it sent", () => {
    expect(parseDetectorAnswer({ ...COMPLETE, state: "visible", replayed: false }, KEY)).toMatchObject({ state: "visible", replayed: false });
    expect(parseDetectorAnswer({ ...COMPLETE, state: "visible", replayed: true }, KEY)).toMatchObject({ state: "visible", replayed: true });
    expect(parseDetectorAnswer({ run_key: KEY, state: "expired", replayed: true }, KEY)).toEqual({ state: "expired", runKey: KEY });
    // An expired answer never carries content, and a visible one must be complete.
    expect(parseDetectorAnswer({ ...COMPLETE, outcome: null, state: "visible", replayed: true }, KEY)).toBeNull();
    expect(parseDetectorAnswer({ ...COMPLETE, state: "visible", replayed: false }, v7(1))).toBeNull();
    expect(parseDetectorAnswer(null, KEY)).toBeNull();
  });

  it("reads the lookup's three states; not_visible needs its retry lifetime", () => {
    expect(parseLookup({ run_key: KEY, state: "visible", checked_at: T, run: COMPLETE }, KEY)).toMatchObject({ state: "visible" });
    expect(parseLookup({ run_key: KEY, state: "expired", checked_at: T }, KEY)).toEqual({ state: "expired" });
    expect(parseLookup({ run_key: KEY, state: "not_visible", checked_at: T, retry_until: "2026-11-28T15:00:00+00:00" }, KEY))
      .toEqual({ state: "not_visible", retryUntil: "2026-11-28T15:00:00+00:00" });
    expect(parseLookup({ run_key: KEY, state: "not_visible", checked_at: T }, KEY)).toBeNull();
    expect(parseLookup({ run_key: KEY, state: "failed", checked_at: T }, KEY)).toBeNull();
    expect(parseLookup({ run_key: KEY, state: "visible", run: { ...COMPLETE, run_key: v7(5) } }, KEY)).toBeNull();
  });

  it("reads runs, observation pages and the summary, and refuses malformed ones", () => {
    expect(parseRuns({ checked_at: T, items: [{ ...COMPLETE, actor_name: "Josh" }] })?.[0].actorName).toBe("Josh");
    expect(parseRuns({ checked_at: T, items: [{ ...COMPLETE, outcome: "done" }] })).toBeNull();
    const obs = { id: 7, run_key: KEY, rule: "T-8", queue: "support", kind: "first_reply_overdue", subject_id: "00000000-0000-4000-8000-0000000000aa",
      subject_kind: "dispute", request_id: null, due_at: "2026-11-26T15:00:00+00:00", evaluated_at: T, observed_at: T, lag_seconds: 86400.1 };
    expect(parseObservationPage({ checked_at: T, items: [obs], next_before_id: 7 })?.items[0]).toMatchObject({ id: 7, subjectKind: "dispute" });
    expect(parseObservationPage({ checked_at: T, items: [{ ...obs, rule: "T-9" }], next_before_id: null })).toBeNull();
    const rule = (r: string) => ({ rule: r, observations: 0, min_lag_seconds: null, max_lag_seconds: null, run_status: { ok: 1, error: 0, skipped: 0 },
      first_completed_at: T, last_completed_at: T, descriptive_largest_interval_seconds: null });
    const summary = { checked_at: T, from: T, to: T, statement: "Counts are a lower bound.", runs: { total: 1, complete: 1, partial: 0, failed: 0, skipped: 0 }, rules: SLA_RULES.map(rule) };
    expect(parseSummary(summary)?.rules).toHaveLength(5);
    expect(parseSummary({ ...summary, rules: SLA_RULES.slice(1).map(rule) })).toBeNull();
    // The summary has no coverage field, and the page reads none.
    expect(Object.keys(parseSummary(summary) ?? {})).toEqual(["checkedAt", "statement", "runs", "rules"]);
  });

  it("reads a purge: logical and physical counts kept apart and consistent; skipped", () => {
    const complete = { purge_id: 3, outcome: "complete", checked_at: T, limit: 1000,
      deleted_logical: { observations: 4, runs: 2, purge_logs: 1 },
      deleted_physical_rows: { observations: 4, run_results: 2, run_starts: 2, purge_logs: 1 },
      remaining_expired_logical: { observations: 0, runs: 1, runs_still_referenced: 1, purge_logs: 0, cap: 10000, over_cap: false },
      oldest_remaining_expired_at: "2026-11-01T00:00:00+00:00" };
    const parsed = parsePurgeResult(complete);
    expect(parsed?.outcome).toBe("complete");
    if (parsed?.outcome !== "complete") throw new Error("expected complete");
    expect(purgeDeletedText(parsed)).toEqual({
      logical: "Records deleted: 4 observations, 2 runs, 1 purge-log entry.",
      physical: "Database rows deleted: 4 observation rows, 2 run-result rows, 2 run-start rows, 1 purge-log row.",
    });
    // No total mixes records and rows.
    expect(Object.values(purgeDeletedText(parsed)).join(" ")).not.toMatch(/\b(9|11) /);
    expect(purgeRemainingText(parsed)).toContain("1 expired run is still referenced by expired observations");
    expect(parsePurgeResult({ ...complete, deleted_physical_rows: { ...complete.deleted_physical_rows, run_starts: 4 } })).toBeNull();
    expect(parsePurgeResult({ ...complete, deleted_logical: { ...complete.deleted_logical, runs: 4 } })).toBeNull();
    expect(parsePurgeResult({ purge_id: 4, outcome: "skipped", checked_at: T, limit: 1000 })).toEqual({ outcome: "skipped", checkedAt: T, limit: 1000 });
    const capped = parsePurgeResult({ ...complete, remaining_expired_logical: { observations: 10000, runs: 0, runs_still_referenced: 0, purge_logs: 0, cap: 10000, over_cap: true } });
    if (capped?.outcome !== "complete") throw new Error("expected complete");
    expect(purgeRemainingText(capped)).toContain("more than 10,000 observations");
    const empty = parsePurgeResult({ ...complete, remaining_expired_logical: { observations: 0, runs: 0, runs_still_referenced: 0, purge_logs: 0, cap: 10000, over_cap: false } });
    if (empty?.outcome !== "complete") throw new Error("expected complete");
    expect(purgeRemainingText(empty)).toBe("No expired records remain.");
  });
});

describe("classifying a scan attempt's error (plan §4.10, F-7)", () => {
  it("57014 is a cancelled attempt, never a refusal or a failure", () => {
    expect(classifyScanError({ code: "57014", message: "canceling statement due to statement timeout" }).kind).toBe("cancelled");
  });

  it("only codes raised before any write are definite refusals", () => {
    for (const code of ["42501", "22023", "55000", "PGRST202", "PGRST301", "PGRST302"]) expect(classifyScanError({ code, message: "x" }).kind).toBe("refused");
    expect(classifyScanError({ code: "22023", message: "Run key is too old to start a scan" })).toMatchObject({ kind: "refused", keyRetired: true });
    expect(classifyScanError({ code: "22023", message: "Run key reused with different parameters" })).toMatchObject({ kind: "refused", keyRetired: false });
  });

  it("everything else is unknown: damaged ledger, connection states, gateway answers, no answer", () => {
    for (const error of [{ code: "XX000", message: "SLA run start found without its result" }, { code: "08007", message: "x" }, { code: "PGRST000", message: "x" },
      { code: "", message: "Failed to fetch" }, { message: "TypeError" }, null, undefined]) {
      expect(classifyScanError(error).kind).toBe("unknown");
    }
  });

  it("derives a version-7 key's 24-hour lifetime from its embedded time; other keys have none", () => {
    expect(keyRetryUntil(KEY)).toBe("2026-11-28T15:00:00.000Z");
    expect(keyRetryUntil("00000000-0000-4000-8000-000000000001")).toBeNull();
    expect(keyRetryUntil(`${KEY.slice(0, 19)}c${KEY.slice(20)}`)).toBeNull();
    expect(keyRetryUntil("not-a-key")).toBeNull();
  });
});

describe("wording", () => {
  const all = [LOWER_BOUND_STATEMENT, INTERVAL_STATEMENT, LAG_STATEMENT, NOT_STILL_OVERDUE, ...Object.values(OUTCOME_DESCRIPTION),
    ...Object.values(RULE_INFO).flatMap((info) => [info.label, info.target])].join(" ");

  it("claims no completeness (plan §6 T)", () => {
    expect(all).not.toMatch(/all breaches|complete coverage|no breaches (were )?missed|guarantee|every breach|coverage is complete/i);
    expect(LOWER_BOUND_STATEMENT).toMatch(/lower bound/);
    expect(INTERVAL_STATEMENT).toMatch(/do not bound, estimate or count missed breaches/);
    expect(INTERVAL_STATEMENT).toMatch(/scanning at any interval does not make the record complete/);
  });

  it("never labels an observation as still overdue", () => {
    for (const kind of ["proposal_missing", "proposal_review", "quote_decision", "payment_failed", "confirmation_overdue", "first_reply_overdue", "unanswered", "other"]) {
      expect(kindLabel(kind)).not.toMatch(/still|overdue now/i);
    }
    expect(NOT_STILL_OVERDUE).toMatch(/doesn’t say the item is still overdue/);
  });

  it("words each rule result without inventing counts", () => {
    expect(ruleResultText({ rule: "T-4", status: "error", sqlstate: "42P01", observedAt: T, listed: null, alreadyRecorded: null, inserted: null, conflicted: null, overLimit: null }))
      .toBe("Failed (42P01). Nothing was recorded for this rule in this run.");
    expect(ruleResultText({ rule: "T-4", status: "skipped", sqlstate: null, observedAt: null, listed: null, alreadyRecorded: null, inserted: null, conflicted: null, overLimit: null }))
      .toBe("Not read: the scan was skipped.");
    expect(ruleResultText({ rule: "T-5", status: "ok", sqlstate: null, observedAt: T, listed: 700, alreadyRecorded: 0, inserted: 500, conflicted: 0, overLimit: 200 }))
      .toBe("700 listed · 500 newly recorded · 0 already recorded · 200 over this run’s limit, left for a later scan");
  });

  it("formats lag and links only to existing admin routes", () => {
    expect([lagText(30), lagText(60), lagText(3600 + 12 * 60), lagText(2 * 86400 + 3 * 3600), lagText(86400)]).toEqual(["under 1 min", "1 min", "1 h 12 min", "2 d 3 h", "1 d"]);
    const request = "00000000-0000-4000-8000-0000000000BB";
    expect(observationDestination({ rule: "T-5", requestId: request }).href).toBe(`/admin/requests?request=${request.toLowerCase()}`);
    expect(observationDestination({ rule: "T-8", requestId: request }).href).toBe("/admin/tickets");
    expect(observationDestination({ rule: "T-10", requestId: "javascript:alert(1)" }).href).toBe("/admin/requests#offer-terms-queue");
    expect(OVERDUE_NOW_QUEUES.map((q) => q.href)).toEqual(["/admin/requests#quote-exceptions", "/admin/requests#fulfillment-follow-up", "/admin/tickets", "/admin/requests#offer-terms-queue"]);
  });
});
