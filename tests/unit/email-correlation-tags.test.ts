// TRACE-155 (Phase 7.3C-1): correlation tag building and validation, the shared sender's body
// with and without tags, round trips through the 7.3B receiver's parser, and the evidence labels
// (S-50). Synthetic values and a stubbed fetch only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCorrelationTags, validCorrelationTags } from "../../src/lib/emailEvidence/correlationTags";
import {
  NOT_INBOX_PROOF,
  conflictSignalLabels,
  evidenceFactLabel,
  evidenceSummaryLabel,
  exclusionLabel,
  type EvidenceRule,
  type NonDeliveryFact,
} from "../../src/lib/emailEvidence/labels";
import { correlationTags } from "../../src/lib/emailEvidence/resendWebhook";
import { sendNotificationEmail, sendOwnerNotification } from "../../src/lib/ownerNotifications";

const REF = "0e0e0e0e-1111-4222-8333-444444444444";

describe("buildCorrelationTags", () => {
  it("builds exactly the three opaque tags, deterministically", () => {
    const tags = buildCorrelationTags("owner_email", REF, 3);
    expect(tags).toEqual([{ name: "mm_ledger", value: "owner_email" }, { name: "mm_ref", value: REF }, { name: "mm_attempt", value: "3" }]);
    expect(buildCorrelationTags("owner_email", REF, 3)).toEqual(tags);
    expect(buildCorrelationTags("owner_email", REF, 4)).not.toEqual(tags);
  });

  it.each(["application", "owner_email", "package_draft"])("accepts the %s ledger", (ledger) => {
    expect(buildCorrelationTags(ledger, REF, 1)?.[0]).toEqual({ name: "mm_ledger", value: ledger });
  });

  it.each([
    ["an unknown ledger", "newsletter", REF, 1],
    ["a missing ledger", null, REF, 1],
    ["an uppercase UUID", "owner_email", REF.toUpperCase(), 1],
    ["a non-UUID ref", "owner_email", "someone@example.test", 1],
    ["a null ref", "owner_email", null, 1],
    ["attempt 0", "owner_email", REF, 0],
    ["attempt 10,001", "owner_email", REF, 10_001],
    ["a fractional attempt", "owner_email", REF, 1.5],
    ["a string attempt", "owner_email", REF, "1"],
  ])("refuses %s", (_label, ledger, ref, attempt) => {
    expect(buildCorrelationTags(ledger, ref, attempt)).toBeNull();
  });

  it("round-trips through the 7.3B receiver's tag parser as a valid set, in both payload shapes", () => {
    for (const attempt of [1, 42, 10_000]) {
      const tags = buildCorrelationTags("owner_email", REF, attempt)!;
      const expected = { p_tag_status: "valid", p_tag_ledger: "owner_email", p_tag_ref: REF, p_tag_attempt: attempt };
      expect(correlationTags(tags)).toEqual(expected);
      expect(correlationTags(Object.fromEntries(tags.map((tag) => [tag.name, tag.value])))).toEqual(expected);
    }
  });
});

describe("validCorrelationTags", () => {
  const good = buildCorrelationTags("owner_email", REF, 2)!;
  it("returns a fresh copy of a valid set", () => {
    const copy = validCorrelationTags(good.map((tag) => ({ ...tag, extra: "dropped" })));
    expect(copy).toEqual(good);
    expect(copy?.[0]).not.toHaveProperty("extra");
  });
  it.each([
    ["no tags", []],
    ["a partial set", good.slice(0, 2)],
    ["a duplicate name", [good[0], good[0], good[2]]],
    ["an extra tag", [...good, { name: "mm_extra", value: "x" }]],
    ["a leading-zero attempt", [good[0], good[1], { name: "mm_attempt", value: "02" }]],
    ["an address in a value", [good[0], { name: "mm_ref", value: "someone@example.test" }, good[2]]],
    ["a non-array", { mm_ledger: "owner_email" }],
    ["a non-object entry", [good[0], good[1], "mm_attempt"]],
  ])("drops %s whole", (_label, tags) => {
    expect(validCorrelationTags(tags)).toBeNull();
  });
});

describe("shared sender: tags are opt-in and change nothing else", () => {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
  const env = { ...process.env };
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_synthetic_key";
    process.env.RESEND_FROM_EMAIL = "Mercurius <notifications@example.test>";
    process.env.OWNER_NOTIFICATION_EMAIL = "owner@example.test";
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });
  const message = { subject: "Synthetic subject", text: "Synthetic body", replyTo: "reply@example.test", idempotencyKey: "contact-submission-notification:x:1" };
  // The exact pre-7.3C request body for this message.
  const LEGACY_BODY = '{"from":"Mercurius <notifications@example.test>","to":["owner@example.test"],"subject":"Synthetic subject","text":"Synthetic body","reply_to":"reply@example.test"}';

  it.each([
    ["no tags field", {}],
    ["tags: undefined", { tags: undefined }],
    ["tags: null", { tags: null }],
    ["an empty set", { tags: [] }],
    ["an invalid set", { tags: [{ name: "mm_ledger", value: "owner_email" }] as never }],
  ])("%s sends the legacy body byte for byte", async (_label, extra) => {
    await sendOwnerNotification({ ...message, ...extra });
    expect(String(fetchMock.mock.calls[0][1].body)).toBe(LEGACY_BODY);
  });

  it("a valid set adds only the tags key, last; recipient, headers, key and timeout are unchanged", async () => {
    await sendOwnerNotification(message);
    const untaggedInit = fetchMock.mock.calls[0][1];
    const tags = buildCorrelationTags("owner_email", REF, 1)!;
    await sendOwnerNotification({ ...message, tags });
    const init = fetchMock.mock.calls[1][1];
    expect(String(init.body)).toBe(`${LEGACY_BODY.slice(0, -1)},"tags":${JSON.stringify(tags)}}`);
    expect(init.headers).toEqual(untaggedInit.headers);
    expect(init.method).toBe(untaggedInit.method);
    expect(fetchMock.mock.calls[1][0]).toBe(fetchMock.mock.calls[0][0]);
  });

  it("a vendor-recipient send (price draft) is untouched when it passes no tags", async () => {
    await sendNotificationEmail({ subject: "s", text: "t" }, "vendor@example.test");
    expect(String(fetchMock.mock.calls[0][1].body)).toBe('{"from":"Mercurius <notifications@example.test>","to":["vendor@example.test"],"subject":"s","text":"t"}');
  });
});

describe("S-50 evidence labels", () => {
  const facts: NonDeliveryFact[][] = [[], ["bounced_permanent"], ["provider_failed", "provider_suppressed"], ["bounced_permanent", "provider_failed", "provider_suppressed"]];
  const all = [
    ...([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as EvidenceRule[]).flatMap((rule) => facts.map((reported) => evidenceSummaryLabel({ rule, reported }))),
    ...Object.values(evidenceFactLabel),
    ...Object.values(exclusionLabel),
    ...conflictSignalLabels(["stored_conflict", "content_conflict", "current_conflict"]),
  ];

  it("never says Delivered, Received, Read or Confirmed alone or as the claim", () => {
    for (const label of all) {
      expect(label).not.toMatch(/^(Delivered|Received|Read|Confirmed)\b/i);
      expect(label).not.toMatch(/\b(Received|Confirmed)\b/i);
      expect(label.trim()).not.toMatch(/^(delivered|received|read|confirmed)\.?$/i);
    }
  });

  it("a server hand-off always carries the inbox disclaimer, and a complaint states the hand-off", () => {
    expect(evidenceSummaryLabel({ rule: 4, reported: [] })).toContain(NOT_INBOX_PROOF);
    expect(evidenceFactLabel.delivered).toContain(NOT_INBOX_PROOF);
    expect(evidenceSummaryLabel({ rule: 1, reported: [] })).toMatch(/^Handed to the mail server/);
    expect(evidenceFactLabel.complained).toMatch(/^Handed to the mail server/);
  });

  it("rule 2 says 'also reported' and never 'later'; rules 2 and 5 name what Resend reported", () => {
    expect(evidenceSummaryLabel({ rule: 2, reported: ["bounced_permanent", "provider_suppressed"] }))
      .toBe("Provider reports disagree: handed to the mail server, and also reported bounced permanently and suppressed");
    expect(evidenceSummaryLabel({ rule: 5, reported: ["provider_failed"] })).toBe("Not delivered: Resend reported a failure");
    expect(evidenceSummaryLabel({ rule: 5, reported: ["bounced_permanent", "provider_failed", "provider_suppressed"] }))
      .toBe("Not delivered: Resend reported a permanent bounce, a failure and suppression");
    for (const label of all) expect(label).not.toMatch(/\blater\b/i);
  });

  it("rules 9 and 10 make no delivery claim; inconclusive bounces say so", () => {
    expect(evidenceSummaryLabel({ rule: 9, reported: [] })).toBe("No provider report yet");
    expect(evidenceSummaryLabel({ rule: 10, reported: [] })).toBe("Delivery evidence not available");
    expect(evidenceFactLabel.bounced_transient).toMatch(/inconclusive/);
    expect(evidenceFactLabel.bounced_undetermined).toMatch(/inconclusive/);
  });

  it("stored and current conflicts use different wording; only a current conflict can count again", () => {
    const [stored] = conflictSignalLabels(["stored_conflict"]);
    const [current] = conflictSignalLabels(["current_conflict"]);
    expect(stored).toBe("Conflicting provider report — excluded from this summary.");
    expect(stored).not.toMatch(/count again/);
    expect(current).toMatch(/can count again/);
    expect(conflictSignalLabels(["content_conflict"])).toEqual([stored]);
    expect(conflictSignalLabels([])).toEqual([]);
  });
});
