// TRACE-104 (R0 truthful listing): signed-in catalog reads follow the public listing rule.
import { describe, expect, it } from "vitest";
import { packagesFromListedProviders } from "@/lib/vendorPricing";

const rows = [
  { id: "listed-package", contractor_id: "listed" },
  { id: "excluded-package", contractor_id: "excluded" },
  { id: "unlisted-package", contractor_id: "unlisted" },
];

describe("catalog packages follow the public listing rule (TRACE-104)", () => {
  it("keeps only packages of providers the listing projection returns", () => {
    expect(packagesFromListedProviders(rows, new Set(["listed"])).map((row) => row.id)).toEqual(["listed-package"]);
  });

  it("shows no package when no provider is listed", () => {
    expect(packagesFromListedProviders(rows, new Set())).toEqual([]);
  });

  it("shows no package when the listing could not be read", () => {
    expect(packagesFromListedProviders(rows, null)).toEqual([]);
  });
});
