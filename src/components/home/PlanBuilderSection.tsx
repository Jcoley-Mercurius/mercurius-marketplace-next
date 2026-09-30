"use client";

import { Fragment, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bug,
  Droplets,
  Leaf,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Waves,
  Wind,
  Wrench,
} from "lucide-react";
import { EligibleProvidersRow, type EligibleProvider } from "@/components/home/EligibleProvidersRow";
import {
  PlanningAvailabilityBadge,
  PlanningPlanSummary,
  PlanningServiceCard,
  planningPrice,
  planningSummaryItem,
  type PlanningService,
  type PlanningTotalRow,
} from "@/components/planning/ServicePlanning";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServiceCatalog } from "@/hooks/useServiceCatalog";
import { useTrialAccess } from "@/hooks/useTrialAccess";
import { EARLY_ACCESS_CTA, bookingState, earlyAccessHref } from "@/lib/earlyAccessExperience";
import { cn } from "@/lib/utils";
import type { PricingFrequency, PublicPackageSelection } from "@/lib/vendorPricing";
import type { ServiceProviderProof } from "@/lib/serviceData";

type Category = "outdoor" | "indoor" | "maintenance" | "repairs" | "specialty";
type Frequency = PricingFrequency;

type Service = {
  id: string;
  name: string;
  descriptor: string;
  category: Category;
  icon: typeof Leaf;
  monthlyPrice: number;
  weeklyPrice?: number;
  biMonthlyPrice?: number;
  quarterlyPrice?: number;
  oneTimePrice: number;
  defaultFrequency: Frequency;
  frequencies: Frequency[];
  availability: "fixed" | "quote" | "sourcing";
  basePrices?: Partial<Record<Frequency, number>>;
  promotionLabels?: Partial<Record<Frequency, string>>;
  promotionIds?: Partial<Record<Frequency, string>>;
  packageSelections?: Partial<Record<Frequency, PublicPackageSelection>>;
  providerProofs?: ServiceProviderProof[];
  providerProofsByFrequency?: Partial<Record<Frequency, ServiceProviderProof[]>>;
};

const categoryLabels: Record<Category, string> = {
  outdoor: "Outdoor",
  indoor: "Cleaning",
  maintenance: "Maintenance",
  repairs: "Repairs",
  specialty: "Specialty",
};

const frequencyLabels: Record<Frequency, string> = {
  weekly: "Weekly",
  "bi-monthly": "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
  "one-time": "One-time",
};

const fallbackBuilderServices: Omit<Service, "availability">[] = [
  {
    id: "lawn-mowing",
    name: "Lawn Mowing",
    descriptor: "Mowing, edging, and cleanup",
    category: "outdoor",
    icon: Leaf,
    monthlyPrice: 120,
    oneTimePrice: 45,
    defaultFrequency: "weekly",
    frequencies: ["weekly", "monthly", "one-time"],
  },
  {
    id: "pool-service",
    name: "Pool Service",
    descriptor: "Cleaning, chemicals, and equipment check",
    category: "outdoor",
    icon: Waves,
    monthlyPrice: 135,
    oneTimePrice: 65,
    defaultFrequency: "weekly",
    frequencies: ["weekly", "monthly", "one-time"],
  },
  {
    id: "house-cleaning",
    name: "House Cleaning",
    descriptor: "A fresh, professionally cleaned home",
    category: "indoor",
    icon: Sparkles,
    monthlyPrice: 180,
    oneTimePrice: 165,
    defaultFrequency: "monthly",
    frequencies: ["monthly", "one-time"],
  },
  {
    id: "ac-maintenance",
    name: "A/C Maintenance",
    descriptor: "Seasonal tune-up and system inspection",
    category: "maintenance",
    icon: Wind,
    monthlyPrice: 45,
    oneTimePrice: 129,
    defaultFrequency: "quarterly",
    frequencies: ["quarterly", "one-time"],
  },
  {
    id: "pressure-washing",
    name: "Pressure Washing",
    descriptor: "Driveways, patios, and exterior surfaces",
    category: "outdoor",
    icon: Droplets,
    monthlyPrice: 80,
    oneTimePrice: 189,
    defaultFrequency: "quarterly",
    frequencies: ["quarterly", "one-time"],
  },
  {
    id: "pest-control",
    name: "Pest Control",
    descriptor: "Interior and exterior home protection",
    category: "specialty",
    icon: Bug,
    monthlyPrice: 49,
    oneTimePrice: 99,
    defaultFrequency: "monthly",
    frequencies: ["monthly", "quarterly", "one-time"],
  },
  {
    id: "handyman",
    name: "Handyman Service",
    descriptor: "Small repairs and home projects",
    category: "repairs",
    icon: Wrench,
    monthlyPrice: 95,
    oneTimePrice: 145,
    defaultFrequency: "one-time",
    frequencies: ["monthly", "one-time"],
  },
  {
    id: "trash-can-cleaning",
    name: "Trash Can Cleaning",
    descriptor: "Sanitized, deodorized, and spotless bins",
    category: "specialty",
    icon: Trash2,
    monthlyPrice: 29,
    oneTimePrice: 49,
    defaultFrequency: "monthly",
    frequencies: ["monthly", "quarterly", "one-time"],
  },
];

const darkThemeStyle = {
  "--color-background": "hsl(220 25% 12%)",
  "--color-foreground": "hsl(40 20% 95%)",
  "--color-card": "hsl(220 22% 16%)",
  "--color-card-foreground": "hsl(40 20% 95%)",
  "--color-muted": "hsl(220 20% 20%)",
  "--color-muted-foreground": "hsl(40 10% 68%)",
  "--color-border": "hsl(220 18% 24%)",
  "--color-input": "hsl(220 18% 22%)",
  "--color-accent": "hsl(150 40% 50%)",
  "--color-accent-foreground": "hsl(220 25% 10%)",
  color: "hsl(40 20% 95%)",
  background:
    "linear-gradient(180deg, hsl(220 25% 9%) 0%, hsl(220 24% 12%) 48%, hsl(220 22% 14%) 100%)",
} as CSSProperties;

export function PlanBuilderSection() {
  const { services: catalogServices, loading } = useServiceCatalog();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [frequencies, setFrequencies] = useState<Record<string, Frequency>>({});
  const [matchingZip, setMatchingZip] = useState("");
  const router = useRouter();
  // TRACE-103 (R0.3): only an admitted account continues to the request; everyone else
  // joins early access with the services they chose.
  const trial = useTrialAccess();
  const invited = trial.status === "ready" && bookingState(trial.access) === "invited";

  const services = useMemo<Service[]>(() => fallbackBuilderServices.map((service) => {
    const catalogService = catalogServices.find((item) => item.id === service.id);
    if (!catalogService) return { ...service, monthlyPrice: 0, oneTimePrice: 0, availability: "sourcing" };
    const availability = catalogService.availability ?? "sourcing";
    const liveFrequencies: Frequency[] = availability === "fixed" ? [
      catalogService.weeklyPrice ? "weekly" : null,
      catalogService.biMonthlyPrice ? "bi-monthly" : null,
      catalogService.avgMonthlyPrice ? "monthly" : null,
      catalogService.quarterlyPrice ? "quarterly" : null,
      catalogService.oneTimePrice ? "one-time" : null,
    ].filter((value): value is Frequency => value !== null) : ["one-time"];
    const defaultFrequency = liveFrequencies.includes(service.defaultFrequency) ? service.defaultFrequency : liveFrequencies[0] ?? "one-time";
    return {
      ...service,
      name: catalogService.name,
      descriptor: catalogService.descriptor,
      weeklyPrice: catalogService.weeklyPrice,
      biMonthlyPrice: catalogService.biMonthlyPrice,
      monthlyPrice: catalogService.avgMonthlyPrice,
      quarterlyPrice: catalogService.quarterlyPrice,
      oneTimePrice: catalogService.oneTimePrice,
      defaultFrequency,
      frequencies: liveFrequencies,
      availability,
      basePrices: catalogService.basePrices,
      promotionLabels: catalogService.promotionLabels,
      promotionIds: catalogService.promotionIds,
      packageSelections: catalogService.packageSelections,
      providerProofs: catalogService.providerProofs,
      providerProofsByFrequency: catalogService.providerProofsByFrequency,
    };
  }), [catalogServices]);

  const filteredServices = services.filter((service) => {
    const matchesSearch = service.name
      .toLowerCase()
      .includes(search.toLowerCase());
    return (
      matchesSearch &&
      (activeCategory === "all" || service.category === activeCategory)
    );
  });

  const selectedServices = services.filter((service) =>
    selectedIds.includes(service.id),
  );

  const getFrequency = (service: Service) => {
    const selected = frequencies[service.id];
    return selected && service.frequencies.includes(selected) ? selected : service.defaultFrequency;
  };

  const pricedTotals = selectedServices.reduce<Record<Frequency, number>>((totals, service) => {
    if (service.availability !== "fixed") return totals;
    const frequency = getFrequency(service);
    totals[frequency] += planningPrice(toPlanningService(service), frequency);
    return totals;
  }, { weekly: 0, "bi-monthly": 0, monthly: 0, quarterly: 0, "one-time": 0 });

  const summaryItems = selectedServices.map((service) =>
    planningSummaryItem(toPlanningService(service), getFrequency(service)),
  );
  const totalRows: PlanningTotalRow[] = (["weekly", "bi-monthly", "monthly", "quarterly", "one-time"] as Frequency[])
    .filter((frequency) => pricedTotals[frequency] > 0)
    .map((frequency) => ({
      key: frequency,
      label: `${frequencyLabels[frequency]} priced today`,
      amount: pricedTotals[frequency],
      detail: frequency === "one-time" ? "Live one-time rates" : frequency === "weekly" ? "Per weekly visit" : frequency === "bi-monthly" ? "Every two weeks" : frequency === "monthly" ? "Per month" : "Per quarter",
      emphasis: frequency === "monthly" || (frequency === "one-time" && Object.values(pricedTotals).filter((total) => total > 0).length === 1),
    }));

  const recommendedServices = useMemo(
    () => services.filter((service) => !selectedIds.includes(service.id)).sort((a, b) => availabilityRank(a.availability) - availabilityRank(b.availability)).slice(0, 2),
    [selectedIds, services],
  );

  const toggleService = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((serviceId) => serviceId !== id)
        : [...current, id],
    );
  };

  const clearPlan = () => {
    setSelectedIds([]);
    setFrequencies({});
  };

  const savePlanDraft = (choice?: { serviceId: string; provider: EligibleProvider }) => {
    const selectedFrequencies = Object.fromEntries(
      selectedServices.map((service) => [service.id, getFrequency(service)]),
    );
    window.sessionStorage.setItem("homePlanSelection", JSON.stringify({
      selectedServiceIds: selectedIds,
      frequencies: selectedFrequencies,
      matchingZip: /^\d{5}$/.test(matchingZip.trim()) ? matchingZip.trim() : undefined,
      requestedServices: selectedServices.map((service) => {
        const frequency = getFrequency(service);
        const provider = choice?.serviceId === service.id ? choice.provider : undefined;
        const selectedPackage = service.packageSelections?.[frequency];
        return {
          id: service.id,
          name: service.name,
          availability: provider?.path ?? service.availability,
          descriptor: service.descriptor,
          defaultFrequency: service.defaultFrequency,
          frequencies: service.frequencies,
          prices: provider?.path === "fixed" && provider.effective_price !== null
            ? { ...toPlanningService(service).prices, [frequency]: Number(provider.effective_price) }
            : toPlanningService(service).prices,
          basePrices: provider?.path === "fixed" && provider.base_price !== null
            ? { ...service.basePrices, [frequency]: Number(provider.base_price) }
            : service.basePrices,
          promotionLabels: service.promotionLabels,
          promotionIds: provider?.promotion_id
            ? { ...service.promotionIds, [frequency]: provider.promotion_id }
            : service.promotionIds,
          ...(provider ? {
            packageId: provider.package_id,
            tierId: provider.package_tier_id ?? undefined,
            pricingMode: provider.path === "fixed" ? "fixed" : "custom_quote",
            preferredContractorId: provider.contractor_id,
            preferredContractorName: provider.contractor_name,
          } : selectedPackage),
        };
      }),
    }));
  };

  const matchMe = () => {
    if (!invited) return router.push(earlyAccessHref(selectedIds));
    savePlanDraft();
    router.push("/request");
  };

  const chooseProvider = (serviceId: string, provider: EligibleProvider) => {
    if (!invited) return router.push(earlyAccessHref([serviceId]));
    savePlanDraft({ serviceId, provider });
    router.push("/request");
  };

  return (
    <section
      id="bundle-builder"
      className="section plan-builder-dark w-full max-w-full scroll-mt-20 overflow-hidden"
      style={darkThemeStyle}
    >
      <div className="bg-motif-lines pointer-events-none absolute inset-0 z-0 opacity-70" />
      <div className="container-wide relative z-10 w-full max-w-full">
        <div className="mb-12 flex flex-col items-center gap-6 text-center">
          <span className="eyebrow eyebrow-center text-coral before:!bg-coral after:!bg-coral">
            Plan Builder
          </span>
          <h2 className="mb-0 text-3xl font-bold text-white md:text-4xl">
            Build Your Home Service Plan
          </h2>
          <p className="max-w-xl text-base text-white/60">
            Choose what your home needs. Live vendor prices appear when
            available; otherwise, request a quote or ask us to source a vetted pro.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-wider">
            {loading ? <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-white/55"><RefreshCw className="h-3 w-3 animate-spin" />Checking live coverage</span> : <><span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-accent">Available now</span><span className="rounded-full border border-info/30 bg-info/10 px-3 py-1.5 text-info">Quote / matching</span><span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-white/50">Request &amp; source</span></>}
          </div>

          <div className="mt-2 flex w-full max-w-full items-start justify-center gap-1.5 overflow-hidden sm:gap-6 md:gap-10">
            {[
              { number: 1, short: "Pick", full: "Pick Services", active: true },
              { number: 2, short: "Home", full: "Your Home", active: false },
              { number: 3, short: "Match", full: "Match Provider", active: false },
              { number: 4, short: "Done", full: "Get It Done", active: false },
            ].map((step, index, allSteps) => (
              <Fragment key={step.number}>
                <div
                  className={cn(
                    "flex min-w-0 flex-shrink flex-col items-center gap-2",
                    !step.active && "opacity-40",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold sm:h-10 sm:w-10 sm:text-sm",
                      step.active
                        ? "bg-coral text-white ring-4 ring-coral/20 shadow-[0_0_20px_hsl(15_65%_55%_/_0.4)]"
                        : "border-2 border-white/20 text-foreground",
                    )}
                  >
                    {step.number}
                  </div>
                  <span className="max-w-full truncate text-[10px] font-medium leading-tight sm:text-xs">
                    <span className="sm:hidden">{step.short}</span>
                    <span className="hidden sm:inline">{step.full}</span>
                  </span>
                </div>
                {index < allSteps.length - 1 && (
                  <div className="mt-4 h-px w-3 flex-shrink-0 bg-white/10 sm:mt-5 sm:w-10 md:w-16" />
                )}
              </Fragment>
            ))}
          </div>
        </div>

        <div className="grid w-full min-w-0 max-w-full gap-8 lg:grid-cols-12">
          <div className="min-w-0 max-w-full space-y-6 overflow-hidden lg:col-span-8">
            <div className="group relative">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/30 transition-colors group-focus-within:text-coral" />
              <Input
                type="search"
                aria-label="Search services"
                placeholder="Search services..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-14 rounded-2xl border-white/10 bg-[hsl(220_22%_16%)] pl-12 pr-4 text-sm text-white placeholder:text-white/30 focus-visible:ring-2 focus-visible:ring-coral/50 focus-visible:ring-offset-0"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <CategoryButton
                active={activeCategory === "all"}
                onClick={() => setActiveCategory("all")}
              >
                All
              </CategoryButton>
              {(Object.keys(categoryLabels) as Category[]).map((category) => (
                <CategoryButton
                  key={category}
                  active={activeCategory === category}
                  onClick={() => setActiveCategory(category)}
                >
                  {categoryLabels[category]}
                </CategoryButton>
              ))}
            </div>

            <div className="space-y-4">
              {filteredServices.map((service) => {
                const selected = selectedIds.includes(service.id);
                const frequency = getFrequency(service);
                return (
                  <PlanningServiceCard
                    key={service.id}
                    service={toPlanningService(service)}
                    selected={selected}
                    frequency={frequency}
                    onToggle={() => toggleService(service.id)}
                    onFrequencyChange={(value) => setFrequencies((current) => ({ ...current, [service.id]: value }))}
                    variant="dark"
                    layout="row"
                    disabled={loading}
                    showSingleFrequency={false}
                  />
                );
              })}

              {filteredServices.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 py-12 text-center text-sm text-white/40">
                  No services match your search.
                </div>
              )}
            </div>

            {selectedServices.length > 0 && (
              <section className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-4 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-xl font-semibold text-white">{invited ? "Choose a pro, or let us match you" : "See eligible pros for your ZIP"}</h3>
                    <p className="mt-1 max-w-xl text-sm leading-6 text-white/55">{invited
                      ? "Enter the service ZIP to see only currently eligible providers. Match me continues without requiring a provider choice."
                      : "Enter the service ZIP to see currently eligible providers. Booking opens by invitation; join early access to be considered for these services."}</p>
                  </div>
                  <Button type="button" onClick={matchMe} className="shrink-0 rounded-xl bg-coral px-5 font-semibold text-coral-foreground hover:bg-coral-dark">
                    {invited ? "Match me" : EARLY_ACCESS_CTA} <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>

                <label htmlFor="plan-matching-zip" className="mt-5 block max-w-sm text-xs font-medium text-white/65">
                  Service ZIP
                  <span className="relative mt-2 block">
                    <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-accent" />
                    <Input
                      id="plan-matching-zip"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      maxLength={5}
                      value={matchingZip}
                      onChange={(event) => setMatchingZip(event.target.value.replace(/\D/g, "").slice(0, 5))}
                      placeholder="33904"
                      className="h-11 border-white/15 bg-[hsl(220_22%_13%)] pl-10 text-base text-white placeholder:text-white/30 focus-visible:ring-coral/50"
                      aria-describedby="plan-matching-zip-hint"
                    />
                  </span>
                </label>
                <p id="plan-matching-zip-hint" className="mt-2 text-xs text-white/40">Provider cards appear after all five digits are entered.</p>

                {/^\d{5}$/.test(matchingZip) && (
                  <div className="mt-8 space-y-9">
                    {selectedServices.map((service) => (
                      <EligibleProvidersRow
                        key={`${service.id}:${getFrequency(service)}:${matchingZip}`}
                        serviceId={service.id}
                        serviceName={service.name}
                        frequency={getFrequency(service)}
                        zipCode={matchingZip}
                        onChoose={(provider) => chooseProvider(service.id, provider)}
                        invited={invited}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          <div className="space-y-6 lg:col-span-4">
            <PlanningPlanSummary
              items={summaryItems}
              totalRows={totalRows}
              variant="dark"
              title="Your home plan"
              emptyTitle="Select services to start your plan"
              emptyCopy="Live prices appear only where an eligible provider package is available."
              actionLabel={invited ? "Match me" : EARLY_ACCESS_CTA}
              actionHref={invited ? "/request" : earlyAccessHref(selectedIds)}
              onActionBeforeNavigate={invited ? () => savePlanDraft() : undefined}
              onRemove={toggleService}
              actionClassName="h-14 text-base"
              footer={selectedServices.length > 0 ? <><div className="rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-semibold uppercase tracking-wider text-white/40">Service area</p><p className="mt-1 text-sm text-foreground">Cape Coral &amp; Fort Myers, Florida</p></div><Button size="sm" variant="ghost" onClick={clearPlan} className="w-full text-white/40 hover:text-foreground">Clear Plan</Button><p className="text-center text-[10px] uppercase leading-relaxed tracking-wider text-white/25">Live prices come from active vendor packages. Quote and matching requests are confirmed before work begins.</p></> : null}
            />

            {selectedServices.length > 0 && recommendedServices.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="mb-3 text-sm font-medium text-foreground">
                  Recommended Add-ons
                </p>
                <div className="space-y-2">
                  {recommendedServices.map((service) => {
                    const ServiceIcon = service.icon;
                    return (
                      <button
                        type="button"
                        key={service.id}
                        onClick={() => toggleService(service.id)}
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 p-3 text-left transition-all hover:border-accent/50 hover:bg-white/5"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5">
                            <ServiceIcon className="h-4 w-4 text-sage" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {service.name}
                            </p>
                            <p className="text-xs text-white/40">
                              {service.descriptor}
                            </p>
                            <PlanningAvailabilityBadge availability={service.availability} variant="dark" className="mt-1.5" />
                          </div>
                        </div>
                        <Plus className="h-4 w-4 flex-shrink-0 text-accent" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function CategoryButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-w-0 rounded-full border px-3 py-2 text-xs font-bold uppercase tracking-wider transition-all sm:px-4",
        active
          ? "border-coral bg-coral/10 text-coral"
          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10",
      )}
    >
      {children}
    </button>
  );
}

function toPlanningService(service: Service): PlanningService {
  return {
    id: service.id,
    name: service.name,
    description: service.descriptor,
    icon: service.icon,
    availability: service.availability,
    defaultFrequency: service.defaultFrequency,
    frequencies: service.frequencies,
    prices: {
      weekly: service.weeklyPrice ?? 0,
      "bi-monthly": service.biMonthlyPrice ?? 0,
      monthly: service.monthlyPrice,
      quarterly: service.quarterlyPrice ?? 0,
      "one-time": service.oneTimePrice,
    },
    basePrices: service.basePrices,
    promotionLabels: service.promotionLabels,
    promotionIds: service.promotionIds,
    packageSelections: service.packageSelections,
    providerProofs: service.providerProofs,
    providerProofsByFrequency: service.providerProofsByFrequency,
  };
}

function availabilityRank(availability: Service["availability"]) {
  return availability === "fixed" ? 0 : availability === "quote" ? 1 : 2;
}
