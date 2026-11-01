import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-134 (6.11B) synthetic browser evidence: no Plans or "coming soon" teasers; Special Offer is
// gone from the vendor editor, prompts and public profile (DEC-2026-055 item 1); no legacy promotion
// editor; explicit price states; and an honest, operator-managed service-area readback. Every row
// is a mocked readback; the database contract is SQL 105.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const vendorA = "00000000-0000-4000-8000-000000000c81";
const updatedAt = "2026-10-30T12:00:00+00:00";
const ids = { live: "00000000-0000-4000-8000-000000000c91", paused: "00000000-0000-4000-8000-000000000c92",
  draft: "00000000-0000-4000-8000-000000000c93", review: "00000000-0000-4000-8000-000000000c94", quote: "00000000-0000-4000-8000-000000000c95" };
const row = (id: string, name: string, service: string, extra: Record<string, unknown>) => ({ id, name, description: null, service_id: service,
  pricing_mode: "fixed", default_frequency: "monthly", deposit_amount: null, is_active: true, needs_review: false, template_id: null,
  sort_order: 0, updated_at: updatedAt, first_published_at: updatedAt, ...extra });

async function blockOutside(page: Page) {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
}

// Tables and readbacks the vendor pages read; empty unless a test says otherwise.
async function vendorReads(page: Page) {
  for (const table of ["package_tiers", "package_qualifying_questions", "package_addons", "package_promotions", "pricing_templates", "contractor_gallery"]) {
    await page.route(`**/rest/v1/${table}?*`, route => route.fulfill({ json: [] }));
  }
  for (const rpc of ["vendor_package_approvals", "vendor_promotion_offers", "vendor_my_package_price_corrections", "vendor_package_archives"]) {
    await page.route(`**/rpc/${rpc}`, route => route.fulfill({ json: [] }));
  }
  await page.route("**/rpc/pricing_server_now", route => route.fulfill({ json: new Date().toISOString() }));
  await page.route("**/rpc/get_contractor_contact", route => route.fulfill({ json: [{ email: "vendor@example.invalid", phone: "555-0100" }] }));
}

test("the vendor portal has no Plans link, the old Plans address goes to the overview, and Marketing has no teasers", async ({ page }) => {
  await blockOutside(page);
  await vendorReads(page);
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: vendorA, name: "Synthetic Lawn Co", is_active: true } }));
  await syntheticSession(page.context(), "vendor");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/vendor/marketing");
  const nav = page.getByRole("navigation", { name: "vendor navigation" });
  await expect(nav.getByRole("link", { name: "Marketing Tools" })).toBeVisible();
  await expect(nav.getByRole("link", { name: /Plans/ })).toHaveCount(0);
  await expect(page.getByText("Coming after soft launch")).toHaveCount(0);
  await expect(page.getByText(/paid upgrade/i)).toHaveCount(0);
  await page.goto("/vendor/plan");
  await expect(page).toHaveURL(/\/vendor$/);
});

test("prices read Live, Paused, Draft, Needs review and their type; listed services read Fixed price, Custom Quote or Not priced yet", async ({ page }) => {
  await blockOutside(page);
  await vendorReads(page);
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: vendorA, services: ["synthetic-lawn", "synthetic-pool", "synthetic-roof", "synthetic-tree"] } }));
  await page.route("**/rest/v1/services_catalog?*", route => route.fulfill({ json: ["lawn", "pool", "roof", "tree"].map(name => ({
    id: `synthetic-${name}`, name: `Synthetic ${name}`, default_frequency: "monthly", available_frequencies: ["monthly"], weekly_price: null, monthly_price: 60, one_time_price: 90 })) }));
  await page.route("**/rest/v1/vendor_packages?*", route => route.fulfill({ json: [
    row(ids.live, "Synthetic live lawn", "synthetic-lawn", {}),
    row(ids.paused, "Synthetic paused pool", "synthetic-pool", { is_active: false }),
    row(ids.draft, "Synthetic draft pool", "synthetic-pool", { is_active: false, first_published_at: null, sort_order: 1 }),
    row(ids.review, "Synthetic review lawn", "synthetic-lawn", { needs_review: true, sort_order: 2 }),
    row(ids.quote, "Synthetic roof quote", "synthetic-roof", { pricing_mode: "custom_quote" }),
  ] }));
  await page.route("**/rest/v1/package_tiers?*", route => route.fulfill({ json: [ids.live, ids.paused, ids.draft, ids.review].map((id, index) => ({
    id: `00000000-0000-4000-8000-00000000c1a${index}`, package_id: id, name: "Monthly", price: id === ids.review ? 900 : 55, frequency: "monthly", includes: [], sort_order: 0 })) }));
  await page.route("**/rpc/vendor_package_revisions", route => route.fulfill({ json: Object.values(ids).map(id => ({ package_id: id, package_revision: "a".repeat(64), in_use: false, is_head: true })) }));
  await page.route("**/rpc/vendor_package_archives", route => route.fulfill({ json: [] }));
  await syntheticSession(page.context(), "vendor");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/vendor/packages");
  const card = (name: string) => page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card("Synthetic live lawn").getByText("Live", { exact: true }).first()).toBeVisible();
  await expect(card("Synthetic live lawn").getByText("Fixed price", { exact: true })).toBeVisible();
  await expect(card("Synthetic paused pool").getByText("Paused", { exact: true }).first()).toBeVisible();
  await expect(card("Synthetic draft pool").getByText("Draft", { exact: true }).first()).toBeVisible();
  await expect(card("Synthetic review lawn").getByText("Needs review", { exact: true }).first()).toBeVisible();
  await expect(card("Synthetic roof quote").getByText("Custom Quote", { exact: true })).toBeVisible();
  await expect(page.getByText("Fixed price · Live")).toBeVisible();
  await expect(page.getByText("Custom Quote · Live")).toBeVisible();
  await expect(page.getByText("Not priced yet", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /promotion/i })).toHaveCount(0);
  await expect(page.getByText("Published before; out of public booking").locator("xpath=preceding-sibling::p[1]")).toHaveText("1");
  await expect(page.getByText("Never published").locator("xpath=preceding-sibling::p[1]")).toHaveText("1");
  expect((await new AxeBuilder({ page }).include("article").withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

for (const width of [320, 1440]) {
  test(`the vendor profile has no Special Offer, scores out of 95 and reads back its operator-set service area at ${width}px`, async ({ page }) => {
    await blockOutside(page);
  await vendorReads(page);
    await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: vendorA, name: "Synthetic Lawn Co", logo_url: null, bio: "Synthetic bio",
      location: "Fort Myers", services: ["synthetic-lawn"], years_experience: 4, our_promise: null, verified_specialty: null, is_active: true, marketing_enabled: true } }));
    await page.route("**/rpc/get_contractor_contact", route => route.fulfill({ json: [{ email: "vendor@example.invalid", phone: "555-0100" }] }));
    await page.route("**/rest/v1/contractor_service_zips?*", route => route.fulfill({ json: [{ zip_code: "33901" }, { zip_code: "33999" }] }));
    await page.route("**/rest/v1/coverage_areas?*", route => route.fulfill({ json: [{ zip_code: "33901", city: "Fort Myers" }] }));
    await syntheticSession(page.context(), "vendor");
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/vendor/profile");
    await expect(page.getByText("out of 95")).toBeVisible();
    await expect(page.getByLabel("Special Offer")).toHaveCount(0);
    await expect(page.getByText(/special offer/i)).toHaveCount(0);
    const area = page.getByRole("region", { name: "Service area" });
    await expect(area.getByText("Fort Myers")).toBeVisible();
    await expect(area.getByText("· 33901")).toBeVisible();
    await expect(area.getByText("Outside current coverage")).toBeVisible();
    await expect(area.getByText("33999")).toBeVisible();
    await expect(area.getByRole("link", { name: "Ask Mercurius to change your service area" })).toHaveAttribute("href", "/vendor/support");
    await expect(area.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByText("Saving your profile does not publish prices, change your visibility or turn Marketing on or off.")).toBeVisible();
    expect((await new AxeBuilder({ page }).include("[aria-labelledby=vendor-service-area]").withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

test("a service-area failure is explained with a retry", async ({ page }) => {
  await blockOutside(page);
  await vendorReads(page);
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: vendorA, name: "Synthetic Lawn Co", logo_url: null, bio: null,
    location: "Fort Myers", services: [], years_experience: null, our_promise: null, verified_specialty: null, is_active: true, marketing_enabled: true } }));
  await page.route("**/rest/v1/contractor_service_zips?*", route => route.fulfill({ status: 500, json: { message: "Synthetic failure" } }));
  await page.route("**/rest/v1/coverage_areas?*", route => route.fulfill({ json: [{ zip_code: "33901", city: "Fort Myers" }] }));
  await syntheticSession(page.context(), "vendor");
  await page.goto("/vendor/profile");
  const area = page.getByRole("region", { name: "Service area" });
  await expect(area.getByRole("alert")).toContainText("Your service area couldn’t be loaded.");
  await expect(area.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("the public profile shows offered services and no Current Offer, whatever the record stores", async ({ page }) => {
  const contractor = "00000000-0000-4000-8000-000000000c99";
  await blockOutside(page);
  // Later routes take precedence: everything else the public page reads is empty.
  await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/pricing_server_now", route => route.fulfill({ json: new Date().toISOString() }));
  await page.route("**/rpc/r0_public_providers", route => route.fulfill({ json: {
    id: contractor, name: "Synthetic Offer Co", logo_url: null, bio: "Synthetic description", location: "Lee County, FL",
    badges: [], services: ["synthetic-lawn"], years_experience: 5, special_offer: "Synthetic 20% off", our_promise: null, verified_specialty: null,
    tagline: null, video_url: null, website: null } }));
  await page.route("**/rest/v1/services_catalog?*", route => route.fulfill({ json: [{ id: "synthetic-lawn", name: "Synthetic lawn care" }] }));
  for (const table of ["contractor_service_zips", "coverage_areas", "contractor_gallery"]) await page.route(`**/rest/v1/${table}?*`, route => route.fulfill({ json: [] }));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/providers/${contractor}`);
  await expect(page.getByRole("heading", { name: "Synthetic Offer Co" })).toBeVisible();
  await expect(page.getByText("Synthetic lawn care")).toBeVisible();
  await expect(page.getByText("Current Offer")).toHaveCount(0);
  await expect(page.getByText("Synthetic 20% off")).toHaveCount(0);
});
