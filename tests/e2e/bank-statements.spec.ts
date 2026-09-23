import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-081 synthetic browser evidence. Readbacks and commands are mocked; no bank file, bank
// transfer, account detail or operator identity is represented.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const now = "2026-09-16T15:00:00.000Z";
const payee = "Synthetic Payee Services";
const movement = (id: string, overrides: Record<string, unknown> = {}) => ({
  movement: `settled:00000000-0000-4000-8000-0000000009${id}`, kind: "settled", direction: "debit", amount: 9500, bank_reference_hint: "ED01",
  obligation_id: `00000000-0000-4000-8000-0000000008${id}`, invoice_number: `M5-00000008${id}`, payee_name: payee, attempt_number: 1, recorded_at: now, ...overrides,
});
const line = (number: number, overrides: Record<string, unknown> = {}) => ({
  line_id: `00000000-0000-4000-8000-00000000070${number}`, line_number: number, posted_on: "2026-09-10", direction: "debit", amount: 9500,
  bank_reference_hint: `000${number}`, state: "unmatched", match: null, suggestion: { action: "no_transfer" }, dismissal: null, ...overrides,
});
const september = {
  statement_id: "00000000-0000-4000-8000-000000000601", period_start: "2026-09-01", period_end: "2026-09-15", created_by_me: true, created_at: now,
  line_count: 5, debit_total: 37900, credit_total: 123456, imports: 2, exceptions: 4, closed: null, close_blocker: "statement_exceptions", open_request_id: null,
  lines: [
    line(1, { state: "matched", match: { ...movement("70"), how: "reference" }, suggestion: null }),
    line(2, { suggestion: { action: "record_settled", attempt_id: "00000000-0000-4000-8000-000000000981", status: "submitted", obligation_id: "00000000-0000-4000-8000-000000000872",
      amount: 9500, attempt_number: 1, invoice_number: "M5-0000000872", payee_name: payee } }),
    line(3),
    line(4, { amount: 9400, state: "amount_mismatch", match: { ...movement("74"), how: "reference" }, suggestion: null }),
    line(5, { direction: "credit", amount: 123456, state: "dismissed", suggestion: null,
      dismissal: { reason: "Stripe payout to Mercurius, not a provider payout", by_me: true, created_at: now } }),
  ],
};
const lateAugust = {
  ...september, statement_id: "00000000-0000-4000-8000-000000000602", period_start: "2026-08-16", period_end: "2026-08-31", line_count: 0, debit_total: 0, credit_total: 0,
  imports: 1, exceptions: 0, close_blocker: null, lines: [],
};
const earlyAugust = {
  ...september, statement_id: "00000000-0000-4000-8000-000000000603", period_start: "2026-08-01", period_end: "2026-08-15", line_count: 1, debit_total: 9500, credit_total: 0,
  exceptions: 0, close_blocker: null, closed: { by_me: false, reason: "Reconciled against the August statement", created_at: now },
  lines: [line(1, { line_id: "00000000-0000-4000-8000-000000000799", state: "matched", match: { ...movement("79"), how: "reference" }, suggestion: null })],
};
const unevidenced = [{ ...movement("73", { bank_reference_hint: "RDED" }), statement_id: september.statement_id }];
const statements = { today: "2026-09-16", statements: [september, lateAugust, earlyAugust], unevidenced };
const closeRequest = {
  request_id: "00000000-0000-4000-8000-000000000611", operation: "bank_statement_close", subject: lateAugust.statement_id, obligation_id: null, invoice_number: null,
  reason: "Reconciled against the bank portal", evidence: null,
  details: { period_start: "2026-08-16", period_end: "2026-08-31", lines: 3, debits: 19000, credits: 500, exceptions_now: 0 },
  requested_by_me: false, approved_by_me: false, recorded_by_me: false, state: "awaiting_approval", blocker: null,
  created_at: now, expires_at: "2026-09-17T15:00:00.000Z", executed_at: null,
};
const operations = (overrides: Record<string, unknown> = {}) => ({
  evaluated_at: now, requests: [closeRequest], holds: [], readbacks: [], events: [], refunds: [], refund_releases: [], late_refunds: [], cancellations: [], chargebacks: [],
  ach: { next_period_start: null, ready: [], batches: [] }, recoveries: { owed_total: 0, owed: [], withdrawn: [], late_settlements: [] },
    repayment_returns: { returnable_total: 0, payouts: [] },
  statements, ...overrides,
});
const reconciliation = {
  evaluated_at: now, fee_percent: 15, obligation_count: 0, listed_limit: 200, global_event_holds: 0, accounts: [],
  totals: { captured: 0, refunded: 0, platform_fee: 0, tax: 0, provider_payable: 0, paid_out: 0, processor_costs: 0, chargeback_suspense: 0, provider_owed: 0, with_issues: 0 },
  exceptions: [
    { kind: "bank_line", line_id: september.lines[2].line_id, statement_id: september.statement_id, period_start: "2026-09-01", period_end: "2026-09-15",
      line_number: 3, direction: "debit", amount: 9500, state: "unmatched", obligation_id: null, since: now },
    { kind: "bank_unevidenced", movement: unevidenced[0].movement, movement_kind: "settled", obligation_id: unevidenced[0].obligation_id, direction: "debit", amount: 9500, since: now },
  ],
  obligations: [],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
  await page.route("**/rpc/money_finance_reconciliation", route => route.fulfill({ json: reconciliation }));
});

async function openPage(page: Page, ops: () => unknown = () => operations(), theme = "light", width = 1440) {
  await page.route("**/rpc/money_finance_operations", route => route.fulfill({ json: ops() }));
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/finance");
  await expect(page.getByRole("heading", { level: 3, name: "Bank statements" })).toBeVisible();
}

const noActor = (payload: Record<string, unknown>) =>
  expect(Object.keys(payload).filter(key => /actor|approver|user/.test(key))).toEqual([]);
const septemberCard = (page: Page) => page.locator("details", { hasText: "Statement Sep 1, 2026 to Sep 15, 2026" });

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`bank statements ${theme} ${width}px`, async ({ page }) => {
    await openPage(page, undefined, theme, width);
    const card = septemberCard(page);
    await expect(card.getByText("4 open exceptions")).toBeVisible();
    await expect(card.getByText("The statement has unresolved lines, or recorded bank movements in its period that no line shows. Resolve them first.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Request close" })).toBeDisabled();
    const lines = card.getByRole(width < 1280 ? "list" : "table", { name: "Statement Sep 1, 2026 to Sep 15, 2026 lines" });
    await expect(lines.getByText("Amount differs", { exact: true }).first()).toBeVisible();
    await expect(lines.getByText("· recorded $95.00", { exact: false }).first()).toBeVisible();
    await expect(lines.getByText("The bank paid this transfer. Record it settled.", { exact: false }).first()).toBeVisible();
    await expect(lines.getByRole("button", { name: "Record settled" })).toHaveCount(1);
    await expect(lines.getByRole("button", { name: "Not a payout" })).toHaveCount(1);
    await expect(lines.getByText("Stripe payout to Mercurius, not a provider payout").first()).toBeVisible();
    await expect(page.locator("details", { hasText: "Statement Aug 1, 2026 to Aug 15, 2026" }).getByText("Closed", { exact: true })).toBeVisible();
    const missing = page.getByRole(width < 1280 ? "list" : "table", { name: "Recorded bank movements not on a statement" });
    await expect(missing.getByText("Inside an imported statement period").first()).toBeVisible();
    await expect(missing.getByText("ref …RDED", { exact: false }).first()).toBeVisible();
    expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await septemberCard(page).screenshot({ path: `test-results/bank-statements-${theme}-${width}.png` });
  });
}

test("a CSV is read in the browser and only each chosen line's date, direction, cents and reference are sent", async ({ page }) => {
  let imported = false;
  await page.route("**/rpc/money_operator_import_bank_statement", route => {
    imported = true;
    return route.fulfill({ json: { statement_id: september.statement_id, import_id: "00000000-0000-4000-8000-000000000621", lines: 1, replay: false } });
  });
  await openPage(page, () => operations({ statements: imported ? statements : { ...statements, statements: [] } }));
  await page.getByLabel("Statement period starts (required)").fill("2026-09-01");
  await page.getByLabel("Statement period ends (required)").fill("2026-09-15");
  const csv = [
    "Posting Date,Description,Amount,Trace Number",
    '09/10/2026,"ACH SYNTHETIC PAYEE, ACCT 000123456789",-95.00,091000019990001',
    "09/11/2026,STRIPE TRANSFER,1234.56,STRIPE-1",
    "09/20/2026,ACH LATER PAYEE,-10.00,091000019990002",
    "not a date,BROKEN,-1.00,X",
  ].join("\r\n");
  await page.getByLabel("Bank CSV export").setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByLabel("Date column (required)")).toHaveValue("0");
  await expect(page.getByLabel("Reference column (required)")).toHaveValue("3");
  await expect(page.getByLabel("Amount column (required)")).toHaveValue("2");
  await expect(page.getByText("ACH SYNTHETIC PAYEE, ACCT 000123456789")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Row 4/ })).toBeDisabled();
  await expect(page.getByText("Dated outside the statement period.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Row 5/ })).toBeDisabled();
  await expect(page.getByText("The date could not be read.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import 0 lines" })).toBeDisabled();
  await page.getByRole("button", { name: "Select all debits" }).click();
  await expect(page.getByRole("checkbox", { name: /Row 2/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Row 3/ })).not.toBeChecked();
  await expect(page.getByText("1 line · debits $95.00 · credits $0.00")).toBeVisible();
  await page.getByRole("button", { name: "Import 1 line" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Import these statement lines?" });
  await expect(confirm.getByText("Nothing is recorded on any transfer.", { exact: false })).toBeVisible();
  const sent = page.waitForRequest("**/rpc/money_operator_import_bank_statement");
  await confirm.getByRole("button", { name: "Import", exact: true }).click();
  const request = await sent;
  const payload = request.postDataJSON();
  expect(Object.keys(payload).sort()).toEqual(["p_file_fingerprint", "p_key", "p_lines", "p_period_end", "p_period_start"]);
  expect(payload.p_period_start).toBe("2026-09-01");
  expect(payload.p_period_end).toBe("2026-09-15");
  expect(payload.p_lines).toEqual([{ posted_on: "2026-09-10", direction: "debit", amount: 9500, reference: "091000019990001" }]);
  expect(payload.p_file_fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(request.postData()).not.toContain("000123456789");
  expect(request.postData()).not.toContain("ACH SYNTHETIC PAYEE");
  expect(request.postData()).not.toContain("statement.csv");
  noActor(payload);
  await expect(confirm).toBeHidden();
  await expect(septemberCard(page)).toBeVisible();
  await expect(page.getByText("ACH SYNTHETIC PAYEE, ACCT 000123456789")).toHaveCount(0);
});

test("one line can be entered by hand, and an empty period recorded", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/rpc/money_operator_import_bank_statement", route => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { statement_id: lateAugust.statement_id, import_id: "synthetic", lines: 1, replay: false } });
  });
  await openPage(page);
  await page.getByLabel("Statement period starts (required)").fill("2026-08-16");
  await page.getByLabel("Statement period ends (required)").fill("2026-08-31");
  await page.getByText("Enter one line by hand, or record a period with no payout lines").click();
  await page.getByLabel("Posting date (required)").fill("2026-09-02");
  await page.getByLabel("Debit or credit (required)").selectOption("credit");
  await page.getByLabel("Line amount in USD (required)").fill("5.00");
  await page.getByLabel("Bank reference on the line (required)").fill(" RET-77 ");
  await expect(page.getByText("Dated outside the statement period.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import this line" })).toBeDisabled();
  await page.getByLabel("Posting date (required)").fill("2026-08-20");
  await page.getByRole("button", { name: "Import this line" }).click();
  await page.getByRole("alertdialog", { name: "Import this statement line?" }).getByRole("button", { name: "Import", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].p_lines).toEqual([{ posted_on: "2026-08-20", direction: "credit", amount: 500, reference: "RET-77" }]);
  expect(bodies[0].p_file_fingerprint).toBeUndefined();
  await page.getByRole("button", { name: "Record no payout lines" }).click();
  await page.getByRole("alertdialog", { name: "Record that this period had no payout lines?" }).getByRole("button", { name: "Record", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1].p_lines).toEqual([]);
  expect(bodies[1].p_key).not.toEqual(bodies[0].p_key);
});

test("an unmatched line records its settlement through the bank outcome command with a note", async ({ page }) => {
  let resolved = false;
  await page.route("**/rpc/money_operator_resolve_bank_line", route => {
    resolved = true;
    return route.fulfill({ json: { attempt_id: "00000000-0000-4000-8000-000000000981", status: "settled", replay: false } });
  });
  const matched = { ...september, lines: september.lines.map(item => item.line_number === 2 ? { ...item, state: "matched", suggestion: null, match: { ...movement("72"), how: "reference" } } : item) };
  await openPage(page, () => operations({ statements: { ...statements, statements: [resolved ? matched : september, lateAugust, earlyAugust] } }));
  await septemberCard(page).getByRole("button", { name: "Record settled" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Record settled from this line?" });
  await expect(confirm.getByText("posts the payout to the ledger", { exact: false })).toBeVisible();
  await expect(confirm.getByText("M5-0000000872", { exact: false })).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Record settled" })).toBeDisabled();
  await confirm.getByRole("textbox").fill("September statement check");
  const sent = page.waitForRequest("**/rpc/money_operator_resolve_bank_line");
  await confirm.getByRole("button", { name: "Record settled" }).click();
  const payload = (await sent).postDataJSON();
  expect(payload).toMatchObject({ p_line: september.lines[1].line_id, p_action: "record_settled", p_note: "September statement check" });
  expect(Object.keys(payload).sort()).toEqual(["p_action", "p_key", "p_line", "p_note"]);
  noActor(payload);
  await expect(confirm).toBeHidden();
  await expect(septemberCard(page).getByRole("button", { name: "Record settled" })).toHaveCount(0);
});

test("a line is dismissed as not a payout, or matched by hand to a recorded movement, each with a reason", async ({ page }) => {
  const dismissals: Record<string, unknown>[] = [];
  const matches: Record<string, unknown>[] = [];
  await page.route("**/rpc/money_operator_dismiss_bank_line", route => {
    dismissals.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { code: "55000", message: "Statement line not dismissable: line_names_transfer", details: null, hint: null } });
  });
  await page.route("**/rpc/money_operator_match_bank_line", route => {
    matches.push(route.request().postDataJSON());
    return route.fulfill({ json: { line_id: september.lines[2].line_id, movement: unevidenced[0].movement, replay: false } });
  });
  const matched = { ...september, lines: september.lines.map(item => item.line_number === 3 ? { ...item, state: "matched", suggestion: null, match: { ...unevidenced[0], how: "manual" } } : item) };
  await openPage(page, () => operations({ statements: matches.length ? { ...statements, statements: [matched, lateAugust, earlyAugust], unevidenced: [] } : statements }));

  await septemberCard(page).getByRole("button", { name: "Not a payout" }).click();
  const dismiss = page.getByRole("alertdialog", { name: "Dismiss this line as not a provider payout?" });
  await dismiss.getByRole("textbox").fill("Operating expense imported by mistake");
  await dismiss.getByRole("button", { name: "Dismiss line" }).click();
  await expect(dismiss.getByRole("alert")).toBeFocused();
  await expect(page.getByText("This line's reference names a recorded transfer, so it is a payout line and cannot be dismissed.").first()).toBeVisible();
  expect(dismissals[0]).toEqual({ p_line: september.lines[2].line_id, p_reason: "Operating expense imported by mistake" });
  await dismiss.getByRole("button", { name: "Cancel" }).click();

  await page.getByLabel("Unmatched statement line (required)").selectOption(september.lines[2].line_id);
  await page.getByLabel("Recorded movement it shows (required)").selectOption(unevidenced[0].movement);
  await page.getByRole("button", { name: "Match line" }).click();
  const match = page.getByRole("alertdialog", { name: "Match this line to the movement?" });
  await expect(match.getByText("M5-0000000873", { exact: false })).toBeVisible();
  await match.getByRole("textbox").fill("Bank shows its own trace number");
  await match.getByRole("button", { name: "Match", exact: true }).click();
  await expect(match).toBeHidden();
  expect(matches[0]).toEqual({ p_line: september.lines[2].line_id, p_movement: unevidenced[0].movement, p_reason: "Bank shows its own trace number" });
  noActor(matches[0]);
  await expect(septemberCard(page).getByRole("table", { name: "Statement Sep 1, 2026 to Sep 15, 2026 lines" })
    .getByText("matched by hand", { exact: false })).toBeVisible();
});

test("closing a reconciled statement is a request a second operator approves with its totals", async ({ page }) => {
  let requested = false;
  await page.route("**/rpc/money_operator_request_bank_statement_close", route => {
    requested = true;
    return route.fulfill({ json: { request_id: "00000000-0000-4000-8000-000000000612", replay: false } });
  });
  const mine = { ...closeRequest, request_id: "00000000-0000-4000-8000-000000000612", requested_by_me: true,
    details: { ...closeRequest.details, lines: 0, debits: 0, credits: 0 } };
  await openPage(page, () => operations({
    requests: requested ? [closeRequest, mine] : [closeRequest],
    statements: { ...statements, statements: [september, { ...lateAugust, open_request_id: requested ? mine.request_id : null }, earlyAugust] },
  }));
  const reviews = page.getByRole("table", { name: "Second-person reviews" });
  await expect(reviews.getByText("Statement Aug 16, 2026 to Aug 31, 2026").first()).toBeVisible();
  await expect(reviews.getByText("3 lines · debits $190.00 · credits $5.00")).toBeVisible();
  const card = page.locator("details", { hasText: "Statement Aug 16, 2026 to Aug 31, 2026" });
  await expect(card.getByText("No payout lines were imported for this period.")).toBeVisible();
  await card.getByRole("button", { name: "Request close" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Request to close this statement?" });
  await expect(confirm.getByText("bound to these lines and totals", { exact: false })).toBeVisible();
  await confirm.getByRole("textbox").fill("Checked against the August statement");
  const sent = page.waitForRequest("**/rpc/money_operator_request_bank_statement_close");
  await confirm.getByRole("button", { name: "Request close" }).click();
  const payload = (await sent).postDataJSON();
  expect(payload).toMatchObject({ p_statement: lateAugust.statement_id, p_reason: "Checked against the August statement" });
  noActor(payload);
  await expect(confirm).toBeHidden();
  await expect(card.getByText("Close requested; see reviews.")).toBeVisible();
  await expect(card.getByRole("button", { name: "Request close" })).toBeDisabled();
});

test("reconciliation lists unmatched statement lines and movements missing from a statement", async ({ page }) => {
  await openPage(page);
  const exceptions = page.getByRole("table", { name: "Finance exceptions" });
  await expect(exceptions.getByText("Statement line unmatched")).toBeVisible();
  await expect(exceptions.getByText("Statement 2026-09-01 to 2026-09-15, line 3")).toBeVisible();
  await expect(exceptions.getByText("Not on a bank statement")).toBeVisible();
  await expect(exceptions.getByText("ACH transfer settled")).toBeVisible();
  await expect(exceptions.getByText("Import the missing line", { exact: false })).toBeVisible();
});
