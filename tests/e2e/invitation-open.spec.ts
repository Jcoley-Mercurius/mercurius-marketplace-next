import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// DEC-2026-029 follow-up: the landing page for the Mercurius link in a provider invitation
// email. Loading it spends nothing; Continue mints a sign-in and moves to the password step.
const attempt = "d4000000-0000-4000-8000-000000000001";
const key = "A".repeat(20) + "b-_" + "9".repeat(20);
const link = `/invitation/open?invitation=${attempt}&key=${key}`;

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin)
      ? route.continue()
      : route.abort(),
  );
});

async function countOpens(page: Page, reply: { status: number; json: unknown }) {
  const bodies: unknown[] = [];
  await page.route("**/api/invitations/open", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill(reply);
  });
  return bodies;
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`opening the link spends nothing until Continue ${theme} ${width}px`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
    await page.setViewportSize({ width, height: 900 });
    const opens = await countOpens(page, { status: 410, json: {} });
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up your Mercurius provider account");
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(page.getByText("This link works until your invitation expires.")).toBeVisible();
    expect(opens).toEqual([]);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("Continue sends the link's values and follows the minted sign-in to the password step", async ({ page }) => {
  const minted = `/set-password?invitation=${attempt}&kind=existing_provider&token_hash=minted&type=magiclink`;
  const opens = await countOpens(page, { status: 200, json: { redirect: minted } });
  await page.goto(`${link}&kind=existing_provider`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up access to your business profile");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL((url) => url.pathname === "/set-password");
  expect(opens).toEqual([{ invitation: attempt, kind: "existing_provider", key }]);
  expect(new URL(page.url()).searchParams.get("type")).toBe("magiclink");
});

test("an invalid or used link explains itself and gives a contact path", async ({ page }) => {
  await countOpens(page, { status: 410, json: { error: "ignored" } });
  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toContainText("This invitation link is no longer valid.");
  await expect(alert.getByRole("link", { name: "hello@mercuriusmarketplace.com" })).toHaveAttribute("href", "mailto:hello@mercuriusmarketplace.com");
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
});

test("an outage keeps the button so the provider can try again", async ({ page }) => {
  const opens = await countOpens(page, { status: 503, json: { error: "We couldn't open your invitation just now. Please try again in a few minutes." } });
  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("We couldn't open your invitation just now. Please try again in a few minutes.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect.poll(() => opens.length).toBe(2);
});

test("a redirect anywhere but the password step is not followed", async ({ page }) => {
  await countOpens(page, { status: 200, json: { redirect: "https://attacker.invalid/set-password" } });
  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/invitation/open");
});

test("an incomplete link sends nothing", async ({ page }) => {
  const opens = await countOpens(page, { status: 200, json: {} });
  await page.goto(`/invitation/open?invitation=${attempt}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("This invitation link is incomplete.");
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
  expect(opens).toEqual([]);
});
