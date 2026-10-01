"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  serviceCategories as fallbackCategories,
  services as fallbackServices,
  type Service,
  type ServiceCategory,
  type ServiceFrequency,
  type ServiceProviderProof,
} from "@/lib/serviceData";
import {
  isPubliclyEligibleFixedPackage,
  isPubliclyEligibleQuotePackage,
  packagesFromListedProviders,
  pricingFrequencies,
  promotionForPackage,
  publiclyEligibleFixedFrequencies,
  resolveEffectiveTierPrice,
  tierPricingFrequency,
  type PackageQualifyingQuestion,
  type PackagePromotion,
  type PublicPackageSelection,
} from "@/lib/vendorPricing";

type CategoryRow = { id: string; name: string; icon: string; description: string };
type ServiceRow = { id: string; name: string; category_id: string; tags: string[] | null; icon: string; descriptor: string; is_popular: boolean | null; weekly_price: number | null; monthly_price: number; one_time_price: number; default_frequency: ServiceFrequency; available_frequencies: ServiceFrequency[] | null };
type ContractorProofRow = { id: string; name: string; logo_url: string | null; marketing_enabled: boolean | null; is_active: boolean | null };
type PackageRow = { id: string; contractor_id: string; service_id: string; name: string; description: string | null; default_frequency: ServiceFrequency; pricing_mode: string; deposit_amount: number | null; is_active: boolean; needs_review: boolean | null; contractors: ContractorProofRow | ContractorProofRow[] | null };
type TierRow = { id: string; package_id: string; name: string; price: number | null; frequency: ServiceFrequency | null; includes: string[] | null };
type QuestionRow = PackageQualifyingQuestion & { package_id: string };
type PricePoint = { base: number; effective: number; promotionId?: string; promotionLabel?: string; selection: PublicPackageSelection; provider: RankedProviderProof | null };
type PriceBucket = { weekly?: PricePoint; monthly?: PricePoint; biMonthly?: PricePoint; quarterly?: PricePoint; oneTime?: PricePoint; anyMin?: number; anyMinProviderId?: string };
type RankedProviderProof = ServiceProviderProof & { marketingEnabled: boolean };
type ProviderCoverage = { provider: RankedProviderProof; frequencies: Set<ServiceFrequency> };

export function useServiceCatalog() {
  const [services, setServices] = useState<Service[]>(() => fallbackServices.map((service) => ({ ...service, availability: "sourcing" })));
  const [categories, setCategories] = useState<ServiceCategory[]>(fallbackCategories);
  const [loading, setLoading] = useState(true);
  // A failed lookup is reported, never presented as a catalog without live supply.
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    const load = () => { void Promise.all([
      supabase.from("service_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("services_catalog").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("vendor_packages").select("id, service_id, name, description, default_frequency, pricing_mode, deposit_amount, is_active, needs_review, contractor_id, contractors!inner(id, name, logo_url, marketing_enabled, is_active)").eq("is_active", true).eq("needs_review", false).eq("contractors.is_active", true),
      supabase.from("package_tiers").select("id, package_id, name, price, frequency, includes"),
      supabase.from("package_promotions").select("id, package_id, promotion_type, percent_off, fixed_price, label, starts_at, ends_at, is_enabled, created_at, updated_at").eq("is_enabled", true),
      supabase.rpc("pricing_server_now"),
    ]).then(async ([categoryResult, serviceResult, packageResult, tierResult, promotionResult, clockResult]) => {
      if (!active) return;
      const activePackageRows = (packageResult.data ?? []) as unknown as PackageRow[];
      const listingResult = activePackageRows.length
        ? await supabase.rpc("r0_public_providers")
        : { data: [] as { id: string }[], error: null };
      if (!active) return;
      const failed = Boolean(categoryResult.error || serviceResult.error || packageResult.error || tierResult.error || promotionResult.error || clockResult.error || listingResult.error);
      // Public pages keep their existing fallback; the intake treats this as an error.
      setError(failed);
      const categoryRows = (categoryResult.data ?? []) as CategoryRow[];
      const serviceRows = (serviceResult.data ?? []) as ServiceRow[];
      const packageRows = packagesFromListedProviders(
        activePackageRows,
        listingResult.error ? null : new Set((listingResult.data ?? []).map((provider: { id: string }) => provider.id)),
      );
      const tierRows = (tierResult.data ?? []) as TierRow[];
      const promotions = !promotionResult.error && !clockResult.error && typeof clockResult.data === "string"
        ? (promotionResult.data ?? []) as PackagePromotion[]
        : [];
      const serverNow = !promotionResult.error && !clockResult.error && typeof clockResult.data === "string" ? clockResult.data : null;
      const publicPackageIds = packageRows.filter((item) => item.pricing_mode === "fixed"
        ? isPubliclyEligibleFixedPackage({ ...item, tiers: tierRows.filter((tier) => tier.package_id === item.id) })
        : isPubliclyEligibleQuotePackage(item),
      ).map((item) => item.id);
      const questionResult = publicPackageIds.length
        ? await supabase.from("package_qualifying_questions").select("id, package_id, question_key, question_label, input_type, unit, options, is_required, sort_order").in("package_id", publicPackageIds).order("sort_order")
        : { data: [] as QuestionRow[], error: null };
      if (!active) return;
      const questionRows = questionResult.error ? [] : (questionResult.data ?? []) as QuestionRow[];

      if (categoryRows.length > 0) setCategories(categoryRows.map((category) => ({ id: category.id, name: category.name, icon: category.icon, description: category.description })));

      const priceIndex: Record<string, PriceBucket> = {};
      const providerCoverage = new Map<string, Map<string, ProviderCoverage>>();
      const coveredServices = new Set<string>();
      packageRows.forEach((item) => {
        const packageTiers = tierRows.filter((tier) => tier.package_id === item.id);
        const eligibleFixed = isPubliclyEligibleFixedPackage({ ...item, tiers: packageTiers });
        const eligibleQuote = isPubliclyEligibleQuotePackage(item);
        if (!eligibleFixed && !eligibleQuote) return;
        coveredServices.add(item.service_id);
        if (!eligibleFixed) return;
        const contractor = packageContractor(item.contractors);
        const provider = contractor && contractor.is_active !== false
          ? { id: contractor.id, name: contractor.name, logoUrl: contractor.logo_url, marketingEnabled: Boolean(contractor.marketing_enabled) }
          : null;
        const promotion = promotionForPackage(promotions, item.id);
        const bucket = (priceIndex[item.service_id] ||= {});
        publiclyEligibleFixedFrequencies({ ...item, tiers: packageTiers }, item.default_frequency).forEach((frequency) => {
          const frequencyTiers = packageTiers.filter((tier) => tierPricingFrequency(tier, item.default_frequency) === frequency);
          const resolved = frequencyTiers.map((tier) => resolveEffectiveTierPrice(tier.price, promotion, serverNow, packageTiers.length));
          const minimum = [...resolved].sort((left, right) => left.effectivePrice - right.effectivePrice)[0];
          if (!minimum?.effectivePrice) return;
          const selectedTier = frequencyTiers.find((tier) => Number(tier.price) === minimum.basePrice) ?? frequencyTiers[0];
          const point: PricePoint = {
            base: minimum.basePrice,
            effective: minimum.effectivePrice,
            promotionId: minimum.promotionId ?? undefined,
            promotionLabel: minimum.promotionLabel ?? undefined,
            selection: {
              packageId: item.id,
              tierId: selectedTier?.id,
              pricingMode: "fixed",
              questions: questionRows.filter((question) => question.package_id === item.id),
              packageName: item.name,
              packageDescription: item.description,
              tierName: selectedTier?.name,
              tierIncludes: selectedTier?.includes?.filter(
                (included) => typeof included === "string" && Boolean(included.trim()),
              ),
            }, provider,
          };
          if (provider) {
            const serviceProviders = providerCoverage.get(item.service_id) ?? new Map<string, ProviderCoverage>();
            const coverage = serviceProviders.get(provider.id) ?? { provider, frequencies: new Set<ServiceFrequency>() };
            coverage.frequencies.add(frequency);
            serviceProviders.set(provider.id, coverage);
            providerCoverage.set(item.service_id, serviceProviders);
          }
          if (bucket.anyMin == null || point.effective < bucket.anyMin) {
            bucket.anyMin = point.effective;
            bucket.anyMinProviderId = provider?.id;
          }
          if (frequency === "weekly") bucket.weekly = lowerPrice(bucket.weekly, point);
          else if (frequency === "monthly") bucket.monthly = lowerPrice(bucket.monthly, point);
          else if (frequency === "bi-monthly") bucket.biMonthly = lowerPrice(bucket.biMonthly, point);
          else if (frequency === "quarterly") bucket.quarterly = lowerPrice(bucket.quarterly, point);
          else bucket.oneTime = lowerPrice(bucket.oneTime, point);
        });
      });

      if (serviceRows.length > 0) {
        setServices(serviceRows.map((service) => {
          const dynamic = priceIndex[service.id] ?? {};
          const hasLivePrice = dynamic.anyMin != null;
          const liveFrequencies = liveFrequenciesForBucket(dynamic);
          const defaultFrequency = liveFrequencies.includes(service.default_frequency)
            ? service.default_frequency
            : liveFrequencies[0] ?? "one-time";
          return {
            id: service.id, name: service.name, categoryId: service.category_id, category: mapCategoryToLegacy(service.category_id), tags: service.tags ?? [], icon: service.icon,
            descriptor: service.descriptor, popular: Boolean(service.is_popular), weeklyPrice: dynamic.weekly?.effective,
            avgMonthlyPrice: dynamic.monthly?.effective ?? 0, biMonthlyPrice: dynamic.biMonthly?.effective, quarterlyPrice: dynamic.quarterly?.effective,
            oneTimePrice: dynamic.oneTime?.effective ?? 0, defaultFrequency,
            availableFrequencies: hasLivePrice ? liveFrequencies : ["one-time"],
            availability: hasLivePrice ? "fixed" : coveredServices.has(service.id) ? "quote" : "sourcing",
            basePrices: pricePoints(dynamic, "base"),
            promotionLabels: promotionStrings(dynamic, "promotionLabel"),
            promotionIds: promotionStrings(dynamic, "promotionId"),
            packageSelections: packageSelections(dynamic),
            providerProofs: providersForService(providerCoverage.get(service.id), dynamic),
            providerProofsByFrequency: providersByFrequency(providerCoverage.get(service.id), dynamic),
          };
        }));
      } else {
        setServices(fallbackServices.map((service) => {
          const dynamic = priceIndex[service.id] ?? {};
          const hasLivePrice = dynamic.anyMin != null;
          const liveFrequencies = liveFrequenciesForBucket(dynamic);
          const defaultFrequency = liveFrequencies.includes(service.defaultFrequency)
            ? service.defaultFrequency
            : liveFrequencies[0] ?? "one-time";
          return {
            ...service,
            weeklyPrice: dynamic.weekly?.effective,
            avgMonthlyPrice: dynamic.monthly?.effective ?? 0,
            biMonthlyPrice: dynamic.biMonthly?.effective,
            quarterlyPrice: dynamic.quarterly?.effective,
            oneTimePrice: dynamic.oneTime?.effective ?? 0,
            defaultFrequency,
            availableFrequencies: hasLivePrice ? liveFrequencies : ["one-time"],
            availability: hasLivePrice ? "fixed" : coveredServices.has(service.id) ? "quote" : "sourcing",
            basePrices: pricePoints(dynamic, "base"),
            promotionLabels: promotionStrings(dynamic, "promotionLabel"),
            promotionIds: promotionStrings(dynamic, "promotionId"),
            packageSelections: packageSelections(dynamic),
            providerProofs: providersForService(providerCoverage.get(service.id), dynamic),
            providerProofsByFrequency: providersByFrequency(providerCoverage.get(service.id), dynamic),
          };
        }));
      }
      setLoading(false);
    }).catch(() => { if (active) { setError(true); setLoading(false); } }); };

    load();
    const clockRefresh = window.setInterval(load, 60_000);

    return () => { active = false; window.clearInterval(clockRefresh); };
  }, [attempt]);

  const retry = () => { setLoading(true); setAttempt((value) => value + 1); };
  return { services, categories, loading, error, retry };
}

function lowerPrice(current: PricePoint | undefined, candidate: PricePoint) {
  return !current || candidate.effective < current.effective ? candidate : current;
}

function liveFrequenciesForBucket(bucket: PriceBucket): ServiceFrequency[] {
  return pricingFrequencies.filter((frequency) => {
    if (frequency === "weekly") return Boolean(bucket.weekly?.effective);
    if (frequency === "bi-monthly") return Boolean(bucket.biMonthly?.effective);
    if (frequency === "monthly") return Boolean(bucket.monthly?.effective);
    if (frequency === "quarterly") return Boolean(bucket.quarterly?.effective);
    return Boolean(bucket.oneTime?.effective);
  });
}

function pricePoints(bucket: PriceBucket, field: "base") {
  return Object.fromEntries([
    ["weekly", bucket.weekly?.[field]],
    ["bi-monthly", bucket.biMonthly?.[field]],
    ["monthly", bucket.monthly?.[field]],
    ["quarterly", bucket.quarterly?.[field]],
    ["one-time", bucket.oneTime?.[field]],
  ].filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}

function promotionStrings(bucket: PriceBucket, field: "promotionId" | "promotionLabel") {
  return Object.fromEntries([
    ["weekly", bucket.weekly?.[field]],
    ["bi-monthly", bucket.biMonthly?.[field]],
    ["monthly", bucket.monthly?.[field]],
    ["quarterly", bucket.quarterly?.[field]],
    ["one-time", bucket.oneTime?.[field]],
  ].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function packageSelections(bucket: PriceBucket) {
  return Object.fromEntries([
    ["weekly", bucket.weekly?.selection],
    ["bi-monthly", bucket.biMonthly?.selection],
    ["monthly", bucket.monthly?.selection],
    ["quarterly", bucket.quarterly?.selection],
    ["one-time", bucket.oneTime?.selection],
  ].filter((entry): entry is [string, PublicPackageSelection] => Boolean(entry[1])));
}

function packageContractor(value: PackageRow["contractors"]) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function providersForService(coverage: Map<string, ProviderCoverage> | undefined, bucket: PriceBucket) {
  return rankProviderCoverage(coverage, bucket.anyMinProviderId);
}

function providersByFrequency(coverage: Map<string, ProviderCoverage> | undefined, bucket: PriceBucket) {
  const points: Partial<Record<ServiceFrequency, PricePoint | undefined>> = {
    weekly: bucket.weekly,
    "bi-monthly": bucket.biMonthly,
    monthly: bucket.monthly,
    quarterly: bucket.quarterly,
    "one-time": bucket.oneTime,
  };
  return Object.fromEntries(pricingFrequencies.flatMap((frequency) => {
    const point = points[frequency];
    if (!point) return [];
    return [[frequency, rankProviderCoverage(coverage, point.provider?.id, frequency)]];
  })) as Partial<Record<ServiceFrequency, ServiceProviderProof[]>>;
}

function rankProviderCoverage(
  coverage: Map<string, ProviderCoverage> | undefined,
  drivingProviderId?: string,
  frequency?: ServiceFrequency,
) {
  if (!coverage) return [];
  return [...coverage.values()]
    .filter((item) => !frequency || item.frequencies.has(frequency))
    .sort((left, right) => {
      const leftDrivesPrice = left.provider.id === drivingProviderId ? 1 : 0;
      const rightDrivesPrice = right.provider.id === drivingProviderId ? 1 : 0;
      if (leftDrivesPrice !== rightDrivesPrice) return rightDrivesPrice - leftDrivesPrice;
      if (left.provider.marketingEnabled !== right.provider.marketingEnabled) return Number(right.provider.marketingEnabled) - Number(left.provider.marketingEnabled);
      return left.provider.name.localeCompare(right.provider.name);
    })
    .map(({ provider }) => ({ id: provider.id, name: provider.name, logoUrl: provider.logoUrl }));
}

function mapCategoryToLegacy(categoryId: string) {
  const map: Record<string, string> = { "lawn-landscape": "outdoor", cleaning: "indoor", "hvac-mechanical": "hvac", "repairs-trades": "repairs", "outdoor-exterior": "outdoor", specialty: "specialty", sanitation: "specialty" };
  return map[categoryId] || "specialty";
}
