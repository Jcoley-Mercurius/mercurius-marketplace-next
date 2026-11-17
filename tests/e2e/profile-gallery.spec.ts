// Dynamic provider profiles — local review gallery (exploration; see
// docs/agent/DYNAMIC-PROFILES-HANDOFF.md). The gated /mds/profiles gallery renders fictional
// providers through the shared card and profile components. No Marketplace read or write.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const widths = [320, 390, 768, 1024, 1440];
const shots = "test-results/profile-gallery";
const brightbin = "/mds/profiles/brightbin-can-care";
const harborline = "/mds/profiles/harborline-remodeling";
const palmetto = "/mds/profiles/palmetto-exterior-care";
const northside = "/mds/profiles/northside-handyman";
const caloosa = "/mds/profiles/caloosa-riverbend-property-care";

test.beforeAll(() => { mkdirSync(shots, { recursive: true }); });

test.beforeEach(async ({ page, baseURL }) => {
  // Origin-agnostic so the same spec runs on the CI lane and on an isolated local port:
  // nothing but the app under test is reachable.
  const origin = new URL(baseURL!).origin;
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

async function open(page: Page, path: string, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

const chooser = (page: Page, name: string) => page.getByRole("radio", { name, exact: true });
const choose = (page: Page, name: string) => page.locator("fieldset label").filter({ hasText: new RegExp(`^${name}$`) }).click();
const summary = (page: Page) => page.locator("[data-offer-summary]").filter({ visible: true });
const price = (page: Page) => summary(page).locator("[data-offer-price]");
const service = (page: Page) => new URL(page.url()).searchParams.get("service");

async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const overflow = await page.locator("main, main section, main fieldset, main article, header").evaluateAll(
    elements => elements.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => `${el.tagName}.${el.className}`.slice(0, 80)));
  expect(overflow).toEqual([]);
}

const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(tags).analyze()).violations;

// ---------------------------------------------------------------------------------------------
// Accessibility and reflow
// ---------------------------------------------------------------------------------------------

for (const width of widths) {
  test(`gallery index ${width}px: axe, reflow and card structure`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await open(page, "/mds/profiles", width);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Provider cards and dynamic profiles");
    await expect(page.locator("[data-provider-card]")).toHaveCount(5);
    expect(await axe(page)).toEqual([]);
    await expectNoOverflow(page);
    expect(errors).toEqual([]);
    // 2:1 cover on every card.
    for (const cover of await page.locator("[data-provider-card] [data-cover]").all()) {
      const box = (await cover.boundingBox())!;
      expect(Math.abs(box.width / box.height - 2)).toBeLessThan(0.05);
    }
    if (width === 320 || width === 1440) await page.screenshot({ path: `${shots}/gallery-cards-${width}.png`, fullPage: true });
  });
}

const views: Array<[string, string, string]> = [
  ["fixed all services", brightbin, "all"],
  ["fixed service", `${brightbin}?service=trash-can-cleaning`, "trash-can-cleaning"],
  ["quote-only all services", harborline, "all"],
  ["quote service with general media", `${harborline}?service=interior-painting`, "interior-painting"],
  ["mixed answer-based service", `${palmetto}?service=window-cleaning`, "window-cleaning"],
  ["mixed quoted service", `${palmetto}?service=pressure-washing`, "pressure-washing"],
  ["unavailable service link", `${palmetto}?service=roof-cleaning`, "all"],
  ["sparse profile", northside, "all"],
  ["long names and failed reads", `${caloosa}?service=seasonal-home-watch`, "seasonal-home-watch"],
];

for (const [name, path, view] of views) for (const width of widths) {
  test(`profile ${name} ${width}px: axe, reflow and one visible action`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await open(page, path, width);
    await expect(page.locator("[data-profile]")).toHaveAttribute("data-profile-view", view);
    expect(await axe(page)).toEqual([]);
    await expectNoOverflow(page);
    expect(errors).toEqual([]);
    await expect(page.getByRole("main")).toHaveCount(1);
    // Exactly one visible next action, 44px or taller, whatever the layout.
    const action = page.getByRole("button", { name: "Join early access" });
    await expect(action).toHaveCount(1);
    expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    for (const label of await page.locator("fieldset label").filter({ visible: true }).all()) {
      expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    if (width === 320 || width === 390 || width === 1440) {
      const file = `${shots}/${name.replace(/\W+/g, "-")}-${width}`;
      // What a visitor sees on arrival, with the phone action bar in place.
      if (width < 1024) await page.screenshot({ path: `${file}-viewport.png` });
      // A full-page capture pins a fixed bar mid-image, so it is laid out in flow for the image only.
      await page.addStyleTag({ content: "[data-profile-action-bar]{position:static!important}" });
      await page.screenshot({ path: `${file}.png`, fullPage: true });
    }
  });
}

test("phone layout puts the decision before the media and keeps the last section clear of the action bar", async ({ page }) => {
  await open(page, `${brightbin}?service=trash-can-cleaning`, 390);
  const priceBox = (await price(page).boundingBox())!;
  const mediaBox = (await page.locator("[data-profile-media]").boundingBox())!;
  expect(priceBox.y).toBeLessThan(mediaBox.y);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bar = (await page.locator("[data-profile-action-bar]").boundingBox())!;
  const last = (await page.locator("[data-service-row=all]").boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(bar.y);
});

test("200% zoom keeps names, price and controls usable", async ({ page }) => {
  await open(page, `${caloosa}?service=seasonal-home-watch`, 1440);
  await page.locator("html").evaluate(el => { el.style.zoom = "2"; });
  expect(await page.locator("main").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Caloosa Riverbend Property Maintenance");
  await expect(price(page)).toHaveText("$55");
  await expect(page.getByRole("button", { name: "Join early access" })).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// Service choice: all services, switching, links, history
// ---------------------------------------------------------------------------------------------

test("all services is useful without answering the prompt", async ({ page }) => {
  await open(page, harborline);
  await expect(chooser(page, "All services")).toBeChecked();
  await expect(summary(page)).toContainText("4 published services");
  await expect(summary(page).locator("[data-offer-price]")).toHaveCount(0);
  for (const name of ["Bathroom remodeling", "Kitchen remodeling", "Drywall repair", "Interior painting"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  for (const heading of ["Explore services", "About Harborline Remodeling & Repair", "Customer reviews", "Service area"]) {
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }
});

test("choosing a service updates offer, scope, price, media and questions; identity and reviews stay put", async ({ page }) => {
  await open(page, brightbin);
  const identity = async () => ({
    name: await page.getByRole("heading", { level: 1 }).textContent(),
    reviews: await page.locator("[data-review-summary]").textContent(),
    list: await page.locator("[data-reviews=list] li").count(),
  });
  const before = await identity();
  expect(before).toEqual({ name: "Brightbin Can Care", reviews: "4.7 (3 public reviews)", list: 3 });
  await expect(page.locator("[data-profile-media]")).toHaveAttribute("data-profile-media", "logo");
  await expect(page.getByRole("heading", { name: /^Questions about/ })).toHaveCount(0);

  await chooser(page, "All services").focus();
  await page.keyboard.press("ArrowRight");
  await expect(chooser(page, "Trash can cleaning")).toBeChecked();
  // Keyboard focus stays on the selector, and the URL carries the choice.
  await expect(chooser(page, "Trash can cleaning")).toBeFocused();
  expect(service(page)).toBe("trash-can-cleaning");
  await expect(page.locator("[data-profile-announcement]")).toHaveText("Showing Trash can cleaning: One-time can cleaning, $45.");

  await expect(summary(page).getByRole("heading", { level: 2 })).toHaveText("One-time can cleaning");
  await expect(price(page)).toHaveText("$45");
  await expect(summary(page)).toContainText("One-time service · Up to 2 cans");
  await expect(page.locator("[data-profile-media]")).toHaveAttribute("data-profile-media", "photo");
  await expect(page.getByRole("img", { name: "Illustration: two cans rinsed and set back at the curb." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Questions about trash can cleaning" })).toBeVisible();
  await expect(page.getByText("How many cans are included?")).toBeVisible();
  await expect(page.getByText("Check the listed area for trash can cleaning.")).toBeVisible();
  expect(await identity()).toEqual(before);
  // "Top Rated" stays hidden (DEC-2026-058).
  await expect(page.getByRole("list", { name: "Credentials" }).getByRole("listitem")).toHaveText(["Licensed", "Insured"]);
});

test("fixed, recurring and quoted offers read differently", async ({ page }) => {
  await open(page, `${brightbin}?service=trash-can-cleaning`);
  await page.locator("[data-offer-option=bb-plan]").click();
  await expect(price(page)).toHaveText("$30");
  await expect(summary(page)).toContainText("Monthly · billed per visit · Up to 2 cans per visit");
  await page.locator("label").filter({ hasText: /^Quarterly · \$38 per visit$/ }).click();
  await expect(price(page)).toHaveText("$38");
  await expect(summary(page)).toContainText("Quarterly · billed per visit");

  await open(page, `${harborline}?service=interior-painting`);
  await expect(price(page)).toHaveText("Quote after walkthrough");
  await expect(summary(page)).not.toContainText("$150 ·");
  await expect(summary(page).locator("[data-offer-deposit]")).toContainText("A $150 deposit may apply after scope, final pricing, and booking details are confirmed.");
  await expect(page.locator("[data-optional-extras]")).toHaveCount(0);
  // A general image is labelled when the service has none of its own.
  await expect(page.getByText("General business photo")).toBeVisible();

  await open(page, `${palmetto}?service=window-cleaning`);
  await expect(price(page)).toHaveText("From $160");
  await expect(summary(page)).toContainText("Set by your answers in the request step.");
  await expect(summary(page)).toContainText("Required · included in the price shown");
});

test("switching service clears package, cadence and extras from the previous service", async ({ page }) => {
  await open(page, `${palmetto}?service=gutter-cleaning`);
  await page.locator("label").filter({ hasText: /^Quarterly · \$130 per visit$/ }).click();
  await page.getByRole("checkbox", { name: "Add Gutter guard rinse" }).check();
  await expect(price(page)).toHaveText("$130");
  await expect(summary(page).locator("[data-price-total]")).toHaveText("$165");

  await choose(page, "Window cleaning");
  await expect(summary(page).getByRole("heading", { level: 2 })).toHaveText("Exterior window cleaning");
  await expect(price(page)).toHaveText("From $160");
  await expect(summary(page).locator("[data-price-preview]")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Add Gutter guard rinse" })).toHaveCount(0);
  await expect(summary(page)).not.toContainText("Quarterly");

  // Returning starts from the published default, not the earlier choices.
  await choose(page, "Gutter cleaning");
  await expect(price(page)).toHaveText("$160");
  await expect(page.getByRole("checkbox", { name: "Add Gutter guard rinse" })).not.toBeChecked();
  await expect(summary(page).locator("[data-price-preview]")).toHaveCount(0);

  await choose(page, "All services");
  await expect(summary(page).locator("[data-offer-price]")).toHaveCount(0);
  await expect(page.locator("[data-optional-extras]")).toHaveCount(0);
});

test("extras update a qualified price preview and stay within published limits", async ({ page }) => {
  await open(page, `${brightbin}?service=trash-can-cleaning`);
  const add = page.getByRole("button", { name: "Add one Extra can" });
  const remove = page.getByRole("button", { name: "Remove one Extra can" });
  await expect(remove).toBeDisabled();
  await add.focus();
  for (let index = 0; index < 4; index += 1) await page.keyboard.press("Enter");
  await expect(page.locator("[data-addon-quantity=bb-extra-can]")).toHaveText("4");
  // At the published maximum the control is disabled but keeps keyboard focus.
  await expect(add).toBeDisabled();
  await expect(add).toBeFocused();
  await expect(summary(page).locator("[data-price-total]")).toHaveText("$93");
  await expect(page.locator("[data-profile-announcement]")).toHaveText("One-time can cleaning, one-time: $93 service subtotal.");
  await expect(price(page)).toHaveText("$45");

  // Choosing another package discards the extras chosen for this one.
  await page.locator("[data-offer-option=bb-empty]").click();
  await expect(price(page)).toHaveText("$85");
  await expect(summary(page).locator("[data-price-preview]")).toHaveCount(0);
  await expect(page.locator("[data-optional-extras]")).toHaveCount(0);
});

test("an explicit service link opens that service", async ({ page }) => {
  await open(page, `${palmetto}?service=pressure-washing`);
  await expect(chooser(page, "Pressure washing")).toBeChecked();
  await expect(price(page)).toHaveText("Quote after walkthrough");
  await expect(summary(page)).toContainText("From $180 estimate · the provider confirms the final price");
  await expect(page.locator("[data-unavailable-service]")).toHaveCount(0);
});

for (const [name, path, message] of [
  ["a withdrawn offer", `${palmetto}?service=roof-cleaning`, "Roof cleaning is not currently offered by Palmetto Exterior Care."],
  ["a catalog service the provider does not publish", `${brightbin}?service=pressure-washing`, "Pressure washing is not currently offered by Brightbin Can Care."],
  ["an unknown service", `${brightbin}?service=retired-service`, "The linked service is not currently offered by Brightbin Can Care."],
] as const) {
  test(`a link to ${name} explains the change and shows published alternatives`, async ({ page }) => {
    await open(page, path);
    await expect(page.locator("[data-unavailable-service]")).toContainText(message);
    await expect(chooser(page, "All services")).toBeChecked();
    await expect(summary(page).locator("[data-offer-price]")).toHaveCount(0);
    await expect(page.locator("[data-optional-extras]")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Explore services" })).toBeVisible();
    // Withdrawn and under-review offers are not offered as alternatives either.
    await expect(page.getByText("Roof soft wash")).toHaveCount(0);
    await expect(page.getByText("Flat-rate patio wash")).toHaveCount(0);
    // Choosing a published service leaves the notice behind.
    await page.locator("[data-service-row]").first().click();
    await expect(page.locator("[data-unavailable-service]")).toHaveCount(0);
  });
}

test("Back and Forward restore the service choice", async ({ page }) => {
  await open(page, palmetto);
  await choose(page, "Window cleaning");
  await expect(price(page)).toHaveText("From $160");
  await choose(page, "Pressure washing");
  await expect(price(page)).toHaveText("Quote after walkthrough");
  expect(service(page)).toBe("pressure-washing");

  await page.goBack();
  await expect(chooser(page, "Window cleaning")).toBeChecked();
  await expect(price(page)).toHaveText("From $160");
  expect(service(page)).toBe("window-cleaning");

  await page.goBack();
  await expect(chooser(page, "All services")).toBeChecked();
  await expect(summary(page)).toContainText("3 published services");
  expect(service(page)).toBeNull();

  await page.goForward();
  await expect(chooser(page, "Window cleaning")).toBeChecked();
  await page.goForward();
  await expect(chooser(page, "Pressure washing")).toBeChecked();
  await expect(page.locator("[data-profile-announcement]")).toHaveText("Showing Pressure washing: Driveway and walkway washing, Quote after walkthrough.");

  // Choosing the service already shown adds no history entry.
  await choose(page, "Pressure washing");
  await page.goBack();
  await expect(chooser(page, "Window cleaning")).toBeChecked();
});

test("choosing from a service list returns keyboard focus to the selector", async ({ page }) => {
  await open(page, harborline);
  await page.locator("[data-service-row=kitchen-remodeling]").focus();
  await page.keyboard.press("Enter");
  await expect(chooser(page, "Kitchen remodeling")).toBeChecked();
  await expect(chooser(page, "Kitchen remodeling")).toBeFocused();

  await page.locator("[data-service-row=all]").focus();
  await page.keyboard.press("Enter");
  await expect(chooser(page, "All services")).toBeFocused();
  expect(service(page)).toBeNull();
});

// ---------------------------------------------------------------------------------------------
// Coverage, sparse content and failed reads
// ---------------------------------------------------------------------------------------------

test("ZIP results separate listed, outside the list, outside the Marketplace area and invalid", async ({ page }) => {
  await open(page, `${brightbin}?service=trash-can-cleaning`);
  const zip = page.getByRole("textbox", { name: "ZIP code" });
  const result = page.locator("[data-zip-result]");
  const check = async (value: string) => { await zip.fill(value); await page.keyboard.press("Enter"); };
  await expect(page.getByText("Enter your ZIP to check the listed area.")).toBeVisible();

  await check("33904");
  await expect(result).toHaveAttribute("data-zip-result", "listed");
  await expect(result).toContainText("33904 is in the listed area");
  // A listed ZIP is not a booking promise.
  await expect(result).toContainText("Eligibility for trash can cleaning at your address is confirmed in the request step.");
  await expect(result).not.toContainText(/available|book/i);

  await check("33901");
  await expect(result).toHaveAttribute("data-zip-result", "outside_provider");
  await expect(result.getByRole("link", { name: "Browse other providers" })).toHaveAttribute("href", "/mds/profiles");

  await check("33955");
  await expect(result).toHaveAttribute("data-zip-result", "outside_marketplace");
  await expect(result).toContainText("Not available yet in your area.");

  await check("339");
  await expect(result).toHaveCount(0);
  await expect(zip).toBeFocused();
  await expect(zip).toHaveAttribute("aria-invalid", "true");
  await expect(zip).toHaveAccessibleDescription("Enter a 5-digit ZIP code.");

  // The map shades only listed ZIPs with a drawn boundary; a postal-only ZIP is in the list.
  const map = page.getByRole("img", { name: /Map of Lee County, Florida/ });
  await expect(map.locator("path[data-served]")).toHaveCount(3);
  await expect(page.getByText("4 listed ZIP codes in Lee County, FL")).toBeVisible();
  await expect(page.getByText("· 33904, 33914, 33915, 33990")).toBeVisible();
});

test("sparse profile stays compact and truthful", async ({ page }) => {
  await open(page, northside, 390);
  await expect(page.locator("[data-logo=initials]").first()).toHaveText("NH");
  await expect(page.getByText("This provider has not added a business description yet.")).toBeVisible();
  await expect(page.locator("[data-review-summary]")).toHaveText("No public reviews yet");
  await expect(page.locator("[data-reviews=empty]")).toBeVisible();
  await expect(page.getByText("Service area not listed yet")).toBeVisible();
  await expect(page.getByRole("img", { name: /Map of Lee County/ })).toHaveCount(0);

  await page.getByRole("textbox", { name: "ZIP code" }).fill("33904");
  await page.getByRole("button", { name: "Check ZIP" }).click();
  const result = page.locator("[data-zip-result]");
  await expect(result).toHaveAttribute("data-zip-result", "unknown");
  await expect(result).toContainText("We can't tell whether 33904 is covered");

  await choose(page, "Handyman");
  await expect(price(page)).toHaveText("Quote after walkthrough");
  await expect(page.locator("[data-profile-media]")).toHaveAttribute("data-profile-media", "logo");
  await expect(page.getByRole("heading", { name: /^Questions about/ })).toHaveCount(0);
});

test("failed reads and broken media are reported, never filled in", async ({ page }) => {
  await open(page, `${caloosa}?service=seasonal-home-watch`);
  // Broken logo becomes initials; the broken photo falls back to the cover.
  await expect(page.locator("header [data-logo=initials], [data-profile] > header [data-logo=initials]").first()).toBeVisible();
  await expect(page.locator("[data-profile-media]")).toHaveAttribute("data-profile-media", "logo");
  await expect(page.getByText("Photos for this provider could not be loaded.")).toBeVisible();

  await expect(page.locator("[data-review-summary]")).toHaveText("Reviews unavailable");
  await expect(page.locator("[data-reviews=unavailable]")).toContainText("No rating or review count is shown until they can be read.");
  await expect(page.getByText("Service area unavailable")).toBeVisible();

  await page.getByRole("textbox", { name: "ZIP code" }).fill("33931");
  await page.getByRole("button", { name: "Check ZIP" }).click();
  const result = page.locator("[data-zip-result]");
  await expect(result).toHaveAttribute("data-zip-result", "unknown");
  await expect(result).toContainText("We couldn't check 33931");
  await result.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("[data-gallery-notice]")).toContainText("the coverage read fails on purpose");

  // The offer itself still reads correctly.
  await expect(price(page)).toHaveText("$55");
  await expect(summary(page)).toContainText("Weekly · billed per visit");
});

// ---------------------------------------------------------------------------------------------
// Next step and directory cards
// ---------------------------------------------------------------------------------------------

test("the next step follows the viewer's access state and sends nothing from the gallery", async ({ page }) => {
  await open(page, `${brightbin}?service=trash-can-cleaning`);
  await expect(page.getByText("Booking opens by invitation as services are ready in your area.").filter({ visible: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Join early access" }).click();
  await expect(page.locator("[data-gallery-notice]")).toContainText("Gallery only: nothing was sent.");
  expect(new URL(page.url()).pathname).toBe(brightbin);

  await page.getByRole("combobox", { name: "Preview as" }).selectOption("invited");
  await expect(page.getByRole("button", { name: "Join early access" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to request" })).toBeVisible();

  await open(page, `${harborline}?service=drywall-repair`);
  await page.getByRole("combobox", { name: "Preview as" }).selectOption("invited");
  await expect(page.getByRole("button", { name: "Request a quote" })).toBeVisible();
});

test("directory cards follow the service context and link with it", async ({ page }) => {
  await open(page, "/mds/profiles");
  const cards = page.locator("[data-provider-card]");
  const card = (id: string) => page.locator(`[data-provider-card=${id}]`);
  await expect(cards).toHaveCount(5);

  // Unfiltered: each provider's first published offer.
  await expect(card("synthetic-brightbin").getByRole("heading")).toHaveText("One-time can cleaning");
  await expect(card("synthetic-brightbin").locator("[data-card-price]")).toHaveText("$45 · Up to 2 cans");
  await expect(card("synthetic-brightbin").locator("[data-cover]")).toHaveAttribute("data-cover", "photo");
  await expect(card("synthetic-harborline").locator("[data-card-price]")).toHaveAttribute("data-card-price", "quote");
  await expect(card("synthetic-northside").locator("[data-logo=initials]")).toHaveText("NH");
  await expect(card("synthetic-caloosa").locator("[data-card-price]")).toContainText("$55 · weekly, per visit");
  await expect(card("synthetic-brightbin").getByRole("link")).toHaveAttribute("href", brightbin);
  await expect(card("synthetic-brightbin").getByRole("link")).toHaveAccessibleName(/^View profile ?: Brightbin Can Care, One-time can cleaning$/);

  // A service context changes the headline and price, and leaves out providers without it.
  await page.getByRole("combobox", { name: "Directory service context" }).selectOption("pressure-washing");
  await expect(cards).toHaveCount(1);
  await expect(page.getByText("1 provider shown")).toBeVisible();
  await expect(card("synthetic-palmetto").getByRole("heading")).toHaveText("Driveway and walkway washing");
  await expect(card("synthetic-palmetto").locator("[data-card-price]")).toContainText("Quote after walkthrough");
  await expect(card("synthetic-palmetto").getByRole("link")).toHaveAttribute("href", `${palmetto}?service=pressure-washing`);

  await card("synthetic-palmetto").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Palmetto Exterior Care");
  await expect(chooser(page, "Pressure washing")).toBeChecked();
  // The profile's Providers link returns to the gallery directory.
  await page.getByRole("link", { name: "Providers", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Provider cards and dynamic profiles");
});

test("the catalog links to the gallery and an unknown scenario is not found", async ({ page }) => {
  await open(page, "/mds");
  await page.getByRole("link", { name: "Review provider cards and profiles" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Provider cards and dynamic profiles");
  const missing = await page.goto("/mds/profiles/not-a-scenario");
  expect(missing?.status()).toBe(404);
});
