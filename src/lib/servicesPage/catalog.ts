// TRACE-161: the public catalog names, descriptions and links that /services renders in its
// initial HTML. Pricing and availability are not part of this: they still come from the browser
// catalog read (useServiceCatalog), which applies the provider-listing and package-eligibility
// rules. Nothing here decides whether a service is bookable.
import { earlyAccessHref } from "@/lib/earlyAccessExperience";
import {
  serviceCategories as fallbackCategories,
  services as fallbackServices,
  type Service,
  type ServiceFrequency,
} from "@/lib/serviceData";
import { featuredPhoto, type FeaturedPhotoKey, type ResponsiveImage } from "@/lib/servicesPage/imagery";
import { serviceRowHref } from "@/lib/servicesPage/rowAnchor";

export type PublicCategory = { id: string; name: string };
export type PublicService = { id: string; name: string; categoryId: string; descriptor: string; icon: string };
export type PublicCatalog = { categories: PublicCategory[]; services: PublicService[] };

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/**
 * Keeps well-formed active rows in the order the database returned them. Returns null when either
 * read is unusable, so the page falls back to the browser read instead of showing a partial list.
 */
export function parsePublicCatalog(categoryRows: unknown, serviceRows: unknown): PublicCatalog | null {
  if (!Array.isArray(categoryRows) || !Array.isArray(serviceRows)) return null;
  const categories = categoryRows.flatMap((row): PublicCategory[] => {
    const record = (row ?? {}) as Record<string, unknown>;
    const id = text(record.id, 64);
    const name = text(record.name, 120);
    return ID.test(id) && name ? [{ id, name }] : [];
  });
  const services = serviceRows.flatMap((row): PublicService[] => {
    const record = (row ?? {}) as Record<string, unknown>;
    const id = text(record.id, 64);
    const name = text(record.name, 200);
    const categoryId = text(record.category_id, 64);
    if (!ID.test(id) || !name || !ID.test(categoryId)) return [];
    return [{ id, name, categoryId, descriptor: text(record.descriptor, 300), icon: text(record.icon, 64) }];
  });
  if (categories.length === 0 || services.length === 0) return null;
  return { categories, services };
}

/** The static catalog the browser read already falls back to. */
export function fallbackPublicCatalog(): PublicCatalog {
  return {
    categories: fallbackCategories.map(({ id, name }) => ({ id, name })),
    services: fallbackServices.map(({ id, name, categoryId, descriptor, icon }) => ({ id, name, categoryId, descriptor, icon })),
  };
}

/** The "All home services" heading; the hero's secondary action jumps here. */
export const ALL_SERVICES_ANCHOR = "all-services";

/** Where a catalog row's action leads. There is no service detail page, so this is early access with the service preselected. */
export const serviceDestination = (serviceId: string) => earlyAccessHref([serviceId]);

/** Featured cards, in display order. Each catalog id was checked against the hosted catalog on 2026-11-24. */
export const FEATURED_SERVICE_IDS: readonly FeaturedPhotoKey[] = ["lawn-mowing", "house-cleaning", "pool-service", "handyman"];

export type FeaturedService = { id: string; name: string; href: string; photo: ResponsiveImage };

/**
 * The featured services that exist in the catalog, named as the catalog names them. Each card leads
 * to its own row in "All home services" (`#service-<id>`), whose action is the early-access link.
 * When the catalog could not be read, the static fallback names are used; the destination is the same.
 */
export function featuredServices(catalog: PublicCatalog | null): FeaturedService[] {
  const source = catalog ?? fallbackPublicCatalog();
  return FEATURED_SERVICE_IDS.flatMap((id) => {
    const service = source.services.find((item) => item.id === id);
    return service ? [{ id, name: service.name, href: serviceRowHref(id), photo: featuredPhoto(id) }] : [];
  });
}

export type LivePrice = { frequency: ServiceFrequency; price: number; suffix: string };

/** The package price shown for a service with fixed-price supply: its default cadence, else the first priced one. */
export function livePriceFor(service: Service): LivePrice | null {
  const prices = [
    service.weeklyPrice ? { frequency: "weekly" as const, price: service.weeklyPrice, suffix: "/weekly visit" } : null,
    service.biMonthlyPrice ? { frequency: "bi-monthly" as const, price: service.biMonthlyPrice, suffix: "/visit every 2 weeks" } : null,
    service.avgMonthlyPrice ? { frequency: "monthly" as const, price: service.avgMonthlyPrice, suffix: "/month" } : null,
    service.everyTwoMonthsPrice ? { frequency: "every-two-months" as const, price: service.everyTwoMonthsPrice, suffix: "/visit every 2 months" } : null,
    service.quarterlyPrice ? { frequency: "quarterly" as const, price: service.quarterlyPrice, suffix: "/quarterly visit" } : null,
    service.oneTimePrice ? { frequency: "one-time" as const, price: service.oneTimePrice, suffix: " one-time" } : null,
  ].filter((price): price is LivePrice => price !== null);
  return prices.find((price) => price.frequency === service.defaultFrequency) ?? prices[0] ?? null;
}
