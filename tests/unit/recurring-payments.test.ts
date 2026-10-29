import { describe, expect, it } from "vitest";
import { recurringQueueLabel, visitCheckoutHref, visitPaymentLine, type VisitPayment } from "@/lib/recurringVisits";
import { queueKindLabel } from "@/lib/quoteProposals";

// TRACE-125: each visit's payment comes from its canonical obligation, snapshot and checkout state
// (recurring_series payment_state); the homeowner's action is a link into the existing reviewed
// checkout, offered only for a payable or open checkout; the provider sees no payment.

const payment = (overrides: Partial<VisitPayment>): VisitPayment => ({
  state: "ready", reason: null, action: "pay", snapshot_id: "11111111-1111-4111-8111-111111111111", amount_cents: 4500,
  accepted_at: "2030-11-01T14:00:00Z", attempt_status: null, ...overrides,
});

describe("visit payment line", () => {
  it("shows nothing to the provider in any state", () => {
    for (const state of ["review_pending", "ready", "processing", "paid", "failed", "unknown"] as const) {
      expect(visitPaymentLine(payment({ state }), "vendor")).toBeNull();
    }
    expect(visitPaymentLine(null, "homeowner")).toBeNull();
  });
  it("shows nothing before the visit's own acceptance or once cancelled", () => {
    expect(visitPaymentLine(payment({ state: "not_accepted", action: null, snapshot_id: null }), "homeowner")).toBeNull();
    expect(visitPaymentLine(payment({ state: "cancelled", action: null }), "admin")).toBeNull();
  });
  it("tells the homeowner payment opens after review, without operations detail", () => {
    const line = visitPaymentLine(payment({ state: "review_pending", reason: "source_blocked", action: null, snapshot_id: null }), "homeowner");
    expect(line).toBe("Payment opens after Mercurius reviews this visit’s price · $45.00");
  });
  it("distinguishes an expired review for operations", () => {
    expect(visitPaymentLine(payment({ state: "review_pending", reason: "snapshot_expired", action: null }), "admin")).toMatch(/expired/);
    expect(visitPaymentLine(payment({ state: "review_pending", reason: "no_snapshot", action: null }), "admin")).toBe("Waiting for commercial review · $45.00");
  });
  it("never reads an open checkout or an unknown outcome as paid", () => {
    expect(visitPaymentLine(payment({ state: "processing", action: "continue" }), "homeowner")).toBe("Payment in progress · $45.00");
    expect(visitPaymentLine(payment({ state: "unknown", action: null }), "homeowner")).toBe("Mercurius is confirming this payment. Don’t pay again.");
    expect(visitPaymentLine(payment({ state: "unknown", action: null }), "admin")).toMatch(/unknown/);
    expect(visitPaymentLine(payment({ state: "paid", action: null }), "homeowner")).toBe("Paid · $45.00");
  });
  it("says a confirmed failure can be retried", () => {
    expect(visitPaymentLine(payment({ state: "failed" }), "homeowner")).toMatch(/didn’t go through/);
  });
});

describe("homeowner checkout link", () => {
  it("links into the existing reviewed checkout for the current snapshot", () => {
    expect(visitCheckoutHref(payment({}))).toBe("/checkout/11111111-1111-4111-8111-111111111111?mode=full");
    expect(visitCheckoutHref(payment({ state: "processing", action: "continue" }))).toBe("/checkout/11111111-1111-4111-8111-111111111111?mode=full");
  });
  it("offers no link for an unpublished, unpaid-but-blocked, unknown or paid visit", () => {
    expect(visitCheckoutHref(payment({ state: "review_pending", action: null, snapshot_id: null }))).toBeNull();
    expect(visitCheckoutHref(payment({ state: "unknown", action: null }))).toBeNull();
    expect(visitCheckoutHref(payment({ state: "paid", action: null }))).toBeNull();
    expect(visitCheckoutHref(null)).toBeNull();
  });
});

describe("recurring payment queue labels", () => {
  it("keeps a distinct operator reason for expired, held and blocked reviews", () => {
    const titles = (["no_snapshot", "snapshot_expired", "held", "source_blocked"] as const)
      .map(reason => recurringQueueLabel({ kind: "review_missing", reason, detail: {} }).title);
    expect(titles).toEqual(["Visit needs commercial review", "Visit price review expired", "Visit payment held", "Visit terms blocked"]);
    expect(visitPaymentLine(payment({ state: "review_pending", reason: "held", action: null }), "admin")).toMatch(/held/);
    expect(visitPaymentLine(payment({ state: "review_pending", reason: "source_blocked", action: null }), "admin")).toMatch(/Terms blocked/);
  });
  it("names the two visit states", () => {
    expect(recurringQueueLabel({ kind: "review_missing", detail: { reason: "no_snapshot" } }).title).toBe("Visit needs commercial review");
    expect(recurringQueueLabel({ kind: "review_missing", detail: { reason: "snapshot_expired" } }).title).toBe("Visit price review expired");
    expect(recurringQueueLabel({ kind: "ready_unpaid", detail: { state: "ready" } }).title).toBe("Visit ready but unpaid");
    expect(recurringQueueLabel({ kind: "ready_unpaid", detail: { state: "ready" } }).action).toMatch(/nothing is charged or cancelled automatically/);
  });
  it("keeps the shared wording for failures and unknown outcomes", () => {
    expect(recurringQueueLabel({ kind: "payment_failed", detail: {} })).toEqual(queueKindLabel.payment_failed);
    expect(recurringQueueLabel({ kind: "payment_unresolved", detail: {} })).toEqual(queueKindLabel.payment_unresolved);
  });
});
