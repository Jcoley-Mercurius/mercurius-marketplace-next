"use client";

import { Fragment, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bug,
  Check,
  Droplets,
  Leaf,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Waves,
  Wind,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Category = "outdoor" | "indoor" | "maintenance" | "repairs" | "specialty";
type Frequency = "weekly" | "monthly" | "quarterly" | "one-time";

type Service = {
  id: string;
  name: string;
  descriptor: string;
  category: Category;
  icon: typeof Leaf;
  monthlyPrice: number;
  oneTimePrice: number;
  defaultFrequency: Frequency;
  frequencies: Frequency[];
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
  monthly: "Monthly",
  quarterly: "Quarterly",
  "one-time": "One-time",
};

const services: Service[] = [
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
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([
    "lawn-mowing",
    "pool-service",
  ]);
  const [frequencies, setFrequencies] = useState<Record<string, Frequency>>({});

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

  const getFrequency = (service: Service) =>
    frequencies[service.id] ?? service.defaultFrequency;

  const recurringTotal = selectedServices.reduce((total, service) => {
    return getFrequency(service) === "one-time"
      ? total
      : total + service.monthlyPrice;
  }, 0);

  const oneTimeTotal = selectedServices.reduce((total, service) => {
    return getFrequency(service) === "one-time"
      ? total + service.oneTimePrice
      : total;
  }, 0);

  const recommendedServices = useMemo(
    () => services.filter((service) => !selectedIds.includes(service.id)).slice(0, 2),
    [selectedIds],
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
            Choose the services your home needs. Pick recurring for the best
            rates, or one-time when you just need a single visit.
          </p>

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
                const oneTime = frequency === "one-time";
                const ServiceIcon = service.icon;

                return (
                  <div
                    key={service.id}
                    className={cn(
                      "group relative rounded-3xl border transition-all",
                      selected
                        ? "border-2 border-coral/40 bg-coral/[0.06] shadow-[inset_0_0_20px_hsl(15_65%_55%_/_0.05),0_18px_40px_-20px_hsl(15_65%_35%_/_0.55)]"
                        : "border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.03] shadow-[0_10px_28px_-18px_hsl(220_40%_2%_/_0.9)] hover:border-white/20 hover:from-white/[0.10] hover:to-white/[0.05]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleService(service.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-center justify-between gap-3 p-4 sm:gap-4 sm:p-6">
                        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-5">
                          <div
                            className={cn(
                              "flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105 sm:h-14 sm:w-14 sm:rounded-2xl",
                              selected
                                ? "bg-coral text-white"
                                : "border border-white/10 bg-white/5",
                            )}
                          >
                            <ServiceIcon
                              className={cn(
                                "h-5 w-5 sm:h-7 sm:w-7",
                                selected ? "text-white" : "text-sage",
                              )}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate font-display text-base font-bold leading-tight text-foreground sm:text-lg">
                              {service.name}
                            </h3>
                            <p className="mt-0.5 truncate text-xs leading-tight text-white/50 sm:text-sm">
                              {service.descriptor}
                            </p>
                            <div className="mt-1 text-sm font-bold text-foreground sm:hidden">
                              ${oneTime ? service.oneTimePrice : service.monthlyPrice}
                              <span className="text-[10px] font-normal text-white/40">
                                {oneTime ? "" : "/mo"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="hidden flex-shrink-0 text-right sm:block">
                          <div className="whitespace-nowrap text-xl font-bold text-foreground">
                            ${oneTime ? service.oneTimePrice : service.monthlyPrice}
                            <span className="text-xs font-normal text-white/40">
                              {oneTime ? "" : "/mo"}
                            </span>
                          </div>
                          {!oneTime && (
                            <div className="mt-1 text-[10px] uppercase tracking-widest text-white/30">
                              or ${service.oneTimePrice} one-time
                            </div>
                          )}
                        </div>
                        <div
                          className={cn(
                            "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all",
                            selected
                              ? "bg-coral text-white shadow-lg shadow-coral/30"
                              : "border border-white/10 bg-white/5 text-white/50 group-hover:border-coral group-hover:bg-coral group-hover:text-white",
                          )}
                        >
                          {selected ? (
                            <Check className="h-4 w-4" strokeWidth={3} />
                          ) : (
                            <Plus className="h-4 w-4" strokeWidth={3} />
                          )}
                        </div>
                      </div>
                    </button>

                    {selected && service.frequencies.length > 1 && (
                      <div className="-mt-1 flex flex-wrap items-center gap-2 px-5 pb-4 sm:px-6">
                        <RefreshCw className="h-3.5 w-3.5 flex-shrink-0 text-white/40" />
                        <span className="mr-1 text-xs uppercase tracking-wider text-white/40">
                          Cadence
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {service.frequencies.map((option) => (
                            <button
                              type="button"
                              key={option}
                              onClick={() =>
                                setFrequencies((current) => ({
                                  ...current,
                                  [service.id]: option,
                                }))
                              }
                              className={cn(
                                "rounded-full px-3 py-1 text-xs font-semibold transition-all",
                                frequency === option
                                  ? "bg-coral text-white shadow-md shadow-coral/20"
                                  : "border border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white",
                              )}
                            >
                              {frequencyLabels[option]}
                            </button>
                          ))}
                        </div>
                        {oneTime && (
                          <span className="ml-auto text-xs text-accent">
                            Save with recurring service
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredServices.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/10 py-12 text-center text-sm text-white/40">
                  No services match your search.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6 lg:col-span-4">
            <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-white/10 to-white/[0.02] p-5 shadow-2xl backdrop-blur-3xl sm:rounded-[2rem] sm:p-8 lg:sticky lg:top-24 lg:self-start">
              <div className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full bg-coral/10 blur-[80px]" />
              <div className="relative z-10">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="font-display text-2xl font-bold text-foreground">
                    Your Home Plan
                  </h3>
                  <span className="rounded bg-coral/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-coral">
                    Florida
                  </span>
                </div>

                {selectedServices.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 py-10 text-center">
                    <p className="text-sm text-white/50">
                      Select services to start your plan.
                    </p>
                    <p className="mt-1 text-xs text-white/30">
                      Add recurring services to see your monthly plan.
                    </p>
                  </div>
                ) : (
                  <div className="mb-6 space-y-3">
                    {selectedServices.map((service) => {
                      const frequency = getFrequency(service);
                      const price =
                        frequency === "one-time"
                          ? service.oneTimePrice
                          : service.monthlyPrice;
                      return (
                        <div
                          key={service.id}
                          className="group flex items-start gap-3"
                        >
                          <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-coral" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-semibold text-foreground">
                                {service.name}
                              </span>
                              <span className="flex-shrink-0 text-sm text-white/70">
                                ${price}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[10px] uppercase tracking-wider text-white/30">
                                {frequencyLabels[frequency]} cadence
                              </span>
                              <button
                                type="button"
                                onClick={() => toggleService(service.id)}
                                className="text-white/30 opacity-100 transition-colors hover:text-destructive lg:opacity-0 lg:group-hover:opacity-100"
                                aria-label={`Remove ${service.name}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedServices.length > 0 && (
                  <>
                    <div className="space-y-3 border-t border-white/10 pt-6">
                      {recurringTotal > 0 && (
                        <div className="flex items-baseline justify-between">
                          <span className="text-sm text-white/60">Plan Total</span>
                          <div className="text-right">
                              <div className="font-display text-4xl font-bold tracking-tight text-white">
                              ${recurringTotal}
                            </div>
                            <div className="text-[10px] uppercase tracking-widest text-white/40">
                              Per Month
                            </div>
                          </div>
                        </div>
                      )}
                      {oneTimeTotal > 0 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-white/60">One-time services</span>
                          <span className="font-semibold text-foreground">
                            ${oneTimeTotal}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-white/40">
                        Service area
                      </p>
                      <p className="mt-1 text-sm text-foreground">
                        Cape Coral &amp; Fort Myers, Florida
                      </p>
                    </div>

                    <div className="mt-6 flex flex-col gap-2">
                      <Button
                        size="lg"
                        asChild
                        className="h-14 w-full rounded-2xl bg-coral text-base font-bold text-coral-foreground shadow-xl shadow-coral/20 hover:bg-coral-dark"
                      >
                        <Link
                          href="/request"
                          onClick={() => {
                            window.sessionStorage.setItem(
                              "homePlanSelection",
                              JSON.stringify({
                                selectedServiceIds: selectedIds,
                                frequencies,
                              }),
                            );
                          }}
                        >
                          Continue to Address
                          <ArrowRight className="ml-2 h-5 w-5" />
                        </Link>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={clearPlan}
                        className="text-white/40 hover:text-foreground"
                      >
                        Clear Plan
                      </Button>
                    </div>
                    <p className="mt-4 text-center text-[10px] uppercase leading-relaxed tracking-wider text-white/25">
                      Sample prices based on a standard home in Cape Coral &amp;
                      Fort Myers. Final quote provided after home validation.
                    </p>
                  </>
                )}
              </div>
            </div>

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
