"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { formatEastern } from "@/lib/offerStatus";
import { queueKindLabel, type QueueItem } from "@/lib/quoteProposals";
import { createClient } from "@/lib/supabase/client";

type State = { mode: "loading" } | { mode: "error"; message: string } | { mode: "ready"; items: QueueItem[]; checkedAt: string };

// DEC-2026-045 G4–G6: quote aging, deposit and provider reviews, accepted-quote exceptions and
// payment exceptions. Read-only status plus recorded reviews; nothing here accepts, cancels,
// reassigns, extends, charges, refunds or sends a message.
export function AdminQuoteQueue({ open }: { open: (requestId: string) => void }) {
  const [state, setState] = useState<State>({ mode: "loading" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const result = await createClient().rpc("admin_quote_queue");
    if (result.error) { setState({ mode: "error", message: result.error.message }); return; }
    const data = result.data as { items?: QueueItem[]; checked_at?: string } | null;
    setState({ mode: "ready", items: data?.items ?? [], checkedAt: data?.checked_at ?? "" });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function record(operation: () => PromiseLike<{ error: { message: string } | null }>, success: string) {
    setBusy(true);
    try {
      const result = await operation();
      if (result.error) { toast.error("Not recorded", { description: result.error.message }); throw new Error(result.error.message); }
      toast.success(success);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="quote-queue-heading" className="mb-6 rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-status-warning" />
        <h2 id="quote-queue-heading" className="text-sm font-semibold">Quote and payment exceptions</h2>
        {state.mode === "ready" && <Badge variant="outline">{state.items.length}</Badge>}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void load()} disabled={busy}><RefreshCw />Refresh</Button>
      </div>
      {state.mode === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading exceptions…</p>
      ) : state.mode === "error" ? (
        <p role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">The exception queue couldn’t be loaded: {state.message}</p>
      ) : state.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs attention. Items appear when a proposal, quote or payment passes its threshold or needs a review.</p>
      ) : (
        <ul className="divide-y" aria-label="Quote and payment exceptions">
          {state.items.map((item) => {
            const label = queueKindLabel[item.kind] ?? { title: item.kind, action: "" };
            const deadlinePassed = item.kind === "quote_decision" && item.detail.deadline_passed === true;
            return (
              <li key={`${item.kind}:${item.request_id}:${item.exception_id ?? ""}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">{label.title}
                    {item.aged && <Badge className="border-status-danger bg-status-danger-bg text-status-danger">Aged</Badge>}
                    {deadlinePassed && <Badge variant="outline">Deadline passed</Badge>}
                  </p>
                  <p className="text-muted-foreground">{item.service_type}{item.since ? ` · since ${formatEastern(item.since)}` : ""}{item.due_at ? ` · threshold ${formatEastern(item.due_at)}` : ""}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{label.action}</p>
                  {item.kind === "accepted_change" && typeof item.detail.reason === "string" && <p className="mt-1 text-xs">Requested change: {item.detail.reason}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => open(item.request_id)}>Open request</Button>
                  {(item.kind === "provider_review" || item.kind === "deposit_review") && (
                    <ConfirmAction disabled={busy} requireReason reasonLabel="Review note" triggerLabel="Record review"
                      title={item.kind === "provider_review" ? "Record the provider review?" : "Record the deposit review?"} entity={item.service_type}
                      consequence={item.kind === "provider_review"
                        ? "The flag clears for this provider. The assignment, job and payments are not changed."
                        : "The quote will carry a $0 deposit. Existing deposit records are not changed."}
                      confirmLabel="Record review"
                      onConfirm={(note) => record(() => createClient().rpc("admin_record_quote_review", { _job_id: item.request_id, _kind: item.kind, _note: note }), "Review recorded.")} />
                  )}
                  {item.kind === "accepted_change" && item.exception_id && (
                    <ConfirmAction disabled={busy} requireReason reasonLabel="Resolution" triggerLabel="Close exception"
                      title="Close this exception?" entity={item.service_type}
                      consequence="Record how it was resolved. Accepted terms stay as agreed."
                      confirmLabel="Close exception"
                      onConfirm={(note) => record(() => createClient().rpc("admin_close_quote_exception", { _exception_id: item.exception_id!, _resolution: note }), "Exception closed.")} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
