// TRACE-104 (R0.4): vendor recruiting states and the operator recruiting-readiness page.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

const wcag = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function open(page: Page, role: "admin" | "vendor", path: string, theme = "light", width = 1440) {
  await syntheticSession(page.context(), role);
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
}

async function accessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([]);
  expect(await page.locator("main").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

test("vendor dashboard explains closed booking and honest listing readiness", async ({ page }) => {
  await open(page, "vendor", "/vendor");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Synthetic Vendor");
  await expect(page.getByRole("complementary", { name: "Homeowner booking has not opened to the public yet" })).toBeVisible();
  await expect(page.getByText("Not listed yet", { exact: true })).toBeVisible();
  const requirements = page.getByRole("list", { name: "Listing requirements" });
  await expect(requirements.getByText("Business name and description — not complete")).toBeAttached();
  await expect(requirements.getByRole("link", { name: "Update" })).toHaveAttribute("href", "/vendor/profile");
  await expect(requirements.getByText("Mercurius approval and compliance review — complete")).toBeAttached();
  await expect(page.getByText("ZIP codes on file: 33904.")).toBeVisible();
  // A vendor that is not listed gets no storefront link.
  await expect(page.getByRole("link", { name: /View (storefront|public profile)/ })).toHaveCount(0);
});

test("vendor jobs keep existing history and say offers are rare while booking is closed", async ({ page }) => {
  await open(page, "vendor", "/vendor/jobs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Jobs & Requests");
  await expect(page.getByRole("complementary", { name: "Homeowner booking has not opened to the public yet" })).toBeVisible();
  // Legitimate existing work stays visible under the notice.
  await expect(page.getByText("Synthetic Lawn Service", { exact: true }).first()).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  for (const width of [320, 1440]) {
    test(`vendor recruiting states ${theme} ${width}px are accessible`, async ({ page }) => {
      await open(page, "vendor", "/vendor", theme, width);
      await expect(page.getByText("Not listed yet", { exact: true })).toBeVisible();
      await accessible(page);
    });
    test(`operator recruiting readiness ${theme} ${width}px is accessible`, async ({ page }) => {
      await open(page, "admin", "/admin/recruiting", theme, width);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recruiting readiness");
      await expect(page.getByText("Synthetic Applicant Services")).toBeVisible();
      await accessible(page);
    });
  }
}

test("operator sees missed email, invitation follow-up and listing review without sample data", async ({ page }) => {
  await open(page, "admin", "/admin/recruiting");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Recruiting readiness");
  // Only items needing attention are shown by default; a Resend-accepted email is not.
  await expect(page.getByText("Synthetic Applicant Services")).toBeVisible();
  await expect(page.getByText("Resend returned 422: invalid from address.")).toBeVisible();
  await expect(page.getByText("Synthetic Uncertain Services")).toBeVisible();
  await expect(page.getByText("Synthetic Delivered Services")).toHaveCount(0);
  await page.getByRole("button", { name: "Show all 3 applications" }).click();
  await expect(page.getByText("Synthetic Delivered Services")).toBeVisible();
  await expect(page.getByText("Accepted by Resend")).toBeVisible();

  await expect(page.getByText("Result unknown").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Open invitation" })).toHaveAttribute("href", "/admin/applications?application=00000000-0000-4000-8000-000000000050");

  await expect(page.getByText("Looks like a test record")).toBeVisible();
  await expect(page.getByText("History: 2 requests, 1 invoice, 0 reviews — kept whatever the listing state.")).toBeVisible();
});

test("an unknown email asks the operator to check the inbox and a failed resend stays visible", async ({ page }) => {
  await open(page, "admin", "/admin/recruiting");
  const uncertain = page.getByRole("listitem").filter({ hasText: "Synthetic Uncertain Services" });
  await uncertain.getByRole("button", { name: "Resend email" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Resend the owner email?" });
  await expect(confirm).toContainText("Resend only after checking the owner inbox and the Resend log");
  await confirm.getByRole("button", { name: "Resend", exact: true }).click();
  // The synthetic backend refuses every write; nothing is claimed as sent.
  await expect(page.getByText("Notification was not resent")).toBeVisible();
  await expect(page.getByText("Resend recorded")).toHaveCount(0);
  // The confirmation stays open with its error; the application stays listed behind it.
  await expect(confirm.getByRole("alert")).toContainText("could not be confirmed");
  await page.keyboard.press("Escape");
  await expect(uncertain).toBeVisible();
});

test("acknowledging and hiding require a reason", async ({ page }) => {
  await open(page, "admin", "/admin/recruiting");
  await page.getByRole("listitem").filter({ hasText: "Synthetic Applicant Services" }).getByRole("button", { name: "Acknowledge" }).click();
  const ack = page.getByRole("alertdialog", { name: "Acknowledge without email?" });
  await expect(ack.getByRole("button", { name: "Acknowledge", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("listitem").filter({ hasText: "Test Vendor Demo" }).getByRole("button", { name: "Hide as test or duplicate" }).click();
  const hide = page.getByRole("alertdialog", { name: "Hide this provider?" });
  await expect(hide).toContainText("Records, history and documents are kept.");
  await expect(hide.getByRole("button", { name: "Hide provider", exact: true })).toBeDisabled();
});

test("the application queue opens the application linked from recruiting readiness", async ({ page }) => {
  await open(page, "admin", "/admin/applications?application=00000000-0000-4000-8000-000000000050");
  await expect(page.getByRole("dialog", { name: "Synthetic Applicant Services" })).toBeVisible();
});

test("non-admin sessions cannot open recruiting readiness", async ({ page }) => {
  await open(page, "vendor", "/admin/recruiting");
  await expect(page.getByRole("heading", { name: "Recruiting readiness" })).toHaveCount(0);
});
