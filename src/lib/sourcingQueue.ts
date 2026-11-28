// Phase 7.5G-2 (TRACE-159): the sourcing queue's response, labels and wording. The server reader
// public.admin_sourcing_queue() (20261206001000) decides membership, kind, related event, order and
// both flags; this module only checks the shape and words it. Plan:
// governance/PHASE-7-SOURCING-QUEUE-PLAN-7-5G-2.md §4, §5, §8.
//
// Wording rules (SG-2, SG-8, OD-6): the time shown is the latest related stored event, named by its
// basis. It is never presented as when the request entered the queue, when matching was exhausted,
// a bound on either, or an age. `awaiting_consent` means a candidate exists, so nothing says or
// implies that no provider is available. No deadline, due time or aged count exists.

/** OD-4a, approved by the owner 2026-11-27 ET (DEC-2026-070). Admin pages only. */
export const SOURCING_NAME = "Sourcing";
export const SOURCING_DESCRIPTION =
  "Requests awaiting a provider or fallback consent. No sourcing deadline is set. Counts reflect stored matching state.";

export const SOURCING_KINDS = ["exhausted", "awaiting_consent", "legacy_sourcing"] as const;
export type SourcingKind = (typeof SOURCING_KINDS)[number];

export const RELATED_EVENTS = ["provider_operation", "offer_closed", "request_created"] as const;
export type RelatedEvent = (typeof RELATED_EVENTS)[number];

/** Operator labels (plan §4; implementation proposals, not owner wording). */
export const KIND_LABEL: Record<SourcingKind, string> = {
  exhausted: "No provider accepted",
  awaiting_consent: "Awaiting fallback consent",
  legacy_sourcing: "Legacy sourcing",
};

/** Plan §5: each label names the stored event the time comes from. */
export const RELATED_EVENT_LABEL: Record<RelatedEvent, string> = {
  provider_operation: "Provider cancel or no-show recorded",
  offer_closed: "Offer last closed",
  request_created: "Request created",
};

export const RELATED_EVENT_HEADING = "Latest related event";
export const PLAN_VISIT_LABEL = "Plan visit: plan's provider only";
export const OFFER_TERMS_CROSS_REFERENCE = "Also in Offers at other terms";
export const EMPTY_TEXT = "No requests in this queue.";
export const ORDER_TEXT = "Listed by latest related event, earliest first. The time is the stored event named beside it.";
export const READ_ONLY_TEXT = "This page only reads. It makes no offer, assignment or other change, and it does not settle expired offers.";

export type SourcingItem = {
  requestId: string;
  kind: SourcingKind;
  relatedEventAt: string;
  relatedEvent: RelatedEvent;
  planVisit: boolean;
  offerTermsBlock: boolean;
};

export type SourcingQueue = { checkedAt: string; items: SourcingItem[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isTime = (value: unknown): value is string => typeof value === "string" && value.trim() !== "" && !Number.isNaN(Date.parse(value));
const isKind = (value: unknown): value is SourcingKind => typeof value === "string" && (SOURCING_KINDS as readonly string[]).includes(value);
const isEvent = (value: unknown): value is RelatedEvent => typeof value === "string" && (RELATED_EVENTS as readonly string[]).includes(value);

/**
 * The reader's answer, or null when any part of it is not the shape the server returns: an unknown
 * kind or related event, a malformed item, or a missing time. A whole answer is refused rather than
 * dropping items, so the page never shows fewer items than the overview counts for the same read.
 */
export function parseSourcingQueue(value: unknown): SourcingQueue | null {
  if (!isObject(value) || !isTime(value.checked_at) || !Array.isArray(value.items)) return null;
  const items: SourcingItem[] = [];
  for (const raw of value.items) {
    if (!isObject(raw)) return null;
    const { request_id: requestId, kind, related_event_at: relatedEventAt, related_event: relatedEvent,
      plan_visit: planVisit, offer_terms_block: offerTermsBlock } = raw;
    if (typeof requestId !== "string" || !UUID.test(requestId)) return null;
    if (!isKind(kind) || !isEvent(relatedEvent) || !isTime(relatedEventAt)) return null;
    if (typeof planVisit !== "boolean" || typeof offerTermsBlock !== "boolean") return null;
    items.push({ requestId, kind, relatedEventAt, relatedEvent, planVisit, offerTermsBlock });
  }
  return { checkedAt: value.checked_at, items };
}

/** Eastern time, as the other operations pages show it. */
export function formatEasternTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(date)} Eastern`;
}

/** "Offer last closed · Nov 27, 2026, 9:00 AM Eastern": the event's basis, then its stored time. */
export function relatedEventText(item: Pick<SourcingItem, "relatedEvent" | "relatedEventAt">) {
  return `${RELATED_EVENT_LABEL[item.relatedEvent]} · ${formatEasternTime(item.relatedEventAt)}`;
}

/** Per-item markers, in a fixed order. */
export function itemNotes(item: Pick<SourcingItem, "planVisit" | "offerTermsBlock">) {
  return [item.planVisit ? PLAN_VISIT_LABEL : null, item.offerTermsBlock ? OFFER_TERMS_CROSS_REFERENCE : null].filter((note): note is string => note !== null);
}

export type RpcError = { code: string; message: string };

export function readError(error: unknown): RpcError {
  const record = isObject(error) ? error : {};
  const message = typeof record.message === "string" && record.message.trim() ? record.message.trim() : "No answer was received";
  const code = typeof record.code === "string" || typeof record.code === "number" ? String(record.code).trim() : "";
  return { code, message };
}
