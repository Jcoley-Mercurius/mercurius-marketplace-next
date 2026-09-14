import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-072 synthetic browser evidence. Queue and notice states are mocked readbacks;
// nothing here claims real evidence, a real provider or a renewal.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const day = 86_400_000;
const evaluated = new Date();
const at = (days: number) => new Date(evaluated.getTime() + days * day).toISOString();
const lapsedEntry = {
  contractor_id: "00000000-0000-4000-8000-000000000071", name: "Synthetic Lapsed Services",
  onboarding_status: "active", onboarding_revision: 3, eligible: false, scoped_compliance_current: false,
  kind: "insurance", evidence_id: "00000000-0000-4000-8000-000000000081", requirement_version: "general-liability-v1",
  accepted_at: at(-400), expires_at: at(-2.5), state: "lapsed",
};
const expiringEntry = {
  contractor_id: "00000000-0000-4000-8000-000000000072", name: "Synthetic Expiring Services",
  onboarding_status: "suspended", onboarding_revision: 5, eligible: false, scoped_compliance_current: true,
  kind: "license", evidence_id: "00000000-0000-4000-8000-000000000082", requirement_version: "state-license-v1",
  accepted_at: at(-300), expires_at: at(9.5), state: "expiring",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

function queue(page: Page, body: Record<string, unknown>) {
  return page.route("**/rpc/vendor_evidence_renewal_queue", route => route.fulfill({
    json: { evaluated_at: evaluated.toISOString(), notice_days: 30, cutover_enforced: false, entries: [lapsedEntry, expiringEntry], ...body },
  }));
}

async function openQueue(page: Page, theme = "light", width = 320) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/compliance/renewals");
  await expect(page.getByRole("heading", { level: 1, name: "Compliance expiry" })).toBeVisible();
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`compliance expiry queue ${theme} ${width}px`, async ({ page }) => {
    await queue(page, {});
    await openQueue(page, theme, width);
    const list = width < 1280 ? page.getByRole("list", { name: "Evidence needing renewal" }) : page.getByRole("table", { name: "Evidence needing renewal" });
    await expect(list).toBeVisible();
    await expect(list.getByText("Lapsed 2 days ago")).toBeVisible();
    await expect(list.getByText("Expires in 10 days")).toBeVisible();
    await expect(list.getByText("Matching on hold").first()).toBeVisible();
    await expect(page.getByText("it does not suspend them", { exact: false })).toBeVisible();
    await expect(page.getByRole("region", { name: "Queue totals" }).getByText("Expiring within 30 days")).toBeVisible();
    expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (width >= 1024) {
      const nav = page.getByRole("navigation", { name: "admin navigation" });
      await expect(nav.getByRole("link", { name: "Compliance Expiry" })).toHaveAttribute("aria-current", "page");
      await expect(nav.getByRole("link", { name: "Provider Compliance" })).not.toHaveAttribute("aria-current", "page");
    }
    await page.screenshot({ path: `test-results/evidence-renewal-queue-${theme}-${width}.png`, fullPage: true });
  });
}

test("the queue links each entry to the provider and filters by state", async ({ page }) => {
  await queue(page, {});
  await openQueue(page, "light", 1440);
  const table = page.getByRole("table", { name: "Evidence needing renewal" });
  await expect(table.getByRole("link", { name: "Synthetic Lapsed Services" })).toHaveAttribute("href", `/admin/vendors/${lapsedEntry.contractor_id}`);
  await expect(table.getByText("Record renewed evidence in the activation checklist, then record renewal.")).toBeVisible();
  await expect(table.getByText("Collect renewed evidence before", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Lapsed (1)" }).click();
  await expect(page.getByRole("button", { name: "Lapsed (1)" })).toHaveAttribute("aria-pressed", "true");
  await expect(table.getByRole("link", { name: "Synthetic Lapsed Services" })).toBeVisible();
  await expect(table.getByRole("link", { name: "Synthetic Expiring Services" })).toHaveCount(0);
});

test("strict matching adds the scoped rebinding step for license and insurance", async ({ page }) => {
  await queue(page, { cutover_enforced: true, entries: [lapsedEntry, { ...expiringEntry, kind: "availability", requirement_version: "availability-v1" }] });
  await openQueue(page, "light", 1440);
  await expect(page.getByRole("table", { name: "Evidence needing renewal" })
    .getByText("Strict matching is on: bind the renewed document to its service areas in Provider compliance.")).toHaveCount(1);
});

test("an empty queue says nothing needs renewal", async ({ page }) => {
  await queue(page, { entries: [] });
  await openQueue(page);
  await expect(page.getByRole("heading", { name: "No evidence needs renewal" })).toBeVisible();
  await expect(page.getByText("No live provider's evidence lapses within the next 30 days.")).toBeVisible();
});

test("a queue that cannot load offers a retry", async ({ page }) => {
  await openQueue(page);
  await expect(page.getByRole("alert").filter({ hasText: "Compliance expiry queue unavailable" })).toBeVisible();
  await queue(page, {});
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "All (2)" })).toBeVisible();
});

test("the activation checklist flags current evidence that is due for renewal", async ({ page }) => {
  await page.route("**/rpc/vendor_onboarding_intake_status", async route => {
    const response = await route.fetch();
    const data = await response.json();
    Object.assign(data, { contractor_id: "00000000-0000-4000-8000-000000000052", onboarding_status: "active", onboarding_revision: 3,
      onboarding_version_id: "00000000-0000-4000-8000-000000000051", review_started: true });
    await route.fulfill({ response, json: data });
  });
  await page.route("**/rpc/vendor_onboarding_checklist", async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.onboarding_status = "active";
    data.renewal_notice_days = 30;
    data.items = data.items.map((item: Record<string, unknown>) => ({
      ...item, evidence_id: `00000000-0000-4000-8000-0000000002${String(data.items.indexOf(item)).padStart(2, "0")}`,
      requirement_version: `${item.kind}-v1`, evidence_ref: `Synthetic ${item.kind}`, accepted_at: at(-10),
      expires_at: item.kind === "license" ? at(12) : null, state: "current", renewal_due: item.kind === "license",
    }));
    await route.fulfill({ response, json: data });
  });
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/admin/applications");
  await page.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Applicant Services" });
  await expect(dialog.getByText("9 of 9 current")).toBeVisible();
  await expect(dialog.getByText("Renewal due", { exact: true })).toHaveCount(1);
  await expect(dialog.getByText("Expires within 30 days.", { exact: false })).toBeVisible();
  await expect(dialog.getByText("it does not change the provider's status or hold payouts, except when payout onboarding lapses", { exact: false })).toBeVisible();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(tags).analyze()).violations).toEqual([]);
});

function vendorNotice(page: Page, items: unknown[]) {
  return page.route("**/rpc/vendor_own_evidence_renewal", route => route.fulfill({
    json: { evaluated_at: evaluated.toISOString(), notice_days: 30, items },
  }));
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`vendor lapsed evidence notice ${theme} ${width}px`, async ({ page }) => {
    await vendorNotice(page, [{ kind: "insurance", expires_at: at(-2.5), state: "lapsed" }, { kind: "license", expires_at: at(9.5), state: "expiring" }]);
    await syntheticSession(page.context(), "vendor");
    await page.addInitScript(value => localStorage.setItem("theme", value), theme);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/vendor/jobs");
    const notice = page.getByRole("region", { name: "Compliance documents have lapsed" });
    await expect(notice).toBeVisible();
    await expect(notice.getByText("Insurance · Lapsed 2 days ago", { exact: false })).toBeVisible();
    await expect(notice.getByText("License · Expires in 10 days", { exact: false })).toBeVisible();
    await expect(notice.getByText("While required evidence has lapsed, Mercurius cannot send you new job requests. Send your renewed documents to Mercurius.")).toBeVisible();
    await expect(notice.getByText("Payouts are held", { exact: false })).toHaveCount(0);
    await expect(notice.getByRole("link", { name: "Contact Mercurius" })).toHaveAttribute("href", "/contact");
    expect((await new AxeBuilder({ page }).include("#main-content > div:first-child").withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/evidence-renewal-vendor-${theme}-${width}.png` });
  });
}

test("vendor notice says payouts are held only for lapsed payout onboarding", async ({ page }) => {
  await vendorNotice(page, [{ kind: "bank_authorization", expires_at: at(-1.5), state: "lapsed" }]);
  await syntheticSession(page.context(), "vendor");
  await page.goto("/vendor/jobs");
  const notice = page.getByRole("region", { name: "Compliance documents have lapsed" });
  await expect(notice.getByText("Payout onboarding · Lapsed 1 day ago", { exact: false })).toBeVisible();
  await expect(notice.getByText("Payouts are held until your payout onboarding is renewed.", { exact: false })).toBeVisible();
});

test("the queue notes the payout hold only for lapsed payout onboarding", async ({ page }) => {
  await queue(page, { entries: [lapsedEntry, { ...lapsedEntry, evidence_id: "00000000-0000-4000-8000-000000000083", kind: "bank_authorization", requirement_version: "payout-v1" }] });
  await openQueue(page, "light", 1440);
  const table = page.getByRole("table", { name: "Evidence needing renewal" });
  await expect(table.getByText("Payouts are held until payout onboarding is renewed.")).toHaveCount(1);
  await expect(page.getByText("it does not suspend them or hold payouts, except lapsed payout onboarding", { exact: false })).toBeVisible();
});

test("vendor expiring notice asks for renewal before the lapse", async ({ page }) => {
  await vendorNotice(page, [{ kind: "license", expires_at: at(20), state: "expiring" }]);
  await syntheticSession(page.context(), "vendor");
  await page.goto("/vendor/jobs");
  const notice = page.getByRole("region", { name: "Compliance documents need renewal" });
  await expect(notice.getByText("Send your renewed documents to Mercurius before they expire to keep receiving new job requests.")).toBeVisible();
});

test("vendors without renewal notices, or whose notice cannot load, see nothing", async ({ page }) => {
  await syntheticSession(page.context(), "vendor");
  await page.goto("/vendor/jobs");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Compliance documents", { exact: false })).toHaveCount(0);
  await vendorNotice(page, []);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Compliance documents", { exact: false })).toHaveCount(0);
});
