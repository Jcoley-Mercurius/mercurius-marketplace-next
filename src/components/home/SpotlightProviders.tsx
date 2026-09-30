"use client";
/* eslint-disable @next/next/no-img-element -- Provider logos are user-managed Supabase assets. */

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Award, BadgeCheck, Briefcase, MapPin, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { fetchCompletedJobCounts } from "@/lib/completedJobs";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type FeaturedRow = {
  id: string;
  contractor_id: string;
  tier: string;
  headline: string | null;
  created_at: string;
};

type Contractor = {
  id: string;
  name: string;
  logo_url: string | null;
  bio: string | null;
  location: string | null;
  years_experience: number | null;
  services: string[] | null;
  badges: string[] | null;
};

type Spotlight = Contractor & {
  featureId: string;
  tier: string;
  headline: string | null;
  completed_jobs: number | null;
};

type Mode = "loading" | "ready" | "error";

export function SpotlightProviders() {
  const [providers, setProviders] = useState<Spotlight[]>([]);
  const [mode, setMode] = useState<Mode>("loading");

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const supabase = createClient();
        const featuredResult = await supabase
          .from("featured_providers")
          .select("id, contractor_id, tier, headline, created_at")
          .eq("is_active", true)
          .order("created_at", { ascending: false })
          .limit(4);
        if (featuredResult.error) throw featuredResult.error;
        const featured = (featuredResult.data ?? []) as FeaturedRow[];
        if (!featured.length) {
          if (active) { setProviders([]); setMode("ready"); }
          return;
        }
        // TRACE-104: a placement shows only while its provider is publicly listed.
        const featuredIds = new Set(featured.map((item) => item.contractor_id));
        const contractorResult = await supabase.rpc("r0_public_providers");
        if (contractorResult.error) throw contractorResult.error;
        let completedJobs = new Map<string, number>();
        try {
          completedJobs = await fetchCompletedJobCounts(featured.map((item) => item.contractor_id));
        } catch (reason) {
          console.warn("Spotlight completed-job counts are unavailable", reason);
        }
        const byId = Object.fromEntries(((contractorResult.data ?? []) as Contractor[]).filter((item) => featuredIds.has(item.id)).map((item) => [item.id, item]));
        const live = featured.flatMap((item) => {
          const contractor = byId[item.contractor_id];
          return contractor ? [{ ...contractor, featureId: item.id, tier: item.tier, headline: item.headline, completed_jobs: completedJobs.get(contractor.id) ?? null }] : [];
        });
        if (active) { setProviders(live); setMode("ready"); }
      } catch (error) {
        console.error("Unable to load live spotlight providers", error);
        if (active) { setProviders([]); setMode("error"); }
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  return (
    <section className="section band-slate band-divider relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-80 w-80 rounded-full bg-coral/5 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-64 w-96 rounded-full bg-sage/5 blur-3xl" />
      <div className="container-wide relative">
        <div className="mb-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-coral/15"><Award className="h-5 w-5 text-coral" /></div>
            <div><h2 className="text-2xl font-bold leading-tight">Spotlight Providers</h2><p className="mt-0.5 text-sm text-slate-dark">Approved providers selected by Mercurius</p></div>
          </div>
          <Link href="/providers" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0 text-slate-dark hover:text-foreground")}>View all<ArrowRight /></Link>
        </div>

        {mode === "loading" && <div className="grid gap-6 md:grid-cols-2">{Array.from({ length: 2 }, (_, index) => <div key={index} className="h-72 animate-pulse rounded-2xl border border-border bg-muted/50" />)}</div>}

        {mode !== "loading" && providers.length === 0 && <div className="rounded-3xl border border-border/70 bg-card p-8 text-center shadow-sm md:p-12"><ShieldCheck className="mx-auto h-10 w-10 text-accent" /><h3 className="mt-4 text-xl font-semibold">Explore our live provider network</h3><p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">{mode === "error" ? "Spotlight placements could not be confirmed right now. The provider directory remains the source of current public listings." : "Featured placements are currently being curated. Browse every provider currently available through Mercurius."}</p><Link href="/providers" className={cn(buttonVariants({ size: "lg" }), "mt-6")}>Browse Providers<ArrowRight /></Link></div>}

        {providers.length > 0 && <div className="grid gap-6 md:grid-cols-2">
          {providers.map((provider, index) => <motion.div key={provider.featureId} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.45, delay: index * 0.08 }}>
            <Link href={`/providers/${provider.id}`} className="group block h-full">
              <article className="relative h-full overflow-hidden rounded-2xl border border-coral-border bg-card shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-coral hover:shadow-lg">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-coral/60 via-coral to-coral/60" />
                <div className="p-6 md:p-8">
                  <div className="mb-5 flex items-start gap-4">
                    {provider.logo_url ? <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-white p-1.5 shadow-sm"><img src={provider.logo_url} alt={`${provider.name} logo`} className="h-full w-full object-contain" /></div> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-sage-light text-xl font-bold text-sage-dark">{initials(provider.name)}</div>}
                    <div className="min-w-0 flex-1"><div className="mb-1 flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold transition-colors group-hover:text-accent">{provider.name}</h3><span className="inline-flex items-center gap-1 rounded-full bg-coral-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-coral ring-1 ring-coral-border"><Award className="h-3 w-3" />{provider.tier}</span></div>{provider.location && <p className="flex items-center gap-1 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{provider.location}</p>}<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">{provider.completed_jobs !== null && provider.completed_jobs > 0 && <span className="flex items-center gap-1 text-muted-foreground"><Briefcase className="h-3.5 w-3.5" />{provider.completed_jobs} completed through Mercurius</span>}{provider.years_experience !== null && <span className="text-muted-foreground">{provider.years_experience}+ yrs</span>}</div></div>
                  </div>
                  {provider.headline && <p className="mb-3 text-sm font-medium leading-relaxed text-foreground/85">“{provider.headline}”</p>}
                  {provider.bio && <p className="mb-5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{provider.bio}</p>}
                  <div className="flex flex-wrap gap-1.5">{provider.badges?.slice(0, 3).map((badge) => <span key={badge} className="inline-flex items-center gap-1 rounded-md border border-accent-border bg-accent-soft px-2 py-1 text-[11px] font-medium text-sage-dark"><BadgeCheck className="h-3 w-3" />{badge}</span>)}{provider.services?.slice(0, 3).map((service) => <span key={service} className="rounded-md bg-slate-soft px-2 py-1 text-[11px] font-medium text-muted-foreground">{formatService(service)}</span>)}</div>
                  <p className="mt-6 flex items-center text-sm font-semibold text-accent">View full storefront<ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-1" /></p>
                </div>
              </article>
            </Link>
          </motion.div>)}

          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.45, delay: providers.length * 0.08 }}>
            <div className="relative h-full overflow-hidden rounded-2xl border border-coral-border bg-gradient-to-br from-coral-soft via-card to-accent-soft p-7 shadow-sm md:p-8"><div className="mb-5 inline-flex items-center gap-2 rounded-full bg-coral-soft px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-coral ring-1 ring-coral-border"><Award className="h-3.5 w-3.5" />Why Spotlight</div><h3 className="text-xl font-bold">Not just listed. <span className="text-coral">Recognized.</span></h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Spotlight placements are tied to real active Mercurius provider records and are managed by our team.</p><div className="mt-6 space-y-3">{["Active public provider profile", "Customer-facing services and credentials", "Performance information from live records"].map((text) => <div key={text} className="flex items-center gap-2.5"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-coral-soft"><BadgeCheck className="h-3.5 w-3.5 text-coral" /></span><span className="text-sm font-medium text-foreground/80">{text}</span></div>)}</div><Link href="/providers" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-7 border-coral-border")}>Explore all providers<ArrowRight /></Link></div>
          </motion.div>
        </div>}
      </div>
    </section>
  );
}

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join("").toUpperCase();
}

function formatService(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
