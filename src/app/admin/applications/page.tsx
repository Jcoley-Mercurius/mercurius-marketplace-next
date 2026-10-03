"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  Clock,
  Eye,
  FileText,
  Globe,
  Loader2,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { VendorAccountLinking } from "@/components/admin/VendorAccountLinking";
import { VendorInvitation } from "@/components/admin/VendorInvitation";
import { VendorOnboardingChecklist } from "@/components/admin/VendorOnboardingChecklist";
import { ApplicationClosure } from "@/components/admin/ApplicationClosure";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { type ApplicationRetentionOverview } from "@/lib/applicationRetention";
import {
  applicationQueueFilters,
  applicationQueueLabel,
  applicationQueueState,
  type ApplicationQueueState,
} from "@/lib/applicationQueueState";
import { retentionStateLabel } from "@/lib/renewalRetention";
import {
  vendorDocumentDisplayName,
  vendorDocumentKindFromPath,
} from "@/lib/vendorApplicationDocuments";

type Application = {
  id: string;
  first_name: string;
  last_name: string;
  business_name: string;
  email: string;
  phone: string;
  address: string | null;
  services: string[];
  years_experience: number;
  availability: string | null;
  service_areas: string | null;
  status: string;
  created_at: string;
  contractor_id: string | null;
  invited_user_id: string | null;
  invite_status: string | null;
  invited_at: string | null;
  invite_expires_at: string | null;
  activated_at: string | null;
  invite_error: string | null;
  primary_category: string | null;
  team_size: string | null;
  business_description: string | null;
  website: string | null;
  preferred_contact: string | null;
  license_number: string | null;
  insurance_policy_number: string | null;
  credentials: string[] | null;
  other_certification: string | null;
  additional_notes: string | null;
  document_urls: string[] | null;
};

type PageMode = "loading" | "live" | "error";

type IntakeStatus = {
  application_status: string;
  latest_version_id: string | null;
  contractor_id: string | null;
  onboarding_status: string | null;
  onboarding_revision: number | null;
  review_started: boolean;
  // The access-managed provider whose confirmed contact sent this application.
  existing_provider: {
    contractor_id: string;
    name: string | null;
    bound: boolean;
    onboarding: boolean;
    excluded: boolean;
    live_attempt: boolean;
  } | null;
};

type ReviewStart = {
  contractor_id: string;
  onboarding_status: string;
  onboarding_revision: number;
  created: boolean;
};

const applicationSelect = [
  "id",
  "first_name",
  "last_name",
  "business_name",
  "email",
  "phone",
  "address",
  "services",
  "years_experience",
  "availability",
  "service_areas",
  "status",
  "created_at",
  "contractor_id",
  "invited_user_id",
  "invite_status",
  "invited_at",
  "invite_expires_at",
  "activated_at",
  "invite_error",
  "primary_category",
  "team_size",
  "business_description",
  "website",
  "preferred_contact",
  "license_number",
  "insurance_policy_number",
  "credentials",
  "other_certification",
  "additional_notes",
  "document_urls",
].join(", ");

const statusStyle: Record<ApplicationQueueState, string> = {
  awaiting_review: "border-amber-200 bg-amber-50 text-amber-700",
  in_review: "border-blue-200 bg-blue-50 text-blue-700",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  suspended: "border-amber-200 bg-amber-50 text-amber-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
  abandoned: "border-border bg-muted text-muted-foreground",
  legacy_approved: "border-border bg-muted text-muted-foreground",
  checking: "border-border bg-muted text-muted-foreground",
  unavailable: "border-red-200 bg-red-50 text-red-700",
};

// Per-application onboarding readback for the queue (TRACE-105). Undefined while
// loading; "failed" when the operator-only RPC refused or errored.
type QueueReadback = IntakeStatus | "failed";

const pipelineLabel: Record<string, string> = {
  not_invited: "Not invited",
  invite_sent: "Invite sent",
  invite_expired: "Invite expired",
  account_active: "Account active",
  failed: "Invite failed",
};

const pipelineStyle: Record<string, string> = {
  not_invited: "border-border bg-muted text-muted-foreground",
  invite_sent: "border-blue-200 bg-blue-50 text-blue-700",
  invite_expired: "border-amber-200 bg-amber-50 text-amber-700",
  account_active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-red-200 bg-red-50 text-red-700",
};

export default function AdminApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Application | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [mode, setMode] = useState<PageMode>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [openingDocument, setOpeningDocument] = useState<string | null>(null);
  const [retention, setRetention] = useState<ApplicationRetentionOverview | null>(null);
  const [onboarding, setOnboarding] = useState<Record<string, QueueReadback>>({});

  const readOnboarding = useCallback(async (applicationId: string) => {
    const { data, error } = await createClient().rpc(
      "vendor_onboarding_intake_status",
      { p_application: applicationId },
    );
    const result: QueueReadback = error ? "failed" : (data as unknown as IntakeStatus);
    setOnboarding((current) => ({ ...current, [applicationId]: result }));
  }, []);

  const loadApplications = useCallback(
    async (showLoading = false) => {
      if (showLoading) setMode("loading");
      setErrorMessage("");
      const supabase = createClient();

      try {
        const { data, error } = await supabase
          .from("vendor_applications")
          .select(applicationSelect)
          .order("created_at", { ascending: false });

        if (error) throw error;
        const rows = (data ?? []) as unknown as Application[];
        setApplications(rows);
        setOnboarding({});
        // The application status column is legacy; the queue shows onboarding state.
        rows.forEach((row) => void readOnboarding(row.id));
        // TRACE-104: /admin/recruiting links here with ?application=<id>.
        const linked = new URLSearchParams(window.location.search).get("application");
        setSelected((current) =>
          current
            ? rows.find((application) => application.id === current.id) ??
              current
            : rows.find((application) => application.id === linked) ?? null,
        );
        setMode("live");
      } catch (error) {
        console.error("Unable to load vendor applications", error);
        setApplications([]);
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Vendor applications could not be loaded.",
        );
        setMode("error");
      }
    },
    [readOnboarding],
  );

  useEffect(() => {
    // This live admin queue loads once when the protected route mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadApplications(true);
  }, [loadApplications]);

  const patchApplication = useCallback(
    (applicationId: string, patch: Partial<Application>) => {
      setApplications((current) =>
        current.map((application) =>
          application.id === applicationId
            ? { ...application, ...patch }
            : application,
        ),
      );
      setSelected((current) =>
        current?.id === applicationId ? { ...current, ...patch } : current,
      );
    },
    [],
  );

  // TRACE-084: the closure panel's reads carry the recorded status and each file's
  // retention state; a closure patches the queue row without a full reload.
  const receiveRetention = useCallback(
    (overview: ApplicationRetentionOverview) => {
      setRetention(overview);
      patchApplication(overview.application_id, { status: overview.application_status });
    },
    [patchApplication],
  );

  const openDocument = async (path: string) => {
    setOpeningDocument(path);
    try {
      const { data, error } = await createClient()
        .storage
        .from("vendor-documents")
        .createSignedUrl(path, 10 * 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error("Document could not be opened", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setOpeningDocument(null);
    }
  };

  const queueState = useCallback(
    (application: Application) => {
      const readback = onboarding[application.id];
      return applicationQueueState(
        application.status,
        readback === "failed" ? null : readback,
        readback === "failed",
      );
    },
    [onboarding],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return applications.filter((application) => {
      const matchesStatus =
        statusFilter === "all" || queueState(application) === statusFilter;
      const matchesSearch =
        !query ||
        application.business_name.toLowerCase().includes(query) ||
        application.email.toLowerCase().includes(query) ||
        (application.first_name + " " + application.last_name)
          .toLowerCase()
          .includes(query) ||
        (application.primary_category ?? "").toLowerCase().includes(query);
      return matchesStatus && matchesSearch;
    });
  }, [applications, search, statusFilter, queueState]);

  const counts = useMemo(() => {
    const states = applications.map(queueState);
    const count = (state: ApplicationQueueState) => states.filter((item) => item === state).length;
    return { awaiting: count("awaiting_review"), review: count("in_review"), active: count("active") };
  }, [applications, queueState]);

  if (mode === "loading") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />
        Loading vendor applications...
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div className="mx-auto w-full max-w-3xl p-4 sm:p-6 md:p-8">
        <Card className="border-destructive/20 bg-destructive/5">
          <CardContent className="py-14 text-center">
            <AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" />
            <h1 className="font-heading text-xl font-semibold">
              Applications could not be loaded
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
              No sample applications have been substituted.{" "}
              {errorMessage || "Please try again."}
            </p>
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => void loadApplications(true)}
            >
              <RefreshCw />
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          Vendor operations
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">
              Vendor Applications
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {applications.length} total · {counts.awaiting} awaiting review
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void loadApplications(true)}
          >
            <RefreshCw />
            Refresh queue
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Awaiting review"
          value={counts.awaiting}
          className="border-amber-200 bg-amber-50"
        />
        <SummaryCard
          label="In review"
          value={counts.review}
          className="border-blue-200 bg-blue-50"
        />
        <SummaryCard
          label="Active"
          value={counts.active}
          className="border-emerald-200 bg-emerald-50"
        />
      </div>

      {counts.awaiting > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center">
          <Clock className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">
            {counts.awaiting} application{counts.awaiting === 1 ? "" : "s"}{" "}
            awaiting review
          </p>
          <Button
            size="sm"
            variant="outline"
            className="sm:ml-auto"
            onClick={() => setStatusFilter("awaiting_review")}
          >
            Show new applications
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, business, category, or email..."
            className="bg-card pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter applications by status"
          className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-48"
        >
          <option value="all">All statuses</option>
          {applicationQueueFilters.map((state) => (
            <option key={state} value={state}>
              {applicationQueueLabel[state]}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-border bg-muted/60">
                <tr className="text-left">
                  <TableHeading>Applicant</TableHeading>
                  <TableHeading>Business</TableHeading>
                  <TableHeading>Services</TableHeading>
                  <TableHeading>Experience</TableHeading>
                  <TableHeading>Applied</TableHeading>
                  <TableHeading>Status</TableHeading>
                  <TableHeading>Account</TableHeading>
                  <TableHeading>Actions</TableHeading>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((application) => (
                  <tr
                    key={application.id}
                    className={cn(
                      "transition-colors hover:bg-muted/30",
                      application.status === "pending" && "bg-amber-50/30",
                    )}
                  >
                    <td className="p-4">
                      <p className="font-medium text-foreground">
                        {application.first_name} {application.last_name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {application.email}
                      </p>
                    </td>
                    <td className="p-4">
                      <p className="font-medium text-foreground">
                        {application.business_name}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {application.primary_category || "No primary category"}
                      </p>
                    </td>
                    <td className="p-4 text-xs text-muted-foreground">
                      {summarizeServices(application.services)}
                    </td>
                    <td className="p-4">{application.years_experience}y</td>
                    <td className="p-4 text-muted-foreground">
                      {formatDate(application.created_at)}
                    </td>
                    <td className="p-4">
                      <ApplicationStatus state={queueState(application)} />
                    </td>
                    <td className="p-4">
                      {application.status === "approved" ? (
                        <PipelineStatus status={application.invite_status} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected(application)}
                      >
                        <Eye />
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="p-12 text-center text-muted-foreground"
                    >
                      <FileText className="mx-auto mb-3 h-10 w-10 opacity-60" />
                      <p className="font-medium text-foreground">
                        No matching applications
                      </p>
                      <p className="mt-1 text-xs">
                        Adjust the search or status filter.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ApplicationDialog
        application={selected}
        state={selected ? queueState(selected) : "checking"}
        openingDocument={openingDocument}
        onClose={() => {
          // Activation, suspension and rejection happen inside the dialog.
          if (selected) void readOnboarding(selected.id);
          setSelected(null);
        }}
        onReviewStarted={(application, contractorId) => {
          patchApplication(application.id, { contractor_id: contractorId });
          void readOnboarding(application.id);
        }}
        retention={retention?.application_id === selected?.id ? retention : null}
        onRetention={receiveRetention}
        onOpenDocument={(path) => void openDocument(path)}
      />
    </div>
  );
}

function ApplicationDialog({
  application,
  state,
  openingDocument,
  onClose,
  onReviewStarted,
  retention,
  onRetention,
  onOpenDocument,
}: {
  application: Application | null;
  state: ApplicationQueueState;
  openingDocument: string | null;
  onClose: () => void;
  onReviewStarted: (application: Application, contractorId: string) => void;
  retention: ApplicationRetentionOverview | null;
  onRetention: (overview: ApplicationRetentionOverview) => void;
  onOpenDocument: (path: string) => void;
}) {
  if (!application) return null;
  const pipelineStatus = application.invite_status ?? "not_invited";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle>{application.business_name}</DialogTitle>
            <ApplicationStatus state={state} />
          </div>
          <DialogDescription>
            Applied {formatDate(application.created_at)} · Application{" "}
            {application.id.slice(0, 8)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <Detail icon={User} label="Applicant">
            {application.first_name} {application.last_name}
          </Detail>
          <Detail icon={Mail} label="Email">
            <a className="break-all hover:underline" href={"mailto:" + application.email}>
              {application.email}
            </a>
          </Detail>
          <Detail icon={Phone} label="Phone">
            <a className="hover:underline" href={"tel:" + application.phone}>
              {application.phone}
            </a>
          </Detail>
          <Detail icon={MapPin} label="Business address">
            {application.address || "Not provided"}
          </Detail>
          <Detail icon={Briefcase} label="Experience">
            {application.years_experience} years ·{" "}
            {application.team_size || "Team size not provided"}
          </Detail>
          <Detail icon={Globe} label="Website">
            {application.website ? (
              <a
                href={normalizeWebsite(application.website)}
                target="_blank"
                rel="noreferrer"
                className="break-all hover:underline"
              >
                {application.website}
              </a>
            ) : (
              "Not provided"
            )}
          </Detail>
        </div>

        <DetailSection title="Services">
          <div className="flex flex-wrap gap-1.5">
            {application.primary_category && (
              <Badge className="bg-accent/10 text-accent">
                {application.primary_category}
              </Badge>
            )}
            {application.services.map((service) => (
              <Badge key={service} variant="secondary">
                {service}
              </Badge>
            ))}
          </div>
        </DetailSection>

        <div className="grid gap-3 sm:grid-cols-2">
          <DetailSection title="Service areas">
            <p className="text-sm leading-6 text-muted-foreground">
              {application.service_areas || "Not provided"}
            </p>
          </DetailSection>
          <DetailSection title="Availability">
            <p className="text-sm leading-6 text-muted-foreground">
              {application.availability || "Not provided"}
            </p>
          </DetailSection>
        </div>

        {application.business_description && (
          <DetailSection title="Business description">
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {application.business_description}
            </p>
          </DetailSection>
        )}

        <DetailSection title="Credentials">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Credentials:</span>{" "}
              {application.credentials?.join(", ") || "None listed"}
            </p>
            <p>
              <span className="font-medium text-foreground">License:</span>{" "}
              {application.license_number || "Not provided"}
            </p>
            <p>
              <span className="font-medium text-foreground">
                Insurance policy:
              </span>{" "}
              {application.insurance_policy_number || "Not provided"}
            </p>
            {application.other_certification && (
              <p>
                <span className="font-medium text-foreground">
                  Other certification:
                </span>{" "}
                {application.other_certification}
              </p>
            )}
          </div>
        </DetailSection>

        <DetailSection title="Credential documents">
          {application.document_urls && application.document_urls.length > 0 ? (
            <div className="space-y-2">
              {application.document_urls.map((path) => {
                const file = retention?.files.find((candidate) => candidate.path === path);
                if (file && file.retention_state !== "retained") {
                  return (
                    <div
                      key={path}
                      className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground"
                    >
                      <Paperclip className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {vendorDocumentDisplayName(path)}
                      </span>
                      <Badge variant="secondary" className="shrink-0">
                        {retentionStateLabel[file.retention_state]}
                      </Badge>
                    </div>
                  );
                }
                return (
                <Button
                  key={path}
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  disabled={openingDocument === path}
                  onClick={() => onOpenDocument(path)}
                >
                  {openingDocument === path ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Paperclip />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">
                    {vendorDocumentDisplayName(path)}
                  </span>
                  {vendorDocumentKindFromPath(path) && (
                    <Badge
                      variant="secondary"
                      className="ml-auto shrink-0 capitalize"
                    >
                      {vendorDocumentKindFromPath(path)}
                    </Badge>
                  )}
                </Button>
                );
              })}
              <p className="pt-1 text-xs text-muted-foreground">
                Files open through an admin-only signed link that expires after
                10 minutes.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-background/60 p-4">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">
                  No credential documents uploaded
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  This application was submitted without optional license,
                  insurance, or certification files. Review the supplied
                  credential numbers and follow up if documentation is needed.
                </p>
              </div>
            </div>
          )}
        </DetailSection>

        {application.additional_notes && (
          <DetailSection title="Additional notes">
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {application.additional_notes}
            </p>
          </DetailSection>
        )}

        <OnboardingReview
          key={`${application.id}:${application.status}`}
          application={application}
          disabled={false}
          onStarted={(contractorId) => onReviewStarted(application, contractorId)}
        />

        <DetailSection title="Closure and retention">
          <ApplicationClosure
            key={`${application.id}:${application.contractor_id ?? ""}`}
            applicationId={application.id}
            businessName={application.business_name}
            disabled={false}
            onOverview={onRetention}
          />
        </DetailSection>

        {application.status === "approved" && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-accent" />
                <p className="font-medium">Legacy onboarding pipeline</p>
                <PipelineStatus status={pipelineStatus} />
              </div>
              <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <PipelineDetail
                  label="Contractor record"
                  value={
                    application.contractor_id
                      ? "Created and linked"
                      : "Not created"
                  }
                />
                <PipelineDetail
                  label="Vendor role"
                  value={
                    application.invited_user_id
                      ? "Assigned to account"
                      : "Awaiting account provisioning"
                  }
                />
                <PipelineDetail
                  label="Invite sent"
                  value={formatDateTime(application.invited_at)}
                />
                <PipelineDetail
                  label="Invite expires"
                  value={formatDateTime(application.invite_expires_at)}
                />
                <PipelineDetail
                  label="Account active"
                  value={formatDateTime(application.activated_at, "Not yet")}
                />
              </dl>
              {application.invite_error && (
                <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {application.invite_error}
                </div>
              )}
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Recovered pipeline record, kept as history. Invitations are
                prepared, sent, reconciled and closed in Provider invitation
                above.
              </p>
            </div>

            <Link
              href="/admin/vendors"
              onClick={onClose}
              className="flex items-center justify-between rounded-xl border border-border p-3 text-sm transition-colors hover:bg-muted/50"
            >
              <span>Open vendor records</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const onboardingLabel: Record<string, string> = {
  review: "In review",
  active: "Active",
  suspended: "Suspended",
  rejected: "Rejected",
};

// Operator-only readback and creation-only start (TRACE-065). The server owns
// authorization, idempotency and every existing-state decision.
function OnboardingReview({
  application,
  disabled,
  onStarted,
}: {
  application: Application;
  disabled: boolean;
  onStarted: (contractorId: string) => void;
}) {
  const [intake, setIntake] = useState<IntakeStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  // One key per opened application so a retried confirmation replays, not duplicates.
  const [key] = useState(() => "onboarding-review:" + crypto.randomUUID());

  const readIntake = useCallback(async () => {
    const { data, error } = await createClient().rpc(
      "vendor_onboarding_intake_status",
      { p_application: application.id },
    );
    if (error) throw error;
    return data as unknown as IntakeStatus;
  }, [application.id]);

  const refresh = useCallback(async () => {
    setLoadError("");
    try {
      setIntake(await readIntake());
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Onboarding status could not be loaded.",
      );
    }
  }, [readIntake]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const start = async (reason: string) => {
    if (!intake?.latest_version_id) return;
    const existing = intake.existing_provider;
    try {
      const args = {
        p_application: application.id,
        p_expected_version: intake.latest_version_id,
        p_reason: reason,
        p_key: key,
      };
      // An existing provider's application opens review on that provider's record.
      const { data, error } = existing
        ? await createClient().rpc("r0_start_existing_provider_review", {
            ...args,
            p_contractor: existing.contractor_id,
          })
        : await createClient().rpc("vendor_start_onboarding_review", args);
      if (error) throw error;
      const result = data as unknown as ReviewStart;
      const readback = await readIntake();
      if (
        !readback.review_started ||
        readback.onboarding_status !== "review" ||
        readback.contractor_id !== result.contractor_id
      ) {
        throw new Error(
          "The server did not confirm the onboarding review. Review the current state before retrying.",
        );
      }
      setIntake(readback);
      onStarted(result.contractor_id);
      toast.success("Onboarding review started", {
        description: existing
          ? "Linked to the existing provider. No approval, role change or public listing followed."
          : "No account, invitation or public listing was created.",
      });
    } catch (error) {
      toast.error("Onboarding review could not be started", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
      void refresh();
      throw error;
    }
  };

  const closed =
    intake?.application_status === "rejected" ||
    intake?.application_status === "abandoned";
  const existing = intake?.existing_provider ?? null;
  const existingBlocked = !existing
    ? ""
    : existing.excluded
      ? "is archived, so it cannot start onboarding."
      : existing.onboarding
        ? "already has an onboarding record."
        : existing.live_attempt
          ? "has a live access invitation. Close it before starting review."
          : !existing.bound
            ? "has no reviewed account binding yet. Bind the account in Existing Provider Access first."
            : "";
  const existingLinked = Boolean(
    existing && intake?.contractor_id === existing.contractor_id,
  );
  const canStart =
    Boolean(intake?.latest_version_id) &&
    (!intake?.contractor_id || existingLinked) &&
    !closed &&
    !existingBlocked;

  return (
    <>
    <DetailSection title="Onboarding review">
      {loadError ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : !intake ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading onboarding status...
        </p>
      ) : intake.onboarding_status && intake.review_started ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-accent" />
          <Badge variant="secondary">
            {onboardingLabel[intake.onboarding_status] ??
              intake.onboarding_status}
          </Badge>
          <span className="text-muted-foreground">
            Revision {intake.onboarding_revision}. Continue vetting in provider
            compliance.
          </span>
        </div>
      ) : intake.contractor_id && !existingLinked ? (
        <p className="text-sm leading-6 text-muted-foreground">
          Linked to an existing provider record. Its review follows the
          provider compliance cutover path.
        </p>
      ) : closed ? (
        <p className="text-sm leading-6 text-muted-foreground">
          Closed applications cannot start onboarding review.
        </p>
      ) : !intake.latest_version_id ? (
        <p className="text-sm leading-6 text-muted-foreground">
          This application has no recorded intake version, so onboarding
          review cannot start here yet.
        </p>
      ) : existing ? (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-muted-foreground">
            Sent from the confirmed contact of the existing provider{" "}
            <Link
              href={`/admin/vendors/${existing.contractor_id}`}
              className="font-medium text-foreground underline underline-offset-4"
            >
              {existing.name ?? "record"}
            </Link>
            .{" "}
            {existingBlocked
              ? `That provider ${existingBlocked}`
              : "Review opens on that provider's record, not a new one."}
          </p>
          <ConfirmAction
            disabled={disabled || !canStart}
            requireReason
            confirmationTone="commitment"
            triggerLabel="Start review for existing provider"
            title="Start onboarding review for the existing provider?"
            entity={existing.name ?? application.business_name}
            consequence="Links this application to the existing provider record and opens review at revision 1. The bound account and its setup access stay as they are. No email, approval, role change or public listing results."
            confirmLabel="Start review"
            onConfirm={start}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs leading-5 text-muted-foreground">
            Opens compliance review for this applicant. No account, vendor
            access, invitation or public listing is created.
          </p>
          <ConfirmAction
            disabled={disabled || !canStart}
            requireReason
            confirmationTone="commitment"
            triggerLabel="Start onboarding review"
            title="Start onboarding review?"
            entity={application.business_name}
            consequence="Creates a hidden provider record without an account, links this application and opens review at revision 1. No email, invitation, vendor access or public listing results."
            confirmLabel="Start review"
            onConfirm={start}
          />
        </div>
      )}
    </DetailSection>
    {/* The invitation, account and checklist panels belong to a provider under
        review (TRACE-066/067/069). An applicant either receives a new account or
        has one bound; the panels report which path is open. */}
    {intake?.contractor_id && intake.review_started && (
      <>
        {/* An existing provider's account came through its reviewed access binding. */}
        {!existingLinked && (
        <>
        <DetailSection title="Provider account">
          <VendorAccountLinking
            contractorId={intake.contractor_id}
            businessName={application.business_name}
            disabled={disabled}
          />
        </DetailSection>
        <DetailSection title="Provider invitation">
          <VendorInvitation
            contractorId={intake.contractor_id}
            businessName={application.business_name}
            disabled={disabled}
          />
        </DetailSection>
        </>
        )}
        <DetailSection title="Activation checklist">
          <VendorOnboardingChecklist
            contractorId={intake.contractor_id}
            businessName={application.business_name}
            disabled={disabled}
          />
        </DetailSection>
      </>
    )}
    </>
  );
}

function SummaryCard({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardContent className="flex items-center justify-between py-4">
        <p className="text-sm font-medium">{label}</p>
        <p className="font-heading text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function TableHeading({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap p-4 font-medium text-muted-foreground">
      {children}
    </th>
  );
}

function ApplicationStatus({ state }: { state: ApplicationQueueState }) {
  return (
    <Badge className={cn("border", statusStyle[state])}>
      {applicationQueueLabel[state]}
    </Badge>
  );
}

function PipelineStatus({ status }: { status: string | null }) {
  const normalized = status ?? "not_invited";
  return (
    <Badge
      className={cn(
        "border",
        pipelineStyle[normalized] ??
          "border-border bg-muted text-muted-foreground",
      )}
    >
      {pipelineLabel[normalized] ?? normalized.replaceAll("_", " ")}
    </Badge>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof User;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="h-4 w-4 text-accent" />
        {label}
      </p>
      <div className="break-words text-sm">{children}</div>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-muted/25 p-4">
      <h3 className="mb-2 text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}

function PipelineDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="mt-0.5 font-medium text-foreground">{value}</dd>
    </div>
  );
}

function summarizeServices(services: string[]) {
  if (services.length === 0) return "—";
  const visible = services.slice(0, 2).join(", ");
  return services.length > 2
    ? visible + " +" + (services.length - 2)
    : visible;
}

function normalizeWebsite(website: string) {
  return /^https?:\/\//i.test(website) ? website : "https://" + website;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

function formatDateTime(value: string | null, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}
