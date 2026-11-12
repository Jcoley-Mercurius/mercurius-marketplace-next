"use client";

// Phase 7.2B / TRACE-153: the vendor notification readback. Homeowners keep useNotifications.
//
// - Reads only rows where user_id = the signed-in account (RLS enforces the same).
// - Newest first by (created_at desc, id desc), paged by a keyset cursor on that pair, so rows that
//   share a timestamp are neither skipped nor repeated, and every historical row is reachable through
//   "Load older" (DEC-2026-065 item 1: no cutoff).
// - The unread count is an exact count over the caller's whole history, not over the loaded rows.
// - read_at is set only where it is still null, only on the caller's rows, and only on the ids
//   given: one opened row, or the unread rows currently loaded and shown ("Mark visible as read").
// - Nothing is updated optimistically. After any write, success or failure, the affected rows and
//   the count are read back, so the screen shows what the database holds.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import type { AppNotification } from "@/hooks/useNotifications";
import { type NotificationCursor, notificationKeysetFilter } from "@/lib/notificationKeyset";

export const VENDOR_NOTIFICATION_PAGE_SIZE = 25;
const UPDATE_CHUNK = 100;
const COLUMNS = "id, type, severity, title, body, link, related_request_id, read_at, created_at";

export type VendorNotificationsStatus = "loading" | "ready" | "error";
export type WriteResult = { ok: true } | { ok: false };

type Cursor = NotificationCursor;

function mergeOlder(current: AppNotification[], older: AppNotification[]) {
  const seen = new Set(current.map((row) => row.id));
  return [...current, ...older.filter((row) => !seen.has(row.id))];
}

export function useVendorNotifications(enabled: boolean) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [status, setStatus] = useState<VendorNotificationsStatus>("loading");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [countFailed, setCountFailed] = useState(false);
  const [realtimeUnavailable, setRealtimeUnavailable] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // A refresh supersedes older responses; a late page or count from before it is ignored.
  const generation = useRef(0);
  // Counts can overlap (a write and a realtime event); only the latest request's answer is applied.
  const countSeq = useRef(0);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const fetchPage = useCallback(async (owner: string, cursor: Cursor | null) => {
    let query = supabase
      .from("notifications")
      .select(COLUMNS)
      .eq("user_id", owner)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(VENDOR_NOTIFICATION_PAGE_SIZE + 1);
    if (cursor) query = query.or(notificationKeysetFilter(cursor));
    const { data, error } = await query;
    if (error) return null;
    const rows = (data ?? []) as AppNotification[];
    return { rows: rows.slice(0, VENDOR_NOTIFICATION_PAGE_SIZE), more: rows.length > VENDOR_NOTIFICATION_PAGE_SIZE };
  }, [supabase]);

  const refreshCount = useCallback(async () => {
    if (!userId || !enabled) return;
    const started = generation.current;
    const seq = ++countSeq.current;
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null);
    if (started !== generation.current || seq !== countSeq.current) return;
    if (error || typeof count !== "number") {
      setCountFailed(true);
      return;
    }
    setCountFailed(false);
    setUnreadCount(count);
  }, [enabled, supabase, userId]);

  const load = useCallback(async () => {
    if (!userId || !enabled) return;
    const started = ++generation.current;
    setStatus("loading");
    setMoreFailed(false);
    const [page] = await Promise.all([fetchPage(userId, null), refreshCount()]);
    if (started !== generation.current) return;
    if (!page) {
      setItems([]);
      setHasMore(false);
      setStatus("error");
      return;
    }
    setItems(page.rows);
    setHasMore(page.more);
    setStatus("ready");
  }, [enabled, fetchPage, refreshCount, userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Resolves to the rows added (and the first of them, to move focus to), or null on failure.
  const loadOlder = useCallback(async (): Promise<{ added: number; firstId: string | null } | null> => {
    const last = itemsRef.current.at(-1);
    if (!userId || !enabled || !last || loadingMore) return null;
    const started = generation.current;
    setLoadingMore(true);
    setMoreFailed(false);
    const page = await fetchPage(userId, { created_at: last.created_at, id: last.id });
    setLoadingMore(false);
    if (started !== generation.current) return null;
    if (!page) {
      setMoreFailed(true);
      return null;
    }
    const seen = new Set(itemsRef.current.map((row) => row.id));
    const fresh = page.rows.filter((row) => !seen.has(row.id));
    setItems((current) => mergeOlder(current, page.rows));
    setHasMore(page.more);
    return { added: fresh.length, firstId: fresh[0]?.id ?? null };
  }, [enabled, fetchPage, loadingMore, userId]);

  // Read back the given rows and apply what the database holds (a row no longer returned was deleted).
  const reconcile = useCallback(async (ids: string[]) => {
    if (!userId || ids.length === 0) return;
    const fresh = new Map<string, AppNotification>();
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const chunk = ids.slice(i, i + UPDATE_CHUNK);
      const { data, error } = await supabase.from("notifications").select(COLUMNS).eq("user_id", userId).in("id", chunk);
      if (error) return;
      for (const row of (data ?? []) as AppNotification[]) fresh.set(row.id, row);
    }
    const asked = new Set(ids);
    setItems((current) => current.flatMap((row) => {
      if (!asked.has(row.id)) return [row];
      const next = fresh.get(row.id);
      return next ? [{ ...row, read_at: next.read_at }] : [];
    }));
  }, [supabase, userId]);

  const markIds = useCallback(async (ids: string[]): Promise<WriteResult> => {
    if (!userId || !enabled) return { ok: false };
    const now = new Date().toISOString();
    const updated = new Map<string, string | null>();
    let failed = false;
    for (let i = 0; i < ids.length && !failed; i += UPDATE_CHUNK) {
      const chunk = ids.slice(i, i + UPDATE_CHUNK);
      const { data, error } = await supabase
        .from("notifications")
        .update({ read_at: now })
        .eq("user_id", userId)
        .in("id", chunk)
        .is("read_at", null)
        .select("id, read_at");
      if (error) failed = true;
      else for (const row of (data ?? []) as Array<{ id: string; read_at: string | null }>) updated.set(row.id, row.read_at);
    }
    if (updated.size > 0) {
      setItems((current) => current.map((row) => (updated.has(row.id) ? { ...row, read_at: updated.get(row.id) ?? row.read_at } : row)));
    }
    // Rows not returned were already read elsewhere, were deleted, or the write failed: read them back.
    const unresolved = ids.filter((id) => !updated.has(id));
    await Promise.all([reconcile(unresolved), refreshCount()]);
    return failed ? { ok: false } : { ok: true };
  }, [enabled, reconcile, refreshCount, supabase, userId]);

  const markRead = useCallback(async (id: string): Promise<WriteResult> => {
    const row = itemsRef.current.find((item) => item.id === id);
    if (!row || row.read_at) return { ok: true };
    setBusyIds((current) => new Set(current).add(id));
    try {
      return await markIds([id]);
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }, [markIds]);

  const markVisibleRead = useCallback(async (): Promise<WriteResult> => {
    const ids = itemsRef.current.filter((row) => !row.read_at).map((row) => row.id);
    if (ids.length === 0) return { ok: true };
    setBulkBusy(true);
    try {
      return await markIds(ids);
    } finally {
      setBulkBusy(false);
    }
  }, [markIds]);

  useEffect(() => {
    if (!userId || !enabled) return;
    const channel = supabase
      .channel(`vendor-notifications:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (payload) => {
        if (payload.eventType === "INSERT") {
          const row = payload.new as AppNotification;
          setItems((current) => (current.some((item) => item.id === row.id) ? current : [row, ...current]));
        } else if (payload.eventType === "UPDATE") {
          const row = payload.new as AppNotification;
          setItems((current) => current.map((item) => (item.id === row.id ? { ...item, read_at: row.read_at } : item)));
        } else if (payload.eventType === "DELETE") {
          const row = payload.old as { id?: string };
          setItems((current) => current.filter((item) => item.id !== row.id));
        }
        void refreshCount();
      })
      .subscribe((state) => {
        if (state === "SUBSCRIBED") setRealtimeUnavailable(false);
        if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") setRealtimeUnavailable(true);
      });
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, refreshCount, supabase, userId]);

  const visibleUnread = items.reduce((count, row) => count + (row.read_at ? 0 : 1), 0);

  return {
    items,
    status,
    hasMore,
    loadingMore,
    moreFailed,
    unreadCount,
    countFailed,
    visibleUnread,
    realtimeUnavailable,
    busyIds,
    bulkBusy,
    refresh: load,
    refreshCount,
    loadOlder,
    markRead,
    markVisibleRead,
  };
}
