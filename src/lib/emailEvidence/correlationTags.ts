// TRACE-155 (Phase 7.3C-1): opt-in correlation tags for ledgered sends (plan §7.1, EC-5).
//
// A send attempt carries exactly three opaque tags: the ledger, the ledger row key and the
// attempt number. They are a pure function of (ledger, row, attempt), and each attempt has its
// own Idempotency-Key, so a key is never reused with a different body. Values are validated
// opaque IDs only; nothing about the recipient or content is ever placed in a tag. The receiver
// (resendWebhook.ts `correlationTags`) parses the same three names and formats.

export const CORRELATION_LEDGERS = ["application", "owner_email", "package_draft"] as const;
export type CorrelationLedger = (typeof CORRELATION_LEDGERS)[number];

export type CorrelationTag = { name: "mm_ledger" | "mm_ref" | "mm_attempt"; value: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ATTEMPT = 10_000;

/** The tag set for one attempt, or null when any part is invalid (the caller sends untagged). */
export function buildCorrelationTags(ledger: unknown, ref: unknown, attempt: unknown): CorrelationTag[] | null {
  if (typeof ledger !== "string" || !(CORRELATION_LEDGERS as readonly string[]).includes(ledger)) return null;
  if (typeof ref !== "string" || !UUID.test(ref)) return null;
  if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 1 || attempt > MAX_ATTEMPT) return null;
  return [
    { name: "mm_ledger", value: ledger },
    { name: "mm_ref", value: ref },
    { name: "mm_attempt", value: String(attempt) },
  ];
}

/**
 * A validated copy of a tag set for the request body, or null. Accepts only exactly the three
 * names, once each, with values that rebuild to the same set; anything else is dropped whole.
 */
export function validCorrelationTags(tags: unknown): CorrelationTag[] | null {
  if (!Array.isArray(tags) || tags.length !== 3) return null;
  const values = new Map<string, unknown>();
  for (const tag of tags) {
    if (typeof tag !== "object" || tag === null) return null;
    const { name, value } = tag as { name?: unknown; value?: unknown };
    if (typeof name !== "string" || typeof value !== "string" || values.has(name)) return null;
    values.set(name, value);
  }
  const attempt = values.get("mm_attempt");
  if (typeof attempt !== "string" || !/^[1-9][0-9]{0,4}$/.test(attempt)) return null;
  const rebuilt = buildCorrelationTags(values.get("mm_ledger"), values.get("mm_ref"), Number(attempt));
  return rebuilt && rebuilt.every((tag) => values.get(tag.name) === tag.value) ? rebuilt : null;
}
