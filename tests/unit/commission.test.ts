import { describe, expect, it } from "vitest";
import {
  commissionCents,
  commissionRateLabel,
  PROMOTIONAL_COMMISSION_BPS,
  PROMOTIONAL_COMMISSION_LABEL,
  STANDARD_COMMISSION_BPS,
  STANDARD_COMMISSION_LABEL,
  standardSplit,
} from "@/lib/commission";

// DEC-2026-067 (TRACE-160): display constants must equal the database policy in force
// (private.money_commission_policies; SQL 127 pins 1000/500 there).
describe("pilot standard commission", () => {
  it("is 10% standard and 5% with one valid promotion (half, DEC-2026-038)", () => {
    expect(STANDARD_COMMISSION_BPS).toBe(1000);
    expect(PROMOTIONAL_COMMISSION_BPS).toBe(500);
    expect(PROMOTIONAL_COMMISSION_BPS * 2).toBe(STANDARD_COMMISSION_BPS);
    expect(STANDARD_COMMISSION_LABEL).toBe("10%");
    expect(PROMOTIONAL_COMMISSION_LABEL).toBe("5%");
    expect(commissionRateLabel(750)).toBe("7.5%");
  });

  it("$100 → $10 commission, $90 to the vendor before separate deductions", () => {
    expect(standardSplit(10000)).toEqual({ commissionCents: 1000, vendorProceedsCents: 9000 });
    expect(commissionCents(10000, PROMOTIONAL_COMMISSION_BPS)).toBe(500);
  });

  it("rounds half away from zero on whole cents, like the database", () => {
    expect(commissionCents(3333)).toBe(333);
    expect(commissionCents(3335)).toBe(334);
    expect(commissionCents(5)).toBe(1);
    expect(commissionCents(3333, 500)).toBe(167);
    expect(commissionCents(30, 500)).toBe(2);
    expect(commissionCents(3333, 1500)).toBe(500);
  });

  it("refuses non-integer or negative amounts", () => {
    expect(() => commissionCents(10.5)).toThrow();
    expect(() => commissionCents(-1)).toThrow();
    expect(() => commissionCents(100, 1.5)).toThrow();
  });
});
