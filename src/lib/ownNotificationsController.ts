// The own-account notification readback state: the vendor page (Phase 7.2B / TRACE-153) and the admin
// page (Phase 7.5E / TRACE-159), through useOwnNotifications. Homeowners keep useNotifications.
//
// - Reads only rows where user_id = the owner account. For a vendor, RLS enforces the same. For an
//   admin it does not: the "Admins can view all notifications" policy lets an admin read every
//   account's rows, so the explicit user_id filter on every read, count, write and realtime
//   subscription below is what keeps an operator to their own notices.
// - State belongs to one owner. Changing the owner (another account signs in, the account signs out,
//   or the page is disabled or unmounted) starts a new epoch: the state is reset at once, the realtime
//   subscription is replaced, and every request, write and realtime callback started under the old
//   epoch is discarded when it completes. A write that completes under a new epoch reports "stale",
//   so the caller shows no feedback and does not navigate.
// - Newest first by (created_at desc, id desc), paged by a keyset cursor on that pair, so rows that
//   share a timestamp are neither skipped nor repeated, and every historical row is reachable through
//   "Load older" (no cutoff).
// - The unread count is an exact count over the owner's whole history, not over the loaded rows.
// - read_at is set only where it is still null, only on the owner's rows, and only on the ids given.
// - Nothing is updated optimistically. A failed write response does not show the write failed: it may
//   have committed. The rows the response did not confirm are read back; only a successful readback
//   establishes their state. If the readback fails too, the outcome is "unknown".

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { AppNotification } from "@/hooks/useNotifications";
import { type NotificationCursor, notificationKeysetFilter } from "@/lib/notificationKeyset";

export const OWN_NOTIFICATION_PAGE_SIZE = 25;
export const OWN_NOTIFICATION_UPDATE_CHUNK = 100;
const COLUMNS = "id, type, severity, title, body, link, related_request_id, read_at, created_at";

export type OwnNotificationsStatus = "loading" | "ready" | "error";
export type OwnNotificationsChannel = "vendor-notifications" | "admin-notifications";

// read: every requested row is read now (confirmed by the write or by a readback), or no longer exists.
// unread: a successful readback shows `remaining` requested rows still unread.
// unknown: the write response and the readback together do not establish the rows' state.
// stale: the owner changed before the outcome was known; nothing of it may be shown.
export type MarkOutcome =
  | { kind: "read" }
  | { kind: "unread"; remaining: number }
  | { kind: "unknown" }
  | { kind: "stale" };

export type OlderResult = { added: number; firstId: string | null };

export type OwnNotificationsState = {
  owner: string | null;
  items: readonly AppNotification[];
  status: OwnNotificationsStatus;
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  unreadCount: number | null;
  countFailed: boolean;
  realtimeUnavailable: boolean;
  busyIds: ReadonlySet<string>;
  bulkBusy: boolean;
};

const NO_ITEMS: readonly AppNotification[] = Object.freeze([]);
const NO_IDS: ReadonlySet<string> = new Set();
const READ: MarkOutcome = { kind: "read" };
const UNKNOWN: MarkOutcome = { kind: "unknown" };
const STALE: MarkOutcome = { kind: "stale" };

export function initialOwnNotificationsState(owner: string | null): OwnNotificationsState {
  return {
    owner,
    items: NO_ITEMS,
    status: "loading",
    hasMore: false,
    loadingMore: false,
    moreFailed: false,
    unreadCount: null,
    countFailed: false,
    realtimeUnavailable: false,
    busyIds: NO_IDS,
    bulkBusy: false,
  };
}

function mergeOlder(current: readonly AppNotification[], older: AppNotification[]) {
  const seen = new Set(current.map((row) => row.id));
  return [...current, ...older.filter((row) => !seen.has(row.id))];
}

type Readback = { ok: true; unread: number } | { ok: false } | "stale";

export class OwnNotificationsController {
  private state: OwnNotificationsState = initialOwnNotificationsState(null);
  private readonly listeners = new Set<() => void>();
  // Bumped on every owner change: work started under an older epoch is discarded.
  private epoch = 0;
  // Bumped on every owner change and every (re)load: a late page or count from before it is ignored.
  private generation = 0;
  // Counts can overlap (a write and a realtime event); only the latest request's answer is applied.
  private countSeq = 0;
  private channel: RealtimeChannel | null = null;

  constructor(private readonly client: SupabaseClient, private readonly channelPrefix: OwnNotificationsChannel) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = () => this.state;

  private update(patch: Partial<OwnNotificationsState> | ((state: OwnNotificationsState) => Partial<OwnNotificationsState>)) {
    const next = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }

  private current(epoch: number) {
    return epoch === this.epoch;
  }

  // null signs the controller out: nothing is shown, read or subscribed until an owner is set again.
  setOwner(owner: string | null) {
    if (owner === this.state.owner) return;
    this.epoch += 1;
    this.generation += 1;
    this.countSeq += 1;
    if (this.channel) {
      void this.client.removeChannel(this.channel);
      this.channel = null;
    }
    this.state = initialOwnNotificationsState(owner);
    for (const listener of this.listeners) listener();
    if (owner) {
      this.subscribeRealtime(owner, this.epoch);
      void this.load();
    }
  }

  private async fetchPage(owner: string, cursor: NotificationCursor | null) {
    let query = this.client
      .from("notifications")
      .select(COLUMNS)
      .eq("user_id", owner)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(OWN_NOTIFICATION_PAGE_SIZE + 1);
    if (cursor) query = query.or(notificationKeysetFilter(cursor));
    const { data, error } = await query;
    if (error) return null;
    const rows = (data ?? []) as AppNotification[];
    return { rows: rows.slice(0, OWN_NOTIFICATION_PAGE_SIZE), more: rows.length > OWN_NOTIFICATION_PAGE_SIZE };
  }

  refreshCount = async () => {
    const owner = this.state.owner;
    if (!owner) return;
    const epoch = this.epoch;
    const started = this.generation;
    const seq = ++this.countSeq;
    const { count, error } = await this.client
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", owner)
      .is("read_at", null);
    if (!this.current(epoch) || started !== this.generation || seq !== this.countSeq) return;
    if (error || typeof count !== "number") {
      this.update({ countFailed: true });
      return;
    }
    this.update({ countFailed: false, unreadCount: count });
  };

  load = async () => {
    const owner = this.state.owner;
    if (!owner) return;
    const epoch = this.epoch;
    const started = ++this.generation;
    this.update({ status: "loading", moreFailed: false });
    const [page] = await Promise.all([this.fetchPage(owner, null), this.refreshCount()]);
    if (!this.current(epoch) || started !== this.generation) return;
    if (!page) {
      this.update({ items: NO_ITEMS, hasMore: false, status: "error" });
      return;
    }
    this.update({ items: page.rows, hasMore: page.more, status: "ready" });
  };

  // Resolves to the rows added (and the first of them, to move focus to), or null on failure, when
  // superseded, or when the owner changed.
  loadOlder = async (): Promise<OlderResult | null> => {
    const owner = this.state.owner;
    const last = this.state.items.at(-1);
    if (!owner || !last || this.state.loadingMore) return null;
    const epoch = this.epoch;
    const started = this.generation;
    this.update({ loadingMore: true, moreFailed: false });
    const page = await this.fetchPage(owner, { created_at: last.created_at, id: last.id });
    if (!this.current(epoch)) return null;
    this.update({ loadingMore: false });
    if (started !== this.generation) return null;
    if (!page) {
      this.update({ moreFailed: true });
      return null;
    }
    const seen = new Set(this.state.items.map((row) => row.id));
    const fresh = page.rows.filter((row) => !seen.has(row.id));
    this.update((state) => ({ items: mergeOlder(state.items, page.rows), hasMore: page.more }));
    return { added: fresh.length, firstId: fresh[0]?.id ?? null };
  };

  // Read the given rows back and apply what the database holds for every chunk that was read (a row
  // no longer returned was deleted). Any failed chunk makes the readback incomplete.
  private async readBack(owner: string, epoch: number, ids: string[]): Promise<Readback> {
    if (ids.length === 0) return { ok: true, unread: 0 };
    const fresh = new Map<string, AppNotification>();
    const answered = new Set<string>();
    let failed = false;
    for (let i = 0; i < ids.length; i += OWN_NOTIFICATION_UPDATE_CHUNK) {
      const chunk = ids.slice(i, i + OWN_NOTIFICATION_UPDATE_CHUNK);
      const { data, error } = await this.client.from("notifications").select(COLUMNS).eq("user_id", owner).in("id", chunk);
      if (!this.current(epoch)) return "stale";
      if (error) {
        failed = true;
        continue;
      }
      for (const id of chunk) answered.add(id);
      for (const row of (data ?? []) as AppNotification[]) fresh.set(row.id, row);
    }
    if (answered.size > 0) {
      this.update((state) => ({
        items: state.items.flatMap((row) => {
          if (!answered.has(row.id)) return [row];
          const next = fresh.get(row.id);
          return next ? [{ ...row, read_at: next.read_at }] : [];
        }),
      }));
    }
    if (failed) return { ok: false };
    let unread = 0;
    for (const id of ids) if (fresh.get(id)?.read_at === null) unread += 1;
    return { ok: true, unread };
  }

  private async markIds(ids: string[]): Promise<MarkOutcome> {
    const owner = this.state.owner;
    if (!owner) return STALE;
    const epoch = this.epoch;
    const now = new Date().toISOString();
    const confirmed = new Map<string, string | null>();
    for (let i = 0; i < ids.length; i += OWN_NOTIFICATION_UPDATE_CHUNK) {
      const chunk = ids.slice(i, i + OWN_NOTIFICATION_UPDATE_CHUNK);
      const { data, error } = await this.client
        .from("notifications")
        .update({ read_at: now })
        .eq("user_id", owner)
        .in("id", chunk)
        .is("read_at", null)
        .select("id, read_at");
      if (!this.current(epoch)) return STALE;
      // The failed chunk may have committed; it and every later chunk are read back below.
      if (error) break;
      for (const row of (data ?? []) as Array<{ id: string; read_at: string | null }>) confirmed.set(row.id, row.read_at);
    }
    if (confirmed.size > 0) {
      this.update((state) => ({
        items: state.items.map((row) => (confirmed.has(row.id) ? { ...row, read_at: confirmed.get(row.id) ?? row.read_at } : row)),
      }));
    }
    // Rows not confirmed were already read elsewhere, were deleted, or their write response failed.
    const unresolved = ids.filter((id) => !confirmed.has(id));
    const [readback] = await Promise.all([this.readBack(owner, epoch, unresolved), this.refreshCount()]);
    if (readback === "stale" || !this.current(epoch)) return STALE;
    if (!readback.ok) return UNKNOWN;
    return readback.unread === 0 ? READ : { kind: "unread", remaining: readback.unread };
  }

  markRead = async (id: string): Promise<MarkOutcome> => {
    if (!this.state.owner) return STALE;
    const row = this.state.items.find((item) => item.id === id);
    if (!row || row.read_at) return READ;
    const epoch = this.epoch;
    this.update((state) => ({ busyIds: new Set(state.busyIds).add(id) }));
    try {
      return await this.markIds([id]);
    } finally {
      if (this.current(epoch)) {
        this.update((state) => {
          const next = new Set(state.busyIds);
          next.delete(id);
          return { busyIds: next };
        });
      }
    }
  };

  // Only the unread rows currently loaded and shown.
  markVisibleRead = async (): Promise<MarkOutcome> => {
    if (!this.state.owner) return STALE;
    const ids = this.state.items.filter((row) => !row.read_at).map((row) => row.id);
    if (ids.length === 0) return READ;
    const epoch = this.epoch;
    this.update({ bulkBusy: true });
    try {
      return await this.markIds(ids);
    } finally {
      if (this.current(epoch)) this.update({ bulkBusy: false });
    }
  };

  private subscribeRealtime(owner: string, epoch: number) {
    this.channel = this.client
      .channel(`${this.channelPrefix}:${owner}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${owner}` }, (payload) => {
        if (!this.current(epoch)) return;
        // Defense in depth for admins, whom RLS does not limit to their own rows: an inserted or
        // updated row that names another account is ignored even if the server filter let it through.
        const named = (payload.new as { user_id?: unknown } | null)?.user_id;
        if ((payload.eventType === "INSERT" || payload.eventType === "UPDATE") && named !== owner) return;
        if (payload.eventType === "INSERT") {
          const row = payload.new as AppNotification;
          this.update((state) => (state.items.some((item) => item.id === row.id) ? {} : { items: [row, ...state.items] }));
        } else if (payload.eventType === "UPDATE") {
          const row = payload.new as AppNotification;
          this.update((state) => ({ items: state.items.map((item) => (item.id === row.id ? { ...item, read_at: row.read_at } : item)) }));
        } else if (payload.eventType === "DELETE") {
          const row = payload.old as { id?: string };
          this.update((state) => ({ items: state.items.filter((item) => item.id !== row.id) }));
        }
        void this.refreshCount();
      })
      .subscribe((state) => {
        if (!this.current(epoch)) return;
        if (state === "SUBSCRIBED") this.update({ realtimeUnavailable: false });
        if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") this.update({ realtimeUnavailable: true });
      });
  }
}
