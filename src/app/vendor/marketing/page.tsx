"use client";

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BadgeCheck,
  BarChart3,
  CheckCircle2,
  Clock,
  Copy,
  DollarSign,
  ListChecks,
  Loader2,
  Lock,
  Megaphone,
  MessageSquareQuote,
  Phone,
  RefreshCw,
  Share2,
  Sparkles,
  Star,
  TrendingUp,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Contractor = {
  id: string;
  name: string;
  rating: number | null;
  jobs_completed: number | null;
  marketing_enabled: boolean;
};

type Metrics = {
  completedJobs: number;
  activeJobs: number;
  totalRevenue: number;
  avgRating: number | null;
  recentMonths: { key: string; month: string; revenue: number }[];
};

type Mode = "loading" | "ready" | "unlinked" | "error";

const activeStatuses = new Set(["pending", "matched", "scheduled", "in_progress"]);
const completedStatuses = new Set(["completed", "closed", "reviewed", "homeowner_confirmed"]);

export default function VendorMarketingPage() {
  const { user } = useAuth();
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const supabase = createClient();
      const contractorResult = await supabase
        .from("contractors")
        .select("id, name, rating, jobs_completed, marketing_enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      if (contractorResult.error) throw contractorResult.error;
      if (!contractorResult.data) {
        setContractor(null);
        setMetrics(null);
        setMode("unlinked");
        return;
      }
      const linkedContractor = contractorResult.data as Contractor;
      setContractor(linkedContractor);
      if (!linkedContractor.marketing_enabled) {
        setMetrics(null);
        setMode("ready");
        return;
      }

      const [requestsResult, invoicesResult] = await Promise.all([
        supabase.from("service_requests").select("id, status, created_at").eq("contractor_id", linkedContractor.id),
        supabase.from("invoices").select("status, vendor_payout, paid_at").eq("contractor_id", linkedContractor.id),
      ]);
      if (requestsResult.error) throw requestsResult.error;
      if (invoicesResult.error) throw invoicesResult.error;
      const requests = (requestsResult.data ?? []) as { id: string; status: string; created_at: string }[];
      const paidInvoices = ((invoicesResult.data ?? []) as { status: string; vendor_payout: number | null; paid_at: string | null }[]).filter((invoice) => invoice.status === "paid");
      const now = new Date();
      const recentMonths = Array.from({ length: 6 }, (_, index) => {
        const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
        const revenue = paidInvoices.filter((invoice) => {
          if (!invoice.paid_at) return false;
          const paidAt = new Date(invoice.paid_at);
          return paidAt.getMonth() === date.getMonth() && paidAt.getFullYear() === date.getFullYear();
        }).reduce((total, invoice) => total + Number(invoice.vendor_payout ?? 0), 0);
        return {
          key: `${date.getFullYear()}-${date.getMonth()}`,
          month: new Intl.DateTimeFormat("en-US", { month: "short" }).format(date),
          revenue,
        };
      });
      setMetrics({
        completedJobs: requests.filter((request) => completedStatuses.has(request.status)).length,
        activeJobs: requests.filter((request) => activeStatuses.has(request.status)).length,
        totalRevenue: paidInvoices.reduce((total, invoice) => total + Number(invoice.vendor_payout ?? 0), 0),
        avgRating: linkedContractor.rating,
        recentMonths,
      });
      setMode("ready");
    } catch (reason) {
      console.error("Unable to load vendor marketing", reason);
      setMetrics(null);
      setError(reason instanceof Error ? reason.message : "Marketing data could not be loaded.");
      setMode("error");
    }
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (mode === "loading") return <Loading />;
  if (mode === "unlinked") return <State icon={AlertCircle} title="No contractor profile linked" copy="Your marketing tools will become available after Mercurius links your approved vendor profile." />;
  if (mode === "error") return <State icon={AlertCircle} title="Marketing couldn’t be loaded" copy={`No preview metrics have been substituted. ${error}`} action={<Button variant="outline" onClick={() => { setMode("loading"); void load(); }}><RefreshCw />Try again</Button>} />;
  if (!contractor) return null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-10 p-4 sm:p-6 md:p-8">
      <header>
        <h1 className="font-heading text-2xl font-semibold">Marketing</h1>
        <p className="mt-1 text-sm text-muted-foreground">Tools and support to help more customers find and book you.</p>
      </header>

      {contractor.marketing_enabled && metrics && <MarketingMetrics contractor={contractor} metrics={metrics} />}
      <FreeTools contractor={contractor} />
      {!contractor.marketing_enabled && <GrowthSection />}
      <FullServiceCard />
    </div>
  );
}

function FreeTools({ contractor }: { contractor: Contractor }) {
  const listingPath = `/providers/${contractor.id}`;

  const copy = async (value: string, title: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(title);
    } catch {
      toast.error("Copy failed", { description: "Your browser did not allow clipboard access." });
    }
  };

  const copyListing = () => void copy(`${window.location.origin}${listingPath}`, "Listing link copied");
  const copyReviewRequest = () => void copy(
    `Hi! Thank you for choosing ${contractor.name}. If Mercurius sends you a review invitation for our completed service, we’d appreciate your honest feedback.`,
    "Review request message copied",
  );

  return <section className="space-y-4">
    <div><h2 className="text-lg font-semibold">Your Free Marketing Tools</h2><p className="text-sm text-muted-foreground">Available to every Mercurius vendor — start using them today.</p></div>
    <div className="grid gap-4 md:grid-cols-3">
      <ToolCard icon={Share2} title="Share your public listing" copy="Copy your directory listing link and share it with customers or on social media."><Button variant="outline" size="sm" className="w-full" onClick={copyListing}><Copy />Copy listing link</Button></ToolCard>
      <ToolCard icon={MessageSquareQuote} title="Request a review" copy="Copy a professional follow-up message for a customer after a completed job."><Button variant="outline" size="sm" className="w-full" onClick={copyReviewRequest}><Star />Copy request message</Button></ToolCard>
      <Card className="rounded-2xl border-border/60 bg-sage-light/30"><CardHeader className="pb-3"><IconBox icon={ListChecks} /><CardTitle className="text-base">Quick tips checklist</CardTitle></CardHeader><CardContent><ul className="space-y-2.5">{["Complete your profile for a stronger listing", "Share your listing link", "Ask every happy customer for an honest review"].map((tip) => <li key={tip} className="flex items-start gap-2 text-sm text-foreground/80"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" /><span>{tip}</span></li>)}</ul></CardContent></Card>
    </div>
  </section>;
}

function ToolCard({ icon, title, copy, children }: { icon: ComponentType<{ className?: string }>; title: string; copy: string; children: ReactNode }) {
  return <Card className="rounded-2xl border-border/60 transition-shadow hover:shadow-md"><CardHeader className="pb-3"><IconBox icon={icon} /><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm leading-relaxed text-muted-foreground">{copy}</p>{children}</CardContent></Card>;
}

function IconBox({ icon: Icon }: { icon: ComponentType<{ className?: string }> }) {
  return <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-sage-light"><Icon className="h-4 w-4 text-sage-dark" /></div>;
}

const growthBenefits = [
  { icon: TrendingUp, title: "Enhanced visibility ranking", description: "Appear more prominently when your services fit a local request." },
  { icon: BarChart3, title: "Marketing performance dashboard", description: "Track Mercurius jobs, paid revenue, and customer rating." },
  { icon: Zap, title: "Priority lead matching", description: "Be considered earlier for suitable jobs in your service area." },
  { icon: BadgeCheck, title: "Review tools and profile support", description: "Build trust with review follow-up tools and listing guidance." },
];

function GrowthSection() {
  return <section className="space-y-4"><div><h2 className="text-lg font-semibold">Grow Faster with the Growth Plan</h2><p className="text-sm text-muted-foreground">Unlock stronger visibility and additional marketing support.</p></div><Card className="rounded-2xl border-sage/30 bg-gradient-to-br from-sage-light/40 to-transparent"><CardContent className="space-y-6 p-6 md:p-8"><div className="grid gap-4 sm:grid-cols-2">{growthBenefits.map((benefit) => <div key={benefit.title} className="flex items-start gap-3 rounded-xl border border-border/60 bg-card p-4"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sage-light"><benefit.icon className="h-4 w-4 text-sage-dark" /></div><div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{benefit.title}</p><Badge variant="outline" className="gap-1 border-sage/40 text-[10px] text-sage-dark"><Lock className="h-2.5 w-2.5" />Growth</Badge></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{benefit.description}</p></div></div>)}</div><div className="text-center"><Link href="/vendor/plan" className={cn(buttonVariants({ size: "lg" }), "bg-accent font-semibold text-accent-foreground hover:bg-accent/90")}><Sparkles />View Growth Plan — $79/mo</Link><p className="mt-3 text-xs text-muted-foreground">Plan activation is coordinated directly with Mercurius.</p></div></CardContent></Card></section>;
}

function FullServiceCard() {
  return <section><div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary/85 p-8 text-primary-foreground"><div className="relative z-10 max-w-xl"><Badge className="mb-3 border-white/20 bg-white/15 text-[10px] uppercase tracking-wider text-primary-foreground">Full-service</Badge><h2 className="mb-3 text-2xl font-bold text-primary-foreground">Want us to run marketing for you?</h2><p className="mb-6 text-sm leading-relaxed text-primary-foreground/80">Talk with Mercurius about available support for SEO, advertising, social media, and review strategy so you can stay focused on the work.</p><a href="mailto:hello@mercurius.com?subject=Full-Service%20Vendor%20Marketing" className={buttonVariants({ variant: "secondary", size: "lg", className: "font-semibold" })}><Phone />Talk to us</a><p className="mt-4 text-xs text-primary-foreground/70">Reach out to hello@mercurius.com to discuss current availability.</p></div><div className="pointer-events-none absolute right-0 top-0 h-full w-48 opacity-[0.07]"><Megaphone className="h-full w-full" /></div></div></section>;
}

function MarketingMetrics({ contractor, metrics }: { contractor: Contractor; metrics: Metrics }) {
  const maxRevenue = Math.max(...metrics.recentMonths.map((month) => month.revenue), 1);
  const cards = [
    { icon: DollarSign, label: "Total Revenue", value: money(metrics.totalRevenue) },
    { icon: CheckCircle2, label: "Jobs Completed", value: String(metrics.completedJobs) },
    { icon: Clock, label: "Active Jobs", value: String(metrics.activeJobs) },
    { icon: Star, label: "Avg. Rating", value: metrics.avgRating === null ? "—" : Number(metrics.avgRating).toFixed(1) },
  ];
  return <section className="space-y-4"><div className="flex items-center gap-2"><h2 className="text-lg font-semibold">Performance</h2><Badge className="gap-1 border-accent/20 bg-accent/10 text-accent"><CheckCircle2 className="h-3 w-3" />Marketing Active</Badge></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map((metric) => <Card key={metric.label} className="rounded-2xl"><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><metric.icon className="h-4 w-4" />{metric.label}</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{metric.value}</p></CardContent></Card>)}</div><Card className="rounded-2xl"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-accent" />Revenue (Last 6 Months) · {contractor.name}</CardTitle></CardHeader><CardContent><div className="flex h-40 items-end gap-2 sm:gap-3">{metrics.recentMonths.map((month) => <div key={month.key} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[10px] text-muted-foreground sm:text-xs">{compactMoney(month.revenue)}</span><div className="min-h-1 w-full rounded-t-md bg-accent/80 transition-colors hover:bg-accent" style={{ height: `${Math.max((month.revenue / maxRevenue) * 100, month.revenue > 0 ? 4 : 1)}%` }} /><span className="text-xs text-muted-foreground">{month.month}</span></div>)}</div>{metrics.totalRevenue === 0 && <p className="mt-4 text-center text-xs text-muted-foreground">No paid vendor payouts are recorded yet.</p>}</CardContent></Card></section>;
}

function Loading() { return <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-6 w-6 animate-spin text-accent" />Loading marketing…</div>; }
function State({ icon: Icon, title, copy, action }: { icon: typeof AlertCircle; title: string; copy: string; action?: ReactNode }) { return <div className="flex min-h-[520px] items-center justify-center p-8 text-center"><div><Icon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" /><h1 className="text-xl font-semibold">{title}</h1><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{copy}</p>{action && <div className="mt-5">{action}</div>}</div></div>; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
function compactMoney(value: number) { return value >= 1000 ? `$${(value / 1000).toFixed(1)}k` : `$${value}`; }
