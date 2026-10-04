// TRACE-105: vendor applications store catalog ids plus one described "Other" entry.
import { describe, expect, it } from "vitest";
import {
  applicationServiceLabels,
  otherServiceEntry,
  readApplicationServices,
  validateApplicationServices,
} from "@/lib/vendorApplicationServices";

const catalog = [{ id: "lawn-mowing", name: "Lawn Care" }, { id: "pressure-washing", name: "Pressure Washing" }];
const active = new Set(catalog.map((service) => service.id));

describe("vendor application services", () => {
  it("reads catalog ids, legacy names and Other descriptions", () => {
    expect(readApplicationServices(["lawn-mowing", "pressure washing", "Other: lanai rescreening", "Mowing"], catalog)).toEqual({
      catalogIds: ["lawn-mowing", "pressure-washing"],
      unmatched: ["lanai rescreening", "Mowing"],
    });
  });

  it("labels catalog ids by name and keeps other entries as entered", () => {
    expect(applicationServiceLabels(["lawn-mowing", "Other: lanai rescreening", "Mowing"], catalog))
      .toEqual(["Lawn Care", "Other: lanai rescreening", "Mowing"]);
  });

  it("accepts catalog choices with one described Other entry", () => {
    expect(validateApplicationServices(["lawn-mowing"], active)).toBeNull();
    expect(validateApplicationServices(["lawn-mowing", otherServiceEntry("  lanai rescreening ")], active)).toBeNull();
  });

  it("refuses applications without a valid catalog choice", () => {
    expect(validateApplicationServices([otherServiceEntry("lanai rescreening")], active)).toMatch(/at least one service/);
    expect(validateApplicationServices(["lawn-mowing", "retired-service"], active)).toMatch(/no longer offered/);
    expect(validateApplicationServices(["lawn-mowing", "Other: a", "Other: b"], active)).toMatch(/one entry/);
    expect(validateApplicationServices(["lawn-mowing", "Other: "], active)).toMatch(/Describe/);
    expect(validateApplicationServices(["lawn-mowing", otherServiceEntry("x".repeat(151))], active)).toMatch(/under 150/);
  });
});
