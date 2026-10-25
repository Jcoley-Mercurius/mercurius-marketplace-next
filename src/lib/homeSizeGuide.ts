import type { PackageQualifyingQuestion } from "@/lib/vendorPricing";

// TRACE-122 (DEC-2026-047 item 2): the bedroom-to-size guide is shown once on a provider's
// profile instead of in every package description. Wording from the onboarding review.
// Whether it applies, and what it says sets the price, comes from the price levels' rule
// conditions, not from which questions a package asks: a bedroom question alone sets no price.

export const HOME_SIZE_GUIDE: ReadonlyArray<{ bedrooms: string; squareFeet: string }> = [
  { bedrooms: "1 bedroom", squareFeet: "about 600–900 sq ft" },
  { bedrooms: "2 bedrooms", squareFeet: "about 900–1,300 sq ft" },
  { bedrooms: "3 bedrooms", squareFeet: "about 1,300–1,800 sq ft" },
  { bedrooms: "4 bedrooms", squareFeet: "about 1,800–2,500 sq ft" },
  { bedrooms: "5+ bedrooms", squareFeet: "about 2,500–3,500 sq ft" },
];

type GuideQuestion = Pick<PackageQualifyingQuestion, "question_key" | "question_label" | "input_type" | "unit">;
type GuideTier = { rule_question_key?: string | null; rule_conditions?: unknown };
export type GuidePackage = { questions: ReadonlyArray<GuideQuestion>; tiers: ReadonlyArray<GuideTier> };

export const BEDROOMS_FACTOR = "the number of bedrooms";
const SQUARE_FEET_FACTOR = "square footage";

/** Question keys a package's price levels are conditioned on, as the server reads them. */
function conditionKeys(tiers: ReadonlyArray<GuideTier>) {
  const keys = new Set<string>();
  for (const tier of tiers) {
    if (typeof tier.rule_question_key === "string" && tier.rule_question_key.trim()) keys.add(tier.rule_question_key.trim());
    if (Array.isArray(tier.rule_conditions)) {
      for (const condition of tier.rule_conditions) {
        const key = (condition as { question_key?: unknown } | null)?.question_key;
        if (typeof key === "string" && key.trim()) keys.add(key.trim());
      }
    }
  }
  return keys;
}

function factorFor(key: string, question: GuideQuestion | undefined) {
  const text = [key, question?.unit ?? "", question?.question_label ?? ""].join(" ");
  if (question?.input_type === "number" && /bedroom/i.test(text)) return BEDROOMS_FACTOR;
  if (/sq\.?\s*ft|sqft|square\s*f(ee|oo)t/i.test(text)) return SQUARE_FEET_FACTOR;
  const label = question?.question_label.trim().replace(/[?:]+$/, "");
  return label ? label.charAt(0).toLowerCase() + label.slice(1) : "other details you answer";
}

/** What a package's prices are set by: one entry per answer its price levels depend on. */
export function pricingFactors(item: GuidePackage): string[] {
  return [...new Set([...conditionKeys(item.tiers)].map((key) =>
    factorFor(key, item.questions.find((question) => question.question_key === key))))];
}

function joinFactors(factors: readonly string[]) {
  return factors.length <= 1 ? factors.join("") : `${factors.slice(0, -1).join(", ")} and ${factors[factors.length - 1]}`;
}

/**
 * The size guide's wording for a profile's live fixed packages, or null when no package's price
 * levels depend on the number of bedrooms (then the guide is not shown).
 */
export function homeSizeGuideText(packages: ReadonlyArray<GuidePackage>): { summary: string; note: string | null } | null {
  const byBedrooms = packages.map(pricingFactors).filter((factors) => factors.includes(BEDROOMS_FACTOR));
  if (!byBedrooms.length) return null;
  const others = [...new Set(byBedrooms.flatMap((factors) => factors.filter((factor) => factor !== BEDROOMS_FACTOR)))];
  const summary = !others.length
    ? "Prices are set by the number of bedrooms."
    : byBedrooms.every((factors) => factors.length > 1)
      ? `Prices depend on ${joinFactors([BEDROOMS_FACTOR, ...others])}.`
      : `Prices are set by the number of bedrooms; some also depend on ${joinFactors(others)}.`;
  const note = others.includes(SQUARE_FEET_FACTOR)
    ? "Sizes below are a rough guide only; your square footage is asked separately and is not taken from the bedroom count."
    : null;
  return { summary, note };
}
