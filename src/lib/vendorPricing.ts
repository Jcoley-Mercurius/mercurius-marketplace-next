export const pricingFrequencies = ["one-time", "weekly", "bi-monthly", "monthly", "quarterly"] as const;

export type PricingFrequency = (typeof pricingFrequencies)[number];

export type PriceTierLike = {
  price: unknown;
};

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

export function isPubliclyEligibleFixedPackage<TTier extends PriceTierLike>(
  item: PublicPackageLike<TTier>,
): boolean {
  return item.is_active
    && item.needs_review !== true
    && item.pricing_mode === "fixed"
    && hasValidFixedTiers(item.tiers);
}

export function isPubliclyEligibleQuotePackage(
  item: Omit<PublicPackageLike, "tiers">,
): boolean {
  return item.is_active
    && item.needs_review !== true
    && (item.pricing_mode === "custom_quote" || item.pricing_mode === "deposit_quote");
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
