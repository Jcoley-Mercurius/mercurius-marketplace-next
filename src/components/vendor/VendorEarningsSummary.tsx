"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, DollarSign, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { formatCents, summarizeEarnings, type EarningsTone, type VendorEarnings } from "@/lib/vendorEarnings";
import { cn } from "@/lib/utils";

// TRACE-135 (Phase 6.12B, DEC-2026-056 item 1): the dashboard earnings summary, read from the
// canonical payment records (vendor_own_earnings). It replaces the legacy "Released earnings" card.

export const earningsToneClass: Record<EarningsTone, string> = {
  success: "border-status-success bg-status-success-bg text-status-success",
  warning: "border-status-warning bg-status-warning-bg text-status-warning",
  danger: "border-status-danger bg-status-danger-bg text-status-danger",
  neutral: "border-border bg-muted text-foreground",
};

export function useVendorEarnings() {
  const [earnings, setEarnings] = useState<VendorEarnings | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: rpcError } = await createClient().rpc("vendor_own_earnings");
      if (rpcError) throw rpcError;
      setEarnings(data as unknown as VendorEarnings);
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
  }, [load]);

  return { earnings, error, loading, load };
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p>
    </div>
  );
}

export function VendorEarningsSummary() {
  const { earnings, error, loading, load } = useVendorEarnings();
  const summary = earnings ? summarizeEarnings(earnings.totals) : null;

  return (
    <Card className="mb-8 overflow-hidden border-accent-border bg-card shadow-sm">
      <CardHeader className="border-b border-accent-border bg-accent-subtle [&_.text-muted-foreground]:text-foreground/75">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><DollarSign className="h-4 w-4 text-accent" />Earnings</CardTitle>
            <CardDescription className="mt-1">From payments Mercurius has collected for your jobs. Payouts are paid by weekly direct deposit.</CardDescription>
          </div>
          <Link href="/vendor/earnings" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 w-full bg-background sm:w-auto")}>
            View earnings<ArrowRight />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        {!earnings || !summary ? (
          error && !loading ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p role="alert" className="text-sm text-foreground">Your earnings could not be loaded. No amount is estimated.</p>
              <Button variant="outline" className="min-h-11" onClick={() => void load()}><RefreshCw />Try again</Button>
            </div>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">Loading your earnings…</p>
          )
        ) : earnings.jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payouts yet. Jobs appear here once a homeowner pays for work assigned to you.</p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Tile label="Paid to you" value={formatCents(summary.paid)} note="Transfers your bank has received." />
              <Tile label="Eligible" value={formatCents(summary.eligible)} note="Paid in a weekly transfer Mercurius prepares." />
              <Tile label="On the way" value={formatCents(summary.onTheWay)} note="In a transfer, not yet confirmed paid." />
              <Tile
                label="On hold"
                value={formatCents(summary.held)}
                note={summary.heldCount === 0 ? "Nothing on hold." : `${summary.heldCount} ${summary.heldCount === 1 ? "job" : "jobs"} on hold.`}
              />
            </div>
            {summary.attention > 0 && (
              <p className={cn("mt-4 rounded-lg border p-3 text-sm", earningsToneClass.danger)}>
                {summary.attention} {summary.attention === 1 ? "transfer was" : "transfers were"} not paid or returned. See your earnings for details.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
