// TRACE-135 (Phase 6.12A) presentation for a provider's own compliance status. The server
// decides each item's state from recorded evidence (vendor_own_compliance_status); this module
// only words it and picks the next action. An upload is never verification, and an exception
// is documentation pending, never a verified license or insurance (DEC-2026-047).

import { kindLabel, type EvidenceKind } from "./evidenceRenewal";
import { renewalDocumentKindLabel, isRenewalDocumentKind } from "./renewalDocuments";

export type ComplianceItemState = "missing" | "current" | "expiring" | "expired" | "exception";

export type ComplianceItem = {
  kind: EvidenceKind;
  state: ComplianceItemState;
  exception: boolean;
  follow_up_due: string | null;
  expires_at: string | null;
  recorded_at: string | null;
  awaiting_review: number;
  last_submitted_at: string | null;
  declined: { at: string; note: string | null } | null;
};

export type ComplianceStatus = {
  evaluated_at: string;
  today: string;
  notice_days: number;
  provider_found: boolean;
  onboarding_status: string | null;
  checklist_current: boolean;
  matching_allowed: boolean;
  payout_onboarding_current: boolean;
  accepting_uploads: boolean;
  open_limit: number;
  items: ComplianceItem[];
};

export type NextAction =
  | { kind: "upload"; text: string }
  | { kind: "wait"; text: string }
  | { kind: "contact"; text: string }
  | { kind: "none"; text: string };

const EASTERN = "America/New_York";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar date as Mercurius's policies count it, in Eastern Time. A date-only value (an
 * exception's follow-up date) is that calendar date; a timestamp is converted to Eastern.
 */
export function formatEasternDate(value: string | null) {
  if (!value) return "";
  const parsed = DATE_ONLY.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-US", {
    timeZone: DATE_ONLY.test(value) ? "UTC" : EASTERN,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function complianceItemLabel(kind: string) {
  return isRenewalDocumentKind(kind) ? renewalDocumentKindLabel[kind] : kindLabel(kind);
}

export const complianceStateLabel: Record<ComplianceItemState, string> = {
  current: "Current",
  expiring: "Expiring soon",
  expired: "Expired",
  missing: "Missing",
  exception: "Exception: document pending",
};

/** What the item's state means, in one sentence, without claiming more than was recorded. */
export function complianceItemDetail(item: ComplianceItem) {
  const until = formatEasternDate(item.follow_up_due);
  const expires = formatEasternDate(item.expires_at);
  switch (item.state) {
    case "exception":
      return `Mercurius allowed a temporary exception while your document is pending. It is not a verified ${item.kind === "license" ? "license" : "insurance certificate"} and ends after ${until}.`;
    case "expired":
      return item.exception
        ? `The temporary exception ended after ${until}. No verified document is on file.`
        : `Expired ${expires}.`;
    case "expiring":
      return `Expires ${expires}.`;
    case "current":
      return item.expires_at ? `Recorded by Mercurius. Expires ${expires}.` : "Recorded by Mercurius.";
    case "missing":
      return "Not recorded for your current application.";
  }
}

/**
 * The provider's next step for one item. Only license and insurance documents can be uploaded in
 * the portal (TRACE-073); every other item is recorded by Mercurius, so the step is to contact
 * Mercurius. Bank details are never collected here.
 */
export function complianceNextAction(item: ComplianceItem, status: Pick<ComplianceStatus, "accepting_uploads" | "open_limit">): NextAction {
  const needsWork = item.state !== "current";
  if (!needsWork) return { kind: "none", text: "No action needed." };
  if (item.awaiting_review > 0) {
    return { kind: "wait", text: "Mercurius is reviewing the document you sent. Uploading is not verification; the item changes only when Mercurius records it." };
  }
  if (isRenewalDocumentKind(item.kind) && status.accepting_uploads) {
    const label = renewalDocumentKindLabel[item.kind].toLowerCase();
    if (item.state === "exception") {
      return { kind: "upload", text: `Upload your ${label} before the end of ${formatEasternDate(item.follow_up_due)}.` };
    }
    if (item.state === "expiring") return { kind: "upload", text: `Upload your renewed ${label} before it expires.` };
    return { kind: "upload", text: `Upload your current ${label} for review.` };
  }
  if (item.kind === "bank_authorization") {
    return { kind: "contact", text: "Contact Mercurius to renew payout onboarding. Do not send bank details by message or upload." };
  }
  return { kind: "contact", text: "Contact Mercurius about this item." };
}

/** Items that need the provider's attention first: expired, then missing, exception, expiring. */
export function complianceAttentionOrder(items: ComplianceItem[]) {
  const rank: Record<ComplianceItemState, number> = { expired: 0, missing: 1, exception: 2, expiring: 3, current: 4 };
  return [...items].sort((a, b) => rank[a.state] - rank[b.state]);
}

/** The effect of the checklist on new requests and payouts, as the server reported it. */
export function complianceEffects(status: ComplianceStatus) {
  if (!status.provider_found || status.onboarding_status === null) {
    return {
      matching: "Mercurius has not moved your account to the current onboarding checklist. Contact Mercurius before relying on this page.",
      payout: null,
    };
  }
  const matching = status.matching_allowed
    ? "Your checklist allows new job requests. Live offerings and coverage are also required."
    : status.onboarding_status === "active"
      ? "While a required item is missing or expired, Mercurius cannot send you new job requests."
      : `Your onboarding status is ${status.onboarding_status}, so Mercurius cannot send you new job requests.`;
  // Payout eligibility needs active onboarding as well as current payout onboarding.
  const payout = status.payout_onboarding_current
    ? null
    : status.onboarding_status !== "active"
      ? `Payouts are held while your onboarding status is ${status.onboarding_status}.`
      : "Payouts are held until your payout onboarding is current.";
  return { matching, payout };
}
