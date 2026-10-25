import { describe, expect, it } from "vitest";
import { HOME_SIZE_GUIDE, homeSizeGuideText, pricingFactors, type GuidePackage } from "@/lib/homeSizeGuide";
import { yearsLabel } from "@/lib/utils";

// TRACE-122 (DEC-2026-047 items 2 and 6; review correction 2026-10-25).
const bedrooms = { question_key: "bedrooms", question_label: "Bedrooms", input_type: "number", unit: "bedrooms" } as const;
const sqft = { question_key: "sqft", question_label: "Home size", input_type: "number", unit: "sq ft" } as const;
const stories = { question_key: "stories", question_label: "Number of stories?", input_type: "number", unit: null } as const;

const bedroomPriced: GuidePackage = { questions: [bedrooms], tiers: [
  { rule_question_key: "bedrooms", rule_conditions: [] }, { rule_conditions: [{ question_key: "bedrooms", min: 3, max: 4 }] }] };
const sqftPricedAsksBedrooms: GuidePackage = { questions: [sqft, bedrooms], tiers: [
  { rule_conditions: [{ question_key: "sqft", min: 0, max: 1200 }] }, { rule_conditions: [{ question_key: "sqft", min: 1201, max: 2000 }] }] };
const multiFactor: GuidePackage = { questions: [sqft, bedrooms], tiers: [
  { rule_conditions: [{ question_key: "sqft", min: 0, max: 1200 }, { question_key: "bedrooms", min: 1, max: 2 }] }] };
const noRule: GuidePackage = { questions: [bedrooms], tiers: [{ rule_question_key: null, rule_conditions: [] }, {}] };

describe("pricing factors", () => {
  it("come from the price levels' conditions, legacy rule first", () => {
    expect(pricingFactors(bedroomPriced)).toEqual(["the number of bedrooms"]);
    expect(pricingFactors(sqftPricedAsksBedrooms)).toEqual(["square footage"]);
    expect(pricingFactors(multiFactor)).toEqual(["square footage", "the number of bedrooms"]);
    expect(pricingFactors({ questions: [stories], tiers: [{ rule_question_key: "stories" }] })).toEqual(["number of stories"]);
  });

  it("ignore questions no price level depends on", () => {
    expect(pricingFactors(noRule)).toEqual([]);
  });

  it("need a number question to count bedrooms", () => {
    expect(pricingFactors({ questions: [{ ...bedrooms, input_type: "text" }], tiers: [{ rule_question_key: "bedrooms" }] }))
      .toEqual(["bedrooms"]);
  });
});

describe("home size guide", () => {
  it("says bedrooms set the price only when they alone do", () => {
    expect(homeSizeGuideText([bedroomPriced])).toEqual({ summary: "Prices are set by the number of bedrooms.", note: null });
  });

  it("is not shown for square-footage pricing that also asks bedrooms", () => {
    expect(homeSizeGuideText([sqftPricedAsksBedrooms])).toBeNull();
  });

  it("names every factor of multi-factor pricing and does not infer square footage from bedrooms", () => {
    const text = homeSizeGuideText([multiFactor]);
    expect(text?.summary).toBe("Prices depend on the number of bedrooms and square footage.");
    expect(text?.note).toMatch(/not taken from the bedroom count/);
  });

  it("distinguishes packages priced by bedrooms alone from those with more factors", () => {
    expect(homeSizeGuideText([bedroomPriced, multiFactor])?.summary)
      .toBe("Prices are set by the number of bedrooms; some also depend on square footage.");
    expect(homeSizeGuideText([{ questions: [bedrooms, stories], tiers: [{ rule_conditions: [{ question_key: "bedrooms" }, { question_key: "stories" }] }] }])?.summary)
      .toBe("Prices depend on the number of bedrooms and number of stories.");
  });

  it("is not shown when no package has an applicable pricing rule", () => {
    expect(homeSizeGuideText([noRule])).toBeNull();
    expect(homeSizeGuideText([])).toBeNull();
  });

  it("lists each bedroom count once", () => {
    expect(HOME_SIZE_GUIDE.map((row) => row.bedrooms)).toEqual(["1 bedroom", "2 bedrooms", "3 bedrooms", "4 bedrooms", "5+ bedrooms"]);
  });
});

describe("yearsLabel", () => {
  it("pluralizes", () => {
    expect(yearsLabel(1)).toBe("1 year");
    expect(yearsLabel(0)).toBe("0 years");
    expect(yearsLabel(12)).toBe("12 years");
  });
});
