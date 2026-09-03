import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Synthetic browser drafts only. No database, authentication or payment writes.
async function requestDraft(page: Page, step = "details", theme = "light", width = 390) {
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:3103") return route.abort();
    if (url.pathname === "/api/request-coverage") return route.fulfill({ json: {
      status: "covered", area: null, checkedZip: "33904", message: "Synthetic covered area",
    } });
    if (url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await page.addInitScript(({ step, theme }) => {
    localStorage.setItem("theme", theme);
    sessionStorage.setItem("nextRequestFlowState", JSON.stringify({
      step, selectedIds: ["general-home-service"], otherServiceDetails: "Synthetic test repair",
      city: "Cape Coral", stateCode: "FL",
    }));
  }, { step, theme });
  await page.goto("/request");
  await expect(page.locator("#request-step")).toBeVisible();
  if (step === "details") await expect(page.getByLabel("Street address", { exact: false })).toBeVisible();
}

test("request errors persist, link to fields, and step changes move focus", async ({ page }) => {
  await requestDraft(page);
  await page.getByRole("button", { name: "Continue to Review" }).click();
  const summary = page.getByRole("region", { name: "Please check your answers" });
  await expect(summary).toBeFocused();
  await expect(summary.getByRole("link")).toHaveCount(2);
  await summary.getByRole("link", { name: "Enter the service street address." }).click();
  const street = page.getByLabel("Street address (required)", { exact: true });
  await expect(street).toBeFocused();
  await expect(street).toHaveAttribute("aria-invalid", "true");
  await expect(street).toHaveAccessibleDescription("Enter the service street address.");
  await street.fill("123 Synthetic Test Lane");
  await page.getByLabel("ZIP code (required)").fill("33904");
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 2);
  const date = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
  await page.getByLabel("Window starts (required)").fill(date);
  await page.getByLabel("Window ends (required)").fill(date);
  await page.getByRole("button", { name: "Continue to Review" }).click();
  await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeFocused();
  await expect(summary).toHaveCount(0);
  // Submit through the actual form so no hidden/native validation UI masks errors.
  await page.locator("form").evaluate(form => (form as HTMLFormElement).requestSubmit());
  await expect(summary).toBeFocused();
  await expect(summary.getByRole("link")).toHaveCount(4);
  await page.getByLabel("First name (required)").fill("Test");
  await page.getByLabel("Last name (required)").fill("Homeowner");
  await page.getByLabel("Email (required)", { exact: true }).fill("invalid-email");
  await page.getByLabel("Phone (required)", { exact: true }).fill("2395550100");
  await page.locator("form").evaluate(form => (form as HTMLFormElement).requestSubmit());
  await expect(summary.getByRole("link")).toHaveText(["Enter a valid email address."]);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator("#request-step")).toBeFocused();
  await expect(street).toHaveValue("123 Synthetic Test Lane");
});

for (const theme of ["light", "dark"]) {
  for (const width of [320, 1440]) {
    test(`request details ${theme} ${width}px: axe and reflow`, async ({ page }) => {
      await requestDraft(page, "details", theme, width);
      await page.getByRole("button", { name: "Continue to Review" }).click();
      await expect(page.getByRole("region", { name: "Please check your answers" })).toBeFocused();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.locator("main, main form, main section").evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ tag: el.tagName, width: el.clientWidth, scroll: el.scrollWidth, children: Array.from(el.querySelectorAll("* ")).filter(child => child.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).slice(0, 8).map(child => child.outerHTML.slice(0, 220)) })))).toEqual([]);
      await page.screenshot({ path: `test-results/request-${theme}-${width}.png`, fullPage: true });
    });
  }
}

test("Enter on an address field validates the details step", async ({ page }) => {
  await requestDraft(page);
  await page.getByLabel("Street address (required)").press("Enter");
  await expect(page.getByRole("region", { name: "Please check your answers" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Enter the service street address." })).toBeVisible();
  await expect(page.getByLabel("First name (required)")).toHaveCount(0);
});

for (const step of ["services", "contact"]) {
  for (const theme of ["light", "dark"]) {
    test(`request ${step} ${theme}: mobile axe and reflow`, async ({ page }) => {
      await requestDraft(page, step, theme, 320);
      await expect(page.getByRole("status")).toContainText(step === "services" ? "Step 1" : "Step 3");
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
      expect(await page.locator("main, main form, main section").evaluateAll(elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ tag: el.tagName, width: el.clientWidth, scroll: el.scrollWidth, children: Array.from(el.querySelectorAll("* ")).filter(child => child.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).slice(0, 8).map(child => child.outerHTML.slice(0, 220)) })))).toEqual([]);
      await page.screenshot({ path: `test-results/request-${step}-${theme}-320.png`, fullPage: true });
    });
  }
}
