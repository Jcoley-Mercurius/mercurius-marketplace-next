// TRACE-155 (Phase 7.3D-2): the operator's manual purge of expired provider reports. The database
// decides everything (migration 20261124001000, unchanged): `email_provider_events_purge(p_limit)`
// runs only for an operator session, clamps the batch to 1–1,000, deletes only receipts whose
// expiry has passed, oldest first, and records each run. This module carries the one request the
// page makes per confirmation and words its answer. Nothing here repeats a call, schedules one or
// decides retention: how often the purge runs is the owner's retention decision (EO-2), which is
// still a proposal.

/** The largest batch the database accepts in one call; the page always asks for exactly this. */
export const PURGE_BATCH_MAX = 1000;

/** The database counts the expired rows left after a run up to this many. */
export const PURGE_REMAINING_CAP = 10000;

export type PurgeResult = {
  checked_at: string;
  limit: number;
  deleted: number;
  remaining_expired: number;
  remaining_over_cap: boolean;
  oldest_remaining_expires_at: string | null;
};

export type PurgeFailure = { kind: "refused" | "unknown"; message: string };

/** The one argument object sent with every confirmed run. */
export function purgeArgs() {
  return { p_limit: PURGE_BATCH_MAX } as const;
}

const count = (value: unknown, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

/** The function's answer, or null when it is not the documented shape. */
export function parsePurgeResult(value: unknown): PurgeResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.checked_at !== "string" || !row.checked_at) return null;
  if (!count(row.limit, PURGE_BATCH_MAX) || row.limit < 1) return null;
  if (!count(row.deleted, row.limit)) return null;
  if (!count(row.remaining_expired, PURGE_REMAINING_CAP)) return null;
  if (typeof row.remaining_over_cap !== "boolean") return null;
  const oldest = row.oldest_remaining_expires_at;
  if (oldest !== null && typeof oldest !== "string") return null;
  // The count and the oldest expiry are separate statements, so a concurrent purge-on-receipt can
  // leave them out of step; only the capped count's own invariant is checked.
  if (row.remaining_over_cap && row.remaining_expired !== PURGE_REMAINING_CAP) return null;
  return {
    checked_at: row.checked_at,
    limit: row.limit,
    deleted: row.deleted,
    remaining_expired: row.remaining_expired,
    remaining_over_cap: row.remaining_over_cap,
    oldest_remaining_expires_at: oldest,
  };
}

/**
 * A database or API refusal carries an error code, and the function runs in one transaction, so
 * nothing was deleted. Without a code (the request failed in transit, or the answer was not the
 * API's) the outcome is unknown: the run may have committed.
 */
export function classifyPurgeError(error: unknown): PurgeFailure {
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const message = typeof record.message === "string" && record.message.trim() ? record.message.trim() : "No answer was received";
  const code = typeof record.code === "string" ? record.code.trim() : "";
  return { kind: code ? "refused" : "unknown", message };
}

export const PURGE_UNREADABLE =
  "The purge's answer could not be read. Reports may have been deleted. Refresh the counts before running it again.";

export function purgeFailureMessage(failure: PurgeFailure): string {
  const message = failure.message.replace(/[.\s]+$/, "");
  return failure.kind === "refused"
    ? `The purge was refused: ${message}. Nothing was deleted.`
    : `The purge's result is unknown: ${message}. Reports may have been deleted. Refresh the counts before running it again.`;
}

const number = (value: number) => value.toLocaleString("en-US");
const reports = (value: number) => `${number(value)} expired ${value === 1 ? "report" : "reports"}`;

export function purgeDeletedLabel(result: PurgeResult): string {
  return `${reports(result.deleted)} deleted`;
}

/** What is left after the run. The page never runs it again by itself. */
export function purgeRemainingLabel(result: PurgeResult, formatTime: (value: string) => string): string {
  const oldest = result.oldest_remaining_expires_at ? `, the oldest expired ${formatTime(result.oldest_remaining_expires_at)}` : "";
  if (result.remaining_over_cap) {
    return `More than ${number(PURGE_REMAINING_CAP)} expired reports remain${oldest}. Each run deletes up to ${number(PURGE_BATCH_MAX)}; run it again to delete more.`;
  }
  if (result.remaining_expired === 0) return "No expired reports remain.";
  return `${reports(result.remaining_expired)} ${result.remaining_expired === 1 ? "remains" : "remain"}${oldest}. Run it again to delete up to ${number(PURGE_BATCH_MAX)} more.`;
}
