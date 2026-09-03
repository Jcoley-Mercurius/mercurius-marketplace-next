import { cn } from "@/lib/utils";

const tones = {
  neutral: "border-status-neutral bg-status-neutral-bg text-status-neutral",
  info: "border-status-info bg-status-info-bg text-status-info",
  success: "border-status-success bg-status-success-bg text-status-success",
  warning: "border-status-warning bg-status-warning-bg text-status-warning",
  danger: "border-status-danger bg-status-danger-bg text-status-danger",
};

// MPS §5.1 vocabulary only. No backend transition or legacy-state remapping.
export const requestStatusPresentation = {
  draft: ["Draft", "neutral"], submitted: ["Submitted", "info"],
  matching: ["Matching", "info"], quote_required: ["Quote required", "warning"],
  unavailable: ["Not available yet in your area", "neutral"],
  provider_confirmed: ["Provider confirmed", "info"], scheduled: ["Scheduled", "info"],
  in_progress: ["In progress", "info"], completion_pending: ["Completion pending", "warning"],
  completed: ["Completed", "success"], closed: ["Closed", "neutral"],
  cancelled: ["Cancelled", "neutral"], expired: ["Expired", "neutral"],
  disputed: ["Disputed", "danger"], resolved: ["Resolved", "success"],
} as const;

export function Status({ state, announce = false }: { state: keyof typeof requestStatusPresentation; announce?: boolean }) {
  const [label, tone] = requestStatusPresentation[state];
  return <span role={announce ? "status" : undefined} className={cn("inline-flex max-w-full items-center rounded-full border px-3 py-1 text-sm font-medium", tones[tone])}>{label}</span>;
}
