import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  bounceSubtypeLabel,
  conflictSignalLabels,
  evidenceFactLabel,
  evidenceIsInconclusive,
  evidenceSummaryLabel,
  exclusionLabel,
  type EvidenceSummary,
} from "@/lib/emailEvidence/labels";
import { conflictingReportTotal, type RowEvidence, type ScopedEvidenceCounts } from "@/lib/emailEvidence/readback";

// TRACE-155 (Phase 7.3C): provider delivery evidence as operators read it on Owner Emails,
// Recruiting and the price-draft panel. The database decides every rule, flag, exclusion and
// count; this only labels them with the shared §5/§8.3 wording. Evidence never adds, removes or
// gates an action, and a hand-off to the mail server is never presented as inbox or read proof.

function summaryTone(summary: EvidenceSummary) {
  if (summary.non_delivery_proven) return "text-destructive";
  if (evidenceIsInconclusive(summary)) return "text-status-warning";
  return "text-muted-foreground";
}

/** The current attempt's evidence summary, the conflict signal and the per-attempt history. */
export function DeliveryEvidence({ evidence, label = "Delivery evidence" }: { evidence: RowEvidence; label?: string }) {
  const attemptNote = evidence.attempt > 1 ? ` (attempt ${evidence.attempt})` : "";
  return (
    <div className="mt-2 space-y-1 text-xs" data-testid="delivery-evidence">
      <p className="break-words">
        <span className="font-medium">{label}{attemptNote}:</span>{" "}
        <span className={summaryTone(evidence.summary)}>{evidenceSummaryLabel(evidence.summary)}</span>
      </p>
      {conflictSignalLabels(evidence.conflict_reasons).map((text) => (
        <p key={text} className="flex items-start gap-1 break-words text-status-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{text}
        </p>
      ))}
      {evidence.attempts.length > 0 && (
        <details className="rounded-md border border-border px-3">
          <summary className="flex min-h-11 cursor-pointer items-center font-medium">Provider report history</summary>
          <div className="space-y-3 pb-3">
            {evidence.attempts.map((attempt) => (
              <div key={attempt.attempt}>
                <p className="break-words font-medium">Attempt {attempt.attempt}: {evidenceSummaryLabel(attempt)}</p>
                {attempt.reports.map((report, index) => (
                  <p key={index} className="mt-1 break-words text-muted-foreground">
                    {evidenceFactLabel[report.fact]}
                    {report.bounce_subtype ? ` (${bounceSubtypeLabel[report.bounce_subtype]})` : ""}
                    {" · "}Provider time {report.provider_created_at ? formatEvidenceTime(report.provider_created_at) : "not given"}
                    {report.excluded ? <> · <span className="font-medium text-status-warning">{exclusionLabel[report.excluded]}</span></> : null}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * The additive §9.1 counts, in two scopes kept apart: `scope` names this ledger's rows; "All
 * Mercurius emails" counts every provider report, whatever ledger it concerns. Existing attention
 * counts stay where they are and are never replaced by these.
 */
export function DeliveryEvidenceCounts({ counts, failed, scope, rowNoun = "Emails" }: {
  counts: ScopedEvidenceCounts | null;
  failed: boolean;
  /** Heading for this ledger's counts, for example "Application emails". */
  scope: string;
  /** Plural noun for this ledger's rows in the conflicting-row label. */
  rowNoun?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Delivery evidence from Resend</CardTitle>
        <CardDescription>
          What Resend reported after accepting an email. A hand-off to the recipient&apos;s mail server is not proof it reached the inbox or was read. These counts never change an email&apos;s state or what you can do with it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed ? (
          <p role="alert" className="text-sm text-status-warning">Delivery evidence counts could not be loaded. Refresh to try again.</p>
        ) : !counts ? (
          <p className="text-sm text-muted-foreground">Loading delivery evidence…</p>
        ) : (
          <>
            {!counts.all_emails.receiver_armed && (
              <p className="text-sm text-muted-foreground">
                Resend delivery reports are not being collected yet, so emails show “Delivery evidence not available”.
              </p>
            )}
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{scope}</p>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Count term="Not delivered (Resend reported)" value={counts.ledger.not_delivered} />
                <Count term="Provider reports to review" value={counts.ledger.to_review} />
                <Count term={`${rowNoun} with conflicting provider reports`} value={counts.ledger.conflicting_rows} />
              </dl>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">All Mercurius emails</p>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Count term="Conflicting provider reports (all emails)" value={conflictingReportTotal(counts.all_emails)} />
                <Count term="Unmatched provider reports" value={counts.all_emails.unmatched_reports.total} />
                <Count term="Expired reports awaiting deletion"
                  value={counts.all_emails.retention_backlog.expired_over_cap ? "Over 10,000" : counts.all_emails.retention_backlog.expired} />
              </dl>
            </div>
            {counts.all_emails.retention_backlog.oldest_expires_at && (
              <p className="text-xs text-muted-foreground">
                Oldest expired report: {formatEvidenceTime(counts.all_emails.retention_backlog.oldest_expires_at)}. Expired reports are never shown or counted above.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Count({ term, value }: { term: string; value: number | string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="font-heading text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function formatEvidenceTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
}
