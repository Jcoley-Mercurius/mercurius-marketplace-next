"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import {
  Bug,
  Droplets,
  Home as HomeIcon,
  Leaf,
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
import { ProviderDirectoryCard } from "@/components/provider-profile/ProviderDirectoryCard";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { EARLY_ACCESS_CTA, EARLY_ACCESS_PATH } from "@/lib/earlyAccessExperience";
import {
  cardOfferFor,
  profileServices,
  providerProfileHref,
  validProviderId,
  validSlug,
  type CardContext,
  type ProfileService,
} from "@/lib/providerProfile/model";
import { fetchPublicProviderOffers, type ProviderOffers } from "@/lib/providerProfile/publicOffers";

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
  our_promise: string | null;
  verified_specialty: string | null;
};

type DirectoryData = {
  categories: Category[];
  services: CatalogService[];
  contractors: Contractor[];
  /** Published offers for the listed providers, or the fact that they could not be read. */
  offers: ProviderOffers;
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

function formatServiceName(slug: string) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function ProvidersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<DirectoryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");

  /**
   * TRACE-156: the search text lives in the address (?q=), so opening a provider and coming
   * back returns the same result list and the browser's own scroll position. Read natively:
   * this page prerenders, and useSearchParams would need its own boundary around it.
   */
  useEffect(() => {
    const read = () => setSearch(new URLSearchParams(window.location.search).get("q") ?? "");
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const updateSearch = useCallback((value: string) => {
    setSearch(value);
    const params = new URLSearchParams(window.location.search);
    if (value.trim()) params.set("q", value);
    else params.delete("q");
    const query = params.toString();
    // Replace, not push: typing does not fill the history stack, and Back leaves the directory.
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDirectory() {
      setIsLoading(true);
      setLoadError(false);

      try {
        const [categoriesResult, servicesResult, contractorsResult] = await Promise.all([
          supabase.from("service_categories").select("id, name, description, icon").eq("is_active", true).order("sort_order"),
          supabase.from("services_catalog").select("id, name, category_id").eq("is_active", true),
          // TRACE-104: only approved, eligible providers with real content (server-decided).
          supabase.rpc("r0_public_providers"),
        ]);

        if (categoriesResult.error) throw categoriesResult.error;
        if (servicesResult.error) throw servicesResult.error;
        if (contractorsResult.error) throw contractorsResult.error;

        const contractors = (contractorsResult.data ?? []) as Contractor[];
        // TRACE-156: published offers for exactly the listed providers, read in batches. A
        // failure here leaves the directory standing with unpriced cards; it is not a reason to
        // hide a listed provider, and it never shows a lower amount.
        const offers = await fetchPublicProviderOffers(contractors.map((contractor) => contractor.id), supabase);

        if (!cancelled) {
          setData({
            categories: (categoriesResult.data ?? []) as Category[],
            services: (servicesResult.data ?? []) as CatalogService[],
            contractors,
            offers,
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

  /** The catalog names the shared profile model reads, as its own record. */
  const catalogNames = useMemo(
    () => Object.fromEntries((data?.services ?? []).map((service) => [service.id, service.name])),
    [data],
  );

  /**
   * Each listed provider's published services, from the one batched offer read. A provider with
   * no published offer simply has none; `offersUnavailable` is the separate case where the read
   * failed and no absence can be claimed.
   */
  const offersUnavailable = data?.offers.status === "unavailable";
  const servicesByProvider = useMemo(() => {
    const byProvider = new Map<string, ProfileService[]>();
    if (data?.offers.status !== "ready") return byProvider;
    for (const [providerId, packages] of data.offers.packages) {
      byProvider.set(providerId, profileServices({ packages, serviceNames: catalogNames }));
    }
    return byProvider;
  }, [data, catalogNames]);

  /** The catalog services in each category, so a card's lead offer stays inside its group. */
  const categoryServiceIds = useMemo(() => {
    const byCategory = new Map<string, Set<string>>();
    for (const service of data?.services ?? []) {
      byCategory.set(service.category_id, (byCategory.get(service.category_id) ?? new Set()).add(service.id));
    }
    return byCategory;
  }, [data]);

  const grouped = useMemo<ProviderGroup[]>(() => {
    if (!data) return [];

    // The listing's own services array decides the groups, unchanged. It is not the provider's
    // declared services: r0_public_providers returns the active catalog services that have a
    // live, review-cleared, unarchived eligible offering, so a provider with none comes back
    // with an empty array and falls to the catch-all group.
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
          id: "more-active-providers",
          name: "More Active Providers",
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

  /**
   * TRACE-156 (P2B): the directory side of a profile's return. Opening a profile first records
   * which card was opened in this entry's address (replacing it), so the browser's Back returns
   * here with it; the profile's own "Providers" link builds the same address. Once the listing
   * has rendered, that card is brought back into view and its profile link takes focus, and the
   * marker is removed so a later reload starts at the top. Search (?q=) stays.
   */
  const rememberOpened = useCallback((providerId: string, categoryId: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("provider", providerId);
    const category = validSlug(categoryId);
    if (category) params.set("category", category);
    else params.delete("category");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${window.location.hash}`);
  }, []);

  const positionRestored = useRef(false);
  useEffect(() => {
    if (isLoading || !data || positionRestored.current) return;
    positionRestored.current = true;
    const params = new URLSearchParams(window.location.search);
    const providerId = validProviderId(params.get("provider"));
    const categoryId = validSlug(params.get("category"));
    if (!params.has("provider") && !params.has("category")) return;
    params.delete("provider");
    params.delete("category");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    if (!providerId) return;
    const cards = [...document.querySelectorAll<HTMLElement>(`[data-provider-card="${CSS.escape(providerId)}"]`)];
    const card = cards.find((element) => categoryId && element.closest(`[data-directory-category="${CSS.escape(categoryId)}"]`)) ?? cards[0];
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    card.querySelector<HTMLElement>("[data-provider-profile-link]")?.focus({ preventScroll: true });
  }, [isLoading, data]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main id="main-content" tabIndex={-1}>
        <section className="bg-gradient-to-br from-accent/10 via-background to-primary/5 py-16 md:py-24">
          <div className="container-wide mx-auto max-w-3xl text-center">
            <Badge className="mb-4 border-0 bg-accent/10 text-accent">
              {isLoading
                ? "Checking local availability"
                : totalVendors > 0
                  ? `${totalVendors} active ${totalVendors === 1 ? "provider" : "providers"}`
                  : "Our local network is growing"}
            </Badge>
            <h1 className="mb-4 text-4xl font-bold text-foreground md:text-6xl">
              Browse Our Provider Network
            </h1>
            <p className="mb-8 text-lg text-muted-foreground">
              Providers apply with license, insurance, and background-check documentation that Mercurius reviews before they join the network. Browse by category or search for what you need.
            </p>
            <div className="relative mx-auto max-w-xl">
              <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search providers"
                placeholder="Search providers, services, or cities…"
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
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
                    {/* The count is essential information, so it carries the secondary text
                        semantic at full strength rather than a dimmed copy of the label. */}
                    <span className="text-xs text-slate">({vendors.length})</span>
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
              <Button variant="outline" className="mt-4" onClick={() => updateSearch("")}>
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
                  data-directory-category={category.id}
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
                      {vendors.map((contractor) => {
                        // A category group leads with an offer from that category, never another's.
                        const inCategory = categoryServiceIds.get(category.id);
                        const context: CardContext = inCategory ? { kind: "category", serviceIds: inCategory } : { kind: "all" };
                        const card = cardOfferFor(servicesByProvider.get(contractor.id) ?? [], context);
                        return (
                          <ProviderDirectoryCard
                            key={contractor.id}
                            anchorId={`provider-${contractor.id}`}
                            provider={contractor}
                            card={card}
                            unpriced={offersUnavailable ? "unavailable" : "no_offer"}
                            listedServices={(contractor.services ?? []).map(
                              (serviceId) => serviceNames.get(serviceId) ?? formatServiceName(serviceId),
                            )}
                            media={[]}
                            // A category card opens on the service it leads with; the profile
                            // offers All services from there. Search and category travel as
                            // validated values for the profile's return link.
                            href={providerProfileHref(contractor.id, {
                              serviceId: context.kind === "category" ? card?.service.id : null,
                              search,
                              categoryId: category.id,
                            })}
                            onOpen={() => rememberOpened(contractor.id, category.id)}
                          />
                        );
                      })}
                    </div>
                  </div>
                </section>
              );
            })
          )}
        </div>

        <section className="bg-primary/5 py-16">
          <div className="container-wide mx-auto max-w-2xl text-center">
            <h2 className="mb-4 text-2xl font-bold text-foreground md:text-3xl">Booking Is Opening by Invitation</h2>
            {/* On the tinted band the secondary text semantic carries this copy; the muted
                foreground is specified against the plain background, not this one. */}
            <p className="mb-6 text-slate">
              Join early access and we&apos;ll invite Lee County homeowners in stages as approved providers and services are ready in their area.
            </p>
            <Link
              href={EARLY_ACCESS_PATH}
              className={cn(
                buttonVariants({ size: "lg" }),
                "rounded-full bg-accent px-8 text-accent-foreground hover:bg-accent-hover",
              )}
            >
              {EARLY_ACCESS_CTA}
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
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
          We couldn&apos;t confirm current directory coverage. Please try again later. Booking is opening by invitation, and you can join early access now.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href={EARLY_ACCESS_PATH} className={buttonVariants({ size: "lg" })}>{EARLY_ACCESS_CTA}</Link>
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
        <h2 className="mt-6 text-2xl font-bold md:text-3xl">Our provider network is growing</h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          We don&apos;t have public provider profiles to show in your area yet. Join early access to tell us what you need, and we&apos;ll let you know when services are ready in your area.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href={EARLY_ACCESS_PATH} className={buttonVariants({ size: "lg" })}>{EARLY_ACCESS_CTA}</Link>
          <Link href="/vendors/apply" className={buttonVariants({ variant: "outline", size: "lg" })}>Join as a Provider</Link>
        </div>
      </div>
    </section>
  );
}
