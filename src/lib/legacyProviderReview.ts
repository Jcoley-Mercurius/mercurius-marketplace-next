// DEC-2026-027 (TRACE-105): what r0_legacy_review_status reads back, and why a listed
// legacy provider cannot start review yet. The server enforces the same refusals.
export type LegacyReviewStatus = {
  listed: boolean;
  started?: boolean;
  onboarding?: boolean;
  contact?: boolean;
  excluded?: boolean;
  live_attempt?: boolean;
  open_application?: boolean;
};

export function legacyReviewOffered(status: LegacyReviewStatus | null): status is LegacyReviewStatus {
  return Boolean(status?.listed && !status.started && !status.onboarding);
}

export function legacyReviewBlocker(status: LegacyReviewStatus): string | null {
  if (status.excluded) return "This provider is excluded from public listing.";
  if (!status.contact) return "Record the provider's confirmed contact first.";
  if (status.live_attempt) return "Close the live access invitation first.";
  if (status.open_application) return "This provider has an open application; start review from it in Vendor Applications.";
  return null;
}
