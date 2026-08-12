"use client";

import { useEffect, useMemo, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  CreditCard,
  Droplets,
  Home,
  ImagePlus,
  Info,
  Leaf,
  Loader2,
  LogIn,
  Search,
  ShieldCheck,
  Sparkles,
  Waves,
  Wind,
  Wrench,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  PlanningPlanSummary,
  PlanningServiceCard,
  formatPlanningMoney,
  planningFrequencyLabel,
  planningPrice,
  planningPriceLabel,
  planningSummaryItem,
  type PlanningService,
} from "@/components/planning/ServicePlanning";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServiceCatalog } from "@/hooks/useServiceCatalog";
import { paymentFunctionError } from "@/lib/payments";
import {
  MAX_REQUEST_PHOTOS,
  attachRequestPhotos,
  createRequestPhotoDraft,
  type RequestPhotoDraft,
} from "@/lib/requestPhotos";
import { createClient } from "@/lib/supabase/client";
import type { ServiceProviderProof } from "@/lib/serviceData";
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
type TimeOfDay = "morning" | "afternoon" | "anytime";
type AccessMethod = "someone-home" | "coordinate" | "gate" | "lockbox" | "other";
type PetStatus = "none" | "secured" | "on-property";

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
  categoryId?: string;
  popular?: boolean;
  providerProofs?: ServiceProviderProof[];
  providerProofsByFrequency?: Partial<Record<Frequency, ServiceProviderProof[]>>;
};

type RequestCategory = { id: string; name: string; description: string };

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
const otherServiceId = "general-home-service";
const featuredServiceIds = [
  "lawn-mowing",
  "pool-service",
  "house-cleaning",
  "ac-maintenance",
  "pressure-washing",
  "pest-control",
  "handyman",
  "plumbing-repair",
];

export default function RequestServicePage() {
  const [step, setStep] = useState<Step>("services");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [frequencies, setFrequencies] = useState<Record<string, Frequency>>({});
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("Cape Coral");
  const [stateCode, setStateCode] = useState("FL");
  const [zipCode, setZipCode] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredEndDate, setPreferredEndDate] = useState("");
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("anytime");
  const [description, setDescription] = useState("");
  const [accessMethod, setAccessMethod] = useState<AccessMethod>("someone-home");
  const [petStatus, setPetStatus] = useState<PetStatus>("none");
  const [entryInstructions, setEntryInstructions] = useState("");
  const [parkingNotes, setParkingNotes] = useState("");
  const [otherServiceDetails, setOtherServiceDetails] = useState("");
  const [photos, setPhotos] = useState<RequestPhotoDraft[]>([]);
  const [photoUploadProgress, setPhotoUploadProgress] = useState({ completed: 0, total: 0 });
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
  const { services: catalogServices, categories: catalogCategories, loading: catalogLoading } = useServiceCatalog();

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
        if (typeof value.preferredEndDate === "string") setPreferredEndDate(value.preferredEndDate);
        if (isTimeOfDay(value.timeOfDay)) setTimeOfDay(value.timeOfDay);
        if (typeof value.description === "string") setDescription(value.description);
        if (isAccessMethod(value.accessMethod)) setAccessMethod(value.accessMethod);
        if (isPetStatus(value.petStatus)) setPetStatus(value.petStatus);
        if (typeof value.entryInstructions === "string") setEntryInstructions(value.entryInstructions);
        if (typeof value.parkingNotes === "string") setParkingNotes(value.parkingNotes);
        if (typeof value.otherServiceDetails === "string") setOtherServiceDetails(value.otherServiceDetails);
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
    if (!hydrated || (preferredDate && preferredEndDate)) return;
    const window = defaultPreferredWindow(preferredDate || undefined);
    // The default depends on the homeowner's local calendar, so initialize it after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!preferredDate) setPreferredDate(window.start);
    if (!preferredEndDate) setPreferredEndDate(window.end);
  }, [hydrated, preferredDate, preferredEndDate]);

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
      preferredDate, preferredEndDate, timeOfDay, description, otherServiceDetails,
      accessMethod, petStatus, entryInstructions, parkingNotes,
      firstName, lastName, email, phone, smsUpdates,
      serviceOverrides, preferredProviders, preferredProviderNames,
      packageSelections,
      questionAnswers,
    }));
  }, [accessMethod, city, description, email, entryInstructions, firstName, frequencies, hydrated, isComplete, lastName, otherServiceDetails, packageSelections, parkingNotes, petStatus, phone, preferredDate, preferredEndDate, preferredProviderNames, preferredProviders, questionAnswers, selectedIds, serviceOverrides, smsUpdates, stateCode, step, streetAddress, timeOfDay, zipCode]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step, isComplete]);

  const requestServiceOptions = useMemo(() => {
    const catalogOptions = catalogServices.map((service): ServiceOption => {
      const frequencies = (service.availableFrequencies ?? [service.defaultFrequency]).filter(isFrequency);
      const base: ServiceOption = {
        id: service.id,
        name: service.name,
        description: service.descriptor,
        icon: serviceIcon(service.id, service.categoryId),
        monthlyPrice: 0,
        oneTimePrice: 0,
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
        providerProofs: service.providerProofs,
        providerProofsByFrequency: service.providerProofsByFrequency,
        categoryId: service.categoryId,
        popular: service.popular,
      };
      return { ...base, ...serviceOverrides[service.id] };
    });
    const catalogIds = new Set(catalogOptions.map((service) => service.id));
    const fallbackFeatured = catalogOptions.length >= 6
      ? []
      : serviceOptions
          .filter((service) => service.id !== otherServiceId && !catalogIds.has(service.id))
          .map((service) => ({ ...service, categoryId: fallbackServiceCategory(service.id), availability: "sourcing" as const }));
    const prefilled = Object.entries(serviceOverrides)
      .filter(([id]) => !catalogIds.has(id) && id !== otherServiceId)
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
        categoryId: override.categoryId,
        popular: override.popular,
        providerProofs: override.providerProofs,
        providerProofsByFrequency: override.providerProofsByFrequency,
      }));
    const catchAll = {
      ...serviceOptions.find((service) => service.id === otherServiceId)!,
      availability: "sourcing" as const,
    };
    return [...catalogOptions, ...fallbackFeatured, ...prefilled, catchAll];
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
    if (selectedServices.length === 0) {
      toast.error("Choose at least one service", { description: "Select what your home needs before continuing." });
      return;
    }
    if (selectedIds.includes(otherServiceId) && !otherServiceDetails.trim()) {
      toast.error("Tell us what you need", { description: "Add a short description for Something Else before continuing." });
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
    if (!preferredDate || !preferredEndDate) {
      toast.error("Preferred date window required", { description: "Choose a start and end date so we know what timing works for you." });
      return;
    }
    if (preferredDate < localDateValue(new Date())) {
      toast.error("Choose a future window", { description: "The preferred start date cannot be in the past." });
      return;
    }
    if (preferredEndDate < preferredDate) {
      toast.error("Check the preferred window", { description: "The end date cannot be before the start date." });
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

  function addPhotos(files: File[]) {
    const remaining = MAX_REQUEST_PHOTOS - photos.length;
    if (remaining <= 0) {
      toast.error("Photo limit reached", { description: `You can attach up to ${MAX_REQUEST_PHOTOS} photos.` });
      return;
    }
    const accepted: RequestPhotoDraft[] = [];
    for (const file of files.slice(0, remaining)) {
      try {
        accepted.push(createRequestPhotoDraft(file));
      } catch (reason) {
        toast.error("Photo not added", { description: reason instanceof Error ? reason.message : "Choose a valid image." });
      }
    }
    if (files.length > remaining) {
      toast.info("Photo limit applied", { description: `Only the first ${remaining} remaining photo${remaining === 1 ? "" : "s"} were added.` });
    }
    if (accepted.length > 0) setPhotos((current) => [...current, ...accepted]);
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const removing = current.find((photo) => photo.id === id);
      if (removing) URL.revokeObjectURL(removing.previewUrl);
      return current.filter((photo) => photo.id !== id);
    });
  }

  function handlePhotoDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    addPhotos(Array.from(event.dataTransfer.files));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) {
      toast.error("Contact information required", { description: "Complete all contact fields before submitting." });
      return;
    }
    if (!user) {
      toast.info("Almost done — sign in to confirm", {
        description: photos.length > 0
          ? "Your request details are saved in this browser. For privacy, reattach your photos after signing in."
          : "Your request has been saved in this browser.",
      });
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
          preferred_time: schedulingPreferenceValue(preferredDate, preferredEndDate, timeOfDay),
          description: requestDescription(service, {
            projectNotes: description,
            otherServiceDetails,
            accessMethod,
            petStatus,
            entryInstructions,
            parkingNotes,
          }),
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

      const requestIds = (insertedRequests ?? []).map((request) => request.id).filter(Boolean);
      if (photos.length > 0) {
        setPhotoUploadProgress({ completed: 0, total: photos.length });
        try {
          await attachRequestPhotos({
            supabase,
            userId: user.id,
            requestIds,
            photos,
            onProgress: (completed, total) => setPhotoUploadProgress({ completed, total }),
          });
        } catch (reason) {
          const rollback = requestIds.length
            ? await supabase
                .from("service_requests")
                .delete()
                .in("id", requestIds)
                .eq("customer_id", user.id)
                .eq("status", "pending")
            : { error: null };
          if (rollback.error) {
            console.error("Request photo upload failed and request rollback was unavailable", rollback.error);
            throw new Error("Your request was saved, but its photos could not be attached. Please check your dashboard before trying again.");
          }
          throw new Error(`Your photos could not be uploaded, so no request was submitted. ${errorMessage(reason)}`);
        }
      }

      window.sessionStorage.removeItem(storageKey);
      photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
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
      setPhotoUploadProgress({ completed: 0, total: 0 });
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
              {step === "services" && <ServicesStep services={requestServiceOptions} categories={catalogCategories} catalogLoading={catalogLoading} selectedIds={selectedIds} frequencies={frequencies} preferredProviderNames={preferredProviderNames} otherServiceDetails={otherServiceDetails} onOtherServiceDetails={setOtherServiceDetails} onToggle={toggleService} onFrequencyChange={changeServiceFrequency} estimate={estimate} onContinue={continueFromServices} />}
              {step === "details" && <DetailsStep streetAddress={streetAddress} city={city} stateCode={stateCode} zipCode={zipCode} preferredDate={preferredDate} preferredEndDate={preferredEndDate} timeOfDay={timeOfDay} description={description} accessMethod={accessMethod} petStatus={petStatus} entryInstructions={entryInstructions} parkingNotes={parkingNotes} photos={photos} selectedServices={selectedServices} frequencies={frequencies} packageSelections={packageSelections} questionAnswers={questionAnswers} isSignedIn={!!user} onQuestionAnswer={(serviceId, questionKey, answer) => setQuestionAnswers((current) => ({ ...current, [serviceId]: { ...(current[serviceId] ?? {}), [questionKey]: answer } }))} onStreetAddress={setStreetAddress} onCity={setCity} onStateCode={setStateCode} onZipCode={setZipCode} onPreferredDate={(value) => { setPreferredDate(value); if (preferredEndDate && preferredEndDate < value) setPreferredEndDate(value); }} onPreferredEndDate={setPreferredEndDate} onTimeOfDay={setTimeOfDay} onDescription={setDescription} onAccessMethod={setAccessMethod} onPetStatus={setPetStatus} onEntryInstructions={setEntryInstructions} onParkingNotes={setParkingNotes} onAddPhotos={addPhotos} onRemovePhoto={removePhoto} onPhotoDrop={handlePhotoDrop} onBack={() => setStep("services")} onContinue={continueFromDetails} />}
              {step === "contact" && <ContactStep selectedServices={selectedServices} frequencies={frequencies} preferredProviderNames={preferredProviderNames} estimate={estimate} directCheckoutExpected={directCheckoutExpected} hasQuoteServices={fixedServices.length !== selectedServices.length} preferredDate={preferredDate} preferredEndDate={preferredEndDate} timeOfDay={timeOfDay} accessMethod={accessMethod} petStatus={petStatus} entryInstructions={entryInstructions} parkingNotes={parkingNotes} photos={photos} photoUploadProgress={photoUploadProgress} firstName={firstName} lastName={lastName} email={email} phone={phone} smsUpdates={smsUpdates} isSubmitting={isSubmitting} isSignedIn={!!user} onFirstName={setFirstName} onLastName={setLastName} onEmail={setEmail} onPhone={setPhone} onSmsUpdates={setSmsUpdates} onBack={() => setStep("details")} />}
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
  categories,
  catalogLoading,
  selectedIds,
  frequencies,
  preferredProviderNames,
  otherServiceDetails,
  onOtherServiceDetails,
  onToggle,
  onFrequencyChange,
  estimate,
  onContinue,
}: {
  services: ServiceOption[];
  categories: RequestCategory[];
  catalogLoading: boolean;
  selectedIds: string[];
  frequencies: Record<string, Frequency>;
  preferredProviderNames: Record<string, string>;
  otherServiceDetails: string;
  onOtherServiceDetails: (value: string) => void;
  onToggle: (id: string) => void;
  onFrequencyChange: (id: string, value: Frequency) => void;
  estimate: number;
  onContinue: () => void;
}) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [browseAll, setBrowseAll] = useState(false);
  const [search, setSearch] = useState("");
  const catalogServices = services.filter((service) => service.id !== otherServiceId);
  const catchAll = services.find((service) => service.id === otherServiceId);
  const selected = services.filter((service) => selectedIds.includes(service.id));
  const summaryItems = selected.map((service) => {
    const frequency = frequencies[service.id] ?? service.defaultFrequency;
    return planningSummaryItem(toPlanningService(service), frequency);
  });
  const availableCategories = categories.filter((category) =>
    catalogServices.some((service) => service.categoryId === category.id),
  );
  const featured = catalogServices
    .filter((service) => service.popular || featuredServiceIds.includes(service.id))
    .slice(0, 8);
  const featuredServices = featured.length >= 4 ? featured : catalogServices.slice(0, 8);
  const categoryServices = activeCategory
    ? catalogServices.filter((service) => service.categoryId === activeCategory)
    : [];
  const normalizedSearch = search.trim().toLowerCase();
  const browsableServices = catalogServices.filter((service) =>
    !normalizedSearch
    || `${service.name} ${service.description}`.toLowerCase().includes(normalizedSearch),
  );

  function renderServiceCard(service: ServiceOption, layout: "tile" | "row" = "tile") {
    const frequency = frequencies[service.id] ?? service.defaultFrequency;
    return (
      <PlanningServiceCard
        key={service.id}
        service={toPlanningService(service)}
        selected={selectedIds.includes(service.id)}
        frequency={frequency}
        onToggle={() => onToggle(service.id)}
        onFrequencyChange={(value) => onFrequencyChange(service.id, value)}
        requestedProviderName={preferredProviderNames[service.id]}
        layout={layout}
      />
    );
  }

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
        <div className="space-y-10">
          <section>
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">Popular home services</h3>
                <p className="mt-1 text-sm text-muted-foreground">Start with the services homeowners request most often.</p>
              </div>
              {catalogLoading && <Loader2 className="h-5 w-5 animate-spin text-accent" aria-label="Loading live catalog" />}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {featuredServices.map((service) => renderServiceCard(service))}
            </div>
          </section>

          {availableCategories.length > 0 && (
            <section>
              <div className="mb-4">
                <h3 className="text-lg font-semibold">Explore by service area</h3>
                <p className="mt-1 text-sm text-muted-foreground">Choose a category to see the specific catalog services available to request.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={activeCategory === category.id}
                    onClick={() => setActiveCategory((current) => current === category.id ? null : category.id)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                      activeCategory === category.id
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border-strong bg-card text-muted-foreground hover:border-accent-border hover:text-foreground",
                    )}
                  >
                    {category.name}
                  </button>
                ))}
              </div>
              {activeCategory && (
                <div className="mt-4 space-y-3">
                  {categoryServices.length > 0
                    ? categoryServices.map((service) => renderServiceCard(service, "row"))
                    : <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">No catalog services are currently listed in this category.</p>}
                </div>
              )}
            </section>
          )}

          <section className="rounded-3xl border border-border bg-muted/20 p-5 sm:p-6">
            <button type="button" onClick={() => setBrowseAll((current) => !current)} className="flex w-full items-center justify-between gap-4 text-left">
              <div>
                <h3 className="text-lg font-semibold">Browse all services</h3>
                <p className="mt-1 text-sm text-muted-foreground">Search the full live catalog for a more specific need.</p>
              </div>
              <span className="rounded-full border border-accent-border bg-card px-3 py-1.5 text-xs font-semibold text-sage-dark">{browseAll ? "Close" : `${catalogServices.length} services`}</span>
            </button>
            {browseAll && (
              <div className="mt-5 space-y-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lawn, cleaning, plumbing…" className="h-11 bg-background pl-10" />
                </div>
                <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                  {browsableServices.length > 0
                    ? browsableServices.map((service) => renderServiceCard(service, "row"))
                    : <p className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">No catalog service matches that search. Use Something Else below and tell us what you need.</p>}
                </div>
              </div>
            )}
          </section>

          {catchAll && (
            <section>
              <div className="mb-3">
                <h3 className="text-lg font-semibold">Can&apos;t find the right service?</h3>
                <p className="mt-1 text-sm text-muted-foreground">Use the guided catch-all only for needs that are not represented in the catalog.</p>
              </div>
              {renderServiceCard(catchAll, "row")}
              {selectedIds.includes(otherServiceId) && (
                <div className="mt-3 rounded-2xl border border-accent-border bg-accent-subtle/35 p-4">
                  <Label htmlFor="otherServiceDetails">What service do you need?</Label>
                  <textarea id="otherServiceDetails" rows={3} value={otherServiceDetails} onChange={(event) => onOtherServiceDetails(event.target.value)} placeholder="Describe the work or issue in a sentence or two…" className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
                  <p className="mt-2 text-xs text-muted-foreground">We&apos;ll review the request, source a suitable pro where possible, and confirm pricing before booking.</p>
                </div>
              )}
            </section>
          )}
        </div>

        <PlanningPlanSummary
          items={summaryItems}
          totalRows={[{ key: "priced-today", label: "Priced today", amount: estimate, emphasis: true }]}
          actionLabel="Continue to Your Home"
          onAction={onContinue}
          onRemove={onToggle}
          showMobileBar
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
  preferredEndDate: string;
  timeOfDay: TimeOfDay;
  description: string;
  accessMethod: AccessMethod;
  petStatus: PetStatus;
  entryInstructions: string;
  parkingNotes: string;
  photos: RequestPhotoDraft[];
  selectedServices: ServiceOption[];
  frequencies: Record<string, Frequency>;
  packageSelections: Record<string, PackageSelection>;
  questionAnswers: Record<string, Record<string, string>>;
  isSignedIn: boolean;
  onQuestionAnswer: (serviceId: string, questionKey: string, answer: string) => void;
  onStreetAddress: (value: string) => void;
  onCity: (value: string) => void;
  onStateCode: (value: string) => void;
  onZipCode: (value: string) => void;
  onPreferredDate: (value: string) => void;
  onPreferredEndDate: (value: string) => void;
  onTimeOfDay: (value: TimeOfDay) => void;
  onDescription: (value: string) => void;
  onAccessMethod: (value: AccessMethod) => void;
  onPetStatus: (value: PetStatus) => void;
  onEntryInstructions: (value: string) => void;
  onParkingNotes: (value: string) => void;
  onAddPhotos: (files: File[]) => void;
  onRemovePhoto: (id: string) => void;
  onPhotoDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onBack: () => void;
  onContinue: () => void;
};

function DetailsStep(props: DetailsStepProps) {
  const minDate = localDateValue(new Date());
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

          <div className="rounded-2xl border border-border-strong bg-background p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-sage-dark"><Clock3 className="h-5 w-5" /></span>
              <div>
                <h3 className="font-semibold">When would you prefer service?</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Share your preference—not a guaranteed appointment. We&apos;ll confirm the actual date and time with you.</p>
              </div>
            </div>
            <div className="mt-5 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="preferredDate">Window starts</Label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="preferredDate" type="date" min={minDate} className="h-12 pl-10" value={props.preferredDate} onChange={(event) => props.onPreferredDate(event.target.value)} required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="preferredEndDate">Window ends</Label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="preferredEndDate" type="date" min={props.preferredDate || minDate} className="h-12 pl-10" value={props.preferredEndDate} onChange={(event) => props.onPreferredEndDate(event.target.value)} required />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Choose the date range that works best. A provider will confirm one appointment within or near this window.</p>
              <PreferencePills<TimeOfDay>
                label="Time of day"
                value={props.timeOfDay}
                options={[["morning", "Morning"], ["afternoon", "Afternoon"], ["anytime", "Anytime"]]}
                onChange={props.onTimeOfDay}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border-strong bg-background p-4 sm:p-5">
            <div>
              <h3 className="font-semibold">Access and property details</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Keep access information separate from the project scope so the assigned pro can prepare for arrival.</p>
            </div>
            <div className="mt-5 space-y-5">
              <PreferencePills<AccessMethod>
                label="How will the provider get access?"
                value={props.accessMethod}
                options={[["someone-home", "Someone will be home"], ["coordinate", "Coordinate with me"], ["gate", "Gate access"], ["lockbox", "Lockbox/key"], ["other", "Other"]]}
                onChange={props.onAccessMethod}
              />
              <PreferencePills<PetStatus>
                label="Pets on the property"
                value={props.petStatus}
                options={[["none", "No pets"], ["secured", "Pets will be secured"], ["on-property", "Pets may be present"]]}
                onChange={props.onPetStatus}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="entryInstructions">Gate, entry, or lockbox instructions <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <textarea id="entryInstructions" rows={4} value={props.entryInstructions} onChange={(event) => props.onEntryInstructions(event.target.value)} placeholder="Gate location, access method, where to meet…" className="w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="parkingNotes">Parking or service-location notes <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <textarea id="parkingNotes" rows={4} value={props.parkingNotes} onChange={(event) => props.onParkingNotes(event.target.value)} placeholder="Driveway access, guest parking, work area location…" className="w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Do not enter alarm codes or other sensitive credentials here. Share time-sensitive access codes only after a provider is confirmed.</p>
              </div>
            </div>
          </div>

          {!descriptionIsProminent && (
            <DescriptionField
              value={props.description}
              onChange={props.onDescription}
            />
          )}

          <RequestPhotoPicker
            photos={props.photos}
            isSignedIn={props.isSignedIn}
            onAdd={props.onAddPhotos}
            onRemove={props.onRemovePhoto}
            onDrop={props.onPhotoDrop}
          />
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

function PreferencePills<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([option, optionLabel]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={cn(
              "rounded-full border px-4 py-2 text-sm transition-all",
              value === option
                ? "border-accent bg-accent font-semibold text-accent-foreground shadow-sm"
                : "border-border-strong bg-background text-muted-foreground hover:border-accent-border hover:text-foreground",
            )}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function RequestPhotoPicker({
  photos,
  isSignedIn,
  onAdd,
  onRemove,
  onDrop,
}: {
  photos: RequestPhotoDraft[];
  isSignedIn: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
}) {
  return (
    <section className="rounded-2xl border border-border-strong bg-muted/20 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-sage-dark"><ImagePlus className="h-5 w-5" /></span>
        <div>
          <h3 className="font-semibold">Add helpful photos <span className="font-normal text-muted-foreground">(optional)</span></h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Attach up to {MAX_REQUEST_PHOTOS} JPG, PNG, or WebP images, 8 MB each. They upload securely and are linked to your request when you submit.</p>
        </div>
      </div>

      <label
        htmlFor="requestPhotos"
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
        className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-accent-border bg-background px-5 py-7 text-center transition-colors hover:bg-accent-subtle/30"
      >
        <ImagePlus className="mb-2 h-6 w-6 text-accent" />
        <span className="text-sm font-semibold">Choose photos or drop them here</span>
        <span className="mt-1 text-xs text-muted-foreground">Visible damage, affected areas, or access context can help providers prepare.</span>
        <input
          id="requestPhotos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="sr-only"
          onChange={(event) => {
            onAdd(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </label>

      {!isSignedIn && photos.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Request details persist through sign-in, but browsers cannot safely persist selected files. Reattach these photos after signing in before you submit.</p>
        </div>
      )}

      {photos.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => (
            <div key={photo.id} className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted">
              <Image src={photo.previewUrl} alt={`Request photo preview ${index + 1}`} fill unoptimized className="object-cover" />
              <button type="button" onClick={() => onRemove(photo.id)} aria-label={`Remove photo ${index + 1}`} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-background/95 text-foreground shadow-md transition-colors hover:bg-destructive hover:text-destructive-foreground">
                <X className="h-4 w-4" />
              </button>
              <span className="absolute bottom-2 left-2 rounded-full bg-slate/80 px-2 py-1 text-[10px] font-medium text-white">{index + 1} of {photos.length}</span>
            </div>
          ))}
        </div>
      )}
    </section>
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
            ? "Share the scope, condition, dimensions, or visible issue that will help us match and quote accurately."
            : "Add any final scope or condition details the provider should know."}
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
  preferredDate: string;
  preferredEndDate: string;
  timeOfDay: TimeOfDay;
  accessMethod: AccessMethod;
  petStatus: PetStatus;
  entryInstructions: string;
  parkingNotes: string;
  photos: RequestPhotoDraft[];
  photoUploadProgress: { completed: number; total: number };
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
  const providerProofRows = props.selectedServices.flatMap((service) => {
    const frequency = props.frequencies[service.id] ?? service.defaultFrequency;
    if (service.availability !== "fixed" || servicePrice(service, frequency) <= 0) return [];
    const providers = service.providerProofsByFrequency?.[frequency] ?? service.providerProofs ?? [];
    return providers.length ? [{ service, providers: providers.slice(0, 3) }] : [];
  });

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
          <Card className="border-accent-border bg-accent-subtle/25 shadow-sm">
            <CardHeader>
              <CardTitle>Visit preferences</CardTitle>
              <p className="text-sm text-muted-foreground">These are scheduling preferences. Mercurius or your provider will confirm the actual appointment.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <ReviewDetail label="Window starts" value={props.preferredDate ? formatReviewDate(props.preferredDate) : "Not selected"} />
                <ReviewDetail label="Window ends" value={props.preferredEndDate ? formatReviewDate(props.preferredEndDate) : "Not selected"} />
                <ReviewDetail label="Time of day" value={timeOfDayLabel(props.timeOfDay)} />
              </div>
              <div className="rounded-xl border border-accent-border bg-card p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Access and arrival</p>
                <p className="mt-1 text-sm font-medium">{accessMethodLabel(props.accessMethod)} · {petStatusLabel(props.petStatus)}</p>
                {(props.entryInstructions.trim() || props.parkingNotes.trim()) && (
                  <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                    {props.entryInstructions.trim() && <p><span className="font-medium text-foreground">Entry:</span> {props.entryInstructions.trim()}</p>}
                    {props.parkingNotes.trim() && <p><span className="font-medium text-foreground">Parking/location:</span> {props.parkingNotes.trim()}</p>}
                  </div>
                )}
              </div>
              {providerProofRows.length > 0 && (
                <div className="rounded-xl border border-accent-border bg-card p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Providers behind live rates</p>
                  <div className="mt-3 space-y-3">
                    {providerProofRows.map(({ service, providers }) => (
                      <div key={service.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-medium">{service.name}</p>
                        <div className="flex flex-wrap gap-2">
                          {providers.map((provider) => <ProviderProofLink key={provider.id} provider={provider} />)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="border-t border-accent-border pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">Request photos</p>
                    <p className="mt-1 text-xs text-muted-foreground">{props.photos.length ? `${props.photos.length} photo${props.photos.length === 1 ? "" : "s"} will upload securely when you submit.` : "No photos attached."}</p>
                  </div>
                  {props.photos.length > 0 && <Badge variant="secondary" className="border-accent-border bg-card text-sage-dark">{props.photos.length} attached</Badge>}
                </div>
                {props.photos.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {props.photos.map((photo, index) => (
                      <div key={photo.id} className="relative h-16 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                        <Image src={photo.previewUrl} alt={`Attached request photo ${index + 1}`} fill unoptimized className="object-cover" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

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
            <><Loader2 className="h-4 w-4 animate-spin" /> {props.photoUploadProgress.total > 0 ? `Uploading photos ${props.photoUploadProgress.completed}/${props.photoUploadProgress.total}` : props.directCheckoutExpected ? "Re-checking live rate..." : "Submitting..."}</>
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

function ReviewDetail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-accent-border bg-card p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-1 font-medium">{value}</p></div>;
}

function ProviderProofLink({ provider }: { provider: ServiceProviderProof }) {
  const initials = provider.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("") || "MP";
  return (
    <Link href={`/providers/${provider.id}`} className="inline-flex min-w-0 items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-3 text-xs font-medium transition-colors hover:border-accent-border hover:text-sage-dark">
      {provider.logoUrl
        ? <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-card p-0.5"><Image src={provider.logoUrl} alt="" width={28} height={28} unoptimized className="h-full w-full object-contain" /></span>
        : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">{initials}</span>}
      <span className="max-w-36 truncate">{provider.name}</span>
    </Link>
  );
}

function isTimeOfDay(value: unknown): value is TimeOfDay {
  return value === "morning" || value === "afternoon" || value === "anytime";
}

function isAccessMethod(value: unknown): value is AccessMethod {
  return value === "someone-home" || value === "coordinate" || value === "gate" || value === "lockbox" || value === "other";
}

function isPetStatus(value: unknown): value is PetStatus {
  return value === "none" || value === "secured" || value === "on-property";
}

function timeOfDayLabel(value: TimeOfDay) {
  return value === "morning" ? "Morning" : value === "afternoon" ? "Afternoon" : "Anytime";
}

function accessMethodLabel(value: AccessMethod) {
  if (value === "someone-home") return "Someone will be home";
  if (value === "coordinate") return "Coordinate access";
  if (value === "gate") return "Gate access";
  if (value === "lockbox") return "Lockbox or key access";
  return "Other access method";
}

function petStatusLabel(value: PetStatus) {
  return value === "none" ? "No pets" : value === "secured" ? "Pets will be secured" : "Pets may be present";
}

function schedulingPreferenceValue(start: string, end: string, timeOfDay: TimeOfDay) {
  const endSummary = end && end !== start ? ` through ${formatReviewDate(end)}` : "";
  return `Preferred window: ${formatReviewDate(start)}${endSummary} · ${timeOfDayLabel(timeOfDay)}`;
}

function formatReviewDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function requestDescription(service: ServiceOption, details: {
  projectNotes: string;
  otherServiceDetails: string;
  accessMethod: AccessMethod;
  petStatus: PetStatus;
  entryInstructions: string;
  parkingNotes: string;
}) {
  const projectNotes = details.projectNotes.trim();
  const scope = service.id === otherServiceId
    ? [`Requested service: ${details.otherServiceDetails.trim()}`, projectNotes].filter(Boolean).join("\n")
    : projectNotes;
  const access = [
    `Access method: ${accessMethodLabel(details.accessMethod)}`,
    `Pets: ${petStatusLabel(details.petStatus)}`,
    details.entryInstructions.trim() ? `Entry instructions: ${details.entryInstructions.trim()}` : "",
    details.parkingNotes.trim() ? `Parking/location: ${details.parkingNotes.trim()}` : "",
  ].filter(Boolean).join("\n");
  return [`Project details:\n${scope || "No additional project notes provided."}`, `Access and arrival:\n${access}`].join("\n\n");
}

function defaultPreferredWindow(existingStart?: string) {
  const start = existingStart ? new Date(`${existingStart}T12:00:00`) : new Date();
  if (!existingStart) start.setDate(start.getDate() + 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 3);
  return { start: localDateValue(start), end: localDateValue(end) };
}

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function serviceIcon(id: string, categoryId?: string) {
  const known = serviceOptions.find((service) => service.id === id)?.icon;
  if (known) return known;
  if (categoryId?.includes("clean")) return Sparkles;
  if (categoryId?.includes("lawn") || categoryId?.includes("landscap")) return Leaf;
  if (categoryId?.includes("pool")) return Waves;
  if (categoryId?.includes("hvac") || categoryId?.includes("mechanical")) return Wind;
  if (categoryId?.includes("pest")) return Bug;
  if (categoryId?.includes("outdoor") || categoryId?.includes("exterior")) return Droplets;
  if (categoryId?.includes("repair") || categoryId?.includes("trade")) return Wrench;
  return Home;
}

function fallbackServiceCategory(id: string) {
  if (id.includes("lawn")) return "lawn-landscape";
  if (id.includes("pool")) return "pool-service";
  if (id.includes("clean")) return "cleaning";
  if (id.includes("ac-")) return "hvac-mechanical";
  if (id.includes("pressure")) return "outdoor-exterior";
  if (id.includes("pest")) return "pest-control";
  return "repairs-trades";
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : "Please check the files and try again.";
}

function servicePrice(service: ServiceOption, frequency: Frequency) {
  return planningPrice(toPlanningService(service), frequency);
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
  return planningPriceLabel(toPlanningService(service), frequency);
}

function formatMoney(value: number) {
  return formatPlanningMoney(value);
}

function frequencyLabel(frequency: Frequency) {
  return planningFrequencyLabel(frequency);
}

function toPlanningService(service: ServiceOption): PlanningService {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    icon: service.icon,
    availability: service.availability ?? "sourcing",
    defaultFrequency: service.defaultFrequency,
    frequencies: service.frequencies,
    prices: service.livePrices ?? {},
    basePrices: service.basePrices,
    promotionLabels: service.promotionLabels,
    promotionIds: service.promotionIds,
    packageSelections: service.packageSelections,
    providerProofs: service.providerProofs,
    providerProofsByFrequency: service.providerProofsByFrequency,
  };
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
