"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageState } from "@/components/ui/page-state";
import { createClient } from "@/lib/supabase/client";
import {
  complianceAttentionOrder,
  complianceEffects,
  complianceItemDetail,
  complianceItemLabel,
  complianceNextAction,
  complianceStateLabel,
  formatEasternDate,
  type ComplianceItemState,
  type ComplianceStatus,
} from "@/lib/vendorCompliance";
import { cn } from "@/lib/utils";

// TRACE-135 (Phase 6.12A): the provider's own checklist, read from vendor_own_compliance_status.
// It shows what Mercurius recorded and the next step; it records, renews or waives nothing.

const stateTone: Record<ComplianceItemState, string> = {
  current: "border-status-success bg-status-success-bg text-status-success",
  expiring: "border-status-warning bg-status-warning-bg text-status-warning",
  exception: "border-status-warning bg-status-warning-bg text-status-warning",
  expired: "border-status-danger bg-status-danger-bg text-status-danger",
  missing: "border-status-danger bg-status-danger-bg text-status-danger",
};

export function VendorComplianceStatus({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<ComplianceStatus | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: rpcError } = await createClient().rpc("vendor_own_compliance_status");
      if (rpcError) throw rpcError;
      setStatus(data as unknown as ComplianceStatus);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  const heading = <h2 id="compliance-status-title" className="text-lg font-semibold">Your checklist</h2>;

  if (!status) {
    return (
      <section aria-labelledby="compliance-status-title" className="space-y-3">
        {heading}
        {error && !loading ? (
          <PageState
            kind="error"
            title="Checklist unavailable"
            description="Your checklist could not be loaded. Your documents and uploads below still work."
            action={<Button onClick={() => void load()}><RefreshCw />Try again</Button>}
          />
        ) : (
          <PageState kind="loading" title="Loading your checklist" />
        )}
      </section>
    );
  }

  const effects = complianceEffects(status);
  const items = complianceAttentionOrder(status.items);
  const needing = items.filter((item) => item.state !== "current").length;

  return (
    <section aria-labelledby="compliance-status-title" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {heading}
        <p className="text-xs text-muted-foreground">Checked {formatEasternDate(status.evaluated_at)} (Eastern Time)</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">The checklist could not be refreshed. It shows the last successful load.</p>
      )}
      <div
        className={cn(
          "space-y-1.5 rounded-xl border p-4 text-sm",
          status.matching_allowed ? "border-border bg-card" : "border-status-danger bg-status-danger-bg",
        )}
      >
        <p className="font-medium text-foreground">{effects.matching}</p>
        {effects.payout && <p className="text-foreground">{effects.payout}</p>}
        {status.items.length > 0 && (
          <p className="text-muted-foreground">
            {needing === 0 ? "Every item is current." : `${needing} of ${status.items.length} ${needing === 1 ? "item needs" : "items need"} attention.`}
          </p>
        )}
      </div>
      {status.items.length === 0 ? (
        <PageState
          kind="empty"
          title="No checklist on record"
          description="Mercurius has no onboarding checklist for this account yet."
          action={<Link href="/contact" className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}>Contact Mercurius</Link>}
        />
      ) : (
        <ul aria-label="Checklist items" className="divide-y rounded-xl border bg-card text-card-foreground">
          {items.map((item) => {
            const action = complianceNextAction(item, status);
            return (
              <li key={item.kind} className="min-w-0 space-y-1.5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{complianceItemLabel(item.kind)}</span>
                  <Badge variant="outline" className={stateTone[item.state]}>{complianceStateLabel[item.state]}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{complianceItemDetail(item)}</p>
                {item.awaiting_review > 0 && (
                  <p className="text-sm text-foreground">
                    {item.awaiting_review === 1 ? "1 document" : `${item.awaiting_review} documents`} awaiting review
                    {item.last_submitted_at ? `, sent ${formatEasternDate(item.last_submitted_at)}` : ""}.
                  </p>
                )}
                {item.declined && (
                  <p className="break-words text-sm text-foreground">
                    <span className="font-medium">Your last document was declined {formatEasternDate(item.declined.at)}.</span>
                    {item.declined.note ? ` ${item.declined.note}` : ""}
                  </p>
                )}
                {action.kind !== "none" && (
                  <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm font-medium text-foreground">Next: {action.text}</p>
                    {action.kind === "upload" && (
                      <a href="#renewal-upload-title" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 w-full sm:w-auto")}>
                        Go to upload
                      </a>
                    )}
                    {action.kind === "contact" && (
                      <Link href="/contact" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 w-full sm:w-auto")}>
                        Contact Mercurius
                      </Link>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
