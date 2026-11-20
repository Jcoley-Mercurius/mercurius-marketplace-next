// TRACE-155 (Phase 7.3D-1): how controlled-acceptance evidence is judged (readiness §3.2, Codex
// review 5997315152). Two kinds of proof are kept apart (R3D-3):
//
// - A probe to a Resend test address is untagged, so its receipts are `unmatched`. They show
//   provider transport and event behaviour only. A probe never qualifies a ledger rule (1, 4 or 5
//   or any other), never links to a ledger row and is never rematched.
// - A controlled send through a real ledger path qualifies only from durable, operator-read state:
//   the expected attempt, claimed while reports were collected (the arming cutoff), with a trusted
//   report of the expected fact that is not excluded. An HTTP status alone, including a duplicate
//   response, is never evidence; an expected trusted receipt already stored still is.
//
// Both judgements are pure functions of the database readbacks; nothing here reads a provider ID,
// recipient or payload.
import type { EvidenceCoverage, EvidenceFact } from "@/lib/emailEvidence/labels";
import type { RowEvidence } from "@/lib/emailEvidence/readback";

// Probes ---------------------------------------------------------------------------------------

export const PROBE_CHOICES = ["delivered", "bounced", "complained", "suppressed"] as const;
export type ProbeChoice = (typeof PROBE_CHOICES)[number];

export function isProbeChoice(value: unknown): value is ProbeChoice {
  return typeof value === "string" && (PROBE_CHOICES as readonly string[]).includes(value);
}

/**
 * The event each test address is expected to produce, and whether that is documented. Readiness
 * §3.6: `suppressed@` is a documented test address, but which event it produces is unverified;
 * no test address is known for `email.failed` or `email.delivery_delayed`.
 */
export const probeExpectation: Record<ProbeChoice, { label: string; event: string; documented: boolean }> = {
  delivered: { label: "Delivered test address", event: "email.delivered", documented: true },
  bounced: { label: "Bounced test address", event: "email.bounced", documented: true },
  complained: { label: "Complained test address", event: "email.complained", documented: true },
  suppressed: { label: "Suppressed test address", event: "email.suppressed", documented: false },
};

export type ProbeReceipt = {
  event_type: string;
  fact: EvidenceFact | null;
  bounce_type: string | null;
  bounce_subtype: string | null;
  provider_created_at: string | null;
  received_at: string;
  state: "unlinked" | "stored_conflict" | "content_conflict" | "current_conflict" | "trusted";
};
export type ProbeReadback = { checked_at: string; not_probe: boolean; receipts: ProbeReceipt[] };

export type ProbeVerdict =
  /** The expected event arrived as an unlinked receipt: transport evidence only. */
  | "expected_event_observed"
  /** Receipts arrived, but not (yet) the expected event, or only excluded ones. */
  | "expected_event_not_observed"
  /** Nothing has arrived for this send yet. */
  | "no_receipt_yet"
  /** The provider ID belongs to a ledger send or a tagged report; not a probe. */
  | "not_a_probe";

export function probeVerdict(readback: ProbeReadback, choice: ProbeChoice): ProbeVerdict {
  if (readback.not_probe) return "not_a_probe";
  if (readback.receipts.length === 0) return "no_receipt_yet";
  const expected = probeExpectation[choice].event;
  return readback.receipts.some((receipt) => receipt.event_type === expected && receipt.state === "unlinked")
    ? "expected_event_observed"
    : "expected_event_not_observed";
}

export const probeVerdictLabel: Record<ProbeVerdict, string> = {
  expected_event_observed: "Expected provider report received (unlinked test report: transport evidence only, not email-record evidence)",
  expected_event_not_observed: "Provider reports received, but not the expected one",
  no_receipt_yet: "No provider report received yet",
  not_a_probe: "This send is not a test probe; its reports are not shown here",
};

// Ledger sends -----------------------------------------------------------------------------------

/** Coverage values for an attempt claimed inside an audited armed interval (at or after the cutoff). */
const CLAIMED_WHILE_COLLECTING: readonly EvidenceCoverage[] = ["collecting", "complete", "partial"];

export type QualificationReason =
  | "qualifying"
  | "attempt_not_found"
  | "claimed_outside_collection"
  | "coverage_unknown"
  | "conflicting_report"
  | "expected_report_missing";

/**
 * Whether one ledger attempt's readback qualifies as controlled-acceptance evidence for the
 * expected fact. Reads only the operator readback (durable state): the attempt must be in the
 * history, claimed while reports were collected, free of conflicting reports, and hold a trusted
 * (not excluded) report of exactly the expected fact.
 */
export function qualifyLedgerAttempt(evidence: RowEvidence, attempt: number, expected: EvidenceFact): QualificationReason {
  const entry = evidence.attempts.find((candidate) => candidate.attempt === attempt);
  if (!entry) return "attempt_not_found";
  if (!entry.coverage) return "coverage_unknown";
  if (!CLAIMED_WHILE_COLLECTING.includes(entry.coverage)) return "claimed_outside_collection";
  if (entry.has_conflict) return "conflicting_report";
  return entry.reports.some((report) => report.fact === expected && report.excluded === null)
    ? "qualifying"
    : "expected_report_missing";
}
