"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { MarketingCta, MarketingHero, MarketingShell } from "@/components/marketing/MarketingShell";
import { serviceCategories, services } from "@/components/marketing/marketing-data";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function ServicesPage() {
  const [category, setCategory] = useState("all");
  const filtered = useMemo(() => category === "all" ? services : services.filter((service) => service.category === category), [category]);

  return <MarketingShell>
    <MarketingHero eyebrow="Our Services" title={<>Everything Your Home Needs, <span className="hero-gradient-text">Handled</span></>} description="From routine maintenance to specialized care, we manage it all with vetted professionals and quality guarantees.">
      <Link href="/request" className={cn(buttonVariants({ size: "lg" }), "h-11 bg-accent px-7 text-accent-foreground hover:bg-accent/90")}>Request a Service<ArrowRight /></Link>
    </MarketingHero>

    <section className="section-sm"><div className="container-wide">
      <div className="mb-9 flex flex-wrap justify-center gap-2"><button onClick={() => setCategory("all")} className={pill(category === "all")}>All Services</button>{serviceCategories.map(({ id, name, icon: Icon }) => <button key={id} onClick={() => setCategory(id)} className={pill(category === id)}><Icon className="h-4 w-4" />{name}</button>)}</div>
      <p className="mb-6 text-center text-sm text-muted-foreground">{filtered.length} service{filtered.length === 1 ? "" : "s"} available</p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{filtered.map((service) => { const Icon = service.icon; const categoryName = serviceCategories.find((item) => item.id === service.category)?.name; return <article key={service.id} className="group flex h-full flex-col rounded-2xl border border-border/50 bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-md"><div className="flex items-start justify-between"><span className="flex h-13 w-13 items-center justify-center rounded-2xl bg-sage-light transition group-hover:bg-accent"><Icon className="h-6 w-6 text-sage-dark group-hover:text-accent-foreground" /></span>{service.popular && <Badge className="border-accent/20 bg-accent/10 text-accent">Popular</Badge>}</div><h2 className="mt-5 text-lg font-semibold">{service.name}</h2><p className="mt-1 text-xs text-muted-foreground">{categoryName}</p><p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{service.description}</p><div className="mt-5 flex items-end justify-between border-t pt-4"><div><p className="text-xs text-muted-foreground">Starting at</p><p className="font-semibold text-accent">{service.oneTime ? `$${service.oneTime}` : "Custom quote"}</p></div><Link href={`/request?service=${service.id}`} aria-label={`Request ${service.name}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-muted transition hover:bg-accent hover:text-accent-foreground"><ArrowRight className="h-4 w-4" /></Link></div></article>; })}</div>
    </div></section>

    <section className="section-sm bg-muted/60"><div className="container-wide grid items-center gap-10 lg:grid-cols-2"><div><span className="badge-accent">The Mercurius Standard</span><h2 className="mt-4 text-3xl font-bold">Ready to Get Started?</h2><p className="mt-3 text-muted-foreground">Browse our services and request what you need. Transparent pricing, vetted professionals, and quality guaranteed on every visit.</p><ul className="mt-6 grid gap-3 sm:grid-cols-2">{["Vetted professionals", "Transparent pricing", "Simple scheduling", "Quality guaranteed"].map((item) => <li key={item} className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4 text-accent" />{item}</li>)}</ul></div><div className="grid grid-cols-2 gap-4">{[["100%", "Guaranteed"], ["1", "Simple Bill"], ["24/7", "Support"], ["Vetted", "Professionals"]].map(([value,label]) => <div key={label} className="rounded-2xl border bg-card p-6 text-center"><p className="text-2xl font-bold text-sage-dark">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></div>)}</div></div></section>
    <MarketingCta title="Ready to Get Started?" description="Browse our services and request what you need. Transparent pricing, vetted professionals, and quality guaranteed on every visit." primaryLabel="Request a Service" secondaryLabel="Contact Us" secondaryHref="/contact" />
  </MarketingShell>;
}

function pill(active: boolean) { return cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors", active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground"); }
