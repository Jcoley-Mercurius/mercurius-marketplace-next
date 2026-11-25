import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";

// TRACE-161 synthetic browser evidence for the /services redesign. The page's server read gets the
// synthetic catalog from tests/fixtures/portal-server.mjs; the browser catalog read (names,
// packages, tiers, listing) is mocked here. No production data.
const app = "http://127.0.0.1:3103";
const supabase = "http://127.0.0.1:55831";
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const fixture = JSON.parse(readFileSync(new URL("../fixtures/services-public-catalog.json", import.meta.url), "utf8")) as {
  categories: { id: string; name: string }[];
  services: { id: string; name: string; category_id: string; icon: string; descriptor: string }[];
};
const provider = "00000000-0000-4000-8000-0000000000a1";
// The browser read sees the same catalog with reference fields, a fixed-price pool package and a
// quote-only handyman package from one listed provider.
const services = fixture.services.map((service) => ({
  ...service, tags: [], is_popular: false, weekly_price: null, monthly_price: 0, one_time_price: 0,
  default_frequency: service.id === "pool-service" ? "weekly" : "one-time", available_frequencies: ["one-time"],
}));
const contractor = { id: provider, name: "Synthetic Pools", logo_url: null, marketing_enabled: false, is_active: true };
const packages = [
  { id: "00000000-0000-4000-8000-0000000000b1", contractor_id: provider, service_id: "pool-service", name: "Weekly pool care", description: null,
    default_frequency: "weekly", pricing_mode: "fixed", deposit_amount: null, is_active: true, needs_review: false, contractors: contractor },
  { id: "00000000-0000-4000-8000-0000000000b2", contractor_id: provider, service_id: "handyman", name: "Handyman visit", description: null,
    default_frequency: "one-time", pricing_mode: "custom_quote", deposit_amount: null, is_active: true, needs_review: false, contractors: contractor },
];
const tiers = [{ id: "00000000-0000-4000-8000-0000000000c1", package_id: packages[0].id, name: "Standard", price: 140, frequency: "weekly", includes: ["Skim and brush"] }];

type Setup = { width: number; height?: number; packagesFail?: (attempt: number) => boolean };

async function open(page: Page, setup: Setup) {
  let packageReads = 0;
  await page.setViewportSize({ width: setup.width, height: setup.height ?? 900 });
  await page.route("**/*", async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.origin === app) return url.pathname.startsWith("/api/") ? route.abort() : route.continue();
    if (url.origin !== supabase) return route.abort();
    if (url.pathname === "/rest/v1/service_categories") return route.fulfill({ json: fixture.categories });
    if (url.pathname === "/rest/v1/services_catalog") return route.fulfill({ json: services });
    if (url.pathname === "/rest/v1/vendor_packages") {
      packageReads += 1;
      if (setup.packagesFail?.(packageReads)) return route.fulfill({ status: 500, json: { message: "Synthetic outage" } });
      return route.fulfill({ json: packages });
    }
    if (url.pathname === "/rest/v1/package_tiers") return route.fulfill({ json: tiers });
    if (url.pathname === "/rest/v1/package_qualifying_questions") return route.fulfill({ json: [] });
    if (url.pathname === "/rest/v1/rpc/pricing_server_now") return route.fulfill({ json: "2026-11-24T12:00:00Z" });
    if (url.pathname === "/rest/v1/rpc/r0_public_providers") return route.fulfill({ json: [{ id: provider }] });
    return route.continue();
  });
  await page.goto("/services");
  await expect(page.getByRole("heading", { level: 1, name: "Explore home services in Lee County" })).toBeVisible();
}

const catalog = (page: Page) => page.getByRole("region", { name: "All home services" });
const row = (page: Page, id: string) => page.locator(`[data-service-row="${id}"]`);

const escaped = (value: string) => value.replaceAll("&", "&amp;");
/** The opening tag of the first <a> carrying this attribute, whatever the attribute order. */
const anchor = (html: string, attribute: string) => html.match(new RegExp(`<a\\s[^>]*${attribute}[^>]*>`))?.[0] ?? "";

async function expectAccessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

async function layoutShift(page: Page) {
  return page.evaluate(() => new Promise<number>((resolve) => {
    let total = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
        if (!entry.hadRecentInput) total += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    setTimeout(() => resolve(total), 750);
  }));
}

async function expectAllPhotosLoaded(page: Page) {
  await page.locator("img").evaluateAll((images) => Promise.all(images.map((image) => {
    (image as HTMLImageElement).loading = "eager";
    return (image as HTMLImageElement).decode().catch(() => undefined);
  })));
  const broken = await page.locator("main img").evaluateAll((images) => images
    .filter((image) => !(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0)
    .map((image) => (image as HTMLImageElement).currentSrc));
  expect(broken).toEqual([]);
}

test.describe("initial HTML", () => {
  test("carries one H1, the metadata, the featured links and the server catalog", async ({ request }) => {
    const response = await request.get("/services");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain("<title>Home services in Lee County | Mercurius Marketplace</title>");
    expect(html).toContain('name="description" content="Browse local home services in Lee County, Florida, and see package pricing where available. Booking opens by invitation."');
    expect(html).not.toMatch(/rel="canonical"/);
    for (const heading of ["Featured services", "All home services", "Want to know when booking opens?"]) expect(html).toContain(heading);
    for (const id of ["lawn-mowing", "house-cleaning", "pool-service", "handyman"]) {
      expect(anchor(html, `data-featured-service="${id}"`)).toContain(`href="/early-access?service=${id}"`);
    }
    // Every catalog service's name, description and link is in the HTML before any script runs.
    for (const service of fixture.services) {
      expect(html).toContain(`data-service-row="${service.id}"`);
      expect(html).toContain(`href="/early-access?service=${service.id}"`);
      expect(html).toContain(escaped(service.name));
      if (service.descriptor) expect(html).toContain(escaped(service.descriptor));
    }
    expect(html).toContain("Representative photos");
    expect(html).not.toMatch(/href="\/request/);
  });
});

for (const viewport of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  test.describe(`${viewport.name} ${viewport.width}px`, () => {
    test("the hero, featured cards and catalog render without shift or overflow, and pass axe", async ({ page }) => {
      await open(page, viewport);
      const join = page.getByRole("main").getByRole("link", { name: "Join early access" }).first();
      const browse = page.getByRole("link", { name: "Browse all services" });
      await expect(join).toHaveAttribute("href", "/early-access");
      await expect(browse).toHaveAttribute("href", "#all-services");
      // Both actions and the featured heading are on the first screen.
      for (const target of [join, browse, page.getByRole("heading", { name: "Featured services" })]) {
        const box = (await target.boundingBox())!;
        expect(box.y + Math.min(box.height, 40)).toBeLessThanOrEqual(viewport.height);
      }
      const cards = page.locator("[data-featured-service]");
      await expect(cards).toHaveCount(4);
      const boxes = await Promise.all([0, 1, 2, 3].map(async (index) => (await cards.nth(index).boundingBox())!));
      const columns = new Set(boxes.map((box) => Math.round(box.x))).size;
      expect(columns).toBe(viewport.width >= 1024 ? 4 : 2);
      // Equal card widths and equal 3:2 photo boxes.
      expect(new Set(boxes.map((box) => Math.round(box.width))).size).toBe(1);
      for (const image of await page.locator("[data-featured-service] img").all()) {
        await expect(image).toHaveAttribute("alt", "");
        const box = (await image.boundingBox())!;
        expect(Math.abs(box.width / box.height - 1.5)).toBeLessThan(0.02);
      }
      await expect(row(page, "pool-service")).toContainText("Package pricing from $140/weekly visit");
      await expect(row(page, "handyman")).toContainText("Quote available");
      await expect(row(page, "lawn-mowing")).toContainText("Not available yet in your area");
      await expect(catalog(page).getByText("Showing 6 services · 2 with live provider coverage")).toBeVisible();
      expect(await layoutShift(page)).toBeLessThan(0.05);
      await expectAllPhotosLoaded(page);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
    });

    test("a homeowner jumps to the full catalog and applies a filter", async ({ page }) => {
      await open(page, viewport);
      await page.getByRole("link", { name: "Browse all services" }).click();
      await expect(page).toHaveURL(/\/services#all-services$/);
      const heading = page.getByRole("heading", { level: 2, name: "All home services" });
      await expect(heading).toBeInViewport();
      // The heading clears the sticky header.
      await expect.poll(async () => {
        const header = (await page.getByRole("banner").boundingBox())!;
        return (await heading.boundingBox())!.y - (header.y + header.height);
      }).toBeGreaterThanOrEqual(8);
      // Keyboard focus continues from the catalog, starting with the filters.
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "All services" })).toBeFocused();

      const filters = page.getByRole("group", { name: "Filter services by category" });
      await filters.getByRole("button", { name: "Outdoor & Exterior" }).click();
      await expect(filters.getByRole("button", { name: "Outdoor & Exterior" })).toHaveAttribute("aria-pressed", "true");
      await expect(filters.getByRole("button", { name: "All services" })).toHaveAttribute("aria-pressed", "false");
      await expect(catalog(page).locator("[data-service-row]")).toHaveCount(1);
      await expect(row(page, "pool-service")).toBeVisible();
      await expect(catalog(page).getByText("Showing 1 service · 1 with live provider coverage")).toBeVisible();

      await filters.getByRole("button", { name: "Specialty" }).click();
      await expect(catalog(page).getByText("No services are listed in this category yet.")).toBeVisible();
      await catalog(page).getByRole("button", { name: "Show all services" }).click();
      await expect(catalog(page).locator("[data-service-row]")).toHaveCount(6);
      await expectNoHorizontalOverflow(page);
      await expectAccessible(page);
    });

    test("a homeowner opens Pool Service by keyboard and lands on early access with it selected", async ({ page }) => {
      await open(page, viewport);
      const card = page.getByRole("link", { name: /^Pool Service\s*,\s*join early access/ });
      await expect(card).toHaveAttribute("href", "/early-access?service=pool-service");
      // Reach it with the keyboard from the top of the page.
      for (let presses = 0; presses < 60 && !(await card.evaluate((element) => element === document.activeElement)); presses += 1) {
        await page.keyboard.press("Tab");
      }
      await expect(card).toBeFocused();
      // A visible focus ring.
      expect(await card.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/early-access\?service=pool-service$/);
      await expect(page.getByRole("checkbox", { name: "Pool Service" })).toBeChecked();
    });

    test("a homeowner joins early access from the hero", async ({ page }) => {
      await open(page, viewport);
      await page.getByRole("main").getByRole("link", { name: "Join early access" }).first().click();
      await expect(page).toHaveURL(/\/early-access$/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  });
}

test("a failed pricing read keeps the catalog, says so, and recovers on retry", async ({ page }) => {
  await open(page, { width: 1440, packagesFail: (attempt) => attempt === 1 });
  const alert = catalog(page).getByRole("alert");
  await expect(alert).toContainText("We couldn’t load current pricing and availability.");
  // The server catalog stays, with no price or availability claim.
  await expect(catalog(page).locator("[data-service-row]")).toHaveCount(6);
  await expect(catalog(page).locator("[data-availability]")).toHaveCount(0);
  await expect(catalog(page).getByText("Showing 6 services", { exact: true })).toBeVisible();
  await expectAccessible(page);
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toHaveCount(0);
  await expect(row(page, "pool-service")).toContainText("Package pricing from $140/weekly visit");
});

for (const width of [320, 768]) {
  test(`${width}px: no horizontal overflow and axe passes`, async ({ page }) => {
    await open(page, { width });
    await expect(row(page, "pool-service")).toContainText("Package pricing from $140");
    await expectNoHorizontalOverflow(page);
    await expectAccessible(page);
  });
}
