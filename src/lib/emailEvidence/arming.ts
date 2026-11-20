// TRACE-155 (Phase 7.3D-1): the shape of email_evidence_arming_readback and the operator wording
// for arming, coverage and retention. The database decides every value (migration
// 20261128001000); this only carries and labels it. Arming records that report collection
// started or stopped; it does not register a webhook, set a secret or send anything.

export type ArmingEvent = {
  seq: number;
  action: "arm" | "disarm";
  occurred_at: string;
  actor: string;
  reason: string;
};

export type ArmingInterval = { armed_from: string; disarmed_at: string | null };

export type RetentionReadback = {
  retained: number;
  retained_linked: number;
  retained_unlinked: number;
  expired: number;
  oldest_expired_expires_at: string | null;
  latest_expires_at: string | null;
  purge_duty: boolean;
  last_purge: { ran_at: string; deleted: number; remaining_expired: number; remaining_over_cap: boolean } | null;
};

export type ArmingReadback = {
  checked_at: string;
  armed: boolean;
  armed_at: string | null;
  retry_horizon_seconds: number;
  history: ArmingEvent[];
  intervals: ArmingInterval[];
  retention: RetentionReadback;
};

/** The database refuses longer reasons and line breaks; the page sends one trimmed line. */
export const ARMING_REASON_MAX = 500;

export function armingReason(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export const armAttestation =
  "The owner has authorized arming, the Resend webhook signing secret is deployed to Production and the webhook endpoint is registered.";

export const armingActionLabel: Record<ArmingEvent["action"], string> = {
  arm: "Collection started",
  disarm: "Collection stopped",
};

/** The purge-duty sentence: duty lasts while any report is stored, expired or not. */
export function purgeDutyLabel(retention: RetentionReadback): string {
  if (!retention.purge_duty) return "No provider reports are stored. There is nothing to purge.";
  return retention.expired > 0
    ? "Expired reports are waiting for the operator purge. Keep running it until no reports remain, even while collection is stopped."
    : "No report has expired yet, but reports are still stored. Keep running the operator purge as they expire, until none remain, even while collection is stopped.";
}

/** The last characters of an operator's account ID, for the history. */
export function actorLabel(actor: string): string {
  return `Operator account …${actor.slice(-6)}`;
}
