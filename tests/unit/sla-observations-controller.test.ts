import { describe, expect, it } from "vitest";
import { PURGE_LIMIT, SCAN_LIMIT, SLA_RULES } from "@/lib/slaObservations";
import { type RpcAnswer, SlaObservationsController } from "@/lib/slaObservationsController";
import { COMPLETE, KEY, SKIPPED, T, errRule, okRule, runJson, v7 } from "../fixtures/sla-observations";

// Phase 7.5F-2 (TRACE-159): the operator page's state. Every call the controller makes stays pending
// until the test answers it, so completion order, account changes and late answers are chosen here.
// Plan §4.10 outcomes, §6 group P, and the client mutations 7.5F-1 deferred to this slice (I-15):
// "`not_visible` mapped to failure" and "`57014` mapped to recorded nothing without a lookup".

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const NOW = Date.UTC(2026, 10, 27, 15, 5, 0);
const READS = new Set(["admin_sla_detector_runs", "admin_sla_observations", "admin_sla_observation_summary", "admin_sla_detector_run"]);
const WRITES = new Set(["admin_sla_new_run_key", "admin_detect_sla_breaches", "admin_purge_sla_records"]);

type Call = { fn: string; args: Record<string, unknown> | undefined; resolve: (answer: RpcAnswer) => void; reject: (error: unknown) => void };

class FakeClient {
  calls: Call[] = [];
  log: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  rpc(fn: string, args?: Record<string, unknown>) {
    this.log.push({ fn, args });
    return new Promise<RpcAnswer>((resolve, reject) => { this.calls.push({ fn, args, resolve, reject }); });
  }
  take(fn: string) {
    const index = this.calls.findIndex((call) => call.fn === fn);
    if (index < 0) throw new Error(`no pending ${fn}; pending: ${this.calls.map((c) => c.fn).join(", ") || "none"}`);
    return this.calls.splice(index, 1)[0];
  }
  has(fn: string) { return this.calls.some((call) => call.fn === fn); }
  writes() { return this.log.filter((entry) => WRITES.has(entry.fn)); }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ok = (data: unknown): RpcAnswer => ({ data, error: null });
const err = (code: string, message = "Synthetic error"): RpcAnswer => ({ data: null, error: { code, message } });
const ruleSummary = (rule: string) => ({ rule, observations: 1, min_lag_seconds: 60, max_lag_seconds: 120, run_status: { ok: 1, error: 0, skipped: 0 },
  first_completed_at: T, last_completed_at: T, descriptive_largest_interval_seconds: null });
const SUMMARY = { checked_at: T, from: T, to: T, statement: "Counts are a lower bound.", runs: { total: 1, complete: 1, partial: 0, failed: 0, skipped: 0 }, rules: SLA_RULES.map(ruleSummary) };
const observation = (id: number, rule = "T-5") => ({ id, run_key: KEY, rule, queue: "fulfillment", kind: "confirmation_overdue",
  subject_id: "00000000-0000-4000-8000-0000000000c1", subject_kind: null, request_id: "00000000-0000-4000-8000-0000000000c1",
  due_at: "2026-11-27T12:00:00+00:00", evaluated_at: T, observed_at: T, lag_seconds: 10800 });
const page = (ids: number[], next: number | null = null, rule = "T-5") => ({ checked_at: T, items: ids.map((id) => observation(id, rule)), next_before_id: next });
const visible = (run: Record<string, unknown>, replayed = false) => ({ ...run, state: "visible", replayed });
const notVisible = (retryUntil = "2026-11-28T15:00:00+00:00") => ({ run_key: KEY, state: "not_visible", checked_at: T, retry_until: retryUntil });

async function answerReads(client: FakeClient, { runs = [COMPLETE], obs = page([3, 2, 1]) }: { runs?: unknown[]; obs?: unknown } = {}) {
  await settle();
  client.take("admin_sla_detector_runs").resolve(ok({ checked_at: T, items: runs.map((run) => ({ ...(run as object), actor_name: "Josh" })) }));
  client.take("admin_sla_observations").resolve(ok(obs));
  client.take("admin_sla_observation_summary").resolve(ok(SUMMARY));
  await settle();
}

async function setup(now = () => NOW) {
  const client = new FakeClient();
  const controller = new SlaObservationsController(client, now);
  controller.setOwner(A);
  await answerReads(client);
  return { client, controller, state: () => controller.getSnapshot() };
}

async function startScan(client: FakeClient, controller: SlaObservationsController) {
  const done = controller.scan();
  await settle();
  client.take("admin_sla_new_run_key").resolve(ok(KEY));
  await settle();
  // Wrapped: returning the promise itself from this async function would wait for the whole scan.
  return { done };
}

describe("loading and refreshing read only (no scan or purge without an operator action)", () => {
  it("opening, refreshing, filtering, paging and changing the period call only the readbacks", async () => {
    const { client, controller, state } = await setup();
    expect(state().runs.items).toHaveLength(1);
    expect(state().observations.items.map((o) => o.id)).toEqual([3, 2, 1]);
    expect(state().summary.status).toBe("ready");

    void controller.loadAll();
    await answerReads(client);
    void controller.loadObservations("T-8");
    await settle();
    expect(client.take("admin_sla_observations").args).toEqual({ p_rule: "T-8", p_before_id: null, p_limit: 50 });
    void controller.loadSummary("7d");
    await settle();
    const summary = client.take("admin_sla_observation_summary").args as { p_from: string; p_to: string };
    expect(Date.parse(summary.p_to) - Date.parse(summary.p_from)).toBe(8 * 24 * 3600 * 1000);
    void controller.loadRuns(100);
    await settle();
    expect(client.take("admin_sla_detector_runs").args).toEqual({ p_limit: 100 });
    expect(client.writes()).toEqual([]);
    expect(client.log.every((entry) => READS.has(entry.fn))).toBe(true);
  });

  it("pages observations by keyset, ignores a second press, and discards a page started under another filter", async () => {
    const client = new FakeClient();
    const controller = new SlaObservationsController(client, () => NOW);
    controller.setOwner(A);
    await answerReads(client, { obs: page([9, 8], 8) });
    const older = controller.loadOlderObservations();
    await settle();
    expect(await controller.loadOlderObservations()).toBeNull(); // already loading: no second request
    const stale = client.take("admin_sla_observations");
    expect(stale.args).toEqual({ p_rule: null, p_before_id: 8, p_limit: 50 });
    expect(client.has("admin_sla_observations")).toBe(false);
    void controller.loadObservations("T-3");
    await settle();
    client.take("admin_sla_observations").resolve(ok(page([20], null, "T-3")));
    stale.resolve(ok(page([7, 6])));
    expect(await older).toBeNull();
    expect(controller.getSnapshot().observations).toMatchObject({ rule: "T-3", nextBeforeId: null });
    expect(controller.getSnapshot().observations.items.map((o) => o.id)).toEqual([20]);
  });

  it("an older page appends after the loaded rows", async () => {
    const client = new FakeClient();
    const controller = new SlaObservationsController(client, () => NOW);
    controller.setOwner(A);
    await answerReads(client, { obs: page([9, 8], 8) });
    const older = controller.loadOlderObservations();
    await settle();
    client.take("admin_sla_observations").resolve(ok(page([7, 6])));
    expect(await older).toEqual({ added: 2, firstId: 7 });
    expect(controller.getSnapshot().observations.items.map((o) => o.id)).toEqual([9, 8, 7, 6]);
    expect(controller.getSnapshot().observations.nextBeforeId).toBeNull();
  });

  it("a failed older page keeps the list; a refused read shows access denied", async () => {
    const client = new FakeClient();
    const controller = new SlaObservationsController(client, () => NOW);
    controller.setOwner(A);
    await answerReads(client, { obs: page([9, 8], 8) });
    const older = controller.loadOlderObservations();
    await settle();
    client.take("admin_sla_observations").resolve(err("", "Failed to fetch"));
    expect(await older).toBeNull();
    expect(controller.getSnapshot().observations).toMatchObject({ moreFailed: true, loadingMore: false });
    expect(controller.getSnapshot().observations.items.map((o) => o.id)).toEqual([9, 8]);

    void controller.loadRuns();
    await settle();
    client.take("admin_sla_detector_runs").resolve(err("42501", "Only admins can read SLA detector runs"));
    await settle();
    expect(controller.getSnapshot().runs.status).toBe("denied");
  });
});

describe("Scan now", () => {
  it("asks for a new key, sends it once with the fixed limit, shows the result and re-reads", async () => {
    const { client, controller, state } = await setup();
    const { done } = await startScan(client, controller);
    const detect = client.take("admin_detect_sla_breaches");
    expect(detect.args).toEqual({ p_run_key: KEY, p_limit: SCAN_LIMIT });
    expect(state().scan).toEqual({ phase: "running", key: KEY, attempt: 1 });
    // A second press while running does nothing.
    await controller.scan();
    expect(client.log.filter((e) => e.fn === "admin_sla_new_run_key")).toHaveLength(1);
    detect.resolve(ok(visible(COMPLETE)));
    await done;
    expect(state().scan).toMatchObject({ phase: "result", key: KEY, replayed: false, via: "answer", run: { outcome: "complete" } });
    expect(client.has("admin_sla_detector_runs")).toBe(true);
    expect(client.writes().map((w) => w.fn)).toEqual(["admin_sla_new_run_key", "admin_detect_sla_breaches"]);
  });

  it("shows replayed, partial, failed and skipped outcomes as the database stated them", async () => {
    for (const [answer, expected] of [
      [visible(COMPLETE, true), { replayed: true, run: { outcome: "complete" } }],
      [visible(runJson("partial", [okRule("T-3"), errRule("T-4"), okRule("T-5"), okRule("T-8"), okRule("T-10")])), { run: { outcome: "partial" } }],
      [visible(runJson("failed", SLA_RULES.map((r) => errRule(r)))), { run: { outcome: "failed" } }],
      [visible(SKIPPED), { run: { outcome: "skipped" } }],
    ] as const) {
      const { client, controller, state } = await setup();
      const { done } = await startScan(client, controller);
      client.take("admin_detect_sla_breaches").resolve(ok(answer));
      await done;
      expect(state().scan).toMatchObject({ phase: "result", ...expected });
    }
  });

  it("an expired answer shows no content", async () => {
    const { client, controller, state } = await setup();
    const { done } = await startScan(client, controller);
    client.take("admin_detect_sla_breaches").resolve(ok({ run_key: KEY, state: "expired", replayed: true }));
    await done;
    expect(state().scan).toEqual({ phase: "expired", key: KEY, via: "answer" });
  });

  it("no key issued: nothing scanned, no detector call", async () => {
    const { client, controller, state } = await setup();
    const done = controller.scan();
    await settle();
    client.take("admin_sla_new_run_key").resolve(err("", "Failed to fetch"));
    await done;
    expect(state().scan).toMatchObject({ phase: "start_failed" });
    expect(client.log.some((e) => e.fn === "admin_detect_sla_breaches")).toBe(false);
    // A key that is not version 7 is not sent either.
    const again = controller.scan();
    await settle();
    client.take("admin_sla_new_run_key").resolve(ok("00000000-0000-4000-8000-000000000001"));
    await again;
    expect(state().scan.phase).toBe("start_failed");
    expect(client.log.some((e) => e.fn === "admin_detect_sla_breaches")).toBe(false);
  });

  it("definite refusals settle the attempt only; a retired key says so", async () => {
    for (const [code, message, retired] of [["42501", "Only admins can run the SLA detector", false], ["55000", "The SLA detector requires READ COMMITTED isolation", false],
      ["22023", "Run key is too old to start a scan", true]] as const) {
      const { client, controller, state } = await setup();
      const { done } = await startScan(client, controller);
      client.take("admin_detect_sla_breaches").resolve(err(code, message));
      await done;
      expect(state().scan).toMatchObject({ phase: "refused", key: KEY, code, keyRetired: retired });
      expect(client.has("admin_sla_detector_run")).toBe(false);
    }
  });
});

describe("unknown outcomes resolve through the run-key lookup (F-4, F-7)", () => {
  it("57014 on a first attempt: cancelled, looked up, never 'recorded nothing' (deferred mutation)", async () => {
    const { client, controller, state } = await setup();
    const { done } = await startScan(client, controller);
    client.take("admin_detect_sla_breaches").resolve(err("57014", "canceling statement due to statement timeout"));
    await settle();
    expect(state().scan).toMatchObject({ phase: "unknown", cause: "cancelled", lookup: "checking", key: KEY });
    const lookup = client.take("admin_sla_detector_run");
    expect(lookup.args).toEqual({ p_run_key: KEY });
    lookup.resolve(ok(notVisible()));
    await done;
    // not_visible stays unknown: never refused, failed or settled (deferred mutation).
    expect(state().scan).toMatchObject({ phase: "unknown", lookup: "not_visible", retryUntil: "2026-11-28T15:00:00+00:00" });
    expect(controller.canRetry()).toBe(true);
  });

  it("a lost answer settled by the lookup shows the stored run", async () => {
    const { client, controller, state } = await setup();
    const { done } = await startScan(client, controller);
    client.take("admin_detect_sla_breaches").reject(new TypeError("Failed to fetch"));
    await settle();
    client.take("admin_sla_detector_run").resolve(ok({ run_key: KEY, state: "visible", checked_at: T, run: COMPLETE }));
    await done;
    expect(state().scan).toMatchObject({ phase: "result", via: "lookup", run: { runKey: KEY } });
  });

  it("an unreadable answer (the F208-1 incomplete shape, XX000) is unknown, not a result", async () => {
    for (const answer of [ok(visible({ ...COMPLETE, outcome: null, rules: null, finished_at: null }, true)), err("XX000", "SLA run start found without its result"), err("", "Bad gateway")]) {
      const { client, controller, state } = await setup();
      const { done } = await startScan(client, controller);
      client.take("admin_detect_sla_breaches").resolve(answer);
      await settle();
      expect(state().scan).toMatchObject({ phase: "unknown", lookup: "checking" });
      client.take("admin_sla_detector_run").resolve(ok({ run_key: KEY, state: "expired", checked_at: T }));
      await done;
      expect(state().scan).toEqual({ phase: "expired", key: KEY, via: "lookup" });
    }
  });

  it("a failed lookup stays unknown; Check again reads only the lookup", async () => {
    const { client, controller, state } = await setup();
    const { done } = await startScan(client, controller);
    client.take("admin_detect_sla_breaches").resolve(err("", "Failed to fetch"));
    await settle();
    client.take("admin_sla_detector_run").resolve(err("", "Failed to fetch"));
    await done;
    expect(state().scan).toMatchObject({ phase: "unknown", lookup: "failed", retryUntil: "2026-11-28T15:00:00.000Z" });
    const writes = client.writes().length;
    const check = controller.checkAgain();
    await settle();
    client.take("admin_sla_detector_run").resolve(ok(notVisible()));
    await check;
    expect(state().scan).toMatchObject({ phase: "unknown", lookup: "not_visible" });
    expect(client.writes()).toHaveLength(writes);
  });

  it("Try again reuses the same key and limit; 57014 on the retry is looked up again; then a replay settles it", async () => {
    const { client, controller, state } = await setup();
    const { done } = await startScan(client, controller);
    client.take("admin_detect_sla_breaches").resolve(err("57014", "canceling statement due to statement timeout"));
    await settle();
    client.take("admin_sla_detector_run").resolve(ok(notVisible()));
    await done;

    const retry = controller.retry();
    await settle();
    const second = client.take("admin_detect_sla_breaches");
    expect(second.args).toEqual({ p_run_key: KEY, p_limit: SCAN_LIMIT });
    expect(state().scan).toMatchObject({ phase: "running", attempt: 2 });
    second.resolve(err("57014", "canceling statement due to statement timeout"));
    await settle();
    expect(state().scan).toMatchObject({ phase: "unknown", cause: "cancelled", attempt: 2 });
    client.take("admin_sla_detector_run").resolve(ok(notVisible()));
    await retry;

    const third = controller.retry();
    await settle();
    client.take("admin_detect_sla_breaches").resolve(ok(visible(COMPLETE, true)));
    await third;
    expect(state().scan).toMatchObject({ phase: "result", replayed: true });
    expect(client.log.filter((e) => e.fn === "admin_sla_new_run_key")).toHaveLength(1);
    expect(new Set(client.log.filter((e) => e.fn === "admin_detect_sla_breaches").map((e) => JSON.stringify(e.args)))).toEqual(new Set([JSON.stringify({ p_run_key: KEY, p_limit: SCAN_LIMIT })]));
  });

  it("past the key's lifetime nothing is sent; a fresh scan gets a new key", async () => {
    let now = NOW;
    const { client, controller, state } = await setup(() => now);
    const { done } = await startScan(client, controller);
    client.take("admin_detect_sla_breaches").resolve(err("", "Failed to fetch"));
    await settle();
    client.take("admin_sla_detector_run").resolve(ok(notVisible("2026-11-28T15:00:00+00:00")));
    await done;
    now = Date.parse("2026-11-28T15:00:00+00:00");
    expect(controller.canRetry()).toBe(false);
    await controller.retry();
    expect(client.calls.some((c) => c.fn === "admin_detect_sla_breaches")).toBe(false);
    expect(state().scan.phase).toBe("unknown");
    const fresh = controller.scan();
    await settle();
    const other = v7(now, "8000-000000000002");
    client.take("admin_sla_new_run_key").resolve(ok(other));
    await settle();
    expect(client.take("admin_detect_sla_breaches").args).toEqual({ p_run_key: other, p_limit: SCAN_LIMIT });
    void fresh;
  });

  it("a retry refused as too old retires the key", async () => {
    const { client, controller, state } = await setup();
    const { done } = await startScan(client, controller);
    client.take("admin_detect_sla_breaches").resolve(err("", "Failed to fetch"));
    await settle();
    client.take("admin_sla_detector_run").resolve(ok(notVisible()));
    await done;
    const retry = controller.retry();
    await settle();
    client.take("admin_detect_sla_breaches").resolve(err("22023", "Run key is too old to start a scan"));
    await retry;
    expect(state().scan).toMatchObject({ phase: "refused", keyRetired: true });
  });
});

describe("account changes discard stale answers and actions (as 7.5E F-1)", () => {
  it("A's scan answer arriving after B signs in is discarded; B never sees A's key", async () => {
    const { client, controller, state } = await setup();
    const { done } = await startScan(client, controller);
    const detect = client.take("admin_detect_sla_breaches");
    controller.setOwner(B);
    expect(state()).toMatchObject({ owner: B, scan: { phase: "idle" }, purge: { phase: "idle" } });
    expect(state().runs.items).toEqual([]);
    detect.resolve(ok(visible(COMPLETE)));
    await done;
    expect(state().scan).toEqual({ phase: "idle" });
    // B's reads were requested for B; A's late scan triggered no lookup or reread.
    expect(client.has("admin_sla_detector_run")).toBe(false);
    await answerReads(client, { runs: [] });
    expect(state().runs.items).toEqual([]);
    expect(client.calls).toEqual([]);
  });

  it("a lookup answer after sign-out, and after A → B → A, is discarded", async () => {
    const { client, controller, state } = await setup();
    const { done } = await startScan(client, controller);
    client.take("admin_detect_sla_breaches").resolve(err("57014", "cancel"));
    await settle();
    const lookup = client.take("admin_sla_detector_run");
    controller.setOwner(B);
    controller.setOwner(A);
    await settle();
    client.calls.splice(0); // the two accounts' reloads; not needed here
    lookup.resolve(ok({ run_key: KEY, state: "visible", checked_at: T, run: COMPLETE }));
    await done;
    // The returning account starts fresh: the old pending key is gone, nothing settled from it.
    expect(state().scan).toEqual({ phase: "idle" });
    controller.setOwner(null);
    expect(state()).toMatchObject({ owner: null, scan: { phase: "idle" } });
  });

  it("reads answered after an account change never show the previous account's data", async () => {
    const client = new FakeClient();
    const controller = new SlaObservationsController(client, () => NOW);
    controller.setOwner(A);
    await settle();
    const stale = client.calls.splice(0);
    controller.setOwner(B);
    for (const call of stale) call.resolve(call.fn === "admin_sla_detector_runs" ? ok({ checked_at: T, items: [COMPLETE] }) : call.fn === "admin_sla_observations" ? ok(page([5])) : ok(SUMMARY));
    await settle();
    expect(controller.getSnapshot()).toMatchObject({ owner: B, runs: { status: "loading", items: [] }, observations: { status: "loading", items: [] }, summary: { status: "loading", data: null } });
  });

  it("a purge answered after an account change is stale and shows nothing", async () => {
    const { client, controller, state } = await setup();
    const purge = controller.purge();
    await settle();
    const call = client.take("admin_purge_sla_records");
    controller.setOwner(B);
    call.resolve(ok({ purge_id: 1, outcome: "complete", checked_at: T, limit: 1000,
      deleted_logical: { observations: 0, runs: 0, purge_logs: 0 }, deleted_physical_rows: { observations: 0, run_results: 0, run_starts: 0, purge_logs: 0 },
      remaining_expired_logical: { observations: 0, runs: 0, runs_still_referenced: 0, purge_logs: 0, cap: 10000, over_cap: false }, oldest_remaining_expired_at: null }));
    expect(await purge).toEqual({ kind: "stale" });
    expect(state().purge).toEqual({ phase: "idle" });
  });
});

describe("purge", () => {
  const COMPLETE_PURGE = { purge_id: 2, outcome: "complete", checked_at: T, limit: 1000,
    deleted_logical: { observations: 3, runs: 1, purge_logs: 0 }, deleted_physical_rows: { observations: 3, run_results: 1, run_starts: 1, purge_logs: 0 },
    remaining_expired_logical: { observations: 0, runs: 0, runs_still_referenced: 0, purge_logs: 0, cap: 10000, over_cap: false }, oldest_remaining_expired_at: null };

  it("one call with the largest batch; a second press while pending sends nothing", async () => {
    const { client, controller } = await setup();
    const first = controller.purge();
    await settle();
    const call = client.take("admin_purge_sla_records");
    expect(call.args).toEqual({ p_limit: PURGE_LIMIT });
    expect(await controller.purge()).toEqual({ kind: "busy" });
    expect(client.log.filter((e) => e.fn === "admin_purge_sla_records")).toHaveLength(1);
    call.resolve(ok(COMPLETE_PURGE));
    expect(await first).toEqual({ kind: "complete" });
    expect(controller.getSnapshot().purge).toMatchObject({ phase: "done", result: { outcome: "complete", deletedLogical: { observations: 3, runs: 1 } } });
    // A completed purge re-reads; it is never repeated by itself.
    expect(client.has("admin_sla_detector_runs")).toBe(true);
    expect(client.log.filter((e) => e.fn === "admin_purge_sla_records")).toHaveLength(1);
  });

  it("a skipped purge is its own outcome", async () => {
    const { client, controller } = await setup();
    const run = controller.purge();
    await settle();
    client.take("admin_purge_sla_records").resolve(ok({ purge_id: 3, outcome: "skipped", checked_at: T, limit: 1000 }));
    expect(await run).toEqual({ kind: "skipped" });
    expect(controller.getSnapshot().purge).toMatchObject({ phase: "done", result: { outcome: "skipped" } });
  });

  it("refusals delete nothing; every other answer is unknown", async () => {
    for (const [answer, kind] of [
      [err("55000", "SLA record retention is not decided; nothing can be purged"), "refused"], [err("42501", "Only admins can purge SLA records"), "refused"],
      [err("XX000", "SLA purge found a run without its start or result"), "unknown"], [err("57014", "cancel"), "unknown"], [err("", "Failed to fetch"), "unknown"],
      [ok({ ...COMPLETE_PURGE, deleted_physical_rows: { ...COMPLETE_PURGE.deleted_physical_rows, run_starts: 2 } }), "unknown"],
    ] as const) {
      const { client, controller } = await setup();
      const run = controller.purge();
      await settle();
      client.take("admin_purge_sla_records").resolve(answer);
      expect((await run).kind).toBe(kind);
      expect(controller.getSnapshot().purge.phase).toBe(kind);
    }
  });

  it("no purge while a scan is in flight, and no scan while a purge is", async () => {
    const { client, controller } = await setup();
    const { done: scan } = await startScan(client, controller);
    expect(await controller.purge()).toEqual({ kind: "busy" });
    client.take("admin_detect_sla_breaches").resolve(ok(visible(COMPLETE)));
    await scan;
    const purge = controller.purge();
    await settle();
    await controller.scan();
    expect(client.log.filter((e) => e.fn === "admin_sla_new_run_key")).toHaveLength(1);
    client.take("admin_purge_sla_records").resolve(ok({ purge_id: 3, outcome: "skipped", checked_at: T, limit: 1000 }));
    await purge;
  });
});
