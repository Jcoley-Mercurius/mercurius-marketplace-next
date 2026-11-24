import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { AppNotification } from "@/hooks/useNotifications";
import { markVisibleFeedback, openNoticeOutcome } from "@/lib/ownNotificationFeedback";
import { OWN_NOTIFICATION_PAGE_SIZE, OwnNotificationsController } from "@/lib/ownNotificationsController";

// Phase 7.5E / TRACE-159 review repairs (F-1, F-2) for the shared own-account notification state used
// by the admin and vendor pages. Every request the controller makes stays pending until the test
// releases it, so the order of completions is chosen here, not by timing.

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

type Kind = "page" | "count" | "readback" | "update";
type Op = { kind: Kind; owner: unknown; ids: string[]; cursor: string | null; resolve: (result: unknown) => void };

class Builder {
  private method: "select" | "update" = "select";
  private head = false;
  private filters: Record<string, unknown> = {};
  private cursor: string | null = null;
  constructor(private readonly client: FakeClient) {}
  select(_columns: string, options?: { head?: boolean }) { if (this.method !== "update") this.head = Boolean(options?.head); return this; }
  update() { this.method = "update"; return this; }
  eq(key: string, value: unknown) { this.filters[key] = value; return this; }
  in(key: string, value: unknown) { this.filters[key] = value; return this; }
  is() { return this; }
  order() { return this; }
  limit() { return this; }
  or(filter: string) { this.cursor = filter; return this; }
  then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
    const kind: Kind = this.method === "update" ? "update" : this.head ? "count" : this.filters.id ? "readback" : "page";
    return new Promise((resolve) => {
      this.client.pending.push({ kind, owner: this.filters.user_id, ids: (this.filters.id as string[]) ?? [], cursor: this.cursor, resolve });
    }).then(onFulfilled, onRejected);
  }
}

type Handler = (payload: Record<string, unknown>) => void;
class FakeChannel {
  handler: Handler | null = null;
  status: ((state: string) => void) | null = null;
  filter: string | null = null;
  constructor(readonly name: string) {}
  on(_event: string, config: { filter: string }, handler: Handler) { this.filter = config.filter; this.handler = handler; return this; }
  subscribe(status: (state: string) => void) { this.status = status; return this; }
}

class FakeClient {
  pending: Op[] = [];
  channels: FakeChannel[] = [];
  removed: FakeChannel[] = [];
  from() { return new Builder(this); }
  channel(name: string) { const channel = new FakeChannel(name); this.channels.push(channel); return channel; }
  removeChannel(channel: FakeChannel) { this.removed.push(channel); return Promise.resolve("ok"); }
  take(kind: Kind, owner: string) {
    const index = this.pending.findIndex((op) => op.kind === kind && op.owner === owner);
    if (index < 0) throw new Error(`no pending ${kind} for ${owner}; pending: ${this.pending.map((op) => `${op.kind}:${op.owner}`).join(", ")}`);
    return this.pending.splice(index, 1)[0];
  }
  has(kind: Kind, owner: string) { return this.pending.some((op) => op.kind === kind && op.owner === owner); }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ok = (data: unknown) => ({ data, error: null });
const fail = { data: null, error: { message: "Synthetic outage" } };
const counted = (count: number) => ({ count, error: null });

let serial = 0;
function note(owner: string, extra: Partial<AppNotification> = {}): AppNotification & { user_id: string } {
  serial += 1;
  return {
    id: `${owner.slice(-1)}-${String(serial).padStart(4, "0")}`, user_id: owner, type: "support", severity: "info",
    title: `${owner === A ? "ACCOUNT-A" : "ACCOUNT-B"} notice ${serial}`, body: null, link: "/admin/tickets",
    related_request_id: null, read_at: null, created_at: new Date(Date.UTC(2026, 10, 10) - serial * 60_000).toISOString(), ...extra,
  };
}

function setup() {
  const client = new FakeClient();
  const controller = new OwnNotificationsController(client as unknown as SupabaseClient, "admin-notifications");
  return { client, controller, state: () => controller.getSnapshot() };
}

// Sets the owner and completes the first page and count.
async function signIn(client: FakeClient, controller: OwnNotificationsController, owner: string, rows: AppNotification[], unread: number, more = false) {
  controller.setOwner(owner);
  await settle();
  const padded = [...rows];
  while (more && padded.length <= OWN_NOTIFICATION_PAGE_SIZE) padded.push(note(owner));
  client.take("page", owner).resolve(ok(padded));
  client.take("count", owner).resolve(counted(unread));
  await settle();
}

const titles = (items: readonly AppNotification[]) => items.map((row) => row.title).join(" | ");

describe("F-1: state and every completion are bound to the account they were started for", () => {
  it("initial load: A's page and count released after switching to B never appear under B", async () => {
    const { client, controller, state } = setup();
    controller.setOwner(A);
    await settle();
    const aPage = client.take("page", A);
    const aCount = client.take("count", A);

    controller.setOwner(B);
    expect(state()).toMatchObject({ owner: B, items: [], unreadCount: null, status: "loading" });
    aPage.resolve(ok([note(A), note(A)]));
    aCount.resolve(counted(42));
    await settle();
    expect(state()).toMatchObject({ owner: B, items: [], unreadCount: null, status: "loading", countFailed: false });

    const bRows = [note(B)];
    client.take("page", B).resolve(ok(bRows));
    client.take("count", B).resolve(counted(1));
    await settle();
    expect(state()).toMatchObject({ owner: B, status: "ready", unreadCount: 1 });
    expect(titles(state().items)).not.toContain("ACCOUNT-A");
    expect(state().items).toEqual(bRows);
  });

  it("initial load: A's failed page released after B loaded does not put B into an error state", async () => {
    const { client, controller, state } = setup();
    controller.setOwner(A);
    await settle();
    const aPage = client.take("page", A);
    client.take("count", A);
    await signIn(client, controller, B, [note(B)], 1);
    aPage.resolve(fail);
    await settle();
    expect(state()).toMatchObject({ owner: B, status: "ready", unreadCount: 1 });
  });

  it("pagination: A's older page released after switching to B is dropped and reports nothing", async () => {
    const { client, controller, state } = setup();
    await signIn(client, controller, A, [note(A)], 1, true);
    const older = controller.loadOlder();
    await settle();
    const aOlder = client.take("page", A);
    expect(aOlder.cursor).not.toBeNull();
    expect(state().loadingMore).toBe(true);

    controller.setOwner(B);
    await settle();
    aOlder.resolve(ok([note(A), note(A)]));
    expect(await older).toBeNull();
    expect(state()).toMatchObject({ owner: B, items: [], loadingMore: false, moreFailed: false });

    // Even after B's own page arrives, A's late page cannot be merged into it.
    client.take("page", B).resolve(ok([note(B)]));
    client.take("count", B).resolve(counted(1));
    await settle();
    expect(titles(state().items)).not.toContain("ACCOUNT-A");
  });

  it("pagination: A's failed older page after the switch does not show a load-older failure under B", async () => {
    const { client, controller, state } = setup();
    await signIn(client, controller, A, [note(A)], 1, true);
    const older = controller.loadOlder();
    await settle();
    const aOlder = client.take("page", A);
    await signIn(client, controller, B, [note(B)], 1, true);
    aOlder.resolve(fail);
    expect(await older).toBeNull();
    expect(state()).toMatchObject({ owner: B, moreFailed: false, loadingMore: false, hasMore: true });
  });

  it("count: A's count released after switching to B never becomes B's count, nor B's count failure", async () => {
    const { client, controller, state } = setup();
    await signIn(client, controller, A, [note(A)], 1);
    void controller.refreshCount();
    void controller.refreshCount();
    await settle();
    const first = client.take("count", A);
    const second = client.take("count", A);
    await signIn(client, controller, B, [note(B)], 3);
    first.resolve(counted(99));
    second.resolve({ count: null, error: { message: "Synthetic outage" } });
    await settle();
    expect(state()).toMatchObject({ owner: B, unreadCount: 3, countFailed: false });
  });

  for (const action of ["single", "bulk"] as const) {
    it(`${action} write: A's write result released after switching to B is stale, issues no readback, and changes nothing under B`, async () => {
      const { client, controller, state } = setup();
      const aRow = note(A);
      await signIn(client, controller, A, [aRow], 1);
      const pending = action === "single" ? controller.markRead(aRow.id) : controller.markVisibleRead();
      await settle();
      const write = client.take("update", A);
      expect(write.ids).toEqual([aRow.id]);

      const bRow = note(B);
      await signIn(client, controller, B, [bRow], 1);
      write.resolve(ok([{ id: aRow.id, read_at: "2026-11-24T00:00:00Z" }]));
      const outcome = await pending;
      await settle();
      expect(outcome).toEqual({ kind: "stale" });
      expect(client.has("readback", A) || client.has("count", A)).toBe(false);
      expect(state()).toMatchObject({ owner: B, items: [bRow], unreadCount: 1, busyIds: new Set(), bulkBusy: false });
      // A stale outcome shows no feedback and does not navigate.
      expect(openNoticeOutcome(outcome, "/admin/tickets", "Support Tickets")).toBeNull();
      expect(markVisibleFeedback(outcome, 1)).toBeNull();
    });

    it(`${action} write: A's reconciliation released after switching to B is stale and changes nothing under B`, async () => {
      const { client, controller, state } = setup();
      const aRow = note(A);
      await signIn(client, controller, A, [aRow], 1);
      const pending = action === "single" ? controller.markRead(aRow.id) : controller.markVisibleRead();
      await settle();
      client.take("update", A).resolve(fail);
      await settle();
      const readback = client.take("readback", A);
      const count = client.take("count", A);

      const bRow = note(B, { id: aRow.id }); // even a colliding id is untouched
      await signIn(client, controller, B, [bRow], 1);
      readback.resolve(ok([{ ...aRow, read_at: "2026-11-24T00:00:00Z" }]));
      count.resolve(counted(0));
      const outcome = await pending;
      await settle();
      expect(outcome).toEqual({ kind: "stale" });
      expect(state()).toMatchObject({ owner: B, items: [bRow], unreadCount: 1, busyIds: new Set(), bulkBusy: false });
      expect(openNoticeOutcome(outcome, "/admin/tickets", "Support Tickets")).toBeNull();
      expect(markVisibleFeedback(outcome, 1)).toBeNull();
    });
  }

  it("realtime: A's channel is removed on the switch, and its late events and status never reach B", async () => {
    const { client, controller, state } = setup();
    await signIn(client, controller, A, [note(A)], 1);
    const aChannel = client.channels[0];
    expect(aChannel.name).toBe(`admin-notifications:${A}`);
    expect(aChannel.filter).toBe(`user_id=eq.${A}`);

    await signIn(client, controller, B, [note(B)], 1);
    expect(client.removed).toContain(aChannel);
    const bChannel = client.channels[1];
    expect(bChannel.name).toBe(`admin-notifications:${B}`);
    expect(bChannel.filter).toBe(`user_id=eq.${B}`);

    aChannel.handler!({ eventType: "INSERT", new: note(A, { title: "ACCOUNT-A late insert" }), old: {} });
    aChannel.handler!({ eventType: "DELETE", new: {}, old: { id: state().items[0].id } });
    aChannel.status!("CHANNEL_ERROR");
    await settle();
    expect(titles(state().items)).not.toContain("ACCOUNT-A");
    expect(state().items).toHaveLength(1);
    expect(state().realtimeUnavailable).toBe(false);
    expect(client.has("count", A)).toBe(false);

    // B's own channel still works, and still ignores a row naming another account.
    bChannel.handler!({ eventType: "INSERT", new: note(A, { title: "ACCOUNT-A foreign insert" }), old: {} });
    const fresh = note(B, { title: "ACCOUNT-B live" });
    bChannel.handler!({ eventType: "INSERT", new: fresh, old: {} });
    await settle();
    expect(state().items[0]).toEqual(fresh);
    expect(titles(state().items)).not.toContain("ACCOUNT-A");
    client.take("count", B).resolve(counted(2));
    await settle();
    expect(state().unreadCount).toBe(2);
  });

  it("A → B → A: responses from A's first session are not applied to A's second session", async () => {
    const { client, controller, state } = setup();
    controller.setOwner(A);
    await settle();
    const oldPage = client.take("page", A);
    const oldCount = client.take("count", A);
    controller.setOwner(B);
    controller.setOwner(A);
    await settle();
    oldPage.resolve(ok([note(A, { title: "ACCOUNT-A first session" })]));
    oldCount.resolve(counted(7));
    await settle();
    expect(state()).toMatchObject({ owner: A, items: [], unreadCount: null, status: "loading" });
    const current = [note(A, { title: "ACCOUNT-A second session" })];
    client.take("page", A).resolve(ok(current));
    client.take("count", A).resolve(counted(1));
    await settle();
    expect(state().items).toEqual(current);
    expect(state().unreadCount).toBe(1);
  });

  for (const action of ["single", "bulk", "older"] as const) {
    it(`sign-out / disable during a ${action} action: nothing is shown, the outcome is stale, nothing more is read`, async () => {
      const { client, controller, state } = setup();
      const aRow = note(A);
      await signIn(client, controller, A, [aRow], 1, true);
      const pending = action === "single" ? controller.markRead(aRow.id) : action === "bulk" ? controller.markVisibleRead() : controller.loadOlder();
      await settle();
      const op = client.take(action === "older" ? "page" : "update", A);
      const channel = client.channels[0];

      controller.setOwner(null);
      expect(state()).toMatchObject({ owner: null, items: [], unreadCount: null, busyIds: new Set(), bulkBusy: false, loadingMore: false });
      expect(client.removed).toContain(channel);

      op.resolve(action === "older" ? ok([note(A)]) : ok([{ id: aRow.id, read_at: "2026-11-24T00:00:00Z" }]));
      channel.handler!({ eventType: "INSERT", new: note(A), old: {} });
      const outcome = await pending;
      await settle();
      expect(outcome === null || (outcome as { kind?: string }).kind === "stale").toBe(true);
      expect(client.pending).toEqual([]);
      expect(state()).toMatchObject({ owner: null, items: [], unreadCount: null });
      // While signed out, actions do nothing and report stale.
      expect(await controller.markRead(aRow.id)).toEqual({ kind: "stale" });
      expect(await controller.markVisibleRead()).toEqual({ kind: "stale" });
      expect(await controller.loadOlder()).toBeNull();
      await controller.load();
      await controller.refreshCount();
      expect(client.pending).toEqual([]);
    });
  }

  it("every read, count, write and readback names the owner it was started for", async () => {
    const { client, controller } = setup();
    const seen: Array<[Kind, unknown]> = [];
    const record = (kind: Kind, owner: string) => { const op = client.take(kind, owner); seen.push([op.kind, op.owner]); return op; };
    controller.setOwner(A);
    await settle();
    record("page", A).resolve(ok([note(A)]));
    record("count", A).resolve(counted(1));
    await settle();
    const write = controller.markVisibleRead();
    await settle();
    controller.setOwner(B);
    await settle();
    record("update", A).resolve(fail);
    expect(await write).toEqual({ kind: "stale" });
    record("page", B).resolve(ok([note(B)]));
    record("count", B).resolve(counted(1));
    await settle();
    const bWrite = controller.markVisibleRead();
    await settle();
    record("update", B).resolve(fail);
    await settle();
    record("readback", B).resolve(ok([]));
    record("count", B).resolve(counted(0));
    await bWrite;
    expect(seen).toEqual([["page", A], ["count", A], ["update", A], ["page", B], ["count", B], ["update", B], ["readback", B], ["count", B]]);
  });
});

describe("F-2: a failed write response is not treated as 'not marked'", () => {
  const READ_AT = "2026-11-24T22:00:00.000000+00:00";

  for (const action of ["single", "bulk"] as const) {
    const start = (controller: OwnNotificationsController, id: string) => (action === "single" ? controller.markRead(id) : controller.markVisibleRead());

    it(`${action}: write committed but its response failed; a successful readback establishes it was read`, async () => {
      const { client, controller, state } = setup();
      const rows = action === "single" ? [note(A)] : [note(A), note(A), note(A)];
      await signIn(client, controller, A, rows, rows.length);
      const pending = start(controller, rows[0].id);
      await settle();
      client.take("update", A).resolve(fail);
      await settle();
      const readback = client.take("readback", A);
      expect(readback.ids).toEqual(rows.map((row) => row.id));
      readback.resolve(ok(rows.map((row) => ({ ...row, read_at: READ_AT }))));
      client.take("count", A).resolve(counted(0));
      const outcome = await pending;
      expect(outcome).toEqual({ kind: "read" });
      expect(state().items.every((row) => row.read_at === READ_AT)).toBe(true);
      expect(state().unreadCount).toBe(0);
      if (action === "single") expect(openNoticeOutcome(outcome, "/admin/tickets", "Support Tickets")).toEqual({ navigate: "/admin/tickets" });
      else expect(markVisibleFeedback(outcome, 3)).toEqual({ tone: "status", text: "3 visible notices marked as read. Notices you haven’t loaded are unchanged." });
    });

    it(`${action}: write response failed and the readback failed; the outcome is unknown and the list is not called saved state`, async () => {
      const { client, controller, state } = setup();
      const rows = action === "single" ? [note(A)] : [note(A), note(A)];
      await signIn(client, controller, A, rows, rows.length);
      const pending = start(controller, rows[0].id);
      await settle();
      client.take("update", A).resolve(fail);
      await settle();
      client.take("readback", A).resolve(fail);
      client.take("count", A).resolve(counted(0));
      const outcome = await pending;
      expect(outcome).toEqual({ kind: "unknown" });
      // Nothing is inferred into the list: rows keep what was last read from the database.
      expect(state().items.every((row) => row.read_at === null)).toBe(true);
      const feedback = action === "single"
        ? (openNoticeOutcome(outcome, "/admin/tickets", "Support Tickets") as { feedback: Record<string, unknown> }).feedback
        : markVisibleFeedback(outcome, 2)!;
      expect(feedback).toMatchObject({ tone: "error", refresh: true });
      const said = `${feedback.title} ${feedback.text}`;
      expect(said).toMatch(/couldn’t confirm/);
      expect(said).toMatch(/may have been saved/);
      expect(said).toMatch(/may be out of date/);
      expect(said).not.toMatch(/wasn’t marked|weren’t all marked|now shows what was saved/);
      if (action === "single") expect(feedback).toMatchObject({ href: "/admin/tickets", label: "Go to Support Tickets" });
    });

    it(`${action}: write response failed and a successful readback shows rows still unread; that is reported as established`, async () => {
      const { client, controller, state } = setup();
      const rows = action === "single" ? [note(A)] : [note(A), note(A)];
      await signIn(client, controller, A, rows, rows.length);
      const pending = start(controller, rows[0].id);
      await settle();
      client.take("update", A).resolve(fail);
      await settle();
      client.take("readback", A).resolve(ok(rows));
      client.take("count", A).resolve(counted(rows.length));
      const outcome = await pending;
      expect(outcome).toEqual({ kind: "unread", remaining: rows.length });
      expect(state().items.every((row) => row.read_at === null)).toBe(true);
      if (action === "single") {
        expect(openNoticeOutcome(outcome, "/admin/tickets", "Support Tickets")).toMatchObject({ feedback: { title: "This notice wasn’t marked as read" } });
      } else {
        expect(markVisibleFeedback(outcome, 2)).toMatchObject({ title: "Notices weren’t all marked as read", text: expect.stringContaining("2 visible notices still unread") });
      }
    });
  }

  it("bulk across chunks: confirmed rows are applied; a later chunk's failed response is read back", async () => {
    const { client, controller, state } = setup();
    const rows = Array.from({ length: 150 }, () => note(A));
    await signIn(client, controller, A, rows.slice(0, 25), 150, true);
    for (let offset = 25; offset < 150; offset += 25) {
      const older = controller.loadOlder();
      await settle();
      client.take("page", A).resolve(ok(rows.slice(offset, offset + 26)));
      await older;
    }
    expect(state().items.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    const pending = controller.markVisibleRead();
    await settle();
    const first = client.take("update", A);
    expect(first.ids).toHaveLength(100);
    first.resolve(ok(first.ids.map((id) => ({ id, read_at: READ_AT }))));
    await settle();
    const second = client.take("update", A);
    expect(second.ids).toHaveLength(50);
    second.resolve(fail);
    await settle();
    const readback = client.take("readback", A);
    expect(readback.ids).toEqual(second.ids);
    readback.resolve(fail);
    client.take("count", A).resolve(counted(50));
    expect(await pending).toEqual({ kind: "unknown" });
    // The first chunk was confirmed by its own response; the second is still as last read.
    expect(state().items.slice(0, 100).every((row) => row.read_at === READ_AT)).toBe(true);
    expect(state().items.slice(100).every((row) => row.read_at === null)).toBe(true);
  });

  it("a successful write that did not return a row still needs a readback; a failed readback is unknown, not read", async () => {
    const { client, controller } = setup();
    const rows = [note(A), note(A)];
    await signIn(client, controller, A, rows, 2);
    const pending = controller.markVisibleRead();
    await settle();
    client.take("update", A).resolve(ok([{ id: rows[0].id, read_at: READ_AT }]));
    await settle();
    const readback = client.take("readback", A);
    expect(readback.ids).toEqual([rows[1].id]);
    readback.resolve(fail);
    client.take("count", A).resolve(counted(1));
    expect(await pending).toEqual({ kind: "unknown" });
  });

  it("a confirmed write needs no readback and is read", async () => {
    const { client, controller, state } = setup();
    const rows = [note(A)];
    await signIn(client, controller, A, rows, 1);
    const pending = controller.markRead(rows[0].id);
    await settle();
    client.take("update", A).resolve(ok([{ id: rows[0].id, read_at: READ_AT }]));
    await settle();
    expect(client.has("readback", A)).toBe(false);
    client.take("count", A).resolve(counted(0));
    expect(await pending).toEqual({ kind: "read" });
    expect(state().items[0].read_at).toBe(READ_AT);
  });
});
