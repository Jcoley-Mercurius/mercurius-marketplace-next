export const VERIFIED_HOMEOWNER_LABEL = "Verified Homeowner";

/**
 * Converts an explicitly public reviewer name to a privacy-preserving label.
 * Private profile names must never be fetched solely for use with this helper.
 */
export function formatPublicReviewerName(value?: string | null) {
  if (!value) return VERIFIED_HOMEOWNER_LABEL;

  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 80 || /[@\d]/u.test(normalized)) return VERIFIED_HOMEOWNER_LABEL;

  const parts = normalized.split(" ").map(cleanNamePart).filter(Boolean);
  if (parts.length < 2) return VERIFIED_HOMEOWNER_LABEL;

  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  if (firstName.length < 2 || lastName.length < 1) return VERIFIED_HOMEOWNER_LABEL;

  const lastInitial = Array.from(lastName)[0]?.toLocaleUpperCase("en-US");
  return lastInitial ? `${firstName} ${lastInitial}.` : VERIFIED_HOMEOWNER_LABEL;
}

function cleanNamePart(value: string) {
  return value.replace(/[^\p{L}\p{M}'’-]/gu, "").slice(0, 40);
}
