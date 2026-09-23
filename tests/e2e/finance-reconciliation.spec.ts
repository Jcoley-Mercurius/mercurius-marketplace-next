import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

import { syntheticSession } from "../fixtures/browser-session";

// TRACE-075/080 synthetic browser evidence. The reconciliation is a mocked readback; no real
// charge, refund, provider, bank transfer or Stripe object is represented.
const tags = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const evaluated = "2026-09-16T15:00:00.000Z";
const payee = { contractor_id: "00000000-0000-4000-8000-000000000751", name: "Synthetic Payee Services", reassigned: false };
const base = {
  service_request_id: "00000000-0000-4000-8000-000000000760",
  created_at: "2026-09-10T15:00:00.000Z",
  payee,
  terms: { subtotal: 10000, tax: 700, tip: 1000, deposit: 3000, total: 11700 },
  charges: { captured: 11700, attempts_captured: 11700, ledger_captured: 11700, fully_captured: true, payments: [{ payment_id: "pi_synthetic", mode: "full", amount: 11700 }] },
  refunds: { service: 0, tax: 0, tip: 0, settled: 0, pending: 0, released: 0 },
  earnings: { platform_fee: 1500, platform_fee_ledger: 1500, tax: 700, tax_ledger: 700, provider_proceeds: 9500 },
  payout: { funds_state: "eligible", not_eligible: [], held: [], eligible_at: null, paid: 0, returned: 0, payable: 9500, payable_ledger: 9500, statement: null,
    withdrawn_statements: 0, recovery: { owed: 0, late_settled: 0, repaid: 0, written_off: 0 } },
  chargebacks: { suspense: 0, suspense_ledger: 0, lost: 0 },
  processor_costs: 0,
  readback: { state: "matched", observed: 11700, expected: 11700, recorded_at: "2026-09-12T15:00:00.000Z" },
  reconciliation_open: false,
  issues: [],
};
const mismatched = {
  ...base, obligation_id: "00000000-0000-4000-8000-000000000771", invoice_number: "M5-0000000771",
  earnings: { ...base.earnings, platform_fee_ledger: 1600 },
  payout: { ...base.payout, funds_state: "held", held: ["pending_refund"], payable_ledger: 9400 },
  refunds: { ...base.refunds, pending: 1 },
  issues: ["platform_fee", "provider_payable"],
};
const eligible = { ...base, obligation_id: "00000000-0000-4000-8000-000000000772", invoice_number: "M5-0000000772" };
const windowed = {
  ...base, obligation_id: "00000000-0000-4000-8000-000000000773", invoice_number: "M5-0000000773",
  payout: { ...base.payout, funds_state: "not_eligible", not_eligible: ["confirmation_window"], eligible_at: "2026-09-17T09:00:00.000Z" },
  readback: { state: "none" },
};
const paid = {
  ...base, obligation_id: "00000000-0000-4000-8000-000000000774", invoice_number: "M5-0000000774",
  payout: { ...base.payout, funds_state: "paid", paid: 9500, payable_ledger: 0, statement: { amount: 9500, period_start: "2026-09-07", attempt_number: 2, bank_status: "settled" } },
};
const reconciliation = {
  evaluated_at: evaluated, fee_percent: 15, obligation_count: 4, listed_limit: 200, global_event_holds: 0,
  accounts: [
    { account: "bank", debit: 0, credit: 9500 },
    { account: "platform_revenue", debit: 0, credit: 6100 },
    { account: "provider_payable", debit: 9500, credit: 38000 },
    { account: "stripe_clearing", debit: 46800, credit: 0 },
    { account: "tax_liability", debit: 0, credit: 2700 },
  ],
  totals: { captured: 46800, refunded: 0, platform_fee: 6100, tax: 2700, provider_payable: 28400, paid_out: 9500, processor_costs: 0, chargeback_suspense: 0, provider_owed: 0, with_issues: 1 },
  exceptions: [
    { kind: "ledger_mismatch", obligation_id: mismatched.obligation_id, invoice_number: mismatched.invoice_number, codes: mismatched.issues, since: "2026-09-10T15:00:00.000Z" },
    { kind: "refund_pending", obligation_id: mismatched.obligation_id, authorization_id: "00000000-0000-4000-8000-000000000781", payment_id: "pi_synthetic", amount: 2140, attempt_status: "reconcile", since: "2026-09-11T15:00:00.000Z" },
    { kind: "bank_outcome", obligation_id: paid.obligation_id, item_id: "00000000-0000-4000-8000-000000000782", attempt_number: 1, amount: 9500, status: "unknown", since: "2026-09-12T15:00:00.000Z" },
  ],
  obligations: [mismatched, eligible, windowed, paid],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    return ["http://127.0.0.1:3103", "http://127.0.0.1:55831"].includes(origin) ? route.continue() : route.abort();
  });
});

function readback(page: Page, body: Record<string, unknown>) {
  return page.route("**/rpc/money_finance_reconciliation", route => route.fulfill({ json: { ...reconciliation, ...body } }));
}

async function openPage(page: Page, theme = "light", width = 320) {
  await syntheticSession(page.context(), "admin");
  await page.addInitScript(value => localStorage.setItem("theme", value), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/admin/finance");
  await expect(page.getByRole("heading", { level: 1, name: "Finance reconciliation" })).toBeVisible();
}

for (const [theme, width] of [["light", 320], ["dark", 1440]] as const) {
  test(`finance reconciliation ${theme} ${width}px`, async ({ page }) => {
    await readback(page, {});
    await openPage(page, theme, width);
    const narrow = width < 1280;
    const exceptions = narrow ? page.getByRole("list", { name: "Finance exceptions" }) : page.getByRole("table", { name: "Finance exceptions" });
    await expect(exceptions.getByText("Ledger mismatch", { exact: true })).toBeVisible();
    await expect(exceptions.getByText("Read the refund back from Stripe. Do not create a second refund.")).toBeVisible();
    await expect(exceptions.getByText("Confirm the transfer with the bank. Do not resend it.")).toBeVisible();
    const invoices = narrow ? page.getByRole("list", { name: "Invoice reconciliation" }) : page.getByRole("table", { name: "Invoice reconciliation" });
    await expect(invoices.getByText("Platform revenue differs from the fee on retained service")).toBeVisible();
    await expect(invoices.getByText("Refund not yet settled")).toBeVisible();
    const totals = page.getByRole("region", { name: "Ledger totals" });
    await expect(totals.getByText("$468.00")).toBeVisible();
    await expect(totals.getByText("Invoices with ledger issues")).toBeVisible();
    const accounts = reconciliation.accounts;
    expect(accounts.reduce((sum, a) => sum + a.debit, 0)).toBe(accounts.reduce((sum, a) => sum + a.credit, 0));
    expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    if (width >= 1024) {
      const nav = page.getByRole("navigation", { name: "admin navigation" });
      await expect(nav.getByRole("link", { name: "Finance Reconciliation" })).toHaveAttribute("aria-current", "page");
    }
    await page.screenshot({ path: `test-results/finance-reconciliation-${theme}-${width}.png`, fullPage: true });
  });
}

test("invoices filter by attention and funds state and show payout detail", async ({ page }) => {
  await readback(page, {});
  await openPage(page, "light", 1440);
  const table = page.getByRole("table", { name: "Invoice reconciliation" });
  await expect(page.getByRole("button", { name: "Needs attention (1)" })).toHaveAttribute("aria-pressed", "true");
  await expect(table.getByText("M5-0000000771")).toBeVisible();
  await expect(table.getByText("M5-0000000772")).toHaveCount(0);
  await page.getByRole("button", { name: "All (4)" }).click();
  await expect(table.getByText("Reconciled")).toHaveCount(3);
  await expect(table.getByRole("link", { name: "Synthetic Payee Services" }).first()).toHaveAttribute("href", `/admin/vendors/${payee.contractor_id}`);
  await expect(table.getByText("Inside 48 hours of homeowner confirmation", { exact: false })).toBeVisible();
  await expect(table.getByText("No Stripe readback recorded")).toBeVisible();
  await page.getByRole("button", { name: "Paid (1)" }).click();
  await expect(table.getByText("$95.00 · week of 2026-09-07 · attempt 2 settled")).toBeVisible();
  await expect(table.getByText("M5-0000000771")).toHaveCount(0);
  await page.getByRole("button", { name: "Eligible for ACH (1)" }).click();
  await expect(table.getByText("M5-0000000772")).toBeVisible();
});

test("an unsupported Stripe event warns that every payout is held", async ({ page }) => {
  await readback(page, {
    global_event_holds: 1,
    exceptions: [{ kind: "provider_event", event_id: "evt_synthetic", event_type: "reconciliation_required", status: "failed", attempts: 1, error_code: "P0001", holds_all_payouts: true, obligation_id: null, since: evaluated }],
  });
  await openPage(page, "light", 1440);
  await expect(page.getByRole("alert").filter({ hasText: "Every provider payout is held until it is read back and excluded." })).toBeVisible();
  const table = page.getByRole("table", { name: "Finance exceptions" });
  await expect(table.getByText("Unsupported Stripe event")).toBeVisible();
  await expect(table.getByText("No invoice linked")).toBeVisible();
});

test("an empty ledger explains that nothing needs action", async ({ page }) => {
  await readback(page, { obligation_count: 0, accounts: [], exceptions: [], obligations: [],
    totals: { captured: 0, refunded: 0, platform_fee: 0, tax: 0, provider_payable: 0, paid_out: 0, processor_costs: 0, chargeback_suspense: 0, provider_owed: 0, with_issues: 0 } });
  await openPage(page);
  await expect(page.getByRole("heading", { name: "No open exceptions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No invoices yet" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No journal postings yet" })).toBeVisible();
});

test("an admin without finance authority sees the permission state", async ({ page }) => {
  await page.route("**/rpc/money_finance_reconciliation", route => route.fulfill({
    status: 403, json: { code: "42501", message: "Restricted finance authority required", details: null, hint: null },
  }));
  await openPage(page);
  await expect(page.getByRole("heading", { name: "Finance authority required" })).toBeVisible();
  await expect(page.getByText("Ledger totals")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
});

test("a reconciliation that cannot load offers a retry", async ({ page }) => {
  let fail = true;
  await page.route("**/rpc/money_finance_reconciliation", route => fail
    ? route.fulfill({ status: 500, json: { code: "XX000", message: "Synthetic outage" } })
    : route.fulfill({ json: reconciliation }));
  await openPage(page);
  await expect(page.getByRole("alert").filter({ hasText: "Finance reconciliation unavailable" })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "All (4)" })).toBeVisible();
});

test("a truncated list says totals still cover every invoice", async ({ page }) => {
  await readback(page, { obligation_count: 250 });
  await openPage(page, "light", 1440);
  await expect(page.getByText("Showing 4 of 250 invoices", { exact: false })).toBeVisible();
});

test("a provider who owes Mercurius after a refund on a paid payout needs attention and names the recovery path", async ({ page }) => {
  const owing = {
    ...paid, obligation_id: "00000000-0000-4000-8000-000000000775", invoice_number: "M5-0000000775",
    refunds: { ...base.refunds, service: 2000, settled: 1 },
    payout: { ...paid.payout, payable: -1700, payable_ledger: -1700, recovery: { owed: 1700, late_settled: 0, repaid: 0, written_off: 0 } },
  };
  await readback(page, {
    obligations: [owing, eligible],
    totals: { ...reconciliation.totals, provider_owed: 1700 },
    exceptions: [{ kind: "provider_owes", obligation_id: owing.obligation_id, invoice_number: owing.invoice_number, payee_name: payee.name, amount: 1700, since: evaluated }],
  });
  await openPage(page, "light", 1440);
  const totals = page.getByRole("region", { name: "Ledger totals" });
  await expect(totals.getByText("Owed by providers")).toBeVisible();
  await expect(totals.getByText("$17.00")).toBeVisible();
  const exceptions = page.getByRole("table", { name: "Finance exceptions" });
  await expect(exceptions.getByText("Provider owes Mercurius", { exact: true })).toBeVisible();
  await expect(exceptions.getByText("Never debit the provider's bank or hold back other earnings.", { exact: false })).toBeVisible();
  const invoices = page.getByRole("table", { name: "Invoice reconciliation" });
  await expect(page.getByRole("button", { name: "Needs attention (1)" })).toHaveAttribute("aria-pressed", "true");
  await expect(invoices.getByText("Provider owes $17.00")).toBeVisible();
  expect((await new AxeBuilder({ page }).include("#main-content").withTags(tags).analyze()).violations).toEqual([]);
});
