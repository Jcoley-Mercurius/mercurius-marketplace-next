"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { adminActionError } from "@/lib/adminOperations";

type Note = { id: number; body: string; created_at: string; author_name: string };
type Loaded = { legacy: string | null; notes: Note[] };

/**
 * TRACE-136 (DEC-2026-057 item 8): operator notes are append-only and readable by operators only
 * (admin_request_notes / admin_add_request_note). The legacy shared notes field is shown read-only
 * with its history: it was readable by the homeowner and provider until 6.13 closed that access.
 */
export function RequestOperatorNotes({ requestId }: { requestId: string }) {
  const [state, setState] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const key = useRef<{ body: string; key: string } | null>(null);

  const load = useCallback(async () => {
    setError("");
    const result = await createClient().rpc("admin_request_notes", { p_request: requestId });
    if (result.error) { setError(adminActionError(result.error)); return; }
    const data = (result.data ?? {}) as { legacy_note?: string | null; notes?: Note[] };
    setState({ legacy: data.legacy_note ?? null, notes: data.notes ?? [] });
  }, [requestId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const save = async () => {
    const body = text.trim();
    if (!body || saving) return;
    if (key.current?.body !== body) key.current = { body, key: crypto.randomUUID() };
    setSaving(true);
    setSaveError("");
    const result = await createClient().rpc("admin_add_request_note", { p_request: requestId, p_key: key.current.key, p_body: body });
    setSaving(false);
    if (result.error) { setSaveError(adminActionError(result.error)); return; }
    key.current = null;
    setText("");
    await load();
  };

  return <section aria-labelledby={`operator-notes-${requestId}`} className="space-y-3 rounded-xl border p-4">
    <div>
      <h3 id={`operator-notes-${requestId}`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal notes</h3>
      <p className="mt-1 text-xs text-muted-foreground">Visible to Mercurius operators only. Notes can’t be edited or deleted once saved.</p>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">Notes unavailable: {error}</p>
      : state === null ? <p role="status" className="text-sm text-muted-foreground">Loading notes…</p>
        : <>
          {state.notes.length === 0 ? <p className="text-sm text-muted-foreground">No operator notes yet.</p>
            : <ol className="space-y-2">{state.notes.map((note) => <li key={note.id} className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="whitespace-pre-wrap break-words">{note.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">{note.author_name} · {formatDateTime(note.created_at)}</p>
            </li>)}</ol>}
          {state.legacy && <div className="rounded-lg border border-status-warning bg-status-warning-bg p-3 text-sm">
            <p className="text-xs font-semibold text-status-warning">Earlier shared note (read-only)</p>
            <p className="mt-1 whitespace-pre-wrap break-words">{state.legacy}</p>
            <p className="mt-1 text-xs text-muted-foreground">Saved in the request’s shared notes field, which the homeowner and provider could read until operator notes were separated. Its author isn’t recorded.</p>
          </div>}
        </>}
    <div>
      <label htmlFor={`operator-note-${requestId}`} className="sr-only">New internal note</label>
      <Textarea id={`operator-note-${requestId}`} rows={3} maxLength={4000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Add an operator-only note…" />
      {saveError && <p role="alert" className="mt-2 text-sm text-destructive">{saveError}</p>}
      <Button size="sm" className="mt-2" disabled={saving || !text.trim()} onClick={() => void save()}>{saving ? <Loader2 className="animate-spin" /> : <Save />}Add note</Button>
    </div>
  </section>;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(date) + " Eastern";
}
