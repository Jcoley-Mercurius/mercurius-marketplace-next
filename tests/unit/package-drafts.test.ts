// TRACE-110 (DEC-2026-035): operator draft prices and the every-two-months cadence. The
// server validates, publishes and records; these cover the request built from what the
// operator entered, the draft readback and the cadence labels.
import { describe, expect, it } from "vitest";
import {
  buildDraftPrices,
  describeDraftPrice,
  draftErrorMessage,
  draftPriceInput,
  offeredCadences,
  parseDrafts,
} from "@/lib/packageDrafts";
import { describeChange, frequencyLabel } from "@/lib/packagePriceCorrections";
import { planningFrequencyLabel } from "@/components/planning/ServicePlanning";
import { evaluateCustomPackagePriceReview, pricingFrequencies } from "@/lib/vendorPricing";

describe("cadences", () => {
  it("adds every two months after monthly and keeps every two weeks", () => {
    expect(pricingFrequencies).toEqual(["one-time", "weekly", "bi-monthly", "monthly", "every-two-months", "quarterly"]);
    expect(frequencyLabel("every-two-months")).toBe("Every two months");
    expect(frequencyLabel("bi-monthly")).toBe("Every two weeks");
    expect(planningFrequencyLabel("every-two-months")).toBe("Every two months");
  });

  it("lists a service's catalog cadences in display order, or every cadence when it has none", () => {
    expect(offeredCadences(["one-time", "every-two-months", "monthly", "unknown"])).toEqual(["one-time", "monthly", "every-two-months"]);
    expect(offeredCadences([])).toEqual([...pricingFrequencies]);
    expect(offeredCadences(null)).toEqual([...pricingFrequencies]);
  });
});

describe("buildDraftPrices", () => {
  const offered = offeredCadences(["monthly", "every-two-months", "one-time"]);

  it("sends the priced cadences only, in cadence order", () => {
    expect(buildDraftPrices({ "every-two-months": "$75", monthly: " 45.50 ", "one-time": "" }, offered))
      .toEqual({ ok: true, prices: [{ frequency: "monthly", price: 45.5 }, { frequency: "every-two-months", price: 75 }] });
  });

  it("ignores cadences the service does not offer", () => {
    expect(buildDraftPrices({ quarterly: "90", monthly: "40" }, offered))
      .toEqual({ ok: true, prices: [{ frequency: "monthly", price: 40 }] });
  });

  it("refuses invalid amounts and an empty draft", () => {
    expect(buildDraftPrices({ monthly: "0", "every-two-months": "12.345" }, offered))
      .toMatchObject({ ok: false, invalid: ["monthly", "every-two-months"] });
    expect(buildDraftPrices({}, offered)).toEqual({ ok: false, invalid: [], message: "Enter a price for at least one cadence." });
  });

  it("round-trips a saved draft into the editor", () => {
    expect(draftPriceInput([{ frequency: "monthly", price: 40 }, { frequency: "every-two-months", price: 75.5 }]))
      .toEqual({ monthly: "40", "every-two-months": "75.5" });
  });
});

describe("parseDrafts", () => {
  it("reads drafts and drops malformed rows and prices", () => {
    const drafts = parseDrafts([
      {
        id: "d-1", contractor_id: "c-1", contractor_name: "Synthetic vendor", service_id: "svc", service_name: "Synthetic service",
        name: "Synthetic plan", description: null, created_by_email: "operator@example.invalid",
        created_at: "2026-10-16T12:00:00Z", updated_at: "2026-10-16T12:05:00Z",
        prices: [{ frequency: "every-two-months", price: 75 }, { frequency: "fortnightly", price: 10 }, { frequency: "monthly", price: "x" }],
      },
      { id: "broken" },
      null,
    ]);
    expect(drafts).toEqual([{
      id: "d-1", contractorId: "c-1", contractorName: "Synthetic vendor", serviceId: "svc", serviceName: "Synthetic service",
      name: "Synthetic plan", description: null, prices: [{ frequency: "every-two-months", price: 75 }],
      createdByEmail: "operator@example.invalid", createdAt: "2026-10-16T12:00:00Z", updatedAt: "2026-10-16T12:05:00Z",
    }]);
    expect(parseDrafts("nope")).toEqual([]);
  });

  it("describes prices and stale-draft refusals for the operator", () => {
    expect(describeDraftPrice({ frequency: "every-two-months", price: 75 })).toBe("Every two months: $75");
    expect(draftErrorMessage({ code: "40001", message: "Draft changed" })).toMatch(/changed since you opened it/);
    expect(draftErrorMessage({ code: "23505", message: "This vendor already has an active Monthly price" }))
      .toBe("This vendor already has an active Monthly price");
  });

  it("shows a published draft's prices in the history as newly set", () => {
    expect(describeChange({ kind: "tier", name: "Every two months", frequency: "every-two-months", from: null, to: 75 }))
      .toBe("Every two months: not set → $75");
  });
});

describe("guardrail guidance", () => {
  it("bands every two months by the monthly catalog reference, as the server does", () => {
    const catalog = { monthly_price: 40, one_time_price: 100 };
    const review = (price: number) => evaluateCustomPackagePriceReview({ tiers: [{ price, frequency: "every-two-months" }], frequency: "every-two-months", catalog });
    expect(review(160).needsReview).toBe(false);
    expect(review(161).needsReview).toBe(true);
    expect(review(161).minPrice).toBe(10);
  });
});
