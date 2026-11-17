// TRACE-156 (P2A): the real /providers directory renders the approved provider card from
// published offers. Synthetic readbacks shaped like the current public reads; no Marketplace
// data, and no write of any kind.
import { test, expect, type Page } from "@playwright/test";
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
const REVIEW = "00000000-0000-4000-8000-000000000a05";
/** Readable as a contractor row, absent from the public listing: it must never get a card. */
const HIDDEN = "00000000-0000-4000-8000-000000000a06";

const LONG_NAME = "Northside Handyman & Home Maintenance Services of Southwest Florida";

const providers = [
  provider(GREEN, "Greenline Yard Care", ["svc-lawn", "svc-remodel"]),
  provider(HARBOR, "Harborline Remodeling", ["svc-remodel"], { location: "Fort Myers, FL" }),
  provider(COAST, "Coastal Surface Pros", ["svc-pressure"]),
  // A broken logo: the request is blocked, so the card must fall back to initials.
  provider(SPARSE, LONG_NAME, ["svc-handy"], { logo_url: "https://synthetic.invalid/logo.png", location: null }),
  provider(REVIEW, "Riverbend Lawn Collective", ["svc-lawn"]),
];

const pkg = (row: Record<string, unknown>) => ({
  description: null, deposit_amount: null, is_active: true, needs_review: false, sort_order: 0, included_scope: null, ...row,
});

const packages = [
  pkg({ id: "pkg-lawn", contractor_id: GREEN, service_id: "svc-lawn", name: "Standard Mow", pricing_mode: "fixed", default_frequency: "one-time", included_scope: ["Up to 1/4 acre"] }),
  pkg({ id: "pkg-lawn-plan", contractor_id: GREEN, service_id: "svc-lawn", name: "Mowing Plan", pricing_mode: "fixed", default_frequency: "monthly", sort_order: 1 }),
  pkg({ id: "pkg-remodel", contractor_id: HARBOR, service_id: "svc-remodel", name: "Kitchen Renovation", pricing_mode: "custom_quote", default_frequency: "one-time" }),
  pkg({ id: "pkg-press", contractor_id: COAST, service_id: "svc-pressure", name: "Driveway & Walkway Wash", pricing_mode: "deposit_quote", default_frequency: "one-time", deposit_amount: 150 }),
  // Under review and withdrawn: neither may price a card, even when the row arrives.
  pkg({ id: "pkg-under", contractor_id: REVIEW, service_id: "svc-lawn", name: "Weekly Mow", pricing_mode: "fixed", default_frequency: "weekly", needs_review: true }),
  pkg({ id: "pkg-off", contractor_id: REVIEW, service_id: "svc-lawn", name: "Retired Mow", pricing_mode: "fixed", default_frequency: "one-time", is_active: false }),
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

async function open(page: Page, { width = 1440, fail = null as Failure, path = "/providers" } = {}) {
  // Later routes take precedence, so the two catch-alls come first: everything else the page
  // reads is empty.
  await page.route("**/rest/v1/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/rpc/**", (route) => route.fulfill({ json: null }));
  await page.route("**/rest/v1/service_categories?*", (route) => route.fulfill({ json: categories }));
  await page.route("**/rest/v1/services_catalog?*", (route) => route.fulfill({ json: servicesCatalog }));
  await page.route("**/rest/v1/vendor_packages?*", (route) => fail === "packages"
    ? route.fulfill({ status: 500, json: { message: "Synthetic failure" } })
    : route.fulfill({ json: packages }));
  await page.route("**/rest/v1/package_tiers?*", (route) => fail === "tiers"
    ? route.fulfill({ status: 500, json: { message: "Synthetic failure" } })
    : route.fulfill({ json: tiers }));
  await page.route("**/rest/v1/package_addons?*", (route) => fail === "addons"
    ? route.fulfill({ status: 500, json: { message: "Synthetic failure" } })
    : route.fulfill({ json: addons }));
  // The directory asks for the whole list; a profile asks for one provider.
  await page.route("**/rpc/r0_public_providers", async (route) => {
    const body = route.request().postData();
    const requested = body ? (JSON.parse(body) as { p_contractor?: string }).p_contractor : undefined;
    if (!requested) return route.fulfill({ json: providers });
    return route.fulfill({ json: providers.find((row) => row.id === requested) ?? null });
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Browse Our Provider Network" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const cards = (page: Page) => page.locator("[data-provider-card]");
const card = (page: Page, id: string) => page.locator(`[data-provider-card="${id}"]`);
const group = (page: Page, categoryId: string) => page.locator(`#cat-${categoryId}`);
const priceOf = (scope: ReturnType<typeof card>) => scope.locator("[data-card-price]");

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const overflow = await page.locator("main, main section, main article, header").evaluateAll(
    (elements) => elements.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => `${el.tagName}.${el.className}`.slice(0, 80)));
  expect(overflow).toEqual([]);
}

/**
 * Two contrast failures on this page predate TRACE-156 and are untouched by it: the category
 * chip's provider count (`text-xs opacity-60`) and the closing invitation paragraph. Both are
 * the muted-foreground token on a tinted background, which is a design-token question rather
 * than a page-local edit, so they are recorded in the checkpoint instead of changed here. They
 * only become visible to axe now that the directory renders providers in a test.
 */
const PRE_EXISTING = /\.opacity-60\.text-xs|\.max-w-2xl > \.mb-6/;

/** Every violation the cards or the rest of the page add to that known list. */
async function axe(page: Page) {
  const violations = await new AxeBuilder({ page }).withTags(tags).analyze();
  return violations.violations
    .flatMap((violation) => violation.nodes.map((node) => ({ id: violation.id, target: node.target.join(" ") })))
    .filter((node) => !PRE_EXISTING.test(node.target));
}

/** The approved cards on their own must be clean, with nothing excused. */
const axeCards = async (page: Page) =>
  (await new AxeBuilder({ page }).include("[data-provider-card]").withTags(tags).analyze()).violations;

/** No amount anywhere in the scope: a truthful unpriced card never reads as a cheaper one. */
const amounts = (scope: ReturnType<typeof card>) =>
  scope.evaluateAll((elements) => elements.flatMap((el) => [...(el.textContent ?? "").matchAll(/\$[\d,.]+/g)].map(([match]) => match)));

// ---------------------------------------------------------------------------------------------
// Rendering, accessibility and reflow
// ---------------------------------------------------------------------------------------------

for (const width of widths) {
  test(`directory ${width}px: approved cards, axe and reflow`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page, { width });

    // Five listed providers; six cards, because one is listed in two categories.
    await expect(page.getByText("5 active providers")).toBeVisible();
    await expect(cards(page)).toHaveCount(6);
    expect(await axeCards(page)).toEqual([]);
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
  // Greenline is listed under both categories but only publishes lawn care.
  await expect(priceOf(group(page, "outdoor").locator(`[data-provider-card="${GREEN}"]`))).toHaveText("$75 · Up to 1/4 acre");
  const interior = group(page, "interior").locator(`[data-provider-card="${GREEN}"]`);
  await expect(interior.getByRole("heading", { name: "Greenline Yard Care" })).toBeVisible();
  await expect(priceOf(interior)).toHaveAttribute("data-card-unpriced", "no_offer");
  await expect(priceOf(interior)).toContainText("No published price yet");
  expect(await amounts(interior)).toEqual([]);
});

test("a withdrawn or under-review offer never prices a card, and the provider stays listed", async ({ page }) => {
  await open(page);
  const review = card(page, REVIEW);
  await expect(review).toHaveCount(1);
  await expect(review.getByRole("heading", { name: "Riverbend Lawn Collective" })).toBeVisible();
  await expect(priceOf(review)).toHaveAttribute("data-card-unpriced", "no_offer");
  await expect(review.getByText("Listed for Lawn Mowing")).toBeVisible();
  await expect(page.getByText("Weekly Mow")).toHaveCount(0);
  await expect(page.getByText("Retired Mow")).toHaveCount(0);
  expect(await amounts(review)).toEqual([]);
});

test("a provider with no package keeps its card, and an unlisted provider gets none", async ({ page }) => {
  await open(page);
  await expect(card(page, SPARSE).getByRole("heading", { name: LONG_NAME })).toBeVisible();
  await expect(priceOf(card(page, SPARSE))).toHaveAttribute("data-card-unpriced", "no_offer");
  await expect(card(page, HIDDEN)).toHaveCount(0);
  await expect(page.getByText("Hidden Mow")).toHaveCount(0);
  expect(await amounts(card(page, SPARSE))).toEqual([]);
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
    expect(await axeCards(page)).toEqual([]);
    expect(await axe(page)).toEqual([]);
    if (fail === "tiers") await page.screenshot({ path: `${shots}/directory-offer-read-failed.png`, fullPage: true });
  });
}

// ---------------------------------------------------------------------------------------------
// Discovery, search and return
// ---------------------------------------------------------------------------------------------

test("category discovery, counts and in-page anchors still work", async ({ page }) => {
  await open(page);
  for (const [id, name, count] of [["outdoor", "Outdoor Care", 3], ["interior", "Interior & Repair", 3]] as const) {
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
  // Two providers match by catalog service name; one of them is listed in both categories.
  await search.fill("Lawn Mowing");
  await expect(cards(page)).toHaveCount(3);
  await search.fill("Harborline");

  await page.locator(`[data-provider-card="${HARBOR}"]`).getByRole("link", { name: /^View profile/ }).click();
  await expect(page.getByRole("heading", { name: "Harborline Remodeling" })).toBeVisible();
  await page.goBack();
  // The same result list comes back, from the address rather than from memory.
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
  await expect(card(page, SPARSE).getByRole("link")).toHaveAccessibleName(new RegExp(`^View profile ?: ${LONG_NAME.replace("&", "&")}$`));
});
