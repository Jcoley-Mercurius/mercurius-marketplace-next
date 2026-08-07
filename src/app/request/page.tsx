"use client";

import { useEffect, useMemo, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  CalendarDays,
  Check,
  CheckCircle2,
  Droplets,
  Home,
  Info,
  Leaf,
  Loader2,
  LogIn,
  ShieldCheck,
  Sparkles,
  Upload,
  Waves,
  Wind,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Step = "services" | "details" | "contact";
type Frequency = "weekly" | "monthly" | "quarterly" | "one-time";

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
};

type BuilderRequestedService = { id: string; name: string; availability: "fixed" | "quote" | "sourcing"; descriptor?: string; defaultFrequency?: Frequency; frequencies?: Frequency[]; prices?: Partial<Record<Frequency, number>> };

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
  const [photos, setPhotos] = useState<File[]>([]);
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
  const { user } = useAuth();
  const router = useRouter();

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
          }])));
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
    }));
  }, [city, description, email, firstName, frequencies, hydrated, isComplete, lastName, phone, preferredDate, preferredProviderNames, preferredProviders, selectedIds, serviceOverrides, smsUpdates, stateCode, step, streetAddress, zipCode]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step, isComplete]);

  const requestServiceOptions = useMemo(() => {
    const knownIds = new Set(serviceOptions.map((service) => service.id));
    const known = serviceOptions.map((service) => ({ ...service, ...serviceOverrides[service.id] }));
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
      }));
    return [...known, ...live];
  }, [serviceOverrides]);
  const selectedServices = useMemo(() => requestServiceOptions.filter((service) => selectedIds.includes(service.id)), [requestServiceOptions, selectedIds]);
  const estimate = useMemo(() => selectedServices.reduce((total, service) => total + servicePrice(service, frequencies[service.id] ?? service.defaultFrequency), 0), [frequencies, selectedServices]);
  const stepIndex = stepOrder.indexOf(step);

  function toggleService(id: string) {
    const removing = selectedIds.includes(id);
    setSelectedIds((current) => removing ? current.filter((serviceId) => serviceId !== id) : [...current, id]);
    if (removing) {
      setPreferredProviders((providers) => withoutKey(providers, id));
      setPreferredProviderNames((names) => withoutKey(names, id));
    }
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
    setStep("contact");
  }

  function addPhotos(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    setPhotos((current) => [...current, ...images].slice(0, 6));
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
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
      toast.info("Almost done — sign in to confirm", { description: "Your request has been saved in this browser." });
      router.push("/login?redirect=/request");
      return;
    }

    setIsSubmitting(true);
    try {
      const inserts = selectedServices.map((service) => {
        const frequency = frequencies[service.id] ?? service.defaultFrequency;
        const amount = servicePrice(service, frequency);
        return {
          customer_id: user.id,
          service_type: service.name,
          contractor_id: preferredProviders[service.id] ?? null,
          address: streetAddress.trim(),
          city: city.trim(),
          state: stateCode.trim().toUpperCase(),
          zip_code: zipCode.trim(),
          preferred_date: preferredDate || null,
          description: description.trim() || null,
          status: "pending",
          frequency,
          pricing_mode: amount > 0 ? "fixed" : "custom_quote",
          quote_only: amount === 0,
          total_amount: amount || null,
          service_catalog_id: service.id,
        };
      });
      const supabase = createClient();
      const { error } = await supabase.from("service_requests").insert(inserts);
      if (error) throw error;

      window.sessionStorage.removeItem(storageKey);
      setIsComplete(true);
      toast.success("Request submitted", { description: "We’ll be in touch to confirm your service." });
    } catch (error) {
      toast.error("Submission failed", { description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isComplete) {
    return <SuccessState services={selectedServices} preferredProviderNames={preferredProviderNames} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <section className="bg-hero py-12 text-center md:py-16">
          <div className="container-narrow">
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
          <div className="container-narrow">
            <form onSubmit={handleSubmit}>
              {step === "services" && <ServicesStep services={requestServiceOptions} selectedIds={selectedIds} frequencies={frequencies} preferredProviderNames={preferredProviderNames} onToggle={toggleService} onFrequencyChange={(id, frequency) => setFrequencies((current) => ({ ...current, [id]: frequency }))} estimate={estimate} onContinue={continueFromServices} />}
              {step === "details" && <DetailsStep streetAddress={streetAddress} city={city} stateCode={stateCode} zipCode={zipCode} preferredDate={preferredDate} description={description} photos={photos} onStreetAddress={setStreetAddress} onCity={setCity} onStateCode={setStateCode} onZipCode={setZipCode} onPreferredDate={setPreferredDate} onDescription={setDescription} onPhotos={addPhotos} onDrop={handleDrop} onRemovePhoto={(index) => setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))} onBack={() => setStep("services")} onContinue={continueFromDetails} />}
              {step === "contact" && <ContactStep selectedServices={selectedServices} frequencies={frequencies} preferredProviderNames={preferredProviderNames} estimate={estimate} firstName={firstName} lastName={lastName} email={email} phone={phone} smsUpdates={smsUpdates} isSubmitting={isSubmitting} isSignedIn={!!user} onFirstName={setFirstName} onLastName={setLastName} onEmail={setEmail} onPhone={setPhone} onSmsUpdates={setSmsUpdates} onBack={() => setStep("details")} />}
            </form>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function ServicesStep({ services, selectedIds, frequencies, preferredProviderNames, onToggle, onFrequencyChange, estimate, onContinue }: { services: ServiceOption[]; selectedIds: string[]; frequencies: Record<string, Frequency>; preferredProviderNames: Record<string, string>; onToggle: (id: string) => void; onFrequencyChange: (id: string, value: Frequency) => void; estimate: number; onContinue: () => void }) {
  return <div><div className="mb-8"><h2 className="text-2xl font-semibold">What does your home need?</h2><p className="mt-2 text-muted-foreground">Choose one or more services. You can adjust the preferred cadence before continuing.</p></div><div className="grid gap-4 sm:grid-cols-2">{services.map((service) => { const selected = selectedIds.includes(service.id); const Icon = service.icon; const frequency = frequencies[service.id] ?? service.defaultFrequency; return <Card key={service.id} className={cn("cursor-pointer transition-all", selected ? "ring-2 ring-accent" : "hover:ring-accent/30")} onClick={() => onToggle(service.id)}><CardContent className="flex gap-4"><span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", selected ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}><Icon className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{service.name}</p><p className="mt-1 text-sm text-muted-foreground">{service.description}</p>{preferredProviderNames[service.id] && <p className="mt-2 flex items-center gap-1 text-xs font-medium text-accent"><ShieldCheck className="h-3.5 w-3.5" />Requested provider: {preferredProviderNames[service.id]}</p>}</div>{selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-accent" />}</div>{selected && <div className="mt-4" onClick={(event) => event.stopPropagation()}><Label htmlFor={`frequency-${service.id}`} className="text-xs text-muted-foreground">Frequency</Label><select id={`frequency-${service.id}`} value={frequency} onChange={(event) => onFrequencyChange(service.id, event.target.value as Frequency)} className="mt-1 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">{service.frequencies.map((item) => <option key={item} value={item}>{frequencyLabel(item)} · {servicePriceLabel(service, item)}</option>)}</select></div>}</div></CardContent></Card>; })}</div><div className="mt-8 flex flex-col gap-4 rounded-2xl border border-accent/20 bg-accent/5 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm text-muted-foreground">Estimated plan total</p><p className="text-2xl font-bold">{estimate > 0 ? `$${estimate}` : "Custom quote"}</p><p className="text-xs text-muted-foreground">Live package pricing when supplied; final scope is confirmed before service.</p></div><Button type="button" size="lg" onClick={onContinue} className="bg-accent text-accent-foreground hover:bg-accent/90">Continue to Your Home <ArrowRight className="h-4 w-4" /></Button></div></div>;
}

type DetailsStepProps = { streetAddress: string; city: string; stateCode: string; zipCode: string; preferredDate: string; description: string; photos: File[]; onStreetAddress: (value: string) => void; onCity: (value: string) => void; onStateCode: (value: string) => void; onZipCode: (value: string) => void; onPreferredDate: (value: string) => void; onDescription: (value: string) => void; onPhotos: (files: File[]) => void; onDrop: (event: DragEvent<HTMLLabelElement>) => void; onRemovePhoto: (index: number) => void; onBack: () => void; onContinue: () => void };

function DetailsStep(props: DetailsStepProps) {
  const minDate = new Date().toISOString().slice(0, 10);
  return <div><div className="mb-8"><h2 className="text-2xl font-semibold">Tell us about your home</h2><p className="mt-2 text-muted-foreground">Add the service location, timing, and anything our team should know.</p></div><Card><CardHeader><CardTitle>Service Details</CardTitle></CardHeader><CardContent className="space-y-6"><div className="space-y-2"><Label htmlFor="streetAddress">Street address</Label><Input id="streetAddress" autoComplete="address-line1" placeholder="123 Main St" className="h-12" value={props.streetAddress} onChange={(event) => props.onStreetAddress(event.target.value)} /></div><div className="grid gap-4 sm:grid-cols-6"><div className="space-y-2 sm:col-span-3"><Label htmlFor="city">City</Label><Input id="city" autoComplete="address-level2" className="h-12" value={props.city} onChange={(event) => props.onCity(event.target.value)} /></div><div className="space-y-2 sm:col-span-1"><Label htmlFor="state">State</Label><Input id="state" autoComplete="address-level1" maxLength={2} className="h-12 uppercase" value={props.stateCode} onChange={(event) => props.onStateCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))} /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="zip">ZIP code</Label><Input id="zip" autoComplete="postal-code" inputMode="numeric" maxLength={10} className="h-12" value={props.zipCode} onChange={(event) => props.onZipCode(event.target.value.replace(/[^\d-]/g, ""))} /></div></div><div className="space-y-2"><Label htmlFor="preferredDate">Preferred date</Label><div className="relative"><CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="preferredDate" type="date" min={minDate} className="h-12 pl-10" value={props.preferredDate} onChange={(event) => props.onPreferredDate(event.target.value)} /></div><p className="text-xs text-muted-foreground">This is a preference. We&apos;ll confirm the actual appointment with you.</p></div><div className="space-y-2"><Label htmlFor="description">Description</Label><textarea id="description" rows={5} placeholder="Describe the work, access instructions, or anything else we should know..." value={props.description} onChange={(event) => props.onDescription(event.target.value)} className="w-full resize-y rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" /></div><div className="space-y-2"><Label>Photos (optional)</Label><label htmlFor="photo-upload" onDragOver={(event) => event.preventDefault()} onDrop={props.onDrop} className="block cursor-pointer rounded-xl border-2 border-dashed border-border p-7 text-center transition-colors hover:border-accent/50"><Upload className="mx-auto mb-2 h-7 w-7 text-muted-foreground" /><p className="text-sm text-muted-foreground">Drag and drop images, or click to browse</p><p className="mt-1 text-xs text-muted-foreground">Up to 6 photos; upload connection coming in a later version.</p><input id="photo-upload" type="file" accept="image/*" multiple className="sr-only" onChange={(event) => { props.onPhotos(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>{props.photos.length > 0 && <div className="flex flex-wrap gap-2">{props.photos.map((file, index) => <button key={`${file.name}-${index}`} type="button" onClick={() => props.onRemovePhoto(index)} className="rounded-lg border border-border bg-muted px-3 py-2 text-xs hover:border-destructive" title="Remove photo">{file.name} ×</button>)}</div>}</div></CardContent></Card><div className="mt-8 flex flex-col-reverse justify-between gap-3 sm:flex-row"><Button type="button" variant="outline" size="lg" onClick={props.onBack}><ArrowLeft className="h-4 w-4" /> Back</Button><Button type="button" size="lg" onClick={props.onContinue} className="bg-accent text-accent-foreground hover:bg-accent/90">Continue to Review <ArrowRight className="h-4 w-4" /></Button></div></div>;
}

type ContactStepProps = { selectedServices: ServiceOption[]; frequencies: Record<string, Frequency>; preferredProviderNames: Record<string, string>; estimate: number; firstName: string; lastName: string; email: string; phone: string; smsUpdates: boolean; isSubmitting: boolean; isSignedIn: boolean; onFirstName: (value: string) => void; onLastName: (value: string) => void; onEmail: (value: string) => void; onPhone: (value: string) => void; onSmsUpdates: (value: boolean) => void; onBack: () => void };

function ContactStep(props: ContactStepProps) {
  return <div><div className="mb-8"><h2 className="text-2xl font-semibold">Review and confirm</h2><p className="mt-2 text-muted-foreground">Tell us how to reach you and review your service plan.</p></div><div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]"><Card><CardHeader><CardTitle>Contact Information</CardTitle></CardHeader><CardContent className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="firstName">First Name</Label><Input id="firstName" autoComplete="given-name" className="h-12" value={props.firstName} onChange={(event) => props.onFirstName(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="lastName">Last Name</Label><Input id="lastName" autoComplete="family-name" className="h-12" value={props.lastName} onChange={(event) => props.onLastName(event.target.value)} required /></div></div><div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" className="h-12" value={props.email} onChange={(event) => props.onEmail(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="phone">Phone</Label><Input id="phone" type="tel" autoComplete="tel" placeholder="(239) 555-0123" className="h-12" value={props.phone} onChange={(event) => props.onPhone(event.target.value)} required /></div><label className="flex cursor-pointer items-start gap-3 text-sm text-muted-foreground"><input type="checkbox" checked={props.smsUpdates} onChange={(event) => props.onSmsUpdates(event.target.checked)} className="mt-1 h-4 w-4 accent-accent" /><span>I agree to receive SMS updates about this service request. Standard messaging rates may apply.</span></label></CardContent></Card><Card className="h-fit border-accent/20 bg-accent/5 ring-accent/20"><CardHeader><CardTitle>Your Plan</CardTitle></CardHeader><CardContent><div className="space-y-3">{props.selectedServices.map((service) => { const frequency = props.frequencies[service.id] ?? service.defaultFrequency; return <div key={service.id} className="flex justify-between gap-4 border-b border-accent/10 pb-3 last:border-0"><div><p className="font-medium">{service.name}</p><p className="text-xs capitalize text-muted-foreground">{frequencyLabel(frequency)}</p></div><p className="font-semibold">{servicePriceLabel(service, frequency)}</p></div>; })}</div><div className="mt-5 border-t border-accent/20 pt-4"><div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">Estimated total</span><span className="text-2xl font-bold">{props.estimate > 0 ? `$${props.estimate}` : "Quote"}</span></div><div className="mt-4 flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><p className="text-xs text-muted-foreground">Preview pricing only. Scope, provider, schedule, and final pricing are confirmed before work begins.</p></div></div></CardContent></Card></div><div className="mt-8 flex flex-col-reverse justify-between gap-3 sm:flex-row"><Button type="button" variant="outline" size="lg" onClick={props.onBack}><ArrowLeft className="h-4 w-4" /> Back</Button><Button type="submit" size="lg" disabled={props.isSubmitting} className="bg-accent text-accent-foreground hover:bg-accent/90">{props.isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</> : props.isSignedIn ? "Submit Request" : "Sign In to Submit"}</Button></div></div>;
}

function SuccessState({ services, preferredProviderNames }: { services: ServiceOption[]; preferredProviderNames: Record<string, string> }) {
  const providerNames = [...new Set(Object.values(preferredProviderNames))];
  return <div className="min-h-screen bg-background"><Header /><main className="py-16 md:py-24"><div className="container-narrow"><div className="mb-10 text-center"><span className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full bg-sage-light"><CheckCircle2 className="h-10 w-10 text-sage-dark" /></span><h1 className="mb-4 text-3xl font-semibold">Request Submitted!</h1><p className="mx-auto max-w-xl text-lg text-muted-foreground">Thank you for your request. Our team will review the details and contact you to confirm next steps.</p></div><Card className="mx-auto mb-8 max-w-xl"><CardHeader><CardTitle>Booking Summary</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex justify-between gap-4"><span className="text-muted-foreground">Services</span><span className="text-right font-medium">{services.map((service) => service.name).join(", ")}</span></div><div className="flex justify-between gap-4"><span className="text-muted-foreground">Provider</span><span className="text-right font-medium">{providerNames.length ? providerNames.join(", ") : "Matching in progress"}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="font-semibold text-sage-dark">Request Sent</span></div></CardContent></Card><div className="mx-auto mb-8 max-w-xl"><h2 className="mb-5 text-center font-semibold">What happens next</h2>{["Sent", "Provider confirmed", "Service in progress", "Completed", "Leave a review"].map((label, index, items) => <div key={label} className="flex items-start gap-4"><div className="flex flex-col items-center"><span className={cn("flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium", index === 0 ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{index === 0 ? <CheckCircle2 className="h-4 w-4" /> : index + 1}</span>{index < items.length - 1 && <span className="h-6 w-0.5 bg-border" />}</div><p className={cn("pt-1.5 text-sm", index === 0 ? "font-medium" : "text-muted-foreground")}>{label}</p></div>)}</div><div className="flex justify-center gap-3"><Link href="/dashboard" className={buttonVariants({ variant: "outline", size: "lg" })}>View Dashboard</Link><Link href="/" className={buttonVariants({ size: "lg" })}>Return Home</Link></div></div></main></div>;
}

function servicePrice(service: ServiceOption, frequency: Frequency) {
  if (service.id === "general-home-service") return 0;
  if (service.livePrices) return service.livePrices[frequency] ?? 0;
  return frequency === "one-time" ? service.oneTimePrice : service.monthlyPrice;
}

function isBuilderRequestedService(item: unknown): item is BuilderRequestedService {
  if (!item || typeof item !== "object") return false;
  const value = item as Partial<BuilderRequestedService>;
  return typeof value.id === "string" && typeof value.name === "string" && ["fixed", "quote", "sourcing"].includes(String(value.availability));
}

function servicePriceLabel(service: ServiceOption, frequency: Frequency) {
  const price = servicePrice(service, frequency);
  if (!price) return "Quote";
  if (frequency === "one-time") return `$${price}`;
  if (frequency === "weekly") return `$${price}/wk`;
  if (frequency === "quarterly") return `$${price}/qtr`;
  return `$${price}/mo`;
}

function frequencyLabel(frequency: Frequency) {
  return frequency === "one-time" ? "One-time" : frequency.charAt(0).toUpperCase() + frequency.slice(1);
}

function formatServiceName(id: string) {
  return id.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function withoutKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}
