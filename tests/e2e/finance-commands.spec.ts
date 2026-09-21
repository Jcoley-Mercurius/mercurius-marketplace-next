import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-076/077 synthetic browser evidence. Readbacks and commands are mocked; no real refund, hold,
// Stripe object, bank transfer or operator identity is represented.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const now = "2026-09-16T15:00:00.000Z";
const obligation = "00000000-0000-4000-8000-000000000861";
const invoice = "M5-0000000861";
const row = {
  obligation_id: obligation, service_request_id: "00000000-0000-4000-8000-000000000860", invoice_number: invoice, created_at: now,
  payee: { contractor_id: "00000000-0000-4000-8000-000000000851", name: "Synthetic Payee Services", reassigned: false },
  terms: { subtotal: 10000, tax: 700, tip: 1000, deposit: 3000, total: 11700 },
  charges: { captured: 11700, attempts_captured: 11700, ledger_captured: 11700, fully_captured: true, payments: [{ payment_id: "pi_synthetic", mode: "full", amount: 11700 }] },
  refunds: { service: 0, tax: 0, tip: 0, settled: 0, pending: 1 },
  earnings: { platform_fee: 1500, platform_fee_ledger: 1500, tax: 700, tax_ledger: 700, provider_proceeds: 9500 },
  payout: { funds_state: "held", not_eligible: [], held: ["payout_hold"], eligible_at: null, paid: 0, returned: 0, payable: 9500, payable_ledger: 9500, statement: null },
  chargebacks: { suspense: 0, suspense_ledger: 0, lost: 0 }, processor_costs: 0,
  readback: { state: "mismatch", observed: 11600, expected: 11700, recorded_at: now }, reconciliation_open: true, issues: [],
};
const reconciliation = {
  evaluated_at: now, fee_percent: 15, obligation_count: 1, listed_limit: 200, global_event_holds: 1, accounts: [],
  totals: { captured: 11700, refunded: 0, platform_fee: 1500, tax: 700, provider_payable: 9500, paid_out: 0, processor_costs: 0, chargeback_suspense: 0, with_issues: 0 },
  exceptions: [], obligations: [row],
};
const hold = { hold_id: "00000000-0000-4000-8000-000000000871", obligation_id: obligation, invoice_number: invoice, reason: "Quality complaint", evidence: "Ticket 4412", placed_by_me: false, created_at: now };
const expires = "2026-09-17T15:00:00.000Z";
const theirRequest = {
  request_id: "00000000-0000-4000-8000-000000000881", operation: "refund_authorization", subject: obligation, obligation_id: obligation, invoice_number: invoice,
  reason: "Rework agreed", evidence: "Ticket 4412 rework", details: { payment_id: "pi_synthetic", service: 2000, tax: 140, tip: 0 },
  requested_by_me: false, approved_by_me: false, recorded_by_me: false,
  state: "awaiting_approval", blocker: null, created_at: now, expires_at: expires, executed_at: null,
};
const myApproved = {
  ...theirRequest, request_id: "00000000-0000-4000-8000-000000000882", operation: "event_exclusion", subject: "evt_synthetic_unsupported", obligation_id: null, invoice_number: null,
  reason: "Informational event", evidence: "Stripe shows metadata-only update", details: null, requested_by_me: true, state: "approved",
};
const myWaiting = { ...theirRequest, request_id: "00000000-0000-4000-8000-000000000883", requested_by_me: true, reason: "Second release reason" };
const operations = {
  evaluated_at: now,
  requests: [theirRequest, myApproved, myWaiting],
  holds: [hold],
  readbacks: [{ obligation_id: obligation, invoice_number: invoice, reconciliation_open: true, net_collected: 11700, observation_id: "00000000-0000-4000-8000-000000000891",
    observed: 11600, expected: 11700, currency: "usd", evidence: "Stripe pi_synthetic", attributed: true, recorded_by_me: true, recorded_at: now, resolution_blocker: "readback_mismatch" }],
  events: [{ event_id: "evt_synthetic_unsupported", event_type: "reconciliation_required", status: "failed", attempts: 1, holds_all_payouts: true, exclusion_blocker: null, received_at: now }],
  refunds: [{ authorization_id: "00000000-0000-4000-8000-000000000892", obligation_id: obligation, invoice_number: invoice, payment_id: "pi_synthetic", amount: 2140,
    attempt_status: "not_started", provider_reference: null, can_send: true, generation: 1, reissue_blocker: null, last_readback: null, created_at: now }],
  cancellations: [{ operation_id: "00000000-0000-4000-8000-000000000893", kind: "customer_cancel", payment_id: "pi_synthetic_cancel", obligation_id: obligation, invoice_number: invoice,
    refund_percent: 50, service: 5000, tax: 350, tip: 500, blocker: null, open_request_id: null, cancelled_at: now }],
  chargebacks: [{ dispute_id: "dp_synthetic", obligation_id: obligation, payment_id: "pi_synthetic", amount: 1000, invoice_number: invoice,
    retained: { service: 10000, tax: 700, tip: 1000 }, blocker: null, open_request_id: null, created_at: now }],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
  await page.route("**/rpc/money_finance_reconciliation", route => route.fulfill({ json: reconciliation }));
});

async function openPage(page: Page, ops: () => unknown = () => operations, theme = "light", width = 1440) {
  await page.route("**/rpc/money_finance_operations", route => route.fulfill({ json: ops() }));
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/finance");
  await expect(page.getByRole("heading", { level: 2, name: "Finance commands" })).toBeVisible();
}

const noActor = (payload: Record<string, unknown>) =>
  expect(Object.keys(payload).filter(key => /actor|approver|user/.test(key))).toEqual([]);

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`finance commands ${theme} ${width}px`, async ({ page }) => {
    await openPage(page, undefined, theme, width);
    const reviews = width < 1280 ? page.getByRole("list", { name: "Second-person reviews" }) : page.getByRole("table", { name: "Second-person reviews" });
    await expect(reviews.getByRole("button", { name: "Approve", exact: true })).toHaveCount(1);
    await expect(reviews.getByRole("button", { name: "Run approved command" })).toHaveCount(1);
    await expect(reviews.getByText("Waiting for a different finance operator to approve it.")).toBeVisible();
    const readbacks = width < 1280 ? page.getByRole("list", { name: "Stripe readbacks" }) : page.getByRole("table", { name: "Stripe readbacks" });
    await expect(readbacks.getByText("The readback does not match the ledger. Record a matching readback first.")).toBeVisible();
    const events = width < 1280 ? page.getByRole("list", { name: "Unprocessed Stripe events" }) : page.getByRole("table", { name: "Unprocessed Stripe events" });
    await expect(events.getByText("reconciliation_required · holds every payout")).toBeVisible();
    await expect(page.getByRole("button", { name: "Send refund to Stripe" })).toBeVisible();
    expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `test-results/finance-commands-${theme}-${width}.png`, fullPage: true });
  });
}

test("a second operator approves the exact request with a note and no actor field", async ({ page }) => {
  let approved = false;
  await page.route("**/rpc/money_operator_approve_review", route => { approved = true; return route.fulfill({ json: { request_id: theirRequest.request_id, approval_id: "synthetic" } }); });
  await openPage(page, () => ({ ...operations, requests: [{ ...theirRequest, approved_by_me: approved }, myApproved, myWaiting] }));
  await page.getByRole("table", { name: "Second-person reviews" }).getByRole("button", { name: "Approve", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Approve: authorize refund?" });
  await expect(confirm.getByText('"Rework agreed" with evidence "Ticket 4412 rework" for pi_synthetic · $21.40', { exact: false })).toBeVisible();
  await expect(confirm.getByText("expires", { exact: false })).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  await confirm.getByRole("textbox").fill("Read ticket 4412 closure");
  const sent = page.waitForRequest("**/rpc/money_operator_approve_review");
  await confirm.getByRole("button", { name: "Approve", exact: true }).click();
  const payload = (await sent).postDataJSON();
  expect(payload).toEqual({ p_request: theirRequest.request_id, p_reason: "Read ticket 4412 closure" });
  noActor(payload);
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("table", { name: "Second-person reviews" }).getByText("You approved it. The requester runs it.")).toBeVisible();
});

test("the requester runs an approved exclusion and a refusal keeps the dialog open with operator wording", async ({ page }) => {
  let runs = 0;
  await page.route("**/rpc/money_operator_execute_review", route => {
    runs++;
    return runs === 1
      ? route.fulfill({ status: 400, json: { code: "55000", message: "Finance review not actionable: event_not_failed", details: null, hint: null } })
      : route.fulfill({ json: { request_id: myApproved.request_id, operation: "event_exclusion", replay: false } });
  });
  await openPage(page, () => ({ ...operations, requests: [theirRequest, { ...myApproved, state: runs > 1 ? "executed" : "approved" }, myWaiting] }));
  await page.getByRole("button", { name: "Run approved command" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Run: exclude stripe event?" });
  await expect(confirm.getByText("It will never be processed or replayed", { exact: false })).toBeVisible();
  const first = page.waitForRequest("**/rpc/money_operator_execute_review");
  await confirm.getByRole("button", { name: "Run", exact: true }).click();
  expect((await first).postDataJSON()).toEqual({ p_request: myApproved.request_id });
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(page.getByText("The event has not failed. Replay it first; only a failed event can be excluded.")).toBeVisible();
  await confirm.getByRole("button", { name: "Run", exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("table", { name: "Second-person reviews" }).getByText("Done", { exact: true })).toBeVisible();
});

test("placing a hold needs invoice, evidence and reason, and a retry reuses the key", async ({ page }) => {
  let placed = false;
  const keys: string[] = [];
  await page.route("**/rpc/money_operator_place_hold", route => {
    const payload = route.request().postDataJSON();
    keys.push(payload.p_key);
    if (keys.length === 1) return route.fulfill({ status: 500, body: "synthetic network failure" });
    placed = true;
    return route.fulfill({ json: { hold_id: "00000000-0000-4000-8000-000000000872", replay: false } });
  });
  await openPage(page, () => ({ ...operations, holds: placed
    ? [hold, { ...hold, hold_id: "00000000-0000-4000-8000-000000000872", reason: "Customer reported damage", evidence: "Ticket 5000", placed_by_me: true }]
    : [hold] }));
  const trigger = page.getByRole("button", { name: "Place hold" });
  await expect(trigger).toBeDisabled();
  await page.getByLabel("Invoice (required)").first().selectOption(obligation);
  await expect(trigger).toBeDisabled();
  await page.getByLabel("Evidence (required)", { exact: true }).fill("Ticket 5000");
  await trigger.click();
  const confirm = page.getByRole("alertdialog", { name: "Hold this provider payout?" });
  await confirm.getByRole("textbox").fill("Customer reported damage");
  const first = page.waitForRequest("**/rpc/money_operator_place_hold");
  await confirm.getByRole("button", { name: "Place hold", exact: true }).click();
  const payload = (await first).postDataJSON();
  expect(payload).toMatchObject({ p_obligation: obligation, p_reason: "Customer reported damage", p_evidence: "Ticket 5000" });
  noActor(payload);
  await expect(confirm.getByRole("alert")).toBeFocused();
  await confirm.getByRole("button", { name: "Place hold", exact: true }).click();
  await expect(confirm).toBeHidden();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  await expect(page.getByLabel("Evidence (required)", { exact: true })).toHaveValue("");
});

test("a command the readback does not confirm is reported as not done", async ({ page }) => {
  await page.route("**/rpc/money_operator_record_readback", route => route.fulfill({ json: { observation_id: "synthetic", matched: false, replay: false } }));
  await openPage(page);
  await page.getByLabel("Invoice (required)").nth(1).selectOption(obligation);
  const amount = page.getByLabel("Amount at Stripe (USD) (required)");
  await amount.fill("116.5.0");
  await expect(page.getByText("Enter dollars and cents, for example 117.00.")).toBeVisible();
  await amount.fill("116.50");
  await page.getByLabel("Stripe reference (required)").fill("pi_synthetic");
  await page.getByRole("button", { name: "Record readback" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Record this Stripe readback?" });
  await expect(confirm.getByText("M5-0000000861 · $116.50")).toBeVisible();
  const sent = page.waitForRequest("**/rpc/money_operator_record_readback");
  await confirm.getByRole("button", { name: "Record", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({ p_obligation: obligation, p_observed: 11650, p_currency: "usd", p_evidence: "pi_synthetic" });
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(page.getByText("The server did not confirm this command.", { exact: false })).toBeVisible();
});

test("refund send reports that money movement is not activated", async ({ page }) => {
  await page.route("**/functions/v1/refund-invoice", route => {
    expect(route.request().postDataJSON()).toEqual({ action: "send", authorization_id: operations.refunds[0].authorization_id });
    return route.fulfill({ status: 503, json: { error: "MONEY_NOT_ACTIVATED", message: "Refund execution is awaiting verification. No refund was initiated." } });
  });
  await openPage(page);
  await page.getByRole("button", { name: "Send refund to Stripe" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Send this refund to Stripe?" });
  await confirm.getByRole("button", { name: "Send refund", exact: true }).click();
  await expect(confirm.getByRole("alert")).toBeFocused();
  await expect(page.getByText("Refund execution is not activated in this environment. No refund was sent or read back.")).toBeVisible();
});

test("an event replay needs a reason and says an unsupported event will fail again", async ({ page }) => {
  let attempts = 1;
  await page.route("**/rpc/money_operator_replay_event", route => { attempts = 2; return route.fulfill({ json: { event_id: "evt_synthetic_unsupported", outcome: "failed", status: "failed", attempts: 2 } }); });
  await openPage(page, () => ({ ...operations, events: [{ ...operations.events[0], attempts }] }));
  await page.getByRole("button", { name: "Replay event" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Replay this Stripe event?" });
  await expect(confirm.getByText("exclusion is how it stops holding payouts", { exact: false })).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Replay", exact: true })).toBeDisabled();
  await confirm.getByRole("textbox").fill("Webhook outage recovery");
  const sent = page.waitForRequest("**/rpc/money_operator_replay_event");
  await confirm.getByRole("button", { name: "Replay", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({ p_event: "evt_synthetic_unsupported", p_reason: "Webhook outage recovery" });
  await expect(confirm).toBeHidden();
});

test("one operator releases a hold with evidence and reason, and no actor field", async ({ page }) => {
  let released = false;
  await page.route("**/rpc/money_operator_release_hold", route => { released = true; return route.fulfill({ json: { hold_id: hold.hold_id, replay: false } }); });
  await openPage(page, () => ({ ...operations, holds: released ? [] : [hold] }));
  await page.getByLabel("Hold (required)").selectOption(hold.hold_id);
  const trigger = page.getByRole("button", { name: "Release hold" });
  await expect(trigger).toBeDisabled();
  await page.getByLabel("Release evidence (required)").fill("Ticket 4412 closed");
  await trigger.click();
  const confirm = page.getByRole("alertdialog", { name: "Release this payout hold?" });
  await expect(confirm.getByText("Releases the hold under your name now.", { exact: false })).toBeVisible();
  await confirm.getByRole("textbox").fill("Complaint closed");
  const sent = page.waitForRequest("**/rpc/money_operator_release_hold");
  await confirm.getByRole("button", { name: "Release hold", exact: true }).click();
  const payload = (await sent).postDataJSON();
  expect(payload).toEqual({ p_hold: hold.hold_id, p_reason: "Complaint closed", p_evidence: "Ticket 4412 closed" });
  noActor(payload);
  await expect(confirm).toBeHidden();
  await expect(page.getByText("No payout hold is open.", { exact: false })).toBeVisible();
});

test("a refund request sends exact cents, payment and policy, and needs a policy reference", async ({ page }) => {
  let requested = false;
  await page.route("**/rpc/money_operator_request_refund", route => { requested = true; return route.fulfill({ json: { request_id: "00000000-0000-4000-8000-000000000894", replay: false } }); });
  await openPage(page, () => ({ ...operations, requests: requested
    ? [...operations.requests, { ...theirRequest, request_id: "00000000-0000-4000-8000-000000000894", requested_by_me: true }]
    : operations.requests }));
  const trigger = page.getByRole("button", { name: "Request refund" });
  await page.getByLabel("Refund invoice (required)").selectOption(obligation);
  await page.getByLabel("Payment (required)").selectOption("pi_synthetic");
  await page.getByLabel("Refund service (USD)").fill("20");
  await page.getByLabel("Refund tax (USD)").fill("1.4");
  await expect(trigger).toBeDisabled();
  await page.getByLabel("Policy reference (required)").fill("Ticket 4412 rework");
  await trigger.click();
  const confirm = page.getByRole("alertdialog", { name: "Request this refund?" });
  await expect(confirm.getByText("M5-0000000861 · pi_synthetic · $21.40")).toBeVisible();
  await confirm.getByRole("textbox").fill("Rework agreed");
  const sent = page.waitForRequest("**/rpc/money_operator_request_refund");
  await confirm.getByRole("button", { name: "Request refund", exact: true }).click();
  const payload = (await sent).postDataJSON();
  expect(payload).toEqual({ p_obligation: obligation, p_payment: "pi_synthetic", p_service: 2000, p_tax: 140, p_tip: 0,
    p_policy: "Ticket 4412 rework", p_reason: "Rework agreed", p_key: expect.stringContaining(`refund:${obligation}:pi_synthetic`) });
  noActor(payload);
  await expect(confirm).toBeHidden();
  await expect(page.getByLabel("Policy reference (required)")).toHaveValue("");
});

test("a cancellation refund is requested with the policy amounts, never operator amounts", async ({ page }) => {
  await page.route("**/rpc/money_operator_request_cancellation_refund", route => route.fulfill({ json: { request_id: "00000000-0000-4000-8000-000000000895", replay: false } }));
  let requested = false;
  page.on("request", request => { if (request.url().includes("money_operator_request_cancellation_refund")) requested = true; });
  await openPage(page, () => ({ ...operations, requests: requested
    ? [...operations.requests, { ...theirRequest, request_id: "00000000-0000-4000-8000-000000000895", operation: "cancellation_refund", requested_by_me: true }]
    : operations.requests }));
  const list = page.getByRole("table", { name: "Cancellation refunds due" });
  await expect(list.getByText("50% · $58.50")).toBeVisible();
  await list.getByRole("button", { name: "Request policy refund" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Request this cancellation refund?" });
  await expect(confirm.getByText("The amounts come from the recorded cancellation, not from you.", { exact: false })).toBeVisible();
  await confirm.getByRole("textbox").fill("Customer cancelled 25 hours ahead");
  const sent = page.waitForRequest("**/rpc/money_operator_request_cancellation_refund");
  await confirm.getByRole("button", { name: "Request refund", exact: true }).click();
  const payload = (await sent).postDataJSON();
  expect(payload).toEqual({ p_operation: operations.cancellations[0].operation_id, p_payment: "pi_synthetic_cancel",
    p_reason: "Customer cancelled 25 hours ahead", p_key: expect.any(String) });
  noActor(payload);
  await expect(confirm).toBeHidden();
});

test("a chargeback allocation must add up to the loss before it can be requested", async ({ page }) => {
  let requested = false;
  await page.route("**/rpc/money_operator_request_chargeback", route => { requested = true; return route.fulfill({ json: { request_id: "00000000-0000-4000-8000-000000000896", replay: false } }); });
  await openPage(page, () => ({ ...operations, requests: requested
    ? [...operations.requests, { ...theirRequest, request_id: "00000000-0000-4000-8000-000000000896", operation: "chargeback_allocation", requested_by_me: true }]
    : operations.requests }));
  await page.getByLabel("Chargeback (required)").selectOption("dp_synthetic");
  await expect(page.getByText("Lost $10.00 · retained service $100.00 · tax $7.00 · tip $10.00")).toBeVisible();
  const trigger = page.getByRole("button", { name: "Request allocation" });
  await page.getByLabel("Chargeback service (USD)").fill("9");
  await expect(page.getByText("Service, tax and tip must add up to the chargeback.")).toBeVisible();
  await expect(trigger).toBeDisabled();
  await page.getByLabel("Chargeback tip (USD)").fill("1");
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const confirm = page.getByRole("alertdialog", { name: "Request this chargeback allocation?" });
  await confirm.getByRole("textbox").fill("Lost at Stripe");
  const sent = page.waitForRequest("**/rpc/money_operator_request_chargeback");
  await confirm.getByRole("button", { name: "Request allocation", exact: true }).click();
  const payload = (await sent).postDataJSON();
  expect(payload).toEqual({ p_dispute: "dp_synthetic", p_service: 900, p_tax: 0, p_tip: 100, p_reason: "Lost at Stripe", p_key: expect.any(String) });
  noActor(payload);
  await expect(confirm).toBeHidden();
});

test("an expired request offers no action and says why", async ({ page }) => {
  await openPage(page, () => ({ ...operations, requests: [{ ...myApproved, state: "expired" }] }));
  const reviews = page.getByRole("table", { name: "Second-person reviews" });
  await expect(reviews.getByText("Expired", { exact: true })).toBeVisible();
  await expect(reviews.getByText("Not run within 24 hours. Request it again if it still applies.")).toBeVisible();
  await expect(reviews.getByRole("button")).toHaveCount(0);
});

test("an uncertain refund is reissued with a reason once the server allows it", async ({ page }) => {
  let generation = 1;
  const uncertain = { ...operations.refunds[0], attempt_status: "reconcile", last_readback: { found: false, provider_status: null, by_me: true, created_at: now } };
  await page.route("**/rpc/money_operator_reissue_refund", route => { generation = 2; return route.fulfill({ json: { authorization_id: uncertain.authorization_id, generation: 2, replay: false } }); });
  await openPage(page, () => ({ ...operations, refunds: [generation === 1 ? uncertain : { ...uncertain, attempt_status: "prepared", generation: 2 }] }));
  await page.getByRole("button", { name: "Reissue refund" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Reissue this refund?" });
  await expect(confirm.getByText("It never changes the amount.", { exact: false })).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Reissue", exact: true })).toBeDisabled();
  await confirm.getByRole("textbox").fill("Stripe shows no refund for pi_synthetic");
  const sent = page.waitForRequest("**/rpc/money_operator_reissue_refund");
  await confirm.getByRole("button", { name: "Reissue", exact: true }).click();
  const payload = (await sent).postDataJSON();
  expect(payload).toEqual({ p_authorization: uncertain.authorization_id, p_reason: "Stripe shows no refund for pi_synthetic" });
  noActor(payload);
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("table", { name: "Unsettled refunds" }).getByText("reissued (send 2)", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send refund to Stripe" })).toBeVisible();
});
