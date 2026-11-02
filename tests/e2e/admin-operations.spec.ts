import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

// TRACE-136 (DEC-2026-057): grouped admin navigation, the overview on queue counts, deep links and
// Back, stale actions, honest finance controls, read-only coverage and legacy invoices, and no
// public Admin or Smart Picks entry points. Hiding links is not authorization: the proxy and the
// database still refuse non-admins (portals.spec and SQL 108).
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
});

const axe = async (page: Page) =>
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
const lawn = "00000000-0000-4000-8000-000000000010";
const groups = ["Marketplace Operations", "Catalog & Supply", "Money", "Trust & Support", "Merchandising & Insights"];

async function admin(page: Page, path: string, theme = "light", width = 1440) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
}

for (const [theme, width] of [["light", 1440], ["dark", 390]] as const) {
  test(`navigation and overview ${theme} ${width}px: grouped, no Smart Picks, counts from the queues`, async ({ page }) => {
    await admin(page, "/admin", theme, width);
    await expect(page.getByRole("heading", { level: 1, name: "Operations overview" })).toBeVisible();
    if (width < 1024) {
      await page.getByRole("button", { name: /menu/i }).first().click();
    }
    const nav = page.getByRole("navigation", { name: "admin navigation" });
    for (const group of groups) await expect(nav.getByRole("heading", { name: group })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Smart Picks" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    if (width < 1024) await page.keyboard.press("Escape");
    const queues = page.getByRole(width < 768 ? "list" : "table", { name: "Operational queues" });
    await expect(queues.getByRole("link", { name: "Cancellation follow-up" })).toBeVisible();
    await expect(queues.getByText("Finance authority required")).toBeVisible();
    await expect(page.getByRole("link", { name: /Homeowner Portal/ })).toHaveCount(0);
    await axe(page);
  });
}

test("the old Smart Picks route goes to Featured Providers", async ({ page }) => {
  await admin(page, "/admin/smart-picks");
  await expect(page).toHaveURL(/\/admin\/featured$/);
});

test("public pages carry no Admin or Smart Picks entry point", async ({ page }) => {
  for (const path of ["/", "/pricing"]) {
    await page.goto(path);
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
    await expect(page.getByText("Our Picks For You")).toHaveCount(0);
  }
});

test("a homeowner session is refused at the server for admin pages", async ({ page }) => {
  await syntheticSession(page.context(), "homeowner");
  await page.goto("/admin/coverage");
  await expect(page).not.toHaveURL(/\/admin\/coverage/);
});

test("deep link opens the record with its filter, keyboard close keeps the filter, Back closes", async ({ page }) => {
  await admin(page, `/admin/requests?status=matched&request=${lawn}`);
  const dialog = page.getByRole("dialog", { name: "Synthetic Lawn Service" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Filter requests by status")).toHaveValue("matched");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/status=matched/);
  await expect(page).not.toHaveURL(/request=/);

  const review = page.getByRole("button", { name: /Review Synthetic Lawn/ });
  await review.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`request=${lawn}`));
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/status=matched/);
});

test("a record outside the loaded list is fetched by id", async ({ page }) => {
  const outside = "00000000-0000-4000-8000-0000000000e1";
  await page.route(`**/rest/v1/service_requests?*id=eq.${outside}*`, route => route.fulfill({ json: {
    id: outside, customer_id: "00000000-0000-4000-8000-000000000001", contractor_id: null, service_type: "Synthetic Archived Service",
    description: "Synthetic", status: "pending", address: "1 Synthetic Way", city: "Cape Coral", state: "FL", zip_code: "33904",
    preferred_date: null, preferred_time: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    total_amount: null, quote_amount: null, assigned_at: null, match_expires_at: null, match_attempt_count: 0, declined_contractor_ids: [],
    payment_status: "pending", needs_admin_review: false, matching_status: "awaiting_match", preferred_contractor_id: null,
  } }));
  await admin(page, `/admin/requests?request=${outside}`);
  const dialog = page.getByRole("dialog", { name: "Synthetic Archived Service" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Correct details" })).toBeVisible();
});

test("a stale status change is refused with the current-state message and changes nothing", async ({ page }) => {
  await page.route("**/rest/v1/rpc/admin_transition_job_status_expected", route => route.fulfill({ status: 409,
    json: { code: "40001", message: "This request changed since you opened it; review the current state" } }));
  await admin(page, `/admin/requests?request=${lawn}`, "light", 390);
  const dialog = page.getByRole("dialog", { name: "Synthetic Lawn Service" });
  await dialog.getByRole("button", { name: "Scheduled", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Change request status?" });
  await confirm.getByLabel("Reason (required)").fill("Synthetic stale check");
  await confirm.getByRole("button", { name: "Change to Scheduled" }).click();
  await expect(confirm.getByRole("alert")).toHaveText("This request changed since you opened it — review the current state.");
  await expect(confirm.getByRole("alert")).toBeFocused();
  await axe(page);
});

test("a bound request offers no address or scope correction", async ({ page }) => {
  await admin(page, `/admin/requests?request=${lawn}`);
  const dialog = page.getByRole("dialog", { name: "Synthetic Lawn Service" });
  await expect(dialog.getByText(/already has an offer, quote, payment or price/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Correct details" })).toHaveCount(0);
});

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`finance controls are honest ${theme} ${width}px`, async ({ page }) => {
    await admin(page, "/admin/invoices", theme, width);
    await expect(page.getByRole("heading", { level: 1, name: "Legacy invoices" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Refunds and payment corrections go through Finance review" })).toBeVisible();
    for (const name of [/Create Invoice/i, /Edit/i, /Mark Paid/i, /Refund/i]) await expect(page.getByRole("button", { name })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Finance" })).toHaveAttribute("href", "/admin/finance");
    await axe(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.route("**/rest/v1/service_requests?*disputed=eq.true*", route => route.fulfill({ json: [] }));
    await page.goto("/admin/disputes");
    await page.getByRole("tab", { name: "Payout holds" }).click();
    await expect(page.getByText("Payout holds are placed in Finance (finance authority required)")).toBeVisible();
    await expect(page.getByRole("button", { name: /Pause/ })).toHaveCount(0);
  });
}

test("coverage is a read-only readback", async ({ page }) => {
  await page.route("**/rest/v1/coverage_areas?*", route => route.fulfill({ json: [
    { id: "00000000-0000-4000-8000-0000000000c1", zip_code: "33904", city: "Cape Coral", state: "FL", is_active: true, has_waitlist: false },
  ] }));
  await admin(page, "/admin/coverage", "light", 390);
  await expect(page.getByText("1 of 1 ZIP codes active. Read-only.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Add|Remove|Delete/ })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await axe(page);
});
