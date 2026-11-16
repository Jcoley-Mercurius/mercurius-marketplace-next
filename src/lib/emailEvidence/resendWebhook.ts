import "server-only";

import { Webhook, WebhookVerificationError } from "svix";
import type { OperationalErrorCode, OperationalLogInput } from "@/lib/observability/operationalLog";
import { classifyOperationalError } from "@/lib/observability/operationalLog";

// TRACE-155 (Phase 7.3B): the dormant, authenticated Resend webhook receiver.
// Plan: governance/PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md §6 (request handling), §7 (identity,
// resolved in the database) and §11 (minimization). Record: PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3B.md.
//
// Order, each step final on rejection: method → configuration gate (no secret: 503, nothing
// read) → bounded headers → advisory Content-Length → bounded byte read (cancelled at
// overflow) → fatal, BOM-preserving UTF-8 decode with an exact re-encode check → the pinned
// svix verifier on that exact string → JSON parse → allowlisted normalization → one
// service-role RPC. No 2xx is sent before the receipt (or its conflict flag) has committed, and
// no verification exception ever becomes a receipt or a 2xx. A receipt changes no ledger,
// sends nothing and suppresses nothing.

export const RESEND_WEBHOOK_MAX_BYTES = 65_536;

const SVIX_ID = /^[!-~]{1,128}$/;
const SVIX_TIMESTAMP = /^[0-9]{1,12}$/;
const SIGNATURE_HEADER = /^[!-~ ]{1,1024}$/;
const MAX_SIGNATURE_ENTRIES = 8;
const MAX_SIGNATURE_ENTRY_BYTES = 128;
// A Resend endpoint secret: the whsec_ prefix and a base64 key (constructor check below).
const SECRET_FORMAT = /^whsec_[A-Za-z0-9+/]{16,}={0,2}$/;
const SIGNATURE_MISMATCH = "No matching signature found";

const EVENT_TYPES = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
] as const;
type EventType = (typeof EVENT_TYPES)[number] | "other";

const PROVIDER_TYPE = /^[a-z_.]{1,64}$/;
const PROVIDER_EMAIL_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ATTEMPT = /^[1-9][0-9]{0,4}$/;
const TAG_LEDGERS = ["application", "owner_email", "package_draft"] as const;
const TAG_KEYS = ["mm_attempt", "mm_ledger", "mm_ref"] as const;

const BOUNCE_TYPES: Record<string, string> = {
  permanent: "permanent",
  transient: "transient",
  temporary: "transient",
  undetermined: "undetermined",
};
const BOUNCE_SUBTYPES: Record<string, string> = {
  general: "general",
  noemail: "no_email",
  mailboxfull: "mailbox_full",
  messagetoolarge: "message_too_large",
  contentrejected: "content_rejected",
  attachmentrejected: "attachment_rejected",
  suppressed: "suppressed",
  onaccountsuppressionlist: "suppressed",
  messagerejected: "message_rejected",
  undetermined: "undetermined",
};

/** The service-role RPC arguments, named exactly as `public.email_receive_provider_event`. */
export type ReceiveParams = {
  p_svix_id: string;
  p_secret_slot: "current" | "previous";
  p_processing: "recorded" | "invalid_payload";
  p_event_type: EventType;
  p_provider_type: string | null;
  p_provider_created_at: string | null;
  p_provider_email_id: string | null;
  p_bounce_type: string | null;
  p_bounce_subtype: string | null;
  p_tag_status: "absent" | "valid" | "invalid";
  p_tag_ledger: string | null;
  p_tag_ref: string | null;
  p_tag_attempt: number | null;
};

export type ReceiveResult = "recorded" | "duplicate" | "conflict";

export type WebhookVerifier = { verify(payload: string, headers: Record<string, string>): unknown };
export type TextDecoderLike = { decode(input: Uint8Array): string };
export type WebhookRequest = Pick<Request, "method" | "headers" | "body">;

export type ResendWebhookDeps = {
  secrets: () => { current?: string; previous?: string };
  createVerifier: (secret: string) => WebhookVerifier;
  createDecoder: () => TextDecoderLike;
  receive: (params: ReceiveParams) => Promise<unknown>;
  log: (input: OperationalLogInput) => void;
  correlationId: () => string;
  now: () => number;
};

/** The production verifier: the exact-pinned official svix library (plan §4.3). */
export function createSvixVerifier(secret: string): WebhookVerifier {
  if (!SECRET_FORMAT.test(secret)) {
    throw new Error("Environment configuration error: the Resend webhook secret is malformed.");
  }
  return new Webhook(secret);
}

/**
 * Fatal, BOM-preserving UTF-8 (plan §6.2 step 6, C1). The default TextDecoder consumes a
 * leading BOM, which would hand the verifier a string one character shorter than the signed
 * bytes; `ignoreBOM: true` keeps it as U+FEFF.
 */
export function createExactDecoder(): TextDecoderLike {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
}

function respond(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}

export function methodNotAllowed() {
  return respond(405, { error: "method_not_allowed" }, { allow: "POST" });
}

type HeaderCheck = { id: string; timestamp: string; signature: string } | null;

function boundedHeaders(headers: Headers): HeaderCheck {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (id === null || timestamp === null || signature === null) return null;
  if (!SVIX_ID.test(id) || !SVIX_TIMESTAMP.test(timestamp) || !SIGNATURE_HEADER.test(signature)) return null;
  const entries = signature.split(" ");
  if (entries.length > MAX_SIGNATURE_ENTRIES) return null;
  if (entries.some((entry) => entry.length === 0 || entry.length > MAX_SIGNATURE_ENTRY_BYTES)) return null;
  return { id, timestamp, signature };
}

function declaredTooLarge(headers: Headers): boolean {
  const value = headers.get("content-length");
  if (value === null || !/^[0-9]{1,20}$/.test(value)) return false; // advisory only; invalid is ignored
  return Number(value) > RESEND_WEBHOOK_MAX_BYTES;
}

type BodyRead = { kind: "ok"; bytes: Uint8Array } | { kind: "too_large" };

/** Reads at most RESEND_WEBHOOK_MAX_BYTES bytes, counting bytes, and cancels on overflow. */
export async function readBoundedBody(body: ReadableStream<Uint8Array> | null, max = RESEND_WEBHOOK_MAX_BYTES): Promise<BodyRead> {
  if (body === null) return { kind: "ok", bytes: new Uint8Array(0) };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try {
        await reader.cancel();
      } catch {
        // The stream is abandoned either way.
      }
      return { kind: "too_large" };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", bytes };
}

type Decoded = { kind: "ok"; text: string } | { kind: "invalid_encoding" } | { kind: "mismatch" };

/** Decodes the whole buffer and proves the string re-encodes to exactly the received bytes. */
export function decodeExact(bytes: Uint8Array, decoder: TextDecoderLike): Decoded {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return { kind: "invalid_encoding" };
  }
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength !== bytes.byteLength) return { kind: "mismatch" };
  for (let i = 0; i < bytes.byteLength; i++) {
    if (encoded[i] !== bytes[i]) return { kind: "mismatch" };
  }
  return { kind: "ok", text };
}

type Verified = { kind: "ok"; slot: "current" | "previous" } | { kind: "rejected" } | { kind: "error" };

function isMismatch(error: unknown) {
  return error instanceof WebhookVerificationError && error.message === SIGNATURE_MISMATCH;
}

/**
 * The current secret first. The previous secret is tried only when the current verifier
 * reported a signature mismatch, so a missing-header or timestamp failure is final and the
 * previous secret never widens the verifier's fixed ±300 s freshness check.
 */
function verifyWithRotation(
  verifiers: { current: WebhookVerifier; previous?: WebhookVerifier },
  text: string,
  headers: Record<string, string>,
): Verified {
  try {
    verifiers.current.verify(text, headers);
    return { kind: "ok", slot: "current" };
  } catch (error) {
    if (!(error instanceof WebhookVerificationError)) return { kind: "error" };
    if (!isMismatch(error) || !verifiers.previous) return { kind: "rejected" };
  }
  try {
    verifiers.previous.verify(text, headers);
    return { kind: "ok", slot: "previous" };
  } catch (error) {
    return error instanceof WebhookVerificationError ? { kind: "rejected" } : { kind: "error" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerTime(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function tagEntries(tags: unknown): Array<[string, unknown]> {
  if (Array.isArray(tags)) {
    return tags.flatMap((tag): Array<[string, unknown]> =>
      isRecord(tag) && typeof tag.name === "string" ? [[tag.name, tag.value]] : [],
    );
  }
  return isRecord(tags) ? Object.entries(tags) : [];
}

type Tags = Pick<ReceiveParams, "p_tag_status" | "p_tag_ledger" | "p_tag_ref" | "p_tag_attempt">;
const NO_TAGS: Tags = { p_tag_status: "absent", p_tag_ledger: null, p_tag_ref: null, p_tag_attempt: null };
const INVALID_TAGS: Tags = { ...NO_TAGS, p_tag_status: "invalid" };

/**
 * The three mm_* correlation tags (plan §7.1). Any mm_* tag makes the set present; it is
 * valid only as exactly mm_ledger, mm_ref and mm_attempt, once each and well formed. Every
 * other tag is ignored and never stored.
 */
export function correlationTags(tags: unknown): Tags {
  const mm = tagEntries(tags).filter(([name]) => name.startsWith("mm_"));
  if (mm.length === 0) return NO_TAGS;
  const names = mm.map(([name]) => name).sort();
  if (names.length !== TAG_KEYS.length || names.some((name, i) => name !== TAG_KEYS[i])) return INVALID_TAGS;
  const values = Object.fromEntries(mm) as Record<(typeof TAG_KEYS)[number], unknown>;
  const { mm_ledger: ledger, mm_ref: ref, mm_attempt: attempt } = values;
  if (
    typeof ledger !== "string" || !(TAG_LEDGERS as readonly string[]).includes(ledger) ||
    typeof ref !== "string" || !UUID.test(ref) ||
    typeof attempt !== "string" || !ATTEMPT.test(attempt) || Number(attempt) > 10_000
  ) {
    return INVALID_TAGS;
  }
  return { p_tag_status: "valid", p_tag_ledger: ledger, p_tag_ref: ref, p_tag_attempt: Number(attempt) };
}

function bounceValue(value: unknown, map: Record<string, string>): string | null {
  if (typeof value !== "string") return null;
  return map[value.toLowerCase().replace(/[^a-z]/g, "")] ?? "other";
}

/**
 * Parses an authenticated body. Returns null for a verified-malformed payload: not JSON, not
 * an object, or without a valid `type`. Only allowlisted fields are kept (plan §11.1).
 */
export function normalizeResendEvent(text: string): Omit<ReceiveParams, "p_svix_id" | "p_secret_slot"> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string" || !PROVIDER_TYPE.test(parsed.type)) return null;
  const type = parsed.type;
  const eventType: EventType = (EVENT_TYPES as readonly string[]).includes(type) ? (type as EventType) : "other";
  const base = {
    p_processing: "recorded" as const,
    p_event_type: eventType,
    p_provider_type: type,
    p_provider_created_at: providerTime(parsed.created_at),
    p_provider_email_id: null,
    p_bounce_type: null,
    p_bounce_subtype: null,
    ...NO_TAGS,
  };
  if (eventType === "other") return base;
  const data = isRecord(parsed.data) ? parsed.data : {};
  const emailId = typeof data.email_id === "string" && PROVIDER_EMAIL_ID.test(data.email_id) ? data.email_id : null;
  const bounce = eventType === "email.bounced" && isRecord(data.bounce) ? data.bounce : null;
  return {
    ...base,
    p_provider_email_id: emailId,
    p_bounce_type: bounce ? bounceValue(bounce.type, BOUNCE_TYPES) : null,
    p_bounce_subtype: bounce ? bounceValue(bounce.subType, BOUNCE_SUBTYPES) : null,
    ...correlationTags(data.tags),
  };
}

const INVALID_PAYLOAD: Omit<ReceiveParams, "p_svix_id" | "p_secret_slot"> = {
  p_processing: "invalid_payload",
  p_event_type: "other",
  p_provider_type: null,
  p_provider_created_at: null,
  p_provider_email_id: null,
  p_bounce_type: null,
  p_bounce_subtype: null,
  ...NO_TAGS,
};

function receiveResult(value: unknown): ReceiveResult | null {
  const result = isRecord(value) ? value.result : null;
  return result === "recorded" || result === "duplicate" || result === "conflict" ? result : null;
}

const UNAVAILABLE: OperationalErrorCode[] = ["db_unavailable", "network_error", "config_missing"];

export async function handleResendWebhook(request: WebhookRequest, deps: ResendWebhookDeps): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed();
  const startedAt = deps.now();
  const trace = { route: "resend_webhook" as const, correlationId: deps.correlationId() };
  const log = (input: Omit<OperationalLogInput, "route" | "correlationId" | "durationMs">) => {
    try {
      deps.log({ ...trace, ...input, durationMs: deps.now() - startedAt });
    } catch {
      // Logging is best effort and never changes the response.
    }
  };
  const refuse = (status: number, errorCode: OperationalErrorCode, error: string) => {
    log({ event: "email_webhook.refused", outcome: "refused", errorCode });
    return respond(status, { error });
  };
  const fail = (status: number, errorCode: OperationalErrorCode) => {
    log({ event: "email_webhook.failed", outcome: "failed", errorCode });
    return respond(status, { error: status === 503 ? "unavailable" : "server_error" });
  };

  // 2. Configuration gate: dormant without the current secret. Nothing is read.
  let verifiers: { current: WebhookVerifier; previous?: WebhookVerifier };
  try {
    const secrets = deps.secrets();
    if (!secrets.current) return refuse(503, "config_missing", "not_configured");
    verifiers = {
      current: deps.createVerifier(secrets.current),
      previous: secrets.previous ? deps.createVerifier(secrets.previous) : undefined,
    };
  } catch {
    return refuse(503, "config_missing", "not_configured");
  }

  // 3. Header bounds, before any body read.
  const headers = boundedHeaders(request.headers);
  if (!headers) return refuse(400, "webhook_headers_invalid", "invalid_request");

  // 4–5. Advisory Content-Length, then a counted byte read that cancels at the ceiling.
  if (declaredTooLarge(request.headers)) return refuse(413, "webhook_payload_too_large", "payload_too_large");
  let read: BodyRead;
  try {
    read = await readBoundedBody(request.body);
  } catch {
    return refuse(400, "request_unreadable", "invalid_request");
  }
  if (read.kind === "too_large") return refuse(413, "webhook_payload_too_large", "payload_too_large");

  // 6. Exact decode: nothing is normalized before or after verification.
  let decoded: Decoded;
  try {
    decoded = decodeExact(read.bytes, deps.createDecoder());
  } catch {
    return fail(500, "unexpected");
  }
  if (decoded.kind === "invalid_encoding") {
    return refuse(400, "webhook_payload_invalid_encoding", "invalid_request");
  }
  if (decoded.kind === "mismatch") return fail(500, "unexpected");

  // 7. Authenticate the exact string. Only a normal return continues.
  const verified = verifyWithRotation(
    verifiers,
    decoded.text,
    { "svix-id": headers.id, "svix-timestamp": headers.timestamp, "svix-signature": headers.signature },
  );
  if (verified.kind === "rejected") return refuse(400, "webhook_signature_invalid", "invalid_signature");
  if (verified.kind === "error") return fail(500, "unexpected");

  // 9–10. Parse and normalize only after authentication.
  const normalized = normalizeResendEvent(decoded.text);
  const params: ReceiveParams = {
    p_svix_id: headers.id,
    p_secret_slot: verified.slot,
    ...(normalized ?? INVALID_PAYLOAD),
  };

  // 11–13. One transaction; a 2xx only after it committed.
  let result: ReceiveResult | null;
  try {
    result = receiveResult(await deps.receive(params));
  } catch (error) {
    const code = classifyOperationalError(error);
    return fail(UNAVAILABLE.includes(code) ? 503 : 500, code);
  }
  if (!result) return fail(500, "unexpected");
  if (!normalized) {
    log({ event: "email_webhook.rejected", outcome: result, errorCode: "webhook_payload_invalid" });
  } else {
    log({ event: `email_webhook.${result}`, outcome: result });
  }
  return respond(200, { received: true });
}
