"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
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
  Tag,
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
  evaluateCustomPackageFrequencyPriceReviews,
  hasValidFixedTiers,
  isPricingFrequency,
  isPubliclyEligibleFixedPackage,
  isPubliclyEligibleQuotePackage,
  MAX_PROMOTION_PERCENT,
  promotionForPackage,
  promotionStatus,
  resolveEffectiveTierPrice,
  tierPricingFrequency,
  validatePromotion,
  type PackagePromotion,
  type PackageQualifyingQuestion,
  type PricingFrequency,
  type PromotionType,
} from "@/lib/vendorPricing";

type ServiceOption = {
  id: string;
  name: string;
  default_frequency: PricingFrequency;
  available_frequencies: PricingFrequency[] | null;
  weekly_price: number | null;
  monthly_price: number | null;
  one_time_price: number | null;
};
type TemplatePriceGuidance = { minPrice: number; maxPrice: number };
type PricingMode = "fixed" | "deposit_quote" | "custom_quote";
type QuestionRow = PackageQualifyingQuestion;
type TierRow = {
  id?: string;
  name: string;
  price: number;
  frequency: PricingFrequency;
  rule_question_key?: string | null;
  rule_min?: number | null;
  rule_max?: number | null;
  includes: string[];
  sort_order: number;
};
type AddonRow = {
  id?: string;
  template_addon_id?: string | null;
  name: string;
  description: string | null;
  price: number;
  is_offered: boolean;
  sort_order: number;
};
type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  service_id: string;
  pricing_mode: PricingMode;
  default_frequency: PricingFrequency;
  deposit_amount: number | null;
  is_active: boolean;
  needs_review: boolean;
  template_id: string | null;
  tiers: TierRow[];
  questions: QuestionRow[];
  addons: AddonRow[];
  promotions: PackagePromotion[];
};

type PromotionDraft = {
  promotion_type: PromotionType;
  percent_off: string;
  fixed_price: string;
  label: string;
  starts_at: string;
  ends_at: string;
  is_enabled: boolean;
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

const PRICING_MODES: Record<PricingMode, { label: string; description: string }> = {
  fixed: {
    label: "Fixed price",
    description: "Customers see a live price and can move directly toward booking after confirming their details.",
  },
  deposit_quote: {
    label: "Quote required + deposit",
    description: "Mercurius confirms the scope and final price first. A saved deposit may apply only after booking details are approved.",
  },
  custom_quote: {
    label: "Custom quote required",
    description: "Customers submit the job details, then you and Mercurius coordinate the scope and price before booking is confirmed.",
  },
};

const nativeSelect = "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const slugKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "size";
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function VendorPackagesManager() {
  const { user } = useAuth();
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [profileServices, setProfileServices] = useState<string[]>([]);
  const [templateGuidance, setTemplateGuidance] = useState<
    Record<string, TemplatePriceGuidance>
  >({});
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
  const [frequencyPrices, setFrequencyPrices] = useState<Partial<Record<PricingFrequency, string>>>({});
  const [saving, setSaving] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [liveSuccessOpen, setLiveSuccessOpen] = useState(false);
  const [serverNow, setServerNow] = useState<string | null>(null);
  const [promotionBackendReady, setPromotionBackendReady] = useState(true);
  const [promotionPackage, setPromotionPackage] = useState<PackageRow | null>(null);
  const [promotionDraft, setPromotionDraft] = useState<PromotionDraft | null>(null);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [promotionSaving, setPromotionSaving] = useState(false);
  const [copySource, setCopySource] = useState<PackageRow | null>(null);
  const [copyTargetServiceId, setCopyTargetServiceId] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);

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
    const [questionsResult, tiersResult, addonsResult, promotionsResult, clockResult] = await Promise.all([
      supabase.from("package_qualifying_questions").select("*").in("package_id", ids).order("sort_order"),
      supabase.from("package_tiers").select("*").in("package_id", ids).order("sort_order"),
      supabase.from("package_addons").select("*").in("package_id", ids).order("created_at"),
      supabase.from("package_promotions").select("id, package_id, promotion_type, percent_off, fixed_price, label, starts_at, ends_at, is_enabled, created_at, updated_at").in("package_id", ids).order("updated_at", { ascending: false }),
      supabase.rpc("pricing_server_now"),
    ]);
    if (questionsResult.error) throw questionsResult.error;
    if (tiersResult.error) throw tiersResult.error;
    if (addonsResult.error) throw addonsResult.error;
    const promotionReady = !promotionsResult.error && !clockResult.error && typeof clockResult.data === "string";
    setPromotionBackendReady(promotionReady);
    setServerNow(promotionReady ? clockResult.data as string : null);
    const questions = (questionsResult.data ?? []) as (QuestionRow & { package_id: string })[];
    const tiers = (tiersResult.data ?? []) as (TierRow & { package_id: string })[];
    const addons = (addonsResult.data ?? []) as (AddonRow & { package_id: string })[];
    const promotions = promotionReady ? (promotionsResult.data ?? []) as PackagePromotion[] : [];
    const hydrated = rows.map((item) => ({
      ...item,
      questions: questions.filter((question) => question.package_id === item.id),
      tiers: tiers
        .filter((tier) => tier.package_id === item.id)
        .map((tier) => ({
          ...tier,
          frequency: tierPricingFrequency(tier, item.default_frequency),
        })),
      addons: addons
        .filter((addon) => addon.package_id === item.id && addon.template_addon_id == null && addon.name?.trim())
        .map((addon, index) => ({
          ...addon,
          description: addon.description?.trim() || null,
          price: Number(addon.price),
          is_offered: addon.is_offered !== false,
          sort_order: Number.isFinite(Number(addon.sort_order)) ? Number(addon.sort_order) : index,
        }))
        .sort((left, right) => left.sort_order - right.sort_order),
      promotions: promotions.filter((promotion) => promotion.package_id === item.id),
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
      const [contractorResult, serviceResult, templateResult] = await Promise.all([
        supabase.from("contractors").select("id, services").eq("user_id", user.id).maybeSingle(),
        supabase.from("services_catalog").select("id, name, default_frequency, available_frequencies, weekly_price, monthly_price, one_time_price").eq("is_active", true).order("name"),
        supabase.from("pricing_templates").select("id, service_id").eq("is_active", true),
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
      if (!templateResult.error) {
        const templates = (templateResult.data ?? []) as {
          id: string;
          service_id: string;
        }[];
        const templateIds = templates.map((template) => template.id);
        const tierResult = templateIds.length
          ? await supabase
              .from("pricing_template_tiers")
              .select("template_id, min_price, max_price")
              .in("template_id", templateIds)
          : { data: [], error: null };
        if (!active) return;
        if (!tierResult.error) {
          const serviceByTemplate = new Map(
            templates.map((template) => [template.id, template.service_id]),
          );
          const guidance: Record<string, TemplatePriceGuidance> = {};
          (
            (tierResult.data ?? []) as {
              template_id: string;
              min_price: number;
              max_price: number;
            }[]
          ).forEach((tier) => {
            const serviceId = serviceByTemplate.get(tier.template_id);
            const minPrice = Number(tier.min_price);
            const maxPrice = Number(tier.max_price);
            if (
              !serviceId ||
              !Number.isFinite(minPrice) ||
              !Number.isFinite(maxPrice) ||
              minPrice <= 0 ||
              maxPrice < minPrice
            ) {
              return;
            }
            const current = guidance[serviceId];
            guidance[serviceId] = {
              minPrice: current
                ? Math.min(current.minPrice, minPrice)
                : minPrice,
              maxPrice: current
                ? Math.max(current.maxPrice, maxPrice)
                : maxPrice,
            };
          });
          setTemplateGuidance(guidance);
        }
      }
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

  useEffect(() => {
    if (!contractorId) return;
    const clockRefresh = window.setInterval(() => { void refresh(contractorId); }, 60_000);
    return () => window.clearInterval(clockRefresh);
  }, [contractorId, refresh]);

  const closeEditor = () => {
    setOpen(false);
    setEditing(null);
    setOriginalPackage(null);
    setAdvancedOpen(false);
    setNameEditorOpen(false);
    setNameCustomized(false);
    setCustomerPrice("");
    setFrequencyPrices({});
    setSaving(false);
  };

  const openEditor = (item: PackageRow) => {
    const normalizedTiers = item.tiers.map((tier) => ({
      ...tier,
      frequency: tierPricingFrequency(tier, item.default_frequency),
    }));
    const defaultTiers = normalizedTiers.filter((tier) => tier.frequency === item.default_frequency);
    const minimum = defaultTiers.length
      ? Math.min(...defaultTiers.map((tier) => Number(tier.price) || 0))
      : normalizedTiers.length
        ? Math.min(...normalizedTiers.map((tier) => Number(tier.price) || 0))
        : 0;
    const isAdvanced = isAdvancedTierStructure(normalizedTiers, item.questions);
    const automaticName = packageName(services.find((service) => service.id === item.service_id)?.name ?? displayService(item.service_id), item.default_frequency);
    setEditing(structuredClone({ ...item, tiers: normalizedTiers }));
    setOriginalPackage(item.id ? structuredClone(item) : null);
    setCustomerPrice(minimum > 0 ? String(minimum) : "");
    setFrequencyPrices(isAdvanced
      ? { [item.default_frequency]: minimum > 0 ? String(minimum) : "" }
      : simpleFrequencyPriceDraft(normalizedTiers, item.default_frequency));
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
      addons: [],
      promotions: [],
    });
  };

  const openCopyDialog = (item: PackageRow) => {
    setCopySource(structuredClone(item));
    setCopyTargetServiceId("");
    setCopyOpen(true);
  };

  const closeCopyDialog = () => {
    setCopyOpen(false);
    setCopySource(null);
    setCopyTargetServiceId("");
  };

  const continuePackageCopy = () => {
    if (!copySource) return;
    const targetService = services.find((service) => service.id === copyTargetServiceId);
    if (!targetService) {
      toast.error("Choose the service that should receive this package setup.");
      return;
    }

    const supportedFrequencies = frequenciesForService(targetService);
    const frequency = supportedFrequencies.includes(copySource.default_frequency)
      ? copySource.default_frequency
      : defaultFrequencyForService(targetService);
    const isFixed = copySource.pricing_mode === "fixed";

    const sourceTiers = copySource.tiers.map((tier) => ({
      ...tier,
      frequency: tierPricingFrequency(tier, copySource.default_frequency),
    }));
    const sourceAdvanced = isAdvancedTierStructure(sourceTiers, copySource.questions);
    const supportedSourceTiers = sourceTiers.filter((tier) => supportedFrequencies.includes(tier.frequency));
    const copiedTiers = supportedSourceTiers.length
      ? supportedSourceTiers
      : sourceTiers.map((tier) => ({ ...tier, frequency }));
    const draftFrequency = sourceAdvanced
      ? frequency
      : copiedTiers.some((tier) => tier.frequency === frequency)
        ? frequency
        : copiedTiers[0]?.frequency ?? frequency;

    const draft: PackageRow = {
      id: "",
      name: packageName(targetService.name, draftFrequency),
      description: copySource.description,
      service_id: targetService.id,
      pricing_mode: copySource.pricing_mode,
      default_frequency: draftFrequency,
      deposit_amount: copySource.pricing_mode === "deposit_quote"
        ? copySource.deposit_amount
        : null,
      // A copied package always starts private. Publishing remains an explicit
      // choice in the editor and re-runs the target service price guardrail.
      is_active: false,
      needs_review: false,
      template_id: null,
      questions: copySource.questions.map((question, index) => ({
            question_key: question.question_key,
            question_label: question.question_label,
            input_type: question.input_type,
            unit: question.unit ?? null,
            options: question.options,
            is_required: question.is_required !== false,
            sort_order: index,
          })),
      tiers: isFixed
        ? copiedTiers.map((tier, index) => ({
            name: tier.name,
            price: Number(tier.price),
            frequency: sourceAdvanced ? draftFrequency : tier.frequency,
            rule_question_key: tier.rule_question_key ?? null,
            rule_min: tier.rule_min ?? null,
            rule_max: tier.rule_max ?? null,
            includes: [...(tier.includes ?? [])],
            sort_order: index,
          }))
        : [],
      addons: copySource.addons.map((addon, index) => ({
        template_addon_id: null,
        name: addon.name,
        description: addon.description,
        price: Number(addon.price),
        is_offered: addon.is_offered,
        sort_order: index,
      })),
      // Promotions are scheduled package-specific overlays and are never copied.
      promotions: [],
    };

    closeCopyDialog();
    openEditor(draft);
    toast.info("Package settings copied into a private draft", {
      description: "Review the target service and pricing before you save or publish. Existing packages were not changed.",
    });
  };

  const updateField = <K extends keyof PackageRow>(key: K, value: PackageRow[K]) => {
    setEditing((current) => current ? { ...current, [key]: value } : current);
  };

  const changeService = (serviceId: string) => {
    const service = services.find((candidate) => candidate.id === serviceId);
    if (!service) return;
    const changingExistingService = Boolean(editing?.service_id && editing.service_id !== serviceId);
    const hasEnteredPricing = Boolean(customerPrice || editing?.deposit_amount || editing?.tiers.length || editing?.questions.length);
    if (changingExistingService && hasEnteredPricing && !window.confirm("Change this package’s service? Existing prices and advanced questions will be cleared so they are not carried to a different service.")) return;
    const frequency = frequenciesForService(service).includes(editing?.default_frequency ?? "one-time")
      ? editing?.default_frequency ?? defaultFrequencyForService(service)
      : defaultFrequencyForService(service);
    setEditing((current) => current ? {
      ...current,
      service_id: service.id,
      default_frequency: frequency,
      name: nameCustomized ? current.name : packageName(service.name, frequency),
      deposit_amount: changingExistingService ? null : current.deposit_amount,
      tiers: changingExistingService ? [] : current.tiers,
      questions: changingExistingService ? [] : current.questions,
    } : current);
    setCustomerPrice("");
    if (changingExistingService) setFrequencyPrices({ [frequency]: "" });
    if (changingExistingService) setAdvancedOpen(false);
  };

  const changeFrequency = (frequency: PricingFrequency) => {
    const service = services.find((candidate) => candidate.id === editing?.service_id);
    setEditing((current) => current ? {
      ...current,
      default_frequency: frequency,
      name: nameCustomized ? current.name : packageName(service?.name ?? displayService(current.service_id), frequency),
    } : current);
    setCustomerPrice(frequencyPrices[frequency] ?? "");
  };

  const updateFrequencyPrice = (frequency: PricingFrequency, value: string) => {
    setFrequencyPrices((current) => ({ ...current, [frequency]: value }));
    if (editing?.default_frequency === frequency) setCustomerPrice(value);
  };

  const toggleFrequency = (frequency: PricingFrequency, enabled: boolean) => {
    if (!editing) return;
    if (enabled) {
      setFrequencyPrices((current) => ({ ...current, [frequency]: current[frequency] ?? "" }));
      return;
    }
    const enabledFrequencies = Object.keys(frequencyPrices).filter(isPricingFrequency);
    if (enabledFrequencies.length <= 1) {
      toast.error("Keep at least one cadence enabled.");
      return;
    }
    const next = { ...frequencyPrices };
    delete next[frequency];
    setFrequencyPrices(next);
    if (editing.default_frequency === frequency) {
      const nextDefault = Object.keys(next).find(isPricingFrequency) ?? "one-time";
      changeFrequency(nextDefault);
    }
  };

  const changePricingMode = (pricingMode: PricingMode) => {
    setEditing((current) => current ? {
      ...current,
      pricing_mode: pricingMode,
      deposit_amount: pricingMode === "deposit_quote" ? current.deposit_amount : null,
      needs_review: pricingMode === "fixed" ? current.needs_review : false,
    } : current);
    if (pricingMode === "fixed") {
      const hasAdvancedStructure = editing
        ? isAdvancedTierStructure(editing.tiers, editing.questions)
        : false;
      setAdvancedOpen(hasAdvancedStructure);
      if (!hasAdvancedStructure && editing?.tiers[0]?.price) setCustomerPrice(String(editing.tiers[0].price));
    } else {
      setAdvancedOpen(false);
    }
  };

  const enterAdvanced = () => {
    const enabledFrequencies = Object.keys(frequencyPrices).filter(isPricingFrequency);
    if (enabledFrequencies.length > 1) {
      if (!window.confirm("Home-detail pricing currently supports one cadence per package. Continue with the primary cadence and remove the other cadence prices from this draft?")) return;
      const primary = editing?.default_frequency ?? enabledFrequencies[0];
      setFrequencyPrices({ [primary]: frequencyPrices[primary] ?? "" });
    }
    setAdvancedOpen(true);
    setEditing((current) => {
      if (!current || isAdvancedTierStructure(current.tiers, current.questions)) return current;
      const price = Number(customerPrice) || current.tiers[0]?.price || 0;
      const questionKey = uniqueQuestionKey("size", current.questions);
      return {
        ...current,
        questions: [{ question_key: questionKey, question_label: "", input_type: "number", unit: "", is_required: true, sort_order: 0 }, ...current.questions.map((question, index) => ({ ...question, sort_order: index + 1 }))],
        tiers: [{ name: "Standard", price, frequency: current.default_frequency, rule_question_key: questionKey, rule_min: 0, rule_max: 100, includes: [], sort_order: 0 }],
      };
    });
  };

  const switchToSimplePricing = () => {
    if (!editing) return;
    const priceKey = pricingQuestionKey(editing.tiers);
    const hasAdvancedStructure = isAdvancedTierStructure(editing.tiers, editing.questions);
    if (hasAdvancedStructure && !window.confirm("Switch to simple pricing? Publishing this change will replace the price levels with cadence prices. Additional service questions will be kept.")) return;
    const minimum = editing.tiers.map((tier) => Number(tier.price)).filter((price) => Number.isFinite(price) && price > 0).sort((a, b) => a - b)[0];
    setCustomerPrice(minimum ? String(minimum) : "");
    setFrequencyPrices({ [editing.default_frequency]: minimum ? String(minimum) : "" });
    updateField("questions", editing.questions.filter((question) => question.question_key !== priceKey).map((question, index) => ({ ...question, sort_order: index })));
    setAdvancedOpen(false);
  };

  const savePackage = async (continueAdding: boolean) => {
    if (!editing || !contractorId || saving) return;
    const name = editing.name.trim();
    if (!name || !editing.service_id) {
      toast.error("Name and service are required.");
      return;
    }
    if (editing.questions.length > 10) {
      toast.error("Keep this package to 10 service questions or fewer.");
      return;
    }
    if (editing.questions.some((question) => !question.question_label.trim() || question.question_label.trim().length > 180)) {
      toast.error("Check the service questions", { description: "Each question needs clear text of 180 characters or fewer." });
      return;
    }
    const normalizedQuestionResult = normalizeQuestionRows(editing.questions);
    const isFixedMode = editing.pricing_mode === "fixed";
    let questions: QuestionRow[] = [];
    let tiers: TierRow[] = [];
    let savedDefaultFrequency = editing.default_frequency;
    if (!isFixedMode) {
      questions = normalizedQuestionResult.questions;
      tiers = [];
      if (editing.pricing_mode === "deposit_quote") {
        const deposit = Number(editing.deposit_amount);
        if (!Number.isFinite(deposit) || deposit <= 0) {
          toast.error("Enter a deposit greater than $0.", {
            description: "This amount is saved with the quote package but is not charged when a homeowner submits a request.",
          });
          return;
        }
      }
    } else if (advancedOpen) {
      if (!editing.tiers.length || editing.tiers.some((tier) => !tier.name.trim() || tier.price <= 0)) {
        toast.error("Every price level needs a name and a price greater than $0.");
        return;
      }
      const currentPriceQuestionKey = pricingQuestionKey(editing.tiers);
      const question = editing.questions.find((candidate) => candidate.question_key === currentPriceQuestionKey);
      if (!question?.question_label.trim()) {
        toast.error("Add the customer question used to choose a price level.");
        return;
      }
      const normalizedPriceKey = normalizedQuestionResult.keyMap.get(question.question_key);
      if (!normalizedPriceKey) {
        toast.error("The price-level question could not be saved.");
        return;
      }
      questions = normalizedQuestionResult.questions.map((candidate) => candidate.question_key === normalizedPriceKey
        ? { ...candidate, input_type: "number", is_required: true }
        : candidate,
      );
      tiers = editing.tiers.map((tier, index) => ({
        ...tier,
        frequency: editing.default_frequency,
        rule_question_key: normalizedPriceKey,
        sort_order: index,
      }));
      const rangeError = validateTierRanges(tiers);
      if (rangeError) {
        toast.error("Check the price-level ranges", { description: rangeError });
        return;
      }
    } else {
      const oldPriceKey = pricingQuestionKey(editing.tiers);
      questions = normalizeQuestionRows(editing.questions.filter((question) => question.question_key !== oldPriceKey)).questions;
      const supported = frequenciesForService(services.find((service) => service.id === editing.service_id));
      const enabled = supported.filter((frequency) => Object.hasOwn(frequencyPrices, frequency));
      if (!enabled.length) {
        toast.error("Enable at least one cadence.");
        return;
      }
      const invalidFrequency = enabled.find((frequency) => {
        const price = Number(frequencyPrices[frequency]);
        return !Number.isFinite(price) || price <= 0;
      });
      if (invalidFrequency) {
        toast.error(`Enter a ${FREQUENCIES[invalidFrequency].toLowerCase()} price greater than $0.`);
        return;
      }
      savedDefaultFrequency = enabled.includes(editing.default_frequency)
        ? editing.default_frequency
        : enabled[0];
      tiers = enabled.map((frequency, index) => {
        const existingSimpleTier = editing.tiers.find((tier) =>
          tierPricingFrequency(tier, editing.default_frequency) === frequency,
        );
        return {
          name: existingSimpleTier?.name.trim() || FREQUENCIES[frequency],
          price: Number(frequencyPrices[frequency]),
          frequency,
          rule_question_key: null,
          rule_min: null,
          rule_max: null,
          includes: [...(existingSimpleTier?.includes ?? [])],
          sort_order: index,
        };
      });
    }

    if (editing.addons.length > 10) {
      toast.error("Keep this package to 10 add-ons or fewer.");
      return;
    }
    const addons = editing.addons.map((addon, index) => ({
      ...addon,
      name: addon.name.trim(),
      description: addon.description?.trim() || null,
      price: Number(addon.price),
      is_offered: true,
      sort_order: index,
    }));
    const invalidAddon = addons.find((addon) =>
      !addon.name
      || addon.name.length > 80
      || !Number.isFinite(addon.price)
      || addon.price <= 0
      || (addon.description?.length ?? 0) > 160,
    );
    if (invalidAddon) {
      toast.error("Check the optional add-ons", {
        description: "Each add-on needs a name of 80 characters or fewer and a price greater than $0. Descriptions can be up to 160 characters.",
      });
      return;
    }

    const selectedService = services.find((service) => service.id === editing.service_id);
    const priceReviews = isFixedMode
      ? evaluateCustomPackageFrequencyPriceReviews({
          tiers,
          defaultFrequency: savedDefaultFrequency,
          catalog: selectedService,
          templateRange: templateGuidance[editing.service_id] ?? null,
        })
      : [];
    const needsReview = priceReviews.some((review) => review.needsReview);

    if (isFixedMode && editing.is_active && !needsReview && !isPubliclyEligibleFixedPackage({
      ...editing,
      needs_review: false,
      pricing_mode: "fixed",
      tiers,
    })) {
      toast.error("This package is not ready to publish", {
        description: "Every saved price level must have a price greater than $0.",
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
      pricing_mode: editing.pricing_mode,
      default_frequency: savedDefaultFrequency,
      deposit_amount: editing.pricing_mode === "deposit_quote" ? Number(editing.deposit_amount) : null,
      is_active: false,
      needs_review: needsReview,
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
      await replaceCustomPackageAddons(supabase, packageId, addons);
      const publishResult = await supabase.from("vendor_packages").update({ is_active: editing.is_active, needs_review: needsReview }).eq("id", packageId).eq("contractor_id", contractorId);
      if (publishResult.error) throw publishResult.error;
      const live = editing.is_active && !needsReview;
      closeEditor();
      await refresh(contractorId);
      if (needsReview) {
        const flaggedCadences = priceReviews
          .filter((review) => review.needsReview)
          .map((review) => FREQUENCIES[review.frequency])
          .join(", ");
        toast.warning("Saved for pricing review", {
          description: `This package is hidden from public pricing because ${flaggedCadences || "one or more cadences"} falls outside the expected range. Adjust the price or contact Mercurius for review.`,
        });
        if (continueAdding && nextCoverage) openCoverageEditor(nextCoverage);
      } else if (continueAdding && nextCoverage) {
        toast.success(live ? isFixedMode ? "Price published" : "Quote package published" : "Draft saved", { description: "The next unpriced service is ready." });
        openCoverageEditor(nextCoverage);
      } else if (continueAdding) {
        toast.success(live ? isFixedMode ? "Price published" : "Quote package published" : "Draft saved", { description: "There are no other unpriced profile services in this session." });
      } else if (live && isFixedMode) {
        setLiveSuccessOpen(true);
      } else if (live) {
        toast.success("Quote package published", { description: "Homeowners will see that matching and a confirmed quote are required before booking." });
      } else {
        toast.success("Saved as draft", { description: isFixedMode ? "Publish it when the customer price is ready." : "Publish it when you are ready to receive quote requests." });
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
    const invalidFixed = item.pricing_mode === "fixed" && !hasValidFixedTiers(item.tiers);
    const invalidDeposit = item.pricing_mode === "deposit_quote" && (!Number.isFinite(Number(item.deposit_amount)) || Number(item.deposit_amount) <= 0);
    if (!item.is_active && (item.needs_review || invalidFixed || invalidDeposit)) {
      toast.error(item.needs_review ? "Review is required before publishing" : invalidDeposit ? "Add a valid deposit before publishing" : "Add a valid fixed price before publishing", {
        description: item.needs_review ? "Keep this package private until Mercurius resolves the review flag." : invalidDeposit ? "Quote + deposit packages need a deposit greater than $0." : "Every fixed price level must have a customer price greater than $0.",
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

  const openPromotionEditor = (item: PackageRow) => {
    if (!promotionBackendReady || !serverNow) {
      toast.error("Promotion setup is not available", { description: "Deploy the package promotions migration before vendors create scheduled offers." });
      return;
    }
    if (!isPubliclyEligibleFixedPackage(item)) {
      toast.error("Publish a valid base price first", { description: "Promotions can only overlay active, review-cleared fixed-price packages." });
      return;
    }
    const existing = promotionForPackage(item.promotions, item.id, true);
    const defaultWindow = defaultPromotionWindow(serverNow);
    setPromotionPackage(item);
    setPromotionDraft({
      promotion_type: existing?.promotion_type ?? "percent_off",
      percent_off: existing?.percent_off == null ? "" : String(existing.percent_off),
      fixed_price: existing?.fixed_price == null ? "" : String(existing.fixed_price),
      label: existing?.label ?? "",
      starts_at: existing ? toDateTimeLocal(existing.starts_at) : defaultWindow.startsAt,
      ends_at: existing ? toDateTimeLocal(existing.ends_at) : defaultWindow.endsAt,
      is_enabled: existing?.is_enabled ?? true,
    });
    setPromotionOpen(true);
  };

  const closePromotionEditor = () => {
    setPromotionOpen(false);
    setPromotionPackage(null);
    setPromotionDraft(null);
    setPromotionSaving(false);
  };

  const savePromotion = async () => {
    if (!contractorId || !promotionPackage || !promotionDraft || promotionSaving) return;
    const startsAt = dateTimeLocalToIso(promotionDraft.starts_at);
    const endsAt = dateTimeLocalToIso(promotionDraft.ends_at);
    if (!startsAt || !endsAt) {
      toast.error("Choose a valid start and end time.");
      return;
    }
    const validationError = validatePromotion({
      promotion_type: promotionDraft.promotion_type,
      percent_off: promotionDraft.promotion_type === "percent_off" ? Number(promotionDraft.percent_off) : null,
      fixed_price: promotionDraft.promotion_type === "fixed_price" ? Number(promotionDraft.fixed_price) : null,
      starts_at: startsAt,
      ends_at: endsAt,
    }, promotionPackage.tiers.map((tier) => tier.price));
    if (validationError) {
      toast.error("Promotion isn’t ready", { description: validationError });
      return;
    }
    if (promotionDraft.label.trim().length > 48) {
      toast.error("Keep the public label to 48 characters or fewer.");
      return;
    }

    setPromotionSaving(true);
    const existing = promotionForPackage(promotionPackage.promotions, promotionPackage.id, true);
    const payload = {
      package_id: promotionPackage.id,
      promotion_type: promotionDraft.promotion_type,
      percent_off: promotionDraft.promotion_type === "percent_off" ? Number(promotionDraft.percent_off) : null,
      fixed_price: promotionDraft.promotion_type === "fixed_price" ? Number(promotionDraft.fixed_price) : null,
      label: promotionDraft.label.trim() || null,
      starts_at: startsAt,
      ends_at: endsAt,
      is_enabled: promotionDraft.is_enabled,
    };
    const supabase = createClient();
    const result = existing
      ? await supabase.from("package_promotions").update(payload).eq("id", existing.id).eq("package_id", promotionPackage.id)
      : await supabase.from("package_promotions").insert(payload);
    if (result.error) {
      setPromotionSaving(false);
      toast.error("Couldn’t save this promotion", { description: result.error.message });
      return;
    }
    closePromotionEditor();
    await refresh(contractorId);
    toast.success(promotionDraft.is_enabled ? "Promotion saved" : "Promotion saved as disabled", { description: "The package’s base tier prices were not changed." });
  };

  const disablePromotion = async (item: PackageRow) => {
    if (!contractorId) return;
    const promotion = promotionForPackage(item.promotions, item.id);
    if (!promotion || !window.confirm("Disable this promotion? Customers will immediately return to the package’s base price.")) return;
    setMutatingId(item.id);
    const result = await createClient().from("package_promotions").update({ is_enabled: false }).eq("id", promotion.id).eq("package_id", item.id);
    setMutatingId(null);
    if (result.error) toast.error("Couldn’t disable this promotion", { description: result.error.message });
    else { toast.success("Promotion disabled", { description: "The base price remains active." }); await refresh(contractorId); }
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
    if (row.state === "needs_review" && row.package?.template_id === null) {
      openEditor(row.package);
      return;
    }
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
  const copyTargetService = services.find((service) => service.id === copyTargetServiceId);
  const copyTargetPackages = copyTargetService
    ? allPackages.filter((item) => item.service_id === copyTargetService.id)
    : [];
  const copyTargetHasLivePackage = copyTargetPackages.some((item) =>
    item.pricing_mode === "fixed"
      ? isPubliclyEligibleFixedPackage(item)
      : isPubliclyEligibleQuotePackage(item),
  );
  const editorService = editing
    ? services.find((service) => service.id === editing.service_id)
    : undefined;
  const editorPricingQuestionKey = editing ? pricingQuestionKey(editing.tiers) : null;
  const editorPricingQuestionIndex = editing?.questions.findIndex((question) => question.question_key === editorPricingQuestionKey) ?? -1;
  const editorIntakeQuestions = editing?.questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => question.question_key !== editorPricingQuestionKey) ?? [];
  const editorEnabledFrequencies = editing
    ? frequenciesForService(editorService).filter((frequency) => Object.hasOwn(frequencyPrices, frequency))
    : [];
  const editorPreviewTiers: TierRow[] = editing
    ? advancedOpen
      ? editing.tiers.map((tier) => ({ ...tier, frequency: editing.default_frequency }))
      : editorEnabledFrequencies.flatMap((frequency, index) => {
          const price = Number(frequencyPrices[frequency]);
          return Number.isFinite(price) && price > 0
            ? [{ name: FREQUENCIES[frequency], price, frequency, includes: [], sort_order: index }]
            : [];
        })
    : [];
  const editorPriceReviews = editing?.pricing_mode === "fixed" && editorPreviewTiers.length
    ? evaluateCustomPackageFrequencyPriceReviews({
        tiers: editorPreviewTiers,
        defaultFrequency: editing.default_frequency,
        catalog: editorService,
        templateRange: templateGuidance[editing.service_id] ?? null,
      })
    : [];
  const editorPriceReview = editorPriceReviews.find((review) => review.needsReview) ?? editorPriceReviews[0] ?? null;

  if (loading) return <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading pricing…</div>;
  if (loadError) return <div className="mx-auto max-w-3xl p-6"><div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center"><h2 className="font-semibold">Pricing couldn’t be loaded</h2><p className="mt-2 text-sm text-muted-foreground">No preview packages have been substituted. {loadError}</p><Button variant="outline" className="mt-5" onClick={() => window.location.reload()}><RefreshCw />Try again</Button></div></div>;
  if (!contractorId) return <div className="mx-auto max-w-3xl p-6"><div className="rounded-xl border bg-card p-8 text-center"><h2 className="font-semibold">Vendor profile not linked</h2><p className="mt-2 text-sm text-muted-foreground">Your account does not have a linked contractor record yet. Contact Mercurius support before publishing prices.</p></div></div>;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Launch pricing</p>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold"><Package className="h-6 w-6 text-accent" />Pricing &amp; Packages</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Publish a live fixed price when the scope is predictable, or mark the service as quote-required when details must be confirmed first. Drafts stay private.</p>
        </div>
        <Button className="min-h-11 w-full bg-accent text-accent-foreground hover:bg-accent-hover sm:w-auto" disabled={!services.length} onClick={() => newPackage()}><Plus />Add package</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard icon={PackageCheck} label="Live Fixed Prices" value={packageStats.live} note="Instant-price packages available publicly" tone="live" />
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
              const canOpenEditor = row.state === "no_package" || row.state === "quote_only" || row.package?.template_id === null;
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
                      <Button variant="outline" className="min-h-11 border-amber-300" disabled={!canOpenEditor} onClick={() => openCoverageEditor(row)}><Pencil />Review pricing</Button>
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="font-heading text-lg font-semibold">Your custom packages</h2><p className="mt-1 text-sm text-muted-foreground">Create, edit, pause, and publish fixed-price or quote-required services here.</p></div>{sortedPackages.length > 0 && <Badge variant="outline" className="w-fit">{sortedPackages.length} {sortedPackages.length === 1 ? "package" : "packages"}</Badge>}</div>
        {sortedPackages.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-8 text-center sm:p-10">
            <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="text-lg font-medium">No custom packages yet</h3>
            <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">Add a live fixed price or a quote-required service, choose whether it starts active, and publish it in about a minute.</p>
            <p className="mx-auto mt-3 max-w-md rounded-lg border bg-muted/50 px-3 py-2.5 text-sm">Example: <span className="font-medium">Standard lawn mow · $55 · Weekly</span></p>
            <Button className="mt-5 min-h-11 bg-accent text-accent-foreground hover:bg-accent-hover" disabled={!services.length} onClick={() => newPackage()}><Plus />Add your first package</Button>
          </div>
        ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sortedPackages.map((item) => {
            const advanced = isAdvancedTierStructure(item.tiers, item.questions);
            const cadencePrices = lowestTierPriceByFrequency(item.tiers, item.default_frequency);
            const validPrices = item.tiers.map((tier) => Number(tier.price)).filter((price) => Number.isFinite(price) && price > 0);
            const displayPrice = validPrices.length ? Math.min(...validPrices) : null;
            const live = isLiveFixedPackage(item);
            const liveQuote = isPubliclyEligibleQuotePackage(item);
            return (
              <article key={item.id} className={cn("rounded-xl border bg-card p-5 shadow-sm", live && "border-accent-border", liveQuote && "border-info/40", item.needs_review && "border-amber-300/70")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{item.name}</h3><PackageStatus item={item} /><Badge variant="outline">{FREQUENCIES[item.default_frequency] ?? item.default_frequency} default</Badge>{cadencePrices.length > 1 && <Badge variant="outline">{cadencePrices.length} cadences</Badge>}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{services.find((service) => service.id === item.service_id)?.name ?? "Service"}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1"><PricingToggle checked={item.is_active} disabled={mutatingId === item.id} onCheckedChange={() => void togglePackage(item)} label={`${item.is_active ? "Pause" : "Publish"} ${item.name}`} /><span className="text-[10px] font-medium text-muted-foreground">{mutatingId === item.id ? "Updating…" : live ? "Live price" : liveQuote ? "Quote live" : item.needs_review ? "Review blocked" : item.is_active ? "Invalid" : "Paused"}</span></div>
                </div>
                {item.pricing_mode === "fixed" && displayPrice !== null ? (
                  <div className="mt-4">
                    {!advanced ? <div className="space-y-2">{cadencePrices.map(({ frequency, price }) => <div key={frequency} className="flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2"><div><p className="text-sm font-medium">{FREQUENCIES[frequency]}</p>{frequency === item.default_frequency && <p className="text-[11px] text-muted-foreground">Selected first for customers</p>}</div><p className="text-base font-semibold tabular-nums">{money(price)}</p></div>)}</div> : (
                      <div className="space-y-2"><p className="text-sm text-muted-foreground">From <span className="font-semibold text-foreground">${displayPrice}</span> · {item.tiers.length} price levels · {FREQUENCIES[item.default_frequency]}</p>{item.tiers.slice(0, 3).map((tier) => <div key={tier.id ?? tier.name} className="flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2"><div><p className="text-sm font-medium">{tier.name}</p>{(tier.rule_min != null || tier.rule_max != null) && <p className="text-xs text-muted-foreground">{tier.rule_min}–{tier.rule_max} {item.questions.find((question) => question.question_key === tier.rule_question_key)?.unit ?? ""}</p>}</div><p className="text-sm font-semibold text-primary">${tier.price}</p></div>)}</div>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">{live ? "Available to public Pricing and Plan Builder flows." : item.needs_review ? "Hidden from public pricing and booking until the review flag is resolved." : "Saved privately until this package is published."}</p>
                  </div>
                ) : item.pricing_mode !== "fixed" ? <div className="mt-4 rounded-lg border border-info/30 bg-info/5 p-3 text-sm"><p className="font-medium text-foreground">{item.pricing_mode === "deposit_quote" ? "Quote required + deposit" : "Custom quote required"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.pricing_mode === "deposit_quote" && item.deposit_amount ? `${money(item.deposit_amount)} deposit saved. ` : ""}Homeowners submit details first; scope and final pricing are confirmed before booking.</p></div> : <div className="mt-4 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><p className="font-medium">A valid fixed price is required</p><p className="mt-1 text-xs opacity-80">Edit this package and add a customer price greater than $0 before publishing.</p></div>}
                {item.addons.length > 0 && <div className="mt-4 rounded-lg border bg-muted/20 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Optional add-ons</p><div className="mt-2 space-y-2">{item.addons.map((addon, index) => <div key={addon.id ?? `${addon.name}-${index}`} className="flex items-start justify-between gap-3 text-sm"><div><p className="font-medium text-foreground">{addon.name}</p>{addon.description && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{addon.description}</p>}</div><span className="shrink-0 font-semibold tabular-nums text-foreground">+{money(addon.price)}</span></div>)}</div></div>}
                {item.pricing_mode === "fixed" && <PackagePromotionPanel item={item} serverNow={serverNow} backendReady={promotionBackendReady} mutating={mutatingId === item.id} onEdit={() => openPromotionEditor(item)} onDisable={() => void disablePromotion(item)} />}
                {item.needs_review && <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>This package is hidden from public pricing and booking while its customer price is reviewed. Adjust the price into the expected range or contact Mercurius to resolve the flag.</span></div>}
                <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
                  <span className="text-xs text-muted-foreground">{live ? "Pause to remove this price from public booking." : liveQuote ? "Pause to remove this quote option from public matching." : item.needs_review ? "This package cannot become public until review is resolved." : item.is_active ? "This active record is excluded publicly until its required details are valid." : item.pricing_mode === "fixed" ? "Publish when the price is ready for customers." : "Publish when you are ready to receive quote requests."}</span>
                  <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" className="h-11 px-3" aria-label={`Copy ${item.name} to another service`} onClick={() => openCopyDialog(item)}><Copy />Copy</Button>
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

      <Dialog open={copyOpen} onOpenChange={(value) => { if (!value) closeCopyDialog(); }}>
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Use this package as a starting point</DialogTitle>
            <DialogDescription>Choose a service, then review the copied settings before saving. Nothing is published automatically.</DialogDescription>
          </DialogHeader>
          {copySource && <div className="space-y-4">
            <div className="rounded-xl border bg-muted/20 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Copying from</p>
              <p className="mt-1 font-medium text-foreground">{copySource.name}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline">{PRICING_MODES[copySource.pricing_mode].label}</Badge>
                <Badge variant="outline">{FREQUENCIES[copySource.default_frequency] ?? copySource.default_frequency}</Badge>
                {copySource.pricing_mode === "fixed" && <Badge variant="outline">{copySource.tiers.length} {copySource.tiers.length === 1 ? "price" : "price levels"}</Badge>}
                {copySource.pricing_mode === "deposit_quote" && copySource.deposit_amount && <Badge variant="outline">{money(copySource.deposit_amount)} deposit</Badge>}
                {copySource.addons.length > 0 && <Badge variant="outline">{copySource.addons.length} {copySource.addons.length === 1 ? "add-on" : "add-ons"}</Badge>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="copy-target-service">Use this setup for</Label>
              <select id="copy-target-service" className={nativeSelect} value={copyTargetServiceId} onChange={(event) => setCopyTargetServiceId(event.target.value)}>
                <option value="" disabled>Choose a target service</option>
                {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
              <p className="text-xs leading-5 text-muted-foreground">The pricing mode, relevant prices or deposit, cadence when supported, and optional add-ons will carry over. Scheduled promotions will not.</p>
            </div>

            {copyTargetService && copyTargetPackages.length > 0 && <div className={cn("flex items-start gap-3 rounded-xl border p-3.5", copyTargetHasLivePackage ? "border-amber-300/70 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" : "bg-muted/30")}>
              {copyTargetHasLivePackage ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Copy className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
              <div>
                <p className="text-sm font-medium">{copyTargetHasLivePackage ? "This service already has live pricing" : "This service already has a saved package"}</p>
                <p className="mt-0.5 text-xs leading-5 opacity-80">A separate private draft will be created for review. The {copyTargetPackages.length === 1 ? "existing package" : `${copyTargetPackages.length} existing packages`} will not be overwritten, paused, or changed.</p>
              </div>
            </div>}

            <div className="rounded-xl border border-accent-border bg-accent-subtle p-3.5 text-sm">
              <p className="font-medium text-foreground">Safe by default</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">The copied setup opens as an unsaved private draft. If you choose to publish a fixed price, Mercurius checks it against the target service’s expected pricing range first.</p>
            </div>
          </div>}
          <DialogFooter>
            <Button variant="ghost" onClick={closeCopyDialog}>Cancel</Button>
            <Button className="bg-accent text-accent-foreground hover:bg-accent-hover" disabled={!copyTargetServiceId} onClick={continuePackageCopy}><Copy />Continue to draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={(value) => { if (!value) closeEditor(); }}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto p-5 sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit custom package" : "Add a custom package"}</DialogTitle><DialogDescription>Choose whether customers see a live price or request a confirmed quote before booking.</DialogDescription></DialogHeader>
          {editing && <div className="space-y-5">
            <div className="space-y-2"><Label htmlFor="package-service">Service</Label><select id="package-service" className={nativeSelect} value={editing.service_id} onChange={(event) => changeService(event.target.value)}><option value="" disabled>Choose a service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></div>
            <div className="space-y-2"><Label htmlFor="package-pricing-mode">How should homeowners get a price?</Label><select id="package-pricing-mode" className={nativeSelect} value={editing.pricing_mode} onChange={(event) => changePricingMode(event.target.value as PricingMode)}><option value="fixed">Fixed price — show a live customer price</option><option value="deposit_quote">Quote required — deposit after confirmation</option><option value="custom_quote">Custom quote — confirm the full price first</option></select><div className="rounded-lg border bg-muted/25 px-3 py-2.5"><p className="text-sm font-medium text-foreground">{PRICING_MODES[editing.pricing_mode].label}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{PRICING_MODES[editing.pricing_mode].description}</p></div></div>
            {editing.pricing_mode === "fixed" && !advancedOpen && <div className="space-y-3 rounded-xl border bg-muted/15 p-3.5">
              <div><Label>Cadences and customer prices</Label><p className="mt-1 text-xs leading-5 text-muted-foreground">Enable only cadences you actively offer. Each enabled cadence needs its own provider-backed price.</p></div>
              <div className="space-y-2">{frequenciesForService(editorService).map((frequency) => {
                const enabled = Object.hasOwn(frequencyPrices, frequency);
                return <div key={frequency} className={cn("grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-center", enabled ? "border-accent-border bg-background" : "bg-muted/20")}>
                  <label className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={enabled} disabled={enabled && editorEnabledFrequencies.length === 1} onChange={(event) => toggleFrequency(frequency, event.target.checked)} className="h-4 w-4 accent-accent" /><span><span className="block text-sm font-medium">{FREQUENCIES[frequency]}</span>{editing.default_frequency === frequency && enabled && <span className="mt-0.5 block text-[11px] font-medium text-accent">Default cadence</span>}</span></label>
                  {enabled ? <div className="relative"><DollarSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={`${FREQUENCIES[frequency]} customer price`} className="h-11 pl-8 text-base" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="0.00" value={frequencyPrices[frequency] ?? ""} onChange={(event) => updateFrequencyPrice(frequency, event.target.value)} /></div> : <p className="text-right text-xs text-muted-foreground">Not offered</p>}
                </div>;
              })}</div>
              {editorEnabledFrequencies.length > 1 && <div className="space-y-2 border-t pt-3"><Label htmlFor="package-default-frequency">Default cadence</Label><select id="package-default-frequency" className={nativeSelect} value={editing.default_frequency} onChange={(event) => isPricingFrequency(event.target.value) && changeFrequency(event.target.value)}>{editorEnabledFrequencies.map((frequency) => <option key={frequency} value={frequency}>{FREQUENCIES[frequency]}</option>)}</select><p className="text-xs text-muted-foreground">This cadence is selected first for customers, but every enabled cadence remains available.</p></div>}
              {isAdvancedTierStructure(editing.tiers, editing.questions) && <p className="text-xs text-amber-700 dark:text-amber-300">You selected simple cadence pricing. Saving will replace the prior home-detail price levels.</p>}
            </div>}
            {editing.pricing_mode === "deposit_quote" && <div className="space-y-2"><Label htmlFor="package-deposit">Deposit after quote confirmation ($)</Label><Input id="package-deposit" className="h-12 text-lg" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="e.g. 100" value={editing.deposit_amount ?? ""} onChange={(event) => updateField("deposit_amount", event.target.value ? Number(event.target.value) : null)} /><p className="text-xs leading-5 text-muted-foreground">This records your intended deposit. It is not charged when a homeowner sends the initial request; Mercurius confirms scope, final price, and payment timing first.</p></div>}
            {editing.pricing_mode === "custom_quote" && <div className="rounded-xl border border-info/30 bg-info/5 p-3.5"><p className="text-sm font-medium text-foreground">No public price required</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Homeowners can request this service, but Mercurius will coordinate the details and confirm your quote before booking. No instant checkout is offered.</p></div>}
            {(editing.pricing_mode !== "fixed" || advancedOpen) && <div className="space-y-2"><Label htmlFor="package-frequency">Cadence / frequency</Label><select id="package-frequency" className={nativeSelect} value={editing.default_frequency} onChange={(event) => isPricingFrequency(event.target.value) && changeFrequency(event.target.value)}>{frequenciesForService(editorService).map((value) => <option key={value} value={value}>{FREQUENCIES[value]}</option>)}</select><p className="text-xs text-muted-foreground">{advancedOpen ? "Home-detail price levels use this cadence. Use simple pricing when one package needs several cadences." : "Only cadences supported by this catalog service are shown."}</p></div>}
            <div className="rounded-lg border bg-muted/20">
              <button type="button" className="flex w-full items-center justify-between px-3 py-3 text-left text-sm hover:bg-muted/40" aria-expanded={nameEditorOpen} onClick={() => setNameEditorOpen((current) => !current)}><span><span className="font-medium">Customer-facing name</span><span className="mt-0.5 block text-xs text-muted-foreground">Optional — generated automatically from service and cadence.</span></span><ChevronDown className={cn("h-4 w-4 transition-transform", nameEditorOpen && "rotate-180")} /></button>
              {nameEditorOpen && <div className="space-y-2 border-t p-3"><Input id="package-name" className="h-11" placeholder="Standard lawn mow" value={editing.name} onChange={(event) => { setNameCustomized(true); updateField("name", event.target.value); }} />{nameCustomized && <Button type="button" variant="ghost" size="sm" onClick={() => { const service = services.find((candidate) => candidate.id === editing.service_id); setNameCustomized(false); updateField("name", packageName(service?.name ?? displayService(editing.service_id), editing.default_frequency)); }}>Use automatic name</Button>}</div>}
            </div>
            <div className="overflow-hidden rounded-lg border">
              <div className="flex flex-col gap-3 bg-muted/20 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div><p className="text-sm font-medium">Optional add-ons</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">Offer simple extras alongside this package. Add-ons are confirmed during the request process and are not separate Stripe checkout items yet.</p></div>
                <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={editing.addons.length >= 10} onClick={() => updateField("addons", [...editing.addons, { name: "", description: null, price: 0, is_offered: true, sort_order: editing.addons.length }])}><Plus />Add add-on</Button>
              </div>
              {editing.addons.length === 0 ? <p className="border-t px-3 py-4 text-center text-xs text-muted-foreground">No optional extras on this package.</p> : <div className="space-y-3 border-t p-3">{editing.addons.map((addon, index) => <div key={addon.id ?? index} className="space-y-3 rounded-lg border bg-background p-3"><div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]"><Field label="Add-on name"><Input maxLength={80} placeholder="Screen enclosure cleaning" value={addon.name} onChange={(event) => { const next = [...editing.addons]; next[index] = { ...addon, name: event.target.value }; updateField("addons", next); }} /></Field><Field label="Price $"><Input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="25" value={addon.price || ""} onChange={(event) => { const next = [...editing.addons]; next[index] = { ...addon, price: Number(event.target.value) }; updateField("addons", next); }} /></Field><Button type="button" variant="ghost" className="h-10 w-10 self-end" aria-label={`Remove ${addon.name || "add-on"}`} onClick={() => updateField("addons", editing.addons.filter((_, addonIndex) => addonIndex !== index))}><Trash2 className="text-destructive" /></Button></div><Field label="Short description (optional)"><Input maxLength={160} placeholder="Includes frames and exterior screens" value={addon.description ?? ""} onChange={(event) => { const next = [...editing.addons]; next[index] = { ...addon, description: event.target.value || null }; updateField("addons", next); }} /></Field></div>)}</div>}
            </div>
            <div className="overflow-hidden rounded-lg border">
              <div className="flex flex-col gap-3 bg-muted/20 px-3 py-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm font-medium">Service questions</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">Ask up to 10 simple questions before a homeowner confirms the request. These do not create conditional branches.</p></div><Button type="button" variant="outline" size="sm" className="shrink-0" disabled={editing.questions.length >= 10} onClick={() => { const key = uniqueQuestionKey("question", editing.questions); updateField("questions", [...editing.questions, { question_key: key, question_label: "", input_type: "text", unit: null, options: null, is_required: true, sort_order: editing.questions.length }]); }}><Plus />Add question</Button></div>
              {editorIntakeQuestions.length === 0 ? <p className="border-t px-3 py-4 text-center text-xs text-muted-foreground">No additional questions. Packages without questions continue through the standard request form.</p> : <div className="space-y-3 border-t p-3">{editorIntakeQuestions.map(({ question, index }, visibleIndex) => <div key={question.id ?? question.question_key} className="rounded-lg border bg-background p-3"><div className="grid gap-3 sm:grid-cols-[1fr_auto]"><Field label={`Question ${visibleIndex + 1}`}><Input maxLength={180} placeholder="Is there gate access we should know about?" value={question.question_label} onChange={(event) => { const next = [...editing.questions]; next[index] = { ...question, question_label: event.target.value }; updateField("questions", next); }} /></Field><div className="flex items-end gap-1"><Button type="button" variant="ghost" className="h-10 w-10" disabled={index === 0 || editing.questions[index - 1]?.question_key === editorPricingQuestionKey} aria-label="Move question up" onClick={() => updateField("questions", moveQuestion(editing.questions, index, index - 1))}><ArrowUp /></Button><Button type="button" variant="ghost" className="h-10 w-10" disabled={index >= editing.questions.length - 1} aria-label="Move question down" onClick={() => updateField("questions", moveQuestion(editing.questions, index, index + 1))}><ArrowDown /></Button><Button type="button" variant="ghost" className="h-10 w-10" aria-label={`Remove ${question.question_label || "question"}`} onClick={() => updateField("questions", editing.questions.filter((_, questionIndex) => questionIndex !== index).map((item, sortIndex) => ({ ...item, sort_order: sortIndex }))) }><Trash2 className="text-destructive" /></Button></div></div><label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={question.is_required !== false} onChange={(event) => { const next = [...editing.questions]; next[index] = { ...question, is_required: event.target.checked }; updateField("questions", next); }} className="h-4 w-4 accent-accent" />Require an answer before request submission</label></div>)}</div>}
            </div>
            {editing.pricing_mode === "fixed" && <div className="overflow-hidden rounded-lg border">
              <button type="button" onClick={() => advancedOpen ? switchToSimplePricing() : enterAdvanced()} className="flex w-full items-center justify-between bg-muted/30 px-3 py-3 text-left text-sm hover:bg-muted/50" aria-expanded={advancedOpen}><span><span className="font-medium">Price varies by home details</span><span className="mt-0.5 block text-xs text-muted-foreground">{advancedOpen ? "Advanced pricing is active. Switching back to one price requires confirmation." : "Optional — add a customer question and size-based levels."}</span></span><ChevronDown className={cn("transition-transform", advancedOpen && "rotate-180")} /></button>
              {advancedOpen && <div className="space-y-5 border-t p-3">
                <div className="space-y-3"><Label className="text-base">Question that chooses the price level</Label>{editorPricingQuestionIndex >= 0 && (() => { const question = editing.questions[editorPricingQuestionIndex]; return <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"><div className="space-y-1.5 sm:col-span-2"><Label className="text-xs text-muted-foreground">Question</Label><Input placeholder="How many bedrooms?" value={question.question_label} onChange={(event) => { const next = [...editing.questions]; const key = uniqueQuestionKey(slugKey(event.target.value), next.filter((_, index) => index !== editorPricingQuestionIndex)); next[editorPricingQuestionIndex] = { ...question, question_label: event.target.value, question_key: key, input_type: "number", is_required: true }; updateField("questions", next); updateField("tiers", editing.tiers.map((tier) => ({ ...tier, rule_question_key: key }))); }} /></div><div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Unit (optional)</Label><Input placeholder="bedrooms, sq ft…" value={question.unit ?? ""} onChange={(event) => { const next = [...editing.questions]; next[editorPricingQuestionIndex] = { ...question, unit: event.target.value }; updateField("questions", next); }} /></div><p className="self-end text-xs leading-5 text-muted-foreground">Required because this answer selects the correct live price.</p></div>; })()}</div>
                <div className="space-y-3"><div className="flex items-center justify-between"><Label className="text-base">Price levels</Label><Button type="button" variant="outline" size="sm" onClick={() => updateField("tiers", [...editing.tiers, { name: `Level ${editing.tiers.length + 1}`, price: 0, frequency: editing.default_frequency, rule_question_key: editorPricingQuestionKey ?? "size", rule_min: 0, rule_max: 100, includes: [], sort_order: editing.tiers.length }])}><Plus />Add level</Button></div>
                  {editing.tiers.map((tier, index) => <div key={index} className="space-y-3 rounded-lg border p-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="Level name"><Input className="h-11" placeholder="e.g. 3–4 bedrooms" value={tier.name} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], name: event.target.value }; updateField("tiers", next); }} /></Field><Field label="Price $"><Input className="h-11" type="number" min="0" value={tier.price || ""} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], price: Number(event.target.value) }; updateField("tiers", next); }} /></Field><Field label="From"><Input className="h-11" type="number" value={tier.rule_min ?? ""} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], rule_min: event.target.value ? Number(event.target.value) : null }; updateField("tiers", next); }} /></Field><Field label="To"><Input className="h-11" type="number" value={tier.rule_max ?? ""} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], rule_max: event.target.value ? Number(event.target.value) : null }; updateField("tiers", next); }} /></Field></div><div className="flex items-end gap-2"><Field label="What’s included (optional)" className="flex-1"><Input className="h-11" placeholder="Mow, edge, blow" value={tier.includes.join(", ")} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], includes: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) }; updateField("tiers", next); }} /></Field><Button type="button" variant="ghost" className="h-11 w-11" aria-label={`Remove ${tier.name || "level"}`} onClick={() => updateField("tiers", editing.tiers.filter((_, tierIndex) => tierIndex !== index))}><Trash2 className="text-destructive" /></Button></div></div>)}
                </div>
              </div>}
            </div>}
            {editorPriceReview && <div className={cn("flex items-start gap-3 rounded-xl border p-3.5", editorPriceReview.needsReview ? "border-amber-300/70 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" : "border-accent-border bg-accent-subtle")}><span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", editorPriceReview.needsReview ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" : "bg-accent-soft text-sage-dark")}>{editorPriceReview.needsReview ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}</span><div><p className="text-sm font-medium">{editorPriceReview.needsReview ? "Pricing review required" : "Within the soft-launch pricing range"}</p><p className="mt-0.5 text-xs leading-5 opacity-80">{FREQUENCIES[editorPriceReview.frequency]} expected range: {money(editorPriceReview.minPrice)}–{money(editorPriceReview.maxPrice)} {priceReviewSourceLabel(editorPriceReview.source)}. {editorPriceReview.needsReview ? "Saving will flag this package and keep every cadence hidden from public pricing and booking until the price is adjusted or reviewed." : editorPriceReviews.length > 1 ? "All enabled cadence prices are checked separately before this package can go live." : "This package can be publicly eligible when it is published and all other checks pass."}</p></div></div>}
            <div className={cn("flex items-start gap-3 rounded-xl border p-3.5", editing.is_active ? "border-accent-border bg-accent-subtle" : "border-border bg-muted/30")}><span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", editing.is_active ? "bg-accent-soft text-sage-dark" : "bg-muted text-muted-foreground")}>{editing.is_active ? <PackageCheck className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{editing.is_active ? editorPriceReview?.needsReview ? "Save for pricing review" : editing.pricing_mode === "fixed" ? "Publish live price" : "Publish quote package" : "Save as draft"}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{editing.is_active ? editorPriceReview?.needsReview ? "The active setting is preserved, but this package stays hidden until its pricing review is resolved." : editing.pricing_mode === "fixed" ? "After a successful save, this validated price can appear in public pricing and request flows." : "Homeowners will see quote / matching required. No instant price or checkout is presented." : "The package remains private until you publish it."}</p></div><PricingToggle checked={editing.is_active} onCheckedChange={(checked) => updateField("is_active", checked)} label={editing.is_active ? "Save this package as a private draft" : "Publish this package when saved"} /></div>
          </div>}
          <DialogFooter className="sm:grid sm:grid-cols-[auto_1fr_1fr]"><Button variant="ghost" className="min-h-11" disabled={saving} onClick={closeEditor}>Cancel</Button><Button variant="outline" className="min-h-11" disabled={saving} onClick={() => void savePackage(true)}>{saving ? <Loader2 className="animate-spin" /> : <Plus />}{editing?.is_active ? editorPriceReview?.needsReview ? "Save review & add next" : editing.pricing_mode === "fixed" ? "Publish & add next" : "Publish quote & add next" : "Save draft & add next"}</Button><Button className={cn("min-h-11", editing?.is_active && "bg-accent text-accent-foreground hover:bg-accent-hover")} disabled={saving} onClick={() => void savePackage(false)}>{saving ? <><Loader2 className="animate-spin" />Saving…</> : editing?.is_active ? editorPriceReview?.needsReview ? <><AlertTriangle />Save for review</> : editing.pricing_mode === "fixed" ? <><PackageCheck />Publish & finish</> : <><PackageCheck />Publish quote</> : <><PauseCircle />Save draft & finish</>}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={promotionOpen} onOpenChange={(value) => { if (!value) closePromotionEditor(); }}>
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{promotionPackage && promotionForPackage(promotionPackage.promotions, promotionPackage.id, true) ? "Edit promotion" : "Add promotion"}</DialogTitle>
            <DialogDescription>Schedule a temporary overlay for {promotionPackage?.name ?? "this package"}. Base tier prices remain unchanged.</DialogDescription>
          </DialogHeader>
          {promotionPackage && promotionDraft && <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="promotion-type">Promotion type</Label>
              <select id="promotion-type" className={nativeSelect} value={promotionDraft.promotion_type} onChange={(event) => setPromotionDraft((current) => current ? { ...current, promotion_type: event.target.value as PromotionType, percent_off: "", fixed_price: "" } : current)}>
                <option value="percent_off">Percent off</option>
                {promotionPackage.tiers.length === 1 && <option value="fixed_price">Fixed promotional price</option>}
              </select>
              <p className="text-xs text-muted-foreground">Percent off works across all valid tiers. Fixed promotional price is limited to a single-tier package.</p>
            </div>
            {promotionDraft.promotion_type === "percent_off" ? <Field label={`Percent off (1–${MAX_PROMOTION_PERCENT}%)`}><Input type="number" min="1" max={MAX_PROMOTION_PERCENT} step="1" inputMode="decimal" placeholder="15" value={promotionDraft.percent_off} onChange={(event) => setPromotionDraft((current) => current ? { ...current, percent_off: event.target.value } : current)} /></Field> : <Field label={`Promotional price (base ${money(promotionPackage.tiers[0]?.price ?? 0)})`}><Input type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="75" value={promotionDraft.fixed_price} onChange={(event) => setPromotionDraft((current) => current ? { ...current, fixed_price: event.target.value } : current)} /></Field>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts"><Input type="datetime-local" value={promotionDraft.starts_at} onChange={(event) => setPromotionDraft((current) => current ? { ...current, starts_at: event.target.value } : current)} /></Field>
              <Field label="Ends"><Input type="datetime-local" value={promotionDraft.ends_at} onChange={(event) => setPromotionDraft((current) => current ? { ...current, ends_at: event.target.value } : current)} /></Field>
            </div>
            <Field label="Public label (optional)"><Input maxLength={48} placeholder="Summer service special" value={promotionDraft.label} onChange={(event) => setPromotionDraft((current) => current ? { ...current, label: event.target.value } : current)} /><p className="text-xs text-muted-foreground">Keep it short and factual. Coupon codes and usage limits are not supported.</p></Field>
            <PromotionDraftPreview item={promotionPackage} draft={promotionDraft} />
            <div className={cn("flex items-start gap-3 rounded-xl border p-3.5", promotionDraft.is_enabled ? "border-accent-border bg-accent-subtle" : "bg-muted/30")}><span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", promotionDraft.is_enabled ? "bg-accent-soft text-sage-dark" : "bg-muted text-muted-foreground")}><Tag className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{promotionDraft.is_enabled ? "Promotion enabled" : "Promotion disabled"}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{promotionDraft.is_enabled ? "Database time controls when the overlay starts and expires." : "Customers continue to see the package’s base price."}</p></div><PricingToggle checked={promotionDraft.is_enabled} onCheckedChange={(is_enabled) => setPromotionDraft((current) => current ? { ...current, is_enabled } : current)} label={promotionDraft.is_enabled ? "Disable promotion" : "Enable promotion"} /></div>
          </div>}
          <DialogFooter><Button variant="ghost" disabled={promotionSaving} onClick={closePromotionEditor}>Cancel</Button><Button className="bg-accent text-accent-foreground hover:bg-accent-hover" disabled={promotionSaving} onClick={() => void savePromotion()}>{promotionSaving ? <Loader2 className="animate-spin" /> : <Tag />}{promotionSaving ? "Saving…" : "Save promotion"}</Button></DialogFooter>
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
      is_required: question.is_required !== false,
      sort_order: question.sort_order,
    })));
    if (result.error) throw result.error;
  }
  const tierResult = await supabase.from("package_tiers").insert(tiers.map((tier) => ({
    package_id: packageId,
    name: tier.name,
    price: tier.price,
    frequency: tier.frequency,
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
    await replaceCustomPackageAddons(supabase, snapshot.id, snapshot.addons);
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

async function replaceCustomPackageAddons(
  supabase: ReturnType<typeof createClient>,
  packageId: string,
  addons: AddonRow[],
) {
  const cleared = await supabase
    .from("package_addons")
    .delete()
    .eq("package_id", packageId)
    .is("template_addon_id", null);
  if (cleared.error) throw cleared.error;
  if (!addons.length) return;

  const inserted = await supabase.from("package_addons").insert(addons.map((addon, index) => ({
    package_id: packageId,
    template_addon_id: null,
    name: addon.name.trim(),
    description: addon.description?.trim() || null,
    price: Number(addon.price),
    is_offered: true,
    sort_order: index,
  })));
  if (inserted.error) throw inserted.error;
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

function isAdvancedTierStructure(tiers: TierRow[], questions: QuestionRow[]) {
  const questionKeys = new Set(questions.map((question) => question.question_key));
  if (tiers.some((tier) =>
    tier.rule_question_key || tier.rule_min != null || tier.rule_max != null
  ) || tiers.some((tier) => tier.rule_question_key && questionKeys.has(tier.rule_question_key))) return true;
  const counts = new Map<PricingFrequency, number>();
  tiers.forEach((tier) => {
    counts.set(tier.frequency, (counts.get(tier.frequency) ?? 0) + 1);
  });
  return [...counts.values()].some((count) => count > 1);
}

function pricingQuestionKey(tiers: TierRow[]) {
  return tiers.find((tier) => tier.rule_question_key)?.rule_question_key ?? null;
}

function uniqueQuestionKey(base: string, questions: QuestionRow[]) {
  const used = new Set(questions.map((question) => question.question_key));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function normalizeQuestionRows(rows: QuestionRow[]) {
  const used = new Set<string>();
  const keyMap = new Map<string, string>();
  const questions = rows.map((question, index) => {
    const base = slugKey(question.question_label);
    let key = base;
    let suffix = 2;
    while (used.has(key)) {
      key = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(key);
    keyMap.set(question.question_key, key);
    return {
      ...question,
      question_key: key,
      question_label: question.question_label.trim(),
      is_required: question.is_required !== false,
      sort_order: index,
    };
  });
  return { questions, keyMap };
}

function moveQuestion(rows: QuestionRow[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= rows.length || to >= rows.length || from === to) return rows;
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((question, index) => ({ ...question, sort_order: index }));
}

function simpleFrequencyPriceDraft(
  tiers: TierRow[],
  fallback: PricingFrequency,
): Partial<Record<PricingFrequency, string>> {
  if (!tiers.length) return { [fallback]: "" };
  const prices: Partial<Record<PricingFrequency, string>> = {};
  tiers.forEach((tier) => {
    const frequency = tierPricingFrequency(tier, fallback);
    const price = Number(tier.price);
    if (!Number.isFinite(price) || price <= 0) return;
    const current = Number(prices[frequency]);
    if (!prices[frequency] || price < current) prices[frequency] = String(price);
  });
  return Object.keys(prices).length ? prices : { [fallback]: "" };
}

function lowestTierPriceByFrequency(tiers: TierRow[], fallback: PricingFrequency) {
  const prices = new Map<PricingFrequency, number>();
  tiers.forEach((tier) => {
    const frequency = tierPricingFrequency(tier, fallback);
    const price = Number(tier.price);
    if (!Number.isFinite(price) || price <= 0) return;
    const current = prices.get(frequency);
    if (current == null || price < current) prices.set(frequency, price);
  });
  return [...prices.entries()].map(([frequency, price]) => ({ frequency, price }));
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

function PackagePromotionPanel({ item, serverNow, backendReady, mutating, onEdit, onDisable }: { item: PackageRow; serverNow: string | null; backendReady: boolean; mutating: boolean; onEdit: () => void; onDisable: () => void }) {
  const baseEligible = isPubliclyEligibleFixedPackage(item);
  const promotion = promotionForPackage(item.promotions, item.id, true);
  const status = promotion ? promotionStatus(promotion, serverNow) : null;
  const minimumBase = item.tiers.length ? Math.min(...item.tiers.map((tier) => Number(tier.price))) : 0;
  const preview = promotion
    ? resolveEffectiveTierPrice(minimumBase, { ...promotion, is_enabled: true }, promotion.starts_at, item.tiers.length)
    : null;
  const statusLabel = status === "active" ? "Active" : status === "scheduled" ? "Scheduled" : status === "expired" ? "Expired" : status === "disabled" ? "Disabled" : status === "invalid" ? "Invalid" : "None";
  const stateClass = status === "active"
    ? "border-accent-border bg-accent-subtle"
    : status === "scheduled"
      ? "border-info/30 bg-info/5"
      : "border-border bg-muted/20";

  return <div className={cn("mt-4 rounded-xl border p-3.5", stateClass)}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><p className="flex items-center gap-1.5 text-sm font-medium"><Tag className="h-3.5 w-3.5" />Promotion</p><Badge variant="outline" className="bg-background/80">{statusLabel}</Badge></div>
        {!backendReady ? <p className="mt-1 text-xs text-muted-foreground">Promotion schema and pricing clock must be deployed before scheduled offers are available.</p> : !baseEligible ? <p className="mt-1 text-xs text-muted-foreground">Publish a valid, review-cleared base price before adding a promotion.</p> : !promotion ? <p className="mt-1 text-xs text-muted-foreground">No scheduled overlay. Customers see the base tier price.</p> : <><p className="mt-1 text-xs text-muted-foreground">{promotion.label || (promotion.promotion_type === "percent_off" ? `${promotion.percent_off}% off` : "Limited-time price")} · {formatPromotionWindow(promotion)}</p>{preview?.isPromotionEffective && <p className="mt-2 text-sm"><span className="text-muted-foreground line-through">{money(preview.basePrice)}</span><span className="mx-2 text-muted-foreground">→</span><span className="font-semibold text-accent">{money(preview.effectivePrice)}</span>{item.tiers.length > 1 && <span className="ml-1 text-xs text-muted-foreground">starting tier</span>}</p>}</>}
      </div>
      {baseEligible && backendReady && <div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" disabled={mutating} onClick={onEdit}>{promotion ? "Edit" : "Add promotion"}</Button>{promotion?.is_enabled && <Button variant="ghost" size="sm" disabled={mutating} onClick={onDisable}>Disable</Button>}</div>}
    </div>
  </div>;
}

function PromotionDraftPreview({ item, draft }: { item: PackageRow; draft: PromotionDraft }) {
  const startsAt = dateTimeLocalToIso(draft.starts_at);
  const endsAt = dateTimeLocalToIso(draft.ends_at);
  const input = {
    promotion_type: draft.promotion_type,
    percent_off: draft.promotion_type === "percent_off" ? Number(draft.percent_off) : null,
    fixed_price: draft.promotion_type === "fixed_price" ? Number(draft.fixed_price) : null,
    starts_at: startsAt ?? "",
    ends_at: endsAt ?? "",
  };
  const error = validatePromotion(input, item.tiers.map((tier) => tier.price));
  if (error) return <div className="rounded-xl border border-dashed bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">Preview appears after the discount and schedule are valid. {error}</div>;
  const minimumBase = Math.min(...item.tiers.map((tier) => Number(tier.price)));
  const preview = resolveEffectiveTierPrice(minimumBase, {
    id: "preview",
    package_id: item.id,
    promotion_type: draft.promotion_type,
    percent_off: input.percent_off,
    fixed_price: input.fixed_price,
    label: draft.label.trim() || null,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    is_enabled: true,
  }, input.starts_at, item.tiers.length);
  return <div className="rounded-xl border border-accent-border bg-accent-subtle p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Customer preview</p><p className="mt-2 text-lg"><span className="text-muted-foreground line-through">{money(preview.basePrice)}</span><span className="mx-2 text-muted-foreground">→</span><span className="font-semibold text-accent">{money(preview.effectivePrice)}</span>{item.tiers.length > 1 && <span className="ml-1 text-xs text-muted-foreground">starting tier</span>}</p><p className="mt-1 text-xs text-muted-foreground">{draft.label.trim() || (draft.promotion_type === "percent_off" ? `${draft.percent_off}% off` : "Limited-time price")}</p></div>;
}

function PackageStatus({ item }: { item: PackageRow }) {
  const status = isLiveFixedPackage(item)
    ? <Badge className="border border-accent-border bg-accent-soft text-sage-dark"><CheckCircle2 />Live / Active</Badge>
    : item.needs_review
      ? <Badge className="border border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle />Review blocked</Badge>
      : !item.is_active
        ? <Badge variant="outline"><PauseCircle />Draft / Paused</Badge>
      : item.pricing_mode !== "fixed"
        ? <Badge className="border border-info/30 bg-info/5 text-info">{item.pricing_mode === "deposit_quote" ? "Quote + deposit" : "Custom quote"}</Badge>
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

function money(value: number) {
  return `$${formatPrice(value)}`;
}

function priceReviewSourceLabel(source: "managed_template" | "service_catalog" | "absolute_fallback") {
  if (source === "managed_template") return "based on Mercurius managed-template bands";
  if (source === "service_catalog") return "based on this service’s catalog guidance";
  return "using the soft-launch fallback range";
}

function toDateTimeLocal(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateTimeLocalToIso(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function defaultPromotionWindow(serverNow: string) {
  const start = new Date(serverNow);
  start.setMinutes(start.getMinutes() + 5, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { startsAt: toDateTimeLocal(start.toISOString()), endsAt: toDateTimeLocal(end.toISOString()) };
}

function formatPromotionWindow(promotion: PackagePromotion) {
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${formatter.format(new Date(promotion.starts_at))}–${formatter.format(new Date(promotion.ends_at))}`;
}
