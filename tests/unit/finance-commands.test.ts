import { describe, expect, it } from "vitest";

import {
  achOutcomes,
  allocationError,
  batchDetails,
  canReadBackRefund,
  canRecordOutcome,
  canRequestRetry,
  canRequestWithdrawal,
  canReissueRefund,
  canSendRefund,
  canDismissLine,
  closeDetails,
  commandErrorMessage,
  lineResolution,
  matchCandidates,
  formatDay,
  lateSettlementDetails,
  moneyDetails,
  parseCents,
  recoveryDetails,
  recoveryError,
  refundErrorMessage,
  retryDetails,
  reviewAction,
  weekEnd,
  withdrawalDetails,
  type AchItem,
  type BankMovement,
  type StatementLine,
  type PendingRefund,
  type ReviewRequest,
} from "../../src/lib/financeCommands";

// TRACE-076/077/078/079/080/081: wording and gating only. The database decides authority, approvers and actionability.
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

// TRACE-078: weekly ACH wording and gating.
const achItem = (overrides: Partial<AchItem> = {}): AchItem => ({
  item_id: "00000000-0000-4000-8000-000000000781",
  obligation_id: "00000000-0000-4000-8000-000000000782",
  invoice_number: "M5-0000000782",
  payee_name: "Synthetic payee",
  amount: 9500,
  attempt_id: "00000000-0000-4000-8000-000000000783",
  attempt_number: 1,
  status: "prepared",
  bank_reference_hint: null,
  last_event: null,
  submit_blocker: null,
  retry_blocker: null,
  open_retry_request_id: null,
  withdraw_blocker: null,
  open_withdrawal_request_id: null,
  withdrawal: null,
  replaced_in: null,
  replaces_period: null,
  ...overrides,
});

describe("weekly ACH", () => {
  it("offers only the bank outcomes the kernel accepts next", () => {
    expect(achOutcomes("prepared")).toEqual(["submitted"]);
    expect(achOutcomes("submitted")).toEqual(["settled", "failed", "unknown"]);
    expect(achOutcomes("unknown")).toEqual(["settled", "failed", "unknown"]);
    expect(achOutcomes("settled")).toEqual(["returned"]);
    expect(achOutcomes("failed")).toEqual([]);
    expect(achOutcomes("returned")).toEqual([]);
    expect(achOutcomes("withdrawn")).toEqual([]);
  });

  it("records a submission only while the payout is still payable", () => {
    expect(canRecordOutcome(achItem())).toBe(true);
    expect(canRecordOutcome(achItem({ submit_blocker: "payout_hold" }))).toBe(false);
    expect(canRecordOutcome(achItem({ status: "unknown" }))).toBe(true);
    expect(canRecordOutcome(achItem({ status: "failed" }))).toBe(false);
    expect(canRecordOutcome(achItem({ status: "withdrawn" }))).toBe(false);
  });

  it("offers a retry only for a failed or returned transfer with nothing blocking it", () => {
    expect(canRequestRetry(achItem({ status: "failed" }))).toBe(true);
    expect(canRequestRetry(achItem({ status: "returned" }))).toBe(true);
    expect(canRequestRetry(achItem({ status: "unknown" }))).toBe(false);
    expect(canRequestRetry(achItem({ status: "failed", retry_blocker: "bank_authorization_changed" }))).toBe(false);
    expect(canRequestRetry(achItem({ status: "failed", open_retry_request_id: "00000000-0000-4000-8000-000000000784" }))).toBe(false);
    expect(canRequestRetry(achItem({ status: "withdrawn" }))).toBe(false);
  });

  it("offers a withdrawal only for a transfer the bank does not hold, with nothing blocking it", () => {
    expect(canRequestWithdrawal(achItem())).toBe(true);
    expect(canRequestWithdrawal(achItem({ status: "failed" }))).toBe(true);
    expect(canRequestWithdrawal(achItem({ status: "returned" }))).toBe(true);
    for (const status of ["submitted", "unknown", "settled", "withdrawn"] as const) {
      expect(canRequestWithdrawal(achItem({ status }))).toBe(false);
    }
    expect(canRequestWithdrawal(achItem({ withdraw_blocker: "status_changed" }))).toBe(false);
    expect(canRequestWithdrawal(achItem({ open_withdrawal_request_id: "00000000-0000-4000-8000-000000000785" }))).toBe(false);
  });

  it("offers a withdrawal where a changed bank authorization stops sending and retrying", () => {
    const blocked = achItem({ status: "failed", retry_blocker: "bank_authorization_changed" });
    expect(canRequestRetry(blocked)).toBe(false);
    expect(canRequestWithdrawal(blocked)).toBe(true);
    expect(canRecordOutcome(achItem({ submit_blocker: "statement_stale" }))).toBe(false);
    expect(canRequestWithdrawal(achItem({ submit_blocker: "statement_stale" }))).toBe(true);
  });

  it("counts a week as seven calendar days without time zone drift", () => {
    expect(weekEnd("2026-09-21")).toBe("2026-09-28");
    expect(weekEnd("2026-12-28")).toBe("2027-01-04");
    expect(formatDay("2026-09-21")).toBe("Sep 21, 2026");
  });

  it("reads batch and retry details only for their own operations", () => {
    const batch = request({ operation: "ach_preparation", details: { period_start: "2026-09-21", period_end: "2026-09-28", bank_ref: "BANK-1", total: 9500, items: [] } });
    expect(batchDetails(batch)?.bank_ref).toBe("BANK-1");
    expect(retryDetails(batch)).toBeNull();
    expect(moneyDetails(batch)).toBeNull();
    const refund = request({ operation: "refund_authorization", details: { payment_id: "pi_1", service: 100, tax: 0, tip: 0 } });
    expect(moneyDetails(refund)?.payment_id).toBe("pi_1");
    expect(batchDetails(refund)).toBeNull();
    expect(withdrawalDetails(refund)).toBeNull();
    const withdrawal = request({ operation: "ach_withdrawal", details: {
      item_id: "00000000-0000-4000-8000-000000000786", attempt_number: 2, status: "failed", current_status: "failed", amount: 9500,
      payee_name: "Synthetic payee", invoice_number: "M5-1", period_start: "2026-09-21", bank_reference_hint: "0111", bank_evidence: "R03",
    } });
    expect(withdrawalDetails(withdrawal)?.status).toBe("failed");
    expect(retryDetails(withdrawal)).toBeNull();
    expect(batchDetails(withdrawal)).toBeNull();
  });

  it("words ACH refusals for operators", () => {
    expect(commandErrorMessage("Bank outcome not recordable: bank_authorization_changed")).toContain("Withdraw the transfer with a second operator");
    expect(commandErrorMessage("Bank outcome not recordable: payout_hold")).toContain("payout hold is open");
    expect(commandErrorMessage("Finance review not actionable: period_taken")).toBe("An ACH batch already covers part of this week.");
    expect(commandErrorMessage("Finance review not actionable: bank_outcome_open")).toContain("never retried");
    expect(commandErrorMessage("Bank batch reference of up to 200 characters required")).toContain("bank's reference");
    expect(commandErrorMessage("Bank outcome idempotency conflict")).toContain("already submitted with different details");
    expect(commandErrorMessage("Bank outcome not recordable: something_new")).toContain("Refresh the page");
  });

  it("words withdrawal refusals for operators", () => {
    expect(commandErrorMessage("Bank outcome not recordable: withdrawn")).toContain("withdrawn from its statement");
    expect(commandErrorMessage("Finance review not actionable: withdrawn")).toContain("replacement");
    expect(commandErrorMessage("Finance review not actionable: status_changed")).toContain("bank status changed");
    expect(commandErrorMessage("Finance review not actionable: paid")).toContain("cannot be withdrawn");
    expect(commandErrorMessage("Finance review not actionable: on_ach_statement")).toContain("withdraw an unsent, failed or returned transfer");
    expect(commandErrorMessage("Payout already on an ACH statement; withdraw its transfer before a replacement")).toContain("withdraw");
  });

  it("reads late payment and recovery details only for their own operations", () => {
    const late = request({ operation: "ach_late_settlement", details: {
      item_id: "00000000-0000-4000-8000-000000000787", attempt_number: 1, amount: 9500, payee_name: "Synthetic payee", invoice_number: "M5-1",
      period_start: "2026-09-14", previous_status: "prepared", withdrawn_at: "2026-09-15T12:00:00.000Z", bank_reference_hint: "0777",
      replacement: { period_start: "2026-09-21", amount: 9500, status: "settled" },
    } });
    expect(lateSettlementDetails(late)?.replacement?.status).toBe("settled");
    expect(recoveryDetails(late)).toBeNull();
    expect(withdrawalDetails(late)).toBeNull();
    const recovery = request({ operation: "payout_recovery", details: { kind: "write_off", amount: 700, owed: 700, owed_now: 700, payee_name: "Synthetic payee" } });
    expect(recoveryDetails(recovery)?.kind).toBe("write_off");
    expect(lateSettlementDetails(recovery)).toBeNull();
    expect(moneyDetails(recovery)).toBeNull();
  });
});

describe("already-paid recovery", () => {
  it("allows a part recovery up to what is owed, never more or nothing", () => {
    expect(recoveryError(1700, 1000)).toBeNull();
    expect(recoveryError(1700, 1700)).toBeNull();
    expect(recoveryError(1700, 1701)).toBe("That is more than the provider owes on this payout.");
    expect(recoveryError(1700, 0)).toBe("Enter an amount greater than zero.");
    expect(recoveryError(1700, null)).toBe("Enter an amount greater than zero.");
  });

  it("words recovery and late payment refusals for operators", () => {
    expect(commandErrorMessage("Finance review not actionable: owed_changed")).toContain("changed after this was requested");
    expect(commandErrorMessage("Finance review not actionable: exceeds_owed")).toBe("That is more than the provider owes on this payout.");
    expect(commandErrorMessage("Finance review not actionable: nothing_owed")).toBe("The provider owes nothing on this payout.");
    expect(commandErrorMessage("Finance review not actionable: not_withdrawn")).toContain("withdrawn from its statement");
    expect(commandErrorMessage("Bank outcome not recordable: already_paid")).toContain("Do not send it");
    expect(commandErrorMessage("Finance review not actionable: already_paid")).toContain("already paid this payout");
    expect(commandErrorMessage("Recovery must be a repayment or a write-off")).toBe("Choose a repayment or a write-off.");
    expect(commandErrorMessage("Recovery amount in cents required")).toBe("Enter an amount greater than zero.");
    expect(commandErrorMessage("Payout recovery idempotency conflict")).toContain("already submitted with different details");
  });
});

describe("bank statement reconciliation", () => {
  const line = (overrides: Partial<StatementLine> = {}): StatementLine => ({
    line_id: "l1", line_number: 1, posted_on: "2026-09-15", direction: "debit", amount: 9500, bank_reference_hint: "0001",
    state: "unmatched", match: null, suggestion: { action: "no_transfer" }, dismissal: null, ...overrides,
  });
  const movement = (overrides: Partial<BankMovement> = {}): BankMovement => ({
    movement: "settled:00000000-0000-4000-8000-000000000001", kind: "settled", direction: "debit", amount: 9500, bank_reference_hint: "9999",
    obligation_id: "o1", invoice_number: "M5-1", payee_name: "Synthetic payee", attempt_number: 1, recorded_at: "2026-09-15T12:00:00Z", ...overrides,
  });

  it("offers only the resolutions that record through an existing command", () => {
    expect(lineResolution(line({ suggestion: { action: "record_settled", attempt_id: "a" } }))).toBe("record_settled");
    expect(lineResolution(line({ suggestion: { action: "record_returned", attempt_id: "a" } }))).toBe("record_returned");
    expect(lineResolution(line({ suggestion: { action: "request_late_settlement", attempt_id: "a" } }))).toBe("request_late_settlement");
    for (const action of ["amount_mismatch", "outcome_conflict", "already_evidenced", "no_transfer", "match_repayment"] as const) {
      expect(lineResolution(line({ suggestion: { action } }))).toBeNull();
    }
    expect(lineResolution(line({ state: "matched", suggestion: { action: "record_settled" } }))).toBeNull();
  });

  it("matches by hand only a movement of the same direction and amount", () => {
    const movements = [movement(), movement({ movement: "repayment:x", kind: "repayment", direction: "credit", amount: 500 }), movement({ movement: "settled:y", amount: 9400 })];
    expect(matchCandidates(line(), movements).map((item) => item.movement)).toEqual(["settled:00000000-0000-4000-8000-000000000001"]);
    expect(matchCandidates(line({ direction: "credit", amount: 500 }), movements).map((item) => item.kind)).toEqual(["repayment"]);
    expect(matchCandidates(line({ state: "matched" }), movements)).toEqual([]);
  });

  it("never offers to dismiss a line whose reference names a transfer", () => {
    expect(canDismissLine(line())).toBe(true);
    expect(canDismissLine(line({ direction: "credit", suggestion: { action: "match_repayment" } }))).toBe(true);
    for (const action of ["record_settled", "record_returned", "request_late_settlement", "amount_mismatch", "outcome_conflict", "already_evidenced"] as const) {
      expect(canDismissLine(line({ suggestion: { action } }))).toBe(false);
    }
    expect(canDismissLine(line({ state: "dismissed" }))).toBe(false);
  });

  it("reads close details only from a close request", () => {
    const close = request({ operation: "bank_statement_close", details: { period_start: "2026-09-01", period_end: "2026-09-30", lines: 3, debits: 19000, credits: 500, exceptions_now: 0 } });
    expect(closeDetails(close)?.lines).toBe(3);
    expect(moneyDetails(close)).toBeNull();
    expect(recoveryDetails(close)).toBeNull();
    expect(closeDetails(request({ operation: "payout_recovery" }))).toBeNull();
  });

  it("words statement refusals for operators without echoing database text", () => {
    expect(commandErrorMessage("Finance review not actionable: period_open")).toContain("has not ended");
    expect(commandErrorMessage("Finance review not actionable: statement_changed")).toContain("Request the close again");
    expect(commandErrorMessage("Finance review not actionable: statement_exceptions")).toContain("Resolve them first");
    expect(commandErrorMessage("Statement line not matchable: movement_matched")).toBe("Another statement line already shows that movement.");
    expect(commandErrorMessage("Statement line not dismissable: line_names_transfer")).toContain("cannot be dismissed");
    expect(commandErrorMessage("Statement line not resolvable: suggestion_changed")).toContain("Refresh and check it again");
    expect(commandErrorMessage("Statement line 3 is already imported")).toBe("Line 3 is already on a bank statement. Leave it out and import the rest.");
    expect(commandErrorMessage("Statement line 2 is posted outside the statement period")).toBe("Line 2 is dated outside the statement period.");
    expect(commandErrorMessage("Statement line 4 needs an amount in whole cents greater than zero")).toBe("Line 4 needs an amount greater than zero.");
    expect(commandErrorMessage("Statement line 5 needs a bank reference of up to 200 characters")).toContain("bank's reference");
    expect(commandErrorMessage("Statement line 6 needs a posting date, direction, amount and reference only")).toBe("Line 6 needs a date, debit or credit, amount and reference.");
    expect(commandErrorMessage("Another statement already covers part of this period")).toContain("does not overlap");
    expect(commandErrorMessage("Bank statement is closed")).toContain("closed");
    expect(commandErrorMessage("Statement import idempotency conflict")).toContain("already submitted with different details");
    expect(commandErrorMessage("Statement line not matchable: something_new")).toContain("Refresh the page");
  });
});
