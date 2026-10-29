import { formatAppointment } from "@/lib/offerStatus";
import { queueKindLabel, type QueueItem } from "@/lib/quoteProposals";
import type { AnchorEntry, CadencePreview, CadenceResolution, LifecycleEntry, PlanState } from "@/lib/recurringCadence";

// TRACE-123 (Phase 6.6): a recurring request accepted by a provider is the plan; each visit is a
// separate service with its own provider acceptance, work, evidence and payment. Operations adds a
// visit at an Eastern wall time; the server derives the visit identity from the plan and the
// Eastern date, records every attempt and refuses a visit the plan's terms no longer cover.

export type SeriesViewer = "admin" | "vendor" | "homeowner";
export type BlockCode =
  | "series_not_active" | "terms_missing" | "quote_terms" | "promotion_decision"
  | "homeowner_not_admitted" | "terms_changed" | "provider_ineligible" | "visit_date_taken"
  | "series_paused" | "series_ended";
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
  /** TRACE-125: the visit's own payment state; null for the provider. Operations also get `problem` and `exception`. */
  payment_state?: VisitPayment | null;
  /** Operations only (TRACE-124): on a cadence date of the current anchor, and the cadence date it replaces. */
  on_cadence?: boolean | null;
  replaces?: { cadence_date: string; anchor_id: string; current_anchor: boolean } | null;
};
export type PaymentProblem = { code: string; message: string; recovery: string };
export type VisitPayment = {
  state: "not_accepted" | "review_pending" | "ready" | "processing" | "paid" | "failed" | "unknown" | "cancelled";
  reason: "no_snapshot" | "snapshot_expired" | "held" | "source_blocked" | "partial_capture" | null;
  /** "pay" for a current, unpaid, payable snapshot; "continue" for this visit's own open checkout. */
  action: "pay" | "continue" | null;
  snapshot_id: string | null;
  amount_cents: number | null;
  accepted_at: string | null;
  attempt_status: string | null;
  problem?: PaymentProblem | null;
  exception?: { kind: string; since: string | null; due_at: string | null } | null;
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
  source?: "manual" | "cadence";
  cadence_date?: string | null;
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
  plan_state: PlanState;
  anchor: { starts_at: string; local_start: string } | null;
  // Operations only (TRACE-124).
  anchor_id?: string | null;
  cadence?: CadencePreview;
  anchors?: AnchorEntry[];
  lifecycle?: LifecycleEntry[];
  resolutions?: CadenceResolution[];
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

const cents = (value: number) => money(value / 100);

/**
 * TRACE-125 (DEC-2026-049 item 5): one line for the visit's payment, from its canonical
 * obligation, snapshot and checkout state. A browser return is never "Paid"; only a recorded
 * capture is. The provider sees no payment.
 */
export function visitPaymentLine(payment: VisitPayment | null | undefined, role: SeriesViewer) {
  if (!payment || role === "vendor") return null;
  const amount = payment.amount_cents === null ? "" : ` · ${cents(payment.amount_cents)}`;
  switch (payment.state) {
    case "not_accepted": return null;
    case "cancelled": return null;
    case "review_pending":
      if (role === "homeowner") return `Payment opens after Mercurius reviews this visit’s price${amount}`;
      if (payment.reason === "snapshot_expired") return `Reviewed price expired · needs a new commercial review${amount}`;
      if (payment.reason === "held") return "Payment held (dispute or refund) · finance must resolve it before any review";
      if (payment.reason === "source_blocked") return `Terms blocked · resolve the exception below before review${amount}`;
      return `Waiting for commercial review${amount}`;
    case "ready": return `Ready to pay${amount}`;
    case "processing": return role === "homeowner" ? `Payment in progress${amount}` : `Checkout open · not paid yet${amount}`;
    case "paid": return `Paid${amount}`;
    case "failed": return role === "homeowner" ? `The last payment didn’t go through. You can try again${amount}` : `Payment failed · homeowner can retry${amount}`;
    case "unknown": return role === "homeowner" ? "Mercurius is confirming this payment. Don’t pay again." : "Payment outcome unknown · reconcile before anything else";
  }
}

/** The homeowner's link into the existing reviewed checkout for this visit's current snapshot. */
export function visitCheckoutHref(payment: VisitPayment | null | undefined) {
  if (!payment?.snapshot_id || !payment.action) return null;
  return `/checkout/${payment.snapshot_id}?mode=full`;
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
    case "series_paused": return "The plan is paused, so no visit was added. Resume the plan first.";
    case "series_ended": return "Future visits for this plan were stopped, so no visit was added.";
    case "provider_ineligible": return "The plan’s provider can’t take this visit right now (coverage, status or eligibility). No visit was added and no other provider was offered it.";
    default: return "No visit was added.";
  }
}

export function historyLine(entry: SeriesHistoryEntry) {
  const when = formatAppointment(entry.starts_at);
  if (entry.outcome === "created") return entry.source === "cadence" ? `Proposed visit added: ${when}` : `Visit added: ${when}`;
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

/** TRACE-125: the recurring payment queue (admin_recurring_payment_queue). */
export type RecurringPaymentQueueItem = QueueItem & {
  series_id: string;
  obligation_id: string | null;
  /** review_missing only: why the review is missing. */
  reason?: VisitPayment["reason"];
  detail: {
    starts_at?: string; state?: VisitPayment["state"]; reason?: VisitPayment["reason"]; snapshot_id?: string | null;
    amount_cents?: number | null; attempt_status?: string | null; problem?: PaymentProblem | null;
  };
};

/** Failure and unknown outcomes keep the shared G6 wording; the two visit states are added. */
export function recurringQueueLabel(item: Pick<RecurringPaymentQueueItem, "kind" | "detail"> & { reason?: VisitPayment["reason"] }) {
  if (item.kind === "review_missing") {
    switch (item.reason ?? item.detail.reason) {
      case "snapshot_expired": return { title: "Visit price review expired",
        action: "The reviewed price expired unpaid. Two finance operators review and publish it again at the accepted plan price." };
      case "held": return { title: "Visit payment held",
        action: "A dispute or refund holds this visit's obligation. Finance resolves it first; no new checkout is offered." };
      case "source_blocked": return { title: "Visit terms blocked",
        action: "The visit can't be reviewed or paid until the exception below is resolved. Nothing is substituted or repriced." };
      default: return { title: "Visit needs commercial review",
        action: "Accepted by the provider and unpaid. Two finance operators review and publish its price; nothing is published automatically." };
    }
  }
  if (item.kind === "ready_unpaid") {
    return {
      title: "Visit ready but unpaid",
      action: item.detail.state === "processing"
        ? "The homeowner has a checkout open. Nothing is charged or cancelled automatically."
        : "The homeowner can pay through the reviewed checkout. Contact them if needed; nothing is charged or cancelled automatically.",
    };
  }
  return queueKindLabel[item.kind] ?? { title: item.kind, action: "" };
}
