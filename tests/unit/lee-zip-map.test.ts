// TRACE-105: the drawn Lee County map on public provider profiles stays within the coverage allowlist.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEE_ZIP_MAP_LABELS, LEE_ZIP_MAP_VIEWBOX, LEE_ZIP_SHAPES } from "@/lib/leeZipMap";

const cityByZip = new Map(
  [...readFileSync("supabase/migrations/20260927010000_cfg001_lee_county_coverage.sql", "utf8")
    .matchAll(/\('(\d{5})', '([^']+)', 'FL'/g)].map((match) => [match[1], match[2]]),
);

describe("Lee County ZIP map", () => {
  it("draws only allowlist ZIPs, each once, with a path", () => {
    const zips = LEE_ZIP_SHAPES.map((shape) => shape.zip);
    expect(new Set(zips).size).toBe(zips.length);
    for (const shape of LEE_ZIP_SHAPES) {
      expect(cityByZip.has(shape.zip), shape.zip).toBe(true);
      expect(shape.d).toMatch(/^M[\d.\s LMZ-]+Z$/);
    }
  });

  it("labels allowlist communities inside the map", () => {
    const cities = new Set(cityByZip.values());
    for (const label of LEE_ZIP_MAP_LABELS) {
      for (const city of label.cities) expect(cities, `${label.name} → ${city}`).toContain(city);
      expect(label.x).toBeGreaterThan(0);
      expect(label.x).toBeLessThan(LEE_ZIP_MAP_VIEWBOX.width);
      expect(label.y).toBeGreaterThan(0);
      expect(label.y).toBeLessThan(LEE_ZIP_MAP_VIEWBOX.height);
    }
  });
});
