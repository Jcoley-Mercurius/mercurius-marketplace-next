// DEC-2026-058 (approved by DEC-2026-060 D-7): "Top Rated" reads like a verified rating with no
// objective criterion behind it, so it is shown nowhere and not offered in the badge editor until
// criteria are approved. Stored values and badge history are kept; admin_set_provider_badges still
// accepts the value, so saving other badges never strips a stored "Top Rated".
export const HIDDEN_PROVIDER_BADGES = ["top rated"] as const;

export function isHiddenProviderBadge(badge: string) {
  return (HIDDEN_PROVIDER_BADGES as readonly string[]).includes(badge.trim().toLowerCase());
}

/** The badges a provider surface may display, in stored order. */
export function displayedProviderBadges(badges: readonly string[] | null | undefined) {
  return (badges ?? []).filter((badge) => badge.trim() && !isHiddenProviderBadge(badge));
}
