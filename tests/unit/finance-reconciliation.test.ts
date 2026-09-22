import { describe, expect, it } from "vitest";
import {
  accountLabel,
  bankStatusLabel,
  exceptionAmount,
  exceptionPresentation,
  formatCents,
  fundsStateLabel,
  issueLabel,
  labelOf,
  needsAttention,
  readbackLabel,
  reasonLabel,
  type FinanceException,
  type ObligationReconciliation,
} from "../../src/lib/financeReconciliation";

// TRACE-075/080: the page only words server-derived states; these cases pin that wording.
const since = "2026-09-16T12:00:00.000Z";
const row = (patch: Partial<ObligationReconciliation> = {}): ObligationReconciliation => ({
  obligation_id: "00000000-0000-4000-8000-000000000001",
  service_request_id: "00000000-0000-4000-8000-000000000002",
  invoice_number: "M5-0000000001",
  created_at: since,
  payee: { contractor_id: "00000000-0000-4000-8000-000000000003", name: "Synthetic payee", reassigned: false },
  terms: { subtotal: 10000, tax: 700, tip: 1000, deposit: 0, total: 11700 },
  charges: { captured: 11700, attempts_captured: 11700, ledger_captured: 11700, fully_captured: true, payments: [] },
  refunds: { service: 0, tax: 0, tip: 0, settled: 0, pending: 0 },
  earnings: { platform_fee: 1500, platform_fee_ledger: 1500, tax: 700, tax_ledger: 700, provider_proceeds: 9500 },
  payout: { funds_state: "eligible", not_eligible: [], held: [], eligible_at: null, paid: 0, returned: 0, payable: 9500, payable_ledger: 9500, statement: null,
    withdrawn_statements: 0, recovery: { owed: 0, late_settled: 0, repaid: 0, written_off: 0 } },
  chargebacks: { suspense: 0, suspense_ledger: 0, lost: 0 },
  processor_costs: 0,
  readback: { state: "none" },
  reconciliation_open: false,
  issues: [],
  ...patch,
});

describe("finance reconciliation presentation", () => {
  it("formats integer cents as dollars", () => {
    expect(formatCents(950000)).toBe("$9,500.00");
    expect(formatCents(1)).toBe("$0.01");
  });

  it("labels every funds state without a reversed state", () => {
    expect(Object.keys(fundsStateLabel).sort()).toEqual(["eligible", "held", "not_eligible", "paid", "payout_failed", "scheduled"]);
    expect(bankStatusLabel.unknown).toBe("bank outcome unknown");
  });

  it("falls back to the raw code for an unrecognized server value", () => {
    expect(labelOf(issueLabel, "platform_fee")).toBe("Platform revenue differs from the fee on retained service");
    expect(labelOf(reasonLabel, "future_reason")).toBe("future_reason");
  });

  it("flags rows with ledger issues, holds, failed payouts or readback drift", () => {
    expect(needsAttention(row())).toBe(false);
    expect(needsAttention(row({ payout: { ...row().payout, funds_state: "not_eligible", not_eligible: ["confirmation_window"] } }))).toBe(false);
    expect(needsAttention(row({ issues: ["provider_payable"] }))).toBe(true);
    expect(needsAttention(row({ payout: { ...row().payout, funds_state: "held", held: ["pending_refund"] } }))).toBe(true);
    expect(needsAttention(row({ payout: { ...row().payout, funds_state: "payout_failed" } }))).toBe(true);
    expect(needsAttention(row({ readback: { state: "mismatch", observed: 9559, expected: 9560, recorded_at: since } }))).toBe(true);
    expect(needsAttention(row({ reconciliation_open: true }))).toBe(true);
  });

  it("words Stripe readback states", () => {
    expect(readbackLabel({ state: "none" })).toBe("No Stripe readback recorded");
    expect(readbackLabel({ state: "mismatch", observed: 9559, expected: 9560, recorded_at: since })).toBe("Stripe readback $95.59, ledger $95.60");
    expect(readbackLabel({ state: "outdated", observed: 11700, expected: 11700, recorded_at: since })).toBe("Money moved since the last Stripe readback");
  });

  it("never tells an operator to resend an unknown bank transfer or duplicate a refund", () => {
    const unknown: FinanceException = { kind: "bank_outcome", obligation_id: "o", item_id: "i", attempt_number: 1, amount: 9500, status: "unknown", since };
    expect(exceptionPresentation(unknown)).toEqual({ title: "Bank outcome unknown", action: "Confirm the transfer with the bank. Do not resend it." });
    expect(exceptionPresentation({ ...unknown, status: "returned" }).title).toBe("Transfer returned");
    const refund: FinanceException = { kind: "refund_pending", obligation_id: "o", authorization_id: "a", payment_id: "pi_x", amount: 2140, attempt_status: "reconcile", since };
    expect(exceptionPresentation(refund).action).toBe("Read the refund back from Stripe. Do not create a second refund.");
    expect(exceptionPresentation({ ...refund, attempt_status: "not_started" }).action).toBe("The reviewed refund has not been sent to Stripe yet.");
    expect(exceptionAmount(refund)).toBe(2140);
  });

  it("says an unsupported Stripe event holds every payout", () => {
    const event: FinanceException = { kind: "provider_event", event_id: "evt_x", event_type: "reconciliation_required", status: "failed", attempts: 1, error_code: null, holds_all_payouts: true, obligation_id: null, since };
    expect(exceptionPresentation(event).title).toBe("Unsupported Stripe event");
    expect(exceptionPresentation({ ...event, holds_all_payouts: false }).title).toBe("Stripe event not processed");
    expect(exceptionAmount(event)).toBeNull();
    expect(exceptionPresentation({ kind: "chargeback", obligation_id: "o", dispute_id: "dp", payment_id: "pi", amount: 1000, status: "lost", since }).title).toBe("Chargeback lost");
  });

  it("flags a paid payout whose provider owes Mercurius, and never suggests a debit or netting", () => {
    const paid = row({ payout: { ...row().payout, funds_state: "paid", paid: 9500, payable: -1700, payable_ledger: -1700,
      recovery: { owed: 1700, late_settled: 0, repaid: 0, written_off: 0 } } });
    expect(needsAttention(paid)).toBe(true);
    expect(needsAttention(row({ payout: { ...paid.payout, payable: 0, payable_ledger: 0, recovery: { owed: 0, late_settled: 0, repaid: 1000, written_off: 700 } } }))).toBe(false);
    const owes: FinanceException = { kind: "provider_owes", obligation_id: "o", invoice_number: "M5-1", payee_name: "Synthetic payee", amount: 1700, since };
    expect(exceptionPresentation(owes).title).toBe("Provider owes Mercurius");
    expect(exceptionPresentation(owes).action).toContain("second reviewer");
    expect(exceptionPresentation(owes).action).toContain("Never debit the provider's bank or hold back other earnings");
    expect(exceptionAmount(owes)).toBe(1700);
    expect(issueLabel.recovery_ledger).toBe("Recovery loss differs from recorded write-offs");
    expect(accountLabel.provider_recovery_loss).toBe("Provider recovery loss");
  });
});
