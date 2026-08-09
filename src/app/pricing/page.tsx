"use client";

import Link from "next/link";
import * as LucideIcons from "lucide-react";
import { ArrowRight, Calendar, CheckCircle2, Clock3, Home, Info, Loader2, Shield, Sparkles, Star, type LucideIcon } from "lucide-react";
import NegotiatedRatesSection from "@/components/home/NegotiatedRatesSection";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { useServiceCatalog } from "@/hooks/useServiceCatalog";
import type { Service } from "@/lib/serviceData";
import { cn } from "@/lib/utils";

const iconMap = LucideIcons as unknown as Record<string, LucideIcon>;
const getIcon = (iconName: string) => iconMap[iconName] || Star;

export default function PricingPage() {
  const { services, categories, loading } = useServiceCatalog();
  const grouped = categories.map((category) => ({ category, services: services.filter((service) => service.categoryId === category.id) })).filter((group) => group.services.length > 0);
  const liveServiceCount = services.filter((service) => service.availability !== "sourcing").length;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <section className="bg-hero py-16 md:py-24">
          <div className="container-wide text-center">
            <span className="mb-6 inline-block rounded-full bg-sage-light px-4 py-2 text-sm font-medium text-sage-dark">Transparent Pricing</span>
            <h1 className="mx-auto mb-6 max-w-3xl text-4xl font-bold leading-tight text-foreground md:text-5xl lg:text-6xl">Honest Pricing, <span className="text-gradient">Shown Upfront</span></h1>
            <p className="mx-auto mb-8 max-w-2xl text-xl text-muted-foreground">See live starting prices where vetted providers are active. If coverage is not available yet, tell us what you need and we&apos;ll work to source the right pro.</p>
            <div className="flex flex-wrap justify-center gap-3 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-accent" />No hidden fees</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-accent" />Quotes approved before work starts</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-accent" />One simple bill</span>
            </div>
          </div>
        </section>

        <section className="section bg-background">
          <div className="container-wide">
            {loading ? <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-accent" /></div> : <><div className="mb-12 flex flex-col gap-4 rounded-2xl border border-accent/20 bg-sage-light/45 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card"><CheckCircle2 className="h-5 w-5 text-accent" /></span><div><p className="font-semibold text-foreground">Launch coverage, shown honestly</p><p className="mt-1 text-sm text-muted-foreground">Only active vendor package prices are displayed. Catalog estimates are never presented as live availability.</p></div></div><Badge className="w-fit border-accent/20 bg-card text-sage-dark">{liveServiceCount} service{liveServiceCount === 1 ? "" : "s"} with live coverage</Badge></div><div className="space-y-16">
              {grouped.map(({ category, services: categoryServices }) => {
                const CategoryIcon = getIcon(category.icon);
                return (
                  <div key={category.id}>
                    <div className="mb-6 flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sage-light"><CategoryIcon className="h-5 w-5 text-sage" /></div><div><h2 className="text-2xl font-bold text-foreground md:text-3xl">{category.name}</h2><p className="text-sm text-muted-foreground">{category.description}</p></div></div>
                    <div className="overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm">
                      <div className="hidden grid-cols-12 gap-4 border-b border-border/50 bg-muted/50 px-6 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid"><div className="col-span-5">Service</div><div className="col-span-3 text-right">One-Time</div><div className="col-span-3 text-right">Recurring</div><div className="col-span-1" /></div>
                      {categoryServices.map((service, index) => {
                        const Icon = getIcon(service.icon);
                        const availability = service.availability ?? "sourcing";
                        const recurring = getRecurringPrice(service);
                        const hasPromotion = Boolean(service.promotionIds && Object.keys(service.promotionIds).length);
                        const requestHref = `/request?service=${availability === "sourcing" ? "general-home-service" : service.id}&requested=${encodeURIComponent(service.name)}`;
                        const requestFrequencies = getRequestFrequencies(service);
                        const requestDefaultFrequency = requestFrequencies.includes(service.defaultFrequency as RequestFrequency) ? service.defaultFrequency as RequestFrequency : requestFrequencies[0] ?? "one-time";
                        return (
                          <Link key={service.id} href={requestHref} onClick={() => window.sessionStorage.setItem("homePlanSelection", JSON.stringify({ selectedServiceIds: [service.id], frequencies: { [service.id]: requestDefaultFrequency }, requestedServices: [{ id: service.id, name: service.name, descriptor: service.descriptor, availability, defaultFrequency: requestDefaultFrequency, frequencies: requestFrequencies, prices: { weekly: service.weeklyPrice ?? 0, monthly: service.avgMonthlyPrice, quarterly: service.quarterlyPrice ?? 0, "one-time": service.oneTimePrice } }] }))} className={cn("group grid grid-cols-12 items-center gap-4 px-6 py-5 transition-colors hover:bg-muted/30", index !== categoryServices.length - 1 && "border-b border-border/30", availability === "sourcing" && "bg-muted/15")}>
                            <div className="col-span-12 flex items-center gap-3 md:col-span-5"><div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", availability === "sourcing" ? "bg-muted" : "bg-sage-light/60")}><Icon className={cn("h-4 w-4", availability === "sourcing" ? "text-muted-foreground" : "text-sage")} /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium text-foreground">{service.name}</p>{availability === "fixed" && <Badge className="border-accent/20 bg-accent/10 px-1.5 py-0 text-[10px] text-accent">Live price</Badge>}{hasPromotion && <Badge className="border-coral/25 bg-coral/10 px-1.5 py-0 text-[10px] text-coral">Promotion</Badge>}{availability === "quote" && <Badge className="border-info/20 bg-info/10 px-1.5 py-0 text-[10px] text-info">Quote available</Badge>}</div><p className="line-clamp-1 text-xs text-muted-foreground">{service.descriptor}</p></div></div>
                            {availability === "fixed" && <><div className="col-span-6 md:col-span-3 md:text-right"><p className="text-[10px] uppercase tracking-wide text-muted-foreground md:hidden">One-Time</p>{service.oneTimePrice > 0 ? <PublicPrice service={service} frequency="one-time" suffix="" /> : <p className="text-sm text-muted-foreground">Not offered</p>}</div><div className="col-span-6 md:col-span-3 md:text-right"><p className="text-[10px] uppercase tracking-wide text-muted-foreground md:hidden">Recurring</p>{recurring ? <PublicPrice service={service} frequency={recurring.frequency} suffix={recurring.label} accent /> : <p className="text-sm text-muted-foreground">Not offered</p>}</div></>}
                            {availability === "quote" && <div className="col-span-12 rounded-xl bg-info/5 px-4 py-3 md:col-span-6"><p className="text-sm font-medium text-foreground">Provider coverage is available</p><p className="mt-0.5 text-xs text-muted-foreground">Request a scoped quote before work begins.</p></div>}
                            {availability === "sourcing" && <div className="col-span-12 rounded-xl border border-dashed border-border bg-card/70 px-4 py-3 md:col-span-6"><p className="flex items-center gap-2 text-sm font-medium text-foreground"><Clock3 className="h-4 w-4 text-coral" />Not available yet in your area</p><p className="mt-1 text-xs font-medium text-accent">Request this service — we&apos;ll source a vetted pro</p></div>}
                            <div className="col-span-1 hidden justify-end md:flex"><ArrowRight className="h-4 w-4 text-muted-foreground" /></div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div></>}
          </div>
        </section>

        <NegotiatedRatesSection />

        <section className="section bg-muted">
          <div className="container-wide">
            <div className="mb-12 text-center"><span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-card px-4 py-2 text-sm font-medium text-foreground"><Info className="h-4 w-4 text-accent" />What affects your final price</span><h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">A few things can change the number</h2><p className="mx-auto max-w-2xl text-muted-foreground">Prices above are starting points. Your actual quote depends on a few common factors — we&apos;ll always confirm the total before any work begins.</p></div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">{[
              { icon: Home, title: "Home Size", desc: "Square footage, number of bedrooms or yard size all factor in." },
              { icon: Calendar, title: "Frequency", desc: "Recurring plans (weekly/monthly) cost less per visit than one-time work." },
              { icon: Sparkles, title: "Add-ons", desc: "Extras like inside windows, deep cleans or specialty equipment may add cost." },
              { icon: Shield, title: "Access & Condition", desc: "Difficult access, severely overgrown areas or special equipment needs." },
            ].map((item) => <div key={item.title} className="rounded-2xl border border-border/40 bg-card p-6"><div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-sage-light"><item.icon className="h-5 w-5 text-sage" /></div><h3 className="mb-2 text-lg font-semibold text-foreground">{item.title}</h3><p className="text-sm text-muted-foreground">{item.desc}</p></div>)}</div>
          </div>
        </section>

        <section className="bg-cta-section section text-white"><div className="container-wide text-center"><h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">Ready to check your service?</h2><p className="mx-auto mb-8 max-w-xl text-lg text-white/80">Choose what you need. We&apos;ll use live pricing where coverage exists—or help source a vetted provider when it doesn&apos;t.</p><div className="flex flex-col justify-center gap-4 sm:flex-row"><Link href="/request" className={cn(buttonVariants({ size: "lg" }), "h-11 bg-accent px-8 text-accent-foreground hover:bg-accent/90")}>Start My Request <ArrowRight className="ml-2 h-5 w-5" /></Link><Link href="/services" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "h-11 border-white/30 bg-white/10 px-8 text-white hover:bg-white/20 hover:text-white")}>Browse All Services</Link></div></div></section>
      </main>
      <Footer />
    </div>
  );
}

function getRecurringPrice(service: { weeklyPrice?: number; avgMonthlyPrice: number; biMonthlyPrice?: number; quarterlyPrice?: number }) {
  if (service.weeklyPrice) return { frequency: "weekly" as const, label: "/visit (weekly)" };
  if (service.avgMonthlyPrice) return { frequency: "monthly" as const, label: "/month" };
  if (service.biMonthlyPrice) return { frequency: "bi-monthly" as const, label: "/visit (bi-monthly)" };
  if (service.quarterlyPrice) return { frequency: "quarterly" as const, label: "/visit (quarterly)" };
  return null;
}

function PublicPrice({ service, frequency, suffix, accent = false }: { service: Service; frequency: RequestFrequency; suffix: string; accent?: boolean }) {
  const effective = frequency === "weekly" ? service.weeklyPrice ?? 0 : frequency === "bi-monthly" ? service.biMonthlyPrice ?? 0 : frequency === "monthly" ? service.avgMonthlyPrice : frequency === "quarterly" ? service.quarterlyPrice ?? 0 : service.oneTimePrice;
  const base = service.basePrices?.[frequency];
  const promoted = Boolean(service.promotionIds?.[frequency] && base && base > effective);
  return <div><p className={cn("text-base font-semibold tabular-nums", accent ? "text-accent" : "text-foreground")}>{promoted && <span className="mr-1.5 text-xs font-normal text-muted-foreground line-through">${base}</span>}From ${effective}<span className="text-xs font-normal text-muted-foreground">{suffix}</span></p>{promoted && <p className="mt-0.5 text-[10px] font-medium text-coral">{service.promotionLabels?.[frequency] || "Limited-time price"}</p>}</div>;
}

type RequestFrequency = "weekly" | "bi-monthly" | "monthly" | "quarterly" | "one-time";

function getRequestFrequencies(service: Service): RequestFrequency[] {
  if (service.availability !== "fixed") return ["one-time"];
  return [
    service.weeklyPrice ? "weekly" as const : null,
    service.biMonthlyPrice ? "bi-monthly" as const : null,
    service.avgMonthlyPrice ? "monthly" as const : null,
    service.quarterlyPrice ? "quarterly" as const : null,
    service.oneTimePrice ? "one-time" as const : null,
  ].filter((frequency): frequency is RequestFrequency => frequency !== null);
}
