// TRACE-109 (DEC-2026-034): operator price corrections. The server validates and records;
// these cover the request built from what the operator read and the history readback.
import { describe, expect, it } from "vitest";
import {
  buildCorrection,
  correctionErrorMessage,
  describeChange,
  formatCorrectionTime,
  parseCorrections,
  parsePriceInput,
  type CorrectablePackage,
} from "@/lib/packagePriceCorrections";

const fixed: CorrectablePackage = {
  id: "pkg-1", contractorId: "c-1", contractorName: "Synthetic vendor", serviceName: "Synthetic service", name: "Synthetic fixed",
  pricingMode: "fixed", templateId: null, isActive: true, needsReview: false, updatedAt: "2026-10-15T12:00:00Z", depositAmount: null,
  tiers: [
    { kind: "tier", id: "t-1", name: "Basic", detail: "One-time", price: 100 },
    { kind: "tier", id: "t-2", name: "Plus", detail: "One-time", price: 150 },
  ],
  addons: [{ kind: "addon", id: "a-1", name: "Extra", detail: "Add-on", price: 25 }],
};
const deposit: CorrectablePackage = { ...fixed, id: "pkg-2", pricingMode: "deposit_quote", depositAmount: 50, tiers: [], addons: [] };

describe("parsePriceInput", () => {
  it("accepts positive whole-cent dollar amounts", () => {
    expect(parsePriceInput("120")).toBe(120);
    expect(parsePriceInput(" $1,250.5 ")).toBe(1250.5);
    expect(parsePriceInput("0.99")).toBe(0.99);
  });
  it("refuses zero, negatives, fractions of a cent, text and huge amounts", () => {
    for (const value of ["0", "-5", "10.005", "ten", "", "1e3", "1000001"]) expect(parsePriceInput(value)).toBeNull();
  });
});

describe("buildCorrection", () => {
  it("sends only changed prices, each with the value the operator read", () => {
    const built = buildCorrection(fixed, { "t-1": "120", "t-2": "150", "a-1": "30" });
    expect(built).toEqual({
      ok: true, changed: 2,
      prices: { tiers: [{ id: "t-1", from: 100, price: 120 }], addons: [{ id: "a-1", from: 25, price: 30 }] },
    });
  });
  it("names every invalid entry and sends nothing", () => {
    const built = buildCorrection(fixed, { "t-1": "abc", "a-1": "0", "t-2": "160" });
    expect(built).toMatchObject({ ok: false, invalid: ["t-1", "a-1"] });
  });
  it("refuses a correction that changes nothing", () => {
    expect(buildCorrection(fixed, { "t-1": "100", "t-2": " " })).toMatchObject({ ok: false, invalid: [], message: "Change at least one price before saving." });
  });
  it("corrects a quote deposit with the deposit read", () => {
    expect(buildCorrection(deposit, { deposit: "40" })).toEqual({ ok: true, changed: 1, prices: { tiers: [], addons: [], deposit: 40, deposit_from: 50 } });
  });
  it("ignores a deposit entry on a fixed package", () => {
    expect(buildCorrection(fixed, { deposit: "40" })).toMatchObject({ ok: false, invalid: [] });
  });
});

describe("history", () => {
  it("parses server rows defensively and describes each change", () => {
    const rows = parseCorrections([
      { id: 2, package_id: "pkg-1", package_name: "Synthetic fixed", reason: "Market rate", created_at: "2026-10-15T12:00:00Z", actor_email: "ops@example.invalid",
        changes: [
          { kind: "tier", name: "Basic", frequency: "weekly", from: 100, to: 120.5 },
          { kind: "deposit", name: "Deposit", from: null, to: 40 },
          { kind: "unknown", name: "x", to: 1 },
        ] },
      { package_id: 7 },
      null,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorEmail).toBe("ops@example.invalid");
    expect(rows[0].changes.map(describeChange)).toEqual(["Basic (Weekly): $100 → $120.50", "Deposit: not set → $40"]);
    expect(parseCorrections({})).toEqual([]);
  });
  it("words a stale read for the operator", () => {
    expect(correctionErrorMessage({ code: "40001", message: "raw" })).toMatch(/changed since you opened it/);
    expect(correctionErrorMessage({ code: "P0001", message: "No price changed" })).toBe("No price changed");
  });
});

describe("formatCorrectionTime", () => {
  it("formats in Eastern time without throwing", () => {
    expect(formatCorrectionTime("2026-10-15T13:00:00+00:00")).toBe("Oct 15, 2026, 9:00 AM Eastern");
  });
});
