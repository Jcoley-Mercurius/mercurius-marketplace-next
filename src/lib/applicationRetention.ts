// TRACE-084 CFG-011 retention of the documents of rejected or abandoned vendor
// applications, and TRACE-090 retention of uploads never attached to an application: closure wording, the path rule the retention route enforces and the
// browser calls. The database decides eligibility and records a step only after reading
// storage; this module never decides either.

import { preparedStorageStep, type ObjectLocation, type RetentionAction, type StorageStep } from "./renewalRetention";

export type ClosureOutcome = "rejected" | "abandoned";
export type ApplicationRetentionState = "retained" | "quarantined" | "deleted";

export const closureOutcomeLabel: Record<ClosureOutcome, string> = {
  rejected: "Rejected",
  abandoned: "Abandoned",
};

export const closureSourceLabel: Record<"closure" | "onboarding", string> = {
  closure: "Recorded on this application",
  onboarding: "Provider rejected in onboarding review",
};

export type ApplicationRetentionFile = {
  application_id: string;
  business_name: string;
  application_status: string;
  path: string;
  kind: string;
  file_name: string;
  /** False for an upload no application version or row lists (TRACE-090). */
  attached: boolean;
  uploaded_at: string | null;
  closure_outcome: ClosureOutcome | null;
  closed_at: string | null;
  closure_source: "closure" | "onboarding" | null;
  retention_ends_at: string | null;
  retention_state: ApplicationRetentionState;
  retention_since: string | null;
  quarantine_ends_at: string | null;
  object_location: ObjectLocation;
  bound_to_evidence: boolean;
  held: boolean;
};

export type ApplicationRetentionOverview = {
  application_id: string;
  application_status: string;
  has_provider: boolean;
  closure: { outcome: ClosureOutcome; closed_at: string | null; source: "closure" | "onboarding"; reason: string | null } | null;
  closable: boolean;
  close_outcomes: ClosureOutcome[];
  retention_days: number;
  quarantine_days: number;
  unattached_days: number;
  hold: { reason: string; placed_at: string } | null;
  provider_held: boolean;
  files: ApplicationRetentionFile[];
  unattached_files: ApplicationRetentionFile[];
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const APPLICATION_PATH = new RegExp(`^(${UUID})/(license|insurance|other)/${UUID}-[A-Za-z0-9_-]{1,72}\\.(pdf|jpg|png|webp|heic|heif)$`);

/** An application upload path, and only inside the named application's folder. */
export function isApplicationDocumentPath(applicationId: string, path: string) {
  const match = APPLICATION_PATH.exec(path);
  return match !== null && match[1] === applicationId;
}

/**
 * The single storage call for a prepared application step: the application's own upload
 * paths only, between the documents bucket and quarantine, whatever prepare returned.
 */
export function applicationRetentionStorageStep(
  action: RetentionAction,
  applicationId: string,
  prepared: Record<string, unknown>,
): StorageStep {
  if (prepared.application_id !== applicationId) {
    throw new Error("Prepared retention step names another application.");
  }
  return preparedStorageStep(action, prepared, (path) => isApplicationDocumentPath(applicationId, path));
}

/** Browser call to the application retention route. Success is confirmed by rereading. */
export async function requestApplicationRetentionStep(input: {
  applicationId: string;
  path: string;
  action: RetentionAction;
  reason: string;
  key: string;
}) {
  const response = await fetch("/api/vendor-applications/retention", {
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
