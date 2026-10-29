import { describe, expect, it } from "vitest";
import {
  fulfillmentTimeline, isStaleRefusal, payoutLine, queueItemCopy, waitingLine, type Fulfillment,
} from "@/lib/fulfillment";

// TRACE-128: the readback is described, never decided, here.

const base = (overrides: Partial<Fulfillment>): Fulfillment => ({
  role: "homeowner", status: "vendor_completed", plan: false, visit: true, started: null, completion: null,
  confirmation: null, dispute: null, dispute_window_ends_at: null, review_at: null, operations: [], payout: null, ...overrides,
});
const started = { at: "2026-11-03T14:00:00Z", by: "provider" as const, rework: false };
const completion = { at: "2026-11-03T16:00:00Z", attempt: 1, photos: 2, minimum: 2, by: "provider" as const, recorded: true };

describe("fulfillment timeline", () => {
  it("keeps provider completion and homeowner confirmation as separate steps with actor and time", () => {
    const steps = fulfillmentTimeline(base({ role: "vendor", status: "completed", started, completion,
      confirmation: { at: "2026-11-03T20:00:00Z", by: "homeowner" } }));
    expect(steps.map((step) => step.label)).toEqual(["Work started", "Completion submitted", "Homeowner confirmed the work"]);
    expect(steps[1].detail).toBe("You · Tue, Nov 3, 2026, 11:00 AM EST · 2 photos");
    expect(steps[2].detail).toBe("Homeowner · Tue, Nov 3, 2026, 3:00 PM EST");
  });

  it("names the viewer and operations from each role's point of view", () => {
    const data = { started: { ...started, by: "operations" as const, rework: true }, completion };
    expect(fulfillmentTimeline(base({ ...data, role: "homeowner" }))[0]).toMatchObject({ label: "Work restarted for rework", detail: expect.stringMatching(/^Mercurius · /) });
    expect(fulfillmentTimeline(base({ ...data, role: "admin" }))[0].detail).toMatch(/^Operations · /);
    expect(fulfillmentTimeline(base({ ...data, role: "homeowner" }))[1].detail).toMatch(/^Provider · /);
  });

  it("shows a resubmission and a completion without recorded photos", () => {
    expect(fulfillmentTimeline(base({ completion: { ...completion, attempt: 2 } }))[0].detail).toMatch(/2 photos · submission 2$/);
    expect(fulfillmentTimeline(base({ completion: { ...completion, attempt: null, photos: null, recorded: false } }))[0].detail).toMatch(/no recorded photos$/);
  });

  it("orders reported exceptions and disputes by time", () => {
    const steps = fulfillmentTimeline(base({ status: "disputed", started, completion,
      operations: [{ kind: "partial_completion", at: "2026-11-03T15:00:00Z", reason: "Half done", by: "provider" }],
      dispute: { at: "2026-11-03T18:00:00Z", status: "open", resolved_at: null } }));
    expect(steps.map((step) => step.label)).toEqual(["Work started", "Partly completed", "Completion submitted", "Issue reported"]);
  });
});

describe("waiting on the homeowner", () => {
  const waiting = base({ completion, dispute_window_ends_at: "2026-11-05T16:00:00Z", review_at: "2026-11-06T16:00:00Z" });
  it("gives the homeowner the dispute deadline and the review time, and says silence confirms nothing", () => {
    expect(waitingLine(waiting, Date.parse("2026-11-04T00:00:00Z"))).toBe(
      "Waiting for you to confirm the work or report an issue by Thu, Nov 5, 2026, 11:00 AM EST. If there's no answer, Mercurius reviews it from Fri, Nov 6, 2026, 11:00 AM EST; silence doesn't confirm it.");
  });
  it("points to support once the dispute window has closed", () => {
    expect(waitingLine(waiting, Date.parse("2026-11-05T16:00:00Z"))).toMatch(/confirm the work or contact support about an issue\./);
  });
  it("tells the provider completion alone neither confirms nor starts payout", () => {
    expect(waitingLine({ ...waiting, role: "vendor" }, 0)).toMatch(/completion alone doesn't confirm the work or start payout/);
  });
  it("says nothing when no completion is waiting", () => {
    expect(waitingLine(base({ status: "completed", completion }), 0)).toBeNull();
  });
});

describe("payout wording", () => {
  it("never implies payout before homeowner confirmation", () => {
    expect(payoutLine({ state: "awaiting_confirmation", eligible_at: null })).toMatch(/waits for the homeowner to confirm/);
  });
  it("gives the time eligibility opens", () => {
    expect(payoutLine({ state: "confirmation_window", eligible_at: "2026-11-05T20:00:00Z" }))
      .toBe("Payout eligibility begins Thu, Nov 5, 2026, 3:00 PM EST, if no dispute or hold applies.");
  });
  it("describes payment and hold blockers", () => {
    expect(payoutLine({ state: "payment_incomplete", eligible_at: null })).toMatch(/payment isn't complete/);
    expect(payoutLine({ state: "held", eligible_at: null })).toMatch(/held/);
    expect(payoutLine({ state: "unavailable", eligible_at: null })).toMatch(/couldn't be checked/);
    expect(payoutLine(null)).toBeNull();
  });
});

describe("operations queue copy", () => {
  it("has an action for each exception the MPS requires", () => {
    for (const detail of ["no_show", "unable_to_complete", "customer_unavailable", "partial_completion"] as const) {
      const copy = queueItemCopy({ kind: "fulfillment_exception", detail });
      expect(copy.title).not.toBe("Service exception");
      expect(copy.action.length).toBeGreaterThan(20);
    }
    expect(queueItemCopy({ kind: "confirmation_overdue", detail: null }).action).toMatch(/Silence doesn't confirm/);
    expect(queueItemCopy({ kind: "evidence_unverified", detail: null }).title).toBe("Completion without recorded evidence");
  });
});

describe("stale refusals", () => {
  it("recognizes the server's changed-since-loaded messages", () => {
    expect(isStaleRefusal("This service is no longer waiting to start (now in progress). Refresh to see its current state.")).toBe(true);
    expect(isStaleRefusal("The provider submitted new completion proof. Review it before you confirm.")).toBe(true);
    expect(isStaleRefusal("This item is no longer open. Refresh the queue.")).toBe(true);
    expect(isStaleRefusal("Only the homeowner can confirm completion")).toBe(false);
  });
});
