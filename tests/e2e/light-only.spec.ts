// DEC-2026-026 (TRACE-105, R0.5): the recruiting launch renders light mode only.
// Saved dark/system preferences and an OS dark preference must not paint dark at any
// point, the theme control is gone, and native controls use the light color scheme.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

const app = "http://127.0.0.1:3103";
const supabase = "http://127.0.0.1:55831";
const wcag = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

type Preference = "fresh" | "saved dark" | "saved system, OS dark";
const preferences: Preference[] = ["fresh", "saved dark", "saved system, OS dark"];

const surfaces = [
  { area: "public", path: "/", role: null },
  { area: "public form", path: "/early-access", role: null },
  { area: "homeowner", path: "/dashboard", role: "homeowner" },
  { area: "vendor", path: "/vendor", role: "vendor" },
  { area: "admin", path: "/admin/recruiting", role: "admin" },
] as const;

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === supabase && url.pathname === "/rest/v1/service_categories") return route.fulfill({ json: [{ id: "outdoor", name: "Outdoor" }] });
    if (url.origin === supabase && url.pathname === "/rest/v1/services_catalog") return route.fulfill({ json: [{ id: "lawn-mowing", name: "Lawn Mowing", category_id: "outdoor" }] });
    return [app, supabase].includes(url.origin) ? route.continue() : route.abort();
  });
});

async function prepare(page: Page, preference: Preference, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme: preference === "saved system, OS dark" ? "dark" : "light" });
  await page.addInitScript(saved => {
    if (saved && !sessionStorage.getItem("seeded")) {
      localStorage.setItem("theme", saved);
      sessionStorage.setItem("seeded", "1");
    }
    // Record any dark paint from the first byte onward, including before hydration.
    const w = window as unknown as { sawDark: boolean };
    w.sawDark = false;
    const check = () => { if (document.documentElement.classList.contains("dark")) w.sawDark = true; };
    new MutationObserver(check).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    check();
  }, preference === "fresh" ? null : preference === "saved dark" ? "dark" : "system");
}

async function expectLight(page: Page) {
  const html = page.locator("html");
  await expect(html).toHaveClass(/(^|\s)light(\s|$)/);
  await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  expect(await page.evaluate(() => (window as unknown as { sawDark: boolean }).sawDark)).toBe(false);
  expect(await html.evaluate(el => getComputedStyle(el).colorScheme)).toBe("light");
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute("content", "light");
  // The light background token, not the dark one.
  expect(await page.locator("body").evaluate(el => getComputedStyle(el).backgroundColor)).toBe(
    await page.evaluate(() => { const probe = document.createElement("div"); probe.style.color = "var(--color-background)"; document.body.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }),
  );
  await expect(page.getByRole("button", { name: /Use (dark|light) mode|Change color theme|Appearance/ })).toHaveCount(0);
}

test("the server-rendered document is light before any script runs", async ({ request }) => {
  const html = await (await request.get("/early-access")).text();
  expect(html).toContain('<meta name="color-scheme" content="light"/>');
  expect(html).not.toMatch(/<html[^>]*class="[^"]*\bdark\b/);
});

for (const preference of preferences) {
  for (const width of [320, 1440]) {
    for (const surface of surfaces) {
      test(`${surface.area} ${preference} ${width}px stays light and accessible`, async ({ page }) => {
        if (surface.role) await syntheticSession(page.context(), surface.role);
        await prepare(page, preference, width);
        await page.goto(surface.path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await expectLight(page);
        expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([]);
        expect(await page.locator("main").first().evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      });
    }
  }
}

test("navigation and reload keep light and leave the saved preference untouched", async ({ page }) => {
  await prepare(page, "saved dark", 390);
  await page.goto("/");
  await expectLight(page);
  await page.goto("/early-access");
  await expectLight(page);
  await page.reload();
  await expectLight(page);
  // Ignored, not erased: the dark-mode repair release can honor it again.
  expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");
});

test("the mobile menu has no theme control", async ({ page }) => {
  await prepare(page, "saved dark", 320);
  await page.goto("/");
  await page.getByRole("button", { name: /menu/i }).first().click();
  await expect(page.getByRole("link", { name: "FAQ" }).last()).toBeVisible();
  await expectLight(page);
});

test("form errors render in the light palette under an OS dark preference", async ({ page }) => {
  await prepare(page, "saved system, OS dark", 320);
  await page.goto("/early-access");
  await page.getByRole("form", { name: "Join early access" }).getByRole("button", { name: "Join early access" }).click();
  const summary = page.getByRole("region", { name: "Please check your answers" });
  await expect(summary).toBeFocused();
  await expect(page.getByLabel("Email address (required)")).toHaveAttribute("aria-invalid", "true");
  await expectLight(page);
  expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([]);
});
