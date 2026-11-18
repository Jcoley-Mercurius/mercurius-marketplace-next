// TRACE-156 (P2A): the real /providers directory renders the approved provider card from
// published offers. Synthetic readbacks shaped like the current public reads; no Marketplace
// data, and no write of any kind.
//
// The normal fixtures follow the r0_public_providers contract
// (supabase/migrations/20261105001000_phase6_vendor_listing.sql): the `services` array it
// returns is derived from active catalog services that have a live, review-cleared, unarchived
// eligible offering — not the provider's declared services. A provider whose declared services
// have no such offering is still listable, and its derived array is simply empty. Responses that
// disagree with that contract are exercised separately, as explicitly defensive scenarios.
import { test, expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const widths = [320, 390, 768, 1024, 1440];
const shots = "test-results/provider-directory-cards";

test.beforeAll(() => { mkdirSync(shots, { recursive: true }); });

test.beforeEach(async ({ page, baseURL }) => {
  // Origin-agnostic so the same spec runs on the CI lane and on an isolated local port:
  // nothing but the app under test is reachable, and later routes take precedence.
  const origin = new URL(baseURL!).origin;
  await page.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

const categories = [
  { id: "outdoor", name: "Outdoor Care", description: "Yards, drives and exteriors.", icon: "Leaf" },
  { id: "interior", name: "Interior & Repair", description: "Inside the home.", icon: "Wrench" },
];

const servicesCatalog = [
  { id: "svc-lawn", name: "Lawn Mowing", category_id: "outdoor" },
  { id: "svc-pressure", name: "Pressure Washing", category_id: "outdoor" },
  { id: "svc-pest", name: "Pest Control", category_id: "outdoor" },
  { id: "svc-remodel", name: "Kitchen Remodel", category_id: "interior" },
  { id: "svc-handy", name: "Handyman Repairs", category_id: "interior" },
];

const provider = (id: string, name: string, services: string[], extra: Record<string, unknown> = {}) => ({
  id, name, logo_url: null, bio: `${name} synthetic description`, location: "Cape Coral, FL",
  badges: [], services, years_experience: 6, special_offer: null, our_promise: null, verified_specialty: null,
  tagline: null, video_url: null, website: null, ...extra,
});

const GREEN = "00000000-0000-4000-8000-000000000a01";
const HARBOR = "00000000-0000-4000-8000-000000000a02";
const COAST = "00000000-0000-4000-8000-000000000a03";
const SPARSE = "00000000-0000-4000-8000-000000000a04";
const NOOFFER = "00000000-0000-4000-8000-000000000a05";
/** Readable as a contractor row, absent from the public listing: it must never get a card. */
const HIDDEN = "00000000-0000-4000-8000-000000000a06";

const LONG_NAME = "Northside Handyman & Home Maintenance Services of Southwest Florida";

const providers = [
  provider(GREEN, "Greenline Yard Care", ["svc-lawn", "svc-remodel"]),
  provider(HARBOR, "Harborline Remodeling", ["svc-remodel"], { location: "Fort Myers, FL" }),
  provider(COAST, "Coastal Surface Pros", ["svc-pressure"]),
  // A broken logo: the request is blocked, so the card must fall back to initials.
  provider(SPARSE, LONG_NAME, ["svc-handy"], { logo_url: "https://synthetic.invalid/logo.png", location: null }),
  // Listable (its declared services include an active catalog service and it has content), but
  // no live offering, so the contract returns an empty services array.
  provider(NOOFFER, "Riverbend Lawn Collective", []),
];

const pkg = (row: Record<string, unknown>) => ({
  description: null, deposit_amount: null, is_active: true, needs_review: false, sort_order: 0, included_scope: null, ...row,
});

const packages = [
  pkg({ id: "pkg-lawn", contractor_id: GREEN, service_id: "svc-lawn", name: "Standard Mow", pricing_mode: "fixed", default_frequency: "one-time", included_scope: ["Up to 1/4 acre"] }),
  pkg({ id: "pkg-lawn-plan", contractor_id: GREEN, service_id: "svc-lawn", name: "Mowing Plan", pricing_mode: "fixed", default_frequency: "monthly", sort_order: 1 }),
  pkg({ id: "pkg-green-remodel", contractor_id: GREEN, service_id: "svc-remodel", name: "Kitchen Refresh", pricing_mode: "custom_quote", default_frequency: "one-time", sort_order: 2 }),
  pkg({ id: "pkg-remodel", contractor_id: HARBOR, service_id: "svc-remodel", name: "Kitchen Renovation", pricing_mode: "custom_quote", default_frequency: "one-time" }),
  pkg({ id: "pkg-press", contractor_id: COAST, service_id: "svc-pressure", name: "Driveway & Walkway Wash", pricing_mode: "deposit_quote", default_frequency: "one-time", deposit_amount: 150 }),
  pkg({ id: "pkg-handy", contractor_id: SPARSE, service_id: "svc-handy", name: "Handyman Half-Day", pricing_mode: "fixed", default_frequency: "one-time" }),
  // Why NOOFFER publishes nothing: one package is under review and the other is withdrawn.
  // Neither may price a card, even though both rows arrive.
  pkg({ id: "pkg-under", contractor_id: NOOFFER, service_id: "svc-lawn", name: "Weekly Mow", pricing_mode: "fixed", default_frequency: "weekly", needs_review: true }),
  pkg({ id: "pkg-off", contractor_id: NOOFFER, service_id: "svc-lawn", name: "Retired Mow", pricing_mode: "fixed", default_frequency: "one-time", is_active: false }),
  // An unlisted provider's package: the listing, not this row, decides who appears.
  pkg({ id: "pkg-hidden", contractor_id: HIDDEN, service_id: "svc-lawn", name: "Hidden Mow", pricing_mode: "fixed", default_frequency: "one-time" }),
];

const tier = (row: Record<string, unknown>) => ({
  frequency: null, price_kind: null, price_max: null, includes: null, rule_question_key: null, rule_conditions: null, sort_order: 0, ...row,
});

const tiers = [
  tier({ id: "t-lawn", package_id: "pkg-lawn", name: "Standard", price: 60 }),
  // Two monthly levels: the card shows the starting price, not the top one.
  tier({ id: "t-plan-b", package_id: "pkg-lawn-plan", name: "Large yard", price: 50, frequency: "monthly", sort_order: 1 }),
  tier({ id: "t-plan-a", package_id: "pkg-lawn-plan", name: "Small yard", price: 30, frequency: "monthly" }),
  tier({ id: "t-remodel", package_id: "pkg-remodel", name: "Typical kitchen", price: 2500, price_kind: "starting_at" }),
  tier({ id: "t-handy", package_id: "pkg-handy", name: "Half day", price: 95 }),
  tier({ id: "t-under", package_id: "pkg-under", name: "Weekly", price: 25, frequency: "weekly" }),
  tier({ id: "t-off", package_id: "pkg-off", name: "Retired", price: 20 }),
  tier({ id: "t-hidden", package_id: "pkg-hidden", name: "Hidden", price: 5 }),
];

const addons = [
  // Required, so the published starting price is $60 + $15.
  { id: "ad-bag", package_id: "pkg-lawn", name: "Clipping removal", description: null, price: 15, price_kind: null, price_max: null, unit_label: null, min_quantity: 1, max_quantity: 1, is_required: true, frequencies: null, sort_order: 0 },
  { id: "ad-edge", package_id: "pkg-lawn", name: "Edging", description: null, price: 10, price_kind: null, price_max: null, unit_label: null, min_quantity: 1, max_quantity: 2, is_required: false, frequencies: null, sort_order: 1 },
];

type Failure = "tiers" | "addons" | "packages" | null;
type Data = { providers?: unknown[]; packages?: unknown[]; width?: number; fail?: Failure; path?: string };

/**
 * A PostgREST-shaped page. `range()` travels as the `offset` and `limit` query parameters, and
 * the exact total comes back in `content-range`, which Supabase exposes to the browser.
 */
function windowOf(rows: unknown[], url: string) {
  const query = new URL(url).searchParams;
  const start = Number(query.get("offset") ?? 0);
  const limit = Number(query.get("limit") ?? rows.length);
  const body = rows.slice(start, start + limit);
  return {
    body,
    headers: {
      "content-range": `${start}-${start + Math.max(body.length - 1, 0)}/${rows.length}`,
      "access-control-expose-headers": "content-range",
      "access-control-allow-origin": "*",
    },
  };
}

const table = (page: Page, name: string, rows: unknown[], fails: boolean) => page.route(`**/rest/v1/${name}?*`, (route) => {
  if (fails) return route.fulfill({ status: 500, json: { message: "Synthetic failure" } });
  const { body, headers } = windowOf(rows, route.request().url());
  return route.fulfill({ status: 200, headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
});

async function open(page: Page, { width = 1440, fail = null as Failure, path = "/providers", ...data }: Data = {}) {
  const listed = data.providers ?? providers;
  const offered = data.packages ?? packages;
  // Later routes take precedence, so the two catch-alls come first: everything else the page
  // reads is empty.
  await page.route("**/rest/v1/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/rpc/**", (route) => route.fulfill({ json: null }));
  await page.route("**/rest/v1/service_categories?*", (route) => route.fulfill({ json: categories }));
  await page.route("**/rest/v1/services_catalog?*", (route) => route.fulfill({ json: servicesCatalog }));
  await table(page, "vendor_packages", offered, fail === "packages");
  await table(page, "package_tiers", tiers, fail === "tiers");
  await table(page, "package_addons", addons, fail === "addons");
  // The directory asks for the whole list; a profile asks for one provider.
  await page.route("**/rpc/r0_public_providers", async (route) => {
    const body = route.request().postData();
    const requested = body ? (JSON.parse(body) as { p_contractor?: string }).p_contractor : undefined;
    if (!requested) return route.fulfill({ json: listed });
    return route.fulfill({ json: (listed as Array<{ id: string }>).find((row) => row.id === requested) ?? null });
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Browse Our Provider Network" })).toBeVisible();
  // The directory reads its offers in windows, so wait for the loading state to finish before
  // asserting anything about what it shows.
  await expect(page.locator(".animate-pulse")).toHaveCount(0, { timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
}

const cards = (page: Page) => page.locator("[data-provider-card]");
const card = (page: Page, id: string) => page.locator(`[data-provider-card="${id}"]`);
const group = (page: Page, categoryId: string) => page.locator(`#cat-${categoryId}`);
const priceOf = (scope: Locator) => scope.locator("[data-card-price]");

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const overflow = await page.locator("main, main section, main article, header").evaluateAll(
    (elements) => elements.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => `${el.tagName}.${el.className}`.slice(0, 80)));
  expect(overflow).toEqual([]);
}

/** The whole rendered page, with nothing excused. */
const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(tags).analyze()).violations
  .flatMap((violation) => violation.nodes.map((node) => ({ id: violation.id, target: node.target.join(" ") })));

/**
 * The element's measured contrast ratio in its current state, compositing every background it
 * sits on — the tinted bands on this page are translucent, so the painted colour is what counts.
 */
const contrastOf = (locator: Locator) => locator.evaluate((element) => {
  // The browser composites the colours, so no colour syntax has to be parsed here: the tinted
  // bands arrive as oklab() with alpha, and a canvas paints them exactly as the page does.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const paint = (colours: string[]) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, 1, 1);
    for (const colour of colours) {
      context.fillStyle = colour;
      context.fillRect(0, 0, 1, 1);
    }
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return [red, green, blue];
  };
  const luminance = (rgb: number[]) => {
    const linear = (value: number) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : (((value / 255) + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
  };

  const painted: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    painted.unshift(getComputedStyle(node).backgroundColor);
  }
  const background = paint(painted);
  const foreground = paint([...painted, getComputedStyle(element).color]);
  const [light, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
});

/** No amount anywhere in the scope: a truthful unpriced card never reads as a cheaper one. */
const amounts = (scope: Locator) =>
  scope.evaluateAll((elements) => elements.flatMap((el) => [...(el.textContent ?? "").matchAll(/\$[\d,.]+/g)].map(([match]) => match)));

// ---------------------------------------------------------------------------------------------
// Rendering, accessibility and reflow
// ---------------------------------------------------------------------------------------------

for (const width of widths) {
  test(`directory ${width}px: approved cards, axe and reflow`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page, { width });

    // Five listed providers; six cards, because one publishes in two categories.
    await expect(page.getByText("5 active providers")).toBeVisible();
    await expect(cards(page)).toHaveCount(6);
    // One scan, nothing excused: the cards are part of the page it covers.
    expect(await axe(page)).toEqual([]);
    await expectNoOverflow(page);
    expect(errors).toEqual([]);

    // Every card carries the approved 2:1 cover.
    for (const cover of await page.locator("[data-provider-card] [data-cover]").all()) {
      const box = (await cover.boundingBox())!;
      expect(Math.abs(box.width / box.height - 2)).toBeLessThan(0.05);
    }
    // A blocked logo falls back to initials, not a broken image.
    await expect(card(page, SPARSE).locator('[data-logo="initials"]')).toHaveText("NH");

    if ([320, 390, 1440].includes(width)) {
      await page.screenshot({ path: `${shots}/directory-${width}.png`, fullPage: true });
    }
  });
}

for (const width of widths) {
  test(`the repaired text meets AA by measurement at ${width}px, at rest, on hover and on focus`, async ({ page }) => {
    const measured: Record<string, number> = {};
    const violations: string[] = [];

    await open(page, { width });
    // Colours here transition, so a measurement taken the instant the state changes would read
    // an interpolated value. The states themselves are unchanged; only their animation is off.
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    const chip = page.getByRole("link", { name: "Outdoor Care (2)" });
    const pairs = {
      "chip label": chip,
      "chip count": chip.locator("span").last(),
      "invitation paragraph": page.locator("main p", { hasText: "Join early access and we" }),
    };

    for (const [state, prepare] of [
      ["rest", async () => {}],
      ["hover", async () => { await chip.hover(); }],
      ["focus", async () => { await chip.focus(); }],
    ] as const) {
      await prepare();
      for (const [name, locator] of Object.entries(pairs)) {
        const ratio = await contrastOf(locator);
        measured[`${name} · ${state} · ${width}px`] = ratio;
        if (ratio < 4.5) violations.push(`${name} · ${state} · ${width}px = ${ratio}`);
      }
      // axe sees the state while it is still held. The at-rest page is scanned at every width
      // by the rendering tests, so the held states are scanned at the extremes of the matrix.
      if (state === "rest" || width === widths[0] || width === widths.at(-1)) {
        expect(await axe(page)).toEqual([]);
      }
    }

    // The measurements are the evidence; the run prints them, failing with any pair that fell short.
    console.log(`measured contrast ratios at ${width}px`, measured);
    expect(violations).toEqual([]);
  });
}

// ---------------------------------------------------------------------------------------------
// Published offers
// ---------------------------------------------------------------------------------------------

test("fixed, recurring and quoted offers stay distinct and keep their basis", async ({ page }) => {
  await open(page);
  const outdoor = group(page, "outdoor");

  const green = outdoor.locator(`[data-provider-card="${GREEN}"]`);
  await expect(green.getByRole("heading", { name: "Standard Mow" })).toBeVisible();
  await expect(green.getByText("Greenline Yard Care", { exact: true })).toBeVisible();
  await expect(green.getByText("Based in Cape Coral, FL")).toBeVisible();
  // $60 level plus the required $15 extra, with the published scope.
  await expect(priceOf(green)).toHaveAttribute("data-card-price", "fixed");
  await expect(priceOf(green)).toHaveText("$75 · Up to 1/4 acre");

  const coast = outdoor.locator(`[data-provider-card="${COAST}"]`);
  await expect(priceOf(coast)).toHaveAttribute("data-card-price", "quote");
  await expect(priceOf(coast)).toHaveText("Quote after walkthrough");
  // A deposit is not a job price, so it never appears on the card.
  await expect(coast.getByText("$150")).toHaveCount(0);

  const harbor = group(page, "interior").locator(`[data-provider-card="${HARBOR}"]`);
  await expect(harbor.getByRole("heading", { name: "Kitchen Renovation" })).toBeVisible();
  await expect(priceOf(harbor)).toContainText("Quote after walkthrough");
  await expect(priceOf(harbor)).toContainText("From $2,500 estimate");
});

test("a card never answers one category with another category's offer", async ({ page }) => {
  await open(page);
  // Greenline publishes in both categories; each group leads with its own.
  await expect(priceOf(group(page, "outdoor").locator(`[data-provider-card="${GREEN}"]`))).toHaveText("$75 · Up to 1/4 acre");
  const interior = group(page, "interior").locator(`[data-provider-card="${GREEN}"]`);
  await expect(interior.getByRole("heading", { name: "Kitchen Refresh" })).toBeVisible();
  await expect(priceOf(interior)).toHaveText("Quote after walkthrough");
  expect(await amounts(interior)).toEqual([]);
});

test("a listed provider with no published offering keeps a truthful card", async ({ page }) => {
  await open(page);
  // The contract returns no services for this provider: one package is under review, the other
  // withdrawn. It is listed, so it keeps its card, in the catch-all group.
  const none = card(page, NOOFFER);
  await expect(none).toHaveCount(1);
  await expect(none.getByRole("heading", { name: "Riverbend Lawn Collective" })).toBeVisible();
  await expect(priceOf(none)).toHaveAttribute("data-card-unpriced", "no_offer");
  await expect(priceOf(none)).toContainText("No published price yet");
  await expect(page.getByText("Weekly Mow")).toHaveCount(0);
  await expect(page.getByText("Retired Mow")).toHaveCount(0);
  expect(await amounts(none)).toEqual([]);
  await expect(page.getByRole("heading", { name: "More Active Providers" })).toBeVisible();
});

test("an unlisted provider's package never becomes a card", async ({ page }) => {
  await open(page);
  await expect(card(page, HIDDEN)).toHaveCount(0);
  await expect(page.getByText("Hidden Mow")).toHaveCount(0);
  await expect(card(page, SPARSE).getByRole("heading", { name: "Handyman Half-Day" })).toBeVisible();
});

test("defensive: a stale services entry in a category with no offering shows no price", async ({ page }) => {
  // A response that disagrees with the r0_public_providers contract — a stale services array
  // naming a service with no live offering. The card must stay truthful rather than borrow the
  // provider's price from another category.
  await open(page, { providers: [provider(HARBOR, "Harborline Remodeling", ["svc-remodel", "svc-lawn"], { location: "Fort Myers, FL" })] });
  const interior = group(page, "interior").locator(`[data-provider-card="${HARBOR}"]`);
  await expect(priceOf(interior)).toContainText("From $2,500 estimate");
  const outdoor = group(page, "outdoor").locator(`[data-provider-card="${HARBOR}"]`);
  await expect(outdoor.getByRole("heading", { name: "Harborline Remodeling" })).toBeVisible();
  await expect(priceOf(outdoor)).toHaveAttribute("data-card-unpriced", "no_offer");
  expect(await amounts(outdoor)).toEqual([]);
  expect(await axe(page)).toEqual([]);
});

for (const fail of ["tiers", "addons", "packages"] as const) {
  test(`a failed ${fail} read is reported, never a lower price`, async ({ page }) => {
    await open(page, { fail });
    // Every listed provider is still represented, and no amount is shown anywhere.
    await expect(cards(page)).toHaveCount(6);
    await expect(page.getByText("5 active providers")).toBeVisible();
    for (const slot of await page.locator("[data-card-price]").all()) {
      await expect(slot).toHaveAttribute("data-card-unpriced", "unavailable");
      await expect(slot).toContainText("Pricing unavailable right now");
    }
    expect(await amounts(cards(page))).toEqual([]);
    // The three failures render the same unpriced page, so one of them carries the scan.
    if (fail === "tiers") expect(await axe(page)).toEqual([]);
    if (fail === "tiers") await page.screenshot({ path: `${shots}/directory-offer-read-failed.png`, fullPage: true });
  });
}

// ---------------------------------------------------------------------------------------------
// Discovery, search and return
// ---------------------------------------------------------------------------------------------

test("category discovery, counts and in-page anchors still work", async ({ page }) => {
  await open(page);
  for (const [id, name, count] of [["outdoor", "Outdoor Care", 2], ["interior", "Interior & Repair", 3]] as const) {
    await expect(page.getByRole("link", { name: `${name} (${count})` })).toHaveAttribute("href", `#cat-${id}`);
    await expect(group(page, id).locator("[data-provider-card]")).toHaveCount(count);
    await expect(group(page, id).getByText(`${count} providers`)).toBeVisible();
  }
  // Provider targeting is preserved for each card.
  await expect(page.locator(`#provider-${HARBOR}`)).toHaveAttribute("data-provider-card", HARBOR);
  await page.getByRole("link", { name: "Interior & Repair (3)" }).click();
  await expect(page).toHaveURL(/#cat-interior$/);
});

test("search filters providers, services and cities and survives a visit to a profile", async ({ page }) => {
  await open(page);
  const search = page.getByLabel("Search providers");

  await search.fill("Harborline");
  await expect(cards(page)).toHaveCount(1);
  await expect(page).toHaveURL(/\?q=Harborline$/);

  // A city still matches, and so does a catalog service name.
  await search.fill("Fort Myers");
  await expect(cards(page)).toHaveCount(1);
  // One provider matches by catalog service name, and it publishes in two categories.
  await search.fill("Lawn Mowing");
  await expect(cards(page)).toHaveCount(2);
  await search.fill("Harborline");

  await page.locator(`[data-provider-card="${HARBOR}"]`).getByRole("link", { name: /^View profile/ }).click();
  // The profile is a heavier route; give its own reads room on a loaded machine.
  await expect(page.getByRole("heading", { level: 1, name: "Harborline Remodeling" })).toBeVisible({ timeout: 15_000 });
  await page.goBack();
  // The directory-side state comes back from the address, not from memory. Profile-side return
  // control and list-position restoration are P2B and are not claimed here.
  await expect(page.getByLabel("Search providers")).toHaveValue("Harborline");
  await expect(cards(page)).toHaveCount(1);

  await search.fill("nothing matches this");
  await expect(page.getByText("No providers match your search.")).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(cards(page)).toHaveCount(6);
  await expect(page).toHaveURL(/\/providers$/);
});

test("every card's link is reachable, named and tall enough to tap", async ({ page }) => {
  await open(page, { width: 390 });
  const links = page.locator("[data-provider-card] a");
  await expect(links).toHaveCount(6);
  for (const link of await links.all()) {
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await link.focus();
    await expect(link).toBeFocused();
  }
  // The accessible name says which provider and offer the link opens.
  await expect(card(page, GREEN).first().getByRole("link")).toHaveAccessibleName(/^View profile ?: Greenline Yard Care, Standard Mow$/);
  await expect(card(page, NOOFFER).getByRole("link")).toHaveAccessibleName(/^View profile ?: Riverbend Lawn Collective$/);
});
