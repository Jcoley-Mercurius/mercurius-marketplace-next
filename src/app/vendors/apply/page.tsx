"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  MAX_VENDOR_DOCUMENT_COUNT,
  VENDOR_DOCUMENT_ACCEPT,
  VENDOR_DOCUMENT_BUCKET,
  validateVendorDocument,
  type VendorDocumentKind,
} from "@/lib/vendorApplicationDocuments";

const steps = ["Business", "Contact", "Service Area", "Credentials", "Review"];
const teamSizes = ["Just me", "2–5", "6–10", "11–25", "25+"];
const primaryCategories = [
  "Lawn Care & Mowing", "Landscaping", "Irrigation & Sprinklers", "Tree Service",
  "Pool Service", "House Cleaning", "Window Cleaning", "Pressure Washing",
  "Trash Can Cleaning", "Handyman", "HVAC", "Electrical", "Plumbing", "Roofing",
  "Painting", "Flooring", "Garage Door", "Appliance Repair", "Pest Control",
  "Junk Removal", "Gutter Cleaning & Repair", "Screen & Lanai Repair",
  "Dryer Vent Cleaning", "Specialty / Other",
];
const serviceAreas = [
  "Cape Coral", "Fort Myers", "Fort Myers Beach", "North Fort Myers", "Estero",
  "Lehigh Acres", "Bonita Springs", "Sanibel / Captiva", "Naples", "Punta Gorda",
];
const suggestedServices: Record<string, string[]> = {
  "Lawn Care & Mowing": ["Mowing", "Edging & trimming", "Hedge trimming", "Fertilization", "Seasonal cleanups"],
  Landscaping: ["Landscape design", "Planting", "Mulching", "Sod install", "Landscape lighting"],
  "Pool Service": ["Weekly pool cleaning", "Chemical balancing", "Filter cleaning", "Equipment repair"],
  "House Cleaning": ["Standard cleaning", "Deep cleaning", "Move in / move out", "Vacation rental turnover"],
  "Pressure Washing": ["Driveway & walkway", "House soft wash", "Roof cleaning", "Pool deck & lanai"],
  Handyman: ["Small repairs", "Furniture assembly", "Drywall patching", "TV & shelf mounting"],
  HVAC: ["AC repair", "AC replacement", "Maintenance tune-ups", "Duct cleaning", "Thermostat install"],
  Electrical: ["Outlet & switch repair", "Lighting install", "Ceiling fans", "Panel upgrades"],
  Plumbing: ["Leak repair", "Drain cleaning", "Water heater service", "Fixture install"],
  "Pest Control": ["General pest", "Termite treatment", "Rodent control", "Mosquito treatment"],
};
const credentialOptions = [
  { id: "licensed", label: "Licensed" },
  { id: "insured", label: "Fully insured" },
  { id: "bbb", label: "BBB accredited" },
  { id: "angi", label: "Angi listed" },
  { id: "google_reviews", label: "Google reviews" },
  { id: "other", label: "Other certification" },
];

type FormState = {
  businessName: string;
  primaryCategory: string;
  teamSize: string;
  yearsExperience: string;
  businessDescription: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  website: string;
  preferredContact: string;
  servicesText: string;
  additionalNotes: string;
  otherCertification: string;
  licenseNumber: string;
  insurancePolicyNumber: string;
};

type SelectedDocument = {
  id: string;
  file: File;
  kind: VendorDocumentKind;
};
type SubmissionStage = "idle" | "saving" | "uploading" | "finalizing";
type DocumentUploadStatus = "waiting" | "uploading" | "uploaded" | "failed";

type ApplicationCreationResponse = {
  applicationId?: string;
  uploads?: Array<{ clientId: string; path: string; token: string }>;
  finalizeToken?: string | null;
  uploadWarning?: string | null;
  error?: string;
};

const initialForm: FormState = {
  businessName: "", primaryCategory: "", teamSize: "", yearsExperience: "",
  businessDescription: "", firstName: "", lastName: "", email: "", phone: "",
  website: "", preferredContact: "either", servicesText: "", additionalNotes: "",
  otherCertification: "", licenseNumber: "", insurancePolicyNumber: "",
};

const fieldClass = "w-full rounded-lg border border-input bg-background px-3 py-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring";

export default function VendorApplyPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>(initialForm);
  const [areas, setAreas] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [credentials, setCredentials] = useState<string[]>([]);
  const [documents, setDocuments] = useState<SelectedDocument[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [submissionStage, setSubmissionStage] =
    useState<SubmissionStage>("idle");
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 });
  const [documentUploadStates, setDocumentUploadStates] = useState<
    Record<string, DocumentUploadStatus>
  >({});
  const [submissionWarning, setSubmissionWarning] = useState<string | null>(null);
  const [attachedDocumentCount, setAttachedDocumentCount] = useState(0);

  const suggestions = suggestedServices[form.primaryCategory] ?? [];
  const allServices = useMemo(() => {
    const typed = form.servicesText.split(/[,\n]/).map((value) => value.trim()).filter(Boolean);
    return Array.from(new Set([...services, ...typed]));
  }, [form.servicesText, services]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggle(value: string, values: string[], update: (values: string[]) => void) {
    update(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  function stepIsValid(value: number) {
    if (value === 1) return !!(form.businessName.trim() && form.primaryCategory && form.teamSize && form.yearsExperience !== "");
    if (value === 2) return !!(form.firstName.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) && form.phone.trim());
    if (value === 3) return allServices.length > 0;
    return true;
  }

  function nextStep() {
    if (!stepIsValid(step)) {
      toast.error("A few fields are missing", { description: "Please complete the required fields to continue." });
      return;
    }
    setStep((current) => Math.min(5, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function previousStep() {
    setStep((current) => Math.max(1, current - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addDocuments(files: FileList | null, kind: SelectedDocument["kind"]) {
    if (!files) return;
    const remainingSlots = MAX_VENDOR_DOCUMENT_COUNT - documents.length;
    if (remainingSlots <= 0) {
      toast.error("Document limit reached", {
        description: `You can attach up to ${MAX_VENDOR_DOCUMENT_COUNT} documents.`,
      });
      return;
    }

    const incoming = Array.from(files);
    const valid: SelectedDocument[] = [];
    incoming.slice(0, remainingSlots).forEach((file, index) => {
      const validationError = validateVendorDocument(file);
      if (validationError) {
        toast.error(`${file.name} was not added`, {
          description: validationError,
        });
        return;
      }
      valid.push({
        id:
          globalThis.crypto?.randomUUID?.() ??
          `document-${Date.now()}-${index}`,
        file,
        kind,
      });
    });

    if (incoming.length > remainingSlots) {
      toast.error("Some files were not added", {
        description: `Applications can include up to ${MAX_VENDOR_DOCUMENT_COUNT} documents.`,
      });
    }
    setDocuments((current) => [...current, ...valid]);
  }

  async function submitApplication() {
    if (![1, 2, 3].every(stepIsValid)) {
      toast.error("Please review earlier steps");
      return;
    }
    setIsSubmitting(true);
    setSubmissionStage("saving");
    setSubmissionWarning(null);
    setAttachedDocumentCount(0);
    setUploadProgress({ completed: 0, total: documents.length });
    setDocumentUploadStates(
      Object.fromEntries(documents.map((document) => [document.id, "waiting"])),
    );
    const payload = {
      business_name: form.businessName.trim(),
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim(),
      address: "",
      years_experience: Number.parseInt(form.yearsExperience || "0", 10) || 0,
      services: allServices,
      service_areas: areas.join(", ") || null,
      availability: null,
      primary_category: form.primaryCategory,
      team_size: form.teamSize,
      business_description: form.businessDescription.trim() || null,
      website: form.website.trim() || null,
      preferred_contact: form.preferredContact,
      credentials,
      other_certification: form.otherCertification.trim() || null,
      additional_notes: form.additionalNotes.trim() || null,
      license_number: form.licenseNumber.trim() || null,
      insurance_policy_number: form.insurancePolicyNumber.trim() || null,
    };

    try {
      const creationResponse = await fetch("/api/vendor-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application: payload,
          documents: documents.map((document) => ({
            clientId: document.id,
            kind: document.kind,
            name: document.file.name,
            size: document.file.size,
            type: document.file.type,
          })),
        }),
      });
      const creation =
        (await creationResponse.json()) as ApplicationCreationResponse;
      if (!creationResponse.ok || !creation.applicationId) {
        throw new Error(
          creation.error || "Your application could not be submitted.",
        );
      }

      const warnings = creation.uploadWarning ? [creation.uploadWarning] : [];
      const instructions = new Map(
        (creation.uploads ?? []).map((upload) => [upload.clientId, upload]),
      );
      const successfulPaths: string[] = [];

      if (documents.length > 0) {
        setSubmissionStage("uploading");
        const supabase = createClient();
        let completed = 0;

        for (const document of documents) {
          const instruction = instructions.get(document.id);
          if (!instruction) {
            setDocumentUploadStates((current) => ({
              ...current,
              [document.id]: "failed",
            }));
            warnings.push(`${document.file.name} could not be prepared for upload.`);
            completed += 1;
            setUploadProgress({ completed, total: documents.length });
            continue;
          }

          setDocumentUploadStates((current) => ({
            ...current,
            [document.id]: "uploading",
          }));
          const { error } = await supabase.storage
            .from(VENDOR_DOCUMENT_BUCKET)
            .uploadToSignedUrl(
              instruction.path,
              instruction.token,
              document.file,
              {
                cacheControl: "3600",
                contentType: document.file.type,
                upsert: false,
              },
            );

          if (error) {
            console.error("Credential document upload failed", error);
            setDocumentUploadStates((current) => ({
              ...current,
              [document.id]: "failed",
            }));
            warnings.push(`${document.file.name} could not be uploaded.`);
          } else {
            successfulPaths.push(instruction.path);
            setDocumentUploadStates((current) => ({
              ...current,
              [document.id]: "uploaded",
            }));
          }
          completed += 1;
          setUploadProgress({ completed, total: documents.length });
        }
      }

      if (successfulPaths.length > 0 && creation.finalizeToken) {
        setSubmissionStage("finalizing");
        const finalizeResponse = await fetch(
          "/api/vendor-applications/documents",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              applicationId: creation.applicationId,
              finalizeToken: creation.finalizeToken,
              paths: successfulPaths,
            }),
          },
        );
        const finalization = (await finalizeResponse.json()) as {
          attachedCount?: number;
          error?: string;
        };
        if (!finalizeResponse.ok) {
          warnings.push(
            finalization.error ||
              "Uploaded documents could not be attached to your application.",
          );
        } else {
          setAttachedDocumentCount(finalization.attachedCount ?? 0);
        }
      } else if (documents.length > 0 && successfulPaths.length === 0) {
        warnings.push(
          "Your application was submitted without credential documents.",
        );
      }

      const warning = [...new Set(warnings)].join(" ");
      setSubmissionWarning(warning || null);
      if (warning) {
        toast.warning("Application submitted with a document note", {
          description: warning,
        });
      }
      setIsComplete(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      toast.error("Submission failed", { description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setIsSubmitting(false);
      setSubmissionStage("idle");
    }
  }

  if (isComplete) {
    return <ApplicationSuccess firstName={form.firstName} businessName={form.businessName} email={form.email} selectedDocumentCount={documents.length} attachedDocumentCount={attachedDocumentCount} warning={submissionWarning} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main id="main-content" tabIndex={-1}>
        <section className="bg-hero py-12 text-center md:py-16">
          <div className="container-narrow">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Provider Application</p>
            <h1 className="mb-4 text-3xl font-semibold md:text-4xl">Join The Mercurius Network</h1>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground">Serving Cape Coral, Fort Myers and the rest of SWFL. Free to join, no setup fee — Mercurius earns a 15% commission on completed jobs.</p>
          </div>
        </section>

        <div className="sticky top-16 z-30 border-b border-border bg-background/95 backdrop-blur">
          <div className="container-narrow py-4">
            <div className="flex items-center justify-between gap-1">
              {steps.map((label, index) => {
                const number = index + 1;
                return <div key={label} className="flex flex-1 items-center gap-2 last:flex-none"><span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium", step >= number ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{step > number ? <CheckCircle2 className="h-4 w-4" /> : number}</span><span className={cn("hidden whitespace-nowrap text-sm md:block", step >= number ? "text-foreground" : "text-muted-foreground")}>{label}</span>{number < steps.length && <span className="h-0.5 min-w-3 flex-1 bg-border" />}</div>;
              })}
            </div>
            <p className="mt-2 text-center text-xs text-muted-foreground md:hidden">{steps[step - 1]} · Step {step} of {steps.length}</p>
          </div>
        </div>

        <section className="py-12 md:py-16">
          <div className="container-narrow max-w-3xl">
            {step === 1 && <BusinessStep form={form} setField={setField} />}
            {step === 2 && <ContactStep form={form} setField={setField} />}
            {step === 3 && <ServiceAreaStep form={form} setField={setField} areas={areas} services={services} suggestions={suggestions} toggleArea={(value) => toggle(value, areas, setAreas)} toggleService={(value) => toggle(value, services, setServices)} />}
            {step === 4 && <CredentialsStep form={form} setField={setField} credentials={credentials} documents={documents} toggleCredential={(value) => toggle(value, credentials, setCredentials)} addDocuments={addDocuments} removeDocument={(index) => setDocuments((current) => current.filter((_, itemIndex) => itemIndex !== index))} />}
            {step === 5 && <ReviewStep form={form} areas={areas} services={allServices} credentials={credentials} documents={documents} isSubmitting={isSubmitting} submissionStage={submissionStage} uploadProgress={uploadProgress} documentUploadStates={documentUploadStates} onSubmit={submitApplication} />}

            <div className="mt-10 flex justify-between gap-3">
              <Button type="button" variant="outline" size="lg" onClick={previousStep} disabled={step === 1}><ArrowLeft className="h-4 w-4" /> Back</Button>
              {step < 5 && <Button type="button" size="lg" onClick={nextStep}>Continue <ArrowRight className="h-4 w-4" /></Button>}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

type StepProps = { form: FormState; setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void };

function BusinessStep({ form, setField }: StepProps) {
  return <div className="space-y-6"><StepHeading title="Business Basics" description="Tell us who you are and what you do." /><Field label="Business name *" id="businessName"><Input id="businessName" className="h-12" value={form.businessName} onChange={(event) => setField("businessName", event.target.value)} placeholder="Aristotle Home Services LLC" /></Field><div className="grid gap-4 sm:grid-cols-2"><SelectField label="Primary service category *" id="primaryCategory" value={form.primaryCategory} placeholder="Select a category" options={primaryCategories} onChange={(value) => setField("primaryCategory", value)} /><SelectField label="Team size *" id="teamSize" value={form.teamSize} placeholder="How many on your crew?" options={teamSizes} onChange={(value) => setField("teamSize", value)} /></div><Field label="Years in business *" id="years"><Input id="years" type="number" min={0} className="h-12" value={form.yearsExperience} onChange={(event) => setField("yearsExperience", event.target.value)} placeholder="5" /></Field><Field label="Brief business description" id="businessDescription"><textarea id="businessDescription" rows={4} className={fieldClass} value={form.businessDescription} onChange={(event) => setField("businessDescription", event.target.value)} placeholder="What you specialize in, who you serve, and what makes your work stand out." /></Field></div>;
}

function ContactStep({ form, setField }: StepProps) {
  return <div className="space-y-6"><StepHeading title="Contact Info" description="We’ll send your vendor login invite here once you’re approved." /><div className="grid gap-4 sm:grid-cols-2"><Field label="First name *" id="firstName"><Input id="firstName" autoComplete="given-name" className="h-12" value={form.firstName} onChange={(event) => setField("firstName", event.target.value)} /></Field><Field label="Last name" id="lastName"><Input id="lastName" autoComplete="family-name" className="h-12" value={form.lastName} onChange={(event) => setField("lastName", event.target.value)} /></Field></div><Field label="Email *" id="email"><Input id="email" type="email" autoComplete="email" className="h-12" value={form.email} onChange={(event) => setField("email", event.target.value)} placeholder="you@yourbusiness.com" /><p className="text-xs text-muted-foreground">Used for your vendor portal invitation.</p></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Phone *" id="phone"><Input id="phone" type="tel" autoComplete="tel" className="h-12" value={form.phone} onChange={(event) => setField("phone", event.target.value)} placeholder="(239) 555-0123" /></Field><Field label="Business website" id="website"><Input id="website" inputMode="url" className="h-12" value={form.website} onChange={(event) => setField("website", event.target.value)} placeholder="yourbusiness.com" /></Field></div><div className="space-y-2"><Label>Preferred contact method</Label><div className="grid grid-cols-3 gap-3">{["email", "phone", "either"].map((value) => <button key={value} type="button" onClick={() => setField("preferredContact", value)} className={cn("h-12 rounded-xl border-2 text-sm font-medium capitalize transition-all", form.preferredContact === value ? "border-primary bg-primary/10" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{value}</button>)}</div></div></div>;
}

type ServiceAreaStepProps = StepProps & { areas: string[]; services: string[]; suggestions: string[]; toggleArea: (value: string) => void; toggleService: (value: string) => void };
function ServiceAreaStep({ form, setField, areas, services, suggestions, toggleArea, toggleService }: ServiceAreaStepProps) {
  return <div className="space-y-8"><StepHeading title="Service Area" description="Where you work and what you offer across Southwest Florida." /><ChipGroup label="Areas you serve" options={serviceAreas} selected={areas} onToggle={toggleArea} />{suggestions.length > 0 && <ChipGroup label={`Common ${form.primaryCategory.toLowerCase()} services`} description="Select any that apply." options={suggestions} selected={services} onToggle={toggleService} compact />}<Field label="Services you offer *" id="servicesText"><textarea id="servicesText" rows={3} className={fieldClass} value={form.servicesText} onChange={(event) => setField("servicesText", event.target.value)} placeholder="List additional services separated by commas" /><p className="text-xs text-muted-foreground">Suggested selections and your own wording are combined for review.</p></Field><Field label="Anything else we should know?" id="additionalNotes"><textarea id="additionalNotes" rows={4} className={fieldClass} value={form.additionalNotes} onChange={(event) => setField("additionalNotes", event.target.value)} placeholder="Availability, seasonal capacity, specialty equipment, HOA experience…" /></Field></div>;
}

type CredentialsStepProps = StepProps & { credentials: string[]; documents: SelectedDocument[]; toggleCredential: (value: string) => void; addDocuments: (files: FileList | null, kind: SelectedDocument["kind"]) => void; removeDocument: (index: number) => void };
function CredentialsStep({ form, setField, credentials, documents, toggleCredential, addDocuments, removeDocument }: CredentialsStepProps) {
  return (
    <div className="space-y-6">
      <StepHeading
        title="Credentials"
        description="Everything here is optional. We’ll verify documentation during onboarding."
      />
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {credentialOptions.map((credential) => (
            <label
              key={credential.id}
              className="flex cursor-pointer items-center justify-between gap-4 p-4"
            >
              <span>{credential.label}</span>
              <input
                type="checkbox"
                checked={credentials.includes(credential.id)}
                onChange={() => toggleCredential(credential.id)}
                className="h-5 w-5 accent-primary"
              />
            </label>
          ))}
        </CardContent>
      </Card>
      {credentials.includes("other") && (
        <Field label="Other certification" id="otherCertification">
          <Input
            id="otherCertification"
            className="h-12"
            value={form.otherCertification}
            onChange={(event) =>
              setField("otherCertification", event.target.value)
            }
            placeholder="EPA 608, CPO, NATE certified…"
          />
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="License / contractor number" id="licenseNumber">
          <Input
            id="licenseNumber"
            className="h-12"
            value={form.licenseNumber}
            onChange={(event) => setField("licenseNumber", event.target.value)}
          />
        </Field>
        <Field label="Insurance policy number" id="insuranceNumber">
          <Input
            id="insuranceNumber"
            className="h-12"
            value={form.insurancePolicyNumber}
            onChange={(event) =>
              setField("insurancePolicyNumber", event.target.value)
            }
          />
        </Field>
      </div>
      <div className="space-y-3">
        <div>
          <Label>Documents for onboarding (optional)</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            PDF, JPG, PNG, WebP, HEIC, or HEIF · 10 MB each · up to{" "}
            {MAX_VENDOR_DOCUMENT_COUNT} files
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["license", "insurance", "other"] as const).map((kind) => (
            <label
              key={kind}
              className="flex h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card px-3 text-center capitalize transition-colors hover:border-primary/50"
            >
              <Upload className="h-5 w-5 text-primary" />
              <span className="text-sm">{kind}</span>
              <span className="text-[11px] text-muted-foreground">
                Choose secure files
              </span>
              <input
                type="file"
                multiple
                accept={VENDOR_DOCUMENT_ACCEPT}
                className="sr-only"
                onChange={(event) => {
                  addDocuments(event.target.files, kind);
                  event.target.value = "";
                }}
              />
            </label>
          ))}
        </div>
        {documents.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {documents.map((document, index) => (
              <li
                key={document.id}
                className="flex items-center gap-3 p-3 text-sm"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {document.file.name}
                </span>
                <span className="text-xs capitalize text-muted-foreground">
                  {document.kind}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${document.file.name}`}
                  onClick={() => removeDocument(index)}
                >
                  <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-5">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          Selected documents are uploaded to private storage when you submit.
          Only authorized Mercurius administrators can open them during review.
        </p>
      </div>
    </div>
  );
}

type ReviewStepProps = {
  form: FormState;
  areas: string[];
  services: string[];
  credentials: string[];
  documents: SelectedDocument[];
  isSubmitting: boolean;
  submissionStage: SubmissionStage;
  uploadProgress: { completed: number; total: number };
  documentUploadStates: Record<string, DocumentUploadStatus>;
  onSubmit: () => void;
};
function ReviewStep({
  form,
  areas,
  services,
  credentials,
  documents,
  isSubmitting,
  submissionStage,
  uploadProgress,
  documentUploadStates,
  onSubmit,
}: ReviewStepProps) {
  const rows = [
    ["Business", form.businessName],
    ["Primary category", form.primaryCategory],
    ["Team size", form.teamSize],
    ["Years in business", form.yearsExperience],
    ["Description", form.businessDescription],
    ["Contact", `${form.firstName} ${form.lastName}`.trim()],
    ["Email", form.email],
    ["Phone", form.phone],
    ["Website", form.website],
    ["Preferred contact", form.preferredContact],
    ["Service areas", areas.join(", ")],
    ["Services offered", services.join(", ")],
    [
      "Credentials",
      credentials
        .map((id) => credentialOptions.find((item) => item.id === id)?.label)
        .filter(Boolean)
        .join(", "),
    ],
    ["Other certification", form.otherCertification],
    ["License / contractor #", form.licenseNumber],
    ["Insurance policy #", form.insurancePolicyNumber],
    ["Notes", form.additionalNotes],
  ].filter(([, value]) => value?.trim());
  const progressPercent =
    uploadProgress.total > 0
      ? Math.round((uploadProgress.completed / uploadProgress.total) * 100)
      : 0;
  const submitLabel =
    submissionStage === "saving"
      ? "Saving application…"
      : submissionStage === "uploading"
        ? `Uploading documents ${uploadProgress.completed}/${uploadProgress.total}…`
        : submissionStage === "finalizing"
          ? "Securing documents…"
          : "Submit Application";

  return (
    <div className="space-y-6">
      <StepHeading
        title="Review & Submit"
        description="Double-check your details before sending."
      />
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="grid gap-1 p-4 sm:grid-cols-3 sm:gap-4"
            >
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="break-words text-sm sm:col-span-2">{value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {documents.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Credential documents</p>
              <span className="text-xs text-muted-foreground">
                {documents.length} selected
              </span>
            </div>
            <ul className="space-y-2">
              {documents.map((document) => {
                const status = documentUploadStates[document.id] ?? "waiting";
                return (
                  <li
                    key={document.id}
                    className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    {status === "uploading" ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    ) : status === "uploaded" ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    ) : status === "failed" ? (
                      <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                    ) : (
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {document.file.name}
                    </span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {status}
                    </span>
                  </li>
                );
              })}
            </ul>
            {isSubmitting && uploadProgress.total > 0 && (
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Credential document upload progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <p className="text-sm text-muted-foreground">
        Free to join, no setup fee. Mercurius takes a 15% commission on
        completed jobs—you keep the rest.
      </p>
      <Button
        type="button"
        size="lg"
        className="h-14 w-full text-base"
        onClick={onSubmit}
        disabled={isSubmitting}
      >
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitLabel}
      </Button>
    </div>
  );
}

function ApplicationSuccess({
  firstName,
  businessName,
  email,
  selectedDocumentCount,
  attachedDocumentCount,
  warning,
}: {
  firstName: string;
  businessName: string;
  email: string;
  selectedDocumentCount: number;
  attachedDocumentCount: number;
  warning: string | null;
}) {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main id="main-content" tabIndex={-1} className="py-16 md:py-24">
        <div className="container-narrow mx-auto max-w-xl text-center">
          <span className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="h-10 w-10 text-primary" />
          </span>
          <h1 className="mb-4 text-3xl font-semibold">Application Received</h1>
          <p className="mb-6 text-lg text-muted-foreground">
            Thanks, {firstName || "there"}—we have your application for{" "}
            <strong className="text-foreground">{businessName}</strong>. Our
            team reviews every Southwest Florida provider by hand.
          </p>
          {attachedDocumentCount > 0 && (
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-left text-emerald-900">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-sm">
                {attachedDocumentCount} credential document
                {attachedDocumentCount === 1 ? "" : "s"} uploaded securely for
                admin review.
              </p>
            </div>
          )}
          {warning && (
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-amber-900">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">Document upload note</p>
                <p className="mt-1">{warning}</p>
                {selectedDocumentCount > attachedDocumentCount && (
                  <p className="mt-1">
                    Your application is still in the review queue. Our team can
                    request any missing document during onboarding.
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="mb-8 rounded-2xl border border-border bg-card p-6 text-left">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">What happens next:</strong>{" "}
              We review your details, follow up if we need anything, and send a
              login invitation to <span className="text-foreground">{email}</span>{" "}
              once you&apos;re approved.
            </p>
          </div>
          <Link
            href="/"
            className={buttonVariants({ variant: "outline", size: "lg" })}
          >
            Return Home
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function StepHeading({ title, description }: { title: string; description: string }) {
  return <div><h2 className="text-2xl font-semibold">{title}</h2><p className="mt-2 text-muted-foreground">{description}</p></div>;
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>;
}

function SelectField({ label, id, value, placeholder, options, onChange }: { label: string; id: string; value: string; placeholder: string; options: string[]; onChange: (value: string) => void }) {
  return <Field label={label} id={id}><select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={cn(fieldClass, "h-12 py-0")}><option value="">{placeholder}</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></Field>;
}

function ChipGroup({ label, description, options, selected, onToggle, compact = false }: { label: string; description?: string; options: string[]; selected: string[]; onToggle: (value: string) => void; compact?: boolean }) {
  return <div className="space-y-3"><div><Label>{label}</Label>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div><div className="flex flex-wrap gap-2">{options.map((option) => <button key={option} type="button" onClick={() => onToggle(option)} className={cn("rounded-full border text-sm transition-all", compact ? "px-3 py-1.5" : "border-2 px-4 py-2", selected.includes(option) ? "border-primary bg-primary/10 text-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/50")}>{option}</button>)}</div></div>;
}
