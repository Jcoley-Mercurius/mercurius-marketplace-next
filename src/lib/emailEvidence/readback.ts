// TRACE-155 (Phase 7.3C): the shapes of the operator delivery-evidence readbacks, shared by Owner
// Emails (7.3C-1), Recruiting and the price-draft panel (7.3C-2). The database decides every
// rule, flag, exclusion and count (migrations 20261125002000 and 20261127001000); these types and
// helpers only carry and batch them. Nothing here carries a provider ID, tag, svix-id or ledger
// row ID.
import type { BounceSubtype, EvidenceFact, EvidenceSummary, ExclusionReason } from "@/lib/emailEvidence/labels";

export type EvidenceReport = {
  fact: EvidenceFact;
  provider_created_at: string | null;
  bounce_type: "permanent" | "transient" | "undetermined" | "other" | null;
  bounce_subtype: BounceSubtype | null;
  excluded: ExclusionReason | null;
};

export type EvidenceAttempt = EvidenceSummary & {
  attempt: number;
  has_conflict: boolean;
  reports: EvidenceReport[];
};

/** One ledger row's evidence: the current attempt's summary, the conflict signal and history. */
export type RowEvidence = {
  attempt: number;
  summary: EvidenceSummary;
  has_conflict: boolean;
  conflict_reasons: ExclusionReason[];
  attempts: EvidenceAttempt[];
};

/** Counts for one ledger's rows only. */
export type LedgerEvidenceCounts = { not_delivered: number; to_review: number; conflicting_rows: number };

/** Counts across every provider report, whatever ledger (if any) it concerns. */
export type GlobalEvidenceCounts = {
  receiver_armed: boolean;
  conflicting_reports: { conflict_disagree: number; conflict_id_ambiguous: number; conflict_tag_invalid: number; content_conflict: number };
  unmatched_reports: { total: number; by_type: Record<string, number> };
  retention_backlog: { expired: number; expired_over_cap: boolean; oldest_expires_at: string | null };
};

/** application_email_evidence_counts and package_draft_email_evidence_counts. */
export type ScopedEvidenceCounts = { checked_at: string; ledger: LedgerEvidenceCounts; all_emails: GlobalEvidenceCounts };

export type ApplicationEmailEvidenceItem = RowEvidence & { application_id: string };
export type ApplicationEmailEvidence = { checked_at: string; items: ApplicationEmailEvidenceItem[] };

/** One email notice of a draft: one per revision sent by email. */
export type PackageDraftNoticeEvidence = RowEvidence & {
  /** The notice of the draft's sent revision, as the panel's delivery state reads it. */
  current: boolean;
  queued_at: string;
  state: string;
};
export type PackageDraftEmailEvidenceItem = { draft_id: string; notices: PackageDraftNoticeEvidence[] };
export type PackageDraftEmailEvidence = { checked_at: string; items: PackageDraftEmailEvidenceItem[] };

/** Each evidence read accepts at most this many records (the database refuses more). */
export const EVIDENCE_READ_LIMIT = 100;

/** Splits IDs into reads the database accepts, without duplicates. */
export function evidenceBatches(ids: readonly string[], size = EVIDENCE_READ_LIMIT): string[][] {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let start = 0; start < unique.length; start += size) batches.push(unique.slice(start, start + size));
  return batches;
}

/** The sum of the global conflicting-report classes. */
export function conflictingReportTotal(counts: GlobalEvidenceCounts) {
  const reports = counts.conflicting_reports;
  return reports.conflict_disagree + reports.conflict_id_ambiguous + reports.conflict_tag_invalid + reports.content_conflict;
}

/** owner_email_evidence_counts (7.3C-1) returns both scopes flat; this splits them. */
export function scopeOwnerEvidenceCounts(flat: LedgerEvidenceCounts & GlobalEvidenceCounts & { checked_at: string }): ScopedEvidenceCounts {
  return {
    checked_at: flat.checked_at,
    ledger: { not_delivered: flat.not_delivered, to_review: flat.to_review, conflicting_rows: flat.conflicting_rows },
    all_emails: {
      receiver_armed: flat.receiver_armed,
      conflicting_reports: flat.conflicting_reports,
      unmatched_reports: flat.unmatched_reports,
      retention_backlog: flat.retention_backlog,
    },
  };
}
