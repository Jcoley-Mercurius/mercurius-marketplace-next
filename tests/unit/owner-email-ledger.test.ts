// TRACE-154 (Phase 7.2C-1 and 7.2C-2): owner-email ledger delivery for contact submissions and
// provider renewal-document submissions.
// Synthetic data, a fake Resend (stubbed fetch) and fake Supabase clients only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => Promise<void>) => { afterCallbacks.push(callback); },
}));

import {
  OPERATIONAL_LOG_SCHEMA,
  OPERATIONAL_LOG_SCHEMA_V2,
  buildOperationalLogRecord,
  logOperationalEvent,
  type OperationalLogInput,
} from "../../src/lib/observability/operationalLog";
import {
  contactNotificationMessage,
  deliverOwnerEmail,
  ownerEmailKey,
  renewalNotificationMessage,
  type ClaimedContactSubmission,
  type ClaimedRenewalDocument,
  type OwnerEmailKind,
} from "../../src/lib/ownerEmailNotifications";
import { sendOwnerNotification } from "../../src/lib/ownerNotifications";

const V1_KEYS = [
  "schema", "ts", "level", "env", "release", "event", "route", "correlation_id", "application_id",
  "attempt", "mode", "outcome", "error_code", "duration_ms",
];
const V2_KEYS = [...V1_KEYS, "source_kind", "source_id"].sort();

// Synthetic sentinels: none may ever appear in a log line.
const SENTINEL = {
  first: "Sentinelfirst",
  last: "Sentinellast",
  email: "sentinel.sender@example.test",
  phone: "239-555-0188",
  subject: "Sentinel subject about a leak",
  message: "Sentinel message body with details",
  ip: "203.0.113.88",
  serviceKey: "synthetic-service-role-key-SENTINEL-1111",
  resendKey: "re_SENTINEL-owner-key",
  claimId: "c1a1m000-0000-4000-8000-00000000c0de",
  providerBody: "Resend says sentinel.sender@example.test is invalid",
  providerMessageId: "msg_SENTINEL_provider_id",
  ackReason: "Sentinel acknowledgement reason",
  actor: "0be7a700-0000-4000-8000-00000000a0a0",
  correlationHeader: "evil\ncorrelation-SENTINEL",
  businessName: "Sentinel Renewal Business LLC",
  fileName: "SentinelRenewalFile",
  storagePath: "renewals/sentinel-storage-path",
};

const sourceId = "22222222-2222-4222-8222-222222222222";
const submission: ClaimedContactSubmission = {
  id: sourceId,
  created_at: "2026-11-12T15:04:05.123456+00:00",
  first_name: SENTINEL.first,
  last_name: SENTINEL.last,
  email: SENTINEL.email,
  phone: SENTINEL.phone,
  subject: SENTINEL.subject,
  message: SENTINEL.message,
};

const renewalId = "33333333-3333-4333-8333-333333333333";
const renewalDocument: ClaimedRenewalDocument = {
  id: renewalId,
  created_at: "2026-11-12T16:07:08.765432+00:00",
  kind: "license",
  business_name: SENTINEL.businessName,
};

type Line = Record<string, unknown>;

function captureLogs(options: { throwing?: boolean } = {}) {
  const raw: string[] = [];
  const sink = (value: unknown) => {
    raw.push(String(value));
    if (options.throwing) throw new Error("log sink unavailable");
  };
  const spies = [
    vi.spyOn(console, "info").mockImplementation(sink),
    vi.spyOn(console, "warn").mockImplementation(sink),
    vi.spyOn(console, "error").mockImplementation(sink),
    vi.spyOn(console, "log").mockImplementation(sink),
  ];
  return {
    raw,
    lines: () => raw.map((line) => JSON.parse(line) as Line),
    events: () => raw.map((line) => (JSON.parse(line) as Line).event),
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

function expectNoSensitiveData(raw: string[]) {
  const joined = raw.join("\n");
  for (const value of Object.values(SENTINEL)) expect(joined).not.toContain(value);
  expect(joined).not.toContain("contact-submission-notification:");
  expect(joined).not.toContain("renewal-document-notification:");
  expect(joined).not.toMatch(/stack|Error:|https?:\/\//);
  for (const line of raw) {
    const parsed = JSON.parse(line) as Line;
    const keys = Object.keys(parsed).sort();
    if (parsed.schema === OPERATIONAL_LOG_SCHEMA_V2) expect(keys).toEqual(V2_KEYS);
    else expect(keys).toEqual([...V1_KEYS].sort());
  }
}

type RpcCall = { name: string; args: Record<string, unknown> };
type Fault = "error" | "throw" | "commit_then_lose" | "malformed" | null;

/**
 * A model of the owner-email ledger: one claim per permitted attempt, outcome only for the
 * current claim, `initial` never claims a missed row, `resend` only after an operator request.
 * `stale` marks a row as past the claim window. The operator request mirrors
 * owner_email_request_resend, including the no-email attestation for missed/unknown rows.
 */
function ownerLedger(
  initial: { state: string; attempts: number; stale?: boolean } = { state: "pending", attempts: 0 },
  claimed: { kind: OwnerEmailKind; source: unknown } = { kind: "contact_submission", source: submission },
) {
  const ledger = { ...initial, stale: initial.stale ?? false, claim: null as string | null };
  const calls: RpcCall[] = [];
  const faults = { claim: null as Fault, record: null as "error" | "throw" | null };
  const view = () => (ledger.stale && ledger.state === "pending" ? "missed" : ledger.stale && ledger.state === "sending" ? "unknown" : ledger.state);
  const claim = () => {
    ledger.state = "sending";
    ledger.stale = false;
    ledger.attempts += 1;
    ledger.claim = `${SENTINEL.claimId}-${ledger.attempts}`;
    return { claimed: true, claim_id: ledger.claim, attempt: ledger.attempts, kind: claimed.kind, source: claimed.source };
  };
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      await Promise.resolve();
      if (name === "owner_email_claim") {
        const permitted = args.p_mode === "initial" ? view() === "pending" : ledger.state === "resend_requested";
        if (faults.claim === "error") return { data: null, error: { code: "08006", message: `connection lost ${SENTINEL.email}` } };
        if (faults.claim === "throw") throw new TypeError(`fetch failed ${SENTINEL.ip}`);
        if (faults.claim === "malformed") return { data: { claimed: true, subject: SENTINEL.subject }, error: null };
        if (!permitted) return { data: { claimed: false, state: view() }, error: null };
        const result = claim();
        // The claim committed in the database, but its response never arrived.
        if (faults.claim === "commit_then_lose") return { data: null, error: { code: "57014", message: `canceling statement due to statement timeout ${SENTINEL.email}` } };
        return { data: result, error: null };
      }
      if (name === "owner_email_record") {
        if (faults.record === "throw") throw new TypeError("fetch failed");
        if (faults.record === "error" || ledger.state !== "sending" || args.p_claim !== ledger.claim) {
          return { data: null, error: { code: "40001", message: `Owner email claim is not current ${SENTINEL.email}` } };
        }
        ledger.state = args.p_outcome as string;
        ledger.claim = null;
        return { data: { state: ledger.state, attempt: ledger.attempts }, error: null };
      }
      return { data: null, error: { code: "42883", message: "unexpected rpc" } };
    }),
  };
  /** Mirrors owner_email_request_resend for the operator's session client. */
  const requestResend = (confirmNoEmail: boolean) => {
    const state = view();
    if (state === "resend_requested") return { data: { state }, error: null };
    if (!["failed", "missed", "unknown"].includes(state)) {
      return { data: null, error: { code: "55000", message: `This owner email cannot be resent from ${state}` } };
    }
    if (state !== "failed" && !confirmNoEmail) {
      return { data: null, error: { code: "55000", message: "Check the owner inbox and the Resend log, and confirm no matching email arrived, before resending" } };
    }
    ledger.state = "resend_requested";
    ledger.claim = null;
    ledger.stale = false;
    return { data: { state: "resend_requested", attempt: ledger.attempts }, error: null };
  };
  return { client: client as unknown as SupabaseClient, calls, ledger, faults, requestResend, view };
}

function stubProvider(respond: () => Promise<Response>) {
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const env = { ...process.env };
beforeEach(() => {
  process.env.RESEND_API_KEY = SENTINEL.resendKey;
  process.env.RESEND_FROM_EMAIL = "Mercurius <notifications@example.test>";
  process.env.OWNER_NOTIFICATION_EMAIL = "owner@example.test";
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const trace = { route: "contact_submit" as const, correlationId: "5e1f2c3d-4b5a-4c6d-8e7f-9a0b1c2d3e4f" };
const renewalTrace = { route: "renewal_document_submit" as const, correlationId: "6f2a3b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b" };

describe("operational log v2 (C-5): owner-email events, v1 unchanged", () => {
  const base: OperationalLogInput = {
    event: "owner_email.claimed",
    route: "contact_submit",
    correlationId: trace.correlationId,
    sourceKind: "contact_submission",
    sourceId,
    attempt: 1,
    mode: "initial",
    outcome: "claimed",
  };

  it("writes a v2 line with exactly the 16 keys", () => {
    const logs = captureLogs();
    logOperationalEvent({ ...base, ...({ email: SENTINEL.email, subject: SENTINEL.subject } as object) } as OperationalLogInput);
    const [line] = logs.lines();
    expect(Object.keys(line).sort()).toEqual(V2_KEYS);
    expect(line).toMatchObject({
      schema: "mercurius.oplog.v2", event: "owner_email.claimed", route: "contact_submit",
      source_kind: "contact_submission", source_id: sourceId, application_id: null, attempt: 1, mode: "initial", outcome: "claimed",
    });
    expectNoSensitiveData(logs.raw);
  });

  it("keeps every v1 event at exactly its 14 keys and schema v1, even if a caller passes source fields", () => {
    const record = buildOperationalLogRecord({
      event: "application_notification.claimed", route: "vendor_application_submit", correlationId: trace.correlationId,
      applicationId: sourceId, sourceKind: "contact_submission", sourceId,
    });
    expect(record.schema).toBe(OPERATIONAL_LOG_SCHEMA);
    expect(OPERATIONAL_LOG_SCHEMA).toBe("mercurius.oplog.v1");
    expect(Object.keys(record)).toEqual(V1_KEYS);
    const invalid = buildOperationalLogRecord({ ...base, event: "owner_email.made_up" as never });
    expect(invalid).toMatchObject({ schema: "mercurius.oplog.v1", event: "oplog.invalid_event", level: "error" });
    expect(Object.keys(invalid)).toEqual(V1_KEYS);
  });

  it("the schema version is fixed by the event name, not the caller", () => {
    const forged = buildOperationalLogRecord({ ...base, ...({ schema: "mercurius.oplog.v1" } as object) } as OperationalLogInput);
    expect(forged.schema).toBe("mercurius.oplog.v2");
  });

  it("drops a malicious source kind or source ID", () => {
    expect(buildOperationalLogRecord({ ...base, sourceKind: "newsletter" as never, sourceId: `${sourceId}\n{"event":"forged"}` }))
      .toMatchObject({ source_kind: null, source_id: null });
    expect(buildOperationalLogRecord({ ...base, sourceId: SENTINEL.email })).toMatchObject({ source_id: null });
  });

  it.each([
    ["owner_email.claim_failed", "error"], ["owner_email.record_failed", "error"], ["owner_email.background_failed", "error"],
    ["owner_email.not_claimed", "warn"], ["contact_submission.refused", "warn"], ["owner_email_resend.refused", "warn"],
    ["contact_submission.saved", "info"], ["owner_email.recorded", "info"],
  ] as const)("%s logs at %s", (event, level) => {
    expect(buildOperationalLogRecord({ ...base, event })).toMatchObject({ level, schema: "mercurius.oplog.v2" });
  });

  it("never throws when the sink throws", () => {
    captureLogs({ throwing: true });
    expect(() => logOperationalEvent(base)).not.toThrow();
  });
});

describe("delivery helper", () => {
  it.each([
    ["accepted", () => new Response(JSON.stringify({ id: SENTINEL.providerMessageId }), { status: 200 }), "sent", null],
    ["422 refusal", () => new Response(SENTINEL.providerBody, { status: 422 }), "failed", "provider_refused"],
    ["429 rate limit", () => new Response(SENTINEL.providerBody, { status: 429 }), "failed", "provider_rate_limited"],
    ["409 concurrent key", () => new Response(SENTINEL.providerBody, { status: 409 }), "unknown", "provider_conflict"],
    ["500 server error", () => new Response(SENTINEL.providerBody, { status: 500 }), "unknown", "provider_server_error"],
    ["503 server error", () => new Response(SENTINEL.providerBody, { status: 503 }), "unknown", "provider_server_error"],
    ["timeout", () => { throw new DOMException(`timeout ${SENTINEL.email}`, "TimeoutError"); }, "unknown", "provider_timeout_or_network"],
    ["network error", () => { throw new TypeError(`fetch failed ${SENTINEL.ip}`); }, "unknown", "provider_timeout_or_network"],
  ] as const)("%s → %s, recorded with an enumerated code only", async (_label, respond, state, errorCode) => {
    const fetchMock = stubProvider(async () => respond());
    const { client, calls, ledger } = ownerLedger();
    const logs = captureLogs();
    expect(await deliverOwnerEmail(client, "contact_submission", sourceId, "initial", sendOwnerNotification, trace)).toEqual({ state, attempt: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls.map((call) => call.name)).toEqual(["owner_email_claim", "owner_email_record"]);
    expect(calls[1].args).toEqual({
      p_kind: "contact_submission", p_source: sourceId, p_claim: `${SENTINEL.claimId}-1`, p_outcome: state,
      p_provider_id: state === "sent" ? SENTINEL.providerMessageId : null, p_error_code: errorCode,
    });
    expect(ledger.state).toBe(state);
    expect(logs.events()).toEqual(["owner_email.claimed", "owner_email.provider_result", "owner_email.recorded"]);
    expect(logs.lines()[1]).toMatchObject({ outcome: state, error_code: errorCode, attempt: 1, source_id: sourceId });
    expectNoSensitiveData(logs.raw);
  });

  it("missing provider configuration is a definite failure without a send", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = stubProvider(async () => new Response("{}"));
    const { client, calls } = ownerLedger();
    captureLogs();
    expect(await deliverOwnerEmail(client, "contact_submission", sourceId, "initial", sendOwnerNotification, trace)).toEqual({ state: "failed", attempt: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls[1].args.p_error_code).toBe("provider_not_configured");
  });

  it("sends the saved record's content with a per-attempt key and the submitter as reply-to", async () => {
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    const { client } = ownerLedger();
    captureLogs();
    await deliverOwnerEmail(client, "contact_submission", sourceId, "initial", sendOwnerNotification, trace);
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(`contact-submission-notification:${sourceId}:1`);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ to: ["owner@example.test"], reply_to: SENTINEL.email, ...{ subject: contactNotificationMessage(submission).subject } });
    expect(body.text).toBe(contactNotificationMessage(submission).text);
  });

  it("a refused claim sends nothing", async () => {
    for (const state of ["sent", "failed", "acknowledged", "sending"]) {
      const { client, calls } = ownerLedger({ state, attempts: 1 });
      const send = vi.fn();
      const logs = captureLogs();
      expect(await deliverOwnerEmail(client, "contact_submission", sourceId, "initial", send, trace)).toEqual({ state: "not_claimed", current: state });
      expect(send).not.toHaveBeenCalled();
      expect(calls).toHaveLength(1);
      expect(logs.lines()).toEqual([expect.objectContaining({ event: "owner_email.not_claimed", outcome: state, level: "warn" })]);
      vi.restoreAllMocks();
    }
  });

  it("R-4: an initial delivery never claims a missed row", async () => {
    const { client, ledger } = ownerLedger({ state: "pending", attempts: 0, stale: true });
    const send = vi.fn();
    captureLogs();
    expect(await deliverOwnerEmail(client, "contact_submission", sourceId, "initial", send, trace)).toEqual({ state: "not_claimed", current: "missed" });
    expect(send).not.toHaveBeenCalled();
    expect(ledger).toMatchObject({ state: "pending", attempts: 0 });
  });

  it.each([
    ["a database error", "error", "db_unavailable"],
    ["a thrown network error", "throw", "network_error"],
    ["a malformed claim result", "malformed", "unexpected"],
  ] as const)("14a: %s on claim sends nothing and returns claim_failed", async (_label, fault, code) => {
    const { client, calls, ledger, faults } = ownerLedger();
    faults.claim = fault;
    const send = vi.fn();
    const logs = captureLogs();
    expect(await deliverOwnerEmail(client, "contact_submission", sourceId, "initial", send, trace)).toEqual({ state: "claim_failed" });
    expect(send).not.toHaveBeenCalled();
    expect(calls.map((call) => call.name)).toEqual(["owner_email_claim"]);
    expect(ledger).toMatchObject({ state: "pending", attempts: 0 });
    expect(logs.lines()).toEqual([expect.objectContaining({ event: "owner_email.claim_failed", error_code: code, level: "error", source_id: sourceId })]);
    expectNoSensitiveData(logs.raw);
  });

  it("clarification 1: a claim that commits but whose response is lost sends nothing, is not retried, and needs an attested resend", async () => {
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    const fake = ownerLedger();
    fake.faults.claim = "commit_then_lose";
    captureLogs();
    expect(await deliverOwnerEmail(fake.client, "contact_submission", sourceId, "initial", sendOwnerNotification, trace)).toEqual({ state: "claim_failed" });
    // The database committed the claim; the helper neither sent nor reset nor claimed again.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.calls.map((call) => call.name)).toEqual(["owner_email_claim"]);
    expect(fake.ledger).toMatchObject({ state: "sending", attempts: 1 });

    // A later initial delivery for the same record cannot claim it either.
    fake.faults.claim = null;
    expect(await deliverOwnerEmail(fake.client, "contact_submission", sourceId, "initial", sendOwnerNotification, trace)).toEqual({ state: "not_claimed", current: "sending" });
    expect(fetchMock).not.toHaveBeenCalled();

    // Inside the window an operator cannot resend; past it the row reads unknown and the
    // resend needs the no-email attestation.
    expect(fake.requestResend(true).error?.code).toBe("55000");
    fake.ledger.stale = true;
    expect(fake.view()).toBe("unknown");
    expect(await deliverOwnerEmail(fake.client, "contact_submission", sourceId, "initial", sendOwnerNotification, trace)).toEqual({ state: "not_claimed", current: "unknown" });
    expect(fake.requestResend(false).error?.message).toMatch(/confirm no matching email/);
    expect(fake.requestResend(true).data?.state).toBe("resend_requested");
    expect(await deliverOwnerEmail(fake.client, "contact_submission", sourceId, "resend", sendOwnerNotification, trace)).toEqual({ state: "sent", attempt: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)["Idempotency-Key"]).toBe(ownerEmailKey("contact_submission", sourceId, 2));
  });

  it.each(["error", "throw"] as const)("an outcome-recording %s is unrecorded and leaves the row sending", async (fault) => {
    const { client, ledger, faults } = ownerLedger();
    faults.record = fault;
    const send = vi.fn(async () => ({ ok: true as const, id: "msg" }));
    const logs = captureLogs();
    expect(await deliverOwnerEmail(client, "contact_submission", sourceId, "initial", send, trace)).toEqual({ state: "unrecorded", attempt: 1 });
    expect(ledger.state).toBe("sending");
    expect(logs.lines().at(-1)).toMatchObject({ event: "owner_email.record_failed", outcome: "unrecorded", level: "error" });
    expectNoSensitiveData(logs.raw);
  });

  it("12: concurrent deliveries send once; an authorized resend is attempt 2 with a new key", async () => {
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    const fake = ownerLedger();
    captureLogs();
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => deliverOwnerEmail(fake.client, "contact_submission", sourceId, "initial", sendOwnerNotification, trace)));
    expect(outcomes.filter((outcome) => outcome.state === "sent")).toEqual([{ state: "sent", attempt: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fake.ledger.state = "failed";
    fake.requestResend(false);
    const resends = await Promise.all(Array.from({ length: 4 }, () => deliverOwnerEmail(fake.client, "contact_submission", sourceId, "resend", sendOwnerNotification, trace)));
    expect(resends.filter((outcome) => outcome.state === "sent")).toEqual([{ state: "sent", attempt: 2 }]);
    const keys = fetchMock.mock.calls.map(([, init]) => (init.headers as Record<string, string>)["Idempotency-Key"]);
    expect(keys).toEqual([ownerEmailKey("contact_submission", sourceId, 1), ownerEmailKey("contact_submission", sourceId, 2)]);
  });

  it("12: a same-attempt provider replay records once", async () => {
    // Resend replays the first result for a repeated key; a duplicate record for that claim is refused.
    const fake = ownerLedger();
    captureLogs();
    const send = vi.fn(async () => ({ ok: true as const, id: "msg_replayed" }));
    expect(await deliverOwnerEmail(fake.client, "contact_submission", sourceId, "initial", send, trace)).toEqual({ state: "sent", attempt: 1 });
    const replay = await fake.client.rpc("owner_email_record", { p_kind: "contact_submission", p_source: sourceId, p_claim: `${SENTINEL.claimId}-1`, p_outcome: "sent", p_provider_id: "msg_replayed", p_error_code: null });
    expect(replay.error).toMatchObject({ code: "40001" });
    expect(fake.calls.filter((call) => call.name === "owner_email_record")).toHaveLength(2);
    expect(fake.ledger).toMatchObject({ state: "sent", attempts: 1 });
  });

  it("a throwing log sink changes no outcome and skips no recording", async () => {
    stubProvider(async () => new Response("down", { status: 503 }));
    const { client, calls, ledger } = ownerLedger();
    captureLogs({ throwing: true });
    expect(await deliverOwnerEmail(client, "contact_submission", sourceId, "initial", sendOwnerNotification, trace)).toEqual({ state: "unknown", attempt: 1 });
    expect(calls.map((call) => call.name)).toEqual(["owner_email_claim", "owner_email_record"]);
    expect(ledger.state).toBe("unknown");
  });
});

describe("13: content parity with the pre-7.2C route", () => {
  it.each([
    ["with a phone", { phone: "239-555-0100", subject: "  Lawn   question\n about\tedging  ", message: "Hello there.\nSecond line." }],
    ["without a phone", { phone: null, subject: "x".repeat(200), message: "Hello." }],
    ["with request context", { phone: null, subject: "Coverage interest", message: "Please add my ZIP.", request_id: "REQ-1234" }],
  ])("matches subject, body, reply-to and fallbacks %s", async (_label, overrides) => {
    const createdAt = submission.created_at;
    // The legacy route builds the email from the parsed request with the route clock; the
    // row it inserts is what the new claim reads back.
    const legacySends: Array<{ subject: string; text: string; replyTo?: string | null }> = [];
    const legacyRows: Array<Record<string, unknown>> = [];
    vi.resetModules();
    vi.doMock("@/lib/ownerNotifications", () => ({ sendOwnerNotification: async (n: never) => { legacySends.push(n); return { ok: true, id: null }; } }));
    vi.doMock("@/lib/env/server", () => ({ getServiceSupabaseEnvironment: () => ({ supabaseUrl: "http://127.0.0.1:1", serviceRoleKey: SENTINEL.serviceKey }) }));
    vi.doMock("@/lib/intakeProtection", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/lib/intakeProtection")>()),
      intakeGuardRefusal: () => null,
      recordIntakeSubmission: async () => "accepted",
    }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient: () => ({ from: () => ({ insert: async (row: Record<string, unknown>) => { legacyRows.push(row); return { error: null }; } }) }) }));
    vi.useFakeTimers({ now: new Date(createdAt), toFake: ["Date"] });
    afterCallbacks.length = 0;
    try {
      const { POST } = await import("../fixtures/legacy-contact-submission-route");
      const response = await POST(new Request("http://localhost/api/contact-submissions", {
        method: "POST",
        body: JSON.stringify({ intake: {}, first_name: " Pat ", last_name: "Example", email: "PAT@example.test", phone: overrides.phone ?? "", ...overrides }),
      }));
      expect(response.status).toBe(201);
      await Promise.all(afterCallbacks.map((callback) => callback()));
    } finally {
      vi.useRealTimers();
      for (const name of ["@/lib/ownerNotifications", "@/lib/env/server", "@/lib/intakeProtection", "@supabase/supabase-js"]) vi.doUnmock(name);
    }
    expect(legacySends).toHaveLength(1);
    expect(legacyRows).toHaveLength(1);
    const current = contactNotificationMessage({ ...(legacyRows[0] as ClaimedContactSubmission), id: sourceId, created_at: createdAt });
    expect(current.subject).toBe(legacySends[0].subject);
    expect(current.replyTo).toBe(legacySends[0].replyTo);
    expect(current.text).toBe(legacySends[0].text);
    expect(current.text).toMatch(/^Submitted: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m);
  }, 60_000);

  it("formats the saved timestamp as the old route clock did", () => {
    expect(contactNotificationMessage(submission).text.split("\n")[2]).toBe("Submitted: 2026-11-12T15:04:05.123Z");
    expect(contactNotificationMessage({ ...submission, phone: null }).text).toContain("Phone: Not provided");
    expect(contactNotificationMessage({ ...submission, last_name: null }).text).toContain(`Name: ${SENTINEL.first}\n`);
  });
});

// Importing a route compiles its dependency graph; allow for a loaded CI host.
describe("contact route and operator resend route", { timeout: 60_000 }, () => {
  let fake: ReturnType<typeof ownerLedger>;
  const inserted: Array<Record<string, unknown>> = [];
  let insertError: unknown;
  let operator: { user: { id: string } | null; requestError: { code: string; message: string } | null; confirmations: unknown[] };
  const intake: { guard: "trap" | "too_fast" | null; limit: string } = { guard: null, limit: "accepted" };

  beforeEach(() => {
    intake.guard = null;
    intake.limit = "accepted";
    inserted.length = 0;
    afterCallbacks.length = 0;
    insertError = null;
    fake = ownerLedger();
    operator = { user: { id: SENTINEL.actor }, requestError: null, confirmations: [] };
    vi.resetModules();
    vi.doMock("@/lib/env/server", () => ({
      getServiceSupabaseEnvironment: () => ({ supabaseUrl: "http://127.0.0.1:1", serviceRoleKey: SENTINEL.serviceKey }),
      getOwnerNotificationEnvironment: () => ({ apiKey: SENTINEL.resendKey, from: "Mercurius <n@example.test>", to: "owner@example.test" }),
    }));
    vi.doMock("@/lib/intakeProtection", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/lib/intakeProtection")>()),
      intakeGuardRefusal: () => intake.guard,
      recordIntakeSubmission: async () => intake.limit,
    }));
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        from: () => ({
          insert: (row: Record<string, unknown>) => {
            // The AFTER INSERT trigger: the saved row and its pending ledger row commit together.
            const commit = () => {
              if (insertError) return { data: null, error: insertError };
              inserted.push({ ...row, id: sourceId });
              return { data: { id: sourceId }, error: null };
            };
            return {
              select: () => ({ single: async () => commit() }),
              then: (resolve: (value: unknown) => void) => resolve({ error: commit().error }),
            };
          },
        }),
        rpc: (name: string, args: Record<string, unknown>) => fake.client.rpc(name, args),
      }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: operator.user }, error: null }) },
        rpc: async (name: string, args: Record<string, unknown>) => {
          if (name !== "owner_email_request_resend") throw new Error("unexpected rpc");
          operator.confirmations.push(args.p_confirm_no_email);
          if (operator.requestError) return { data: null, error: operator.requestError };
          return fake.requestResend(args.p_confirm_no_email === true);
        },
      }),
    }));
  });
  afterEach(() => {
    for (const name of ["@supabase/supabase-js", "@/lib/env/server", "@/lib/intakeProtection", "@/lib/supabase/server"]) vi.doUnmock(name);
  });

  function contact(extra: Record<string, unknown> = {}) {
    return new Request("http://localhost/api/contact-submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-correlation-id": SENTINEL.correlationHeader.replace("\n", " "), "x-forwarded-for": SENTINEL.ip },
      body: JSON.stringify({
        intake: {}, first_name: SENTINEL.first, last_name: SENTINEL.last, email: SENTINEL.email, phone: SENTINEL.phone,
        subject: SENTINEL.subject, message: SENTINEL.message, ...extra,
      }),
    });
  }
  function resend(body: unknown) {
    return new Request("http://localhost/api/admin/owner-emails", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  it("saves, responds 201 before the email, then claims the saved ID and records the outcome", async () => {
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/contact-submissions/route");
    const response = await POST(contact());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ submitted: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.calls).toHaveLength(0);
    await Promise.all(afterCallbacks.map((callback) => callback()));
    expect(fake.calls.map((call) => [call.name, call.args.p_source])).toEqual([["owner_email_claim", sourceId], ["owner_email_record", sourceId]]);
    expect(fake.ledger).toMatchObject({ state: "sent", attempts: 1 });
    const lines = logs.lines();
    expect(lines.map((line) => line.event)).toEqual(["contact_submission.saved", "owner_email.claimed", "owner_email.provider_result", "owner_email.recorded"]);
    expect(new Set(lines.map((line) => line.correlation_id)).size).toBe(1);
    expect(lines[0].correlation_id).not.toContain("correlation-SENTINEL");
    for (const line of lines) expect(line).toMatchObject({ schema: "mercurius.oplog.v2", route: "contact_submit", source_id: sourceId });
    expectNoSensitiveData(logs.raw);
  });

  it.each([
    ["the provider throws", "provider"],
    ["the claim RPC errors", "claim"],
    ["the logger sink throws", "logger"],
  ] as const)("14: the submission succeeds when %s", async (_label, failure) => {
    if (failure === "provider") vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(`boom ${SENTINEL.email}`); }));
    else stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    if (failure === "claim") fake.faults.claim = "error";
    const logs = captureLogs({ throwing: failure === "logger" });
    const { POST } = await import("../../src/app/api/contact-submissions/route");
    const response = await POST(contact());
    expect(response.status).toBe(201);
    expect(inserted).toHaveLength(1);
    await expect(Promise.all(afterCallbacks.map((callback) => callback()))).resolves.toBeDefined();
    if (failure !== "logger") expectNoSensitiveData(logs.raw);
    if (failure === "claim") expect(fake.ledger.state).toBe("pending");
  });

  it("keeps the existing 400, 429 and 500 responses and logs codes only", async () => {
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/contact-submissions/route");
    const invalid = await POST(contact({ email: "not-an-email" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Enter a valid email address." });
    insertError = { code: "23505", message: `duplicate ${SENTINEL.email}` };
    const failed = await POST(contact());
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Your message could not be submitted. Please try again." });
    expect((await POST(new Request("http://localhost/api/contact-submissions", { method: "POST", body: `{"email":"${SENTINEL.email}"` }))).status).toBe(500);
    expect(afterCallbacks).toHaveLength(0);
    expect(logs.lines().map((line) => [line.event, line.outcome, line.error_code])).toEqual([
      ["contact_submission.refused", "invalid", "validation_failed"],
      ["contact_submission.failed", "failed", "db_constraint"],
      ["contact_submission.failed", "failed", "request_unreadable"],
    ]);
    expectNoSensitiveData(logs.raw);
  });

  it.each([
    ["trap", "accepted", "intake_trap"], ["too_fast", "accepted", "intake_too_fast"],
    [null, "email_limit", "intake_email_limit"], [null, "ip_limit", "intake_ip_limit"],
  ] as const)("intake refusal %s/%s stays 429 with the same body", async (guard, limit, code) => {
    intake.guard = guard;
    intake.limit = limit;
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/contact-submissions/route");
    const response = await POST(contact());
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Please try again later." });
    expect(inserted).toHaveLength(0);
    expect(logs.lines()).toEqual([expect.objectContaining({ event: "contact_submission.refused", outcome: "refused", error_code: code })]);
  });

  it("F-3: a double submit still creates two submissions (no idempotency is claimed)", async () => {
    stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    captureLogs();
    const { POST } = await import("../../src/app/api/contact-submissions/route");
    expect((await POST(contact())).status).toBe(201);
    expect((await POST(contact())).status).toBe(201);
    expect(inserted).toHaveLength(2);
  });

  it("26: the old route on the new schema never claims, so its row stays pending for attested recovery", async () => {
    const legacySend = vi.fn(async () => ({ ok: true as const, id: "msg_legacy" }));
    vi.doMock("@/lib/ownerNotifications", () => ({ sendOwnerNotification: legacySend }));
    captureLogs();
    const { POST } = await import("../fixtures/legacy-contact-submission-route");
    expect((await POST(contact())).status).toBe(201);
    await Promise.all(afterCallbacks.map((callback) => callback()));
    vi.doUnmock("@/lib/ownerNotifications");
    expect(legacySend).toHaveBeenCalledTimes(1);
    expect(fake.calls).toHaveLength(0);
    expect(fake.ledger).toMatchObject({ state: "pending", attempts: 0 });
    // After the window the new release does not claim it, and recovery needs the attestation.
    fake.ledger.stale = true;
    const send = vi.fn();
    expect(await deliverOwnerEmail(fake.client, "contact_submission", sourceId, "initial", send, trace)).toEqual({ state: "not_claimed", current: "missed" });
    expect(send).not.toHaveBeenCalled();
    expect(fake.requestResend(false).error?.code).toBe("55000");
  });

  it("16: an operator resend of a failed email sends once; the attestation flag is passed only when confirmed", async () => {
    fake.ledger.state = "failed";
    fake.ledger.attempts = 1;
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/admin/owner-emails/route");
    const response = await POST(resend({ kind: "contact_submission", sourceId, confirmNoEmail: "yes" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "sent", message: "Resend accepted the email. Confirm it arrived in the owner inbox." });
    expect(operator.confirmations).toEqual([false]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fake.ledger).toMatchObject({ state: "sent", attempts: 2 });
    expect(logs.lines().map((line) => line.event)).toEqual([
      "owner_email_resend.requested", "owner_email.claimed", "owner_email.provider_result", "owner_email.recorded", "owner_email_resend.completed",
    ]);
    for (const line of logs.lines()) expect(line).toMatchObject({ route: "owner_email_resend", source_id: sourceId, mode: "resend" });
    expectNoSensitiveData(logs.raw);
  });

  it("16: an unknown email needs the confirmed attestation; without it nothing is sent", async () => {
    fake.ledger.state = "sending";
    fake.ledger.attempts = 1;
    fake.ledger.stale = true;
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    captureLogs();
    const { POST } = await import("../../src/app/api/admin/owner-emails/route");
    const refused = await POST(resend({ kind: "contact_submission", sourceId }));
    expect(refused.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    const allowed = await POST(resend({ kind: "contact_submission", sourceId, confirmNoEmail: true }));
    expect(allowed.status).toBe(200);
    expect(operator.confirmations).toEqual([false, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("16: status mapping and no send for anonymous or non-operator callers", async () => {
    fake.ledger.state = "failed";
    const fetchMock = stubProvider(async () => new Response("{}"));
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/admin/owner-emails/route");
    expect((await POST(resend({ kind: "newsletter", sourceId }))).status).toBe(400);
    expect((await POST(resend({ kind: "contact_submission", sourceId: `${SENTINEL.email}' or 1=1` }))).status).toBe(400);
    operator.user = null;
    expect((await POST(resend({ kind: "contact_submission", sourceId }))).status).toBe(401);
    operator.user = { id: SENTINEL.actor };
    for (const [code, status] of [["42501", 403], ["P0002", 404], ["55000", 409], ["XX000", 500]] as const) {
      operator.requestError = { code, message: `refused ${code}` };
      expect((await POST(resend({ kind: "contact_submission", sourceId }))).status).toBe(status);
    }
    expect(fake.calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.lines().map((line) => [line.event, line.outcome, line.error_code])).toEqual([
      ["owner_email_resend.refused", "invalid", "validation_failed"],
      ["owner_email_resend.refused", "invalid", "validation_failed"],
      ["owner_email_resend.refused", "unauthenticated", null],
      ["owner_email_resend.refused", "forbidden", "db_permission_denied"],
      ["owner_email_resend.refused", "not_found", "db_not_found"],
      ["owner_email_resend.refused", "conflict", "db_state_conflict"],
      ["owner_email_resend.failed", "failed", "db_error"],
    ]);
    expect(logs.raw.join("\n")).not.toContain("or 1=1");
    expectNoSensitiveData(logs.raw);
  });

  it("16: a lost resend claim response sends nothing and says so", async () => {
    fake.ledger.state = "failed";
    fake.faults.claim = "commit_then_lose";
    const fetchMock = stubProvider(async () => new Response("{}"));
    captureLogs();
    const { POST } = await import("../../src/app/api/admin/owner-emails/route");
    const response = await POST(resend({ kind: "contact_submission", sourceId }));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/did not confirm the send attempt\. Nothing was sent/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.ledger).toMatchObject({ state: "sending", attempts: 1 });
    // A second operator click is refused by the database inside the window: no blind retry.
    fake.faults.claim = null;
    expect((await POST(resend({ kind: "contact_submission", sourceId }))).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("16: a resend that loses the claim to a concurrent one sends nothing more", async () => {
    fake.ledger.state = "failed";
    fake.ledger.attempts = 1;
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    captureLogs();
    const { POST } = await import("../../src/app/api/admin/owner-emails/route");
    const responses = await Promise.all(Array.from({ length: 3 }, () => POST(resend({ kind: "contact_submission", sourceId }))));
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409, 409]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fake.ledger).toMatchObject({ state: "sent", attempts: 2 });
  });
  it("7.2C-2: an operator resend of a failed renewal email sends once with the renewal key and wording", async () => {
    fake = ownerLedger({ state: "failed", attempts: 1 }, { kind: "renewal_document", source: renewalDocument });
    const fetchMock = stubProvider(async () => new Response(SENTINEL.providerBody, { status: 422 }));
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/admin/owner-emails/route");
    const response = await POST(resend({ kind: "renewal_document", sourceId: renewalId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "failed", message: "Resend refused the email. The renewal document is still saved." });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(`renewal-document-notification:${renewalId}:2`);
    expect(fake.calls.map((call) => [call.name, call.args.p_kind])).toEqual([["owner_email_claim", "renewal_document"], ["owner_email_record", "renewal_document"]]);
    expect(fake.ledger).toMatchObject({ state: "failed", attempts: 2 });
    for (const line of logs.lines()) expect(line).toMatchObject({ route: "owner_email_resend", source_kind: "renewal_document", source_id: renewalId });
    expectNoSensitiveData(logs.raw);
  });

  it("7.2C-2: an unknown renewal email needs the attestation; a lost renewal claim response sends nothing", async () => {
    fake = ownerLedger({ state: "sending", attempts: 1, stale: true }, { kind: "renewal_document", source: renewalDocument });
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    captureLogs();
    const { POST } = await import("../../src/app/api/admin/owner-emails/route");
    expect((await POST(resend({ kind: "renewal_document", sourceId: renewalId }))).status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    fake.faults.claim = "commit_then_lose";
    const lost = await POST(resend({ kind: "renewal_document", sourceId: renewalId, confirmNoEmail: true }));
    expect(lost.status).toBe(500);
    expect((await lost.json()).error).toMatch(/Nothing was sent from this request/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fake.ledger).toMatchObject({ state: "sending", attempts: 2 });
    expect(operator.confirmations).toEqual([false, true]);
  });
});


describe("7.2C-2: renewal-document owner emails", { timeout: 60_000 }, () => {
  it.each([
    ["accepted", () => new Response(JSON.stringify({ id: SENTINEL.providerMessageId }), { status: 200 }), "sent", null],
    ["422 refusal", () => new Response(SENTINEL.providerBody, { status: 422 }), "failed", "provider_refused"],
    ["429 rate limit", () => new Response(SENTINEL.providerBody, { status: 429 }), "failed", "provider_rate_limited"],
    ["409 concurrent key", () => new Response(SENTINEL.providerBody, { status: 409 }), "unknown", "provider_conflict"],
    ["500 server error", () => new Response(SENTINEL.providerBody, { status: 500 }), "unknown", "provider_server_error"],
    ["503 server error", () => new Response(SENTINEL.providerBody, { status: 503 }), "unknown", "provider_server_error"],
    ["timeout", () => { throw new DOMException(`timeout ${SENTINEL.businessName}`, "TimeoutError"); }, "unknown", "provider_timeout_or_network"],
    ["network error", () => { throw new TypeError(`fetch failed ${SENTINEL.ip}`); }, "unknown", "provider_timeout_or_network"],
  ] as const)("provider %s, with the renewal key and content, recorded with a code only", async (_label, respond, state, errorCode) => {
    const fetchMock = stubProvider(async () => respond());
    const { client, calls, ledger } = ownerLedger(undefined, { kind: "renewal_document", source: renewalDocument });
    const logs = captureLogs();
    expect(await deliverOwnerEmail(client, "renewal_document", renewalId, "initial", sendOwnerNotification, renewalTrace)).toEqual({ state, attempt: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(`renewal-document-notification:${renewalId}:1`);
    const body = JSON.parse(String(init.body));
    expect(body.subject).toBe(renewalNotificationMessage(renewalDocument).subject);
    expect(body.text).toBe(renewalNotificationMessage(renewalDocument).text);
    expect(body).not.toHaveProperty("reply_to");
    expect(calls.map((call) => [call.name, call.args.p_kind, call.args.p_source])).toEqual([
      ["owner_email_claim", "renewal_document", renewalId], ["owner_email_record", "renewal_document", renewalId],
    ]);
    expect(calls[1].args).toMatchObject({ p_outcome: state, p_error_code: errorCode });
    expect(ledger.state).toBe(state);
    expect(logs.lines().map((line) => [line.event, line.source_kind, line.route])).toEqual([
      ["owner_email.claimed", "renewal_document", "renewal_document_submit"],
      ["owner_email.provider_result", "renewal_document", "renewal_document_submit"],
      ["owner_email.recorded", "renewal_document", "renewal_document_submit"],
    ]);
    expectNoSensitiveData(logs.raw);
  });

  it("not configured is a definite failure without a send; a failed record is unrecorded", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = stubProvider(async () => new Response("{}"));
    const first = ownerLedger(undefined, { kind: "renewal_document", source: renewalDocument });
    captureLogs();
    expect(await deliverOwnerEmail(first.client, "renewal_document", renewalId, "initial", sendOwnerNotification, renewalTrace)).toEqual({ state: "failed", attempt: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(first.calls[1].args.p_error_code).toBe("provider_not_configured");
    process.env.RESEND_API_KEY = SENTINEL.resendKey;
    for (const fault of ["error", "throw"] as const) {
      const second = ownerLedger(undefined, { kind: "renewal_document", source: renewalDocument });
      second.faults.record = fault;
      stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
      expect(await deliverOwnerEmail(second.client, "renewal_document", renewalId, "initial", sendOwnerNotification, renewalTrace))
        .toEqual({ state: "unrecorded", attempt: 1 });
      expect(second.ledger.state).toBe("sending");
    }
  });

  it("R-2: a missing business name sends 'A provider'; a genuine claim failure sends nothing", async () => {
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    const missing = ownerLedger(undefined, { kind: "renewal_document", source: { ...renewalDocument, business_name: null } });
    const logs = captureLogs();
    expect(await deliverOwnerEmail(missing.client, "renewal_document", renewalId, "initial", sendOwnerNotification, renewalTrace)).toEqual({ state: "sent", attempt: 1 });
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(sent.subject).toBe("Renewal document submitted — A provider");
    expect(sent.text).toContain("\nBusiness: A provider\n");
    for (const fault of ["error", "throw", "commit_then_lose", "malformed"] as const) {
      fetchMock.mockClear();
      logs.raw.length = 0;
      const failing = ownerLedger(undefined, { kind: "renewal_document", source: renewalDocument });
      failing.faults.claim = fault;
      expect(await deliverOwnerEmail(failing.client, "renewal_document", renewalId, "initial", sendOwnerNotification, renewalTrace)).toEqual({ state: "claim_failed" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(failing.calls.map((call) => call.name)).toEqual(["owner_email_claim"]);
      expect(logs.lines()).toEqual([expect.objectContaining({ event: "owner_email.claim_failed", source_kind: "renewal_document", source_id: renewalId })]);
      expect(logs.lines()[0].error_code).toBe({ error: "db_unavailable", throw: "network_error", commit_then_lose: "db_unavailable", malformed: "unexpected" }[fault]);
      expectNoSensitiveData(logs.raw);
    }
  });

  it("a claim for the wrong kind or with a malformed renewal payload sends nothing", async () => {
    const fetchMock = stubProvider(async () => new Response("{}"));
    captureLogs();
    // A renewal-shaped payload labelled as another kind is still refused.
    const wrongKind = ownerLedger(undefined, { kind: "contact_submission", source: renewalDocument });
    expect(await deliverOwnerEmail(wrongKind.client, "renewal_document", renewalId, "initial", sendOwnerNotification, renewalTrace)).toEqual({ state: "claim_failed" });
    const badSource = ownerLedger(undefined, { kind: "renewal_document", source: { id: renewalId, business_name: 7 } });
    expect(await deliverOwnerEmail(badSource.client, "renewal_document", renewalId, "initial", sendOwnerNotification, renewalTrace)).toEqual({ state: "claim_failed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keys are per kind, source and attempt; concurrent deliveries send once; a same-attempt replay records once", async () => {
    expect(ownerEmailKey("renewal_document", renewalId, 1)).toBe(`renewal-document-notification:${renewalId}:1`);
    expect(ownerEmailKey("renewal_document", renewalId, 2)).not.toBe(ownerEmailKey("renewal_document", renewalId, 1));
    expect(ownerEmailKey("renewal_document", renewalId, 1)).not.toBe(ownerEmailKey("contact_submission", renewalId, 1));
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
    const { client, ledger, requestResend } = ownerLedger(undefined, { kind: "renewal_document", source: renewalDocument });
    captureLogs();
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => deliverOwnerEmail(client, "renewal_document", renewalId, "initial", sendOwnerNotification, renewalTrace)));
    expect(outcomes.filter((outcome) => outcome.state === "sent")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A provider replay of the same key returns the first result; the outcome is recorded once.
    expect(await deliverOwnerEmail(client, "renewal_document", renewalId, "initial", sendOwnerNotification, renewalTrace)).toEqual({ state: "not_claimed", current: "sent" });
    ledger.state = "failed";
    requestResend(false);
    await deliverOwnerEmail(client, "renewal_document", renewalId, "resend", sendOwnerNotification, renewalTrace);
    expect(fetchMock.mock.calls.map(([, init]) => (init.headers as Record<string, string>)["Idempotency-Key"])).toEqual([
      `renewal-document-notification:${renewalId}:1`, `renewal-document-notification:${renewalId}:2`,
    ]);
  });

  it("logs renewal route events as v2 with exactly 16 keys; v1 events are unchanged", () => {
    for (const event of ["renewal_document_submission.saved", "renewal_document_submission.failed"] as const) {
      const record = buildOperationalLogRecord({ event, route: "renewal_document_submit", correlationId: renewalTrace.correlationId, sourceKind: "renewal_document", sourceId: renewalId });
      expect(record.schema).toBe(OPERATIONAL_LOG_SCHEMA_V2);
      expect(Object.keys(record).sort()).toEqual(V2_KEYS);
      expect(record).toMatchObject({ route: "renewal_document_submit", source_kind: "renewal_document", source_id: renewalId });
    }
    const v1 = buildOperationalLogRecord({ event: "application_notification.claimed", route: "renewal_document_submit", correlationId: renewalTrace.correlationId, sourceKind: "renewal_document", sourceId: renewalId });
    expect(v1.schema).toBe(OPERATIONAL_LOG_SCHEMA);
    expect(Object.keys(v1).sort()).toEqual([...V1_KEYS].sort());
    expect(buildOperationalLogRecord({ event: "renewal_document_submission.saved", route: "renewal_document_submit", correlationId: "x", sourceId: SENTINEL.storagePath }).source_id).toBeNull();
  });

  describe("routes", () => {
    let fake: ReturnType<typeof ownerLedger>;
    const session: {
      user: { id: string } | null;
      result: { data: unknown; error: { code: string; message: string } | null };
      calls: Array<{ name: string; args: Record<string, unknown> }>;
    } = { user: null, result: { data: null, error: null }, calls: [] };
    const business: { name: string | null } = { name: SENTINEL.businessName };
    let serviceFails = false;
    const path = `renewals/44444444-4444-4444-8444-444444444444/license/55555555-5555-4555-8555-555555555555-${SENTINEL.fileName}.pdf`;
    const recorded = (overrides: Record<string, unknown> = {}) => ({
      document_id: renewalId, contractor_id: "44444444-4444-4444-8444-444444444444", kind: "license", submitted_as: "provider", recorded: true, ...overrides,
    });

    beforeEach(() => {
      afterCallbacks.length = 0;
      fake = ownerLedger(undefined, { kind: "renewal_document", source: renewalDocument });
      session.user = { id: SENTINEL.actor };
      session.result = { data: recorded(), error: null };
      session.calls = [];
      business.name = SENTINEL.businessName;
      serviceFails = false;
      vi.resetModules();
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => ({
          auth: { getUser: async () => ({ data: { user: session.user }, error: null }) },
          rpc: async (name: string, args: Record<string, unknown>) => {
            session.calls.push({ name, args });
            return session.result;
          },
        }),
      }));
      vi.doMock("@/lib/renewalDocumentsServer", async (importOriginal) => ({
        ...(await importOriginal<typeof import("../../src/lib/renewalDocumentsServer")>()),
        serviceClient: () => {
          if (serviceFails) throw new Error("Environment configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured");
          return {
            rpc: (name: string, args: Record<string, unknown>) => fake.client.rpc(name, args),
            // The legacy route's name read (pre-7.2C-2). The new route never calls it.
            from: (table: string) => ({
              select: () => ({ eq: () => ({ maybeSingle: async () => {
                if (table !== "contractors") throw new Error("unexpected table");
                return { data: business.name === null ? null : { name: business.name }, error: null };
              } }) }),
            }),
          };
        },
      }));
    });
    afterEach(() => {
      for (const name of ["@/lib/supabase/server", "@/lib/renewalDocumentsServer", "@/lib/ownerNotifications"]) vi.doUnmock(name);
    });

    const submit = (body: unknown = { path }) =>
      new Request("http://localhost/api/renewal-documents/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-correlation-id": SENTINEL.correlationHeader.replace("\n", " ") },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    const runAfter = () => Promise.all(afterCallbacks.map((callback) => callback()));

    it("the legacy fixture is byte-identical to the pre-7.2C-2 route", async () => {
      const { readFile } = await import("node:fs/promises");
      const { createHash } = await import("node:crypto");
      const fixture = await readFile(new URL("../fixtures/legacy-renewal-document-submit-route.ts", import.meta.url), "utf8");
      const marker = "// ---- legacy route below ----\n";
      const legacy = fixture.slice(fixture.indexOf(marker) + marker.length);
      expect(createHash("sha256").update(legacy).digest("hex")).toBe("979e5bfb874c5b6a9decbd9faf45bfab531d30faec79f45331a77e2fe1bfef1f");
    });

    it.each([
      ["a name with spacing", { name: "  Acme \n Lawn\tCare  ", kind: "license" }],
      ["a long name", { name: "B".repeat(150), kind: "insurance" }],
      ["a missing name", { name: null, kind: "license" }],
      ["an unexpected kind", { name: "Synthetic Co", kind: "permit" }],
    ])("13: content parity with the pre-7.2C-2 route for %s", async (_label, input) => {
      const createdAt = renewalDocument.created_at;
      const legacySends: Array<{ subject: string; text: string; replyTo?: string | null }> = [];
      business.name = input.name;
      session.result = { data: recorded({ kind: input.kind }), error: null };
      vi.doMock("@/lib/ownerNotifications", () => ({ sendOwnerNotification: async (n: never) => { legacySends.push(n); return { ok: true, id: null }; } }));
      vi.useFakeTimers({ now: new Date(createdAt), toFake: ["Date"] });
      try {
        const { POST } = await import("../fixtures/legacy-renewal-document-submit-route");
        expect((await POST(submit())).status).toBe(200);
        await runAfter();
      } finally {
        vi.useRealTimers();
      }
      expect(legacySends).toHaveLength(1);
      const current = renewalNotificationMessage({ id: renewalId, created_at: createdAt, kind: input.kind, business_name: input.name });
      expect(current.subject).toBe(legacySends[0].subject);
      expect(current.text).toBe(legacySends[0].text);
      expect(legacySends[0].replyTo).toBeUndefined();
      expect(current).not.toHaveProperty("replyTo");
      expect(current.text).toMatch(/^Submitted: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/m);
    });

    it("a provider submission responds 200 unchanged before the email, then claims the saved document and records", async () => {
      const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
      const logs = captureLogs();
      const { POST } = await import("../../src/app/api/renewal-documents/submit/route");
      const response = await POST(submit());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ documentId: renewalId, kind: "license", recorded: true });
      expect(session.calls).toEqual([{ name: "vendor_submit_renewal_document", args: { p_path: path } }]);
      expect(fake.calls).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
      await runAfter();
      expect(fake.calls.map((call) => [call.name, call.args.p_kind, call.args.p_source, call.args.p_mode ?? null])).toEqual([
        ["owner_email_claim", "renewal_document", renewalId, "initial"], ["owner_email_record", "renewal_document", renewalId, null],
      ]);
      expect(fake.ledger).toMatchObject({ state: "sent", attempts: 1 });
      const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(sent).toMatchObject(renewalNotificationMessage(renewalDocument));
      expect(sent).not.toHaveProperty("reply_to");
      const lines = logs.lines();
      expect(lines.map((line) => line.event)).toEqual([
        "renewal_document_submission.saved", "owner_email.claimed", "owner_email.provider_result", "owner_email.recorded",
      ]);
      expect(new Set(lines.map((line) => line.correlation_id)).size).toBe(1);
      for (const line of lines) {
        expect(line).toMatchObject({ schema: "mercurius.oplog.v2", route: "renewal_document_submit", source_kind: "renewal_document", source_id: renewalId });
      }
      expectNoSensitiveData(logs.raw);
      expect(logs.raw.join("\n")).not.toContain("44444444-4444-4444-8444-444444444444");
    });

    it("operator uploads and replays send nothing and keep their responses", async () => {
      const fetchMock = stubProvider(async () => new Response("{}"));
      const logs = captureLogs();
      const { POST } = await import("../../src/app/api/renewal-documents/submit/route");
      session.result = { data: recorded({ submitted_as: "operator" }), error: null };
      const operatorUpload = await POST(submit({ path, contractorId: "44444444-4444-4444-8444-444444444444" }));
      expect(await operatorUpload.json()).toEqual({ documentId: renewalId, kind: "license", recorded: true });
      expect(session.calls.at(-1)?.args).toEqual({ p_path: path, p_contractor: "44444444-4444-4444-8444-444444444444" });
      session.result = { data: recorded({ recorded: false }), error: null };
      const replay = await POST(submit());
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ documentId: renewalId, kind: "license", recorded: false });
      expect(afterCallbacks).toHaveLength(0);
      expect(fake.calls).toHaveLength(0);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(logs.lines().map((line) => [line.event, line.source_id])).toEqual([["renewal_document_submission.saved", renewalId]]);
    });

    it.each([
      ["the provider throws", "provider"],
      ["the claim RPC errors", "claim"],
      ["the claim response is lost after commit", "lost"],
      ["the logger sink throws", "logger"],
      ["the service client cannot be created", "service"],
    ] as const)("14: the submission still answers 200 when %s", async (_label, failure) => {
      if (failure === "provider") vi.stubGlobal("fetch", vi.fn(async () => { throw new Error(`boom ${SENTINEL.businessName}`); }));
      const fetchMock = failure === "provider" ? null : stubProvider(async () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }));
      if (failure === "claim") fake.faults.claim = "error";
      if (failure === "lost") fake.faults.claim = "commit_then_lose";
      if (failure === "service") serviceFails = true;
      const logs = captureLogs({ throwing: failure === "logger" });
      const { POST } = await import("../../src/app/api/renewal-documents/submit/route");
      const response = await POST(submit());
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ documentId: renewalId, kind: "license", recorded: true });
      await expect(runAfter()).resolves.toBeDefined();
      if (failure === "claim" || failure === "lost" || failure === "service") expect(fetchMock).not.toHaveBeenCalled();
      if (failure === "claim") expect(fake.ledger).toMatchObject({ state: "pending", attempts: 0 });
      // A lost response may follow a commit: nothing reset it.
      if (failure === "lost") expect(fake.ledger).toMatchObject({ state: "sending", attempts: 1 });
      if (failure === "service") {
        expect(logs.lines().at(-1)).toMatchObject({ event: "owner_email.background_failed", error_code: "config_missing", source_id: renewalId });
      }
      if (failure !== "logger") expectNoSensitiveData(logs.raw);
    });

    it("keeps validation, authorization and error responses, and logs codes only", async () => {
      const logs = captureLogs();
      const { POST } = await import("../../src/app/api/renewal-documents/submit/route");
      for (const body of [{ path: "uploads/x.pdf" }, { path, contractorId: "not-a-uuid" }, "not json", { path: `renewals/${"x".repeat(300)}` }]) {
        const response = await POST(submit(body));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "The document upload could not be matched." });
      }
      session.user = null;
      const anonymous = await POST(submit());
      expect(anonymous.status).toBe(401);
      expect(await anonymous.json()).toEqual({ error: "Sign in to submit a document." });
      session.user = { id: SENTINEL.actor };
      session.result = { data: null, error: { code: "42501", message: "Vendor account required" } };
      const forbidden = await POST(submit());
      expect([forbidden.status, await forbidden.json()]).toEqual([403, { error: "Vendor account required" }]);
      session.result = { data: null, error: { code: "P0001", message: "Too many renewal documents are awaiting review" } };
      const refused = await POST(submit());
      expect([refused.status, await refused.json()]).toEqual([400, { error: "Too many renewal documents are awaiting review" }]);
      session.result = { data: null, error: { code: "XX000", message: `internal ${SENTINEL.storagePath} ${SENTINEL.businessName}` } };
      const failed = await POST(submit());
      expect([failed.status, await failed.json()]).toEqual([500, { error: "The document could not be submitted. Please try again." }]);
      session.result = { data: { recorded: true }, error: null };
      expect((await POST(submit())).status).toBe(500);
      expect(afterCallbacks).toHaveLength(0);
      expect(logs.lines().map((line) => [line.event, line.outcome, line.error_code])).toEqual([
        ["renewal_document_submission.failed", "failed", "db_error"],
        ["renewal_document_submission.failed", "failed", "unexpected"],
      ]);
      expect(logs.lines()[0].correlation_id).not.toContain("correlation-SENTINEL");
      expectNoSensitiveData(logs.raw);
    });

    it("26: the old renewal route on the new schema never claims, so its row stays pending for attested recovery", async () => {
      const legacySend = vi.fn(async () => ({ ok: true as const, id: "msg_legacy" }));
      vi.doMock("@/lib/ownerNotifications", () => ({ sendOwnerNotification: legacySend }));
      captureLogs();
      const { POST } = await import("../fixtures/legacy-renewal-document-submit-route");
      expect((await POST(submit())).status).toBe(200);
      await runAfter();
      expect(legacySend).toHaveBeenCalledTimes(1);
      expect(fake.calls).toHaveLength(0);
      expect(fake.ledger).toMatchObject({ state: "pending", attempts: 0 });
      fake.ledger.stale = true;
      const send = vi.fn();
      expect(await deliverOwnerEmail(fake.client, "renewal_document", renewalId, "initial", send, renewalTrace)).toEqual({ state: "not_claimed", current: "missed" });
      expect(send).not.toHaveBeenCalled();
      expect(fake.requestResend(false).error?.code).toBe("55000");
      expect(fake.requestResend(true).data?.state).toBe("resend_requested");
    });
  });
});
