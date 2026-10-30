import { describe, expect, it } from "vitest";
import {
  commentError, eligibilityLine, historyDetail, historyLabel, reviewErrorMessage, reviewStateLine, summariesById, summaryLine,
  type ReviewHistoryEntry,
} from "@/lib/reviews/serviceReview";

// TRACE-130: the review readbacks are described, never decided, here.

const entry = (overrides: Partial<ReviewHistoryEntry>): ReviewHistoryEntry => ({
  action: "rejected", at: "2026-11-03T15:00:00Z", from_state: "published", to_state: "rejected",
  criterion: null, criterion_label: null, reason: "Synthetic", ...overrides,
});

describe("public summaries", () => {
  it("reads one average and count for every surface", () => {
    expect(summaryLine({ count: 3, average: 3.33 })).toBe("3.3 (3 public reviews)");
    expect(summaryLine({ count: 1, average: 5 })).toBe("5.0 (1 public review)");
    expect(summaryLine({ count: 0, average: null })).toBe("No public reviews yet");
  });

  it("treats a provider missing from the summaries as having no public reviews", () => {
    const map = summariesById([{ contractor_id: "a", review_count: 2, average_rating: 4.5 }]);
    expect(map.get("a")).toEqual({ count: 2, average: 4.5 });
    expect(map.get("b")).toBeUndefined();
    expect(summariesById(null).size).toBe(0);
  });
});

describe("eligibility and states", () => {
  it("explains every refusal and stays silent when the homeowner can review", () => {
    expect(eligibilityLine("eligible")).toBeNull();
    expect(eligibilityLine("submitted")).toBeNull();
    expect(eligibilityLine("plan")).toBe("Reviews are left on each completed visit, not on the recurring plan.");
    expect(eligibilityLine("issue_open")).toMatch(/once the issue you reported is resolved/);
    expect(eligibilityLine("not_confirmed")).toMatch(/after you confirm the work is done/);
  });

  it("names the moderation criterion and the next step, never the rating", () => {
    expect(reviewStateLine({ state: "rejected", criterion_label: "Personal information" }))
      .toBe("Your review isn't public (personal information). You can correct it or appeal the decision.");
    expect(reviewStateLine({ state: "appealed", criterion_label: "Spam" })).toMatch(/reviewing your appeal/);
    expect(reviewStateLine({ state: "private", criterion_label: null })).toMatch(/isn't shown publicly/);
  });

  it("labels appeal outcomes separately from first decisions", () => {
    expect(historyLabel(entry({ action: "published", from_state: "appealed" }))).toBe("Appeal upheld — review public");
    expect(historyLabel(entry({ action: "rejected", from_state: "appealed" }))).toBe("Appeal not upheld");
    expect(historyLabel(entry({ action: "rejected" }))).toBe("Review not published");
    expect(historyDetail(entry({ by: "mercurius", criterion_label: "Spam" }))).toBe("Mercurius · Tue, Nov 3, 2026, 10:00 AM EST · Spam");
    expect(historyDetail(entry({ actor_name: "Synthetic operator" }))).toBe("Synthetic operator · Tue, Nov 3, 2026, 10:00 AM EST");
  });
});

describe("input and refusals", () => {
  it("limits the comment as the server does", () => {
    expect(commentError("x".repeat(2000))).toBeNull();
    expect(commentError(`  ${"x".repeat(2000)}  `)).toBeNull();
    expect(commentError("x".repeat(2001))).toBe("Keep the review to 2,000 characters.");
  });

  it("words stale and permission refusals for the person who can act", () => {
    expect(reviewErrorMessage({ code: "40001", message: "Another moderation decision was recorded. Refresh to see it." }, "x"))
      .toBe("Another moderation decision was recorded. Refresh to see it.");
    expect(reviewErrorMessage({ code: "42501", message: "Only the review author can edit it" }, "x")).toBe("You don't have permission to change this review.");
    expect(reviewErrorMessage(null, "Fallback")).toBe("Fallback");
  });
});
