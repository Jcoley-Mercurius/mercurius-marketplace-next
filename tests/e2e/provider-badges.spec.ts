// CS-2 / TRACE-143 (DEC-2026-058, approved by DEC-2026-060 D-7): the public provider profile never
// shows "Top Rated", and a provider whose only badge is "Top Rated" shows no Credentials section.
// Synthetic readbacks only.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const contractor = "00000000-0000-4000-8000-000000000143";

async function open(page: Page, badges: string[], width: number) {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/pricing_server_now", route => route.fulfill({ json: new Date().toISOString() }));
  await page.route("**/rpc/r0_public_providers", route => route.fulfill({ json: {
    id: contractor, name: "Synthetic Badge Co", logo_url: null, bio: "Synthetic description", location: "Lee County, FL",
    badges, services: [], years_experience: 5, special_offer: null, our_promise: null, verified_specialty: null,
    tagline: null, video_url: null, website: null,
  } }));
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/providers/${contractor}`);
  await expect(page.getByRole("heading", { name: "Synthetic Badge Co" })).toBeVisible();
}

for (const width of [320, 1440]) {
  test(`profile credentials omit Top Rated at ${width}px`, async ({ page }) => {
    await open(page, ["Licensed", "Top Rated", "Insured"], width);
    const credentials = page.getByRole("heading", { name: "Credentials" }).locator("xpath=ancestor::*[self::section or self::div][1]/..");
    await expect(credentials.getByText("Licensed", { exact: true })).toBeVisible();
    await expect(credentials.getByText("Insured", { exact: true })).toBeVisible();
    await expect(page.getByText(/top rated/i)).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

test("a provider whose only badge is Top Rated shows no Credentials section", async ({ page }) => {
  await open(page, ["Top Rated"], 1440);
  await expect(page.getByRole("heading", { name: "Credentials" })).toHaveCount(0);
  await expect(page.getByText(/top rated/i)).toHaveCount(0);
});
