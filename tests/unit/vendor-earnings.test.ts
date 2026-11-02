import { describe, expect, it } from "vitest";

import {
  earningsStateDetail,
  earningsStateLabel,
  formatCents,
  formatEasternDateTime,
  formatWeek,
  holdCategoryLabel,
  summarizeEarnings,
  transferStatusLabel,
  type EarningsJob,
  type EarningsState,
} from "@/lib/vendorEarnings";

// TRACE-135 (Phase 6.12B, DEC-2026-056): wording for a provider's own earnings and payouts.

function job(overrides: Partial<EarningsJob> = {}): EarningsJob {
  return {
    job_id: "job-1", invoice_number: "M5-0000000001", service: "House cleaning", completed_at: "2026-10-28T15:00:00Z",
    confirmed_at: "2026-10-29T15:00:00Z", state: "eligible", holds: [], eligible_at: "2026-10-31T15:00:00Z",
    amounts: { service: 10000, platform_fee: 1500, platform_subsidy: 0, tips: 1000, payout: 9500 }, received: 0,
    transfer: null, ...overrides,
  };
}

const ALL_STATES: EarningsState[] = [
  "waiting_payment", "awaiting_confirmation", "confirmation_window", "eligible", "held", "in_transfer", "sent",
  "unknown", "paid", "failed", "returned", "nothing_payable", "unavailable",
];

describe("earningsStateDetail", () => {
  it("words an eligible payout without an expected payout date (item 2)", () => {
    expect(earningsStateDetail(job())).toBe("Eligible since Oct 31, 2026; paid in a weekly transfer Mercurius prepares.");
  });

  it("uses the approved transfer problem wording without retry or recovery dates (item 5)", () => {
    expect(earningsStateDetail(job({ state: "unknown" }))).toBe("Mercurius is confirming this transfer with the bank. It isn't counted as paid.");
    expect(earningsStateDetail(job({ state: "failed" }))).toBe("Not paid. Mercurius will review a retry.");
    expect(earningsStateDetail(job({ state: "returned" }))).toBe("Returned by your bank. Mercurius will contact you.");
  });

  it("says no amount exists before the payment is collected (item 4)", () => {
    expect(earningsStateDetail(job({ state: "waiting_payment", amounts: null }))).toMatch(/Amounts appear once it is collected/);
  });

  it("states the eligibility moment in Eastern Time during the 48-hour window", () => {
    // 19:30 UTC on Nov 2 is 2:30 PM in New York (EST).
    expect(earningsStateDetail(job({ state: "confirmation_window", eligible_at: "2026-11-02T19:30:00Z" })))
      .toBe("Becomes eligible Nov 2, 2026, 2:30 PM ET, 48 hours after the homeowner confirmed.");
  });

  it("names the transfer week for payouts on a transfer", () => {
    const transfer = { week_start: "2026-10-25", week_end: "2026-10-31", amount: 9500 };
    expect(earningsStateDetail(job({ state: "in_transfer", transfer }))).toBe("In the transfer for the week of Oct 25, 2026 – Oct 31, 2026. Not yet sent to your bank.");
    expect(earningsStateDetail(job({ state: "sent", transfer }))).toMatch(/counted as paid once the bank confirms it/);
    expect(earningsStateDetail(job({ state: "paid", transfer }))).toBe("Paid in the transfer for the week of Oct 25, 2026 – Oct 31, 2026.");
    expect(earningsStateDetail(job({ state: "paid", transfer: null }))).toBe("Paid.");
  });

  it("words every state and never says released", () => {
    for (const state of ALL_STATES) {
      expect(earningsStateLabel[state]).toBeTruthy();
      const detail = earningsStateDetail(job({ state, transfer: { week_start: "2026-10-25", week_end: "2026-10-31", amount: 9500 } }));
      expect(detail).toBeTruthy();
      expect(`${earningsStateLabel[state]} ${detail}`.toLowerCase()).not.toContain("released");
    }
  });

  it("never promises a payout weekday or date", () => {
    for (const state of ALL_STATES) {
      expect(earningsStateDetail(job({ state }))).not.toMatch(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|expected|will be paid on)\b/i);
    }
  });
});

describe("hold categories and transfer statuses", () => {
  it("names holds by category only (item 3)", () => {
    expect(Object.values(holdCategoryLabel)).toEqual([
      "Dispute", "Payment not complete or under review", "Refund in progress", "Payout onboarding", "Held by Mercurius",
    ]);
  });

  it("never labels an unknown, failed or returned transfer as paid", () => {
    for (const status of ["unknown", "failed", "returned", "submitted", "prepared", "withdrawn"] as const) {
      expect(transferStatusLabel[status]).not.toBe("Paid");
    }
    expect(transferStatusLabel.settled).toBe("Paid");
  });
});

describe("summarizeEarnings", () => {
  it("counts only bank-paid transfers as paid and groups the rest", () => {
    const summary = summarizeEarnings({
      paid: { count: 1, amount: 9500 },
      eligible: { count: 2, amount: 19000 },
      in_transfer: { count: 1, amount: 9500 },
      sent: { count: 1, amount: 9500 },
      unknown: { count: 1, amount: 9500 },
      held: { count: 3, amount: 28500 },
      awaiting_confirmation: { count: 1, amount: 9500 },
      confirmation_window: { count: 1, amount: 9500 },
      waiting_payment: { count: 2, amount: null },
      failed: { count: 1, amount: 9500 },
      returned: { count: 1, amount: 9500 },
    });
    expect(summary).toEqual({
      paid: 9500, eligible: 19000, onTheWay: 28500, held: 28500, heldCount: 3, notYetEligible: 19000, waitingPayment: 2, attention: 2,
    });
  });

  it("reads zero for a provider with no jobs", () => {
    expect(summarizeEarnings({})).toEqual({
      paid: 0, eligible: 0, onTheWay: 0, held: 0, heldCount: 0, notYetEligible: 0, waitingPayment: 0, attention: 0,
    });
  });
});

describe("formatting", () => {
  it("formats cents as dollars", () => {
    expect(formatCents(9500)).toBe("$95.00");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("formats a week from its date-only bounds in any viewer timezone", () => {
    expect(formatWeek("2026-10-25", "2026-10-31")).toBe("Oct 25, 2026 – Oct 31, 2026");
  });

  it("formats an Eastern moment and tolerates missing values", () => {
    expect(formatEasternDateTime("2026-07-01T16:05:00Z")).toBe("Jul 1, 2026, 12:05 PM ET");
    expect(formatEasternDateTime(null)).toBe("");
    expect(formatEasternDateTime("not a date")).toBe("");
  });
});
