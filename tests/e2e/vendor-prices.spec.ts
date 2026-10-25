import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-109 (DEC-2026-034) synthetic browser evidence. Package rows and the correction
// command are mocked readbacks and requests; nothing here claims a real vendor or price.
// The database contract is SQL 079. TRACE-110 (DEC-2026-035) adds operator draft prices
// and the every-two-months cadence (SQL 080), with the same synthetic mocks. TRACE-113
// (DEC-2026-039): the vendor can approve a draft's exact revision (SQL 083); the approval flow
// itself is in pricing-approval.spec.ts. DEC-2026-046 (TRACE-120): an operator publishes with
// or without that approval (SQL 091). DEC-2026-041 item 4: a price correction is proposed as
// a replacement draft (SQL 085); live packages show their content, price meaning and
// recorded approval evidence. TRACE-122 (DEC-2026-047, SQL 093): internal notes are edited in
// place and paused prices can be archived; the vendor sees an archived price as read-only
// history, outside its counts and coverage (SQL 094).
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const vendorA = "00000000-0000-4000-8000-000000000081";
const vendorB = "00000000-0000-4000-8000-000000000082";
const fixedPkg = "00000000-0000-4000-8000-000000000083";
const depositPkg = "00000000-0000-4000-8000-000000000084";
const updatedAt = "2026-10-15T12:00:00+00:00";
const draftId = "00000000-0000-4000-8000-000000000087";
const draftUpdatedAt = "2026-10-16T12:00:00+00:00";
const draft = { id: draftId, contractor_id: vendorB, contractor_name: "Synthetic Roof Co", service_id: "synthetic-lawn", service_name: "Lawn care",
  name: "Synthetic lawn plan", description: null, prices: [{ frequency: "monthly", price: 45 }, { frequency: "every-two-months", price: 75 }],
  status: "draft", package_id: null, created_by_email: "operator@example.invalid", created_at: draftUpdatedAt, updated_at: draftUpdatedAt,
  revision: "a".repeat(64), approval_state: "draft", approval_current: false,
  vendor_link: { linked: false, vendor_role: false, blocker: "No vendor account is bound to this provider" },
  delivery: { channel: "in_app", status: "not_sent", email: "not_sent" } };
const approvedDraft = { ...draft, approval_state: "approved", approval_current: true, approved_at: "2026-10-17T14:00:00+00:00",
  vendor_link: { linked: true, vendor_role: true, blocker: null } };

const packages = [
  { id: fixedPkg, contractor_id: vendorA, service_id: "synthetic-lawn", template_id: null, name: "Synthetic lawn package", pricing_mode: "fixed",
    deposit_amount: null, is_active: true, needs_review: true, updated_at: updatedAt, sort_order: 0 },
  { id: depositPkg, contractor_id: vendorB, service_id: "synthetic-roof", template_id: null, name: "Synthetic roof quote", pricing_mode: "deposit_quote",
    deposit_amount: 50, is_active: false, needs_review: false, updated_at: updatedAt, sort_order: 0 },
];

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.route("**/rest/v1/vendor_packages?*", route => route.fulfill({ json: packages }));
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: [{ id: vendorA, name: "Synthetic Lawn Co" }, { id: vendorB, name: "Synthetic Roof Co" }] }));
  await page.route("**/rest/v1/services_catalog?*", route => route.fulfill({ json: [
    { id: "synthetic-lawn", name: "Lawn care", default_frequency: "monthly", available_frequencies: ["monthly", "every-two-months", "one-time"] },
    { id: "synthetic-roof", name: "Roof repair", default_frequency: "one-time", available_frequencies: ["one-time"] },
  ] }));
  await page.route("**/rpc/admin_package_drafts", route => route.fulfill({ json: [draft] }));
  await page.route("**/rest/v1/package_tiers?*", route => route.fulfill({ json: [
    { id: "00000000-0000-4000-8000-000000000085", package_id: fixedPkg, name: "Basic", price: 1000, frequency: "one-time", sort_order: 0 },
  ] }));
  await page.route("**/rest/v1/package_addons?*", route => route.fulfill({ json: [
    { id: "00000000-0000-4000-8000-000000000086", package_id: fixedPkg, template_addon_id: null, name: "Edging", price: 25, is_offered: true, sort_order: 0 },
  ] }));
  await page.route("**/rest/v1/pricing_template_addons?*", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/admin_package_contents", route => route.fulfill({ json: [
    { package_id: fixedPkg, approval: { status: "unrecorded", operator_corrected: false, replacement: null }, content: {
      name: "Synthetic lawn package", description: "Synthetic mowing and edging", pricing_mode: "fixed", included_scope: ["Front lawn"],
      questions: [], tiers: [{ id: "00000000-0000-4000-8000-000000000085", name: "Basic", frequency: "one-time", price: 1000, price_kind: "exact", conditions: [], includes: [] }],
      addons: [{ id: "00000000-0000-4000-8000-000000000086", name: "Edging", price: 25, price_kind: "exact", unit_label: null, min_quantity: 0, max_quantity: 1, is_required: false, frequencies: [] }] } },
    { package_id: depositPkg, approval: { status: "operator_published", operator_corrected: false, replacement: { draft_id: draftId, approval_state: "sent" } }, content: {
      name: "Synthetic roof quote", description: null, pricing_mode: "deposit_quote", deposit_amount: 50, included_scope: [], questions: [], tiers: [], addons: [] } },
  ] }));
});

async function openPrices(page: Page, theme = "light", width = 1440) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/vendor-prices");
  await expect(page.getByRole("heading", { level: 1, name: "Vendor Prices" })).toBeVisible();
}

const list = (page: Page) =>
  page.viewportSize()!.width < 1280 ? page.getByRole("list", { name: "Vendor packages", exact: true }) : page.getByRole("table", { name: "Vendor packages", exact: true });

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`vendor prices ${theme} ${width}px`, async ({ page }) => {
    await openPrices(page, theme, width);
    await expect(page.getByText("2 packages · 1 draft · 1 needs review")).toBeVisible();
    await expect(page.getByText("Synthetic Roof Co · Synthetic lawn plan")).toBeVisible();
    await expect(page.getByText("$75", { exact: true })).toBeVisible();
    await expect(page.getByText("Draft, not sent to the vendor")).toBeVisible();
    const rows = list(page);
    await expect(rows.getByRole("link", { name: "Synthetic Lawn Co" })).toHaveAttribute("href", `/admin/vendors/${vendorA}`);
    await expect(rows.getByRole("definition").filter({ hasText: /^\$1,000$/ })).toBeVisible();
    await expect(rows.getByText("Deposit", { exact: true })).toBeVisible();
    await expect(rows.getByText("Needs review")).toBeVisible();
    expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("combobox", { name: "Filter packages by status" }).selectOption("review");
    await expect(rows.getByRole("link", { name: "Synthetic Roof Co" })).toHaveCount(0);
    await page.getByRole("combobox", { name: "Filter packages by status" }).selectOption("all");
    await page.getByRole("textbox", { name: "Search vendor prices" }).fill("roof");
    await expect(rows.getByRole("link", { name: "Synthetic Lawn Co" })).toHaveCount(0);
    await expect(rows.getByRole("link", { name: "Synthetic Roof Co" })).toBeVisible();
  });
}

test("live packages show content, price meaning and recorded approval", async ({ page }) => {
  await openPrices(page);
  const rows = list(page);
  await expect(rows.getByText("No approval recorded")).toBeVisible();
  await expect(rows.getByText("Published by Mercurius without vendor approval")).toBeVisible();
  await expect(rows.getByText("Replacement draft: waiting for the vendor")).toBeVisible();
  await rows.getByText("Description, scope and add-ons").first().click();
  await expect(rows.getByText("Synthetic mowing and edging")).toBeVisible();
  await expect(rows.getByText("Front lawn")).toBeVisible();
  await expect(rows.getByText("+$25").last()).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
});

test("suspending a listing and starting a replacement each need a reason", async ({ page }) => {
  const suspended: unknown[] = [];
  const drafted: unknown[] = [];
  await page.route("**/rpc/admin_suspend_package", route => { suspended.push(route.request().postDataJSON()); return route.fulfill({ json: { vendor_notified: true } }); });
  await page.route("**/rpc/admin_draft_from_package", route => { drafted.push(route.request().postDataJSON());
    return route.fulfill({ json: { draft: { ...draft, id: "00000000-0000-4000-8000-000000000089" }, prices_changed: 0, conversions: [] } }); });
  await openPrices(page);
  await list(page).getByRole("button", { name: "Suspend listing" }).first().click();
  let dialog = page.getByRole("alertdialog", { name: "Suspend this listing" });
  await dialog.getByRole("textbox").fill("Synthetic: wrong price shown");
  await dialog.getByRole("button", { name: "Suspend listing" }).click();
  await expect.poll(() => suspended).toEqual([{ p_package: fixedPkg, p_expected_updated_at: updatedAt, p_reason: "Synthetic: wrong price shown" }]);
  await list(page).getByRole("button", { name: "Start replacement draft" }).nth(1).click();
  dialog = page.getByRole("alertdialog", { name: "Start a replacement draft" });
  await dialog.getByRole("textbox").fill("Synthetic: vendor approval of the legacy package");
  await dialog.getByRole("button", { name: "Create draft" }).click();
  await expect.poll(() => drafted).toEqual([{ p_package: depositPkg, p_expected_updated_at: updatedAt, p_prices: null,
    p_reason: "Synthetic: vendor approval of the legacy package" }]);
});

test("proposed corrected prices become a replacement draft with the read values and a reason", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/rpc/admin_draft_from_package", route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { draft: { ...draft, id: "00000000-0000-4000-8000-000000000089" }, prices_changed: 1, conversions: [] } });
  });
  await openPrices(page);
  await list(page).getByRole("button", { name: "Propose corrected prices" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Propose corrected prices" });
  await expect(dialog.getByText("Synthetic Lawn Co · Synthetic lawn package", { exact: false })).toBeVisible();

  await dialog.getByRole("textbox", { name: "Basic (One-time)" }).fill("12.345");
  await dialog.getByRole("button", { name: "Create replacement draft" }).click();
  await expect(dialog.getByRole("alert").first()).toContainText("positive dollar amount");
  expect(sent).toHaveLength(0);

  await dialog.getByRole("textbox", { name: "Basic (One-time)" }).fill("120");
  await dialog.getByRole("button", { name: "Create replacement draft" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter the reason. The vendor will see it.");
  expect(sent).toHaveLength(0);

  await dialog.getByRole("textbox", { name: "Reason (required)" }).fill("Synthetic: $1,000 was a typo for $120");
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(tags).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Create replacement draft" }).click();
  await expect(page.getByText("Correction drafted: 1 price")).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([{
    p_package: fixedPkg, p_expected_updated_at: updatedAt, p_reason: "Synthetic: $1,000 was a typo for $120",
    p_prices: { tiers: [{ id: "00000000-0000-4000-8000-000000000085", from: 1000, price: 120 }], addons: [] },
  }]);
});

test("a stale read is refused and explained without closing the dialog", async ({ page }) => {
  await page.route("**/rpc/admin_draft_from_package", route => route.fulfill({ status: 400,
    json: { code: "40001", message: "Package changed since it was read; reload before correcting prices" } }));
  await openPrices(page);
  await list(page).getByRole("button", { name: "Propose corrected prices" }).nth(1).click();
  const dialog = page.getByRole("dialog", { name: "Propose corrected prices" });
  await dialog.getByRole("textbox", { name: "Deposit" }).fill("40");
  await dialog.getByRole("textbox", { name: "Reason (required)" }).fill("Synthetic deposit correction");
  await dialog.getByRole("button", { name: "Create replacement draft" }).click();
  await expect(dialog.getByRole("alert")).toContainText("changed since you opened it");
  await expect(dialog).toBeVisible();
});

test("the vendor sees what Mercurius changed and why", async ({ page }) => {
  await page.route("**/rpc/vendor_my_package_price_corrections", route => route.fulfill({ json: [
    { id: 1, package_id: fixedPkg, package_name: "Synthetic lawn package", reason: "Synthetic: matched the market rate",
      created_at: "2026-10-15T13:00:00+00:00", changes: [{ kind: "tier", name: "Basic", frequency: "one-time", from: 1000, to: 120 }] },
  ] }));
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: vendorA } }));
  await syntheticSession(page.context(), "vendor");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/vendor/pricing");
  const panel = page.getByRole("region", { name: "Price changes by Mercurius" });
  await expect(panel.getByText("Basic: $1,000 → $120")).toBeVisible();
  await expect(panel.getByText("Synthetic: matched the market rate")).toBeVisible();
  await expect(panel.getByText("Oct 15, 2026, 9:00 AM Eastern")).toBeVisible();
  expect((await new AxeBuilder({ page }).include("section[aria-labelledby=vendor-price-corrections]").withTags(tags).analyze()).violations).toEqual([]);
});

test("package reviews offers a proposed correction next to approval", async ({ page }) => {
  await page.route("**/rest/v1/pricing_templates?*", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/pricing_template_tiers?*", route => route.fulfill({ json: [] }));
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/admin/pricing-reviews");
  await expect(page.getByRole("heading", { level: 2, name: "Synthetic lawn package" })).toBeVisible();
  await page.getByRole("button", { name: "Propose corrected prices" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Propose corrected prices" });
  await expect(dialog.getByRole("textbox", { name: "Basic (One-time)" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: /Edging/ })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(tags).analyze()).violations).toEqual([]);
});

test("add a price saves a private draft for the chosen vendor at the catalog's cadences", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/rpc/admin_save_package_draft", route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...draft, id: "00000000-0000-4000-8000-000000000088" } });
  });
  await openPrices(page, "light", 320);
  await page.getByRole("button", { name: "Add a price" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a price for a vendor" });
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Choose the vendor this price is for.");

  await dialog.getByRole("combobox", { name: "Vendor (required)" }).selectOption({ label: "Synthetic Lawn Co" });
  await dialog.getByRole("combobox", { name: "Service (required)" }).selectOption({ label: "Lawn care" });
  await expect(dialog.getByRole("textbox", { name: "Package name (required)" })).toHaveValue("Lawn care");
  // Only the cadences the catalog offers for the service, every two months among them.
  await expect(dialog.getByRole("textbox", { name: "Every two months" })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Weekly" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter a price for at least one cadence.");

  await dialog.getByRole("textbox", { name: "Every two months" }).fill("75");
  await dialog.getByRole("textbox", { name: "Monthly" }).fill("$45.50");
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(tags).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([{
    p_draft: null, p_expected_updated_at: null, p_contractor: vendorA, p_service: "synthetic-lawn", p_name: "Lawn care", p_description: null,
    p_prices: [{ frequency: "monthly", price: 45.5 }, { frequency: "every-two-months", price: 75 }],
  }]);
});

// DEC-2026-046 (TRACE-120): the vendor's approval is optional; SQL 091.
test("an unapproved draft publishes without the vendor's approval and an unbound vendor cannot be asked", async ({ page }) => {
  const sent: unknown[] = [];
  await page.route("**/rpc/admin_publish_package_draft", route => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { package_id: "00000000-0000-4000-8000-000000000089", needs_review: false, vendor_notified: false, vendor_approved: false } });
  });
  await openPrices(page, "light", 320);
  await expect(page.getByRole("button", { name: "Send for approval" })).toBeDisabled();
  await expect(page.getByRole("note")).toContainText("No vendor account is bound to this provider");
  await expect(page.getByRole("note")).toContainText("you can still publish");
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publish price" });
  await expect(dialog.getByText("not approved by the vendor", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("note")).toHaveText("This version was not sent to the vendor for approval. Publishing does not need it.");
  await dialog.getByRole("textbox", { name: "Reason (required)" }).fill("Synthetic: rate set by Mercurius");
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(tags).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Publish price" }).click();
  await expect(page.getByText("Price published")).toBeVisible();
  await expect(page.getByText("Published without the vendor's approval.", { exact: false })).toBeVisible();
  expect(sent).toEqual([{ p_draft: draftId, p_expected_updated_at: draftUpdatedAt, p_reason: "Synthetic: rate set by Mercurius" }]);
});

test("publishing a draft the vendor asked to change shows their request", async ({ page }) => {
  await page.route("**/rpc/admin_package_drafts", route => route.fulfill({ json: [{ ...draft, approval_state: "changes_requested",
    change_request: "Synthetic: lower the monthly price", vendor_link: { linked: true, vendor_role: true, blocker: null } }] }));
  await openPrices(page, "light", 1440);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publish price" });
  await expect(dialog.getByRole("note")).toHaveText("The vendor asked for changes: \"Synthetic: lower the monthly price\". Publishing goes ahead without them.");
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(tags).analyze()).violations).toEqual([]);
});

test("publishing an approved draft needs a reason and explains a refusal", async ({ page }) => {
  const sent: unknown[] = [];
  let refuse = true;
  await page.route("**/rpc/admin_package_drafts", route => route.fulfill({ json: [approvedDraft] }));
  await page.route("**/rpc/admin_publish_package_draft", route => {
    sent.push(route.request().postDataJSON());
    if (refuse) { refuse = false; return route.fulfill({ status: 409, json: { code: "23505",
      message: "This vendor already has an active package named \"Synthetic lawn plan\" for this service; rename it or replace that package" } }); }
    return route.fulfill({ json: { package_id: "00000000-0000-4000-8000-000000000089", needs_review: false, vendor_notified: true } });
  });
  await openPrices(page, "dark", 1440);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publish price" });
  await expect(dialog.getByText("the version the vendor approved", { exact: false })).toBeVisible();
  await expect(dialog.getByText("$75", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Publish price" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter the reason. The vendor will see it.");
  expect(sent).toHaveLength(0);

  await dialog.getByRole("textbox", { name: "Reason (required)" }).fill("Synthetic: rate agreed by phone");
  expect((await new AxeBuilder({ page }).include("[role=dialog]").withTags(tags).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Publish price" }).click();
  await expect(dialog.getByRole("alert")).toContainText("already has an active package named");
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "Publish price" }).click();
  await expect(page.getByText("Price published")).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(sent[1]).toEqual({ p_draft: draftId, p_expected_updated_at: draftUpdatedAt, p_reason: "Synthetic: rate agreed by phone" });
});

test("a draft can be edited and discarded against the version read", async ({ page }) => {
  const saved: unknown[] = [];
  const discarded: unknown[] = [];
  await page.route("**/rpc/admin_save_package_draft", route => { saved.push(route.request().postDataJSON()); return route.fulfill({ json: draft }); });
  await page.route("**/rpc/admin_discard_package_draft", route => { discarded.push(route.request().postDataJSON()); return route.fulfill({ json: { ...draft, status: "discarded" } }); });
  await openPrices(page, "light", 1440);
  await page.getByRole("button", { name: "Edit draft" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit draft price" });
  await expect(dialog.getByText("Vendor: Synthetic Roof Co")).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Every two months" })).toHaveValue("75");
  await dialog.getByRole("textbox", { name: "Monthly" }).fill("");
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(dialog).toBeHidden();
  expect(saved).toEqual([{
    p_draft: draftId, p_expected_updated_at: draftUpdatedAt, p_contractor: vendorB, p_service: "synthetic-lawn", p_name: "Synthetic lawn plan",
    p_description: null, p_prices: [{ frequency: "every-two-months", price: 75 }],
  }]);

  await page.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard draft" }).click();
  await expect.poll(() => discarded).toEqual([{ p_draft: draftId, p_expected_updated_at: draftUpdatedAt }]);
});

test("internal notes are edited in place without a new version", async ({ page }) => {
  const saved: unknown[] = [];
  await page.route("**/rpc/admin_set_package_internal_notes", route => { saved.push(route.request().postDataJSON()); return route.fulfill({ json: { notes: "Synthetic gate code" } }); });
  await openPrices(page);
  await list(page).getByRole("button", { name: "Add internal notes" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Internal notes" });
  await expect(dialog.getByText("Saving creates no new version, needs no republishing and does not notify the vendor.", { exact: false })).toBeVisible();
  await dialog.getByLabel("Internal notes (not shown to homeowners)").fill("  Synthetic gate code  ");
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').withTags(tags).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Save notes" }).click();
  await expect.poll(() => saved).toEqual([{ p_package: fixedPkg, p_notes: "Synthetic gate code" }]);
});

test("a paused price can be archived with a reason; archived prices leave the list and counts", async ({ page }) => {
  const archived: unknown[] = [];
  let done = false;
  await page.route("**/rpc/admin_archive_package", route => { archived.push(route.request().postDataJSON()); done = true;
    return route.fulfill({ json: { package_id: depositPkg, archived_at: updatedAt } }); });
  await page.route("**/rpc/admin_package_contents", route => route.fulfill({ json: [
      { package_id: fixedPkg, approval: { status: "unrecorded", operator_corrected: false, replacement: null }, internal_notes: null, archive: null,
        content: { name: "Synthetic lawn package", description: null, pricing_mode: "fixed", included_scope: [], questions: [], tiers: [], addons: [] } },
      { package_id: depositPkg, approval: null, internal_notes: { notes: "Synthetic internal note", updated_at: updatedAt, updated_by_email: null },
        archive: done ? { reason: "Synthetic: old price", archived_at: updatedAt, actor_email: "operator@example.invalid" } : null,
        content: { name: "Synthetic roof quote", description: null, pricing_mode: "deposit_quote", deposit_amount: 50, included_scope: [], questions: [], tiers: [], addons: [] } },
  ] }));
  await openPrices(page);
  // Only the paused package offers Archive.
  await expect(list(page).getByRole("button", { name: "Archive", exact: true })).toHaveCount(1);
  await list(page).getByRole("button", { name: "Archive", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Archive this price" });
  await expect(dialog.getByText("The vendor is not notified.", { exact: false })).toBeVisible();
  await dialog.getByRole("textbox").fill("Synthetic: old price");
  await dialog.getByRole("button", { name: "Archive" }).click();
  await expect.poll(() => archived).toEqual([{ p_package: depositPkg, p_expected_updated_at: updatedAt, p_reason: "Synthetic: old price" }]);
  await expect(page.getByText("1 package · 1 draft · 1 needs review")).toBeVisible();
  await expect(list(page).getByRole("link", { name: "Synthetic Roof Co" })).toHaveCount(0);
  await page.getByText("Archived prices (1)").click();
  await expect(page.getByText("Reason: Synthetic: old price")).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
});

test("the vendor sees an archived price as Archived, read-only and outside counts and coverage", async ({ page }) => {
  const livePkg = "00000000-0000-4000-8000-0000000000a1";
  const archivedPkg = "00000000-0000-4000-8000-0000000000a2";
  const row = (id: string, service: string, name: string, active: boolean) => ({ id, name, description: null, service_id: service, pricing_mode: "fixed",
    default_frequency: "one-time", deposit_amount: null, is_active: active, needs_review: false, template_id: null, sort_order: 0 });
  await page.route("**/rest/v1/contractors?*", route => route.fulfill({ json: { id: vendorA, services: ["synthetic-lawn", "synthetic-roof"] } }));
  await page.route("**/rest/v1/vendor_packages?*", route => route.fulfill({ json: [
    row(livePkg, "synthetic-lawn", "Synthetic live lawn", true), row(archivedPkg, "synthetic-roof", "Synthetic archived roof", false)] }));
  await page.route("**/rest/v1/package_tiers?*", route => route.fulfill({ json: [
    { id: "00000000-0000-4000-8000-0000000000a3", package_id: livePkg, name: "One-time", price: 50, frequency: "one-time", includes: [], sort_order: 0 },
    { id: "00000000-0000-4000-8000-0000000000a4", package_id: archivedPkg, name: "One-time", price: 80, frequency: "one-time", includes: [], sort_order: 0 }] }));
  await page.route("**/rest/v1/package_qualifying_questions?*", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/package_addons?*", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/package_promotions?*", route => route.fulfill({ json: [] }));
  await page.route("**/rest/v1/pricing_templates?*", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/pricing_server_now", route => route.fulfill({ json: new Date().toISOString() }));
  await page.route("**/rpc/vendor_package_approvals", route => route.fulfill({ json: [] }));
  await page.route("**/rpc/vendor_package_archives", route => route.fulfill({ json: [{ package_id: archivedPkg, archived_at: "2026-10-20T15:00:00+00:00" }] }));
  await syntheticSession(page.context(), "vendor");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/vendor/packages");
  const archived = page.getByRole("region", { name: "Archived prices" });
  await expect(archived.getByText("Synthetic archived roof")).toBeVisible();
  await expect(archived.getByText("Archived", { exact: true })).toBeVisible();
  await expect(archived.getByText("Roof repair · archived Oct 20, 2026")).toBeVisible();
  await expect(archived.getByText("Paused", { exact: false })).toHaveCount(0);
  // No publish, reactivate, edit or delete action for the archived version.
  await expect(page.getByLabel("Publish Synthetic archived roof")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Synthetic archived roof" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete Synthetic archived roof" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit Synthetic live lawn" })).toBeVisible();
  // Not counted as paused, and not offered as ready to publish for its service.
  await expect(page.getByText("Draft or Paused", { exact: true }).locator("xpath=following-sibling::p[1]")).toHaveText("0");
  await expect(page.getByText("Paused · ready")).toHaveCount(0);
  await expect(page.getByText("1 service still needs a live fixed price.")).toBeVisible();
  expect((await new AxeBuilder({ page }).include("section[aria-labelledby=archived-prices]").withTags(tags).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
