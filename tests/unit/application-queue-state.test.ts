// TRACE-105: the applications queue shows onboarding state, not the legacy status column.
import { describe, expect, it } from "vitest";
import { applicationQueueState } from "@/lib/applicationQueueState";

const notStarted = { onboarding_status: null, review_started: false };
const started = (status: string) => ({ onboarding_status: status, review_started: true });

describe("applications queue state (TRACE-105)", () => {
  it("shows a new application as awaiting review", () => {
    expect(applicationQueueState("pending", notStarted)).toBe("awaiting_review");
  });

  it("follows onboarding while the legacy column still says pending", () => {
    expect(applicationQueueState("pending", started("review"))).toBe("in_review");
    expect(applicationQueueState("pending", started("active"))).toBe("active");
    expect(applicationQueueState("pending", started("suspended"))).toBe("suspended");
    expect(applicationQueueState("pending", started("rejected"))).toBe("rejected");
  });

  it("keeps closures, which still write the application status", () => {
    expect(applicationQueueState("rejected", notStarted)).toBe("rejected");
    expect(applicationQueueState("abandoned", started("review"))).toBe("abandoned");
  });

  it("labels a pre-Phase 5 approval as legacy, never as current approval", () => {
    expect(applicationQueueState("approved", notStarted)).toBe("legacy_approved");
    expect(applicationQueueState("approved", started("review"))).toBe("in_review");
  });

  it("never guesses while the readback is loading or failed", () => {
    expect(applicationQueueState("pending", undefined)).toBe("checking");
    expect(applicationQueueState("pending", null, true)).toBe("unavailable");
    expect(applicationQueueState("approved", null, true)).toBe("unavailable");
  });
});
