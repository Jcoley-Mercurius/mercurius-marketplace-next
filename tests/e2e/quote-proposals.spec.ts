// TRACE-119 / DEC-2026-045 (Phase 6.4): itemized provider estimates, operator send/correct/return,
// deposit review, final accepted terms, the exception queue and the homeowner's tax-pending view.
// Synthetic fixture only; outcomes come from stubbed read-backs, and the real commands are proven
// by SQL 090.
import { test, expect, type Page, type Route } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { syntheticSession } from "../fixtures/browser-session";

const homeowner = "00000000-0000-4000-8000-000000000001";
const contractor = "00000000-0000-4000-8000-000000000002";
const jobId = "00000000-0000-4000-8000-000000000012";
const quoteId = "00000000-0000-4000-8000-000000000099";
const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations;

type Row = Record<string, unknown>;
const lines = [
  { kind: "labor", description: "Stump removal", quantity: 2, unit_cents: 10000, amount_cents: 20000 },
  { kind: "addon", description: "Haul-away", quantity: 1, unit_cents: 5000, amount_cents: 5000 },
];
const quoteJob = (overrides: Row = {}): Row => ({
  id: jobId, customer_id: homeowner, contractor_id: contractor, service_type: "Synthetic Quote Service",
  description: "Synthetic scope for quote verification.", status: "scheduled", matching_status: "matched",
  pricing_mode: "custom_quote", quote_only: true, payment_status: "pending", preferred_date: null, preferred_time: null,
  address: "123 Synthetic Test Lane", city: "Cape Coral", state: "FL", zip_code: "33904",
  quote_amount: null, quote_status: null, quote_expires_at: null, quote_revision: 0, current_quote_id: null,
  pricing_inputs: { version: "pricing-v2", status: "estimate", lines: [
    { kind: "tier", name: "Up to 2 stumps", quantity: 1, unit_cents: 18000, price_kind: "range" },
    { kind: "addon", name: "Haul-away", quantity: 1, unit_cents: 5000 },
  ] },
  total_amount: null, created_at: hours(-3), updated_at: hours(-3), assigned_at: hours(-3), match_expires_at: null,
  package_question_answers: {}, scheduled_start_at: null, service_catalog_id: null, preferred_contractor_id: null,
  photo_proof_urls: null, quote_declined_at: null, quote_approved_at: null, vendor_completed_at: null, homeowner_confirmed_at: null,
  notes: null, needs_admin_review: false, match_attempt_count: 1, declined_contractor_ids: [], frequency: "one-time",
  ...overrides,
});
const proposal = (overrides: Row = {}): Row => ({
  id: "00000000-0000-4000-8000-000000000090", request_id: jobId, contractor_id: contractor, items: lines, subtotal_cents: 25000,
  scope: "Remove two stumps and haul away debris.", based_on_revision: 0, created_at: hours(-1), status: "pending",
  decided_at: null, decision_reason: null, quote_id: null, corrected: null, ...overrides,
});
const terms = (overrides: Row = {}): Row => ({
  quote_id: quoteId, items: lines, scope: "Remove two stumps and haul away debris.", service_cents: 20000, addons_cents: 5000,
  discount_cents: 0, subtotal_cents: 25000, tax_status: "pending", tax_cents: null, total_cents: null, deposit_cents: 0,
  payment_terms: "No deposit. Payment through a Mercurius invoice and secure checkout under the approved payment timing.",
  policy_version: "DEC-2026-045", ...overrides,
});

const allowLocal = (page: Page) => page.route("**/*", (route) => {
  const origin = new URL(route.request().url()).origin;
  return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
});
type Reply = "ok" | "abort" | { status: number; body: Row };
const reply = (route: Route, value: Reply, ok: unknown = null) => value === "abort" ? route.abort("failed")
  : value === "ok" ? route.fulfill({ json: ok }) : route.fulfill({ status: value.status, json: value.body });

type VendorState = { job: Row; proposals: Row[]; after?: Row[]; propose?: Reply; calls: Row[] };
async function vendorJob(page: Page, state: VendorState, width = 320) {
  await allowLocal(page);
  await syntheticSession(page.context(), "vendor");
  await page.setViewportSize({ width, height: 1000 });
  await page.route("**/rest/v1/service_requests?**", (route) => route.fulfill({ json: [state.job] }));
  await page.route("**/rest/v1/request_quote_proposals?**", (route) => route.fulfill({ json: state.proposals }));
  await page.route("**/rest/v1/rpc/vendor_propose_quote", async (route) => {
    state.calls.push(route.request().postDataJSON());
    if (state.after) state.proposals = state.after;
    return reply(route, state.propose ?? "ok", "00000000-0000-4000-8000-000000000091");
  });
  await page.goto("/vendor/jobs");
  await expect(page.getByRole("heading", { level: 1, name: "Jobs & Requests" })).toBeVisible();
  await page.getByRole("tab", { name: /Active Jobs/ }).click();
  await page.getByRole("button", { name: "View details", exact: true }).click();
  return page.getByRole("dialog", { name: "Synthetic Quote Service" }).getByRole("region", { name: "Quote", exact: true });
}
const lineField = (scope: ReturnType<Page["getByRole"]>, row: number, label: string) => {
  const line = scope.getByRole("listitem", { name: `Line ${row}` });
  // A wrapping <label> around a <select> includes the option text, so select the type by role.
  return label === "Type" ? line.getByRole("combobox", { name: "Type", exact: true }) : line.getByLabel(label, { exact: true });
};

for (const width of [320, 1440]) {
  test(`vendor ${width}px: proposes itemized lines prefilled from the selection`, async ({ page }) => {
    test.slow(); // two axe scans and a full-page screenshot
    const state: VendorState = { job: quoteJob(), proposals: [], calls: [] };
    state.after = [proposal({ items: [{ kind: "service", description: "Up to 2 stumps", quantity: 1, unit_cents: 18000, amount_cents: 18000 }, lines[1]], subtotal_cents: 23000, scope: "Two stumps, hauled away." })];
    const panel = await vendorJob(page, state, width);
    await expect(panel.getByRole("status").filter({ hasText: "No quote yet" })).toBeVisible();
    await expect(lineField(panel, 1, "Description")).toHaveValue("Up to 2 stumps");
    await expect(lineField(panel, 2, "Unit price ($)")).toHaveValue("50.00");
    await expect(panel.getByText("Subtotal $230.00 · Tax pending confirmation")).toBeVisible();
    expect(await axe(page)).toEqual([]);

    await lineField(panel, 2, "Description").fill(" ");
    await panel.getByRole("button", { name: "Send estimate to Mercurius" }).click();
    await expect(panel.getByRole("listitem", { name: "Line 2" })).toBeFocused();
    await expect(panel.getByRole("alert").filter({ hasText: "Line 2" })).toContainText("Line 2: add a description");
    await lineField(panel, 2, "Description").fill("Haul-away");
    await panel.getByRole("button", { name: "Send estimate to Mercurius" }).click();
    const scope = panel.getByLabel("What this price covers (required)", { exact: true });
    await expect(scope).toBeFocused();
    expect(state.calls).toEqual([]);

    await scope.fill("Two stumps, hauled away.");
    await panel.getByRole("button", { name: "Send estimate to Mercurius" }).click();
    await expect(panel.getByText("Estimate sent to Mercurius for review.", { exact: false })).toBeVisible();
    expect(state.calls).toEqual([{ _job_id: jobId, _expected_revision: 0, _scope: "Two stumps, hauled away.", _items: [
      { kind: "service", description: "Up to 2 stumps", quantity: 1, unit_cents: 18000 },
      { kind: "addon", description: "Haul-away", quantity: 1, unit_cents: 5000 },
    ] }]);
    await expect(panel.getByRole("status").filter({ hasText: "Proposal awaiting Mercurius review" })).toContainText("$230.00 before tax");
    expect(await page.locator("[role=dialog]").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: `test-results/trace119-vendor-quote-${width}.png`, fullPage: true });
  });
}

test("vendor: a lost response is confirmed from the read-back, a stale refusal is explained", async ({ page }) => {
  const state: VendorState = { job: quoteJob({ pricing_inputs: null }), proposals: [], calls: [], propose: "abort", after: [proposal({ subtotal_cents: 30000, scope: "Full scope" })] };
  const panel = await vendorJob(page, state);
  await lineField(panel, 1, "Description").fill("Full job");
  await lineField(panel, 1, "Unit price ($)").fill("300");
  await panel.getByLabel("What this price covers (required)", { exact: true }).fill("Full scope");
  await panel.getByRole("button", { name: "Send estimate to Mercurius" }).click();
  await expect(panel.getByText("Estimate sent to Mercurius for review.", { exact: false })).toBeVisible();

  state.after = undefined;
  state.propose = { status: 400, body: { message: "Quote changed; refresh before proposing", code: "22023" } };
  await lineField(panel, 1, "Unit price ($)").fill("320");
  await panel.getByLabel("What this price covers (required)", { exact: true }).fill("Full scope plus permit");
  await panel.getByRole("button", { name: "Send estimate to Mercurius" }).click();
  await expect(panel.getByRole("alert")).toContainText("The quote changed since this page loaded, so your proposal wasn’t sent.");
  expect(state.calls).toHaveLength(2);
});

test("vendor: returned estimates show the reason; accepted quotes stop proposals", async ({ page }) => {
  const state: VendorState = { job: quoteJob(), proposals: [proposal({ status: "returned", decision_reason: "Include the permit fee", decided_at: hours(0) })], calls: [] };
  const panel = await vendorJob(page, state);
  await expect(panel.getByRole("status").filter({ hasText: "Proposal returned" })).toContainText("Include the permit fee");
  state.job = quoteJob({ quote_status: "accepted", quote_revision: 1, quote_amount: 272.5 });
  state.proposals = [proposal({ status: "sent", corrected: true, quote_id: quoteId, decision_reason: "Second stump discounted", decided_at: hours(0) })];
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("tab", { name: /Active Jobs/ }).click();
  await page.getByRole("button", { name: "View details", exact: true }).click();
  const accepted = page.getByRole("dialog", { name: "Synthetic Quote Service" }).getByRole("region", { name: "Quote", exact: true });
  await expect(accepted.getByRole("status").filter({ hasText: "Quote accepted" })).toContainText("$272.50");
  await expect(accepted.getByText("Mercurius corrected it before sending: Second stump discounted")).toBeVisible();
  await expect(accepted.getByRole("button", { name: "Send estimate to Mercurius" })).toHaveCount(0);
});

type AdminState = { job: Row; proposals: Row[]; exceptions?: Row[]; terms?: Row | null; queue?: Row[]; calls: { name: string; body: Row }[] };
async function adminRequest(page: Page, state: AdminState, width = 1440) {
  await allowLocal(page);
  await syntheticSession(page.context(), "admin");
  await page.setViewportSize({ width, height: 1000 });
  await page.route("**/rest/v1/service_requests?**", (route) => route.fulfill({ json: [state.job] }));
  await page.route("**/rest/v1/request_quote_proposals?**", (route) => route.fulfill({ json: state.proposals }));
  await page.route("**/rest/v1/request_quote_exceptions?**", (route) => route.fulfill({ json: state.exceptions ?? [] }));
  await page.route("**/rest/v1/request_quote_terms?**", (route) => route.fulfill({ json: state.terms ?? null }));
  await page.route("**/rest/v1/rpc/admin_quote_queue", (route) => route.fulfill({ json: { checked_at: hours(0), items: state.queue ?? [] } }));
  for (const name of ["admin_send_itemized_quote", "admin_return_quote_proposal", "admin_record_quote_review", "admin_open_quote_exception", "admin_close_quote_exception"]) {
    await page.route(`**/rest/v1/rpc/${name}`, (route) => {
      state.calls.push({ name, body: route.request().postDataJSON() });
      return route.fulfill({ json: null });
    });
  }
  await page.goto("/admin/requests");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Service Requests");
}
const openAdminRequest = async (page: Page) => {
  await page.getByRole("button", { name: /Review Synthetic Quote/ }).first().click();
  return page.getByRole("dialog", { name: "Synthetic Quote Service" });
};

for (const width of [320, 1440]) {
  test(`admin ${width}px: sends the provider's lines as a recorded correction`, async ({ page }) => {
    test.slow();
    const state: AdminState = { job: quoteJob(), proposals: [proposal()], calls: [] };
    await adminRequest(page, state, width);
    const dialog = await openAdminRequest(page);
    await expect(dialog.getByText("Synthetic Vendor proposed $250.00 · Tax pending confirmation")).toBeVisible();
    await dialog.getByRole("button", { name: "Use proposed lines" }).click();
    await expect(lineField(dialog, 1, "Description")).toHaveValue("Stump removal");
    await expect(dialog.getByLabel("What this quote covers (required)", { exact: true })).toHaveValue("Remove two stumps and haul away debris.");
    await dialog.getByRole("button", { name: "Add line" }).click();
    await lineField(dialog, 3, "Type").selectOption("discount");
    await lineField(dialog, 3, "Description").fill("Second stump");
    await lineField(dialog, 3, "Unit price ($)").fill("25");
    await expect(dialog.getByText("Subtotal $225.00 · Tax pending confirmation")).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await dialog.getByRole("button", { name: "Send itemized quote" }).click();
    await expect(dialog.getByLabel("Quote reason (required)", { exact: true })).toBeFocused();
    await dialog.getByLabel("Quote reason (required)", { exact: true }).fill("Second stump discounted");
    await dialog.getByRole("button", { name: "Send itemized quote" }).click();
    await expect.poll(() => state.calls).toEqual([{ name: "admin_send_itemized_quote", body: {
      _job_id: jobId, _expected_revision: 0, _proposal_id: "00000000-0000-4000-8000-000000000090",
      _scope: "Remove two stumps and haul away debris.", _reason: "Second stump discounted", _items: [
        { kind: "labor", description: "Stump removal", quantity: 2, unit_cents: 10000 },
        { kind: "addon", description: "Haul-away", quantity: 1, unit_cents: 5000 },
        { kind: "discount", description: "Second stump", quantity: 1, unit_cents: 2500 },
      ] } }]);
    await page.screenshot({ path: `test-results/trace119-admin-quote-${width}.png`, fullPage: true });
  });
}

test("admin: deposit review first; an out-of-date proposal is not used; returning one needs a reason", async ({ page }) => {
  const state: AdminState = { job: quoteJob({ pricing_mode: "deposit_quote", quote_revision: 1, quote_status: "declined", quote_amount: 300 }), proposals: [proposal({ based_on_revision: 0 })], calls: [] };
  await adminRequest(page, state);
  const dialog = await openAdminRequest(page);
  await expect(dialog.getByText("Current quote: revision 1 · $300.00 before tax · declined by homeowner")).toBeVisible();
  await expect(dialog.getByText("Deposit review needed before sending")).toBeVisible();
  await dialog.getByRole("button", { name: "Record deposit review" }).click();
  const review = page.getByRole("alertdialog", { name: "Record the deposit review?" });
  await expect(review.getByRole("button", { name: "Record review" })).toBeDisabled();
  await review.getByLabel(/Review note/).fill("Beta default: no deposit");
  await review.getByRole("button", { name: "Record review" }).click();
  await expect.poll(() => state.calls.at(-1)).toEqual({ name: "admin_record_quote_review", body: { _job_id: jobId, _kind: "deposit_review", _note: "Beta default: no deposit" } });

  await expect(dialog.getByText(/This proposal is out of date/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Use proposed lines" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Return to provider" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Return this quote proposal?" });
  await expect(confirm).toContainText("Nothing is sent to the homeowner.");
  await expect(confirm.getByRole("button", { name: "Return proposal" })).toBeDisabled();
  await confirm.getByLabel(/Reason for the provider/).fill("Include the permit fee");
  await confirm.getByRole("button", { name: "Return proposal" }).click();
  await expect.poll(() => state.calls.at(-1)).toEqual({ name: "admin_return_quote_proposal", body: { _proposal_id: "00000000-0000-4000-8000-000000000090", _reason: "Include the permit fee" } });
});

test("admin: accepted terms are final; a change opens an exception", async ({ page }) => {
  const state: AdminState = {
    job: quoteJob({ quote_status: "accepted", quote_revision: 1, quote_amount: 272.5, current_quote_id: quoteId }),
    proposals: [], terms: terms({ tax_status: "confirmed", tax_cents: 2250, total_cents: 27250 }), calls: [],
  };
  await adminRequest(page, state);
  const dialog = await openAdminRequest(page);
  await expect(dialog.getByText("Accepted terms are final")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Send itemized quote" })).toHaveCount(0);
  await expect(dialog.getByText("$272.50", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Open change exception" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Open an exception for this accepted quote?" });
  await confirm.getByLabel(/What needs to change/).fill("Homeowner asked to add a third stump");
  await confirm.getByRole("button", { name: "Open exception" }).click();
  await expect.poll(() => state.calls.at(-1)).toEqual({ name: "admin_open_quote_exception", body: { _job_id: jobId, _reason: "Homeowner asked to add a third stump" } });
  // Scan the settled panel: while it re-reads, the trigger is inactive (exempt from contrast).
  await expect(dialog.getByRole("button", { name: "Open change exception" })).toBeEnabled();
  expect(await axe(page)).toEqual([]);
});

test("admin: the exception queue shows aged items and records a provider review", async ({ page }) => {
  const state: AdminState = { job: quoteJob(), proposals: [], calls: [], queue: [
    { kind: "payment_failed", request_id: jobId, service_type: "Synthetic Quote Service", since: hours(-25), due_at: hours(-1), aged: true, exception_id: null, detail: {} },
    { kind: "payment_unresolved", request_id: jobId, service_type: "Synthetic Quote Service", since: hours(-1), due_at: null, aged: false, exception_id: null, detail: {} },
    { kind: "quote_decision", request_id: jobId, service_type: "Synthetic Quote Service", since: hours(-13), due_at: hours(-1), aged: true, exception_id: null, detail: { deadline_passed: false } },
    { kind: "provider_review", request_id: jobId, service_type: "Synthetic Quote Service", since: null, due_at: null, aged: false, exception_id: null, detail: {} },
  ] };
  await adminRequest(page, state, 320);
  const queue = page.getByRole("list", { name: "Quote and payment exceptions" });
  await expect(queue.getByRole("listitem")).toHaveCount(4);
  await expect(queue.getByRole("listitem").filter({ hasText: "Payment not completed" }).getByText("Aged")).toBeVisible();
  await expect(queue.getByRole("listitem").filter({ hasText: "Payment outcome unknown" })).toContainText("do not assume success or failure");
  await expect(queue.getByRole("listitem").filter({ hasText: "Homeowner hasn’t decided" })).toContainText("The 24-hour expiry is unchanged.");
  expect(await axe(page)).toEqual([]);
  await queue.getByRole("listitem").filter({ hasText: "Provider not eligible" }).getByRole("button", { name: "Record review" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Record the provider review?" });
  await expect(confirm).toContainText("The assignment, job and payments are not changed.");
  await confirm.getByLabel(/Review note/).fill("Contacted provider");
  await confirm.getByRole("button", { name: "Record review" }).click();
  await expect.poll(() => state.calls.at(-1)).toEqual({ name: "admin_record_quote_review", body: { _job_id: jobId, _kind: "provider_review", _note: "Contacted provider" } });
  await queue.getByRole("listitem").filter({ hasText: "Payment not completed" }).getByRole("button", { name: "Open request" }).click();
  await expect(page.getByRole("dialog", { name: "Synthetic Quote Service" })).toBeVisible();
});

async function homeownerQuote(page: Page, job: Row, quoteTerms: Row | null) {
  await allowLocal(page);
  await syntheticSession(page.context(), "homeowner");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.route("**/rest/v1/service_requests?**", (route) => route.fulfill({ json: [job] }));
  await page.route("**/rest/v1/request_quote_terms?**", (route) => route.fulfill({ json: quoteTerms }));
  await page.goto("/dashboard?tab=upcoming");
  await page.getByRole("button", { name: "Open Synthetic Quote Service details" }).click();
  return page.getByRole("dialog", { name: "Synthetic Quote Service" });
}

test("homeowner: an itemized quote with tax pending can be reviewed and declined, not approved", async ({ page }) => {
  const dialog = await homeownerQuote(page, quoteJob({ quote_status: "submitted", quote_revision: 1, quote_amount: 250, current_quote_id: quoteId, quote_expires_at: hours(20) }), terms());
  await expect(dialog.getByText("Stump removal")).toBeVisible();
  await expect(dialog.getByText("Tax pending confirmation", { exact: true })).toBeVisible();
  await expect(dialog.getByText("$0.00", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("status").filter({ hasText: "approval opens when Mercurius sends a final quote with tax confirmed" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Approve quote" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Decline", exact: true })).toBeEnabled();
  expect(await axe(page)).toEqual([]);
});

test("homeowner: a quote past its 24-hour deadline can no longer be answered", async ({ page }) => {
  const dialog = await homeownerQuote(page, quoteJob({ quote_status: "submitted", quote_revision: 1, quote_amount: 260, current_quote_id: quoteId, quote_expires_at: hours(-0.5) }), terms());
  await expect(dialog.getByText("The 24-hour approval window for this quote has closed", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Approve quote" })).toHaveCount(0);
  expect(await axe(page)).toEqual([]);
});

test("homeowner: returning from Stripe is not shown as a confirmed payment", async ({ page }) => {
  await allowLocal(page);
  await syntheticSession(page.context(), "homeowner");
  await page.goto("/dashboard?tab=invoices&paid=1");
  await expect(page.getByText("Waiting for payment confirmation")).toBeVisible();
  await expect(page.getByText("Returning from Stripe doesn’t confirm a payment.", { exact: false })).toBeVisible();
});
