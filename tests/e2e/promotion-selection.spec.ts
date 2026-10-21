// TRACE-116 (DEC-2026-042), synthetic: after submission the homeowner sees the offer on their
// request and, when it no longer applies, chooses again; operators see the gate and the cleanup
// of unpaid reservations. Server behavior is SQL 087 and scripts/pricing-concurrency.mjs.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const homeowner = "00000000-0000-4000-8000-000000000001";
const contractor = "00000000-0000-4000-8000-000000000002";
const requestId = "00000000-0000-4000-8000-000000000010";
const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();
const row = {
  id: requestId, customer_id: homeowner, contractor_id: contractor, service_type: "Synthetic Lawn Service",
  description: null, status: "scheduled", matching_status: "matched", pricing_mode: "fixed", quote_only: false, payment_status: null,
  preferred_date: null, preferred_time: null, address: "123 Synthetic Test Lane", city: "Cape Coral", state: "FL", zip_code: "33904",
  quote_amount: null, total_amount: 100, created_at: minutes(-30), updated_at: minutes(-30), assigned_at: minutes(-30), match_expires_at: null,
  package_question_answers: {}, scheduled_start_at: null, service_catalog_id: null, preferred_contractor_id: null, photo_proof_urls: null,
  quote_status: null, current_quote_id: null, quote_expires_at: null, quote_declined_at: null, quote_approved_at: null,
  vendor_completed_at: null, homeowner_confirmed_at: null,
};
const option = (id: string, label: string, discount: number) => ({
  offer_id: `00000000-0000-4000-8000-0000000007${id}`, fingerprint: id.slice(-1).repeat(64), label, terms: `${label} terms.`,
  ends_at: "2026-12-31T23:59:00Z", timezone: "America/New_York", first_booking_only: false, requires_code: false,
  service_cents: 10000, discount_cents: discount, total_after_cents: 10000 - discount, best: false,
});
const state = (overrides: Record<string, unknown>) => ({
  available: true, credits: null, state: "applied", reason: null, service_cents: 10000, confirmed_service_cents: 9000, editable: true,
  locked_reason: null, applied: null, options: [], code: null, ...overrides,
});

async function openRequest(page: Page, promotion: () => unknown, chosen: unknown[], width = 320) {
  await syntheticSession(page.context(), "homeowner");
  await page.setViewportSize({ width, height: 1000 });
  await page.route("**/rest/v1/service_requests?**", (route) => route.fulfill({ json: [row] }));
  await page.route("**/rest/v1/rpc/homeowner_request_promotion", (route) => {
    const answer = promotion();
    return answer === "fail" ? route.fulfill({ status: 500, json: { code: "XX000", message: "Synthetic outage" } }) : route.fulfill({ json: answer });
  });
  await page.route("**/rest/v1/rpc/homeowner_choose_request_promotion", (route) => {
    const body = route.request().postDataJSON() as { p_offer: string | null };
    chosen.push(body);
    return route.fulfill({ json: body.p_offer ? { status: "applied", reused: false } : { status: "declined", service_cents: 10000 } });
  });
  await page.goto("/dashboard?tab=upcoming");
  await page.getByRole("button", { name: "Open Synthetic Lawn Service details" }).click();
  return page.getByRole("dialog", { name: "Synthetic Lawn Service" });
}

for (const width of [320, 1440]) test(`an offer that no longer applies waits for the homeowner, who may continue without one (${width}px)`, async ({ page }) => {
  const chosen: Array<Record<string, unknown>> = [];
  let current: unknown = state({ state: "needs_homeowner", reason: "Offer ended before payment", options: [option("b2", "Synthetic $10 off", 1000)] });
  const dialog = await openRequest(page, () => current, chosen, width);
  const offer = dialog.getByRole("region", { name: "Offer" });
  await expect(offer).toContainText("Your offer no longer applies");
  await expect(offer).toContainText("Offer ended before payment. Checkout waits until you choose another offer or confirm the price without one ($100).");
  await expect(offer.getByRole("radio", { name: /Synthetic \$10 off/ })).not.toBeChecked();
  // Scoped to the new section: the dialog's existing "Scheduled" status badge is a separate finding.
  expect((await new AxeBuilder({ page }).include(`[aria-labelledby="offer-${requestId}"]`).withTags(tags).analyze()).violations).toEqual([]);
  current = state({ state: "declined", confirmed_service_cents: 10000, applied: null, options: [option("b2", "Synthetic $10 off", 1000)] });
  await offer.getByRole("button", { name: "Continue without an offer at $100" }).click();
  await expect(offer.getByRole("status").filter({ hasText: "No offer. Your service total is $100." })).toBeVisible();
  expect(chosen).toEqual([expect.objectContaining({ p_request: requestId, p_offer: null, p_fingerprint: null, p_expected_cents: 10000 })]);
});

test("an offers outage is said on the request and can be retried", async ({ page }) => {
  let current: unknown = "fail";
  const dialog = await openRequest(page, () => current, []);
  const offer = dialog.getByRole("region", { name: "Offer" });
  const notice = offer.getByRole("status").filter({ hasText: "We couldn’t load this request’s offer. Checkout still checks it." });
  await expect(notice).toBeVisible();
  expect((await new AxeBuilder({ page }).include(`[aria-labelledby="offer-${requestId}"]`).withTags(tags).analyze()).violations).toEqual([]);
  current = state({ state: "needs_homeowner", reason: "Offer ended before payment", options: [] });
  await notice.getByRole("button", { name: "Try again" }).click();
  await expect(notice).toHaveCount(0);
  await expect(offer).toContainText("Your offer no longer applies");
});

test("the homeowner replaces an applied offer explicitly and sees the new total", async ({ page }) => {
  const chosen: Array<Record<string, unknown>> = [];
  const applied = { offer_id: "00000000-0000-4000-8000-0000000007a1", label: "Synthetic $10 off", terms: "Synthetic", ends_at: null,
    service_cents: 10000, discount_cents: 1000, total_after_cents: 9000, committed: false, problem: null };
  const dialog = await openRequest(page, () => state({ applied, options: [option("c3", "Synthetic $15 off", 1500)] }), chosen);
  const offer = dialog.getByRole("region", { name: "Offer" });
  await expect(offer).toContainText("Synthetic $10 off: save $10. Service total $90 instead of $100.");
  await offer.getByRole("radio", { name: /Synthetic \$15 off/ }).click();
  await expect(offer.getByRole("status").filter({ hasText: "Synthetic $15 off applied. Your service total is $85." })).toBeVisible();
  expect(chosen).toEqual([expect.objectContaining({ p_offer: "00000000-0000-4000-8000-0000000007c3", p_fingerprint: "3".repeat(64), p_expected_cents: 8500 })]);
});

test("once checkout starts the offer is shown but cannot change", async ({ page }) => {
  const applied = { offer_id: "00000000-0000-4000-8000-0000000007a1", label: "Synthetic $10 off", terms: "Synthetic", ends_at: null,
    service_cents: 10000, discount_cents: 1000, total_after_cents: 9000, committed: false, problem: null };
  const dialog = await openRequest(page, () => state({ applied, editable: false, locked_reason: "checkout_started" }), []);
  const offer = dialog.getByRole("region", { name: "Offer" });
  await expect(offer).toContainText("Checkout has started, so the offer can no longer change.");
  await expect(offer.getByRole("radio")).toHaveCount(0);
  await expect(offer.getByRole("button", { name: "Remove the offer" })).toHaveCount(0);
});

test("with the promotions gate closed the request shows no offer section", async ({ page }) => {
  const dialog = await openRequest(page, () => ({ available: false, credits: null }), []);
  await expect(dialog.getByRole("heading", { name: "Synthetic Lawn Service" })).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Offer" })).toHaveCount(0);
});

test("operators see the gate state and the unpaid reservation cleanup", async ({ page }) => {
  await page.route("**/rpc/admin_promotion_offers", (route) => route.fulfill({ json: [] }));
  await page.route("**/rpc/admin_promotion_reservation_health", (route) => route.fulfill({ json: {
    gate_open: true, scheduled: false, reserved: 3, releasable: 1, held_by_checkout: 1, needs_homeowner: 2, runs_24h: 0, last_run: null } }));
  await page.route("**/rest/v1/contractors?*", (route) => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/vendor_packages?*", (route) => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/services_catalog?*", (route) => route.fulfill({ json: [] }));
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/admin/promotions");
  await expect(page.getByRole("note")).toContainText("Homeowners can choose live offers");
  const card = page.locator("[data-slot=card]").filter({ hasText: "Unpaid reservation cleanup" });
  await expect(card).toContainText("Not scheduled");
  await expect(card).toContainText("Waiting for cleanup1");
  await expect(card).toContainText("Last cleanupNever");
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
