import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

// TRACE-103 (R0.3): signed-in waiting, invited, closed and error states, interest editing and
// email preferences. Scripted Supabase responses over the synthetic fixture; SQL 069/070
// prove the database commands behind them.
const app = "http://127.0.0.1:3103";
const supabase = "http://127.0.0.1:55831";
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const cell = (state: string) => ({ zip_code: "33904", service_id: "lawn-mowing", service_name: "Lawn Mowing", state, changed_at: "2026-09-29T12:00:00Z" });
const interest = (overrides: Record<string, unknown> = {}) => ({ kind: "early_access", status: "active", first_name: null, zip_code: "33904", service_ids: ["lawn-mowing"], still_exploring: false, linked: true, updated_at: "2026-09-29T12:00:00Z", ...overrides });

type Setup = {
  width?: number;
  theme?: string;
  trial?: unknown;
  trialFails?: () => boolean;
  interests?: unknown[];
  verified?: boolean;
  marketing?: boolean;
  history?: boolean;
  save?: (body: Record<string, unknown>) => { status?: number; json: unknown };
};

async function portal(page: Page, path: string, setup: Setup = {}) {
  const calls = { save: [] as Record<string, unknown>[], marketing: [] as Record<string, unknown>[], withdraw: [] as Record<string, unknown>[], trialReads: 0 };
  let interests = setup.interests ?? [interest()];
  let marketing = setup.marketing ?? false;
  await syntheticSession(page.context(), "homeowner");
  await page.setViewportSize({ width: setup.width ?? 1440, height: 900 });
  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === app) return route.continue();
    if (url.origin !== supabase) return route.abort();
    const path = url.pathname;
    if (path === "/rest/v1/rpc/r0_my_trial_access") {
      calls.trialReads += 1;
      if (setup.trialFails?.()) return route.fulfill({ status: 500, json: { message: "Synthetic outage" } });
      return route.fulfill({ json: setup.trial ?? { homeowner: true, cells: [] } });
    }
    if (path === "/rest/v1/rpc/r0_my_interest") {
      return route.fulfill({ json: setup.verified === false ? { verified: false } : { verified: true, interests, marketing_opted_in: marketing } });
    }
    if (path === "/rest/v1/rpc/r0_save_my_interest") {
      const body = request.postDataJSON() as Record<string, unknown>;
      calls.save.push(body);
      const reply = setup.save?.(body) ?? { json: { outcome: "saved", interest: interest({ zip_code: body.p_zip, service_ids: body.p_service_ids, still_exploring: body.p_still_exploring, first_name: body.p_first_name }) } };
      const saved = (reply.json as { interest?: unknown }).interest;
      if (saved) interests = [saved];
      return route.fulfill({ status: reply.status ?? 200, json: reply.json });
    }
    if (path === "/rest/v1/rpc/r0_withdraw_my_interest") {
      calls.withdraw.push(request.postDataJSON() as Record<string, unknown>);
      interests = [];
      return route.fulfill({ json: { outcome: "withdrawn" } });
    }
    if (path === "/rest/v1/rpc/r0_set_my_marketing") {
      const body = request.postDataJSON() as { p_opted_in: boolean };
      calls.marketing.push(body);
      marketing = body.p_opted_in;
      return route.fulfill({ json: { marketing_opted_in: marketing } });
    }
    if (path === "/rest/v1/service_categories") return route.fulfill({ json: [{ id: "outdoor", name: "Outdoor" }] });
    if (path === "/rest/v1/services_catalog") return route.fulfill({ json: [{ id: "lawn-mowing", name: "Lawn Mowing", category_id: "outdoor" }, { id: "pool-cleaning", name: "Pool Cleaning", category_id: "outdoor" }] });
    if (setup.history === false && request.method() === "GET" && ["/rest/v1/service_requests", "/rest/v1/invoices"].includes(path)) return route.fulfill({ json: [] });
    return route.continue();
  });
  await page.addInitScript((theme) => localStorage.setItem("theme", theme), setup.theme ?? "light");
  await page.goto(path);
  return calls;
}

const nav = (page: Page) => page.getByRole("navigation", { name: "homeowner navigation" }).first();

async function expectAccessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.describe("waiting home", () => {
  test("a new non-invited account sees status, interests and exploration, with no transaction areas", async ({ page }) => {
    await portal(page, "/dashboard", { history: false });
    await expect(page.getByText("Early access · Waiting for an invitation")).toBeVisible();
    await expect(page.getByText("Booking is opening in stages across Lee County.")).toBeVisible();
    const interests = page.locator("dl");
    await expect(interests).toContainText("33904");
    await expect(interests).toContainText("Lawn Mowing");
    await expect(page.getByText("We’ll email you if your area and service are selected for a trial. Your account is ready; no booking is active.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse services" })).toHaveAttribute("href", "/services");
    await expect(page.getByRole("link", { name: "Explore providers" })).toHaveAttribute("href", "/providers");
    await expect(page.getByRole("link", { name: "Email preferences" })).toHaveAttribute("href", "/account#email-preferences");
    await expect(page.locator('a[href^="/request"]')).toHaveCount(0);
    await expect(page.getByText(/Upcoming Services|Recent Invoices|Pay Securely/)).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/queue|position|place in line|credit/i);
    await expect(nav(page).getByRole("link")).toHaveText(["Overview", "Notifications", "Account Settings"]);
  });

  test("a missing interest is a recovery prompt, and saving reads back the stored interest", async ({ page }) => {
    const calls = await portal(page, "/dashboard", { history: false, interests: [] });
    await expect(page.getByText("Add your ZIP code and services")).toBeVisible();
    await page.getByRole("button", { name: "Add my interests" }).click();
    const zip = page.getByLabel("ZIP code (required)");
    await expect(zip).toBeFocused();
    await zip.fill("33904");
    await page.locator("summary", { hasText: "Outdoor" }).click();
    await page.getByLabel("Lawn Mowing").check();
    await page.getByRole("button", { name: "Save interests" }).click();
    await expect(page.getByRole("heading", { name: "Your interests" })).toBeFocused();
    await expect(page.getByText("Saved. Your early-access interests are up to date.")).toBeVisible();
    await expect(page.locator("dl")).toContainText("Lawn Mowing");
    expect(calls.save).toEqual([{ p_kind: "early_access", p_first_name: null, p_zip: "33904", p_service_ids: ["lawn-mowing"], p_still_exploring: false }]);
  });

  test("an out-of-area ZIP on save is explained and nothing changes", async ({ page }) => {
    await portal(page, "/dashboard", { history: false, save: () => ({ json: { outcome: "boundary" } }) });
    await page.getByRole("button", { name: "Update interests" }).click();
    await page.getByLabel("ZIP code (required)").fill("10001");
    await page.getByRole("button", { name: "Save interests" }).click();
    const zip = page.getByLabel("ZIP code (required)");
    await expect(zip).toBeFocused();
    await expect(zip).toHaveAccessibleDescription(/outside Lee County/);
  });

  test("an unverified email is asked to verify, not given an editor", async ({ page }) => {
    await portal(page, "/dashboard", { history: false, verified: false });
    await expect(page.getByText("Verify your email address to add or change early-access interests.")).toBeVisible();
    await expect(page.getByRole("button", { name: /interests/ })).toHaveCount(0);
  });

  test("leaving the list is confirmed and read back", async ({ page }) => {
    const calls = await portal(page, "/dashboard", { history: false });
    await page.getByRole("button", { name: "Leave the early-access list" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Leave the early-access list?" });
    await dialog.getByRole("button", { name: "Leave the list" }).click();
    await expect(page.getByText("You’ve left the early-access list. You can join again at any time.")).toBeVisible();
    await expect(page.getByText("Add your ZIP code and services")).toBeVisible();
    expect(calls.withdraw).toEqual([{ p_kind: "early_access" }]);
  });

  test("a revoked account without history gets an honest ended state", async ({ page }) => {
    await portal(page, "/dashboard", { history: false, trial: { homeowner: true, cells: [cell("revoked")] } });
    await expect(page.getByText("Early access · Invitation ended")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Contact us" })).toBeVisible();
    await expect(page.locator('a[href^="/request"]')).toHaveCount(0);
  });
});

test.describe("existing history and invitations", () => {
  test("an invited account sees its scope and the request action", async ({ page }) => {
    await portal(page, "/dashboard", { trial: { homeowner: true, cells: [cell("active")] } });
    await expect(page.getByText("Invited to book", { exact: true })).toBeVisible();
    await expect(page.getByText("Your invitation covers Lawn Mowing in 33904.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Request a service" }).first()).toHaveAttribute("href", "/request");
    await expect(nav(page).getByRole("link", { name: "Request Service" })).toHaveAttribute("href", "/request");
  });

  test("a revoked account keeps its history and support, without request actions", async ({ page }) => {
    await portal(page, "/dashboard", { trial: { homeowner: true, cells: [cell("revoked")] } });
    await expect(page.getByText("New bookings are closed for your account")).toBeVisible();
    await expect(page.getByText(/Your invitation to book has ended, so new requests and payments are closed/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Synthetic Lawn Service details" })).toBeVisible();
    await expect(page.locator('a[href^="/request"]')).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Invoices" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Messages" })).toBeVisible();
    await page.goto("/dashboard?tab=invoices");
    await expect(page.getByText("MDS-INV-001")).toBeVisible();
  });

  test("an access check failure hides request actions but keeps records, and can be retried", async ({ page }) => {
    let fail = true;
    const calls = await portal(page, "/dashboard", { trialFails: () => fail });
    const alert = page.getByRole("alert").filter({ hasText: "We couldn’t check your booking access" });
    await expect(alert).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Synthetic Lawn Service details" })).toBeVisible();
    await expect(page.locator('a[href^="/request"]')).toHaveCount(0);
    fail = false;
    const reads = calls.trialReads;
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("New bookings are closed for your account")).toBeVisible();
    expect(calls.trialReads).toBeGreaterThan(reads);
  });
});

test.describe("email preferences", () => {
  test("marketing is a separate, read-back choice", async ({ page }) => {
    const calls = await portal(page, "/account");
    const updates = page.getByRole("switch", { name: "Mercurius news, offers and product updates" });
    await expect(updates).not.toBeChecked();
    await updates.focus();
    await page.keyboard.press("Space");
    await expect(page.getByText("Saved. You’ll get Mercurius news, offers and product updates.")).toBeVisible();
    await expect(updates).toBeChecked();
    expect(calls.marketing).toEqual([{ p_opted_in: true }]);
  });
});

test.describe("accessibility matrix", () => {
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 1440]) {
      test(`waiting home ${theme} ${width}px: axe and reflow`, async ({ page }) => {
        await portal(page, "/dashboard", { history: false, theme, width });
        await expect(page.getByText("Early access · Waiting for an invitation")).toBeVisible();
        await expect(page.locator("dl")).toContainText("Lawn Mowing");
        await expectAccessible(page);
      });
      test(`invited dashboard ${theme} ${width}px: axe and reflow`, async ({ page }) => {
        await portal(page, "/dashboard", { theme, width, trial: { homeowner: true, cells: [cell("active")] } });
        await expect(page.getByText("Your invitation covers Lawn Mowing in 33904.")).toBeVisible();
        await expectAccessible(page);
      });
    }
    test(`interest editor ${theme} 320px: axe and reflow`, async ({ page }) => {
      await portal(page, "/dashboard", { history: false, theme, width: 320, interests: [] });
      await page.getByRole("button", { name: "Add my interests" }).click();
      await page.getByRole("button", { name: "Save interests" }).click();
      await expect(page.getByLabel("ZIP code (required)")).toBeFocused();
      await expectAccessible(page);
    });
  }

  test("200% zoom (1280px window) keeps the waiting home usable without horizontal scrolling", async ({ page }) => {
    await portal(page, "/dashboard", { history: false, width: 640 });
    await expect(page.getByText("Early access · Waiting for an invitation")).toBeVisible();
    await expectAccessible(page);
  });
});
