"use client";
/* eslint-disable @next/next/no-img-element -- Provider logos are user-managed Supabase URLs and may be signed. */

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, BadgeCheck, Loader2, MapPin, RefreshCw, SearchX, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EARLY_ACCESS_CTA } from "@/lib/earlyAccessExperience";
import { createClient } from "@/lib/supabase/client";
import type { PricingFrequency } from "@/lib/vendorPricing";

export type EligibleProvider = {
  contractor_id: string;
  contractor_name: string;
  logo_url: string | null;
  area_hint: string | null;
  badges: string[] | null;
  package_id: string;
  package_tier_id: string | null;
  promotion_id: string | null;
  frequency: PricingFrequency;
  path: "fixed" | "quote";
  base_price: number | null;
  effective_price: number | null;
  rank_order: number;
};

export function EligibleProvidersRow({
  serviceId,
  serviceName,
  frequency,
  zipCode,
  onChoose,
  invited = false,
}: {
  serviceId: string;
  serviceName: string;
  frequency: PricingFrequency;
  zipCode: string;
  onChoose: (provider: EligibleProvider) => void;
  /** TRACE-103: without an admitted account, choosing leads to early access instead. */
  invited?: boolean;
}) {
  const [providers, setProviders] = useState<EligibleProvider[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (isActive: () => boolean) => {
    setStatus("loading");
    const result = await createClient().rpc("find_public_eligible_providers", {
      _service_id: serviceId,
      _frequency: frequency,
      _zip_code: zipCode,
    });
    if (!isActive()) return;
    if (result.error) {
      setProviders([]);
      setStatus("error");
      return;
    }
    const rows = (result.data ?? []) as EligibleProvider[];
    setProviders(rows);
    setStatus(rows.length > 0 ? "ready" : "empty");
  }, [frequency, serviceId, zipCode]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) void load(() => active);
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [load, reloadKey]);

  return (
    <section aria-labelledby={`eligible-${serviceId}`} className="min-w-0">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h3 id={`eligible-${serviceId}`} className="truncate text-lg font-semibold text-white">
            Pros for {serviceName}
          </h3>
          <p className="mt-1 text-sm text-white/55">Eligible for {zipCode} · {frequencyLabel(frequency)}</p>
        </div>
        {status === "ready" && <p className="shrink-0 text-xs text-white/40">{providers.length} available</p>}
      </div>

      {status === "loading" && (
        <div className="flex min-h-52 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-sm text-white/55" role="status">
          <Loader2 className="mr-2 h-4 w-4 animate-spin text-accent" />Checking live provider coverage…
        </div>
      )}

      {status === "error" && (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-6 text-center">
          <RefreshCw className="h-5 w-5 text-white/45" />
          <p className="mt-3 text-sm font-medium text-white">Provider availability could not be checked.</p>
          <p className="mt-1 max-w-md text-xs leading-5 text-white/50">You can still use Match me and confirm your address in the request.</p>
          <Button type="button" size="sm" variant="outline" className="mt-4 border-white/15 bg-transparent text-white hover:bg-white/10" onClick={() => setReloadKey((key) => key + 1)}>
            Try again
          </Button>
        </div>
      )}

      {status === "empty" && (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 px-6 text-center">
          <SearchX className="h-6 w-6 text-white/35" />
          <p className="mt-3 text-sm font-medium text-white">No eligible provider is published for this ZIP yet.</p>
          <p className="mt-1 max-w-md text-xs leading-5 text-white/50">{invited ? "Choose Match me to send a sourcing request. We’ll confirm coverage before presenting a provider or price." : "Booking opens by invitation. Join early access to be considered when this service opens in your area."}</p>
        </div>
      )}

      {status === "ready" && (
        <div className="-mx-4 overflow-x-auto px-4 pb-3 [scrollbar-color:hsl(220_16%_34%)_transparent] sm:-mx-2 sm:px-2">
          <div className="flex w-max snap-x snap-mandatory gap-4">
            {providers.map((provider) => (
              <ProviderCard key={`${provider.contractor_id}:${provider.package_id}:${provider.package_tier_id ?? "quote"}`} provider={provider} zipCode={zipCode} onChoose={onChoose} invited={invited} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ProviderCard({ provider, zipCode, onChoose, invited }: { provider: EligibleProvider; zipCode: string; onChoose: (provider: EligibleProvider) => void; invited: boolean }) {
  const badges = (provider.badges ?? []).filter((badge) => badge.trim() && badge.toLowerCase() !== "top rated").slice(0, 3);
  const initials = provider.contractor_name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "MP";
  const fixedPrice = provider.path === "fixed" && provider.effective_price !== null ? Number(provider.effective_price) : null;

  return (
    <article className="flex w-[min(78vw,19rem)] snap-start flex-col overflow-hidden rounded-2xl border border-white/12 bg-[hsl(220_22%_16%)] shadow-[0_18px_36px_-24px_hsl(220_50%_2%_/_0.95)] sm:w-72">
      <div className="flex items-start gap-3 p-5 pb-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
          {provider.logo_url ? <img src={provider.logo_url} alt="" className="h-full w-full object-contain p-1.5" /> : <span className="text-sm font-bold text-white/65">{initials}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 font-semibold leading-5 text-white">{provider.contractor_name}</p>
          <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-white/50"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{provider.area_hint?.trim() || `Serves ${zipCode}`}</p>
        </div>
      </div>

      <div className="min-h-12 px-5">
        {badges.length > 0 ? <div className="flex flex-wrap gap-1.5">{badges.map((badge) => <span key={badge} className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent"><BadgeCheck className="h-3 w-3" />{badge}</span>)}</div> : <p className="flex items-center gap-1.5 text-xs text-white/40"><ShieldCheck className="h-3.5 w-3.5" />Eligible Mercurius provider</p>}
      </div>

      <div className="mt-auto border-t border-white/10 p-5">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">{fixedPrice !== null ? "Live package" : "Pricing path"}</p><p className="mt-1 text-xl font-semibold tabular-nums text-white">{fixedPrice !== null ? priceLabel(fixedPrice, provider.frequency) : "Quote"}</p></div>
          <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-white/50">{provider.path === "fixed" ? "Fixed" : "Quote"}</span>
        </div>
        <Button type="button" className="w-full rounded-xl bg-coral font-semibold text-coral-foreground hover:bg-coral-dark" onClick={() => onChoose(provider)}>
          {invited ? "Choose this pro" : EARLY_ACCESS_CTA} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </article>
  );
}

function priceLabel(price: number, frequency: PricingFrequency) {
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(price);
  if (frequency === "weekly") return `${amount}/wk`;
  if (frequency === "bi-monthly") return `${amount}/2 wks`;
  if (frequency === "monthly") return `${amount}/mo`;
  if (frequency === "quarterly") return `${amount}/qtr`;
  return amount;
}

function frequencyLabel(frequency: PricingFrequency) {
  if (frequency === "bi-monthly") return "Every two weeks";
  if (frequency === "one-time") return "One-time";
  return frequency.charAt(0).toUpperCase() + frequency.slice(1);
}
