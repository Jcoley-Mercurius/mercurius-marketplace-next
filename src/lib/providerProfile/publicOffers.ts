// TRACE-156 (P2A): the published offers behind the provider directory's cards.
//
// Columns, filters and ordering follow the public provider storefront
// (src/app/providers/[id]/page.tsx) so the directory and the profile publish the same offers.
// Reads are batched by the listed providers: one packages read, then one tiers read and one
// add-ons read for the packages that came back. No card reads on its own.
//
// A failed supporting read never becomes a cheaper price or a claim that a provider publishes
// nothing: the result says the published offers could not be read, and the caller shows its
// unpriced card instead.

import { createClient } from "@/lib/supabase/client";
import type { ProfileAddon, ProfilePackage, ProfileTier } from "@/lib/providerProfile/model";
import { isPricingFrequency, type PricingFrequency } from "@/lib/vendorPricing";

const PACKAGE_COLUMNS =
  "id, contractor_id, service_id, name, description, pricing_mode, default_frequency, deposit_amount, is_active, needs_review, sort_order, included_scope";
const TIER_COLUMNS =
  "id, package_id, name, price, frequency, price_kind, price_max, includes, rule_question_key, rule_conditions, sort_order";
const ADDON_COLUMNS =
  "id, package_id, name, description, price, price_kind, price_max, unit_label, min_quantity, max_quantity, is_required, frequencies, sort_order";

/** PostgREST takes the identifiers in the query string, so a long directory reads in batches. */
const BATCH = 100;

export type PackageRow = {
  id: string;
  contractor_id: string;
  service_id: string;
  name: string;
  description: string | null;
  pricing_mode: string;
  default_frequency: string | null;
  deposit_amount: number | string | null;
  is_active: boolean;
  needs_review: boolean | null;
  sort_order: number | null;
  included_scope: string[] | null;
};

export type TierRow = {
  id: string;
  package_id: string;
  name: string;
  price: number | string;
  frequency: string | null;
  price_kind: string | null;
  price_max: number | string | null;
  includes: string[] | null;
  rule_question_key: string | null;
  rule_conditions: unknown;
  sort_order: number | null;
};

export type AddonRow = {
  id: string;
  package_id: string;
  name: string;
  description: string | null;
  price: number | string;
  price_kind: string | null;
  price_max: number | string | null;
  unit_label: string | null;
  min_quantity: number | null;
  max_quantity: number | null;
  is_required: boolean | null;
  frequencies: string[] | null;
  sort_order: number | null;
};

export type ProviderOffers =
  /**
   * Published packages by provider id. A provider with no entry publishes no offer; that is a
   * fact about the provider, not a failed read.
   */
  | { status: "ready"; packages: Map<string, ProfilePackage[]> }
  /** A required read failed. No amount is shown for anyone, and no absence is asserted. */
  | { status: "unavailable" };

function chunk<T>(items: readonly T[], size = BATCH): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}

const order = <T extends { sort_order: number }>(left: T, right: T, leftId: string, rightId: string) =>
  left.sort_order - right.sort_order || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0);

const sortOrder = (value: number | null) => (Number.isFinite(value) ? Number(value) : 0);
const amount = (value: number | string | null | undefined) => (value === null || value === undefined ? null : Number(value));

function toTier(row: TierRow, fallback: PricingFrequency): ProfileTier {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    frequency: isPricingFrequency(row.frequency) ? row.frequency : fallback,
    price_kind: row.price_kind,
    price_max: amount(row.price_max),
    includes: row.includes,
    rule_question_key: row.rule_question_key,
    rule_conditions: row.rule_conditions,
    sort_order: sortOrder(row.sort_order),
  };
}

function toAddon(row: AddonRow): ProfileAddon {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    price_kind: row.price_kind,
    price_max: amount(row.price_max),
    unit_label: row.unit_label,
    min_quantity: row.min_quantity,
    max_quantity: row.max_quantity,
    is_required: row.is_required,
    frequencies: row.frequencies,
    sort_order: sortOrder(row.sort_order),
  };
}

/**
 * Rows to packages, grouped by provider. Eligibility, price meaning and cadence stay with the
 * shared helpers the model already calls; this only assembles the shapes they read. Packages,
 * levels and extras are ordered by the provider's sort order with an id tie-break, so equal
 * sort values do not depend on the order rows arrived in.
 */
export function groupPublicPackages(
  packages: readonly PackageRow[],
  tiers: readonly TierRow[],
  addons: readonly AddonRow[],
): Map<string, ProfilePackage[]> {
  const grouped = new Map<string, ProfilePackage[]>();
  const ordered = [...packages].sort((left, right) => order(
    { sort_order: sortOrder(left.sort_order) }, { sort_order: sortOrder(right.sort_order) }, left.id, right.id,
  ));

  for (const row of ordered) {
    const fallback: PricingFrequency = isPricingFrequency(row.default_frequency) ? row.default_frequency : "one-time";
    const item: ProfilePackage = {
      id: row.id,
      service_id: row.service_id,
      name: row.name,
      description: row.description,
      pricing_mode: row.pricing_mode,
      default_frequency: fallback,
      deposit_amount: amount(row.deposit_amount),
      is_active: row.is_active,
      needs_review: row.needs_review,
      sort_order: sortOrder(row.sort_order),
      included_scope: row.included_scope,
      tiers: tiers
        .filter((tier) => tier.package_id === row.id)
        .map((tier) => toTier(tier, fallback))
        .sort((left, right) => order(left, right, left.id, right.id)),
      addons: addons
        .filter((addon) => addon.package_id === row.id)
        .map(toAddon)
        .sort((left, right) => order(left, right, left.id, right.id)),
    };
    grouped.set(row.contractor_id, [...(grouped.get(row.contractor_id) ?? []), item]);
  }
  return grouped;
}

/**
 * The published offers for the providers the public listing returned. The listing stays the
 * authority on who appears: a package read for an id that is not listed is never requested.
 */
export async function fetchPublicProviderOffers(
  providerIds: readonly string[],
  client?: ReturnType<typeof createClient>,
): Promise<ProviderOffers> {
  const ids = [...new Set(providerIds.filter(Boolean))];
  if (!ids.length) return { status: "ready", packages: new Map() };

  const supabase = client ?? createClient();
  const packageRows: PackageRow[] = [];
  for (const batch of chunk(ids)) {
    const result = await supabase
      .from("vendor_packages")
      .select(PACKAGE_COLUMNS)
      .in("contractor_id", batch)
      .eq("is_active", true)
      .eq("needs_review", false)
      .order("sort_order");
    if (result.error) {
      console.warn("Public provider offers are unavailable", result.error);
      return { status: "unavailable" };
    }
    packageRows.push(...((result.data ?? []) as unknown as PackageRow[]));
  }
  if (!packageRows.length) return { status: "ready", packages: new Map() };

  const packageIds = packageRows.map((row) => row.id);
  const tierRows: TierRow[] = [];
  const addonRows: AddonRow[] = [];
  for (const batch of chunk(packageIds)) {
    const [tiers, addons] = await Promise.all([
      supabase.from("package_tiers").select(TIER_COLUMNS).in("package_id", batch).order("sort_order"),
      supabase
        .from("package_addons")
        .select(ADDON_COLUMNS)
        .in("package_id", batch)
        // The storefront's rule: only the provider's own, offered extras are public.
        .is("template_addon_id", null)
        .eq("is_offered", true)
        .order("sort_order"),
    ]);
    // A level or extra that cannot be read would lower a published starting price, so the whole
    // result is reported unreadable rather than priced from what did arrive.
    if (tiers.error || addons.error) {
      console.warn("Public provider offer details are unavailable", tiers.error ?? addons.error);
      return { status: "unavailable" };
    }
    tierRows.push(...((tiers.data ?? []) as unknown as TierRow[]));
    addonRows.push(...((addons.data ?? []) as unknown as AddonRow[]));
  }

  return { status: "ready", packages: groupPublicPackages(packageRows, tierRows, addonRows) };
}
