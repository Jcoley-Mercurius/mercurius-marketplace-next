import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const width of [320, 1440]) {
  test(`brand ${width}px: exports render on both backgrounds`, async ({ page }) => {
    await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:3103" ? route.continue() : route.abort());
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/mds/brand");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mercurius identity assets");
    await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(6);
    await expect.poll(() => page.locator("main img").evaluateAll(images => images.every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await page.locator("main, main section").evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
    await page.screenshot({ path: `test-results/brand-${width}.png`, fullPage: true });
  });

  test(`@visual brand ${width}px`, async ({ page }) => {
    await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:3103" ? route.continue() : route.abort());
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/mds/brand");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mercurius identity assets");
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`brand-${width}.png`, { fullPage: true, animations: "disabled" });
  });
}
