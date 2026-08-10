"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  DollarSign,
  ExternalLink,
  Eye,
  Gauge,
  Loader2,
  PackageCheck,
  RefreshCw,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COMPLETED_JOB_STATUSES, completionRateFromStatuses } from "@/lib/completedJobs";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { calculateVendorProfileStrength } from "@/lib/vendorProfileStrength";
import { isPubliclyEligibleFixedPackage, isPubliclyEligibleQuotePackage } from "@/lib/vendorPricing";

type Contractor = {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean | null;
  marketing_enabled: boolean | null;
  bio: string | null;
  location: string | null;
  services: string[] | null;
  special_offer: string | null;
  our_promise: string | null;
  years_experience: number | null;
  verified_specialty: string | null;
};

type ServiceRequest = {
  id: string;
  status: string;
  created_at: string;
};

type VendorPackage = {
  id: string;
  service_id: string;
  is_active: boolean;
  pricing_mode: string;
  needs_review: boolean | null;
  deposit_amount: number | null;
  tiers: Array<{ price: number }>;
};

type CatalogService = {
  id: string;
  name: string;
};

type PricingGap = {
  key: string;
  label: string;
};

type ContactDetails = {
  email: string | null;
  phone: string | null;
};

type Mode = "loading" | "live" | "unlinked" | "error";

type OverviewData = {
  openRequests: number;
  activeJobs: number;
  completedJobs: number;
  actionableJobs: number;
  completionRate: number | null;
  profileComplete: boolean;
  profileStrength: number;
  livePackageCount: number;
  hasLivePrice: boolean;
  isActive: boolean;
  isPublic: boolean;
  readyForJobs: boolean;
  requestsLast30Days: number;
  totalRequests: number;
  profileServiceCount: number;
  pricedServiceCount: number;
  servicesNeedingPricing: PricingGap[];
};

const incomingStatuses = new Set(["matched", "pending"]);
const completedStatuses = new Set<string>(COMPLETED_JOB_STATUSES);
const inactiveStatuses = new Set([...completedStatuses, "resolved", "cancelled"]);

export default function VendorOverviewPage() {
  const { user } = useAuth();
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [packages, setPackages] = useState<VendorPackage[]>([]);
  const [catalogServices, setCatalogServices] = useState<CatalogService[]>([]);
  const [contact, setContact] = useState<ContactDetails | null>(null);
  const [galleryCount, setGalleryCount] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  const [mode, setMode] = useState<Mode>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  const loadOverview = useCallback(async () => {
    if (!user) return;
    setMode("loading");
    setErrorMessage("");

    try {
      const supabase = createClient();
      const contractorResult = await supabase
        .from("contractors")
        .select("id, name, logo_url, is_active, marketing_enabled, bio, location, services, special_offer, our_promise, years_experience, verified_specialty")
        .eq("user_id", user.id)
        .maybeSingle();

      if (contractorResult.error) throw contractorResult.error;
      if (!contractorResult.data) {
        setContractor(null);
        setMode("unlinked");
        return;
      }

      const contractorData = contractorResult.data as Contractor;
      const [requestsResult, packagesResult, catalogResult, contactResult, galleryResult] = await Promise.all([
        supabase
          .from("service_requests")
          .select("id, status, created_at")
          .eq("contractor_id", contractorData.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("vendor_packages")
          .select("id, service_id, is_active, pricing_mode, needs_review, deposit_amount")
          .eq("contractor_id", contractorData.id),
        supabase
          .from("services_catalog")
          .select("id, name")
          .eq("is_active", true)
          .order("name"),
        supabase.rpc("get_contractor_contact", { _contractor_id: contractorData.id }),
        supabase
          .from("contractor_gallery")
          .select("id", { count: "exact", head: true })
          .eq("contractor_id", contractorData.id),
      ]);

      if (requestsResult.error) throw requestsResult.error;
      if (packagesResult.error) throw packagesResult.error;
      if (catalogResult.error) throw catalogResult.error;

      if (contactResult.error) throw contactResult.error;
      if (galleryResult.error) throw galleryResult.error;
      const packageRows = (packagesResult.data ?? []) as Omit<VendorPackage, "tiers">[];
      const packageIds = packageRows.map((item) => item.id);
      const tiersResult = packageIds.length
        ? await supabase
            .from("package_tiers")
            .select("package_id, price")
            .in("package_id", packageIds)
        : { data: [] as Array<{ package_id: string; price: number }>, error: null };
      if (tiersResult.error) throw tiersResult.error;
      const tiers = (tiersResult.data ?? []) as Array<{ package_id: string; price: number }>;
      const value = contactResult.data as unknown;
      setContact((Array.isArray(value) ? value[0] : value) as ContactDetails | null);
      setGalleryCount(galleryResult.count ?? 0);

      setContractor(contractorData);
      setRequests((requestsResult.data ?? []) as ServiceRequest[]);
      setPackages(packageRows.map((item) => ({
        ...item,
        deposit_amount: item.deposit_amount === null ? null : Number(item.deposit_amount),
        tiers: tiers
          .filter((tier) => tier.package_id === item.id)
          .map((tier) => ({ price: Number(tier.price) })),
      })));
      setCatalogServices((catalogResult.data ?? []) as CatalogService[]);
      setLoadedAt(Date.now());
      setMode("live");
    } catch (error) {
      console.error("Unable to load vendor overview", error);
      setContractor(null);
      setRequests([]);
      setPackages([]);
      setCatalogServices([]);
      setErrorMessage(error instanceof Error ? error.message : "Your live vendor data could not be loaded.");
      setMode("error");
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    // Refresh all scorecard inputs when the authenticated vendor changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadOverview();
  }, [loadOverview, user]);

  const overview = useMemo<OverviewData | null>(() => {
    if (!contractor) return null;

    const openRequests = requests.filter((request) => incomingStatuses.has(request.status)).length;
    const activeJobs = requests.filter((request) => !incomingStatuses.has(request.status) && !inactiveStatuses.has(request.status)).length;
    const completion = completionRateFromStatuses(requests.map((request) => request.status));
    const serviceCoverage = profileServicePricingCoverage(contractor.services ?? [], catalogServices, packages);
    const strength = calculateVendorProfileStrength({
      ...contractor,
      email: contact?.email ?? null,
      phone: contact?.phone ?? null,
    }, galleryCount ?? 0);
    const profileComplete = strength.essentials === 40;
    const livePackageCount = packages.filter(isPubliclyEligibleFixedPackage).length;
    const hasLivePrice = livePackageCount > 0;
    const isActive = contractor.is_active !== false;
    const isPublic = isActive && contractor.marketing_enabled !== false;
    const readyForJobs = isActive && profileComplete && hasLivePrice;
    const profileStrength = strength.score;
    const thirtyDaysAgo = loadedAt - 30 * 24 * 60 * 60 * 1000;
    const requestsLast30Days = requests.filter((request) => Date.parse(request.created_at) >= thirtyDaysAgo).length;

    return {
      openRequests,
      activeJobs,
      completedJobs: completion.completedJobs,
      actionableJobs: completion.actionableJobs,
      completionRate: completion.completionRate,
      profileComplete,
      profileStrength,
      livePackageCount,
      hasLivePrice,
      isActive,
      isPublic,
      readyForJobs,
      requestsLast30Days,
      totalRequests: requests.length,
      profileServiceCount: serviceCoverage.length,
      pricedServiceCount: serviceCoverage.filter((service) => service.isCovered).length,
      servicesNeedingPricing: serviceCoverage
        .filter((service) => !service.isCovered)
        .map(({ key, label }) => ({ key, label })),
    };
  }, [catalogServices, contact, contractor, galleryCount, loadedAt, packages, requests]);

  if (mode === "loading") return <PageLoading />;
  if (mode === "unlinked") return <UnlinkedState />;
  if (mode === "error") return <ErrorState message={errorMessage} retry={() => void loadOverview()} />;
  if (!contractor || !overview) return null;

  const checklist = [
    {
      id: "profile",
      done: overview.profileComplete,
      title: "Complete your profile",
      description: overview.profileComplete
        ? `Your essential profile fields are complete. Profile strength is ${overview.profileStrength}%.`
        : "Add your business name, service area, services, email, and phone.",
      href: "/vendor/profile",
      cta: overview.profileComplete ? "Review profile" : "Complete profile",
      icon: UserRound,
    },
    {
      id: "pricing",
      done: overview.hasLivePrice,
      title: "Add at least one live price",
      description: overview.hasLivePrice
        ? `${overview.livePackageCount} fixed-price ${overview.livePackageCount === 1 ? "package is" : "packages are"} currently live.`
        : "Publish a fixed-price package so eligible homeowners can move directly toward booking.",
      href: "/vendor/packages",
      cta: overview.hasLivePrice ? "Manage pricing" : "Add a live price",
      icon: PackageCheck,
    },
    {
      id: "ready",
      done: overview.readyForJobs,
      title: "Be ready for jobs",
      description: !overview.isActive
        ? "Your contractor account is not active. Mercurius onboarding can confirm what remains."
        : overview.readyForJobs
          ? "Your active account, essential profile, and live pricing are ready for matched work."
          : "Finish the profile and pricing steps above so your active account is ready for matched work.",
      href: overview.isActive ? "/vendor/jobs" : "/contact",
      cta: overview.isActive ? "Open jobs queue" : "Contact onboarding",
      icon: BriefcaseBusiness,
    },
  ];

  const completedSteps = checklist.filter((item) => item.done).length;
  const readiness = Math.round((completedSteps / checklist.length) * 100);

  const recommendations = buildRecommendations(contractor, overview);

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 md:p-8">
      <header className="mb-7 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Vendor overview</p>
          <h1 className="break-words font-heading text-2xl font-semibold tracking-tight sm:text-3xl">{contractor.name}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {overview.readyForJobs
              ? "Your launch essentials are in place. Stay responsive and keep your profile and pricing current."
              : "Finish the essentials below so Mercurius can confidently match homeowners with your business."}
          </p>
        </div>
        {overview.isPublic && (
          <Link href={`/providers/${contractor.id}`} className={cn(buttonVariants({ variant: "outline" }), "min-h-11 w-full shrink-0 sm:w-auto")}>
            <ExternalLink />View storefront
          </Link>
        )}
      </header>

      <div className="mb-6 flex flex-col gap-3 rounded-xl border border-accent-border bg-accent-subtle px-4 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <DollarSign className="mt-0.5 h-5 w-5 shrink-0 text-sage-dark" />
          <div>
            <p className="font-medium text-foreground">Soft-launch vendor terms</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">No vendor subscriptions during soft launch. Mercurius charges 15% commission on completed jobs.</p>
          </div>
        </div>
        <Badge variant="outline" className="w-fit border-accent-border bg-background text-sage-dark">No subscriptions · 15% commission</Badge>
      </div>

      <Card className="mb-8 overflow-hidden border-accent-border bg-card shadow-sm">
        <CardHeader className="border-b border-accent-border bg-accent-subtle">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg"><Gauge className="h-5 w-5 text-accent" />Launch readiness</CardTitle>
              <CardDescription className="mt-1">Three practical steps to become ready for homeowner requests.</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">{completedSteps} of {checklist.length}</span>
              <span className="text-2xl font-semibold tabular-nums text-sage-dark">{readiness}%</span>
            </div>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-background ring-1 ring-accent-border" role="progressbar" aria-label="Launch readiness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readiness}>
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${readiness}%` }} />
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-border p-0">
          {checklist.map((item, index) => (
            <div key={item.id} className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", item.done ? "border-accent-border bg-accent-soft text-sage-dark" : "border-border bg-muted text-muted-foreground")}>
                {item.done ? <CheckCircle2 className="h-5 w-5" /> : <item.icon className="h-5 w-5" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">{index + 1}. {item.title}</p>
                  <Badge variant={item.done ? "secondary" : "outline"} className={cn("text-[10px]", item.done && "border-accent-border bg-accent-soft text-sage-dark")}>{item.done ? "Complete" : "Next action"}</Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
              </div>
              <Link href={item.href} className={cn(buttonVariants({ variant: item.done ? "outline" : "default" }), "min-h-11 w-full shrink-0 sm:w-auto", !item.done && "bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active")}>
                {item.cta}<ArrowRight />
              </Link>
            </div>
          ))}
        </CardContent>
      </Card>

      <SectionHeading title="Operational scorecard" description="Live records from your Mercurius vendor account and assigned work." />
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <MetricCard icon={Clock3} label="Awaiting response" value={String(overview.openRequests)} note={overview.openRequests ? "Open Jobs & Requests" : "No open requests"} href="/vendor/jobs" emphasize={overview.openRequests > 0} />
        <MetricCard icon={Activity} label="Active jobs" value={String(overview.activeJobs)} note="Scheduled or in progress" href="/vendor/jobs" />
        <MetricCard icon={CheckCircle2} label="Completed jobs" value={String(overview.completedJobs)} note="Completed through Mercurius" />
        <MetricCard icon={Gauge} label="Completion rate" value={overview.completionRate === null ? "—" : `${overview.completionRate}%`} note={overview.completionRate === null ? "No actionable job history yet" : `${overview.completedJobs} of ${overview.actionableJobs} actionable ${overview.actionableJobs === 1 ? "request" : "requests"} completed`} />
        <MetricCard icon={Sparkles} label="Profile strength" value={`${overview.profileStrength}%`} note="Based on saved profile fields" href="/vendor/profile" emphasize={overview.profileStrength < 80} />
      </div>

      <Card className="mb-8 overflow-hidden">
        <CardHeader className="border-b bg-muted/20">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><DollarSign className="h-4 w-4 text-accent" />Services that still need pricing</CardTitle>
              <CardDescription className="mt-1">A service is covered when it has an active, review-cleared fixed price or valid public quote option.</CardDescription>
            </div>
            {overview.profileServiceCount > 0 && <Badge variant="outline" className="w-fit bg-background">{overview.pricedServiceCount} of {overview.profileServiceCount} covered</Badge>}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {overview.profileServiceCount === 0 ? (
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><PackageCheck className="h-5 w-5" /></span><div><p className="text-sm font-medium">Add services to your profile first</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Once your services are listed, Mercurius can show which ones still need a public pricing or quote path.</p></div></div>
              <Link href="/vendor/profile" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 w-full shrink-0 sm:w-auto")}>Edit profile<ArrowRight /></Link>
            </div>
          ) : overview.servicesNeedingPricing.length === 0 ? (
            <div className="flex items-start gap-3 bg-accent-subtle p-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent-border bg-accent-soft text-sage-dark"><CheckCircle2 className="h-5 w-5" /></span><div><p className="text-sm font-medium">Every listed service is covered</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Each profile service currently has an eligible live fixed price or public quote option. Keep rates and availability current as your services change.</p></div><Link href="/vendor/packages" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-auto hidden shrink-0 sm:inline-flex")}>Review pricing</Link></div>
          ) : (
            <div className="divide-y">
              {overview.servicesNeedingPricing.map((service) => (
                <Link key={service.key} href="/vendor/packages" className="group flex flex-col gap-3 p-4 transition-colors hover:bg-surface-hover sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <span className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground"><DollarSign className="h-4 w-4" /></span><span><span className="block text-sm font-medium text-foreground">{service.label}</span><span className="mt-0.5 block text-xs text-muted-foreground">No active public-eligible package covers this service yet.</span></span></span>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-accent">Set or review pricing<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mb-8 grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Workload right now</CardTitle>
            <CardDescription>Live assignment counts, without forecast or sample activity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            <ScoreRow label="Requests assigned in the last 30 days" value={overview.requestsLast30Days} />
            <ScoreRow label="All assigned request records" value={overview.totalRequests} />
            <ScoreRow label="Live fixed-price packages" value={overview.livePackageCount} />
            <ScoreRow label="Public storefront" value={overview.isPublic ? "Visible" : "Not visible"} />
            <ScoreRow label="Vendor account" value={overview.isActive ? "Active" : "Inactive"} last />
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Next best actions</CardTitle>
            <CardDescription>Recommendations tied directly to your current profile, pricing, and job queue.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recommendations.map((recommendation, index) => (
              <Link key={recommendation.title} href={recommendation.href} className={cn("group flex items-start gap-3 rounded-xl border p-3.5 transition-colors hover:bg-surface-hover", index === 0 ? "border-accent-border bg-accent-subtle" : "border-border bg-background")}>
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", index === 0 ? "bg-accent-soft text-sage-dark" : "bg-muted text-muted-foreground")}><recommendation.icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-foreground">{recommendation.title}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{recommendation.description}</span></span>
                <ArrowRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-dashed border-border bg-muted/30 p-5 sm:flex-row sm:items-center">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border bg-card text-muted-foreground"><BarChart3 className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium text-foreground">Growth analytics are coming soon</p><Badge variant="outline" className="gap-1 text-[10px]"><Eye className="h-3 w-3" />Deferred</Badge></div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Profile views, search impressions, click-through rate, and acceptance rate are hidden until Mercurius has reliable event and response-history tracking.</p>
        </div>
      </div>
    </div>
  );
}

function profileServicePricingCoverage(
  profileServices: string[],
  catalogServices: CatalogService[],
  packages: VendorPackage[],
) {
  const normalize = (value: string) => value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const displayService = (value: string) => value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const catalogById = new Map(catalogServices.map((service) => [service.id, service]));
  const uniqueServices = [...new Map(
    profileServices
      .filter(Boolean)
      .map((raw) => [normalize(raw), raw] as const),
  ).values()];

  return uniqueServices.map((raw) => {
    const normalized = normalize(raw);
    const catalogService = catalogServices.find((service) =>
      normalize(service.id) === normalized || normalize(service.name) === normalized,
    );
    const matchingKeys = new Set([
      normalized,
      catalogService ? normalize(catalogService.id) : "",
      catalogService ? normalize(catalogService.name) : "",
    ].filter(Boolean));
    const matchingPackages = packages.filter((item) => {
      const packageService = catalogById.get(item.service_id);
      return matchingKeys.has(normalize(item.service_id))
        || Boolean(packageService && matchingKeys.has(normalize(packageService.name)));
    });
    const isCovered = matchingPackages.some((item) => item.pricing_mode === "fixed"
      ? isPubliclyEligibleFixedPackage(item)
      : isPubliclyEligibleQuotePackage(item));

    return {
      key: normalized,
      label: catalogService?.name ?? displayService(raw),
      isCovered,
    };
  });
}

function buildRecommendations(contractor: Contractor, overview: OverviewData) {
  const actions: Array<{ title: string; description: string; href: string; icon: typeof Sparkles }> = [];

  if (!overview.profileComplete || overview.profileStrength < 80) {
    actions.push({
      title: overview.profileComplete ? `Raise profile strength above ${overview.profileStrength}%` : "Complete your essential profile",
      description: overview.profileComplete
        ? "Add useful business details and project proof so homeowners can evaluate your business confidently."
        : "Business name, location, bio, and services are the foundation of your public storefront.",
      href: "/vendor/profile",
      icon: UserRound,
    });
  }

  if (!overview.hasLivePrice) {
    actions.push({
      title: "Publish your first fixed price",
      description: "A live provider-backed price gives eligible homeowners a shorter, clearer path to booking.",
      href: "/vendor/packages",
      icon: PackageCheck,
    });
  } else {
    actions.push({
      title: "Keep pricing complete and current",
      description: `${overview.livePackageCount} live ${overview.livePackageCount === 1 ? "package is" : "packages are"} published across ${contractor.services?.length ?? 0} listed ${contractor.services?.length === 1 ? "service" : "services"}. Review gaps and outdated rates.`,
      href: "/vendor/packages",
      icon: DollarSign,
    });
  }

  if (overview.openRequests > 0) {
    actions.push({
      title: `Respond to ${overview.openRequests} open ${overview.openRequests === 1 ? "request" : "requests"}`,
      description: "Review scope and timing promptly so Mercurius can keep the homeowner informed.",
      href: "/vendor/jobs",
      icon: Clock3,
    });
  } else if (!overview.isActive) {
    actions.push({
      title: "Confirm your vendor activation",
      description: "Your contractor record is inactive. Contact Mercurius onboarding before expecting new matches.",
      href: "/contact",
      icon: AlertCircle,
    });
  } else {
    actions.push({
      title: "Stay ready for the next match",
      description: "There are no requests awaiting a response. New matched work will appear in Jobs & Requests.",
      href: "/vendor/jobs",
      icon: BriefcaseBusiness,
    });
  }

  return actions.slice(0, 3);
}

function MetricCard({ icon: Icon, label, value, note, href, emphasize = false }: { icon: ComponentType<{ className?: string }>; label: string; value: string; note: string; href?: string; emphasize?: boolean }) {
  const content = (
    <Card className={cn("h-full transition-colors", emphasize && "border-accent-border bg-accent-subtle", href && "group-hover:border-accent-border group-hover:bg-surface-hover")}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground"><span className="flex items-center gap-2"><Icon className="h-4 w-4 text-accent" />{label}</span>{href && <ArrowRight className="h-3.5 w-3.5 opacity-50" />}</div>
        <p className="mt-3 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">{content}</Link> : content;
}

function ScoreRow({ label, value, last = false }: { label: string; value: ReactNode; last?: boolean }) {
  return <div className={cn("flex items-center justify-between gap-4 border-b border-border py-3", last && "border-b-0 pb-0")}><span className="text-sm text-muted-foreground">{label}</span><span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{value}</span></div>;
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return <div className="mb-4"><h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>;
}

function PageLoading() {
  return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">Loading your live vendor overview...</span></div>;
}

function UnlinkedState() {
  return <PortalState icon={UserRound} title="No contractor profile linked" description="Your vendor account has access, but no contractor record is linked to it yet. Contact Mercurius onboarding so your approved business can be connected." />;
}

function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <PortalState icon={AlertCircle} title="We couldn’t load your overview" description={`No preview metrics have been substituted. ${message || "Please try again."}`}>
      <Button variant="outline" onClick={retry}><RefreshCw />Try again</Button>
    </PortalState>
  );
}

function PortalState({ icon: Icon, title, description, children }: { icon: ComponentType<{ className?: string }>; title: string; description: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-20 text-center">
      <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted"><Icon className="h-7 w-7 text-muted-foreground" /></span>
      <h1 className="font-heading text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">{children}<Link href="/contact" className={buttonVariants({ variant: "outline" })}>Contact Mercurius</Link></div>
    </div>
  );
}
