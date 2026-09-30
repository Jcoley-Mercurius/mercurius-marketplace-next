import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

// TRACE-103 (R0.3): public early-access form, result and account continuation. Scripted
// route and Supabase responses only; the TRACE-102 route and database contracts are proven
// by tests/unit/early-access.test.ts, SQL 069 and scripts/r0-interest-concurrency.mjs.
const app = "http://127.0.0.1:3103";
const supabase = "http://127.0.0.1:55831";
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const categories = [{ id: "outdoor", name: "Outdoor" }, { id: "indoor", name: "Indoor" }];
const services = [
  { id: "lawn-mowing", name: "Lawn Mowing", category_id: "outdoor" },
  { id: "pool-cleaning", name: "Pool Cleaning", category_id: "outdoor" },
  { id: "deep-cleaning", name: "Deep Cleaning", category_id: "indoor" },
];

type Reply = { status?: number; json?: unknown; abort?: boolean };
type Setup = {
  width?: number;
  theme?: string;
  query?: string;
  signedIn?: boolean;
  catalogFails?: (attempt: number) => boolean;
  join?: (body: Record<string, unknown>, count: number) => Reply;
  signUp?: () => Reply;
};

async function open(page: Page, setup: Setup = {}) {
  const joins: Record<string, unknown>[] = [];
  const signUps: Record<string, unknown>[] = [];
  let catalogReads = 0;
  if (setup.signedIn) await syntheticSession(page.context(), "homeowner");
  await page.setViewportSize({ width: setup.width ?? 390, height: 900 });
  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === app) {
      if (url.pathname === "/api/early-access") {
        const body = request.postDataJSON() as Record<string, unknown>;
        joins.push(body);
        const reply = setup.join?.(body, joins.length) ?? { status: 201, json: { outcome: "saved", kind: body.kind } };
        if (reply.abort) return route.abort("failed");
        return route.fulfill({ status: reply.status ?? 201, json: reply.json ?? {} });
      }
      return url.pathname.startsWith("/api/") ? route.abort() : route.continue();
    }
    if (url.origin !== supabase) return route.abort();
    if (url.pathname === "/rest/v1/service_categories") return route.fulfill({ json: categories });
    if (url.pathname === "/rest/v1/services_catalog") {
      catalogReads += 1;
      if (setup.catalogFails?.(catalogReads)) return route.fulfill({ status: 500, json: { message: "Synthetic outage" } });
      return route.fulfill({ json: services });
    }
    if (url.pathname === "/auth/v1/signup") {
      signUps.push(request.postDataJSON() as Record<string, unknown>);
      const reply = setup.signUp?.() ?? { status: 200, json: { id: "00000000-0000-4000-8000-0000000000e1", aud: "authenticated", role: "", email: "new@example.invalid", identities: [], user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() } };
      return route.fulfill({ status: reply.status ?? 200, json: reply.json });
    }
    return route.continue();
  });
  await page.addInitScript((theme) => localStorage.setItem("theme", theme), setup.theme ?? "light");
  await page.goto(`/early-access${setup.query ?? ""}`);
  await expect(page.getByRole("heading", { level: 2, name: "Join early access" })).toBeVisible();
  return { joins, signUps, catalogReads: () => catalogReads };
}

const form = (page: Page) => page.getByRole("form", { name: "Join early access" });
const services_ = (page: Page) => page.getByRole("group", { name: "Services you’re interested in (required)" });
const submit = (page: Page) => form(page).getByRole("button", { name: "Join early access" });

async function fill(page: Page, { email = "homeowner@example.invalid", zip = "33904", service = "Lawn Mowing" }: { email?: string; zip?: string; service?: string | null } = {}) {
  await page.getByLabel("Email address (required)").fill(email);
  await page.getByLabel("ZIP code (required)").fill(zip);
  if (service) {
    const outdoor = services_(page).locator("summary", { hasText: "Outdoor" });
    if (!(await services_(page).getByLabel(service).isVisible())) await outdoor.click();
    await services_(page).getByLabel(service).check();
  }
}

async function expectAccessible(page: Page) {
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.locator("main, main form, main section").evaluateAll((elements) => elements.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.outerHTML.slice(0, 160)))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

test.describe("form composition and validation", () => {
  test("approved copy, labelled fields, catalog services and an unchecked marketing choice", async ({ page }) => {
    await open(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A better way to care for your home is on its way.");
    await expect(page.getByText("Lee County early access").first()).toBeVisible();
    for (const fact of ["Explore now", "Booking by invitation", "No payment to join"]) await expect(page.getByText(fact, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Email address (required)")).toHaveAttribute("type", "email");
    await expect(page.getByLabel("ZIP code (required)")).toHaveAccessibleDescription("Early access is for Lee County, Florida.");
    await expect(page.getByLabel("First name (optional)")).toBeVisible();
    await expect(services_(page).locator("summary")).toHaveText(["Outdoor", "Indoor"]);
    await expect(page.getByLabel("I’m still exploring")).not.toBeChecked();
    await expect(page.getByLabel("Also send me Mercurius news, offers and product updates (optional)")).not.toBeChecked();
    await expect(page.getByText("Joining does not create a service request or guarantee an invitation.")).toBeVisible();
    // Nothing beyond the approved minimum is collected.
    await expect(form(page).locator("input:not([type=checkbox]):not([name=company_fax])")).toHaveCount(3);
    await expect(page.getByLabel(/phone|address line|street/i)).toHaveCount(0);
  });

  test("an empty submission is summarized, linked to each field and sends nothing", async ({ page }) => {
    const { joins } = await open(page);
    await submit(page).click();
    const summary = page.getByRole("region", { name: "Please check your answers" });
    await expect(summary).toBeFocused();
    await expect(summary.getByRole("link")).toHaveText(["Enter a valid email address.", "Enter a five-digit ZIP code.", "Choose at least one service, or choose “I’m still exploring.”"]);
    await summary.getByRole("link", { name: /Choose at least one service/ }).click();
    await expect(services_(page)).toBeFocused();
    await expect(page.getByLabel("Email address (required)")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Email address (required)")).toHaveAccessibleDescription("Enter a valid email address.");
    expect(joins).toHaveLength(0);
  });

  test("service context preselects catalog services; still exploring replaces them", async ({ page }) => {
    const { joins } = await open(page, { query: "?service=pool-cleaning&service=not-in-catalog" });
    await expect(services_(page).getByLabel("Pool Cleaning")).toBeChecked();
    await expect(services_(page).locator("details").first()).toHaveAttribute("open", "");
    await expect(services_(page).locator("summary", { hasText: "Outdoor" })).toContainText("1 selected");
    await page.getByLabel("I’m still exploring").check();
    await expect(services_(page).getByLabel("Pool Cleaning")).not.toBeChecked();
    await expect(services_(page).locator("details").first()).toHaveAttribute("open", "");
    await fill(page, { service: null });
    await submit(page).click();
    await expect(page.getByRole("heading", { name: "You’re on the early-access list." })).toBeFocused();
    expect(joins[0]).toMatchObject({ service_ids: [], still_exploring: true });
  });

  test("a catalog failure is shown and retryable, and never replaced by a static list", async ({ page }) => {
    const opened = await open(page, { catalogFails: (attempt) => attempt === 1 });
    await expect(services_(page).getByRole("alert")).toContainText("Services couldn’t be loaded.");
    await expect(services_(page).locator("summary")).toHaveCount(0);
    await services_(page).getByRole("button", { name: "Try again" }).click();
    await expect(services_(page).locator("summary")).toHaveText(["Outdoor", "Indoor"]);
    expect(opened.catalogReads()).toBe(2);
  });
});

test.describe("submission results", () => {
  test("a confirmed save sends the minimal payload, focuses the result and offers an optional account", async ({ page }) => {
    const { joins } = await open(page);
    await fill(page);
    await submit(page).click();
    const heading = page.getByRole("heading", { name: "You’re on the early-access list." });
    await expect(heading).toBeFocused();
    expect(Object.keys(joins[0]).sort()).toEqual(["email", "first_name", "intake", "kind", "marketing_opt_in", "service_ids", "still_exploring", "zip_code"]);
    expect(joins[0]).toMatchObject({ kind: "early_access", email: "homeowner@example.invalid", first_name: null, zip_code: "33904", service_ids: ["lawn-mowing"], still_exploring: false, marketing_opt_in: false, intake: { trap: "" } });
    await expect(page.getByText("We’ll invite homeowners in stages when services are ready in their area. Joining did not book a service.")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Your early-access interest was saved." })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Create my account" })).toHaveAttribute("href", "/register?from=early-access");
    await expect(page.getByRole("link", { name: "Continue exploring" })).toHaveAttribute("href", "/services");
    // No claim of email delivery, queue position or reward.
    await expect(page.locator("main")).not.toContainText(/email (was )?sent|we(’|')ve emailed|position|place in line|credit/i);
    expect(await page.evaluate(() => sessionStorage.getItem("mercurius.earlyAccess.email"))).toBe("homeowner@example.invalid");
    expect(page.url()).not.toContain("example.invalid");
  });

  test("the marketing choice is independent and sent only when chosen", async ({ page }) => {
    const { joins } = await open(page);
    await fill(page);
    await page.getByLabel("First name (optional)").fill("  Sam ");
    await page.getByLabel("Also send me Mercurius news, offers and product updates (optional)").check();
    await submit(page).click();
    await expect(page.getByRole("heading", { name: "You’re on the early-access list." })).toBeVisible();
    expect(joins[0]).toMatchObject({ marketing_opt_in: true, first_name: "Sam" });
  });

  test("an out-of-area ZIP is explained, saves nothing, and expansion is a separate explicit choice", async ({ page }) => {
    const { joins } = await open(page, {
      join: (body) => body.kind === "early_access"
        ? { status: 409, json: { outcome: "boundary", kind: "early_access", error: "outside" } }
        : { status: 201, json: { outcome: "saved", kind: "expansion" } },
    });
    await fill(page, { zip: "10001" });
    await submit(page).click();
    const alert = page.getByRole("alert").filter({ hasText: "That ZIP code is outside Lee County" });
    await expect(alert).toBeFocused();
    await expect(alert).toContainText("10001 isn’t eligible for early access or a booking invitation");
    await expect(alert).toContainText("Nothing has been saved yet.");
    await expect(page.getByLabel("ZIP code (required)")).toHaveAttribute("aria-invalid", "true");
    await expectAccessible(page);
    await alert.getByRole("button", { name: "Save interest for my area" }).click();
    await expect(page.getByRole("heading", { name: "We’ve saved your interest in your area." })).toBeFocused();
    await expect(page.getByText("This doesn’t make you eligible for an early-access invitation, and it didn’t book a service.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Create my account" })).toHaveCount(0);
    expect(joins.map((body) => body.kind)).toEqual(["early_access", "expansion"]);
    expect({ ...joins[1], kind: "early_access", intake: null }).toEqual({ ...joins[0], intake: null });
  });

  test("changing the ZIP after a boundary answer clears it", async ({ page }) => {
    await open(page, { join: () => ({ status: 409, json: { outcome: "boundary", kind: "early_access" } }) });
    await fill(page, { zip: "10001" });
    await submit(page).click();
    await page.getByRole("button", { name: "Change ZIP code" }).click();
    await expect(page.getByLabel("ZIP code (required)")).toBeFocused();
    await expect(page.getByLabel("ZIP code (required)")).not.toHaveAttribute("aria-invalid", "true");
  });

  test("a refusal keeps typed answers and gives a contact path", async ({ page }) => {
    await open(page, { join: () => ({ status: 429, json: { error: "Please try again later." } }) });
    await fill(page);
    await submit(page).click();
    const alert = page.getByRole("alert").filter({ hasText: "We couldn’t accept this right now" });
    await expect(alert).toBeFocused();
    await expect(alert.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/contact");
    await expect(page.getByLabel("Email address (required)")).toHaveValue("homeowner@example.invalid");
    await expect(services_(page).getByLabel("Lawn Mowing")).toBeChecked();
  });

  test("a storage failure is never shown as success", async ({ page }) => {
    await open(page, { join: () => ({ status: 500, json: { error: "Your interest could not be saved. Please try again." } }) });
    await fill(page);
    await submit(page).click();
    await expect(page.getByRole("alert").filter({ hasText: "Your interest was not saved" })).toBeFocused();
    await expect(page.getByRole("heading", { name: /on the early-access list/ })).toHaveCount(0);
    await expect(page.getByLabel("ZIP code (required)")).toHaveValue("33904");
  });

  test("an unconfirmed submission is checked by resending the same payload", async ({ page }) => {
    const { joins } = await open(page, { join: (_body, count) => count === 1 ? { abort: true } : { status: 201, json: { outcome: "saved", kind: "early_access" } } });
    await fill(page);
    await submit(page).click();
    const alert = page.getByRole("alert").filter({ hasText: "We couldn’t confirm your submission" });
    await expect(alert).toBeFocused();
    await expect(alert).toContainText("the same email is never added twice");
    await alert.getByRole("button", { name: "Check submission" }).click();
    await expect(page.getByRole("heading", { name: "You’re on the early-access list." })).toBeFocused();
    expect(joins).toHaveLength(2);
    expect({ ...joins[1], intake: null }).toEqual({ ...joins[0], intake: null });
  });

  test("keyboard only: complete the form, open a category and submit", async ({ page }) => {
    const { joins } = await open(page);
    await page.getByLabel("Email address (required)").focus();
    await page.keyboard.type("homeowner@example.invalid");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("ZIP code (required)")).toBeFocused();
    await page.keyboard.type("33904");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("I’m still exploring")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(services_(page).locator("summary", { hasText: "Outdoor" })).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(services_(page).getByLabel("Lawn Mowing")).toBeFocused();
    await page.keyboard.press("Space");
    await submit(page).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "You’re on the early-access list." })).toBeFocused();
    expect(joins[0]).toMatchObject({ service_ids: ["lawn-mowing"] });
  });

  test("a signed-in visitor is pointed to the dashboard as well", async ({ page }) => {
    await open(page, { signedIn: true });
    await expect(page.getByRole("link", { name: "your dashboard" })).toHaveAttribute("href", "/dashboard");
  });
});

test.describe("optional account continuation", () => {
  test("the joined email is prefilled in the same tab only, and new and existing addresses get one neutral answer", async ({ page }) => {
    const answers: string[] = [];
    for (const existing of [false, true]) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await open(page, existing ? { signUp: () => ({ status: 422, json: { code: "user_already_exists", error_code: "user_already_exists", msg: "User already registered" } }) } : {});
      await fill(page);
      await submit(page).click();
      await page.getByRole("link", { name: "Create my account" }).click();
      await expect(page).toHaveURL(/\/register\?from=early-access$/);
      await expect(page.getByLabel("Email")).toHaveValue("homeowner@example.invalid");
      await expect(page.getByText("Creating an account doesn’t book a service or guarantee an invitation.")).toBeVisible();
      await page.getByLabel("First Name").fill("Synthetic");
      await page.getByLabel("Last Name").fill("Homeowner");
      await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
      await page.getByRole("button", { name: "Create Homeowner Account" }).click();
      const heading = page.getByRole("heading", { name: "Check your email" });
      await expect(heading).toBeFocused();
      answers.push(await page.locator("section[aria-labelledby=register-sent-heading]").innerText());
      await expect(page.getByRole("link", { name: "Go to sign in" })).toHaveAttribute("href", "/login");
      expect(await page.evaluate(() => sessionStorage.getItem("mercurius.earlyAccess.email"))).toBeNull();
    }
    expect(answers[1]).toBe(answers[0]);
    expect(answers[0]).toContain("If this email address can be used for a new account");
  });

  test("other sign-up errors still show, and public registration does not prefill", async ({ page }) => {
    await open(page, { signUp: () => ({ status: 422, json: { code: "weak_password", error_code: "weak_password", msg: "Password is too weak" } }) });
    await page.evaluate(() => sessionStorage.setItem("mercurius.earlyAccess.email", "homeowner@example.invalid"));
    await page.goto("/register");
    await expect(page.getByLabel("Email")).toHaveValue("");
    await page.getByLabel("First Name").fill("Synthetic");
    await page.getByLabel("Last Name").fill("Homeowner");
    await page.getByLabel("Email").fill("new@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
    await page.getByRole("button", { name: "Create Homeowner Account" }).click();
    await expect(page.getByText("Password is too weak")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check your email" })).toHaveCount(0);
  });
});

test.describe("truthful public entry points", () => {
  for (const path of ["/", "/homeowners", "/services", "/pricing", "/providers", "/how-it-works", "/faq"]) {
    test(`${path}: booking entry points lead to early access, not the request form`, async ({ page }) => {
      await page.route("**/*", (route) => [app, supabase].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(path);
      await expect(page.getByRole("banner").getByRole("link", { name: "Join early access" })).toHaveAttribute("href", "/early-access");
      await expect(page.locator('a[href^="/request"]')).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^(Request service|Request a Service|Start a Request|Start My Request|Book)/i })).toHaveCount(0);
    });
  }
});

test.describe("accessibility matrix", () => {
  for (const theme of ["light", "dark"]) {
    for (const width of [320, 390, 768, 1440]) {
      test(`form ${theme} ${width}px: axe and reflow`, async ({ page }) => {
        await open(page, { theme, width, query: "?service=lawn-mowing" });
        await expect(services_(page).getByLabel("Lawn Mowing")).toBeChecked();
        await expectAccessible(page);
      });
    }
    test(`result ${theme} 320px: axe and reflow`, async ({ page }) => {
      await open(page, { theme, width: 320 });
      await fill(page);
      await submit(page).click();
      await expect(page.getByRole("heading", { name: "You’re on the early-access list." })).toBeFocused();
      await expectAccessible(page);
    });
    test(`errors ${theme} 320px: axe and reflow`, async ({ page }) => {
      await open(page, { theme, width: 320 });
      await submit(page).click();
      await expect(page.getByRole("region", { name: "Please check your answers" })).toBeFocused();
      await expectAccessible(page);
    });
  }

  test("200% zoom (1280px window) keeps the form and result usable without horizontal scrolling", async ({ page }) => {
    // A 1280px window at 200% zoom lays out at 640 CSS pixels.
    await open(page, { width: 640 });
    await expectAccessible(page);
    await fill(page);
    await submit(page).click();
    await expect(page.getByRole("heading", { name: "You’re on the early-access list." })).toBeVisible();
    await expectAccessible(page);
  });

  test("targets are at least 44px", async ({ page }) => {
    await open(page, { width: 320, query: "?service=lawn-mowing" });
    const small = await page.locator("main").locator("button, a, summary, label:has(input[type=checkbox])").evaluateAll((elements) =>
      elements.filter((el) => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height < 44; }).map((el) => el.outerHTML.slice(0, 120)));
    expect(small).toEqual([]);
  });
});
