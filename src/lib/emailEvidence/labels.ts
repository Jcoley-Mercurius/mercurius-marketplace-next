// TRACE-155 (Phase 7.3C-1, C3C-4): operator wording for provider delivery evidence. The database
// decides every rule, flag and exclusion reason (migration 20261125002000); this file only maps
// those values to the plan's §5 and §8.3 labels. No label says "Delivered", "Received", "Read" or
// "Confirmed" alone, a server hand-off always carries its disclaimer, and two reports are said to
// be "also reported", never "later".
//
// TRACE-155 (Phase 7.3D-1, R3D-2): every summary also carries `coverage`, from the audited arming
// intervals (migration 20261128001000). Only the no-report rules 9 and 10 read it: a label never
// claims more collection than the arming history shows.
//
// 7.3D-1 review fixes (2026-11-20): an interval is a *recorded coverage window*, an operator's
// declaration of when reports were meant to be collected. Recording it does not turn webhook
// receipt on or off, and it is not proof that the receiver was available throughout. So the
// labels say a window was "recorded", never that reports "were collected". The 28-hour period
// follows Resend's documented retry schedule: it is how long a window must stay open, not proof of
// uninterrupted collection (D-3).

export type EvidenceFact =
  | "accepted" | "delayed" | "delivered" | "bounced_permanent" | "bounced_transient"
  | "bounced_undetermined" | "complained" | "provider_failed" | "provider_suppressed";
export type NonDeliveryFact = "bounced_permanent" | "provider_failed" | "provider_suppressed";
export type EvidenceRule = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type EvidenceCoverage = "unknown" | "before_first_arm" | "gap" | "partial" | "collecting" | "complete";
export type ExclusionReason = "stored_conflict" | "content_conflict" | "current_conflict";
export type BounceSubtype =
  | "general" | "no_email" | "mailbox_full" | "message_too_large" | "content_rejected"
  | "attachment_rejected" | "suppressed" | "message_rejected" | "undetermined" | "other";

export type EvidenceSummary = {
  rule: EvidenceRule;
  delivered_fact: boolean;
  non_delivery_proven: boolean;
  needs_review: boolean;
  reported: NonDeliveryFact[];
  /** Absent only in data read before 7.3D-1; treated as no coverage information. */
  coverage?: EvidenceCoverage;
};

/** The retry horizon the database uses for coverage (private.email_evidence_retry_horizon). */
export const RETRY_HORIZON_HOURS = 28;

/** What the recorded coverage windows show for an attempt, by its claim time. */
export const coverageLabel: Record<EvidenceCoverage, string> = {
  unknown: "Send time unknown, so its coverage window cannot be shown",
  before_first_arm: "Sent before any coverage window was recorded",
  gap: "Sent while no coverage window was recorded",
  partial: `Sent inside a recorded coverage window that ended within ${RETRY_HORIZON_HOURS} hours, so a report may have been missed`,
  collecting: `Sent inside the open coverage window, less than ${RETRY_HORIZON_HOURS} hours ago`,
  complete: `Sent inside a recorded coverage window that stayed open for ${RETRY_HORIZON_HOURS} hours after`,
};

export const NOT_INBOX_PROOF = "Not proof it reached the inbox or was read";

const alsoReported: Record<NonDeliveryFact, string> = {
  bounced_permanent: "bounced permanently",
  provider_failed: "failed",
  provider_suppressed: "suppressed",
};
const notDeliveredBecause: Record<NonDeliveryFact, string> = {
  bounced_permanent: "a permanent bounce",
  provider_failed: "a failure",
  provider_suppressed: "suppression",
};

function joined(parts: string[]) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** The §8.3 summary label for a rule. */
export function evidenceSummaryLabel(summary: Pick<EvidenceSummary, "rule" | "reported" | "coverage">): string {
  const reported = summary.reported ?? [];
  switch (summary.rule) {
    case 1: return "Handed to the mail server; the recipient marked it as spam";
    case 2: return `Provider reports disagree: handed to the mail server, and also reported ${joined(reported.map((fact) => alsoReported[fact]))}`;
    case 3: return "Handed to the mail server; a temporary or undetermined bounce was also reported";
    case 4: return `Handed to the recipient's mail server. ${NOT_INBOX_PROOF}`;
    case 5: return `Not delivered: Resend reported ${joined(reported.map((fact) => notDeliveredBecause[fact]))}`;
    case 6: return "Bounce reported (temporary or undetermined); delivery not established";
    case 7: return "Delivery delayed; not yet established";
    case 8: return "Accepted by Resend for delivery";
    case 9:
      if (summary.coverage === "complete") return `No provider report received; a coverage window was recorded for ${RETRY_HORIZON_HOURS} hours after sending`;
      if (summary.coverage === "partial") return `No provider report received; the recorded coverage window ended within ${RETRY_HORIZON_HOURS} hours of sending, so a report may have been missed`;
      return "No provider report yet";
    default:
      if (summary.coverage === "gap") return "Delivery evidence not available: no coverage window was recorded when this was sent";
      return "Delivery evidence not available";
  }
}

/** A single report in the history. */
export const evidenceFactLabel: Record<EvidenceFact, string> = {
  accepted: "Accepted by Resend for delivery",
  delayed: "Delivery delayed",
  delivered: `Handed to the recipient's mail server. ${NOT_INBOX_PROOF}`,
  bounced_permanent: "Permanent bounce reported",
  bounced_transient: "Temporary bounce reported (inconclusive)",
  bounced_undetermined: "Undetermined bounce reported (inconclusive)",
  complained: "Handed to the mail server; the recipient marked it as spam",
  provider_failed: "Resend reported a failure",
  provider_suppressed: "Resend reported suppression",
};

export const bounceSubtypeLabel: Record<BounceSubtype, string> = {
  general: "general",
  no_email: "no such mailbox",
  mailbox_full: "mailbox full",
  message_too_large: "message too large",
  content_rejected: "content rejected",
  attachment_rejected: "attachment rejected",
  suppressed: "on a suppression list",
  message_rejected: "message rejected",
  undetermined: "undetermined",
  other: "other",
};

/** Why a report is excluded from the summary. */
export const exclusionLabel: Record<ExclusionReason, string> = {
  stored_conflict: "Excluded: conflicting report",
  content_conflict: "Excluded: conflicting report",
  current_conflict: "Excluded while current email records disagree with it",
};

/**
 * The row's conflict signal. Stored and content conflicts stay excluded for the report's whole
 * retained life; a current conflict is excluded only while the email records disagree, so the
 * report can count again if that disagreement disappears (plan §7.3, S-57 as amended).
 */
export function conflictSignalLabels(reasons: ExclusionReason[]): string[] {
  const labels: string[] = [];
  if (reasons.includes("stored_conflict") || reasons.includes("content_conflict")) {
    labels.push("Conflicting provider report — excluded from this summary.");
  }
  if (reasons.includes("current_conflict")) {
    labels.push("Conflicting provider report — excluded while current email records disagree with it. If the conflicting record is removed, this report can count again.");
  }
  return labels;
}

export function evidenceIsInconclusive(summary: EvidenceSummary) {
  return summary.needs_review && !summary.non_delivery_proven;
}
