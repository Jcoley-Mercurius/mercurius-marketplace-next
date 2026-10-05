import { describe, expect, it } from "vitest";
import { legacyReviewBlocker, legacyReviewOffered } from "@/lib/legacyProviderReview";

const ready = { listed: true, started: false, onboarding: false, contact: true, excluded: false, live_attempt: false, open_application: false };

describe("legacy provider review (DEC-2026-027)", () => {
  it("is offered only to a listed provider with no review yet", () => {
    expect(legacyReviewOffered(ready)).toBe(true);
    expect(legacyReviewOffered({ listed: false })).toBe(false);
    expect(legacyReviewOffered({ ...ready, started: true })).toBe(false);
    expect(legacyReviewOffered({ ...ready, onboarding: true })).toBe(false);
    expect(legacyReviewOffered(null)).toBe(false);
  });

  it("names the first blocker, in the server's order", () => {
    expect(legacyReviewBlocker(ready)).toBeNull();
    expect(legacyReviewBlocker({ ...ready, excluded: true, live_attempt: true })).toBe("This provider is excluded from public listing.");
    expect(legacyReviewBlocker({ ...ready, contact: false })).toBe("Record the provider's confirmed contact first.");
    expect(legacyReviewBlocker({ ...ready, live_attempt: true })).toBe("Close the live access invitation first.");
    expect(legacyReviewBlocker({ ...ready, open_application: true })).toMatch(/open application/);
  });
});
