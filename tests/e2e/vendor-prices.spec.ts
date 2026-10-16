import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-109 (DEC-2026-034) synthetic browser evidence. Package rows and the correction
// command are mocked readbacks and requests; nothing here claims a real vendor or price.
// The database contract is SQL 079.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const vendorA = "00000000-0000-4000-8000-000000000081";
const vendorB = "00000000-0000-4000-8000-000000000082";
const fixedPkg = "00000000-0000-4000-8000-000000000083";
const depositPkg = "00000000-0000-4000-8000-000000000084";
const updatedAt = "2026-10-15T12:00:00+00:00";

const packages = [
  { id: fixedPkg, contractor_id: vendorA, service_id: "synthetic-lawn", template_id: null, name: "Synthetic lawn package", pricing_mode: "fixed",
    deposit_amount: null, is_active: true, needs_review: true, updated_at: updatedAt, sort_order: 0 },
  { id: depositPkg, contractor_id: vendorB, service_id: "synthetic-roof", template_id: null, name: "Synthetic roof quote", pricing_mode: "deposit_quote",
    deposit_amount: 50, is_active: false, needs_review: false, updated_at: updatedAt, sort_order: 0 },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.route("**/rest/v1/vendor_packages?*", route => route.fulfill({ json: packages }));
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: [{ id: vendorA, name: "Synthetic Lawn Co" }, { id: vendorB, name: "Synthetic Roof Co" }] }));
  await page.route("**/rest/v1/services_catalog?*", route => route.fulfill({ json: [{ id: "synthetic-lawn", name: "Lawn care" }, { id: "synthetic-roof", name: "Roof repair" }] }));
  await page.route("**/rest/v1/package_tiers?*", route => route.fulfill({ json: [
    { id: "00000000-0000-4000-8000-000000000085", package_id: fixedPkg, name: "Basic", price: 1000, frequency: "one-time", sort_order: 0 },
  ] }));
  await page.route("**/rest/v1/package_addons?*", route => route.fulfill({ json: [
    { id: "00000000-0000-4000-8000-000000000086", package_id: fixedPkg, template_addon_id: null, name: "Edging", price: 25, is_offered: true, sort_order: 0 },
  ] }));
  await page.route("**/rest/v1/pricing_template_addons?*", route => route.fulfill({ json: [] }));
});

async function openPrices(page: Page, theme = "light", width = 1440) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/vendor-prices");
  await expect(page.getByRole("heading", { level: 1, name: "Vendor Prices" })).toBeVisible();
}

const list = (page: Page) =>
  page.viewportSize()!.width < 1280 ? page.getByRole("list", { name: "Vendor packages", exact: true }) : page.getByRole("table", { name: "Vendor packages", exact: true });

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`vendor prices ${theme} ${width}px`, async ({ page }) => {
    await openPrices(page, theme, width);
    await expect(page.getByText("2 packages · 1 need review")).toBeVisible();
    const rows = list(page);
    await expect(rows.getByRole("link", { name: "Synthetic Lawn Co" })).toHaveAttribute("href", `/admin/vendors/${vendorA}`);
    await expect(rows.getByText("$1,000")).toBeVisible();
    await expect(rows.getByText("Deposit", { exact: true })).toBeVisible();
    await expect(rows.getByText("Needs review")).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("combobox", { name: "Filter packages by status" }).selectOption("review");
    await expect(rows.getByRole("link", { name: "Synthetic Roof Co" })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Filter packages by status" }).selectOption("all");
    await page.getByRole("textbox", { name: "Search vendor prices" }).fill("roof");
    await expect(rows.getByRole("link", { name: "Synthetic Lawn Co" })).toHaveCount(0);
    await expect(rows.getByRole("link", { name: "Synthetic Roof Co" })).toBeVisible();
  });
}

test("correct prices sends only changes with the read values and a reason", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/rpc/admin_correct_package_prices", route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { changed: 1, needs_review: false, updated_at: "2026-10-15T13:00:00+00:00", vendor_notified: true } });
  });
  await openPrices(page);
  await list(page).getByRole("button", { name: "Correct prices" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Correct prices" });
  await expect(dialog.getByText("Synthetic Lawn Co · Synthetic lawn package", { exact: false })).toBeVisible();

  await dialog.getByRole("textbox", { name: "Basic (One-time)" }).fill("12.345");
  await dialog.getByRole("button", { name: "Save corrected prices" }).click();
  await expect(dialog.getByRole("alert").first()).toContainText("positive dollar amount");
  expect(sent).toHaveLength(0);

  await dialog.getByRole("textbox", { name: "Basic (One-time)" }).fill("120");
  await dialog.getByRole("button", { name: "Save corrected prices" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter the reason. The vendor will see it.");
  expect(sent).toHaveLength(0);

  await dialog.getByRole("textbox", { name: "Reason (required)" }).fill("Synthetic: $1,000 was a typo for $120");
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(tags).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Save corrected prices" }).click();
  await expect(page.getByText("1 price corrected")).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([{
    p_package: fixedPkg, p_expected_updated_at: updatedAt, p_reason: "Synthetic: $1,000 was a typo for $120",
    p_prices: { tiers: [{ id: "00000000-0000-4000-8000-000000000085", from: 1000, price: 120 }], addons: [] },
  }]);
});

test("a stale read is refused and explained without closing the dialog", async ({ page }) => {
  await page.route("**/rpc/admin_correct_package_prices", route => route.fulfill({ status: 400,
    json: { code: "40001", message: "Package changed since it was read; reload before correcting prices" } }));
  await openPrices(page);
  await list(page).getByRole("button", { name: "Correct prices" }).nth(1).click();
  const dialog = page.getByRole("dialog", { name: "Correct prices" });
  await dialog.getByRole("textbox", { name: "Deposit" }).fill("40");
  await dialog.getByRole("textbox", { name: "Reason (required)" }).fill("Synthetic deposit correction");
  await dialog.getByRole("button", { name: "Save corrected prices" }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed since you opened it");
  await expect(dialog).toBeVisible();
});

test("the vendor sees what Mercurius changed and why", async ({ page }) => {
  await page.route("**/rpc/vendor_my_package_price_corrections", route => route.fulfill({ json: [
    { id: 1, package_id: fixedPkg, package_name: "Synthetic lawn package", reason: "Synthetic: matched the market rate",
      created_at: "2026-10-15T13:00:00+00:00", changes: [{ kind: "tier", name: "Basic", frequency: "one-time", from: 1000, to: 120 }] },
  ] }));
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: vendorA } }));
  await syntheticSession(page.context(), "vendor");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/vendor/pricing");
  const panel = page.getByRole("region", { name: "Price changes by Mercurius" });
  await expect(panel.getByText("Basic: $1,000 → $120")).toBeVisible();
  await expect(panel.getByText("Synthetic: matched the market rate")).toBeVisible();
  await expect(panel.getByText("Oct 15, 2026, 9:00 AM Eastern")).toBeVisible();
  expect((await new AxeBuilder({ page }).include("section[aria-labelledby=vendor-price-corrections]").withTags(tags).analyze()).violations).toEqual([]);
});

test("package reviews offers a price correction next to approval", async ({ page }) => {
  await page.route("**/rest/v1/pricing_templates?*", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/pricing_template_tiers?*", route => route.fulfill({ json: [] }));
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/admin/pricing-reviews");
  await expect(page.getByRole("heading", { level: 2, name: "Synthetic lawn package" })).toBeVisible();
  await page.getByRole("button", { name: "Correct prices" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Correct prices" });
  await expect(dialog.getByRole("textbox", { name: "Basic (One-time)" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: /Edging/ })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(tags).analyze()).violations).toEqual([]);
});
