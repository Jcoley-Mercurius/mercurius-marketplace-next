import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-112/113/114 synthetic browser evidence. Every package, draft, offer and amount is a
// mocked readback; the database contracts are SQL 082 (calculation), 083 (approval) and 084
// (promotions). Nothing here claims a real vendor, rate or campaign.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const vendorA = "00000000-0000-4000-8000-000000000091";
const vendorB = "00000000-0000-4000-8000-000000000092";
const pkgA = "00000000-0000-4000-8000-000000000093";
const pkgB = "00000000-0000-4000-8000-000000000094";
const draftId = "00000000-0000-4000-8000-000000000095";
const offerId = "00000000-0000-4000-8000-000000000096";
const platformOfferId = "00000000-0000-4000-8000-000000000097";
const revision = "b".repeat(64);
const updatedAt = "2026-10-18T12:00:00+00:00";

const content = {
  name: "Synthetic standard clean", description: "Synthetic scope", pricing_mode: "fixed", deposit_amount: null,
  included_scope: ["Kitchen", "Bathrooms"], policy_notes: "Synthetic provider note",
  questions: [{ question_key: "sqft", question_label: "Square feet", input_type: "number", is_required: true }],
  tiers: [
    { id: "small", name: "Up to 1,500 sq ft", frequency: "one-time", price_kind: "exact", price: 125, conditions: [{ question_key: "sqft", min: 0, max: 1500 }], includes: [] },
    { id: "large", name: "1,501 to 3,000 sq ft", frequency: "one-time", price_kind: "exact", price: 180, conditions: [{ question_key: "sqft", min: 1501, max: 3000 }], includes: [] },
  ],
  addons: [{ id: "fridge", name: "Inside fridge", price_kind: "range", price: 30, price_max: 50, min_quantity: 0, max_quantity: 1, is_required: false, frequencies: [] }],
};
const draft = {
  id: draftId, contractor_id: vendorA, contractor_name: "Synthetic Clean Co", service_id: "synthetic-clean", service_name: "Home cleaning",
  name: content.name, description: content.description, prices: [], content, revision, target_package_id: null, target_package_name: null,
  status: "draft", approval_state: "draft", approval_current: false, sent_at: null, approved_at: null, change_request: null,
  vendor_link: { linked: true, vendor_role: true, blocker: null }, delivery: { channel: "in_app", status: "not_sent", email: "not_sent" },
  internal_notes: "Synthetic internal note", created_by_email: "operator@example.invalid", created_at: updatedAt, updated_at: updatedAt,
};
const economics = (funding: "vendor" | "platform") => funding === "vendor"
  ? { eligible_cents: 10000, discount_cents: 1000, funding, homeowner_service_cents: 9000, commission_rate_bps: 750, commission_base_cents: 9000,
    commission_cents: 675, vendor_proceeds_cents: 8325, platform_subsidy_cents: 0 }
  : { eligible_cents: 10000, discount_cents: 1000, funding, homeowner_service_cents: 9000, commission_rate_bps: 750, commission_base_cents: 10000,
    commission_cents: 750, vendor_proceeds_cents: 9250, platform_subsidy_cents: 1000 };
const offer = (id: string, funding: "vendor" | "platform", status: string) => ({
  id, revision: 1, fingerprint: "c".repeat(64), status, live: status === "approved", funding,
  contractor_id: funding === "vendor" ? vendorA : null, contractor_name: funding === "vendor" ? "Synthetic Clean Co" : null,
  kind: "amount", percent_bps: null, amount_cents: 1000, max_discount_cents: null, min_spend_cents: 0,
  package_lineage_ids: funding === "vendor" ? [pkgA] : [], package_names: funding === "vendor" ? ["Synthetic standard clean"] : [],
  service_ids: [], zip_codes: [], first_booking_only: false, requires_code: false, label: funding === "vendor" ? "Synthetic fall offer" : "Synthetic welcome",
  terms: "Synthetic terms; one per booking.", starts_at: "2026-10-18T13:00:00+00:00", ends_at: "2026-11-18T13:00:00+00:00", timezone: "America/New_York",
  max_redemptions: 20, budget_cents: funding === "platform" ? 50000 : null, vendor_approved_at: null, vendor_note: null, authorized_at: null,
  updated_at: updatedAt, usage: { reserved: 0, finalized: 0, released: 0, subsidy_committed_cents: 0, vendor_discount_cents: 0, commission_relief_cents: 0 },
  example: economics(funding),
});

// Registered first, so each test's own routes (registered later) take precedence.
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
});

async function adminPrices(page: Page, width = 1440, query = "") {
  await page.route("**/rest/v1/vendor_packages?*", route => route.fulfill({ json: [
    { id: pkgA, contractor_id: vendorA, service_id: "synthetic-clean", template_id: null, name: "Synthetic standard clean", pricing_mode: "fixed",
      deposit_amount: null, is_active: true, needs_review: false, updated_at: updatedAt, sort_order: 0, lineage_id: pkgA, revision_number: 1 },
    { id: pkgB, contractor_id: vendorB, service_id: "synthetic-clean", template_id: null, name: "Synthetic other clean", pricing_mode: "fixed",
      deposit_amount: null, is_active: true, needs_review: true, updated_at: updatedAt, sort_order: 0, lineage_id: pkgB, revision_number: 1 },
  ] }));
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: [{ id: vendorA, name: "Synthetic Clean Co" }, { id: vendorB, name: "Synthetic Other Co" }] }));
  await page.route("**/rest/v1/services_catalog?*", route => route.fulfill({ json: [
    { id: "synthetic-clean", name: "Home cleaning", default_frequency: "one-time", available_frequencies: ["one-time", "monthly"] },
  ] }));
  await page.route("**/rest/v1/package_tiers?*", route => route.fulfill({ json: [
    { id: "00000000-0000-4000-8000-0000000000a1", package_id: pkgA, name: "Small", price: 125, frequency: "one-time", sort_order: 0 },
    { id: "00000000-0000-4000-8000-0000000000a2", package_id: pkgB, name: "Small", price: 130, frequency: "one-time", sort_order: 0 },
  ] }));
  await page.route("**/rest/v1/package_addons?*", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/pricing_template_addons?*", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/admin_package_drafts", route => route.fulfill({ json: [draft] }));
  await page.route("**/rpc/admin_package_contents", route => route.fulfill({ json: [] }));
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/admin/vendor-prices${query}`);
  await expect(page.getByRole("heading", { level: 1, name: "Vendor Prices" })).toBeVisible();
}

test("the vendor filter scopes packages and drafts with real counts", async ({ page }) => {
  await adminPrices(page, 1440, `?vendor=${vendorB}`);
  await expect(page.getByText("Synthetic Other Co: 1 package · 0 drafts · 1 needs review")).toBeVisible();
  await expect(page.getByRole("table", { name: "Vendor packages", exact: true }).getByRole("link", { name: "Synthetic Clean Co" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Filter by vendor" }).selectOption("");
  await expect(page.getByText("2 packages · 1 draft · 1 needs review")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/vendor-prices$/);
});

test("a draft shows its full content, can be published, and is sent for the vendor's approval of that revision", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/rpc/admin_send_package_draft", route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { status: "sent", draft: { ...draft, approval_state: "sent", sent_at: updatedAt } } });
  });
  await adminPrices(page, 320);
  await expect(page.getByText("Up to 1,500 sq ft · Square feet 0–1,500")).toBeVisible();
  await expect(page.getByText("+$30–$50")).toBeVisible();
  await expect(page.getByText("Kitchen · Bathrooms")).toBeVisible();
  // TRACE-122: notes are internal; the draft's content notes are not shown as provider notes.
  await expect(page.getByText("Internal notes (not shown to homeowners)").first()).toBeVisible();
  await expect(page.getByText("Synthetic internal note").first()).toBeVisible();
  await expect(page.getByText("Synthetic provider note")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Sent for approval")).toBeVisible();
  expect(sent).toEqual([{ p_draft: draftId, p_revision: revision }]);
});

// DEC-2026-041 item 6: with no vendor account, the notice goes to the contact email on file;
// the operator is told it is not approval, and a failed email stays visible with a resend.
test("an unlinked vendor is emailed a notice that is not approval, and failures stay visible", async ({ page }) => {
  const emailed: unknown[] = [];
  const unlinked = { ...draft, vendor_link: { linked: false, vendor_role: false, email_on_file: true, blocker: "No vendor account is bound to this provider" } };
  await page.route("**/rpc/admin_send_package_draft", route => route.fulfill({ json: { status: "sent", channel: "email", email_queued: true,
    draft: { ...unlinked, approval_state: "sent" } } }));
  await page.route("**/api/admin/package-draft-emails", route => { emailed.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, json: { state: "failed", message: "The email was refused. The vendor has not been told; resend it or contact them another way." } }); });
  await adminPrices(page, 320);
  await page.unroute("**/rpc/admin_package_drafts");
  await page.route("**/rpc/admin_package_drafts", route => route.fulfill({ json: [emailed.length
    ? { ...unlinked, approval_state: "sent", sent_at: updatedAt, delivery: { channel: "email", status: "emailed", email: "failed", email_attempts: 1, email_error: "Resend returned 422: invalid to [address]" } }
    : unlinked] }));
  await page.reload();
  await expect(page.getByText("Sending emails a notice to the contact email on file; the email is not approval.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Email notice not confirmed")).toBeVisible();
  expect(emailed).toEqual([{ draftId, resend: false, confirmUnknown: false }]);
  await expect(page.getByText("Email failed; the vendor was not told")).toBeVisible();
  await expect(page.getByText("Email error: Resend returned 422: invalid to [address]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend email" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
});

test("building a package previews it with the server calculation before saving", async ({ page }) => {
  const previews: unknown[] = [];
  const saved: unknown[] = [];
  await page.route("**/rpc/pricing_preview_content", route => {
    previews.push(route.request().postDataJSON());
    return route.fulfill({ json: { status: "estimate", reason: null, total_cents: null, min_cents: 15500, max_cents: 17500, lines: [
      { kind: "tier", id: "level-1", name: "Small", price_kind: "exact", quantity: 1, amount_cents: 12500, amount_max_cents: 12500, required: true },
      { kind: "addon", id: "addon-1", name: "Inside fridge", price_kind: "range", quantity: 1, amount_cents: 3000, amount_max_cents: 5000, required: false },
    ] } });
  });
  await page.route("**/rpc/admin_save_package_draft_content", route => { saved.push(route.request().postDataJSON()); return route.fulfill({ json: draft }); });
  await adminPrices(page, 1440);
  await page.getByRole("button", { name: "Build a package" }).click();
  const dialog = page.getByRole("dialog", { name: "Build a package for a vendor" });
  await dialog.getByRole("combobox", { name: "Vendor (required)" }).selectOption({ label: "Synthetic Clean Co" });
  await dialog.getByRole("combobox", { name: "Service (required)" }).selectOption({ label: "Home cleaning" });
  await expect(dialog.getByRole("textbox", { name: "Package name (required)" })).toHaveValue("Home cleaning");
  await dialog.getByRole("button", { name: "Add price level" }).click();
  await dialog.getByRole("textbox", { name: "Level name" }).fill("Small");
  await dialog.getByRole("textbox", { name: "Price (required)" }).fill("125");
  await dialog.getByRole("button", { name: "Add add-on" }).click();
  await dialog.getByRole("textbox", { name: "Add-on name" }).fill("Inside fridge");
  await dialog.getByRole("combobox", { name: "Price", exact: true }).selectOption("range");
  await dialog.getByRole("textbox", { name: "From (required)" }).fill("30");
  await dialog.getByRole("textbox", { name: "To (required)" }).fill("50");
  await dialog.getByRole("textbox", { name: /^Inside fridge/ }).fill("1");
  const preview = dialog.getByRole("complementary", { name: "Homeowner preview" });
  await expect(preview.getByText("Draft, not approved")).toBeVisible();
  await expect(preview.getByText("Estimate $155–$175; the provider confirms the final price")).toBeVisible();
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(tags).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();
  expect(saved).toEqual([{ p_draft: null, p_expected_updated_at: null, p_contractor: vendorA, p_service: "synthetic-clean", p_target_package: null,
    p_content: { name: "Home cleaning", description: null, pricing_mode: "fixed", deposit_amount: null, included_scope: [], policy_notes: null, questions: [],
      tiers: [{ id: "level-1", name: "Small", frequency: "one-time", price_kind: "exact", price: 125, price_max: null, conditions: [], includes: [] }],
      addons: [{ id: "addon-1", name: "Inside fridge", description: null, price_kind: "range", price: 30, price_max: 50, unit_label: null,
        min_quantity: 0, max_quantity: 1, is_required: false, frequencies: [] }] } }]);
  expect(previews.length).toBeGreaterThan(0);
});

async function vendorPricing(page: Page, approvals: unknown[], offers: unknown[]) {
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: vendorA } }));
  await page.route("**/rpc/vendor_package_approvals", route => route.fulfill({ json: approvals }));
  await page.route("**/rpc/vendor_promotion_offers", route => route.fulfill({ json: offers }));
  await page.route("**/rpc/vendor_my_package_price_corrections", route => route.fulfill({ json: [] }));
  await syntheticSession(page.context(), "vendor");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/vendor/pricing");
}

const vendorDraft = { id: draftId, contractor_id: vendorA, service_id: "synthetic-clean", service_name: "Home cleaning", content, revision,
  target_package_id: pkgA, target_package_name: "Synthetic standard clean", status: "draft", approval_state: "sent", sent_at: updatedAt,
  approved_at: null, change_request: null, package_id: null };

test("the vendor approves the exact version Mercurius sent, or asks for changes", async ({ page }) => {
  const approved: unknown[] = [];
  const changes: unknown[] = [];
  await page.route("**/rpc/vendor_approve_package_draft", route => { approved.push(route.request().postDataJSON()); return route.fulfill({ json: { ...vendorDraft, approval_state: "approved" } }); });
  await page.route("**/rpc/vendor_request_package_changes", route => { changes.push(route.request().postDataJSON()); return route.fulfill({ json: { ...vendorDraft, approval_state: "changes_requested" } }); });
  await page.route("**/rpc/pricing_preview_draft", route => route.fulfill({ json: { status: "exact", total_cents: 12500, lines: [
    { kind: "tier", id: "small", name: "Up to 1,500 sq ft", price_kind: "exact", quantity: 1, amount_cents: 12500, amount_max_cents: 12500, required: true }] } }));
  await vendorPricing(page, [vendorDraft], []);
  const panel = page.getByRole("region", { name: "Prices waiting for your approval" });
  await expect(panel.getByText("replaces \"Synthetic standard clean\"", { exact: false })).toBeVisible();
  await expect(panel.getByText("Waiting for your approval", { exact: true })).toBeVisible();
  await expect(panel.getByText("Mercurius can also publish a price without your approval", { exact: false })).toBeVisible();
  expect((await new AxeBuilder({ page }).include("#price-approvals").withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

  await panel.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByRole("dialog", { name: "What homeowners would see" });
  await preview.getByRole("textbox", { name: "Square feet" }).fill("1200");
  await expect(preview.getByText("$125 total")).toBeVisible();
  await page.keyboard.press("Escape");

  await panel.getByRole("button", { name: "Ask for changes" }).click();
  const ask = page.getByRole("dialog", { name: "Ask for changes" });
  await ask.getByRole("button", { name: "Send to Mercurius" }).click();
  await expect(ask.getByRole("alert")).toHaveText("Say what should change.");
  await ask.getByRole("textbox", { name: "What should change (required)" }).fill("Synthetic: small homes at $130");
  await ask.getByRole("button", { name: "Send to Mercurius" }).click();
  await expect.poll(() => changes).toEqual([{ p_draft: draftId, p_revision: revision, p_note: "Synthetic: small homes at $130" }]);

  await panel.getByRole("button", { name: "Approve this version" }).click();
  await expect.poll(() => approved).toEqual([{ p_draft: draftId, p_revision: revision }]);
});

test("a vendor sees the 7.5% economics of an offer it would fund before approving", async ({ page }) => {
  const approved: unknown[] = [];
  await page.route("**/rpc/vendor_approve_promotion_offer", route => { approved.push(route.request().postDataJSON()); return route.fulfill({ json: offer(offerId, "vendor", "approved") }); });
  await vendorPricing(page, [], [offer(offerId, "vendor", "awaiting_vendor")]);
  const panel = page.getByRole("region", { name: "Offers you would fund" });
  await expect(panel.getByText("commission is 7.5% instead of 15%", { exact: false })).toBeVisible();
  await expect(panel.getByText("homeowner pays $90.00, Mercurius commission $6.75 (7.5%), you receive $83.25", { exact: false })).toBeVisible();
  await expect(panel.getByText("An offer applies to a booking only when the homeowner chooses it", { exact: false })).toBeVisible();
  expect((await new AxeBuilder({ page }).include("#offer-approvals").withTags(tags).analyze()).violations).toEqual([]);
  await panel.getByRole("button", { name: "Approve this offer" }).click();
  await expect.poll(() => approved).toEqual([{ p_offer: offerId, p_fingerprint: "c".repeat(64) }]);
});

for (const width of [320, 1440]) {
  test(`promotions show funding, the gate and a worked example at ${width}px`, async ({ page }) => {
    const authorized: unknown[] = [];
    await page.route("**/rpc/admin_promotion_offers", route => route.fulfill({ json: [offer(platformOfferId, "platform", "draft"), offer(offerId, "vendor", "approved")] }));
    await page.route("**/rpc/admin_authorize_platform_promotion", route => { authorized.push(route.request().postDataJSON()); return route.fulfill({ json: offer(platformOfferId, "platform", "approved") }); });
    await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: [{ id: vendorA, name: "Synthetic Clean Co" }] }));
    await page.route("**/rest/v1/vendor_packages?*", route => route.fulfill({ json: [{ id: pkgA, name: "Synthetic standard clean", contractor_id: vendorA, lineage_id: pkgA, is_active: true }] }));
    await page.route("**/rest/v1/services_catalog?*", route => route.fulfill({ json: [{ id: "synthetic-clean", name: "Home cleaning" }] }));
    await syntheticSession(page.context(), "admin");
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/admin/promotions");
    await expect(page.getByRole("heading", { level: 1, name: "Promotions" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Offers are not shown to homeowners yet");
    const example = page.getByRole("definition").filter({ hasText: "$7.50" });
    await expect(example.first()).toBeVisible();
    await expect(page.getByLabel("Worked example for Synthetic welcome").getByText("Mercurius subsidy (not commission)")).toBeVisible();
    await expect(page.getByLabel("Worked example for Synthetic fall offer").getByText("Commission (7.5% of $90)")).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.getByRole("button", { name: "Authorize funding" }).click();
    const confirm = page.getByRole("alertdialog");
    await confirm.getByRole("textbox").fill("Synthetic welcome budget");
    await confirm.getByRole("button", { name: "Authorize" }).click();
    await expect.poll(() => authorized).toEqual([{ p_offer: platformOfferId, p_fingerprint: "c".repeat(64), p_reason: "Synthetic welcome budget" }]);
  });
}

test("a new offer is checked before it is sent and keeps Eastern campaign times", async ({ page }) => {
  const saved: Array<{ p_terms: Record<string, unknown> }> = [];
  await page.route("**/rpc/admin_promotion_offers", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/admin_save_promotion_offer", route => { saved.push(route.request().postDataJSON()); return route.fulfill({ json: offer(offerId, "vendor", "draft") }); });
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: [{ id: vendorA, name: "Synthetic Clean Co" }] }));
  await page.route("**/rest/v1/vendor_packages?*", route => route.fulfill({ json: [{ id: pkgA, name: "Synthetic standard clean", contractor_id: vendorA, lineage_id: pkgA, is_active: true }] }));
  await page.route("**/rest/v1/services_catalog?*", route => route.fulfill({ json: [{ id: "synthetic-clean", name: "Home cleaning" }] }));
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/admin/promotions");
  await expect(page.getByText("No offers yet")).toBeVisible();
  await page.getByRole("button", { name: "New offer" }).click();
  const dialog = page.getByRole("dialog", { name: "New offer" });
  await dialog.getByRole("button", { name: "Save offer" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter a start and an end.");
  await dialog.getByRole("combobox", { name: "Vendor (required)" }).selectOption({ label: "Synthetic Clean Co" });
  await dialog.getByRole("checkbox", { name: "Synthetic standard clean" }).check();
  await dialog.getByRole("textbox", { name: "Amount off (required)" }).fill("10");
  await dialog.getByLabel("Starts (required)").fill("2026-11-02T09:00");
  await dialog.getByLabel("Ends (required)").fill("2026-12-01T09:00");
  await dialog.getByRole("textbox", { name: "Label (required)" }).fill("Synthetic fall offer");
  await dialog.getByRole("textbox", { name: "Terms (required)" }).fill("Synthetic terms; one per booking.");
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(tags).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Save offer" }).click();
  await expect(page.getByText("Offer created")).toBeVisible();
  expect(saved[0].p_terms).toMatchObject({ funding: "vendor", contractor_id: vendorA, kind: "amount", amount_cents: 1000,
    package_lineage_ids: [pkgA], starts_at: "2026-11-02T14:00:00.000Z", ends_at: "2026-12-01T14:00:00.000Z", timezone: "America/New_York" });
});

test("the public profile shows price meaning truthfully", async ({ page }) => {
  const provider = "00000000-0000-4000-8000-0000000000b1";
  await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/pricing_server_now", route => route.fulfill({ json: new Date().toISOString() }));
  await page.route("**/rpc/r0_public_providers", route => route.fulfill({ json: {
    id: provider, name: "Synthetic Pricing Co", logo_url: null, bio: "Synthetic description", location: "Lee County, FL", badges: [], services: [],
    years_experience: 1, special_offer: null, our_promise: null, verified_specialty: null, tagline: null, video_url: null, website: null } }));
  await page.route("**/rest/v1/vendor_packages?*", route => route.fulfill({ json: [
    { id: "00000000-0000-4000-8000-0000000000b2", contractor_id: provider, service_id: "synthetic-cans", name: "Synthetic dump and clean", description: null,
      pricing_mode: "fixed", default_frequency: "one-time", deposit_amount: null, is_active: true, needs_review: false, sort_order: 0,
      included_scope: ["Two cans"], policy_notes: "Synthetic private note" },
    { id: "00000000-0000-4000-8000-0000000000b3", contractor_id: provider, service_id: "synthetic-clean", name: "Synthetic sized clean", description: null,
      pricing_mode: "fixed", default_frequency: "one-time", deposit_amount: null, is_active: true, needs_review: false, sort_order: 1 },
    { id: "00000000-0000-4000-8000-0000000000b4", contractor_id: provider, service_id: "synthetic-walk", name: "Synthetic estimate", description: "Synthetic",
      pricing_mode: "custom_quote", default_frequency: "one-time", deposit_amount: null, is_active: true, needs_review: false, sort_order: 2 },
    { id: "00000000-0000-4000-8000-0000000000b5", contractor_id: provider, service_id: "synthetic-walk", name: "Synthetic walkthrough", description: "Synthetic",
      pricing_mode: "custom_quote", default_frequency: "one-time", deposit_amount: null, is_active: true, needs_review: false, sort_order: 3 },
  ] }));
  await page.route("**/rest/v1/package_tiers?*", route => route.fulfill({ json: [
    { id: "t1", package_id: "00000000-0000-4000-8000-0000000000b2", name: "One-time", price: 89, frequency: "one-time", includes: [], sort_order: 0 },
    { id: "t2", package_id: "00000000-0000-4000-8000-0000000000b3", name: "Small", price: 100, frequency: "one-time", includes: [], sort_order: 0,
      rule_conditions: [{ question_key: "bedrooms", max: 2 }] },
    { id: "t3", package_id: "00000000-0000-4000-8000-0000000000b3", name: "Large", price: 180, frequency: "one-time", includes: [], sort_order: 1,
      rule_conditions: [{ question_key: "bedrooms", min: 3 }] },
    { id: "t4", package_id: "00000000-0000-4000-8000-0000000000b4", name: "Estimate", price: 250, price_kind: "range", price_max: 400, frequency: "one-time", includes: [], sort_order: 0 },
  ] }));
  await page.route("**/rest/v1/package_addons?*", route => route.fulfill({ json: [
    { id: "a1", package_id: "00000000-0000-4000-8000-0000000000b2", name: "Synthetic setup", description: null, price: 10, sort_order: 0,
      price_kind: "exact", is_required: true, min_quantity: 1, max_quantity: 1, frequencies: [] },
    { id: "a2", package_id: "00000000-0000-4000-8000-0000000000b2", name: "Extra can", description: null, price: 15, sort_order: 1,
      price_kind: "exact", unit_label: "can", is_required: false, min_quantity: 0, max_quantity: 6, frequencies: [] },
  ] }));
  await page.route("**/rest/v1/package_qualifying_questions?*", route => route.fulfill({ json: [
    { id: "q1", package_id: "00000000-0000-4000-8000-0000000000b3", question_key: "bedrooms", question_label: "Bedrooms", input_type: "number",
      unit: "bedrooms", options: null, is_required: true, sort_order: 0 },
  ] }));
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`/providers/${provider}`);
  await expect(page.getByRole("heading", { name: "Synthetic Pricing Co" })).toBeVisible();
  // The required add-on is part of the price shown: $89 + $10.
  await expect(page.getByRole("button", { name: /one-time.*\$99/i })).toBeVisible();
  await expect(page.getByText("Required · included in the price shown")).toBeVisible();
  await expect(page.getByText("+$15 per can")).toBeVisible();
  await expect(page.getByText("Included: Two cans", { exact: false })).toBeVisible();
  // Rule-based levels show the lowest as "From" and are chosen by the homeowner's answers.
  await expect(page.getByRole("button", { name: /one-time.*From \$100.*Set by your answers/i })).toBeVisible();
  await expect(page.getByText("$250–$400")).toBeVisible();
  await expect(page.getByText("Quote after walkthrough; no price is shown until then.")).toBeVisible();
  // TRACE-122: notes are never public; the bedroom size guide appears once; "1 year".
  await expect(page.getByText("Synthetic private note")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "How we size your home" })).toHaveCount(1);
  await expect(page.getByText("Prices are set by the number of bedrooms.", { exact: false })).toBeVisible();
  await expect(page.getByText("about 1,300–1,800 sq ft")).toBeVisible();
  await expect(page.getByText("1 year", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include("main").withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

// TRACE-122 review correction: the guide follows the price levels' conditions, not the questions asked.
for (const [label, conditions, expected] of [
  ["square-footage pricing that also asks bedrooms", [[{ question_key: "sqft", max: 1200 }], [{ question_key: "sqft", min: 1201 }]], null],
  ["bedroom and square-footage pricing", [[{ question_key: "sqft", max: 1200 }, { question_key: "bedrooms", max: 2 }], [{ question_key: "sqft", min: 1201 }, { question_key: "bedrooms", min: 3 }]],
    "Prices depend on the number of bedrooms and square footage."],
] as const) {
  test(`the public size guide describes ${label} accurately`, async ({ page }) => {
    const provider = "00000000-0000-4000-8000-0000000000c1";
    const pkg = "00000000-0000-4000-8000-0000000000c2";
    await page.route("**/rest/v1/**", route => route.fulfill({ json: [] }));
    await page.route("**/rpc/pricing_server_now", route => route.fulfill({ json: new Date().toISOString() }));
    await page.route("**/rpc/r0_public_providers", route => route.fulfill({ json: {
      id: provider, name: "Synthetic Sizing Co", logo_url: null, bio: "Synthetic description", location: "Lee County, FL", badges: [], services: [],
      years_experience: 3, special_offer: null, our_promise: null, verified_specialty: null, tagline: null, video_url: null, website: null } }));
    await page.route("**/rest/v1/vendor_packages?*", route => route.fulfill({ json: [
      { id: pkg, contractor_id: provider, service_id: "synthetic-clean", name: "Synthetic sized clean", description: null, pricing_mode: "fixed",
        default_frequency: "one-time", deposit_amount: null, is_active: true, needs_review: false, sort_order: 0, included_scope: [] }] }));
    await page.route("**/rest/v1/package_tiers?*", route => route.fulfill({ json: conditions.map((rule, index) => ({
      id: `t${index}`, package_id: pkg, name: `Level ${index + 1}`, price: 100 + index * 50, frequency: "one-time", includes: [], sort_order: index, rule_conditions: rule })) }));
    await page.route("**/rest/v1/package_qualifying_questions?*", route => route.fulfill({ json: [
      { id: "q1", package_id: pkg, question_key: "sqft", question_label: "Home size", input_type: "number", unit: "sq ft", options: null, is_required: true, sort_order: 0 },
      { id: "q2", package_id: pkg, question_key: "bedrooms", question_label: "Bedrooms", input_type: "number", unit: "bedrooms", options: null, is_required: true, sort_order: 1 },
    ] }));
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/providers/${provider}`);
    await expect(page.getByRole("heading", { name: "Synthetic Sizing Co" })).toBeVisible();
    await expect(page.getByRole("button", { name: /one-time.*From \$100/i })).toBeVisible();
    if (expected === null) {
      await expect(page.getByRole("heading", { name: "How we size your home" })).toHaveCount(0);
    } else {
      await expect(page.getByText(expected, { exact: false })).toBeVisible();
      await expect(page.getByText("not taken from the bedroom count", { exact: false })).toBeVisible();
    }
    await expect(page.getByText("Prices are set by the number of bedrooms", { exact: false })).toHaveCount(0);
  });
}
