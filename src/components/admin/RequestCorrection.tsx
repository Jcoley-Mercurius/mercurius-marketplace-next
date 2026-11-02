"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { adminActionError, isCorrectableRequest } from "@/lib/adminOperations";

type Request = {
  id: string; status: string; updated_at: string; address: string; city: string; state: string; zip_code: string | null;
  description: string | null; contractor_id: string | null; matching_status: string; current_quote_id?: string | null;
  quote_status?: string | null; total_amount: number | null; quote_amount: number | null; payment_status: string;
};
type HistoryEntry = { action: string; reason: string; created_at: string; actor_name: string; result: Record<string, unknown> };

/**
 * TRACE-136 (DEC-2026-057 item 5): an operator corrects address or scope only before any offer,
 * quote or commercial binding. The server binds the correction to the version read here,
 * revalidates coverage and the service under the row lock, and records before and after.
 * After a binding, no correction is offered: agreed property and scope need a change workflow.
 */
export function RequestCorrection({ request, onSaved }: { request: Request; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => fromRequest(request));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const key = useRef<{ fingerprint: string; key: string } | null>(null);
  const correctable = isCorrectableRequest(request);

  const loadHistory = useCallback(async () => {
    const result = await createClient().rpc("admin_request_action_history", { p_request: request.id });
    setHistory(result.error ? [] : ((result.data ?? []) as HistoryEntry[]));
  }, [request.id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadHistory();
  }, [loadHistory, request.updated_at]);

  const submit = async () => {
    if (saving || !reason.trim()) return;
    const fingerprint = JSON.stringify([request.updated_at, form, reason.trim()]);
    if (key.current?.fingerprint !== fingerprint) key.current = { fingerprint, key: crypto.randomUUID() };
    setSaving(true);
    setError("");
    const result = await createClient().rpc("admin_correct_request_details", {
      p_request: request.id, p_expected_updated_at: request.updated_at, p_key: key.current.key,
      p_address: form.address, p_city: form.city, p_state: form.state, p_zip_code: form.zip_code, p_description: form.description, p_reason: reason.trim(),
    });
    setSaving(false);
    if (result.error) { setError(adminActionError(result.error)); return; }
    key.current = null;
    setEditing(false);
    setReason("");
    onSaved();
  };

  return <section aria-labelledby={`correction-${request.id}`} className="space-y-3 rounded-xl border p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={`correction-${request.id}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Address and scope</h3>
      {correctable && !editing && <Button size="sm" variant="outline" onClick={() => { setForm(fromRequest(request)); setError(""); setEditing(true); }}><Pencil />Correct details</Button>}
    </div>
    {!correctable && <p className="text-sm text-muted-foreground">This request already has an offer, quote, payment or price, so its address and scope can’t be changed here. A change to agreed details needs a change request with the homeowner and provider.</p>}
    {editing && <div className="space-y-3">
      <FormField label="Street address" required>{(control) => <Input {...control} value={form.address} maxLength={200} onChange={(event) => setForm({ ...form, address: event.target.value })} />}</FormField>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="City" required>{(control) => <Input {...control} value={form.city} maxLength={100} onChange={(event) => setForm({ ...form, city: event.target.value })} />}</FormField>
        <FormField label="State" required>{(control) => <Input {...control} value={form.state} maxLength={2} onChange={(event) => setForm({ ...form, state: event.target.value.toUpperCase() })} />}</FormField>
        <FormField label="ZIP code" required help="Must be in the Lee County service area.">{(control) => <Input {...control} inputMode="numeric" value={form.zip_code} maxLength={5} onChange={(event) => setForm({ ...form, zip_code: event.target.value })} />}</FormField>
      </div>
      <FormField label="Customer scope">{(control) => <Textarea {...control} rows={3} maxLength={5000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />}</FormField>
      <FormField label="Reason" required help="Recorded with the before and after values. Nobody is notified automatically.">{(control) => <Textarea {...control} rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />}</FormField>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
        <Button disabled={saving || !reason.trim()} onClick={() => void submit()}>{saving && <Loader2 className="animate-spin" />}Save correction</Button>
      </div>
    </div>}
    {history && history.length > 0 && <div>
      <h4 className="mb-1 text-xs font-medium text-muted-foreground">Operator changes</h4>
      <ol className="space-y-1 text-xs text-muted-foreground">{history.map((entry, index) => <li key={`${entry.created_at}:${index}`}>
        {entry.action === "status_change" ? `Status ${label(String(entry.result.from_status ?? ""))} → ${label(String(entry.result.status ?? ""))}` : "Address or scope corrected"} · {entry.actor_name} · {formatDateTime(entry.created_at)} · “{entry.reason}”
      </li>)}</ol>
    </div>}
  </section>;
}

function fromRequest(request: Request) {
  return { address: request.address, city: request.city, state: request.state, zip_code: request.zip_code ?? "", description: request.description ?? "" };
}
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(date) + " Eastern";
}
