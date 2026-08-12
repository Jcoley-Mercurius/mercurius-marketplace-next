"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  CalendarDays,
  Check,
  CheckCircle2,
  CreditCard,
  Droplets,
  Home,
  Info,
  Leaf,
  Loader2,
  LogIn,
  ShieldCheck,
  Sparkles,
  Waves,
  Wind,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  RequestPlanSummary,
  type RequestPlanSummaryItem,
} from "@/components/request/RequestPlanSummary";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServiceCatalog } from "@/hooks/useServiceCatalog";
import { paymentFunctionError } from "@/lib/payments";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  isPricingFrequency,
  isPubliclyEligibleFixedPackage,
  isPubliclyEligibleQuotePackage,
  promotionForPackage,
  publiclyEligibleFixedFrequencies,
  resolveEffectiveTierPrice,
  tierPricingFrequency,
  type PackagePromotion,
  type PackageQualifyingQuestion,
  type PricingFrequency,
  type PublicPackageSelection,
} from "@/lib/vendorPricing";

type Step = "services" | "details" | "contact";
type Frequency = PricingFrequency;

type ServiceOption = {
  id: string;
  name: string;
  description: string;
  icon: typeof Leaf;
  monthlyPrice: number;
  oneTimePrice: number;
  defaultFrequency: Frequency;
  frequencies: Frequency[];
  livePrices?: Partial<Record<Frequency, number>>;
  basePrices?: Partial<Record<Frequency, number>>;
  promotionLabels?: Partial<Record<Frequency, string>>;
  promotionIds?: Partial<Record<Frequency, string>>;
  packageSelections?: Partial<Record<Frequency, PublicPackageSelection>>;
  availability?: "fixed" | "quote" | "sourcing";
};

type BuilderRequestedService = { id: string; name: string; availability: "fixed" | "quote" | "sourcing"; descriptor?: string; defaultFrequency?: Frequency; frequencies?: Frequency[]; prices?: Partial<Record<Frequency, number>>; basePrices?: Partial<Record<Frequency, number>>; promotionLabels?: Partial<Record<Frequency, string>>; promotionIds?: Partial<Record<Frequency, string>>; packageId?: string; tierId?: string; pricingMode?: "fixed" | "deposit_quote" | "custom_quote"; questions?: PackageQualifyingQuestion[]; packageName?: string; packageDescription?: string | null; tierName?: string; tierIncludes?: string[] };
type PackageSelection = PublicPackageSelection;
type ResolvedPackage = PackageSelection & { contractorId: string; price: number | null; basePrice?: number; promotionId?: string; promotionLabel?: string };
type CompletionKind = "quote" | "payment_pending" | "multi_service";

const serviceOptions: ServiceOption[] = [
  { id: "lawn-mowing", name: "Lawn Mowing", description: "Mowing, edging, and cleanup", icon: Leaf, monthlyPrice: 120, oneTimePrice: 45, defaultFrequency: "weekly", frequencies: ["weekly", "monthly", "one-time"] },
  { id: "pool-service", name: "Pool Service", description: "Cleaning, chemicals, and equipment check", icon: Waves, monthlyPrice: 135, oneTimePrice: 65, defaultFrequency: "weekly", frequencies: ["weekly", "monthly", "one-time"] },
  { id: "house-cleaning", name: "House Cleaning", description: "A fresh, professionally cleaned home", icon: Sparkles, monthlyPrice: 180, oneTimePrice: 165, defaultFrequency: "monthly", frequencies: ["monthly", "one-time"] },
  { id: "ac-maintenance", name: "A/C Maintenance", description: "Seasonal tune-up and system inspection", icon: Wind, monthlyPrice: 45, oneTimePrice: 129, defaultFrequency: "quarterly", frequencies: ["quarterly", "one-time"] },
  { id: "pressure-washing", name: "Pressure Washing", description: "Driveways, patios, and exterior surfaces", icon: Droplets, monthlyPrice: 80, oneTimePrice: 189, defaultFrequency: "quarterly", frequencies: ["quarterly", "one-time"] },
  { id: "pest-control", name: "Pest Control", description: "Interior and exterior home protection", icon: Bug, monthlyPrice: 49, oneTimePrice: 99, defaultFrequency: "monthly", frequencies: ["monthly", "quarterly", "one-time"] },
  { id: "handyman", name: "Handyman Service", description: "Small repairs and home projects", icon: Wrench, monthlyPrice: 95, oneTimePrice: 145, defaultFrequency: "one-time", frequencies: ["monthly", "one-time"] },
  { id: "general-home-service", name: "Something Else", description: "Tell us what your home needs", icon: Home, monthlyPrice: 0, oneTimePrice: 0, defaultFrequency: "one-time", frequencies: ["one-time"] },
];

const stepOrder: Step[] = ["services", "details", "contact"];
const stepLabels: Record<Step, string> = { services: "Services", details: "Your Home", contact: "Review" };
const storageKey = "nextRequestFlowState";

export default function RequestServicePage() {
  const [step, setStep] = useState<Step>("services");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [frequencies, setFrequencies] = useState<Record<string, Frequency>>({});
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("Cape Coral");
  const [stateCode, setStateCode] = useState("FL");
  const [zipCode, setZipCode] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [description, setDescription] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [smsUpdates, setSmsUpdates] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [serviceOverrides, setServiceOverrides] = useState<Record<string, Partial<ServiceOption>>>({});
  const [preferredProviders, setPreferredProviders] = useState<Record<string, string>>({});
  const [preferredProviderNames, setPreferredProviderNames] = useState<Record<string, string>>({});
  const [packageSelections, setPackageSelections] = useState<Record<string, PackageSelection>>({});
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, Record<string, string>>>({});
  const [completionKind, setCompletionKind] = useState<CompletionKind>("quote");
  const { user } = useAuth();
  const router = useRouter();
  const { services: catalogServices } = useServiceCatalog();

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      const builder = window.sessionStorage.getItem("homePlanSelection");
      const providerSelection = window.sessionStorage.getItem("preferredProviderSelection");
      if (saved) {
        const value = JSON.parse(saved) as Record<string, unknown>;
        // Restoring a browser-only draft necessarily hydrates the controlled form after mount.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(value.selectedIds)) setSelectedIds(value.selectedIds.filter((id): id is string => typeof id === "string"));
        if (value.frequencies && typeof value.frequencies === "object") setFrequencies(value.frequencies as Record<string, Frequency>);
        if (stepOrder.includes(value.step as Step)) setStep(value.step as Step);
        if (typeof value.streetAddress === "string") setStreetAddress(value.streetAddress);
        if (typeof value.city === "string") setCity(value.city);
        if (typeof value.stateCode === "string") setStateCode(value.stateCode);
        if (typeof value.zipCode === "string") setZipCode(value.zipCode);
        if (typeof value.preferredDate === "string") setPreferredDate(value.preferredDate);
        if (typeof value.description === "string") setDescription(value.description);
        if (typeof value.firstName === "string") setFirstName(value.firstName);
        if (typeof value.lastName === "string") setLastName(value.lastName);
        if (typeof value.email === "string") setEmail(value.email);
        if (typeof value.phone === "string") setPhone(value.phone);
        if (typeof value.smsUpdates === "boolean") setSmsUpdates(value.smsUpdates);
        if (value.serviceOverrides && typeof value.serviceOverrides === "object") setServiceOverrides(value.serviceOverrides as Record<string, Partial<ServiceOption>>);
        if (value.preferredProviders && typeof value.preferredProviders === "object") setPreferredProviders(value.preferredProviders as Record<string, string>);
        if (value.preferredProviderNames && typeof value.preferredProviderNames === "object") setPreferredProviderNames(value.preferredProviderNames as Record<string, string>);
        if (value.packageSelections && typeof value.packageSelections === "object") setPackageSelections(value.packageSelections as Record<string, PackageSelection>);
        if (value.questionAnswers && typeof value.questionAnswers === "object") setQuestionAnswers(value.questionAnswers as Record<string, Record<string, string>>);
      }
      if (builder) {
        const value = JSON.parse(builder) as { selectedServiceIds?: unknown; frequencies?: unknown; requestedServices?: unknown };
        const requestedServices = Array.isArray(value.requestedServices) ? value.requestedServices.filter(isBuilderRequestedService) : [];
        if (requestedServices.length > 0) {
          setSelectedIds(requestedServices.map((item) => item.id));
          setServiceOverrides(Object.fromEntries(requestedServices.map((item) => [item.id, {
            name: item.name,
            description: item.descriptor,
            defaultFrequency: item.defaultFrequency,
            frequencies: item.frequencies,
            livePrices: item.prices,
            basePrices: item.basePrices,
            promotionLabels: item.promotionLabels,
            promotionIds: item.promotionIds,
            availability: item.availability,
            packageSelections: item.packageId && item.pricingMode
              ? Object.fromEntries((item.frequencies ?? [item.defaultFrequency ?? "one-time"]).map((frequency) => [frequency, { packageId: item.packageId!, tierId: item.tierId, pricingMode: item.pricingMode!, questions: item.questions, packageName: item.packageName, packageDescription: item.packageDescription, tierName: item.tierName, tierIncludes: item.tierIncludes }]))
              : undefined,
          }])));
          setPackageSelections(Object.fromEntries(requestedServices
            .filter((item) => item.packageId && item.pricingMode)
            .map((item) => [item.id, { packageId: item.packageId!, tierId: item.tierId, pricingMode: item.pricingMode!, questions: item.questions, packageName: item.packageName, packageDescription: item.packageDescription, tierName: item.tierName, tierIncludes: item.tierIncludes }])));
          const needsMatching = requestedServices.filter((item) => item.availability !== "fixed");
          if (needsMatching.length > 0) setDescription((current) => current || `Please help me with: ${needsMatching.map((item) => item.name).join(", ")}. I understand provider coverage and pricing still need to be confirmed.`);
        } else if (Array.isArray(value.selectedServiceIds)) {
          const knownIds = value.selectedServiceIds.filter((id): id is string => typeof id === "string" && serviceOptions.some((service) => service.id === id));
          setSelectedIds(knownIds);
        }
        if (value.frequencies && typeof value.frequencies === "object") setFrequencies(value.frequencies as Record<string, Frequency>);
        window.sessionStorage.removeItem("homePlanSelection");
      }

      const query = new URLSearchParams(window.location.search);
      const requestedServiceId = query.get("service");
      const requestedServiceName = query.get("requested");
      if (requestedServiceId && !builder) {
        const knownService = serviceOptions.find((service) => service.id === requestedServiceId);
        const selectedServiceId = knownService?.id ?? requestedServiceId;
        setSelectedIds((current) => current.includes(selectedServiceId) ? current : [...current, selectedServiceId]);
        setFrequencies((current) => current[selectedServiceId] ? current : { ...current, [selectedServiceId]: knownService?.defaultFrequency ?? "one-time" });
        if (requestedServiceName && !knownService) {
          setServiceOverrides((current) => ({ ...current, [selectedServiceId]: { name: requestedServiceName, description: "Provider-specific service request", defaultFrequency: "one-time", frequencies: ["one-time"], livePrices: {} } }));
        }
      }

      const storedProvider = providerSelection ? JSON.parse(providerSelection) as { contractorId?: unknown; contractorName?: unknown; serviceId?: unknown } : null;
      const providerId = typeof storedProvider?.contractorId === "string" ? storedProvider.contractorId : query.get("provider");
      const providerName = typeof storedProvider?.contractorName === "string" ? storedProvider.contractorName : query.get("providerName");
      const providerServiceId = typeof storedProvider?.serviceId === "string" ? storedProvider.serviceId : requestedServiceId;
      if (providerId && providerServiceId) {
        setPreferredProviders((current) => ({ ...current, [providerServiceId]: providerId }));
        if (providerName) setPreferredProviderNames((current) => ({ ...current, [providerServiceId]: providerName }));
      }
      window.sessionStorage.removeItem("preferredProviderSelection");
    } catch {
      window.sessionStorage.removeItem(storageKey);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
    const [givenName, ...familyName] = fullName.split(" ");
    // Auth metadata arrives asynchronously and only fills fields the user has not edited.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFirstName((current) => current || givenName || "");
    setLastName((current) => current || familyName.join(" "));
    setEmail((current) => current || user.email || "");
  }, [user]);

  useEffect(() => {
    if (!hydrated || isComplete) return;
    window.sessionStorage.setItem(storageKey, JSON.stringify({
      step, selectedIds, frequencies, streetAddress, city, stateCode, zipCode,
      preferredDate, description, firstName, lastName, email, phone, smsUpdates,
      serviceOverrides, preferredProviders, preferredProviderNames,
      packageSelections,
      questionAnswers,
    }));
  }, [city, description, email, firstName, frequencies, hydrated, isComplete, lastName, packageSelections, phone, preferredDate, preferredProviderNames, preferredProviders, questionAnswers, selectedIds, serviceOverrides, smsUpdates, stateCode, step, streetAddress, zipCode]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step, isComplete]);

  const requestServiceOptions = useMemo(() => {
    const knownIds = new Set(serviceOptions.map((service) => service.id));
    const catalogOverrides = Object.fromEntries(catalogServices.map((service) => {
      const frequencies = (service.availableFrequencies ?? [service.defaultFrequency]).filter(isFrequency);
      return [service.id, {
        name: service.name,
        description: service.descriptor,
        defaultFrequency: isFrequency(service.defaultFrequency) ? service.defaultFrequency : "one-time",
        frequencies: frequencies.length ? frequencies : ["one-time"],
        availability: service.availability ?? "sourcing",
        livePrices: service.availability === "fixed" ? {
          weekly: service.weeklyPrice ?? 0,
          "bi-monthly": service.biMonthlyPrice ?? 0,
          monthly: service.avgMonthlyPrice,
          quarterly: service.quarterlyPrice ?? 0,
          "one-time": service.oneTimePrice,
        } : undefined,
        basePrices: service.basePrices,
        promotionLabels: service.promotionLabels,
        promotionIds: service.promotionIds,
        packageSelections: service.packageSelections,
      } satisfies Partial<ServiceOption>];
    }));
    const known = serviceOptions.map((service) => ({ ...service, ...catalogOverrides[service.id], ...serviceOverrides[service.id] }));
    const live = Object.entries(serviceOverrides)
      .filter(([id]) => !knownIds.has(id))
      .map(([id, override]): ServiceOption => ({
        id,
        name: override.name ?? formatServiceName(id),
        description: override.description ?? "Tell us what you need and we’ll confirm the details.",
        icon: override.icon ?? Home,
        monthlyPrice: override.monthlyPrice ?? 0,
        oneTimePrice: override.oneTimePrice ?? 0,
        defaultFrequency: override.defaultFrequency ?? "one-time",
        frequencies: override.frequencies?.length ? override.frequencies : ["one-time"],
        livePrices: override.livePrices,
        availability: override.availability ?? "sourcing",
      }));
    return [...known, ...live];
  }, [catalogServices, serviceOverrides]);
  const selectedServices = useMemo(() => requestServiceOptions.filter((service) => selectedIds.includes(service.id)), [requestServiceOptions, selectedIds]);
  const estimate = useMemo(() => selectedServices.reduce((total, service) => total + servicePrice(service, frequencies[service.id] ?? service.defaultFrequency), 0), [frequencies, selectedServices]);
  const fixedServices = selectedServices.filter((service) => service.availability === "fixed" && servicePrice(service, frequencies[service.id] ?? service.defaultFrequency) > 0);
  const directCheckoutExpected = selectedServices.length === 1 && fixedServices.length === 1;
  const stepIndex = stepOrder.indexOf(step);

  function toggleService(id: string) {
    const removing = selectedIds.includes(id);
    setSelectedIds((current) => removing ? current.filter((serviceId) => serviceId !== id) : [...current, id]);
    if (removing) {
      setPreferredProviders((providers) => withoutKey(providers, id));
      setPreferredProviderNames((names) => withoutKey(names, id));
      setPackageSelections((selections) => withoutKey(selections, id));
      setQuestionAnswers((answers) => withoutKey(answers, id));
    } else {
      const service = requestServiceOptions.find((item) => item.id === id);
      const requestedFrequency = frequencies[id] ?? service?.defaultFrequency;
      const firstLiveFrequency = service?.frequencies.find(
        (item) => servicePrice(service, item) > 0,
      );
      const frequency =
        requestedFrequency && service && servicePrice(service, requestedFrequency) > 0
          ? requestedFrequency
          : firstLiveFrequency ?? requestedFrequency;
      if (frequency) {
        setFrequencies((current) => ({ ...current, [id]: frequency }));
      }
      const selection = frequency ? service?.packageSelections?.[frequency] : undefined;
      if (selection) setPackageSelections((current) => ({ ...current, [id]: selection }));
    }
  }

  function changeServiceFrequency(id: string, frequency: Frequency) {
    setFrequencies((current) => ({ ...current, [id]: frequency }));
    const selection = requestServiceOptions.find((service) => service.id === id)?.packageSelections?.[frequency];
    setPackageSelections((current) => selection ? { ...current, [id]: selection } : withoutKey(current, id));
    setQuestionAnswers((current) => withoutKey(current, id));
  }

  function continueFromServices() {
    if (selectedIds.length === 0) {
      toast.error("Choose at least one service", { description: "Select what your home needs before continuing." });
      return;
    }
    setStep("details");
  }

  function continueFromDetails() {
    if (!streetAddress.trim() || !city.trim()) {
      toast.error("Service address required", { description: "Enter the address where service is needed." });
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(stateCode.trim())) {
      toast.error("Invalid state", { description: "Use a two-letter state code, such as FL." });
      return;
    }
    if (!/^\d{5}(-\d{4})?$/.test(zipCode.trim())) {
      toast.error("Invalid ZIP code", { description: "Enter a valid five-digit ZIP code." });
      return;
    }
    const unanswered = selectedServices.flatMap((service) =>
      (packageSelections[service.id]?.questions ?? [])
        .filter((question) => question.is_required !== false && !questionAnswers[service.id]?.[question.question_key]?.trim())
        .map((question) => question.question_label),
    );
    if (unanswered.length) {
      toast.error("Answer the required service questions", { description: unanswered[0] });
      return;
    }
    setStep("contact");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) {
      toast.error("Contact information required", { description: "Complete all contact fields before submitting." });
      return;
    }
    if (!user) {
      toast.info("Almost done — sign in to confirm", { description: "Your request has been saved in this browser." });
      router.push("/login?redirect=/request");
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      let resolvedPackages: Record<string, ResolvedPackage> = {};
      try {
        resolvedPackages = await resolveLivePackages(
          supabase,
          selectedServices,
          frequencies,
          preferredProviders,
          packageSelections,
          questionAnswers,
        );
      } catch (reason) {
        console.error("Unable to verify live package pricing; submitting as quote requests", reason);
        toast.info("Live checkout is unavailable", { description: "Your request will still be submitted. We’ll confirm pricing before any payment is due." });
      }

      const inserts = selectedServices.map((service) => {
        const frequency = frequencies[service.id] ?? service.defaultFrequency;
        const livePackage = resolvedPackages[service.id];
        const isVerifiedFixed = livePackage?.pricingMode === "fixed" && Boolean(livePackage.tierId) && Number(livePackage.price) > 0;
        const requestPricingMode = isVerifiedFixed
          ? "fixed"
          : livePackage?.pricingMode === "deposit_quote"
            ? "deposit_quote"
            : "custom_quote";
        return {
          customer_id: user.id,
          service_type: service.name,
          contractor_id: preferredProviders[service.id] ?? livePackage?.contractorId ?? null,
          address: streetAddress.trim(),
          city: city.trim(),
          state: stateCode.trim().toUpperCase(),
          zip_code: zipCode.trim(),
          preferred_date: preferredDate || null,
          description: description.trim() || null,
          status: "pending",
          frequency,
          pricing_mode: requestPricingMode,
          quote_only: !isVerifiedFixed,
          total_amount: isVerifiedFixed ? livePackage.price : null,
          service_catalog_id: service.id,
          package_id: livePackage?.packageId ?? null,
          package_tier_id: isVerifiedFixed ? livePackage.tierId : null,
          package_question_answers: answerSnapshot(packageSelections[service.id]?.questions ?? [], questionAnswers[service.id] ?? {}),
          ...(isVerifiedFixed && livePackage.promotionId ? { base_amount: livePackage.basePrice, promotion_id: livePackage.promotionId } : {}),
        };
      });
      const { data: insertedRequests, error } = await supabase
        .from("service_requests")
        .insert(inserts)
        .select("id, pricing_mode, quote_only, package_id, package_tier_id");
      if (error) throw error;

      window.sessionStorage.removeItem(storageKey);
      const payable = insertedRequests?.length === 1 && insertedRequests[0]?.pricing_mode === "fixed" && !insertedRequests[0]?.quote_only && insertedRequests[0]?.package_tier_id
        ? insertedRequests[0]
        : null;

      if (payable) {
        const { data: checkout, error: checkoutError } = await supabase.functions.invoke("checkout-request", {
          body: { request_id: payable.id },
        });
        if (!checkoutError && typeof checkout?.url === "string") {
          toast.success("Request saved", { description: "Taking you to Stripe to complete secure payment." });
          window.location.assign(checkout.url);
          return;
        }

        const detail = checkoutError
          ? await paymentFunctionError(checkoutError)
          : { code: typeof checkout?.error === "string" ? checkout.error : undefined, message: typeof checkout?.message === "string" ? checkout.message : "Secure checkout did not return a payment link." };
        console.error("Unable to start request checkout", detail);
        setCompletionKind("payment_pending");
        setIsComplete(true);
        toast.warning("Request saved — payment not collected", { description: detail.message });
        return;
      }

      setCompletionKind(insertedRequests && insertedRequests.length > 1 ? "multi_service" : "quote");
      setIsComplete(true);
      toast.success("Request submitted", { description: "No payment was collected. We’ll confirm pricing and next steps." });
    } catch (error) {
      toast.error("Submission failed", { description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isComplete) {
    return <SuccessState services={selectedServices} preferredProviderNames={preferredProviderNames} completionKind={completionKind} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <section className="bg-hero py-12 text-center md:py-16">
          <div className="container-wide max-w-6xl">
            <Badge variant="secondary" className="mb-4">Homeowner Service Request</Badge>
            <h1 className="mb-4 text-3xl font-semibold md:text-4xl">Request a Service</h1>
            <p className="text-lg text-muted-foreground">Tell us what your home needs and we&apos;ll take care of the rest.</p>
          </div>
        </section>

        {!user && (
          <div className="border-y border-accent/20 bg-accent/5">
            <div className="container-narrow flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15"><Info className="h-4 w-4 text-accent" /></span>
                <div className="text-sm"><p className="font-semibold">You&apos;ll need a free account to confirm your request</p><p className="text-muted-foreground">Build your request now—your progress is saved in this browser.</p></div>
              </div>
              <Link href="/login?redirect=/request" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "border-accent/30 text-accent")}><LogIn className="h-4 w-4" /> Sign in now</Link>
            </div>
          </div>
        )}

        <div className="border-b border-border bg-card">
          <div className="container-narrow py-5">
            <div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>Step {stepIndex + 1} of 3</span><span>{Math.round(((stepIndex + 1) / 3) * 100)}% complete</span></div>
            <div className="mb-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((stepIndex + 1) / 3) * 100}%` }} /></div>
            <div className="flex items-center justify-center">
              {stepOrder.map((item, index) => (
                <div key={item} className="flex items-center">
                  <div className="flex items-center gap-2"><span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold", index <= stepIndex ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{index < stepIndex ? <Check className="h-4 w-4" /> : index + 1}</span><span className={cn("hidden text-xs sm:block", index === stepIndex ? "font-medium text-foreground" : "text-muted-foreground")}>{stepLabels[item]}</span></div>
                  {index < stepOrder.length - 1 && <div className="mx-3 h-px w-8 bg-border sm:w-16" />}
                </div>
              ))}
            </div>
          </div>
        </div>

        <section className="py-12 md:py-16">
          <div className="container-wide max-w-6xl">
            <form onSubmit={handleSubmit}>
              {step === "services" && <ServicesStep services={requestServiceOptions} selectedIds={selectedIds} frequencies={frequencies} preferredProviderNames={preferredProviderNames} onToggle={toggleService} onFrequencyChange={changeServiceFrequency} estimate={estimate} onContinue={continueFromServices} />}
              {step === "details" && <DetailsStep streetAddress={streetAddress} city={city} stateCode={stateCode} zipCode={zipCode} preferredDate={preferredDate} description={description} selectedServices={selectedServices} frequencies={frequencies} packageSelections={packageSelections} questionAnswers={questionAnswers} onQuestionAnswer={(serviceId, questionKey, answer) => setQuestionAnswers((current) => ({ ...current, [serviceId]: { ...(current[serviceId] ?? {}), [questionKey]: answer } }))} onStreetAddress={setStreetAddress} onCity={setCity} onStateCode={setStateCode} onZipCode={setZipCode} onPreferredDate={setPreferredDate} onDescription={setDescription} onBack={() => setStep("services")} onContinue={continueFromDetails} />}
              {step === "contact" && <ContactStep selectedServices={selectedServices} frequencies={frequencies} preferredProviderNames={preferredProviderNames} estimate={estimate} directCheckoutExpected={directCheckoutExpected} hasQuoteServices={fixedServices.length !== selectedServices.length} firstName={firstName} lastName={lastName} email={email} phone={phone} smsUpdates={smsUpdates} isSubmitting={isSubmitting} isSignedIn={!!user} onFirstName={setFirstName} onLastName={setLastName} onEmail={setEmail} onPhone={setPhone} onSmsUpdates={setSmsUpdates} onBack={() => setStep("details")} />}
            </form>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ServicesStep({
  services,
  selectedIds,
  frequencies,
  preferredProviderNames,
  onToggle,
  onFrequencyChange,
  estimate,
  onContinue,
}: {
  services: ServiceOption[];
  selectedIds: string[];
  frequencies: Record<string, Frequency>;
  preferredProviderNames: Record<string, string>;
  onToggle: (id: string) => void;
  onFrequencyChange: (id: string, value: Frequency) => void;
  estimate: number;
  onContinue: () => void;
}) {
  const selected = services.filter((service) => selectedIds.includes(service.id));
  const summaryItems: RequestPlanSummaryItem[] = selected.map((service) => {
    const frequency = frequencies[service.id] ?? service.defaultFrequency;
    return {
      id: service.id,
      name: service.name,
      cadence: frequencyLabel(frequency),
      price: servicePrice(service, frequency),
      priceLabel: servicePriceLabel(service, frequency),
      availability: service.availability ?? "sourcing",
    };
  });

  return (
    <div className="pb-24 lg:pb-0">
      <div className="mb-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          Build your request
        </p>
        <h2 className="text-2xl font-semibold sm:text-3xl">
          What does your home need?
        </h2>
        <p className="mt-2 max-w-2xl leading-6 text-muted-foreground">
          Choose one or more services. Live rates appear only where an active
          provider has published eligible pricing.
        </p>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid gap-4 sm:grid-cols-2">
          {services.map((service) => {
            const isSelected = selectedIds.includes(service.id);
            const Icon = service.icon;
            const frequency = frequencies[service.id] ?? service.defaultFrequency;
            const liveFrequencies = service.frequencies.filter(
              (item) => servicePrice(service, item) > 0,
            );
            const availableNow =
              service.availability === "fixed" && liveFrequencies.length > 0;
            const cardPrice = serviceCardPriceLabel(service);

            return (
              <Card
                key={service.id}
                className={cn(
                  "gap-0 overflow-hidden py-0 transition-all duration-200",
                  isSelected
                    ? "-translate-y-0.5 border-accent-border shadow-lg shadow-sage/10 ring-2 ring-accent"
                    : "hover:border-accent-border hover:shadow-md",
                )}
              >
                <button
                  type="button"
                  onClick={() => onToggle(service.id)}
                  aria-pressed={isSelected}
                  className="w-full p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring"
                >
                  <div className="flex items-start gap-4">
                    <span
                      className={cn(
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors",
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "bg-accent-soft text-sage-dark",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-semibold leading-5">{service.name}</p>
                        <span
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors",
                            isSelected
                              ? "border-accent bg-accent text-accent-foreground"
                              : "border-border bg-background text-transparent",
                          )}
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {service.description}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    <Badge
                      variant="secondary"
                      className={
                        availableNow
                          ? "border-accent-border bg-accent-soft text-sage-dark"
                          : service.availability === "quote"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                      }
                    >
                      {availableNow
                        ? "Available now"
                        : service.availability === "quote"
                          ? "Quote required"
                          : "Matching required"}
                    </Badge>
                    {cardPrice ? (
                      <span className="text-sm font-semibold text-foreground">
                        {cardPrice}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Price confirmed before booking
                      </span>
                    )}
                  </div>

                  {preferredProviderNames[service.id] && (
                    <p className="mt-3 flex items-center gap-1 text-xs font-medium text-accent">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Requested provider: {preferredProviderNames[service.id]}
                    </p>
                  )}
                </button>

                {isSelected && availableNow && liveFrequencies.length > 0 && (
                  <div className="border-t border-accent-border bg-accent-subtle/50 px-5 py-4">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Choose cadence and live rate
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {liveFrequencies.map((item) => (
                        <button
                          key={item}
                          type="button"
                          aria-pressed={frequency === item}
                          onClick={() => onFrequencyChange(service.id, item)}
                          className={cn(
                            "rounded-full border px-3 py-2 text-left text-xs transition-all",
                            frequency === item
                              ? "border-accent bg-accent font-semibold text-accent-foreground shadow-sm"
                              : "border-border-strong bg-background text-muted-foreground hover:border-accent-border hover:text-foreground",
                          )}
                        >
                          <span className="block">{frequencyLabel(item)}</span>
                          <span
                            className={cn(
                              "mt-0.5 block text-[11px]",
                              frequency === item
                                ? "text-accent-foreground/80"
                                : "text-foreground",
                            )}
                          >
                            {servicePriceLabel(service, item)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {isSelected && !availableNow && (
                  <div className="border-t border-border bg-muted/30 px-5 py-3 text-xs leading-5 text-muted-foreground">
                    Continue with your request. Mercurius will coordinate provider
                    matching and confirm pricing before booking.
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <RequestPlanSummary
          items={summaryItems}
          pricedSubtotal={estimate}
          onContinue={onContinue}
          onRemove={onToggle}
        />
      </div>
    </div>
  );
}

type DetailsStepProps = {
  streetAddress: string;
  city: string;
  stateCode: string;
  zipCode: string;
  preferredDate: string;
  description: string;
  selectedServices: ServiceOption[];
  frequencies: Record<string, Frequency>;
  packageSelections: Record<string, PackageSelection>;
  questionAnswers: Record<string, Record<string, string>>;
  onQuestionAnswer: (serviceId: string, questionKey: string, answer: string) => void;
  onStreetAddress: (value: string) => void;
  onCity: (value: string) => void;
  onStateCode: (value: string) => void;
  onZipCode: (value: string) => void;
  onPreferredDate: (value: string) => void;
  onDescription: (value: string) => void;
  onBack: () => void;
  onContinue: () => void;
};

function DetailsStep(props: DetailsStepProps) {
  const minDate = new Date().toISOString().slice(0, 10);
  const fixedServices = props.selectedServices.filter((service) => {
    const frequency = props.frequencies[service.id] ?? service.defaultFrequency;
    return service.availability === "fixed" && servicePrice(service, frequency) > 0;
  });
  const matchingServices = props.selectedServices.filter(
    (service) => !fixedServices.some((fixed) => fixed.id === service.id),
  );
  const selectionMix = fixedServices.length === props.selectedServices.length
    ? "fixed"
    : fixedServices.length === 0
      ? "matching"
      : "mixed";
  const framing = selectionMix === "fixed"
    ? {
        eyebrow: "Schedule your live-priced services",
        title: "Where and when should we plan service?",
        helper: "Your selected services currently have provider-backed rates. Confirm the location and preferred timing; additional notes are optional.",
      }
    : selectionMix === "matching"
      ? {
          eyebrow: "Help us match the right provider",
          title: "Tell us what your home needs",
          helper: "A little context helps Mercurius match the right provider and confirm an accurate quote before booking.",
        }
      : {
          eyebrow: "Complete your mixed service plan",
          title: "Add the details we need to coordinate",
          helper: `${fixedServices.length} service${fixedServices.length === 1 ? " has" : "s have"} a live rate today, while ${matchingServices.length} still need${matchingServices.length === 1 ? "s" : ""} matching or a quote.`,
        };
  const questionGroups = props.selectedServices
    .map((service) => ({
      service,
      questions: props.packageSelections[service.id]?.questions ?? [],
    }))
    .filter((group) => group.questions.length);
  const packageDetails = fixedServices.flatMap((service) => {
    const frequency = props.frequencies[service.id] ?? service.defaultFrequency;
    const selection = props.packageSelections[service.id];
    if (!selection) return [];
    const description = selection.packageDescription?.trim();
    const includes = selection.tierIncludes?.filter(Boolean) ?? [];
    return description || includes.length > 0
      ? [{ service, frequency, selection, description, includes }]
      : [];
  });
  const descriptionIsProminent = selectionMix !== "fixed";

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          {framing.eyebrow}
        </p>
        <h2 className="text-2xl font-semibold sm:text-3xl">{framing.title}</h2>
        <p className="mt-2 max-w-3xl leading-6 text-muted-foreground">
          {framing.helper}
        </p>
      </div>

      {packageDetails.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h3 className="font-semibold">What&apos;s included</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Published details from the live package and selected starting tier.
              </p>
            </div>
            <Badge variant="secondary" className="hidden border-accent-border bg-accent-soft text-sage-dark sm:inline-flex">
              Provider published
            </Badge>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {packageDetails.map(({ service, frequency, selection, description, includes }) => (
              <Card key={service.id} className="border-accent-border bg-accent-subtle/30 shadow-sm">
                <CardHeader className="gap-2 pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">{service.name}</CardTitle>
                    <Badge variant="outline" className="border-accent-border bg-background text-sage-dark">
                      {frequencyLabel(frequency)} · {servicePriceLabel(service, frequency)}
                    </Badge>
                  </div>
                  {selection.packageName && selection.packageName !== service.name && (
                    <p className="text-xs font-medium text-muted-foreground">{selection.packageName}</p>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {description && (
                    <p className="text-sm leading-6 text-muted-foreground">{description}</p>
                  )}
                  {includes.length > 0 && (
                    <ul className="grid gap-2 text-sm sm:grid-cols-2 md:grid-cols-1 xl:grid-cols-2">
                      {includes.map((included) => (
                        <li key={included} className="flex items-start gap-2">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                          <span>{included}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {selection.tierName && (
                    <p className="border-t border-accent-border pt-2 text-[11px] text-muted-foreground">
                      Scope shown for the {selection.tierName} tier. Final tier is re-checked with your answers at submit.
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {questionGroups.length > 0 && (
        <section className="mb-6">
          <div className="mb-3">
            <h3 className="font-semibold">Service-specific questions</h3>
            <p className="text-sm text-muted-foreground">
              These details help confirm the right price level and prepare for
              the visit.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {questionGroups.map(({ service, questions }) => (
              <Card key={service.id} className="border-border-strong shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{service.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Your answers are saved with this request only after you
                    confirm it.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {questions.map((question) => (
                    <PackageQuestionInput
                      key={question.question_key}
                      serviceId={service.id}
                      question={question}
                      value={
                        props.questionAnswers[service.id]?.[
                          question.question_key
                        ] ?? ""
                      }
                      onChange={props.onQuestionAnswer}
                    />
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>
            {selectionMix === "fixed" ? "Schedule and service location" : "Service location and request details"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            We&apos;ll confirm that the assigned provider serves this address before the appointment is finalized.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="streetAddress">Street address</Label>
            <Input
              id="streetAddress"
              autoComplete="address-line1"
              placeholder="123 Main St"
              className="h-12"
              value={props.streetAddress}
              onChange={(event) => props.onStreetAddress(event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="space-y-2 sm:col-span-3">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                autoComplete="address-level2"
                className="h-12"
                value={props.city}
                onChange={(event) => props.onCity(event.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-1">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                autoComplete="address-level1"
                maxLength={2}
                className="h-12 uppercase"
                value={props.stateCode}
                onChange={(event) =>
                  props.onStateCode(
                    event.target.value.toUpperCase().replace(/[^A-Z]/g, ""),
                  )
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="zip">ZIP code</Label>
              <Input
                id="zip"
                autoComplete="postal-code"
                inputMode="numeric"
                maxLength={10}
                className="h-12"
                value={props.zipCode}
                onChange={(event) =>
                  props.onZipCode(event.target.value.replace(/[^\d-]/g, ""))
                }
              />
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-accent-border bg-accent-subtle/40 p-4">
            <Home className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div>
              <p className="text-sm font-medium">Southwest Florida service area</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Mercurius primarily serves Southwest Florida, with an initial focus on Lee County and the Cape Coral–Fort Myers area. You can still submit if you&apos;re nearby; we&apos;ll confirm provider availability for your address.
              </p>
            </div>
          </div>

          {descriptionIsProminent && (
            <DescriptionField
              value={props.description}
              onChange={props.onDescription}
              prominent
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="preferredDate">Preferred date</Label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="preferredDate"
                type="date"
                min={minDate}
                className="h-12 pl-10"
                value={props.preferredDate}
                onChange={(event) => props.onPreferredDate(event.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This is a preference. We&apos;ll confirm the actual appointment
              with you.
            </p>
          </div>

          {!descriptionIsProminent && (
            <DescriptionField
              value={props.description}
              onChange={props.onDescription}
            />
          )}

          <div className="flex items-start gap-3 rounded-xl border border-dashed border-border-strong bg-muted/40 p-4">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
            <div>
              <p className="text-sm font-medium">Photo upload is coming soon</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                No files are collected or attached in this version. For now,
                describe any visible damage, dimensions, or access details in the
                notes above.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-8 flex flex-col-reverse justify-between gap-3 sm:flex-row">
        <Button type="button" variant="outline" size="lg" onClick={props.onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={props.onContinue}
          className="bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active"
        >
          Continue to Review <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function DescriptionField({
  value,
  onChange,
  prominent = false,
}: {
  value: string;
  onChange: (value: string) => void;
  prominent?: boolean;
}) {
  return (
    <div className={cn("space-y-2", prominent && "rounded-xl border border-accent-border bg-accent-subtle/30 p-4")}>
      <div>
        <Label htmlFor="description">
          {prominent ? "What do you need help with?" : "Additional notes"}
          <span className="font-normal text-muted-foreground"> (optional)</span>
        </Label>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {prominent
            ? "Share the scope, condition, dimensions, or access details that will help us match and quote accurately."
            : "Add access instructions or details the provider should know before the visit."}
        </p>
      </div>
      <textarea
        id="description"
        rows={prominent ? 6 : 3}
        placeholder={prominent ? "Describe the work you need, what you’re seeing, and any important home details..." : "Anything else we should know?"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
      />
    </div>
  );
}

function PackageQuestionInput({ serviceId, question, value, onChange }: { serviceId: string; question: PackageQualifyingQuestion; value: string; onChange: (serviceId: string, questionKey: string, answer: string) => void }) {
  const id = `question-${serviceId}-${question.question_key}`;
  const options = questionOptions(question.options);
  return <div className="space-y-2"><Label htmlFor={id}>{question.question_label}{question.is_required !== false ? <span className="text-destructive"> *</span> : <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>{question.input_type === "select" && options.length ? <select id={id} value={value} onChange={(event) => onChange(serviceId, question.question_key, event.target.value)} className="h-12 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"><option value="">Choose an answer</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <Input id={id} type={question.input_type === "number" ? "number" : "text"} inputMode={question.input_type === "number" ? "decimal" : undefined} className="h-12" placeholder={question.input_type === "number" ? `Enter a number${question.unit ? ` (${question.unit})` : ""}` : "Your answer"} value={value} onChange={(event) => onChange(serviceId, question.question_key, event.target.value)} />}{question.unit && question.input_type !== "number" && <p className="text-xs text-muted-foreground">Unit: {question.unit}</p>}</div>;
}

type ContactStepProps = {
  selectedServices: ServiceOption[];
  frequencies: Record<string, Frequency>;
  preferredProviderNames: Record<string, string>;
  estimate: number;
  directCheckoutExpected: boolean;
  hasQuoteServices: boolean;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  smsUpdates: boolean;
  isSubmitting: boolean;
  isSignedIn: boolean;
  onFirstName: (value: string) => void;
  onLastName: (value: string) => void;
  onEmail: (value: string) => void;
  onPhone: (value: string) => void;
  onSmsUpdates: (value: boolean) => void;
  onBack: () => void;
};

function ContactStep(props: ContactStepProps) {
  const pricedCount = props.selectedServices.filter((service) => {
    const frequency = props.frequencies[service.id] ?? service.defaultFrequency;
    return service.availability === "fixed" && servicePrice(service, frequency) > 0;
  }).length;
  const matchingCount = props.selectedServices.length - pricedCount;
  const paymentTitle = props.directCheckoutExpected
    ? "This request may continue to secure checkout"
    : props.hasQuoteServices
      ? "Requests first — no payment on this screen"
      : "Multiple services are coordinated before payment";
  const paymentCopy = props.directCheckoutExpected
    ? "At submit, we re-check the active package and tier. If this single fixed-price request is still eligible, you’ll continue to Stripe Checkout. No payment is complete until Stripe confirms it."
    : props.hasQuoteServices
      ? "Services that need matching or a quote are submitted first. Any live-priced items in this mixed plan are also coordinated as requests; we’ll confirm scope and pricing before payment."
      : "Current secure checkout supports exactly one verified fixed-tier request. This multi-service plan is submitted for coordination first; payable invoices can appear in your dashboard later.";

  return (
    <div>
      <div className="mb-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent">
          Final review
        </p>
        <h2 className="text-2xl font-semibold sm:text-3xl">Review and confirm</h2>
        <p className="mt-2 max-w-2xl leading-6 text-muted-foreground">
          Confirm your contact details, pricing status, and what happens after
          you submit.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Contact information</CardTitle>
              <p className="text-sm text-muted-foreground">
                We use these details to coordinate your request and confirm the
                appointment.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input id="firstName" autoComplete="given-name" className="h-12" value={props.firstName} onChange={(event) => props.onFirstName(event.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" autoComplete="family-name" className="h-12" value={props.lastName} onChange={(event) => props.onLastName(event.target.value)} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" className="h-12" value={props.email} onChange={(event) => props.onEmail(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" type="tel" autoComplete="tel" placeholder="(239) 555-0123" className="h-12" value={props.phone} onChange={(event) => props.onPhone(event.target.value)} required />
              </div>
              <label className="flex cursor-pointer items-start gap-3 text-sm text-muted-foreground">
                <input type="checkbox" checked={props.smsUpdates} onChange={(event) => props.onSmsUpdates(event.target.checked)} className="mt-1 h-4 w-4 accent-accent" />
                <span>I agree to receive SMS updates about this service request. Standard messaging rates may apply.</span>
              </label>
            </CardContent>
          </Card>

          <Card className="border-accent-border bg-accent-subtle/40">
            <CardHeader>
              <CardTitle>What happens next</CardTitle>
              <p className="text-sm text-muted-foreground">
                You stay informed before a provider arrives or any payment is
                considered complete.
              </p>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                {[
                  ["Rates are re-checked", "We verify each selected live package and tier when you submit."],
                  ["Matching is coordinated", "Quote or matching requests go to Mercurius for provider and scope confirmation."],
                  ["Payment follows the verified path", props.directCheckoutExpected ? "An eligible single fixed-tier request may continue to Stripe Checkout." : "This plan is submitted as requests first; any payable invoice follows after coordination."],
                  ["Track progress", "Status updates and invoices appear in your homeowner dashboard."],
                ].map(([title, copy], index) => (
                  <li key={title} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{index + 1}</span>
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{copy}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit border-accent-border bg-card shadow-lg shadow-slate/5 lg:sticky lg:top-24">
          <CardHeader className="border-b border-accent-border bg-accent-subtle">
            <CardTitle>Your service plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              {props.selectedServices.map((service) => {
                const frequency = props.frequencies[service.id] ?? service.defaultFrequency;
                const price = servicePrice(service, frequency);
                return (
                  <div key={service.id} className="flex justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium">{service.name}</p>
                      <p className="text-xs text-muted-foreground">{price > 0 ? frequencyLabel(frequency) : "Price confirmed before booking"}</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold">{price > 0 ? servicePriceLabel(service, frequency) : service.availability === "quote" ? "Quote" : "Matching"}</p>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3 border-t border-accent-border pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-muted-foreground">Priced today</span>
                <span className="text-2xl font-semibold tabular-nums">{formatMoney(props.estimate)}</span>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                {matchingCount > 0
                  ? `${matchingCount} service${matchingCount === 1 ? "" : "s"} need matching or a quote. No price for those services is included above.`
                  : "All selected services currently have live provider-backed rates."}
              </div>
              <div className="rounded-xl border border-accent-border bg-accent-subtle/50 p-4">
                <div className="flex items-start gap-3">
                  <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                  <div>
                    <p className="text-sm font-semibold">{paymentTitle}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{paymentCopy}</p>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <p>
                  Live rates are re-checked when you submit. If a selected rate
                  is no longer eligible, that service becomes a quote or
                  matching request instead.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 flex flex-col-reverse justify-between gap-3 sm:flex-row">
        <Button type="button" variant="outline" size="lg" onClick={props.onBack}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button type="submit" size="lg" disabled={props.isSubmitting} className="bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active">
          {props.isSubmitting ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {props.directCheckoutExpected ? "Re-checking live rate..." : "Submitting..."}</>
          ) : props.isSignedIn ? (
            props.directCheckoutExpected ? "Submit & Continue if Eligible" : "Submit Request"
          ) : (
            "Sign In to Submit"
          )}
        </Button>
      </div>
    </div>
  );
}

function SuccessState({ services, preferredProviderNames, completionKind }: { services: ServiceOption[]; preferredProviderNames: Record<string, string>; completionKind: CompletionKind }) {
  const providerNames = [...new Set(Object.values(preferredProviderNames))];
  const paymentMessage = completionKind === "payment_pending"
    ? "Your request is saved, but secure checkout could not be opened and no payment was collected. Check your dashboard for an eligible invoice or contact support."
    : completionKind === "multi_service"
      ? "Nothing was charged today. We’ll coordinate the selected services and place any payable invoices in your dashboard."
      : "No payment was collected. We’ll confirm scope, availability, and pricing before asking you to approve or pay anything.";
  return <div className="min-h-screen bg-background"><Header /><main className="py-16 md:py-24"><div className="container-narrow"><div className="mb-10 text-center"><span className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full bg-sage-light"><CheckCircle2 className="h-10 w-10 text-sage-dark" /></span><h1 className="mb-4 text-3xl font-semibold">Request Submitted!</h1><p className="mx-auto max-w-xl text-lg text-muted-foreground">Thank you for your request. Our team will review the details and contact you to confirm next steps.</p></div><Card className="mx-auto mb-8 max-w-xl"><CardHeader><CardTitle>Request Summary</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex justify-between gap-4"><span className="text-muted-foreground">Services</span><span className="text-right font-medium">{services.map((service) => service.name).join(", ")}</span></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">Provider</span><span className="text-right font-medium">{providerNames.length ? providerNames.join(", ") : "Matching in progress"}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Request status</span><span className="font-semibold text-sage-dark">Received</span></div><div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950"><CreditCard className="mt-0.5 h-4 w-4 shrink-0" /><p className="text-xs leading-relaxed">{paymentMessage}</p></div></CardContent></Card><div className="mx-auto mb-8 max-w-xl"><h2 className="mb-5 text-center font-semibold">What happens next</h2>{["Request received", "Pricing and provider confirmed", "Payment confirmed when required", "Service completed", "Leave a review"].map((label, index, items) => <div key={label} className="flex items-start gap-4"><div className="flex flex-col items-center"><span className={cn("flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium", index === 0 ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{index === 0 ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</span>{index < items.length - 1 && <span className="h-6 w-0.5 bg-border" />}</div><p className={cn("pt-1.5 text-sm", index === 0 ? "font-medium" : "text-muted-foreground")}>{label}</p></div>)}</div><div className="flex justify-center gap-3"><Link href="/dashboard?tab=invoices" className={buttonVariants({ variant: "outline", size: "lg" })}>View Dashboard</Link><Link href="/" className={buttonVariants({ size: "lg" })}>Return Home</Link></div></div></main></div>;
}

function servicePrice(service: ServiceOption, frequency: Frequency) {
  if (service.availability !== "fixed" || !service.livePrices) return 0;
  return service.livePrices[frequency] ?? 0;
}

function isBuilderRequestedService(item: unknown): item is BuilderRequestedService {
  if (!item || typeof item !== "object") return false;
  const value = item as Partial<BuilderRequestedService>;
  return typeof value.id === "string" && typeof value.name === "string" && ["fixed", "quote", "sourcing"].includes(String(value.availability));
}

function questionOptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((option): option is string => typeof option === "string" && Boolean(option.trim()));
  if (value && typeof value === "object" && "choices" in value && Array.isArray(value.choices)) {
    return value.choices.filter((option): option is string => typeof option === "string" && Boolean(option.trim()));
  }
  return [];
}

function answerSnapshot(questions: PackageQualifyingQuestion[], answers: Record<string, string>) {
  return Object.fromEntries(questions.flatMap((question) => {
    const answer = answers[question.question_key]?.trim();
    return answer ? [[question.question_key, {
      question: question.question_label,
      answer,
      unit: question.unit || null,
    }]] : [];
  }));
}

function servicePriceLabel(service: ServiceOption, frequency: Frequency) {
  const price = servicePrice(service, frequency);
  if (!price) return "Quote";
  const base = service.basePrices?.[frequency];
  if (service.promotionIds?.[frequency] && base && base > price) return `$${price} promo (was $${base})`;
  if (frequency === "one-time") return `$${price}`;
  if (frequency === "weekly") return `$${price}/wk`;
  if (frequency === "bi-monthly") return `$${price}/2 wks`;
  if (frequency === "quarterly") return `$${price}/qtr`;
  return `$${price}/mo`;
}

function serviceCardPriceLabel(service: ServiceOption) {
  if (service.availability !== "fixed") return null;
  const prices = service.frequencies
    .map((frequency) => servicePrice(service, frequency))
    .filter((price) => Number.isFinite(price) && price > 0);
  if (prices.length === 0) return null;
  const lowestPrice = Math.min(...prices);
  if (prices.length === 1) {
    const frequency = service.frequencies.find(
      (item) => servicePrice(service, item) === lowestPrice,
    );
    return frequency
      ? servicePriceLabel(service, frequency)
      : formatMoney(lowestPrice);
  }
  return `From ${formatMoney(lowestPrice)}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function frequencyLabel(frequency: Frequency) {
  return frequency === "one-time" ? "One-time" : frequency.charAt(0).toUpperCase() + frequency.slice(1);
}

function formatServiceName(id: string) {
  return id.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isFrequency(value: unknown): value is Frequency {
  return isPricingFrequency(value);
}

async function resolveLivePackages(
  supabase: ReturnType<typeof createClient>,
  services: ServiceOption[],
  frequencies: Record<string, Frequency>,
  preferredProviders: Record<string, string>,
  explicitSelections: Record<string, PackageSelection>,
  questionAnswers: Record<string, Record<string, string>>,
) {
  if (services.length === 0) return {};
  type PackageCandidate = { id: string; contractor_id: string; service_id: string; default_frequency: string; pricing_mode: string; deposit_amount: number | null; is_active: boolean; needs_review: boolean | null };
  type TierCandidate = { id: string; package_id: string; price: number | null; frequency: string | null; rule_question_key: string | null; rule_min: number | null; rule_max: number | null };

  const { data: packageData, error: packageError } = await supabase
    .from("vendor_packages")
    .select("id, contractor_id, service_id, default_frequency, pricing_mode, deposit_amount, is_active, needs_review, contractors!inner(is_active)")
    .in("service_id", services.map((service) => service.id))
    .eq("is_active", true)
    .eq("needs_review", false)
    .eq("contractors.is_active", true);
  if (packageError) throw packageError;

  const packageRows = (packageData ?? []) as unknown as PackageCandidate[];
  const fixedPackageIds = packageRows.filter((item) => item.pricing_mode === "fixed").map((item) => item.id);
  const [tierResult, promotionResult, clockResult] = await Promise.all([
    fixedPackageIds.length
      ? supabase.from("package_tiers").select("id, package_id, price, frequency, rule_question_key, rule_min, rule_max").in("package_id", fixedPackageIds)
      : Promise.resolve({ data: [] as TierCandidate[], error: null }),
    fixedPackageIds.length
      ? supabase.from("package_promotions").select("id, package_id, promotion_type, percent_off, fixed_price, label, starts_at, ends_at, is_enabled, created_at, updated_at").in("package_id", fixedPackageIds).eq("is_enabled", true)
      : Promise.resolve({ data: [] as PackagePromotion[], error: null }),
    supabase.rpc("pricing_server_now"),
  ]);
  if (tierResult.error) throw tierResult.error;
  if (promotionResult.error) throw promotionResult.error;
  if (clockResult.error || typeof clockResult.data !== "string") throw clockResult.error ?? new Error("The pricing clock is unavailable.");
  const tiers = (tierResult.data ?? []) as TierCandidate[];
  const promotions = (promotionResult.data ?? []) as PackagePromotion[];
  const serverNow = clockResult.data;
  const packages = packageRows.filter((item) => item.pricing_mode === "fixed"
    ? isPubliclyEligibleFixedPackage({ ...item, tiers: tiers.filter((tier) => tier.package_id === item.id) })
    : isPubliclyEligibleQuotePackage(item),
  );

  const resolved: Record<string, ResolvedPackage> = {};
  for (const service of services) {
    const frequency = frequencies[service.id] ?? service.defaultFrequency;
    const preferredProvider = preferredProviders[service.id];
    const explicit = explicitSelections[service.id];
    if (!explicit && service.availability !== "fixed") continue;
    const candidates = packages.filter((item) =>
      item.service_id === service.id
      && (!preferredProvider || item.contractor_id === preferredProvider)
      && (!explicit || item.id === explicit.packageId),
    );

    const livePairs = candidates
      .filter((item) => item.pricing_mode === "fixed" && publiclyEligibleFixedFrequencies({ ...item, tiers: tiers.filter((tier) => tier.package_id === item.id) }, isFrequency(item.default_frequency) ? item.default_frequency : "one-time").includes(frequency))
      .flatMap((item) => tiers
        .filter((tier) => tier.package_id === item.id && Number(tier.price) > 0 && tierPricingFrequency(tier, isFrequency(item.default_frequency) ? item.default_frequency : "one-time") === frequency && tierMatchesAnswers(tier, questionAnswers[service.id] ?? {}))
        .map((tier) => ({ package: item, tier, price: resolveEffectiveTierPrice(tier.price, promotionForPackage(promotions, item.id), serverNow, tiers.filter((candidate) => candidate.package_id === item.id).length) })))
      .sort((left, right) => left.price.effectivePrice - right.price.effectivePrice);
    const explicitPackage = explicit ? candidates.find((item) => item.id === explicit.packageId) : undefined;
    const explicitHasRuleTiers = explicit ? tiers.some((tier) => tier.package_id === explicit.packageId && Boolean(tier.rule_question_key)) : false;
    const selectedPair = explicitHasRuleTiers
      ? livePairs.find((pair) => pair.package.id === explicit?.packageId)
      : explicit?.tierId
      ? livePairs.find((pair) => pair.package.id === explicit.packageId && pair.tier.id === explicit.tierId)
        ?? livePairs.find((pair) => pair.package.id === explicit.packageId)
      : explicit
        ? livePairs.find((pair) => pair.package.id === explicit.packageId)
        : livePairs[0];
    const selectedPackage = explicitPackage ?? selectedPair?.package;
    if (!selectedPackage) continue;

    if (selectedPackage.pricing_mode !== "fixed") {
      resolved[service.id] = {
        packageId: selectedPackage.id,
        pricingMode: isPricingMode(selectedPackage.pricing_mode) ? selectedPackage.pricing_mode : "custom_quote",
        contractorId: selectedPackage.contractor_id,
        price: null,
      };
      continue;
    }

    const tier = selectedPair?.tier;
    const selectedDefaultFrequency = isFrequency(selectedPackage.default_frequency) ? selectedPackage.default_frequency : "one-time";
    if (!tier || tierPricingFrequency(tier, selectedDefaultFrequency) !== frequency) continue;

    const verifiedResult = await supabase.rpc("resolve_package_tier_price", { p_package_id: selectedPackage.id, p_tier_id: tier.id });
    if (verifiedResult.error) throw verifiedResult.error;
    const verified = Array.isArray(verifiedResult.data) ? verifiedResult.data[0] : verifiedResult.data;
    if (!verified || Number(verified.effective_price) <= 0 || Number(verified.base_price) <= 0) continue;

    resolved[service.id] = {
      packageId: selectedPackage.id,
      tierId: tier.id,
      pricingMode: "fixed",
      contractorId: selectedPackage.contractor_id,
      price: Number(verified.effective_price),
      basePrice: Number(verified.base_price),
      promotionId: typeof verified.promotion_id === "string" ? verified.promotion_id : undefined,
      promotionLabel: typeof verified.promotion_label === "string" ? verified.promotion_label : undefined,
    };
  }
  return resolved;
}

function tierMatchesAnswers(
  tier: { rule_question_key: string | null; rule_min: number | null; rule_max: number | null },
  answers: Record<string, string>,
) {
  if (!tier.rule_question_key) return true;
  const answer = Number(answers[tier.rule_question_key]);
  if (!Number.isFinite(answer)) return false;
  if (tier.rule_min != null && answer < Number(tier.rule_min)) return false;
  if (tier.rule_max != null && answer > Number(tier.rule_max)) return false;
  return true;
}

function isPricingMode(value: string): value is PackageSelection["pricingMode"] {
  return value === "fixed" || value === "deposit_quote" || value === "custom_quote";
}

function withoutKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}
