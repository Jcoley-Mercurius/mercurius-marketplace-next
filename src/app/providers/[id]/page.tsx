"use client";
/* eslint-disable @next/next/no-img-element -- Provider logos and gallery URLs are user-managed Supabase assets. */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Award,
  BadgeCheck,
  Briefcase,
  Check,
  MapPin,
  RefreshCw,
  Shield,
  Star,
} from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { PublicReviewAuthor } from "@/components/reviews/PublicReviewAuthor";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchCompletedJobCounts } from "@/lib/completedJobs";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  isPricingFrequency,
  isPubliclyEligibleFixedPackage,
  isPubliclyEligibleQuotePackage,
  promotionForPackage,
  resolveEffectiveTierPrice,
  type PackagePromotion,
  type PricingFrequency,
} from "@/lib/vendorPricing";

type PricingMode = "fixed" | "deposit_quote" | "custom_quote";
type Frequency = PricingFrequency;

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
  video_url: string | null;
  website: string | null;
  tagline: string | null;
};

type Review = {
  id: string;
  contractor_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
  visibility: string;
};

type PackageRow = {
  id: string;
  contractor_id: string;
  service_id: string;
  name: string;
  description: string | null;
  pricing_mode: string;
  default_frequency: string;
  deposit_amount: number | null;
  is_active: boolean;
  needs_review: boolean | null;
  sort_order: number;
};

type PackageTier = {
  id: string;
  package_id: string;
  name: string;
  price: number;
  includes: string[] | null;
  sort_order: number;
};

type VendorPackage = Omit<PackageRow, "pricing_mode" | "default_frequency"> & {
  pricing_mode: PricingMode;
  default_frequency: Frequency;
  tiers: PackageTier[];
  promotions: PackagePromotion[];
};

type GalleryItem = {
  id: string;
  image_url: string;
  caption: string | null;
  sort_order: number;
};

type PageMode = "loading" | "ready" | "missing" | "error";

const contractorSafeSelect = [
  "id",
  "name",
  "logo_url",
  "bio",
  "location",
  "badges",
  "services",
  "years_experience",
  "is_active",
  "marketing_enabled",
  "special_offer",
  "our_promise",
  "verified_specialty",
  "video_url",
  "website",
  "tagline",
].join(", ");

const serviceFallbacks: Record<string, string> = {
  "lawn-care": "Lawn Care",
  "lawn-mowing": "Lawn Care",
  "pool-service": "Pool Service",
  "house-cleaning": "House Cleaning",
  handyman: "Handyman",
  "pressure-washing": "Pressure Washing",
  "gutter-cleaning": "Gutter Cleaning",
  "window-cleaning": "Window Cleaning",
  "pest-control": "Pest Control",
  "ac-maintenance": "AC Maintenance",
  "plumbing-repair": "Plumbing Repair",
  "electrical-repair": "Electrical Repair",
  "appliance-repair": "Appliance Repair",
  "roof-inspection": "Roof Inspection",
  "tree-trimming": "Tree Trimming",
  "junk-removal": "Junk Removal",
  "garage-door-repair": "Garage Door Repair",
  "floor-cleaning": "Floor Cleaning",
  "painting-touch-ups": "Painting Touch-ups",
  "fence-repair": "Fence Repair",
  "rental-turnover-cleaning": "Rental Turnover Cleaning",
};

export default function ProviderStorefrontPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const contractorId = typeof params.id === "string" ? params.id : "";
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [packages, setPackages] = useState<VendorPackage[]>([]);
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({});
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [completedJobCount, setCompletedJobCount] = useState<number | null>(null);
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [mode, setMode] = useState<PageMode>("loading");
  const [error, setError] = useState("");

  const load = useCallback(async (showLoading = false) => {
    if (!contractorId) {
      setMode("missing");
      return;
    }
    if (showLoading) setMode("loading");
    setError("");

    try {
      const supabase = createClient();
      const completedJobsPromise = fetchCompletedJobCounts([contractorId])
        .then((counts) => counts.get(contractorId) ?? null)
        .catch((reason) => {
          console.warn("Public completed-job count is unavailable", reason);
          return null;
        });
      const [contractorResult, reviewsResult, packagesResult, catalogResult, galleryResult] = await Promise.all([
        supabase.from("contractors").select(contractorSafeSelect).eq("id", contractorId).maybeSingle(),
        supabase
          .from("reviews")
          .select("id, contractor_id, rating, comment, created_at, visibility")
          .eq("contractor_id", contractorId)
          .eq("visibility", "eligible_for_google")
          .order("created_at", { ascending: false }),
        supabase
          .from("vendor_packages")
          .select("id, contractor_id, service_id, name, description, pricing_mode, default_frequency, deposit_amount, is_active, needs_review, sort_order")
          .eq("contractor_id", contractorId)
          .eq("is_active", true)
          .eq("needs_review", false)
          .order("sort_order"),
        supabase.from("services_catalog").select("id, name").eq("is_active", true),
        supabase
          .from("contractor_gallery")
          .select("id, image_url, caption, sort_order")
          .eq("contractor_id", contractorId)
          .order("sort_order"),
      ]);

      if (contractorResult.error) throw contractorResult.error;
      if (!contractorResult.data) {
        setContractor(null);
        setReviews([]);
        setPackages([]);
        setGallery([]);
        setCompletedJobCount(null);
        setMode("missing");
        return;
      }

      const supportingError = reviewsResult.error ?? packagesResult.error ?? catalogResult.error ?? galleryResult.error;
      if (supportingError) throw supportingError;

      const packageRows = (packagesResult.data ?? []) as PackageRow[];
      const packageIds = packageRows.map((item) => item.id);
      const [tiersResult, promotionsResult, clockResult] = await Promise.all([
        packageIds.length ? supabase
            .from("package_tiers")
            .select("id, package_id, name, price, includes, sort_order")
            .in("package_id", packageIds)
            .order("sort_order")
          : Promise.resolve({ data: [] as PackageTier[], error: null }),
        packageIds.length ? supabase
          .from("package_promotions")
          .select("id, package_id, promotion_type, percent_off, fixed_price, label, starts_at, ends_at, is_enabled, created_at, updated_at")
          .in("package_id", packageIds)
          .eq("is_enabled", true)
          : Promise.resolve({ data: [] as PackagePromotion[], error: null }),
        supabase.rpc("pricing_server_now"),
      ]);
      if (tiersResult.error) throw tiersResult.error;
      const promotionReady = !promotionsResult.error && !clockResult.error && typeof clockResult.data === "string";
      const promotions = promotionReady ? (promotionsResult.data ?? []) as PackagePromotion[] : [];
      setServerNow(promotionReady ? clockResult.data as string : null);

      setContractor(contractorResult.data as unknown as Contractor);
      setReviews((reviewsResult.data ?? []) as Review[]);
      setServiceNames(Object.fromEntries((catalogResult.data ?? []).map((service) => [service.id, service.name])));
      setGallery((galleryResult.data ?? []) as GalleryItem[]);
      setCompletedJobCount(await completedJobsPromise);
      const hydratedPackages = packageRows.map((item) => ({
        ...item,
        pricing_mode: isPricingMode(item.pricing_mode) ? item.pricing_mode : "custom_quote",
        default_frequency: isFrequency(item.default_frequency) ? item.default_frequency : "one-time",
        deposit_amount: item.deposit_amount === null ? null : Number(item.deposit_amount),
        tiers: ((tiersResult.data ?? []) as PackageTier[])
          .filter((tier) => tier.package_id === item.id)
          .map((tier) => ({ ...tier, price: Number(tier.price) })),
        promotions: promotions.filter((promotion) => promotion.package_id === item.id),
      }));
      setPackages(hydratedPackages.filter((item) => item.pricing_mode === "fixed"
        ? isPubliclyEligibleFixedPackage(item)
        : isPubliclyEligibleQuotePackage(item),
      ));
      setMode("ready");
    } catch (reason) {
      console.error("Unable to load public provider storefront", reason);
      setCompletedJobCount(null);
      setError(reason instanceof Error ? reason.message : "The live provider profile could not be loaded.");
      setMode("error");
    }
  }, [contractorId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(true); }, 0);
    const clockRefresh = window.setInterval(() => { void load(false); }, 60_000);
    return () => { window.clearTimeout(timer); window.clearInterval(clockRefresh); };
  }, [load]);

  useEffect(() => {
    if (!contractorId || mode !== "ready") return;
    const supabase = createClient();
    const refresh = () => { void load(false); };
    const channel = supabase
      .channel(`public-provider-${contractorId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contractors", filter: `id=eq.${contractorId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "vendor_packages", filter: `contractor_id=eq.${contractorId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "package_promotions" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "contractor_gallery", filter: `contractor_id=eq.${contractorId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "reviews", filter: `contractor_id=eq.${contractorId}` }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [contractorId, load, mode]);

  const fixedPackages = useMemo(
    () => packages.filter((item) => item.pricing_mode === "fixed" && item.tiers.length > 0),
    [packages],
  );
  const quotePackages = useMemo(
    () => packages.filter((item) => item.pricing_mode !== "fixed" || item.tiers.length === 0),
    [packages],
  );

  function startRequest(selectedPackage?: VendorPackage) {
    if (!contractor) return;
    const serviceId = selectedPackage?.service_id ?? contractor.services?.[0];
    const serviceName = serviceId ? displayService(serviceId, serviceNames) : contractor.verified_specialty ?? "Home service";
    const tierPrice = selectedPackage?.pricing_mode === "fixed" ? lowestEffectiveTier(selectedPackage, serverNow) : null;
    const tier = tierPrice?.tier ?? null;
    const frequency = selectedPackage?.default_frequency ?? "one-time";

    if (serviceId) {
      const prices = tierPrice ? { [frequency]: tierPrice.price.effectivePrice } : undefined;
      window.sessionStorage.setItem("homePlanSelection", JSON.stringify({
        selectedServiceIds: [serviceId],
        frequencies: { [serviceId]: frequency },
        requestedServices: [{
          id: serviceId,
          name: serviceName,
          availability: tier ? "fixed" : "quote",
          descriptor: selectedPackage?.description ?? `Requested from ${contractor.name}`,
          defaultFrequency: frequency,
          frequencies: [frequency],
          prices,
          basePrices: tierPrice?.price.isPromotionEffective ? { [frequency]: tierPrice.price.basePrice } : undefined,
          promotionLabels: tierPrice?.price.promotionLabel ? { [frequency]: tierPrice.price.promotionLabel } : undefined,
          promotionIds: tierPrice?.price.promotionId ? { [frequency]: tierPrice.price.promotionId } : undefined,
          packageId: selectedPackage?.id,
          tierId: tier?.id,
          pricingMode: selectedPackage?.pricing_mode,
        }],
      }));
    }

    window.sessionStorage.setItem("preferredProviderSelection", JSON.stringify({
      contractorId: contractor.id,
      contractorName: contractor.name,
      serviceId: serviceId ?? null,
    }));

    const query = new URLSearchParams({
      provider: contractor.id,
      providerName: contractor.name,
      requested: serviceName,
    });
    if (serviceId) query.set("service", serviceId);
    router.push(`/request?${query.toString()}`);
  }

  if (mode === "loading") return <StorefrontLoading />;
  if (mode === "missing") return <StorefrontMissing />;
  if (mode === "error") return <StorefrontError message={error} retry={() => void load(true)} />;
  if (!contractor) return null;

  const averageRating = reviews.length
    ? reviews.reduce((total, review) => total + Number(review.rating), 0) / reviews.length
    : null;
  const primaryPackage = fixedPackages[0];
  const isPublished = Boolean(contractor.is_active);
  const heroCta = fixedPackages.length ? "Book This Provider" : "Request This Provider";
  const hasQuickStats = averageRating !== null
    || completedJobCount !== null
    || contractor.years_experience !== null
    || Boolean(contractor.verified_specialty);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <section className="bg-hero border-b border-border/50 py-10 md:py-14">
          <div className="container-narrow">
            <Link href="/providers" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mb-6 -ml-2 text-muted-foreground")}>
              <ArrowLeft />Back to Providers
            </Link>
            <div className="flex flex-col items-start gap-6 sm:flex-row">
              <ProviderLogo contractor={contractor} />
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{contractor.name}</h1>
                  {!isPublished && <Badge variant="outline">Not publicly listed</Badge>}
                </div>
                {contractor.tagline && <p className="mb-3 max-w-2xl text-base text-foreground/75">{contractor.tagline}</p>}
                <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                  {contractor.location && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{contractor.location}</span>}
                  <span className="flex items-center gap-1.5"><Star className={cn("h-4 w-4", averageRating === null ? "text-muted-foreground/60" : "fill-amber-400 text-amber-400")} />{averageRating === null ? "No public reviews yet" : `${Number(averageRating).toFixed(1)} (${reviews.length} public review${reviews.length === 1 ? "" : "s"})`}</span>
                  {completedJobCount !== null && completedJobCount > 0 && <span className="flex items-center gap-1.5"><Briefcase className="h-4 w-4" />{completedJobCount} completed through Mercurius</span>}
                </div>
              </div>
              <div className="w-full shrink-0 sm:w-auto">
                <Button size="lg" disabled={!isPublished} className="min-h-11 w-full bg-accent px-5 text-accent-foreground hover:bg-accent/90" onClick={() => startRequest(primaryPackage)}>
                  {heroCta}<ArrowRight />
                </Button>
                <p className="mt-2 max-w-64 text-xs leading-relaxed text-muted-foreground sm:text-right">
                  {fixedPackages.length ? "Confirm your home and scheduling details next." : "Mercurius will coordinate scope and pricing before booking is confirmed."}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section-sm bg-background">
          <div className="container-narrow">
            <div className="mb-8 flex items-start gap-3 rounded-2xl border border-sage/25 bg-sage-light/70 p-4 text-sage-dark">
              <Shield className="mt-0.5 h-5 w-5 shrink-0" />
              <div><p className="font-semibold">Managed by Mercurius</p><p className="mt-0.5 text-sm">This provider is monitored and performance-tracked as part of the Mercurius network.</p></div>
            </div>

            <div className="grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
              <div className="space-y-8">
                {contractor.bio && <SectionCard title="About"><p className="whitespace-pre-line leading-7 text-muted-foreground">{contractor.bio}</p></SectionCard>}

                <SectionCard title="Services Offered">
                  {(contractor.services?.length ?? 0) > 0 ? <div className="flex flex-wrap gap-2">{contractor.services?.map((service) => <Badge key={service} variant="secondary" className="h-7 px-3">{displayService(service, serviceNames)}</Badge>)}</div> : <p className="text-sm text-muted-foreground">This provider has not published a service list yet.</p>}
                </SectionCard>

                {contractor.special_offer && <Card className="border-accent/25 bg-accent/5"><CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Award className="text-accent" />Current Offer</CardTitle></CardHeader><CardContent><p className="leading-7 text-muted-foreground">{contractor.special_offer}</p></CardContent></Card>}

                {fixedPackages.length > 0 && <SectionCard title="Fixed-Price Services">
                  <div className="grid gap-3">
                    {fixedPackages.map((item) => {
                      const tierPrice = lowestEffectiveTier(item, serverNow);
                      if (!tierPrice) return null;
                      const { tier, price } = tierPrice;
                      return <button key={item.id} type="button" onClick={() => startRequest(item)} className="rounded-xl border border-border bg-background p-4 text-left transition-colors hover:border-accent/50 hover:bg-accent/5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0"><p className="font-semibold">{item.name}</p><p className="mt-1 text-sm text-muted-foreground">{displayService(item.service_id, serviceNames)} · {frequencyLabel(item.default_frequency)}</p>{item.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>}{tier.includes && tier.includes.length > 0 && <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">{tier.includes.slice(0, 4).map((included) => <span key={included} className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3 w-3 text-accent" />{included}</span>)}</div>}</div>
                          <div className="shrink-0 text-right">{price.isPromotionEffective && <p className="text-xs text-muted-foreground line-through">{money(price.basePrice)}</p>}<p className="text-xl font-bold tabular-nums">{money(price.effectivePrice)}<span className="text-sm font-normal text-muted-foreground">{frequencySuffix(item.default_frequency)}</span></p>{price.isPromotionEffective && <p className="text-[10px] font-medium text-coral">{price.promotionLabel || "Limited-time price"}</p>}<p className="mt-1 text-xs font-medium text-accent">Continue to request</p></div>
                        </div>
                      </button>;
                    })}
                  </div>
                </SectionCard>}

                {quotePackages.length > 0 && <SectionCard title="Services Requiring a Quote">
                  <div className="grid gap-3">{quotePackages.map((item) => <div key={item.id} className="flex flex-col gap-4 rounded-xl border border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{item.name}</p><Badge variant="outline" className="border-info/30 bg-info/5 text-info">{item.pricing_mode === "deposit_quote" ? "Quote + deposit" : "Custom quote"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{item.description || `${displayService(item.service_id, serviceNames)} requires scope confirmation.`}</p>{item.pricing_mode === "deposit_quote" && item.deposit_amount && <p className="mt-2 text-xs text-muted-foreground">A {money(item.deposit_amount)} deposit may apply after scope, final pricing, and booking details are confirmed. Nothing is charged with the initial request.</p>}</div><Button variant="outline" className="shrink-0" onClick={() => startRequest(item)}>Request &amp; Match<ArrowRight /></Button></div>)}</div>
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Mercurius will coordinate the details with you and the provider before the work is confirmed. No unpublished price is presented as bookable.</p>
                </SectionCard>}

                {packages.length === 0 && <SectionCard title="Request a Service"><p className="text-sm leading-relaxed text-muted-foreground">This provider has not published a live fixed price yet. Submit your service details and Mercurius will confirm provider availability, scope, and pricing before booking.</p><Button className="mt-4 bg-accent text-accent-foreground hover:bg-accent/90" disabled={!isPublished} onClick={() => startRequest()}>Request This Provider<ArrowRight /></Button></SectionCard>}

                {(contractor.badges?.length ?? 0) > 0 && <SectionCard title="Credentials"><div className="flex flex-wrap gap-3">{contractor.badges?.map((badge) => <div key={badge} className="flex items-center gap-2 rounded-lg bg-sage-light px-3 py-2 text-sm font-medium text-sage-dark"><BadgeCheck className="h-4 w-4" />{badge}</div>)}</div></SectionCard>}

                {contractor.our_promise && <SectionCard title="Our Promise"><div className="flex items-start gap-3"><Shield className="mt-1 h-5 w-5 shrink-0 text-accent" /><p className="leading-7 text-muted-foreground">{contractor.our_promise}</p></div></SectionCard>}

                {contractor.video_url && <SectionCard title="Video"><ProviderVideo url={contractor.video_url} /></SectionCard>}

                {gallery.length > 0 && <SectionCard title="Gallery"><div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{gallery.map((item) => <figure key={item.id} className="overflow-hidden rounded-xl border border-border bg-muted"><div className="aspect-square overflow-hidden"><img src={item.image_url} alt={item.caption || `${contractor.name} project`} loading="lazy" className="h-full w-full object-cover transition-transform duration-300 hover:scale-105" /></div>{item.caption && <figcaption className="px-3 py-2 text-xs text-muted-foreground">{item.caption}</figcaption>}</figure>)}</div></SectionCard>}

                <SectionCard title={`Reviews (${reviews.length})`}>
                  {reviews.length === 0 ? <div className="py-4 text-center"><Star className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-2 text-sm text-muted-foreground">No shareable customer reviews yet.</p></div> : <div className="space-y-6">{reviews.map((review, index) => <article key={review.id} className={cn("pb-6", index < reviews.length - 1 && "border-b border-border")}><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-3"><PublicReviewAuthor /><div className="flex gap-0.5" aria-label={`${review.rating} out of 5 stars`}>{Array.from({ length: 5 }, (_, star) => <Star key={star} className={cn("h-3.5 w-3.5", star < review.rating ? "fill-amber-400 text-amber-400" : "text-muted")} />)}</div></div><time className="text-xs text-muted-foreground" dateTime={review.created_at}>{formatDate(review.created_at)}</time></div>{review.comment && <p className="text-sm leading-relaxed text-muted-foreground">{review.comment}</p>}</article>)}</div>}
                </SectionCard>
              </div>

              <aside className="space-y-6 md:sticky md:top-24 md:self-start">
                <Card className="border-accent/20 shadow-sm"><CardHeader><CardTitle className="text-lg">Pricing Overview</CardTitle></CardHeader><CardContent>
                  {fixedPackages.length > 0 ? <StorefrontPriceOverview item={fixedPackages[0]} serverNow={serverNow} /> : <p className="mb-5 text-sm leading-relaxed text-muted-foreground">Pricing depends on the scope. Mercurius will confirm availability and price before work begins.</p>}
                  <Button className="min-h-11 w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled={!isPublished} onClick={() => startRequest(primaryPackage)}>{fixedPackages.length ? "Continue to Request" : "Request a Quote"}<ArrowRight /></Button>
                </CardContent></Card>

                <Card><CardHeader><CardTitle className="text-lg">Service Area</CardTitle></CardHeader><CardContent><div className="flex min-h-40 items-center justify-center rounded-xl bg-muted/60"><div className="px-5 text-center text-muted-foreground"><MapPin className="mx-auto mb-2 h-8 w-8" /><p className="text-sm font-medium text-foreground">Southwest Florida</p><p className="mt-1 text-xs">Coverage is confirmed for your service address.</p></div></div>{contractor.location && <p className="mt-3 text-center text-sm text-muted-foreground">Based in {contractor.location}</p>}</CardContent></Card>

                {hasQuickStats && <Card><CardHeader><CardTitle className="text-lg">Quick Stats</CardTitle></CardHeader><CardContent className="space-y-3">{averageRating !== null && <QuickStat label="Public review rating" value={Number(averageRating).toFixed(1)} />}{completedJobCount !== null && <QuickStat label="Completed through Mercurius" value={String(completedJobCount)} />}{contractor.years_experience !== null && <QuickStat label="Experience" value={`${contractor.years_experience} years`} />}{contractor.verified_specialty && <div className="border-t pt-3"><p className="text-xs text-muted-foreground">Verified Specialty</p><p className="mt-1 text-sm font-semibold">{contractor.verified_specialty}</p></div>}</CardContent></Card>}
              </aside>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ProviderLogo({ contractor }: { contractor: Contractor }) {
  return contractor.logo_url ? <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-card p-2 shadow-sm"><img src={contractor.logo_url} alt={`${contractor.name} logo`} className="h-full w-full object-contain" /></div> : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-accent text-2xl font-bold text-accent-foreground shadow-sm">{contractor.name.charAt(0).toUpperCase()}</div>;
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card><CardHeader><CardTitle className="text-lg">{title}</CardTitle></CardHeader><CardContent>{children}</CardContent></Card>;
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="font-semibold">{value}</span></div>;
}

function ProviderVideo({ url }: { url: string }) {
  const youtube = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]+)/);
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  const embed = youtube ? `https://www.youtube.com/embed/${youtube[1]}` : vimeo ? `https://player.vimeo.com/video/${vimeo[1]}` : null;
  return <div className="aspect-video overflow-hidden rounded-xl bg-muted">{embed ? <iframe src={embed} title="Provider video" className="h-full w-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" /> : <video src={url} controls className="h-full w-full object-cover" />}</div>;
}

function StorefrontLoading() {
  return <div className="min-h-screen bg-background"><Header /><main><section className="bg-hero py-14"><div className="container-narrow animate-pulse"><div className="h-7 w-36 rounded bg-muted" /><div className="mt-7 flex gap-5"><div className="h-20 w-20 rounded-2xl bg-muted" /><div className="flex-1 space-y-3"><div className="h-8 w-2/3 rounded bg-muted" /><div className="h-4 w-1/2 rounded bg-muted" /><div className="h-7 w-36 rounded-full bg-muted" /></div></div></div></section><section className="section-sm"><div className="container-narrow grid gap-8 md:grid-cols-3"><div className="space-y-5 md:col-span-2">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-48 animate-pulse rounded-xl bg-muted" />)}</div><div className="h-72 animate-pulse rounded-xl bg-muted" /></div></section></main><Footer /></div>;
}

function StorefrontMissing() {
  return <StorefrontState icon={MapPin} title="Provider not found" copy="This provider is not currently available in the public Mercurius network." action={<Link href="/providers" className={buttonVariants({ size: "lg" })}>Browse Live Providers<ArrowRight /></Link>} />;
}

function StorefrontError({ message, retry }: { message: string; retry: () => void }) {
  return <StorefrontState icon={AlertCircle} title="Provider profile unavailable" copy={`We could not confirm this provider's current public information. No substitute profile data has been shown. ${message}`} action={<Button size="lg" onClick={retry}><RefreshCw />Try Again</Button>} />;
}

function StorefrontState({ icon: Icon, title, copy, action }: { icon: typeof AlertCircle; title: string; copy: string; action: React.ReactNode }) {
  return <div className="min-h-screen bg-background"><Header /><main className="flex min-h-[65vh] items-center justify-center bg-hero px-4 py-16"><Card className="w-full max-w-xl border-border/70 shadow-lg"><CardContent className="py-12 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10"><Icon className="h-7 w-7 text-accent" /></div><h1 className="mt-5 font-heading text-2xl font-semibold">{title}</h1><p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{copy}</p><div className="mt-6">{action}</div></CardContent></Card></main><Footer /></div>;
}

function isPricingMode(value: string): value is PricingMode {
  return value === "fixed" || value === "deposit_quote" || value === "custom_quote";
}

function isFrequency(value: string): value is Frequency {
  return isPricingFrequency(value);
}

function lowestEffectiveTier(item: VendorPackage, serverNow: string | null) {
  const promotion = promotionForPackage(item.promotions, item.id);
  return item.tiers
    .map((tier) => ({ tier, price: resolveEffectiveTierPrice(tier.price, promotion, serverNow, item.tiers.length) }))
    .sort((left, right) => left.price.effectivePrice - right.price.effectivePrice)[0] ?? null;
}

function StorefrontPriceOverview({ item, serverNow }: { item: VendorPackage; serverNow: string | null }) {
  const tierPrice = lowestEffectiveTier(item, serverNow);
  if (!tierPrice) return null;
  return <div className="mb-5"><p className="text-sm text-muted-foreground">Published provider-backed pricing</p>{tierPrice.price.isPromotionEffective && <p className="mt-2 text-sm text-muted-foreground line-through">From {money(tierPrice.price.basePrice)}</p>}<p className={cn("text-2xl font-bold tabular-nums", !tierPrice.price.isPromotionEffective && "mt-2")}>From {money(tierPrice.price.effectivePrice)}<span className="text-sm font-normal text-muted-foreground">{frequencySuffix(item.default_frequency)}</span></p>{tierPrice.price.isPromotionEffective && <p className="mt-1 text-xs font-medium text-coral">{tierPrice.price.promotionLabel || "Limited-time price"}</p>}</div>;
}

function displayService(id: string, names: Record<string, string>) {
  return names[id] ?? serviceFallbacks[id] ?? id.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function frequencyLabel(value: Frequency) {
  return value === "one-time" ? "One-Time" : value.charAt(0).toUpperCase() + value.slice(1);
}

function frequencySuffix(value: Frequency) {
  if (value === "weekly") return "/wk";
  if (value === "bi-monthly") return "/2 wks";
  if (value === "monthly") return "/mo";
  if (value === "quarterly") return "/qtr";
  return "";
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number(value) % 1 === 0 ? 0 : 2 }).format(Number(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
