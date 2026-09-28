// TRACE-099 (Phase 6.3): exclusive offers, honest provider status, consent and exhaustion.
// Synthetic fixture only; accept/decline/consent outcomes come from stubbed read-backs, and the
// real commands are proven separately by SQL 067 and scripts/phase6-matching-offers.mjs.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";
import { formatEastern } from "../../src/lib/offerStatus";

const homeowner = "00000000-0000-4000-8000-000000000001";
const contractor = "00000000-0000-4000-8000-000000000002";
const fixedId = "00000000-0000-4000-8000-000000000010";
const quoteId = "00000000-0000-4000-8000-000000000012";
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;

type Row = Record<string, unknown>;
const request = (id: string, overrides: Row = {}): Row => ({
  id, customer_id: homeowner, contractor_id: contractor, service_type: "Synthetic Lawn Service",
  description: "Synthetic scope for offer verification.", status: "matched", matching_status: "offered",
  pricing_mode: "fixed", quote_only: false, payment_status: null, preferred_date: null, preferred_time: null,
  address: "123 Synthetic Test Lane", city: "Cape Coral", state: "FL", zip_code: "33904",
  quote_amount: null, total_amount: 120, created_at: minutes(-30), updated_at: minutes(-30), assigned_at: minutes(-30),
  match_expires_at: minutes(150), package_question_answers: {}, scheduled_start_at: null, service_catalog_id: null,
  preferred_contractor_id: null, photo_proof_urls: null, quote_status: null, current_quote_id: null, quote_expires_at: null,
  quote_declined_at: null, quote_approved_at: null, vendor_completed_at: null, homeowner_confirmed_at: null,
  ...overrides,
});
const quoteOffer = request(quoteId, { service_type: "Synthetic Quote Service", pricing_mode: "custom_quote", quote_only: true, total_amount: 90 });
const accepted = (row: Row, extra: Row = {}) => ({ ...row, status: "scheduled", matching_status: "matched", match_expires_at: null, ...extra });

type Reply = "ok" | "abort" | { status: number; body: Row };
type VendorState = { rows: Row[]; readback: Row[] | "error"; accept?: Reply; decline?: Reply; lists: number; calls: string[] };

async function vendorOffers(page: Page, state: VendorState, theme = "light", width = 320) {
  await syntheticSession(page.context(), "vendor");
  await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 1000 });
  await page.route("**/rest/v1/service_requests?**", (route) => {
    if (/[?&]id=eq\./.test(route.request().url())) {
      return state.readback === "error"
        ? route.fulfill({ status: 500, json: { message: "Synthetic read failure", code: "FIXTURE" } })
        : route.fulfill({ json: state.readback });
    }
    state.lists += 1;
    return route.fulfill({ json: state.rows });
  });
  for (const name of ["accept", "decline"] as const) {
    await page.route(`**/rest/v1/rpc/vendor_${name}_job`, (route) => {
      state.calls.push(name);
      const reply = state[name] ?? "ok";
      if (reply === "abort") return route.abort("failed");
      if (reply === "ok") return route.fulfill({ status: 204, body: "" });
      return route.fulfill({ status: reply.status, json: reply.body });
    });
  }
  await page.goto("/vendor/jobs");
  await expect(page.getByRole("heading", { level: 1, name: "Jobs & Requests" })).toBeVisible();
}
const card = (page: Page, service: string) => page.locator("[data-slot=card]").filter({ has: page.getByText(service, { exact: true }) });
async function confirmAccept(page: Page, service: string) {
  await card(page, service).getByRole("button", { name: "Accept offer", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Accept this offer?" });
  await dialog.getByRole("button", { name: "Accept offer", exact: true }).click();
  return dialog;
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`vendor ${theme} ${width}px: exclusive offers show an ET deadline, the price mode and a confirmed commitment`, async ({ page }) => {
    test.slow(); // two axe scans and a full-page screenshot
    const state: VendorState = { rows: [request(fixedId), quoteOffer], readback: [], lists: 0, calls: [] };
    await vendorOffers(page, state, theme, width);
    const fixed = card(page, "Synthetic Lawn Service");
    await expect(fixed.getByText(formatEastern(state.rows[0].match_expires_at as string)!, { exact: true })).toBeVisible();
    await expect(fixed.getByText(/^2h (29|30)m left$/)).toBeVisible();
    await expect(fixed.getByText("$120.00", { exact: true })).toBeVisible();
    await expect(card(page, "Synthetic Quote Service").getByText("Quote required", { exact: true })).toBeVisible();
    await expect(page.locator("[aria-live]").filter({ hasText: /left$/ })).toHaveCount(0);
    await card(page, "Synthetic Quote Service").getByRole("button", { name: "Accept offer", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Accept this offer?" });
    await expect(dialog).toContainText("This is quote work: the price isn’t set until a quote is agreed.");
    await expect(dialog).toContainText("with no appointment time until one is recorded");
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(card(page, "Synthetic Quote Service").getByRole("button", { name: "Accept offer", exact: true })).toBeFocused();
    expect(state.calls).toEqual([]);
    expect(await page.locator("main").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: `test-results/trace099-vendor-offers-${theme}-${width}.png`, fullPage: true });
  });
}

test("vendor: accepted quote work reads back as accepted without an appointment or price", async ({ page }) => {
  const state: VendorState = { rows: [quoteOffer], readback: [accepted(quoteOffer)], lists: 0, calls: [] };
  await vendorOffers(page, state);
  await confirmAccept(page, "Synthetic Quote Service");
  const notice = page.getByRole("status").filter({ hasText: "Offer accepted" });
  await expect(notice).toBeFocused();
  await expect(notice).toContainText("This is quote work, so the price isn’t set yet. No appointment time is recorded yet.");
  await expect(page.getByText("No open offers", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Active Jobs/ }).click();
  await expect(page.getByText("No appointment time recorded yet", { exact: true })).toBeVisible();
  expect(state.calls).toEqual(["accept"]);
});

test("vendor: a lost acceptance response is recovered from the read-back, without a retry", async ({ page }) => {
  const state: VendorState = { rows: [request(fixedId)], readback: [accepted(request(fixedId), { scheduled_start_at: "2026-10-01T14:00:00.000Z" })], accept: "abort", lists: 0, calls: [] };
  await vendorOffers(page, state);
  await confirmAccept(page, "Synthetic Lawn Service");
  await expect(page.getByRole("status").filter({ hasText: "Offer accepted" })).toContainText("Appointment: Oct 1, 2026, 10:00 AM ET.");
  expect(state.calls).toEqual(["accept"]);
});

test("vendor: an expired offer is refused and the list is re-read", async ({ page }) => {
  const state: VendorState = { rows: [request(fixedId)], readback: [request(fixedId)], accept: { status: 400, body: { code: "22023", message: "Offer has expired" } }, lists: 0, calls: [] };
  await vendorOffers(page, state);
  const before = state.lists;
  state.rows = [];
  await confirmAccept(page, "Synthetic Lawn Service");
  await expect(page.getByRole("status").filter({ hasText: "Response window closed" })).toBeFocused();
  await expect(page.getByText("No open offers", { exact: true })).toBeVisible();
  expect(state.lists).toBeGreaterThan(before);
});

test("vendor: a withdrawn or reassigned offer says so and leaves the queue", async ({ page }) => {
  const state: VendorState = { rows: [request(fixedId)], readback: [], accept: { status: 400, body: { code: "P0001", message: "No open offer is available to accept" } }, lists: 0, calls: [] };
  await vendorOffers(page, state);
  await confirmAccept(page, "Synthetic Lawn Service");
  const notice = page.getByRole("status").filter({ hasText: "Offer no longer available" });
  await expect(notice).toBeFocused();
  await expect(notice).toContainText("your response wasn’t recorded");
  await expect(page.getByText("No open offers", { exact: true })).toBeVisible();
});

test("vendor: an eligibility refusal stays inline and the offer remains actionable", async ({ page }) => {
  const state: VendorState = { rows: [request(fixedId)], readback: [request(fixedId)], accept: { status: 400, body: { code: "22023", message: "Provider is no longer eligible" } }, lists: 0, calls: [] };
  await vendorOffers(page, state);
  const dialog = await confirmAccept(page, "Synthetic Lawn Service");
  await expect(dialog.getByRole("alert")).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const offer = card(page, "Synthetic Lawn Service");
  await expect(offer.getByRole("alert")).toContainText("You aren’t currently eligible for this request, so it wasn’t accepted.");
  await expect(offer.getByRole("button", { name: "Decline", exact: true })).toBeEnabled();
  expect(await axe(page)).toEqual([]);
});

test("vendor: an unconfirmed result asks to check again instead of guessing", async ({ page }) => {
  const state: VendorState = { rows: [request(fixedId)], readback: "error", lists: 0, calls: [] };
  await vendorOffers(page, state);
  const dialog = await confirmAccept(page, "Synthetic Lawn Service");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  const offer = card(page, "Synthetic Lawn Service");
  await expect(offer.getByRole("alert")).toContainText("We couldn’t confirm whether your response was saved.");
  const before = state.lists;
  await offer.getByRole("button", { name: "Check again", exact: true }).click();
  await expect.poll(() => state.lists).toBeGreaterThan(before);
});

test("vendor: decline copy allows consent or exhaustion and the result is read back", async ({ page }) => {
  const state: VendorState = { rows: [request(fixedId)], readback: [], lists: 0, calls: [] };
  await vendorOffers(page, state);
  await card(page, "Synthetic Lawn Service").getByRole("button", { name: "Decline", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Decline this offer?" });
  await expect(dialog).toContainText("Mercurius may offer it to another eligible provider, ask the homeowner how to proceed, or tell them it isn’t available yet.");
  await dialog.getByRole("button", { name: "Decline offer", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Offer declined" })).toBeFocused();
  expect(state.calls).toEqual(["decline"]);
});

test("vendor: a lapsed window disables responses and returning to the page re-reads offers", async ({ page }) => {
  const state: VendorState = { rows: [request(fixedId, { match_expires_at: minutes(-1) })], readback: [], lists: 0, calls: [] };
  await vendorOffers(page, state);
  const offer = card(page, "Synthetic Lawn Service");
  await expect(offer.getByText("Response window closed", { exact: true })).toBeVisible();
  await expect(offer.getByRole("button", { name: "Accept offer", exact: true })).toBeDisabled();
  await expect(offer.getByRole("button", { name: "Decline", exact: true })).toBeDisabled();
  const before = state.lists;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => state.lists).toBeGreaterThan(before);
});

// ---------------------------------------------------------------- homeowner

async function homeownerRequests(page: Page, rows: Row[], theme = "light") {
  await syntheticSession(page.context(), "homeowner");
  await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.route("**/rest/v1/service_requests?**", (route) => route.fulfill({ json: rows }));
  await page.goto("/dashboard?tab=upcoming");
}

for (const theme of ["light", "dark"]) {
  test(`homeowner ${theme}: a pending offer is not an assignment and exhaustion is honest`, async ({ page }) => {
    const pending = request(fixedId);
    await homeownerRequests(page, [pending, request(quoteId, { service_type: "Synthetic Quote Service", status: "pending", matching_status: "exhausted", contractor_id: null, pricing_mode: "custom_quote" })], theme);
    const lawn = page.getByRole("button", { name: "Open Synthetic Lawn Service details" });
    await expect(lawn).toContainText("Waiting for a provider to respond");
    await expect(page.getByRole("button", { name: "Open Synthetic Quote Service details" })).toContainText("Not available yet in your area");
    await expect(page.getByText("Provider assigned", { exact: true })).toHaveCount(0);
    await lawn.click();
    const dialog = page.getByRole("dialog", { name: "Synthetic Lawn Service" });
    await expect(dialog.getByRole("heading", { name: "Waiting for a provider to respond" })).toBeVisible();
    await expect(dialog).toContainText(`Offered to an eligible provider. No provider has accepted yet; they have until ${formatEastern(pending.match_expires_at as string)} to respond.`);
    await expect(dialog.getByRole("link", { name: /Message provider/ })).toHaveCount(0);
    await expect(dialog.getByText("Loading assigned provider")).toHaveCount(0);
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: `test-results/trace099-homeowner-offer-${theme}.png`, fullPage: true });
  });
}

test("homeowner: consent is confirmed from the stored record even when the response is lost", async ({ page }) => {
  const waiting = request(fixedId, { status: "pending", matching_status: "awaiting_consent", contractor_id: null, preferred_contractor_id: contractor });
  await homeownerRequests(page, [waiting]);
  await page.route("**/rest/v1/rpc/consent_to_provider_fallback", (route) => route.abort("failed"));
  await page.route("**/rest/v1/matching_fallback_consents?**", (route) => route.fulfill({ json: [{ request_id: fixedId }] }));
  await page.getByRole("button", { name: "Open Synthetic Lawn Service details" }).click();
  const dialog = page.getByRole("dialog", { name: "Synthetic Lawn Service" });
  await expect(dialog.getByRole("heading", { name: "Your choice is needed" })).toBeVisible();
  await expect(dialog).toContainText("It won’t be offered to anyone else unless you allow it.");
  await dialog.getByRole("button", { name: "Allow another provider", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Allow another provider?" });
  await expect(confirm).toContainText("one eligible provider at a time");
  await expect(confirm).toContainText("not available yet in your area");
  expect(await axe(page)).toEqual([]);
  await confirm.getByRole("button", { name: "Allow other providers", exact: true }).click();
  await expect(page.getByText("Other providers allowed", { exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test("homeowner: consent that was not recorded stays recoverable", async ({ page }) => {
  const waiting = request(fixedId, { status: "pending", matching_status: "awaiting_consent", contractor_id: null, preferred_contractor_id: contractor });
  await homeownerRequests(page, [waiting]);
  await page.route("**/rest/v1/rpc/consent_to_provider_fallback", (route) => route.fulfill({ status: 400, json: { code: "22023", message: "Request is not awaiting matching" } }));
  await page.route("**/rest/v1/matching_fallback_consents?**", (route) => route.fulfill({ json: [] }));
  await page.getByRole("button", { name: "Open Synthetic Lawn Service details" }).click();
  await page.getByRole("dialog", { name: "Synthetic Lawn Service" }).getByRole("button", { name: "Allow another provider", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Allow another provider?" });
  await confirm.getByRole("button", { name: "Allow other providers", exact: true }).click();
  await expect(confirm.getByRole("alert")).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Synthetic Lawn Service" }).getByRole("alert")).toContainText("Your choice wasn’t saved. Request is not awaiting matching");
});
