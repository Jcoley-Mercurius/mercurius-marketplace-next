// TRACE-105 (R0.5): vendor-application service areas limited to Lee County (CFG-001, DEC-2026-021).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LEE_COUNTY_SERVICE_AREAS,
  normalizeServiceAreas,
  UnsupportedServiceAreaError,
} from "@/lib/vendorServiceAreas";

const allowlistCities = new Set(
  [...readFileSync("supabase/migrations/20260927010000_cfg001_lee_county_coverage.sql", "utf8")
    .matchAll(/\('\d{5}', '([^']+)', 'FL'/g)].map((match) => match[1]),
);

// Communities each descriptive label stands for, all present in the approved allowlist.
const communities: Record<string, string[]> = {
  "Sanibel / Captiva": ["Sanibel", "Captiva"],
  "Pine Island": ["Bokeelia", "Pineland", "Saint James City"],
};

describe("Lee County vendor service areas", () => {
  it("offers only communities from the approved Lee County ZIP allowlist", () => {
    for (const label of LEE_COUNTY_SERVICE_AREAS) {
      for (const city of communities[label] ?? [label]) {
        expect(allowlistCities, `${label} → ${city}`).toContain(city);
      }
    }
  });

  it("covers every community in the allowlist", () => {
    const offered = new Set(LEE_COUNTY_SERVICE_AREAS.flatMap((label) => communities[label] ?? [label]));
    expect([...allowlistCities].filter((city) => !offered.has(city))).toEqual([]);
  });

  it("excludes areas outside Lee County", () => {
    for (const outside of ["Naples", "Punta Gorda", "Port Charlotte", "Marco Island"]) {
      expect(LEE_COUNTY_SERVICE_AREAS).not.toContain(outside);
    }
  });

  it("normalizes selected areas and treats empty input as none", () => {
    expect(normalizeServiceAreas(null)).toBeNull();
    expect(normalizeServiceAreas("  ,  ")).toBeNull();
    expect(normalizeServiceAreas(" Cape Coral , Estero, Cape Coral ")).toBe("Cape Coral, Estero");
    expect(normalizeServiceAreas("Sanibel / Captiva, Pine Island")).toBe("Sanibel / Captiva, Pine Island");
  });

  it("refuses submissions naming areas outside Lee County", () => {
    expect(() => normalizeServiceAreas("Cape Coral, Naples")).toThrow(UnsupportedServiceAreaError);
    try {
      normalizeServiceAreas("Naples, Punta Gorda, Fort Myers");
    } catch (error) {
      expect((error as UnsupportedServiceAreaError).entries).toEqual(["Naples", "Punta Gorda"]);
      expect((error as Error).message).toMatch(/Lee County only/);
    }
  });
});
