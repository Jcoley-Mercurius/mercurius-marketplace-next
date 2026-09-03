import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function syntheticSession(context: BrowserContext, role: "admin" | "vendor" | "homeowner") {
  const suffix = { admin: "3", vendor: "4", homeowner: "1" }[role];
  const id = `00000000-0000-4000-8000-00000000000${suffix}`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: id, aud: "authenticated", role: "authenticated", exp: expires, fixture: "mds-only", testRole: role })}.synthetic-signature`;
  const session = { access_token: token, refresh_token: "mds-fixture-only", token_type: "bearer", expires_at: expires, expires_in: 3600, user: { id, aud: "authenticated", role: "authenticated", email: `${role}@example.invalid`, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
  await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${encoded(session)}`, url: "http://127.0.0.1:3103", sameSite: "Lax" }]);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

async function portal(page: Page, role: "admin" | "vendor", theme = "light", width = 320) {
  await syntheticSession(page.context(), role);
  await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto(role === "admin" ? "/admin/requests" : "/vendor/jobs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(role === "admin" ? "Service Requests" : "Jobs & Requests");
  await expect((role === "admin" && width === 1440 ? page.getByRole("table", { name: "Service requests", exact: true }) : page).getByText("Synthetic Lawn Service", { exact: true }).first()).toBeVisible();
}

for (const role of ["admin", "vendor"] as const) {
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 1440]) {
      test(`${role} ${theme} ${width}px: accessible live-shaped records`, async ({ page }) => {
        await portal(page, role, theme, width);
        expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
        expect(await page.locator("main").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        if (role === "admin") {
          await expect(page.getByRole(width === 320 ? "list" : "table", { name: "Service requests", exact: true })).toBeVisible();
        }
        await page.screenshot({ path: `test-results/${role}-${theme}-${width}.png`, fullPage: true });
      });
    }
  }
}

test("admin quote fields, nested confirmation and persistent action errors", async ({ page }) => {
  await portal(page, "admin");
  const review = page.getByRole("button", { name: /Review Synthetic Lawn/ });
  await review.click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Lawn Service" });
  await expect(dialog).toBeVisible();
  const quote = dialog.getByLabel("Total amount ($) (required)", { exact: true });
  await quote.fill("0");
  await dialog.getByRole("button", { name: "Send Quote", exact: true }).click();
  await expect(quote).toBeFocused();
  await expect(quote).toHaveAccessibleDescription("Enter a quote amount greater than $0.");
  const release = dialog.getByRole("button", { name: "Release match", exact: true });
  await release.click();
  const confirm = page.getByRole("alertdialog", { name: "Release this vendor?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(release).toBeFocused();
  await dialog.getByRole("button", { name: "Save Note", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Action could not be completed" })).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(review).toBeFocused();
});

test("vendor confirmation, mobile navigation and completion upload failure", async ({ page }) => {
  await portal(page, "vendor", "dark");
  const menu = page.getByRole("button", { name: "Open vendor menu" });
  await menu.click();
  await expect(page.getByRole("dialog", { name: "Vendor navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  const decline = page.getByRole("button", { name: "Decline", exact: true });
  await decline.click();
  const confirm = page.getByRole("alertdialog", { name: "Decline this request?" });
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Decline request", exact: true }).click();
  await expect(confirm.getByRole("alert")).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(decline).toBeFocused();
  await page.getByRole("tab", { name: /Active Jobs/ }).click();
  await page.getByRole("button", { name: "Mark done", exact: true }).click();
  const complete = page.getByRole("dialog", { name: "Complete Synthetic Pool Service" });
  await complete.locator('input[type="file"]').setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from("synthetic image fixture") });
  await expect(complete.getByRole("alert")).toContainText("Photo upload failed");
  await expect(complete.getByRole("alert")).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
});

test("portal guards still reject absent and wrong-role sessions", async ({ page }) => {
  await page.goto("/admin/requests");
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await syntheticSession(page.context(), "homeowner");
  await page.goto("/vendor/jobs");
  await expect(page).toHaveURL(/\/dashboard$/);
});
