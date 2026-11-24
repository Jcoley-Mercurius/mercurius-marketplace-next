import { describe, expect, it } from "vitest";
import { bankTransition, canRetryBank, captureJournal, checkout, commercial, earningsJournal, fee, payoutEligibility, processorCostJournal, refundJournal, retained, type CheckoutAttempt, type CommercialTerms } from "../../supabase/functions/_shared/money";
import { acceptMoneyEvent, normalizeMoneyEvent } from "../../supabase/functions/_shared/moneyWebhook";

const terms: CommercialTerms = { service: 10000, addons: 2000, discount: 2000, adjustment: -1000, tax: 630, tip: 2000, deposit: 3000, currency: "usd", sourceVersion: "synthetic-offering-v1", policyVersion: "CFG-005", taxEvidence: "synthetic-tax-calculation", promotionTerms: "synthetic-approved-terms", commissionRateBps: 1500 };
// A snapshot stamped before DEC-2026-067 (15%); the pilot standard (10%) is covered below.
describe("commercial and ledger policy", () => {
  it("charges Mercurius subtotal plus separate tax/tip, with no second fee on a deposit", () => {
    expect(commercial(terms)).toMatchObject({ subtotal: 9000, total: 11630, platformFee: 1350, providerPayable: 9650 });
    expect(captureJournal(3000)).toEqual([{ account: "stripe_clearing", debit: 3000, credit: 0 }, { account: "customer_advance", debit: 0, credit: 3000 }]);
    expect(earningsJournal({ service: 9000, tax: 630, tip: 2000 }, 1500).find(x => x.account === "provider_payable")?.credit).toBe(9650);
  });
  it("uses cumulative retained fee rounding across small partial refunds", () => {
    expect(fee(10, 1500)).toBe(2);
    const first = refundJournal({ service: 10, tax: 0, tip: 0 }, { service: 1, tax: 0, tip: 0 }, 1500);
    expect(first.find(x => x.account === "platform_revenue")?.debit).toBe(1);
    const second = refundJournal({ service: 9, tax: 0, tip: 0 }, { service: 1, tax: 0, tip: 0 }, 1500);
    expect(second.find(x => x.account === "platform_revenue")).toBeUndefined();
    expect(retained({ service: 9000, tax: 630, tip: 2000 }, { service: 4500, tax: 315, tip: 0 }, 1500)).toMatchObject({ platformFee: 675, providerPayable: 5825 });
    expect(retained({ service: 9000, tax: 630, tip: 2000 }, { service: 9000, tax: 630, tip: 2000 }, 1500).total).toBe(0);
  });
  it("keeps processor costs out of provider payable", () => {
    expect(processorCostJournal(321).map(x => x.account)).toEqual(["processor_expense", "stripe_clearing"]);
  });
  it("rejects missing policy evidence, fractional/overflow amounts and excessive refunds/deposits", () => {
    for (const patch of [{ taxEvidence: "" }, { promotionTerms: null }, { service: 0.01 }, { service: Number.MAX_SAFE_INTEGER }, { deposit: 999999 }, { discount: 999999 }]) {
      expect(() => commercial({ ...terms, ...patch })).toThrow();
    }
    expect(() => retained({ service: 1, tax: 0, tip: 0 }, { service: 2, tax: 0, tip: 0 }, 1500)).toThrow();
  });
});

describe("pilot standard commission (DEC-2026-067)", () => {
  const pilot: CommercialTerms = { ...terms, service: 10000, addons: 0, discount: 0, adjustment: 0, tax: 700, tip: 1000, deposit: 0, promotionTerms: null, commissionRateBps: 1000 };
  it("$100 service: $10 commission and $90 to the vendor before separate deductions; tax and tip excluded", () => {
    expect(commercial(pilot)).toMatchObject({ subtotal: 10000, total: 11700, platformFee: 1000, providerPayable: 10000 });
    const lines = earningsJournal({ service: 10000, tax: 700, tip: 1000 }, 1000);
    expect(lines.find(x => x.account === "platform_revenue")?.credit).toBe(1000);
    expect(lines.find(x => x.account === "provider_payable")?.credit).toBe(10000);
  });
  it("rounds half away from zero on whole cents, like PostgreSQL round()", () => {
    expect(fee(3333, 1000)).toBe(333);
    expect(fee(3335, 1000)).toBe(334);
    expect(fee(5, 1000)).toBe(1);
    expect(fee(3333, 500)).toBe(167);
    expect(fee(30, 500)).toBe(2);
  });
  it("recomputes a partial refund on the cumulative retained subtotal at the stamped rate", () => {
    expect(retained({ service: 10000, tax: 0, tip: 0 }, { service: 3333, tax: 0, tip: 0 }, 1000)).toMatchObject({ platformFee: 667, providerPayable: 6000 });
    const refund = refundJournal({ service: 10000, tax: 0, tip: 0 }, { service: 3333, tax: 0, tip: 0 }, 1000);
    expect(refund.find(x => x.account === "platform_revenue")?.debit).toBe(333);
  });
  it("keeps a historical 15% snapshot at 15% through a later refund", () => {
    expect(retained({ service: 10000, tax: 0, tip: 0 }, { service: 4000, tax: 0, tip: 0 }, 1500)).toMatchObject({ platformFee: 900, providerPayable: 5100 });
  });
  it("refuses a rate outside 0-100%", () => {
    expect(() => fee(100, -1)).toThrow("INVALID_RATE");
    expect(() => fee(100, 10001)).toThrow("INVALID_RATE");
    expect(() => fee(100, 10.5)).toThrow("INVALID_RATE");
  });
});

describe("checkout uncertainty", () => {
  const attempt: CheckoutAttempt = { id: "synthetic-attempt", snapshotId: "snapshot-v1", amount: 11630, currency: "usd", idempotencyKey: "stable-key", createdAt: "2026-09-04T00:00:00Z", expiresAt: "2026-09-04T01:00:00Z", status: "prepared", sessionId: null, url: null };
  it("concurrent commands share durable attempt and provider idempotency key", async () => {
    const keys: string[] = [];
    const store = { prepare: async () => attempt, attach: async () => {}, flag: async () => {} };
    const provider = { create: async (input: { idempotencyKey: string }) => { keys.push(input.idempotencyKey); return { id: "cs_same", url: "https://checkout.stripe.com/same" }; } };
    const results = await Promise.all(Array.from({ length: 8 }, () => checkout(store, provider, "owner", "snapshot-v1", "full", new Date("2026-09-04T00:01:00Z"))));
    expect(new Set(keys).size).toBe(1); expect(new Set(results.map(x => x.id)).size).toBe(1);
  });
  it("retries a provider success/local attachment failure with the same key", async () => {
    let failed = false; const keys: string[] = [];
    const store = { prepare: async () => attempt, attach: async () => { if (!failed) { failed = true; throw new Error("write failed"); } }, flag: async () => {} };
    const provider = { create: async (input: { idempotencyKey: string }) => { keys.push(input.idempotencyKey); return { id: "cs_same", url: "https://checkout.stripe.com/same" }; } };
    await expect(checkout(store, provider, "owner", "snapshot-v1", "full", new Date("2026-09-04T00:01:00Z"))).rejects.toThrow("write failed");
    await checkout(store, provider, "owner", "snapshot-v1", "full", new Date("2026-09-04T00:01:00Z"));
    expect(keys).toEqual(["stable-key", "stable-key"]);
  });
  it("never contacts provider for paid, expired or reconciliation attempts", async () => {
    for (const status of ["captured", "expired", "reconcile"] as const) {
      await expect(checkout({ prepare: async () => ({ ...attempt, status }), attach: async () => {}, flag: async () => {} }, { create: async () => { throw new Error("provider should not run"); } }, "owner", "snapshot-v1", "full", new Date("2026-09-04T00:01:00Z"))).rejects.not.toThrow("provider should not run");
    }
  });
});

describe("webhook receipts", () => {
  it("strips customer/card data and accepts capture only from a succeeded intent", () => {
    const event = { id: "evt_synthetic", type: "payment_intent.succeeded", livemode: false, data: { object: { id: "pi_synthetic", status: "succeeded", amount_received: 11630, currency: "usd", receipt_email: "synthetic@example.invalid", metadata: { money_attempt_id: "attempt" } } } };
    expect(normalizeMoneyEvent(event).payload).toEqual({ attempt_id: "attempt", payment_id: "pi_synthetic", amount: 11630, currency: "usd" });
    expect(() => normalizeMoneyEvent({ ...event, data: { object: { ...event.data.object, status: "processing" } } })).toThrow();
  });
  it("retains receipt and signals retry when processing fails", async () => {
    const order: string[] = [];
    await expect(acceptMoneyEvent({ id: "evt_synthetic", type: "capture", payload: {} }, { receive: async () => { order.push("committed"); }, process: async () => { order.push("failed"); return "failed"; } })).rejects.toThrow("WEBHOOK_RETRY_REQUIRED");
    expect(order).toEqual(["committed", "failed"]);
  });
  it("never maps old payment failures or subscription events to job rollback", () => {
    for (const type of ["payment_intent.payment_failed", "customer.subscription.deleted", "checkout.session.completed"]) {
      expect(normalizeMoneyEvent({ id: "evt_synthetic", type, livemode: false, data: { object: { id: "obj_synthetic" } } }).type).toBe("observation");
    }
  });
});

describe("weekly direct ACH eligibility and retries", () => {
  const input = { homeownerConfirmedAt: "2026-09-02T12:00:00Z", confirmationEvidence: "homeowner-event", disputed: false, chargebackOpen: false, reconciliationOpen: false, vendorEligible: true, bankAuthorizationEvidence: "private-form-ref", captured: 11630, total: 11630, payable: 9650 };
  it("starts exactly 48h after homeowner confirmation, never from vendor completion", () => {
    expect(payoutEligibility(input, new Date("2026-09-04T11:59:59.999Z")).eligible).toBe(false);
    expect(payoutEligibility(input, new Date("2026-09-04T12:00:00Z")).eligible).toBe(true);
    expect(payoutEligibility({ ...input, homeownerConfirmedAt: null }, new Date("2026-09-10")).eligible).toBe(false);
  });
  it("retains dispute, reconciliation, payment and compliance holds", () => {
    for (const patch of [{ disputed: true }, { chargebackOpen: true }, { reconciliationOpen: true }, { vendorEligible: false }, { bankAuthorizationEvidence: null }, { captured: 3000 }]) {
      expect(payoutEligibility({ ...input, ...patch }, new Date("2026-09-10")).eligible).toBe(false);
    }
  });
  it("allows retry only after evidenced bank failure/return; unknown is not failure", () => {
    expect(canRetryBank("unknown", "bank-ref")).toBe(false);
    expect(canRetryBank("settled", "bank-ref")).toBe(false);
    expect(canRetryBank("failed", null)).toBe(false);
    expect(canRetryBank("returned", "return-code")).toBe(true);
    expect(() => bankTransition("settled", "submitted", "reason")).toThrow();
    expect(bankTransition("settled", "returned", "bank-return")).toBe("returned");
  });
});
