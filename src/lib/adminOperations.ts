// TRACE-136 (DEC-2026-057): shared rules for the admin operations pages. The server owns
// authorization, version binding, replay and history; this module keeps request keys stable
// across retries, words refusals, and maps the operations summary to its queues.

/**
 * One request key per intent. A retry of the same action on the same record version reuses its
 * key, so a lost response replays the first result instead of acting twice.
 */
export function createKeyStore() {
  const keys = new Map<string, string>();
  return (intent: string) => {
    let key = keys.get(intent);
    if (!key) { key = crypto.randomUUID(); keys.set(intent, key); }
    return key;
  };
}

type RpcError = { code?: string; message: string };

export const STALE_REQUEST_MESSAGE = "This request changed since you opened it — review the current state.";

/** Server refusals worded for operators; anything else keeps the server's own wording. */
export function adminActionError(error: RpcError | null | undefined, stale = STALE_REQUEST_MESSAGE) {
  if (!error) return "";
  if (error.code === "40001") return stale;
  if (error.code === "42501") return "You don't have access to this action.";
  return error.message;
}

export class AdminActionError extends Error {}

export type SummaryQueue = {
  queue: string;
  state: "ready" | "error" | "restricted";
  count: number | null;
  aged: number | null;
};

export type OperationsSummary = { checkedAt: string; queues: SummaryQueue[] };

/** Where each summarized queue is worked. Labels match the queue headings. */
export const SUMMARY_QUEUES: Record<string, { label: string; href: string; agedLabel?: string }> = {
  quote: { label: "Quote exceptions", href: "/admin/requests#quote-exceptions", agedLabel: "aged" },
  recurring_payment: { label: "Recurring visit payments", href: "/admin/requests#recurring-payments", agedLabel: "aged" },
  fulfillment: { label: "Fulfillment follow-up", href: "/admin/requests#fulfillment-follow-up", agedLabel: "aged" },
  cancellation: { label: "Cancellation follow-up", href: "/admin/requests#cancellation-follow-up" },
  support: { label: "Support tickets", href: "/admin/tickets", agedLabel: "past response target" },
  compliance_renewal: { label: "Compliance renewals", href: "/admin/compliance/renewals" },
  renewal_documents: { label: "Renewal documents", href: "/admin/compliance/renewals" },
  finance_exceptions: { label: "Finance exceptions", href: "/admin/finance" },
};

export function parseOperationsSummary(value: unknown): OperationsSummary {
  const data = (value ?? {}) as { checked_at?: unknown; queues?: unknown };
  const queues = Array.isArray(data.queues) ? data.queues.flatMap((row): SummaryQueue[] => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (typeof item.queue !== "string") return [];
    const state = item.state === "ready" || item.state === "restricted" ? item.state : "error";
    const count = typeof item.count === "number" ? item.count : null;
    const aged = typeof item.aged === "number" ? item.aged : null;
    return [{ queue: item.queue, state, count, aged }];
  }) : [];
  return { checkedAt: typeof data.checked_at === "string" ? data.checked_at : "", queues };
}

/** A request with no offer, quote, assignment, payment or price: the only state the correction command accepts. */
export function isCorrectableRequest(request: {
  status: string; contractor_id: string | null; matching_status: string; current_quote_id?: string | null;
  quote_status?: string | null; total_amount: number | null; quote_amount: number | null; payment_status: string;
}) {
  return request.status === "pending" && request.contractor_id === null
    && !["offered", "matched", "quote_pending"].includes(request.matching_status)
    && !request.current_quote_id && !request.quote_status
    && request.total_amount === null && request.quote_amount === null && request.payment_status === "pending";
}

/** URL state for /admin/requests: ?q=, ?status=, ?request=. Unknown values are dropped. */
export function parseRequestsQuery(params: URLSearchParams, statuses: readonly string[]) {
  const status = params.get("status") ?? "all";
  return {
    q: params.get("q") ?? "",
    status: status === "all" || statuses.includes(status) ? status : "all",
    request: /^[0-9a-f-]{36}$/i.test(params.get("request") ?? "") ? params.get("request")! : null,
  };
}

export function requestsQueryString(state: { q: string; status: string; request: string | null }) {
  const params = new URLSearchParams();
  if (state.q.trim()) params.set("q", state.q.trim());
  if (state.status !== "all") params.set("status", state.status);
  if (state.request) params.set("request", state.request);
  const text = params.toString();
  return text ? `?${text}` : "";
}

export type VerifiedProviderStats = { reviewCount: number | null; averageRating: number | null; completedJobs: number | null };

/**
 * DEC-2026-057 item 4 (DEC-2026-052 item 6 as amended): operator surfaces show the verified review
 * summary and completed-job count, never contractors.rating or jobs_completed. A summary that can't
 * be read shows as unavailable rather than falling back to the stored value.
 */
export async function loadVerifiedProviderStats(
  supabase: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> },
  contractorIds: string[],
) {
  const ids = [...new Set(contractorIds.filter(Boolean))];
  const stats = new Map<string, VerifiedProviderStats>();
  if (!ids.length) return stats;
  const [reviews, jobs] = await Promise.all([
    supabase.rpc("public_review_summaries", { _contractor_ids: ids }),
    supabase.rpc("get_completed_job_counts", { _contractor_ids: ids }),
  ]);
  const reviewRows = new Map(((reviews.error ? [] : reviews.data ?? []) as { contractor_id: string; review_count: number; average_rating: number | string | null }[])
    .map((row) => [row.contractor_id, row]));
  const jobRows = new Map(((jobs.error ? [] : jobs.data ?? []) as { contractor_id: string; completed_jobs: number | string }[])
    .map((row) => [row.contractor_id, Number(row.completed_jobs)]));
  for (const id of ids) {
    const review = reviewRows.get(id);
    stats.set(id, {
      reviewCount: reviews.error ? null : review?.review_count ?? 0,
      averageRating: review?.average_rating == null ? null : Number(review.average_rating),
      completedJobs: jobs.error ? null : jobRows.get(id) ?? 0,
    });
  }
  return stats;
}

export function reviewSummaryText(stats: VerifiedProviderStats | undefined) {
  if (!stats || stats.reviewCount === null) return "Reviews unavailable";
  if (stats.reviewCount === 0 || stats.averageRating === null) return "No reviews yet";
  return `${stats.averageRating.toFixed(1)} from ${stats.reviewCount} review${stats.reviewCount === 1 ? "" : "s"}`;
}

export function completedJobsText(stats: VerifiedProviderStats | undefined) {
  if (!stats || stats.completedJobs === null) return "Completed jobs unavailable";
  return `${stats.completedJobs} completed job${stats.completedJobs === 1 ? "" : "s"}`;
}
