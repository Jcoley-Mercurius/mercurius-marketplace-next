"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Briefcase,
  CheckCircle2,
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
  Send,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
type InviteAction = "approve" | "resend";

type InviteResponse = {
  ok?: boolean;
  error?: string;
  contractor_id?: string | null;
  user_id?: string | null;
  invite_status?: string | null;
  invited_at?: string | null;
  invite_expires_at?: string | null;
  activated_at?: string | null;
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

const statusStyle: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200 bg-red-50 text-red-700",
};

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
  const [processing, setProcessing] = useState<InviteAction | "reject" | null>(null);
  const [openingDocument, setOpeningDocument] = useState<string | null>(null);

  const loadApplications = useCallback(
    async (showLoading = false, syncPipeline = false) => {
      if (showLoading) setMode("loading");
      setErrorMessage("");
      const supabase = createClient();

      try {
        if (syncPipeline) {
          const syncResult = await supabase.functions.invoke("vendor-invite", {
            body: { action: "sync" },
          });
          if (syncResult.error) {
            console.warn("Unable to sync vendor invite pipeline", syncResult.error);
          }
        }

        const { data, error } = await supabase
          .from("vendor_applications")
          .select(applicationSelect)
          .order("created_at", { ascending: false });

        if (error) throw error;
        const rows = (data ?? []) as unknown as Application[];
        setApplications(rows);
        setSelected((current) =>
          current
            ? rows.find((application) => application.id === current.id) ??
              current
            : current,
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
    [],
  );

  useEffect(() => {
    // This live admin queue loads once when the protected route mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadApplications(true, true);
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

  const runInvite = async (
    application: Application,
    action: InviteAction,
  ) => {
    setProcessing(action);
    const supabase = createClient();

    try {
      const { data, error } = await supabase.functions.invoke("vendor-invite", {
        body: {
          action,
          application_id: application.id,
          origin: window.location.origin,
        },
      });
      const response = isRecord(data) ? (data as InviteResponse) : null;
      const invocationError = await getFunctionError(error, data);

      if (invocationError) {
        await loadApplications(false, false);
        throw new Error(invocationError);
      }

      if (!response?.ok || !response.contractor_id || !response.user_id) {
        await loadApplications(false, false);
        throw new Error(
          "The onboarding function returned an incomplete provisioning result. Review the application before retrying.",
        );
      }

      const [roleResult, contractorResult, applicationResult] = await Promise.all([
        supabase.rpc("has_role", {
          _user_id: response.user_id,
          _role: "vendor",
        }),
        supabase
          .from("contractors")
          .select("id, user_id")
          .eq("id", response.contractor_id)
          .eq("user_id", response.user_id)
          .maybeSingle(),
        supabase
          .from("vendor_applications")
          .select("id, status, contractor_id, invited_user_id, invite_status")
          .eq("id", application.id)
          .maybeSingle(),
      ]);
      if (roleResult.error) throw roleResult.error;
      if (contractorResult.error) throw contractorResult.error;
      if (applicationResult.error) throw applicationResult.error;
      if (!roleResult.data || !contractorResult.data) {
        await loadApplications(false, false);
        throw new Error(
          "Provisioning did not produce a verified vendor role and linked contractor record.",
        );
      }
      const savedApplication = applicationResult.data as {
        status: string;
        contractor_id: string | null;
        invited_user_id: string | null;
        invite_status: string | null;
      } | null;
      if (
        !savedApplication ||
        savedApplication.status !== "approved" ||
        savedApplication.contractor_id !== response.contractor_id ||
        savedApplication.invited_user_id !== response.user_id
      ) {
        await loadApplications(false, false);
        throw new Error(
          "The vendor account was provisioned, but the application record was not linked correctly.",
        );
      }

      const patch: Partial<Application> = {
        status: "approved",
        contractor_id:
          response?.contractor_id ?? application.contractor_id ?? null,
        invited_user_id:
          response?.user_id ?? application.invited_user_id ?? null,
        invite_status:
          savedApplication.invite_status ?? response.invite_status ?? "not_invited",
        invited_at: response?.invited_at ?? application.invited_at ?? null,
        invite_expires_at:
          response?.invite_expires_at ??
          application.invite_expires_at ??
          null,
        activated_at:
          response?.activated_at ?? application.activated_at ?? null,
        invite_error: null,
      };
      patchApplication(application.id, patch);

      const accountIsActive = patch.invite_status === "account_active";
      toast.success(
        action === "approve" ? "Application approved" : "Invite resent",
        {
          description: accountIsActive
            ? application.email +
              " already has an account. Vendor access is active and the contractor is linked."
            : "Vendor access was provisioned and an invitation was sent to " +
              application.email +
              ".",
        },
      );
    } catch (error) {
      toast.error(
        action === "approve" ? "Approval failed" : "Invite could not be sent",
        {
          description:
            error instanceof Error ? error.message : "Please try again.",
        },
      );
    } finally {
      setProcessing(null);
    }
  };

  const rejectApplication = async (application: Application) => {
    const confirmed = window.confirm(
      "Reject " +
        application.business_name +
        "? This records the application as rejected.",
    );
    if (!confirmed) return;

    setProcessing("reject");
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .from("vendor_applications")
        .update({ status: "rejected" })
        .eq("id", application.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        await loadApplications(false, false);
        throw new Error(
          "This application is no longer pending. The queue has been refreshed.",
        );
      }

      patchApplication(application.id, { status: "rejected" });
      toast.success("Application rejected");
    } catch (error) {
      toast.error("Application could not be rejected", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setProcessing(null);
    }
  };

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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return applications.filter((application) => {
      const matchesStatus =
        statusFilter === "all" || application.status === statusFilter;
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
  }, [applications, search, statusFilter]);

  const counts = useMemo(
    () => ({
      pending: applications.filter((item) => item.status === "pending").length,
      approved: applications.filter((item) => item.status === "approved").length,
      rejected: applications.filter((item) => item.status === "rejected").length,
    }),
    [applications],
  );

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
              onClick={() => void loadApplications(true, true)}
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
              {applications.length} total · {counts.pending} pending review
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void loadApplications(false, true)}
          >
            <RefreshCw />
            Sync onboarding
          </Button>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Pending"
          value={counts.pending}
          className="border-amber-200 bg-amber-50"
        />
        <SummaryCard
          label="Approved"
          value={counts.approved}
          className="border-emerald-200 bg-emerald-50"
        />
        <SummaryCard
          label="Rejected"
          value={counts.rejected}
          className="border-border bg-muted/40"
        />
      </div>

      {counts.pending > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 sm:flex-row sm:items-center">
          <Clock className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">
            {counts.pending} application{counts.pending === 1 ? "" : "s"}{" "}
            awaiting review
          </p>
          <Button
            size="sm"
            variant="outline"
            className="sm:ml-auto"
            onClick={() => setStatusFilter("pending")}
          >
            Show pending
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
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
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
                      <ApplicationStatus status={application.status} />
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
        processing={processing}
        openingDocument={openingDocument}
        onClose={() => {
          if (!processing) setSelected(null);
        }}
        onApprove={(application) =>
          void runInvite(application, "approve")
        }
        onReject={(application) => void rejectApplication(application)}
        onResend={(application) => void runInvite(application, "resend")}
        onOpenDocument={(path) => void openDocument(path)}
      />
    </div>
  );
}

function ApplicationDialog({
  application,
  processing,
  openingDocument,
  onClose,
  onApprove,
  onReject,
  onResend,
  onOpenDocument,
}: {
  application: Application | null;
  processing: InviteAction | "reject" | null;
  openingDocument: string | null;
  onClose: () => void;
  onApprove: (application: Application) => void;
  onReject: (application: Application) => void;
  onResend: (application: Application) => void;
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
            <ApplicationStatus status={application.status} />
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

        {application.document_urls && application.document_urls.length > 0 && (
          <DetailSection title="Uploaded documents">
            <div className="space-y-2">
              {application.document_urls.map((path) => (
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
                  <span className="truncate">{fileName(path)}</span>
                </Button>
              ))}
            </div>
          </DetailSection>
        )}

        {application.additional_notes && (
          <DetailSection title="Additional notes">
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
              {application.additional_notes}
            </p>
          </DetailSection>
        )}

        {application.status === "pending" && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="font-medium text-amber-950">Approval provisions access</p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              Approving creates or reuses the contractor record, adds the vendor
              role to the applicant’s account, links the account to the
              contractor, and sends the appropriate invite or password email.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={Boolean(processing)}
                onClick={() => onApprove(application)}
              >
                {processing === "approve" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <CheckCircle2 />
                )}
                {processing === "approve"
                  ? "Processing..."
                  : "Approve & Send Invite"}
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={Boolean(processing)}
                onClick={() => onReject(application)}
              >
                {processing === "reject" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <XCircle />
                )}
                {processing === "reject" ? "Rejecting..." : "Reject"}
              </Button>
            </div>
          </div>
        )}

        {application.status === "approved" && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-accent" />
                <p className="font-medium">Onboarding pipeline</p>
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
              {pipelineStatus !== "account_active" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-4 w-full"
                  disabled={Boolean(processing)}
                  onClick={() => onResend(application)}
                >
                  {processing === "resend" ? (
                    <Loader2 className="animate-spin" />
                  ) : pipelineStatus === "not_invited" ||
                    pipelineStatus === "failed" ? (
                    <Send />
                  ) : (
                    <RefreshCw />
                  )}
                  {processing === "resend"
                    ? "Sending..."
                    : pipelineStatus === "not_invited" ||
                        pipelineStatus === "failed"
                      ? "Send invite"
                      : "Resend invite"}
                </Button>
              )}
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

        {application.status === "rejected" && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <XCircle className="h-4 w-4" />
            Application was rejected
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={Boolean(processing)} onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function ApplicationStatus({ status }: { status: string }) {
  return (
    <Badge
      className={cn(
        "border capitalize",
        statusStyle[status] ?? "border-border bg-muted text-muted-foreground",
      )}
    >
      {status}
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

function fileName(path: string) {
  return path.split("/").pop() || path;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function getFunctionError(error: unknown, data: unknown) {
  if (isRecord(data) && typeof data.error === "string") return data.error;
  if (!error) return null;

  if (isRecord(error) && error.context instanceof Response) {
    try {
      const body = (await error.context.clone().json()) as unknown;
      if (isRecord(body) && typeof body.error === "string") return body.error;
    } catch {
      // Fall through to the SDK error message.
    }
  }

  return error instanceof Error
    ? error.message
    : "The vendor onboarding function returned an error.";
}
