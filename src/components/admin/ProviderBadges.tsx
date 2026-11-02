"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { adminActionError } from "@/lib/adminOperations";
import { cn } from "@/lib/utils";

export const PROVIDER_BADGES = ["Licensed", "Insured", "Background Checked", "24/7 Available", "Emergency Services", "Eco-Friendly", "Satisfaction Guaranteed", "Top Rated"] as const;

type HistoryEntry = { before: string[]; after: string[]; reason: string; created_at: string; actor_name: string };

/**
 * DEC-2026-057 item 4: badges stay operator-managed (DEC-2026-047) through admin_set_provider_badges,
 * which takes a reason, refuses a change made from an out-of-date read and records before/after.
 */
export function ProviderBadges({ contractorId, badges, onSaved }: { contractorId: string; badges: string[]; onSaved: (badges: string[]) => void }) {
  const [draft, setDraft] = useState<string[]>(badges);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const key = useRef<{ fingerprint: string; key: string } | null>(null);
  const changed = [...draft].sort().join("|") !== [...badges].sort().join("|");

  const loadHistory = useCallback(async () => {
    const result = await createClient().rpc("admin_provider_badge_history", { p_contractor: contractorId });
    setHistory(result.error ? [] : ((result.data ?? []) as HistoryEntry[]));
  }, [contractorId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory();
  }, [loadHistory]);

  const save = async () => {
    if (!changed || !reason.trim() || saving) return;
    const fingerprint = JSON.stringify([badges, draft, reason.trim()]);
    if (key.current?.fingerprint !== fingerprint) key.current = { fingerprint, key: crypto.randomUUID() };
    setSaving(true);
    setError("");
    const result = await createClient().rpc("admin_set_provider_badges", { p_contractor: contractorId, p_expected_badges: badges, p_badges: draft, p_reason: reason.trim(), p_key: key.current.key });
    setSaving(false);
    if (result.error) { setError(adminActionError(result.error, "This provider’s badges changed since you opened them — review the current badges.")); return; }
    key.current = null;
    setReason("");
    onSaved(((result.data as { badges?: string[] } | null)?.badges) ?? draft);
    await loadHistory();
  };

  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-4 w-4" />Credentials</CardTitle><CardDescription>Badge changes are saved on their own, with a reason, and kept in the history below.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Badges">{PROVIDER_BADGES.map((badge) => { const checked = draft.includes(badge); return <button key={badge} type="button" aria-pressed={checked} onClick={() => setDraft(checked ? draft.filter((item) => item !== badge) : [...draft, badge])} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition-colors", checked ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-border bg-muted text-muted-foreground hover:border-emerald-300")}>{badge}</button>; })}</div>
      {changed && <>
        <FormField label="Reason" required help="For example, the license or insurance document you checked.">{(control) => <Textarea {...control} rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />}</FormField>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2"><Button size="sm" disabled={saving || !reason.trim()} onClick={() => void save()}>{saving && <Loader2 className="animate-spin" />}Save badges</Button><Button size="sm" variant="outline" disabled={saving} onClick={() => { setDraft(badges); setReason(""); setError(""); }}>Cancel</Button></div>
      </>}
      {history.length > 0 && <ol className="space-y-1 border-t pt-3 text-xs text-muted-foreground">{history.slice(0, 10).map((entry, index) => <li key={`${entry.created_at}:${index}`}>{(entry.after.length ? entry.after.join(", ") : "No badges")} · {entry.actor_name} · {formatDateTime(entry.created_at)} · “{entry.reason}”</li>)}</ol>}
    </CardContent>
  </Card>;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(date) + " Eastern";
}
