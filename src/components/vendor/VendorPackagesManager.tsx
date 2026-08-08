"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Copy,
  DollarSign,
  ExternalLink,
  Loader2,
  Package,
  PackageCheck,
  PauseCircle,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PricingToggle } from "@/components/vendor/PricingToggle";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  hasValidFixedTiers,
  isPricingFrequency,
  isPubliclyEligibleFixedPackage,
  type PricingFrequency,
} from "@/lib/vendorPricing";

type ServiceOption = {
  id: string;
  name: string;
  default_frequency: PricingFrequency;
  available_frequencies: PricingFrequency[] | null;
};
type QuestionRow = {
  id?: string;
  question_key: string;
  question_label: string;
  input_type: "number" | "select" | "text";
  unit?: string | null;
  options?: unknown;
  sort_order: number;
};
type TierRow = {
  id?: string;
  name: string;
  price: number;
  rule_question_key?: string | null;
  rule_min?: number | null;
  rule_max?: number | null;
  includes: string[];
  sort_order: number;
};
type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  service_id: string;
  pricing_mode: "fixed" | "deposit_quote" | "custom_quote";
  default_frequency: PricingFrequency;
  deposit_amount: number | null;
  is_active: boolean;
  needs_review: boolean;
  template_id: string | null;
  tiers: TierRow[];
  questions: QuestionRow[];
};

type CoverageState =
  | "live_fixed"
  | "needs_review"
  | "paused_valid"
  | "draft"
  | "quote_only"
  | "no_package";

type ServiceCoverage = {
  key: string;
  raw: string;
  label: string;
  service?: ServiceOption;
  state: CoverageState;
  package?: PackageRow;
};

const FREQUENCIES: Record<PricingFrequency, string> = {
  "one-time": "One-time",
  weekly: "Weekly",
  "bi-monthly": "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

const nativeSelect = "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const slugKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "size";
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function VendorPackagesManager() {
  const { user } = useAuth();
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [profileServices, setProfileServices] = useState<string[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [allPackages, setAllPackages] = useState<PackageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PackageRow | null>(null);
  const [originalPackage, setOriginalPackage] = useState<PackageRow | null>(null);
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [nameEditorOpen, setNameEditorOpen] = useState(false);
  const [nameCustomized, setNameCustomized] = useState(false);
  const [customerPrice, setCustomerPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [liveSuccessOpen, setLiveSuccessOpen] = useState(false);

  const refresh = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data: packageData, error: packageError } = await supabase
      .from("vendor_packages")
      .select("*")
      .eq("contractor_id", id)
      .order("sort_order");
    if (packageError) throw packageError;
    const rows = (packageData ?? []) as PackageRow[];
    if (!rows.length) {
      setPackages([]);
      setAllPackages([]);
      return;
    }
    const ids = rows.map((item) => item.id);
    const [questionsResult, tiersResult] = await Promise.all([
      supabase.from("package_qualifying_questions").select("*").in("package_id", ids).order("sort_order"),
      supabase.from("package_tiers").select("*").in("package_id", ids).order("sort_order"),
    ]);
    if (questionsResult.error) throw questionsResult.error;
    if (tiersResult.error) throw tiersResult.error;
    const questions = (questionsResult.data ?? []) as (QuestionRow & { package_id: string })[];
    const tiers = (tiersResult.data ?? []) as (TierRow & { package_id: string })[];
    const hydrated = rows.map((item) => ({
      ...item,
      questions: questions.filter((question) => question.package_id === item.id),
      tiers: tiers.filter((tier) => tier.package_id === item.id),
    }));
    setAllPackages(hydrated);
    setPackages(hydrated.filter((item) => item.template_id === null));
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const supabase = createClient();
    void (async () => {
      setLoading(true);
      setLoadError(null);
      const [contractorResult, serviceResult] = await Promise.all([
        supabase.from("contractors").select("id, services").eq("user_id", user.id).maybeSingle(),
        supabase.from("services_catalog").select("id, name, default_frequency, available_frequencies").eq("is_active", true).order("name"),
      ]);
      if (!active) return;
      if (contractorResult.error || serviceResult.error) {
        setLoadError(contractorResult.error?.message ?? serviceResult.error?.message ?? "Pricing could not be loaded.");
        setLoading(false);
        return;
      }
      setServices((serviceResult.data ?? []).map((service) => {
        const frequency = isPricingFrequency(service.default_frequency) ? service.default_frequency : "one-time";
        const available = Array.isArray(service.available_frequencies)
          ? service.available_frequencies.filter(isPricingFrequency)
          : null;
        return { ...service, default_frequency: frequency, available_frequencies: available } as ServiceOption;
      }));
      const contractor = contractorResult.data as { id: string; services?: string[] | null } | null;
      if (contractor?.id) {
        setContractorId(contractor.id);
        setProfileServices([...new Set((contractor.services ?? []).filter(Boolean))]);
        try { await refresh(contractor.id); } catch (error) {
          if (active) setLoadError(error instanceof Error ? error.message : "Pricing could not be loaded.");
        }
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [refresh, user]);

  const closeEditor = () => {
    setOpen(false);
    setEditing(null);
    setOriginalPackage(null);
    setAdvancedOpen(false);
    setNameEditorOpen(false);
    setNameCustomized(false);
    setCustomerPrice("");
    setSaving(false);
  };

  const openEditor = (item: PackageRow) => {
    const minimum = item.tiers.length ? Math.min(...item.tiers.map((tier) => Number(tier.price) || 0)) : 0;
    const isAdvanced = item.questions.length > 0 || item.tiers.length > 1;
    const automaticName = packageName(services.find((service) => service.id === item.service_id)?.name ?? displayService(item.service_id), item.default_frequency);
    setEditing(structuredClone(item));
    setOriginalPackage(item.id ? structuredClone(item) : null);
    setCustomerPrice(minimum > 0 ? String(minimum) : "");
    setAdvancedOpen(isAdvanced);
    setNameCustomized(Boolean(item.name && item.name !== automaticName));
    setNameEditorOpen(Boolean(item.name && item.name !== automaticName));
    setOpen(true);
  };

  const newPackage = (serviceId?: string, serviceLabel?: string) => {
    const selectedService = services.find((service) => service.id === serviceId) ?? (!serviceLabel ? services[0] : undefined);
    const frequency = selectedService ? defaultFrequencyForService(selectedService) : "one-time";
    const label = selectedService?.name ?? serviceLabel ?? "";
    openEditor({
      id: "",
      name: label ? packageName(label, frequency) : "",
      description: null,
      service_id: selectedService?.id ?? "",
      pricing_mode: "fixed",
      default_frequency: frequency,
      deposit_amount: null,
      is_active: true,
      needs_review: false,
      template_id: null,
      tiers: [],
      questions: [],
    });
  };

  const updateField = <K extends keyof PackageRow>(key: K, value: PackageRow[K]) => {
    setEditing((current) => current ? { ...current, [key]: value } : current);
  };

  const changeService = (serviceId: string) => {
    const service = services.find((candidate) => candidate.id === serviceId);
    if (!service) return;
    const changingExistingService = Boolean(editing?.service_id && editing.service_id !== serviceId);
    const hasEnteredPricing = Boolean(customerPrice || editing?.tiers.length || editing?.questions.length);
    if (changingExistingService && hasEnteredPricing && !window.confirm("Change this package’s service? Existing prices and advanced questions will be cleared so they are not carried to a different service.")) return;
    const frequency = frequenciesForService(service).includes(editing?.default_frequency ?? "one-time")
      ? editing?.default_frequency ?? defaultFrequencyForService(service)
      : defaultFrequencyForService(service);
    setEditing((current) => current ? {
      ...current,
      service_id: service.id,
      default_frequency: frequency,
      name: nameCustomized ? current.name : packageName(service.name, frequency),
      tiers: changingExistingService ? [] : current.tiers,
      questions: changingExistingService ? [] : current.questions,
    } : current);
    setCustomerPrice("");
    if (changingExistingService) setAdvancedOpen(false);
  };

  const changeFrequency = (frequency: PricingFrequency) => {
    const service = services.find((candidate) => candidate.id === editing?.service_id);
    setEditing((current) => current ? {
      ...current,
      default_frequency: frequency,
      name: nameCustomized ? current.name : packageName(service?.name ?? displayService(current.service_id), frequency),
    } : current);
  };

  const enterAdvanced = () => {
    setAdvancedOpen(true);
    setEditing((current) => {
      if (!current || current.tiers.length > 1 || current.questions.length) return current;
      const price = Number(customerPrice) || current.tiers[0]?.price || 0;
      return {
        ...current,
        questions: [{ question_key: "size", question_label: "", input_type: "number", unit: "", sort_order: 0 }],
        tiers: [{ name: "Standard", price, rule_question_key: "size", rule_min: 0, rule_max: 100, includes: [], sort_order: 0 }],
      };
    });
  };

  const switchToSimplePricing = () => {
    if (!editing) return;
    const hasAdvancedStructure = editing.questions.length > 0 || editing.tiers.length > 1;
    if (hasAdvancedStructure && !window.confirm("Switch to one simple price? Publishing this change will replace the existing questions and price levels with a single Standard price.")) return;
    const minimum = editing.tiers.map((tier) => Number(tier.price)).filter((price) => Number.isFinite(price) && price > 0).sort((a, b) => a - b)[0];
    setCustomerPrice(minimum ? String(minimum) : "");
    setAdvancedOpen(false);
  };

  const savePackage = async (continueAdding: boolean) => {
    if (!editing || !contractorId || saving) return;
    const name = editing.name.trim();
    if (!name || !editing.service_id) {
      toast.error("Name and service are required.");
      return;
    }
    let questions: QuestionRow[] = [];
    let tiers: TierRow[] = [];
    if (advancedOpen) {
      if (!editing.tiers.length || editing.tiers.some((tier) => !tier.name.trim() || tier.price <= 0)) {
        toast.error("Every price level needs a name and a price greater than $0.");
        return;
      }
      const question = editing.questions[0];
      if (!question?.question_label.trim()) {
        toast.error("Add the customer question used to choose a price level.");
        return;
      }
      questions = [{ ...question, question_key: slugKey(question.question_label), sort_order: 0 }];
      tiers = editing.tiers.map((tier, index) => ({ ...tier, rule_question_key: questions[0].question_key, sort_order: index }));
      const rangeError = validateTierRanges(tiers);
      if (rangeError) {
        toast.error("Check the price-level ranges", { description: rangeError });
        return;
      }
    } else {
      const price = Number(customerPrice);
      if (!Number.isFinite(price) || price <= 0) {
        toast.error("Enter a customer price greater than $0.");
        return;
      }
      tiers = [{ name: "Standard", price, rule_question_key: null, rule_min: null, rule_max: null, includes: [], sort_order: 0 }];
    }

    if (editing.is_active && !isPubliclyEligibleFixedPackage({ ...editing, pricing_mode: "fixed", tiers })) {
      toast.error(editing.needs_review ? "Review is required before publishing" : "This package is not ready to publish", {
        description: editing.needs_review
          ? "Keep the package private until its pricing review is resolved."
          : "Every saved price level must have a price greater than $0.",
      });
      return;
    }

    setSaving(true);
    const supabase = createClient();
    let packageId = editing.id;
    const created = !packageId;
    const nextCoverage = nextIncompleteCoverageFor(editing.service_id);
    const payload = {
      name,
      description: editing.description || null,
      service_id: editing.service_id,
      pricing_mode: "fixed",
      default_frequency: editing.default_frequency,
      deposit_amount: null,
      is_active: false,
      needs_review: editing.needs_review,
    };
    try {
      if (!packageId) {
        const result = await supabase.from("vendor_packages").insert({ contractor_id: contractorId, ...payload }).select("id").single();
        if (result.error || !result.data) throw result.error ?? new Error("The price record was not created.");
        packageId = (result.data as { id: string }).id;
      } else {
        const result = await supabase.from("vendor_packages").update(payload).eq("id", packageId).eq("contractor_id", contractorId);
        if (result.error) throw result.error;
      }
      await replacePackageChildren(supabase, packageId, questions, tiers);
      const publishResult = await supabase.from("vendor_packages").update({ is_active: editing.is_active }).eq("id", packageId).eq("contractor_id", contractorId);
      if (publishResult.error) throw publishResult.error;
      const live = editing.is_active;
      closeEditor();
      await refresh(contractorId);
      if (continueAdding && nextCoverage) {
        toast.success(live ? "Price published" : "Draft saved", { description: "The next unpriced service is ready." });
        openCoverageEditor(nextCoverage);
      } else if (continueAdding) {
        toast.success(live ? "Price published" : "Draft saved", { description: "There are no other unpriced profile services in this session." });
      } else if (live) {
        setLiveSuccessOpen(true);
      } else {
        toast.success("Saved as draft", { description: "Publish it when the customer price is ready." });
      }
    } catch (error) {
      let restored = false;
      let recoveryMessage = "No public price was changed.";
      if (packageId) {
        if (created) {
          const cleanup = await supabase.from("vendor_packages").delete().eq("id", packageId).eq("contractor_id", contractorId);
          restored = !cleanup.error;
          if (restored) recoveryMessage = "The incomplete new package was removed.";
        } else if (originalPackage) {
          restored = await restorePackageSnapshot(supabase, contractorId, originalPackage);
          if (restored) recoveryMessage = "The previous package was restored.";
        }
        if (!restored) {
          await supabase.from("vendor_packages").update({ is_active: false }).eq("id", packageId).eq("contractor_id", contractorId);
          recoveryMessage = "The incomplete package was kept private.";
        }
      }
      setSaving(false);
      toast.error("Couldn’t save this price", { description: `${error instanceof Error ? error.message : "Please try again."} ${recoveryMessage}` });
    }
  };

  const togglePackage = async (item: PackageRow) => {
    if (!contractorId) return;
    if (!item.is_active && (!hasValidFixedTiers(item.tiers) || item.needs_review)) {
      toast.error(item.needs_review ? "Review is required before publishing" : "Add a valid fixed price before publishing", {
        description: item.needs_review ? "Keep this package private until Mercurius resolves the review flag." : "Every price level must have a customer price greater than $0.",
      });
      return;
    }
    setMutatingId(item.id);
    const supabase = createClient();
    const result = await supabase.from("vendor_packages").update({ is_active: !item.is_active }).eq("id", item.id).eq("contractor_id", contractorId);
    setMutatingId(null);
    if (result.error) toast.error("Couldn’t update availability", { description: result.error.message });
    else await refresh(contractorId);
  };

  const deletePackage = async (item: PackageRow) => {
    if (!contractorId || !window.confirm(`Delete “${item.name}”? This cannot be undone.`)) return;
    setMutatingId(item.id);
    const supabase = createClient();
    const result = await supabase.from("vendor_packages").delete().eq("id", item.id).eq("contractor_id", contractorId);
    setMutatingId(null);
    if (result.error) toast.error("Couldn’t delete this price", { description: result.error.message });
    else { toast.success("Price deleted"); await refresh(contractorId); }
  };

  const serviceForProfileValue = (raw: string) => services.find((service) => normalize(service.id) === normalize(raw) || normalize(service.name) === normalize(raw));
  const uniqueProfileServices = [...new Map(profileServices.filter(Boolean).map((raw) => [normalize(raw), raw])).values()];
  const profileCoverage: ServiceCoverage[] = uniqueProfileServices.map((raw) => {
    const service = serviceForProfileValue(raw);
    const keys = new Set([normalize(raw), service ? normalize(service.id) : "", service ? normalize(service.name) : ""].filter(Boolean));
    const matching = allPackages
      .filter((item) => {
        const catalogService = services.find((candidate) => candidate.id === item.service_id);
        return keys.has(normalize(item.service_id)) || Boolean(catalogService && keys.has(normalize(catalogService.name)));
      })
      .sort((left, right) => Number(left.template_id !== null) - Number(right.template_id !== null));
    const live = matching.find(isLiveFixedPackage);
    const review = matching.find((item) => item.needs_review);
    const pausedValid = matching.find((item) => item.pricing_mode === "fixed" && !item.is_active && !item.needs_review && hasValidFixedTiers(item.tiers));
    const draft = matching.find((item) => item.pricing_mode === "fixed");
    const quote = matching.find((item) => item.pricing_mode !== "fixed");
    const selected = live ?? review ?? pausedValid ?? draft ?? quote;
    const state: CoverageState = live
      ? "live_fixed"
      : review
        ? "needs_review"
        : pausedValid
          ? "paused_valid"
          : draft
            ? "draft"
            : quote
              ? "quote_only"
              : "no_package";
    return {
      key: normalize(raw),
      raw,
      label: service?.name ?? displayService(raw),
      service,
      state,
      package: selected,
    };
  });
  const orderedCoverage = [...profileCoverage].sort((left, right) => coverageStateRank(left.state) - coverageStateRank(right.state) || left.label.localeCompare(right.label));
  const incompleteCoverage = orderedCoverage.filter((row) => row.state !== "live_fixed");
  const pricedServiceCount = profileCoverage.length - incompleteCoverage.length;

  const nextIncompleteCoverageFor = (serviceId: string) => {
    const currentService = services.find((service) => service.id === serviceId);
    const currentKeys = new Set([normalize(serviceId), currentService ? normalize(currentService.name) : ""].filter(Boolean));
    return incompleteCoverage.find((row) => {
      if (currentKeys.has(row.key) || (row.service && currentKeys.has(normalize(row.service.id)))) return false;
      if (row.state === "needs_review") return false;
      if (row.state === "no_package" || row.state === "quote_only") return true;
      return row.package?.template_id === null;
    });
  };

  const openCoverageEditor = (row: ServiceCoverage) => {
    if ((row.state === "paused_valid" || row.state === "draft") && row.package?.template_id === null) {
      openEditor({ ...row.package, is_active: true });
      return;
    }
    if (row.state === "live_fixed" && row.package?.template_id === null) {
      openEditor(row.package);
      return;
    }
    if (row.state === "no_package" || row.state === "quote_only") {
      newPackage(row.service?.id, row.label);
    }
  };

  const packageStats = {
    live: allPackages.filter(isLiveFixedPackage).length,
    paused: allPackages.filter((item) => !item.is_active).length,
    review: allPackages.filter((item) => item.needs_review).length,
    coveredServices: pricedServiceCount,
  };

  const managedPackages = allPackages.filter((item) => item.template_id !== null);
  const sortedPackages = [...packages].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name));

  if (loading) return <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading pricing…</div>;
  if (loadError) return <div className="mx-auto max-w-3xl p-6"><div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center"><h2 className="font-semibold">Pricing couldn’t be loaded</h2><p className="mt-2 text-sm text-muted-foreground">No preview packages have been substituted. {loadError}</p><Button variant="outline" className="mt-5" onClick={() => window.location.reload()}><RefreshCw />Try again</Button></div></div>;
  if (!contractorId) return <div className="mx-auto max-w-3xl p-6"><div className="rounded-xl border bg-card p-8 text-center"><h2 className="font-semibold">Vendor profile not linked</h2><p className="mt-2 text-sm text-muted-foreground">Your account does not have a linked contractor record yet. Contact Mercurius support before publishing prices.</p></div></div>;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Launch pricing</p>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold"><Package className="h-6 w-6 text-accent" />Pricing &amp; Packages</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Publish real fixed prices so eligible homeowners can move directly toward booking. Drafts stay private until you turn them live.</p>
        </div>
        <Button className="min-h-11 w-full bg-accent text-accent-foreground hover:bg-accent-hover sm:w-auto" disabled={!services.length} onClick={() => newPackage()}><Plus />Add fixed price</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={PackageCheck} label="Live / Active" value={packageStats.live} note="Fixed prices available publicly" tone="live" />
        <SummaryCard icon={PauseCircle} label="Draft or Paused" value={packageStats.paused} note="Not currently customer-facing" />
        <SummaryCard icon={AlertTriangle} label="Needs Review" value={packageStats.review} note="Flagged pricing records" tone={packageStats.review ? "review" : undefined} />
        <SummaryCard icon={DollarSign} label="Profile Coverage" value={profileCoverage.length ? `${packageStats.coveredServices}/${profileCoverage.length}` : "—"} note={profileCoverage.length ? "Listed services with a live price" : "Add services to your profile"} />
      </div>

      {!services.length && <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><p className="font-medium">No active service catalog options are available</p><p className="mt-1 text-xs leading-5 opacity-80">New packages cannot be created until Mercurius activates at least one catalog service. Existing pricing remains visible below.</p></div>}

      <section className="space-y-4 rounded-2xl border border-accent-border bg-accent-subtle p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-heading text-lg font-semibold">{incompleteCoverage.length ? "Not priced yet" : "Pricing coverage"}</h2>
              {profileCoverage.length > 0 && <Badge variant="outline" className="border-accent-border bg-background">{pricedServiceCount} of {profileCoverage.length} priced</Badge>}
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Each profile service needs at least one active, review-cleared fixed price to count as complete. Existing drafts and quote-only options are shown so you can take the right next step without creating duplicates.</p>
          </div>
          {incompleteCoverage.length === 0 && profileCoverage.length > 0 && <Badge className="w-fit border border-accent-border bg-accent-soft text-sage-dark"><CheckCircle2 />Pricing complete</Badge>}
        </div>

        {profileCoverage.length > 0 && <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-background/80 ring-1 ring-border/60" role="progressbar" aria-label="Profile service pricing coverage" aria-valuemin={0} aria-valuemax={profileCoverage.length} aria-valuenow={pricedServiceCount}><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((pricedServiceCount / profileCoverage.length) * 100)}%` }} /></div>
          <p className="text-xs text-muted-foreground">{incompleteCoverage.length ? `${incompleteCoverage.length} ${incompleteCoverage.length === 1 ? "service still needs" : "services still need"} a live fixed price.` : "Every listed profile service has live fixed-price coverage."}</p>
        </div>}

        {profileCoverage.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-background/70 p-6 text-center">
            <p className="text-sm font-medium">No services are listed on your profile</p>
            <p className="mt-1 text-xs text-muted-foreground">Add your services first so pricing completeness can be measured accurately.</p>
            <Link href="/vendor/profile" className={cn(buttonVariants({ variant: "outline" }), "mt-4")}>Update profile</Link>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {orderedCoverage.map((row) => {
              const details = coverageDetails(row);
              const managed = row.package?.template_id !== null && row.package !== undefined;
              const canOpenEditor = row.state !== "needs_review" && (row.state === "no_package" || row.state === "quote_only" || row.package?.template_id === null);
              return (
                <article key={row.key} className={cn("flex flex-col rounded-xl border bg-background p-4", row.state === "live_fixed" ? "border-accent-border/70" : "border-border shadow-sm")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">{row.label}</h3>
                    <CoverageBadge state={row.state} />
                  </div>
                  <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{details.description}</p>
                  {!row.service && services.length > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">This profile label does not exactly match an active catalog service. Choose the correct service before saving.</p>}
                  <div className="mt-4">
                    {managed ? (
                      <Link href="/vendor/pricing" className={buttonVariants({ variant: "outline", className: "min-h-11 border-accent-border" })}>{details.action}<ExternalLink /></Link>
                    ) : row.state === "needs_review" ? (
                      <Link href="/contact" className={buttonVariants({ variant: "outline", className: "min-h-11 border-amber-300" })}>Resolve review<ExternalLink /></Link>
                    ) : (
                      <Button variant={row.state === "no_package" ? "default" : "outline"} className={cn("min-h-11", row.state === "no_package" && "bg-accent text-accent-foreground hover:bg-accent-hover", row.state !== "no_package" && "border-accent-border")} disabled={!services.length || !canOpenEditor} onClick={() => openCoverageEditor(row)}>{row.state === "live_fixed" ? <Pencil /> : <DollarSign />}{details.action}</Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-heading text-lg font-semibold">Your fixed prices</h2><p className="mt-1 text-sm text-muted-foreground">Custom packages you can create, edit, pause, and publish here.</p></div>{sortedPackages.length > 0 && <Badge variant="outline" className="w-fit">{sortedPackages.length} {sortedPackages.length === 1 ? "package" : "packages"}</Badge>}</div>
        {sortedPackages.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-8 text-center sm:p-10">
            <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="text-lg font-medium">No custom fixed prices yet</h3>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Add a customer-facing fixed price, choose whether it starts live, and publish it in about a minute.</p>
            <p className="mx-auto mt-3 max-w-md rounded-lg border bg-muted/50 px-3 py-2.5 text-sm">Example: <span className="font-medium">Standard lawn mow · $55 · Weekly</span></p>
            <Button className="mt-5 min-h-11 bg-accent text-accent-foreground hover:bg-accent-hover" disabled={!services.length} onClick={() => newPackage()}><Plus />Add your first fixed price</Button>
          </div>
        ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sortedPackages.map((item) => {
            const advanced = item.tiers.length > 1;
            const validPrices = item.tiers.map((tier) => Number(tier.price)).filter((price) => Number.isFinite(price) && price > 0);
            const displayPrice = validPrices.length ? Math.min(...validPrices) : null;
            const live = isLiveFixedPackage(item);
            return (
              <article key={item.id} className={cn("rounded-xl border bg-card p-5 shadow-sm", live && "border-accent-border", item.needs_review && "border-amber-300/70")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.name}</h3><PackageStatus item={item} /><Badge variant="outline">{FREQUENCIES[item.default_frequency] ?? item.default_frequency}</Badge></div>
                    <p className="mt-1 text-xs text-muted-foreground">{services.find((service) => service.id === item.service_id)?.name ?? "Service"}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1"><PricingToggle checked={item.is_active} disabled={mutatingId === item.id} onCheckedChange={() => void togglePackage(item)} label={`${item.is_active ? "Pause" : "Publish"} ${item.name}`} /><span className="text-[10px] font-medium text-muted-foreground">{mutatingId === item.id ? "Updating…" : live ? "Live" : item.needs_review ? "Review blocked" : item.is_active ? "Invalid" : "Paused"}</span></div>
                </div>
                {item.pricing_mode === "fixed" && displayPrice !== null ? (
                  <div className="mt-4">
                    {!advanced ? <p className="flex items-center text-2xl font-semibold"><DollarSign className="h-5 w-5" />{formatPrice(displayPrice)}</p> : (
                      <div className="space-y-2"><p className="text-sm text-muted-foreground">From <span className="font-semibold text-foreground">${displayPrice}</span> · {item.tiers.length} price levels</p>{item.tiers.slice(0, 3).map((tier) => <div key={tier.id ?? tier.name} className="flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2"><div><p className="text-sm font-medium">{tier.name}</p>{(tier.rule_min != null || tier.rule_max != null) && <p className="text-xs text-muted-foreground">{tier.rule_min}–{tier.rule_max} {item.questions[0]?.unit ?? ""}</p>}</div><p className="text-sm font-semibold text-primary">${tier.price}</p></div>)}</div>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">{live ? "Available to public Pricing and Plan Builder flows." : "Saved privately until this package is published."}</p>
                  </div>
                ) : <div className="mt-4 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><p className="font-medium">A valid fixed price is required</p><p className="mt-1 text-xs opacity-80">Edit this package and add a customer price greater than $0 before publishing.</p></div>}
                {item.needs_review && <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>This package is flagged for pricing review. It remains in its current visibility state until the review workflow changes it.</span></div>}
                <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
                  <span className="text-xs text-muted-foreground">{live ? "Pause to remove this price from public booking." : item.needs_review ? "This package cannot become public until review is resolved." : item.is_active ? "This active record is excluded publicly until every tier is valid." : "Publish when the price is ready for customers."}</span>
                  <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" className="h-11 w-11" aria-label={`Duplicate ${item.name}`} onClick={() => openEditor({ ...structuredClone(item), id: "", name: `${item.name} (copy)`, is_active: false, needs_review: false })}><Copy /></Button>
                  <Button variant="ghost" className="h-11 w-11" aria-label={`Edit ${item.name}`} onClick={() => openEditor(item)}><Pencil /></Button>
                  <Button variant="ghost" className="h-11 w-11" disabled={mutatingId === item.id} aria-label={`Delete ${item.name}`} onClick={() => void deletePackage(item)}><Trash2 className="text-destructive" /></Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        )}
      </section>

      {managedPackages.length > 0 && <section className="space-y-3"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-heading text-lg font-semibold">Managed pricing</h2><p className="mt-1 text-sm text-muted-foreground">Template-backed packages use Mercurius tiers and price guardrails.</p></div><Link href="/vendor/pricing" className={buttonVariants({ variant: "outline" })}>Edit managed pricing</Link></div><div className="grid gap-3 md:grid-cols-2">{managedPackages.map((item) => <Link key={item.id} href="/vendor/pricing" className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-accent-border hover:bg-surface-hover"><span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", isLiveFixedPackage(item) ? "bg-accent-soft text-sage-dark" : "bg-muted text-muted-foreground")}><PackageCheck className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium">{item.name}</span><PackageStatus item={item} /></span><span className="mt-1 block text-xs text-muted-foreground">{services.find((service) => service.id === item.service_id)?.name ?? "Managed service pricing"}</span></span><ExternalLink className="h-4 w-4 text-muted-foreground" /></Link>)}</div></section>}

      <div className="flex flex-col gap-2 border-t pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><p>Need Mercurius-approved tiers and price guardrails?</p><Link href="/vendor/pricing" className={buttonVariants({ variant: "outline" })}>Open Managed Pricing</Link></div>

      <Dialog open={open} onOpenChange={(value) => { if (!value) closeEditor(); }}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto p-5 sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit fixed price" : "Add a fixed price"}</DialogTitle><DialogDescription>Set the real customer price, then publish now or save it privately until you are ready.</DialogDescription></DialogHeader>
          {editing && <div className="space-y-5">
            <div className="space-y-2"><Label htmlFor="package-service">Service</Label><select id="package-service" className={nativeSelect} value={editing.service_id} onChange={(event) => changeService(event.target.value)}><option value="" disabled>Choose a service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></div>
            {!advancedOpen && <div className="space-y-2"><Label htmlFor="package-price">Price customers pay ($)</Label><Input id="package-price" className="h-12 text-lg" type="number" min="0" step="1" inputMode="decimal" placeholder="e.g. 80" value={customerPrice} onChange={(event) => setCustomerPrice(event.target.value)} /><p className="text-xs text-muted-foreground">This provider-backed price is shown publicly and revalidated when a homeowner submits a request.</p>{editing.tiers.length > 1 && <p className="text-xs text-amber-700">You explicitly selected simple pricing. Saving will replace the existing size-based levels with this single price.</p>}</div>}
            <div className="space-y-2"><Label htmlFor="package-frequency">Cadence / frequency</Label><select id="package-frequency" className={nativeSelect} value={editing.default_frequency} onChange={(event) => isPricingFrequency(event.target.value) && changeFrequency(event.target.value)}>{frequenciesForService(services.find((service) => service.id === editing.service_id)).map((value) => <option key={value} value={value}>{FREQUENCIES[value]}</option>)}</select><p className="text-xs text-muted-foreground">Only cadences supported by this catalog service are shown.</p></div>
            <div className="rounded-lg border bg-muted/20">
              <button type="button" className="flex w-full items-center justify-between px-3 py-3 text-left text-sm hover:bg-muted/40" aria-expanded={nameEditorOpen} onClick={() => setNameEditorOpen((current) => !current)}><span><span className="font-medium">Customer-facing name</span><span className="mt-0.5 block text-xs text-muted-foreground">Optional — generated automatically from service and cadence.</span></span><ChevronDown className={cn("h-4 w-4 transition-transform", nameEditorOpen && "rotate-180")} /></button>
              {nameEditorOpen && <div className="space-y-2 border-t p-3"><Input id="package-name" className="h-11" placeholder="Standard lawn mow" value={editing.name} onChange={(event) => { setNameCustomized(true); updateField("name", event.target.value); }} />{nameCustomized && <Button type="button" variant="ghost" size="sm" onClick={() => { const service = services.find((candidate) => candidate.id === editing.service_id); setNameCustomized(false); updateField("name", packageName(service?.name ?? displayService(editing.service_id), editing.default_frequency)); }}>Use automatic name</Button>}</div>}
            </div>
            <div className="overflow-hidden rounded-lg border">
              <button type="button" onClick={() => advancedOpen ? switchToSimplePricing() : enterAdvanced()} className="flex w-full items-center justify-between bg-muted/30 px-3 py-3 text-left text-sm hover:bg-muted/50" aria-expanded={advancedOpen}><span><span className="font-medium">Price varies by home details</span><span className="mt-0.5 block text-xs text-muted-foreground">{advancedOpen ? "Advanced pricing is active. Switching back to one price requires confirmation." : "Optional — add a customer question and size-based levels."}</span></span><ChevronDown className={cn("transition-transform", advancedOpen && "rotate-180")} /></button>
              {advancedOpen && <div className="space-y-5 border-t p-3">
                <div className="space-y-3"><Label className="text-base">Ask the customer</Label>{editing.questions.slice(0, 1).map((question, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"><div className="space-y-1.5 sm:col-span-2"><Label className="text-xs text-muted-foreground">Question</Label><Input placeholder="How many bedrooms?" value={question.question_label} onChange={(event) => { const next = [...editing.questions]; const key = slugKey(event.target.value); next[index] = { ...next[index], question_label: event.target.value, question_key: key }; updateField("questions", next); updateField("tiers", editing.tiers.map((tier) => ({ ...tier, rule_question_key: key }))); }} /></div><div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Unit (optional)</Label><Input placeholder="bedrooms, sq ft…" value={question.unit ?? ""} onChange={(event) => { const next = [...editing.questions]; next[index] = { ...next[index], unit: event.target.value }; updateField("questions", next); }} /></div></div>)}</div>
                <div className="space-y-3"><div className="flex items-center justify-between"><Label className="text-base">Price levels</Label><Button type="button" variant="outline" size="sm" onClick={() => updateField("tiers", [...editing.tiers, { name: `Level ${editing.tiers.length + 1}`, price: 0, rule_question_key: editing.questions[0]?.question_key ?? "size", rule_min: 0, rule_max: 100, includes: [], sort_order: editing.tiers.length }])}><Plus />Add level</Button></div>
                  {editing.tiers.map((tier, index) => <div key={index} className="space-y-3 rounded-lg border p-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="Level name"><Input className="h-11" placeholder="e.g. 3–4 bedrooms" value={tier.name} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], name: event.target.value }; updateField("tiers", next); }} /></Field><Field label="Price $"><Input className="h-11" type="number" min="0" value={tier.price || ""} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], price: Number(event.target.value) }; updateField("tiers", next); }} /></Field><Field label="From"><Input className="h-11" type="number" value={tier.rule_min ?? ""} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], rule_min: event.target.value ? Number(event.target.value) : null }; updateField("tiers", next); }} /></Field><Field label="To"><Input className="h-11" type="number" value={tier.rule_max ?? ""} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], rule_max: event.target.value ? Number(event.target.value) : null }; updateField("tiers", next); }} /></Field></div><div className="flex items-end gap-2"><Field label="What’s included (optional)" className="flex-1"><Input className="h-11" placeholder="Mow, edge, blow" value={tier.includes.join(", ")} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], includes: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) }; updateField("tiers", next); }} /></Field><Button type="button" variant="ghost" className="h-11 w-11" aria-label={`Remove ${tier.name || "level"}`} onClick={() => updateField("tiers", editing.tiers.filter((_, tierIndex) => tierIndex !== index))}><Trash2 className="text-destructive" /></Button></div></div>)}
                </div>
              </div>}
            </div>
            <div className={cn("flex items-start gap-3 rounded-xl border p-3.5", editing.is_active ? "border-accent-border bg-accent-subtle" : "border-border bg-muted/30")}><span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", editing.is_active ? "bg-accent-soft text-sage-dark" : "bg-muted text-muted-foreground")}>{editing.is_active ? <PackageCheck className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{editing.is_active ? "Publish now" : "Save as draft"}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{editing.is_active ? "After a successful save, this validated price can appear in public pricing and request flows." : "The package remains private until you publish it."}</p></div><PricingToggle checked={editing.is_active} onCheckedChange={(checked) => updateField("is_active", checked)} label={editing.is_active ? "Save this package as a private draft" : "Publish this package when saved"} /></div>
          </div>}
          <DialogFooter className="sm:grid sm:grid-cols-[auto_1fr_1fr]"><Button variant="ghost" className="min-h-11" disabled={saving} onClick={closeEditor}>Cancel</Button><Button variant="outline" className="min-h-11" disabled={saving} onClick={() => void savePackage(true)}>{saving ? <Loader2 className="animate-spin" /> : <Plus />}{editing?.is_active ? "Publish & add next" : "Save draft & add next"}</Button><Button className={cn("min-h-11", editing?.is_active && "bg-accent text-accent-foreground hover:bg-accent-hover")} disabled={saving} onClick={() => void savePackage(false)}>{saving ? <><Loader2 className="animate-spin" />Saving…</> : editing?.is_active ? <><PackageCheck />Publish & finish</> : <><PauseCircle />Save draft & finish</>}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={liveSuccessOpen} onOpenChange={setLiveSuccessOpen}><DialogContent className="max-w-md sm:max-w-md"><DialogHeader><div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15"><CheckCircle2 className="h-6 w-6 text-accent" /></div><DialogTitle className="text-center text-xl">Your price is live</DialogTitle><DialogDescription className="text-center">Customers can now see this fixed price in Mercurius pricing and use it while requesting service.</DialogDescription></DialogHeader><div className="flex flex-col gap-2 pt-2">{contractorId && <Link href={`/providers/${contractorId}`} className={buttonVariants({ className: "min-h-11 w-full" })} onClick={() => setLiveSuccessOpen(false)}><ExternalLink />View public storefront</Link>}<Button variant="outline" className="min-h-11 w-full" onClick={() => { setLiveSuccessOpen(false); newPackage(); }}><Plus />Add another price</Button></div></DialogContent></Dialog>
    </div>
  );
}

async function replacePackageChildren(
  supabase: ReturnType<typeof createClient>,
  packageId: string,
  questions: QuestionRow[],
  tiers: TierRow[],
) {
  const clearQuestions = await supabase.from("package_qualifying_questions").delete().eq("package_id", packageId);
  if (clearQuestions.error) throw clearQuestions.error;
  const clearTiers = await supabase.from("package_tiers").delete().eq("package_id", packageId);
  if (clearTiers.error) throw clearTiers.error;
  if (questions.length) {
    const result = await supabase.from("package_qualifying_questions").insert(questions.map((question) => ({
      package_id: packageId,
      question_key: question.question_key,
      question_label: question.question_label,
      input_type: question.input_type,
      unit: question.unit || null,
      options: question.options ?? null,
      sort_order: question.sort_order,
    })));
    if (result.error) throw result.error;
  }
  const tierResult = await supabase.from("package_tiers").insert(tiers.map((tier) => ({
    package_id: packageId,
    name: tier.name,
    price: tier.price,
    rule_question_key: tier.rule_question_key || null,
    rule_min: tier.rule_min ?? null,
    rule_max: tier.rule_max ?? null,
    includes: tier.includes,
    sort_order: tier.sort_order,
  })));
  if (tierResult.error) throw tierResult.error;
}

async function restorePackageSnapshot(
  supabase: ReturnType<typeof createClient>,
  contractorId: string,
  snapshot: PackageRow,
) {
  try {
    const paused = await supabase.from("vendor_packages").update({ is_active: false }).eq("id", snapshot.id).eq("contractor_id", contractorId);
    if (paused.error) throw paused.error;
    await replacePackageChildren(supabase, snapshot.id, snapshot.questions, snapshot.tiers);
    const restored = await supabase.from("vendor_packages").update({
      name: snapshot.name,
      description: snapshot.description,
      service_id: snapshot.service_id,
      pricing_mode: snapshot.pricing_mode,
      default_frequency: snapshot.default_frequency,
      deposit_amount: snapshot.deposit_amount,
      needs_review: snapshot.needs_review,
      is_active: snapshot.is_active,
    }).eq("id", snapshot.id).eq("contractor_id", contractorId);
    if (restored.error) throw restored.error;
    return true;
  } catch {
    await supabase.from("vendor_packages").update({ is_active: false }).eq("id", snapshot.id).eq("contractor_id", contractorId);
    return false;
  }
}

function validateTierRanges(tiers: TierRow[]) {
  const ranged = tiers.filter((tier) => tier.rule_min != null || tier.rule_max != null);
  for (const tier of ranged) {
    if (tier.rule_min == null || tier.rule_max == null) return `${tier.name || "Each level"} needs both a From and To value.`;
    if (!Number.isFinite(tier.rule_min) || !Number.isFinite(tier.rule_max)) return `${tier.name || "Each level"} needs valid numeric boundaries.`;
    if (tier.rule_min > tier.rule_max) return `${tier.name || "A price level"} cannot start above its ending value.`;
  }
  const ordered = [...ranged].sort((left, right) => Number(left.rule_min) - Number(right.rule_min));
  for (let index = 1; index < ordered.length; index += 1) {
    if (Number(ordered[index].rule_min) <= Number(ordered[index - 1].rule_max)) return `${ordered[index - 1].name} and ${ordered[index].name} have overlapping ranges.`;
  }
  return null;
}

function frequenciesForService(service?: ServiceOption): PricingFrequency[] {
  const all = Object.keys(FREQUENCIES) as PricingFrequency[];
  if (!service) return ["one-time"];
  const supported = service.available_frequencies?.filter(isPricingFrequency) ?? [];
  return supported.length ? supported : [...new Set([service.default_frequency, ...all])];
}

function defaultFrequencyForService(service: ServiceOption): PricingFrequency {
  const supported = frequenciesForService(service);
  return supported.includes(service.default_frequency) ? service.default_frequency : supported[0] ?? "one-time";
}

function packageName(serviceName: string, frequency: PricingFrequency) {
  return `${serviceName} · ${FREQUENCIES[frequency]}`;
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <div className={cn("space-y-1.5", className)}><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}

function SummaryCard({ icon: Icon, label, value, note, tone }: { icon: typeof Package; label: string; value: React.ReactNode; note: string; tone?: "live" | "review" }) {
  return <div className={cn("rounded-xl border bg-card p-4", tone === "live" && "border-accent-border bg-accent-subtle", tone === "review" && "border-amber-300/70 bg-amber-50 dark:bg-amber-950/30")}><div className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className={cn("h-4 w-4", tone === "live" && "text-sage-dark", tone === "review" && "text-amber-700 dark:text-amber-300")} />{label}</div><p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p></div>;
}

function coverageStateRank(state: CoverageState) {
  return ({ no_package: 0, paused_valid: 1, draft: 2, needs_review: 3, quote_only: 4, live_fixed: 5 } satisfies Record<CoverageState, number>)[state];
}

function coverageDetails(row: ServiceCoverage) {
  switch (row.state) {
    case "live_fixed":
      return { action: "Manage price", description: "An active, review-cleared fixed price covers this service and can appear in public booking flows." };
    case "needs_review":
      return { action: "Resolve review", description: "A package is flagged for review and cannot count as public fixed-price coverage until Mercurius clears it." };
    case "paused_valid":
      return { action: "Review & publish", description: "A complete fixed price already exists but is paused. Review it, then publish when it is ready for customers." };
    case "draft":
      return { action: "Finish draft", description: "A fixed-price draft already exists but is incomplete or private. Resume it instead of creating a duplicate." };
    case "quote_only":
      return {
        action: "Add fixed price",
        description: row.package?.is_active
          ? "This service is available through quote or matching only. Add a fixed price to enable the faster live-price path."
          : "A quote-based package exists but is not active. Add a fixed price if this service should support direct live-price requests.",
      };
    case "no_package":
      return { action: "Set price", description: "No package currently covers this profile service. Start the fast path with the matching service preselected." };
  }
}

function CoverageBadge({ state }: { state: CoverageState }) {
  if (state === "live_fixed") return <Badge className="border border-accent-border bg-accent-soft text-sage-dark"><CheckCircle2 />Live fixed price</Badge>;
  if (state === "needs_review") return <Badge className="border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle />Needs review</Badge>;
  if (state === "paused_valid") return <Badge variant="outline"><PauseCircle />Paused · ready</Badge>;
  if (state === "draft") return <Badge variant="outline">Draft exists</Badge>;
  if (state === "quote_only") return <Badge variant="outline">Quote only</Badge>;
  return <Badge variant="outline">No package</Badge>;
}

function PackageStatus({ item }: { item: PackageRow }) {
  const status = isLiveFixedPackage(item)
    ? <Badge className="border border-accent-border bg-accent-soft text-sage-dark"><CheckCircle2 />Live / Active</Badge>
    : !item.is_active
      ? <Badge variant="outline"><PauseCircle />Draft / Paused</Badge>
      : item.needs_review
        ? <Badge className="border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle />Review blocked</Badge>
      : item.pricing_mode !== "fixed"
        ? <Badge variant="outline">Quote / Matching</Badge>
        : <Badge className="border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle />Needs valid price</Badge>;
  return <>{status}</>;
}

function isLiveFixedPackage(item: PackageRow) {
  return isPubliclyEligibleFixedPackage(item);
}

function displayService(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value);
}
