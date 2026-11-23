import { describe, expect, it } from "vitest";
import {
  commissionRateLabel,
  dollarsToCents,
  economicsRows,
  formatPromotionDiscount,
  isoToZonedLocal,
  parseEconomics,
  parseOffers,
  percentToBps,
  zonedLocalToIso,
} from "@/lib/promotionOffers";

// TRACE-114 (DEC-2026-038): the server computes promotional economics; the client words
// them. Fixture 11: $100 eligible, $10 discount, at the DEC-2026-067 promotional 5% (SQL 127).

const vendorFunded = parseEconomics({ eligible_cents: 10000, discount_cents: 1000, homeowner_service_cents: 9000, commission_rate_bps: 500,
  commission_base_cents: 9000, commission_cents: 450, vendor_proceeds_cents: 8550, platform_subsidy_cents: 0 })!;
const platformFunded = parseEconomics({ eligible_cents: 10000, discount_cents: 1000, homeowner_service_cents: 9000, commission_rate_bps: 500,
  commission_base_cents: 10000, commission_cents: 500, vendor_proceeds_cents: 9500, platform_subsidy_cents: 1000 })!;
// A redemption recorded before DEC-2026-067 keeps its 7.5% and is worded from its own rate.
const historical = parseEconomics({ eligible_cents: 10000, discount_cents: 1000, homeowner_service_cents: 9000, commission_rate_bps: 750,
  commission_base_cents: 9000, commission_cents: 675, vendor_proceeds_cents: 8325, platform_subsidy_cents: 0 })!;

describe("promotion economics wording", () => {
  it("shows the vendor-funded split", () => {
    expect(economicsRows(vendorFunded, "vendor")).toEqual([
      ["Eligible service", "$100"], ["Discount (vendor-funded)", "−$10"], ["Homeowner pays for the service", "$90"],
      ["Commission (5% of $90)", "$4.50"], ["You receive", "$85.50"],
    ]);
  });

  it("words a historical redemption from the rate it recorded", () => {
    expect(economicsRows(historical, "vendor")).toContainEqual(["Commission (7.5% of $90)", "$6.75"]);
  });

  it("keeps the Mercurius subsidy apart from commission for operators", () => {
    const rows = economicsRows(platformFunded, "operator");
    expect(rows).toContainEqual(["Commission (5% of $100)", "$5"]);
    expect(rows).toContainEqual(["Vendor proceeds", "$95"]);
    expect(rows).toContainEqual(["Mercurius subsidy (not commission)", "$10"]);
  });

  it("refuses incomplete economics instead of filling in numbers", () => {
    expect(parseEconomics({ eligible_cents: 10000 })).toBeNull();
    expect(commissionRateLabel(1000)).toBe("10%");
    expect(commissionRateLabel(500)).toBe("5%");
    expect(commissionRateLabel(1500)).toBe("15%");
    expect(commissionRateLabel(750)).toBe("7.5%");
  });
});

describe("offer input", () => {
  it("reads dollars and percentages strictly", () => {
    expect(dollarsToCents("$1,000.50")).toBe(100050);
    expect(dollarsToCents("12.345")).toBeNull();
    expect(dollarsToCents("0")).toBeNull();
    expect(percentToBps("10")).toBe(1000);
    expect(percentToBps("7.5%")).toBe(750);
    expect(percentToBps("81")).toBeNull();
  });

  it("describes the discount", () => {
    expect(formatPromotionDiscount({ kind: "percent", percentBps: 2000, amountCents: null, maxDiscountCents: 1500 })).toBe("20% off, up to $15");
    expect(formatPromotionDiscount({ kind: "amount", percentBps: null, amountCents: 1000, maxDiscountCents: null })).toBe("$10 off");
    expect(formatPromotionDiscount({ kind: "package_price", percentBps: null, amountCents: null, maxDiscountCents: null })).toBe("Promotional package price");
  });

  it("reads campaign times in the campaign timezone across daylight saving", () => {
    expect(zonedLocalToIso("2026-11-02T09:00")).toBe("2026-11-02T14:00:00.000Z");
    expect(zonedLocalToIso("2026-10-18T09:00")).toBe("2026-10-18T13:00:00.000Z");
    expect(isoToZonedLocal("2026-11-02T14:00:00.000Z")).toBe("2026-11-02T09:00");
    expect(zonedLocalToIso("not a time")).toBeNull();
  });

  it("parses offers and drops malformed rows", () => {
    const offers = parseOffers([{ id: "o1", fingerprint: "f", label: "Synthetic", status: "approved", funding: "platform", kind: "amount", amount_cents: 1000 }, { id: "bad" }]);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ status: "approved", funding: "platform", amountCents: 1000, live: false, example: null });
  });
});
