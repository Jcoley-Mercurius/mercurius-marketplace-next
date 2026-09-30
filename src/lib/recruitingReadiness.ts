// TRACE-104 (R0.4): presentation of the operator recruiting readbacks and the vendor's
// own listing readback. The database decides every state; these only label it.

export type NotificationState =
  | "pending" | "sending" | "sent" | "failed" | "unknown" | "missed"
  | "resend_requested" | "acknowledged" | "untracked";

export type NotificationItem = {
  application_id: string;
  business_name: string;
  application_status: string;
  submitted_at: string;
  state: NotificationState;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  requested_at: string | null;
  acknowledged_at: string | null;
  acknowledged_reason: string | null;
  needs_attention: boolean;
};

export type InvitationReason = "uncertain" | "refused" | "expired_unaccepted" | "link_lapsed";

export type InvitationAttention = {
  attempt_id: string;
  contractor_id: string;
  application_id: string;
  business_name: string;
  attempt_status: string;
  dispatch_state: string | null;
  onboarding_status: string;
  created_at: string;
  expires_at: string;
  reason: InvitationReason;
};

export type ListingInventoryItem = {
  contractor_id: string;
  name: string;
  is_active: boolean | null;
  marketing_enabled: boolean | null;
  account_linked: boolean;
  onboarding_status: string | null;
  eligible: boolean;
  has_content: boolean;
  listable: boolean;
  excluded: boolean;
  exclusion_reason: string | null;
  excluded_at: string | null;
  test_signal: boolean;
  featured: boolean;
  request_count: number;
  invoice_count: number;
  review_count: number;
};

export type MyProviderListing =
  | { linked: false }
  | {
      linked: true;
      contractor_id: string;
      listed: boolean;
      active: boolean;
      accepting_work: boolean;
      approved: boolean;
      held: boolean;
      has_name: boolean;
      has_description: boolean;
      has_catalog_service: boolean;
      service_zips: string[];
    };

export const notificationStateLabel: Record<NotificationState, string> = {
  pending: "Waiting to send",
  sending: "Sending",
  sent: "Accepted by Resend",
  failed: "Failed",
  unknown: "Result unknown",
  missed: "Never sent",
  resend_requested: "Resend requested",
  acknowledged: "Acknowledged",
  untracked: "Not tracked",
};

// An unknown or untracked email may already be in the inbox; resending it needs an
// explicit operator confirmation, which the database also enforces.
export function notificationNeedsConfirmation(state: NotificationState) {
  return state === "unknown" || state === "untracked";
}

export const invitationReasonLabel: Record<InvitationReason, { title: string; help: string }> = {
  uncertain: {
    title: "Result unknown",
    help: "Auth did not confirm the invitation. Reconcile it with the exact account ID before anything else.",
  },
  refused: {
    title: "Refused",
    help: "Auth refused the invitation, usually because the address already has an account. Bind that account instead.",
  },
  expired_unaccepted: {
    title: "Expired",
    help: "The invitation expired without acceptance. Close it and prepare a new one if the provider still qualifies.",
  },
  link_lapsed: {
    title: "Email link lapsed",
    help: "Auth accepted the invitation over 3 hours ago and the email link has expired without acceptance. Revoke it and prepare a new one.",
  },
};

export function listingBlockers(item: ListingInventoryItem): string[] {
  const blockers: string[] = [];
  if (item.excluded) blockers.push("Hidden by an operator");
  if (!item.eligible && !item.excluded) blockers.push("Not approved and eligible");
  if (item.is_active !== true) blockers.push("Inactive");
  if (item.marketing_enabled === false) blockers.push("Not accepting work");
  if (!item.has_content) blockers.push("Missing name, description or a live catalog service");
  return blockers;
}

export type ListingStep = { id: string; done: boolean; label: string; href: string | null };

// The vendor's own preparation steps toward a truthful public listing.
export function listingSteps(listing: Extract<MyProviderListing, { linked: true }>): ListingStep[] {
  return [
    { id: "approved", done: listing.approved, label: "Mercurius approval and compliance review", href: "/vendor/compliance" },
    { id: "description", done: listing.has_name && listing.has_description, label: "Business name and description", href: "/vendor/profile" },
    { id: "services", done: listing.has_catalog_service, label: "At least one service from the Mercurius catalog", href: "/vendor/profile" },
    // Active status and public visibility are set by Mercurius operations, not the vendor.
    { id: "available", done: listing.active && listing.accepting_work, label: "Account active and visible (set by Mercurius)", href: null },
  ];
}
