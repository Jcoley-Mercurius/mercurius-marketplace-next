export const pricingFrequencies = ["one-time", "weekly", "bi-monthly", "monthly", "quarterly"] as const;

export type PricingFrequency = (typeof pricingFrequencies)[number];

export type PriceTierLike = {
  price: unknown;
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
