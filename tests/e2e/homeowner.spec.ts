import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

test.beforeEach(async ({ page }) => {
  await syntheticSession(page.context(), "homeowner");
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

async function dashboard(page: Page, tab: string) {
  await page.goto(`/dashboard?tab=${tab}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome back");
  if (tab === "invoices") await expect(page.getByText("MDS-INV-001")).toBeVisible();
  else if (tab === "payment-methods") await expect(page.getByText("No saved cards yet")).toBeVisible();
  else await expect(page.getByRole("button", { name: "Open Synthetic Lawn Service details" })).toBeVisible();
}

for (const theme of ["light", "dark"]) {
  for (const width of [320, 1440]) {
    test(`homeowner ${theme} ${width}px: service and payment screens`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
      for (const tab of ["overview", "upcoming", "invoices", "payment-methods"]) {
        await dashboard(page, tab);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.locator("main").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      await page.screenshot({ path: `test-results/homeowner-${theme}-${width}.png`, fullPage: true });
    });
  }
}

test("checkout and card-management failures persist, focus and allow retry", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await dashboard(page, "invoices");
  const pay = page.getByRole("button", { name: "Pay invoice MDS-INV-001 securely" });
  await pay.click();
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Payment could not be started.");
  await expect(pay).toBeEnabled();
  await expect(page).toHaveURL(/\/dashboard\?tab=invoices$/);
  await dashboard(page, "payment-methods");
  await page.getByRole("button", { name: "Manage Cards" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Card management could not be opened.");
});

test("service dialog failures, cancellation confirmation and keyboard review", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await dashboard(page, "upcoming");
  const quote = page.getByRole("button", { name: "Open Synthetic Quote Service details" });
  await quote.click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Quote Service" });
  await dialog.getByRole("button", { name: "Approve quote" }).click();
  await expect(dialog.getByRole("alert")).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Approve quote" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(quote).toBeFocused();
  await page.getByRole("button", { name: "Open Synthetic Pending Service details" }).click();
  await page.getByRole("dialog", { name: "Synthetic Pending Service" }).getByRole("button", { name: "Cancel request", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Cancel this pending request?" });
  await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open Synthetic Review Service details" }).click();
  const review = page.getByRole("dialog", { name: "Synthetic Review Service" });
  const stars = review.getByRole("button", { name: "4 stars", exact: true });
  await stars.focus();
  await page.keyboard.press("Space");
  await expect(stars).toHaveAttribute("aria-pressed", "true");
  const box = await stars.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await review.getByLabel("Comments (optional)").fill("Synthetic review fixture.");
  await review.getByRole("button", { name: "Submit review" }).click();
  await expect(review.getByRole("alert")).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect(await review.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test("completion concern records a reason without claiming vendor work started", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await dashboard(page, "upcoming");
  await page.getByRole("button", { name: "Open Synthetic Completed Service details" }).click();
  const detail = page.getByRole("dialog", { name: "Synthetic Completed Service" });
  await expect(detail.getByText(/after 72 hours/)).toBeVisible();
  await detail.getByRole("button", { name: "Report an issue", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Report an issue with this service?" });
  await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await expect(confirm.getByRole("button", { name: "Report issue", exact: true })).toBeDisabled();
  await confirm.getByLabel("Reason (required)").fill("Synthetic completion concern");
  const request = page.waitForRequest(request => request.url().includes("/rpc/homeowner_raise_dispute"));
  await confirm.getByRole("button", { name: "Report issue", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ _reason: "Synthetic completion concern" });
  await expect(confirm.getByRole("alert")).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/phase4-homeowner-issue.png", fullPage: true });
});
