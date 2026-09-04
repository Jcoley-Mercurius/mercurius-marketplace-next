export type VerifiedStripeEvent = {
  id: string; type: string; livemode: boolean;
  data: { object: Record<string, unknown> };
};
export type NormalizedEvent = { id: string; type: string; payload: Record<string, string | number> };
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 255) throw new Error("INVALID_EVENT_REFERENCE");
  return value;
}
function amount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error("INVALID_EVENT_AMOUNT");
  return value;
}
function id(value: unknown): string {
  return text(typeof value === "object" && value ? (value as Record<string, unknown>).id : value);
}
/** Only call AFTER SDK signature verification on the unmodified body. Never store card/customer payloads. */
export function normalizeMoneyEvent(event: VerifiedStripeEvent): NormalizedEvent {
  const object = event.data.object;
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  const base = { id: text(event.id) };
  if (event.type === 'checkout.session.expired') {
    if (object.status !== 'expired' || object.mode !== 'payment') throw new Error('INVALID_CHECKOUT_EXPIRY');
    return { ...base, type: 'checkout_expired', payload: { attempt_id: text(metadata.money_attempt_id), session_id: id(object.id) } };
  }
  if (event.type === "payment_intent.succeeded") {
    if (object.status !== "succeeded" || object.currency !== "usd") throw new Error("INVALID_CAPTURE");
    return { ...base, type: "capture", payload: { attempt_id: text(metadata.money_attempt_id), payment_id: id(object.id), amount: amount(object.amount_received), currency: "usd" } };
  }
  if (event.type === "refund.updated" || event.type === "refund.created") {
    if (object.status !== "succeeded") return { ...base, type: "observation", payload: { object_id: id(object.id), source_type: event.type, status: text(object.status) } };
    if (object.currency !== "usd") throw new Error("INVALID_REFUND_CURRENCY");
    return { ...base, type: "refund", payload: { authorization_id: text(metadata.money_authorization_id), refund_id: id(object.id), payment_id: id(object.payment_intent), amount: amount(object.amount), currency: "usd" } };
  }
  if (event.type === "charge.dispute.created" || event.type === "charge.dispute.closed") {
    if (object.currency !== "usd") throw new Error("INVALID_DISPUTE_CURRENCY");
    const state = event.type === "charge.dispute.created" ? "open" : text(object.status);
    if (!["open", "won", "lost"].includes(state)) throw new Error("UNSUPPORTED_DISPUTE_STATE");
    return { ...base, type: "dispute", payload: { dispute_id: id(object.id), payment_id: id(object.payment_intent), amount: amount(object.amount), currency: "usd", state } };
  }
  // Retain unknowns for review; do not mutate paid/job state on delayed failure or subscription events.
  return { ...base, type: "observation", payload: { object_id: id(object.id), source_type: event.type } };
}
export interface WebhookStore {
  receive(event: NormalizedEvent): Promise<void>;
  process(eventId: string): Promise<string>;
}
export async function acceptMoneyEvent(event: NormalizedEvent, store: WebhookStore): Promise<void> {
  await store.receive(event); // commit first; processing failure never deletes receipt
  const status = await store.process(event.id);
  if (status !== "processed" && status !== "reviewed_no_effect") throw new Error("WEBHOOK_RETRY_REQUIRED");
}
