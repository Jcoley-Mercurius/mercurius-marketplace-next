// The applications queue shows where an applicant stands in onboarding (TRACE-065/105).
// The application's own `status` column is legacy: since Phase 5 nothing sets it to
// "approved", so a reviewed or activated applicant still reads "pending" there. Only the
// closures ("rejected", "abandoned") still write it. Onboarding status is the real state.

export type ApplicationQueueState =
  | "awaiting_review"
  | "in_review"
  | "active"
  | "suspended"
  | "rejected"
  | "abandoned"
  | "legacy_approved"
  | "checking"
  | "unavailable";

export type OnboardingReadback = {
  onboarding_status: string | null;
  review_started: boolean;
};

export function applicationQueueState(
  applicationStatus: string,
  onboarding: OnboardingReadback | null | undefined,
  failed = false,
): ApplicationQueueState {
  if (applicationStatus === "abandoned") return "abandoned";
  if (onboarding?.onboarding_status === "rejected" || applicationStatus === "rejected") return "rejected";
  if (onboarding?.review_started) {
    if (onboarding.onboarding_status === "active") return "active";
    if (onboarding.onboarding_status === "suspended") return "suspended";
    return "in_review";
  }
  if (failed) return "unavailable";
  if (onboarding === undefined) return "checking";
  // Approved under the recovered pre-Phase 5 pipeline and never reviewed since.
  if (applicationStatus === "approved") return "legacy_approved";
  return "awaiting_review";
}

export const applicationQueueLabel: Record<ApplicationQueueState, string> = {
  awaiting_review: "Awaiting review",
  in_review: "In review",
  active: "Active",
  suspended: "Suspended",
  rejected: "Rejected",
  abandoned: "Abandoned",
  legacy_approved: "Approved (legacy)",
  checking: "Checking…",
  unavailable: "Status unavailable",
};

export const applicationQueueFilters: ApplicationQueueState[] = [
  "awaiting_review",
  "in_review",
  "active",
  "suspended",
  "rejected",
  "abandoned",
  "legacy_approved",
];
