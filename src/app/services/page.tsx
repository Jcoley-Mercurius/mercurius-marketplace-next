"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import * as LucideIcons from "lucide-react";
import { ArrowRight, CheckCircle2, Loader2, Star, type LucideIcon } from "lucide-react";
import { MarketingCta, MarketingHero, MarketingShell } from "@/components/marketing/MarketingShell";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useServiceCatalog } from "@/hooks/useServiceCatalog";
import type { Service, ServiceFrequency } from "@/lib/serviceData";
import { cn } from "@/lib/utils";

const iconMap = LucideIcons as unknown as Record<string, LucideIcon>;
const getIcon = (iconName: string) => iconMap[iconName] || Star;

export default function ServicesPage() {
  const [category, setCategory] = useState("all");
  const { services, categories, loading } = useServiceCatalog();
  const filtered = useMemo(() => category === "all" ? services : services.filter((service) => service.categoryId === category), [category, services]);
  const liveCoverageCount = filtered.filter((service) => service.availability !== "sourcing").length;

  return <MarketingShell>
    <MarketingHero eyebrow="Our Services" title={<>Explore Home Services, <span className="hero-gradient-text">Coordinated Locally</span></>} description="Browse the service catalog, see live package pricing where coverage exists, and request Mercurius coordination for the work you need.">
      <Link href="/request" className={cn(buttonVariants({ size: "lg" }), "h-11 bg-accent px-7 text-accent-foreground hover:bg-accent-hover")}>Request a Service<ArrowRight /></Link>
    </MarketingHero>

    <section className="section-sm"><div className="container-wide">
      <div className="mb-9 flex flex-wrap justify-center gap-2"><button onClick={() => setCategory("all")} className={pill(category === "all")}>All Services</button>{categories.map(({ id, name, icon }) => { const Icon = getIcon(icon); return <button key={id} onClick={() => setCategory(id)} className={pill(category === id)}><Icon className="h-4 w-4" />{name}</button>; })}</div>
      {loading ? <div className="flex items-center justify-center py-20" role="status"><Loader2 className="h-8 w-8 animate-spin text-accent" /><span className="sr-only">Loading service catalog</span></div> : <><p className="mb-6 text-center text-sm text-muted-foreground">Showing {filtered.length} catalog service{filtered.length === 1 ? "" : "s"} · {liveCoverageCount} with live provider coverage</p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.map((service) => {
        const Icon = getIcon(service.icon);
        const categoryName = categories.find((item) => item.id === service.categoryId)?.name;
        const availability = service.availability ?? "sourcing";
        const livePrice = availability === "fixed" ? getLivePrice(service) : null;
        const requestHref = `/request?service=${availability === "sourcing" ? "general-home-service" : service.id}&requested=${encodeURIComponent(service.name)}`;
        const requestFrequencies = getRequestFrequencies(service);
        const requestDefaultFrequency = requestFrequencies.includes(service.defaultFrequency) ? service.defaultFrequency : requestFrequencies[0] ?? "one-time";
        return <article key={service.id} className="group flex h-full flex-col rounded-2xl border border-border/50 bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md"><div className="flex items-start justify-between"><span className="flex h-13 w-13 items-center justify-center rounded-2xl bg-sage-light transition group-hover:bg-accent"><Icon className="h-6 w-6 text-sage-dark group-hover:text-accent-foreground" /></span>{service.popular && <Badge className="border-accent/20 bg-accent/10 text-accent">Popular</Badge>}</div><h2 className="mt-5 text-lg font-semibold">{service.name}</h2><p className="mt-1 text-xs text-muted-foreground">{categoryName}</p><p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{service.descriptor}</p><div className="mt-5 flex items-end justify-between gap-3 border-t pt-4"><div>{availability === "fixed" && livePrice ? <><p className="text-xs text-muted-foreground">Live package price</p><p className="font-semibold text-accent">From ${livePrice.price}<span className="text-xs font-normal text-muted-foreground">{livePrice.suffix}</span></p></> : availability === "quote" ? <><p className="font-semibold text-foreground">Quote available</p><p className="text-xs text-muted-foreground">Price confirmed before work begins</p></> : <><p className="font-semibold text-foreground">Not available yet</p><p className="text-xs text-muted-foreground">Request to source a vetted provider</p></>}</div><Link href={requestHref} onClick={() => storeRequestContext(service, availability, requestDefaultFrequency, requestFrequencies)} aria-label={`Request ${service.name}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted transition hover:bg-accent hover:text-accent-foreground"><ArrowRight className="h-4 w-4" /></Link></div></article>;
      })}</div></>}
    </div></section>

    <section className="section-sm bg-muted/60"><div className="container-narrow"><span className="badge-accent">The Mercurius Standard</span><h2 className="mt-4 text-3xl font-bold">Ready to Get Started?</h2><p className="mt-3 text-muted-foreground">Browse our services and request what you need. See live pricing where available, and if quality falls short, we work with the provider to make it right.</p><ul className="mt-6 grid gap-3 sm:grid-cols-2">{["Vetted professionals", "Transparent pricing", "Simple scheduling", "Provider resolution support"].map((item) => <li key={item} className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-accent" />{item}</li>)}</ul></div></section>
    <MarketingCta title="Ready to Get Started?" description="Browse our services and request what you need. See live pricing where available, and if quality falls short, we work with the provider to make it right." primaryLabel="Request a Service" secondaryLabel="Contact Us" secondaryHref="/contact" />
  </MarketingShell>;
}

function pill(active: boolean) { return cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors", active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground"); }

function getLivePrice(service: Service) {
  const prices = [
    service.weeklyPrice ? { frequency: "weekly" as const, price: service.weeklyPrice, suffix: "/weekly visit" } : null,
    service.biMonthlyPrice ? { frequency: "bi-monthly" as const, price: service.biMonthlyPrice, suffix: "/visit every 2 months" } : null,
    service.avgMonthlyPrice ? { frequency: "monthly" as const, price: service.avgMonthlyPrice, suffix: "/month" } : null,
    service.quarterlyPrice ? { frequency: "quarterly" as const, price: service.quarterlyPrice, suffix: "/quarterly visit" } : null,
    service.oneTimePrice ? { frequency: "one-time" as const, price: service.oneTimePrice, suffix: " one-time" } : null,
  ].filter((price): price is { frequency: ServiceFrequency; price: number; suffix: string } => price !== null);
  return prices.find((price) => price.frequency === service.defaultFrequency) ?? prices[0] ?? null;
}

function getRequestFrequencies(service: Service): ServiceFrequency[] {
  if (service.availability !== "fixed") return ["one-time"];
  return [
    service.weeklyPrice ? "weekly" as const : null,
    service.biMonthlyPrice ? "bi-monthly" as const : null,
    service.avgMonthlyPrice ? "monthly" as const : null,
    service.quarterlyPrice ? "quarterly" as const : null,
    service.oneTimePrice ? "one-time" as const : null,
  ].filter((frequency): frequency is ServiceFrequency => frequency !== null);
}

function storeRequestContext(service: Service, availability: "fixed" | "quote" | "sourcing", defaultFrequency: ServiceFrequency, frequencies: ServiceFrequency[]) {
  window.sessionStorage.setItem("homePlanSelection", JSON.stringify({
    selectedServiceIds: [service.id],
    frequencies: { [service.id]: defaultFrequency },
    requestedServices: [{
      id: service.id,
      name: service.name,
      descriptor: service.descriptor,
      availability,
      defaultFrequency,
      frequencies,
      prices: {
        weekly: service.weeklyPrice ?? 0,
        "bi-monthly": service.biMonthlyPrice ?? 0,
        monthly: service.avgMonthlyPrice,
        quarterly: service.quarterlyPrice ?? 0,
        "one-time": service.oneTimePrice,
      },
      ...service.packageSelections?.[defaultFrequency],
    }],
  }));
}
