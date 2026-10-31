import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

// TRACE-131: exception previews, the assessed cancellation command, stale recovery, plan rows,
// the refund-status layers, the operations queue, quality events and the public policy.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
});

const axe = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
const pendingJob = "00000000-0000-4000-8000-000000000013";

async function homeowner(page: Page, theme: string, width: number) {
  await syntheticSession(page.context(), "homeowner");
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/dashboard?tab=upcoming");
  await page.getByRole("button", { name: "Open Synthetic Pending Service details" }).click();
  return page.getByRole("dialog", { name: "Synthetic Pending Service" });
}

async function admin(page: Page, theme = "light", width = 320) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/requests");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Service Requests");
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`homeowner ${theme} ${width}px: pending cancel previews the policy and sends the read it showed`, async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await page.route("**/rest/v1/rpc/record_job_operation", async route => {
      sent = route.request().postDataJSON();
      await route.fulfill({ json: { policy: "CFG-006/007", refund_percent: 50, basis: "notice_24_to_72_hours", operation_id: "00000000-0000-4000-8000-0000000000aa" } });
    });
    const dialog = await homeowner(page, theme, width);
    await dialog.getByRole("button", { name: "Cancel request", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "Cancel this pending request?" });
    await expect(confirm.getByText(/Refund under the policy: 50% of what was paid, because 24 to 72 hours before the appointment/)).toBeVisible();
    await expect(confirm.getByText(/this action doesn't send money/)).toBeVisible();
    await axe(page);
    await confirm.getByRole("button", { name: "Yes, cancel request" }).click();
    await expect(page.getByText("Request cancelled")).toBeVisible();
    expect(sent).toMatchObject({ _job_id: pendingJob, _kind: "customer_cancel", _expected: { status: "pending" } });
    await expect(page.getByText(/refunded/i)).toHaveCount(0);
  });
}

test("homeowner: a stale cancellation is refused, explained and the preview reloads", async ({ page }) => {
  let previews = 0;
  await page.route("**/rest/v1/rpc/job_cancellation_preview", async route => { previews += 1; await route.fallback(); });
  await page.route("**/rest/v1/rpc/record_job_operation", route => route.fulfill({ status: 409,
    json: { code: "40001", message: "This service changed since you opened it. Review the current details and try again." } }));
  const dialog = await homeowner(page, "light", 320);
  await dialog.getByRole("button", { name: "Cancel request", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Cancel this pending request?" });
  const before = previews;
  await confirm.getByRole("button", { name: "Yes, cancel request" }).click();
  await expect(confirm.getByRole("alert")).toHaveText(/This request changed since you opened it/);
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect.poll(() => previews).toBeGreaterThan(before);
});

test("homeowner: refund status keeps policy, approval and money returned apart", async ({ page }) => {
  await page.route("**/rest/v1/rpc/job_cancellation_outcome", route => route.fulfill({ json: { job_id: pendingJob, status: "pending", cancelled: false,
    entitlement: { state: "refund_due", refund_percent: 100, basis: "provider_withdrawal_open", amount: 11700, captured: 11700 },
    authorization: { state: "partly_authorized", amount: 5000 }, movement: { state: "in_flight", settled: 0, in_flight: 5000 }, follow_up: [] } }));
  const dialog = await homeowner(page, "light", 320);
  const status = dialog.getByRole("region", { name: "Refund status" });
  await expect(status.getByText("Owed under the policy: 100% ($117.00).")).toBeVisible();
  await expect(status.getByText("Part of the refund is approved ($50.00).")).toBeVisible();
  await expect(status.getByText("Refund sent; waiting for the payment provider to confirm it.")).toBeVisible();
  await expect(status.getByText(/^Refunded/)).toHaveCount(0);
  await axe(page);
});

test("homeowner: refunded is said only when the payment provider confirmed it", async ({ page }) => {
  await page.route("**/rest/v1/rpc/job_cancellation_outcome", route => route.fulfill({ json: { job_id: pendingJob, status: "pending", cancelled: false,
    entitlement: { state: "refund_due", refund_percent: 100, basis: "no_acceptable_replacement", amount: 11700, captured: 11700 },
    authorization: { state: "authorized", amount: 11700 }, movement: { state: "settled", settled: 11700 }, follow_up: [] } }));
  const dialog = await homeowner(page, "dark", 1440);
  await expect(dialog.getByText("Refunded: $117.00. The payment provider confirmed it.")).toBeVisible();
});

test("admin: a recurring plan shows plan guidance instead of visit changes", async ({ page }) => {
  await page.route("**/rest/v1/rpc/job_cancellation_preview", route => route.fulfill({ json: { job_id: "00000000-0000-4000-8000-000000000010",
    kind: "customer_cancel", allowed: false, plan: true, visit: false, expected: {}, assessment: null, payment: null,
    refusal: { code: "recurring_plan", message: "Changes are made on each visit. Mercurius can stop future visits on the plan." } } }));
  await admin(page);
  await page.getByRole("button", { name: /Review Synthetic Lawn/ }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Lawn Service" });
  await expect(dialog.getByText(/This is a recurring plan. Change it with Stop future visits/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Review service change" })).toHaveCount(0);
});

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`admin ${theme} ${width}px: no generic cancel; follow-up queue and provider events`, async ({ page }) => {
    await page.route("**/rest/v1/rpc/admin_cancellation_queue", route => route.fulfill({ json: { checked_at: new Date().toISOString(), items: [{
      job_id: "00000000-0000-4000-8000-0000000000c1", service_type: "Synthetic Cancelled Service", customer_name: "Synthetic Homeowner",
      status: "cancelled", cancelled: true, entitlement: { state: "refund_due", refund_percent: 100, basis: "notice_72_hours_or_more", amount: 11700, captured: 11700 },
      authorization: { state: "none", amount: 0 }, movement: { state: "none" },
      follow_up: [{ code: "payment_after_cancellation", message: "A payment was recorded after the cancellation. Request the refund it is owed." }] }] } }));
    await page.route("**/rest/v1/rpc/admin_provider_quality_events", route => route.fulfill({ json: { checked_at: new Date().toISOString(), items: [
      { operation_id: "q1", job_id: "j1", service_type: "Synthetic Lawn Service", contractor_name: "Synthetic Vendor", kind: "provider_cancel",
        reason: "Synthetic withdrawal", created_at: new Date().toISOString(), classification: "recorded", recorded_by: "provider" },
      { operation_id: "q2", job_id: "j2", service_type: "Synthetic Pool Service", contractor_name: "Synthetic Vendor", kind: "no_show",
        reason: "Synthetic storm", created_at: new Date().toISOString(), classification: "excused", recorded_by: "operations" }] } }));
    await admin(page, theme, width);
    const queue = page.getByRole("region", { name: "Cancellation follow-up" });
    await expect(queue.getByText(/A payment was recorded after the cancellation/)).toBeVisible();
    await expect(queue.getByText(/No money has been returned yet/)).toBeVisible();
    await page.getByRole("button", { name: /Review Synthetic Lawn/ }).first().click();
    const dialog = page.getByRole("dialog", { name: "Synthetic Lawn Service" });
    await expect(dialog.getByRole("button", { name: "Scheduled", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancelled", exact: true })).toHaveCount(0);
    await axe(page);
    await page.keyboard.press("Escape");
    await page.goto("/admin/quality");
    await page.getByRole("tab", { name: "Provider Cancellations" }).click();
    const events = page.getByRole("region", { name: "Provider cancellations and no-shows" });
    await expect(events.getByText("Quality event")).toBeVisible();
    await expect(events.getByText("Excused by operations")).toBeVisible();
    await expect(events.getByText(/Nothing here changes a provider’s ranking, matching or standing/)).toBeVisible();
    await axe(page);
  });
}

for (const theme of ["light", "dark"]) {
  test(`public policy ${theme}: matches CFG-006/007 and promises nothing unapproved`, async ({ page }) => {
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/reschedule-policy");
    for (const text of ["72+ Hours Before", "24-72 Hours Before", "No Appointment Time Yet", "After Work Has Started",
      "A $25 rescheduling fee applies.", "Handled case by case and not guaranteed."]) await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/Mercurius waives rescheduling fees and cancellation penalties/)).toBeVisible();
    await expect(page.getByText(/looks for an acceptable replacement first[^]*If there isn.t one, you get a full refund/)).toBeVisible();
    await expect(page.getByText(/compensate/i)).toHaveCount(0);
    await expect(page.getByText(/instantly/i)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await axe(page);
  });
}
