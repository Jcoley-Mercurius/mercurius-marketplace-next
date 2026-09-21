import { describe, expect, it } from "vitest";

import {
  allocationError,
  canReadBackRefund,
  canReissueRefund,
  canSendRefund,
  commandErrorMessage,
  parseCents,
  refundErrorMessage,
  reviewAction,
  type PendingRefund,
  type ReviewRequest,
} from "../../src/lib/financeCommands";

// TRACE-076/077: wording and gating only. The database decides authority, approvers and actionability.
const request = (overrides: Partial<ReviewRequest> = {}): ReviewRequest => ({
  request_id: "00000000-0000-4000-8000-000000000761",
  operation: "hold_resolution",
  subject: "00000000-0000-4000-8000-000000000762",
  obligation_id: "00000000-0000-4000-8000-000000000763",
  invoice_number: "M5-0000000763",
  reason: "Complaint closed",
  evidence: "Ticket 1 closed",
  details: null,
  requested_by_me: false,
  approved_by_me: false,
  recorded_by_me: false,
  state: "awaiting_approval",
  blocker: null,
  created_at: "2026-09-16T15:00:00.000Z",
  expires_at: "2026-09-17T15:00:00.000Z",
  executed_at: null,
  ...overrides,
});

const refund = (overrides: Partial<PendingRefund> = {}): PendingRefund => ({
  authorization_id: "00000000-0000-4000-8000-000000000764",
  obligation_id: "00000000-0000-4000-8000-000000000763",
  invoice_number: "M5-0000000763",
  payment_id: "pi_synthetic",
  amount: 2140,
  attempt_status: "not_started",
  provider_reference: null,
  can_send: true,
  generation: 1,
  reissue_blocker: null,
  last_readback: null,
  created_at: "2026-09-16T15:00:00.000Z",
  ...overrides,
});

describe("review actions", () => {
  it("offers approval only to a different operator who has not approved or recorded it", () => {
    expect(reviewAction(request()).kind).toBe("approve");
    expect(reviewAction(request({ requested_by_me: true })).kind).toBe("none");
    expect(reviewAction(request({ approved_by_me: true })).kind).toBe("none");
    expect(reviewAction(request({ operation: "reconciliation_resolution", evidence: null, recorded_by_me: true })).note).toContain("different operator");
  });

  it("offers execution only to the requester once approved", () => {
    expect(reviewAction(request({ requested_by_me: true, state: "approved" })).kind).toBe("execute");
    expect(reviewAction(request({ state: "approved" })).kind).toBe("approve");
    expect(reviewAction(request({ approved_by_me: true, state: "approved" })).kind).toBe("none");
  });

  it("explains stale and executed requests without an action", () => {
    expect(reviewAction(request({ requested_by_me: true, state: "stale", blocker: "readback_outdated" }))).toEqual({
      kind: "none",
      note: "Money moved since this readback. Record a new one.",
    });
    expect(reviewAction(request({ state: "executed" })).kind).toBe("none");
  });

  it("offers nothing on an expired request, even an approved one of mine", () => {
    for (const overrides of [{}, { requested_by_me: true, state: "expired" as const }]) {
      expect(reviewAction(request({ ...overrides, state: "expired" }))).toEqual({
        kind: "none",
        note: "Not run within 24 hours. Request it again if it still applies.",
      });
    }
  });
});

describe("refund actions", () => {
  it("sends only reviewed refunds not yet at Stripe, for their author or approver", () => {
    expect(canSendRefund(refund())).toBe(true);
    expect(canSendRefund(refund({ attempt_status: "prepared" }))).toBe(true);
    expect(canSendRefund(refund({ can_send: false }))).toBe(false);
    expect(canSendRefund(refund({ attempt_status: "pending" }))).toBe(false);
    expect(canSendRefund(refund({ attempt_status: "reconcile" }))).toBe(false);
  });

  it("reads back only refunds that were sent", () => {
    expect(canReadBackRefund(refund())).toBe(false);
    expect(canReadBackRefund(refund({ attempt_status: "reconcile" }))).toBe(true);
  });

  it("reissues only an uncertain refund the server allows, for its author or approver", () => {
    expect(canReissueRefund(refund({ attempt_status: "reconcile" }))).toBe(true);
    expect(canReissueRefund(refund({ attempt_status: "reconcile", reissue_blocker: "readback_too_early" }))).toBe(false);
    expect(canReissueRefund(refund({ attempt_status: "reconcile", can_send: false }))).toBe(false);
    expect(canReissueRefund(refund({ attempt_status: "prepared" }))).toBe(false);
  });
});

describe("chargeback allocation", () => {
  const retained = { service: 10000, tax: 700, tip: 1000 };
  it("accepts parts that add up to the loss within retained components", () => {
    expect(allocationError(1000, retained, { service: 800, tax: 100, tip: 100 })).toBeNull();
  });
  it("refuses a partial or excessive split", () => {
    expect(allocationError(1000, retained, { service: 900, tax: 0, tip: 0 })).toContain("add up");
    expect(allocationError(1001, retained, { service: 0, tax: 0, tip: 1001 })).toContain("more than");
  });
});

describe("parseCents", () => {
  it("reads dollars and cents as integer cents", () => {
    expect(parseCents("117")).toBe(11700);
    expect(parseCents("117.5")).toBe(11750);
    expect(parseCents("$1,170.05")).toBe(117005);
    expect(parseCents("0.07")).toBe(7);
    expect(parseCents(" 0 ")).toBe(0);
  });

  it("refuses anything that is not a plain non-negative amount", () => {
    for (const value of ["", "-1", "1.005", "1e3", "abc", "12.", ".5", "NaN"]) expect(parseCents(value)).toBeNull();
  });
});

describe("error wording", () => {
  it("maps gateway refusals and blockers to operator language", () => {
    expect(commandErrorMessage("A different finance operator must approve this command")).toContain("different finance operator");
    expect(commandErrorMessage("Finance review not actionable: event_has_effects")).toBe("The event already moved money in the ledger, so it cannot be excluded.");
    expect(commandErrorMessage("Hold idempotency conflict")).toContain("different details");
    expect(commandErrorMessage("Finance review request expired; request it again")).toContain("expired");
    expect(commandErrorMessage("Finance review not actionable: amount_changed")).toBe("The policy amount changed after this was requested. Request it again.");
    expect(commandErrorMessage("Refund reissue not allowed: readback_too_early")).toContain("24 hours");
    expect(commandErrorMessage("Refund reissue idempotency conflict")).toContain("different details");
    expect(commandErrorMessage("Payout hold already released")).toBe("This hold was already released.");
  });

  it("never shows unknown database text", () => {
    expect(commandErrorMessage('duplicate key value violates unique constraint "secret_detail"')).not.toContain("secret_detail");
  });

  it("maps refund gateway codes and defaults to reconciliation", () => {
    expect(refundErrorMessage("MONEY_NOT_ACTIVATED")).toContain("not activated");
    expect(refundErrorMessage(undefined)).toContain("do not create a second refund");
    expect(refundErrorMessage("SOMETHING_ELSE")).toContain("do not create a second refund");
  });
});
