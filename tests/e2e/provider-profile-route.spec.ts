// TRACE-156 (P2B): the real /providers/[id] route renders the approved dynamic profile interior
// from the provider-scoped public reads. Every provider, offer, review and image is synthetic:
// the gallery's own fictional providers (profileFixtures.ts) are served through the same public
// reads the route makes, so the route and the approved gallery can be compared like for like.
// Nothing outside the app's origin is reachable, and nothing is written.
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { PROFILE_SCENARIOS, SYNTHETIC_COVERAGE_AREAS, SYNTHETIC_SERVICE_NAMES } from "../../src/components/mds/profiles/profileFixtures";
import type { ProfileData } from "../../src/lib/providerProfile/model";
import { syntheticSession } from "../fixtures/browser-session";

const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const widths = [320, 390, 768, 1024, 1440];
const shots = "test-results/provider-profile-route";

const IDS: Record<string, string> = {
  "brightbin-can-care": "00000000-0000-4000-8000-000000000b01",
  "harborline-remodeling": "00000000-0000-4000-8000-000000000b02",
  "palmetto-exterior-care": "00000000-0000-4000-8000-000000000b03",
  "northside-handyman": "00000000-0000-4000-8000-000000000b04",
  "caloosa-riverbend-property-care": "00000000-0000-4000-8000-000000000b05",
};
const scenario = (slug: string) => PROFILE_SCENARIOS.find((item) => item.slug === slug)!;
const PALMETTO = IDS["palmetto-exterior-care"];
const BRIGHTBIN = IDS["brightbin-can-care"];
const HARBORLINE = IDS["harborline-remodeling"];
const NORTHSIDE = IDS["northside-handyman"];

test.beforeAll(() => { mkdirSync(shots, { recursive: true }); });

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

// ---------------------------------------------------------------------------------------------
// The public reads, served from a fixture
// ---------------------------------------------------------------------------------------------

type Table = "vendor_packages" | "package_tiers" | "package_addons" | "package_qualifying_questions"
  | "contractor_gallery" | "contractor_service_zips" | "coverage_areas" | "services_catalog";
type Trial = "signed_out" | "invited" | "waiting" | "revoked" | "unavailable" | "not_homeowner" | "error" | "hold";

type Provider = { id: string; data: ProfileData; listed: boolean; questions: Record<string, unknown>[]; completed: number | null; business: Record<string, unknown> };

/** Mutable, so a test can change what the next read returns (withdrawal, refresh, recovery). */
type World = {
  providers: Map<string, Provider>;
  fail: Set<Table | "listing" | "reviews">;
  /** Serve this table one row short of its reported count: a capped response. */
  short: Set<Table>;
  /** Delay every read for this provider (ms), to test a response arriving late. */
  slow: Map<string, number>;
  trial: Trial;
  trialReads: number;
  reads: string[];
};

function provider(slug: string, extra: Partial<Provider> = {}): Provider {
  const data = scenario(slug).data;
  const id = IDS[slug];
  return {
    id, data: { ...data, provider: { ...data.provider, id } }, listed: true, completed: null, questions: [],
    business: { years_experience: null, our_promise: null, verified_specialty: null, video_url: null }, ...extra,
  };
}

const without = (row: Record<string, unknown>, ...keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));

const rowsFor = (world: World, table: Table): Record<string, unknown>[] => {
  const all = [...world.providers.values()];
  switch (table) {
    case "vendor_packages":
      return all.flatMap(({ id, data }) => data.packages.map((item) => without({ ...item, contractor_id: id }, "tiers", "addons")));
    case "package_tiers":
      return all.flatMap(({ data }) => data.packages.flatMap((item) => item.tiers.map((tier) => ({
        frequency: null, price_kind: null, price_max: null, includes: null, rule_question_key: null, rule_conditions: null, ...tier, package_id: item.id }))));
    case "package_addons":
      return all.flatMap(({ data }) => data.packages.flatMap((item) => item.addons.map((addon) => ({
        description: null, price_kind: null, price_max: null, unit_label: null, min_quantity: null, max_quantity: null, is_required: null, frequencies: null,
        ...addon, package_id: item.id }))));
    case "package_qualifying_questions":
      return all.flatMap(({ questions }) => questions);
    case "contractor_gallery":
      // contractor_gallery has no service link: every live photo is general business media.
      return all.flatMap(({ id, data }) => data.media.map((item) => without({ ...item, contractor_id: id }, "service_id")));
    case "contractor_service_zips":
      return all.flatMap(({ id, data }) => (data.serviceArea?.areas ?? []).flatMap((area) => area.zips.map((zip_code) => ({ contractor_id: id, zip_code }))));
    case "coverage_areas":
      return SYNTHETIC_COVERAGE_AREAS.map((area) => ({ ...area, is_active: true }));
    case "services_catalog":
      return Object.entries(SYNTHETIC_SERVICE_NAMES).map(([id, name]) => ({ id, name, is_active: true }));
  }
};

/** PostgREST filters as the reader sends them: eq., in.(…) and is.null. */
function matches(row: Record<string, unknown>, query: URLSearchParams) {
  for (const [key, raw] of query) {
    if (["select", "order", "offset", "limit"].includes(key) || !(key in row)) continue;
    const value = row[key];
    if (raw.startsWith("eq.") && String(value) !== raw.slice(3)) return false;
    if (raw.startsWith("in.(") && !raw.slice(4, -1).split(",").map((item) => item.replace(/^"|"$/g, "")).includes(String(value))) return false;
    if (raw === "is.null" && value != null) return false;
  }
  return true;
}

async function serveTable(world: World, table: Table, route: Route) {
  const url = new URL(route.request().url());
  world.reads.push(table);
  const owner = url.searchParams.get("contractor_id")?.slice(3);
  const delay = owner ? world.slow.get(owner) ?? 0 : 0;
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  if (world.fail.has(table)) return route.fulfill({ status: 500, json: { message: "Synthetic failure" } });
  const rows = rowsFor(world, table).filter((row) => matches(row, url.searchParams));
  const start = Number(url.searchParams.get("offset") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? rows.length);
  const available = world.short.has(table) ? rows.slice(0, Math.max(rows.length - 1, 0)) : rows;
  const body = available.slice(start, start + limit);
  return route.fulfill({
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-range": `${start}-${start + Math.max(body.length - 1, 0)}/${rows.length}`,
      "access-control-expose-headers": "content-range",
    },
    body: JSON.stringify(body),
  });
}

const trialCell = (state: string) => ({ zip_code: "33904", service_id: "gutter-cleaning", service_name: "Gutter cleaning", state, changed_at: "2026-11-01T12:00:00Z" });
const trialAccess: Partial<Record<Trial, unknown>> = {
  invited: { homeowner: true, cells: [trialCell("active")] },
  waiting: { homeowner: true, cells: [] },
  revoked: { homeowner: true, cells: [trialCell("revoked")] },
  unavailable: { homeowner: true, cells: [trialCell("unavailable")] },
  not_homeowner: { homeowner: false, cells: [] },
};

async function serve(page: Page, providers: Provider[], options: Partial<Pick<World, "trial">> = {}): Promise<World> {
  const world: World = {
    providers: new Map(providers.map((item) => [item.id, item])), fail: new Set(), short: new Set(), slow: new Map(),
    trial: options.trial ?? "signed_out", trialReads: 0, reads: [],
  };
  if (world.trial !== "signed_out") await syntheticSession(page.context(), "homeowner");
  // Later routes take precedence: anything the page reads that is not served below is empty.
  await page.route("**/rest/v1/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/rpc/**", (route) => route.fulfill({ json: null }));
  for (const table of ["vendor_packages", "package_tiers", "package_addons", "package_qualifying_questions", "contractor_gallery",
    "contractor_service_zips", "coverage_areas", "services_catalog"] as Table[]) {
    await page.route(`**/rest/v1/${table}?*`, (route) => serveTable(world, table, route));
  }
  await page.route("**/rest/v1/rpc/r0_public_providers", async (route) => {
    world.reads.push("listing");
    const body = route.request().postData();
    const requested = body ? (JSON.parse(body) as { p_contractor?: string }).p_contractor : undefined;
    const delay = requested ? world.slow.get(requested) ?? 0 : 0;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    if (world.fail.has("listing")) return route.fulfill({ status: 500, json: { message: "Synthetic failure" } });
    const listing = (item: Provider) => ({
      id: item.id, name: item.data.provider.name, logo_url: item.data.provider.logo_url, bio: item.data.provider.bio,
      location: item.data.provider.location, badges: item.data.provider.badges, tagline: item.data.provider.tagline, website: null, special_offer: null,
      services: [...new Set(item.data.packages.filter((pkg) => pkg.is_active && !pkg.needs_review).map((pkg) => pkg.service_id))],
      ...item.business,
    });
    const listed = [...world.providers.values()].filter((item) => item.listed);
    if (!requested) return route.fulfill({ json: listed.map(listing) });
    const found = listed.find((item) => item.id === requested);
    return route.fulfill({ json: found ? listing(found) : null });
  });
  await page.route("**/rest/v1/rpc/public_provider_reviews", (route) => {
    const id = (route.request().postDataJSON() as { _contractor_id: string })._contractor_id;
    const reviews = world.providers.get(id)?.data.reviews;
    return world.fail.has("reviews") || !reviews ? route.fulfill({ status: 500, json: { message: "Synthetic failure" } }) : route.fulfill({ json: reviews });
  });
  await page.route("**/rest/v1/rpc/get_completed_job_counts", (route) => route.fulfill({
    json: [...world.providers.values()].filter((item) => item.completed !== null).map((item) => ({ contractor_id: item.id, completed_jobs: item.completed })),
  }));
  await page.route("**/rest/v1/rpc/r0_my_trial_access", async (route) => {
    world.trialReads += 1;
    if (world.trial === "hold") return; // Never answered: admission stays unknown.
    if (world.trial === "error") return route.fulfill({ status: 500, json: { message: "Synthetic outage" } });
    return route.fulfill({ json: trialAccess[world.trial] ?? null });
  });
  return world;
}

async function open(page: Page, path: string, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await settle(page);
}

async function settle(page: Page) {
  await expect(page.locator("[data-profile]").or(page.getByRole("heading", { level: 1, name: /Provider (not found|profile unavailable)/ }))).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

const summary = (page: Page) => page.locator("[data-offer-summary]").filter({ visible: true });
const price = (page: Page) => summary(page).locator("[data-offer-price]");
const action = (page: Page) => page.locator("[data-next-step]").filter({ visible: true });
/** Chips are visually hidden radios inside their labels; a person clicks the label. */
const pick = (page: Page, name: string | RegExp) => page.locator("label").filter({ visible: true }).filter({ has: page.getByRole("radio", { name }) }).click();
const serviceParam = (page: Page) => new URL(page.url()).searchParams.get("service");
const dropdown = (page: Page) => page.getByRole("combobox", { name: "What can we help with?" });
const amounts = (page: Page) => page.locator("main").evaluate((el) => [...(el.textContent ?? "").matchAll(/\$[\d,.]+/g)].map(([match]) => match));

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const overflow = await page.locator("main, main section, main fieldset, main article, header").evaluateAll(
    (elements) => elements.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => `${el.tagName}.${el.className}`.slice(0, 80)));
  expect(overflow).toEqual([]);
}

const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(tags).analyze()).violations
  .flatMap((violation) => violation.nodes.map((node) => ({ id: violation.id, target: node.target.join(" ") })));

const palmettoLive = (extra: Partial<Provider> = {}) => provider("palmetto-exterior-care", {
  completed: 12,
  business: { years_experience: 9, our_promise: "Synthetic promise: we leave the property as we found it.", verified_specialty: "Exterior cleaning", video_url: null },
  questions: [{ id: "q-win", package_id: "pe-windows", question_key: "window_count", question_label: "How many windows?", input_type: "number", unit: "windows", options: null, is_required: true, sort_order: 0 }],
  ...extra,
});

// ---------------------------------------------------------------------------------------------
// Layout, accessibility and reflow at the required widths
// ---------------------------------------------------------------------------------------------

for (const width of widths) {
  test(`live profile at ${width}px: approved composition, axe and reflow`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await serve(page, [palmettoLive()]);
    await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`, width);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Palmetto Exterior Care");
    await expect(price(page)).toHaveText("$160");
    expect(await axe(page)).toEqual([]);
    await expectNoOverflow(page);
    expect(errors).toEqual([]);
    // One visible next action at every width, at least 44px tall.
    await expect(action(page)).toHaveCount(1);
    expect((await action(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${shots}/live-palmetto-gutter-${width}.png`, fullPage: true });
  });
}

// ---------------------------------------------------------------------------------------------
// Supported content, offers and extras
// ---------------------------------------------------------------------------------------------

test("keeps the provider's supported business information and labels photos as general business media", async ({ page }) => {
  await serve(page, [palmettoLive({ business: { years_experience: 9, our_promise: "Synthetic promise: we leave the property as we found it.", verified_specialty: "Exterior cleaning", video_url: "https://www.youtube.com/watch?v=synthetic01" } })]);
  await open(page, `/providers/${PALMETTO}`);
  const about = page.getByRole("region", { name: "About Palmetto Exterior Care" });
  await expect(about.locator('[data-business-fact="experience"]')).toContainText("9 years");
  await expect(about.locator('[data-business-fact="completed"]')).toContainText("12");
  await expect(about.locator('[data-business-fact="specialty"]')).toContainText("Exterior cleaning");
  await expect(about.getByText("Synthetic promise: we leave the property as we found it.")).toBeVisible();
  await expect(about.locator("iframe[title='Palmetto Exterior Care video']")).toHaveAttribute("src", "https://www.youtube.com/embed/synthetic01");
  await expect(about.getByText("Insured")).toBeVisible();
  // All services: business media needs no label. A service view says what the photos are.
  await expect(page.locator("[data-media-general]")).toHaveCount(0);
  await pick(page, "Window cleaning");
  await expect(page.locator("[data-media-general]")).toHaveText("General business photo · not specific to window cleaning");
  // No published service-question source exists, so no FAQ is shown.
  await expect(page.getByRole("heading", { name: /^Questions about/ })).toHaveCount(0);
  // Legacy promotions stay closed: no promotion read.
  await expect(page.getByText(/limited-time|special offer/i)).toHaveCount(0);
});

test("prices include required extras; optional extras are published information for the request step", async ({ page }) => {
  await serve(page, [palmettoLive()]);
  await open(page, `/providers/${PALMETTO}?service=window-cleaning`);
  // $140 starting level + the required $20 screen rinse.
  await expect(price(page)).toHaveText("From $160");
  await expect(summary(page)).toContainText("Required · included in the price shown");
  await expect(summary(page)).toContainText("Optional extras · chosen in the request step");
  await expect(summary(page)).toContainText("Not included in the price shown.");
  // No local extras controls and no local subtotal on a live profile.
  await expect(page.locator("[data-optional-extras]")).toHaveCount(0);
  await expect(page.locator("[data-price-preview]")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Add one|^Increase/ })).toHaveCount(0);
  await expect(summary(page)).toContainText("Set by your answers in the request step.");

  // A quote keeps its wording, with the estimate qualified and no deposit folded into it.
  await pick(page, "Pressure washing");
  await expect(price(page)).toHaveText("Quote after walkthrough");
  await expect(summary(page)).toContainText("From $180 estimate");
});

test("a deposit quote shows the deposit apart from the quote", async ({ page }) => {
  await serve(page, [provider("harborline-remodeling")]);
  await open(page, `/providers/${HARBORLINE}`);
  const withDeposit = scenario("harborline-remodeling").data.packages.find((item) => item.pricing_mode === "deposit_quote")!;
  await pick(page, SYNTHETIC_SERVICE_NAMES[withDeposit.service_id]);
  await expect(price(page)).toHaveText("Quote after walkthrough");
  await expect(summary(page).locator("[data-offer-deposit]")).toContainText(`A $${withDeposit.deposit_amount} deposit may apply`);
  await expect(summary(page).locator("[data-offer-deposit]")).toContainText("Nothing is charged with the initial request.");
});

test("the bedroom size guide appears beside the offer whose levels depend on it", async ({ page }) => {
  const sized = provider("northside-handyman", {
    data: {
      ...scenario("northside-handyman").data,
      provider: { ...scenario("northside-handyman").data.provider, id: NORTHSIDE },
      packages: [{ id: "ns-clean", service_id: "handyman", name: "Sized clean", description: null, pricing_mode: "fixed", default_frequency: "one-time",
        deposit_amount: null, is_active: true, needs_review: false, sort_order: 0, included_scope: [], addons: [],
        tiers: [{ id: "ns-s", name: "Small", price: 100, sort_order: 0, rule_conditions: [{ question_key: "bedrooms", max: 2 }] },
          { id: "ns-l", name: "Large", price: 180, sort_order: 1, rule_conditions: [{ question_key: "bedrooms", min: 3 }] }] }],
    },
    questions: [{ id: "q-bed", package_id: "ns-clean", question_key: "bedrooms", question_label: "Bedrooms", input_type: "number", unit: "bedrooms", options: null, is_required: true, sort_order: 0 }],
  });
  await serve(page, [sized]);
  await open(page, `/providers/${NORTHSIDE}?service=handyman`, 390);
  await expect(price(page)).toHaveText("From $100");
  await expect(summary(page).getByRole("heading", { name: "How we size your home" })).toHaveCount(1);
  await expect(summary(page)).toContainText("Prices are set by the number of bedrooms.");
});

// ---------------------------------------------------------------------------------------------
// Links, history and service changes
// ---------------------------------------------------------------------------------------------

test("direct and invalid service links resolve truthfully", async ({ page }) => {
  await serve(page, [palmettoLive()]);
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`, 390);
  await expect(dropdown(page)).toHaveValue("gutter-cleaning");

  // Withdrawn, unknown, inherited-name and malformed ids are never selected.
  for (const [query, named] of [["roof-cleaning", "Roof cleaning"], ["retired-service", null], ["__proto__", null], ["%3Cscript%3E", null]] as const) {
    await open(page, `/providers/${PALMETTO}?service=${query}`, 390);
    await expect(page.locator("[data-unavailable-service]")).toContainText(`${named ?? "The linked service"} is not currently offered by Palmetto Exterior Care.`);
    await expect(summary(page)).toHaveAttribute("data-offer-summary", "all");
    await expect(dropdown(page)).toHaveValue("");
  }

  // An unlisted provider and a malformed id have no profile, and the malformed id is not read.
  await open(page, "/providers/00000000-0000-4000-8000-00000000dead");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Provider not found");
  const world = await serve(page, [palmettoLive()]);
  await open(page, "/providers/not-a-provider");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Provider not found");
  expect(world.reads).toEqual([]);
});

test("a service change replaces the history entry, resets the package and keeps the ZIP", async ({ page }) => {
  await serve(page, [palmettoLive()]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.goto(`/providers/${PALMETTO}?service=gutter-cleaning&utm=synthetic`);
  await settle(page);
  const before = await page.evaluate(() => window.history.length);

  // Choose the quarterly cadence, then check a ZIP.
  await pick(page, /Quarterly/);
  await expect(price(page)).toHaveText("$130");
  await page.getByRole("textbox", { name: "ZIP code" }).fill("33901");
  await page.getByRole("button", { name: "Check ZIP" }).click();
  await expect(page.locator("[data-zip-result]")).toHaveAttribute("data-zip-result", "listed");

  await pick(page, "Window cleaning");
  await expect.poll(() => serviceParam(page)).toBe("window-cleaning");
  expect(new URL(page.url()).searchParams.get("utm")).toBe("synthetic");
  await expect(page.locator("[data-profile-announcement]")).toContainText("Showing Window cleaning");
  // The ZIP and its result stay, worked out again for the service now shown.
  await expect(page.getByRole("textbox", { name: "ZIP code" })).toHaveValue("33901");
  await expect(page.locator("[data-zip-result]")).toContainText("Eligibility for window cleaning");

  // Back to gutters: the earlier cadence is not restored.
  await pick(page, "Gutter cleaning");
  await expect(price(page)).toHaveText("$160");
  expect(await page.evaluate(() => window.history.length)).toBe(before);
  // Back leaves the profile in one step; Forward returns to the last service chosen.
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await settle(page);
  expect(serviceParam(page)).toBe("gutter-cleaning");
});

test("the phone dropdown and the desktop chips are one keyboard-operable choice", async ({ page }) => {
  await serve(page, [palmettoLive()]);
  await open(page, `/providers/${PALMETTO}`, 390);
  await dropdown(page).focus();
  await dropdown(page).selectOption("pressure-washing");
  await expect.poll(() => serviceParam(page)).toBe("pressure-washing");
  await expect(dropdown(page)).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 900 });
  const chip = page.getByRole("radio", { name: "Pressure washing" });
  await expect(chip).toBeChecked();
  await chip.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => serviceParam(page)).not.toBe("pressure-washing");
});

// ---------------------------------------------------------------------------------------------
// Failed and changed reads
// ---------------------------------------------------------------------------------------------

for (const [label, broken] of [["an extras read fails", { fail: "package_addons" }], ["a levels read fails", { fail: "package_tiers" }],
  ["an extras response is capped", { short: "package_addons" }]] as const) {
  test(`no price and no "nothing published" when ${label}`, async ({ page }) => {
    const world = await serve(page, [palmettoLive()]);
    if ("fail" in broken) world.fail.add(broken.fail);
    else world.short.add(broken.short);
    await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`);
    await expect(summary(page)).toHaveAttribute("data-offer-summary", "unavailable");
    await expect(summary(page)).toContainText("Prices unavailable right now");
    await expect(summary(page)).toContainText("This doesn't mean they have none.");
    await expect(page.locator("[data-unchecked-service]")).toContainText("Gutter cleaning can't be shown right now.");
    await expect(page.locator("[data-unavailable-service]")).toHaveCount(0);
    await expect(page.getByText(/No published services yet|not currently offered/)).toHaveCount(0);
    expect(await amounts(page)).toEqual([]);
    if (label === "an extras read fails") {
      expect(await axe(page)).toEqual([]);
      // Recovery: the next read prices the service again, with its required extra.
      world.fail.clear();
      await summary(page).getByRole("button", { name: "Try again" }).click();
      await expect(price(page)).toHaveText("$160");
    }
  });
}

test("reviews, photos and coverage that cannot be read say so, separately", async ({ page }) => {
  const world = await serve(page, [palmettoLive()]);
  world.fail.add("reviews").add("contractor_gallery").add("contractor_service_zips");
  await open(page, `/providers/${PALMETTO}`, 390);
  await expect(page.locator('[data-reviews="unavailable"]')).toContainText("Reviews could not be loaded");
  await expect(page.locator("[data-review-summary]")).toHaveText("Reviews unavailable");
  await expect(page.locator("[data-media-unavailable]")).toBeVisible();
  await expect(page.getByText("Service area unavailable")).toBeVisible();
  // Offers were read, so prices still show.
  await expect(page.locator("[data-service-row]").first()).toContainText("$");
});

test("background refresh: a withdrawn offer, a failed refresh and a withdrawn listing", async ({ page }) => {
  await page.clock.install();
  const world = await serve(page, [palmettoLive()]);
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`);
  await page.getByRole("textbox", { name: "ZIP code" }).fill("33901");
  await page.getByRole("button", { name: "Check ZIP" }).click();
  await expect(price(page)).toHaveText("$160");

  // The provider withdraws the gutter offer; the next refresh says so and keeps the ZIP.
  const live = world.providers.get(PALMETTO)!;
  live.data = { ...live.data, packages: live.data.packages.map((item) => item.id === "pe-gutters" ? { ...item, is_active: false } : item) };
  await page.clock.fastForward(61_000);
  await expect(page.locator("[data-unavailable-service]")).toContainText("Gutter cleaning is not currently offered by Palmetto Exterior Care.");
  await expect(page.locator("[data-profile-announcement]")).toContainText("The linked service is not currently offered.");
  await expect(page.getByRole("textbox", { name: "ZIP code" })).toHaveValue("33901");

  // A refresh that cannot read the listing keeps the profile but withdraws every price.
  world.fail.add("listing");
  await page.clock.fastForward(61_000);
  await expect(page.locator("[data-refresh-failed]")).toContainText("Prices are hidden until they can be confirmed again.");
  expect(await amounts(page)).toEqual([]);
  await expect(page.getByRole("textbox", { name: "ZIP code" })).toHaveValue("33901");

  // Recovery, then the provider leaves the public listing.
  world.fail.delete("listing");
  await page.locator("[data-refresh-failed]").getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("[data-refresh-failed]")).toHaveCount(0);
  live.listed = false;
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Provider not found");
});

test("a failed first read shows no substitute profile", async ({ page }) => {
  const world = await serve(page, [palmettoLive()]);
  world.fail.add("listing");
  await open(page, `/providers/${PALMETTO}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Provider profile unavailable");
  await expect(page.getByText("No substitute profile data has been shown.")).toBeVisible();
  world.fail.delete("listing");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Palmetto Exterior Care");
});

// ---------------------------------------------------------------------------------------------
// Provider changes
// ---------------------------------------------------------------------------------------------

test("moving to another provider resets its state and a late response cannot leak across", async ({ page }) => {
  const world = await serve(page, [palmettoLive(), provider("brightbin-can-care")]);
  world.fail.add("reviews");
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`);
  await pick(page, /Quarterly/);
  await page.getByRole("textbox", { name: "ZIP code" }).fill("33901");
  await page.getByRole("button", { name: "Check ZIP" }).click();
  await expect(page.locator("[data-zip-result]")).toBeVisible();

  // Start a slow Palmetto read (the reviews retry), then leave for Brightbin by client-side
  // navigation before it answers. Next.js exposes its router on window for debugging.
  world.fail.delete("reviews");
  world.slow.set(PALMETTO, 2_500);
  await page.locator('[data-reviews="unavailable"]').getByRole("button", { name: "Try again" }).click();
  await page.evaluate((id) => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(`/providers/${id}`), BRIGHTBIN);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Brightbin Can Care");
  await expect(page.getByRole("textbox", { name: "ZIP code" })).toHaveValue("");
  await expect(page.locator("[data-zip-result]")).toHaveCount(0);
  await expect(summary(page)).toHaveAttribute("data-offer-summary", "all");
  // After Palmetto's slow responses would have landed, Brightbin is still shown.
  await page.waitForTimeout(3_000);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Brightbin Can Care");
  await expect(page.getByText("Palmetto Exterior Care")).toHaveCount(0);
  await expect(page.locator("[data-profile]")).toHaveAttribute("data-profile", BRIGHTBIN);
});

// ---------------------------------------------------------------------------------------------
// Directory return
// ---------------------------------------------------------------------------------------------

test("directory search, category and provider position come back from the profile", async ({ page }) => {
  await serve(page, [palmettoLive(), provider("brightbin-can-care"), provider("harborline-remodeling"), provider("northside-handyman")]);
  await page.route("**/rest/v1/service_categories?*", (route) => route.fulfill({ json: [
    { id: "exterior", name: "Exterior Care", description: null, icon: "Leaf" },
  ] }));
  await page.route("**/rest/v1/services_catalog?*", (route) => route.fulfill({ json: Object.entries(SYNTHETIC_SERVICE_NAMES).map(([id, name]) => ({
    id, name, category_id: ["gutter-cleaning", "window-cleaning", "pressure-washing", "trash-can-cleaning"].includes(id) ? "exterior" : "other", is_active: true })) }));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/providers");
  await expect(page.locator(".animate-pulse")).toHaveCount(0, { timeout: 20_000 });
  await page.getByLabel("Search providers").fill("Fort Myers");
  const card = page.locator(`[data-directory-category="exterior"] [data-provider-card="${PALMETTO}"]`);
  const link = card.getByRole("link", { name: /^View profile/ });
  // The card opens on its category's lead service and carries the directory's state.
  await expect(link).toHaveAttribute("href", `/providers/${PALMETTO}?service=window-cleaning&q=Fort+Myers&category=exterior`);
  await link.click();
  await settle(page);
  expect(serviceParam(page)).toBe("window-cleaning");
  const back = page.getByRole("link", { name: "Providers", exact: true });
  await expect(back).toHaveAttribute("href", `/providers?q=Fort+Myers&category=exterior&provider=${PALMETTO}`);

  // The profile's own return link.
  await back.click();
  await expect(page.getByLabel("Search providers")).toHaveValue("Fort Myers");
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport();
  await expect(page).toHaveURL(/\/providers\?q=Fort\+Myers$/);

  // The browser's Back, after several service changes on the profile.
  await link.click();
  await settle(page);
  await dropdown(page).selectOption("pressure-washing");
  await dropdown(page).selectOption("gutter-cleaning");
  await page.goBack();
  await expect(page.getByLabel("Search providers")).toHaveValue("Fort Myers");
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport();

  // A crafted return address cannot leave the directory.
  await page.goto(`/providers/${PALMETTO}?q=x&category=%2F%2Fevil.invalid&return=https://evil.invalid`);
  await settle(page);
  await expect(page.getByRole("link", { name: "Providers", exact: true })).toHaveAttribute("href", `/providers?q=x&provider=${PALMETTO}`);
});

// ---------------------------------------------------------------------------------------------
// Access and request continuation
// ---------------------------------------------------------------------------------------------

/** Records what the profile hands the request step: the navigation is client-side, so it survives. */
async function captureHandoff(page: Page) {
  await page.evaluate(() => {
    const store = window.sessionStorage;
    const original = store.setItem.bind(store);
    (window as unknown as { handoff: Record<string, unknown> }).handoff = {};
    store.setItem = (key: string, value: string) => {
      (window as unknown as { handoff: Record<string, unknown> }).handoff[key] = JSON.parse(value);
      original(key, value);
    };
  });
}
const handoff = (page: Page) => page.evaluate(() => (window as unknown as { handoff: Record<string, { requestedServices?: Record<string, unknown>[] } & Record<string, unknown>> }).handoff);

test("a visitor who is not signed in joins early access with the chosen service", async ({ page }) => {
  await serve(page, [palmettoLive()]);
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`, 390);
  await expect(action(page)).toHaveText("Join early access");
  await action(page).click();
  await expect(page).toHaveURL(/\/early-access\?service=gutter-cleaning$/);
});

test("an invited homeowner continues to the request with provider, package, service and cadence bound", async ({ page }) => {
  await serve(page, [palmettoLive()], { trial: "invited" });
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`);
  await pick(page, /Quarterly/);
  await captureHandoff(page);
  await expect(action(page)).toHaveText("Continue to request");
  await action(page).click();
  await expect(page).toHaveURL(new RegExp(`/request\\?provider=${PALMETTO}&providerName=Palmetto\\+Exterior\\+Care&requested=Gutter\\+cleaning&service=gutter-cleaning$`));
  const sent = await handoff(page);
  expect(sent.preferredProviderSelection).toEqual({ contractorId: PALMETTO, contractorName: "Palmetto Exterior Care", serviceId: "gutter-cleaning" });
  const [requested] = sent.homePlanSelection.requestedServices!;
  expect(requested).toMatchObject({
    id: "gutter-cleaning", packageId: "pe-gutters", pricingMode: "fixed", defaultFrequency: "quarterly",
    // The quarterly cadence publishes one level without a rule, so it is bound.
    tierId: "pe-gutters-qtr", prices: { "one-time": 160, quarterly: 130 },
  });
  expect(JSON.stringify(sent)).not.toMatch(/promotion|basePrice/i);
});

test("an answer-based level is never bound as the homeowner's level, and its questions travel", async ({ page }) => {
  await serve(page, [palmettoLive()], { trial: "invited" });
  await open(page, `/providers/${PALMETTO}?service=window-cleaning`);
  await captureHandoff(page);
  await action(page).click();
  await expect(page).toHaveURL(/\/request\?/);
  const [requested] = (await handoff(page)).homePlanSelection.requestedServices!;
  expect(requested.packageId).toBe("pe-windows");
  expect(requested.tierId).toBeUndefined();
  expect(requested.tierName).toBeUndefined();
  expect((requested.questions as Array<{ question_key: string }>).map((question) => question.question_key)).toEqual(["window_count"]);
});

test("unreadable questions are left to the request step rather than sent as none", async ({ page }) => {
  const world = await serve(page, [palmettoLive()], { trial: "invited" });
  world.fail.add("package_qualifying_questions");
  await open(page, `/providers/${PALMETTO}?service=window-cleaning`);
  await captureHandoff(page);
  await action(page).click();
  await expect(page).toHaveURL(/\/request\?/);
  const [requested] = (await handoff(page)).homePlanSelection.requestedServices!;
  expect("questions" in requested).toBe(false);
});

test("All services asks an invited homeowner to choose a service first", async ({ page }) => {
  await serve(page, [palmettoLive()], { trial: "invited" });
  await open(page, `/providers/${PALMETTO}`, 390);
  await expect(action(page)).toHaveText("Request this provider");
  await action(page).click();
  await expect(dropdown(page)).toBeFocused();
  await expect(page.locator("[data-profile-announcement]")).toHaveText("Choose a service to request from Palmetto Exterior Care.");
  expect(new URL(page.url()).pathname).toBe(`/providers/${PALMETTO}`);
});

for (const [trial, label, destination, service] of [
  ["waiting", "See my early-access status", "/dashboard", null],
  ["revoked", "Go to my dashboard", "/dashboard", null],
  ["unavailable", "Go to my dashboard", "/dashboard", null],
  ["not_homeowner", "Join early access", "/early-access", "gutter-cleaning"],
] as const) {
  test(`a ${trial} account is not offered a request`, async ({ page }) => {
    await serve(page, [palmettoLive()], { trial });
    await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`, 390);
    await expect(action(page)).toHaveText(label);
    await expect(page.getByRole("button", { name: /Continue to request|Request a quote/ })).toHaveCount(0);
    // The destination may redirect a synthetic session, so the navigation itself is asserted.
    const navigation = page.waitForRequest((request) => new URL(request.url()).pathname === destination);
    await action(page).click();
    const url = new URL((await navigation).url());
    expect(url.searchParams.get("service")).toBe(service);
  });
}

test("unknown admission offers nothing bookable; a failed read can be retried", async ({ page }) => {
  const world = await serve(page, [palmettoLive()], { trial: "hold" });
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`, 390);
  await expect(action(page)).toHaveText("Checking booking access");
  await expect(action(page)).toHaveAttribute("aria-busy", "true");
  await action(page).click({ force: true });
  expect(new URL(page.url()).pathname).toBe(`/providers/${PALMETTO}`);

  world.trial = "error";
  await page.reload();
  await settle(page);
  await expect(action(page)).toHaveText("Check booking access again");
  const reads = world.trialReads;
  world.trial = "invited";
  await action(page).click();
  await expect(action(page)).toHaveText("Continue to request");
  expect(world.trialReads).toBeGreaterThan(reads);
});

// ---------------------------------------------------------------------------------------------
// Illustrative service photos (TRACE-156 P2C)
// ---------------------------------------------------------------------------------------------

const illustration = (page: Page) => page.locator("[data-service-illustration]");
const imageryShots = "test-results/provider-profile-imagery";
const imageLoaded = (page: Page) => expect.poll(() => illustration(page).locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
async function showIllustration(page: Page) {
  await illustration(page).scrollIntoViewIfNeeded();
  await imageLoaded(page);
}

for (const width of [320, 768, 1440]) {
  test(`gallery cleanup ${width}px: unique slides and whole portrait/panorama images`, async ({ page }) => {
    const svg = (w: number, h: number, label: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="4" y="4" width="${w - 8}" height="${h - 8}" fill="#e7eee8" stroke="#263d35" stroke-width="8"/><text x="50%" y="50%" text-anchor="middle" font-size="24">${label}</text></svg>`)}`;
    const portrait = svg(300, 900, "Portrait");
    const panorama = svg(1200, 200, "Panorama");
    const item = palmettoLive();
    item.data = { ...item.data, media: [
      { id: "portrait", image_url: portrait, caption: "Portrait work photo", sort_order: 0 },
      { id: "portrait-copy", image_url: portrait, caption: "Duplicate upload", sort_order: 1 },
      { id: "panorama", image_url: panorama, caption: "Panoramic work photo", sort_order: 2 },
    ] };
    await serve(page, [item]);
    await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`, width);
    const gallery = page.locator('[data-profile-media="photo"]');
    await expect(gallery).toHaveCount(1);
    await expect(gallery.getByText("Business photos", { exact: true })).toBeVisible();
    await expect(gallery.getByText("1 of 2", { exact: true })).toBeVisible();
    for (const caption of ["Portrait work photo", "Panoramic work photo"]) {
      await expect(gallery.getByText(caption, { exact: true })).toBeVisible();
      await expect.poll(() => gallery.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      expect(await gallery.locator("img").evaluate((image) => getComputedStyle(image).objectFit)).toBe("contain");
      const box = (await gallery.locator("img").boundingBox())!;
      expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.03);
      await expectNoOverflow(page);
      await gallery.screenshot({ path: `${shots}/cleanup-${width}-${caption.startsWith("Portrait") ? "portrait" : "panorama"}.png` });
      await gallery.getByRole("button", { name: "Next photo" }).click();
    }
    await expect(gallery.getByText("1 of 2", { exact: true })).toBeVisible();
    await expect(gallery.getByText("Duplicate upload", { exact: true })).toHaveCount(0);
  });
}

test("a long provider name cannot stretch the service image beyond its reserved crop", async ({ page }) => {
  const item = palmettoLive();
  item.data = { ...item.data, provider: { ...item.data.provider, name: "Synthetic long provider name ".repeat(18) } };
  await serve(page, [item]);
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`, 768);
  await showIllustration(page);
  const box = (await illustration(page).locator("img").boundingBox())!;
  expect(Math.abs(box.width / box.height - 4 / 3)).toBeLessThan(0.03);
  await expectNoOverflow(page);
});

test("pool and gutter selections each keep exactly one matching service example", async ({ page }) => {
  const item = palmettoLive();
  const gutter = item.data.packages.find((offer) => offer.service_id === "gutter-cleaning")!;
  item.data = { ...item.data, packages: [...item.data.packages, { ...gutter, id: "synthetic-pool", service_id: "pool-service", name: "Pool cleaning" }] };
  await serve(page, [item]);
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`, 390);
  for (const service of ["pool-service", "gutter-cleaning", "pool-service"]) {
    await dropdown(page).selectOption(service);
    // Wait for this service's example first: the previous one is replaced as the view changes.
    await expect(illustration(page)).toHaveAttribute("data-service-illustration", service);
    await expect(illustration(page)).toHaveCount(1);
    await showIllustration(page);
    expect(await illustration(page).locator("img").evaluate((image: HTMLImageElement) => new URL(image.currentSrc).pathname)).toContain(`/images/services/${service}-`);
    await expect(page.locator("[data-profile-media]")).toHaveCount(1);
  }
});

test("a mapped service shows a labelled photo apart from the provider's own media", async ({ page }) => {
  const outside: string[] = [];
  page.on("request", (request) => { if (/unsplash|pexels|stocksnap|wordpress\.org|openverse/.test(request.url())) outside.push(request.url()); });
  await serve(page, [palmettoLive()]);
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`);
  await showIllustration(page);
  await expect(illustration(page)).toContainText("Illustrative service photo");
  await expect(illustration(page)).toContainText("It doesn't show Palmetto Exterior Care's team, work or results.");
  const image = illustration(page).locator("img");
  await expect(image).toHaveAttribute("alt", /^Illustrative photo of /);
  await expect(image).toHaveAttribute("loading", "lazy");
  await expect(image).toHaveAttribute("width", "960");
  await expect(image).toHaveAttribute("height", "540");
  expect(await image.evaluate((element: HTMLImageElement) => new URL(element.currentSrc).pathname)).toMatch(/^\/images\/services\/gutter-cleaning-(wide|compact)-\d+\.webp$/);
  // The provider's own media leads, keeps its own label and contains no stock photo.
  const portfolio = page.locator('[data-profile-media="photo"]');
  await expect(portfolio.locator("[data-media-general]")).toHaveText("General business photo · not specific to gutter cleaning");
  await expect(portfolio.locator('img[src*="/images/services/"]')).toHaveCount(0);
  await expect(portfolio.locator("[data-service-illustration]")).toHaveCount(0);
  expect(await portfolio.evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector("[data-service-illustration]")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  expect(outside).toEqual([]);
});

test("All services and a service with no mapped photo show no illustrative photo", async ({ page }) => {
  await serve(page, [palmettoLive()]);
  await open(page, `/providers/${PALMETTO}`);
  await expect(page.locator('[data-profile-media="photo"]')).toBeVisible();
  await expect(illustration(page)).toHaveCount(0);
  await open(page, `/providers/${PALMETTO}?service=window-cleaning`);
  await expect(page.locator("[data-media-general]")).toBeVisible();
  await expect(illustration(page)).toHaveCount(0);
  await expect(page.getByText("Illustrative service photo")).toHaveCount(0);
});

test("switching services changes the photo and leaves price and history behaviour intact", async ({ page }) => {
  await serve(page, [palmettoLive()]);
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`);
  await showIllustration(page);
  await expect(price(page)).toHaveText("$160");
  const entries = await page.evaluate(() => history.length);
  await pick(page, "Window cleaning");
  await expect(illustration(page)).toHaveCount(0);
  expect(serviceParam(page)).toBe("window-cleaning");
  await pick(page, "Gutter cleaning");
  await showIllustration(page);
  await expect(illustration(page)).toHaveAttribute("data-service-illustration", "gutter-cleaning");
  await expect(price(page)).toHaveText("$160");
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await pick(page, "All services");
  await expect(illustration(page)).toHaveCount(0);
});

test("a sparse profile keeps its business identity first and labels the photo", async ({ page }) => {
  await serve(page, [provider("northside-handyman")]);
  await open(page, `/providers/${NORTHSIDE}?service=handyman`, 390);
  const cover = page.locator('[data-profile-media="logo"]');
  await expect(cover).toBeVisible();
  await expect(cover.locator('img[src*="/images/services/"]')).toHaveCount(0);
  await showIllustration(page);
  await expect(illustration(page)).toContainText("It doesn't show Northside Handyman's team, work or results.");
  expect(await cover.evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector("[data-service-illustration]")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
});

test("a photo that fails to load removes the whole panel and nothing else", async ({ page }) => {
  await page.route("**/images/services/**", (route) => route.abort());
  await serve(page, [palmettoLive()]);
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`, 390);
  // The photo loads lazily, so bring it into view for the failure to happen.
  await page.evaluate(() => document.querySelector("[data-service-illustration]")?.scrollIntoView());
  await expect(illustration(page)).toHaveCount(0);
  await expect(page.getByText("Illustrative service photo")).toHaveCount(0);
  await expect(page.locator('[data-profile-media="photo"]')).toBeVisible();
  await expect(price(page)).toHaveText("$160");
  await expect(action(page)).toBeEnabled();
});

test("failed provider photos stay reported and are never replaced by the stock photo", async ({ page }) => {
  const world = await serve(page, [palmettoLive()]);
  world.fail.add("contractor_gallery");
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`);
  const cover = page.locator('[data-profile-media="logo"]');
  await expect(cover.locator("[data-media-unavailable]")).toHaveText("Photos for this provider could not be loaded.");
  await expect(cover.locator('img[src*="/images/services/"]')).toHaveCount(0);
  await showIllustration(page);
  await expect(illustration(page)).toContainText("Illustrative service photo");
});

test("provider video is kept, does not autoplay and no stock video is added", async ({ page }) => {
  await serve(page, [palmettoLive({ business: { years_experience: 9, our_promise: null, verified_specialty: null, video_url: "https://cdn.example.invalid/synthetic-provider-video.mp4" } })]);
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`);
  await showIllustration(page);
  const video = page.locator("video");
  await expect(video).toHaveCount(1);
  await expect(video).toHaveAttribute("src", "https://cdn.example.invalid/synthetic-provider-video.mp4");
  await expect(video).toHaveAttribute("controls", "");
  expect(await video.evaluate((element: HTMLVideoElement) => element.autoplay)).toBe(false);
  await expect(illustration(page).locator("video, iframe")).toHaveCount(0);
});

test("the request handoff is unchanged by the photo", async ({ page }) => {
  await serve(page, [palmettoLive()], { trial: "invited" });
  await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`);
  await showIllustration(page);
  await expect(action(page)).toHaveText("Continue to request");
  await action(page).click();
  await expect(page).toHaveURL(/\/request\?/);
  const params = new URL(page.url()).searchParams;
  expect(params.get("provider")).toBe(PALMETTO);
  expect(params.get("service")).toBe("gutter-cleaning");
});

for (const width of [320, 768, 1440]) {
  test(`illustrative photo at ${width}px: axe, reflow and reserved space`, async ({ page }) => {
    await serve(page, [palmettoLive()]);
    await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`, width);
    await showIllustration(page);
    expect(await axe(page)).toEqual([]);
    await expectNoOverflow(page);
    const box = await illustration(page).locator("img").boundingBox();
    const ratio = box!.width / box!.height;
    expect(Math.abs(ratio - (width < 640 ? 16 / 9 : 4 / 3))).toBeLessThan(0.05);
  });
}

// Review images for the owner's look at each photo state. They are not visual baselines.
const imageryStates: Array<[string, string, string]> = [
  ["real-media-and-photo", "palmetto-exterior-care", "?service=gutter-cleaning"],
  ["no-mapped-photo", "palmetto-exterior-care", "?service=window-cleaning"],
  ["sparse-portfolio", "northside-handyman", "?service=handyman"],
  ["single-service", "brightbin-can-care", "?service=trash-can-cleaning"],
];

for (const width of [390, 1440]) {
  test(`review images of the illustrative photo states at ${width}px`, async ({ page }) => {
    mkdirSync(imageryShots, { recursive: true });
    await serve(page, [palmettoLive(), provider("northside-handyman"), provider("brightbin-can-care")]);
    for (const [state, slug, query] of imageryStates) {
      await open(page, `/providers/${IDS[slug]}${query}`, width);
      if (await illustration(page).count()) await showIllustration(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${imageryShots}/${state}-${width}.png`, fullPage: true });
    }
    await page.route("**/images/services/**", (route) => route.abort());
    await open(page, `/providers/${PALMETTO}?service=gutter-cleaning`, width);
    await page.evaluate(() => document.querySelector("[data-service-illustration]")?.scrollIntoView());
    await expect(illustration(page)).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${imageryShots}/failed-photo-${width}.png`, fullPage: true });
  });
}

// ---------------------------------------------------------------------------------------------
// Comparison with the approved gallery (review images; not visual baselines)
// ---------------------------------------------------------------------------------------------

const comparisons: Array<[string, string]> = [
  ["palmetto-exterior-care", "?service=gutter-cleaning"],
  ["brightbin-can-care", ""],
  ["harborline-remodeling", "?service=interior-painting"],
  ["northside-handyman", ""],
];

for (const width of [390, 1440]) {
  test(`comparison images with the gallery at ${width}px`, async ({ page, request }) => {
    const gallery = await request.get("/mds/profiles");
    test.skip(gallery.status() !== 200, "The gallery is gated off in this build (MDS_CATALOG_ENABLED).");
    await serve(page, comparisons.map(([slug]) => slug === "palmetto-exterior-care" ? palmettoLive() : provider(slug)));
    for (const [slug, query] of comparisons) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/mds/profiles/${slug}${query}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0);
      await page.screenshot({ path: `${shots}/compare-${slug}-${width}-gallery.png`, fullPage: true });
      await open(page, `/providers/${IDS[slug]}${query}`, width);
      await page.screenshot({ path: `${shots}/compare-${slug}-${width}-live.png`, fullPage: true });
    }
  });
}
