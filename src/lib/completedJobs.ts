import { createClient } from "@/lib/supabase/client";

/**
 * Conservative trust-facing completion states. Vendor-only completion and
 * dispute resolution are intentionally excluded until the job reaches a
 * homeowner-confirmed or normal post-completion state.
 */
export const COMPLETED_JOB_STATUSES = [
  "homeowner_confirmed",
  "completed",
  "review_requested",
  "reviewed",
  "closed",
] as const;

const completedStatusSet = new Set<string>(COMPLETED_JOB_STATUSES);

/**
 * Statuses that represent post-match work or a terminal outcome for an
 * assigned contractor. Pending/matched offers are excluded so this signal
 * does not quietly become an acceptance-rate metric.
 */
export const ACTIONABLE_ASSIGNED_JOB_STATUSES = [
  "quoted",
  "scheduled",
  "in_progress",
  "pending_review",
  "vendor_completed",
  ...COMPLETED_JOB_STATUSES,
  "disputed",
  "resolved",
  "cancelled",
] as const;

const actionableAssignedStatusSet = new Set<string>(ACTIONABLE_ASSIGNED_JOB_STATUSES);

export function isCompletedJobStatus(status: string) {
  return completedStatusSet.has(status);
}

export function completionRateFromStatuses(statuses: string[]) {
  const actionableStatuses = statuses.filter((status) => actionableAssignedStatusSet.has(status));
  const completedJobs = actionableStatuses.filter(isCompletedJobStatus).length;
  const actionableJobs = actionableStatuses.length;

  return {
    completedJobs,
    actionableJobs,
    completionRate: actionableJobs > 0
      ? Math.round((completedJobs / actionableJobs) * 100)
      : null,
  };
}

type CompletedJobCountRow = {
  contractor_id: string;
  completed_jobs: number | string;
};

/**
 * Reads aggregate-only public counts from a security-definer RPC. Callers
 * should hide the metric if this throws; contractors.jobs_completed is not a
 * trustworthy fallback for public or vendor-facing history.
 */
export async function fetchCompletedJobCounts(contractorIds: string[]) {
  const uniqueIds = [...new Set(contractorIds.filter(Boolean))];
  const counts = new Map<string, number>();
  if (!uniqueIds.length) return counts;

  const result = await createClient().rpc("get_completed_job_counts", {
    _contractor_ids: uniqueIds,
  });
  if (result.error) throw result.error;

  for (const row of (result.data ?? []) as CompletedJobCountRow[]) {
    const value = Number(row.completed_jobs);
    if (Number.isFinite(value) && value >= 0) {
      counts.set(row.contractor_id, Math.floor(value));
    }
  }
  return counts;
}
