import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-135 (Phase 6.12A) synthetic browser evidence. Checklist states are mocked readbacks;
// nothing here claims a real provider, document, exception or review. The database contract
// (states, isolation, non-disclosure, read-only) is SQL 106.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const day = 86_400_000;
const at = (days: number) => new Date(Date.now() + days * day).toISOString();
const easternDay = (offset: number) => {
  const [year, month, date] = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
};
const label = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });

const current = (kind: string) => ({ kind, state: "current", exception: false, follow_up_due: null, expires_at: null, recorded_at: at(-30),
  awaiting_review: 0, last_submitted_at: null, declined: null });
const attention = {
  evaluated_at: new Date().toISOString(), today: easternDay(0), notice_days: 30, provider_found: true, onboarding_status: "active",
  checklist_current: false, matching_allowed: false, payout_onboarding_current: false, accepting_uploads: true, open_limit: 5,
  items: [
    current("identity"), current("agreement"), current("coverage"),
    { ...current("license"), state: "exception", exception: true, follow_up_due: easternDay(10), expires_at: at(11), recorded_at: null },
    { ...current("insurance"), state: "expired", expires_at: at(-2), awaiting_review: 1, last_submitted_at: at(-1) },
    { ...current("bank_authorization"), state: "expired", expires_at: at(-1) },
    current("profile_pricing"),
    { ...current("availability"), state: "missing", recorded_at: null },
    current("test_notification"),
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});
test.afterEach(async ({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

function status(page: Page, body: Record<string, unknown> | (() => Record<string, unknown> | null)) {
  return page.route("**/rpc/vendor_own_compliance_status", route => {
    const json = typeof body === "function" ? body() : body;
    return json ? route.fulfill({ json }) : route.fulfill({ status: 503, json: { message: "Synthetic outage" } });
  });
}

async function openPage(page: Page, theme = "light", width = 320) {
  await syntheticSession(page.context(), "vendor");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/vendor/compliance");
  await expect(page.getByRole("heading", { level: 1, name: "Compliance documents" })).toBeVisible();
  return page.getByRole("region", { name: "Your checklist" });
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`vendor checklist ${theme} ${width}px: states, next actions and effects`, async ({ page }) => {
    await status(page, attention);
    const region = await openPage(page, theme, width);
    await expect(region.getByText("While a required item is missing or expired, Mercurius cannot send you new job requests.")).toBeVisible();
    await expect(region.getByText("Payouts are held until your payout onboarding is current.")).toBeVisible();
    await expect(region.getByText("4 of 9 items need attention.")).toBeVisible();
    const items = region.getByRole("list", { name: "Checklist items" }).getByRole("listitem");
    // Expired first, then missing, then the exception; current items last.
    await expect(items.nth(0)).toContainText("Insurance");
    await expect(items.nth(1)).toContainText("Payout onboarding");
    await expect(items.nth(2)).toContainText("Availability expectations");
    const license = items.nth(3);
    await expect(license).toContainText("Exception: document pending");
    await expect(license).toContainText(`It is not a verified license and ends after ${label(easternDay(10))}.`);
    await expect(license).toContainText(`Next: Upload your license or business tax receipt before the end of ${label(easternDay(10))}.`);
    await expect(license.getByText("Recorded by Mercurius")).toHaveCount(0);
    await expect(items.nth(0)).toContainText("1 document awaiting review");
    await expect(items.nth(0)).toContainText("Uploading is not verification");
    await expect(items.nth(1)).toContainText("Do not send bank details");
    await expect(items.nth(1).getByRole("link", { name: "Contact Mercurius" })).toHaveAttribute("href", "/contact");
    await expect(license.getByRole("link", { name: "Go to upload" })).toHaveAttribute("href", "#renewal-upload-title");
    expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/vendor-compliance-status-${theme}-${width}.png`, fullPage: true });
  });
}

test("the checklist is read with no provider parameter", async ({ page }) => {
  const request = page.waitForRequest("**/rpc/vendor_own_compliance_status");
  await status(page, attention);
  await openPage(page);
  const body = (await request).postData();
  expect(body === null || body === "" || body === "{}").toBe(true);
});

test("a current checklist asks for nothing", async ({ page }) => {
  const region = await openPage(page);
  await expect(region.getByText("Your checklist allows new job requests. Live offerings and coverage are also required.")).toBeVisible();
  await expect(region.getByText("Every item is current.")).toBeVisible();
  await expect(region.getByText("Next:", { exact: false })).toHaveCount(0);
  await expect(region.getByText("Payouts are held", { exact: false })).toHaveCount(0);
});

test("a declined document shows Mercurius's note without changing a current item", async ({ page }) => {
  await status(page, { ...attention, checklist_current: true, matching_allowed: true, payout_onboarding_current: true,
    items: attention.items.map(item => item.kind === "license"
      ? { ...current("license"), expires_at: at(200), declined: { at: at(-1), note: "Synthetic: the expiry date is not readable." } }
      : current(item.kind)) });
  const region = await openPage(page);
  const license = region.getByRole("listitem").filter({ hasText: "License or business tax receipt" });
  await expect(license).toContainText("Current");
  await expect(license).toContainText("Synthetic: the expiry date is not readable.");
});

test("a load failure keeps uploads usable and offers a retry", async ({ page }) => {
  let fail = true;
  await status(page, () => (fail ? null : attention));
  const region = await openPage(page);
  await expect(region.getByRole("alert")).toContainText("Your documents and uploads below still work.");
  fail = false;
  await region.getByRole("button", { name: "Try again" }).click();
  await expect(region.getByText("4 of 9 items need attention.")).toBeVisible();
});

test("a provider without an onboarding record is told to contact Mercurius, with no invented items", async ({ page }) => {
  await status(page, { ...attention, onboarding_status: null, checklist_current: false, matching_allowed: false, items: [] });
  const region = await openPage(page);
  await expect(region.getByText("Mercurius has not moved your account to the current onboarding checklist.", { exact: false })).toBeVisible();
  await expect(region.getByRole("heading", { name: "No checklist on record" })).toBeVisible();
  await expect(region.getByRole("list", { name: "Checklist items" })).toHaveCount(0);
});

test("the renewal notice words an exception as documentation pending by its Eastern follow-up date", async ({ page }) => {
  await page.route("**/rpc/vendor_own_evidence_renewal", route => route.fulfill({ json: {
    evaluated_at: new Date().toISOString(), notice_days: 30,
    items: [{ kind: "license", expires_at: at(11), state: "expiring", exception: true, follow_up_due: easternDay(10) }],
  } }));
  await syntheticSession(page.context(), "vendor");
  await page.goto("/vendor/jobs");
  const notice = page.getByRole("region", { name: "Compliance documents need renewal" });
  await expect(notice.getByText(`License · Exception: document pending, ends after ${label(easternDay(10))}`)).toBeVisible();
  await expect(notice.getByText("Expires in", { exact: false })).toHaveCount(0);
  await expect(notice.getByText("Upload your documents before the dates shown to keep receiving new job requests.")).toBeVisible();
  await expect(notice.getByRole("link", { name: "Upload documents" })).toHaveAttribute("href", "/vendor/compliance");
});

test("a lapsed exception says no verified document is on file", async ({ page }) => {
  await page.route("**/rpc/vendor_own_evidence_renewal", route => route.fulfill({ json: {
    evaluated_at: new Date().toISOString(), notice_days: 30,
    items: [{ kind: "insurance", expires_at: at(-1), state: "lapsed", exception: true, follow_up_due: easternDay(-2) }],
  } }));
  await syntheticSession(page.context(), "vendor");
  await page.goto("/vendor/jobs");
  const notice = page.getByRole("region", { name: "Compliance documents have lapsed" });
  await expect(notice.getByText(`Insurance · Exception ended after ${label(easternDay(-2))}; no verified document is on file`)).toBeVisible();
  await expect(notice.getByText("Upload your documents for review.", { exact: false })).toBeVisible();
});
