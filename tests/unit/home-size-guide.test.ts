import { describe, expect, it } from "vitest";
import { HOME_SIZE_GUIDE, pricedByBedrooms } from "@/lib/homeSizeGuide";
import { yearsLabel } from "@/lib/utils";

// TRACE-122 (DEC-2026-047 items 2 and 6).
describe("home size guide", () => {
  it("applies to packages priced by a number-of-bedrooms answer", () => {
    expect(pricedByBedrooms([{ question_key: "bedrooms", input_type: "number", unit: "bedrooms" }])).toBe(true);
    expect(pricedByBedrooms([{ question_key: "how_many", input_type: "number", unit: "Bedrooms" }])).toBe(true);
    expect(pricedByBedrooms([{ question_key: "how_many_bedrooms", input_type: "text", unit: null }])).toBe(false);
    expect(pricedByBedrooms([{ question_key: "lot_sqft", input_type: "number", unit: "sqft" }])).toBe(false);
    expect(pricedByBedrooms([])).toBe(false);
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
