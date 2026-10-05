// TRACE-105: the public provider profile shows the provider's own service ZIPs, grouped by
// community from the active coverage allowlist. Synthetic readbacks only.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const contractor = "00000000-0000-4000-8000-000000000075";

async function open(page: Page, zips: string[] | "error", width = 1440) {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  // Later routes take precedence: everything else the page reads is empty.
  await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/pricing_server_now", route => route.fulfill({ json: new Date().toISOString() }));
  await page.route("**/rpc/r0_public_providers", route => route.fulfill({ json: {
    id: contractor, name: "Synthetic Cleaning Co", logo_url: null, bio: "Synthetic description", location: "Lee County, FL",
    badges: [], services: [], years_experience: 5, special_offer: null, our_promise: null, verified_specialty: null,
    tagline: null, video_url: null, website: null,
  } }));
  await page.route("**/rest/v1/coverage_areas?*", route => route.fulfill({ json: [
    { zip_code: "33904", city: "Cape Coral" }, { zip_code: "33909", city: "Cape Coral" }, { zip_code: "33901", city: "Fort Myers" },
  ] }));
  await page.route("**/rest/v1/contractor_service_zips?*", route => zips === "error"
    ? route.fulfill({ status: 500, json: { message: "Synthetic failure" } })
    : route.fulfill({ json: zips.map(zip_code => ({ zip_code })) }));
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/providers/${contractor}`);
  await expect(page.getByRole("heading", { name: "Synthetic Cleaning Co" })).toBeVisible();
}

for (const width of [320, 1440]) {
  test(`service area lists the provider's communities and ZIPs at ${width}px`, async ({ page }) => {
    await open(page, ["33909", "33901", "33904", "34102"], width);
    await expect(page.getByText("Cape Coral", { exact: true })).toBeVisible();
    await expect(page.getByText("33904, 33909", { exact: true })).toBeVisible();
    await expect(page.getByText("Fort Myers", { exact: true })).toBeVisible();
    await expect(page.getByText("3 ZIP codes in Lee County, FL")).toBeVisible();
    await expect(page.getByText("34102")).toHaveCount(0);
    await expect(page.getByText("Coverage is confirmed for your service address.")).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.getByText("3 ZIP codes in Lee County, FL").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/provider-service-area-${width}.png` });
  });
}

test("a provider with no service ZIPs says so", async ({ page }) => {
  await open(page, []);
  await expect(page.getByText("Service area not listed yet")).toBeVisible();
});

test("a failed service-area read does not invent coverage", async ({ page }) => {
  await open(page, "error");
  await expect(page.getByText("Service area unavailable")).toBeVisible();
});
