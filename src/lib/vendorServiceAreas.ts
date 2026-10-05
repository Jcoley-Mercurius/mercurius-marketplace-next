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

// Allowlist communities that a combined label stands for; other labels name one community.
const communities: Record<string, string[]> = {
  "Sanibel / Captiva": ["Sanibel", "Captiva"],
  "Pine Island": ["Bokeelia", "Pineland", "Saint James City"],
};

/** Allowlist communities (coverage_areas.city) named by a service-area label. */
export function serviceAreaCommunities(label: string): string[] {
  return communities[label] ?? [label];
}

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

export type PublicServiceArea = { city: string; zips: string[] };

/**
 * A provider's service ZIPs grouped by community for its public profile. Only ZIPs in
 * the active coverage allowlist are shown; communities and ZIPs are sorted.
 */
export function publicServiceAreas(
  zips: readonly string[],
  areas: readonly { zip_code: string; city: string }[],
): PublicServiceArea[] {
  const cityByZip = new Map(areas.map((area) => [area.zip_code, area.city]));
  const grouped = new Map<string, Set<string>>();
  for (const zip of zips) {
    const city = cityByZip.get(zip);
    if (!city) continue;
    grouped.set(city, (grouped.get(city) ?? new Set()).add(zip));
  }
  return [...grouped]
    .map(([city, set]) => ({ city, zips: [...set].sort() }))
    .sort((a, b) => a.city.localeCompare(b.city));
}
