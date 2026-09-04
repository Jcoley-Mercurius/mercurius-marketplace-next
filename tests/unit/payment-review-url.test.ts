import { describe, expect, it } from "vitest";
import { sameOriginReviewUrl } from "../../src/lib/payments";

describe("payment review redirect recovery", () => {
  const origin = "https://marketplace.example";
  it("keeps a valid same-origin review link", () => {
    expect(sameOriginReviewUrl(`${origin}/checkout/fixture?mode=deposit`, origin))
      .toBe(`${origin}/checkout/fixture?mode=deposit`);
  });
  it.each([null, {}, "/checkout/fixture", "not a URL", "https://other.example/checkout", "javascript:alert(1)", "https://user:pass@marketplace.example/checkout"])
    ("returns to the existing recovery path for %j", value => {
      expect(sameOriginReviewUrl(value, origin)).toBeNull();
    });
});
