"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  Star,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
  const [confirmingCancel, setConfirmingCancel] = useState(false);

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
    setConfirmingCancel(false);
    onOpenChange(false);
  }

  async function cancelPendingRequest() {
    if (!actionsEnabled || busyAction || !isPending) return;

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
      setConfirmingCancel(false);
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
      toast.error("We couldn’t cancel this request", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
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
      toast.error("We couldn’t update this service", {
        description:
          error instanceof Error ? error.message : "Please try again.",
      });
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
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
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

        {isPending && (
          <div className="rounded-xl border border-border bg-muted/30 p-4">
            {!confirmingCancel ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">Manage this request</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    You can cancel while the request is still waiting for a provider.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!actionsEnabled || Boolean(busyAction)}
                  className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
                  onClick={() => setConfirmingCancel(true)}
                >
                  <Ban className="h-4 w-4" />
                  Cancel request
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="font-medium text-red-950 dark:text-red-100">
                    Cancel this pending request?
                  </p>
                  <p className="mt-1 text-sm leading-5 text-red-900/80 dark:text-red-200/80">
                    This removes the request before a provider is matched. You can
                    submit a new request later, but this action can’t be undone.
                  </p>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={Boolean(busyAction)}
                    onClick={() => setConfirmingCancel(false)}
                  >
                    Keep request
                  </Button>
                  <Button
                    type="button"
                    disabled={!actionsEnabled || Boolean(busyAction)}
                    className="bg-red-700 text-white hover:bg-red-800 dark:bg-red-700 dark:hover:bg-red-600"
                    onClick={() => void cancelPendingRequest()}
                  >
                    {busyAction === "cancel-request" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Ban className="h-4 w-4" />
                    )}
                    Yes, cancel request
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {needsConfirmation && (
          <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:bg-amber-950/20">
            <div>
              <p className="font-medium text-amber-950 dark:text-amber-100">
                Confirm the completed work
              </p>
              <p className="mt-1 text-sm leading-5 text-amber-900/80 dark:text-amber-200/80">
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
                    className="h-32 w-full rounded-lg border border-amber-200 object-cover"
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-amber-300 px-3 py-4 text-center text-xs text-amber-900 dark:text-amber-200">
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
          <div className="space-y-4 rounded-xl border border-violet-200 bg-violet-50 p-4 dark:bg-violet-950/20">
            <div>
              <p className="font-medium text-violet-950 dark:text-violet-100">
                Respond to this quote
              </p>
              <p className="mt-1 text-sm leading-5 text-violet-900/80 dark:text-violet-200/80">
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
              <p className="mt-1 text-sm text-muted-foreground">
                Your rating helps Mercurius maintain service quality.
              </p>
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="flex gap-1">
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
                    className="rounded-md p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed"
                  >
                    <Star
                      className={cn(
                        "h-9 w-9 transition-colors",
                        stars <= displayRating
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground/30",
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
              <Label htmlFor="job-review-comment">Comments (optional)</Label>
              <textarea
                id="job-review-comment"
                rows={4}
                maxLength={1000}
                value={comment}
                disabled={Boolean(busyAction)}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Tell us about your experience..."
                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-focus-ring focus-visible:ring-2 focus-visible:ring-focus-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
              />
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
