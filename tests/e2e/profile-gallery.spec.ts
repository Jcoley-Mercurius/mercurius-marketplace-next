// Dynamic provider profiles — local review gallery (exploration; see
// docs/agent/DYNAMIC-PROFILES-HANDOFF.md). The gated /mds/profiles gallery renders fictional
// providers through the shared card and profile components. No Marketplace read or write.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";

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
  // Settled means React has revealed every streamed segment. Until it does, a hidden
  // <div hidden id="S:n"> can still hold a second copy of the page beside the live one, and a
  // CSS locator such as [data-profile] would resolve to both (CI run 44186485645, attempt 2).
  await expect(page.locator('div[hidden][id^="S:"]')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
}

// The service choice has two controls over one value: chips from 1024px, a dropdown below it.
const desktop = 1024;
const chooser = (page: Page, name: string) => page.getByRole("radio", { name, exact: true });
const choose = (page: Page, name: string) => page.locator("fieldset label").filter({ hasText: new RegExp(`^${name}$`) }).click();
const dropdown = (page: Page) => page.getByRole("combobox", { name: "What can we help with?" });
const dropdownChoice = (page: Page) => dropdown(page).evaluate((el: HTMLSelectElement) => el.selectedOptions[0].text);
const history = (page: Page) => page.evaluate(() => ({ length: window.history.length, router: window.history.state?.__NA === true }));
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
    // One service selector is on screen: chips on desktop, the dropdown on phones and tablets.
    if (width >= desktop) {
      await expect(dropdown(page)).toHaveCount(0);
      await expect(page.getByRole("radio", { name: "All services", exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("radio", { name: "All services", exact: true })).toHaveCount(0);
      await expect(dropdown(page)).toHaveValue(view === "all" ? "" : view);
      expect((await dropdown(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
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
  // All services shows each of the provider's photos once, including service-linked ones (TRACE-156).
  await expect(page.locator("[data-profile-media]")).toHaveAttribute("data-profile-media", "photo");
  await expect(page.getByRole("heading", { name: /^Questions about/ })).toHaveCount(0);

  const entries = (await history(page)).length;
  await chooser(page, "All services").focus();
  await page.keyboard.press("ArrowRight");
  await expect(chooser(page, "Trash can cleaning")).toBeChecked();
  // Keyboard focus stays on the selector, and the URL carries the choice without a new history entry.
  await expect(chooser(page, "Trash can cleaning")).toBeFocused();
  expect(service(page)).toBe("trash-can-cleaning");
  expect((await history(page)).length).toBe(entries);
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

test("an extra with a minimum of two is none or two to six, and the preview follows", async ({ page }) => {
  await open(page, `${palmetto}?service=gutter-cleaning`);
  const row = page.locator("[data-addon=pe-downspouts]");
  const quantity = page.locator("[data-addon-quantity=pe-downspouts]");
  const more = page.getByRole("button", { name: "Increase Extra downspout flush quantity" });
  const fewer = page.getByRole("button", { name: "Decrease Extra downspout flush quantity" });
  const total = summary(page).locator("[data-price-total]");
  const lines = summary(page).locator("[data-price-preview] li");

  await expect(row.locator("[data-addon-limits]")).toHaveText("Minimum 2, up to 6");
  await expect(page.getByRole("group", { name: "Extra downspout flush quantity. Minimum 2, up to 6" })).toBeVisible();
  await expect(quantity).toHaveText("0");
  await expect(fewer).toBeDisabled();
  await expect(summary(page).locator("[data-price-preview]")).toHaveCount(0);

  // The first selection is the minimum: one is never offered.
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(quantity).toHaveText("2");
  await expect(total).toHaveText("$190");
  await expect(lines).toHaveText(["Gutter clean-out$160", "Extra downspout flush × 2$30"]);
  await expect(page.locator("[data-profile-announcement]")).toHaveText("Gutter clean-out, one-time: $190 service subtotal.");

  // Up to the published maximum, where the control stops but keeps keyboard focus.
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Enter");
  await expect(quantity).toHaveText("6");
  await expect(more).toBeDisabled();
  await expect(more).toBeFocused();
  await expect(total).toHaveText("$250");
  await expect(lines).toHaveText(["Gutter clean-out$160", "Extra downspout flush × 6$90"]);

  // Down to the minimum, then one more step removes the extra rather than leaving one.
  await fewer.focus();
  for (let index = 0; index < 4; index += 1) await page.keyboard.press("Enter");
  await expect(quantity).toHaveText("2");
  await expect(total).toHaveText("$190");
  await page.keyboard.press("Enter");
  await expect(quantity).toHaveText("0");
  await expect(summary(page).locator("[data-price-preview]")).toHaveCount(0);
  await expect(fewer).toBeDisabled();
  await expect(fewer).toBeFocused();
  await expect(price(page)).toHaveText("$160");

  // With another extra, on the other cadence: both are priced from that cadence's base.
  await more.click();
  await page.getByRole("checkbox", { name: "Add Gutter guard rinse" }).check();
  await expect(total).toHaveText("$225");
  await page.locator("label").filter({ hasText: /^Quarterly · \$130 per visit$/ }).click();
  await expect(quantity).toHaveText("0");
  await expect(summary(page).locator("[data-price-preview]")).toHaveCount(0);
  await more.click();
  await expect(quantity).toHaveText("2");
  await expect(total).toHaveText("$160");
  await expect(lines).toHaveText(["Gutter clean-out$130", "Extra downspout flush × 2$30"]);

  // An extra with no published minimum still steps by one.
  await open(page, `${brightbin}?service=trash-can-cleaning`);
  await page.getByRole("button", { name: "Add one Extra can" }).click();
  await expect(page.locator("[data-addon-quantity=bb-extra-can]")).toHaveText("1");
  await expect(page.locator("[data-addon=bb-extra-can] [data-addon-limits]")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove one Extra can" }).click();
  await expect(page.locator("[data-addon-quantity=bb-extra-can]")).toHaveText("0");
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

for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
  test(`a link naming "${id}" as the service shows the normal fallback without a browser error`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
    page.on("console", message => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    // The Vercel Web Analytics script exists only on Vercel. Locally it is a 404 on every page,
    // so it is answered here and any other console error still fails the test.
    await page.route("**/_vercel/insights/**", route => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    for (const width of [1440, 390]) {
      await open(page, `${brightbin}?service=${id}`, width);
      const notice = page.locator("[data-unavailable-service]");
      await expect(notice.locator("p").first()).toHaveText("The linked service is not currently offered by Brightbin Can Care.");
      await expect(notice).toContainText("All services are shown instead; choose one above to see its current offer.");
      await expect(page.locator("[data-profile]")).toHaveAttribute("data-profile-view", "all");
      if (width >= desktop) await expect(chooser(page, "All services")).toBeChecked();
      else expect(await dropdownChoice(page)).toBe("All services");
      await expect(summary(page)).toContainText("1 published service");
      await expect(page.locator("[data-profile-announcement]")).toHaveText("");
      await expect(page.getByRole("heading", { name: "Explore services" })).toBeVisible();
      // The page still works: a published service can be chosen and the notice goes.
      await page.locator("[data-service-row=trash-can-cleaning]").click();
      await expect(price(page)).toHaveText("$45");
      await expect(notice).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test("a service change replaces the history entry: Back leaves the profile, Forward returns to the last choice", async ({ page }) => {
  await open(page, "/mds/profiles");
  await page.locator("[data-provider-card=synthetic-palmetto]").getByRole("link").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Palmetto Exterior Care");
  const arrival = await history(page);

  await choose(page, "Window cleaning");
  await expect(price(page)).toHaveText("From $160");
  await choose(page, "Pressure washing");
  await expect(price(page)).toHaveText("Quote after walkthrough");
  await choose(page, "All services");
  await expect(summary(page)).toContainText("3 published services");
  expect(service(page)).toBeNull();
  await choose(page, "Pressure washing");
  expect(service(page)).toBe("pressure-washing");
  // Four changes of service, no new history entry, and the framework's entry state is intact.
  expect(await history(page)).toEqual(arrival);
  expect(arrival.router).toBe(true);

  // Back leaves the profile in one step, as a client-side navigation.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Provider cards and dynamic profiles");
  expect(new URL(page.url()).pathname).toBe("/mds/profiles");

  // Forward returns to the profile with the last service chosen.
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Palmetto Exterior Care");
  await expect(chooser(page, "Pressure washing")).toBeChecked();
  await expect(price(page)).toHaveText("Quote after walkthrough");
  expect(service(page)).toBe("pressure-washing");

  // A reload opens the same view from the address alone.
  await page.reload();
  await expect(chooser(page, "Pressure washing")).toBeChecked();
});

test("a service change keeps unrelated query parameters, the hash and the scroll position", async ({ page }) => {
  await open(page, `${palmetto}?utm_source=mailer%20a&service=window-cleaning&ref=card+2#profile-reviews`);
  await expect(chooser(page, "Window cleaning")).toBeChecked();
  const arrival = await history(page);
  const address = () => page.evaluate(() => `${window.location.pathname}${window.location.search}${window.location.hash}`);

  // The service keeps its place; the other parameters keep their spelling.
  await choose(page, "Gutter cleaning");
  await expect(price(page)).toHaveText("$160");
  expect(await address()).toBe(`${palmetto}?utm_source=mailer%20a&service=gutter-cleaning&ref=card+2#profile-reviews`);

  // Changing service does not jump to the hash target again.
  await page.evaluate(() => window.scrollTo(0, 0));
  await choose(page, "All services");
  await expect(summary(page)).toContainText("3 published services");
  expect(await address()).toBe(`${palmetto}?utm_source=mailer%20a&ref=card+2#profile-reviews`);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await choose(page, "Pressure washing");
  expect(await address()).toBe(`${palmetto}?utm_source=mailer%20a&ref=card+2&service=pressure-washing#profile-reviews`);
  expect(await history(page)).toEqual(arrival);

  // The address still opens the same view, and section links still work after the changes.
  await page.reload();
  await expect(chooser(page, "Pressure washing")).toBeChecked();
  await page.getByRole("navigation", { name: "Profile sections" }).getByRole("link", { name: "Service area" }).click();
  expect(await address()).toBe(`${palmetto}?utm_source=mailer%20a&ref=card+2&service=pressure-washing#profile-area`);
  await expect(chooser(page, "Pressure washing")).toBeChecked();
});

test("phones and tablets choose the service from a dropdown that keeps focus", async ({ page }) => {
  await open(page, palmetto, 390);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(dropdown(page).getByRole("option")).toHaveText(["All services", "Window cleaning", "Gutter cleaning", "Pressure washing"]);
  expect(await dropdownChoice(page)).toBe("All services");
  const entries = (await history(page)).length;

  await dropdown(page).focus();
  await dropdown(page).selectOption({ label: "Gutter cleaning" });
  await expect(page.locator("[data-profile]")).toHaveAttribute("data-profile-view", "gutter-cleaning");
  await expect(dropdown(page)).toBeFocused();
  await expect(price(page)).toHaveText("$160");
  expect(service(page)).toBe("gutter-cleaning");
  await expect(page.locator("[data-profile-announcement]")).toHaveText("Showing Gutter cleaning: Gutter clean-out, $160.");

  await dropdown(page).selectOption({ label: "All services" });
  await expect(summary(page)).toContainText("3 published services");
  expect(service(page)).toBeNull();
  expect((await history(page)).length).toBe(entries);

  // Choosing from a service list returns focus to the dropdown, which shows the choice.
  await page.locator("[data-service-row=pressure-washing]").click();
  await expect(dropdown(page)).toBeFocused();
  expect(await dropdownChoice(page)).toBe("Pressure washing");

  // A link to a service this provider does not publish leaves the dropdown on All services.
  await open(page, `${palmetto}?service=roof-cleaning`, 768);
  await expect(page.locator("[data-unavailable-service]")).toContainText("Roof cleaning is not currently offered by Palmetto Exterior Care.");
  expect(await dropdownChoice(page)).toBe("All services");
});

test("the dropdown and the chips are one selection", async ({ page }) => {
  await open(page, palmetto, 390);
  await dropdown(page).selectOption({ label: "Gutter cleaning" });
  await page.getByRole("checkbox", { name: "Add Gutter guard rinse" }).check();
  await expect(summary(page).locator("[data-price-total]")).toHaveText("$195");

  // Widening the window swaps the control, not the choice or what was chosen within it.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(dropdown(page)).toHaveCount(0);
  await expect(chooser(page, "Gutter cleaning")).toBeChecked();
  await expect(page.getByRole("radio", { checked: true }).and(page.locator("[name$=-service]"))).toHaveCount(1);
  await expect(summary(page).locator("[data-price-total]")).toHaveText("$195");

  await choose(page, "Window cleaning");
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.getByRole("radio", { name: "Window cleaning", exact: true })).toHaveCount(0);
  expect(await dropdownChoice(page)).toBe("Window cleaning");
  await expect(dropdown(page)).toHaveValue("window-cleaning");
  expect(service(page)).toBe("window-cleaning");
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

test("the ZIP stays through service changes and its result follows the service shown", async ({ page }) => {
  await open(page, `${palmetto}?service=window-cleaning`);
  const zip = page.getByRole("textbox", { name: "ZIP code" });
  const result = page.locator("[data-zip-result]");
  await zip.fill("33901");
  await page.keyboard.press("Enter");
  await expect(result).toHaveAttribute("data-zip-result", "listed");
  await expect(result).toContainText("Eligibility for window cleaning at your address is confirmed in the request step.");

  // Another service: the same ZIP, checked for that service.
  await choose(page, "Pressure washing");
  await expect(zip).toHaveValue("33901");
  await expect(result).toHaveAttribute("data-zip-result", "listed");
  await expect(result).toContainText("33901 is in the listed area");
  await expect(result).toContainText("Eligibility for pressure washing at your address is confirmed in the request step.");
  await expect(result).not.toContainText("window cleaning");
  await expect(page.getByText("Check the listed area for pressure washing.")).toBeVisible();

  // All services: still there, no longer naming a service.
  await choose(page, "All services");
  await expect(zip).toHaveValue("33901");
  await expect(result).toContainText("Eligibility for a service at your address is confirmed in the request step.");

  // A ZIP typed but not yet checked is kept too, and the last checked result stays until it is.
  await zip.fill("33904");
  await choose(page, "Gutter cleaning");
  await expect(zip).toHaveValue("33904");
  await expect(result).toContainText("33901 is in the listed area");
  await expect(result).toContainText("Eligibility for gutter cleaning");
  await page.getByRole("button", { name: "Check ZIP" }).click();
  await expect(result).toHaveAttribute("data-zip-result", "outside_provider");
  await choose(page, "Window cleaning");
  await expect(zip).toHaveValue("33904");
  await expect(result).toHaveAttribute("data-zip-result", "outside_provider");

  // The same holds on a phone, through the dropdown.
  await open(page, `${brightbin}?service=trash-can-cleaning`, 390);
  await page.getByRole("textbox", { name: "ZIP code" }).fill("33904");
  await page.getByRole("button", { name: "Check ZIP" }).click();
  await expect(result).toContainText("Eligibility for trash can cleaning");
  await dropdown(page).selectOption({ label: "All services" });
  await expect(page.getByRole("textbox", { name: "ZIP code" })).toHaveValue("33904");
  await expect(result).toContainText("Eligibility for a service at your address");
});

test("reviews are described as the business's in every view of a multi-service profile", async ({ page }) => {
  const sentence = page.getByText("Reviews shown are for the business overall.", { exact: true });
  await open(page, palmetto);
  await expect(sentence).toBeVisible();
  await expect(page.getByText(/Reviews cover the whole business/)).toHaveCount(0);
  const list = await page.locator("[data-reviews=list]").innerText();
  for (const name of ["Window cleaning", "Pressure washing"]) {
    await choose(page, name);
    await expect(sentence).toBeVisible();
    expect(await page.locator("[data-reviews=list]").innerText()).toBe(list);
    await expect(page.locator("[data-review-summary]")).toHaveText("4.5 (2 public reviews)");
  }
  // One service, or no reviews yet: there is nothing to tell apart, so nothing is said.
  await open(page, `${brightbin}?service=trash-can-cleaning`);
  await expect(page.locator("[data-reviews=list] li")).toHaveCount(3);
  await expect(sentence).toHaveCount(0);
  await open(page, harborline);
  await expect(page.locator("[data-reviews=empty]")).toBeVisible();
  await expect(sentence).toHaveCount(0);
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

  await dropdown(page).selectOption({ label: "Handyman" });
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

// ---------------------------------------------------------------------------------------------
// Catalog gate
// ---------------------------------------------------------------------------------------------

test.describe("with the catalog disabled", () => {
  // A second server from the same build, started without MDS_CATALOG_ENABLED, as production is.
  let server: ChildProcess | undefined;
  let origin = "";
  const output: string[] = [];

  test.beforeAll(async () => {
    const port = await new Promise<number>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const { port: free } = probe.address() as { port: number };
        probe.close(() => resolve(free));
      });
    });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55831",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "mds-synthetic-anon-key",
    };
    delete env.MDS_CATALOG_ENABLED;
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout?.on("data", chunk => output.push(String(chunk)));
    server.stderr?.on("data", chunk => output.push(String(chunk)));
    origin = `http://127.0.0.1:${port}`;
    await expect.poll(() => fetch(`${origin}/mds`).then(response => response.status, () => 0), { timeout: 25_000 }).not.toBe(0);
  });

  test.afterAll(() => { server?.kill(); });

  test("both gallery routes, and the catalog itself, return 404 and none of the gallery", async ({ request, baseURL }) => {
    const routes = ["/mds/profiles", `${brightbin}?service=trash-can-cleaning`, palmetto, "/mds"];
    for (const route of routes) {
      const response = await request.get(`${origin}${route}`);
      expect([route, response.status()]).toEqual([route, 404]);
      const body = await response.text();
      for (const text of ["Provider cards and dynamic profiles", "Brightbin", "Palmetto Exterior Care", "MDS review gallery", "What can we help with?"]) {
        expect([route, text, body.includes(text)]).toEqual([route, text, false]);
      }
    }
    // The same build with the gate on serves those routes: the 404 comes from the gate alone.
    for (const route of routes) {
      expect([route, (await request.get(`${baseURL}${route}`)).status()]).toEqual([route, 200]);
    }
    // The live provider directory is not behind the gate.
    expect((await request.get(`${origin}/providers`)).status()).toBe(200);
  });

  test("a browser on the disabled catalog sees the not-found page for both gallery routes", async ({ page }) => {
    // This test alone reaches the second server; everything else stays blocked.
    await page.unrouteAll();
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    for (const route of ["/mds/profiles", brightbin]) {
      const response = await page.goto(`${origin}${route}`);
      expect([route, response?.status()]).toEqual([route, 404]);
      await expect(page.locator("[data-provider-card], [data-profile], [data-gallery-controls]")).toHaveCount(0);
      await expect(page.getByText("Provider cards and dynamic profiles")).toHaveCount(0);
    }
  });
});
