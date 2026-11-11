// TRACE-151 (Phase 7.1): application-notification tracing and redacted operational logs.
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
  buildOperationalLogRecord,
  classifyOperationalError,
  createCorrelationId,
  logOperationalEvent,
  type OperationalLogInput,
} from "../../src/lib/observability/operationalLog";
import {
  applicationNotificationKey,
  deliverApplicationNotification,
  providerErrorCode,
  type ClaimedApplication,
} from "../../src/lib/applicationNotifications";
import { sendOwnerNotification } from "../../src/lib/ownerNotifications";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECORD_KEYS = [
  "schema", "ts", "level", "env", "release", "event", "route", "correlation_id", "application_id",
  "attempt", "mode", "outcome", "error_code", "duration_ms",
].sort();

// Synthetic sentinels: none of these may ever appear in a log line.
const SENTINEL = {
  business: "Sentinel Business LLC",
  first: "Sentinelfirst",
  last: "Sentinellast",
  email: "sentinel.applicant@example.test",
  phone: "239-555-0199",
  address: "99 Sentinel Way, Fort Myers, FL",
  license: "SENTINEL-LIC-77",
  policy: "SENTINEL-POL-88",
  notes: "Sentinel free text note",
  ip: "203.0.113.77",
  serviceKey: "synthetic-service-role-key-SENTINEL-0000",
  resendKey: "re_SENTINEL-key",
  claimId: "c1a1m000-0000-4000-8000-00000000c1a1",
  providerBody: "Resend says sentinel.applicant@example.test is invalid",
  token: "signed-upload-token-SENTINEL",
  correlationHeader: "evil\ncorrelation-SENTINEL",
  documentName: "sentinel-license-scan.pdf",
};

const applicationId = "11111111-1111-4111-8111-111111111111";
const application: ClaimedApplication = {
  id: applicationId,
  created_at: "2026-11-10T12:00:00Z",
  business_name: SENTINEL.business,
  first_name: SENTINEL.first,
  last_name: SENTINEL.last,
  email: SENTINEL.email,
  phone: SENTINEL.phone,
  primary_category: "Lawn & Landscape",
  services: ["lawn-mowing"],
  service_areas: "Cape Coral",
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
  expect(joined).not.toContain("vendor-application-notification:");
  expect(joined).not.toMatch(/stack|Error:|token=|https?:\/\//);
  for (const line of raw) {
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(RECORD_KEYS);
  }
}

type RpcCall = { name: string; args: Record<string, unknown> };

/** A model of the ledger: one claim per permitted attempt, outcome only for the current claim. */
function ledgerClient(initial: { state: string; attempts: number } = { state: "pending", attempts: 0 }) {
  const ledger = { ...initial, claim: null as string | null };
  const calls: RpcCall[] = [];
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      await Promise.resolve();
      if (name === "r0_claim_application_notification") {
        const permitted = args.p_mode === "initial" ? ledger.state === "pending" : ledger.state === "resend_requested";
        if (!permitted) return { data: { claimed: false, state: ledger.state }, error: null };
        ledger.state = "sending";
        ledger.attempts += 1;
        ledger.claim = `${SENTINEL.claimId}-${ledger.attempts}`;
        return { data: { claimed: true, claim_id: ledger.claim, attempt: ledger.attempts, application }, error: null };
      }
      if (name === "r0_record_application_notification") {
        if (ledger.state !== "sending" || args.p_claim !== ledger.claim) {
          return { data: null, error: { code: "40001", message: `Notification claim is not current ${SENTINEL.email}` } };
        }
        ledger.state = args.p_outcome as string;
        ledger.claim = null;
        return { data: { state: ledger.state, attempt: ledger.attempts }, error: null };
      }
      return { data: null, error: null };
    }),
  };
  return { client: client as unknown as SupabaseClient, calls, ledger };
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

describe("operational log contract", () => {
  const base: OperationalLogInput = {
    event: "application_notification.claimed",
    route: "vendor_application_submit",
    correlationId: "0b8f7e7c-1d7e-4c38-9a59-6f3d7cbbd001",
    applicationId,
    attempt: 1,
    mode: "initial",
    outcome: "claimed",
  };

  it("writes exactly the allowlisted fields, as one JSON line", () => {
    const logs = captureLogs();
    logOperationalEvent({
      ...base,
      // Unexpected fields from a careless caller are not copied.
      ...({ email: SENTINEL.email, body: { phone: SENTINEL.phone }, headers: { "x-forwarded-for": SENTINEL.ip } } as object),
    } as OperationalLogInput);
    expect(logs.raw).toHaveLength(1);
    expect(logs.raw[0]).not.toContain("\n");
    const [line] = logs.lines();
    expect(Object.keys(line).sort()).toEqual(RECORD_KEYS);
    expect(line).toMatchObject({
      schema: OPERATIONAL_LOG_SCHEMA, level: "info", env: "test", release: null,
      event: "application_notification.claimed", route: "vendor_application_submit",
      correlation_id: base.correlationId, application_id: applicationId, attempt: 1, mode: "initial",
      outcome: "claimed", error_code: null, duration_ms: null,
    });
    expect(new Date(line.ts as string).toISOString()).toBe(line.ts);
    expectNoSensitiveData(logs.raw);
  });

  it("reduces errors to a code: no message, stack, URL, token or address", () => {
    const leaky = Object.assign(
      new Error(`insert failed for ${SENTINEL.email} at https://x.supabase.co/storage/v1/upload/sign/a?token=${SENTINEL.token}`),
      { details: SENTINEL.address, hint: SENTINEL.phone },
    );
    const logs = captureLogs();
    logOperationalEvent({ ...base, event: "application_submission.failed", outcome: "failed", error: leaky });
    logOperationalEvent({ ...base, event: "application_submission.failed", outcome: "failed", error: { code: "23505", message: SENTINEL.email } });
    expect(logs.lines().map((line) => line.error_code)).toEqual(["unexpected", "db_constraint"]);
    expectNoSensitiveData(logs.raw);
  });

  it.each([
    [{ code: "42501" }, "db_permission_denied"],
    [{ code: "P0002" }, "db_not_found"],
    [{ code: "PGRST116" }, "db_not_found"],
    [{ code: "40001" }, "db_claim_not_current"],
    [{ code: "55000" }, "db_state_conflict"],
    [{ code: "08006" }, "db_unavailable"],
    [{ code: "XX000" }, "db_error"],
    [{ code: `${SENTINEL.email}` }, "unexpected"],
    [{ __isStorageError: true, message: SENTINEL.token }, "storage_error"],
    [new SyntaxError("Unexpected token"), "request_unreadable"],
    [new Error("Environment configuration error: SUPABASE_SERVICE_ROLE_KEY is required."), "config_missing"],
    [new TypeError("fetch failed"), "network_error"],
    ["a bare string with " + SENTINEL.email, "unexpected"],
    [null, "unexpected"],
  ])("classifies %o as %s", (error, code) => {
    expect(classifyOperationalError(error)).toBe(code);
  });

  it("survives hostile error objects", () => {
    const hostile = new Proxy({}, { get() { throw new Error(SENTINEL.email); }, has() { throw new Error("x"); } });
    expect(classifyOperationalError(hostile)).toBe("unexpected");
    const logs = captureLogs();
    expect(() => logOperationalEvent({ ...base, error: hostile })).not.toThrow();
    expectNoSensitiveData(logs.raw);
  });

  it("drops malicious, oversized or out-of-range values instead of writing them", () => {
    const record = buildOperationalLogRecord({
      ...base,
      event: "made.up.event" as never,
      route: "../../etc" as never,
      correlationId: SENTINEL.correlationHeader + "x".repeat(100_000),
      applicationId: `${applicationId}\n{"event":"forged"}`,
      attempt: 1e12,
      mode: "bulk" as never,
      outcome: SENTINEL.email as never,
      errorCode: "provider says hi" as never,
      durationMs: Number.POSITIVE_INFINITY,
    });
    expect(record).toMatchObject({
      event: "oplog.invalid_event", level: "error", route: null, correlation_id: null, application_id: null,
      attempt: 10_000, mode: null, outcome: null, error_code: null, duration_ms: null,
    });
    expect(buildOperationalLogRecord({ ...base, durationMs: 9e9, attempt: -3 })).toMatchObject({ duration_ms: 3_600_000, attempt: 1 });
    expect(JSON.stringify(record).length).toBeLessThan(600);
  });

  it("reports environment and release only in their expected shapes", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_SHA = "88d4e09c89b6499a2ca4e0612eab117829c7dc35";
    expect(buildOperationalLogRecord(base)).toMatchObject({ env: "preview", release: "88d4e09c89b6499a2ca4e0612eab117829c7dc35" });
    process.env.VERCEL_ENV = SENTINEL.email;
    process.env.VERCEL_GIT_COMMIT_SHA = SENTINEL.token;
    expect(buildOperationalLogRecord(base)).toMatchObject({ env: "test", release: null });
  });

  it("generates distinct server UUIDs", () => {
    const ids = new Set(Array.from({ length: 50 }, () => createCorrelationId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID);
  });

  it("never throws when the sink throws", () => {
    const logs = captureLogs({ throwing: true });
    expect(() => logOperationalEvent(base)).not.toThrow();
    expect(() => logOperationalEvent({ ...base, event: "application_submission.failed", error: new Error("x") })).not.toThrow();
    expect(logs.raw).toHaveLength(2);
  });
});

describe("delivery helper: outcomes are unchanged and traced", () => {
  const trace = { route: "vendor_application_submit" as const, correlationId: "5e1f2c3d-4b5a-4c6d-8e7f-9a0b1c2d3e4f" };

  // Fake provider responses through the real shared sender.
  it.each([
    ["accepted", () => new Response(JSON.stringify({ id: "msg_synthetic" }), { status: 200 }), "sent", null],
    ["definite 422 refusal", () => new Response(SENTINEL.providerBody, { status: 422 }), "failed", "provider_refused"],
    ["429 rate limit", () => new Response(SENTINEL.providerBody, { status: 429 }), "failed", "provider_rate_limited"],
    ["500 server error", () => new Response(SENTINEL.providerBody, { status: 500 }), "unknown", "provider_server_error"],
    ["503 server error", () => new Response(SENTINEL.providerBody, { status: 503 }), "unknown", "provider_server_error"],
    ["409 concurrent key", () => new Response(SENTINEL.providerBody, { status: 409 }), "unknown", "provider_conflict"],
    ["timeout", () => { throw new DOMException(`timeout for ${SENTINEL.email}`, "TimeoutError"); }, "unknown", "provider_timeout_or_network"],
    ["network error", () => { throw new TypeError(`fetch failed ${SENTINEL.ip}`); }, "unknown", "provider_timeout_or_network"],
  ] as const)("%s → %s", async (_label, respond, state, errorCode) => {
    stubProvider(async () => respond());
    const { client, calls } = ledgerClient();
    const logs = captureLogs();
    const outcome = await deliverApplicationNotification(client, applicationId, "initial", sendOwnerNotification, trace);
    expect(outcome).toEqual({ state, attempt: 1 });
    expect(calls.map((call) => call.name)).toEqual(["r0_claim_application_notification", "r0_record_application_notification"]);
    expect(calls[1].args).toMatchObject({ p_outcome: state, p_claim: `${SENTINEL.claimId}-1` });
    // The ledger still receives the provider detail (redacted in SQL); logs do not.
    if (state !== "sent") expect(calls[1].args.p_error).toEqual(expect.any(String));
    expect(logs.events()).toEqual([
      "application_notification.claimed",
      "application_notification.provider_result",
      "application_notification.recorded",
    ]);
    const lines = logs.lines();
    expect(lines[1]).toMatchObject({ outcome: state, error_code: errorCode, attempt: 1, mode: "initial" });
    expect(lines[1].duration_ms).toEqual(expect.any(Number));
    for (const line of lines) expect(line).toMatchObject({ correlation_id: trace.correlationId, application_id: applicationId, route: trace.route });
    expectNoSensitiveData(logs.raw);
  });

  it("missing provider configuration is a definite failure without a send", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = stubProvider(async () => new Response("{}"));
    const { client } = ledgerClient();
    const logs = captureLogs();
    expect(await deliverApplicationNotification(client, applicationId, "initial", sendOwnerNotification, trace)).toEqual({ state: "failed", attempt: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.lines()[1]).toMatchObject({ outcome: "failed", error_code: "provider_not_configured" });
  });

  it("logs a refused claim without sending", async () => {
    const { client } = ledgerClient({ state: "sent", attempts: 1 });
    const send = vi.fn();
    const logs = captureLogs();
    expect(await deliverApplicationNotification(client, applicationId, "initial", send, trace)).toEqual({ state: "not_claimed", current: "sent" });
    expect(send).not.toHaveBeenCalled();
    expect(logs.lines()).toEqual([expect.objectContaining({ event: "application_notification.not_claimed", outcome: "sent", level: "warn" })]);
  });

  it("logs a failed claim and still throws it to the caller", async () => {
    const client = { rpc: vi.fn(async () => ({ data: null, error: { code: "08006", message: `connection lost ${SENTINEL.email}` } })) } as unknown as SupabaseClient;
    const send = vi.fn();
    const logs = captureLogs();
    await expect(deliverApplicationNotification(client, applicationId, "initial", send, trace)).rejects.toMatchObject({ code: "08006" });
    expect(send).not.toHaveBeenCalled();
    expect(logs.lines()).toEqual([expect.objectContaining({ event: "application_notification.claim_failed", error_code: "db_unavailable" })]);
    expectNoSensitiveData(logs.raw);
  });

  it("reports an outcome-recording failure as unrecorded, with a safe code", async () => {
    const client = {
      rpc: vi.fn(async (name: string) => name === "r0_claim_application_notification"
        ? { data: { claimed: true, claim_id: SENTINEL.claimId, attempt: 3, application }, error: null }
        : { data: null, error: { code: "40001", message: `Notification claim is not current ${SENTINEL.email}` } }),
    } as unknown as SupabaseClient;
    const logs = captureLogs();
    const send = vi.fn(async () => ({ ok: true as const, id: "msg_synthetic" }));
    expect(await deliverApplicationNotification(client, applicationId, "initial", send, trace)).toEqual({ state: "unrecorded", attempt: 3 });
    expect(logs.lines().at(-1)).toMatchObject({ event: "application_notification.record_failed", outcome: "unrecorded", error_code: "db_claim_not_current", level: "error", attempt: 3 });
    expectNoSensitiveData(logs.raw);
  });

  it("a throwing log sink changes no outcome and skips no recording", async () => {
    for (const respond of [
      () => new Response(JSON.stringify({ id: "msg_synthetic" }), { status: 200 }),
      () => new Response("refused", { status: 422 }),
      () => new Response("down", { status: 503 }),
    ]) {
      const fetchMock = stubProvider(async () => respond());
      const { client, calls, ledger } = ledgerClient();
      captureLogs({ throwing: true });
      const outcome = await deliverApplicationNotification(client, applicationId, "initial", sendOwnerNotification, trace);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(calls.map((call) => call.name)).toEqual(["r0_claim_application_notification", "r0_record_application_notification"]);
      expect(ledger.state).toBe(outcome.state);
      vi.restoreAllMocks();
    }
  });

  it("concurrent deliveries for one permitted attempt send once; an authorized resend is a distinct attempt", async () => {
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg_synthetic" }), { status: 200 }));
    const { client, ledger } = ledgerClient();
    const logs = captureLogs();
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => deliverApplicationNotification(client, applicationId, "initial", sendOwnerNotification, trace)));
    expect(outcomes.filter((outcome) => outcome.state === "sent")).toEqual([{ state: "sent", attempt: 1 }]);
    expect(outcomes.filter((outcome) => outcome.state === "not_claimed")).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ledger.attempts).toBe(1);

    // A repeated initial delivery after success adds nothing.
    await deliverApplicationNotification(client, applicationId, "initial", sendOwnerNotification, trace);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The operator's database request permits exactly one more attempt.
    ledger.state = "resend_requested";
    const resendTrace = { route: "application_notification_resend" as const, correlationId: createCorrelationId() };
    const resends = await Promise.all(Array.from({ length: 4 }, () => deliverApplicationNotification(client, applicationId, "resend", sendOwnerNotification, resendTrace)));
    expect(resends.filter((outcome) => outcome.state === "sent")).toEqual([{ state: "sent", attempt: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(([, init]) => (init.headers as Record<string, string>)["Idempotency-Key"]);
    expect(keys).toEqual([applicationNotificationKey(applicationId, 1), applicationNotificationKey(applicationId, 2)]);
    // Neither key reaches the log; the attempt number is the safe reference.
    expectNoSensitiveData(logs.raw);
    const sent = logs.lines().filter((line) => line.event === "application_notification.recorded");
    expect(sent.map((line) => [line.attempt, line.correlation_id])).toEqual([[1, trace.correlationId], [2, resendTrace.correlationId]]);
  });

  it("maps every provider status class", () => {
    expect(providerErrorCode({ ok: true, id: null })).toBeNull();
    expect(providerErrorCode({ ok: false, definite: true, error: "Resend returned 400: bad" })).toBe("provider_refused");
    expect(providerErrorCode({ ok: false, definite: true, error: "Resend returned 403." })).toBe("provider_refused");
    expect(providerErrorCode({ ok: false, definite: false, error: "Resend returned 502: x" })).toBe("provider_server_error");
    expect(providerErrorCode({ ok: false, definite: true, error: "RESEND_API_KEY is required." })).toBe("provider_not_configured");
    expect(providerErrorCode({ ok: false, definite: false, error: "socket hang up" })).toBe("provider_timeout_or_network");
  });
});

// Importing a route compiles its dependency graph; allow for a loaded CI host.
describe("journey: save → post-response attempt → operator recovery", { timeout: 60_000 }, () => {
  const inserted: Array<Record<string, unknown>> = [];
  let ledger: ReturnType<typeof ledgerClient>;
  let operator: { user: { id: string } | null; requestError: { code: string; message: string } | null };
  let storageError: unknown;
  let insertError: unknown;

  beforeEach(() => {
    inserted.length = 0;
    afterCallbacks.length = 0;
    ledger = ledgerClient();
    operator = { user: { id: "0be7a700-0000-4000-8000-000000000001" }, requestError: null };
    storageError = null;
    insertError = null;
    vi.resetModules();
    vi.doMock("@/lib/env/server", () => ({
      getServiceSupabaseEnvironment: () => ({ supabaseUrl: "http://127.0.0.1:1", serviceRoleKey: SENTINEL.serviceKey }),
      getOwnerNotificationEnvironment: () => ({ apiKey: SENTINEL.resendKey, from: "Mercurius <n@example.test>", to: "owner@example.test" }),
      getVendorUploadSigningEnvironment: () => ({ secret: "s".repeat(40), version: "v1" }),
    }));
    vi.doMock("@/lib/intakeProtection", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/lib/intakeProtection")>()),
      intakeGuardRefusal: () => null,
      recordIntakeSubmission: async () => "accepted",
    }));
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        from: (table: string) => ({
          insert: async (row: Record<string, unknown>) => {
            if (insertError) return { error: insertError };
            inserted.push(row);
            return { error: null };
          },
          select: () => ({ eq: async () => ({ data: table === "services_catalog" ? [{ id: "lawn-mowing" }] : [{ name: "Lawn & Landscape" }], error: null }) }),
        }),
        storage: {
          from: () => ({
            createSignedUploadUrl: async () => storageError
              ? { data: null, error: storageError }
              : { data: { token: SENTINEL.token, signedUrl: `https://x.supabase.co/upload?token=${SENTINEL.token}` }, error: null },
          }),
        },
        rpc: (name: string, args: Record<string, unknown>) => ledger.client.rpc(name, args),
      }),
    }));
    // The operator's session client: identity and the database's resend authority.
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: operator.user }, error: null }) },
        rpc: async (name: string) => {
          if (name !== "r0_request_application_notification_resend") throw new Error("unexpected rpc");
          if (operator.requestError) return { data: null, error: operator.requestError };
          await Promise.resolve();
          // Mirrors r0_request_application_notification_resend: idempotent while requested,
          // allowed from failed (or confirmed unknown), refused otherwise.
          if (ledger.ledger.state !== "resend_requested") {
            if (!["failed", "unknown"].includes(ledger.ledger.state)) {
              return { data: null, error: { code: "55000", message: `This notification cannot be resent from ${ledger.ledger.state}` } };
            }
            ledger.ledger.state = "resend_requested";
          }
          return { data: { state: "resend_requested", attempt: ledger.ledger.attempts }, error: null };
        },
      }),
    }));
  });
  afterEach(() => {
    for (const name of ["@supabase/supabase-js", "@/lib/env/server", "@/lib/intakeProtection", "@/lib/supabase/server"]) vi.doUnmock(name);
  });

  function submission(extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    return new Request("http://localhost/api/vendor-applications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-correlation-id": SENTINEL.correlationHeader.replace("\n", " "),
        "x-request-id": "client-supplied",
        "x-forwarded-for": SENTINEL.ip,
        ...headers,
      },
      body: JSON.stringify({
        intake: {},
        application: {
          business_name: SENTINEL.business, first_name: SENTINEL.first, last_name: SENTINEL.last, email: SENTINEL.email,
          phone: SENTINEL.phone, address: SENTINEL.address, service_areas: "Cape Coral", license_number: SENTINEL.license,
          insurance_policy_number: SENTINEL.policy, additional_notes: SENTINEL.notes, years_experience: 3,
          services: ["lawn-mowing"], primary_category: "Lawn & Landscape", team_size: "1",
        },
        ...extra,
      }),
    });
  }

  function resend(body: unknown) {
    return new Request("http://localhost/api/admin/application-notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-correlation-id": "00000000-0000-4000-8000-000000000000" },
      body: JSON.stringify(body),
    });
  }

  it("traces a refused provider attempt and a later operator recovery without sensitive data", async () => {
    let providerCall = 0;
    const fetchMock = stubProvider(async () => ++providerCall === 1
      ? new Response(SENTINEL.providerBody, { status: 422 })
      : new Response(JSON.stringify({ id: "msg_synthetic" }), { status: 200 }));
    const logs = captureLogs();

    const { POST: submit } = await import("../../src/app/api/vendor-applications/route");
    const response = await submit(submission({ documents: [{ clientId: "doc-1", kind: "license", name: SENTINEL.documentName, type: "application/pdf", size: 1000 }] }));
    expect(response.status).toBe(201);
    const { applicationId: savedId } = (await response.json()) as { applicationId: string };
    await Promise.all(afterCallbacks.map((callback) => callback()));
    expect(ledger.ledger).toMatchObject({ state: "failed", attempts: 1 });

    const { POST: operatorResend } = await import("../../src/app/api/admin/application-notifications/route");
    const recovery = await operatorResend(resend({ applicationId: savedId }));
    expect(recovery.status).toBe(200);
    expect(await recovery.json()).toMatchObject({ state: "sent" });
    expect(ledger.ledger).toMatchObject({ state: "sent", attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const lines = logs.lines();
    expect(lines.map((line) => [line.event, line.outcome])).toEqual([
      ["application_submission.saved", "saved"],
      ["application_notification.claimed", "claimed"],
      ["application_notification.provider_result", "failed"],
      ["application_notification.recorded", "failed"],
      ["application_notification_resend.requested", "resend_requested"],
      ["application_notification.claimed", "claimed"],
      ["application_notification.provider_result", "sent"],
      ["application_notification.recorded", "sent"],
      ["application_notification_resend.completed", "sent"],
    ]);
    // Every line names the same application; each request has its own server correlation ID.
    for (const line of lines) expect(line.application_id).toBe(savedId);
    const submitIds = new Set(lines.slice(0, 4).map((line) => line.correlation_id));
    const resendIds = new Set(lines.slice(4).map((line) => line.correlation_id));
    expect(submitIds.size).toBe(1);
    expect(resendIds.size).toBe(1);
    const [submitId] = submitIds;
    const [resendId] = resendIds;
    expect(submitId).toMatch(UUID);
    expect(resendId).toMatch(UUID);
    expect(submitId).not.toBe(resendId);
    expect(resendId).not.toBe("00000000-0000-4000-8000-000000000000");
    expect(lines.slice(0, 4).every((line) => line.route === "vendor_application_submit")).toBe(true);
    expect(lines.slice(4).every((line) => line.route === "application_notification_resend")).toBe(true);
    expect(lines[2]).toMatchObject({ error_code: "provider_refused", attempt: 1, mode: "initial" });
    expect(lines[8]).toMatchObject({ attempt: 2, mode: "resend" });
    expectNoSensitiveData(logs.raw);
    expect(logs.raw.join("\n")).not.toContain("client-supplied");
  });

  it("a throwing log sink changes neither the response, the saved row nor outcome recording", async () => {
    stubProvider(async () => new Response(JSON.stringify({ id: "msg_synthetic" }), { status: 200 }));
    captureLogs({ throwing: true });
    const { POST } = await import("../../src/app/api/vendor-applications/route");
    const response = await POST(submission());
    expect(response.status).toBe(201);
    expect(inserted).toHaveLength(1);
    await Promise.all(afterCallbacks.map((callback) => callback()));
    expect(ledger.calls.map((call) => call.name)).toEqual(["r0_claim_application_notification", "r0_record_application_notification"]);
    expect(ledger.ledger).toMatchObject({ state: "sent", attempts: 1 });

    ledger.ledger.state = "failed";
    const { POST: operatorResend } = await import("../../src/app/api/admin/application-notifications/route");
    const recovery = await operatorResend(resend({ applicationId: inserted[0].id }));
    expect(recovery.status).toBe(200);
    expect(ledger.ledger).toMatchObject({ state: "sent", attempts: 2 });
  });

  it("a failed claim after saving keeps the application and logs a safe background failure", async () => {
    vi.spyOn(ledger.client, "rpc").mockImplementation(async () => ({ data: null, error: { code: "08006", message: `reset ${SENTINEL.email}` } }) as never);
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/vendor-applications/route");
    expect((await POST(submission())).status).toBe(201);
    await expect(Promise.all(afterCallbacks.map((callback) => callback()))).resolves.toBeDefined();
    expect(inserted).toHaveLength(1);
    expect(logs.lines().map((line) => [line.event, line.error_code])).toEqual([
      ["application_submission.saved", null],
      ["application_notification.claim_failed", "db_unavailable"],
      ["application_notification.background_failed", "db_unavailable"],
    ]);
    expectNoSensitiveData(logs.raw);
  });

  it("an upload-URL failure with a token-bearing message keeps the save and logs only a code", async () => {
    storageError = Object.assign(new Error(`https://x.supabase.co/object/upload/sign/${SENTINEL.documentName}?token=${SENTINEL.token}`), { __isStorageError: true });
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/vendor-applications/route");
    const response = await POST(submission({ documents: [{ clientId: "doc-1", kind: "license", name: SENTINEL.documentName, type: "application/pdf", size: 1000 }] }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ uploadWarning: expect.any(String), uploads: [] });
    expect(logs.lines()[0]).toMatchObject({ event: "application_submission.upload_url_failed", error_code: "storage_error", level: "warn" });
    expectNoSensitiveData(logs.raw);
  });

  it("logs refusal, invalid input and failure with codes only", async () => {
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/vendor-applications/route");
    expect((await POST(submission({ application: { email: SENTINEL.email, business_name: SENTINEL.business } }))).status).toBe(400);
    insertError = { code: "23505", message: `duplicate ${SENTINEL.email}`, details: SENTINEL.address };
    expect((await POST(submission())).status).toBe(500);
    expect((await POST(new Request("http://localhost/api/vendor-applications", { method: "POST", body: `{"email":"${SENTINEL.email}"` }))).status).toBe(500);
    expect(logs.lines().map((line) => [line.event, line.outcome, line.error_code, line.application_id])).toEqual([
      ["application_submission.refused", "invalid", "validation_failed", null],
      ["application_submission.failed", "failed", "db_constraint", null],
      ["application_submission.failed", "failed", "request_unreadable", null],
    ]);
    expect(afterCallbacks).toHaveLength(0);
    expectNoSensitiveData(logs.raw);
  });

  it("logs an intake guard refusal with its enumerated reason", async () => {
    vi.doMock("@/lib/intakeProtection", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/lib/intakeProtection")>()),
      intakeGuardRefusal: () => "trap",
      recordIntakeSubmission: async () => "accepted",
    }));
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/vendor-applications/route");
    expect((await POST(submission())).status).toBe(429);
    expect(inserted).toHaveLength(0);
    expect(logs.lines()).toEqual([expect.objectContaining({ event: "application_submission.refused", outcome: "refused", error_code: "intake_trap" })]);
    expectNoSensitiveData(logs.raw);
  });

  it("gives anonymous and non-operator callers no resend and no claim", async () => {
    ledger.ledger.state = "failed";
    ledger.ledger.attempts = 1;
    const fetchMock = stubProvider(async () => new Response("{}"));
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/admin/application-notifications/route");

    operator.user = null;
    expect((await POST(resend({ applicationId }))).status).toBe(401);
    operator.user = { id: "0be7a700-0000-4000-8000-000000000002" };
    operator.requestError = { code: "42501", message: "Operator access required" };
    expect((await POST(resend({ applicationId }))).status).toBe(403);

    expect(ledger.calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ledger.ledger).toMatchObject({ state: "failed", attempts: 1 });
    expect(logs.lines().map((line) => [line.event, line.outcome, line.error_code])).toEqual([
      ["application_notification_resend.refused", "unauthenticated", null],
      ["application_notification_resend.refused", "forbidden", "db_permission_denied"],
    ]);
  });

  it("refuses malformed input without logging it, and reports unexpected errors as codes", async () => {
    const logs = captureLogs();
    const { POST } = await import("../../src/app/api/admin/application-notifications/route");
    expect((await POST(resend({ applicationId: `${SENTINEL.email}' or 1=1 --${"x".repeat(5000)}` }))).status).toBe(400);
    operator.requestError = { code: "XX000", message: `internal ${SENTINEL.email}` };
    expect((await POST(resend({ applicationId }))).status).toBe(500);
    operator.requestError = { code: "55000", message: "This notification cannot be resent from sent" };
    expect((await POST(resend({ applicationId }))).status).toBe(409);
    expect(logs.lines().map((line) => [line.event, line.outcome, line.error_code, line.application_id])).toEqual([
      ["application_notification_resend.refused", "invalid", "validation_failed", null],
      ["application_notification_resend.failed", "failed", "db_error", applicationId],
      ["application_notification_resend.refused", "conflict", "db_state_conflict", applicationId],
    ]);
    expectNoSensitiveData(logs.raw);
    expect(logs.raw.join("\n")).not.toContain("or 1=1");
  });

  it("a resend that loses the claim to a concurrent one sends nothing more", async () => {
    ledger.ledger.state = "failed";
    ledger.ledger.attempts = 1;
    const fetchMock = stubProvider(async () => new Response(JSON.stringify({ id: "msg_synthetic" }), { status: 200 }));
    captureLogs();
    const { POST } = await import("../../src/app/api/admin/application-notifications/route");
    const responses = await Promise.all(Array.from({ length: 3 }, () => POST(resend({ applicationId, confirmUnknown: true }))));
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 409, 409]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ledger.ledger).toMatchObject({ state: "sent", attempts: 2 });
  });
});
