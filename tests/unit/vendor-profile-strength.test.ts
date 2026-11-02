import { describe, expect, it } from "vitest";
import { calculateVendorProfileStrength, VENDOR_PROFILE_STRENGTH_MAX } from "@/lib/vendorProfileStrength";
import { vendorCoverageReadback } from "@/lib/vendorServiceAreas";

// TRACE-134 (6.11B, DEC-2026-055 item 1): Special Offer earns no points; the maximum is 95.
const complete = { name: "Synthetic Lawn Co", location: "Fort Myers", services: ["lawn"], email: "a@example.invalid", phone: "555-0100",
  years_experience: 5, verified_specialty: "Turf", logo_url: "/logo.png", bio: "x".repeat(80), our_promise: "On time" };

describe("vendor profile strength", () => {
  it("reaches its maximum without a Special Offer", () => {
    expect(calculateVendorProfileStrength(complete, 3)).toMatchObject({ score: VENDOR_PROFILE_STRENGTH_MAX, differentiation: 15 });
    expect(VENDOR_PROFILE_STRENGTH_MAX).toBe(95);
  });

  it("ignores a Special Offer the record still stores", () => {
    const withOffer = { ...complete, special_offer: "20% off" };
    expect(calculateVendorProfileStrength(withOffer, 3).score).toBe(calculateVendorProfileStrength(complete, 3).score);
  });
});

describe("vendor coverage readback", () => {
  const areas = [{ zip_code: "33901", city: "Fort Myers" }, { zip_code: "33903", city: "North Fort Myers" }];
  it("groups covered ZIP codes by city and lists the rest as outside coverage", () => {
    expect(vendorCoverageReadback(["33903", "33901", "90210", "90210"], areas)).toEqual({
      covered: [{ city: "Fort Myers", zips: ["33901"] }, { city: "North Fort Myers", zips: ["33903"] }],
      outside: ["90210"],
    });
  });

  it("is empty when nothing is on file", () => {
    expect(vendorCoverageReadback([], areas)).toEqual({ covered: [], outside: [] });
  });
});
