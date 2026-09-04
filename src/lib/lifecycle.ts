import type { Database } from "@/lib/supabase/database.types";

export const lifecycleVersion = "phase4-v1";
type StoredStatus = Database["public"]["Enums"]["request_status"];
export type RequestState = "submitted" | "matching" | "quote_required" | "unavailable" |
  "provider_confirmed" | "scheduled" | "in_progress" | "completion_pending" |
  "completed" | "closed" | "cancelled" | "disputed" | "resolved";

// Compatibility projection; historical database states are never overwritten.
const requestStates = {
  pending: "submitted", matched: "matching", quoted: "quote_required",
  scheduled: "scheduled", in_progress: "in_progress", pending_review: "completion_pending",
  vendor_completed: "completion_pending", homeowner_confirmed: "completed",
  completed: "completed", review_requested: "completed", reviewed: "completed",
  cancelled: "cancelled", closed: "closed", disputed: "disputed", resolved: "resolved",
} as const satisfies Record<StoredStatus, RequestState>;

export function canonicalRequestState(status: StoredStatus, matchingStatus?: string): RequestState {
  if (status === "pending" && ["sourcing", "exhausted"].includes(matchingStatus ?? "")) return "unavailable";
  if (status === "matched" && matchingStatus === "matched") return "provider_confirmed";
  if (status === "pending" && ["awaiting_match", "offered", "awaiting_consent"].includes(matchingStatus ?? "")) return "matching";
  return requestStates[status];
}

// Mirrors the recovered transition graph, with actor checks enforced separately
// in SQL. This is presentation guidance, never an authorization boundary.
const transitions: Record<StoredStatus, readonly StoredStatus[]> = {
  pending: ["matched", "quoted", "scheduled", "in_progress", "cancelled"],
  matched: ["scheduled", "quoted", "pending", "in_progress", "cancelled"],
  quoted: ["scheduled", "matched", "pending", "in_progress", "cancelled"],
  scheduled: ["in_progress", "quoted", "pending", "cancelled"],
  in_progress: ["pending_review", "vendor_completed", "pending", "cancelled"],
  pending_review: ["vendor_completed", "in_progress", "cancelled"],
  vendor_completed: ["homeowner_confirmed", "disputed", "in_progress"],
  homeowner_confirmed: ["completed", "disputed"],
  completed: ["review_requested", "reviewed", "closed", "disputed"],
  review_requested: ["reviewed", "closed", "disputed"], reviewed: ["closed", "disputed"],
  disputed: ["resolved", "in_progress"], resolved: ["completed", "closed"], cancelled: [], closed: [],
};

export function adminTransitionTargets(status: string): readonly StoredStatus[] {
  if (!Object.hasOwn(transitions, status)) return [];
  return transitions[status as StoredStatus].filter(target => !["homeowner_confirmed", "quoted", "pending_review", "disputed", "resolved", "reviewed"].includes(target) && (target !== "cancelled" || status === "pending"));
}

/** CFG-006: classify intent only. No refund, fee, ledger or payout operation. */
export function cancellationPolicy(scheduledAt: string, requestedAt: string, waived = false) {
  const scheduled = Date.parse(scheduledAt);
  const requested = Date.parse(requestedAt);
  if (!Number.isFinite(scheduled) || !Number.isFinite(requested)) throw new Error("Valid appointment and request timestamps are required");
  const hours = (scheduled - requested) / 3_600_000;
  return { policy: "CFG-006", refundPercent: waived || hours >= 72 ? 100 : hours >= 24 ? 50 : 0 } as const;
}

export function reschedulingPolicy(scheduledAt: string, requestedAt: string, waived = false) {
  const scheduled = Date.parse(scheduledAt);
  const requested = Date.parse(requestedAt);
  if (!Number.isFinite(scheduled) || !Number.isFinite(requested)) throw new Error("Valid appointment and request timestamps are required");
  const hours = (scheduled - requested) / 3_600_000;
  // Waivers remove fees; they do not promise an appointment under 24 hours.
  return { policy: "CFG-006", requiresOperations: hours < 24,
    fee: waived || hours >= 48 ? 0 : hours >= 24 ? 25 : null } as const;
}
