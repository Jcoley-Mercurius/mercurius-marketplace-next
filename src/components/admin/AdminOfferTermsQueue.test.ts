import { describe, expect, it } from "vitest";
import { canRetryOfferTerms, itemText } from "./AdminOfferTermsQueue";

// Review of #154, finding 1: a decline whose next matching run failed is shown with the decline kept,
// and operations can retry it whether or not offers at other terms are active (as the server allows).
describe("offer terms follow-up queue", () => {
  const item = (kind: "unanswered" | "not_acceptable" | "blocked_inactive" | "rematch_failed") =>
    ({ kind, request_id: "00000000-0000-4000-8000-000000000001", since: "2026-11-09T12:00:00Z" });

  it("explains a failed re-match without implying the decline was lost", () => {
    expect(itemText(item("rematch_failed"))).toBe(
      "The homeowner declined the provider's terms and the decline is recorded, but finding the next provider failed. No provider is assigned. Retry matching.");
  });

  it("retries a failed re-match with the gate on or off; a gate block only once active", () => {
    expect(canRetryOfferTerms(item("rematch_failed"), false)).toBe(true);
    expect(canRetryOfferTerms(item("rematch_failed"), true)).toBe(true);
    expect(canRetryOfferTerms(item("blocked_inactive"), false)).toBe(false);
    expect(canRetryOfferTerms(item("blocked_inactive"), true)).toBe(true);
    expect(canRetryOfferTerms(item("unanswered"), true)).toBe(false);
    expect(canRetryOfferTerms(item("not_acceptable"), true)).toBe(false);
  });
});
