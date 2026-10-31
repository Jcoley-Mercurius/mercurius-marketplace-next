"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type QualityEvent = {
  operation_id: string; job_id: string; service_type: string; contractor_name: string; kind: "provider_cancel" | "no_show";
  reason: string; created_at: string; classification: "recorded" | "excused" | "reported_unconfirmed";
  recorded_by: "operations" | "provider" | "homeowner";
};

const classification = {
  recorded: "Quality event",
  excused: "Excused by operations",
  reported_unconfirmed: "Reported, not confirmed",
} as const;

/**
 * TRACE-131 / CFG-007: provider cancellations and no-shows, for operations to see. Display only
 * (DEC-2026-053 E10): no score, ranking, matching or penalty follows from this list.
 */
export function ProviderQualityEvents() {
  const [items, setItems] = useState<QualityEvent[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    const result = await createClient().rpc("admin_provider_quality_events");
    if (result.error) { setError("Provider quality events could not be loaded."); return; }
    setItems(((result.data as { items?: QualityEvent[] } | null)?.items) ?? []);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return <section aria-labelledby="provider-quality-events" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 id="provider-quality-events" className="font-semibold">Provider cancellations and no-shows</h2>
      <Button type="button" variant="outline" onClick={() => void load()}>Refresh</Button>
    </div>
    <p className="text-sm text-muted-foreground">Recorded for review only. Nothing here changes a provider’s ranking, matching or standing.</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p>
      : items === null ? <p className="text-sm text-muted-foreground">Loading…</p>
        : items.length === 0 ? <p className="text-sm text-muted-foreground">No provider cancellations or no-shows recorded.</p>
          : <ul className="space-y-3">{items.map(item => <li key={item.operation_id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{item.contractor_name}</p>
              <Badge variant="outline">{classification[item.classification]}</Badge>
            </div>
            <p className="mt-1">{item.kind === "provider_cancel" ? "Provider cancelled" : "No-show"} · {item.service_type} · reported by {item.recorded_by}</p>
            <p className="mt-1 text-muted-foreground">{item.reason}</p>
            <p className="mt-1 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET</p>
          </li>)}</ul>}
  </section>;
}
