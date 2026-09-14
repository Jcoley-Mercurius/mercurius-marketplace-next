// TRACE-072 presentation for the compliance expiry notice. The server decides which
// evidence is expiring or lapsed (30-day notice, owner decision 2026-09-13); this module
// only words it. Lapsed evidence is a flag: it suspends nothing.

export type RenewalState = "expiring" | "lapsed";

export type EvidenceKind =
  | "identity"
  | "agreement"
  | "coverage"
  | "license"
  | "insurance"
  | "bank_authorization"
  | "profile_pricing"
  | "availability"
  | "test_notification";

export const evidenceKindLabel: Record<EvidenceKind, string> = {
  identity: "Identity verification",
  agreement: "Marketplace agreement",
  coverage: "Services and coverage approval",
  license: "License",
  insurance: "Insurance",
  bank_authorization: "Payout onboarding",
  profile_pricing: "Profile and pricing review",
  availability: "Availability expectations",
  test_notification: "Test notification",
};

export function kindLabel(kind: string) {
  return evidenceKindLabel[kind as EvidenceKind] ?? kind;
}

const DAY = 86_400_000;

/**
 * Whole days between the server's evaluation time and the expiry. Expiring evidence
 * rounds up (anything left is at least "1 day"); lapsed evidence rounds down, so a
 * lapse under a day reads as "today".
 */
export function renewalDays(state: RenewalState, expiresAt: string, evaluatedAt: string) {
  const difference = new Date(expiresAt).getTime() - new Date(evaluatedAt).getTime();
  if (!Number.isFinite(difference)) return null;
  return state === "expiring"
    ? Math.max(1, Math.ceil(difference / DAY))
    : Math.max(0, Math.floor(-difference / DAY));
}

export function renewalTiming(state: RenewalState, expiresAt: string, evaluatedAt: string) {
  const days = renewalDays(state, expiresAt, evaluatedAt);
  if (days === null) return state === "expiring" ? "Expiring" : "Lapsed";
  const plural = days === 1 ? "day" : "days";
  if (state === "expiring") return `Expires in ${days} ${plural}`;
  return days === 0 ? "Lapsed today" : `Lapsed ${days} ${plural} ago`;
}

export function formatRenewalDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Unknown date"
    : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
