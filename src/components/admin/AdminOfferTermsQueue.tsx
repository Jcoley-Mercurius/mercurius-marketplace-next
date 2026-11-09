"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/offerTerms";

type Item = {
  kind: "unanswered" | "not_acceptable" | "blocked_inactive" | "rematch_failed";
  request_id: string;
  since: string;
  problem?: string | null;
  total_cents?: number | null;
};

const problems: Record<string, string> = {
  provider_inactive: "the provider is suspended or off the marketplace",
  provider_not_matchable: "the provider can no longer be matched",
  provider_zip: "the provider no longer covers this ZIP",
  coverage_inactive: "the ZIP is no longer covered",
  service_inactive: "the service is no longer offered",
  package_unavailable: "the provider no longer offers this offering",
  package_in_review: "the offering is held in Package Reviews",
  answers_mismatch: "the answers no longer fit this level",
  answers_missing: "a required answer is missing",
};

/** Whether operations can retry matching for this item now (the server enforces the same rule). */
export function canRetryOfferTerms(item: Pick<Item, "kind">, active: boolean | null) {
  if (item.kind === "rematch_failed") return true;
  return item.kind === "blocked_inactive" && Boolean(active);
}

export function itemText(item: Item) {
  if (item.kind === "blocked_inactive") {
    return "Left without an offer while offers at other terms were off. Retry matching once they're active.";
  }
  if (item.kind === "rematch_failed") {
    return "The homeowner declined the provider's terms and the decline is recorded, but finding the next provider failed. No provider is assigned. Retry matching.";
  }
  const total = typeof item.total_cents === "number" ? ` (${formatCents(item.total_cents)})` : "";
  if (item.kind === "not_acceptable") {
    return `The homeowner can't accept the provider's terms${total}: ${problems[item.problem ?? ""] ?? item.problem ?? "the terms no longer pass the live checks"}. They can still decline.`;
  }
  return `The provider's terms${total} have waited more than 24 hours for the homeowner. Nothing changes automatically.`;
}

/**
 * TRACE-150 (DEC-2026-063, O-11): offers at other terms that need operations. Unanswered terms after
 * 24 hours and terms the homeowner can no longer accept are shown for follow-up; nothing changes
 * automatically. Requests left without an offer while the offer_terms gate was off can be retried
 * after activation (keyed, with a reason). A decline whose next matching run failed keeps the decline
 * and can be retried at any time (review of #154, finding 1).
 */
export function AdminOfferTermsQueue({ open }: { open?: (id: string) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [active, setActive] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const keys = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    setError("");
    const result = await createClient().rpc("admin_offer_terms_queue");
    if (result.error) { setError("The offer terms list could not be loaded."); return; }
    const data = result.data as { items?: Item[]; active?: boolean } | null;
    setItems(data?.items ?? []);
    setActive(Boolean(data?.active));
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function retry(item: Item, reason: string) {
    const intent = `${item.request_id}:${reason}`;
    let key = keys.current.get(intent);
    if (!key) { key = crypto.randomUUID(); keys.current.set(intent, key); }
    const result = await createClient().rpc("admin_retry_offer_terms_matching", { _request_id: item.request_id, _retry_key: key, _reason: reason });
    if (result.error) throw new Error(result.error.message);
    keys.current.delete(intent);
    await load();
  }

  return <section aria-labelledby="offer-terms-follow-up" className="space-y-3 rounded-xl border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="offer-terms-follow-up" className="font-heading text-lg font-semibold">Offers at other terms</h2>
        {items !== null && !error && <Badge variant="outline">{items.length}</Badge>}
        {active !== null && <span className="text-xs text-muted-foreground">{active ? "Active" : "Off: no offer at other terms is made"}</span>}
      </div>
      <Button type="button" variant="outline" onClick={() => void load()}>Refresh</Button>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p>
      : items === null ? <p className="text-sm text-muted-foreground">Loading…</p>
        : items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing needs follow-up.</p>
          : <ul className="space-y-3">{items.map(item => <li key={`${item.kind}:${item.request_id}`} className="rounded-lg border p-3 text-sm">
            <p className="font-medium">Request {item.request_id.slice(0, 8)}</p>
            <p className="text-muted-foreground">{itemText(item)}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {open && <Button type="button" size="sm" variant="outline" aria-label={`Open request ${item.request_id.slice(0, 8)}`} onClick={() => open(item.request_id)}>Open request</Button>}
              {(item.kind === "blocked_inactive" || item.kind === "rematch_failed") && <ConfirmAction requireReason disabled={!canRetryOfferTerms(item, active)} triggerLabel="Retry matching" title="Retry matching for this request?"
                entity={`Request ${item.request_id.slice(0, 8)}`}
                consequence="Matching runs again. Another provider may be offered this request at its own terms; the homeowner accepts them before anything is scheduled or charged."
                confirmLabel="Retry matching" confirmationTone="commitment" onConfirm={reason => retry(item, reason)} />}
            </div>
          </li>)}</ul>}
  </section>;
}
