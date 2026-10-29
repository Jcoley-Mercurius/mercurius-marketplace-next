// TRACE-128 (Phase 6.7): who started, completed and confirmed the work, and when, for every role;
// the homeowner's confirmation and issue report bound to the completion they reviewed, with a
// stale refusal recovering; the provider's keyed start replaying after a lost response; the
// operations follow-up queue. Synthetic fixture only; outcomes come from stubbed read-backs, and
// the real commands are proven by SQL 098 and scripts/fulfillment-concurrency.mjs.
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

type Row = Record<string, unknown>;
const lawn = "00000000-0000-4000-8000-000000000010";
const completed = "00000000-0000-4000-8000-000000000015";
const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const readback = (overrides: Row): Row => ({ role: "homeowner", status: "vendor_completed", plan: false, visit: true,
  started: { at: hoursAgo(3), by: "provider", rework: false }, completion: { at: hoursAgo(1), attempt: 1, photos: 2, minimum: 2, by: "provider", recorded: true },
  confirmation: null, dispute: null, dispute_window_ends_at: new Date(Date.now() + 47 * 3_600_000).toISOString(),
  review_at: new Date(Date.now() + 71 * 3_600_000).toISOString(), operations: [], payout: null, ...overrides });

async function setup(page: Page, role: "admin" | "homeowner" | "vendor", { theme = "light", width = 1440 } = {}) {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.setViewportSize({ width, height: 1000 });
  await syntheticSession(page.context(), role);
}

async function homeownerDialog(page: Page, completedHoursAgo = 1) {
  const completedAt = hoursAgo(completedHoursAgo);
  await page.route("**/rest/v1/service_requests?**", async route => {
    const response = await route.fetch();
    const rows = await response.json();
    const shift = (row: Row) => row.id === completed ? { ...row, vendor_completed_at: completedAt, matching_status: "matched" } : row;
    await route.fulfill({ response, json: Array.isArray(rows) ? rows.map(shift) : shift(rows) });
  });
  await page.route("**/rest/v1/rpc/job_fulfillment", route => route.fulfill({ json: readback({
    completion: { at: completedAt, attempt: 1, photos: 2, minimum: 2, by: "provider", recorded: true },
    dispute_window_ends_at: new Date(Date.parse(completedAt) + 48 * 3_600_000).toISOString(),
    review_at: new Date(Date.parse(completedAt) + 72 * 3_600_000).toISOString() }) }));
  await page.goto("/dashboard?tab=upcoming");
  await page.getByRole("button", { name: "Open Synthetic Completed Service details" }).click();
  return { dialog: page.getByRole("dialog", { name: "Synthetic Completed Service" }), completedAt };
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`homeowner ${theme} ${width}px: provider completion is separate from confirmation`, async ({ page }) => {
    await setup(page, "homeowner", { theme, width });
    const { dialog, completedAt } = await homeownerDialog(page);
    const work = dialog.getByRole("region", { name: "Work and completion" });
    await expect(work.getByRole("list", { name: "Work history" }).getByRole("listitem")).toHaveText([/Work started.*Provider/, /Completion submitted.*Provider.*2 photos/]);
    await expect(work).toContainText("Waiting for you to confirm the work or report an issue by");
    await expect(work).toContainText("silence doesn't confirm it");
    await expect(work).not.toContainText("Payout");
    await expect(dialog.getByText(/You can report an issue until/)).toBeVisible();

    await dialog.getByRole("button", { name: "Confirm done", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Confirm the work is done?" });
    await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await expect(confirm).toContainText("payout can begin 48 hours after you confirm");
    expect(await axe(page)).toEqual([]);
    // The provider resubmitted proof meanwhile: the server refuses, the alert takes focus and the
    // service reloads; nothing is confirmed.
    await page.route("**/rest/v1/rpc/homeowner_confirm_completion", route => route.fulfill({ status: 409,
      json: { code: "40001", message: "The provider submitted new completion proof. Review it before you confirm." } }));
    const sent = page.waitForRequest(request => request.method() === "POST" && request.url().includes("/rpc/homeowner_confirm_completion"));
    const reloaded = page.waitForRequest(request => request.url().includes("/rest/v1/service_requests"));
    await confirm.getByRole("button", { name: "Confirm done", exact: true }).click();
    expect((await sent).postDataJSON()).toEqual({ _job_id: completed, _completed_at: completedAt });
    await expect(confirm.getByRole("alert")).toBeFocused();
    await reloaded;
    // Behind the confirmation, the service dialog names the reason once the confirmation closes.
    await page.keyboard.press("Escape");
    await expect(dialog.getByRole("alert")).toContainText("The provider submitted new completion proof");
    expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/fulfillment-homeowner-${theme}-${width}.png`, fullPage: true });
  });
}

test("homeowner: after 48 hours the issue report is replaced by support guidance", async ({ page }) => {
  await setup(page, "homeowner");
  const { dialog } = await homeownerDialog(page, 49);
  await expect(dialog.getByText(/The 48-hour window to report an issue has ended; contact support/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Report an issue", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Confirm done", exact: true })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Work and completion" })).toContainText("contact support about an issue");
});

test("vendor: a lost start response replays with the same key; the details show payout waits for the homeowner", async ({ page }) => {
  await setup(page, "vendor", { width: 320 });
  await page.route("**/rest/v1/service_requests?**", async route => {
    const response = await route.fetch();
    const rows = await response.json();
    const scheduled = (row: Row) => row.id === lawn ? { ...row, status: "scheduled", matching_status: "matched" } : row;
    await route.fulfill({ response, json: Array.isArray(rows) ? rows.map(scheduled) : scheduled(rows) });
  });
  const starts: Row[] = [];
  await page.route("**/rest/v1/rpc/start_job", route => {
    starts.push(route.request().postDataJSON() as Row);
    return starts.length === 1 ? route.abort("failed") : route.fulfill({ json: { outcome: "replayed", status: "in_progress" } });
  });
  await page.route("**/rest/v1/rpc/job_fulfillment", route => route.fulfill({ json: readback({ role: "vendor",
    payout: { state: "awaiting_confirmation", eligible_at: null } }) }));
  await page.goto("/vendor/jobs");
  await page.getByRole("tab", { name: /Active Jobs/ }).click();
  const card = page.locator("[data-slot=card]").filter({ hasText: "Synthetic Lawn Service" });
  await card.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Unable to start this job")).toBeVisible();
  await card.getByRole("button", { name: "Start job" }).click();
  await expect(page.getByText("Job started", { exact: true })).toBeVisible();
  expect(starts).toHaveLength(2);
  expect(starts[1]._operation_key).toBe(starts[0]._operation_key);
  expect(starts[0]).toMatchObject({ _job_id: lawn });

  await card.getByRole("button", { name: "View details" }).click();
  const work = page.getByRole("dialog", { name: "Synthetic Lawn Service" }).getByRole("region", { name: "Work and completion" });
  await expect(work.getByRole("listitem").nth(1)).toContainText("Completion submitted");
  await expect(work).toContainText("Waiting for the homeowner to confirm. The provider's completion alone doesn't confirm the work or start payout.");
  await expect(work).toContainText("Payout: Payout waits for the homeowner to confirm the work.");
  expect(await axe(page)).toEqual([]);
});

test("vendor: a stale start refreshes the jobs instead of failing silently", async ({ page }) => {
  await setup(page, "vendor");
  await page.route("**/rest/v1/service_requests?**", async route => {
    const response = await route.fetch();
    const rows = await response.json();
    const scheduled = (row: Row) => row.id === lawn ? { ...row, status: "scheduled", matching_status: "matched" } : row;
    await route.fulfill({ response, json: Array.isArray(rows) ? rows.map(scheduled) : scheduled(rows) });
  });
  await page.route("**/rest/v1/rpc/start_job", route => route.fulfill({ status: 409,
    json: { code: "40001", message: "This service is no longer waiting to start (now in progress). Refresh to see its current state." } }));
  await page.goto("/vendor/jobs");
  await page.getByRole("tab", { name: /Active Jobs/ }).click();
  const reloaded = page.waitForRequest(request => request.url().includes("/rest/v1/service_requests"));
  await page.locator("[data-slot=card]").filter({ hasText: "Synthetic Lawn Service" }).getByRole("button", { name: "Start job" }).click();
  await reloaded;
  await expect(page.getByText("This job changed")).toBeVisible();
});

for (const [theme, width] of [["dark", 320], ["light", 1440]] as const) {
  test(`admin ${theme} ${width}px: follow-up queue records a reasoned follow-up; the request shows the payment at start`, async ({ page }) => {
    await setup(page, "admin", { theme, width });
    let items: Row[] = [{ request_id: lawn, kind: "fulfillment_exception", since: hoursAgo(2), detail: "unable_to_complete",
      service_type: "Synthetic Lawn Service", status: "in_progress", series_id: "00000000-0000-4000-8000-000000000099" }];
    await page.route("**/rest/v1/rpc/admin_fulfillment_queue", route => route.fulfill({ json: { items } }));
    const followUps: Row[] = [];
    await page.route("**/rest/v1/rpc/admin_record_fulfillment_follow_up", route => {
      followUps.push(route.request().postDataJSON() as Row);
      items = [];
      return route.fulfill({ json: { outcome: "recorded" } });
    });
    await page.route("**/rest/v1/rpc/job_fulfillment", route => route.fulfill({ json: readback({ role: "admin", status: "in_progress", completion: null,
      started: { at: hoursAgo(3), by: "provider", rework: false, reason: null, payment_at_start: { state: "ready", reason: null } },
      operations: [{ kind: "unable_to_complete", at: hoursAgo(2), reason: "Gate locked", by: "provider" }],
      payout: { state: "awaiting_confirmation", eligible_at: null, blocker: "awaiting_confirmation" } }) }));
    await page.goto("/admin/requests");
    const queue = page.getByRole("region", { name: "Work and completion follow-up" });
    await expect(queue.getByRole("listitem")).toContainText("Unable to complete");
    await expect(queue).toContainText("recurring visit");
    await queue.getByRole("button", { name: "Record follow-up" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Record your follow-up?" });
    await expect(confirm).toContainText("doesn’t change the service, charge, refund or message anyone");
    await expect(confirm.getByRole("button", { name: "Record follow-up" })).toBeDisabled();
    await confirm.getByLabel("What you did or agreed (required)").fill("Called both; return visit Thursday");
    await confirm.getByRole("button", { name: "Record follow-up" }).click();
    await expect(queue).toContainText("Nothing needs follow-up");
    expect(followUps).toHaveLength(1);
    expect(followUps[0]).toMatchObject({ _job_id: lawn, _item: "fulfillment_exception", _reason: "Called both; return visit Thursday" });
    expect(followUps[0]._operation_key).toEqual(expect.any(String));

    await page.getByRole("button", { name: /Review Synthetic Lawn/ }).first().click();
    const work = page.getByRole("dialog", { name: "Synthetic Lawn Service" }).getByRole("region", { name: "Work and completion" });
    await expect(work).toContainText("Unable to complete");
    await expect(work).toContainText("Payment when work started: ready");
    await expect(work).toContainText("Payout check: awaiting confirmation");
    expect(await axe(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/fulfillment-admin-${theme}-${width}.png`, fullPage: true });
  });
}

test("the work history recovers from a failed readback with Refresh", async ({ page }) => {
  await setup(page, "admin");
  let fail = true;
  await page.route("**/rest/v1/rpc/job_fulfillment", (route: Route) => fail
    ? route.fulfill({ status: 503, json: { message: "Synthetic outage" } })
    : route.fulfill({ json: readback({ role: "admin", status: "in_progress", completion: null }) }));
  await page.goto("/admin/requests");
  await page.getByRole("button", { name: /Review Synthetic Lawn/ }).first().click();
  const work = page.getByRole("dialog", { name: "Synthetic Lawn Service" }).getByRole("region", { name: "Work and completion" });
  await expect(work.getByRole("alert")).toContainText("Work history couldn’t be loaded");
  fail = false;
  await work.getByRole("button", { name: "Refresh" }).click();
  await expect(work.getByRole("listitem")).toContainText("Work started");
});
