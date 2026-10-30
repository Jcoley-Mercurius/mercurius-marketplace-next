import { formatAppointment } from "@/lib/appointments";

// TRACE-130: the canonical review readbacks and their wording. The server decides eligibility,
// visibility, moderation and every count; these helpers only describe them.

export const REVIEW_COMMENT_MAX = 2000;

export type ReviewEligibility = "eligible" | "submitted" | "plan" | "cancelled" | "no_provider" | "issue_open"
  | "closed" | "not_confirmed" | "not_found";
export type ReviewState = "published" | "held_for_moderation" | "rejected" | "appealed" | "private";
export type ModerationCriterion = "spam" | "personal_information" | "threats_or_abuse" | "unrelated_to_service";

export type ReviewHistoryEntry = {
  action: "corrected" | "published" | "held_for_moderation" | "rejected" | "appealed";
  at: string; from_state: string | null; to_state: string | null; criterion: ModerationCriterion | null;
  criterion_label: string | null; reason: string; by?: "you" | "mercurius";
  actor_name?: string; ticket_id?: string | null;
  previous?: { rating: number | null; comment: string | null } | null;
};
export type OwnReview = {
  id: string; rating: number; comment: string | null; created_at: string; edited_at: string | null; revision: number;
  state: ReviewState; public: boolean; criterion: ModerationCriterion | null; criterion_label: string | null;
  moderation_version: number; can_edit: boolean; can_appeal: boolean;
};
export type ServiceReview = {
  role: "homeowner" | "admin" | "vendor"; job_id: string; eligibility?: ReviewEligibility; requested?: boolean;
  review: OwnReview | null; history?: ReviewHistoryEntry[];
};
export type PublicReview = { id: string; rating: number; comment: string | null; created_at: string; edited: boolean };
export type PublicReviews = { summary: { count: number; average: number | null }; reviews: PublicReview[] };
export type ReviewSummary = { count: number; average: number | null };

export type AdminReview = OwnReview & {
  job_id: string; service_type: string; visit: boolean; contractor_id: string; contractor_name: string | null;
  author_name: string; moderated_at: string | null; history: ReviewHistoryEntry[];
};
export type AdminReviewCounts = {
  public: number; held_for_moderation: number; rejected: number; appealed: number; private: number;
  public_average: number | null; quality_feedback: number;
};
export type AdminReviews = { checked_at: string; counts: AdminReviewCounts; items: AdminReview[] };

export const MODERATION_CRITERIA: { value: ModerationCriterion; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "personal_information", label: "Personal information" },
  { value: "threats_or_abuse", label: "Threats or abuse" },
  { value: "unrelated_to_service", label: "Unrelated to the service" },
];

export const RATING_LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"] as const;

// DEC-2026-009/010, said the same way wherever a review is written or decided.
export const MODERATION_RULE = "Every star rating is published the same way. Mercurius hides a review only for spam, personal information, threats or abuse, or content unrelated to the service — never for a low rating alone.";

// Why a homeowner can or cannot review this service right now.
export function eligibilityLine(eligibility: ReviewEligibility | undefined): string | null {
  switch (eligibility) {
    case "plan": return "Reviews are left on each completed visit, not on the recurring plan.";
    case "issue_open": return "You can review this service once the issue you reported is resolved.";
    case "not_confirmed": return "You can review this service after you confirm the work is done.";
    case "closed": return "This service is closed for reviews.";
    case "cancelled": return "This service was cancelled, so it can't be reviewed.";
    case "no_provider": return "This service has no provider to review yet.";
    default: return null;
  }
}

export function reviewStateLabel(state: ReviewState) {
  return { published: "Public", held_for_moderation: "Hidden while Mercurius reviews it", rejected: "Not public",
    appealed: "Appeal in review", private: "Private feedback" }[state];
}

// What the author's review state means for them, in one sentence.
export function reviewStateLine(review: Pick<OwnReview, "state" | "criterion_label">) {
  const because = review.criterion_label ? ` (${review.criterion_label.toLowerCase()})` : "";
  switch (review.state) {
    case "published": return "Your review is public on the provider's profile.";
    case "held_for_moderation": return `Your review is hidden while Mercurius checks it${because}. You can correct it or appeal.`;
    case "rejected": return `Your review isn't public${because}. You can correct it or appeal the decision.`;
    case "appealed": return "Mercurius is reviewing your appeal. Your review stays hidden until it's decided.";
    case "private": return "This is private feedback for Mercurius. It isn't shown publicly.";
  }
}

export function historyLabel(entry: ReviewHistoryEntry) {
  switch (entry.action) {
    case "corrected": return "Review corrected";
    case "published": return entry.from_state === "appealed" ? "Appeal upheld — review public" : "Review made public";
    case "held_for_moderation": return "Review hidden for checking";
    case "rejected": return entry.from_state === "appealed" ? "Appeal not upheld" : "Review not published";
    case "appealed": return "Appeal submitted";
  }
}

export function historyDetail(entry: ReviewHistoryEntry) {
  const who = entry.actor_name ?? (entry.by === "you" ? "You" : "Mercurius");
  const criterion = entry.criterion_label ? ` · ${entry.criterion_label}` : "";
  return `${who} · ${formatAppointment(entry.at)}${criterion}`;
}

export function formatAverage(average: number | null | undefined) {
  return average == null ? null : Number(average).toFixed(1);
}

export function summaryLine(summary: ReviewSummary) {
  const average = formatAverage(summary.average);
  if (!summary.count || average === null) return "No public reviews yet";
  return `${average} (${summary.count} public review${summary.count === 1 ? "" : "s"})`;
}

// The public summaries RPC returns only providers with a public review; everyone else has none.
export function summariesById(rows: { contractor_id: string; review_count: number; average_rating: number | null }[] | null) {
  return new Map((rows ?? []).map((row) => [row.contractor_id, { count: row.review_count, average: row.average_rating == null ? null : Number(row.average_rating) }]));
}

export function commentError(comment: string) {
  return comment.trim().length > REVIEW_COMMENT_MAX ? `Keep the review to ${REVIEW_COMMENT_MAX.toLocaleString("en-US")} characters.` : null;
}

// Server refusals worded for the person who can act on them.
export function reviewErrorMessage(error: { code?: string; message?: string } | null | undefined, fallback: string) {
  if (!error) return fallback;
  if (error.code === "40001") return error.message || "This review changed. Refresh to see the current version.";
  if (error.code === "42501") return "You don't have permission to change this review.";
  return error.message || fallback;
}
