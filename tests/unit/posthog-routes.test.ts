// TRACE-157 / TRACE-158 (Phase 7.4B): the two server outcome events, asserted where they fire.
// Each test calls the real route handler, the real early-access command and the real server
// analytics module. Only the database client, Next's `after` scheduler and the PostHog SDK are
// synthetic, so no test reaches Supabase or PostHog. Synthetic identifiers and addresses only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_COOKIE } from "@/lib/analytics/policy";
import { MIN_FILL_MS } from "@/lib/intakeProtection";

type Answer = { data: unknown; error: unknown };
const mock = vi.hoisted(() => ({
  after: vi.fn(),
  capture: vi.fn(),
  flush: vi.fn(),
  /** The coverage lookup: from(table).select(columns).eq(column, zip).maybeSingle(). */
  lookup: vi.fn(),
  /** Early-access database commands: rpc(name, params). */
  rpc: vi.fn(),
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: mock.after }));
vi.mock("posthog-node", () => ({ PostHog: class { capture = mock.capture; flush = mock.flush; } }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: mock.rpc,
    from: (table: string) => ({ select: () => ({ eq: (column: string, value: string) => ({ maybeSingle: () => mock.lookup(table, column, value) }) }) }),
  }),
}));

const distinctId = "00000000-0000-4000-8000-0000000000d1";
const sessionId = "00000000-0000-4000-8000-0000000000e1";
const origin = "https://www.mercuriusmarketplace.com";
const telemetry = { cookie: `${CONSENT_COOKIE}=v1-granted`, "X-POSTHOG-DISTINCT-ID": distinctId, "X-POSTHOG-SESSION-ID": sessionId };
const serverOnly = { $session_id: sessionId, $process_person_profile: false };

/** Runs the work the route scheduled with `after`, as Next does once the response is sent. */
async function captured() {
  for (const [callback] of mock.after.mock.calls) await callback();
  return mock.capture.mock.calls.map(([call]) => call as { distinctId: string; event: string; properties: Record<string, unknown> });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mock.flush.mockResolvedValue(undefined);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENABLED", "1");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_synthetic");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55832");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon-key-0000");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-role-key-0000");
  vi.stubEnv("VERCEL", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// ---------------------------------------------------------------------------------------------
// A-07 coverage_checked: GET /api/request-coverage
// ---------------------------------------------------------------------------------------------

describe("coverage_checked from GET /api/request-coverage", () => {
  const lookup = (zip: string, headers: Record<string, string> = telemetry) => new Request(`${origin}/api/request-coverage?zip=${zip}`, { headers });
  const area = (overrides: Record<string, unknown>) => ({ id: "00000000-0000-4000-8000-0000000000a1", zip_code: "33904", city: "Cape Coral", state: "FL", is_active: false, has_waitlist: false, ...overrides });

  it.each([
    ["covered", area({ is_active: true })],
    ["waitlist", area({ has_waitlist: true })],
    ["uncovered", null],
  ])("captures exactly { coverage: %s } after a server decision, never the ZIP", async (coverage, row) => {
    mock.lookup.mockResolvedValue({ data: row, error: null } satisfies Answer);
    const { GET } = await import("@/app/api/request-coverage/route");
    const response = await GET(lookup("33904"));
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe(coverage);
    expect(mock.lookup).toHaveBeenCalledExactlyOnceWith("coverage_areas", "zip_code", "33904");
    const events = await captured();
    expect(events).toEqual([{ distinctId, event: "coverage_checked", properties: { coverage, ...serverOnly }, disableGeoip: true }]);
    expect(JSON.stringify(events)).not.toMatch(/33904|Cape Coral|0000000000a1/);
  });

  it("counts every lookup, including a repeat of the same ZIP (F-3)", async () => {
    mock.lookup.mockResolvedValue({ data: area({ is_active: true }), error: null });
    const { GET } = await import("@/app/api/request-coverage/route");
    await GET(lookup("33904"));
    await GET(lookup("33904"));
    expect((await captured()).map((event) => event.event)).toEqual(["coverage_checked", "coverage_checked"]);
  });

  it("captures nothing for an invalid ZIP, which is refused before any lookup", async () => {
    const { GET } = await import("@/app/api/request-coverage/route");
    for (const zip of ["", "3390", "abcde", "33%2004"]) expect((await GET(lookup(zip))).status).toBe(400);
    expect(mock.lookup).not.toHaveBeenCalled();
    expect(mock.after).not.toHaveBeenCalled();
    expect(await captured()).toEqual([]);
  });

  it("captures nothing when the lookup fails, whether it answers with an error or throws", async () => {
    const { GET } = await import("@/app/api/request-coverage/route");
    mock.lookup.mockResolvedValueOnce({ data: null, error: { message: "Synthetic outage" } } satisfies Answer);
    expect((await GET(lookup("33904"))).status).toBe(503);
    mock.lookup.mockRejectedValueOnce(new Error("Synthetic transport failure"));
    expect((await GET(lookup("33904"))).status).toBe(503);
    expect(mock.after).not.toHaveBeenCalled();
    expect(await captured()).toEqual([]);
  });

  it("captures nothing without consent or usable telemetry IDs, and the answer is unchanged", async () => {
    mock.lookup.mockResolvedValue({ data: area({ is_active: true }), error: null });
    const { GET } = await import("@/app/api/request-coverage/route");
    for (const headers of [{}, { ...telemetry, cookie: `${CONSENT_COOKIE}=v1-denied` }, { ...telemetry, "sec-gpc": "1" }, { ...telemetry, "X-POSTHOG-DISTINCT-ID": "person@example.invalid" }]) {
      const response = await GET(lookup("33904", headers));
      expect(await response.json()).toMatchObject({ status: "covered", checkedZip: "33904" });
    }
    expect(await captured()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// A-08 early_access_submitted: POST /api/early-access
// ---------------------------------------------------------------------------------------------

describe("early_access_submitted from POST /api/early-access", () => {
  const valid = { kind: "early_access", email: "synthetic-person@example.invalid", first_name: "Synthetic", zip_code: "33904", service_ids: ["lawn-mowing"], still_exploring: false, marketing_opt_in: false, intake: { trap: "", elapsedMs: MIN_FILL_MS } };
  const expansion = { ...valid, kind: "expansion", zip_code: "32801" };
  const submit = (body: unknown, headers: Record<string, string> = telemetry) => new Request(`${origin}/api/early-access`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  /** The database commands answer as they do for a new or existing interest in the right area. */
  function database(overrides: Record<string, Answer | Error> = {}) {
    mock.rpc.mockImplementation(async (name: string, params: Record<string, unknown>) => {
      const override = overrides[name];
      if (override instanceof Error) throw override;
      if (override) return override;
      if (name === "r0_zip_in_lee") return { data: params.p_zip === "33904", error: null };
      if (name === "intake_record_submission") return { data: "accepted", error: null };
      if (name === "r0_submit_interest") return { data: { outcome: "saved" }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
  }

  it.each([["early_access", valid], ["expansion", expansion]])("captures exactly { kind: %s } when the route answers 201 saved", async (kind, body) => {
    database();
    const { POST } = await import("@/app/api/early-access/route");
    const response = await POST(submit(body));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ outcome: "saved", kind });
    const events = await captured();
    expect(events).toEqual([{ distinctId, event: "early_access_submitted", properties: { kind, ...serverOnly }, disableGeoip: true }]);
    expect(JSON.stringify(events)).not.toMatch(/synthetic-person|example\.invalid|Synthetic|33904|32801|lawn-mowing/);
  });

  it("captures each accepted submission, including a repeat by the same address (F-2), with no new-or-repeat signal", async () => {
    database();
    const { POST } = await import("@/app/api/early-access/route");
    const first = await POST(submit(valid));
    const repeat = await POST(submit(valid));
    expect([first.status, repeat.status]).toEqual([201, 201]);
    expect(await repeat.json()).toEqual(await first.json());
    const events = await captured();
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual(events[0]);
    expect(Object.keys(events[0].properties).sort()).toEqual(["$process_person_profile", "$session_id", "kind"]);
  });

  it.each<[string, unknown, Record<string, Answer | Error>, number]>([
    ["invalid input", { ...valid, email: "not-an-email" }, {}, 400],
    ["a database validation refusal", valid, { r0_submit_interest: { data: null, error: { code: "22023", message: "Synthetic" } } }, 400],
    ["the Lee County boundary before saving", { ...valid, zip_code: "32801" }, {}, 409],
    ["the boundary reported by the save", valid, { r0_submit_interest: { data: { outcome: "boundary" }, error: null } }, 409],
    ["the intake guard", { ...valid, intake: { trap: "", elapsedMs: 10 } }, {}, 429],
    ["the submission limit", valid, { intake_record_submission: { data: "email_limit", error: null } }, 429],
    ["a database failure", valid, { r0_submit_interest: new Error("Synthetic outage") }, 500],
    ["an unexpected save outcome", valid, { r0_submit_interest: { data: { outcome: "unknown" }, error: null } }, 500],
  ])("captures nothing for %s", async (_case, body, overrides, status) => {
    database(overrides);
    const { POST } = await import("@/app/api/early-access/route");
    expect((await POST(submit(body))).status).toBe(status);
    expect(mock.after).not.toHaveBeenCalled();
    expect(await captured()).toEqual([]);
  });

  it("captures nothing for an unreadable body", async () => {
    database();
    const { POST } = await import("@/app/api/early-access/route");
    const response = await POST(new Request(`${origin}/api/early-access`, { method: "POST", headers: telemetry, body: "{" }));
    expect(response.status).toBe(429);
    expect(await captured()).toEqual([]);
  });

  it("captures nothing without consent or usable telemetry IDs, and the saved answer is unchanged", async () => {
    database();
    const { POST } = await import("@/app/api/early-access/route");
    for (const headers of [{}, { ...telemetry, cookie: `${CONSENT_COOKIE}=v1-denied` }, { ...telemetry, dnt: "1" }, { ...telemetry, "X-POSTHOG-DISTINCT-ID": "not-a-uuid" }]) {
      const response = await POST(submit(valid, headers));
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ outcome: "saved", kind: "early_access" });
    }
    expect(await captured()).toEqual([]);
  });

  it("an analytics outage never changes the saved answer", async () => {
    database();
    mock.flush.mockRejectedValue(new Error("Synthetic PostHog outage"));
    const { POST } = await import("@/app/api/early-access/route");
    const response = await POST(submit(valid));
    expect(response.status).toBe(201);
    await expect(captured()).resolves.toHaveLength(1);
  });
});
