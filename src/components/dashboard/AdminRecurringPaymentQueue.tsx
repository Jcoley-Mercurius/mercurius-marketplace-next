"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatEastern } from "@/lib/offerStatus";
import { recurringQueueLabel, type RecurringPaymentQueueItem } from "@/lib/recurringVisits";
import { cents } from "@/lib/quoteProposals";
import { createClient } from "@/lib/supabase/client";

type State = { mode: "loading" } | { mode: "error"; message: string } | { mode: "ready"; items: RecurringPaymentQueueItem[] };

// TRACE-125 (DEC-2026-049 item 5): accepted recurring visits that are still unpaid from 24 hours
// before their appointment (or from a later acceptance), and their confirmed failures and unknown
// outcomes. Read-only: nothing here publishes a price, charges, cancels or messages anyone.
export function AdminRecurringPaymentQueue({ open }: { open: (requestId: string) => void }) {
  const [state, setState] = useState<State>({ mode: "loading" });

  const load = useCallback(async () => {
    const result = await createClient().rpc("admin_recurring_payment_queue");
    if (result.error) { setState({ mode: "error", message: result.error.message }); return; }
    const data = result.data as { items?: RecurringPaymentQueueItem[] } | null;
    setState({ mode: "ready", items: data?.items ?? [] });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <section aria-labelledby="recurring-payment-queue-heading" className="mb-6 rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CreditCard className="h-4 w-4 text-status-warning" aria-hidden />
        <h2 id="recurring-payment-queue-heading" className="text-sm font-semibold">Recurring visit payments</h2>
        {state.mode === "ready" && <Badge variant="outline">{state.items.length}</Badge>}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}><RefreshCw />Refresh</Button>
      </div>
      {state.mode === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading visit payments…</p>
      ) : state.mode === "error" ? (
        <p role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">Visit payments couldn’t be loaded: {state.message}</p>
      ) : state.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs attention. An accepted visit appears here 24 hours before its appointment while it is unpaid, or as soon as it is accepted inside that window.</p>
      ) : (
        <ul className="divide-y" aria-label="Recurring visit payments">
          {state.items.map((item) => {
            const label = recurringQueueLabel(item);
            const passed = (item.kind === "review_missing" || item.kind === "ready_unpaid") && item.aged;
            return (
              <li key={`${item.kind}:${item.request_id}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">{label.title}
                    {passed && <Badge className="border-status-danger bg-status-danger-bg text-status-danger">Appointment passed</Badge>}
                    {!passed && item.aged && <Badge className="border-status-danger bg-status-danger-bg text-status-danger">Aged</Badge>}
                  </p>
                  <p className="text-muted-foreground">
                    {item.service_type}{item.detail.starts_at ? ` · visit ${formatEastern(item.detail.starts_at)}` : ""}
                    {typeof item.detail.amount_cents === "number" ? ` · ${cents(item.detail.amount_cents)}` : ""}
                    {item.since ? ` · since ${formatEastern(item.since)}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{label.action}</p>
                  {item.detail.problem && <p className="mt-1 text-xs text-status-danger">{item.detail.problem.message} {item.detail.problem.recovery}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => open(item.request_id)}>Open visit</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
