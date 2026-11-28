// Phase 7.5G-2 (TRACE-159): the sourcing queue client. The server reader decides membership, kind,
// related event, order and both flags (SQL 134); these tests hold the parser to the server's shape,
// the wording to the plan's rules (SG-2, SG-8, OD-4a, OD-6), the overview entry to the approved name,
// and every read to the account it was started for.
import { describe, expect, it } from "vitest";
import { SUMMARY_QUEUES } from "@/lib/adminOperations";
import {
  EMPTY_TEXT, KIND_LABEL, OFFER_TERMS_CROSS_REFERENCE, ORDER_TEXT, PLAN_VISIT_LABEL, READ_ONLY_TEXT, RELATED_EVENT_HEADING, RELATED_EVENT_LABEL,
  RELATED_EVENTS, SOURCING_DESCRIPTION, SOURCING_KINDS, SOURCING_NAME, itemNotes, parseSourcingQueue, relatedEventText,
} from "@/lib/sourcingQueue";
import { DENIED_MESSAGE, SOURCING_READER, SourcingQueueController, UNREADABLE, type RpcAnswer } from "@/lib/sourcingQueueController";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const item = (extra: Record<string, unknown> = {}) => ({
  request_id: A, kind: "exhausted", related_event_at: "2026-11-27T14:00:00+00:00", related_event: "offer_closed",
  plan_visit: false, offer_terms_block: true, ...extra,
});
const answer = (items: unknown[], checked = "2026-11-27T15:00:00+00:00") => ({ checked_at: checked, items });

describe("parseSourcingQueue", () => {
  it("accepts the reader's shape and keeps the server's order", () => {
    const parsed = parseSourcingQueue(answer([
      item({ request_id: B, kind: "awaiting_consent", related_event: "request_created", offer_terms_block: false }),
      item(),
      item({ request_id: "00000000-0000-4000-8000-0000000000c3", kind: "legacy_sourcing", related_event: "provider_operation", plan_visit: true, offer_terms_block: false }),
    ]));
    expect(parsed).toEqual({ checkedAt: "2026-11-27T15:00:00+00:00", items: [
      { requestId: B, kind: "awaiting_consent", relatedEventAt: "2026-11-27T14:00:00+00:00", relatedEvent: "request_created", planVisit: false, offerTermsBlock: false },
      { requestId: A, kind: "exhausted", relatedEventAt: "2026-11-27T14:00:00+00:00", relatedEvent: "offer_closed", planVisit: false, offerTermsBlock: true },
      { requestId: "00000000-0000-4000-8000-0000000000c3", kind: "legacy_sourcing", relatedEventAt: "2026-11-27T14:00:00+00:00", relatedEvent: "provider_operation", planVisit: true, offerTermsBlock: false },
    ] });
  });

  it("accepts an empty queue", () => {
    expect(parseSourcingQueue(answer([]))).toEqual({ checkedAt: "2026-11-27T15:00:00+00:00", items: [] });
  });

  it("copies only the known fields", () => {
    expect(parseSourcingQueue(answer([item({ address: "1 Synthetic Way", candidates: [] })]))?.items[0]).not.toHaveProperty("address");
  });

  it.each([
    ["an unknown kind", { kind: "sourcing" }],
    ["kind relabeled", { kind: "no_provider" }],
    ["an unknown related event", { related_event: "since" }],
    ["revision 1's basis name", { related_event: "last_offer_closed" }],
    ["a missing time", { related_event_at: null }],
    ["an unparseable time", { related_event_at: "yesterday" }],
    ["a request id that is not a uuid", { request_id: "request-1" }],
    ["a string plan_visit", { plan_visit: "false" }],
    ["a missing offer_terms_block", { offer_terms_block: undefined }],
  ])("refuses the whole answer for %s", (_, extra) => {
    expect(parseSourcingQueue(answer([item(), item(extra)]))).toBeNull();
  });

  it.each([
    ["null", null], ["an array", []], ["no items", { checked_at: "2026-11-27T15:00:00+00:00" }],
    ["no checked_at", { items: [] }], ["an item that is not an object", answer(["x"])],
  ])("refuses %s", (_, value) => {
    expect(parseSourcingQueue(value)).toBeNull();
  });
});

describe("wording", () => {
  it("uses the approved OD-4a name and description exactly (DEC-2026-070)", () => {
    expect(SOURCING_NAME).toBe("Sourcing");
    expect(SOURCING_DESCRIPTION).toBe("Requests awaiting a provider or fallback consent. No sourcing deadline is set. Counts reflect stored matching state.");
  });

  it("labels every kind and every related event", () => {
    expect(Object.keys(KIND_LABEL).sort()).toEqual([...SOURCING_KINDS].sort());
    expect(Object.keys(RELATED_EVENT_LABEL).sort()).toEqual([...RELATED_EVENTS].sort());
    expect(KIND_LABEL).toEqual({ exhausted: "No provider accepted", awaiting_consent: "Awaiting fallback consent", legacy_sourcing: "Legacy sourcing" });
    expect(RELATED_EVENT_LABEL).toEqual({ provider_operation: "Provider cancel or no-show recorded", offer_closed: "Offer last closed", request_created: "Request created" });
    expect(new Set(Object.values(KIND_LABEL)).size).toBe(3);
  });

  it("never presents the time as an entry time, a bound, an age or a deadline (SG-2, OD-6)", () => {
    const shown = [SOURCING_NAME, SOURCING_DESCRIPTION, RELATED_EVENT_HEADING, ORDER_TEXT, READ_ONLY_TEXT, EMPTY_TEXT, PLAN_VISIT_LABEL,
      OFFER_TERMS_CROSS_REFERENCE, ...Object.values(KIND_LABEL), ...Object.values(RELATED_EVENT_LABEL)];
    for (const text of shown) {
      expect(text, text).not.toMatch(/\bsince\b|\bwaiting\b|entered|exhausted at|at least|lower bound|longest|\bage\b|\baged\b|overdue|\bdue\b|ago\b/i);
    }
    expect(RELATED_EVENT_HEADING).toBe("Latest related event");
  });

  it("never says or implies no provider is available for awaiting_consent (SG-8)", () => {
    expect(KIND_LABEL.awaiting_consent).not.toMatch(/no provider|unavailable|none|exhaust/i);
    expect(KIND_LABEL.awaiting_consent).not.toBe(KIND_LABEL.exhausted);
  });

  it("names the event's basis beside its time", () => {
    expect(relatedEventText({ relatedEvent: "offer_closed", relatedEventAt: "2026-11-27T14:00:00+00:00" })).toBe("Offer last closed · Nov 27, 2026, 9:00 AM Eastern");
  });

  it("marks plan visits and the offers-at-other-terms overlap, in a fixed order", () => {
    expect(itemNotes({ planVisit: false, offerTermsBlock: false })).toEqual([]);
    expect(itemNotes({ planVisit: true, offerTermsBlock: true })).toEqual(["Plan visit: plan's provider only", "Also in Offers at other terms"]);
    expect(itemNotes({ planVisit: false, offerTermsBlock: true })).toEqual(["Also in Offers at other terms"]);
  });

  it("the overview row uses the approved name, links to the read-only list and has no aged rule", () => {
    expect(SUMMARY_QUEUES.sourcing).toEqual({ label: SOURCING_NAME, href: "/admin/sourcing" });
    const keys = Object.keys(SUMMARY_QUEUES);
    expect(keys.indexOf("sourcing")).toBe(keys.indexOf("applications") + 1);
    expect(keys.at(-1)).toBe("finance_exceptions");
  });
});

type Pending = { resolve: (value: RpcAnswer) => void; reject: (reason: unknown) => void };
function fakeClient() {
  const calls: string[] = [];
  const pending: Pending[] = [];
  const client = { rpc: (fn: string) => {
    calls.push(fn);
    return new Promise<RpcAnswer>((resolve, reject) => { pending.push({ resolve, reject }); });
  } };
  return { client, calls, pending };
}
const ok = (items: unknown[]) => ({ data: answer(items), error: null });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SourcingQueueController", () => {
  it("reads only the sourcing reader: once for an owner, once per refresh", async () => {
    const { client, calls, pending } = fakeClient();
    const controller = new SourcingQueueController(client);
    expect(calls).toEqual([]);
    controller.setOwner("owner-a");
    expect(controller.getSnapshot()).toMatchObject({ owner: "owner-a", status: "loading", data: null });
    pending[0].resolve(ok([item()]));
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ status: "ready", data: { items: [{ requestId: A }] } });
    void controller.refresh();
    pending[1].resolve(ok([]));
    await flush();
    expect(controller.getSnapshot().data?.items).toEqual([]);
    controller.setOwner("owner-a");
    expect(calls).toEqual([SOURCING_READER, SOURCING_READER]);
    expect(SOURCING_READER).toBe("admin_sourcing_queue");
  });

  it("discards an answer that arrives after another account signs in", async () => {
    const { client, pending } = fakeClient();
    const controller = new SourcingQueueController(client);
    controller.setOwner("owner-a");
    controller.setOwner("owner-b");
    expect(controller.getSnapshot()).toMatchObject({ owner: "owner-b", status: "loading", data: null });
    pending[0].resolve(ok([item()]));
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ owner: "owner-b", status: "loading", data: null });
    pending[1].resolve(ok([item({ request_id: B })]));
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ owner: "owner-b", status: "ready", data: { items: [{ requestId: B }] } });
  });

  it("discards an answer, and a refusal, that arrive after sign-out", async () => {
    const { client, calls, pending } = fakeClient();
    const controller = new SourcingQueueController(client);
    controller.setOwner("owner-a");
    pending[0].resolve(ok([item()]));
    await flush();
    void controller.refresh();
    controller.setOwner(null);
    expect(controller.getSnapshot()).toEqual({ owner: null, status: "loading", data: null, message: null });
    pending[1].resolve({ data: null, error: { code: "42501", message: "Admin access required" } });
    await flush();
    expect(controller.getSnapshot()).toEqual({ owner: null, status: "loading", data: null, message: null });
    await controller.refresh();
    expect(calls).toHaveLength(2);
  });

  it("A → B → A: the first read for A never shows on A's second session", async () => {
    const { client, pending } = fakeClient();
    const controller = new SourcingQueueController(client);
    controller.setOwner("owner-a");
    controller.setOwner("owner-b");
    controller.setOwner("owner-a");
    pending[0].resolve(ok([item({ request_id: B })]));
    pending[1].resolve(ok([]));
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ owner: "owner-a", status: "loading", data: null });
    pending[2].resolve(ok([item()]));
    await flush();
    expect(controller.getSnapshot().data?.items.map((i) => i.requestId)).toEqual([A]);
  });

  it("a later refresh supersedes an earlier one in flight", async () => {
    const { client, pending } = fakeClient();
    const controller = new SourcingQueueController(client);
    controller.setOwner("owner-a");
    void controller.refresh();
    pending[1].resolve(ok([item({ request_id: B })]));
    await flush();
    pending[0].resolve(ok([item()]));
    await flush();
    expect(controller.getSnapshot().data?.items.map((i) => i.requestId)).toEqual([B]);
  });

  it("words a refusal, an error, a lost answer and an unreadable answer without showing stale items", async () => {
    const { client, pending } = fakeClient();
    const controller = new SourcingQueueController(client);
    controller.setOwner("owner-a");
    pending[0].resolve({ data: null, error: { code: "42501", message: "Admin access required" } });
    await flush();
    expect(controller.getSnapshot()).toEqual({ owner: "owner-a", status: "denied", data: null, message: DENIED_MESSAGE });

    void controller.refresh();
    pending[1].resolve(ok([item()]));
    await flush();
    void controller.refresh();
    pending[2].resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout." } });
    await flush();
    expect(controller.getSnapshot()).toEqual({ owner: "owner-a", status: "error", data: null, message: "canceling statement due to statement timeout (57014)" });

    void controller.refresh();
    pending[3].reject(new Error("Failed to fetch"));
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ status: "error", data: null, message: "Failed to fetch" });

    void controller.refresh();
    pending[4].resolve({ data: answer([item({ kind: "sourced" })]), error: null });
    await flush();
    expect(controller.getSnapshot()).toMatchObject({ status: "error", data: null, message: UNREADABLE });
  });

  it("keeps the last items visible while a refresh is loading", async () => {
    const { client, pending } = fakeClient();
    const controller = new SourcingQueueController(client);
    controller.setOwner("owner-a");
    pending[0].resolve(ok([item()]));
    await flush();
    void controller.refresh();
    expect(controller.getSnapshot()).toMatchObject({ status: "loading", data: { items: [{ requestId: A }] } });
  });
});
