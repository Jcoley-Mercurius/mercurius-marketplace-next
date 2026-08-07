"use client";

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Circle,
  DollarSign,
  ExternalLink,
  Eye,
  Gauge,
  Loader2,
  Lock,
  MousePointerClick,
  Search,
  Sparkles,
  Star,
  TrendingUp,
  User,
  Users,
  Zap,
} from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Contractor = {
  id: string;
  name: string;
  rating: number | null;
  jobs_completed: number | null;
  is_active: boolean | null;
  marketing_enabled: boolean | null;
  bio: string | null;
  location: string | null;
  services: string[] | null;
  special_offer: string | null;
  our_promise: string | null;
};

type ServiceRequest = {
  id: string;
  status: string;
  created_at: string;
};

type Mode = "loading" | "live" | "unlinked" | "error";

const incomingStatuses = new Set(["matched", "pending", "quoted"]);
const completedStatuses = new Set(["completed", "closed", "reviewed"]);

export default function VendorOverviewPage() {
  const { user } = useAuth();
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [hasLivePrice, setHasLivePrice] = useState(false);
  const [mode, setMode] = useState<Mode>("loading");

  useEffect(() => {
    if (!user) return;
    let active = true;

    async function loadOverview() {
      setMode("loading");

      try {
        const supabase = createClient();
        const { data: contractorData, error: contractorError } = await supabase
          .from("contractors")
          .select("id, name, rating, jobs_completed, is_active, marketing_enabled, bio, location, services, special_offer, our_promise")
          .eq("user_id", user!.id)
          .maybeSingle();

        if (contractorError) throw contractorError;
        if (!active) return;
        if (!contractorData) {
          setMode("unlinked");
          return;
        }

        const [requestsResult, packagesResult] = await Promise.all([
          supabase
            .from("service_requests")
            .select("id, status, created_at")
            .eq("contractor_id", contractorData.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("vendor_packages")
            .select("id")
            .eq("contractor_id", contractorData.id)
            .eq("is_active", true)
            .eq("pricing_mode", "fixed")
            .limit(1),
        ]);

        if (requestsResult.error) throw requestsResult.error;
        if (packagesResult.error) throw packagesResult.error;
        if (!active) return;

        setContractor(contractorData as Contractor);
        setRequests((requestsResult.data ?? []) as ServiceRequest[]);
        setHasLivePrice((packagesResult.data?.length ?? 0) > 0);
        setMode("live");
      } catch (error) {
        console.error("Unable to load vendor overview", error);
        if (active) setMode("error");
      }
    }

    void loadOverview();
    return () => {
      active = false;
    };
  }, [user]);

  const overview = useMemo(() => {
    if (!contractor) return null;

    const pendingCount = requests.filter((request) => incomingStatuses.has(request.status)).length;
    const completedFromRequests = requests.filter((request) => completedStatuses.has(request.status)).length;
    const jobsCompleted = Math.max(contractor.jobs_completed ?? 0, completedFromRequests);
    const profileFields = [
      contractor.name.trim(),
      contractor.location?.trim(),
      contractor.bio?.trim(),
      (contractor.services?.length ?? 0) > 0,
    ];
    const profileComplete = profileFields.every(Boolean);
    const profileStrength = Math.round((profileFields.filter(Boolean).length / profileFields.length) * 100);
    const setupComplete = hasLivePrice && profileComplete;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentRequests = requests.filter((request) => new Date(request.created_at) >= thirtyDaysAgo).length;
    const isActive = contractor.is_active !== false;
    const isPublic = isActive && contractor.marketing_enabled !== false;

    return {
      pendingCount,
      jobsCompleted,
      profileComplete,
      profileStrength,
      setupComplete,
      recentRequests,
      isActive,
      isPublic,
    };
  }, [contractor, hasLivePrice, requests]);

  if (mode === "loading") return <PageLoading />;
  if (mode === "unlinked") return <UnlinkedState />;
  if (mode === "error") return <ErrorState />;
  if (!contractor || !overview) return null;

  const checklist = [
    {
      id: "price",
      done: hasLivePrice,
      title: "Add a bookable price",
      description: hasLivePrice
        ? "You have an active fixed-price package available to customers."
        : "Publish a fixed price so eligible services can move toward booking online.",
      href: hasLivePrice ? "/vendor/profile" : "/contact",
      cta: hasLivePrice ? "Review services" : "Contact pricing support",
      icon: DollarSign,
      primary: !hasLivePrice,
    },
    {
      id: "profile",
      done: overview.profileComplete,
      title: "Complete your profile",
      description: "Name, location, bio, and services for your public listing.",
      href: "/vendor/profile",
      cta: overview.profileComplete ? "Edit profile" : "Complete your profile",
      icon: User,
      primary: hasLivePrice && !overview.profileComplete,
    },
    {
      id: "listing",
      done: overview.setupComplete && overview.isPublic,
      title: "View public listing",
      description: overview.isPublic
        ? "See how your business appears in the provider directory."
        : "Public visibility is enabled by Mercurius after your listing is ready.",
      href: `/providers/${contractor.id}`,
      cta: "Open public storefront",
      icon: ExternalLink,
      primary: false,
    },
  ];

  const completedCount = checklist.filter((item) => item.done).length;
  const progressPct = Math.round((completedCount / checklist.length) * 100);

  const metrics = [
    {
      label: "New Requests",
      value: String(overview.pendingCount),
      icon: Users,
      note: overview.pendingCount > 0 ? "Awaiting your response" : "No open requests",
      href: "/vendor/jobs",
      highlight: overview.pendingCount > 0,
      accent: false,
    },
    {
      label: "Jobs Completed",
      value: String(overview.jobsCompleted),
      icon: CheckCircle2,
      note: overview.jobsCompleted > 0 ? "Completed through Mercurius" : "Your first completed job will appear here",
      href: null,
      highlight: false,
      accent: false,
    },
    {
      label: "Average Rating",
      value: contractor.rating ? contractor.rating.toFixed(1) : "New",
      icon: Star,
      note: contractor.rating ? "Based on recorded job feedback" : "No verified rating yet",
      href: null,
      highlight: false,
      accent: false,
    },
    {
      label: "Status",
      value: overview.isActive ? "Active" : "Inactive",
      icon: Gauge,
      note: overview.isPublic
        ? "Eligible for the public directory"
        : overview.isActive
          ? "Active; public visibility is not enabled"
          : "Your vendor profile is inactive",
      href: null,
      highlight: false,
      accent: overview.isPublic,
    },
  ];

  const funnel = [
    { label: "Profile Views (30d)", value: "—", icon: Eye, note: "Tracking not connected" },
    { label: "Search Impressions", value: "—", icon: Search, note: "Tracking not connected" },
    { label: "Click-to-Book Rate", value: "—", icon: MousePointerClick, note: "Awaiting listing analytics" },
    { label: "Requests Generated", value: String(overview.recentRequests), icon: Zap, note: "Assigned in the last 30 days" },
  ];

  const insights = [
    {
      title: hasLivePrice ? "Live pricing is active" : "Add live pricing",
      body: hasLivePrice
        ? "At least one fixed-price package is active, giving eligible homeowners a shorter path toward booking."
        : "No active fixed-price package was found. Mercurius can help prepare provider-backed pricing for eligible services.",
      tag: hasLivePrice ? "Ready" : "Action needed",
      icon: DollarSign,
      tone: hasLivePrice ? "accent" : "action",
      href: hasLivePrice ? null : "/contact",
      cta: "Contact pricing support",
    },
    {
      title: overview.pendingCount > 0 ? "New requests need a response" : "You’re caught up",
      body: overview.pendingCount > 0
        ? `${overview.pendingCount} ${overview.pendingCount === 1 ? "request is" : "requests are"} waiting in your queue. Review the scope and timing before accepting work.`
        : "There are no open matched requests right now. New opportunities will appear in Jobs & Requests.",
      tag: "Requests",
      icon: TrendingUp,
      tone: "muted",
      href: "/vendor/jobs",
      cta: "View requests",
    },
    {
      title: `Profile strength ${overview.profileStrength}%`,
      body: overview.profileComplete
        ? "Your essential listing details are complete. Keep services, location, and business information current."
        : "Complete your business name, location, bio, and services so Mercurius can present a useful listing to homeowners.",
      tag: overview.profileComplete ? "Complete" : "Action needed",
      icon: Sparkles,
      tone: overview.profileComplete ? "accent" : "action",
      href: "/vendor/profile",
      cta: "Improve profile",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 md:p-8">
      <div className="mb-5 sm:mb-6">
        <h1 className="break-words text-xl font-semibold text-foreground sm:text-2xl">{contractor.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {overview.setupComplete
            ? "You’re live — customers can find your profile and request eligible services."
            : !hasLivePrice
              ? "Start here: add provider-backed pricing so eligible services can move toward booking."
              : "Finish setup so customers can find your business and request service."}
        </p>
      </div>

      {overview.setupComplete ? (
        <Card className="mb-8 border-accent/40 bg-accent/5 ring-accent/20">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-accent" />
              <div>
                <p className="font-semibold text-foreground">You’re ready for customers</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Your essential profile details and an active fixed price are set. Monitor new requests here.
                </p>
              </div>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
              <ActionLink href="/providers"><ExternalLink className="h-4 w-4" />View directory</ActionLink>
              <ActionLink href="/vendor/jobs" outline><Users className="h-4 w-4" />View requests</ActionLink>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-8 border-accent/40 bg-accent/5 ring-accent/20">
          <CardHeader className="space-y-3 pb-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">Get ready for customers</CardTitle>
              <Badge variant="secondary" className="w-fit text-xs font-medium">
                {completedCount} of {checklist.length} complete
              </Badge>
            </div>
            <p className="text-sm font-medium text-foreground">Complete these steps to make your listing ready for customer requests.</p>
            <div className="space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full border border-border/40 bg-background/80">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-sm font-normal text-muted-foreground">
                {!hasLivePrice ? "Step 1: work with Mercurius to publish a provider-backed fixed price." : "Almost there — finish the remaining items below."}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!hasLivePrice && (
              <Link href="/contact" className={cn(buttonVariants({ size: "lg" }), "h-12 w-full bg-accent text-base text-accent-foreground shadow-sm hover:bg-accent/90 sm:w-auto")}>
                <DollarSign className="h-5 w-5" />Contact pricing support<ArrowRight className="h-4 w-4" />
              </Link>
            )}
            {checklist.map((item) => (
              <div key={item.id} className={cn("flex flex-col gap-3 rounded-lg border bg-background p-3.5 sm:flex-row sm:items-center sm:p-4", item.primary ? "border-accent/50 ring-1 ring-accent/20" : "border-border/60")}>
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {item.done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                  </div>
                </div>
                <Link href={item.href} className={cn(buttonVariants({ variant: item.primary ? "default" : "outline" }), "min-h-11 w-full shrink-0 sm:w-auto", item.primary && "bg-accent text-accent-foreground hover:bg-accent/90")}>
                  <item.icon className="h-4 w-4" /><span className="truncate">{item.cta}</span><ArrowRight className="h-3.5 w-3.5 opacity-70" />
                </Link>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <SectionHeading compact title="Performance" />
      <div className="mb-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => <MetricCard key={metric.label} {...metric} />)}
      </div>

      <SectionHeading title="Your Growth Funnel" description="How attention turns into booked work" />
      <div className="mb-12 grid gap-4 lg:grid-cols-5">
        <div className="grid content-start gap-4 sm:grid-cols-2 lg:col-span-2">
          {funnel.map((item) => (
            <Card key={item.label} className="h-full">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><item.icon className="h-4 w-4" />{item.label}</div>
                <p className="mt-2 text-2xl font-bold text-foreground">{item.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-base">
              Profile Views &amp; Impressions (Last 30 Days)
              <Badge variant="secondary" className="gap-1 text-[10px] font-medium"><Lock className="h-3 w-3" />Analytics</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AnalyticsUnavailable />
            <p className="mt-3 text-xs text-muted-foreground">Historical listing analytics will appear after profile-view and impression tracking is connected.</p>
          </CardContent>
        </Card>
      </div>

      <SectionHeading title="Insights & Recommendations" />
      <div className="mb-12 grid gap-4 md:grid-cols-3">
        {insights.map((insight) => (
          <Card key={insight.title} className={cn("flex h-full flex-col", insight.tone === "action" && "border-accent/40 bg-accent/5 ring-accent/10")}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10"><insight.icon className="h-5 w-5 text-accent" /></div>
                <Badge variant={insight.tone === "muted" ? "secondary" : "outline"} className={cn("text-xs", insight.tone === "action" && "border-accent/40 text-accent")}>{insight.tag}</Badge>
              </div>
              <CardTitle className="pt-2 text-base">{insight.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <p className="text-sm leading-relaxed text-muted-foreground">{insight.body}</p>
              {insight.href && (
                <Link href={insight.href} className={cn(buttonVariants({ variant: "outline" }), "mt-4 w-full self-start sm:w-auto")}>
                  {insight.cta}<ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Platform Performance</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-2">
            {[
              { label: "Profile Views (30d)", value: "—" },
              { label: "Search Impressions", value: "—" },
              { label: "Click-to-Book Rate", value: "—" },
              { label: "Repeat Customer Rate", value: "—" },
            ].map((stat) => (
              <div key={stat.label} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                <span className="text-sm text-muted-foreground">{stat.label}</span><span className="font-semibold text-foreground">{stat.value}</span>
              </div>
            ))}
          </div>
          <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
            No public-profile analytics source is connected yet. These fields remain unavailable rather than showing preview performance as live data.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, note, href, highlight, accent }: { icon: ComponentType<{ className?: string }>; label: string; value: string; note: string; href: string | null; highlight: boolean; accent: boolean }) {
  const card = (
    <Card className={cn("h-full", (highlight || accent) && "border-accent/50 bg-accent/5 ring-accent/10", href && "cursor-pointer transition-colors hover:border-accent/60 hover:bg-accent/5")}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className="h-4 w-4" />{label}{href && <ArrowRight className="ml-auto h-3 w-3 opacity-50" />}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2"><p className={cn("text-3xl font-bold", accent ? "text-accent" : "text-foreground")}>{value}</p>{accent && <span className="ml-auto h-2.5 w-2.5 rounded-full bg-accent ring-4 ring-accent/15" />}</div>
        <p className="mt-1.5 text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );

  return href ? <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{card}</Link> : <div>{card}</div>;
}

function AnalyticsUnavailable() {
  return (
    <div className="relative flex h-[220px] w-full items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-muted/25">
      <div className="pointer-events-none absolute inset-0 grid grid-rows-4 opacity-60">{Array.from({ length: 4 }).map((_, index) => <span key={index} className="border-b border-border/60 last:border-0" />)}</div>
      <div className="relative max-w-xs px-5 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-card shadow-sm ring-1 ring-border"><BarChart3 className="h-5 w-5 text-muted-foreground" /></span>
        <p className="mt-3 text-sm font-medium text-foreground">Listing analytics are not connected yet</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Requests are live; views, impressions, and conversion tracking will appear here when available.</p>
      </div>
    </div>
  );
}

function SectionHeading({ title, description, compact = false }: { title: string; description?: string; compact?: boolean }) {
  return <div className="mb-4"><h2 className={compact ? "text-sm font-medium text-muted-foreground" : "text-lg font-semibold text-foreground"}>{title}</h2>{description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}</div>;
}

function ActionLink({ href, children, outline = false }: { href: string; children: ReactNode; outline?: boolean }) {
  return <Link href={href} className={cn(buttonVariants({ variant: outline ? "outline" : "default" }), "min-h-11 w-full gap-1.5 sm:w-auto", !outline && "bg-accent text-accent-foreground hover:bg-accent/90")}>{children}</Link>;
}

function PageLoading() {
  return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">Loading your business...</span></div>;
}

function UnlinkedState() {
  return <PortalState icon={User} title="No contractor profile linked" description="Your vendor account is approved, but its contractor record has not been linked yet. Contact Mercurius for onboarding help." />;
}

function ErrorState() {
  return <PortalState icon={AlertCircle} title="We couldn’t load your overview" description="Live vendor data is temporarily unavailable. Refresh the page or contact Mercurius if the problem continues." />;
}

function PortalState({ icon: Icon, title, description }: { icon: ComponentType<{ className?: string }>; title: string; description: string }) {
  return (
    <div className="mx-auto max-w-lg px-6 py-20 text-center">
      <Icon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <Link href="/contact" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>Contact Mercurius</Link>
    </div>
  );
}
