// TRACE-129 (DEC-2026-051): a vendor's price for a service is its own package; the catalog's
// prices and pricing mode are reference defaults only and never price a vendor. A service a
// vendor lists with no package of its own is offered as Custom Quote only when an operator
// says so, through the same draft-and-publish commands as any other price (DEC-2026-046):
// a reason is required, nothing is sent for approval and no email is sent.
import { emptyCatalogService, serviceIdFromName, type CatalogService } from "@/lib/serviceCatalog";

export const QUOTE_REASON_MAX = 500;

/** The profile columns "Save services" writes. Visibility, marketing and profile fields are not among them. */
export function serviceSaveChanges(services: readonly string[]) {
  return { services: [...new Set(services)] };
}

/**
 * Saved services this vendor has never been priced for: no package (live, paused or archived)
 * and no open draft. Only those may be offered as Custom Quote here; a paused or replaced price
 * is handled in Vendor prices, so this never adds a package beside one an operator suspended.
 */
export function unpricedServices(
  saved: readonly string[],
  packageServices: readonly string[],
  draftServices: readonly string[],
) {
  const priced = new Set([...packageServices, ...draftServices]);
  return [...new Set(saved)].filter((service) => !priced.has(service));
}

/** Draft content for a Custom Quote package: no price levels, so homeowners request a quote. */
export function customQuoteContent(serviceName: string) {
  return {
    name: serviceName.trim(), description: null, pricing_mode: "custom_quote" as const, deposit_amount: null,
    included_scope: [] as string[], policy_notes: null, questions: [], tiers: [], addons: [],
  };
}

export function quoteReasonError(reason: string) {
  const trimmed = reason.trim();
  if (!trimmed) return "Enter the reason. The vendor will see it.";
  if (trimmed.length > QUOTE_REASON_MAX) return `Keep the reason to ${QUOTE_REASON_MAX} characters.`;
  return null;
}

/** A service named on a vendor application, added to the catalog as Custom Quote and shown. */
export function catalogServiceFromApplication(name: string, categoryId: string): CatalogService {
  const trimmed = name.replace(/\s+/g, " ").trim();
  return { ...emptyCatalogService(categoryId), id: serviceIdFromName(trimmed), name: trimmed, icon: "Star" };
}
