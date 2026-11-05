import { describe, expect, it } from "vitest";
import { displayedProviderBadges, isHiddenProviderBadge } from "../../src/lib/providerBadges";
import { OFFERED_PROVIDER_BADGES } from "../../src/components/admin/ProviderBadges";

describe("CS-2 / DEC-2026-058 Top Rated hidden", () => {
  it("drops Top Rated in any casing or spacing and keeps the rest in order", () => {
    expect(displayedProviderBadges(["Licensed", "Top Rated", "Insured", " top rated ", "TOP RATED"])).toEqual(["Licensed", "Insured"]);
  });

  it("drops blank badges and tolerates missing lists", () => {
    expect(displayedProviderBadges(["", "  ", "Insured"])).toEqual(["Insured"]);
    expect(displayedProviderBadges(null)).toEqual([]);
    expect(displayedProviderBadges(undefined)).toEqual([]);
  });

  it("hides only Top Rated", () => {
    expect(isHiddenProviderBadge("Top Rated")).toBe(true);
    expect(isHiddenProviderBadge("Satisfaction Guaranteed")).toBe(false);
  });

  it("is not offered in the badge editor", () => {
    expect(OFFERED_PROVIDER_BADGES).not.toContain("Top Rated");
    expect(OFFERED_PROVIDER_BADGES).toContain("Licensed");
  });
});
