// TRACE-105: the public provider profile shows the provider's own service ZIPs on a drawn
// Lee County map, with the list grouped by community from the active coverage allowlist
// behind a disclosure. Synthetic readbacks only.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";

const contractor = "00000000-0000-4000-8000-000000000075";

const coverage = [
  { zip_code: "33904", city: "Cape Coral" }, { zip_code: "33909", city: "Cape Coral" }, { zip_code: "33901", city: "Fort Myers" },
];

async function open(page: Page, zips: string[] | "error", width = 1440, areas = coverage) {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  // Later routes take precedence: everything else the page reads is empty.
  await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/pricing_server_now", route => route.fulfill({ json: new Date().toISOString() }));
  await page.route("**/rpc/r0_public_providers", route => route.fulfill({ json: {
    id: contractor, name: "Synthetic Cleaning Co", logo_url: null, bio: "Synthetic description", location: "Lee County, FL",
    badges: [], services: [], years_experience: 5, special_offer: null, our_promise: null, verified_specialty: null,
    tagline: null, video_url: null, website: null,
  } }));
  await page.route("**/rest/v1/coverage_areas?*", route => route.fulfill({ json: areas }));
  await page.route("**/rest/v1/contractor_service_zips?*", route => zips === "error"
    ? route.fulfill({ status: 500, json: { message: "Synthetic failure" } })
    : route.fulfill({ json: zips.map(zip_code => ({ zip_code })) }));
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/providers/${contractor}`);
  await expect(page.getByRole("heading", { name: "Synthetic Cleaning Co" })).toBeVisible();
}

for (const width of [320, 1440]) {
  test(`service area maps and lists the provider's communities and ZIPs at ${width}px`, async ({ page }) => {
    await open(page, ["33909", "33901", "33904", "34102"], width);
    const map = page.getByRole("img", { name: /Map of Lee County, Florida/ });
    await expect(map).toBeVisible();
    await expect(map.locator("path[data-served]")).toHaveCount(3);
    for (const zip of ["33901", "33904", "33909"]) await expect(map.locator(`path[data-zip="${zip}"]`)).toHaveAttribute("data-served", "true");
    await expect(map.locator('path[data-zip="33905"]')).not.toHaveAttribute("data-served");
    await expect(page.getByText("3 ZIP codes in Lee County, FL")).toBeVisible();

    const list = page.locator("details").filter({ hasText: "See ZIP codes by community" });
    await expect(list.getByText("33904, 33909", { exact: true })).toBeHidden();
    await list.getByText("See ZIP codes by community").click();
    await expect(list.getByText("Cape Coral", { exact: true })).toBeVisible();
    await expect(list.getByText("33904, 33909", { exact: true })).toBeVisible();
    await expect(list.getByText("Fort Myers", { exact: true })).toBeVisible();
    await expect(page.getByText("34102")).toHaveCount(0);
    await expect(page.getByText("Coverage is confirmed for your service address.")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await map.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/provider-service-area-${width}.png` });
  });
}

const allowlist = [...readFileSync("supabase/migrations/20260927010000_cfg001_lee_county_coverage.sql", "utf8")
  .matchAll(/\('(\d{5})', '([^']+)', 'FL'/g)].map(([, zip_code, city]) => ({ zip_code, city }));

for (const width of [320, 1440]) {
  test(`a provider serving most of the county reads as broad coverage at ${width}px`, async ({ page }) => {
    const zips = allowlist.map(area => area.zip_code).filter(zip => !["33921", "33924", "33957"].includes(zip));
    await open(page, zips, width, allowlist);
    const map = page.getByRole("img", { name: /Map of Lee County, Florida/ });
    await expect(map.locator('path[data-zip="33957"]')).not.toHaveAttribute("data-served");
    await expect(map.locator('path[data-zip="33936"]')).toHaveAttribute("data-served", "true");
    await expect(page.getByText(`${zips.length} ZIP codes in Lee County, FL`)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await map.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/provider-service-area-broad-${width}.png` });
  });
}

test("a provider serving only PO-box ZIPs gets the list without an empty map", async ({ page }) => {
  await open(page, ["33902"], 1440, [{ zip_code: "33902", city: "Fort Myers" }]);
  await expect(page.getByText("1 ZIP code in Lee County, FL")).toBeVisible();
  await expect(page.getByRole("img", { name: /Map of Lee County, Florida/ })).toHaveCount(0);
});

test("a provider with no service ZIPs says so", async ({ page }) => {
  await open(page, []);
  await expect(page.getByText("Service area not listed yet")).toBeVisible();
  await expect(page.getByText("This provider has not listed its service ZIP codes.")).toBeVisible();
});

for (const width of [320, 1440]) {
  test(`a provider whose service ZIPs are all outside current coverage says so at ${width}px`, async ({ page }) => {
    await open(page, ["34102"], width);
    await expect(page.getByText("No service ZIP codes in current coverage")).toBeVisible();
    await expect(page.getByText("This provider's listed ZIP codes are outside Mercurius's current service area.")).toBeVisible();
    await expect(page.getByText("Service area not listed yet")).toHaveCount(0);
    await expect(page.getByText("34102")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

test("a failed service-area read does not invent coverage", async ({ page }) => {
  await open(page, "error");
  await expect(page.getByText("Service area unavailable")).toBeVisible();
  await expect(page.getByText("Please refresh to try again.")).toBeVisible();
});
