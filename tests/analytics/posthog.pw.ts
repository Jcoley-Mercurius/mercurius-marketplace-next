import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { CONSENT_COOKIE } from "../../src/lib/analytics/policy";
import { PROFILE_SCENARIOS } from "../../src/components/mds/profiles/profileFixtures";
import { syntheticSession } from "../fixtures/browser-session";

type Event = { event: string; properties: Record<string, unknown> };
const host = "http://127.0.0.1:3104";

async function isolate(page: Page, options: { outage?: boolean } = {}) {
  // This synthetic lane exercises visitor collection, not the SDK's automation filter.
  await page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
  const events: Event[] = [];
  const replays: string[] = [];
  const requests: string[] = [];
  await page.route("**/*", async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.hostname.endsWith("posthog.com")) {
      requests.push(url.pathname);
      if (options.outage) return route.abort();
      if (/\/static\//.test(url.pathname)) return route.fulfill({ path: resolve("node_modules/posthog-js/dist", url.pathname.split("/").at(-1)!), contentType: "application/javascript" });
      if (/\/flags|\/array\/[^/]+\/config$/.test(url.pathname)) return route.fulfill({ json: { featureFlags: {}, sessionRecording: { endpoint: "/s/", sampleRate: "1", minimumDurationMilliseconds: 0, masking: { maskAllInputs: true, maskTextSelector: "*", maskAllElementAttributes: true, blockSelector: "img" }, urlBlocklist: [{ url: ".*[?#].*", matching: "regex" }] } } });
      const buffer = request.postDataBuffer();
      if (buffer) {
        let data = buffer;
        if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data);
        const text = data.toString();
        try {
          const parsed = JSON.parse(text); const rows = Array.isArray(parsed) ? parsed : parsed.batch ?? [parsed];
          for (const row of rows) { if (row.event === "$snapshot") replays.push(JSON.stringify(row)); else if (row.event) events.push(row); }
        } catch { /* The assertions below require readable captured outcomes, not request counts alone. */ }
      }
      return route.fulfill({ json: { status: 1 }, headers: { "Access-Control-Allow-Origin": "*" } });
    }
    if (url.port === "55832") {
      if (url.pathname.includes("/auth/")) return route.fulfill({ status: 401, json: { message: "Synthetic visitor" } });
      return route.fulfill({ json: [], headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
    }
    if (url.origin === host) return route.continue();
    return route.abort();
  });
  return { events, replays, requests };
}

test("no collection before consent; tagged campaign and navigation are redacted after opt-in; refusal stops future traffic", async ({ page }) => {
  const captured = await isolate(page);
  await page.goto("/faq?utm_source=facebook&utm_medium=paid-social&utm_campaign=lee-county&code=SECRET_CODE#access_token=SECRET_TOKEN");
  const panel = page.getByRole("region", { name: "Usage analytics preferences" });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(captured.requests).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("ph_")))).toEqual([]);
  await panel.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await expect(panel).not.toBeVisible();
  await expect.poll(() => captured.events.some(event => event.event === "$pageview")).toBe(true);
  const view = captured.events.find(event => event.event === "$pageview")!;
  expect(view.properties).toMatchObject({ utm_source: "facebook", utm_medium: "paid-social", utm_campaign: "lee-county", $current_url: host + "/faq" });
  expect(JSON.stringify(captured.events)).not.toMatch(/SECRET_CODE|SECRET_TOKEN|access_token/);
  expect(captured.replays).toEqual([]);
  await page.getByRole("link", { name: "Privacy Policy", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect.poll(() => captured.events.filter(event => event.event === "$pageview").length).toBe(2);
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  await panel.getByRole("button", { name: "Decline analytics", exact: true }).click();
  const previous = captured.events.length;
  await page.getByRole("link", { name: "Terms of Service", exact: true }).click();
  await expect(page).toHaveURL(/\/terms$/);
  // Give the SDK's batch timer a chance to expose an incorrectly retained queue.
  await page.waitForTimeout(3500);
  expect(captured.events.length).toBe(previous);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("ph_") && !k.includes("opt_in_out")))).toEqual([]);
});

test("masked public replay excludes text, attributes and inputs, and never records private forms", async ({ page }) => {
  await page.context().addCookies([{ name: CONSENT_COOKIE, value: "v1-granted", url: host }]);
  const captured = await isolate(page);
  await page.goto("/faq");
  await expect.poll(() => captured.requests.some(path => path.includes("recorder"))).toBe(true);
  await page.evaluate(() => {
    const element = document.createElement("section");
    element.innerHTML = '<p title="PRIVATE_REPLAY_ATTRIBUTE">PRIVATE_REPLAY_TEXT</p><input value="PRIVATE_REPLAY_INPUT"><img src="/PRIVATE_REPLAY_IMAGE.png">';
    document.querySelector("main")!.appendChild(element);
    element.querySelector("input")!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // Trigger a new snapshot before navigating, then wait for the SDK's recording batch.
  await page.getByRole("heading", { level: 1 }).click();
  await expect.poll(() => captured.replays.length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(captured.replays.join("\n")).not.toMatch(/PRIVATE_REPLAY_TEXT|PRIVATE_REPLAY_INPUT|PRIVATE_REPLAY_IMAGE|PRIVATE_REPLAY_ATTRIBUTE/);
  await page.getByRole("contentinfo").getByRole("link", { name: "Contact Us", exact: true }).click();
  await page.getByLabel("First Name", { exact: true }).fill("PRIVATE_CONTACT_NAME");
  await page.getByLabel("Email", { exact: true }).fill("private-contact@example.invalid");
  await page.getByRole("contentinfo").getByRole("link", { name: "FAQ", exact: true }).click();
  await expect.poll(() => captured.events.some(event => event.event === "$pageview" && event.properties.page === "/contact")).toBe(true);
  await page.goto("/login?redirect=%2Frequest&code=PRIVATE_AUTH_CODE");
  await page.getByLabel("Email", { exact: true }).fill("private-person@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("PRIVATE_PASSWORD_SENTINEL");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect.poll(() => captured.events.some(event => event.event === "login_failed")).toBe(true);
  expect(captured.replays.join("\n")).not.toMatch(/private-person|PRIVATE_PASSWORD|PRIVATE_AUTH_CODE|PRIVATE_CONTACT_NAME|private-contact/);
  expect(JSON.stringify(captured.events)).not.toMatch(/private-person|PRIVATE_PASSWORD|PRIVATE_AUTH_CODE|PRIVATE_CONTACT_NAME|private-contact/);
});

test("browser privacy signals keep tracking off and preferences are usable at 320px", async ({ page }) => {
  const captured = await isolate(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
  await page.context().addCookies([{ name: CONSENT_COOKIE, value: "v1-granted", url: host }]);
  await page.goto("/faq");
  await page.getByRole("button", { name: "Analytics preferences", exact: true }).click();
  const panel = page.getByRole("region", { name: "Usage analytics preferences" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "Allow analytics", exact: true })).toBeDisabled();
  expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include('section[aria-label="Usage analytics preferences"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  expect(captured.requests).toEqual([]);
  await page.screenshot({ path: "test-results/posthog-preferences-320.png", fullPage: false });
});

test("a blocked analytics service cannot stop browsing", async ({ page }) => {
  await isolate(page, { outage: true });
  await page.goto("/faq");
  await page.getByRole("button", { name: "Allow analytics", exact: true }).click();
  await page.getByRole("link", { name: "Privacy Policy", exact: true }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// TRACE-158 (Phase 7.4B): every approved browser event, asserted from the call site that fires it.
// Real pages, the real PostHog SDK and the installed listeners; isolate() above is unchanged and
// still answers every PostHog and Supabase request. The routes below only script the synthetic
// Supabase answers a scenario needs. Synthetic identifiers, addresses and content only.
// ---------------------------------------------------------------------------------------------

const supabase = "http://127.0.0.1:55832";
const homeownerId = "00000000-0000-4000-8000-000000000001";
const providerId = "00000000-0000-4000-8000-000000000b03";

/** Event properties other than SDK system keys (`$…`, `token`, `distinct_id`). */
const custom = (event: Event) => Object.fromEntries(Object.entries(event.properties).filter(([key]) => !/^\$|^token$|^distinct_id$/.test(key)));
const named = (events: Event[], name: string) => events.filter(event => event.event === name);
const consent = (page: Page) => page.context().addCookies([{ name: CONSENT_COOKIE, value: "v1-granted", url: host }]);
const synthetic = (pattern: string) => `${supabase}${pattern}`;
const user = (id: string, email: string) => ({ id, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, identities: [], created_at: "2026-11-01T12:00:00Z" });

test.describe("7.4B authentication outcomes (A-09 to A-12)", () => {
  async function signIn(page: Page, answer: "accepted" | "refused") {
    await page.route(synthetic("/auth/v1/token?grant_type=password"), route => answer === "accepted"
      ? route.fulfill({ json: { access_token: "synthetic-access", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "synthetic-refresh", user: user(homeownerId, "homeowner@example.invalid") } })
      : route.fulfill({ status: 400, json: { code: 400, error_code: "invalid_credentials", msg: "SYNTHETIC_AUTH_ERROR_TEXT" } }));
    await page.route(synthetic("/auth/v1/user"), route => route.fulfill({ json: user(homeownerId, "homeowner@example.invalid") }));
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("private-person@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("PRIVATE_PASSWORD_SENTINEL");
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
  }

  test("an accepted sign-in identifies the account once, then captures login_succeeded with no credential", async ({ page }) => {
    await consent(page);
    const captured = await isolate(page);
    await signIn(page, "accepted");
    await expect.poll(() => named(captured.events, "login_succeeded").length).toBe(1);
    const identify = named(captured.events, "$identify");
    expect(identify).toHaveLength(1);
    expect(identify[0].properties.distinct_id).toBe(homeownerId);
    // Identity is synced before the outcome is captured, so the outcome is attributed to it.
    expect(captured.events.findIndex(event => event.event === "$identify")).toBeLessThan(captured.events.findIndex(event => event.event === "login_succeeded"));
    const [succeeded] = named(captured.events, "login_succeeded");
    expect(custom(succeeded)).toEqual({ page: "/login" });
    expect(succeeded.properties.distinct_id).toBe(homeownerId);
    expect(named(captured.events, "login_failed")).toEqual([]);
    expect(JSON.stringify(captured.events)).not.toMatch(/private-person|PRIVATE_PASSWORD|synthetic-access|synthetic-refresh|homeowner@example/);
  });

  test("a refused sign-in captures login_failed only: no identity, no success and no error text", async ({ page }) => {
    await consent(page);
    const captured = await isolate(page);
    await signIn(page, "refused");
    await expect.poll(() => named(captured.events, "login_failed").length).toBe(1);
    expect(custom(named(captured.events, "login_failed")[0])).toEqual({ page: "/login" });
    // Give a misclassified or late outcome time to reach the interceptor.
    await page.waitForTimeout(1500);
    expect(named(captured.events, "login_succeeded")).toEqual([]);
    expect(named(captured.events, "$identify")).toEqual([]);
    expect(JSON.stringify(captured.events)).not.toMatch(/SYNTHETIC_AUTH_ERROR_TEXT|invalid_credentials|private-person|PRIVATE_PASSWORD/);
  });

  test("without consent an accepted sign-in sends nothing", async ({ page }) => {
    const captured = await isolate(page);
    await signIn(page, "accepted");
    await expect(page).not.toHaveURL(/\/login$/);
    await page.waitForTimeout(1500);
    expect(captured.requests).toEqual([]);
  });

  test("signup_submitted only when the auth provider accepts the signup, with no identity or form content", async ({ page }) => {
    await consent(page);
    const captured = await isolate(page);
    let accept = false;
    await page.route(synthetic("/auth/v1/signup*"), route => accept
      ? route.fulfill({ json: user("00000000-0000-4000-8000-0000000000c1", "new-person@example.invalid") })
      : route.fulfill({ status: 422, json: { code: 422, error_code: "weak_password", msg: "SYNTHETIC_SIGNUP_ERROR_TEXT" } }));
    await page.goto("/register");
    await page.getByLabel("First Name", { exact: true }).fill("PRIVATE_FIRST_NAME");
    await page.getByLabel("Last Name", { exact: true }).fill("PRIVATE_LAST_NAME");
    await page.getByLabel("Email", { exact: true }).fill("new-person@example.invalid");
    await page.getByLabel("Password", { exact: true }).fill("PRIVATE_PASSWORD_SENTINEL");
    await page.getByRole("button", { name: "Create Homeowner Account" }).click();
    await expect(page.getByText("SYNTHETIC_SIGNUP_ERROR_TEXT")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(named(captured.events, "signup_submitted")).toEqual([]);
    accept = true;
    await page.getByRole("button", { name: "Create Homeowner Account" }).click();
    await expect.poll(() => named(captured.events, "signup_submitted").length).toBe(1);
    expect(custom(named(captured.events, "signup_submitted")[0])).toEqual({ page: "/register" });
    // Signup is not sign-in: email verification is still pending, so no identity is sent.
    expect(named(captured.events, "$identify")).toEqual([]);
    expect(JSON.stringify(captured.events)).not.toMatch(/PRIVATE_|new-person|SYNTHETIC_SIGNUP_ERROR_TEXT|weak_password|0000000000c1/);
  });
});

test.describe("7.4B provider profile (A-05, A-06)", () => {
  const palmetto = PROFILE_SCENARIOS.find(item => item.slug === "palmetto-exterior-care")!.data;
  const strip = (row: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
  const tables: Record<string, Record<string, unknown>[]> = {
    vendor_packages: palmetto.packages.map(item => strip({ ...item, contractor_id: providerId }, "tiers", "addons")),
    package_tiers: palmetto.packages.flatMap(item => item.tiers.map(tier => ({ frequency: null, price_kind: null, price_max: null, includes: null, rule_question_key: null, rule_conditions: null, ...tier, package_id: item.id }))),
    package_addons: palmetto.packages.flatMap(item => item.addons.map(addon => ({ description: null, price_kind: null, price_max: null, unit_label: null, min_quantity: null, max_quantity: null, is_required: null, frequencies: null, ...addon, package_id: item.id }))),
  };

  /** One listed synthetic provider, served through the profile's public reads. */
  async function serveProfile(page: Page, listing: "listed" | "missing" | "error") {
    await page.route(synthetic("/rest/v1/**"), route => {
      const url = new URL(route.request().url());
      const rows = tables[url.pathname.split("/").at(-1)!] ?? [];
      const start = Number(url.searchParams.get("offset") ?? 0);
      const body = rows.slice(start, start + Number(url.searchParams.get("limit") ?? rows.length));
      return route.fulfill({ json: body, headers: { "content-range": `${start}-${start + Math.max(body.length - 1, 0)}/${rows.length}`, "access-control-expose-headers": "content-range", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
    });
    await page.route(synthetic("/rest/v1/rpc/**"), route => route.fulfill({ json: null, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } }));
    await page.route(synthetic("/rest/v1/rpc/r0_public_providers"), route => listing === "error"
      ? route.fulfill({ status: 500, json: { message: "Synthetic outage" } })
      : route.fulfill({ json: listing === "missing" ? null : { id: providerId, name: palmetto.provider.name, logo_url: null, bio: null, location: palmetto.provider.location, badges: [], tagline: null, website: null, special_offer: null, services: [...new Set(palmetto.packages.map(item => item.service_id))], years_experience: null, our_promise: null, verified_specialty: null, video_url: null } }));
  }

  test("provider_profile_viewed after a successful load, and service_viewed on an explicit service choice", async ({ page }) => {
    await consent(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    const captured = await isolate(page);
    await serveProfile(page, "listed");
    await page.goto(`/providers/${providerId}`);
    await expect(page.getByRole("heading", { level: 1, name: palmetto.provider.name })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => named(captured.events, "provider_profile_viewed").length).toBe(1);
    expect(custom(named(captured.events, "provider_profile_viewed")[0])).toEqual({ page: "/providers/[id]", provider_id: providerId });
    expect(named(captured.events, "service_viewed")).toEqual([]);
    await page.locator("label").filter({ visible: true }).filter({ has: page.getByRole("radio", { name: "Gutter cleaning" }) }).click();
    await expect.poll(() => named(captured.events, "service_viewed").length).toBe(1);
    expect(custom(named(captured.events, "service_viewed")[0])).toEqual({ page: "/providers/[id]", provider_id: providerId, service_id: "gutter-cleaning" });
    // Choosing a service is not another profile view.
    expect(named(captured.events, "provider_profile_viewed")).toHaveLength(1);
    expect(JSON.stringify(captured.events)).not.toMatch(/Palmetto Exterior Care|Fort Myers|service=/);
  });

  test("a profile opened before consent counts once the visitor opts in", async ({ page }) => {
    const captured = await isolate(page);
    await serveProfile(page, "listed");
    await page.goto(`/providers/${providerId}`);
    await expect(page.getByRole("heading", { level: 1, name: palmetto.provider.name })).toBeVisible({ timeout: 20_000 });
    expect(captured.requests).toEqual([]);
    await page.getByRole("region", { name: "Usage analytics preferences" }).getByRole("button", { name: "Allow analytics", exact: true }).click();
    await expect.poll(() => named(captured.events, "provider_profile_viewed").length).toBe(1);
    expect(custom(named(captured.events, "provider_profile_viewed")[0])).toEqual({ page: "/providers/[id]", provider_id: providerId });
    // The consent panel is a private element: its buttons are never captured.
    expect(named(captured.events, "button_clicked")).toEqual([]);
  });

  for (const listing of ["missing", "error"] as const) {
    test(`no provider_profile_viewed when the profile is ${listing === "missing" ? "not found" : "unreadable"}`, async ({ page }) => {
      await consent(page);
      const captured = await isolate(page);
      await serveProfile(page, listing);
      await page.goto(`/providers/${providerId}`);
      await expect(page.getByRole("heading", { level: 1, name: listing === "missing" ? "Provider not found" : "Provider profile unavailable" })).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => named(captured.events, "$pageview").length).toBe(1);
      await page.waitForTimeout(1500);
      expect(named(captured.events, "provider_profile_viewed")).toEqual([]);
    });
  }
});

test.describe("7.4B request intake (A-13 to A-15)", () => {
  const services = ["lawn-mowing", "house-cleaning"];
  const futureDate = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + days * 86_400_000));
  const draft = (step: string) => ({
    step, selectedIds: services, frequencies: { "lawn-mowing": "one-time", "house-cleaning": "one-time" },
    streetAddress: "123 Synthetic Test Lane", city: "Cape Coral", stateCode: "FL", zipCode: "33904", preferredDate: futureDate(2), preferredEndDate: futureDate(4),
    firstName: "PRIVATE_FIRST_NAME", lastName: "PRIVATE_LAST_NAME", email: "homeowner@example.invalid", phone: "2395550100",
  });
  type Selection = { service_id: string; expected?: { pricing_mode: string; total?: number } };
  const saved = (selections: Selection[], reused: boolean) => ({
    status: "submitted", coverage: "covered", reused,
    outcomes: selections.map((selection, index) => ({ selection_index: index, service_id: selection.service_id, outcome: "eligible_fixed", pricing_mode: "fixed", total: 100 })),
    requests: selections.map((selection, index) => ({ selection_index: index, request_id: `00000000-0000-4000-8000-0000000005${index}0`, service_id: selection.service_id, pricing_mode: "fixed", quote_only: false, total_amount: 100, package_id: "00000000-0000-4000-8000-0000000000f1", package_tier_id: "00000000-0000-4000-8000-0000000000f2" })),
  });
  const refused = { status: "refused", coverage: "covered", reused: false, requests: [], outcomes: [{ selection_index: 0, service_id: "lawn-mowing", outcome: "price_changed", pricing_mode: "fixed", total: 130 }] };

  /** A signed-in, invited homeowner with a seeded draft; the submission answers are scripted. */
  async function intake(page: Page, step: string, submit: (selections: Selection[], count: number) => unknown) {
    await consent(page);
    await syntheticSession(page.context(), "homeowner");
    await page.setViewportSize({ width: 1440, height: 900 });
    const captured = await isolate(page);
    const submissions: Selection[][] = [];
    const json = (body: unknown) => ({ json: body, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
    await page.route(`${host}/api/request-coverage*`, route => route.fulfill({ json: { status: "covered", area: { id: "a", zip_code: "33904", city: "Cape Coral", state: "FL", is_active: true, has_waitlist: false }, checkedZip: "33904" } }));
    await page.route(synthetic("/auth/v1/user"), route => route.fulfill({ json: user(homeownerId, "homeowner@example.invalid") }));
    await page.route(synthetic("/rest/v1/rpc/pricing_server_now"), route => route.fulfill(json(new Date().toISOString())));
    await page.route(synthetic("/rest/v1/rpc/r0_my_trial_access"), route => route.fulfill(json({ homeowner: true, cells: services.map(service_id => ({ zip_code: "33904", service_id, service_name: service_id, state: "active", changed_at: "2026-11-01T12:00:00Z" })) })));
    await page.route(synthetic("/rest/v1/rpc/homeowner_promotion_options"), route => route.fulfill(json({ available: false, credits: null, selections: [] })));
    await page.route(synthetic("/rest/v1/rpc/preview_service_request_selections"), route => {
      const payload = route.request().postDataJSON().p_payload as { stage: string; selections: Selection[] };
      return route.fulfill(json({ stage: payload.stage, coverage: "covered", outcomes: payload.selections.map((selection, index) => ({ selection_index: index, service_id: selection.service_id, outcome: "eligible_fixed", pricing_mode: "fixed", offering_mode: "fixed", total: 100, from_total: null, depends_on_answers: false, promotion: false, package_id: "00000000-0000-4000-8000-0000000000f1", tier_id: "00000000-0000-4000-8000-0000000000f2", question_details: [], scope: { package_name: "Synthetic package", package_description: "Synthetic scope", tier_name: "Synthetic tier", tier_includes: ["Synthetic edge"] } })) }));
    });
    await page.route(synthetic("/rest/v1/rpc/submit_service_requests"), route => {
      const selections = (route.request().postDataJSON() as { p_payload: { selections: Selection[] } }).p_payload.selections;
      submissions.push(selections);
      return route.fulfill(json(submit(selections, submissions.length)));
    });
    await page.route(synthetic("/rest/v1/rpc/start_request_matching"), route => route.fulfill(json("00000000-0000-4000-8000-0000000000aa")));
    await page.route(synthetic("/rest/v1/service_requests?*"), route => route.fulfill(json([])));
    await page.addInitScript(seed => {
      if (!sessionStorage.getItem("synthetic-seeded")) { sessionStorage.setItem("nextRequestFlowState", JSON.stringify(seed)); sessionStorage.setItem("synthetic-seeded", "1"); }
    }, draft(step));
    await page.goto("/request");
    return { captured, submissions };
  }
  const submitButton = (page: Page) => page.getByRole("button", { name: "Request service", exact: true });
  // Two services save two requests: "Your 2 requests are saved".
  const savedHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Your 2 requests are saved" });

  test("forward steps capture started and completed; Back then Continue fires request_started again (F-1, D-2); a fresh save captures request_submitted once", async ({ page }) => {
    const { captured, submissions } = await intake(page, "services", selections => saved(selections, false));
    const toDetails = () => page.getByRole("button", { name: "Continue to your home" }).filter({ visible: true }).first().click();
    await toDetails();
    await expect.poll(() => named(captured.events, "request_step_completed").length).toBe(1);
    expect(named(captured.events, "request_started").map(custom)).toEqual([{ page: "/request", service_count: 2 }]);
    expect(custom(named(captured.events, "request_step_completed")[0])).toEqual({ page: "/request", step: "services", service_count: 2 });
    // F-1: current behavior, pinned until owner decision D-2. The services step fires again.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await toDetails();
    await expect.poll(() => named(captured.events, "request_started").length).toBe(2);
    expect(named(captured.events, "request_step_completed").map(custom)).toEqual([{ page: "/request", step: "services", service_count: 2 }, { page: "/request", step: "services", service_count: 2 }]);
    await page.getByRole("button", { name: "Continue to review" }).click();
    await expect(page.getByRole("heading", { name: "Review and confirm" })).toBeVisible();
    await expect.poll(() => named(captured.events, "request_step_completed").length).toBe(3);
    expect(custom(named(captured.events, "request_step_completed")[2])).toEqual({ page: "/request", step: "details", service_count: 2 });
    expect(named(captured.events, "request_submitted")).toEqual([]);
    await submitButton(page).click();
    await expect(savedHeading(page)).toBeVisible();
    expect(submissions).toHaveLength(1);
    await expect.poll(() => named(captured.events, "request_submitted").length).toBe(1);
    expect(custom(named(captured.events, "request_submitted")[0])).toEqual({ page: "/request", service_count: 2 });
    await page.waitForTimeout(1500);
    expect(named(captured.events, "request_submitted")).toHaveLength(1);
    expect(named(captured.events, "request_started")).toHaveLength(2);
    expect(JSON.stringify(captured.events)).not.toMatch(/PRIVATE_|Synthetic Test Lane|Cape Coral|33904|homeowner@example|2395550100|lawn-mowing|house-cleaning/);
  });

  test("a reused (idempotent) save is shown as saved but never captured as request_submitted", async ({ page }) => {
    const { captured, submissions } = await intake(page, "contact", selections => saved(selections, true));
    await expect(submitButton(page)).toBeEnabled({ timeout: 20_000 });
    await submitButton(page).click();
    await expect(savedHeading(page)).toBeVisible();
    expect(submissions).toHaveLength(1);
    await page.waitForTimeout(1500);
    expect(named(captured.events, "$pageview").length).toBeGreaterThan(0);
    expect(named(captured.events, "request_submitted")).toEqual([]);
  });

  test("a refused submission captures nothing; the later fresh save captures once", async ({ page }) => {
    const { captured, submissions } = await intake(page, "contact", (selections, count) => count === 1 ? refused : saved(selections, false));
    await expect(submitButton(page)).toBeEnabled({ timeout: 20_000 });
    await submitButton(page).click();
    await expect(page.getByText(/Nothing was submitted\./).first()).toBeVisible();
    await page.waitForTimeout(1500);
    expect(named(captured.events, "request_submitted")).toEqual([]);
    await submitButton(page).click();
    await expect(savedHeading(page)).toBeVisible();
    expect(submissions).toHaveLength(2);
    await expect.poll(() => named(captured.events, "request_submitted").length).toBe(1);
    expect(custom(named(captured.events, "request_submitted")[0])).toEqual({ page: "/request", service_count: 2 });
  });
});

test.describe("7.4B installed listeners (A-02 to A-04)", () => {
  /** Synthetic click targets inside the real page; each cancels its own navigation after the capture-phase listener ran. */
  async function addTargets(page: Page) {
    return page.evaluate(id => {
      const section = document.createElement("section");
      section.innerHTML = `
        <a data-target="internal" href="/privacy">Internal</a>
        <a data-target="provider" href="/providers/${id}?ref=SECRET_QUERY#SECRET_FRAGMENT">Provider</a>
        <a data-target="external" href="https://example.invalid/privacy?PRIVATE_EXTERNAL=1">External</a>
        <a data-target="disallowed" href="/admin/PRIVATE_ADMIN">Admin</a>
        <a data-target="dashboard" href="/dashboard">Portal</a>
        <button type="button" data-target="button">BUTTON_LABEL_SENTINEL</button>
        <input data-target="input" value="PRIVATE_INPUT_VALUE">
        <div data-analytics-private><a data-target="private-link" href="/privacy">Private link</a><button type="button" data-target="private-button">PRIVATE_BUTTON_LABEL</button></div>`;
      section.addEventListener("click", event => event.preventDefault());
      document.querySelector("main")!.appendChild(section);
      return Array.from(document.querySelectorAll("button")).indexOf(section.querySelector('[data-target="button"]') as HTMLButtonElement);
    }, providerId);
  }
  const target = (page: Page, name: string) => page.locator(`[data-target="${name}"]`);

  test("navigation_clicked only for permitted internal destinations; button_clicked with only action and position; private, external and disallowed targets dropped", async ({ page }) => {
    await consent(page);
    const captured = await isolate(page);
    await page.goto("/faq");
    await expect.poll(() => named(captured.events, "$pageview").length).toBe(1);
    const buttonIndex = await addTargets(page);
    expect(buttonIndex).toBeGreaterThanOrEqual(0);
    for (const name of ["internal", "provider", "external", "disallowed", "dashboard", "private-link", "private-button", "input", "button"]) await target(page, name).click();
    await expect.poll(() => named(captured.events, "button_clicked").length).toBe(1);
    await page.waitForTimeout(1500);
    expect(named(captured.events, "navigation_clicked").map(custom)).toEqual([
      { page: "/faq", destination: "/privacy" },
      { page: "/faq", destination: "/providers/[id]", provider_id: providerId },
    ]);
    expect(named(captured.events, "button_clicked").map(custom)).toEqual([{ page: "/faq", action: "other", button_index: buttonIndex }]);
    expect(JSON.stringify(captured.events)).not.toMatch(/BUTTON_LABEL_SENTINEL|PRIVATE_|SECRET_QUERY|SECRET_FRAGMENT|example\.invalid|\/admin|\/dashboard/);
    // A real header link reaches the same listener and navigates.
    await page.getByRole("link", { name: "Privacy Policy", exact: true }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect.poll(() => named(captured.events, "navigation_clicked").length).toBe(3);
    expect(custom(named(captured.events, "navigation_clicked")[2])).toEqual({ page: "/faq", destination: "/privacy" });
  });

  test("page_scrolled once per milestone per page, reset by a new page; nothing before consent", async ({ page }) => {
    const captured = await isolate(page);
    await page.setViewportSize({ width: 1024, height: 600 });
    await page.goto("/faq");
    // The consent panel renders only on the client, so the page has hydrated before it is changed.
    await expect(page.getByRole("region", { name: "Usage analytics preferences" })).toBeVisible();
    // Make the page reliably tall: the scroll listener's milestones are relative to its height.
    await page.evaluate(() => { const spacer = document.createElement("div"); spacer.style.height = "4000px"; document.querySelector("main")!.appendChild(spacer); });
    const scrollTo = (fraction: number) => page.evaluate(value => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * value), fraction);
    await scrollTo(1);
    await page.waitForTimeout(500);
    expect(captured.requests).toEqual([]);
    await scrollTo(0);
    await page.getByRole("region", { name: "Usage analytics preferences" }).getByRole("button", { name: "Allow analytics", exact: true }).click();
    await expect.poll(() => named(captured.events, "$pageview").length).toBe(1);
    const depths = () => named(captured.events, "page_scrolled").map(event => custom(event).depth);
    await scrollTo(0.3);
    await expect.poll(depths).toEqual([25]);
    await scrollTo(0.1);
    await scrollTo(0.3);
    await scrollTo(0.6);
    await expect.poll(depths).toEqual([25, 50]);
    await scrollTo(1);
    await expect.poll(depths).toEqual([25, 50, 75, 100]);
    await scrollTo(0);
    await scrollTo(1);
    await page.waitForTimeout(1000);
    expect(depths()).toEqual([25, 50, 75, 100]);
    expect(named(captured.events, "page_scrolled").map(event => custom(event).page)).toEqual(["/faq", "/faq", "/faq", "/faq"]);
    // A new page starts its own milestones.
    await page.getByRole("link", { name: "Privacy Policy", exact: true }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect.poll(() => named(captured.events, "$pageview").length).toBe(2);
    await page.evaluate(() => { const spacer = document.createElement("div"); spacer.style.height = "4000px"; document.querySelector("main")!.appendChild(spacer); });
    await scrollTo(0.3);
    await expect.poll(() => named(captured.events, "page_scrolled").filter(event => custom(event).page === "/privacy").map(event => custom(event).depth)).toEqual([25]);
  });
});
