import "server-only";

import { randomUUID } from "node:crypto";

// TRACE-151 (Phase 7.1): PII-safe structured operational log lines with correlation IDs.
//
// Every line is built field by field from the allowlist below; nothing a caller passes is
// spread or serialized as-is. Errors are reduced to an enumerated code and their message,
// stack and other properties are never written. Logging is best effort: a failing sink or
// an unexpected input can lose a line but never throws into the caller.
//
// The correlation ID ties the lines of one route request together (including its
// post-response work). It is transport metadata only: it is never accepted from a request,
// never used for authorization, and never derived from a claim or provider idempotency key.

export const OPERATIONAL_LOG_SCHEMA = "mercurius.oplog.v1";
// TRACE-154 (Phase 7.2C-1, Codex C-5): owner-email events add `source_kind` and `source_id`.
// The schema version is fixed per event name below, never chosen by the caller: a v1 event
// always has exactly the 14 v1 keys, and a v2 event can never be written as v1.
export const OPERATIONAL_LOG_SCHEMA_V2 = "mercurius.oplog.v2";

const EVENTS = [
  "application_submission.saved",
  "application_submission.refused",
  "application_submission.failed",
  "application_submission.upload_url_failed",
  "application_notification.claimed",
  "application_notification.not_claimed",
  "application_notification.claim_failed",
  "application_notification.provider_result",
  "application_notification.recorded",
  "application_notification.record_failed",
  "application_notification.background_failed",
  "application_notification_resend.requested",
  "application_notification_resend.refused",
  "application_notification_resend.completed",
  "application_notification_resend.failed",
] as const;

const EVENTS_V2 = [
  "contact_submission.saved",
  "contact_submission.refused",
  "contact_submission.failed",
  // TRACE-154 (Phase 7.2C-2): provider renewal-document submissions.
  "renewal_document_submission.saved",
  "renewal_document_submission.failed",
  "owner_email.claimed",
  "owner_email.not_claimed",
  "owner_email.claim_failed",
  "owner_email.provider_result",
  "owner_email.recorded",
  "owner_email.record_failed",
  "owner_email.background_failed",
  "owner_email_resend.requested",
  "owner_email_resend.refused",
  "owner_email_resend.completed",
  "owner_email_resend.failed",
] as const;
export type OperationalEventV1 = (typeof EVENTS)[number];
export type OperationalEventV2 = (typeof EVENTS_V2)[number];
export type OperationalEvent = OperationalEventV1 | OperationalEventV2;

const ROUTES = [
  "vendor_application_submit",
  "application_notification_resend",
  "contact_submit",
  "renewal_document_submit",
  "owner_email_resend",
  "unattributed",
] as const;
export type OperationalRoute = (typeof ROUTES)[number];

const MODES = ["initial", "resend"] as const;

const SOURCE_KINDS = ["contact_submission", "renewal_document"] as const;
export type OperationalSourceKind = (typeof SOURCE_KINDS)[number];

const OUTCOMES = [
  // Submission
  "saved",
  "refused",
  "invalid",
  "failed",
  // Claim, provider and recording
  "claimed",
  "sent",
  "unknown",
  "recorded",
  "unrecorded",
  // Notification states seen when a claim is refused
  "pending",
  "sending",
  "missed",
  "untracked",
  "resend_requested",
  "acknowledged",
  // Operator resend route
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
] as const;
export type OperationalOutcome = (typeof OUTCOMES)[number];

const ERROR_CODES = [
  "intake_trap",
  "intake_too_fast",
  "intake_email_limit",
  "intake_ip_limit",
  "validation_failed",
  "request_unreadable",
  "config_missing",
  "db_permission_denied",
  "db_not_found",
  "db_claim_not_current",
  "db_state_conflict",
  "db_constraint",
  "db_unavailable",
  "db_error",
  "storage_error",
  "network_error",
  "provider_refused",
  "provider_rate_limited",
  "provider_conflict",
  "provider_server_error",
  "provider_timeout_or_network",
  "provider_not_configured",
  "unexpected",
] as const;
export type OperationalErrorCode = (typeof ERROR_CODES)[number];

export type OperationalLogInput = {
  event: OperationalEvent;
  route: OperationalRoute;
  correlationId: string;
  applicationId?: string | null;
  /** v2 events only; ignored for v1 events. */
  sourceKind?: OperationalSourceKind | null;
  /** v2 events only; ignored for v1 events. UUID-validated. */
  sourceId?: string | null;
  attempt?: number | null;
  mode?: (typeof MODES)[number] | null;
  outcome?: OperationalOutcome | null;
  errorCode?: OperationalErrorCode | null;
  /** Reduced to an error code inside the logger; never written. */
  error?: unknown;
  durationMs?: number | null;
};

export type OperationalLogRecord = {
  schema: typeof OPERATIONAL_LOG_SCHEMA;
  ts: string;
  level: "info" | "warn" | "error";
  env: "production" | "preview" | "development" | "test" | "local";
  release: string | null;
  event: OperationalEventV1 | "oplog.invalid_event";
  route: OperationalRoute | null;
  correlation_id: string | null;
  application_id: string | null;
  attempt: number | null;
  mode: (typeof MODES)[number] | null;
  outcome: OperationalOutcome | null;
  error_code: OperationalErrorCode | null;
  duration_ms: number | null;
};

/** The v2 record: the 14 v1 keys plus `source_kind` and `source_id`. */
export type OperationalLogRecordV2 = Omit<OperationalLogRecord, "schema" | "event"> & {
  schema: typeof OPERATIONAL_LOG_SCHEMA_V2;
  event: OperationalEventV2;
  source_kind: OperationalSourceKind | null;
  source_id: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_DURATION_MS = 3_600_000;
const MAX_ATTEMPT = 10_000;

export function createCorrelationId(): string {
  return randomUUID();
}

function member<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" && value.length === 36 && UUID.test(value) ? value : null;
}

function boundedInteger(value: unknown, max: number, min = 0): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function environment(): OperationalLogRecord["env"] {
  const vercel = member(["production", "preview", "development"] as const, process.env.VERCEL_ENV);
  if (vercel) return vercel;
  return process.env.NODE_ENV === "test" ? "test" : "local";
}

function release(): string | null {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return typeof sha === "string" && /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
}

function sqlstateCode(code: string): OperationalErrorCode {
  if (code === "42501") return "db_permission_denied";
  if (code === "P0002" || code === "PGRST116") return "db_not_found";
  if (code === "40001") return "db_claim_not_current";
  if (code === "55000") return "db_state_conflict";
  if (/^23[0-9A-Z]{3}$/.test(code)) return "db_constraint";
  if (/^(08|57)[0-9A-Z]{3}$/.test(code)) return "db_unavailable";
  return "db_error";
}

/**
 * Maps an untrusted thrown value to an enumerated code. It reads only a `code` string and
 * the error class/name; the message is matched against fixed configuration phrases at
 * most and is never returned.
 */
export function classifyOperationalError(error: unknown): OperationalErrorCode {
  try {
    if (error === null || typeof error !== "object") return "unexpected";
    const candidate = error as { code?: unknown; name?: unknown; message?: unknown; __isStorageError?: unknown };
    const code = candidate.code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$|^PGRST[0-9]{3}$/.test(code)) {
      return sqlstateCode(code);
    }
    if (candidate.__isStorageError === true || candidate.name === "StorageError" || candidate.name === "StorageApiError") {
      return "storage_error";
    }
    if (error instanceof SyntaxError) return "request_unreadable";
    const message = typeof candidate.message === "string" ? candidate.message : "";
    if (/^Environment configuration error|is not configured|are not configured/.test(message)) {
      return "config_missing";
    }
    if (error instanceof TypeError && /fetch failed|network/i.test(message)) return "network_error";
    if (candidate.name === "AbortError" || candidate.name === "TimeoutError") return "network_error";
    return "unexpected";
  } catch {
    return "unexpected";
  }
}

function levelFor(event: OperationalLogRecord["event"] | OperationalEventV2, outcome: OperationalOutcome | null) {
  if (event === "oplog.invalid_event") return "error" as const;
  if (/\.(failed|claim_failed|record_failed|background_failed)$/.test(event)) return "error" as const;
  if (event.endsWith(".refused") || event.endsWith(".upload_url_failed") || event.endsWith(".not_claimed")) {
    return "warn" as const;
  }
  if (event.endsWith(".provider_result") || event.endsWith(".completed")) {
    return outcome === "sent" ? ("info" as const) : ("warn" as const);
  }
  return "info" as const;
}

/** Builds the allowlisted record. Exposed for tests; never throws. */
export function buildOperationalLogRecord(input: OperationalLogInput): OperationalLogRecord | OperationalLogRecordV2 {
  const v2 = member(EVENTS_V2, input?.event);
  const event = v2 ?? member(EVENTS, input?.event) ?? "oplog.invalid_event";
  const outcome = member(OUTCOMES, input?.outcome);
  const errorCode =
    member(ERROR_CODES, input?.errorCode) ??
    (input && "error" in input && input.error !== undefined ? classifyOperationalError(input.error) : null);
  // Field order matches the 7.1 v1 line exactly; v2 appends its two keys.
  const record = {
    schema: v2 ? OPERATIONAL_LOG_SCHEMA_V2 : OPERATIONAL_LOG_SCHEMA,
    ts: new Date().toISOString(),
    level: levelFor(event, outcome),
    env: environment(),
    release: release(),
    event,
    route: member(ROUTES, input?.route),
    correlation_id: uuid(input?.correlationId),
    application_id: uuid(input?.applicationId),
    attempt: boundedInteger(input?.attempt, MAX_ATTEMPT, 1),
    mode: member(MODES, input?.mode),
    outcome,
    error_code: errorCode,
    duration_ms: boundedInteger(input?.durationMs, MAX_DURATION_MS),
  };
  if (!v2) return record as OperationalLogRecord;
  return {
    ...record,
    source_kind: member(SOURCE_KINDS, input?.sourceKind),
    source_id: uuid(input?.sourceId),
  } as OperationalLogRecordV2;
}

/**
 * Writes one JSON line to the host log stream (console, captured by the hosting platform).
 * Never throws: a failure to build or write the line is swallowed so it cannot change an
 * HTTP response, skip outcome recording or cause another send.
 */
export function logOperationalEvent(input: OperationalLogInput): void {
  try {
    const record = buildOperationalLogRecord(input);
    const line = JSON.stringify(record);
    if (record.level === "error") console.error(line);
    else if (record.level === "warn") console.warn(line);
    else console.info(line);
  } catch {
    // Logging is best effort by contract.
  }
}

/** Milliseconds since `startedAt`, for `durationMs`. */
export function elapsedSince(startedAt: number): number {
  return Date.now() - startedAt;
}
