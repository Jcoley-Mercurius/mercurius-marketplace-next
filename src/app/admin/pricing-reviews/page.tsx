"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  PauseCircle,
  RefreshCw,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  evaluateCustomPackageFrequencyPriceReviews,
  hasValidFixedTiers,
  isPricingFrequency,
  isPubliclyEligibleQuotePackage,
  type CustomPackagePriceReview,
  type PricingFrequency,
} from "@/lib/vendorPricing";

type PricingMode = "fixed" | "deposit_quote" | "custom_quote";

type PackageRecord = {
  id: string;
  contractor_id: string;
  service_id: string;
  template_id: string | null;
  name: string;
  description: string | null;
  pricing_mode: PricingMode;
  default_frequency: PricingFrequency;
  deposit_amount: number | null;
  is_active: boolean;
  needs_review: boolean;
  updated_at: string;
  created_at: string;
};
type RawPackageRecord = Omit<PackageRecord, "pricing_mode" | "default_frequency" | "deposit_amount"> & {
  pricing_mode: unknown;
  default_frequency: unknown;
  deposit_amount: unknown;
};

type PackageTier = {
  id: string;
  package_id: string;
  template_tier_id: string | null;
  name: string;
  price: number;
  frequency: PricingFrequency;
  rule_min: number | null;
  rule_max: number | null;
  sort_order: number;
};

type Contractor = { id: string; name: string; is_active: boolean | null };
type Service = {
  id: string;
  name: string;
  weekly_price: number | null;
  monthly_price: number | null;
  one_time_price: number | null;
};
type PricingTemplate = { id: string; service_id: string; is_active: boolean };
type TemplateTier = { id: string; template_id: string; name: string; min_price: number; max_price: number };
type TemplateRange = { minPrice: number; maxPrice: number };

type ReviewItem = PackageRecord & {
  contractor: Contractor | null;
  service: Service | null;
  tiers: PackageTier[];
  customReviews: Array<CustomPackagePriceReview & { frequency: PricingFrequency }>;
  managedRanges: Record<string, TemplateTier>;
};

type Mode = "loading" | "live" | "error";

export default function AdminPricingReviewsPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<{ id: string; action: "approve" | "pause" } | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading");
    setError("");
    try {
      const supabase = createClient();
      const packageResult = await supabase
        .from("vendor_packages")
        .select("id, contractor_id, service_id, template_id, name, description, pricing_mode, default_frequency, deposit_amount, is_active, needs_review, updated_at, created_at")
        .eq("needs_review", true)
        .order("updated_at", { ascending: false });
      if (packageResult.error) throw packageResult.error;

      const packageRows = ((packageResult.data ?? []) as RawPackageRecord[]).map((item) => ({
        ...item,
        pricing_mode: isPricingMode(item.pricing_mode) ? item.pricing_mode : "custom_quote",
        default_frequency: isPricingFrequency(item.default_frequency) ? item.default_frequency : "one-time",
        deposit_amount: item.deposit_amount === null ? null : Number(item.deposit_amount),
      }));

      if (!packageRows.length) {
        setItems([]);
        setMode("live");
        return;
      }

      const packageIds = packageRows.map((item) => item.id);
      const contractorIds = [...new Set(packageRows.map((item) => item.contractor_id))];
      const serviceIds = [...new Set(packageRows.map((item) => item.service_id))];
      const [contractorResult, serviceResult, tierResult, templateResult, templateTierResult] = await Promise.all([
        supabase.from("contractors").select("id, name, is_active").in("id", contractorIds),
        supabase.from("services_catalog").select("id, name, weekly_price, monthly_price, one_time_price").in("id", serviceIds),
        supabase.from("package_tiers").select("id, package_id, template_tier_id, name, price, frequency, rule_min, rule_max, sort_order").in("package_id", packageIds).order("sort_order"),
        supabase.from("pricing_templates").select("id, service_id, is_active"),
        supabase.from("pricing_template_tiers").select("id, template_id, name, min_price, max_price"),
      ]);
      const firstError = contractorResult.error ?? serviceResult.error ?? tierResult.error ?? templateResult.error ?? templateTierResult.error;
      if (firstError) throw firstError;

      const contractors = new Map(((contractorResult.data ?? []) as Contractor[]).map((item) => [item.id, item]));
      const services = new Map(((serviceResult.data ?? []) as Service[]).map((item) => [item.id, {
        ...item,
        weekly_price: item.weekly_price === null ? null : Number(item.weekly_price),
        monthly_price: item.monthly_price === null ? null : Number(item.monthly_price),
        one_time_price: item.one_time_price === null ? null : Number(item.one_time_price),
      }]));
      const tiers = ((tierResult.data ?? []) as PackageTier[]).map((item) => ({ ...item, frequency: isPricingFrequency(item.frequency) ? item.frequency : "one-time", price: Number(item.price), rule_min: item.rule_min === null ? null : Number(item.rule_min), rule_max: item.rule_max === null ? null : Number(item.rule_max) }));
      const templates = (templateResult.data ?? []) as PricingTemplate[];
      const templateTiers = ((templateTierResult.data ?? []) as TemplateTier[]).map((item) => ({ ...item, min_price: Number(item.min_price), max_price: Number(item.max_price) }));
      const managedRanges = Object.fromEntries(templateTiers.map((item) => [item.id, item]));
      const templateGuidance = buildTemplateGuidance(templates, templateTiers);

      setItems(packageRows.map((item) => {
        const packageTiers = tiers.filter((tier) => tier.package_id === item.id);
        const service = services.get(item.service_id) ?? null;
        const customReviews = item.template_id === null && item.pricing_mode === "fixed"
          ? evaluateCustomPackageFrequencyPriceReviews({
              tiers: packageTiers,
              defaultFrequency: item.default_frequency,
              catalog: service,
              templateRange: templateGuidance[item.service_id] ?? null,
            })
          : [];
        return {
          ...item,
          contractor: contractors.get(item.contractor_id) ?? null,
          service,
          tiers: packageTiers,
          customReviews,
          managedRanges,
        };
      }));
      setMode("live");
    } catch (reason) {
      console.error("Unable to load package pricing reviews", reason);
      setError(reason instanceof Error ? reason.message : "Package pricing reviews could not be loaded.");
      setMode("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const counts = useMemo(() => ({
    total: items.length,
    active: items.filter((item) => item.is_active).length,
    paused: items.filter((item) => !item.is_active).length,
    custom: items.filter((item) => item.template_id === null).length,
  }), [items]);

  async function approve(item: ReviewItem) {
    if (!canApprove(item)) {
      toast.error("This package is not safe to approve", { description: approvalBlockReason(item) });
      return;
    }
    const publicEffect = item.is_active
      ? "If the provider and all remaining public checks are eligible, this active package can become customer-facing immediately."
      : "The package will remain private until the vendor publishes it.";
    if (!window.confirm(`Approve “${item.name}” as a pricing exception? ${publicEffect}`)) return;

    setBusy({ id: item.id, action: "approve" });
    const result = await createClient()
      .from("vendor_packages")
      .update({ needs_review: false })
      .eq("id", item.id)
      .eq("needs_review", true)
      .eq("updated_at", item.updated_at)
      .select("id")
      .maybeSingle();
    setBusy(null);
    if (result.error) {
      toast.error("Package approval failed", { description: result.error.message });
      return;
    }
    if (!result.data) {
      toast.error("Package changed before approval", { description: "Refresh the queue and review the vendor’s latest saved pricing before approving." });
      await load(false);
      return;
    }
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    toast.success("Pricing review cleared", { description: publicEffect });
  }

  async function pause(item: ReviewItem) {
    if (!item.is_active || !window.confirm(`Pause “${item.name}” and keep it under review?`)) return;
    setBusy({ id: item.id, action: "pause" });
    const result = await createClient()
      .from("vendor_packages")
      .update({ is_active: false })
      .eq("id", item.id)
      .eq("needs_review", true)
      .eq("updated_at", item.updated_at)
      .select("id, updated_at")
      .maybeSingle();
    setBusy(null);
    if (result.error) {
      toast.error("Package could not be paused", { description: result.error.message });
      return;
    }
    if (!result.data) {
      toast.error("Package changed before it was paused", { description: "Refresh the queue before taking another action." });
      await load(false);
      return;
    }
    const updatedAt = result.data.updated_at;
    setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, is_active: false, updated_at: updatedAt } : candidate));
    toast.success("Package paused", { description: "It remains in the review queue and hidden from public pricing." });
  }

  if (mode === "loading") return <AdminLoading label="Loading package pricing reviews..." />;
  if (mode === "error") return <AdminError title="Pricing reviews could not be loaded" message={error} retry={() => void load(true)} />;

  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Pricing operations</p><h1 className="flex items-center gap-2 font-heading text-3xl font-semibold tracking-tight"><AlertTriangle className="text-amber-600" />Package Reviews</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">Review vendor package prices held outside public booking by the soft-launch guardrail. Approval clears only the review flag; it does not change the vendor’s price or active state.</p></div>
      <Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button>
    </header>

    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Needs review" value={counts.total} />
      <Stat label="Active but hidden" value={counts.active} tone="warning" />
      <Stat label="Paused" value={counts.paused} />
      <Stat label="Custom packages" value={counts.custom} />
    </div>

    <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-medium">Keep under review is the safe default</p><p className="mt-1 text-xs leading-5 opacity-80">No action is required to keep a package hidden. Approve only after accepting the displayed price as an intentional exception. Pause is available when an active package should also be disabled operationally.</p></div>

    {items.length === 0 ? <Card><CardContent className="p-0"><AdminEmpty icon={CheckCircle2} title="No packages need pricing review" description="New guardrail exceptions will appear here automatically." /></CardContent></Card> : <div className="grid gap-5 xl:grid-cols-2">{items.map((item) => <ReviewCard key={item.id} item={item} busy={busy} approve={approve} pause={pause} />)}</div>}
  </div>;
}

function ReviewCard({ item, busy, approve, pause }: { item: ReviewItem; busy: { id: string; action: "approve" | "pause" } | null; approve: (item: ReviewItem) => Promise<void>; pause: (item: ReviewItem) => Promise<void> }) {
  const itemBusy = busy?.id === item.id;
  const ready = canApprove(item);
  return <Card className="overflow-hidden border-amber-300/60 shadow-sm">
    <CardContent className="p-0">
      <div className="border-b border-amber-200/70 bg-amber-50/70 p-5 dark:bg-amber-950/20">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{item.name}</h2><Badge className="border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle />Needs review</Badge><Badge variant="outline">{pricingModeLabel(item.pricing_mode)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{item.contractor?.name ?? "Unknown vendor"} · {item.service?.name ?? item.service_id}</p></div><Badge variant="outline" className={cn(item.is_active ? "border-accent-border bg-accent-soft text-sage-dark" : "bg-background text-muted-foreground")}>{item.is_active ? "Active · hidden" : "Paused"}</Badge></div>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid gap-3 sm:grid-cols-2"><Detail label="Vendor"><span className="flex items-center gap-1.5"><Store className="h-3.5 w-3.5" />{item.contractor?.name ?? "Unavailable"}</span></Detail><Detail label="Last package update">{formatDateTime(item.updated_at)}</Detail><Detail label="Default cadence">{frequencyLabel(item.default_frequency)}</Detail><Detail label="Guardrail source">{guardrailSource(item)}</Detail></div>

        <section><div className="mb-2 flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Current pricing</h3>{item.customReviews.length > 1 && <Badge variant="outline">Cadence-specific ranges</Badge>}</div><PriceRows item={item} /></section>

        {!ready && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-destructive"><p className="font-medium">Approval blocked</p><p className="mt-0.5">{approvalBlockReason(item)}</p></div>}

        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center"><Button className="min-h-11 bg-accent text-accent-foreground hover:bg-accent-hover" disabled={itemBusy || !ready} onClick={() => void approve(item)}>{busy?.id === item.id && busy.action === "approve" ? <RefreshCw className="animate-spin" /> : <CheckCircle2 />}Approve pricing</Button>{item.is_active && <Button variant="outline" className="min-h-11" disabled={itemBusy} onClick={() => void pause(item)}>{busy?.id === item.id && busy.action === "pause" ? <RefreshCw className="animate-spin" /> : <PauseCircle />}Pause &amp; keep under review</Button>}<Link href={`/admin/vendors/${item.contractor_id}`} className={cn(buttonVariants({ variant: "ghost" }), "min-h-11 sm:ml-auto")}>Open vendor</Link></div>
      </div>
    </CardContent>
  </Card>;
}

function PriceRows({ item }: { item: ReviewItem }) {
  if (item.pricing_mode === "deposit_quote") return <div className="rounded-lg border bg-muted/20 px-3 py-3 text-sm"><div className="flex items-center justify-between gap-3"><span>Saved deposit</span><span className="font-semibold">{item.deposit_amount && item.deposit_amount > 0 ? money(item.deposit_amount) : "Missing"}</span></div><p className="mt-1 text-xs text-muted-foreground">Quote-required package; no instant customer price is created.</p></div>;
  if (item.pricing_mode === "custom_quote") return <div className="rounded-lg border bg-muted/20 px-3 py-3 text-sm"><p className="font-medium">Custom quote / matching required</p><p className="mt-1 text-xs text-muted-foreground">This mode does not publish a fixed bookable price.</p></div>;
  if (!item.tiers.length) return <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">No package tiers are saved.</div>;

  return <div className="space-y-2">{item.tiers.map((tier) => {
    const managedRange = tier.template_tier_id ? item.managedRanges[tier.template_tier_id] : null;
    const customReview = item.customReviews.find((review) => review.frequency === tier.frequency);
    const min = managedRange?.min_price ?? customReview?.minPrice ?? null;
    const max = managedRange?.max_price ?? customReview?.maxPrice ?? null;
    const outside = min !== null && max !== null && (tier.price < min || tier.price > max);
    return <div key={tier.id} className={cn("rounded-lg border px-3 py-3 text-sm", outside ? "border-amber-300/70 bg-amber-50/60 dark:bg-amber-950/20" : "bg-muted/20")}><div className="flex items-center justify-between gap-3"><div><p className="font-medium">{tier.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{frequencyLabel(tier.frequency)}</p>{(tier.rule_min !== null || tier.rule_max !== null) && <p className="mt-0.5 text-xs text-muted-foreground">Range rule: {tier.rule_min ?? "—"}–{tier.rule_max ?? "—"}</p>}</div><div className="text-right"><p className={cn("font-semibold", outside && "text-amber-800 dark:text-amber-200")}>{money(tier.price)}</p><p className="text-xs text-muted-foreground">{min !== null && max !== null ? `Expected ${money(min)}–${money(max)}` : "Expected range unavailable"}</p></div></div></div>;
  })}</div>;
}

function buildTemplateGuidance(templates: PricingTemplate[], tiers: TemplateTier[]) {
  const serviceByTemplate = new Map(templates.filter((item) => item.is_active).map((item) => [item.id, item.service_id]));
  const guidance: Record<string, TemplateRange> = {};
  tiers.forEach((tier) => {
    const serviceId = serviceByTemplate.get(tier.template_id);
    if (!serviceId || !Number.isFinite(tier.min_price) || !Number.isFinite(tier.max_price) || tier.min_price <= 0 || tier.max_price < tier.min_price) return;
    const current = guidance[serviceId];
    guidance[serviceId] = { minPrice: current ? Math.min(current.minPrice, tier.min_price) : tier.min_price, maxPrice: current ? Math.max(current.maxPrice, tier.max_price) : tier.max_price };
  });
  return guidance;
}

function canApprove(item: ReviewItem) {
  if (item.pricing_mode === "fixed") return hasValidFixedTiers(item.tiers);
  return isPubliclyEligibleQuotePackage({ ...item, is_active: true, needs_review: false });
}

function approvalBlockReason(item: ReviewItem) {
  if (item.pricing_mode === "fixed") return item.tiers.length ? "Every fixed-price tier must contain a positive valid price before the review flag can be cleared." : "The package has no saved price tiers.";
  if (item.pricing_mode === "deposit_quote") return "A quote + deposit package needs a positive deposit before approval.";
  return "This package is not currently eligible for approval.";
}

function guardrailSource(item: ReviewItem) {
  if (item.template_id !== null) return "Managed template tier bands";
  if (!item.customReviews.length) return "No fixed-price guardrail";
  const sources = new Set(item.customReviews.map((review) => review.source));
  if (sources.has("managed_template")) return "Template/catalog cadence bands";
  if (sources.has("service_catalog")) return "Service catalog cadence guidance";
  return "Soft-launch fallback ($20–$5,000)";
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warning" }) {
  return <Card className={cn(tone === "warning" && value > 0 && "border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20")}><CardContent className="py-4"><p className="text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></CardContent></Card>;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="rounded-lg border bg-muted/20 px-3 py-2.5"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><div className="mt-1 text-sm font-medium">{children}</div></div>;
}

function isPricingMode(value: unknown): value is PricingMode {
  return value === "fixed" || value === "deposit_quote" || value === "custom_quote";
}

function pricingModeLabel(value: PricingMode) {
  if (value === "fixed") return "Fixed price";
  if (value === "deposit_quote") return "Quote + deposit";
  return "Custom quote";
}

function frequencyLabel(value: PricingFrequency) {
  if (value === "one-time") return "One-time";
  if (value === "bi-monthly") return "Every two weeks";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(Number(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
