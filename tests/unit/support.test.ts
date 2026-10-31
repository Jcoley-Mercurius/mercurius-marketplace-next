import { describe, expect, it } from "vitest";
import {
  describeSupportError, payoutText, refundText, responseDueText, ticketFollowsDecision, ticketKindLabel,
} from "@/lib/support";

// TRACE-133: support and dispute reads are described, never decided, here.

describe("money facts stay separate", () => {
  it("never calls a decision or an authorization a refund sent", () => {
    expect(refundText({ payment_record: true, authorization: "none", movement: "none" })).toBe("No refund has been authorized.");
    expect(refundText({ payment_record: true, authorization: "authorized", authorized: 5000, movement: "none" })).toMatch(/no money has moved/);
    expect(refundText({ payment_record: true, authorization: "authorized", movement: "in_flight" })).toMatch(/on its way/);
    expect(refundText({ payment_record: true, authorization: "authorized", movement: "settled" })).toMatch(/has been sent/);
    expect(refundText({ payment_record: false, authorization: "none", movement: "none" })).toMatch(/No payment on record/);
    expect(refundText(null)).toBeNull();
  });

  it("names a dispute hold and falls back to a generic hold", () => {
    expect(payoutText({ state: "dispute_hold" })).toMatch(/held while this dispute or its appeal is open/);
    expect(payoutText({ state: "confirmation_window" })).toMatch(/48 hours after confirmation/);
    expect(payoutText({ state: "reconciliation_hold" })).toBe("Payout is on hold.");
    expect(payoutText(null)).toBeNull();
  });
});

describe("tickets that follow another decision", () => {
  it("locks dispute and dispute-appeal tickets to the dispute decision", () => {
    expect(ticketFollowsDecision({ kind: "dispute", decision_recorded: null })).toMatch(/dispute decision/);
    expect(ticketFollowsDecision({ kind: "dispute_appeal", decision_recorded: null })).toMatch(/dispute decision/);
  });
  it("locks a review appeal only until its decision is recorded", () => {
    expect(ticketFollowsDecision({ kind: "review_appeal", decision_recorded: false })).toMatch(/review appeal first/);
    expect(ticketFollowsDecision({ kind: "review_appeal", decision_recorded: true })).toBeNull();
    expect(ticketFollowsDecision({ kind: "general", decision_recorded: null })).toBeNull();
  });
  it("labels unknown kinds as a support request", () => {
    expect(ticketKindLabel("plan_stop_request")).toBe("Plan stop request");
    expect(ticketKindLabel("something_new")).toBe("Support request");
  });
});

describe("response expectations", () => {
  it("shows a due time only while open, and never a 24-hour promise", () => {
    const due = "2026-11-03T21:00:00Z";
    expect(responseDueText({ status: "open", response_due_at: due, priority: "standard" })).toMatch(/^Response expected by/);
    expect(responseDueText({ status: "in-progress", response_due_at: due, priority: "same_day" })).toMatch(/^Same-day priority/);
    expect(responseDueText({ status: "resolved", response_due_at: due, priority: "standard" })).toBeNull();
    expect(responseDueText({ status: "open", response_due_at: null, priority: "standard" })).toBeNull();
    expect(responseDueText({ status: "open", response_due_at: due, priority: "standard" })).not.toMatch(/24/);
  });
});

describe("refusals", () => {
  it("maps stale, permission and validation refusals and hides unknown errors", () => {
    expect(describeSupportError({ code: "40001", message: "x" })).toMatch(/Reload/);
    expect(describeSupportError({ code: "42501", message: "internal detail" })).not.toMatch(/internal detail/);
    expect(describeSupportError({ code: "22023", message: "Add a subject of up to 160 characters" })).toBe("Add a subject of up to 160 characters");
    expect(describeSupportError(new Error("socket hang up"))).toMatch(/didn't go through/);
  });
});
