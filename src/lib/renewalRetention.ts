// TRACE-074 CFG-011 retention of declined renewal documents: shared naming, wording and
// the storage step the retention route may take. The database decides whether a step may
// start and records it only after reading storage; this module never decides eligibility.

export const RENEWAL_DOCUMENT_BUCKET = "vendor-documents";
export const RENEWAL_QUARANTINE_BUCKET = "vendor-documents-quarantine";

export const RETENTION_ACTIONS = ["quarantine", "restore", "delete"] as const;
export type RetentionAction = (typeof RETENTION_ACTIONS)[number];
export type RetentionState = "retained" | "quarantined" | "deleted";
export type ObjectLocation = "documents" | "quarantine" | "both" | "missing";

/** The action name the database records for each route action. */
export const retentionRecordAction: Record<RetentionAction, "quarantined" | "restored" | "deleted"> = {
  quarantine: "quarantined",
  restore: "restored",
  delete: "deleted",
};

export function isRetentionAction(value: unknown): value is RetentionAction {
  return typeof value === "string" && RETENTION_ACTIONS.includes(value as RetentionAction);
}

export const retentionStateLabel: Record<RetentionState, string> = {
  retained: "Retained",
  quarantined: "In quarantine",
  deleted: "Deleted",
};

export const objectLocationLabel: Record<ObjectLocation, string> = {
  documents: "File in documents storage",
  quarantine: "File in quarantine",
  both: "File found in both documents storage and quarantine",
  missing: "File not found in storage",
};

export type StorageStep =
  | { kind: "move"; path: string; from: string; to: string }
  | { kind: "remove"; path: string; bucket: string };

const RENEWAL_PATH = /^renewals\/[0-9a-f-]{36}\/(license|insurance)\/[0-9a-f-]{36}-[A-Za-z0-9_-]{1,72}\.(pdf|jpg|png|webp|heic|heif)$/;

/**
 * The single storage call for a prepared step. The route acts only on renewal paths and
 * only between the documents bucket and quarantine, whatever the prepare response says;
 * anything else is refused before storage is touched.
 */
export function retentionStorageStep(action: RetentionAction, prepared: Record<string, unknown>): StorageStep {
  return preparedStorageStep(action, prepared, (path) => RENEWAL_PATH.test(path));
}

/**
 * Shared by the renewal (TRACE-074) and application (TRACE-084) retention routes: the
 * prepared path must pass the caller's own path rule, and the buckets must be the ones
 * the action allows.
 */
export function preparedStorageStep(
  action: RetentionAction,
  prepared: Record<string, unknown>,
  allowedPath: (path: string) => boolean,
): StorageStep {
  const path = prepared.storage_path;
  if (typeof path !== "string" || !allowedPath(path)) {
    throw new Error("Prepared retention step has an unexpected path.");
  }
  const expected =
    action === "quarantine"
      ? { from: RENEWAL_DOCUMENT_BUCKET, to: RENEWAL_QUARANTINE_BUCKET }
      : action === "restore"
        ? { from: RENEWAL_QUARANTINE_BUCKET, to: RENEWAL_DOCUMENT_BUCKET }
        : { from: RENEWAL_QUARANTINE_BUCKET, to: null };
  if (prepared.action !== retentionRecordAction[action] || prepared.from_bucket !== expected.from || (prepared.to_bucket ?? null) !== expected.to) {
    throw new Error("Prepared retention step does not match the requested action.");
  }
  return expected.to === null
    ? { kind: "remove", path, bucket: expected.from }
    : { kind: "move", path, from: expected.from, to: expected.to };
}

/** Browser call to the retention route. Success is confirmed by the caller rereading. */
export async function requestRetentionStep(input: { documentId: string; action: RetentionAction; reason: string; key: string }) {
  const response = await fetch("/api/renewal-documents/retention", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as { error?: unknown; recorded?: unknown; underHold?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "The retention step could not be completed.");
  }
  return { recorded: body?.recorded === true, underHold: body?.underHold === true };
}

/** Whole days from `now` until `until`, never negative. */
export function daysUntil(until: string | null, now: string) {
  if (!until) return null;
  const difference = new Date(until).getTime() - new Date(now).getTime();
  if (!Number.isFinite(difference)) return null;
  return Math.max(0, Math.ceil(difference / 86_400_000));
}
