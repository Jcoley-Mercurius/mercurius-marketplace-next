import { test, expect, type Page, type Request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-134 (6.11A) synthetic browser evidence: both vendor price editors save through one keyed,
// stale-guarded command (vendor_save_package) and publish/pause through vendor_set_package_active.
// No editor writes a package, level, add-on or question table directly. The database contract is
// SQL 104 and scripts/vendor-offerings-concurrency.mjs; every row here is a mocked readback.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const vendorA = "00000000-0000-4000-8000-000000000b81";
const livePkg = "00000000-0000-4000-8000-000000000b83";
const oldPkg = "00000000-0000-4000-8000-000000000b84";
const managedPkg = "00000000-0000-4000-8000-000000000b85";
const template = "00000000-0000-4000-8000-000000000b86";
const templateTier = "00000000-0000-4000-8000-000000000b87";
const updatedAt = "2026-10-30T12:00:00+00:00";
const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, description: null, service_id: "synthetic-lawn",
  pricing_mode: "fixed", default_frequency: "monthly", deposit_amount: null, is_active: true, needs_review: false, template_id: null,
  sort_order: 0, updated_at: updatedAt, ...extra });

function directWrites(page: Page) {
  const writes: string[] = [];
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (request.method() !== "GET" && /\/rest\/v1\/(vendor_packages|package_tiers|package_addons|package_qualifying_questions)/.test(url.pathname)) {
      writes.push(`${request.method()} ${url.pathname}`);
    }
  });
  return writes;
}

async function vendorPrices(page: Page) {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: vendorA, services: ["synthetic-lawn"] } }));
  await page.route("**/rest/v1/services_catalog?*", route => route.fulfill({ json: [{ id: "synthetic-lawn", name: "Lawn care", default_frequency: "monthly",
    available_frequencies: ["monthly"], weekly_price: null, monthly_price: 60, one_time_price: 90 }] }));
  await page.route("**/rest/v1/vendor_packages?*", route => route.fulfill({ json: [row(livePkg, "Synthetic lawn plan"),
    row(oldPkg, "Synthetic lawn plan", { is_active: false })] }));
  await page.route("**/rest/v1/package_tiers?*", route => route.fulfill({ json: [
    { id: "00000000-0000-4000-8000-000000000b91", package_id: livePkg, name: "Monthly", price: 55, frequency: "monthly", includes: [], sort_order: 0 },
    { id: "00000000-0000-4000-8000-000000000b92", package_id: oldPkg, name: "Monthly", price: 50, frequency: "monthly", includes: [], sort_order: 0 }] }));
  await page.route("**/rest/v1/package_qualifying_questions?*", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/package_addons?*", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/package_promotions?*", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/pricing_templates?*", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/pricing_server_now", route => route.fulfill({ json: new Date().toISOString() }));
  await page.route("**/rpc/vendor_package_approvals", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/vendor_promotion_offers", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/vendor_my_package_price_corrections", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/vendor_package_archives", route => route.fulfill({ json: [] }));
  // The old version is a superseded revision that requests still use: history, not listed.
  await page.route("**/rpc/vendor_package_revisions", route => route.fulfill({ json: [
    { package_id: livePkg, package_revision: "b".repeat(64), in_use: false, is_head: true },
    { package_id: oldPkg, package_revision: "c".repeat(64), in_use: true, is_head: false }] }));
  await syntheticSession(page.context(), "vendor");
}

test("a live price is saved in one keyed call against the version read, with no direct table writes", async ({ page }) => {
  await vendorPrices(page);
  const writes = directWrites(page);
  const saved: Record<string, unknown>[] = [];
  await page.route("**/rpc/vendor_save_package", route => { saved.push(route.request().postDataJSON());
    return route.fulfill({ json: { package_id: "00000000-0000-4000-8000-000000000b99", lineage_id: livePkg, revision_number: 2, new_version: true,
      replaced_package_id: livePkg, is_active: true, needs_review: false, updated_at: updatedAt, package_revision: "d".repeat(64), reused: false } }); });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/vendor/packages");
  await expect(page.getByRole("button", { name: "Edit Synthetic lawn plan" })).toHaveCount(1);
  await page.getByRole("button", { name: "Edit Synthetic lawn plan" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Monthly customer price").fill("65");
  await dialog.getByRole("button", { name: "Publish & finish" }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ p_package: livePkg, p_expected_revision: "b".repeat(64), p_publish: true,
    p_content: { service_id: "synthetic-lawn", package: { name: "Synthetic lawn plan", pricing_mode: "fixed", default_frequency: "monthly" },
      tiers: [{ name: "Monthly", price: 65, frequency: "monthly" }] } });
  expect(String(saved[0].p_save_key)).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  expect(writes).toEqual([]);
});

test("a stale save is explained with a reload and changes no public price", async ({ page }) => {
  await vendorPrices(page);
  await page.route("**/rpc/vendor_save_package", route => route.fulfill({ status: 400,
    json: { code: "40001", message: "A newer version of this price was saved; reload before saving", details: null, hint: null } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/vendor/packages");
  await page.getByRole("button", { name: "Edit Synthetic lawn plan" }).click();
  await page.getByRole("dialog").getByLabel("Monthly customer price").fill("66");
  await page.getByRole("dialog").getByRole("button", { name: "Publish & finish" }).click();
  await expect(page.getByText("This price changed", { exact: true })).toBeVisible();
  await expect(page.getByText(/Reload to see the current version, then save again/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("pausing goes through the publish/pause command with the row read", async ({ page }) => {
  await vendorPrices(page);
  const writes = directWrites(page);
  const toggled: Record<string, unknown>[] = [];
  await page.route("**/rpc/vendor_set_package_active", route => { toggled.push(route.request().postDataJSON());
    return route.fulfill({ json: { package_id: livePkg, is_active: false, updated_at: updatedAt, changed: true } }); });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/vendor/packages");
  await page.getByRole("switch", { name: /^Pause Synthetic lawn plan/ }).click();
  await expect.poll(() => toggled.length).toBe(1);
  expect(toggled[0]).toEqual({ p_package: livePkg, p_active: false, p_expected_updated_at: updatedAt });
  expect(writes).toEqual([]);
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("Managed Pricing saves its template levels in one keyed call", async ({ page }) => {
  await vendorPrices(page);
  const writes = directWrites(page);
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: vendorA } }));
  await page.route("**/rest/v1/pricing_templates?*", route => route.fulfill({ json: [{ id: template, service_id: "synthetic-lawn", name: "Synthetic template", description: null, is_active: true }] }));
  await page.route("**/rest/v1/pricing_template_questions?*", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/pricing_template_tiers?*", route => route.fulfill({ json: [{ id: templateTier, template_id: template, name: "Standard",
    description: null, min_price: 50, max_price: 150, suggested_price: 100, includes: [], sort_order: 0 }] }));
  await page.route("**/rest/v1/pricing_template_addons?*", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/vendor_packages?*", route => route.fulfill({ json: [{ id: managedPkg, name: "Lawn care — Managed Pricing", description: null,
    template_id: template, is_active: true, needs_review: false, updated_at: updatedAt, lineage_id: managedPkg, revision_number: 1 }] }));
  await page.route("**/rest/v1/package_tiers?*", route => route.fulfill({ json: [{ package_id: managedPkg, template_tier_id: templateTier, price: 100 }] }));
  await page.route("**/rpc/vendor_package_revisions", route => route.fulfill({ json: [{ package_id: managedPkg, package_revision: "e".repeat(64), in_use: true, is_head: true }] }));
  const saved: Record<string, unknown>[] = [];
  await page.route("**/rpc/vendor_save_package", route => { saved.push(route.request().postDataJSON());
    return route.fulfill({ json: { package_id: "00000000-0000-4000-8000-000000000b98", lineage_id: managedPkg, revision_number: 2, new_version: true,
      replaced_package_id: managedPkg, is_active: true, needs_review: false, updated_at: updatedAt, package_revision: "f".repeat(64), reused: false } }); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/vendor/pricing");
  await page.getByLabel("Price ($)").fill("120");
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0]).toMatchObject({ p_package: managedPkg, p_expected_revision: "e".repeat(64), p_publish: true,
    p_content: { template_id: template, tiers: [{ template_tier_id: templateTier, price: 120, frequency: "one-time" }] } });
  await expect(page.getByText("Prices saved")).toBeVisible();
  expect(writes).toEqual([]);
});
