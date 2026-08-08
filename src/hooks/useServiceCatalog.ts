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

type CategoryRow = { id: string; name: string; icon: string; description: string };
type ServiceRow = { id: string; name: string; category_id: string; tags: string[] | null; icon: string; descriptor: string; is_popular: boolean | null; weekly_price: number | null; monthly_price: number; one_time_price: number; default_frequency: ServiceFrequency; available_frequencies: ServiceFrequency[] | null };
type PackageRow = { id: string; service_id: string; default_frequency: ServiceFrequency; pricing_mode: string };
type TierRow = { package_id: string; price: number | null };
type PriceBucket = { weekly?: number; monthly?: number; biMonthly?: number; quarterly?: number; oneTime?: number; anyMin?: number };

export function useServiceCatalog() {
  const [services, setServices] = useState<Service[]>(() => fallbackServices.map((service) => ({ ...service, availability: "sourcing" })));
  const [categories, setCategories] = useState<ServiceCategory[]>(fallbackCategories);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    Promise.all([
      supabase.from("service_categories").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("services_catalog").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("vendor_packages").select("id, service_id, default_frequency, pricing_mode, is_active, contractor_id, contractors!inner(is_active)").eq("is_active", true).eq("contractors.is_active", true),
      supabase.from("package_tiers").select("package_id, price"),
    ]).then(([categoryResult, serviceResult, packageResult, tierResult]) => {
      if (!active) return;
      const categoryRows = (categoryResult.data ?? []) as CategoryRow[];
      const serviceRows = (serviceResult.data ?? []) as ServiceRow[];
      const packageRows = (packageResult.data ?? []) as unknown as PackageRow[];
      const tierRows = (tierResult.data ?? []) as TierRow[];

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
        coveredServices.add(item.service_id);
        if (item.pricing_mode !== "fixed") return;
        const tierPrices = tiersByPackage[item.id];
        if (!tierPrices?.length) return;
        const minimum = Math.min(...tierPrices);
        const bucket = (priceIndex[item.service_id] ||= {});
        bucket.anyMin = bucket.anyMin == null ? minimum : Math.min(bucket.anyMin, minimum);
        if (item.default_frequency === "weekly") bucket.weekly = bucket.weekly == null ? minimum : Math.min(bucket.weekly, minimum);
        else if (item.default_frequency === "monthly") bucket.monthly = bucket.monthly == null ? minimum : Math.min(bucket.monthly, minimum);
        else if (item.default_frequency === "bi-monthly") bucket.biMonthly = bucket.biMonthly == null ? minimum : Math.min(bucket.biMonthly, minimum);
        else if (item.default_frequency === "quarterly") bucket.quarterly = bucket.quarterly == null ? minimum : Math.min(bucket.quarterly, minimum);
        else bucket.oneTime = bucket.oneTime == null ? minimum : Math.min(bucket.oneTime, minimum);
      });

      if (serviceRows.length > 0) {
        setServices(serviceRows.map((service) => {
          const dynamic = priceIndex[service.id] ?? {};
          const hasLivePrice = dynamic.anyMin != null;
          return {
            id: service.id, name: service.name, categoryId: service.category_id, category: mapCategoryToLegacy(service.category_id), tags: service.tags ?? [], icon: service.icon,
            descriptor: service.descriptor, popular: Boolean(service.is_popular), weeklyPrice: dynamic.weekly,
            avgMonthlyPrice: dynamic.monthly ?? 0, biMonthlyPrice: dynamic.biMonthly, quarterlyPrice: dynamic.quarterly,
            oneTimePrice: dynamic.oneTime ?? 0, defaultFrequency: service.default_frequency,
            availableFrequencies: service.available_frequencies ?? undefined,
            availability: hasLivePrice ? "fixed" : coveredServices.has(service.id) ? "quote" : "sourcing",
          };
        }));
      } else {
        setServices(fallbackServices.map((service) => {
          const dynamic = priceIndex[service.id] ?? {};
          const hasLivePrice = dynamic.anyMin != null;
          return {
            ...service,
            weeklyPrice: dynamic.weekly,
            avgMonthlyPrice: dynamic.monthly ?? 0,
            biMonthlyPrice: dynamic.biMonthly,
            quarterlyPrice: dynamic.quarterly,
            oneTimePrice: dynamic.oneTime ?? 0,
            availability: hasLivePrice ? "fixed" : coveredServices.has(service.id) ? "quote" : "sourcing",
          };
        }));
      }
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, []);

  return { services, categories, loading };
}

function mapCategoryToLegacy(categoryId: string) {
  const map: Record<string, string> = { "lawn-landscape": "outdoor", cleaning: "indoor", "hvac-mechanical": "hvac", "repairs-trades": "repairs", "outdoor-exterior": "outdoor", specialty: "specialty", sanitation: "specialty" };
  return map[categoryId] || "specialty";
}
