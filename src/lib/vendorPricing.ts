export const pricingFrequencies = ["one-time", "weekly", "bi-monthly", "monthly", "quarterly"] as const;

export type PricingFrequency = (typeof pricingFrequencies)[number];

export type PackageQualifyingQuestion = {
  id?: string;
  package_id?: string;
  question_key: string;
  question_label: string;
  input_type: "number" | "select" | "text";
  unit?: string | null;
  options?: unknown;
  is_required?: boolean | null;
  sort_order: number;
};

export type PublicPackageSelection = {
  packageId: string;
  tierId?: string;
  pricingMode: "fixed" | "deposit_quote" | "custom_quote";
  questions?: PackageQualifyingQuestion[];
  /** Optional public-facing package substance carried with the selected live tier. */
  packageName?: string;
  packageDescription?: string | null;
  tierName?: string;
  tierIncludes?: string[];
};

export type PriceTierLike = {
  price: unknown;
  frequency?: unknown;
};

export type CatalogPriceGuidanceLike = {
  weekly_price?: unknown;
  monthly_price?: unknown;
  one_time_price?: unknown;
};

export type CustomPackagePriceReview = {
  needsReview: boolean;
  minPrice: number;
  maxPrice: number;
  referencePrice: number | null;
  source: "managed_template" | "service_catalog" | "absolute_fallback";
  outOfBandTierIndexes: number[];
};

export const CUSTOM_PRICE_MIN_MULTIPLIER = 0.25;
export const CUSTOM_PRICE_MAX_MULTIPLIER = 4;
export const CUSTOM_PRICE_FALLBACK_MIN = 20;
export const CUSTOM_PRICE_FALLBACK_MAX = 5_000;

export const MAX_PROMOTION_PERCENT = 80;

export type PromotionType = "percent_off" | "fixed_price";
export type PromotionStatus = "scheduled" | "active" | "expired" | "disabled" | "invalid";

export type PackagePromotion = {
  id: string;
  package_id: string;
  promotion_type: PromotionType;
  percent_off: number | null;
  fixed_price: number | null;
  label: string | null;
  starts_at: string;
  ends_at: string;
  is_enabled: boolean;
  created_at?: string;
  updated_at?: string;
};

export type EffectiveTierPrice = {
  basePrice: number;
  effectivePrice: number;
  promotionId: string | null;
  promotionLabel: string | null;
  isPromotionEffective: boolean;
};

export type PublicPackageLike<TTier extends PriceTierLike = PriceTierLike> = {
  is_active: boolean;
  needs_review?: boolean | null;
  pricing_mode: string;
  tiers: readonly TTier[];
};

export function isPricingFrequency(value: unknown): value is PricingFrequency {
  return typeof value === "string" && pricingFrequencies.includes(value as PricingFrequency);
}

export function isPositiveTierPrice(value: unknown): boolean {
  const price = Number(value);
  return Number.isFinite(price) && price > 0;
}

/**
 * A fixed package is valid only when every saved tier has a real positive price.
 * This prevents a partially configured tier set from advertising its lowest valid row.
 */
export function hasValidFixedTiers(tiers: readonly PriceTierLike[]): boolean {
  return tiers.length > 0 && tiers.every((tier) => isPositiveTierPrice(tier.price));
}

export function tierPricingFrequency(
  tier: PriceTierLike,
  fallback: PricingFrequency,
): PricingFrequency {
  return isPricingFrequency(tier.frequency) ? tier.frequency : fallback;
}

export function publiclyEligibleFixedFrequencies<TTier extends PriceTierLike>(
  item: PublicPackageLike<TTier>,
  fallback: PricingFrequency,
): PricingFrequency[] {
  if (!isPubliclyEligibleFixedPackage(item)) return [];
  return [...new Set(item.tiers.map((tier) => tierPricingFrequency(tier, fallback)))];
}

export function evaluateCustomPackageFrequencyPriceReviews({
  tiers,
  defaultFrequency,
  catalog,
  templateRange,
}: {
  tiers: readonly PriceTierLike[];
  defaultFrequency: PricingFrequency;
  catalog?: CatalogPriceGuidanceLike | null;
  templateRange?: { minPrice: number; maxPrice: number } | null;
}): Array<CustomPackagePriceReview & { frequency: PricingFrequency }> {
  const grouped = new Map<PricingFrequency, PriceTierLike[]>();
  tiers.forEach((tier) => {
    const frequency = tierPricingFrequency(tier, defaultFrequency);
    grouped.set(frequency, [...(grouped.get(frequency) ?? []), tier]);
  });
  return [...grouped.entries()].map(([frequency, frequencyTiers]) => ({
    frequency,
    ...evaluateCustomPackagePriceReview({
      tiers: frequencyTiers,
      frequency,
      catalog,
      templateRange,
    }),
  }));
}

/**
 * Soft-launch review guardrail for self-serve custom packages.
 *
 * One-time services reuse the broadest active managed-template range when one
 * exists. Other cadences use a deliberately broad 25%–400% band around the
 * service catalog guidance price. The absolute fallback catches only obvious
 * outliers when Mercurius has not configured either guidance source.
 */
export function evaluateCustomPackagePriceReview({
  tiers,
  frequency,
  catalog,
  templateRange,
}: {
  tiers: readonly PriceTierLike[];
  frequency: PricingFrequency;
  catalog?: CatalogPriceGuidanceLike | null;
  templateRange?: { minPrice: number; maxPrice: number } | null;
}): CustomPackagePriceReview {
  const validTemplateRange =
    frequency === "one-time" &&
    Number.isFinite(templateRange?.minPrice) &&
    Number.isFinite(templateRange?.maxPrice) &&
    Number(templateRange?.minPrice) > 0 &&
    Number(templateRange?.maxPrice) >= Number(templateRange?.minPrice)
      ? {
          minPrice: roundCurrency(Number(templateRange?.minPrice)),
          maxPrice: roundCurrency(Number(templateRange?.maxPrice)),
        }
      : null;
  const referencePrice = catalogGuidancePrice(catalog, frequency);

  const range = validTemplateRange
    ? {
        ...validTemplateRange,
        referencePrice: null,
        source: "managed_template" as const,
      }
    : referencePrice
      ? {
          minPrice: roundCurrency(
            Math.max(1, referencePrice * CUSTOM_PRICE_MIN_MULTIPLIER),
          ),
          maxPrice: roundCurrency(
            referencePrice * CUSTOM_PRICE_MAX_MULTIPLIER,
          ),
          referencePrice,
          source: "service_catalog" as const,
        }
      : {
          minPrice: CUSTOM_PRICE_FALLBACK_MIN,
          maxPrice: CUSTOM_PRICE_FALLBACK_MAX,
          referencePrice: null,
          source: "absolute_fallback" as const,
        };

  const outOfBandTierIndexes = tiers.flatMap((tier, index) => {
    const price = Number(tier.price);
    return !Number.isFinite(price) ||
      price < range.minPrice ||
      price > range.maxPrice
      ? [index]
      : [];
  });

  return {
    ...range,
    needsReview: tiers.length > 0 && outOfBandTierIndexes.length > 0,
    outOfBandTierIndexes,
  };
}

export function isPubliclyEligibleFixedPackage<TTier extends PriceTierLike>(
  item: PublicPackageLike<TTier>,
): boolean {
  return item.is_active
    && item.needs_review !== true
    && item.pricing_mode === "fixed"
    && hasValidFixedTiers(item.tiers);
}

export function isPubliclyEligibleQuotePackage(
  item: Omit<PublicPackageLike, "tiers"> & { deposit_amount?: unknown },
): boolean {
  return item.is_active
    && item.needs_review !== true
    && (item.pricing_mode === "custom_quote"
      || (item.pricing_mode === "deposit_quote" && isPositiveTierPrice(item.deposit_amount)));
}

export function isPromotionType(value: unknown): value is PromotionType {
  return value === "percent_off" || value === "fixed_price";
}

export function promotionStatus(promotion: PackagePromotion, serverNow: string | null): PromotionStatus {
  if (!promotion.is_enabled) return "disabled";
  if (!serverNow) return "invalid";
  const now = Date.parse(serverNow);
  const starts = Date.parse(promotion.starts_at);
  const ends = Date.parse(promotion.ends_at);
  if (![now, starts, ends].every(Number.isFinite) || ends <= starts) return "invalid";
  if (now < starts) return "scheduled";
  if (now >= ends) return "expired";
  return "active";
}

/**
 * Resolve a tier without mutating its authoritative base price. If any promotion
 * input is ambiguous or invalid, the public result safely falls back to base.
 */
export function resolveEffectiveTierPrice(
  basePriceValue: unknown,
  promotion: PackagePromotion | null | undefined,
  serverNow: string | null,
  tierCount: number,
): EffectiveTierPrice {
  const basePrice = Number(basePriceValue);
  const safeBasePrice = Number.isFinite(basePrice) && basePrice > 0 ? roundCurrency(basePrice) : 0;
  const fallback = { basePrice: safeBasePrice, effectivePrice: safeBasePrice, promotionId: null, promotionLabel: null, isPromotionEffective: false };
  if (!safeBasePrice || !promotion || promotionStatus(promotion, serverNow) !== "active") return fallback;

  let effectivePrice = safeBasePrice;
  if (promotion.promotion_type === "percent_off") {
    const percent = Number(promotion.percent_off);
    if (!Number.isFinite(percent) || percent <= 0 || percent > MAX_PROMOTION_PERCENT) return fallback;
    effectivePrice = roundCurrency(safeBasePrice * (1 - percent / 100));
  } else if (promotion.promotion_type === "fixed_price") {
    const fixedPrice = Number(promotion.fixed_price);
    if (tierCount !== 1 || !Number.isFinite(fixedPrice) || fixedPrice <= 0 || fixedPrice >= safeBasePrice) return fallback;
    effectivePrice = roundCurrency(fixedPrice);
  } else {
    return fallback;
  }

  if (effectivePrice <= 0 || effectivePrice >= safeBasePrice) return fallback;
  return {
    basePrice: safeBasePrice,
    effectivePrice,
    promotionId: promotion.id,
    promotionLabel: promotion.label?.trim() || null,
    isPromotionEffective: true,
  };
}

export function validatePromotion(
  input: Pick<PackagePromotion, "promotion_type" | "percent_off" | "fixed_price" | "starts_at" | "ends_at">,
  baseTierPrices: readonly unknown[],
): string | null {
  const prices = baseTierPrices.map(Number);
  if (!prices.length || prices.some((price) => !Number.isFinite(price) || price <= 0)) return "The package needs valid positive base prices before a promotion can be added.";
  const starts = Date.parse(input.starts_at);
  const ends = Date.parse(input.ends_at);
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return "Choose both a promotion start and end time.";
  if (ends <= starts) return "The promotion end must be after its start.";
  if (input.promotion_type === "percent_off") {
    const percent = Number(input.percent_off);
    if (!Number.isFinite(percent) || percent <= 0 || percent > MAX_PROMOTION_PERCENT) return `Percent off must be between 1% and ${MAX_PROMOTION_PERCENT}%.`;
    return null;
  }
  if (prices.length !== 1) return "A fixed promotional price is available only for single-tier packages.";
  const fixedPrice = Number(input.fixed_price);
  if (!Number.isFinite(fixedPrice) || fixedPrice <= 0 || fixedPrice >= prices[0]) return "The promotional price must be greater than $0 and lower than the base price.";
  return null;
}

/** Multiple enabled records are treated as ambiguous and never affect public prices. */
export function promotionForPackage(promotions: readonly PackagePromotion[], packageId: string, includeDisabled = false) {
  const matches = promotions.filter((promotion) => promotion.package_id === packageId);
  const enabled = matches.filter((promotion) => promotion.is_enabled);
  if (enabled.length === 1) return enabled[0];
  if (enabled.length > 1 || !includeDisabled) return undefined;
  return [...matches].sort((left, right) => Date.parse(right.updated_at ?? right.created_at ?? "") - Date.parse(left.updated_at ?? left.created_at ?? ""))[0];
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function catalogGuidancePrice(
  catalog: CatalogPriceGuidanceLike | null | undefined,
  frequency: PricingFrequency,
) {
  if (!catalog) return null;
  const weekly = positiveNumber(catalog.weekly_price);
  const monthly = positiveNumber(catalog.monthly_price);
  const oneTime = positiveNumber(catalog.one_time_price);
  const candidate =
    frequency === "weekly"
      ? weekly ?? monthly ?? oneTime
      : frequency === "monthly" || frequency === "bi-monthly"
        ? monthly ?? oneTime
        : frequency === "quarterly"
          ? oneTime ?? monthly
          : oneTime ?? monthly;
  return candidate == null ? null : roundCurrency(candidate);
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
