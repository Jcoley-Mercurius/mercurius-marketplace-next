"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCheck, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { formatEastern } from "@/lib/offerStatus";
import { queueItemCopy, type FulfillmentQueueItem } from "@/lib/fulfillment";
import { createClient } from "@/lib/supabase/client";

type State = { mode: "loading" } | { mode: "error"; message: string } | { mode: "ready"; items: FulfillmentQueueItem[] };

// TRACE-128: completions unanswered past the 72-hour review time, open no-show /
// unable-to-complete / homeowner-unavailable / partial-completion reports, and completions without
// recorded evidence. Recording a follow-up closes the item; it changes no state, charges, refunds
// or messages nobody.
export function AdminFulfillmentQueue({ open }: { open: (requestId: string) => void }) {
  const [state, setState] = useState<State>({ mode: "loading" });
  const keys = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    const result = await createClient().rpc("admin_fulfillment_queue");
    if (result.error) { setState({ mode: "error", message: result.error.message }); return; }
    const data = result.data as { items?: FulfillmentQueueItem[] } | null;
    setState({ mode: "ready", items: data?.items ?? [] });
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function followUp(item: FulfillmentQueueItem, reason: string) {
    const intent = JSON.stringify([item.request_id, item.kind, item.since, reason]);
    let key = keys.current.get(intent);
    if (!key) { key = crypto.randomUUID(); keys.current.set(intent, key); }
    const result = await createClient().rpc("admin_record_fulfillment_follow_up", { _job_id: item.request_id, _operation_key: key, _item: item.kind, _reason: reason });
    await load();
    if (result.error) throw result.error;
  }

  return (
    <section aria-labelledby="fulfillment-queue-heading" className="mb-6 rounded-xl border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-status-warning" aria-hidden />
        <h2 id="fulfillment-queue-heading" className="text-sm font-semibold">Work and completion follow-up</h2>
        {state.mode === "ready" && <Badge variant="outline">{state.items.length}</Badge>}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}><RefreshCw />Refresh</Button>
      </div>
      {state.mode === "loading" ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading follow-ups…</p>
      ) : state.mode === "error" ? (
        <p role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">Follow-ups couldn’t be loaded: {state.message}</p>
      ) : state.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs follow-up. Unanswered completions appear 72 hours after the homeowner was asked to confirm; service exceptions appear when they’re reported.</p>
      ) : (
        <ul className="divide-y" aria-label="Work and completion follow-up">
          {state.items.map((item) => {
            const copy = queueItemCopy(item);
            const entity = `${item.service_type} · ${item.request_id.slice(0, 8)}`;
            return (
              <li key={`${item.kind}:${item.request_id}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{copy.title}</p>
                  <p className="text-muted-foreground">{item.service_type}{item.series_id ? " · recurring visit" : ""} · since {formatEastern(item.since)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{copy.action}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => open(item.request_id)}>Open request</Button>
                  <ConfirmAction requireReason triggerLabel="Record follow-up" title="Record your follow-up?" entity={entity}
                    reasonLabel="What you did or agreed" reasonHelp="Visible to operations in the request history."
                    consequence="This closes the item until something new happens. It doesn’t change the service, charge, refund or message anyone."
                    confirmLabel="Record follow-up" confirmationTone="commitment" onConfirm={reason => followUp(item, reason)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
