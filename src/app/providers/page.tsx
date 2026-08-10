"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bug,
  Droplets,
  Home as HomeIcon,
  Leaf,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Waves,
  Wind,
  Wrench,
  Zap,
} from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Category = {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
};

type CatalogService = {
  id: string;
  name: string;
  category_id: string;
};

type Contractor = {
  id: string;
  name: string;
  logo_url: string | null;
  bio: string | null;
  location: string | null;
  badges: string[] | null;
  services: string[] | null;
  years_experience: number | null;
  is_active: boolean | null;
  marketing_enabled: boolean | null;
  special_offer: string | null;
  our_promise: string | null;
  verified_specialty: string | null;
};

type DirectoryData = {
  categories: Category[];
  services: CatalogService[];
  contractors: Contractor[];
};

type ProviderGroup = {
  category: Category;
  vendors: Contractor[];
};

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  Leaf,
  Sparkles,
  Wind,
  Wrench,
  Bug,
  Waves,
  Droplets,
  Zap,
  Home: HomeIcon,
  Star,
  Trash2,
};

const contractorSafeSelect =
  "id, name, logo_url, bio, location, badges, services, years_experience, is_active, marketing_enabled, special_offer, our_promise, verified_specialty";

function formatServiceName(slug: string) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function ProvidersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<DirectoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadDirectory() {
      setIsLoading(true);
      setLoadError(false);

      try {
        const [categoriesResult, servicesResult, contractorsResult] = await Promise.all([
          supabase.from("service_categories").select("id, name, description, icon").eq("is_active", true).order("sort_order"),
          supabase.from("services_catalog").select("id, name, category_id").eq("is_active", true),
          supabase.from("contractors").select(contractorSafeSelect).eq("is_active", true).order("name"),
        ]);

        if (categoriesResult.error) throw categoriesResult.error;
        if (servicesResult.error) throw servicesResult.error;
        if (contractorsResult.error) throw contractorsResult.error;

        if (!cancelled) {
          setData({
            categories: (categoriesResult.data ?? []) as Category[],
            services: (servicesResult.data ?? []) as CatalogService[],
            contractors: (contractorsResult.data ?? []) as Contractor[],
          });
        }
      } catch (error) {
        console.error("Unable to load provider directory", error);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const serviceNames = useMemo(
    () => new Map((data?.services ?? []).map((service) => [service.id, service.name])),
    [data],
  );

  const grouped = useMemo<ProviderGroup[]>(() => {
    if (!data) return [];

    const serviceToCategory = new Map(data.services.map((service) => [service.id, service.category_id]));
    const groups = data.categories
      .map((category) => ({
        category,
        vendors: data.contractors.filter((contractor) =>
          contractor.services?.some((serviceId) => serviceToCategory.get(serviceId) === category.id),
        ),
      }))
      .filter((group) => group.vendors.length > 0);

    const groupedVendorIds = new Set(groups.flatMap((group) => group.vendors.map((vendor) => vendor.id)));
    const uncategorized = data.contractors.filter((contractor) => !groupedVendorIds.has(contractor.id));

    if (uncategorized.length > 0) {
      groups.push({
        category: {
          id: "more-verified-providers",
          name: "More Verified Providers",
          description: "Active local providers whose services are still being added to our catalog.",
          icon: "Star",
        },
        vendors: uncategorized,
      });
    }

    return groups;
  }, [data]);

  const filteredGrouped = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return grouped;

    return grouped
      .map((group) => ({
        ...group,
        vendors: group.vendors.filter((vendor) =>
          [
            vendor.name,
            vendor.location ?? "",
            ...(vendor.services ?? []).map((serviceId) => serviceNames.get(serviceId) ?? formatServiceName(serviceId)),
          ].some((value) => value.toLowerCase().includes(query)),
        ),
      }))
      .filter((group) => group.vendors.length > 0);
  }, [grouped, search, serviceNames]);

  const totalVendors = data?.contractors.length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <section className="bg-gradient-to-br from-accent/10 via-background to-primary/5 py-16 md:py-24">
          <div className="container-wide mx-auto max-w-3xl text-center">
            <Badge className="mb-4 border-0 bg-accent/10 text-accent">
              {isLoading
                ? "Checking local availability"
                : totalVendors > 0
                  ? `${totalVendors} verified ${totalVendors === 1 ? "provider" : "providers"}`
                  : "Our local network is growing"}
            </Badge>
            <h1 className="mb-4 text-4xl font-bold text-foreground md:text-6xl">
              Browse Our Verified Providers
            </h1>
            <p className="mb-8 text-lg text-muted-foreground">
              Every contractor is background-checked, insured, and quality-monitored. Browse by category or search for what you need.
            </p>
            <div className="relative mx-auto max-w-xl">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search providers"
                placeholder="Search providers, services, or cities…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-14 rounded-full bg-background pl-12 text-base shadow-sm"
              />
            </div>
          </div>
        </section>

        {!isLoading && grouped.length > 0 && (
          <section className="sticky top-16 z-30 border-b border-border bg-background/95 backdrop-blur">
            <div className="container-wide flex flex-wrap justify-center gap-2 py-4">
              {grouped.map(({ category, vendors }) => {
                const Icon = iconMap[category.icon ?? ""] ?? Star;
                return (
                  <a
                    key={category.id}
                    href={`#cat-${category.id}`}
                    className="inline-flex items-center gap-2 rounded-full bg-muted px-4 py-2 text-sm font-medium transition-colors hover:bg-accent/10 hover:text-accent"
                  >
                    <Icon className="h-4 w-4" />
                    {category.name}
                    <span className="text-xs opacity-60">({vendors.length})</span>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        <div>
          {isLoading ? (
            <DirectorySkeleton />
          ) : loadError ? (
            <DirectoryUnavailable />
          ) : totalVendors === 0 ? (
            <GrowingNetwork />
          ) : filteredGrouped.length === 0 ? (
            <div className="container-wide py-20 text-center">
              <Search className="mx-auto h-9 w-9 text-muted-foreground" />
              <p className="mt-4 text-lg text-muted-foreground">No providers match your search.</p>
              <Button variant="outline" className="mt-4" onClick={() => setSearch("")}>
                Clear search
              </Button>
            </div>
          ) : (
            filteredGrouped.map(({ category, vendors }, index) => {
              const Icon = iconMap[category.icon ?? ""] ?? Star;
              return (
                <section
                  key={category.id}
                  id={`cat-${category.id}`}
                  className={cn(
                    "scroll-mt-32 border-b border-border/40 py-14 md:py-20",
                    index % 2 === 1 ? "bg-muted/40" : "bg-background",
                  )}
                >
                  <div className="container-wide">
                    <div className="mb-8 flex items-center gap-4">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent/10 ring-1 ring-accent/20">
                        <Icon className="h-7 w-7 text-accent" />
                      </div>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="text-2xl font-bold text-foreground md:text-3xl">{category.name}</h2>
                          <Badge variant="secondary" className="rounded-full">
                            {vendors.length} {vendors.length === 1 ? "provider" : "providers"}
                          </Badge>
                        </div>
                        {category.description && (
                          <p className="mt-1 text-sm text-muted-foreground">{category.description}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {vendors.map((contractor) => (
                        <ProviderCard key={contractor.id} contractor={contractor} serviceNames={serviceNames} />
                      ))}
                    </div>
                  </div>
                </section>
              );
            })
          )}
        </div>

        <section className="bg-primary/5 py-16">
          <div className="container-wide mx-auto max-w-2xl text-center">
            <h2 className="mb-4 text-2xl font-bold text-foreground md:text-3xl">Ready to Book a Service?</h2>
            <p className="mb-6 text-muted-foreground">
              Skip the comparison shopping — build your plan and we&apos;ll match you with the right verified provider.
            </p>
            <Link
              href="/?builder=services#bundle-builder"
              className={cn(
                buttonVariants({ size: "lg" }),
                "rounded-full bg-accent px-8 text-accent-foreground hover:bg-accent/90",
              )}
            >
              Build Your Plan
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ProviderCard({
  contractor,
  serviceNames,
}: {
  contractor: Contractor;
  serviceNames: Map<string, string>;
}) {
  return (
    <Card id={`provider-${contractor.id}`} className="group scroll-mt-28 border border-border transition-all hover:-translate-y-0.5 hover:shadow-lg">
      <CardContent className="flex h-full flex-col gap-4 p-6">
        <div className="flex items-start gap-4">
          {contractor.logo_url ? (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-border bg-white p-1">
              {/* Provider logos are user-managed external assets, so a standard image avoids remote-host restrictions. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={contractor.logo_url} alt={`${contractor.name} logo`} className="h-full w-full object-contain" />
            </div>
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-accent/10">
              <ShieldCheck className="h-7 w-7 text-accent" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <Link href={`/providers/${contractor.id}`} className="block truncate font-semibold text-foreground transition-colors group-hover:text-accent">
              {contractor.name}
            </Link>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              {contractor.location && (
                <span className="flex min-w-0 items-center gap-1 truncate">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{contractor.location}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {contractor.bio && <p className="line-clamp-2 text-sm text-muted-foreground">{contractor.bio}</p>}

        <div className="flex flex-wrap gap-1.5">
          {contractor.services?.slice(0, 3).map((serviceId) => (
            <Badge key={serviceId} variant="secondary" className="text-[11px] font-normal">
              {serviceNames.get(serviceId) ?? formatServiceName(serviceId)}
            </Badge>
          ))}
          {(contractor.services?.length ?? 0) > 3 && (
            <Badge variant="secondary" className="text-[11px] font-normal">
              +{(contractor.services?.length ?? 0) - 3}
            </Badge>
          )}
        </div>

        <Link
          href={`/providers/${contractor.id}`}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "mt-auto transition-colors group-hover:border-accent group-hover:text-accent",
          )}
        >
          View Full Profile <ArrowRight className="ml-1 h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
}

function DirectorySkeleton() {
  return (
    <section className="container-wide py-12">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Card key={index} className="animate-pulse">
            <CardContent className="space-y-4 p-6">
              <div className="h-12 w-12 rounded-lg bg-muted" />
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-3 w-full rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function DirectoryUnavailable() {
  return (
    <section className="container-wide py-16 md:py-20">
      <div className="mx-auto max-w-2xl rounded-3xl border border-border bg-card p-8 text-center shadow-sm md:p-12">
        <ShieldCheck className="mx-auto h-11 w-11 text-accent" />
        <h2 className="mt-5 text-2xl font-bold">Live provider availability is temporarily unavailable</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          We couldn&apos;t confirm current directory coverage. Submit a request and our team will check for a vetted local professional before anything is booked.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/request" className={buttonVariants({ size: "lg" })}>Request a Service</Link>
          <Link href="/contact" className={buttonVariants({ variant: "outline", size: "lg" })}>Contact Us</Link>
        </div>
      </div>
    </section>
  );
}

function GrowingNetwork() {
  return (
    <section className="container-wide py-16 md:py-20">
      <div className="mx-auto max-w-2xl rounded-3xl border border-accent/20 bg-gradient-to-br from-card to-accent/5 p-8 text-center shadow-sm md:p-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 ring-1 ring-accent/20">
          <ShieldCheck className="h-8 w-8 text-accent" />
        </div>
        <h2 className="mt-6 text-2xl font-bold md:text-3xl">Our vetted network is growing</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          We don&apos;t have public provider profiles to show in your area yet. Tell us what you need and we&apos;ll work to source a qualified local pro—without pretending coverage is already available.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/request" className={buttonVariants({ size: "lg" })}>Request a Service</Link>
          <Link href="/vendors/apply" className={buttonVariants({ variant: "outline", size: "lg" })}>Join as a Provider</Link>
        </div>
      </div>
    </section>
  );
}
