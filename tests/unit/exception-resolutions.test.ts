import { describe, expect, it } from "vitest";
import { adjustmentText, planStopLine, planStopVisitLine, proposalAnswerLine, remainingText, replacementLine, requestFeeLine, type PlanStopPreview, type ReplacementState } from "@/lib/exceptionResolutions";
import { appointmentState, historyLine, type ScheduleEntry } from "@/lib/appointments";
import { describeAssessment, movementText, type CancellationOutcome } from "@/lib/cancellation";
import { providerStatus, vendorOfferOutcome } from "@/lib/offerStatus";
import { serviceRequestStatusLabel } from "@/lib/serviceRequestStatus";

const start = "2026-11-10T14:00:00.000Z";
const later = "2026-11-12T19:30:00.000Z";

describe("TRACE-132 reschedule initiator and answers (E3)", () => {
  it("never charges the homeowner for a provider's request and never calls a fee charged", () => {
    expect(requestFeeLine({ initiator: "provider", fee: 0 })).toContain("no rescheduling fee applies to you");
    expect(requestFeeLine({ initiator: "homeowner", fee: 25 })).toContain("assessed but not charged");
    expect(requestFeeLine({ initiator: "homeowner", fee: 25, fee_waived_later: true })).toContain("no longer applies");
    expect(requestFeeLine({ initiator: "homeowner", fee: null })).toContain("case by case");
    for (const fee of [0, 25, null]) expect(requestFeeLine({ initiator: "homeowner", fee })).not.toMatch(/was charged|has been charged|you paid/i);
  });

  it("keeps a proposed time from reading as an appointment until it is accepted and recorded", () => {
    const open = { requires_homeowner_acceptance: true, requested_start: later, answer: null };
    expect(proposalAnswerLine(open, "homeowner")).toContain("current appointment stays");
    expect(proposalAnswerLine(open, "admin")).toContain("can't move to it until they accept");
    expect(proposalAnswerLine({ ...open, answer: { accepted: true, at: start, reason: null } }, "admin")).toContain("Use requested time");
    expect(proposalAnswerLine({ ...open, answer: { accepted: true, at: start, reason: null } }, "homeowner")).toContain("changes when Mercurius records it");
    expect(proposalAnswerLine({ ...open, answer: { accepted: false, at: start, reason: null } }, "admin")).toContain("CFG-007");
    expect(proposalAnswerLine({ requires_homeowner_acceptance: false, requested_start: later, answer: null }, "admin")).toBeNull();
  });

  it("describes a provider's request in the preview without a homeowner fee", () => {
    expect(describeAssessment("reschedule_request", { initiator: "provider", fee: 0 })).toContain("no rescheduling fee applies to the homeowner");
    expect(describeAssessment("reschedule_request", { initiator: "homeowner", fee: 25 })).toContain("isn't charged by this request");
  });

  it("names answers and proposals in the history", () => {
    const base: ScheduleEntry = { id: "1", kind: "reschedule_response", outcome: "accepted", actor: "homeowner", at: start, reason: "",
      previous_start: start, new_start: null, requested_start: later, operation_key: null };
    expect(historyLine(base)).toMatch(/^Accepted the provider’s proposed time/);
    expect(historyLine({ ...base, outcome: "declined" })).toMatch(/^Declined/);
    expect(historyLine({ ...base, kind: "replacement_proposal", outcome: "proposed", new_start: later, provider_name: "B" })).toMatch(/^Replacement proposed: B on/);
    expect(historyLine({ ...base, kind: "reschedule_request", outcome: "requested", initiator: "provider" })).toContain("by the provider");
  });
});

describe("TRACE-132 replacement consent (E5)", () => {
  const replacement = (over: Partial<ReplacementState>): ReplacementState => ({ state: "searching", withdrawn_at: start, original_start: later,
    search_deadline: start, search_closed: false, inside_search_deadline: false, proposal: null, expected: null, admin_expected: null, ...over });

  it("never presents a replacement or the earlier time as scheduled before the homeowner accepts", () => {
    expect(replacementLine(replacement({}), "homeowner")!.detail).toContain("nothing is scheduled until you do");
    const proposal = { id: "p", contractor_id: "c", provider_name: "Provider B", starts_at: later, created_at: start, reason: "r", after_search_deadline: false, answer: null };
    const awaiting = replacementLine(replacement({ state: "awaiting_homeowner", proposal }), "homeowner")!;
    expect(awaiting.heading).toBe("Accept your replacement provider?");
    expect(awaiting.detail).toContain("Provider B");
    expect(awaiting.detail).toContain("both the provider and the time");
    expect(replacementLine(replacement({ state: "search_ended", inside_search_deadline: true }), "homeowner")!.detail).toContain("full refund");
    expect(replacementLine(replacement({ state: "closed" }), "homeowner")).toBeNull();
    expect(replacementLine(null, "homeowner")).toBeNull();
  });

  it("holds the earlier time instead of inheriting it", () => {
    const state = appointmentState({ status: "matched", matching_status: "awaiting_homeowner", has_provider: true, appointment: later, open_request: null, history: [] });
    expect(state.kind).toBe("replacement_pending");
    expect(state.detail).toContain("isn't carried over");
    expect(providerStatus({ status: "matched", matching_status: "awaiting_homeowner", contractor_id: "c" }).assigned).toBe(false);
    expect(serviceRequestStatusLabel("matched", "awaiting_homeowner")).toBe("Replacement needs your answer");
  });

  it("tells the replacement provider it is waiting for the homeowner, not scheduled", () => {
    const outcome = vendorOfferOutcome({ status: "matched", matching_status: "awaiting_homeowner", contractor_id: "c", scheduled_start_at: later }, "c", false);
    expect(outcome).toEqual({ kind: "accepted", quote: false, appointment: null, awaitingHomeowner: true });
  });

  it("explains the 24-hour window for a withdrawal close to the appointment", () => {
    expect(describeAssessment("provider_cancel", { replacement_providers: true, inside_search_deadline: true })).toContain("within 24 hours");
    expect(describeAssessment("provider_cancel", { replacement_providers: false })).toContain("recommit");
  });
});

describe("TRACE-132 plan stop requests (E8)", () => {
  const preview = (over: Partial<PlanStopPreview>): PlanStopPreview => ({ series_id: "s", plan_state: "active", expected_state: "active", accepted: true,
    request: { id: "q", at: start, reason: "Moving", state: "open", closed_at: null, resolution: null }, visits: [], ...over });

  it("never presents a stop request as a cancellation", () => {
    const line = planStopLine(preview({}), "homeowner")!;
    expect(line).toContain("Nothing has been cancelled");
    expect(line).not.toMatch(/(plan|visits?) (was|were|is|are) cancelled/i);
    expect(planStopLine(preview({ plan_state: "ended", request: { id: "q", at: start, reason: "Moving", state: "stopped", closed_at: null, resolution: null } }), "homeowner"))
      .toContain("Visits already in place stay");
    expect(planStopLine(preview({ request: null }), "homeowner")).toBeNull();
  });

  it("shows each visit in place with what cancelling it would assess", () => {
    expect(planStopVisitLine({ id: "v", status: "scheduled", matching_status: "matched", scheduled_start_at: later, provider_name: "A", offer_open: false,
      cancellation: { allowed: true, refund_percent: 50, basis: "notice_24_to_72_hours" }, payment: null })).toContain("stays in place; cancelling it now would refund 50%");
    expect(planStopVisitLine({ id: "v", status: "matched", matching_status: "offered", scheduled_start_at: null, provider_name: "A", offer_open: true,
      cancellation: { allowed: false, message: "Work has started" }, payment: null })).toContain("offer open to the provider");
  });
});

describe("TRACE-132 later waivers (E11)", () => {
  const outcome = (over: Partial<CancellationOutcome>): CancellationOutcome => ({ job_id: "j", status: "cancelled", cancelled: true,
    entitlement: { state: "refund_due", refund_percent: 100, basis: "exception_accepted_later", amount: 11700, captured: 11700 },
    authorization: { state: "partly_authorized", amount: 5850 }, movement: { state: "partly_settled", settled: 5850 },
    adjustment: { id: "a", kind: "waiver", at: start, reason: "Storm", original_percent: 50, original_basis: "notice_24_to_72_hours", operation_id: "o", original_amount: 5850 },
    remaining: { state: "supplemental_review", amount: 5850 }, follow_up: [], ...over });

  it("keeps the original assessment beside the revised entitlement", () => {
    expect(adjustmentText(outcome({}))).toBe("Originally assessed at 50% ($58.50). Mercurius later accepted an exception, so 100% is owed.");
    expect(adjustmentText(outcome({ adjustment: null }))).toBe("");
  });

  it("says the remainder is owed and not sent, and needs its own review", () => {
    expect(remainingText(outcome({}), "homeowner")).toBe("$58.50 more is owed to you after the exception. Mercurius reviews it separately before it's sent; it hasn't been sent yet.");
    expect(remainingText(outcome({}), "admin")).toContain("own reviewed refund authorization");
    expect(remainingText(outcome({ remaining: { state: "none", amount: 0 } }), "homeowner")).toBe("");
    expect(movementText(outcome({}))).not.toMatch(/^Refunded/);
  });
});
