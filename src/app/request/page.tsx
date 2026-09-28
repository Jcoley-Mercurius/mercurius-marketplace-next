"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent, ReactNode } from "react";
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
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Waves,
  Wind,
  Wrench,
  X,
} from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { IntakeTrapField, useIntakeGuard } from "@/components/marketing/IntakeGuard";
import {
  PlanningPlanSummary,
  PlanningServiceCard,
  formatPlanningMoney,
  planningFrequencyLabel,
  planningPrice,
  planningSummaryItem,
  type PlanningService,
} from "@/components/planning/ServicePlanning";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { InterestConfirmation, RequestConfirmation } from "@/components/request/RequestConfirmation";
import { ServiceAvailabilityList, type AvailabilityItem } from "@/components/request/ServiceAvailabilityList";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { FormErrorSummary, FormErrorsContext, type FormErrors } from "@/components/ui/form-errors";
import { Checkbox } from "@/components/ui/checkbox";
import { PageState } from "@/components/ui/page-state";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui/workflow-stepper";
import { useServiceCatalog } from "@/hooks/useServiceCatalog";
import { paymentFunctionError, sameOriginReviewUrl } from "@/lib/payments";
import {
  describeConfirmation,
  intakeCheckoutAllowed,
  intakeMatchingAllowed,
  type CheckoutState,
  type MatchingStart,
  type RequestReadback,
} from "@/lib/requestConfirmation";
import {
  resolveRequestCoverage,
  type RequestCoverageResult,
  type RequestCoverageStatus,
} from "@/lib/requestCoverage";
import {
  addDays,
  clearDraftStorage,
  easternDateValue,
  emptyDraft,
  parseDraft,
  parsePackageSelection,
  readDraftStorage,
  reconcileDraftActor,
  writeDraftStorage,
  type AccessMethod,
  type DraftServiceOverride,
  type DraftStep,
  type PetStatus,
  type RequestDraft,
  type SavedSubmission,
  type TimeOfDay,
} from "@/lib/requestDraft";
import {
  MAX_REQUEST_PHOTOS,
  RequestPhotoError,
  attachRequestPhotos,
  createRequestPhotoDraft,
  discardUnattachedRequestPhotos,
  selectRequestPhotos,
  type RequestPhotoDraft,
} from "@/lib/requestPhotos";
import {
  parsePreviewResult,
  planIsSubmittable,
  previewSignature,
  serviceAvailability,
  type PreviewResult,
  type PreviewSelection,
  type PreviewStage,
  type ServiceAvailability,
} from "@/lib/requestPreview";
import {
  isSubmissionKeyConflict,
  newSubmissionKey,
  parseSubmissionResult,
  refusalMessage,
  submissionValidationMessage,
  type SubmissionPayload,
  type SubmissionResult,
} from "@/lib/requestSubmission";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  isPricingFrequency,
  type PackageQualifyingQuestion,
  type PricingFrequency,
  type PublicPackageSelection,
} from "@/lib/vendorPricing";

type Step = DraftStep;
type Frequency = PricingFrequency;

type ServiceOption = {
  id: string;
  name: string;
  description: string;
  icon: typeof Leaf;
  defaultFrequency: Frequency;
  frequencies: Frequency[];
  /** Lowest published network rates. Display hints only; the address check decides. */
  livePrices?: Partial<Record<Frequency, number>>;
  /** Frequencies whose published rate carries a promotion (DEC-2026-015: not offered). */
  promotedFrequencies?: Frequency[];
  availability?: "fixed" | "quote" | "sourcing";
  categoryId?: string;
  popular?: boolean;
};

type RequestCategory = { id: string; name: string; description: string };

type BuilderRequestedService = { id: string; name: string; availability: "fixed" | "quote" | "sourcing"; descriptor?: string; defaultFrequency?: Frequency; frequencies?: Frequency[]; prices?: Partial<Record<Frequency, number>>; packageId?: string; tierId?: string; pricingMode?: "fixed" | "deposit_quote" | "custom_quote"; questions?: PackageQualifyingQuestion[]; packageName?: string; packageDescription?: string | null; tierName?: string; tierIncludes?: string[]; preferredContractorId?: string; preferredContractorName?: string };
type Completion = { kind: "coverage"; status: "waitlist" | "uncovered"; services: string[] } | { kind: "interest"; services: string[] };
type PreviewState = { signature: string; status: "checking" | "ready" | "error"; result: PreviewResult | null };
type PostSave = {
  loading: boolean;
  readback: RequestReadback[] | null;
  readbackFailed: boolean;
  matching: Record<string, MatchingStart>;
  checkout: CheckoutState;
  checkoutBusy: boolean;
  checkoutError: string | null;
  photoError: string | null;
  photoBusy: boolean;
  photoProgress: { completed: number; total: number };
};

const serviceOptions: ServiceOption[] = [
  { id: "lawn-mowing", name: "Lawn Mowing", description: "Mowing, edging, and cleanup", icon: Leaf, defaultFrequency: "weekly", frequencies: ["weekly", "monthly", "one-time"] },
  { id: "pool-service", name: "Pool Service", description: "Cleaning, chemicals, and equipment check", icon: Waves, defaultFrequency: "weekly", frequencies: ["weekly", "monthly", "one-time"] },
  { id: "house-cleaning", name: "House Cleaning", description: "A fresh, professionally cleaned home", icon: Sparkles, defaultFrequency: "monthly", frequencies: ["monthly", "one-time"] },
  { id: "ac-maintenance", name: "A/C Maintenance", description: "Seasonal tune-up and system inspection", icon: Wind, defaultFrequency: "quarterly", frequencies: ["quarterly", "one-time"] },
  { id: "pressure-washing", name: "Pressure Washing", description: "Driveways, patios, and exterior surfaces", icon: Droplets, defaultFrequency: "quarterly", frequencies: ["quarterly", "one-time"] },
  { id: "pest-control", name: "Pest Control", description: "Interior and exterior home protection", icon: Bug, defaultFrequency: "monthly", frequencies: ["monthly", "quarterly", "one-time"] },
  { id: "handyman", name: "Handyman Service", description: "Small repairs and home projects", icon: Wrench, defaultFrequency: "one-time", frequencies: ["monthly", "one-time"] },
  { id: "general-home-service", name: "Something Else", description: "Tell us what your home needs", icon: Home, defaultFrequency: "one-time", frequencies: ["one-time"] },
];

const stepOrder: Step[] = ["services", "details", "contact"];
const stepLabels: Record<Step, string> = { services: "Services", details: "Your home", contact: "Review" };
const otherServiceId = "general-home-service";
const serviceIdPattern = /^[a-z0-9-]{1,100}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

function browserStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function prefersReducedMotion() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export default function RequestServicePage() {
  const [errors, setErrors] = useState<FormErrors>({});
  const formRef = useRef<HTMLFormElement>(null);
  const focusNextStep = useRef(false);
  const submitting = useRef(false);
  const { trapRef, intakePayload } = useIntakeGuard();
  const [draft, setDraft] = useState<RequestDraft>(() => emptyDraft(""));
  const [hydrated, setHydrated] = useState(false);
  const [actorChecked, setActorChecked] = useState(false);
  const [held, setHeld] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [photos, setPhotos] = useState<RequestPhotoDraft[]>([]);
  const [photoMessages, setPhotoMessages] = useState<string[]>([]);
  const [photoUploadProgress, setPhotoUploadProgress] = useState({ completed: 0, total: 0 });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [coverageStatus, setCoverageStatus] = useState<RequestCoverageStatus>("idle");
  const [coverageResult, setCoverageResult] = useState<RequestCoverageResult | null>(null);
  const [availabilityPreview, setAvailabilityPreview] = useState<PreviewState | null>(null);
  const [finalPreview, setFinalPreview] = useState<PreviewState | null>(null);
  const [interestSentFor, setInterestSentFor] = useState<string[]>([]);
  const [submissionUnknown, setSubmissionUnknown] = useState(false);
  const [keyConflict, setKeyConflict] = useState(false);
  const [postSave, setPostSave] = useState<PostSave | null>(null);
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { services: catalogServices, categories: catalogCategories, loading: catalogLoading, error: catalogError, retry: retryCatalog } = useServiceCatalog();

  const {
    step, selectedIds, frequencies, streetAddress, city, stateCode, zipCode, preferredDate, preferredEndDate,
    timeOfDay, description, accessMethod, petStatus, entryInstructions, parkingNotes, otherServiceDetails,
    firstName, lastName, email, phone, smsUpdates, serviceOverrides, preferredProviders, preferredProviderNames,
    packageSelections, questionAnswers, submissionKey, saved,
  } = draft;
  const update = useCallback((patch: Partial<RequestDraft> | ((current: RequestDraft) => Partial<RequestDraft>)) => {
    setDraft((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) }));
  }, []);

  // Restore this tab's draft, then apply an explicit plan-builder or provider-page entry.
  useEffect(() => {
    const storage = browserStorage();
    const today = easternDateValue(new Date());
    const stored = readDraftStorage(storage);
    const restored = parseDraft(stored.raw, newSubmissionKey(), today);
    let next = restored.draft;
    const messages: string[] = [];
    if (!stored.available) messages.push("This browser isn’t saving your progress, so keep this tab open until you submit.");
    if (restored.dropped.includes("draft")) messages.push("We couldn’t restore your earlier request details, so this is a fresh start.");
    else if (restored.dropped.some((field) => field === "preferredDate" || field === "preferredEndDate")) messages.push("Your earlier preferred dates have passed, so we suggested new ones.");

    let builderRaw: string | null = null;
    let providerRaw: string | null = null;
    try {
      builderRaw = storage?.getItem("homePlanSelection") ?? null;
      providerRaw = storage?.getItem("preferredProviderSelection") ?? null;
      storage?.removeItem("homePlanSelection");
      storage?.removeItem("preferredProviderSelection");
    } catch {
      // Storage already reported above; an entry that can't be read is simply not imported.
    }
    const query = new URLSearchParams(window.location.search);
    const requestedServiceId = query.get("service");
    const entering = Boolean(builderRaw || (requestedServiceId && serviceIdPattern.test(requestedServiceId)));
    // A new explicit entry starts a new draft; a saved request stays in the dashboard.
    if (entering && next.saved) next = emptyDraft(newSubmissionKey());

    try {
      const builder = builderRaw ? JSON.parse(builderRaw) as { selectedServiceIds?: unknown; frequencies?: unknown; requestedServices?: unknown; matchingZip?: unknown } : null;
      const provider = providerRaw ? JSON.parse(providerRaw) as { contractorId?: unknown; contractorName?: unknown; serviceId?: unknown } : null;
      if (builder) next = importBuilder(next, builder, provider);
      if (requestedServiceId && serviceIdPattern.test(requestedServiceId) && !builder) {
        const known = serviceOptions.find((service) => service.id === requestedServiceId);
        const requestedName = query.get("requested");
        next = {
          ...next,
          selectedIds: next.selectedIds.includes(requestedServiceId) ? next.selectedIds : [...next.selectedIds, requestedServiceId],
          frequencies: next.frequencies[requestedServiceId] ? next.frequencies : { ...next.frequencies, [requestedServiceId]: known?.defaultFrequency ?? "one-time" },
          serviceOverrides: requestedName && !known && !next.serviceOverrides[requestedServiceId]
            ? { ...next.serviceOverrides, [requestedServiceId]: { name: requestedName.slice(0, 200), description: "Provider-specific service", defaultFrequency: "one-time", frequencies: ["one-time"] } }
            : next.serviceOverrides,
        };
      }
      const providerId = typeof provider?.contractorId === "string" ? provider.contractorId : query.get("provider");
      const providerName = typeof provider?.contractorName === "string" ? provider.contractorName : query.get("providerName");
      const providerServiceId = typeof provider?.serviceId === "string" ? provider.serviceId : requestedServiceId;
      if (providerId && uuidPattern.test(providerId) && providerServiceId && serviceIdPattern.test(providerServiceId)) {
        next = {
          ...next,
          preferredProviders: { ...next.preferredProviders, [providerServiceId]: providerId },
          preferredProviderNames: providerName ? { ...next.preferredProviderNames, [providerServiceId]: providerName.slice(0, 200) } : next.preferredProviderNames,
        };
      }
    } catch {
      messages.push("We couldn’t read the plan you started, so choose your services again.");
    }
    if (!next.preferredDate) next = { ...next, preferredDate: addDays(today, 1) };
    if (!next.preferredEndDate) next = { ...next, preferredEndDate: addDays(next.preferredDate, 3) };
    // Restoring a browser-only draft necessarily hydrates the controlled form after mount.
    setDraft(next);
    // A payload sent without a confirmed answer is resolved before anything else is submitted.
    setSubmissionUnknown(Boolean(next.inFlight && !next.saved));
    setStorageAvailable(stored.available);
    setNotice(messages.join(" ") || null);
    setHydrated(true);
  }, []);

  // Bind the draft to the account that continues it once the session is known.
  useEffect(() => {
    if (!hydrated || authLoading) return;
    const decision = reconcileDraftActor(draft, user?.id ?? null);
    // Account changes arrive asynchronously; the draft follows the signed-in actor.
    setHeld(decision.action === "hold");
    if (decision.action === "adopt") setDraft(decision.draft);
    if (decision.action === "discard") {
      photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      setPhotos([]);
      setPostSave(null);
      setFinalPreview(null);
      setAvailabilityPreview(null);
      setSubmissionUnknown(false);
      setKeyConflict(false);
      setDraft({ ...emptyDraft(newSubmissionKey()), ownerId: user?.id ?? null, preferredDate: addDays(easternDateValue(new Date()), 1), preferredEndDate: addDays(easternDateValue(new Date()), 4) });
      setNotice("A request started by another account was cleared from this browser.");
    }
    setActorChecked(true);
    // Only the actor and ownership fields decide this; other edits must not re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, authLoading, user?.id, draft.ownerId, draft.saved?.actorId]);

  useEffect(() => {
    if (!user) return;
    const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
    const [givenName, ...familyName] = fullName.split(" ");
    // Auth metadata arrives asynchronously and only fills fields the user has not edited.
    update((current) => ({
      firstName: current.firstName || givenName || "",
      lastName: current.lastName || familyName.join(" "),
      email: current.email || user.email || "",
    }));
  }, [update, user]);

  useEffect(() => {
    if (!hydrated || held) return;
    const result = writeDraftStorage(browserStorage(), draft);
    // Storage can fail at any write (quota, privacy mode); say so instead of implying it saved.
    setStorageAvailable(result.ok);
  }, [draft, held, hydrated]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [step, completion, saved?.submissionKey]);

  // Coverage is checked against the exact ZIP as it changes.
  useEffect(() => {
    const normalizedZip = zipCode.trim().slice(0, 5);
    if (!/^\d{5}$/.test(normalizedZip)) {
      const reset = window.setTimeout(() => {
        setCoverageStatus("idle");
        setCoverageResult(null);
      }, 0);
      return () => window.clearTimeout(reset);
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setCoverageStatus("checking");
      const result = await resolveRequestCoverage({ zipCode: normalizedZip, city, state: stateCode });
      if (!active) return;
      setCoverageResult(result);
      setCoverageStatus(result.status);
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [city, stateCode, zipCode]);

  const requestServiceOptions = useMemo(() => {
    const catalogOptions = catalogServices.map((service): ServiceOption => {
      const frequencies = (service.availableFrequencies ?? [service.defaultFrequency]).filter(isPricingFrequency);
      const promoted = Object.entries(service.promotionIds ?? {}).filter(([frequency, id]) => isPricingFrequency(frequency) && id).map(([frequency]) => frequency as Frequency);
      const prices: Partial<Record<Frequency, number>> = service.availability === "fixed" ? {
        weekly: service.weeklyPrice ?? 0,
        "bi-monthly": service.biMonthlyPrice ?? 0,
        monthly: service.avgMonthlyPrice,
        quarterly: service.quarterlyPrice ?? 0,
        "one-time": service.oneTimePrice,
      } : {};
      // A promoted rate is never shown or offered on the intake (DEC-2026-015).
      promoted.forEach((frequency) => { delete prices[frequency]; });
      const base: ServiceOption = {
        id: service.id,
        name: service.name,
        description: service.descriptor,
        icon: serviceIcon(service.id, service.categoryId),
        defaultFrequency: isPricingFrequency(service.defaultFrequency) ? service.defaultFrequency : "one-time",
        frequencies: frequencies.length ? frequencies : ["one-time"],
        availability: service.availability ?? "sourcing",
        livePrices: prices,
        promotedFrequencies: promoted,
        categoryId: service.categoryId,
        popular: service.popular,
      };
      return withOverride(base, serviceOverrides[service.id]);
    });
    const catalogIds = new Set(catalogOptions.map((service) => service.id));
    const fallbackFeatured = catalogOptions.length >= 6
      ? []
      : serviceOptions
          .filter((service) => service.id !== otherServiceId && !catalogIds.has(service.id))
          .map((service) => ({ ...service, categoryId: fallbackServiceCategory(service.id), availability: "sourcing" as const }));
    const prefilled = Object.entries(serviceOverrides)
      .filter(([id]) => !catalogIds.has(id) && id !== otherServiceId)
      .map(([id, override]): ServiceOption => withOverride({
        id,
        name: formatServiceName(id),
        description: "Tell us what you need.",
        icon: Home,
        defaultFrequency: "one-time",
        frequencies: ["one-time"],
        availability: "sourcing",
      }, override));
    const catchAll = { ...serviceOptions.find((service) => service.id === otherServiceId)!, availability: "sourcing" as const };
    return [...catalogOptions, ...fallbackFeatured, ...prefilled, catchAll];
  }, [catalogServices, serviceOverrides]);
  const selectedServices = useMemo(() => requestServiceOptions.filter((service) => selectedIds.includes(service.id)), [requestServiceOptions, selectedIds]);
  const normalizedZip = zipCode.trim().slice(0, 5);

  const explicitSelection = useCallback((serviceId: string) => packageSelections[serviceId], [packageSelections]);

  const previewSelections = useCallback((stage: PreviewStage): PreviewSelection[] => selectedServices.map((service) => {
    const selection = explicitSelection(service.id);
    const answers = questionAnswers[service.id];
    return {
      service_id: service.id,
      frequency: frequencies[service.id] ?? service.defaultFrequency,
      ...(preferredProviders[service.id] ? { preferred_contractor_id: preferredProviders[service.id] } : {}),
      ...(selection ? { package_id: selection.packageId } : {}),
      ...(selection?.tierId ? { tier_id: selection.tierId } : {}),
      ...(stage === "final" && answers && Object.keys(answers).length ? { answers } : {}),
    };
  }), [explicitSelection, frequencies, preferredProviders, questionAnswers, selectedServices]);

  const runPreview = useCallback(async (stage: PreviewStage): Promise<PreviewState> => {
    const selections = previewSelections(stage);
    const signature = previewSignature(stage, normalizedZip, selections);
    const setState = stage === "final" ? setFinalPreview : setAvailabilityPreview;
    setState((current) => ({ signature, status: "checking", result: current?.signature === signature ? current.result : null }));
    let state: PreviewState;
    try {
      const { data, error } = await createClient().rpc("preview_service_request_selections", {
        p_payload: { stage, location: { zip_code: normalizedZip }, selections },
      });
      if (error) throw error;
      state = { signature, status: "ready", result: parsePreviewResult(data, selections.length) };
    } catch {
      state = { signature, status: "error", result: null };
    }
    // Only the answer for the current input is applied; an older response is dropped.
    setState((current) => current?.signature === signature ? state : current);
    return state;
  }, [normalizedZip, previewSelections]);

  const availabilitySignature = previewSignature("availability", normalizedZip, previewSelections("availability"));
  const finalSignature = previewSignature("final", normalizedZip, previewSelections("final"));

  // Once location and configuration are known, each selection's local outcome is checked early.
  useEffect(() => {
    if (coverageStatus !== "covered" || selectedServices.length === 0 || saved) return;
    if (availabilityPreview?.signature === availabilitySignature) return;
    const timer = window.setTimeout(() => { void runPreview("availability"); }, 300);
    return () => window.clearTimeout(timer);
  }, [availabilityPreview?.signature, availabilitySignature, coverageStatus, runPreview, saved, selectedServices.length]);

  useEffect(() => {
    if (step !== "contact" || coverageStatus !== "covered" || selectedServices.length === 0 || saved) return;
    if (finalPreview?.signature === finalSignature) return;
    const timer = window.setTimeout(() => { void runPreview("final"); }, 150);
    return () => window.clearTimeout(timer);
  }, [coverageStatus, finalPreview?.signature, finalSignature, runPreview, saved, selectedServices.length, step]);

  const currentPreview = (stage: PreviewStage) => {
    const state = stage === "final" ? finalPreview : availabilityPreview;
    const signature = stage === "final" ? finalSignature : availabilitySignature;
    return state?.signature === signature ? state : null;
  };
  const availabilityFor = (stage: PreviewStage, serviceId: string): ServiceAvailability | "error" | undefined => {
    const state = currentPreview(stage);
    if (!state || state.status === "checking") return undefined;
    if (state.status === "error" || !state.result) return "error";
    const index = selectedServices.findIndex((service) => service.id === serviceId);
    const outcome = state.result.outcomes.find((item) => item.selection_index === index);
    return outcome ? serviceAvailability(outcome) : "error";
  };

  /** Questions to ask: the chosen offering's, else those of the offering the address check found. */
  const questionsFor = (serviceId: string): PackageQualifyingQuestion[] => {
    const explicit = explicitSelection(serviceId)?.questions;
    if (explicit?.length) return explicit;
    const availability = availabilityFor("availability", serviceId);
    const final = availabilityFor("final", serviceId);
    const outcome = (final && final !== "error" ? final.outcome : null) ?? (availability && availability !== "error" ? availability.outcome : null);
    return outcome?.question_details ?? [];
  };

  const stepIndex = stepOrder.indexOf(step);

  function toggleService(id: string) {
    const removing = selectedIds.includes(id);
    if (removing) {
      update((current) => ({
        selectedIds: current.selectedIds.filter((serviceId) => serviceId !== id),
        preferredProviders: withoutKey(current.preferredProviders, id),
        preferredProviderNames: withoutKey(current.preferredProviderNames, id),
        packageSelections: withoutKey(current.packageSelections, id),
        questionAnswers: withoutKey(current.questionAnswers, id),
      }));
      setErrors((current) => withoutKey(withoutKey(current, `availability-${id}`), `submission-${id}`));
      return;
    }
    const service = requestServiceOptions.find((item) => item.id === id);
    const requested = frequencies[id] ?? service?.defaultFrequency;
    const firstLive = service?.frequencies.find((item) => servicePrice(service, item) > 0);
    const frequency = requested && service && servicePrice(service, requested) > 0 ? requested : firstLive ?? requested;
    update((current) => ({
      selectedIds: [...current.selectedIds, id],
      frequencies: frequency ? { ...current.frequencies, [id]: frequency } : current.frequencies,
    }));
  }

  function changeServiceFrequency(id: string, frequency: Frequency) {
    // An offering and its answers belong to one frequency; changing it clears them.
    update((current) => ({
      frequencies: { ...current.frequencies, [id]: frequency },
      packageSelections: current.packageSelections[id] && !current.serviceOverrides[id]?.packageSelections?.[frequency]
        ? withoutKey(current.packageSelections, id)
        : current.serviceOverrides[id]?.packageSelections?.[frequency]
          ? { ...current.packageSelections, [id]: current.serviceOverrides[id]!.packageSelections![frequency]! }
          : current.packageSelections,
      questionAnswers: withoutKey(current.questionAnswers, id),
    }));
  }

  function changeStep(next: Step) {
    setErrors({});
    focusNextStep.current = true;
    update({ step: next });
  }

  useEffect(() => {
    if (focusNextStep.current) {
      formRef.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus();
      focusNextStep.current = false;
    }
  }, [step]);

  function continueFromServices() {
    if (selectedServices.length === 0) {
      setErrors({ "request-step": "Choose at least one service before continuing." });
      return;
    }
    if (selectedIds.includes(otherServiceId) && !otherServiceDetails.trim()) {
      setErrors({ otherServiceDetails: "Describe the work you need for Something Else." });
      return;
    }
    changeStep("details");
  }

  async function verifyCoverage() {
    setCoverageStatus("checking");
    const result = await resolveRequestCoverage({ zipCode, city, state: stateCode });
    setCoverageResult(result);
    setCoverageStatus(result.status);
    return result;
  }

  async function continueFromDetails() {
    const today = easternDateValue(new Date());
    const nextErrors: FormErrors = {};
    if (!streetAddress.trim()) nextErrors.streetAddress = "Enter the service street address.";
    if (!city.trim()) nextErrors.city = "Enter the service city.";
    if (!/^[A-Za-z]{2}$/.test(stateCode.trim())) nextErrors.state = "Use a two-letter state code, such as FL.";
    if (!/^\d{5}(-\d{4})?$/.test(zipCode.trim())) nextErrors.zip = "Enter a valid five-digit ZIP code.";
    if (!preferredDate) nextErrors.preferredDate = "Choose the start of your preferred date window.";
    else if (preferredDate < today) nextErrors.preferredDate = "The preferred start date can’t be in the past (Eastern Time).";
    if (!preferredEndDate) nextErrors.preferredEndDate = "Choose the end of your preferred date window.";
    else if (preferredEndDate < preferredDate) nextErrors.preferredEndDate = "The end date can’t be before the start date.";
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }
    const currentCoverage = await verifyCoverage();
    if (currentCoverage.status === "covered") {
      const unanswered = selectedServices.flatMap((service) =>
        questionsFor(service.id)
          .filter((question) => question.is_required !== false && !questionAnswers[service.id]?.[question.question_key]?.trim())
          .map((question) => [`question-${service.id}-${question.question_key}`, `${service.name}: answer “${question.question_label}”.`]),
      );
      if (unanswered.length) {
        setErrors(Object.fromEntries(unanswered));
        return;
      }
      // Answers can change the price or availability, so confirm them before review.
      const final = await runPreview("final");
      const missing = final.result?.outcomes.filter((outcome) => outcome.outcome === "answers_required") ?? [];
      if (missing.length) {
        setErrors(Object.fromEntries(missing.flatMap((outcome) => (outcome.questions ?? []).map((key) => {
          const question = outcome.question_details?.find((item) => item.question_key === key);
          return [`question-${outcome.service_id}-${key}`, `Answer “${question?.question_label ?? key}”.`];
        }))));
        return;
      }
    }
    changeStep("contact");
  }

  function addPhotos(files: File[]) {
    const selection = selectRequestPhotos(files, photos.length);
    const messages = [...selection.rejected];
    if (selection.overLimit > 0) messages.push(`You can attach up to ${MAX_REQUEST_PHOTOS} photos, so ${selection.overLimit} ${selection.overLimit === 1 ? "wasn’t" : "weren’t"} added.`);
    setPhotoMessages(messages);
    if (selection.accepted.length > 0) setPhotos((current) => [...current, ...selection.accepted.map(createRequestPhotoDraft)]);
  }

  function removePhoto(id: string) {
    setPhotos((current) => {
      const removing = current.find((photo) => photo.id === id);
      if (removing) URL.revokeObjectURL(removing.previewUrl);
      return current.filter((photo) => photo.id !== id);
    });
    setPhotoMessages([]);
  }

  function handlePhotoDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    addPhotos(Array.from(event.dataTransfer.files));
  }

  // Consent to any eligible provider: clears the preference and everything bound to it.
  function allowAnyProvider(serviceId: string) {
    update((current) => ({
      preferredProviders: withoutKey(current.preferredProviders, serviceId),
      preferredProviderNames: withoutKey(current.preferredProviderNames, serviceId),
      packageSelections: withoutKey(current.packageSelections, serviceId),
      questionAnswers: withoutKey(current.questionAnswers, serviceId),
      serviceOverrides: current.serviceOverrides[serviceId]
        ? { ...current.serviceOverrides, [serviceId]: { ...current.serviceOverrides[serviceId], packageSelections: undefined } }
        : current.serviceOverrides,
    }));
    setErrors((current) => withoutKey(withoutKey(current, `availability-${serviceId}`), `submission-${serviceId}`));
  }

  function removeService(serviceId: string) {
    if (selectedIds.includes(serviceId)) toggleService(serviceId);
  }

  function contactErrors() {
    const nextErrors: FormErrors = {};
    for (const [id, value, label] of [["firstName", firstName, "first name"], ["lastName", lastName, "last name"], ["email", email, "email"], ["phone", phone, "phone number"]]) {
      if (!value.trim()) nextErrors[id] = `Enter your ${label}.`;
    }
    const emailInput = formRef.current?.querySelector<HTMLInputElement>("#email");
    if (email.trim() && (emailInput?.validity.typeMismatch || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) nextErrors.email = "Enter a valid email address.";
    return nextErrors;
  }

  async function registerServiceInterest(serviceId: string) {
    const missing = contactErrors();
    if (Object.keys(missing).length) {
      setErrors(missing);
      return;
    }
    const service = selectedServices.find((item) => item.id === serviceId);
    try {
      const response = await fetch("/api/contact-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          subject: `Service interest — ${normalizedZip}`,
          message: [
            "Service interest submitted from /request.",
            `Service: ${service?.name ?? formatServiceName(serviceId)} (not available yet in this area)`,
            serviceId === otherServiceId && otherServiceDetails.trim() ? `Requested work: ${otherServiceDetails.trim()}` : "",
            `Location: ${city.trim()}, ${stateCode.trim().toUpperCase()} ${normalizedZip}`,
            "No service_request was created. No provider was assigned. No payment was collected.",
          ].filter(Boolean).join("\n"),
          intake: intakePayload(),
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "We couldn’t save your interest.");
      setInterestSentFor((current) => [...current, serviceId]);
      setErrors((current) => withoutKey(current, `interest-${serviceId}`));
    } catch (reason) {
      setErrors({ [`availability-${serviceId}`]: `${service?.name ?? "Service"}: interest not saved. ${reason instanceof Error ? reason.message : "Please try again."}` });
    }
  }

  function finishWithInterest() {
    setCompletion({ kind: "interest", services: selectedServices.filter((service) => interestSentFor.includes(service.id)).map((service) => service.name) });
    photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    setPhotos([]);
    clearDraftStorage(browserStorage());
  }

  function buildPayload(preview: PreviewResult): SubmissionPayload {
    return {
      location: { address: streetAddress.trim(), city: city.trim(), state: stateCode.trim().toUpperCase(), zip_code: zipCode.trim() },
      preferred_date: preferredDate || undefined,
      preferred_time: schedulingPreferenceValue(preferredDate, preferredEndDate, timeOfDay),
      selections: selectedServices.map((service, index) => {
        const selection = explicitSelection(service.id);
        const shown = preview.outcomes.find((outcome) => outcome.selection_index === index);
        return {
          service_id: service.id,
          frequency: frequencies[service.id] ?? service.defaultFrequency,
          description: requestDescription(service, { projectNotes: description, otherServiceDetails, accessMethod, petStatus, entryInstructions, parkingNotes }),
          preferred_contractor_id: preferredProviders[service.id],
          package_id: selection?.packageId,
          tier_id: selection?.packageId ? selection.tierId : undefined,
          answers: questionAnswers[service.id],
          // What the homeowner was shown for this address; the command compares it.
          expected: shown?.pricing_mode === "fixed" && typeof shown.total === "number"
            ? { pricing_mode: "fixed" as const, total: shown.total }
            : { pricing_mode: "quote" as const },
        };
      }),
    };
  }

  async function sendSubmission(payload: SubmissionPayload, key: string) {
    const actorId = user!.id;
    update({ inFlight: payload, submissionKey: key });
    setSubmissionUnknown(false);
    setKeyConflict(false);
    let result: SubmissionResult;
    try {
      const { data, error } = await createClient().rpc("submit_service_requests", { p_submission_key: key, p_payload: payload });
      if (error) throw error;
      result = parseSubmissionResult(data);
    } catch (reason) {
      if (isSubmissionKeyConflict(reason)) {
        update({ inFlight: null });
        setKeyConflict(true);
        setErrors({ "request-conflict": "A request from this form was already saved with different details. Check your requests before starting another." });
        return;
      }
      const code = (reason as { code?: unknown } | null)?.code;
      if (code === "42501") {
        update({ inFlight: null });
        setErrors({ "request-step": "This account can’t request homeowner services. Sign in with a homeowner account to continue. Nothing was submitted." });
        return;
      }
      const validation = submissionValidationMessage(reason);
      if (validation) {
        update({ inFlight: null });
        setErrors({ "request-step": `${validation}. Nothing was submitted.` });
        return;
      }
      // No answer: the request may or may not have been saved. Keep the exact payload so a
      // retry resolves it without creating a duplicate.
      setSubmissionUnknown(true);
      setErrors({ "request-unknown": "We couldn’t confirm whether your request was saved. Check again: it won’t create a duplicate." });
      return;
    }

    if (result.status === "refused") {
      update({ inFlight: null });
      if (result.coverage !== "covered") {
        setCoverageStatus(result.coverage);
        setCoverageResult({ status: result.coverage, area: null, checkedZip: normalizedZip });
        setErrors({ "request-step": "This ZIP code isn’t in the current service area, so no request was created." });
        return;
      }
      const nextErrors: FormErrors = {};
      for (const outcome of result.outcomes) {
        const service = selectedServices.find((item) => item.id === outcome.service_id);
        const message = refusalMessage(outcome, service?.name ?? formatServiceName(outcome.service_id), formatMoney);
        if (message) nextErrors[`availability-${outcome.service_id}`] = `${message} Nothing was submitted.`;
      }
      setErrors(nextErrors);
      // Re-show current terms before another submission.
      void runPreview("final");
      return;
    }

    const record: SavedSubmission = {
      actorId,
      submissionKey: key,
      payload,
      result,
      serviceNames: Object.fromEntries(selectedServices.map((service) => [service.id, service.name])),
      preferredProviderNames,
      photosPending: photos.length,
      savedAt: new Date().toISOString(),
    };
    update({ inFlight: null, saved: record });
    setErrors({});
    await continueAfterSave(record, photos, true);
  }

  const readRequests = useCallback(async (record: SavedSubmission) => {
    const ids = record.result.requests.map((request) => request.request_id);
    const { data, error } = await createClient().from("service_requests")
      .select("id, status, matching_status, pricing_mode, total_amount, contractor_id, payment_status, quote_status, quote_amount")
      .in("id", ids);
    return error ? null : (data ?? []) as RequestReadback[];
  }, []);

  const attachPhotos = useCallback(async (record: SavedSubmission, files: RequestPhotoDraft[]) => {
    setPostSave((current) => current && { ...current, photoBusy: true, photoError: null, photoProgress: { completed: 0, total: files.length } });
    try {
      await attachRequestPhotos({
        supabase: createClient(),
        userId: record.actorId,
        requestIds: record.result.requests.map((request) => request.request_id),
        photos: files,
        onProgress: (completed, total) => setPostSave((current) => current && { ...current, photoProgress: { completed, total } }),
      });
      files.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      setPhotos([]);
      update((current) => current.saved ? { saved: { ...current.saved, photosPending: 0 } } : {});
      setPostSave((current) => current && { ...current, photoBusy: false });
      return true;
    } catch (reason) {
      const message = reason instanceof RequestPhotoError
        ? reason.kind === "uncertain" ? `${reason.message} Try again to check; nothing will be attached twice.` : reason.message
        : "Your photos couldn’t be attached.";
      setPostSave((current) => current && { ...current, photoBusy: false, photoError: message });
      return false;
    }
  }, [update]);

  const startCheckout = useCallback(async (requestId: string) => {
    setPostSave((current) => current && { ...current, checkoutBusy: true, checkoutError: null });
    const { data: checkout, error } = await createClient().functions.invoke("checkout-request", { body: { request_id: requestId } });
    const reviewUrl = error ? null : sameOriginReviewUrl(checkout?.review_url, window.location.origin);
    if (reviewUrl) { window.location.assign(reviewUrl); return; }
    if (!error && typeof checkout?.url === "string") { window.location.assign(checkout.url); return; }
    const detail = error
      ? await paymentFunctionError(error)
      : { message: typeof checkout?.message === "string" ? checkout.message : "Secure checkout didn’t return a payment link." };
    setPostSave((current) => current && { ...current, checkoutBusy: false, checkoutError: `${detail.message} Your request is still saved.`, checkout: { kind: "failed" } });
  }, []);

  const continueAfterSave = useCallback(async (record: SavedSubmission, files: RequestPhotoDraft[], autoCheckout: boolean) => {
    const requests = record.result.requests;
    const payable = requests.length === 1 && requests[0].pricing_mode === "fixed" && !requests[0].quote_only && requests[0].package_tier_id ? requests[0] : null;
    setPostSave({
      loading: true, readback: null, readbackFailed: false, matching: {}, checkoutBusy: false, checkoutError: null,
      checkout: payable ? { kind: "pending" } : { kind: "not_offered", reason: requests.some((request) => request.pricing_mode === "fixed") ? "multiple" : "quote" },
      photoError: record.photosPending > 0 && files.length === 0 ? "The photos you chose weren’t attached before this page reloaded." : null,
      photoBusy: false, photoProgress: { completed: 0, total: 0 },
    });
    let photosAttached = record.photosPending === 0;
    if (!photosAttached && files.length > 0) photosAttached = await attachPhotos(record, files);

    let rows = await readRequests(record);
    // Quote requests start the existing matching command; fixed requests wait for operations (D4).
    const matching: Record<string, MatchingStart> = {};
    for (const request of requests.filter((item) => item.pricing_mode !== "fixed")) {
      const row = rows?.find((item) => item.id === request.request_id);
      if (row && !intakeMatchingAllowed(row)) continue;
      if (!row && rows) continue;
      const { error } = await createClient().rpc("start_request_matching", { _request_id: request.request_id });
      matching[request.request_id] = error ? "failed" : "started";
    }
    if (Object.keys(matching).length) rows = await readRequests(record);
    setPostSave((current) => current && { ...current, loading: false, readback: rows, readbackFailed: rows === null, matching: { ...current.matching, ...matching } });

    const payableRow = rows?.find((row) => row.id === payable?.request_id);
    if (payable && autoCheckout && photosAttached && intakeCheckoutAllowed(payableRow)) await startCheckout(payable.request_id);
  }, [attachPhotos, readRequests, startCheckout]);

  // A saved submission survives a reload: recover its status without resubmitting.
  const recovered = useRef(false);
  useEffect(() => {
    if (!actorChecked || held || !saved || postSave || recovered.current || !user || saved.actorId !== user.id) return;
    recovered.current = true;
    void continueAfterSave(saved, [], false);
  }, [actorChecked, continueAfterSave, held, postSave, saved, user]);

  async function retryMatching(requestId: string) {
    if (!saved) return;
    const { error } = await createClient().rpc("start_request_matching", { _request_id: requestId });
    const rows = await readRequests(saved);
    setPostSave((current) => current && { ...current, readback: rows, readbackFailed: rows === null, matching: { ...current.matching, [requestId]: error ? "failed" : "started" } });
  }

  async function refreshStatus() {
    if (!saved) return;
    setPostSave((current) => current && { ...current, loading: true });
    const rows = await readRequests(saved);
    setPostSave((current) => current && { ...current, loading: false, readback: rows, readbackFailed: rows === null });
  }

  async function retryPhotos(files = photos) {
    if (!saved || files.length === 0) return;
    const attached = await attachPhotos(saved, files);
    const payable = saved.result.requests.length === 1 && saved.result.requests[0].pricing_mode === "fixed" ? saved.result.requests[0] : null;
    if (attached && payable && postSave?.checkout.kind === "pending" && intakeCheckoutAllowed(postSave.readback?.find((row) => row.id === payable.request_id))) await startCheckout(payable.request_id);
  }

  function reselectPhotos(files: File[]) {
    const selection = selectRequestPhotos(files, 0);
    if (selection.rejected.length || selection.accepted.length === 0) {
      setPostSave((current) => current && { ...current, photoError: selection.rejected.join(" ") || "Choose at least one photo." });
      return;
    }
    const drafts = selection.accepted.map(createRequestPhotoDraft);
    setPhotos(drafts);
    void retryPhotos(drafts);
  }

  async function discardPhotos() {
    if (!saved) return;
    setPostSave((current) => current && { ...current, photoBusy: true });
    try {
      await discardUnattachedRequestPhotos({ supabase: createClient(), userId: saved.actorId, requestIds: saved.result.requests.map((request) => request.request_id) });
      photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      setPhotos([]);
      update((current) => current.saved ? { saved: { ...current.saved, photosPending: 0 } } : {});
      setPostSave((current) => current && { ...current, photoBusy: false, photoError: null });
    } catch (reason) {
      setPostSave((current) => current && { ...current, photoBusy: false, photoError: reason instanceof Error ? reason.message : "We couldn’t clean up the photos." });
    }
  }

  /** An edit after save is always a new draft with a new key, never a resubmission. */
  function startNewRequest() {
    photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    setPhotos([]);
    setPostSave(null);
    setFinalPreview(null);
    setAvailabilityPreview(null);
    setInterestSentFor([]);
    setSubmissionUnknown(false);
    setKeyConflict(false);
    recovered.current = false;
    const today = easternDateValue(new Date());
    setDraft({ ...emptyDraft(newSubmissionKey()), ownerId: user?.id ?? null, preferredDate: addDays(today, 1), preferredEndDate: addDays(today, 4) });
    setErrors({});
  }

  function startOverAsVisitor() {
    clearDraftStorage(browserStorage());
    setHeld(false);
    startNewRequest();
    setDraft((current) => ({ ...current, ownerId: null }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter validates the current step rather than hidden contact fields.
    if (step === "services") { continueFromServices(); return; }
    if (step === "details") { await continueFromDetails(); return; }
    if (submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    try {
      await submitReview();
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
      setPhotoUploadProgress({ completed: 0, total: 0 });
    }
  }

  async function submitReview(options: { newKey?: boolean } = {}) {
    // P6-R3: an unconfirmed earlier attempt is resolved first with its exact persisted key
    // and payload, independent of the current form, coverage or preview. Only the command's
    // answer decides whether anything was saved.
    if (submissionUnknown && draft.inFlight && !options.newKey) {
      if (!user) { router.push("/login?redirect=/request"); return; }
      await sendSubmission(draft.inFlight, submissionKey);
      return;
    }

    const nextErrors = contactErrors();
    if (selectedServices.length === 0) nextErrors["request-step"] = "Go back to Services and choose at least one service.";
    if (Object.keys(nextErrors).length) { setErrors(nextErrors); return; }
    setErrors({});

    const currentCoverage = await verifyCoverage();
    if (currentCoverage.status === "error") {
      setErrors({ "request-step": "We couldn’t verify coverage for this ZIP code, so nothing was sent. Check again, or contact us." });
      return;
    }
    if (currentCoverage.status !== "covered") {
      await sendCoverageInterest(currentCoverage);
      return;
    }

    if (!user) {
      // The draft (never files or credentials) is kept in this tab for the return trip.
      router.push("/login?redirect=/request");
      return;
    }

    const preview = currentPreview("final")?.status === "ready" ? currentPreview("final")! : await runPreview("final");
    if (preview.status !== "ready" || !preview.result) {
      setErrors({ "request-step": "We couldn’t check availability and pricing for this address, so nothing was submitted. Try again." });
      return;
    }
    if (!planIsSubmittable(preview.result)) {
      const blocking = selectedServices.flatMap((service, index) => {
        const outcome = preview.result!.outcomes.find((item) => item.selection_index === index);
        const availability = outcome ? serviceAvailability(outcome) : null;
        const ok = availability && ((availability.kind === "fixed" && availability.exact) || availability.kind === "quote");
        return ok ? [] : [[`availability-${service.id}`, `${service.name}: ${blockingMessage(availability)}`]];
      });
      setErrors(Object.fromEntries(blocking));
      return;
    }
    await sendSubmission(buildPayload(preview.result), options.newKey ? newSubmissionKey() : submissionKey);
  }

  async function sendCoverageInterest(coverage: RequestCoverageResult) {
    try {
      const response = await fetch("/api/contact-submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          subject: coverage.status === "waitlist" ? `Service-area waitlist — ${normalizedZip}` : `Service-area notification request — ${normalizedZip}`,
          message: coverageInterestMessage({ coverage, selectedServices, streetAddress, city, stateCode, zipCode, preferredDate, preferredEndDate, timeOfDay, description }),
          intake: intakePayload(),
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error || "We couldn’t save your service-area interest.");
      photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
      setPhotos([]);
      clearDraftStorage(browserStorage());
      setCompletion({ kind: "coverage", status: coverage.status === "waitlist" ? "waitlist" : "uncovered", services: selectedServices.map((service) => service.name) });
    } catch (reason) {
      setErrors({ "request-step": `${reason instanceof Error ? reason.message : "We couldn’t save your interest."} Nothing was sent.` });
    }
  }

  async function submitAsNew() {
    if (submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    try {
      await submitReview({ newKey: true });
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  const reviewItems: AvailabilityItem[] = selectedServices.map((service) => ({
    serviceId: service.id,
    name: service.name,
    cadence: planningFrequencyLabel(frequencies[service.id] ?? service.defaultFrequency),
    availability: availabilityFor(step === "contact" ? "final" : "availability", service.id),
    preferredProviderName: preferredProviderNames[service.id],
    explicitOffering: explicitSelection(service.id)?.packageName,
    interestSent: interestSentFor.includes(service.id),
    isSomethingElse: service.id === otherServiceId,
  }));
  const interestOnly = step === "contact" && selectedServices.length > 0 && reviewItems.every((item) => item.interestSent);

  const pageShell = (content: ReactNode) => (
    <div className="min-h-screen bg-background">
      <Header />
      <main id="main-content" tabIndex={-1}>{content}</main>
      <Footer />
    </div>
  );

  if (completion?.kind === "coverage") {
    return pageShell(<InterestConfirmation
      title={completion.status === "waitlist" ? "You’re on the service-area list" : "Coverage interest received"}
      services={completion.services}
      reason="Thanks for telling us where you need service. We saved your contact details so Mercurius can follow up if coverage reaches your ZIP code." />);
  }
  if (completion?.kind === "interest") {
    return pageShell(<InterestConfirmation title="Interest recorded" services={completion.services}
      reason="These services aren’t available at your address yet. We saved your interest so Mercurius can follow up if that changes." />);
  }
  if (held) {
    return pageShell(<div className="container-narrow py-16">
      <PageState kind="permission" title="Sign in to continue this request"
        description="A request was started in this tab by a signed-in account. Sign in to that account to continue, or start over. We don’t show its details while you’re signed out."
        action={<div className="flex flex-wrap gap-3">
          <Link href="/login?redirect=/request" className={buttonVariants({ size: "lg" })}><LogIn className="size-4" /> Sign in</Link>
          <Button type="button" variant="outline" size="lg" onClick={startOverAsVisitor}>Start over</Button>
        </div>} />
    </div>);
  }
  if (saved && user && saved.actorId === user.id) {
    const confirmations = describeConfirmation({
      requests: saved.result.requests,
      serviceNames: saved.serviceNames,
      preferredProviderNames: saved.preferredProviderNames,
      readback: postSave?.readback ?? null,
      matching: postSave?.matching ?? {},
      checkout: postSave?.checkout ?? { kind: "pending" },
      formatMoney,
    });
    const single = saved.result.requests.length === 1 ? saved.result.requests[0] : null;
    const checkoutAvailable = Boolean(single && single.pricing_mode === "fixed" && single.package_tier_id && saved.photosPending === 0
      && postSave && !postSave.loading && intakeCheckoutAllowed(postSave.readback?.find((row) => row.id === single.request_id)));
    return pageShell(<RequestConfirmation
      services={confirmations}
      loading={postSave?.loading ?? true}
      readbackFailed={postSave?.readbackFailed ?? false}
      photos={{ pending: saved.photosPending, filesAvailable: photos.length > 0, error: postSave?.photoError ?? null, busy: postSave?.photoBusy ?? false, progress: postSave?.photoProgress ?? { completed: 0, total: 0 } }}
      checkout={{ available: checkoutAvailable, busy: postSave?.checkoutBusy ?? false, error: postSave?.checkoutError ?? null, onContinue: () => single && void startCheckout(single.request_id) }}
      onRetryPhotos={() => void retryPhotos()}
      onReselectPhotos={reselectPhotos}
      onDiscardPhotos={() => void discardPhotos()}
      onRetryMatching={(requestId) => void retryMatching(requestId)}
      onRefresh={() => void refreshStatus()}
      onStartNew={startNewRequest} />);
  }

  const stepperSteps: WorkflowStep[] = stepOrder.map((item, index) => ({
    id: item,
    label: stepLabels[item],
    state: index < stepIndex ? "complete" : index === stepIndex ? (Object.keys(errors).length ? "error" : "current") : "upcoming",
  }));

  return pageShell(<>
    <section className="bg-hero py-12 text-center md:py-16">
      <div className="container-wide max-w-6xl">
        <p className="mb-4 text-sm font-medium text-muted-foreground">Homeowner service request</p>
        <h1 className="mb-4 text-3xl font-semibold md:text-4xl">Request a service</h1>
        <p className="text-lg text-muted-foreground">Tell us what your home needs. We check providers and prices for your address before you submit.</p>
      </div>
    </section>

    {!user && (
      <div className="border-y border-accent/20 bg-accent/5">
        <div className="container-narrow flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15"><Info aria-hidden="true" className="h-4 w-4 text-accent" /></span>
            <div className="text-sm"><p className="font-semibold">You’ll need a free account to submit your request</p><p className="text-foreground">{storageAvailable ? "Your details stay in this browser tab while you sign in. Photos must be chosen again after signing in." : "This browser isn’t saving your progress, so sign in before you start."}</p></div>
          </div>
          <Link href="/login?redirect=/request" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 border-accent/30 text-accent")}><LogIn aria-hidden="true" className="h-4 w-4" /> Sign in now</Link>
        </div>
      </div>
    )}

    <div className="border-b border-border bg-card">
      <div className="container-narrow py-5">
        <WorkflowStepper steps={stepperSteps} label="Request progress" />
      </div>
    </div>

    <section className="py-12 md:py-16">
      <div className="container-wide max-w-6xl">
        {(notice || (!storageAvailable && hydrated)) && (
          <div role="status" className="mb-6 flex items-start gap-3 rounded-xl border border-status-info bg-status-info-bg p-4 text-sm text-foreground">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <p>{[notice, !storageAvailable && !notice?.includes("isn’t saving") ? "This browser isn’t saving your progress, so keep this tab open until you submit." : null].filter(Boolean).join(" ")}</p>
          </div>
        )}
        <FormErrorsContext value={errors}>
          <form ref={formRef} noValidate onSubmit={handleSubmit}>
            <FormErrorSummary errors={errors} />
            <IntakeTrapField inputRef={trapRef} />
            {step === "services" && <ServicesStep services={requestServiceOptions} categories={catalogCategories} catalogLoading={catalogLoading} catalogError={catalogError} onRetryCatalog={retryCatalog} selectedIds={selectedIds} frequencies={frequencies} preferredProviderNames={preferredProviderNames} otherServiceDetails={otherServiceDetails} onOtherServiceDetails={(value) => update({ otherServiceDetails: value })} onToggle={toggleService} onFrequencyChange={changeServiceFrequency} localStatusFor={(service) => localStatus(service, catalogLoading || catalogError, availabilityFor("availability", service.id), selectedIds.includes(service.id))} onContinue={continueFromServices} />}
            {step === "details" && <DetailsStep streetAddress={streetAddress} city={city} stateCode={stateCode} zipCode={zipCode} coverageStatus={coverageStatus} coverageResult={coverageResult} preferredDate={preferredDate} preferredEndDate={preferredEndDate} timeOfDay={timeOfDay} description={description} accessMethod={accessMethod} petStatus={petStatus} entryInstructions={entryInstructions} parkingNotes={parkingNotes} photos={photos} photoMessages={photoMessages} selectedServices={selectedServices} availabilityItems={reviewItems} questionsFor={questionsFor} scopeFor={(serviceId) => scopeFor(explicitSelection(serviceId), availabilityFor("availability", serviceId))} questionAnswers={questionAnswers} isSignedIn={!!user} onQuestionAnswer={(serviceId, questionKey, answer) => update((current) => ({ questionAnswers: { ...current.questionAnswers, [serviceId]: { ...(current.questionAnswers[serviceId] ?? {}), [questionKey]: answer } } }))} onStreetAddress={(value) => update({ streetAddress: value })} onCity={(value) => update({ city: value })} onStateCode={(value) => update({ stateCode: value })} onZipCode={(value) => update({ zipCode: value })} onPreferredDate={(value) => update((current) => ({ preferredDate: value, preferredEndDate: current.preferredEndDate && current.preferredEndDate < value ? value : current.preferredEndDate }))} onPreferredEndDate={(value) => update({ preferredEndDate: value })} onTimeOfDay={(value) => update({ timeOfDay: value })} onDescription={(value) => update({ description: value })} onAccessMethod={(value) => update({ accessMethod: value })} onPetStatus={(value) => update({ petStatus: value })} onEntryInstructions={(value) => update({ entryInstructions: value })} onParkingNotes={(value) => update({ parkingNotes: value })} onAddPhotos={addPhotos} onRemovePhoto={removePhoto} onPhotoDrop={handlePhotoDrop} onRetryCoverage={() => void verifyCoverage()} onRetryAvailability={() => void runPreview("availability")} onRemoveService={removeService} onUseAnyProvider={allowAnyProvider} onBack={() => changeStep("services")} />}
            {step === "contact" && <ContactStep selectedServices={selectedServices} frequencies={frequencies} availabilityItems={reviewItems} coverageStatus={coverageStatus} coverageResult={coverageResult} preferredDate={preferredDate} preferredEndDate={preferredEndDate} timeOfDay={timeOfDay} accessMethod={accessMethod} petStatus={petStatus} entryInstructions={entryInstructions} parkingNotes={parkingNotes} photos={photos} photoUploadProgress={photoUploadProgress} firstName={firstName} lastName={lastName} email={email} phone={phone} smsUpdates={smsUpdates} isSubmitting={isSubmitting} isSignedIn={!!user} submissionUnknown={submissionUnknown} keyConflict={keyConflict} interestOnly={interestOnly} onFinishWithInterest={finishWithInterest} onSubmitAsNew={() => void submitAsNew()} onRemoveService={removeService} onUseAnyProvider={allowAnyProvider} onRegisterInterest={(serviceId) => void registerServiceInterest(serviceId)} onRetryAvailability={() => void runPreview("final")} onFirstName={(value) => update({ firstName: value })} onLastName={(value) => update({ lastName: value })} onEmail={(value) => update({ email: value })} onPhone={(value) => update({ phone: value })} onSmsUpdates={(value) => update({ smsUpdates: value })} onRetryCoverage={() => void verifyCoverage()} onBack={() => changeStep("details")} />}
          </form>
        </FormErrorsContext>
      </div>
    </section>
  </>);
}

function withOverride(base: ServiceOption, override: DraftServiceOverride | undefined): ServiceOption {
  if (!override) return base;
  return {
    ...base,
    name: override.name ?? base.name,
    description: override.description ?? base.description,
    defaultFrequency: override.defaultFrequency ?? base.defaultFrequency,
    frequencies: override.frequencies?.length ? override.frequencies : base.frequencies,
    livePrices: override.livePrices ?? base.livePrices,
    availability: override.availability ?? base.availability,
  };
}

/** Imports a plan-builder entry. Only a provider-bound choice is an explicit offering. */
function importBuilder(draft: RequestDraft, builder: { selectedServiceIds?: unknown; frequencies?: unknown; requestedServices?: unknown; matchingZip?: unknown }, provider: { serviceId?: unknown } | null): RequestDraft {
  const requestedServices = Array.isArray(builder.requestedServices) ? builder.requestedServices.filter(isBuilderRequestedService) : [];
  const frequencies = builder.frequencies && typeof builder.frequencies === "object"
    ? Object.fromEntries(Object.entries(builder.frequencies as Record<string, unknown>).filter(([id, value]) => serviceIdPattern.test(id) && isPricingFrequency(value))) as Record<string, Frequency>
    : {};
  const next: RequestDraft = { ...draft, frequencies: { ...draft.frequencies, ...frequencies } };
  if (requestedServices.length > 0) {
    next.selectedIds = requestedServices.map((item) => item.id).slice(0, 20);
    const explicit = requestedServices.filter((item) => item.packageId && item.pricingMode
      && (item.preferredContractorId || (typeof provider?.serviceId === "string" && provider.serviceId === item.id)));
    next.serviceOverrides = Object.fromEntries(requestedServices.map((item) => [item.id, {
      name: item.name.slice(0, 200),
      description: item.descriptor?.slice(0, 500),
      defaultFrequency: item.defaultFrequency,
      frequencies: item.frequencies?.filter(isPricingFrequency),
      // Promotion labels, ids and base prices from the entry page are deliberately dropped.
      livePrices: item.prices,
      availability: item.availability,
    } satisfies DraftServiceOverride]));
    next.packageSelections = Object.fromEntries(explicit.flatMap((item) => {
      const selection = parsePackageSelection(item);
      return selection ? [[item.id, selection]] : [];
    }));
    next.preferredProviders = Object.fromEntries(requestedServices
      .filter((item) => typeof item.preferredContractorId === "string" && uuidPattern.test(item.preferredContractorId))
      .map((item) => [item.id, item.preferredContractorId!]));
    next.preferredProviderNames = Object.fromEntries(requestedServices
      .filter((item) => typeof item.preferredContractorName === "string")
      .map((item) => [item.id, item.preferredContractorName!.slice(0, 200)]));
  } else if (Array.isArray(builder.selectedServiceIds)) {
    next.selectedIds = builder.selectedServiceIds.filter((id): id is string => typeof id === "string" && serviceOptions.some((service) => service.id === id));
  }
  if (typeof builder.matchingZip === "string" && /^\d{5}$/.test(builder.matchingZip)) next.zipCode = builder.matchingZip;
  return next;
}

function localStatus(service: ServiceOption, catalogUnknown: boolean, availability: ServiceAvailability | "error" | undefined, selected: boolean) {
  if (service.id === otherServiceId) return { label: "Interest only", detail: "Something Else records your description as interest. It isn’t a service request or a quote, and no provider is assigned." };
  if (selected && availability && availability !== "error") {
    if (availability.kind === "unavailable") return { label: "Not available yet in your area", detail: "No eligible provider offers this at your address. You can remove it, or ask us to notify you on the review step." };
    if (availability.kind === "promotion") return { label: "Online pricing unavailable", detail: "This service’s current price can’t be booked online yet." };
  }
  if (catalogUnknown) return undefined;
  const live = service.frequencies.some((frequency) => servicePrice(service, frequency) > 0);
  if (service.availability === "fixed" && !live && service.promotedFrequencies?.length) {
    return { label: "Online pricing unavailable", detail: "This service’s current price can’t be booked online yet." };
  }
  if (service.availability === "sourcing") return { label: "Not available yet", detail: "No provider offers this service yet. Keep it in your plan and we’ll confirm on the next step; you can ask to be notified." };
  if (service.availability === "quote") return { label: "Quote required", detail: "Providers quote this service. We check your address on the next step; nothing is priced or booked until you accept a quote." };
  return undefined;
}

function scopeFor(explicit: PublicPackageSelection | undefined, availability: ServiceAvailability | "error" | undefined) {
  if (explicit) return { name: explicit.packageName ?? null, description: explicit.packageDescription ?? null, tier: explicit.tierName ?? null, includes: explicit.tierIncludes ?? [] };
  const scope = availability && availability !== "error" ? availability.outcome.scope : null;
  return scope ? { name: scope.package_name, description: scope.package_description, tier: scope.tier_name, includes: scope.tier_includes } : null;
}

function blockingMessage(availability: ServiceAvailability | null) {
  if (!availability) return "we couldn’t check it. Check again, or remove it.";
  if (availability.kind === "unavailable") return "not available yet in your area. Remove it to submit the rest of your plan.";
  if (availability.kind === "promotion") return "its current price can’t be booked online. Remove it to submit the rest of your plan.";
  if (availability.kind === "fixed" && !availability.exact) return "answer its questions to confirm the price.";
  switch (availability.outcome.outcome) {
    case "answers_required": return "answer its questions on the Your home step.";
    case "preferred_provider_unavailable": return "your preferred provider isn’t available here. Choose any eligible provider, or remove it.";
    case "invalid_provider": return "we couldn’t find the provider you chose. Choose any eligible provider, or remove it.";
    default: return "the offering you chose isn’t available here. Choose any eligible provider, or remove it.";
  }
}

function ServicesStep({
  services,
  categories,
  catalogLoading,
  catalogError,
  onRetryCatalog,
  selectedIds,
  frequencies,
  preferredProviderNames,
  otherServiceDetails,
  onOtherServiceDetails,
  onToggle,
  onFrequencyChange,
  localStatusFor,
  onContinue,
}: {
  services: ServiceOption[];
  categories: RequestCategory[];
  catalogLoading: boolean;
  catalogError: boolean;
  onRetryCatalog: () => void;
  selectedIds: string[];
  frequencies: Record<string, Frequency>;
  preferredProviderNames: Record<string, string>;
  otherServiceDetails: string;
  onOtherServiceDetails: (value: string) => void;
  onToggle: (id: string) => void;
  onFrequencyChange: (id: string, value: Frequency) => void;
  localStatusFor: (service: ServiceOption) => { label: string; detail: string } | undefined;
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
  const publishedTotal = selected.reduce((total, service) => total + servicePrice(service, frequencies[service.id] ?? service.defaultFrequency), 0);
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
        localStatus={localStatusFor(service)}
      />
    );
  }

  return (
    <div className="pb-24 lg:pb-0">
      <div className="mb-8">
        <p className="mb-2 text-sm font-medium text-muted-foreground">
          Build your request
        </p>
        <h2 id="request-step" data-step-heading tabIndex={-1} className="scroll-mt-24 text-2xl font-semibold sm:text-3xl">
          What does your home need?
        </h2>
        <p className="mt-2 max-w-2xl leading-6 text-muted-foreground">
          Choose one or more services. Prices shown here are the lowest published rates; on the next step we check which providers serve your address and confirm the price there.
        </p>
      </div>

      {catalogError && (
        <div className="mb-8">
          <PageState kind="error" title="We couldn’t load current services and prices"
            description="Nothing is priced or submitted from this page until the catalog loads. Your selections are kept."
            action={<Button type="button" variant="outline" onClick={onRetryCatalog}><RefreshCw className="size-4" /> Try again</Button>} />
        </div>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-10">
          <section>
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">Popular home services</h3>
                <p className="mt-1 text-sm text-muted-foreground">Start with the services homeowners request most often.</p>
              </div>
              {catalogLoading && <span role="status" className="flex size-8 shrink-0 items-center justify-center"><Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-accent" /><span className="sr-only">Loading services</span></span>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {featuredServices.map((service) => renderServiceCard(service))}
            </div>
          </section>

          {availableCategories.length > 0 && (
            <section>
              <div className="mb-4">
                <h3 className="text-lg font-semibold">Explore by service area</h3>
                <p className="mt-1 text-sm text-muted-foreground">Choose a category to see its catalog services.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    aria-pressed={activeCategory === category.id}
                    onClick={() => setActiveCategory((current) => current === category.id ? null : category.id)}
                    className={cn(
                      "min-h-11 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
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
            <button type="button" aria-expanded={browseAll} onClick={() => setBrowseAll((current) => !current)} className="flex min-h-11 w-full items-center justify-between gap-4 text-left">
              <div>
                <h3 className="text-lg font-semibold">Browse all services</h3>
                <p className="mt-1 text-sm text-muted-foreground">Search the full catalog for a more specific need.</p>
              </div>
              <span className="rounded-full border border-accent-border bg-card px-3 py-1.5 text-xs font-semibold text-sage-dark">{browseAll ? "Close" : `${catalogServices.length} services`}</span>
            </button>
            {browseAll && (
              <div className="mt-5 space-y-4">
                <div className="relative">
                  <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input aria-label="Search services" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search lawn, cleaning, plumbing…" className="h-11 bg-background pl-10" />
                </div>
                <div className="max-h-[34rem] space-y-3 overflow-y-auto pr-1">
                  {browsableServices.length > 0
                    ? browsableServices.map((service) => renderServiceCard(service, "row"))
                    : <p className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">No catalog service matches that search. Use Something Else below to tell us what you need.</p>}
                </div>
              </div>
            )}
          </section>

          {catchAll && (
            <section>
              <div className="mb-3">
                <h3 className="text-lg font-semibold">Can&apos;t find the right service?</h3>
                <p className="mt-1 text-sm text-muted-foreground">Something Else lets you tell us about a need that isn’t in the catalog. It records your interest; it doesn’t create a request or a quote.</p>
              </div>
              {renderServiceCard(catchAll, "row")}
              {selectedIds.includes(otherServiceId) && (
                <div className="mt-3 rounded-2xl border border-accent-border bg-accent-subtle/35 p-4">
                  <FormField id="otherServiceDetails" label="What service do you need?" required help="We save this as interest so Mercurius knows what homeowners need. No provider is assigned and nothing is priced.">{control => <Textarea {...control} rows={3} maxLength={1000} value={otherServiceDetails} onChange={(event) => onOtherServiceDetails(event.target.value)} placeholder="Describe the work or issue in a sentence or two…" className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />}</FormField>
                </div>
              )}
            </section>
          )}
        </div>

        <PlanningPlanSummary
          items={summaryItems}
          totalRows={[{ key: "published", label: "Published rates", amount: publishedTotal, detail: "Confirmed for your address before you submit", emphasis: true }]}
          actionLabel="Continue to your home"
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
  coverageStatus: RequestCoverageStatus;
  coverageResult: RequestCoverageResult | null;
  preferredDate: string;
  preferredEndDate: string;
  timeOfDay: TimeOfDay;
  description: string;
  accessMethod: AccessMethod;
  petStatus: PetStatus;
  entryInstructions: string;
  parkingNotes: string;
  photos: RequestPhotoDraft[];
  photoMessages: string[];
  selectedServices: ServiceOption[];
  availabilityItems: AvailabilityItem[];
  questionsFor: (serviceId: string) => PackageQualifyingQuestion[];
  scopeFor: (serviceId: string) => { name: string | null; description: string | null; tier: string | null; includes: string[] } | null;
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
  onRetryCoverage: () => void;
  onRetryAvailability: () => void;
  onRemoveService: (serviceId: string) => void;
  onUseAnyProvider: (serviceId: string) => void;
  onBack: () => void;
};

function DetailsStep(props: DetailsStepProps) {
  const minDate = easternDateValue(new Date());
  const coverageBlocksBooking = props.coverageStatus === "waitlist" || props.coverageStatus === "uncovered" || props.coverageStatus === "error";
  const questionGroups = props.selectedServices
    .map((service) => ({ service, questions: props.questionsFor(service.id) }))
    .filter((group) => group.questions.length);
  const scopes = props.selectedServices.flatMap((service) => {
    const scope = props.scopeFor(service.id);
    const includes = scope?.includes.filter(Boolean) ?? [];
    return scope && (scope.description?.trim() || includes.length) ? [{ service, scope, includes }] : [];
  });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="mb-2 text-sm font-medium text-muted-foreground">{coverageBlocksBooking ? "Service-area availability" : "Your home and project"}</p>
        <h2 id="request-step" data-step-heading tabIndex={-1} className="scroll-mt-24 text-2xl font-semibold sm:text-3xl">Where and when do you need service?</h2>
        <p className="mt-2 max-w-3xl leading-6 text-muted-foreground">
          Your address decides which providers and prices apply. Required fields are marked; everything else is optional.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle><h3>Service location</h3></CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <FormField id="streetAddress" label="Street address" required>{control => <Input {...control} autoComplete="address-line1" maxLength={200} placeholder="123 Main St" className="h-12" value={props.streetAddress} onChange={(event) => props.onStreetAddress(event.target.value)} />}</FormField>
          <div className="grid gap-4 sm:grid-cols-6">
            <div className="sm:col-span-3">
              <FormField id="city" label="City" required>{control => <Input {...control} autoComplete="address-level2" maxLength={100} className="h-12" value={props.city} onChange={(event) => props.onCity(event.target.value)} />}</FormField>
            </div>
            <div className="sm:col-span-1">
              <FormField id="state" label="State" required>{control => <Input {...control} autoComplete="address-level1" maxLength={2} className="h-12 uppercase" value={props.stateCode} onChange={(event) => props.onStateCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} />}</FormField>
            </div>
            <div className="sm:col-span-2">
              <FormField id="zip" label="ZIP code" required help="Coverage is decided by ZIP code, not city.">{control => <Input {...control} autoComplete="postal-code" inputMode="numeric" maxLength={10} className="h-12" value={props.zipCode} onChange={(event) => props.onZipCode(event.target.value.replace(/[^\d-]/g, ""))} />}</FormField>
            </div>
          </div>

          <CoverageStatusPanel status={props.coverageStatus} result={props.coverageResult} onRetry={props.onRetryCoverage} />

          {props.coverageStatus === "covered" && props.availabilityItems.length > 0 && (
            <ServiceAvailabilityList headingId="details-availability" items={props.availabilityItems} formatMoney={formatMoney} onRemove={props.onRemoveService} onUseAnyProvider={props.onUseAnyProvider} onRetry={props.onRetryAvailability} />
          )}
        </CardContent>
      </Card>

      {!coverageBlocksBooking && scopes.length > 0 && (
        <section className="mt-6" aria-labelledby="included-heading">
          <h3 id="included-heading" className="font-semibold">What’s included</h3>
          <p className="mt-1 text-sm text-muted-foreground">As published by the offering available at your address. It’s confirmed again when you submit.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {scopes.map(({ service, scope, includes }) => (
              <Card key={service.id} className="border-accent-border bg-accent-subtle/30 shadow-sm">
                <CardHeader className="gap-1 pb-3">
                  <CardTitle className="text-base"><h4>{service.name}</h4></CardTitle>
                  {scope.tier && <p className="text-xs text-muted-foreground">{scope.tier}</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  {scope.description && <p className="text-sm leading-6 text-muted-foreground">{scope.description}</p>}
                  {includes.length > 0 && (
                    <ul className="grid gap-2 text-sm">
                      {includes.map((included) => (
                        <li key={included} className="flex items-start gap-2"><Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><span>{included}</span></li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {!coverageBlocksBooking && questionGroups.length > 0 && (
        <section className="mt-6" aria-labelledby="questions-heading">
          <h3 id="questions-heading" className="font-semibold">Service questions</h3>
          <p className="text-sm text-muted-foreground">Your answers can set the price level. They’re saved only when you submit.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {questionGroups.map(({ service, questions }) => (
              <fieldset key={service.id} className="space-y-4 rounded-xl border border-border-strong bg-card p-4 shadow-sm">
                <legend className="px-1 font-medium">{service.name}</legend>
                {questions.map((question) => (
                  <PackageQuestionInput key={question.question_key} serviceId={service.id} question={question} value={props.questionAnswers[service.id]?.[question.question_key] ?? ""} onChange={props.onQuestionAnswer} />
                ))}
              </fieldset>
            ))}
          </div>
        </section>
      )}

      <Card className="mt-6 shadow-sm">
        <CardHeader>
          <CardTitle><h3>Timing, access and project details</h3></CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-2xl border border-border-strong bg-background p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-sage-dark"><Clock3 className="h-5 w-5" /></span>
              <div>
                <h4 className="font-semibold">When would you prefer service?</h4>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">A preference, not an appointment. Dates are in Eastern Time; an actual time is confirmed with you after a provider accepts.</p>
              </div>
            </div>
            <div className="mt-5 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="preferredDate" label="Window starts" required>{control => <div className="relative">
                  <CalendarDays aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input {...control} type="date" min={minDate} className="h-12 pl-10" value={props.preferredDate} onChange={(event) => props.onPreferredDate(event.target.value)} /></div>}</FormField>
                <FormField id="preferredEndDate" label="Window ends" required>{control => <div className="relative">
                  <CalendarDays aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input {...control} type="date" min={props.preferredDate || minDate} className="h-12 pl-10" value={props.preferredEndDate} onChange={(event) => props.onPreferredEndDate(event.target.value)} /></div>}</FormField>
              </div>
              <PreferencePills<TimeOfDay> label="Time of day" value={props.timeOfDay} options={[["morning", "Morning"], ["afternoon", "Afternoon"], ["anytime", "Anytime"]]} onChange={props.onTimeOfDay} />
            </div>
          </div>

          <div className="rounded-2xl border border-border-strong bg-background p-4 sm:p-5">
            <h4 className="font-semibold">Access and property details</h4>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">Shared with a provider only after they accept your request.</p>
            <div className="mt-5 space-y-5">
              <PreferencePills<AccessMethod> label="How will the provider get access?" value={props.accessMethod} options={[["someone-home", "Someone will be home"], ["coordinate", "Coordinate with me"], ["gate", "Gate access"], ["lockbox", "Lockbox/key"], ["other", "Other"]]} onChange={props.onAccessMethod} />
              <PreferencePills<PetStatus> label="Pets on the property" value={props.petStatus} options={[["none", "No pets"], ["secured", "Pets will be secured"], ["on-property", "Pets may be present"]]} onChange={props.onPetStatus} />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="entryInstructions" label="Gate, entry, or lockbox instructions (optional)" help="Up to 1,000 characters.">{control => <Textarea {...control} rows={4} maxLength={1000} value={props.entryInstructions} onChange={(event) => props.onEntryInstructions(event.target.value)} placeholder="Gate location, where to meet…" className="w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />}</FormField>
                <FormField id="parkingNotes" label="Parking or service-location notes (optional)" help="Up to 1,000 characters.">{control => <Textarea {...control} rows={4} maxLength={1000} value={props.parkingNotes} onChange={(event) => props.onParkingNotes(event.target.value)} placeholder="Driveway access, work area location…" className="w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />}</FormField>
              </div>
              <div className="flex items-start gap-2 rounded-xl border border-status-warning bg-status-warning-bg p-3 text-sm leading-5 text-foreground">
                <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Don’t enter alarm codes, passwords or other credentials here. Share time-sensitive access codes only after a provider is confirmed.</p>
              </div>
            </div>
          </div>

          <FormField id="description" label="Project notes (optional)" help="Scope, condition, dimensions or anything the provider should know. Up to 4,000 characters.">{control => <Textarea {...control} rows={4} maxLength={4000} value={props.description} onChange={(event) => props.onDescription(event.target.value)} placeholder="Describe the work you need and what you’re seeing…" className="w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />}</FormField>

          {coverageBlocksBooking ? (
            <div className="flex items-start gap-3 rounded-xl border border-border-strong bg-muted/30 p-4">
              <ImagePlus aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Photos aren’t uploaded for coverage interest</p>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  {props.photos.length
                    ? `${props.photos.length} photo${props.photos.length === 1 ? " stays" : "s stay"} on this device and won’t upload.`
                    : "A coverage-interest submission records your contact details and service-area demand only."}
                </p>
              </div>
            </div>
          ) : (
            <RequestPhotoPicker photos={props.photos} messages={props.photoMessages} isSignedIn={props.isSignedIn} onAdd={props.onAddPhotos} onRemove={props.onRemovePhoto} onDrop={props.onPhotoDrop} />
          )}
        </CardContent>
      </Card>

      <div className="mt-8 flex flex-col-reverse justify-between gap-3 sm:flex-row">
        <Button type="button" variant="outline" size="lg" onClick={props.onBack}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back
        </Button>
        <Button type="submit" size="lg" loading={props.coverageStatus === "checking"} className="bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active">
          Continue to review <ArrowRight aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CoverageStatusPanel({
  status,
  result,
  onRetry,
  review = false,
}: {
  status: RequestCoverageStatus;
  result: RequestCoverageResult | null;
  onRetry: () => void;
  review?: boolean;
}) {
  if (status === "idle") {
    return <div className="flex items-start gap-3 rounded-xl border border-border-strong bg-muted/30 p-4"><MapPin aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-accent" /><div><p className="text-sm font-medium">Enter your ZIP code to check coverage</p><p className="mt-1 text-sm leading-5 text-muted-foreground">Mercurius serves an approved list of ZIP codes.</p></div></div>;
  }
  if (status === "checking") {
    return <div role="status" className="flex items-center gap-3 rounded-xl border border-accent-border bg-accent-subtle/35 p-4"><Loader2 aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin text-accent" /><div><p className="text-sm font-medium">Checking coverage</p><p className="mt-1 text-sm text-muted-foreground">Confirming this ZIP code against the current service area.</p></div></div>;
  }
  if (status === "covered") {
    const area = result?.area;
    return <div role="status" className="flex items-start gap-3 rounded-xl border border-status-success bg-status-success-bg p-4 text-foreground"><CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-status-success" /><div><p className="text-sm font-semibold">This ZIP code is in our service area</p><p className="mt-1 text-sm leading-5">{area ? `${area.zip_code}. ` : ""}Each service still needs an eligible provider here; see availability below.</p></div></div>;
  }

  const waitlist = status === "waitlist";
  const lookupError = status === "error";
  return (
    <div role={lookupError ? "alert" : "status"} className="rounded-xl border border-status-warning bg-status-warning-bg p-4 text-foreground">
      <div className="flex items-start gap-3">
        <MapPin aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{waitlist ? "This area is coming soon" : lookupError ? "We couldn’t check coverage" : "We don’t serve this ZIP code yet"}</p>
          <p className="mt-1 text-sm leading-5">
            {waitlist
              ? `${result?.checkedZip || "This ZIP code"} is on the service-area waitlist. A service request can’t be created yet.`
              : lookupError
                ? `${result?.message ?? "The coverage check is unavailable."} We won’t treat this address as covered, and nothing is sent until the check works.`
                : `${result?.checkedZip || "This ZIP code"} isn’t in the current service area, so services can’t be booked here.`}
          </p>
          {!lookupError && <p className="mt-2 text-sm leading-5">{review ? "Add your contact details below to be notified. No request, provider, photo upload or payment is created." : "You can continue to review and leave contact details to be notified."}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {lookupError && <Button type="button" variant="outline" size="sm" onClick={onRetry} className="min-h-11 bg-background"><RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />Check coverage again</Button>}
            <Link href="/contact" className={buttonVariants({ variant: "outline", size: "sm", className: "min-h-11 bg-background" })}>Contact Mercurius</Link>
          </div>
        </div>
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
              "min-h-11 rounded-full border px-4 py-2 text-sm transition-colors",
              value === option
                ? "border-accent bg-accent font-semibold text-accent-foreground shadow-sm"
                : "border-border-strong bg-background text-muted-foreground hover:border-accent-border hover:text-foreground",
            )}
          >
            {value === option && <Check aria-hidden="true" className="mr-1 inline h-4 w-4" />}
            {optionLabel}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function RequestPhotoPicker({
  photos,
  messages,
  isSignedIn,
  onAdd,
  onRemove,
  onDrop,
}: {
  photos: RequestPhotoDraft[];
  messages: string[];
  isSignedIn: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
}) {
  return (
    <section aria-labelledby="photos-heading" className="rounded-2xl border border-border-strong bg-muted/20 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-sage-dark"><ImagePlus className="h-5 w-5" /></span>
        <div>
          <h4 id="photos-heading" className="font-semibold">Add helpful photos (optional)</h4>
          <p id="photos-help" className="mt-1 text-sm leading-5 text-muted-foreground">Up to {MAX_REQUEST_PHOTOS} JPG, PNG or WebP images, 8 MB each. They upload after your request is saved and help providers prepare; they aren’t proof of completed work.</p>
        </div>
      </div>

      <label
        htmlFor="requestPhotos"
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
        className="mt-4 flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-accent-border bg-background px-5 py-7 text-center transition-colors hover:bg-accent-subtle/30 has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-focus-ring"
      >
        <ImagePlus aria-hidden="true" className="mb-2 h-6 w-6 text-accent" />
        <span className="text-sm font-semibold">Choose photos</span>
        <span className="mt-1 text-sm text-muted-foreground">or drop them here</span>
        <input
          id="requestPhotos"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          aria-describedby="photos-help"
          disabled={photos.length >= MAX_REQUEST_PHOTOS}
          className="sr-only"
          onChange={(event) => {
            onAdd(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </label>
      <p role="status" className="mt-2 text-sm text-muted-foreground">{photos.length} of {MAX_REQUEST_PHOTOS} photos selected.</p>

      {messages.length > 0 && (
        <ul role="alert" className="mt-2 space-y-1 text-sm text-destructive">
          {messages.map((message) => <li key={message}>{message}</li>)}
        </ul>
      )}

      {!isSignedIn && photos.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-status-warning bg-status-warning-bg p-3 text-sm leading-5 text-foreground">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Your details are kept while you sign in, but browsers can’t keep selected files. You’ll need to choose these photos again after signing in.</p>
        </div>
      )}

      {photos.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Selected photos">
          {photos.map((photo, index) => (
            <li key={photo.id} className="relative aspect-[4/3] overflow-hidden rounded-xl border border-border bg-muted">
              <Image src={photo.previewUrl} alt={`Selected photo ${index + 1}: ${photo.file.name}`} fill unoptimized className="object-cover" />
              <button type="button" onClick={() => onRemove(photo.id)} aria-label={`Remove photo ${index + 1}, ${photo.file.name}`} className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full bg-background/95 text-foreground shadow-md transition-colors hover:bg-destructive hover:text-destructive-foreground">
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PackageQuestionInput({ serviceId, question, value, onChange }: { serviceId: string; question: PackageQualifyingQuestion; value: string; onChange: (serviceId: string, questionKey: string, answer: string) => void }) {
  const id = `question-${serviceId}-${question.question_key}`;
  const options = questionOptions(question.options);
  return <FormField id={id} label={question.question_label} required={question.is_required !== false} help={question.unit ? `Unit: ${question.unit}` : undefined}>
    {control => question.input_type === "select" && options.length ? <Select {...control} value={value} onChange={event => onChange(serviceId, question.question_key, event.target.value)}>
      <option value="">Choose an answer</option>
      {options.map(option => <option key={option} value={option}>{option}</option>)}
    </Select> : <Input {...control} maxLength={200} type={question.input_type === "number" ? "number" : "text"} inputMode={question.input_type === "number" ? "decimal" : undefined} value={value} onChange={event => onChange(serviceId, question.question_key, event.target.value)} />}
  </FormField>;
}

type ContactStepProps = {
  selectedServices: ServiceOption[];
  frequencies: Record<string, Frequency>;
  availabilityItems: AvailabilityItem[];
  coverageStatus: RequestCoverageStatus;
  coverageResult: RequestCoverageResult | null;
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
  submissionUnknown: boolean;
  keyConflict: boolean;
  interestOnly: boolean;
  onFinishWithInterest: () => void;
  onSubmitAsNew: () => void;
  onRemoveService: (serviceId: string) => void;
  onUseAnyProvider: (serviceId: string) => void;
  onRegisterInterest: (serviceId: string) => void;
  onRetryAvailability: () => void;
  onFirstName: (value: string) => void;
  onLastName: (value: string) => void;
  onEmail: (value: string) => void;
  onPhone: (value: string) => void;
  onSmsUpdates: (value: boolean) => void;
  onRetryCoverage: () => void;
  onBack: () => void;
};

function ContactStep(props: ContactStepProps) {
  const covered = props.coverageStatus === "covered";
  const ready = props.availabilityItems.map((item) => item.availability).filter((availability): availability is ServiceAvailability => Boolean(availability) && availability !== "error");
  const fixed = ready.filter((availability) => availability.kind === "fixed" && availability.exact);
  const fixedTotal = fixed.reduce((total, availability) => total + (availability.kind === "fixed" ? availability.total : 0), 0);
  const quoteCount = ready.filter((availability) => availability.kind === "quote").length;
  const blocked = props.availabilityItems.some((item) => {
    const availability = item.availability;
    return !availability || availability === "error" || !((availability.kind === "fixed" && availability.exact) || availability.kind === "quote");
  });
  const singleFixed = props.availabilityItems.length === 1 && fixed.length === 1;
  const submitLabel = props.submissionUnknown ? "Check and finish submitting"
    : !covered
    ? props.coverageStatus === "waitlist" ? "Join the service-area list" : props.coverageStatus === "error" ? "Check coverage again" : "Notify me when coverage expands"
    : props.isSignedIn ? "Request service" : "Sign in to request service";

  return (
    <div>
      <div className="mb-8">
        <p className="mb-2 text-sm font-medium text-muted-foreground">Final review</p>
        <h2 id="request-step" data-step-heading tabIndex={-1} className="scroll-mt-24 text-2xl font-semibold sm:text-3xl">Review and confirm</h2>
        <p className="mt-2 max-w-2xl leading-6 text-muted-foreground">Check each service’s price and availability at your address, add your contact details, then submit.</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <CoverageStatusPanel status={props.coverageStatus} result={props.coverageResult} onRetry={props.onRetryCoverage} review />

          {props.submissionUnknown && (
            <div id="request-unknown" tabIndex={-1} className="rounded-xl border border-status-warning bg-status-warning-bg p-4 text-sm text-foreground">
              <p className="font-semibold">We couldn’t confirm whether your request was saved</p>
              <p className="mt-1">Select “Check and finish submitting” to resend exactly what you submitted. If it was already saved, you’ll see it; nothing is created twice.</p>
            </div>
          )}
          {props.keyConflict && (
            <div id="request-conflict" tabIndex={-1} className="rounded-xl border border-status-warning bg-status-warning-bg p-4 text-sm text-foreground">
              <p className="font-semibold">A request from this form was already saved</p>
              <p className="mt-1">It was saved with different details than you see now. Check your requests first. If you still need this one too, submit it as a new request.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/dashboard" className={buttonVariants({ variant: "outline", size: "sm", className: "min-h-11 bg-background" })}>View your requests</Link>
                <Button type="button" size="sm" className="min-h-11" onClick={props.onSubmitAsNew} loading={props.isSubmitting}>Submit as a new request</Button>
              </div>
            </div>
          )}

          {covered && props.availabilityItems.length > 0 && (
            <ServiceAvailabilityList headingId="review-availability" items={props.availabilityItems} formatMoney={formatMoney} onRemove={props.onRemoveService} onUseAnyProvider={props.onUseAnyProvider} onRegisterInterest={props.onRegisterInterest} onRetry={props.onRetryAvailability} />
          )}

          {props.interestOnly && (
            <div className="rounded-xl border border-accent-border bg-accent-subtle/40 p-4 text-sm">
              <p className="font-semibold">Interest saved for every service in your plan</p>
              <p className="mt-1 text-muted-foreground">None of them can be booked here yet, so there’s nothing to submit.</p>
              <Button type="button" className="mt-3" onClick={props.onFinishWithInterest}>Finish</Button>
            </div>
          )}

          <Card className="border-accent-border bg-accent-subtle/25 shadow-sm">
            <CardHeader>
              <CardTitle><h3>Visit preferences</h3></CardTitle>
              <p className="text-sm text-muted-foreground">Preferences only. A time is confirmed with you after a provider accepts.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <ReviewDetail label="Window starts" value={props.preferredDate ? `${formatReviewDate(props.preferredDate)} (ET)` : "Not selected"} />
                <ReviewDetail label="Window ends" value={props.preferredEndDate ? `${formatReviewDate(props.preferredEndDate)} (ET)` : "Not selected"} />
                <ReviewDetail label="Time of day" value={timeOfDayLabel(props.timeOfDay)} />
              </dl>
              <div className="rounded-xl border border-accent-border bg-card p-4">
                <p className="text-sm font-semibold">Access and arrival</p>
                <p className="mt-1 text-sm">{accessMethodLabel(props.accessMethod)} · {petStatusLabel(props.petStatus)}</p>
                {(props.entryInstructions.trim() || props.parkingNotes.trim()) && (
                  <div className="mt-2 space-y-1 text-sm leading-5 text-muted-foreground">
                    {props.entryInstructions.trim() && <p><span className="font-medium text-foreground">Entry:</span> {props.entryInstructions.trim()}</p>}
                    {props.parkingNotes.trim() && <p><span className="font-medium text-foreground">Parking/location:</span> {props.parkingNotes.trim()}</p>}
                  </div>
                )}
              </div>
              <div className="border-t border-accent-border pt-4">
                <p className="text-sm font-semibold">Photos</p>
                <p className="mt-1 text-sm text-muted-foreground">{props.photos.length ? covered ? `${props.photos.length} photo${props.photos.length === 1 ? "" : "s"} will upload after your request is saved.` : `${props.photos.length} photo${props.photos.length === 1 ? "" : "s"} stay on this device and won’t upload with coverage interest.` : "No photos attached."}</p>
                {props.photos.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {props.photos.map((photo, index) => (
                      <div key={photo.id} className="relative h-16 w-20 shrink-0 overflow-hidden rounded-lg border border-border bg-muted">
                        <Image src={photo.previewUrl} alt={`Selected photo ${index + 1}`} fill unoptimized className="object-cover" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle><h3>Contact information</h3></CardTitle>
              <p className="text-sm text-muted-foreground">
                {covered ? "We use these details to coordinate your request." : "We use these details only to follow up about coverage."}
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField id="firstName" label="First name" required>{control => <Input {...control} autoComplete="given-name" maxLength={100} className="h-12" value={props.firstName} onChange={(event) => props.onFirstName(event.target.value)} />}</FormField>
                <FormField id="lastName" label="Last name" required>{control => <Input {...control} autoComplete="family-name" maxLength={100} className="h-12" value={props.lastName} onChange={(event) => props.onLastName(event.target.value)} />}</FormField>
              </div>
              <FormField id="email" label="Email" required>{control => <Input {...control} type="email" autoComplete="email" maxLength={254} className="h-12" value={props.email} onChange={(event) => props.onEmail(event.target.value)} />}</FormField>
              <FormField id="phone" label="Phone" required>{control => <Input {...control} type="tel" autoComplete="tel" maxLength={50} placeholder="(239) 555-0123" className="h-12" value={props.phone} onChange={(event) => props.onPhone(event.target.value)} />}</FormField>
              {covered && (
                <Checkbox checked={props.smsUpdates} onChange={(event) => props.onSmsUpdates(event.target.checked)} label="I agree to receive SMS updates about this service request. Standard messaging rates may apply." />
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit border-accent-border bg-card shadow-lg shadow-slate/5 lg:sticky lg:top-24">
          <CardHeader className="border-b border-accent-border bg-accent-subtle">
            <CardTitle><h3>Your service plan</h3></CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <ul className="space-y-3">
              {props.availabilityItems.map((item) => {
                const availability = item.availability;
                const amount = !covered ? "Not bookable here" : !availability ? "Checking…" : availability === "error" ? "Not checked" : availability.kind === "fixed" ? availability.exact ? formatMoney(availability.total) : `From ${formatMoney(availability.total)}` : availability.kind === "quote" ? "Quote required" : "Can’t be booked";
                return (
                  <li key={item.serviceId} className="flex justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-sm text-muted-foreground">{item.cadence}</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums">{amount}</p>
                  </li>
                );
              })}
            </ul>

            {covered ? (
              <div className="space-y-3 border-t border-accent-border pt-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-muted-foreground">Fixed prices</span>
                  <span className="text-2xl font-semibold tabular-nums">{formatMoney(fixedTotal)}</span>
                </div>
                <p className="text-sm leading-5 text-muted-foreground">
                  {quoteCount > 0 ? `${quoteCount} service${quoteCount === 1 ? " needs" : "s need"} a quote and ${quoteCount === 1 ? "isn’t" : "aren’t"} included. ` : ""}
                  This is the service price when you request. Checkout shows the final amount, including any tax, before you pay.
                </p>
                <div className="rounded-xl border border-accent-border bg-accent-subtle/50 p-4">
                  <div className="flex items-start gap-3">
                    <CreditCard aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
                    <div>
                      <p className="text-sm font-semibold">{singleFixed ? "Secure checkout may follow" : "No payment on this page"}</p>
                      <p className="mt-1 text-sm leading-5 text-muted-foreground">
                        {singleFixed
                          ? "If this fixed price is still valid when you submit, you’ll review the terms in secure checkout. Nothing is paid until checkout confirms it."
                          : quoteCount > 0
                            ? "Quote services are priced only when you accept a quote; any deposit is set then."
                            : "Online payment covers one fixed-price service at a time, so this plan is saved without payment."}
                      </p>
                    </div>
                  </div>
                </div>
                <p className="flex items-start gap-2 text-sm leading-5 text-muted-foreground">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  All services are submitted together. If anything changed, nothing is submitted and we show you what changed.
                </p>
              </div>
            ) : (
              <p className="border-t border-accent-border pt-4 text-sm leading-5 text-muted-foreground">No request, provider assignment, booking or payment is created for an address outside the service area.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 flex flex-col-reverse justify-between gap-3 sm:flex-row">
        <Button type="button" variant="outline" size="lg" onClick={props.onBack}>
          <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back
        </Button>
        <Button type="submit" size="lg" aria-busy={props.isSubmitting} disabled={props.isSubmitting || (!props.submissionUnknown && (props.coverageStatus === "checking" || props.coverageStatus === "idle" || (covered && blocked) || props.interestOnly))} className="bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active">
          {props.isSubmitting ? (
            <><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> {props.photoUploadProgress.total > 0 ? `Uploading photos ${props.photoUploadProgress.completed} of ${props.photoUploadProgress.total}` : covered || props.submissionUnknown ? "Submitting…" : "Saving…"}</>
          ) : !props.submissionUnknown && (props.coverageStatus === "checking" || props.coverageStatus === "idle") ? "Checking coverage…" : submitLabel}
        </Button>
      </div>
      {covered && blocked && !props.submissionUnknown && !props.interestOnly && (
        <p className="mt-3 text-right text-sm text-muted-foreground">Resolve each service above to submit.</p>
      )}
    </div>
  );
}

function ReviewDetail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-accent-border bg-card p-3"><dt className="text-sm font-semibold text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>;
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
  return `Preferred window (ET): ${formatReviewDate(start)}${endSummary} · ${timeOfDayLabel(timeOfDay)}`;
}

function formatReviewDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
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

function coverageInterestMessage({
  coverage,
  selectedServices,
  streetAddress,
  city,
  stateCode,
  zipCode,
  preferredDate,
  preferredEndDate,
  timeOfDay,
  description,
}: {
  coverage: RequestCoverageResult;
  selectedServices: ServiceOption[];
  streetAddress: string;
  city: string;
  stateCode: string;
  zipCode: string;
  preferredDate: string;
  preferredEndDate: string;
  timeOfDay: TimeOfDay;
  description: string;
}) {
  const coverageLabel = coverage.status === "waitlist" ? "Admin-managed waitlist area" : "Outside current active coverage";
  const dateWindow = preferredDate
    ? `${formatReviewDate(preferredDate)}${preferredEndDate && preferredEndDate !== preferredDate ? ` through ${formatReviewDate(preferredEndDate)}` : ""} (ET) · ${timeOfDayLabel(timeOfDay)}`
    : "No timing preference supplied";

  return [
    "Service-area interest submitted from /request.",
    `Coverage result: ${coverageLabel}`,
    `Location: ${streetAddress.trim()}, ${city.trim()}, ${stateCode.trim().toUpperCase()} ${zipCode.trim()}`,
    `Services: ${selectedServices.map((service) => service.name).join(", ")}`,
    `Preferred timing: ${dateWindow}`,
    `Project notes: ${description.trim() || "None provided"}`,
    "No service_request was created. No provider was assigned. No photos were uploaded. No payment was collected.",
  ].join("\n");
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

function servicePrice(service: ServiceOption, frequency: Frequency) {
  return planningPrice(toPlanningService(service), frequency);
}

function isBuilderRequestedService(item: unknown): item is BuilderRequestedService {
  if (!item || typeof item !== "object") return false;
  const value = item as Partial<BuilderRequestedService>;
  return typeof value.id === "string" && serviceIdPattern.test(value.id) && typeof value.name === "string" && ["fixed", "quote", "sourcing"].includes(String(value.availability));
}

function questionOptions(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((option): option is string => typeof option === "string" && Boolean(option.trim()));
  if (value && typeof value === "object" && "choices" in value && Array.isArray(value.choices)) {
    return value.choices.filter((option): option is string => typeof option === "string" && Boolean(option.trim()));
  }
  return [];
}

function formatMoney(value: number) {
  return formatPlanningMoney(value);
}

/** Intake cards never receive promotion labels or base prices (DEC-2026-015). */
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
  };
}

function formatServiceName(id: string) {
  return id.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function withoutKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}
