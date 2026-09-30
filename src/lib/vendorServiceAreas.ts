// Vendor-application service areas, limited to Lee County (CFG-001, DEC-2026-021).
// Names are descriptive only; the ZIP allowlist in coverage_areas stays authoritative.
// Each label covers communities named in migration 20260927010000_cfg001_lee_county_coverage.
export const LEE_COUNTY_SERVICE_AREAS = [
  "Cape Coral",
  "Fort Myers",
  "Fort Myers Beach",
  "North Fort Myers",
  "Estero",
  "Lehigh Acres",
  "Bonita Springs",
  "Sanibel / Captiva",
  "Pine Island",
  "Alva",
  "Boca Grande",
] as const;

const allowed = new Set<string>(LEE_COUNTY_SERVICE_AREAS);

/**
 * Normalizes a comma-separated service-area value to known Lee County labels.
 * Returns null when empty; throws with the unsupported entries otherwise.
 */
export function normalizeServiceAreas(value: string | null): string | null {
  if (!value) return null;
  const entries = [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
  const unsupported = entries.filter((entry) => !allowed.has(entry));
  if (unsupported.length > 0) {
    throw new UnsupportedServiceAreaError(unsupported);
  }
  return entries.length > 0 ? entries.join(", ") : null;
}

export class UnsupportedServiceAreaError extends Error {
  constructor(readonly entries: string[]) {
    super("Mercurius currently serves Lee County only. Remove service areas outside Lee County.");
  }
}
