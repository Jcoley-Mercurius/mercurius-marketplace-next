// TRACE-105: vendor applications choose services from the live Mercurius catalog.
// vendor_applications.services holds catalog ids plus at most one "Other: …" entry
// describing services the catalog does not list yet (collected for catalog review).
// Applications submitted before this change hold free-text names.

export const OTHER_SERVICE_PREFIX = "Other: ";
export const MAX_OTHER_SERVICE_LENGTH = 150;

export type CatalogService = { id: string; name: string };

export function otherServiceEntry(description: string): string {
  return OTHER_SERVICE_PREFIX + description.trim();
}

export function otherServiceDescription(entry: string): string | null {
  return entry.startsWith(OTHER_SERVICE_PREFIX) ? entry.slice(OTHER_SERVICE_PREFIX.length).trim() : null;
}

/** Splits stored entries into catalog ids and descriptions with no catalog service. */
export function readApplicationServices(entries: string[] | null, catalog: CatalogService[]) {
  const byId = new Map(catalog.map((service) => [service.id, service.id]));
  // Legacy free-text names still match a catalog service of the same name.
  const byName = new Map(catalog.map((service) => [service.name.trim().toLowerCase(), service.id]));
  const catalogIds: string[] = [];
  const unmatched: string[] = [];
  for (const raw of entries ?? []) {
    const entry = raw.trim();
    if (!entry) continue;
    const other = otherServiceDescription(entry);
    const id = other === null ? byId.get(entry) ?? byName.get(entry.toLowerCase()) : undefined;
    if (id) {
      if (!catalogIds.includes(id)) catalogIds.push(id);
    } else {
      unmatched.push(other ?? entry);
    }
  }
  return { catalogIds, unmatched };
}

/** Display labels: catalog names, "Other: …" as entered, legacy names unchanged. */
export function applicationServiceLabels(entries: string[] | null, catalog: CatalogService[]): string[] {
  const names = new Map(catalog.map((service) => [service.id, service.name]));
  return (entries ?? []).map((entry) => names.get(entry) ?? entry);
}

/** Server rule: one or more active catalog ids and at most one described "Other" entry. */
export function validateApplicationServices(entries: string[], activeIds: Set<string>): string | null {
  const others = entries.filter((entry) => otherServiceDescription(entry) !== null);
  if (!entries.some((entry) => activeIds.has(entry))) return "Choose at least one service from the list.";
  if (entries.some((entry) => !activeIds.has(entry) && otherServiceDescription(entry) === null)) {
    return "A selected service is no longer offered. Refresh the page and choose again.";
  }
  if (others.length > 1) return "Describe other services in one entry.";
  const description = others.length ? otherServiceDescription(others[0]) ?? "" : null;
  if (description !== null && !description) return "Describe the other services you offer.";
  if (description !== null && description.length > MAX_OTHER_SERVICE_LENGTH) {
    return `Keep the other services description under ${MAX_OTHER_SERVICE_LENGTH} characters.`;
  }
  return null;
}
