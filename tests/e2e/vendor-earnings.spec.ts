import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-135 (Phase 6.12B, DEC-2026-056) synthetic browser evidence. Earnings are mocked readbacks;
// nothing here claims a real provider, payment, hold or transfer. The database contract (states,
// isolation, non-disclosure, read-only) is SQL 107.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const amounts = { service: 10000, platform_fee: 1500, platform_subsidy: 0, tips: 1000, payout: 9500 };
const week = { week_start: "2026-10-25", week_end: "2026-10-31", amount: 9500 };
const job = (n: number, state: string, extra: Record<string, unknown> = {}) => ({
  job_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, invoice_number: `M5-000000000${n}`, service: "House cleaning",
  completed_at: "2026-10-28T15:00:00Z", confirmed_at: "2026-10-29T15:00:00Z", state, holds: [], eligible_at: null,
  amounts, received: 0, transfer: null, ...extra,
});
const item = (n: number, status: string) => ({
  job_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, invoice_number: `M5-000000000${n}`, service: "House cleaning",
  service_amount: 10000, platform_fee: 1500, platform_subsidy: 0, tips: 1000, payout: 9500, status,
});
const earnings = {
  evaluated_at: "2026-11-01T15:00:00Z", provider_found: true, payout_onboarding_current: true,
  jobs: [
    job(1, "waiting_payment", { amounts: null, received: null }),
    job(2, "eligible", { eligible_at: "2026-10-31T15:00:00Z" }),
    job(3, "held", { holds: ["dispute", "mercurius"], eligible_at: "2026-10-31T15:00:00Z" }),
    job(4, "unknown", { transfer: week }),
    job(5, "failed", { transfer: week }),
    job(6, "returned", { transfer: week }),
    job(7, "paid", { transfer: week, received: 9500 }),
  ],
  totals: {
    waiting_payment: { count: 1, amount: null }, eligible: { count: 1, amount: 9500 }, held: { count: 1, amount: 9500 },
    unknown: { count: 1, amount: 9500 }, failed: { count: 1, amount: 9500 }, returned: { count: 1, amount: 9500 },
    paid: { count: 1, amount: 9500 },
  },
  statements: [{ week_start: "2026-10-25", week_end: "2026-10-31", payout_total: 38000, paid_total: 9500,
    items: [item(4, "unknown"), item(5, "failed"), item(6, "returned"), item(7, "settled")] }],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});
test.afterEach(async ({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

function readback(page: Page, body: Record<string, unknown> | (() => Record<string, unknown> | null)) {
  return page.route("**/rpc/vendor_own_earnings", route => {
    const json = typeof body === "function" ? body() : body;
    return json ? route.fulfill({ json }) : route.fulfill({ status: 503, json: { message: "Synthetic outage" } });
  });
}

async function openPage(page: Page, path = "/vendor/earnings", theme = "light", width = 320) {
  await syntheticSession(page.context(), "vendor");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
}

async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`vendor earnings ${theme} ${width}px: states, holds, amounts and statement`, async ({ page }) => {
    await readback(page, earnings);
    await openPage(page, "/vendor/earnings", theme, width);
    await expect(page.getByRole("heading", { level: 1, name: "Earnings & payouts" })).toBeVisible();

    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary.getByText("Paid to you")).toBeVisible();
    // Paid counts the settled transfer only; unknown, failed and returned are not paid.
    await expect(summary.locator("dd").first()).toHaveText("$95.00");
    await expect(summary.getByText("1 job is waiting for the homeowner's payment.", { exact: false })).toBeVisible();

    const rows = page.getByRole("list", { name: "Job payouts" }).locator(":scope > li");
    await expect(rows).toHaveCount(7);
    const waiting = rows.nth(0);
    await expect(waiting).toContainText("Waiting for payment");
    await expect(waiting).not.toContainText("$");
    await expect(rows.nth(1)).toContainText("Eligible since Oct 31, 2026; paid in a weekly transfer Mercurius prepares.");
    await expect(rows.nth(1)).toContainText("Your payout");
    await expect(rows.nth(1)).toContainText("$95.00");
    const held = rows.nth(2);
    await expect(held.getByRole("list", { name: "Hold reasons" })).toContainText("Dispute");
    await expect(held.getByRole("list", { name: "Hold reasons" })).toContainText("Held by Mercurius");
    await expect(rows.nth(3)).toContainText("Mercurius is confirming this transfer with the bank. It isn't counted as paid.");
    await expect(rows.nth(4)).toContainText("Not paid. Mercurius will review a retry.");
    await expect(rows.nth(5)).toContainText("Returned by your bank. Mercurius will contact you.");
    await expect(rows.nth(6)).toContainText("Paid in the transfer for the week of Oct 25, 2026 – Oct 31, 2026.");

    const statement = page.getByRole("region", { name: "Week of Oct 25, 2026 – Oct 31, 2026" });
    await expect(statement).toContainText("Transfer total $380.00 · paid $95.00");
    await expect(statement.getByRole("row")).toHaveCount(5);
    await expect(statement.getByRole("columnheader")).toHaveText(["Job", "Service", "Platform fee", "Tips", "Payout", "Transfer"]);
    await expect(statement.getByRole("row").nth(1)).toContainText("Confirming with the bank");
    await expect(statement.getByRole("row").nth(4)).toContainText("Paid");

    // Never released, never an expected payout date, never bank details.
    await expect(page.locator("#main-content")).not.toContainText(/released|expected payout|routing|account number/i);
    await accessible(page);
  });
}

test("vendor earnings: empty state for a provider with no jobs", async ({ page }) => {
  await readback(page, { ...earnings, jobs: [], totals: {}, statements: [] });
  await openPage(page);
  await expect(page.getByText("No payouts yet")).toBeVisible();
  await expect(page.getByText("No statements yet")).toBeVisible();
  await accessible(page);
});

test("vendor earnings: error with retry, then recovery", async ({ page }) => {
  let calls = 0;
  await readback(page, () => (++calls === 1 ? null : earnings));
  await openPage(page);
  await expect(page.getByText("Earnings unavailable")).toBeVisible();
  await expect(page.getByText("No amount is estimated.")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("list", { name: "Job payouts" })).toBeVisible();
});

test("vendor earnings: lapsed payout onboarding and unlinked account", async ({ page }) => {
  await readback(page, { ...earnings, payout_onboarding_current: false });
  await openPage(page);
  await expect(page.getByText("Payouts are held until your payout onboarding is current.")).toBeVisible();
  await expect(page.getByText("Do not send bank details by message or upload.")).toBeVisible();
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
  await readback(page, { evaluated_at: earnings.evaluated_at, provider_found: false, payout_onboarding_current: false, jobs: [], totals: {}, statements: [] });
  await page.reload();
  await expect(page.getByText("No provider account linked")).toBeVisible();
});

test("vendor dashboard shows the canonical earnings summary, not released earnings", async ({ page }) => {
  await readback(page, earnings);
  await openPage(page, "/vendor", "light", 1440);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Synthetic Vendor");
  await expect(page.getByText("Released earnings")).toHaveCount(0);
  await expect(page.getByText("Paid to you")).toBeVisible();
  await expect(page.getByText("1 transfer was not paid or returned.", { exact: false })).toHaveCount(0);
  await expect(page.getByText("2 transfers were not paid or returned. See your earnings for details.")).toBeVisible();
  await expect(page.getByRole("link", { name: "View earnings" })).toHaveAttribute("href", "/vendor/earnings");
  await expect(page.getByRole("navigation", { name: "vendor navigation" }).getByRole("link", { name: "Earnings & Payouts" })).toHaveAttribute("href", "/vendor/earnings");
});
