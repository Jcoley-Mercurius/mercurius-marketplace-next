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
  pending: "border-status-warning bg-status-warning-bg text-status-warning",
  matched: "border-status-info bg-status-info-bg text-status-info",
  quoted: "border-status-info bg-status-info-bg text-status-info",
  scheduled: "border-sage/20 bg-sage-light text-sage-dark",
  in_progress: "border-accent/20 bg-accent/10 text-accent",
  pending_review: "border-status-warning bg-status-warning-bg text-status-warning",
  vendor_completed: "border-status-warning bg-status-warning-bg text-status-warning",
  homeowner_confirmed: "border-status-success bg-status-success-bg text-status-success",
  completed: "border-status-success bg-status-success-bg text-status-success",
  review_requested: "border-status-info bg-status-info-bg text-status-info",
  reviewed: "border-status-success bg-status-success-bg text-status-success",
  disputed: "border-status-danger bg-status-danger-bg text-status-danger",
  resolved: "border-status-success bg-status-success-bg text-status-success",
  closed: "border-border bg-muted text-muted-foreground",
  cancelled: "border-status-danger bg-status-danger-bg text-status-danger",
} satisfies Record<ServiceRequestStatus, string>;

const serviceRequestStatusLabels = {
  pending: "Request received",
  matched: "Provider offer pending",
  quoted: "Quote ready",
  scheduled: "Scheduled",
  in_progress: "In progress",
  pending_review: "Completion pending",
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
