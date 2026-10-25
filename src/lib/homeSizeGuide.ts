import type { PackageQualifyingQuestion } from "@/lib/vendorPricing";

// TRACE-122 (DEC-2026-047 item 2): the bedroom-to-size guide is shown once on a provider's
// profile instead of in every package description. Wording from the onboarding review.

export const HOME_SIZE_GUIDE: ReadonlyArray<{ bedrooms: string; squareFeet: string }> = [
  { bedrooms: "1 bedroom", squareFeet: "about 600–900 sq ft" },
  { bedrooms: "2 bedrooms", squareFeet: "about 900–1,300 sq ft" },
  { bedrooms: "3 bedrooms", squareFeet: "about 1,300–1,800 sq ft" },
  { bedrooms: "4 bedrooms", squareFeet: "about 1,800–2,500 sq ft" },
  { bedrooms: "5+ bedrooms", squareFeet: "about 2,500–3,500 sq ft" },
];

/** Whether a package's price is set by a number-of-bedrooms answer. */
export function pricedByBedrooms(questions: ReadonlyArray<Pick<PackageQualifyingQuestion, "question_key" | "input_type" | "unit">>) {
  return questions.some((question) => question.input_type === "number"
    && (/bedroom/i.test(question.unit ?? "") || /bedroom/i.test(question.question_key)));
}
