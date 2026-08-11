export const serviceRequestStatuses = [
  "pending",
  "matched",
  "quoted",
  "scheduled",
  "in_progress",
  "pending_review",
  "completed",
  "cancelled",
  "vendor_completed",
  "homeowner_confirmed",
  "disputed",
  "resolved",
  "review_requested",
  "reviewed",
  "closed",
] as const;

type ServiceRequestStatus = (typeof serviceRequestStatuses)[number];

export const pastServiceRequestStatuses = new Set<string>([
  "homeowner_confirmed",
  "completed",
  "reviewed",
  "disputed",
  "resolved",
  "closed",
  "cancelled",
]);

export const serviceRequestStatusStyles = {
  pending: "border-amber-200 bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200",
  matched: "border-blue-200 bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-200",
  quoted: "border-violet-200 bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-200",
  scheduled: "border-sage/20 bg-sage-light text-sage-dark",
  in_progress: "border-accent/20 bg-accent/10 text-accent",
  pending_review: "border-amber-200 bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200",
  vendor_completed: "border-amber-200 bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-200",
  homeowner_confirmed: "border-emerald-200 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
  completed: "border-emerald-200 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
  review_requested: "border-violet-200 bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-200",
  reviewed: "border-emerald-200 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
  disputed: "border-red-200 bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-200",
  resolved: "border-emerald-200 bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200",
  closed: "border-border bg-muted text-muted-foreground",
  cancelled: "border-red-200 bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-200",
} satisfies Record<ServiceRequestStatus, string>;

const serviceRequestStatusLabels = {
  pending: "Request received",
  matched: "Provider matched",
  quoted: "Quote ready",
  scheduled: "Scheduled",
  in_progress: "In progress",
  pending_review: "Awaiting confirmation",
  vendor_completed: "Ready to confirm",
  homeowner_confirmed: "Completion confirmed",
  completed: "Completed",
  review_requested: "Review requested",
  reviewed: "Reviewed",
  disputed: "Issue reported",
  resolved: "Issue resolved",
  closed: "Closed",
  cancelled: "Cancelled",
} satisfies Record<ServiceRequestStatus, string>;

export function isPastServiceRequestStatus(status: string) {
  return pastServiceRequestStatuses.has(status);
}

export function serviceRequestStatusLabel(status: string) {
  return status in serviceRequestStatusLabels
    ? serviceRequestStatusLabels[status as ServiceRequestStatus]
    : status.replaceAll("_", " ");
}

export function serviceRequestStatusStyle(status: string) {
  return status in serviceRequestStatusStyles
    ? serviceRequestStatusStyles[status as ServiceRequestStatus]
    : "border-border bg-muted text-muted-foreground";
}
