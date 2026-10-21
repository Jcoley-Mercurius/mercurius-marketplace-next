import { frequencyLabel } from "@/lib/packagePriceCorrections";
import { isPricingFrequency, type PricingFrequency } from "@/lib/vendorPricing";

// TRACE-112/113: a package content document (the shape drafts and live packages share) and
// the result of the server's price calculation, private.price_selection. The server
// validates content (pricing_normalize_content) and owns every amount; this module shapes
// editor input, parses what comes back and words price meaning one way everywhere.

export type PricingMode = "fixed" | "custom_quote" | "deposit_quote";
export type PriceKind = "exact" | "starting_at" | "range";
export type AddonPriceKind = "exact" | "range";

export type ContentQuestion = {
  question_key: string;
  question_label: string;
  input_type: "number" | "select" | "text";
  unit?: string | null;
  options?: string[] | null;
  is_required: boolean;
};

export type ContentCondition = { question_key: string; min?: number | null; max?: number | null };

export type ContentTier = {
  id: string;
  name: string;
  frequency: PricingFrequency;
  price_kind: PriceKind;
  price: number;
  price_max?: number | null;
  conditions: ContentCondition[];
  includes: string[];
};

export type ContentAddon = {
  id: string;
  name: string;
  description?: string | null;
  price_kind: AddonPriceKind;
  price: number;
  price_max?: number | null;
  unit_label?: string | null;
  min_quantity: number;
  max_quantity: number;
  is_required: boolean;
  frequencies: PricingFrequency[];
};

export type PackageContent = {
  name: string;
  description?: string | null;
  pricing_mode: PricingMode;
  deposit_amount?: number | null;
  included_scope: string[];
  policy_notes?: string | null;
  questions: ContentQuestion[];
  tiers: ContentTier[];
  addons: ContentAddon[];
};

export type PriceStatus = "exact" | "estimate" | "quote" | "unresolved" | "invalid";

export type PricedLine = {
  kind: "tier" | "addon";
  id: string | null;
  name: string | null;
  unitLabel: string | null;
  priceKind: string;
  quantity: number;
  amountCents: number;
  amountMaxCents: number | null;
  required: boolean;
};

export type PriceResult = {
  status: PriceStatus;
  reason: string | null;
  tierName: string | null;
  lines: PricedLine[];
  totalCents: number | null;
  minCents: number | null;
  maxCents: number | null;
  depositCents: number | null;
  includedScope: string[];
  /** Answers that prevented an exact price (DEC-2026-041 item 7). */
  blocking: BlockingAnswers | null;
};

export type BlockingAnswers = {
  answers: Array<{ questionKey: string; questionLabel: string; answer: string | null }>;
  /** Each answer fits some level, but no level fits them all. */
  combination: boolean;
};

export const PRICING_MODES: { value: PricingMode; label: string; help: string }[] = [
  { value: "fixed", label: "Fixed price", help: "An exact price the homeowner can book." },
  { value: "custom_quote", label: "Quote required", help: "An estimate (starting at or a range), or no amount until a walkthrough." },
  { value: "deposit_quote", label: "Quote with deposit", help: "As quote required, with a deposit toward the final price." },
];

export const PRICE_KINDS: { value: PriceKind; label: string }[] = [
  { value: "exact", label: "Exact price" },
  { value: "starting_at", label: "Starting at" },
  { value: "range", label: "Range" },
];

const usd = (cents: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2,
}).format(cents / 100);

/** Dollars (as entered or stored) to whole cents, or null. */
export function toCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function formatCents(cents: number) {
  return usd(cents);
}

/** How a price level reads wherever it is shown. */
export function priceKindLabel(kind: PriceKind | null | undefined, price: number, priceMax?: number | null): string {
  const low = toCents(price) ?? 0;
  if (kind === "starting_at") return `From ${usd(low)}`;
  if (kind === "range" && priceMax != null) return `${usd(low)}–${usd(toCents(priceMax) ?? 0)} estimate`;
  return usd(low);
}

export function addonPriceLabel(addon: Pick<ContentAddon, "price_kind" | "price" | "price_max" | "unit_label">): string {
  const low = toCents(addon.price) ?? 0;
  const amount = addon.price_kind === "range" && addon.price_max != null
    ? `${usd(low)}–${usd(toCents(addon.price_max) ?? 0)}` : usd(low);
  return addon.unit_label ? `+${amount} per ${addon.unit_label}` : `+${amount}`;
}

/** A package with no estimate tiers on a quote mode is quote after walkthrough. */
export function walkthroughLabel(mode: PricingMode) {
  return mode === "deposit_quote" ? "Quote after walkthrough, deposit applies" : "Quote after walkthrough";
}

/** One sentence for a calculation result; never presents an estimate as payable. */
export function priceResultLabel(result: PriceResult): string {
  switch (result.status) {
    case "exact": return result.totalCents != null ? `${usd(result.totalCents)} total` : "Price unavailable";
    case "estimate":
      if (result.minCents == null) return "Estimate unavailable";
      return result.maxCents == null
        ? `Estimate from ${usd(result.minCents)}; the provider confirms the final price`
        : `Estimate ${usd(result.minCents)}–${usd(result.maxCents)}; the provider confirms the final price`;
    case "quote": return "Quote after walkthrough; no price is shown until then";
    case "unresolved": return unresolvedReason(result.reason, result.blocking);
    default: return invalidReason(result.reason);
  }
}

export function unresolvedReason(reason: string | null, blocking: BlockingAnswers | null = null) {
  if (reason === "answers_needed") return "Answer the questions to see a price";
  if (reason === "ambiguous_price_levels") return "Price requires confirmation: more than one price level matches these answers";
  if (reason === "no_matching_price_level") {
    const detail = blockingDetail(blocking);
    return detail ? `Price requires confirmation: ${detail}` : "Price requires confirmation: no price level matches these answers";
  }
  return "No exact price for this selection";
}

/** Which answers kept the selection from an exact price, in words. Never names a price. */
export function blockingDetail(blocking: BlockingAnswers | null): string | null {
  if (!blocking || blocking.answers.length === 0) return null;
  const parts = blocking.answers.map((item) => item.answer ? `${item.questionLabel} ${item.answer}` : `${item.questionLabel} (not answered)`);
  if (blocking.combination) return `no single price level covers ${joinWords(parts, "with")}`;
  return `no price level covers ${joinWords(parts, "or")}`;
}

function joinWords(parts: string[], word: string) {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} ${word} ${parts[parts.length - 1]}`;
}

export function parseBlocking(value: unknown): BlockingAnswers | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (!Array.isArray(item.answers)) return null;
  const answers = item.answers.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const a = entry as Record<string, unknown>;
    if (typeof a.question_key !== "string") return [];
    return [{ questionKey: a.question_key, questionLabel: typeof a.question_label === "string" ? a.question_label : a.question_key,
      answer: typeof a.answer === "string" && a.answer.trim() ? a.answer : null }];
  });
  return { answers, combination: item.combination === true };
}

export function invalidReason(reason: string | null) {
  switch (reason) {
    case "addon_not_offered": return "An add-on is not offered for this cadence";
    case "addon_quantity": return "An add-on quantity is outside what is allowed";
    case "duplicate_addon": return "An add-on is listed twice";
    case "addon_included_in_package": return "An add-on charges for something already included";
    case "tier_not_applicable": return "The chosen price level does not match the answers";
    case "tier_not_offered": return "The chosen price level is not offered";
    case "no_price_for_cadence": return "No price for this cadence";
    default: return "This selection cannot be priced";
  }
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parsePriceResult(value: unknown): PriceResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const statuses: PriceStatus[] = ["exact", "estimate", "quote", "unresolved", "invalid"];
  if (!statuses.includes(item.status as PriceStatus)) return null;
  const lines = Array.isArray(item.lines) ? item.lines.flatMap((entry): PricedLine[] => {
    if (!entry || typeof entry !== "object") return [];
    const line = entry as Record<string, unknown>;
    const amount = asNumber(line.amount_cents);
    if ((line.kind !== "tier" && line.kind !== "addon") || amount === null) return [];
    return [{
      kind: line.kind, id: typeof line.id === "string" ? line.id : null, name: typeof line.name === "string" ? line.name : null,
      unitLabel: typeof line.unit_label === "string" ? line.unit_label : null, priceKind: String(line.price_kind ?? "exact"),
      quantity: asNumber(line.quantity) ?? 1, amountCents: amount, amountMaxCents: asNumber(line.amount_max_cents),
      required: line.required === true,
    }];
  }) : [];
  return {
    status: item.status as PriceStatus,
    reason: typeof item.reason === "string" ? item.reason : null,
    tierName: typeof item.tier_name === "string" ? item.tier_name : null,
    lines,
    totalCents: asNumber(item.total_cents),
    minCents: asNumber(item.min_cents),
    maxCents: asNumber(item.max_cents),
    depositCents: asNumber(item.deposit_cents),
    includedScope: Array.isArray(item.included_scope) ? item.included_scope.filter((entry): entry is string => typeof entry === "string") : [],
    blocking: parseBlocking(item.blocking),
  };
}

export function lineAmountLabel(line: PricedLine) {
  if (line.amountMaxCents != null && line.amountMaxCents !== line.amountCents) return `${usd(line.amountCents)}–${usd(line.amountMaxCents)}`;
  if (line.amountMaxCents == null && line.priceKind !== "exact") return `from ${usd(line.amountCents)}`;
  return usd(line.amountCents);
}

export function lineLabel(line: PricedLine) {
  if (line.kind === "tier") return line.name ?? "Price level to be confirmed";
  const quantity = line.quantity > 1 || line.unitLabel ? ` × ${line.quantity}${line.unitLabel ? ` ${line.unitLabel}` : ""}` : "";
  return `${line.name ?? "Add-on"}${quantity}${line.required ? " (required)" : ""}`;
}

/** Short client ids for new levels and add-ons; the server checks uniqueness. */
export function newContentId(prefix: "level" | "addon", existing: readonly string[]) {
  for (let n = existing.length + 1; ; n += 1) {
    const id = `${prefix}-${n}`;
    if (!existing.includes(id)) return id;
  }
}

export function emptyContent(name = ""): PackageContent {
  return { name, description: null, pricing_mode: "fixed", deposit_amount: null, included_scope: [], policy_notes: null,
    questions: [], tiers: [], addons: [] };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Reads a content document from the server; unknown values fall back safely. */
export function parseContent(value: unknown): PackageContent | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.name !== "string") return null;
  const mode: PricingMode = item.pricing_mode === "custom_quote" || item.pricing_mode === "deposit_quote" ? item.pricing_mode : "fixed";
  const questions = Array.isArray(item.questions) ? item.questions.flatMap((entry): ContentQuestion[] => {
    if (!entry || typeof entry !== "object") return [];
    const q = entry as Record<string, unknown>;
    if (typeof q.question_key !== "string" || typeof q.question_label !== "string") return [];
    const type = q.input_type === "select" || q.input_type === "text" ? q.input_type : "number";
    return [{ question_key: q.question_key, question_label: q.question_label, input_type: type,
      unit: typeof q.unit === "string" ? q.unit : null, options: Array.isArray(q.options) ? stringList(q.options) : null,
      is_required: q.is_required !== false }];
  }) : [];
  const tiers = Array.isArray(item.tiers) ? item.tiers.flatMap((entry): ContentTier[] => {
    if (!entry || typeof entry !== "object") return [];
    const t = entry as Record<string, unknown>;
    const price = asNumber(t.price);
    if (typeof t.id !== "string" || typeof t.name !== "string" || !isPricingFrequency(t.frequency) || price === null) return [];
    const kind: PriceKind = t.price_kind === "starting_at" || t.price_kind === "range" ? t.price_kind : "exact";
    // A live tier's legacy single rule comes first, as the server reads it (pricing_tier_conditions).
    const legacy: ContentCondition[] = typeof t.rule_question_key === "string" && t.rule_question_key.trim()
      ? [{ question_key: t.rule_question_key, min: asNumber(t.rule_min), max: asNumber(t.rule_max) }] : [];
    const conditions = legacy.concat(Array.isArray(t.conditions) ? t.conditions.flatMap((c): ContentCondition[] => {
      if (!c || typeof c !== "object" || typeof (c as Record<string, unknown>).question_key !== "string") return [];
      const condition = c as Record<string, unknown>;
      return [{ question_key: condition.question_key as string, min: asNumber(condition.min), max: asNumber(condition.max) }];
    }) : []);
    return [{ id: t.id, name: t.name, frequency: t.frequency, price_kind: kind, price, price_max: asNumber(t.price_max),
      conditions, includes: stringList(t.includes) }];
  }) : [];
  const addons = Array.isArray(item.addons) ? item.addons.flatMap((entry): ContentAddon[] => {
    if (!entry || typeof entry !== "object") return [];
    const a = entry as Record<string, unknown>;
    const price = asNumber(a.price);
    if (typeof a.id !== "string" || typeof a.name !== "string" || price === null) return [];
    return [{ id: a.id, name: a.name, description: typeof a.description === "string" ? a.description : null,
      price_kind: a.price_kind === "range" ? "range" : "exact", price, price_max: asNumber(a.price_max),
      unit_label: typeof a.unit_label === "string" ? a.unit_label : null,
      min_quantity: asNumber(a.min_quantity) ?? 0, max_quantity: asNumber(a.max_quantity) ?? 1,
      is_required: a.is_required === true, frequencies: stringList(a.frequencies).filter(isPricingFrequency) }];
  }) : [];
  return { name: item.name, description: typeof item.description === "string" ? item.description : null, pricing_mode: mode,
    deposit_amount: asNumber(item.deposit_amount), included_scope: stringList(item.included_scope),
    policy_notes: typeof item.policy_notes === "string" ? item.policy_notes : null, questions, tiers, addons };
}

/** A draft with one exact price per cadence and nothing else fits the simple price editor. */
export function isSimpleContent(content: PackageContent) {
  const cadences = content.tiers.map((tier) => tier.frequency);
  return content.pricing_mode === "fixed" && !content.questions.length && !content.addons.length && !content.included_scope.length
    && !content.policy_notes && new Set(cadences).size === cadences.length
    && content.tiers.every((tier) => tier.price_kind === "exact" && !tier.conditions.length && !tier.includes.length
      && tier.name === frequencyLabel(tier.frequency));
}

/** A one-line description of a level's rule, e.g. "Square feet 0–1,500". */
export function conditionsLabel(conditions: readonly ContentCondition[], questions: readonly ContentQuestion[]) {
  const number = new Intl.NumberFormat("en-US");
  return conditions.map((condition) => {
    const label = questions.find((q) => q.question_key === condition.question_key)?.question_label ?? condition.question_key;
    if (condition.min != null && condition.max != null) return `${label} ${number.format(condition.min)}–${number.format(condition.max)}`;
    if (condition.min != null) return `${label} ${number.format(condition.min)} or more`;
    return `${label} up to ${number.format(condition.max ?? 0)}`;
  }).join(", ");
}
