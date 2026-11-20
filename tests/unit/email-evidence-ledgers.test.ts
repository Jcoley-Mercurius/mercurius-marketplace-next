// TRACE-155 (Phase 7.3C-2): correlation tags on the application and price-draft senders. Each send
// goes through the real shared sender with a stubbed provider, so the exact request body, key and
// recipient are checked. Synthetic values and fake ledgers only; nothing is sent.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  applicationNotificationKey,
  applicationNotificationMessage,
  deliverApplicationNotification,
  type ClaimedApplication,
} from "../../src/lib/applicationNotifications";
import { DRAFT_EMAIL_CLAIM_INVALID, deliverDraftEmail, draftEmailKey, draftEmailMessage } from "../../src/lib/draftEmailNotices";
import { ownerEmailKey } from "../../src/lib/ownerEmailNotifications";
import { correlationTags } from "../../src/lib/emailEvidence/resendWebhook";
import { sendNotificationEmail, sendOwnerNotification } from "../../src/lib/ownerNotifications";

const APPLICATION = "a1a1a1a1-1111-4111-8111-111111111111";
const DRAFT = "d2d2d2d2-2222-4222-8222-222222222222";
const NOTICE_H1 = "e1e1e1e1-3333-4333-8333-333333333333";
const NOTICE_H2 = "e2e2e2e2-4444-4444-8444-444444444444";
const SENTINEL = { email: "sentinel.applicant@example.test", contact: "sentinel.contact@example.test", business: "Sentinel Business LLC" };

const application: ClaimedApplication = {
  id: APPLICATION, created_at: "2026-11-19T12:00:00Z", business_name: SENTINEL.business, first_name: "Ann", last_name: "Applicant",
  email: SENTINEL.email, phone: "239-555-0100", primary_category: "Lawn & Landscape", services: ["lawn-mowing"], service_areas: "Cape Coral",
};

type Call = { name: string; args: Record<string, unknown> };

function fakeClient(claim: unknown, recordName: string) {
  const calls: Call[] = [];
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === recordName) return { data: { state: args.p_outcome }, error: null };
      return { data: claim, error: null };
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

function stubProvider(status = 200) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    status === 200 ? new Response(JSON.stringify({ id: "msg_synthetic" }), { status }) : new Response("refused", { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const bodyOf = (fetchMock: ReturnType<typeof stubProvider>, index = 0) => fetchMock.mock.calls[index][1].body as string;
const keyOf = (fetchMock: ReturnType<typeof stubProvider>, index = 0) =>
  (fetchMock.mock.calls[index][1].headers as Record<string, string>)["Idempotency-Key"];

function captureLogs() {
  const raw: string[] = [];
  for (const level of ["info", "warn", "error", "log"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { raw.push(args.map(String).join(" ")); });
  return raw;
}

const env = { ...process.env };
beforeEach(() => {
  process.env.RESEND_API_KEY = "re_synthetic";
  process.env.RESEND_FROM_EMAIL = "Mercurius <notifications@example.test>";
  process.env.OWNER_NOTIFICATION_EMAIL = "owner@example.test";
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The pre-7.3C body for the same message and key, through the same sender. */
async function legacyBody(message: Parameters<typeof sendOwnerNotification>[0], recipient: string | null) {
  const fetchMock = stubProvider();
  await sendNotificationEmail(message, recipient);
  const body = bodyOf(fetchMock);
  vi.unstubAllGlobals();
  return body;
}

describe("application email tags (7.3C-2)", () => {
  const claimFor = (attempt: number) => ({ claimed: true, claim_id: `claim-${attempt}`, attempt, application });

  it.each([1, 2, 37])("tags attempt %i with the application_id and the claimed attempt; only `tags` is added", async (attempt) => {
    const legacy = await legacyBody({ ...applicationNotificationMessage(application), idempotencyKey: applicationNotificationKey(APPLICATION, attempt) }, null);
    const fetchMock = stubProvider();
    const { client, calls } = fakeClient(claimFor(attempt), "r0_record_application_notification");
    captureLogs();
    expect(await deliverApplicationNotification(client, APPLICATION, attempt === 1 ? "initial" : "resend")).toEqual({ state: "sent", attempt });
    const body = JSON.parse(bodyOf(fetchMock));
    expect(body.tags).toEqual([
      { name: "mm_ledger", value: "application" }, { name: "mm_ref", value: APPLICATION }, { name: "mm_attempt", value: String(attempt) },
    ]);
    const { tags, ...rest } = body;
    expect(JSON.stringify(rest)).toBe(legacy);
    expect(keyOf(fetchMock)).toBe(applicationNotificationKey(APPLICATION, attempt));
    expect(correlationTags(tags)).toEqual({ p_tag_status: "valid", p_tag_ledger: "application", p_tag_ref: APPLICATION, p_tag_attempt: attempt });
    // No lookup: exactly the claim and the record, with the record's arguments unchanged.
    expect(calls.map((call) => call.name)).toEqual(["r0_claim_application_notification", "r0_record_application_notification"]);
    expect(calls[1].args).toEqual({ p_application: APPLICATION, p_claim: `claim-${attempt}`, p_outcome: "sent", p_provider_id: "msg_synthetic", p_error: null });
  });

  it.each([
    ["an uppercase application ID", APPLICATION.toUpperCase(), 1],
    ["a non-UUID application ID", "not-a-uuid", 1],
    ["attempt 0 from the claim", APPLICATION, 0],
    ["a fractional attempt from the claim", APPLICATION, 1.5],
    ["an attempt above 10,000", APPLICATION, 10_001],
  ])("%s sends untagged, byte-for-byte as before, logs one code and still records", async (_label, id, attempt) => {
    const legacy = await legacyBody({ ...applicationNotificationMessage(application), idempotencyKey: applicationNotificationKey(id, attempt) }, null);
    const fetchMock = stubProvider();
    const { client, calls } = fakeClient({ ...claimFor(1), attempt }, "r0_record_application_notification");
    const raw = captureLogs();
    const outcome = await deliverApplicationNotification(client, id, "initial");
    expect(outcome).toEqual({ state: "sent", attempt });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock)).toBe(legacy);
    expect(keyOf(fetchMock)).toBe(applicationNotificationKey(id, attempt));
    expect(calls.map((call) => call.name)).toEqual(["r0_claim_application_notification", "r0_record_application_notification"]);
    const warnings = raw.map((line) => JSON.parse(line)).filter((line) => line.event === "application_notification.correlation_unavailable");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ level: "warn", error_code: "correlation_ref_unavailable", schema: "mercurius.oplog.v1" });
    expect(Object.keys(warnings[0])).toHaveLength(14);
    const joined = raw.join("\n");
    for (const value of Object.values(SENTINEL)) expect(joined).not.toContain(value);
    expect(joined).not.toMatch(/mm_ref|mm_ledger|vendor-application-notification:/);
  });

  it("a refused send with tags is still recorded as failed against the same claim", async () => {
    const fetchMock = stubProvider(422);
    const { client, calls } = fakeClient(claimFor(1), "r0_record_application_notification");
    captureLogs();
    expect(await deliverApplicationNotification(client, APPLICATION, "initial")).toEqual({ state: "failed", attempt: 1 });
    expect(JSON.parse(bodyOf(fetchMock)).tags).toHaveLength(3);
    expect(calls[1].args).toMatchObject({ p_claim: "claim-1", p_outcome: "failed", p_provider_id: null });
  });

  it("no claim, no send and no tags", async () => {
    const fetchMock = stubProvider();
    const { client } = fakeClient({ claimed: false, state: "sent" }, "r0_record_application_notification");
    captureLogs();
    expect(await deliverApplicationNotification(client, APPLICATION, "initial")).toEqual({ state: "not_claimed", current: "sent" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("price-draft email tags (7.3C-2)", () => {
  const claimed = (notice: unknown, attempt = 1) =>
    ({ claimed: true, claim_id: `claim-${attempt}`, attempt, notice_id: notice, recipient: SENTINEL.contact, vendor_name: "Synthetic Cans" });
  const message = (attempt: number) =>
    ({ ...draftEmailMessage("Synthetic Cans", "https://mercuriusmarketplace.com"), idempotencyKey: draftEmailKey(NOTICE_H1, attempt) as string });
  // The pre-repair per-draft key, for comparison only (D-3).
  const legacyKey = (attempt: number) => `package-draft-email:${DRAFT}:${attempt}`;

  it("tags with exactly the claimed notice_id and attempt, never the draft ID; only `tags` is added", async () => {
    const legacy = await legacyBody(message(2), SENTINEL.contact);
    const fetchMock = stubProvider();
    const { client, calls } = fakeClient(claimed(NOTICE_H1, 2), "pricing_record_draft_email");
    expect(await deliverDraftEmail(client, DRAFT, "resend")).toEqual({ state: "sent", attempt: 2 });
    const body = JSON.parse(bodyOf(fetchMock));
    expect(body.tags).toEqual([
      { name: "mm_ledger", value: "package_draft" }, { name: "mm_ref", value: NOTICE_H1 }, { name: "mm_attempt", value: "2" },
    ]);
    expect(JSON.stringify(body)).not.toContain(DRAFT);
    const { tags, ...rest } = body;
    expect(JSON.stringify(rest)).toBe(legacy);
    expect(body.to).toEqual([SENTINEL.contact]);
    expect(keyOf(fetchMock)).toBe(`package-draft-email:v2:${NOTICE_H1}:2`);
    expect(keyOf(fetchMock)).not.toContain(DRAFT);
    expect(correlationTags(tags)).toEqual({ p_tag_status: "valid", p_tag_ledger: "package_draft", p_tag_ref: NOTICE_H1, p_tag_attempt: 2 });
    // No lookup of the current revision: exactly the claim and the record, record arguments unchanged.
    expect(calls.map((call) => call.name)).toEqual(["pricing_claim_draft_email", "pricing_record_draft_email"]);
    expect(calls[1].args).toEqual({ p_draft: DRAFT, p_claim: "claim-2", p_outcome: "sent", p_provider_id: "msg_synthetic", p_error: null });
  });

  it("a revision change during delivery does not move the tag or the key: each claim carries its own notice", async () => {
    // The claim for revision h1 is in flight when the operator sends h2. The sender reads nothing
    // else, so the h1 email stays tagged and keyed with h1's notice; h2's later claim uses h2's.
    const fetchMock = stubProvider();
    const first = fakeClient(claimed(NOTICE_H1, 1), "pricing_record_draft_email");
    await deliverDraftEmail(first.client, DRAFT, "initial");
    const second = fakeClient(claimed(NOTICE_H2, 1), "pricing_record_draft_email");
    await deliverDraftEmail(second.client, DRAFT, "initial");
    expect(JSON.parse(bodyOf(fetchMock, 0)).tags[1]).toEqual({ name: "mm_ref", value: NOTICE_H1 });
    expect(JSON.parse(bodyOf(fetchMock, 1)).tags[1]).toEqual({ name: "mm_ref", value: NOTICE_H2 });
    expect(keyOf(fetchMock, 0)).toBe(`package-draft-email:v2:${NOTICE_H1}:1`);
    expect(keyOf(fetchMock, 1)).toBe(`package-draft-email:v2:${NOTICE_H2}:1`);
    expect(first.calls.map((call) => call.name)).toEqual(["pricing_claim_draft_email", "pricing_record_draft_email"]);
    expect(second.calls.map((call) => call.name)).toEqual(["pricing_claim_draft_email", "pricing_record_draft_email"]);
  });

  it("D-3: two revisions of one draft, both at attempt 1, have different keys, and neither is the legacy per-draft key", async () => {
    const fetchMock = stubProvider();
    await deliverDraftEmail(fakeClient(claimed(NOTICE_H1, 1), "pricing_record_draft_email").client, DRAFT, "initial");
    await deliverDraftEmail(fakeClient(claimed(NOTICE_H2, 1), "pricing_record_draft_email").client, DRAFT, "initial");
    expect(keyOf(fetchMock, 0)).not.toBe(keyOf(fetchMock, 1));
    for (const index of [0, 1]) {
      expect(keyOf(fetchMock, index)).not.toBe(legacyKey(1));
      // A legacy key's second segment is a draft UUID, so a `v2` key can never equal one.
      expect(keyOf(fetchMock, index)).toMatch(/^package-draft-email:v2:[0-9a-f-]{36}:1$/);
    }
  });

  it("D-3: replaying the same notice and attempt gives the same key and the same body", async () => {
    const fetchMock = stubProvider();
    await deliverDraftEmail(fakeClient(claimed(NOTICE_H1, 1), "pricing_record_draft_email").client, DRAFT, "initial");
    await deliverDraftEmail(fakeClient(claimed(NOTICE_H1, 1), "pricing_record_draft_email").client, DRAFT, "initial");
    expect(keyOf(fetchMock, 1)).toBe(keyOf(fetchMock, 0));
    expect(bodyOf(fetchMock, 1)).toBe(bodyOf(fetchMock, 0));
  });

  it("D-3: an authorized resend (the next claimed attempt of the same notice) has a different key", async () => {
    const fetchMock = stubProvider();
    await deliverDraftEmail(fakeClient(claimed(NOTICE_H1, 1), "pricing_record_draft_email").client, DRAFT, "initial");
    await deliverDraftEmail(fakeClient(claimed(NOTICE_H1, 2), "pricing_record_draft_email").client, DRAFT, "resend");
    expect(keyOf(fetchMock, 0)).toBe(`package-draft-email:v2:${NOTICE_H1}:1`);
    expect(keyOf(fetchMock, 1)).toBe(`package-draft-email:v2:${NOTICE_H1}:2`);
  });

  it("the key is a pure function of a valid notice and attempt; anything else has no key", () => {
    expect(draftEmailKey(NOTICE_H1, 1)).toBe(`package-draft-email:v2:${NOTICE_H1}:1`);
    expect(draftEmailKey(NOTICE_H1, 10_000)).toBe(`package-draft-email:v2:${NOTICE_H1}:10000`);
    for (const [notice, attempt] of [
      [undefined, 1], [null, 1], [NOTICE_H1.toUpperCase(), 1], [42, 1], ["not-a-uuid", 1], ["", 1],
      [NOTICE_H1, 0], [NOTICE_H1, 1.5], [NOTICE_H1, 10_001], [NOTICE_H1, "1"], [NOTICE_H1, null], [NOTICE_H1, undefined],
    ] as const) expect(draftEmailKey(notice, attempt)).toBeNull();
  });

  it.each([
    ["a missing notice_id", undefined, 1],
    ["a null notice_id", null, 1],
    ["an uppercase notice_id", NOTICE_H1.toUpperCase(), 1],
    ["a non-string notice_id", 42, 1],
    ["attempt 0", NOTICE_H1, 0],
    ["a fractional attempt", NOTICE_H1, 1.5],
    ["an attempt above 10,000", NOTICE_H1, 10_001],
    ["a string attempt", NOTICE_H1, "1"],
  ])("fails closed on %s: no send under any fallback key; the claim is recorded failed", async (_label, notice, attempt) => {
    const fetchMock = stubProvider();
    const { client, calls } = fakeClient({ ...claimed(notice, 1), attempt }, "pricing_record_draft_email");
    const raw = captureLogs();
    const outcome = await deliverDraftEmail(client, DRAFT, "initial");
    expect(outcome).toEqual({ state: "failed", attempt: typeof attempt === "number" && Number.isInteger(attempt) ? attempt : 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    // The existing record function, against this claim: nothing left, so the operator may resend
    // directly. No other RPC (no lookup, no reset).
    expect(calls.map((call) => call.name)).toEqual(["pricing_claim_draft_email", "pricing_record_draft_email"]);
    expect(calls[1].args).toEqual({ p_draft: DRAFT, p_claim: "claim-1", p_outcome: "failed", p_provider_id: null, p_error: DRAFT_EMAIL_CLAIM_INVALID });
    expect(raw).toEqual([expect.stringContaining("Price approval email not sent: invalid claim reference")]);
    expect(raw.join("\n")).not.toContain(SENTINEL.contact);
  });

  it("fails closed when the claim also lacks a usable claim_id: no send, unrecorded, and the notice is left to the existing stale rule", async () => {
    const fetchMock = stubProvider();
    const calls: Call[] = [];
    const client = {
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === "pricing_record_draft_email") return { data: null, error: { code: "40001", message: "Notification claim is not current" } };
        return { data: { ...claimed(null, 1), claim_id: undefined }, error: null };
      }),
    } as unknown as SupabaseClient;
    const raw = captureLogs();
    expect(await deliverDraftEmail(client, DRAFT, "initial")).toEqual({ state: "unrecorded", attempt: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.map((call) => call.name)).toEqual(["pricing_claim_draft_email", "pricing_record_draft_email"]);
    expect(raw).toHaveLength(2);
    expect(raw.join("\n")).not.toContain(SENTINEL.contact);
  });

  it.each(["sent", "unknown", "missed", "failed", "not_sent"])(
    "a historical %s notice that the claim refuses gains no send, no record and no automatic recovery",
    async (state) => {
      const fetchMock = stubProvider();
      const { client, calls } = fakeClient({ claimed: false, state }, "pricing_record_draft_email");
      expect(await deliverDraftEmail(client, DRAFT, "initial")).toEqual({ state: "not_claimed", current: state });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(calls.map((call) => call.name)).toEqual(["pricing_claim_draft_email"]);
    },
  );

  it("leaves the application and owner-email key formats unchanged", () => {
    expect(applicationNotificationKey(APPLICATION, 2)).toBe(`vendor-application-notification:${APPLICATION}:2`);
    expect(ownerEmailKey("contact_submission", APPLICATION, 3)).toBe(`contact-submission-notification:${APPLICATION}:3`);
    expect(ownerEmailKey("renewal_document", APPLICATION, 1)).toBe(`renewal-document-notification:${APPLICATION}:1`);
  });

  it("an unknown result is still recorded as unknown against the same claim", async () => {
    const fetchMock = stubProvider(503);
    const { client, calls } = fakeClient(claimed(NOTICE_H1, 1), "pricing_record_draft_email");
    captureLogs();
    expect(await deliverDraftEmail(client, DRAFT, "initial")).toEqual({ state: "unknown", attempt: 1 });
    expect(JSON.parse(bodyOf(fetchMock)).tags).toHaveLength(3);
    expect(calls[1].args).toMatchObject({ p_claim: "claim-1", p_outcome: "unknown" });
  });
});
