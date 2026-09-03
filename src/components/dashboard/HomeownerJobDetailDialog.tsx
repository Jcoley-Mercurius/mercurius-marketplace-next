"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  LifeBuoy,
  Loader2,
  MapPin,
  MessageSquare,
  Star,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { fetchCompletedJobCounts } from "@/lib/completedJobs";
import { contactHrefForRequest } from "@/lib/requestContext";
import {
  serviceRequestStatusLabel,
  serviceRequestStatusStyle,
} from "@/lib/serviceRequestStatus";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type HomeownerDashboardJob = {
  id: string;
  service_type: string;
  status: string;
  preferred_date: string | null;
  preferred_time: string | null;
  address: string;
  city: string;
  state: string;
  contractor_id: string | null;
  description: string | null;
  photo_proof_urls: string[] | null;
  total_amount: number | null;
  created_at: string;
};

type JobAction =
  | "approve-quote"
  | "cancel-request"
  | "decline-quote"
  | "confirm-done"
  | "needs-rework"
  | "submit-review";

type Props = {
  job: HomeownerDashboardJob | null;
  homeownerId: string;
  open: boolean;
  actionsEnabled: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoveJob: (jobId: string) => void;
  onOptimisticStatus: (jobId: string, status: string) => void;
  onRefresh: () => Promise<void>;
};

type ProviderSummary = {
  id: string;
  name: string;
  logo_url: string | null;
  location: string | null;
};

type ProviderMode = "idle" | "loading" | "ready" | "missing" | "error";

const ratingLabels = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

export function HomeownerJobDetailDialog({
  job,
  homeownerId,
  open,
  actionsEnabled,
  onOpenChange,
  onRemoveJob,
  onOptimisticStatus,
  onRefresh,
}: Props) {
  const [busyAction, setBusyAction] = useState<JobAction | null>(null);
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState("");
  const [signedPhotos, setSignedPhotos] = useState<string[]>([]);
  const [actionError, setActionError] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (actionError) errorRef.current?.focus(); }, [actionError]);
  const [provider, setProvider] = useState<ProviderSummary | null>(null);
  const [providerMode, setProviderMode] = useState<ProviderMode>(
    job?.contractor_id ? "loading" : "idle",
  );
  const [publicRating, setPublicRating] = useState<number | null>(null);
  const [publicReviewCount, setPublicReviewCount] = useState(0);
  const [completedJobCount, setCompletedJobCount] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !job || !job.photo_proof_urls?.length) return;
    let active = true;

    async function resolvePhotos() {
      const supabase = createClient();
      const resolved = await Promise.all(
        (job?.photo_proof_urls ?? []).map(async (path) => {
          if (/^https?:\/\//i.test(path)) return path;
          const { data, error } = await supabase.storage
            .from("job-photos")
            .createSignedUrl(path, 3600);
          return error ? null : data.signedUrl;
        }),
      );

      if (active) {
        setSignedPhotos(
          resolved.filter((value): value is string => Boolean(value)),
        );
      }
    }

    void resolvePhotos();
    return () => {
      active = false;
    };
  }, [job, open]);

  useEffect(() => {
    const contractorId = job?.contractor_id;
    if (!open || !contractorId) return;
    let active = true;

    const timer = window.setTimeout(async () => {
      setProviderMode("loading");
      setProvider(null);
      setPublicRating(null);
      setPublicReviewCount(0);
      setCompletedJobCount(null);

      try {
        const supabase = createClient();
        const completedJobsPromise = fetchCompletedJobCounts([contractorId])
          .then((counts) => counts.get(contractorId) ?? null)
          .catch((reason) => {
            console.warn("Assigned provider completed-job count is unavailable", reason);
            return null;
          });
        const [contractorResult, reviewsResult] = await Promise.all([
          supabase
            .from("contractors")
            .select("id, name, logo_url, location")
            .eq("id", contractorId)
            .maybeSingle(),
          supabase
            .from("reviews")
            .select("rating")
            .eq("contractor_id", contractorId)
            .eq("visibility", "eligible_for_google"),
        ]);

        if (!active) return;
        if (contractorResult.error) throw contractorResult.error;
        if (!contractorResult.data) {
          setProviderMode("missing");
          return;
        }

        const ratings = reviewsResult.error
          ? []
          : (reviewsResult.data ?? [])
              .map((review) => Number(review.rating))
              .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);
        if (reviewsResult.error) {
          console.warn("Assigned provider public reviews are unavailable", reviewsResult.error);
        }

        const completedJobs = await completedJobsPromise;
        if (!active) return;

        setProvider(contractorResult.data as ProviderSummary);
        setPublicReviewCount(ratings.length);
        setPublicRating(
          ratings.length
            ? ratings.reduce((total, rating) => total + rating, 0) /
                ratings.length
            : null,
        );
        setCompletedJobCount(completedJobs);
        setProviderMode("ready");
      } catch (reason) {
        console.error("Unable to load assigned provider basics", reason);
        if (active) setProviderMode("error");
      }
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [job?.contractor_id, open]);

  if (!job) return null;
  const currentJob = job;

  const isQuoted = job.status === "quoted";
  const isPending = job.status === "pending";
  const needsConfirmation = ["pending_review", "vendor_completed"].includes(
    job.status,
  );
  const needsReview = job.status === "review_requested";
  const location = [job.address, job.city, job.state].filter(Boolean).join(", ");
  const displayRating = hoveredRating || rating;

  function close() {
    if (busyAction) return;
    setRating(0);
    setHoveredRating(0);
    setComment("");
    setSignedPhotos([]);
    setActionError("");
    onOpenChange(false);
  }

  async function cancelPendingRequest() {
    if (!actionsEnabled || busyAction || !isPending) return;

    setActionError("");
    setBusyAction("cancel-request");
    try {
      const { data, error } = await createClient()
        .from("service_requests")
        .delete()
        .eq("id", currentJob.id)
        .eq("customer_id", homeownerId)
        .eq("status", "pending")
        .select("id");

      if (error) throw new Error(error.message);
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error(
          "This request could not be cancelled. It may no longer be pending.",
        );
      }

      onRemoveJob(currentJob.id);
      requestAnimationFrame(() => document.getElementById("homeowner-dashboard-heading")?.focus());
      setActionError("");
      onOpenChange(false);
      toast.success("Request cancelled", {
        description: "Your pending request has been removed.",
      });

      try {
        await onRefresh();
      } catch (error) {
        toast.warning("Request cancelled, but the dashboard could not refresh", {
          description:
            error instanceof Error
              ? error.message
              : "Refresh the page to confirm the latest list.",
        });
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "We couldn’t cancel this request. Please try again.");
      throw error;
    } finally {
      setBusyAction(null);
    }
  }

  async function runAction(
    action: JobAction,
    optimisticStatus: string,
    request: () => PromiseLike<{ error: { message: string } | null }>,
    successTitle: string,
    successDescription: string,
  ) {
    if (!actionsEnabled || busyAction) return;

    const previousStatus = currentJob.status;
    setActionError("");
    setBusyAction(action);
    onOptimisticStatus(currentJob.id, optimisticStatus);

    try {
      const { error } = await request();
      if (error) throw new Error(error.message);

      toast.success(successTitle, { description: successDescription });
      setRating(0);
      setHoveredRating(0);
      setComment("");
      onOpenChange(false);

      try {
        await onRefresh();
      } catch (error) {
        toast.warning("Action saved, but the dashboard could not refresh", {
          description:
            error instanceof Error
              ? error.message
              : "Refresh the page to see the latest status.",
        });
      }
    } catch (error) {
      onOptimisticStatus(currentJob.id, previousStatus);
      setActionError(error instanceof Error ? error.message : "We couldn’t update this service. Please try again.");
    } finally {
      setBusyAction(null);
    }
  }

  function respondToQuote(approve: boolean) {
    const supabase = createClient();
    return runAction(
      approve ? "approve-quote" : "decline-quote",
      approve ? "scheduled" : "cancelled",
      () =>
        supabase.rpc("homeowner_respond_to_quote", {
          _job_id: currentJob.id,
          _approve: approve,
        }),
      approve ? "Quote approved" : "Quote declined",
      approve
        ? "Your service is now moving into the scheduled workflow."
        : "This quoted service has been cancelled.",
    );
  }

  function respondToCompletion(confirm: boolean) {
    const supabase = createClient();
    return runAction(
      confirm ? "confirm-done" : "needs-rework",
      confirm ? "homeowner_confirmed" : "in_progress",
      () =>
        confirm
          ? supabase.rpc("homeowner_confirm_job", { _job_id: currentJob.id })
          : supabase.rpc("transition_job_status", {
              _job_id: currentJob.id,
              _to_status: "in_progress",
            }),
      confirm ? "Service confirmed" : "Sent back for rework",
      confirm
        ? "Thanks—Mercurius will move this service into the review workflow."
        : "The provider can now continue work on this service.",
    );
  }

  function submitReview() {
    if (rating < 1 || rating > 5) {
      toast.error("Choose a star rating before submitting");
      return;
    }

    const supabase = createClient();
    return runAction(
      "submit-review",
      "reviewed",
      () =>
        supabase.rpc("submit_job_review", {
          _job_id: currentJob.id,
          _rating: rating,
          _comment: comment.trim(),
        }),
      "Review submitted",
      "Thank you for sharing feedback about your service.",
    );
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent showCloseButton={!busyAction} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle>{job.service_type}</DialogTitle>
            <Badge
              variant="outline"
              className={cn(
                "border",
                serviceRequestStatusStyle(job.status),
              )}
            >
              {serviceRequestStatusLabel(job.status)}
            </Badge>
          </div>
          <DialogDescription>
            Review the current service details and complete any action that is
            waiting on you.
          </DialogDescription>
        </DialogHeader>
        {actionError && <p ref={errorRef} role="alert" tabIndex={-1} className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">{actionError}</p>}

        <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:grid-cols-2">
          <Detail icon={Calendar} label="Preferred date">
            {job.preferred_date ? formatDate(job.preferred_date) : "Date TBD"}
          </Detail>
          <Detail icon={Clock} label="Preferred time">
            {job.preferred_time || "Time TBD"}
          </Detail>
          <Detail icon={MapPin} label="Service address" wide>
            {location || "Address unavailable"}
          </Detail>
          <Detail icon={CreditCard} label={isQuoted ? "Quoted price" : "Recorded amount"}>
            {job.total_amount === null
              ? "Not available"
              : formatMoney(job.total_amount)}
          </Detail>
        </div>

        {job.description && (
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Request notes
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
              {job.description}
            </p>
          </div>
        )}

        {job.contractor_id && (
          <AssignedProviderCard
            contractorId={job.contractor_id}
            jobId={job.id}
            provider={provider}
            mode={providerMode}
            publicRating={publicRating}
            publicReviewCount={publicReviewCount}
            completedJobCount={completedJobCount}
          />
        )}

        {isPending && <div className="rounded-xl border border-border p-4">
          <ConfirmAction triggerLabel="Cancel request" title="Cancel this pending request?" entity={`${job.service_type} · ${job.id.slice(0, 8)}`} consequence="This removes the request before a provider is matched. You can submit a new request later, but this action can’t be undone." confirmLabel="Yes, cancel request" disabled={!actionsEnabled || Boolean(busyAction)} onConfirm={cancelPendingRequest} />
        </div>}

        {needsConfirmation && (
          <div className="space-y-4 rounded-xl border border-status-warning bg-status-warning-bg p-4 bg-status-warning-bg">
            <div>
              <p className="font-medium text-status-warning text-status-warning">
                Confirm the completed work
              </p>
              <p className="mt-1 text-sm leading-5 text-status-warning text-status-warning">
                Confirm only after you’ve reviewed the result. “Needs rework”
                returns the service to in progress.
              </p>
            </div>

            {signedPhotos.length > 0 ? (
              <div className="grid grid-cols-2 gap-3">
                {signedPhotos.map((src, index) => (
                  // Signed storage URLs are short-lived and intentionally bypass
                  // Next Image optimization.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={src}
                    src={src}
                    alt={`Completion photo ${index + 1} for ${job.service_type}`}
                    className="h-32 w-full rounded-lg border border-status-warning object-cover"
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-status-warning px-3 py-4 text-center text-xs text-status-warning text-status-warning">
                No completion photos are available to display.
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                disabled={!actionsEnabled || Boolean(busyAction)}
                onClick={() => void respondToCompletion(false)}
              >
                {busyAction === "needs-rework" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <AlertTriangle />
                )}
                Needs rework
              </Button>
              <Button
                disabled={!actionsEnabled || Boolean(busyAction)}
                className="bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active"
                onClick={() => void respondToCompletion(true)}
              >
                {busyAction === "confirm-done" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <CheckCircle2 />
                )}
                Confirm done
              </Button>
            </div>
          </div>
        )}

        {isQuoted && (
          <div className="space-y-4 rounded-xl border border-status-info bg-status-info-bg p-4 bg-status-info-bg">
            <div>
              <p className="font-medium text-status-info text-status-info">
                Respond to this quote
              </p>
              <p className="mt-1 text-sm leading-5 text-status-info text-status-info">
                Approving moves the request into scheduling. Declining cancels
                this quoted service.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                disabled={!actionsEnabled || Boolean(busyAction)}
                onClick={() => void respondToQuote(false)}
              >
                {busyAction === "decline-quote" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ThumbsDown />
                )}
                Decline
              </Button>
              <Button
                disabled={!actionsEnabled || Boolean(busyAction)}
                className="bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active"
                onClick={() => void respondToQuote(true)}
              >
                {busyAction === "approve-quote" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ThumbsUp />
                )}
                Approve quote
              </Button>
            </div>
          </div>
        )}

        {needsReview && (
          <div className="space-y-5 rounded-xl border border-accent-border bg-accent-subtle p-4">
            <div>
              <p className="font-medium">How did the service go?</p>
              <p className="mt-1 text-sm text-foreground">
                Your rating helps Mercurius maintain service quality.
              </p>
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="flex flex-wrap justify-center gap-0">
                {[1, 2, 3, 4, 5].map((stars) => (
                  <button
                    key={stars}
                    type="button"
                    aria-label={`${stars} star${stars === 1 ? "" : "s"}`}
                    aria-pressed={rating === stars}
                    disabled={Boolean(busyAction)}
                    onClick={() => setRating(stars)}
                    onMouseEnter={() => setHoveredRating(stars)}
                    onMouseLeave={() => setHoveredRating(0)}
                    className="flex size-11 items-center justify-center rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed"
                  >
                    <Star
                      className={cn(
                        "h-9 w-9 transition-colors",
                        stars <= displayRating
                          ? "fill-status-warning text-status-warning"
                          : "text-muted-foreground",
                      )}
                    />
                  </button>
                ))}
              </div>
              {displayRating > 0 && (
                <p className="text-sm font-medium">
                  {ratingLabels[displayRating]}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <FormField id="job-review-comment" label="Comments (optional)">{control => <Textarea
                {...control}
                rows={4}
                maxLength={1000}
                value={comment}
                disabled={Boolean(busyAction)}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Tell us about your experience..."
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
              />}</FormField>
            </div>

            <div className="flex justify-end">
              <Button
                disabled={!actionsEnabled || rating === 0 || Boolean(busyAction)}
                className="w-full bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active sm:w-auto"
                onClick={() => void submitReview()}
              >
                {busyAction === "submit-review" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Star />
                )}
                Submit review
              </Button>
            </div>
          </div>
        )}

        {!isPending && !isQuoted && !needsConfirmation && !needsReview && (
          <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            No homeowner action is required for this service right now.
          </div>
        )}

        {!actionsEnabled &&
          (isPending || isQuoted || needsConfirmation || needsReview) && (
          <p className="text-xs text-muted-foreground">
            Actions are unavailable until live dashboard data is available.
          </p>
        )}

        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Need help with this request?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Contact support with this request already attached for context.
            </p>
          </div>
          <Link
            href={contactHrefForRequest(currentJob.id)}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <LifeBuoy className="h-4 w-4" />
            Report an issue
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
  wide = false,
}: {
  icon: typeof Calendar;
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2", wide && "sm:col-span-2")}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 break-words text-sm font-medium">{children}</p>
      </div>
    </div>
  );
}

function AssignedProviderCard({
  contractorId,
  jobId,
  provider,
  mode,
  publicRating,
  publicReviewCount,
  completedJobCount,
}: {
  contractorId: string;
  jobId: string;
  provider: ProviderSummary | null;
  mode: ProviderMode;
  publicRating: number | null;
  publicReviewCount: number;
  completedJobCount: number | null;
}) {
  if (mode === "loading" || mode === "idle") {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 animate-pulse rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3 w-48 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <span className="sr-only">Loading assigned provider</span>
      </div>
    );
  }

  if (mode === "missing" || mode === "error" || !provider) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="font-medium">Provider assigned</p>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">
          The provider’s public profile details are unavailable right now. Your
          assignment is still attached to this service.
        </p>
        <Link
          href={`/messages?request=${encodeURIComponent(jobId)}`}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "mt-4",
          )}
        >
          <MessageSquare className="h-4 w-4" />
          Message provider
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-accent-border bg-accent-subtle/40 p-4">
      <div className="flex items-start gap-3">
        {provider.logo_url ? (
          // Public storefront logos intentionally bypass Next Image optimization.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={provider.logo_url}
            alt={`${provider.name} logo`}
            className="h-12 w-12 shrink-0 rounded-xl border border-border bg-card object-contain p-1"
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent text-lg font-semibold text-accent-foreground">
            {provider.name.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Assigned provider
          </p>
          <p className="mt-1 truncate font-semibold">{provider.name}</p>
          {provider.location && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              {provider.location}
            </p>
          )}
        </div>
      </div>

      {(publicRating !== null || completedJobCount !== null) && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-accent-border/70 pt-3 text-xs text-muted-foreground">
          {publicRating !== null && (
            <span className="flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-status-warning" />
              <strong className="font-semibold text-foreground">
                {publicRating.toFixed(1)}
              </strong>
              {publicReviewCount} public review{publicReviewCount === 1 ? "" : "s"}
            </span>
          )}
          {completedJobCount !== null && (
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-sage-dark" />
              <strong className="font-semibold text-foreground">
                {completedJobCount}
              </strong>
              completed through Mercurius
            </span>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Link
          href={`/providers/${encodeURIComponent(contractorId)}`}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "flex-1",
          )}
        >
          View provider profile
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        <Link
          href={`/messages?request=${encodeURIComponent(jobId)}`}
          className={cn(
            buttonVariants({ size: "sm" }),
            "flex-1 bg-accent text-accent-foreground hover:bg-accent-hover",
          )}
        >
          <MessageSquare className="h-4 w-4" />
          Message provider
        </Link>
      </div>
    </div>
  );
}

function formatDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value));
}
