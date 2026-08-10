"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  serviceCategories as fallbackCategories,
  services as fallbackServices,
  type Service,
  type ServiceCategory,
  type ServiceFrequency,
} from "@/lib/serviceData";
import {
  isPubliclyEligibleFixedPackage,
  isPubliclyEligibleQuotePackage,
  promotionForPackage,
  resolveEffectiveTierPrice,
  type PackagePromotion,
} from "@/lib/vendorPricing";

type CategoryRow = { id: string; name: string; icon: string; description: string };
type ServiceRow = { id: string; name: string; category_id: string; tags: string[] | null; icon: string; descriptor: string; is_popular: boolean | null; weekly_price: number | null; monthly_price: number; one_time_price: number; default_frequency: ServiceFrequency; available_frequencies: ServiceFrequency[] | null };
type PackageRow = { id: string; service_id: string; default_frequency: ServiceFrequency; pricing_mode: string; deposit_amount: number | null; is_active: boolean; needs_review: boolean | null };
type TierRow = { package_id: string; price: number | null };
type PricePoint = { base: number; effective: number; promotionId?: string; promotionLabel?: string };
type PriceBucket = { weekly?: PricePoint; monthly?: PricePoint; biMonthly?: PricePoint; quarterly?: PricePoint; oneTime?: PricePoint; anyMin?: number };

export function useServiceCatalog() {
  const [services, setServices] = useState<Service[]>(() => fallbackServices.map((service) => ({ ...service, availability: "sourcing" })));
  const [categories, setCategories] = useState<ServiceCategory[]>(fallbackCategories);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    const load = () => { void Promise.all([
      supabase.from("service_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("services_catalog").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("vendor_packages").select("id, service_id, default_frequency, pricing_mode, deposit_amount, is_active, needs_review, contractor_id, contractors!inner(is_active)").eq("is_active", true).eq("needs_review", false).eq("contractors.is_active", true),
      supabase.from("package_tiers").select("package_id, price"),
      supabase.from("package_promotions").select("id, package_id, promotion_type, percent_off, fixed_price, label, starts_at, ends_at, is_enabled, created_at, updated_at").eq("is_enabled", true),
      supabase.rpc("pricing_server_now"),
    ]).then(([categoryResult, serviceResult, packageResult, tierResult, promotionResult, clockResult]) => {
      if (!active) return;
      const categoryRows = (categoryResult.data ?? []) as CategoryRow[];
      const serviceRows = (serviceResult.data ?? []) as ServiceRow[];
      const packageRows = (packageResult.data ?? []) as unknown as PackageRow[];
      const tierRows = (tierResult.data ?? []) as TierRow[];
      const promotions = !promotionResult.error && !clockResult.error && typeof clockResult.data === "string"
        ? (promotionResult.data ?? []) as PackagePromotion[]
        : [];
      const serverNow = !promotionResult.error && !clockResult.error && typeof clockResult.data === "string" ? clockResult.data : null;

      if (categoryRows.length > 0) setCategories(categoryRows.map((category) => ({ id: category.id, name: category.name, icon: category.icon, description: category.description })));

      const priceIndex: Record<string, PriceBucket> = {};
      const coveredServices = new Set<string>();
      const tiersByPackage: Record<string, number[]> = {};
      tierRows.forEach((tier) => {
        const price = Number(tier.price);
        if (tier.price != null && Number.isFinite(price) && price > 0) {
          (tiersByPackage[tier.package_id] ||= []).push(price);
        }
      });
      packageRows.forEach((item) => {
        const packageTiers = tierRows.filter((tier) => tier.package_id === item.id);
        const eligibleFixed = isPubliclyEligibleFixedPackage({ ...item, tiers: packageTiers });
        const eligibleQuote = isPubliclyEligibleQuotePackage(item);
        if (!eligibleFixed && !eligibleQuote) return;
        coveredServices.add(item.service_id);
        if (!eligibleFixed) return;
        const tierPrices = tiersByPackage[item.id];
        if (!tierPrices?.length) return;
        const promotion = promotionForPackage(promotions, item.id);
        const resolved = tierPrices.map((price) => resolveEffectiveTierPrice(price, promotion, serverNow, tierPrices.length));
        const minimum = [...resolved].sort((left, right) => left.effectivePrice - right.effectivePrice)[0];
        const bucket = (priceIndex[item.service_id] ||= {});
        const point: PricePoint = { base: minimum.basePrice, effective: minimum.effectivePrice, promotionId: minimum.promotionId ?? undefined, promotionLabel: minimum.promotionLabel ?? undefined };
        bucket.anyMin = bucket.anyMin == null ? point.effective : Math.min(bucket.anyMin, point.effective);
        if (item.default_frequency === "weekly") bucket.weekly = lowerPrice(bucket.weekly, point);
        else if (item.default_frequency === "monthly") bucket.monthly = lowerPrice(bucket.monthly, point);
        else if (item.default_frequency === "bi-monthly") bucket.biMonthly = lowerPrice(bucket.biMonthly, point);
        else if (item.default_frequency === "quarterly") bucket.quarterly = lowerPrice(bucket.quarterly, point);
        else bucket.oneTime = lowerPrice(bucket.oneTime, point);
      });

      if (serviceRows.length > 0) {
        setServices(serviceRows.map((service) => {
          const dynamic = priceIndex[service.id] ?? {};
          const hasLivePrice = dynamic.anyMin != null;
          return {
            id: service.id, name: service.name, categoryId: service.category_id, category: mapCategoryToLegacy(service.category_id), tags: service.tags ?? [], icon: service.icon,
            descriptor: service.descriptor, popular: Boolean(service.is_popular), weeklyPrice: dynamic.weekly?.effective,
            avgMonthlyPrice: dynamic.monthly?.effective ?? 0, biMonthlyPrice: dynamic.biMonthly?.effective, quarterlyPrice: dynamic.quarterly?.effective,
            oneTimePrice: dynamic.oneTime?.effective ?? 0, defaultFrequency: service.default_frequency,
            availableFrequencies: service.available_frequencies ?? undefined,
            availability: hasLivePrice ? "fixed" : coveredServices.has(service.id) ? "quote" : "sourcing",
            basePrices: pricePoints(dynamic, "base"),
            promotionLabels: promotionStrings(dynamic, "promotionLabel"),
            promotionIds: promotionStrings(dynamic, "promotionId"),
          };
        }));
      } else {
        setServices(fallbackServices.map((service) => {
          const dynamic = priceIndex[service.id] ?? {};
          const hasLivePrice = dynamic.anyMin != null;
          return {
            ...service,
            weeklyPrice: dynamic.weekly?.effective,
            avgMonthlyPrice: dynamic.monthly?.effective ?? 0,
            biMonthlyPrice: dynamic.biMonthly?.effective,
            quarterlyPrice: dynamic.quarterly?.effective,
            oneTimePrice: dynamic.oneTime?.effective ?? 0,
            availability: hasLivePrice ? "fixed" : coveredServices.has(service.id) ? "quote" : "sourcing",
            basePrices: pricePoints(dynamic, "base"),
            promotionLabels: promotionStrings(dynamic, "promotionLabel"),
            promotionIds: promotionStrings(dynamic, "promotionId"),
          };
        }));
      }
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); }); };

    load();
    const clockRefresh = window.setInterval(load, 60_000);

    return () => { active = false; window.clearInterval(clockRefresh); };
  }, []);

  return { services, categories, loading };
}

function lowerPrice(current: PricePoint | undefined, candidate: PricePoint) {
  return !current || candidate.effective < current.effective ? candidate : current;
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

function mapCategoryToLegacy(categoryId: string) {
  const map: Record<string, string> = { "lawn-landscape": "outdoor", cleaning: "indoor", "hvac-mechanical": "hvac", "repairs-trades": "repairs", "outdoor-exterior": "outdoor", specialty: "specialty", sanitation: "specialty" };
  return map[categoryId] || "specialty";
}
