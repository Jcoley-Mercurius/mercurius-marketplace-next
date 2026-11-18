// Dynamic provider profile — presentation view model (TRACE-156; see
// docs/agent/DYNAMIC-PROFILES-HANDOFF.md). Pure functions over rows shaped like today's public
// reads. Eligibility, price meaning and coverage stay with their existing helpers; this module
// only decides what a card or profile shows for a chosen service. The directory (P2A) and the
// provider profile route (P2B) both read it; the gated review gallery reads it with fixtures.

import { EARLY_ACCESS_CTA } from "@/lib/earlyAccessExperience";
import { addonPriceLabel, formatCents, toCents, walkthroughLabel, type PricingMode } from "@/lib/pricingContent";
import type { PublicReviews } from "@/lib/reviews/serviceReview";
import {
  isPubliclyEligibleFixedPackage,
  isPubliclyEligibleQuotePackage,
  pricingFrequencies,
  publiclyEligibleFixedFrequencies,
  tierPricingFrequency,
  type PricingFrequency,
} from "@/lib/vendorPricing";
import type { PublicServiceArea } from "@/lib/vendorServiceAreas";

// ---------------------------------------------------------------------------------------------
// Inputs. Field names follow r0_public_providers, vendor_packages, package_tiers,
// package_addons and contractor_gallery so a real reader can supply them unchanged.
// ---------------------------------------------------------------------------------------------

export type ProfileProvider = {
  id: string;
  name: string;
  logo_url: string | null;
  bio: string | null;
  location: string | null;
  badges: string[] | null;
  tagline: string | null;
};

export type ProfileTier = {
  id: string;
  name: string;
  price: number;
  frequency?: string | null;
  price_kind?: string | null;
  price_max?: number | null;
  includes?: string[] | null;
  rule_question_key?: string | null;
  /** The bounds of a rule_question_key rule; the request step's server calculation applies them. */
  rule_min?: number | null;
  rule_max?: number | null;
  rule_conditions?: unknown;
  sort_order: number;
};

export type ProfileAddon = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  price_kind?: string | null;
  price_max?: number | null;
  unit_label?: string | null;
  min_quantity?: number | null;
  max_quantity?: number | null;
  is_required?: boolean | null;
  frequencies?: string[] | null;
  sort_order: number;
};

export type ProfilePackage = {
  id: string;
  service_id: string;
  name: string;
  description: string | null;
  pricing_mode: string;
  default_frequency: string;
  deposit_amount: number | null;
  is_active: boolean;
  needs_review: boolean | null;
  sort_order: number;
  included_scope?: string[] | null;
  tiers: ProfileTier[];
  addons: ProfileAddon[];
};

/**
 * A gallery item. `service_id` is PROPOSED: contractor_gallery has only an image and a caption
 * today, so a production profile cannot yet link media to a service.
 */
export type ProfileMedia = {
  id: string;
  image_url: string;
  caption: string | null;
  sort_order: number;
  service_id?: string | null;
};

/** PROPOSED content: published service answers have no data source today. */
export type ProfileQuestion = {
  id: string;
  service_id: string;
  question: string;
  answer: string;
  source: "provider" | "marketplace";
};

export type ProfileServiceArea = { areas: PublicServiceArea[]; hasListedZips: boolean };

/**
 * Supported business information from the public listing that the gallery composition has no
 * slot for. A live profile keeps it rather than silently dropping it (TRACE-156 P2B).
 */
export type ProfileBusiness = {
  yearsExperience: number | null;
  ourPromise: string | null;
  verifiedSpecialty: string | null;
  videoUrl: string | null;
  /** Homeowner-confirmed completions through Mercurius; null when unknown or unreadable. */
  completedJobs: number | null;
};

/** The bedroom size guide (TRACE-122) for one offer, when its price levels depend on bedrooms. */
export type ProfileSizeGuide = { summary: string; note: string | null };

export type ProfileData = {
  provider: ProfileProvider;
  packages: ProfilePackage[];
  /**
   * ready: `packages` is the provider's complete published set (possibly empty).
   * unavailable: the offers could not be read completely. Nothing is priced, and nothing says
   * the provider publishes no offers. Omitted means ready (the gallery's fixtures).
   */
  offersStatus?: "ready" | "unavailable";
  /** services_catalog names by id. */
  serviceNames: Record<string, string>;
  media: ProfileMedia[];
  /** The gallery read failed: no photo is shown and the cover says so. Omitted means ready. */
  mediaStatus?: "ready" | "unavailable";
  /** null: the public review read failed. */
  reviews: PublicReviews | null;
  /** null: the provider's service-ZIP read failed. */
  serviceArea: ProfileServiceArea | null;
  /** Active coverage_areas ZIPs (the Marketplace allowlist); null when unreadable. */
  marketplaceZips: readonly string[] | null;
  questions: ProfileQuestion[];
  /** The public listing's services array (services with a live eligible offering). */
  listedServiceIds?: readonly string[];
  business?: ProfileBusiness;
  /** Size guides by offer (package) id. */
  sizeGuides?: Readonly<Record<string, ProfileSizeGuide>>;
};

// ---------------------------------------------------------------------------------------------
// Offers and services
// ---------------------------------------------------------------------------------------------

export type OfferCadence = {
  frequency: PricingFrequency;
  /** Lowest level plus required extras at their minimum quantity. */
  baseCents: number;
  /** exact: one published price. from: several levels or an answer-based level. estimate: a required extra is a range. */
  qualifier: "exact" | "from" | "estimate";
  levels: number;
  ruleBased: boolean;
  includes: string[];
  /**
   * The level a request may be bound to before any answer: only when this cadence publishes
   * exactly one level and that level has no answer rule. Otherwise null, and the request step's
   * server calculation resolves the level from the homeowner's answers. The cheapest of several
   * levels is never presented as the homeowner's level.
   */
  boundTier: { id: string; name: string; includes: string[] } | null;
  requiredAddons: ProfileAddon[];
  optionalAddons: ProfileAddon[];
};

export type ProfileOffer = {
  id: string;
  serviceId: string;
  name: string;
  description: string | null;
  scope: string[];
  kind: "fixed" | "quote";
  pricingMode: PricingMode;
  defaultFrequency: PricingFrequency;
  /** Fixed offers only, default cadence first. */
  cadences: OfferCadence[];
  /** Quote offers: a published estimate, already qualified, or null. */
  estimateLabel: string | null;
  /** Quote offers with a deposit: shown apart from the job price. */
  depositCents: number | null;
  /** Quote offers: optional extras the provider has published. */
  quoteAddons: ProfileAddon[];
};

export type ProfileService = {
  id: string;
  name: string;
  offers: ProfileOffer[];
  mode: "fixed" | "quote" | "mixed";
};

function isPricingMode(value: string): value is PricingMode {
  return value === "fixed" || value === "custom_quote" || value === "deposit_quote";
}

function asFrequency(value: string | null | undefined, fallback: PricingFrequency = "one-time"): PricingFrequency {
  return pricingFrequencies.includes(value as PricingFrequency) ? (value as PricingFrequency) : fallback;
}

function hasLevelRule(tier: ProfileTier) {
  return Boolean(tier.rule_question_key) || (Array.isArray(tier.rule_conditions) && tier.rule_conditions.length > 0);
}

function appliesTo(addon: ProfileAddon, frequency: PricingFrequency) {
  return !addon.frequencies?.length || addon.frequencies.includes(frequency);
}

const byId = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** The provider's order, with an id tie-break so equal sort values do not depend on row order. */
const bySortOrder = <T extends { id: string; sort_order: number }>(left: T, right: T) =>
  left.sort_order - right.sort_order || byId(left.id, right.id);

/** Mirrors the current profile's cadence rule: lowest level, required extras included. */
function fixedCadences(item: ProfilePackage): OfferCadence[] {
  const fallback = asFrequency(item.default_frequency);
  return publiclyEligibleFixedFrequencies(item, fallback)
    .flatMap((frequency) => {
      const levels = item.tiers
        .filter((tier) => tierPricingFrequency(tier, fallback) === frequency)
        .sort((left, right) => left.price - right.price || byId(left.id, right.id));
      const lowest = levels[0];
      if (!lowest) return [];
      const applicable = item.addons.filter((addon) => appliesTo(addon, frequency)).sort(bySortOrder);
      const requiredAddons = applicable.filter((addon) => addon.is_required);
      const requiredCents = requiredAddons.reduce(
        (sum, addon) => sum + (toCents(addon.price) ?? 0) * Math.max(1, addon.min_quantity ?? 1),
        0,
      );
      const ruleBased = levels.some(hasLevelRule);
      const estimate = requiredAddons.some((addon) => addon.price_kind === "range");
      return [{
        frequency,
        baseCents: (toCents(lowest.price) ?? 0) + requiredCents,
        qualifier: estimate ? "estimate" as const : levels.length > 1 || ruleBased ? "from" as const : "exact" as const,
        levels: levels.length,
        ruleBased,
        includes: lowest.includes ?? [],
        boundTier: levels.length === 1 && !ruleBased
          ? { id: lowest.id, name: lowest.name, includes: lowest.includes ?? [] }
          : null,
        requiredAddons,
        optionalAddons: applicable.filter((addon) => !addon.is_required),
      }];
    })
    .sort((left, right) => {
      if (left.frequency === fallback) return -1;
      if (right.frequency === fallback) return 1;
      return pricingFrequencies.indexOf(left.frequency) - pricingFrequencies.indexOf(right.frequency);
    });
}

/** A quote offer's published estimate, qualified, or null when it is quoted without one. */
function quoteEstimateLabel(item: ProfilePackage): string | null {
  const estimates = item.tiers.filter((tier) => tier.price_kind === "starting_at" || tier.price_kind === "range");
  if (!estimates.length) return null;
  const low = Math.min(...estimates.map((tier) => toCents(tier.price) ?? 0));
  if (estimates.some((tier) => tier.price_kind === "starting_at")) return `From ${formatCents(low)} estimate`;
  const high = Math.max(...estimates.map((tier) => toCents(tier.price_max ?? tier.price) ?? 0));
  return `${formatCents(low)}–${formatCents(high)} estimate`;
}

/** Only offers the existing public-eligibility rules allow, in the provider's order. */
export function publishedOffers(packages: readonly ProfilePackage[]): ProfileOffer[] {
  return [...packages].sort(bySortOrder).flatMap((item): ProfileOffer[] => {
    if (!isPricingMode(item.pricing_mode)) return [];
    const base = {
      id: item.id,
      serviceId: item.service_id,
      name: item.name,
      description: item.description,
      scope: item.included_scope ?? [],
      pricingMode: item.pricing_mode,
      defaultFrequency: asFrequency(item.default_frequency),
    };
    if (item.pricing_mode === "fixed") {
      if (!isPubliclyEligibleFixedPackage(item)) return [];
      const cadences = fixedCadences(item);
      if (!cadences.length) return [];
      return [{ ...base, kind: "fixed", cadences, estimateLabel: null, depositCents: null, quoteAddons: [] }];
    }
    if (!isPubliclyEligibleQuotePackage(item)) return [];
    return [{
      ...base,
      kind: "quote",
      cadences: [],
      estimateLabel: quoteEstimateLabel(item),
      depositCents: item.pricing_mode === "deposit_quote" ? toCents(item.deposit_amount) : null,
      quoteAddons: [...item.addons].sort(bySortOrder),
    }];
  });
}

/**
 * A services_catalog name, read as data. Only an own, non-empty string entry counts, so an id
 * taken from a link (such as "__proto__", "constructor" or "toString") never resolves to a
 * member the object inherits.
 */
export function catalogServiceName(names: Record<string, string>, id: string): string | null {
  const name: unknown = Object.prototype.hasOwnProperty.call(names, id) ? names[id] : null;
  return typeof name === "string" && name.trim() ? name : null;
}

export function serviceDisplayName(id: string, names: Record<string, string>) {
  return catalogServiceName(names, id) ?? id.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

/** The provider's published services, each with its offers, in first-offer order. */
export function profileServices(data: Pick<ProfileData, "packages" | "serviceNames">): ProfileService[] {
  const grouped = new Map<string, ProfileOffer[]>();
  for (const offer of publishedOffers(data.packages)) {
    grouped.set(offer.serviceId, [...(grouped.get(offer.serviceId) ?? []), offer]);
  }
  return [...grouped].map(([id, offers]) => ({
    id,
    name: serviceDisplayName(id, data.serviceNames),
    offers,
    mode: offers.every((offer) => offer.kind === "fixed") ? "fixed"
      : offers.every((offer) => offer.kind === "quote") ? "quote" : "mixed",
  }));
}

// ---------------------------------------------------------------------------------------------
// Service selection (the URL's ?service= value is the only source of truth)
// ---------------------------------------------------------------------------------------------

export type ServiceSelection =
  | { kind: "all" }
  | { kind: "service"; service: ProfileService }
  /** The link named a service this provider does not currently publish. */
  | { kind: "unavailable"; requestedId: string };

export function resolveServiceSelection(requested: string | null | undefined, services: readonly ProfileService[]): ServiceSelection {
  const id = requested?.trim();
  if (!id) return { kind: "all" };
  const service = services.find((candidate) => candidate.id === id);
  return service ? { kind: "service", service } : { kind: "unavailable", requestedId: id };
}

/**
 * The current address with only the service choice changed: every other query parameter (in
 * its original spelling and order) and the hash are kept. Returns the path, query and hash, or
 * null when the address already says this.
 */
export function serviceSelectionUrl(href: string, serviceId: string | null, param = "service"): string | null {
  const url = new URL(href);
  const next = serviceId?.trim() || null;
  const names = (pair: string) => {
    try { return decodeURIComponent(pair.split("=", 1)[0].replace(/\+/g, " ")) === param; } catch { return false; }
  };
  const pairs = url.search.slice(1).split("&").filter(Boolean);
  const first = pairs.findIndex(names);
  const kept = pairs.filter((pair) => !names(pair));
  // The choice keeps its place in the query; a new one goes last.
  if (next) kept.splice(first < 0 ? kept.length : first, 0, `${encodeURIComponent(param)}=${encodeURIComponent(next)}`);
  const target = `${url.pathname}${kept.length ? `?${kept.join("&")}` : ""}${url.hash}`;
  return target === `${url.pathname}${url.search}${url.hash}` ? null : target;
}

// ---------------------------------------------------------------------------------------------
// Offer selection within one service
// ---------------------------------------------------------------------------------------------

export type OfferSelection = {
  serviceId: string;
  offerId: string;
  frequency: PricingFrequency;
  /** Optional-extra quantities by add-on id. */
  addons: Record<string, number>;
};

export function defaultOfferSelection(service: ProfileService): OfferSelection {
  const offer = service.offers[0];
  return {
    serviceId: service.id,
    offerId: offer.id,
    frequency: offer.cadences[0]?.frequency ?? offer.defaultFrequency,
    addons: {},
  };
}

const wholeNumber = (value: unknown, fallback: number) => {
  const whole = Math.floor(Number(value ?? fallback));
  return Number.isFinite(whole) ? whole : fallback;
};

/**
 * The published limits for choosing an optional extra. Its quantity is zero (not chosen) or
 * from the minimum to the maximum, the rule the request step's server calculation applies
 * (`addon_quantity`). An extra published with no minimum starts at one.
 */
export function addonQuantityBounds(addon: ProfileAddon): { min: number; max: number } {
  return { min: Math.max(1, wholeNumber(addon.min_quantity, 0)), max: Math.max(1, wholeNumber(addon.max_quantity, 1)) };
}

/**
 * A quantity the published limits allow. Anything below the minimum, or not a number, is zero;
 * anything above the maximum is the maximum. A preview therefore never prices more of an extra
 * than was chosen.
 */
export function normalizeAddonQuantity(addon: ProfileAddon, value: unknown): number {
  const { min, max } = addonQuantityBounds(addon);
  const quantity = typeof value === "number" || typeof value === "string" ? Math.floor(Number(value)) : Number.NaN;
  if (!Number.isFinite(quantity) || quantity < min || min > max) return 0;
  return Math.min(quantity, max);
}

/** One step up or down: the first step up lands on the minimum, a step below it removes the extra. */
export function stepAddonQuantity(addon: ProfileAddon, current: unknown, direction: 1 | -1): number {
  const { min, max } = addonQuantityBounds(addon);
  const quantity = normalizeAddonQuantity(addon, current);
  if (direction > 0) return quantity === 0 ? normalizeAddonQuantity(addon, min) : Math.min(quantity + 1, max);
  return quantity <= min ? 0 : quantity - 1;
}

/** The limits in words when an extra has a minimum above one, so the first step is explained. */
export function addonQuantityNote(addon: ProfileAddon): string | null {
  const { min, max } = addonQuantityBounds(addon);
  if (min > max || min <= 1) return null;
  return min === max ? `Quantity ${min}` : `Minimum ${min}, up to ${max}`;
}

/**
 * Keeps only what is valid for this service: a selection made for another service, a withdrawn
 * offer, a cadence the offer does not publish, or an extra that does not apply is discarded,
 * and each remaining quantity is brought within the extra's published limits.
 */
export function reconcileOfferSelection(service: ProfileService, selection: OfferSelection | null | undefined): OfferSelection {
  const fallback = defaultOfferSelection(service);
  if (!selection || selection.serviceId !== service.id) return fallback;
  const offer = service.offers.find((candidate) => candidate.id === selection.offerId);
  if (!offer) return fallback;
  if (offer.kind === "quote") return { serviceId: service.id, offerId: offer.id, frequency: offer.defaultFrequency, addons: {} };
  const cadence = offer.cadences.find((candidate) => candidate.frequency === selection.frequency) ?? offer.cadences[0];
  const addons: Record<string, number> = {};
  for (const addon of cadence.optionalAddons) {
    const quantity = normalizeAddonQuantity(addon, selection.addons[addon.id]);
    if (quantity > 0) addons[addon.id] = quantity;
  }
  return { serviceId: service.id, offerId: offer.id, frequency: cadence.frequency, addons };
}

export function selectedOffer(service: ProfileService, selection: OfferSelection): { offer: ProfileOffer; cadence: OfferCadence | null } {
  const offer = service.offers.find((candidate) => candidate.id === selection.offerId) ?? service.offers[0];
  const cadence = offer.cadences.find((candidate) => candidate.frequency === selection.frequency) ?? offer.cadences[0] ?? null;
  return { offer, cadence };
}

// ---------------------------------------------------------------------------------------------
// Price presentation
// ---------------------------------------------------------------------------------------------

const cadenceLabels: Record<PricingFrequency, string> = {
  "one-time": "One-time",
  weekly: "Weekly",
  "bi-monthly": "Every two weeks",
  monthly: "Monthly",
  "every-two-months": "Every two months",
  quarterly: "Quarterly",
};

export function cadenceLabel(frequency: PricingFrequency) {
  return cadenceLabels[frequency];
}

/**
 * Billing basis for a published price. Recurring prices are billed per visit today
 * (DEC-2026-048: prepaid bundles are approved but not implemented, so none is shown).
 */
export function billingBasisLabel(frequency: PricingFrequency) {
  return frequency === "one-time" ? "One-time service" : `${cadenceLabels[frequency]} · billed per visit`;
}

export function cadencePriceLabel(cadence: OfferCadence) {
  const amount = formatCents(cadence.baseCents);
  return cadence.qualifier === "exact" ? amount : `From ${amount}`;
}

export function cadenceQualifierNote(cadence: OfferCadence): string | null {
  if (cadence.qualifier === "estimate") return "Includes a required extra priced as an estimate. The provider confirms the final price.";
  if (cadence.ruleBased) return "Set by your answers in the request step.";
  if (cadence.levels > 1) return `${cadence.levels} price levels. The starting price is shown.`;
  return null;
}

/** The quote headline. A deposit is shown apart from it, never folded into the headline. */
export function quoteHeadline() {
  return walkthroughLabel("custom_quote");
}

/** The short offer line a directory card or service row shows. */
export function offerPriceLine(offer: ProfileOffer): { amount: string; detail: string | null; kind: "fixed" | "quote" } {
  if (offer.kind === "quote") return { amount: quoteHeadline(), detail: offer.estimateLabel, kind: "quote" };
  const cadence = offer.cadences[0];
  const basis = cadence.frequency === "one-time" ? null : `${cadenceLabels[cadence.frequency].toLowerCase()}, per visit`;
  return {
    amount: cadencePriceLabel(cadence),
    detail: [basis, offer.scope[0] ?? null].filter(Boolean).join(" · ") || null,
    kind: "fixed",
  };
}

export type PriceLine = { id: string; label: string; amount: string };

export type PricePreview = {
  /** Exact total in cents, or null when any part is a starting price or estimate. */
  totalCents: number | null;
  totalLabel: string;
  lines: PriceLine[];
};

/**
 * Service subtotal for the chosen offer, cadence and optional extras. Presentation arithmetic
 * over published prices only; the request step's server calculation stays authoritative.
 */
export function pricePreview(offer: ProfileOffer, cadence: OfferCadence, addons: Record<string, number>): PricePreview {
  const lines: PriceLine[] = [{ id: "base", label: offer.name, amount: cadencePriceLabel(cadence) }];
  let total = cadence.baseCents;
  let exact = cadence.qualifier === "exact";
  for (const addon of cadence.optionalAddons) {
    const quantity = normalizeAddonQuantity(addon, addons[addon.id]);
    if (quantity <= 0) continue;
    const unit = toCents(addon.price) ?? 0;
    const range = addon.price_kind === "range" && addon.price_max != null;
    if (range) exact = false;
    total += unit * quantity;
    lines.push({
      id: addon.id,
      label: quantity > 1 ? `${addon.name} × ${quantity}` : addon.name,
      amount: range ? `From ${formatCents(unit * quantity)}` : formatCents(unit * quantity),
    });
  }
  return {
    totalCents: exact ? total : null,
    totalLabel: exact ? formatCents(total) : `From ${formatCents(total)}`,
    lines,
  };
}

export function addonUnitLabel(addon: ProfileAddon) {
  const label = addonPriceLabel({
    price_kind: addon.price_kind === "range" ? "range" : "exact",
    price: addon.price,
    price_max: addon.price_max,
    unit_label: addon.unit_label,
  });
  return addon.price_kind === "range" ? `${label} estimate` : label;
}

// ---------------------------------------------------------------------------------------------
// Directory card
// ---------------------------------------------------------------------------------------------

export type CardOffer = { service: ProfileService; offer: ProfileOffer; line: ReturnType<typeof offerPriceLine> };

/**
 * What the directory knows about the service a card should lead with.
 * - service: an explicit service context. Only that service's offer may lead.
 * - category: a category group. The lead offer must belong to a service in that category, so a
 *   card never answers one category with another category's price.
 * - all: no narrower context. The provider's first published offer leads.
 * A free-text search is not a service context; it does not narrow this.
 */
export type CardContext =
  | { kind: "all" }
  | { kind: "service"; serviceId: string }
  | { kind: "category"; serviceIds: ReadonlySet<string> };

/** The offer a directory card shows, or null when the context has no published offer. */
export function cardOfferFor(services: readonly ProfileService[], context: CardContext): CardOffer | null {
  const service = context.kind === "service"
    ? services.find((candidate) => candidate.id === context.serviceId)
    : context.kind === "category"
      ? services.find((candidate) => context.serviceIds.has(candidate.id))
      : services[0];
  const offer = service?.offers[0];
  return service && offer ? { service, offer, line: offerPriceLine(offer) } : null;
}

/**
 * The offer a directory card shows. With a service context it is that service's first
 * published offer, or null (the card is left out of that result). Without one it is the
 * provider's first published offer; a provider-chosen lead service has no data source yet.
 */
export function cardOffer(services: readonly ProfileService[], serviceId: string | null): CardOffer | null {
  return cardOfferFor(services, serviceId ? { kind: "service", serviceId } : { kind: "all" });
}

/**
 * no_offer: the provider publishes no offer in this context. unavailable: the published offers
 * could not be read. The two are never merged, and neither states an amount.
 */
export type CardUnpricedReason = "no_offer" | "unavailable";

export type CardUnpricedLine = { reason: CardUnpricedReason; amount: string; detail: string };

/** The price slot of a card with no offer to show. It stays truthful about which case it is. */
export function cardUnpricedLine(reason: CardUnpricedReason): CardUnpricedLine {
  return reason === "unavailable"
    ? {
      reason,
      amount: "Pricing unavailable right now",
      detail: "We could not read this provider's published prices. Their profile has the rest of their details.",
    }
    : {
      reason,
      amount: "No published price yet",
      detail: "This provider has not published a price here. Their profile shows what they offer.",
    };
}

// ---------------------------------------------------------------------------------------------
// Media and questions
// ---------------------------------------------------------------------------------------------

export type ServiceMedia = { items: ProfileMedia[]; general: boolean };

/**
 * Media for a service: items linked to it first; otherwise the provider's unlinked media,
 * flagged general so the profile can label it. Media linked to another service is never used.
 */
export function mediaForService(media: readonly ProfileMedia[], serviceId: string | null): ServiceMedia {
  const sorted = [...media].sort(bySortOrder);
  const general = sorted.filter((item) => !item.service_id);
  if (!serviceId) return { items: general, general: true };
  const linked = sorted.filter((item) => item.service_id === serviceId);
  return linked.length ? { items: linked, general: false } : { items: general, general: true };
}

export function questionsForService(questions: readonly ProfileQuestion[], serviceId: string) {
  return questions.filter((question) => question.service_id === serviceId);
}

// ---------------------------------------------------------------------------------------------
// ZIP check
// ---------------------------------------------------------------------------------------------

export type ZipCheck =
  | { status: "invalid" }
  /** In the provider's listed area. Listing is not booking eligibility. */
  | { status: "listed"; zip: string; city: string | null }
  /** A Marketplace ZIP the provider has not listed. */
  | { status: "outside_provider"; zip: string }
  /** Not in the Marketplace allowlist. */
  | { status: "outside_marketplace"; zip: string }
  /** Coverage could not be read, or the provider has listed no ZIPs. */
  | { status: "unknown"; zip: string; reason: "unreadable" | "unlisted" };

export function checkZip(
  input: string,
  serviceArea: ProfileServiceArea | null,
  marketplaceZips: readonly string[] | null,
): ZipCheck {
  const zip = input.trim();
  if (!/^\d{5}$/.test(zip)) return { status: "invalid" };
  if (!serviceArea || !marketplaceZips) return { status: "unknown", zip, reason: "unreadable" };
  if (!marketplaceZips.includes(zip)) return { status: "outside_marketplace", zip };
  if (!serviceArea.hasListedZips) return { status: "unknown", zip, reason: "unlisted" };
  const area = serviceArea.areas.find((candidate) => candidate.zips.includes(zip));
  return area ? { status: "listed", zip, city: area.city } : { status: "outside_provider", zip };
}

// ---------------------------------------------------------------------------------------------
// Next step (current access states: TRACE-103 / the MDS R0 addendum)
// ---------------------------------------------------------------------------------------------

/**
 * Who is looking, as the live admission read (useTrialAccess, TRACE-103) reports it.
 * - public: the gallery's stand-in for anyone not admitted.
 * - signed_out / not_homeowner: join early access.
 * - waiting / unavailable / revoked: a signed-in homeowner whose booking is closed; the
 *   existing request route explains which, and keeps history and support reachable.
 * - loading / error: admission is not known. Nothing is offered as bookable, and an error is
 *   never read as access.
 * - invited: an admitted homeowner. The request command still enforces admission itself.
 */
export type ProfileViewer =
  | "public" | "invited" | "signed_out" | "not_homeowner"
  | "waiting" | "unavailable" | "revoked" | "loading" | "error";

/** The admission read as a profile viewer. Only an active cell with the homeowner role invites. */
export function profileViewer(
  trial: { status: "loading" } | { status: "signed_out" } | { status: "error" } | { status: "ready"; access: { homeowner: boolean; cells: readonly { state: string }[] } },
): ProfileViewer {
  if (trial.status !== "ready") return trial.status;
  const { homeowner, cells } = trial.access;
  if (homeowner && cells.some((cell) => cell.state === "active")) return "invited";
  if (!homeowner) return "not_homeowner";
  if (cells.some((cell) => cell.state === "unavailable")) return "unavailable";
  if (cells.some((cell) => cell.state === "revoked")) return "revoked";
  return "waiting";
}

export type NextStepKind = "request" | "early_access" | "closed" | "retry" | "pending" | "choose_service";

/**
 * The profile's single next action. Wording for a visitor who is not admitted is the live
 * early-access wording; a design image never overrides it. In the All services view an invited
 * homeowner chooses a service first, so the request keeps this provider bound to it.
 */
export function nextStepCopy(
  viewer: ProfileViewer,
  view: "all" | "fixed" | "quote",
  options: { hasServices?: boolean } = {},
): { label: string; note: string; kind: NextStepKind } {
  switch (viewer) {
    case "loading":
      return { label: "Checking booking access", note: "One moment while we check whether your account can book.", kind: "pending" };
    case "error":
      return { label: "Check booking access again", note: "We couldn't confirm your booking access. Nothing has been requested.", kind: "retry" };
    case "waiting":
      return { label: "See my early-access status", note: "Your account isn't invited to book yet. Booking opens by invitation.", kind: "closed" };
    case "revoked":
      return { label: "Go to my dashboard", note: "Your invitation to book has ended. Your existing requests stay available.", kind: "closed" };
    case "unavailable":
      return { label: "Go to my dashboard", note: "Your invited service or area isn't active right now, so new requests are closed.", kind: "closed" };
    case "invited":
      if (view === "fixed") return { label: "Continue to request", note: "Confirm your home and scheduling details next.", kind: "request" };
      if (view === "quote") return { label: "Request a quote", note: "Mercurius will coordinate scope and pricing before booking is confirmed.", kind: "request" };
      return options.hasServices === false
        ? { label: "Request this provider", note: "Mercurius will confirm scope, availability and price before booking.", kind: "request" }
        : { label: "Request this provider", note: "Choose a service first, so your request goes to this provider.", kind: "choose_service" };
    default:
      return { label: EARLY_ACCESS_CTA, note: "Booking opens by invitation as services are ready in your area.", kind: "early_access" };
  }
}

// ---------------------------------------------------------------------------------------------
// Directory context and return (TRACE-156 P2B)
// ---------------------------------------------------------------------------------------------

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SEARCH = 100;

/** A service or category id as the catalog writes them, or null. */
export function validSlug(value: string | null | undefined): string | null {
  const id = value?.trim();
  return id && SLUG.test(id) ? id : null;
}

export function validProviderId(value: string | null | undefined): string | null {
  const id = value?.trim();
  return id && UUID.test(id) ? id : null;
}

/** Directory search text as carried in a link: control characters removed, bounded length. */
export function validSearch(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_SEARCH);
  return text || null;
}

/** Where a profile was opened from in the directory. Every field is validated, never a URL. */
export type DirectoryContext = { search: string | null; categoryId: string | null };

export function directoryContextFrom(params: Pick<URLSearchParams, "get">): DirectoryContext {
  return { search: validSearch(params.get("q")), categoryId: validSlug(params.get("category")) };
}

/**
 * The profile link a directory card opens. `service` is the card's lead service (validated);
 * `q` and `category` carry the directory's state so the profile can build its return link.
 */
export function providerProfileHref(providerId: string, options: { serviceId?: string | null } & Partial<DirectoryContext> = {}): string {
  const params = new URLSearchParams();
  const service = validSlug(options.serviceId);
  const search = validSearch(options.search);
  const category = validSlug(options.categoryId);
  if (service) params.set("service", service);
  if (search) params.set("q", search);
  if (category) params.set("category", category);
  const query = params.toString();
  return `/providers/${encodeURIComponent(providerId)}${query ? `?${query}` : ""}`;
}

/**
 * The directory link a profile returns to. It is always built here from validated parts —
 * never taken from the address — so it cannot point anywhere but the directory. `provider`
 * asks the directory to bring that provider's card back into view and focus it.
 */
export function providerDirectoryHref(context: Partial<DirectoryContext> & { providerId?: string | null } = {}): string {
  const params = new URLSearchParams();
  const search = validSearch(context.search);
  const category = validSlug(context.categoryId);
  const provider = validProviderId(context.providerId);
  if (search) params.set("q", search);
  if (category) params.set("category", category);
  if (provider) params.set("provider", provider);
  const query = params.toString();
  return `/providers${query ? `?${query}` : ""}`;
}

// ---------------------------------------------------------------------------------------------
// Announcements and identity
// ---------------------------------------------------------------------------------------------

/** One sentence for the live region after the service view changes. */
export function selectionAnnouncement(providerName: string, selection: ServiceSelection, services: readonly ProfileService[]) {
  if (selection.kind === "service") {
    const line = offerPriceLine(selection.service.offers[0]);
    return `Showing ${selection.service.name}: ${selection.service.offers[0].name}, ${line.amount}.`;
  }
  const count = services.length;
  const all = `Showing all services from ${providerName}: ${count} published service${count === 1 ? "" : "s"}.`;
  return selection.kind === "unavailable" ? `The linked service is not currently offered. ${all}` : all;
}

export function providerInitials(name: string) {
  const words = name.trim().split(/\s+/).filter((word) => /^[A-Za-z0-9]/.test(word));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

export type LogoShape = "wide" | "square" | "tall";

export function logoShape(width: number, height: number): LogoShape {
  if (!width || !height) return "square";
  const ratio = width / height;
  return ratio >= 1.6 ? "wide" : ratio <= 0.8 ? "tall" : "square";
}
