// Phase 7.5F-2 (TRACE-159): synthetic browser evidence for the SLA observation page (DEC-2026-069).
// Every 7.5F function is served per test from synthetic values and every call is recorded; any
// other origin is aborted, so nothing leaves the machine. Covers: no scan or purge on load, refresh,
// filtering, paging or waiting; scan outcomes (complete, replayed, partial, failed, skipped);
// unknown outcomes resolved by the run-key lookup, the same-key retry and its lifetime; purge
// confirmation, one call per confirmation, logical vs physical counts, refusal and unknown; access
// denial; sign-out while a scan is pending; safe links; loading, empty, error and paging states;
// accessibility at 320 and 1440 px. The database contract is SQL 131/132 and is unchanged.
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";
import { COMPLETE, SKIPPED, errRule, okRule, runJson, v7 } from "../fixtures/sla-observations";
import { SLA_RULES } from "../../src/lib/slaObservations";

const wcag = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const T = "2026-11-27T15:00:00+00:00";
const REQUEST = "00000000-0000-4000-8000-0000000000c1";

type Answer = { status?: number; json?: unknown; abort?: boolean };
type Handler = (body: Record<string, unknown>, store: Store) => Answer | Promise<Answer>;

class Store {
  calls: { fn: string; body: Record<string, unknown> }[] = [];
  handlers: Record<string, Handler> = {};
  constructor(public key = v7(Date.now())) {}
  of(fn: string) { return this.calls.filter((c) => c.fn === fn); }
  writes() { return this.calls.filter((c) => ["admin_sla_new_run_key", "admin_detect_sla_breaches", "admin_purge_sla_records"].includes(c.fn)); }
}

const run = (extra: Record<string, unknown> = {}, base: Record<string, unknown> = COMPLETE) => ({ ...base, actor_name: "Synthetic Admin", ...extra });
const runsAnswer = (items: unknown[]) => ({ json: { checked_at: T, items } });
const obs = (id: number, extra: Record<string, unknown> = {}) => ({ id, run_key: COMPLETE.run_key, rule: "T-5", queue: "fulfillment", kind: "confirmation_overdue",
  subject_id: REQUEST, subject_kind: null, request_id: REQUEST, due_at: "2026-11-27T12:00:00+00:00", evaluated_at: T, observed_at: T, lag_seconds: 3 * 3600 + 15 * 60, ...extra });
const summaryAnswer = (observations = 2) => ({ json: { checked_at: T, from: T, to: T,
  statement: "Counts are a lower bound: a breach that begins and ends between scans is never recorded, and absence is not evidence of compliance.",
  runs: { total: 3, complete: 1, partial: 1, failed: 0, skipped: 1 },
  rules: SLA_RULES.map((rule) => ({ rule, observations: rule === "T-5" ? observations : 0, min_lag_seconds: rule === "T-5" ? 3600 : null, max_lag_seconds: rule === "T-5" ? 7200 : null,
    run_status: { ok: 2, error: rule === "T-4" ? 1 : 0, skipped: 1 }, first_completed_at: T, last_completed_at: T, descriptive_largest_interval_seconds: 86400 })) } });
const COMPLETE_PURGE = { purge_id: 2, outcome: "complete", checked_at: T, limit: 1000,
  deleted_logical: { observations: 3, runs: 1, purge_logs: 0 }, deleted_physical_rows: { observations: 3, run_results: 1, run_starts: 1, purge_logs: 0 },
  remaining_expired_logical: { observations: 0, runs: 2, runs_still_referenced: 2, purge_logs: 0, cap: 10000, over_cap: false },
  oldest_remaining_expired_at: "2026-08-20T12:00:00+00:00" };

function defaults(store: Store) {
  store.handlers = {
    admin_sla_detector_runs: () => runsAnswer([run()]),
    admin_sla_observations: (body) => ({ json: { checked_at: T, items: body.p_before_id ? [obs(1)] : [obs(3), obs(2, { rule: "T-8", queue: "support", kind: "first_reply_overdue", subject_kind: "dispute", request_id: null })],
      next_before_id: body.p_before_id ? null : 2 } }),
    admin_sla_observation_summary: () => summaryAnswer(),
    admin_sla_new_run_key: (_, s) => ({ json: s.key }),
    admin_detect_sla_breaches: (body) => ({ json: { ...COMPLETE, run_key: body.p_run_key, state: "visible", replayed: false } }),
    admin_sla_detector_run: (body) => ({ json: { run_key: body.p_run_key, state: "not_visible", checked_at: T, retry_until: new Date(Date.now() + 3600_000).toISOString() } }),
    admin_purge_sla_records: () => ({ json: COMPLETE_PURGE }),
  };
}

async function open(page: Page, configure: (store: Store) => void = () => undefined, options: { width?: number; role?: "admin" | "homeowner" } = {}) {
  const store = new Store();
  defaults(store);
  configure(store);
  await page.route(/\/rest\/v1\/rpc\/admin_(sla_|detect_sla|purge_sla)/, async (route: Route) => {
    const fn = new URL(route.request().url()).pathname.split("/").pop() as string;
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    store.calls.push({ fn, body });
    const answer = await store.handlers[fn](body, store);
    if (answer.abort) return route.abort("failed");
    return route.fulfill({ status: answer.status ?? 200, json: answer.json });
  });
  await syntheticSession(page.context(), options.role ?? "admin");
  await page.addInitScript(() => localStorage.setItem("theme", "light"));
  await page.setViewportSize({ width: options.width ?? 1440, height: 900 });
  await page.goto("/admin/sla-observations");
  return store;
}

const status = (page: Page) => page.getByTestId("scan-status");
const ready = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1, name: "SLA observations" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Recent runs", exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: "Observations", exact: true })).toBeVisible();
};
async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([]);
  expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
});

for (const width of [1440, 320]) {
  test(`opening, refreshing, filtering, paging and waiting never scan or purge (${width}px)`, async ({ page }) => {
    test.slow();
    const store = await open(page, undefined, { width });
    await ready(page);
    const facts = page.getByRole("region", { name: "What this page shows, and what it doesn’t" });
    await expect(facts).toContainText("Overdue now");
    await expect(facts.getByRole("link", { name: "Fulfillment follow-up" })).toHaveAttribute("href", "/admin/requests#fulfillment-follow-up");
    await expect(facts).toContainText("Recorded observations");
    await expect(facts).toContainText("Observation counts are a lower bound.");
    await expect(facts).toContainText("First-response facts");
    await expect(facts).toContainText("doesn’t report whether a first reply was late");
    await expect(facts).toContainText("scanning at any interval does not make the record complete");
    await expect(page.getByText("No scan has been started on this page. Opening or refreshing it never runs one.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Purge expired records" })).toBeVisible();
    await accessible(page);

    await page.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(() => store.of("admin_sla_detector_runs").length).toBe(2);
    await page.getByRole("combobox", { name: "Rule", exact: true }).selectOption("T-8");
    await expect.poll(() => store.of("admin_sla_observations").at(-1)?.body).toEqual({ p_rule: "T-8", p_before_id: null, p_limit: 50 });
    await page.getByRole("combobox", { name: "Rule", exact: true }).selectOption("");
    await page.getByRole("button", { name: "Load older observations" }).click();
    await expect(page.getByRole("list", { name: "Observations", exact: true }).locator(":scope > li")).toHaveCount(3);
    await expect(page.getByText("You’ve reached the oldest retained observation.")).toBeVisible();
    await page.getByRole("combobox", { name: "Period", exact: true }).selectOption("7d");
    await expect.poll(() => store.of("admin_sla_observation_summary").length).toBe(3);
    await page.reload();
    await ready(page);
    await page.waitForTimeout(1500);
    expect(store.writes()).toEqual([]);
  });
}

test("observations are labelled as records, with lag and safe links; never as still overdue", async ({ page }) => {
  await open(page);
  await ready(page);
  const list = page.getByRole("list", { name: "Observations", exact: true });
  const first = list.locator(":scope > li").first();
  await expect(first).toContainText("T-5 Completion confirmation: Completion unanswered");
  await expect(first).toContainText("3 h 15 min past due");
  await expect(first.getByRole("link", { name: "Open the service request" })).toHaveAttribute("href", `/admin/requests?request=${REQUEST}`);
  const ticket = list.locator(":scope > li").nth(1);
  await expect(ticket).toContainText("Awaiting first reply (Service dispute)");
  await expect(ticket.getByRole("link", { name: "Open Support tickets" })).toHaveAttribute("href", "/admin/tickets");
  await expect(list).not.toContainText(/still overdue|overdue now/i);
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(summary).toContainText("3 scans in this period: 1 complete, 1 partial, 0 failed, 1 skipped.");
  await expect(summary).toContainText("At least 2");
  await expect(summary).toContainText("They do not bound, estimate or count missed breaches");
  await expect(summary).not.toContainText(/coverage:|complete coverage|all breaches/i);
  await first.getByRole("link", { name: "Open the service request" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/requests\\?request=${REQUEST}$`));
});

test("Scan now: one new key, one detector call with it, the result, then reads only", async ({ page }) => {
  const store = await open(page, (s) => {
    s.handlers.admin_sla_detector_runs = () => runsAnswer(s.of("admin_detect_sla_breaches").length ? [run({ run_key: s.key }), run()] : [run()]);
  });
  await ready(page);
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect(status(page)).toContainText("Scan complete");
  await expect(status(page)).toContainText("3 items newly recorded, 1 item already recorded, 1 item left for a later scan by the per-rule limit.");
  await expect(status(page)).toContainText("T-5 Completion confirmation: 2 listed · 1 newly recorded · 0 already recorded · 1 over this run’s limit");
  await expect(status(page)).toBeFocused();
  expect(store.of("admin_sla_new_run_key")).toHaveLength(1);
  expect(store.of("admin_detect_sla_breaches").map((c) => c.body)).toEqual([{ p_run_key: store.key, p_limit: 200 }]);
  await expect(page.getByRole("list", { name: "Recent runs", exact: true }).locator(":scope > li")).toHaveCount(2);
  await page.waitForTimeout(1000);
  expect(store.writes()).toHaveLength(2);
});

test("run outcomes are shown as recorded: replayed, partial, failed and skipped", async ({ page }) => {
  const partial = runJson("partial", [okRule("T-3", { listed: 1, inserted: 1 }), errRule("T-4", "42P01"), okRule("T-5"), okRule("T-8"), okRule("T-10")], { run_key: v7(Date.now() - 60_000) });
  const failed = runJson("failed", SLA_RULES.map((r) => errRule(r)), { run_key: v7(Date.now() - 120_000) });
  const skipped = { ...SKIPPED, run_key: v7(Date.now() - 180_000) };
  await open(page, (s) => {
    s.handlers.admin_sla_detector_runs = () => runsAnswer([run({}, partial), run({}, failed), run({}, skipped)]);
    s.handlers.admin_detect_sla_breaches = (body) => ({ json: { ...COMPLETE, run_key: body.p_run_key, state: "visible", replayed: true } });
  });
  await ready(page);
  const runs = page.getByRole("list", { name: "Recent runs", exact: true }).locator(":scope > li");
  await expect(runs.nth(0)).toContainText("Partial");
  await expect(runs.nth(0)).toContainText("Some rules failed. They recorded nothing in this run; the other rules were recorded.");
  await runs.nth(0).getByText("Rule details").click();
  await expect(runs.nth(0)).toContainText("T-4 Failed payment aging: Failed (42P01). Nothing was recorded for this rule in this run.");
  await expect(runs.nth(1)).toContainText("Failed");
  await expect(runs.nth(1)).toContainText("Every rule failed. Nothing was recorded in this run.");
  await expect(runs.nth(2)).toContainText("Skipped");
  await expect(runs.nth(2)).toContainText("Another scan or purge was running. Nothing was read or recorded.");
  await expect(runs.nth(2)).not.toContainText("newly recorded");
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect(status(page)).toContainText("This scan had already run. This is its stored result; nothing was scanned again.");
});

test("a skipped scan says nothing was recorded and that a new scan needs a new key", async ({ page }) => {
  const store = await open(page, (s) => {
    s.handlers.admin_detect_sla_breaches = (body) => ({ json: { ...SKIPPED, run_key: body.p_run_key, state: "visible", replayed: false } });
  });
  await ready(page);
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect(status(page)).toContainText("Scan skipped");
  await expect(status(page)).toContainText("Another scan or purge was running. Nothing was read or recorded. This key is used up; press Scan now to start a new scan.");
  store.key = v7(Date.now(), "8000-000000000009");
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect.poll(() => store.of("admin_detect_sla_breaches").map((c) => c.body.p_run_key)).toEqual([store.of("admin_detect_sla_breaches")[0].body.p_run_key, store.key]);
});

test("cancelled attempt (57014): looked up, stays unknown, same-key retry replays", async ({ page }) => {
  const store = await open(page, (s) => {
    s.handlers.admin_detect_sla_breaches = (body, st) => st.of("admin_detect_sla_breaches").length === 1
      ? { status: 500, json: { code: "57014", message: "canceling statement due to statement timeout" } }
      : { json: { ...COMPLETE, run_key: body.p_run_key, state: "visible", replayed: true } };
  });
  await ready(page);
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect(status(page)).toContainText("This attempt was cancelled before it finished");
  await expect(status(page)).toContainText("another attempt with the same key may have finished");
  await expect(status(page)).toContainText("No result is visible yet.");
  await expect(status(page)).not.toContainText(/nothing was recorded|did not run|failed/i);
  expect(store.of("admin_sla_detector_run").map((c) => c.body)).toEqual([{ p_run_key: store.key }]);
  await accessible(page);
  await page.getByRole("button", { name: "Try again with the same key" }).click();
  await expect(status(page)).toContainText("This scan had already run.");
  expect(store.of("admin_detect_sla_breaches").map((c) => c.body)).toEqual([{ p_run_key: store.key, p_limit: 200 }, { p_run_key: store.key, p_limit: 200 }]);
  expect(store.of("admin_sla_new_run_key")).toHaveLength(1);
});

test("no answer: the lookup settles it; a failed lookup stays unknown and Check again only reads", async ({ page }) => {
  const store = await open(page, (s) => {
    s.handlers.admin_detect_sla_breaches = () => ({ abort: true });
    s.handlers.admin_sla_detector_run = () => ({ abort: true });
  });
  await ready(page);
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect(status(page)).toContainText("We couldn’t confirm whether the scan ran");
  await expect(status(page)).toContainText("The lookup didn’t answer either, so the outcome is still unknown.");
  store.handlers.admin_sla_detector_run = (body) => ({ json: { run_key: body.p_run_key, state: "visible", checked_at: T, run: { ...COMPLETE, run_key: body.p_run_key } } });
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(status(page)).toContainText("Scan complete");
  await expect(status(page)).toContainText("Confirmed by looking up the scan’s run key.");
  expect(store.of("admin_detect_sla_breaches")).toHaveLength(1);
});

test("an incomplete answer is unknown; an expired run shows no content; a retired key offers only a new scan", async ({ page }) => {
  const store = await open(page, (s) => {
    s.handlers.admin_detect_sla_breaches = (body) => ({ json: { ...COMPLETE, run_key: body.p_run_key, outcome: null, rules: null, finished_at: null, state: "visible", replayed: true } });
    s.handlers.admin_sla_detector_run = (body) => ({ json: { run_key: body.p_run_key, state: "not_visible", checked_at: T, retry_until: new Date(Date.now() - 1000).toISOString() } });
  });
  await ready(page);
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect(status(page)).toContainText("The scan’s answer couldn’t be read");
  await expect(status(page)).toContainText("This key can no longer be retried. Press Scan now to start a new scan");
  await expect(page.getByRole("button", { name: "Try again with the same key" })).toHaveCount(0);
  store.handlers.admin_sla_detector_run = (body) => ({ json: { run_key: body.p_run_key, state: "expired", checked_at: T } });
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(status(page)).toContainText("This scan’s record is past its retention period");
  await expect(status(page)).not.toContainText(/listed|newly recorded/);
  expect(store.of("admin_detect_sla_breaches")).toHaveLength(1);
});

test("refused scans: too-old key and a non-admin answer record nothing", async ({ page }) => {
  await open(page, (s) => {
    s.handlers.admin_detect_sla_breaches = () => ({ status: 400, json: { code: "22023", message: "Run key is too old to start a scan" } });
  });
  await ready(page);
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect(status(page)).toContainText("The scan was refused");
  await expect(status(page)).toContainText("Run key is too old to start a scan. This attempt recorded nothing.");
  await expect(status(page)).toContainText("This key can no longer be retried.");
});

test("access denial: a non-admin never reaches the page; a refused readback shows the permission state", async ({ page }) => {
  // The server proxy sends a signed-in non-admin home before the page renders (the admin layout and
  // every database function also refuse).
  const store = await open(page, undefined, { role: "homeowner" });
  await expect(page).toHaveURL("http://127.0.0.1:3103/");
  await expect(page.getByRole("heading", { level: 1, name: "SLA observations" })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(store.calls).toEqual([]);
  await page.context().clearCookies();
  const admin = await open(page, (s) => {
    s.handlers.admin_sla_detector_runs = () => ({ status: 403, json: { code: "42501", message: "Only admins can read SLA detector runs" } });
  });
  await expect(page.getByRole("heading", { name: "Admin access required" })).toBeVisible();
  await expect(page.getByText("This account can’t read SLA observations. Nothing was scanned or changed.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Scan now" })).toHaveCount(0);
  expect(admin.writes()).toEqual([]);
});

test("signing out while a scan is pending: the late result shows nothing and nothing follows", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const store = await open(page, (s) => {
    s.handlers.admin_detect_sla_breaches = async (body) => { await held; return { json: { ...COMPLETE, run_key: body.p_run_key, state: "visible", replayed: false } }; };
  });
  await page.route("**/auth/v1/logout**", (route) => route.fulfill({ status: 204 }));
  await ready(page);
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Scanning…" })).toBeVisible();
  await page.getByRole("button", { name: "Sign Out" }).click();
  await expect(page).toHaveURL(/\/login/);
  const before = store.calls.length;
  release();
  await page.waitForTimeout(1000);
  await expect(page.locator("body")).not.toContainText(/Scan complete|newly recorded/);
  expect(store.calls.slice(before)).toEqual([]);
  await expect(page).toHaveURL(/\/login/);
});

test("leaving mid-scan and coming back starts nothing", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const store = await open(page, (s) => {
    s.handlers.admin_detect_sla_breaches = async (body) => { await held; return { json: { ...COMPLETE, run_key: body.p_run_key, state: "visible", replayed: false } }; };
  });
  await ready(page);
  await page.getByRole("button", { name: "Scan now" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Scanning…" })).toBeVisible();
  await page.getByRole("navigation", { name: "admin navigation" }).getByRole("link", { name: "Notifications" }).click();
  await expect(page).toHaveURL(/\/admin\/notifications$/);
  release();
  await page.getByRole("navigation", { name: "admin navigation" }).getByRole("link", { name: "SLA Observations" }).click();
  await ready(page);
  await expect(page.getByRole("navigation", { name: "admin navigation" }).getByRole("link", { name: "SLA Observations" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("No scan has been started on this page.")).toBeVisible();
  await page.waitForTimeout(1000);
  expect(store.of("admin_sla_new_run_key")).toHaveLength(1);
  expect(store.of("admin_detect_sla_breaches")).toHaveLength(1);
});

test("purge: the confirmation is explicit and expired-only; cancel calls nothing; one confirmation is one call", async ({ page }) => {
  const store = await open(page);
  await ready(page);
  const section = page.getByRole("region", { name: "Retention and purge" });
  await expect(section).toContainText("90-day retention (DEC-2026-069)");
  await expect(section).toContainText("at most 4,000 rows");
  await section.getByRole("button", { name: "Purge expired records" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading")).toHaveText("Permanently delete expired SLA records?");
  await expect(dialog).toContainText("Up to 1,000 expired observations, 1,000 expired runs and 1,000 expired purge-log entries");
  await expect(dialog).toContainText("Deletes only records whose retention period has passed");
  await expect(dialog).toContainText("Deletion is permanent and cannot be undone.");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await accessible(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  expect(store.of("admin_purge_sla_records")).toEqual([]);

  await section.getByRole("button", { name: "Purge expired records" }).click();
  await dialog.getByRole("button", { name: "Delete expired records" }).click();
  await expect(dialog).toHaveCount(0);
  const result = page.getByTestId("purge-result");
  await expect(result).toContainText("Records deleted: 3 observations, 1 run, 0 purge-log entries.");
  await expect(result).toContainText("Database rows deleted: 3 observation rows, 1 run-result row, 1 run-start row, 0 purge-log rows.");
  await expect(result).toContainText("2 expired runs are still referenced by expired observations");
  expect(store.of("admin_purge_sla_records").map((c) => c.body)).toEqual([{ p_limit: 1000 }]);
  await page.waitForTimeout(1000);
  expect(store.of("admin_purge_sla_records")).toHaveLength(1);
  expect(store.of("admin_detect_sla_breaches")).toEqual([]);
});

test("purge: a refusal deletes nothing; an unknown outcome says records may have been deleted; skipped is not 'done'", async ({ page }) => {
  const store = await open(page, (s) => {
    s.handlers.admin_purge_sla_records = () => ({ status: 400, json: { code: "55000", message: "SLA record retention is not decided; nothing can be purged" } });
  });
  await ready(page);
  const section = page.getByRole("region", { name: "Retention and purge" });
  const dialog = page.getByRole("alertdialog");
  await section.getByRole("button", { name: "Purge expired records" }).click();
  await dialog.getByRole("button", { name: "Delete expired records" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The purge was refused: SLA record retention is not decided; nothing can be purged. Nothing was deleted.");

  store.handlers.admin_purge_sla_records = () => ({ abort: true });
  await dialog.getByRole("button", { name: "Delete expired records" }).click();
  await expect(dialog.getByRole("alert")).toContainText("We couldn’t confirm whether the purge ran");
  await expect(dialog.getByRole("alert")).toContainText("Expired records may have been deleted; no unexpired record can be.");

  store.handlers.admin_purge_sla_records = () => ({ json: { purge_id: 9, outcome: "skipped", checked_at: T, limit: 1000 } });
  await dialog.getByRole("button", { name: "Delete expired records" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Another scan or purge was running, so nothing was deleted. The skip was logged.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("purge-result")).toContainText("The last purge was skipped");
  expect(store.of("admin_purge_sla_records")).toHaveLength(3);
});

test("loading, empty and error states with retry", async ({ page }) => {
  test.slow();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const store = await open(page, (s) => {
    s.handlers.admin_sla_detector_runs = async () => { await held; return runsAnswer([]); };
    s.handlers.admin_sla_observations = () => ({ json: { checked_at: T, items: [], next_before_id: null } });
    s.handlers.admin_sla_observation_summary = () => ({ status: 500, json: { message: "Synthetic outage" } });
  }, { width: 320 });
  await expect(page.getByRole("status").filter({ hasText: "Loading recent runs" })).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "No retained scans" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No retained observations" })).toBeVisible();
  await expect(page.getByText("Check the queues for anything overdue now.")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "The summary couldn’t be loaded" })).toContainText("Nothing was scanned or changed.");
  await accessible(page);
  store.handlers.admin_sla_observation_summary = () => summaryAnswer(0);
  await page.getByRole("region", { name: "Summary" }).getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("region", { name: "Summary" })).toContainText("None recorded");
  expect(store.writes()).toEqual([]);
});
