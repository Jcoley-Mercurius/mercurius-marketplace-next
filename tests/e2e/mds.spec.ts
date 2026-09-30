import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  // No external data, provider calls, or production sessions enter catalog tests.
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === "http://127.0.0.1:3103" ? route.continue() : route.abort();
  });
});

async function catalog(page: Page, theme = "light", width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(value => { if (!localStorage.getItem("theme")) localStorage.setItem("theme", value); }, theme);
  await page.goto("/mds");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Component foundation");
  // Light-only launch (DEC-2026-026): no theme control; a saved dark preference renders light.
  await expect(page.locator("main").getByRole("button", { name: /Use .* mode/ })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of ["light", "dark"]) {
  for (const width of [320, 390, 768, 1024, 1440]) {
    test(`${theme} ${width}px: axe and reflow`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await catalog(page, theme, width);
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      // Check actual content widths as well as body width: overflow-x:clip must not mask a failure.
      const overflow = await page.locator("main, main section, main form, header").evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.tagName));
      expect(overflow).toEqual([]);
      expect(errors).toEqual([]);
      for (const name of ["Request service", "Outline action", "Compact action"]) {
        const box = await page.locator("main").getByRole("button", { name, exact: true }).boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(name === "Compact action" ? 40 : 44);
      }
    });
  }
}

test("skip navigation moves focus to the single main landmark", async ({ page }) => {
  await catalog(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(page.getByRole("main")).toHaveCount(1);
});

test("public mobile menu has one trigger, a name, scroll access, trap and restoration", async ({ page }) => {
  await catalog(page, "dark", 320);
  const trigger = page.getByRole("button", { name: "Open main menu" });
  await expect(trigger.locator("button")).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Main menu" });
  await expect(dialog).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await close.focus();
  await page.keyboard.press("Tab");
  // Base UI wraps focus through guards on the next animation frame.
  await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  // TRACE-103: the public header's booking entry point is early access during R0.
  await dialog.getByRole("link", { name: "Join early access", exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole("link", { name: "Join early access", exact: true })).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("forms associate labels, help and errors; native controls support keyboard", async ({ page }) => {
  await catalog(page);
  const field = page.getByRole("textbox", { name: "Service name" });
  await page.getByRole("button", { name: "Validate example" }).click();
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription("A short name for your example. Enter a service name.");
  await field.fill("Synthetic lawn care");
  await page.getByRole("button", { name: "Validate example" }).click();
  await expect(field).not.toHaveAttribute("aria-invalid");
  await expect(page.getByText("Example validated. No data was sent.")).toBeVisible();
  const check = page.getByRole("checkbox", { name: "Include example details" });
  await check.focus(); await page.keyboard.press("Space"); await expect(check).toBeChecked();
  const toggle = page.getByRole("switch", { name: "Enable example reminders" });
  await toggle.focus(); await page.keyboard.press("Space"); await expect(toggle).toBeChecked();
  const select = page.getByRole("combobox", { name: "Frequency" });
  await select.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await expect(select).not.toHaveValue("");
});

test("sheet and dialog close on Escape and restore trigger focus", async ({ page }) => {
  await catalog(page);
  for (const [triggerName, title] of [["Open example sheet", "Example navigation"], ["Open example dialog", "Example details"]]) {
    const trigger = page.getByRole("button", { name: triggerName });
    await trigger.focus(); await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
  }
});

test("confirmation defaults to cancel, requires reason and guards pending dismissal", async ({ page }) => {
  await catalog(page);
  const trigger = page.getByRole("button", { name: "Remove example", exact: true });
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  const confirm = dialog.getByRole("button", { name: "Remove example" });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Reason" }).fill("Synthetic test");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await confirm.click();
  await expect(dialog.getByRole("button", { name: "Confirming…" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.getByText("Remove example: Synthetic example MDS-001. Done.")).toBeVisible();
});

test("confirmation failure stays open, announces failure and permits cancel", async ({ page }) => {
  await catalog(page);
  await page.getByRole("checkbox", { name: "Simulate confirmation failure" }).check();
  await page.getByRole("button", { name: "Remove example", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("textbox", { name: "Reason" }).fill("Synthetic failure");
  await dialog.getByRole("button", { name: "Remove example" }).click();
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Remove example" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});

test("tabs use arrow navigation; light-only theme holds across reload", async ({ page }) => {
  await catalog(page);
  await page.getByRole("tab", { name: "Overview" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Details" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tabpanel", { name: "Details" })).toHaveText("This panel contains the example details.");
  const listBox = await page.getByRole("tablist").boundingBox();
  const panelBox = await page.getByRole("tabpanel", { name: "Details" }).boundingBox();
  expect(panelBox!.y).toBeGreaterThanOrEqual(listBox!.y + listBox!.height);
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  // goto instead of catalog(): do not overwrite the saved localStorage value.
  await page.goto("/mds");
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("200% content zoom preserves controls and visible keyboard focus", async ({ page }) => {
  await catalog(page, "light", 1440);
  await page.locator("html").evaluate(el => { el.style.zoom = "2"; });
  const field = page.getByRole("textbox", { name: "Service name" });
  await field.focus();
  const outline = await field.evaluate(el => ({ width: getComputedStyle(el).outlineWidth, style: getComputedStyle(el).outlineStyle }));
  expect(outline).toEqual({ width: "3px", style: "solid" });
  expect(await page.locator("main").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Validate example" }).click();
  await expect(field).toBeFocused();
});

test("reduced motion and forced colors preserve the focus indicator", async ({ page }) => {
  await catalog(page);
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  const trigger = page.getByRole("button", { name: "Open example dialog" });
  await trigger.focus();
  expect(await trigger.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("solid");
  const duration = await page.locator("main .animate-spin").evaluate(el => getComputedStyle(el).animationDuration);
  expect(parseFloat(duration)).toBeLessThanOrEqual(0.001);
});

for (const theme of ["light", "dark"]) for (const width of [320, 1440]) {
  test(`@visual catalog ${theme} ${width}`, async ({ page }) => {
    await catalog(page, theme, width);
    await expect(page).toHaveScreenshot(`catalog-${theme}-${width}.png`, { fullPage: true, animations: "disabled" });
  });
}
