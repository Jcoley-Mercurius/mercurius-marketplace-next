import { describe, expect, it } from "vitest";
import { authorizationText, describeAssessment, entitlementText, isStale, movementText, type CancellationOutcome } from "@/lib/cancellation";

const outcome = (over: Partial<CancellationOutcome>): CancellationOutcome => ({ job_id: "j", status: "cancelled", cancelled: true,
  entitlement: { state: "refund_due", refund_percent: 100, basis: "notice_72_hours_or_more", amount: 11700, captured: 11700 },
  authorization: { state: "none", amount: 0 }, movement: { state: "none" }, follow_up: [], ...over });

describe("TRACE-131 cancellation wording", () => {
  it("describes each CFG-006 basis without claiming money moves", () => {
    for (const [percent, basis, phrase] of [[100, "notice_72_hours_or_more", "72 or more hours"], [50, "notice_24_to_72_hours", "24 to 72 hours"],
      [0, "notice_under_24_hours", "less than 24 hours"], [100, "no_appointment", "no appointment time"],
      [100, "provider_withdrawal_open", "provider withdrew"], [100, "exception_accepted", "weather or emergency"]] as const) {
      const text = describeAssessment("customer_cancel", { refund_percent: percent, basis });
      expect(text).toContain(`${percent}%`);
      expect(text).toContain(phrase);
      expect(text).toContain("doesn't send money");
    }
  });

  it("names the reschedule fee only as the policy, never as charged", () => {
    expect(describeAssessment("reschedule_request", { fee: 0 })).toContain("No rescheduling fee");
    expect(describeAssessment("reschedule_request", { fee: 25 })).toContain("isn't charged by this request");
    expect(describeAssessment("reschedule_request", { fee: null })).toContain("case by case");
  });

  it("says a plan visit is not offered to another provider", () => {
    expect(describeAssessment("provider_cancel", { replacement_providers: false })).toContain("isn't offered to another provider");
    expect(describeAssessment("provider_cancel", { replacement_providers: true })).toContain("acceptable replacement first");
  });

  it("keeps entitlement, approval and movement apart", () => {
    const due = outcome({});
    expect(entitlementText(due)).toBe("Owed under the policy: 100% ($117.00).");
    expect(authorizationText(due)).toBe("Refund not yet approved.");
    expect(movementText(due)).toBe("No money has been returned yet.");
    expect(movementText(outcome({ authorization: { state: "authorized", amount: 11700 }, movement: { state: "not_sent" } }))).toBe("Refund approved but not sent yet.");
    expect(movementText(outcome({ movement: { state: "in_flight" } }))).toContain("waiting for the payment provider");
    expect(movementText(outcome({ movement: { state: "failed" } }))).toContain("failed");
    expect(movementText(outcome({ movement: { state: "unknown" } }))).toContain("isn't known");
  });

  it("says refunded only for a settlement the payment provider confirmed", () => {
    const states = ["none", "not_sent", "in_flight", "failed", "unknown", "partly_settled"];
    for (const state of states) expect(movementText(outcome({ movement: { state } }))).not.toMatch(/^Refunded/);
    expect(movementText(outcome({ movement: { state: "settled", settled: 11700 } }))).toBe("Refunded: $117.00. The payment provider confirmed it.");
    for (const state of ["no_payment", "no_refund_under_policy", "payment_outcome_pending", "awaiting_replacement_decision", "awaiting_operations"]) {
      expect(entitlementText(outcome({ entitlement: { state, refund_percent: 0, basis: null } }))).not.toMatch(/refunded/i);
    }
  });

  it("recognizes a stale refusal", () => {
    expect(isStale({ code: "40001" })).toBe(true);
    expect(isStale({ code: "22023" })).toBe(false);
    expect(isStale(new Error("x"))).toBe(false);
  });
});
