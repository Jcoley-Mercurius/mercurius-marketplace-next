"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, CircleAlert, Loader2, RefreshCw, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServiceCatalog } from "@/hooks/useServiceCatalog";
import { EARLY_ACCESS_CTA } from "@/lib/earlyAccessExperience";
import type { Service } from "@/lib/serviceData";
import { ALL_SERVICES_ANCHOR, livePriceFor, serviceDestination, type PublicCatalog } from "@/lib/servicesPage/catalog";
import { cn } from "@/lib/utils";

type Row = { id: string; name: string; categoryId: string; descriptor: string };

/**
 * TRACE-161: the full catalog as compact rows under the existing category filters.
 *
 * Names, descriptions and links come from the server read (`initial`) so they are in the initial
 * HTML. Pricing and availability appear only after the browser catalog read succeeds, because only
 * that read applies the provider-listing and package-eligibility rules. If it fails, the rows stay
 * and say nothing about price or availability rather than claiming that nothing is available.
 */
export function ServicesCatalog({ initial, icons }: { initial: PublicCatalog | null; icons: Record<string, ReactNode> }) {
  const [category, setCategory] = useState("all");
  const { services, categories, loading, error, retry } = useServiceCatalog();
  const live = !loading && !error;

  const rows: Row[] = live ? services : initial?.services ?? (loading ? [] : services);
  const filters = live ? categories : initial?.categories ?? categories;
  const liveById = useMemo(() => new Map<string, Service>(live ? services.map((service) => [service.id, service]) : []), [live, services]);
  const filtered = category === "all" ? rows : rows.filter((row) => row.categoryId === category);
  const coverage = filtered.filter((row) => (liveById.get(row.id)?.availability ?? "sourcing") !== "sourcing").length;
  const waiting = loading && !initial;

  return (
    <section aria-labelledby={ALL_SERVICES_ANCHOR} className="pb-8 pt-10 md:pt-14">
      <div className="container-wide">
        <h2 id={ALL_SERVICES_ANCHOR} className="scroll-mt-24 text-2xl font-bold tracking-tight sm:text-3xl">All home services</h2>

        <div role="group" aria-label="Filter services by category" className="mt-5 flex flex-wrap gap-2 sm:mt-6">
          <FilterButton active={category === "all"} onClick={() => setCategory("all")}>All services</FilterButton>
          {filters.map(({ id, name }) => (
            <FilterButton key={id} active={category === id} onClick={() => setCategory(id)}>{name}</FilterButton>
          ))}
        </div>

        {error && (
          <div role="alert" className="mt-5 flex flex-col gap-3 rounded-xl border border-status-info bg-status-info-bg p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm text-foreground">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-info" />
              <span><strong className="font-semibold">We couldn’t load current pricing and availability.</strong> Services are listed without prices until it loads.</span>
            </p>
            <Button type="button" variant="outline" onClick={retry} className="shrink-0"><RefreshCw aria-hidden="true" />Try again</Button>
          </div>
        )}

        {waiting ? (
          <div role="status" className="flex items-center justify-center py-20">
            <Loader2 aria-hidden="true" className="size-8 animate-spin text-accent" />
            <span className="sr-only">Loading service catalog</span>
          </div>
        ) : (
          <>
            <p aria-live="polite" className="mt-5 text-sm text-muted-foreground">
              Showing {filtered.length} service{filtered.length === 1 ? "" : "s"}
              {live && <> · {coverage} with live provider coverage</>}
              {loading && <span className="ml-2 inline-flex items-center gap-1.5"><Loader2 aria-hidden="true" className="size-3.5 animate-spin" />Checking current pricing and availability…</span>}
            </p>
            {filtered.length === 0 ? (
              <div className="mt-3 rounded-2xl border border-border bg-card p-6 text-center">
                <p className="font-semibold text-foreground">No services are listed in this category yet.</p>
                <Button type="button" variant="outline" className="mt-4" onClick={() => setCategory("all")}>Show all services</Button>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                {filtered.map((row) => (
                  <ServiceRow key={row.id} row={row} icon={icons[row.id]} live={liveById.get(row.id) ?? null} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? "border-commitment bg-commitment text-commitment-foreground"
          : "border-border-strong bg-card text-foreground hover:bg-surface-hover",
      )}
    >
      {children}
    </button>
  );
}

function ServiceRow({ row, icon, live }: { row: Row; icon: ReactNode; live: Service | null }) {
  return (
    <li data-service-row={row.id} className="flex gap-4 px-4 py-4 sm:items-center sm:px-5">
      <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-sage-light text-sage-dark">
        {icon ?? <Star className="size-6" />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground sm:text-lg">{row.name}</h3>
          {row.descriptor && <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{row.descriptor}</p>}
          {live && <Availability service={live} />}
        </div>
        <Link
          href={serviceDestination(row.id)}
          aria-label={`${EARLY_ACCESS_CTA} for ${row.name}`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-lg font-semibold text-commitment underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-focus-ring sm:self-center sm:px-2"
        >
          {EARLY_ACCESS_CTA}<ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </li>
  );
}

function Availability({ service }: { service: Service }) {
  const availability = service.availability ?? "sourcing";
  const price = availability === "fixed" ? livePriceFor(service) : null;
  if (price) {
    return <p data-availability="fixed" className="mt-1 text-sm text-muted-foreground">
      Package pricing from <span className="font-semibold text-foreground">${price.price}</span>{price.suffix}
    </p>;
  }
  if (availability === "quote") {
    return <p data-availability="quote" className="mt-1 text-sm text-muted-foreground">
      <span className="font-semibold text-foreground">Quote available</span> · price confirmed before work begins
    </p>;
  }
  if (availability === "fixed") return null;
  return <p data-availability="sourcing" className="mt-1 text-sm text-muted-foreground">Not available yet in your area</p>;
}
