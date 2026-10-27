import { formatAppointment } from "@/lib/offerStatus";

// TRACE-123 (Phase 6.6): a recurring request accepted by a provider is the plan; each visit is a
// separate service with its own provider acceptance, work, evidence and payment. Operations adds a
// visit at an Eastern wall time; the server derives the visit identity from the plan and the
// Eastern date, records every attempt and refuses a visit the plan's terms no longer cover.

export type SeriesViewer = "admin" | "vendor" | "homeowner";
export type BlockCode =
  | "series_not_active" | "terms_missing" | "quote_terms" | "promotion_decision"
  | "homeowner_not_admitted" | "terms_changed" | "provider_ineligible" | "visit_date_taken";
export type SeriesVisit = {
  id: string;
  visit_key: string;
  starts_at: string;
  local_start: string;
  status: string;
  matching_status: string | null;
  offer: string | null;
  plan_provider: boolean;
  provider_completed_at: string | null;
  homeowner_confirmed_at: string | null;
  payment: "none" | "awaiting_payment" | "paid" | null;
};
export type SeriesHistoryEntry = {
  id: string;
  at: string;
  outcome: "created" | "existing" | "blocked";
  code: BlockCode | null;
  starts_at: string;
  local_start: string;
  occurrence_id: string | null;
  actor: "operations";
  reason: string;
  operation_key: string | null;
};
export type SeriesReadback = {
  series_id: string;
  timezone: string;
  frequency: string;
  status: string;
  has_provider: boolean;
  terms: {
    provider: string | null;
    package: string | null;
    price_level: string | null;
    pricing_mode: string;
    frequency: string;
    visit_price: number | null;
    visit_total: number | null;
    has_addons: boolean;
    accepted_at: string;
  } | null;
  visits: SeriesVisit[];
  history: SeriesHistoryEntry[];
};
export type CreateResult = { outcome: SeriesHistoryEntry["outcome"]; code: BlockCode | null; occurrence_id: string | null; starts_at: string };

const cadence: Record<string, string> = {
  weekly: "Weekly", "bi-monthly": "Every two weeks", monthly: "Monthly", "every-two-months": "Every two months", quarterly: "Quarterly",
};
export const cadenceLabel = (frequency: string) => cadence[frequency] ?? frequency;

/** A recurring request that is the plan itself, not one of its visits. */
export function isRecurringPlan(request: { frequency?: string | null; recurrence_parent_id?: string | null }) {
  return Boolean(request.frequency && request.frequency !== "one-time" && !request.recurrence_parent_id);
}

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export function termsLine(terms: NonNullable<SeriesReadback["terms"]>) {
  const price = terms.pricing_mode === "fixed" && terms.visit_total !== null
    ? `${money(Number(terms.visit_total))} a visit${terms.has_addons ? ", including add-ons" : ""}`
    : "Quoted";
  return [cadenceLabel(terms.frequency), price, terms.provider].filter(Boolean).join(" · ");
}

/** One line for each visit's own state; acceptance and work are never inferred from the plan. */
export function visitState(visit: SeriesVisit) {
  if (visit.status === "cancelled") return "Cancelled";
  if (visit.homeowner_confirmed_at) return "Completed and confirmed by the homeowner";
  if (visit.provider_completed_at) return "Completed by the provider · waiting for the homeowner to confirm";
  if (visit.status === "in_progress") return "In progress";
  if (visit.status === "scheduled") return "Provider accepted this visit";
  if (visit.matching_status === "offered" && visit.offer === "pending") return "Waiting for the provider to accept this visit";
  if (visit.matching_status === "awaiting_consent" || visit.matching_status === "exhausted") return "Provider didn’t accept · Mercurius is reviewing";
  return visit.status.replaceAll("_", " ");
}

export function paymentLabel(payment: SeriesVisit["payment"]) {
  if (payment === "paid") return "Paid";
  if (payment === "awaiting_payment") return "Payment requested";
  if (payment === "none") return "Not invoiced";
  return null;
}

export function blockMessage(code: BlockCode | null) {
  switch (code) {
    case "visit_date_taken": return "This plan already has a visit on that date. Each Eastern Time date can hold one visit; change or cancel the existing visit instead.";
    case "series_not_active": return "The plan isn’t active with an accepted provider, so no visit was added.";
    case "terms_missing": return "No accepted plan terms are on record, so no visit was added. The plan needs a provider to accept it again.";
    case "quote_terms": return "This plan is priced by quote. Visits for quoted plans aren’t set up yet, so no visit was added.";
    case "promotion_decision": return "This plan has a promotion. How a promotion applies to each visit hasn’t been decided, so no visit was added.";
    case "homeowner_not_admitted": return "The homeowner’s access for this service and ZIP has ended, so no visit was added.";
    case "terms_changed": return "The provider’s price, package or the property changed since the plan was accepted. No visit was added and no other price or provider was used.";
    case "provider_ineligible": return "The plan’s provider can’t take this visit right now (coverage, status or eligibility). No visit was added and no other provider was offered it.";
    default: return "No visit was added.";
  }
}

export function historyLine(entry: SeriesHistoryEntry) {
  const when = formatAppointment(entry.starts_at);
  if (entry.outcome === "created") return `Visit added: ${when}`;
  if (entry.outcome === "existing") return `Already added: ${when}; nothing new was created`;
  return `Not added: ${when}`;
}

/** A lost response counts as recorded when the readback holds this caller's operation key. */
export function recordedAttempt(series: SeriesReadback | null, operationKey: string) {
  return series?.history.find(entry => entry.operation_key === operationKey) ?? null;
}

export function seriesErrorMessage(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (message.includes("future")) return "Choose a time in the future.";
  if (message.includes("does not match the Eastern Time")) return "The time couldn’t be read as Eastern Time. Re-enter the date and time.";
  if (message.includes("reused with different intent")) return "This attempt conflicts with an earlier one. Review the latest visits and try again.";
  if (message.includes("Recurring plan required")) return "This service isn’t a recurring plan.";
  if (code === "42501" || message.includes("Admin access") || message.includes("Not a participant")) return "You don’t have permission to do this.";
  return "We couldn’t confirm whether the visit was added. The latest visits are shown; check them before trying again.";
}
