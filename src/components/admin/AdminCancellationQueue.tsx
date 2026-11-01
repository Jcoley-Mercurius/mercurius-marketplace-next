"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { authorizationText, entitlementText, movementText, type CancellationOutcome } from "@/lib/cancellation";

type Item = CancellationOutcome & { service_type: string; customer_name: string | null };

/**
 * TRACE-131: cancelled or withdrawn services with payment work outstanding — an open checkout, a
 * payment after cancellation, a refund not yet authorized, failed or unknown, or a replacement
 * decision. Read-only: refunds are requested through the reviewed finance commands.
 */
export function AdminCancellationQueue() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    const result = await createClient().rpc("admin_cancellation_queue");
    if (result.error) { setError("The cancellation follow-up list could not be loaded."); return; }
    setItems(((result.data as { items?: Item[] } | null)?.items) ?? []);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return <section aria-labelledby="cancellation-follow-up" className="space-y-3 rounded-xl border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="cancellation-follow-up" className="font-heading text-lg font-semibold">Cancellation follow-up</h2>
      <Button type="button" variant="outline" onClick={() => void load()}>Refresh</Button>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p>
      : items === null ? <p className="text-sm text-muted-foreground">Loading…</p>
        : items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing needs payment follow-up.</p>
          : <ul className="space-y-3">{items.map(item => <li key={item.job_id} className="rounded-lg border p-3 text-sm">
            <p className="font-medium">{item.service_type} · {item.job_id.slice(0, 8)}{item.customer_name ? ` · ${item.customer_name}` : ""}</p>
            <p className="text-muted-foreground">{[entitlementText(item), authorizationText(item), movementText(item)].filter(Boolean).join(" ")}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">{item.follow_up?.map(entry => <li key={entry.code}>{entry.message}</li>)}</ul>
          </li>)}</ul>}
  </section>;
}
