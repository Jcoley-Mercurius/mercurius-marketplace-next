// TRACE-116 (DEC-2026-042): the homeowner chooses an offer. The server lists eligible offers,
// computes every saving and reserves the choice; this module parses what it returns, words
// its reasons for homeowners and shapes the choice sent back. Nothing here applies an offer
// on its own: no default, no automatic switch to a better one.

export type PromotionOption = {
  offerId: string;
  fingerprint: string;
  label: string;
  terms: string;
  endsAt: string | null;
  timezone: string;
  firstBookingOnly: boolean;
  requiresCode: boolean;
  serviceCents: number;
  discountCents: number;
  totalAfterCents: number;
  /** The greatest saving among several different savings; a label only, never a selection. */
  best: boolean;
};

export type CodeResult =
  | { status: "eligible"; offerId: string }
  | { status: "ineligible"; reason: string | null }
  | { status: "not_found" | "too_many_attempts" | "not_applicable" };

export type SelectionOffers = {
  selectionIndex: number;
  serviceId: string;
  priced: boolean;
  serviceCents: number | null;
  options: PromotionOption[];
  code: CodeResult | null;
};

export type PromotionOptionsResult = {
  available: boolean;
  selections: SelectionOffers[];
};

/** What the homeowner chose for one service, as shown to them. */
export type PromotionChoice = {
  offerId: string;
  fingerprint: string;
  code: string | null;
  label: string;
  discountCents: number;
  serviceCents: number;
  firstBookingOnly: boolean;
};

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const text = (value: unknown) => (typeof value === "string" ? value : null);

export function parseOption(value: unknown): PromotionOption | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const serviceCents = num(item.service_cents);
  const discountCents = num(item.discount_cents);
  const totalAfterCents = num(item.total_after_cents);
  if (typeof item.offer_id !== "string" || typeof item.fingerprint !== "string" || typeof item.label !== "string"
    || serviceCents === null || discountCents === null || totalAfterCents === null
    || discountCents <= 0 || totalAfterCents !== serviceCents - discountCents) return null;
  return {
    offerId: item.offer_id, fingerprint: item.fingerprint, label: item.label, terms: text(item.terms) ?? "",
    endsAt: text(item.ends_at), timezone: text(item.timezone) ?? "America/New_York",
    firstBookingOnly: item.first_booking_only === true, requiresCode: item.requires_code === true,
    serviceCents, discountCents, totalAfterCents, best: item.best === true,
  };
}

export function parseOptions(value: unknown): PromotionOption[] {
  return Array.isArray(value) ? value.flatMap((row) => { const option = parseOption(row); return option ? [option] : []; }) : [];
}

function parseCode(value: unknown): CodeResult | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.status === "eligible" && typeof item.offer_id === "string") return { status: "eligible", offerId: item.offer_id };
  if (item.status === "ineligible") return { status: "ineligible", reason: text(item.reason) };
  if (item.status === "not_found" || item.status === "too_many_attempts" || item.status === "not_applicable") return { status: item.status };
  return null;
}

/** An unrecognized response is a verification error, never "no offers". */
export function parsePromotionOptions(value: unknown): PromotionOptionsResult {
  const result = value as { available?: unknown; selections?: unknown } | null;
  if (!result || typeof result.available !== "boolean" || !Array.isArray(result.selections)) {
    throw new Error("The offers service returned an unexpected response.");
  }
  return {
    available: result.available,
    selections: result.selections.flatMap((row) => {
      const item = row as Record<string, unknown> | null;
      if (!item || typeof item.service_id !== "string" || !Number.isInteger(item.selection_index)) return [];
      return [{
        selectionIndex: item.selection_index as number, serviceId: item.service_id, priced: item.status === "priced",
        serviceCents: num(item.service_cents), options: parseOptions(item.options), code: parseCode(item.code),
      }];
    }),
  };
}

export type RequestPromotionState = {
  available: boolean;
  /** False while promotions are closed: an offer can be removed, not applied. */
  offersOpen: boolean;
  state: "applied" | "needs_homeowner" | "declined" | null;
  reason: string | null;
  serviceCents: number | null;
  confirmedServiceCents: number | null;
  editable: boolean;
  lockedReason: string | null;
  applied: {
    offerId: string; label: string; terms: string; endsAt: string | null; serviceCents: number; discountCents: number;
    totalAfterCents: number; committed: boolean; problem: string | null;
  } | null;
  options: PromotionOption[];
  code: CodeResult | null;
};

export function parseRequestPromotion(value: unknown): RequestPromotionState {
  const item = value as Record<string, unknown> | null;
  if (!item || typeof item.available !== "boolean") throw new Error("The offers service returned an unexpected response.");
  const applied = item.applied as Record<string, unknown> | null | undefined;
  const state = item.state === "applied" || item.state === "needs_homeowner" || item.state === "declined" ? item.state : null;
  return {
    available: item.available, offersOpen: item.offers_open !== false, state, reason: text(item.reason),
    serviceCents: num(item.service_cents), confirmedServiceCents: num(item.confirmed_service_cents),
    editable: item.editable === true, lockedReason: text(item.locked_reason),
    applied: applied && typeof applied.offer_id === "string" && typeof applied.label === "string"
      && num(applied.service_cents) !== null && num(applied.discount_cents) !== null && num(applied.total_after_cents) !== null
      ? {
        offerId: applied.offer_id, label: applied.label, terms: text(applied.terms) ?? "", endsAt: text(applied.ends_at),
        serviceCents: num(applied.service_cents)!, discountCents: num(applied.discount_cents)!, totalAfterCents: num(applied.total_after_cents)!,
        committed: applied.committed === true, problem: text(applied.problem),
      } : null,
    options: parseOptions(item.options),
    code: parseCode(item.code),
  };
}

const reasons: Record<string, string> = {
  offer_not_approved: "this offer isn’t available any more",
  offer_revision_not_approved: "this offer’s terms changed",
  offer_changed: "this offer’s terms changed",
  offer_unavailable: "this offer isn’t available any more",
  not_started: "this offer hasn’t started yet",
  expired: "this offer has ended",
  provider_not_confirmed: "this offer needs a specific provider’s price",
  other_provider: "this offer is for another provider",
  package_not_included: "this offer doesn’t cover this package",
  service_not_included: "this offer doesn’t cover this service",
  area_not_included: "this offer doesn’t cover your area",
  no_exact_service_amount: "this offer needs an exact price",
  below_minimum_spend: "the service total is below this offer’s minimum",
  code_required: "this offer needs its promotion code",
  not_first_booking: "this offer is for a first booking only",
  first_booking_already_reserved: "a first-booking offer is already applied to another request",
  promotion_already_applied: "another offer is already applied",
  discount_exceeds_service: "this offer can’t apply to this total",
  redemption_limit_reached: "this offer has been fully claimed",
  budget_exhausted: "this offer has been fully claimed",
  discount_changed: "the saving changed",
  price_changed: "the price changed",
  offers_paused: "offers are paused",
};

/** A homeowner-facing reason, e.g. "this offer has ended"; never an internal code. */
export function promotionReason(reason: string | null | undefined) {
  return (reason && reasons[reason]) || "this offer can’t be applied";
}

export function codeMessage(code: CodeResult | null): string | null {
  if (!code) return null;
  switch (code.status) {
    case "eligible": return null;
    case "ineligible": return `That code is valid, but ${promotionReason(code.reason)}.`;
    case "not_found": return "We couldn’t find that code. Check it and try again.";
    case "too_many_attempts": return "Too many codes were tried. Try again in an hour.";
    case "not_applicable": return "Codes apply to services with an exact price.";
  }
}

/** Keeps a choice only while the server still offers the same offer, revision and saving. */
export function reconcileChoice(choice: PromotionChoice, offers: SelectionOffers | undefined):
  { choice: PromotionChoice | null; notice: string | null } {
  const option = offers?.options.find((item) => item.offerId === choice.offerId);
  if (!option) return { choice: null, notice: `“${choice.label}” no longer applies to this service. Choose again.` };
  if (option.fingerprint !== choice.fingerprint || option.discountCents !== choice.discountCents || option.serviceCents !== choice.serviceCents) {
    return { choice: null, notice: `“${choice.label}” changed: it now saves ${centsLabel(option.discountCents)} on ${centsLabel(option.serviceCents)}. Choose again.` };
  }
  return { choice, notice: null };
}

export function choiceFromOption(option: PromotionOption, code: string | null): PromotionChoice {
  return { offerId: option.offerId, fingerprint: option.fingerprint, code: option.requiresCode ? code : null, label: option.label,
    discountCents: option.discountCents, serviceCents: option.serviceCents, firstBookingOnly: option.firstBookingOnly };
}

/** The submission's per-selection promotion; the server compares it with what it computes. */
export function promotionPayload(choice: PromotionChoice | undefined) {
  if (!choice) return undefined;
  return { offer_id: choice.offerId, fingerprint: choice.fingerprint, expected_discount_cents: choice.discountCents,
    ...(choice.code ? { code: choice.code } : {}) };
}

export function centsLabel(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

export function offerEndsLabel(endsAt: string | null, timeZone = "America/New_York") {
  if (!endsAt || !Number.isFinite(Date.parse(endsAt))) return null;
  // dateStyle/timeStyle cannot be combined with timeZoneName, so the fields are explicit.
  return `Ends ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZone, timeZoneName: "short" }).format(new Date(endsAt))}`;
}
