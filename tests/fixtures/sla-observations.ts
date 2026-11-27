// Phase 7.5F-2 (TRACE-159): synthetic SLA detector answers shared by the unit and browser tests. The
// shapes are the 7.5F database functions' (migration 20261203001000); no real data.
import { SLA_RULES } from "@/lib/slaObservations";

/** A version-7 run key whose embedded issue time is `ms`. */
export function v7(ms: number, tail = "8000-000000000001") {
  const hex = ms.toString(16).padStart(12, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-${tail}`;
}
export const KEY = v7(Date.UTC(2026, 10, 27, 15, 0, 0));
export const T = "2026-11-27T15:00:00.100+00:00";

export function okRule(rule: string, counts: Partial<Record<"listed" | "already_recorded" | "inserted" | "conflicted" | "over_limit", number>> = {}) {
  const c = { listed: 0, already_recorded: 0, inserted: 0, conflicted: 0, over_limit: 0, ...counts };
  return { rule, status: "ok", sqlstate: null, observed_at: T, ...c };
}
export function errRule(rule: string, sqlstate = "P0001") {
  return { rule, status: "error", sqlstate, observed_at: T, listed: null, already_recorded: null, inserted: null, conflicted: null, over_limit: null };
}
export function runJson(outcome: string, rules: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const ok = rules.filter((r) => r.status === "ok");
  const sum = (k: string) => ok.reduce((t, r) => t + (r[k] as number), 0);
  return {
    run_key: KEY, actor: "00000000-0000-4000-8000-000000000003", applied_limit: 200, rule_set: "OD-1 DEC-2026-069",
    evaluated_at: "2026-11-27T15:00:00+00:00", started_at: "2026-11-27T15:00:00.050+00:00", finished_at: "2026-11-27T15:00:01+00:00",
    outcome, rules,
    totals: { listed: sum("listed"), already_recorded: sum("already_recorded"), inserted: sum("inserted"), conflicted: sum("conflicted"), over_limit: sum("over_limit") },
    ...extra,
  };
}
export const COMPLETE = runJson("complete", [
  okRule("T-3", { listed: 3, inserted: 2, already_recorded: 1 }), okRule("T-4"), okRule("T-5", { listed: 2, inserted: 1, over_limit: 1 }), okRule("T-8"), okRule("T-10"),
]);
export const SKIPPED = runJson("skipped", SLA_RULES.map((rule) => ({ rule, status: "skipped" })));
