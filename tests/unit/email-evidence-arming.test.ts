// TRACE-155 (Phase 7.3D-1): coverage labels, acceptance judgements and the restricted probe route.
// Synthetic data only. Every network request is stubbed: the fetch stub answers only Resend's send
// endpoint and fails the test on any other URL, so nothing leaves the process.
// 7.3D-1 review fixes: the route needs VERCEL_ENV=production, so these tests mock a Production
// configuration (process.env only) and still stub every send; coverage wording says "recorded
// coverage window", never "collected"; a mixed probe readback is never a success (D-11).
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  created: 0,
  user: { id: "e1250000-0000-4000-8000-000000000001" } as { id: string } | null,
  authorizeError: null as { code: string; message: string } | null,
  readback: { checked_at: "2026-11-20T18:00:00Z", not_probe: false, receipts: [] as unknown[] } as unknown,
  readbackError: null as { code: string; message: string } | null,
  rpcCalls: [] as Array<{ name: string; args?: Record<string, unknown> }>,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    session.created += 1;
    return {
      auth: { getUser: async () => ({ data: { user: session.user }, error: null }) },
      rpc: async (name: string, args?: Record<string, unknown>) => {
        session.rpcCalls.push({ name, args });
        if (name === "email_evidence_probe_authorize") return session.authorizeError ? { data: null, error: session.authorizeError } : { data: true, error: null };
        if (name === "email_evidence_probe_readback") return session.readbackError ? { data: null, error: session.readbackError } : { data: session.readback, error: null };
        throw new Error(`unexpected rpc ${name}`);
      },
    };
  },
}));

import {
  PROBE_CHOICES,
  isProbeChoice,
  probeExpectation,
  probeVerdict,
  probeVerdictLabel,
  qualifyLedgerAttempt,
  type ProbeReadback,
} from "../../src/lib/emailEvidence/acceptance";
import { actorLabel, armAttestation, armingActionLabel, armingReason, purgeDutyLabel, type RetentionReadback } from "../../src/lib/emailEvidence/arming";
import { coverageLabel, evidenceSummaryLabel, type EvidenceCoverage, type EvidenceRule } from "../../src/lib/emailEvidence/labels";
import type { RowEvidence } from "../../src/lib/emailEvidence/readback";
import { PROBE_SUBJECT, PROBE_TEXT, probeGate, probeIdempotencyKey, probeRecipient } from "../../src/lib/emailEvidence/probe";
import { buildOperationalLogRecord } from "../../src/lib/observability/operationalLog";

// Locally generated per run, never literals.
const SENTINEL = {
  resendKey: `sentinel-resend-${randomBytes(12).toString("hex")}`,
  webhookSecret: `whsec_${randomBytes(32).toString("base64")}`,
  emailId: "synthetic-probe-email-id-4f1c",
};
const COVERAGES: EvidenceCoverage[] = ["unknown", "before_first_arm", "gap", "partial", "collecting", "complete"];

// Labels ----------------------------------------------------------------------------------------

describe("coverage labels (R3D-2)", () => {
  it("rules 1–8 keep their 7.3C-1 labels whatever the coverage", () => {
    for (const rule of [1, 2, 3, 4, 5, 6, 7, 8] as EvidenceRule[]) {
      const reported = rule === 2 || rule === 5 ? (["bounced_permanent"] as const) : [];
      const base = evidenceSummaryLabel({ rule, reported: [...reported] });
      for (const coverage of COVERAGES) expect(evidenceSummaryLabel({ rule, reported: [...reported], coverage })).toBe(base);
    }
  });

  it("rule 9 says which coverage window was recorded and never claims more", () => {
    expect(evidenceSummaryLabel({ rule: 9, reported: [], coverage: "collecting" })).toBe("No provider report yet");
    expect(evidenceSummaryLabel({ rule: 9, reported: [] })).toBe("No provider report yet");
    expect(evidenceSummaryLabel({ rule: 9, reported: [], coverage: "complete" }))
      .toBe("No provider report received; a coverage window was recorded for 28 hours after sending");
    expect(evidenceSummaryLabel({ rule: 9, reported: [], coverage: "partial" }))
      .toBe("No provider report received; the recorded coverage window ended within 28 hours of sending, so a report may have been missed");
  });

  it("rule 10 marks a gap between recorded windows, and is otherwise unchanged", () => {
    expect(evidenceSummaryLabel({ rule: 10, reported: [], coverage: "gap" }))
      .toBe("Delivery evidence not available: no coverage window was recorded when this was sent");
    for (const coverage of ["unknown", "before_first_arm", undefined] as const) {
      expect(evidenceSummaryLabel({ rule: 10, reported: [], coverage })).toBe("Delivery evidence not available");
    }
  });

  it("no coverage wording says Delivered, Received, Read or Confirmed alone, or 'later'", () => {
    const texts = [...Object.values(coverageLabel), ...COVERAGES.flatMap((coverage) =>
      [9, 10].map((rule) => evidenceSummaryLabel({ rule: rule as EvidenceRule, reported: [], coverage })))];
    for (const text of texts) {
      expect(text).not.toMatch(/\b(Delivered|Received|Read|Confirmed)\b/);
      expect(text).not.toMatch(/\blater\b/i);
    }
    expect(Object.keys(coverageLabel).sort()).toEqual([...COVERAGES].sort());
  });

  it("coverage wording (review fixes): a recorded window, never a claim that reports were collected or that the receiver was on", () => {
    expect(coverageLabel).toEqual({
      unknown: "Send time unknown, so its coverage window cannot be shown",
      before_first_arm: "Sent before any coverage window was recorded",
      gap: "Sent while no coverage window was recorded",
      partial: "Sent inside a recorded coverage window that ended within 28 hours, so a report may have been missed",
      collecting: "Sent inside the open coverage window, less than 28 hours ago",
      complete: "Sent inside a recorded coverage window that stayed open for 28 hours after",
    });
    const texts = [...Object.values(coverageLabel), ...Object.values(armingActionLabel), ...COVERAGES.flatMap((coverage) =>
      [9, 10].map((rule) => evidenceSummaryLabel({ rule: rule as EvidenceRule, reported: [], coverage })))];
    for (const text of texts) {
      expect(text).not.toMatch(/\bcollect(ed|ing|ion)\b/i);
      expect(text).not.toMatch(/\b(receiver|webhook) (is|was) (on|available|enabled|running)\b/i);
      expect(text).not.toMatch(/\b(enabled?|disabled?|turned on|turned off)\b/i);
    }
  });
});

// Probe verdicts ------------------------------------------------------------------------------------

const receipt = (event_type: string, state: string = "unlinked") =>
  ({ event_type, fact: null, bounce_type: null, bounce_subtype: null, provider_created_at: null, received_at: "2026-11-20T18:00:00Z", state }) as ProbeReadback["receipts"][number];
const readback = (receipts: ProbeReadback["receipts"], not_probe = false): ProbeReadback => ({ checked_at: "2026-11-20T18:00:00Z", not_probe, receipts });

describe("probe verdicts (R3D-3: transport evidence only)", () => {
  it("only the expected event, as an unlinked receipt, is observed", () => {
    expect(probeVerdict(readback([receipt("email.sent"), receipt("email.delivered")]), "delivered")).toBe("expected_event_observed");
    expect(probeVerdict(readback([receipt("email.sent")]), "delivered")).toBe("expected_event_not_observed");
    expect(probeVerdict(readback([]), "complained")).toBe("no_receipt_yet");
    expect(probeVerdict(readback([], true), "delivered")).toBe("not_probe_evidence");
    expect(probeVerdict(readback([receipt("email.delivered")]), "suppressed")).toBe("expected_event_not_observed");
  });

  it("D-11: any linked or conflicted receipt excludes the whole ID, even beside a valid expected-event receipt", () => {
    for (const state of ["content_conflict", "stored_conflict", "current_conflict", "trusted"] as const) {
      // An otherwise valid expected report plus one disqualified report for the same provider ID.
      expect(probeVerdict(readback([receipt("email.bounced"), receipt("email.bounced", state)]), "bounced")).toBe("not_probe_evidence");
      expect(probeVerdict(readback([receipt("email.bounced", state), receipt("email.delivered")]), "delivered")).toBe("not_probe_evidence");
      expect(probeVerdict(readback([receipt("email.bounced", state)]), "bounced")).toBe("not_probe_evidence");
    }
    // The database flag alone excludes, whatever receipts accompany it.
    expect(probeVerdict(readback([receipt("email.bounced")], true), "bounced")).toBe("not_probe_evidence");
  });

  it("the excluded label says why, and does not claim the send was not a probe", () => {
    expect(probeVerdictLabel.not_probe_evidence).toBe(
      "Not usable as test evidence: a current report for this send is matched to an email record, carries Mercurius tags or is in conflict, so none of its reports are shown");
    expect(probeVerdictLabel.not_probe_evidence).not.toMatch(/not a (test )?probe/i);
  });

  it("the observed label disclaims email-record evidence", () => {
    expect(probeVerdictLabel.expected_event_observed).toContain("transport evidence only, not email-record evidence");
  });

  it("the suppressed address's event is marked undocumented; the choices are exactly the four test addresses", () => {
    expect(PROBE_CHOICES).toEqual(["delivered", "bounced", "complained", "suppressed"]);
    expect(Object.entries(probeExpectation).filter(([, value]) => !value.documented).map(([key]) => key)).toEqual(["suppressed"]);
    for (const bad of ["", "Delivered", "delivered@resend.dev", "failed", "delivery_delayed", null, 1, ["delivered"], { choice: "delivered" }]) {
      expect(isProbeChoice(bad)).toBe(false);
    }
  });
});

// Ledger qualification ---------------------------------------------------------------------------------

const summary = { rule: 4 as EvidenceRule, delivered_fact: true, non_delivery_proven: false, needs_review: false, reported: [] };
function evidence(coverage: EvidenceCoverage | undefined, reports: RowEvidence["attempts"][number]["reports"], hasConflict = false): RowEvidence {
  return {
    attempt: 1, summary: { ...summary, coverage }, has_conflict: hasConflict, conflict_reasons: [],
    attempts: [{ attempt: 1, ...summary, coverage, has_conflict: hasConflict, reports }],
  };
}
const delivered = (excluded: "stored_conflict" | "content_conflict" | "current_conflict" | null = null) =>
  ({ fact: "delivered" as const, provider_created_at: "2026-11-20T18:00:00Z", bounce_type: null, bounce_subtype: null, excluded });

describe("ledger qualification (readiness §3.2, criteria 4 and 5 as corrected)", () => {
  it("qualifies only an expected, trusted report on an attempt claimed while collecting", () => {
    for (const coverage of ["collecting", "complete", "partial"] as const) {
      expect(qualifyLedgerAttempt(evidence(coverage, [delivered()]), 1, "delivered")).toBe("qualifying");
    }
  });

  it("criterion 4: an attempt claimed before the cutoff never qualifies, even with a trusted report", () => {
    expect(qualifyLedgerAttempt(evidence("before_first_arm", [delivered()]), 1, "delivered")).toBe("claimed_outside_collection");
    expect(qualifyLedgerAttempt(evidence("gap", [delivered()]), 1, "delivered")).toBe("claimed_outside_collection");
    expect(qualifyLedgerAttempt(evidence("unknown", [delivered()]), 1, "delivered")).toBe("claimed_outside_collection");
    expect(qualifyLedgerAttempt(evidence(undefined, [delivered()]), 1, "delivered")).toBe("coverage_unknown");
  });

  it("criterion 5: excluded, conflicting, missing or unexpected reports never qualify", () => {
    for (const excluded of ["stored_conflict", "content_conflict", "current_conflict"] as const) {
      expect(qualifyLedgerAttempt(evidence("complete", [delivered(excluded)]), 1, "delivered")).toBe("expected_report_missing");
    }
    expect(qualifyLedgerAttempt(evidence("complete", [delivered()], true), 1, "delivered")).toBe("conflicting_report");
    expect(qualifyLedgerAttempt(evidence("complete", []), 1, "delivered")).toBe("expected_report_missing");
    expect(qualifyLedgerAttempt(evidence("complete", [delivered()]), 1, "bounced_permanent")).toBe("expected_report_missing");
    expect(qualifyLedgerAttempt(evidence("complete", [delivered()]), 2, "delivered")).toBe("attempt_not_found");
  });

  it("an already stored expected trusted receipt stays valid readback evidence (a duplicate response changes nothing)", () => {
    const stored = evidence("partial", [delivered()]);
    const afterDuplicate = structuredClone(stored);
    expect(qualifyLedgerAttempt(afterDuplicate, 1, "delivered")).toBe(qualifyLedgerAttempt(stored, 1, "delivered"));
    expect(qualifyLedgerAttempt(afterDuplicate, 1, "delivered")).toBe("qualifying");
  });
});

describe("arming wording", () => {
  const retention = (extra: Partial<RetentionReadback>): RetentionReadback => ({
    retained: 0, retained_linked: 0, retained_unlinked: 0, expired: 0, oldest_expired_expires_at: null, latest_expires_at: null,
    purge_duty: false, last_purge: null, ...extra,
  });
  it("purge duty continues while anything is stored, including unexpired reports", () => {
    expect(purgeDutyLabel(retention({}))).toBe("No provider reports are stored. There is nothing to purge.");
    expect(purgeDutyLabel(retention({ retained: 4, purge_duty: true }))).toMatch(/^No report has expired yet, but reports are still stored\. Keep running the operator purge/);
    expect(purgeDutyLabel(retention({ retained: 4, expired: 2, purge_duty: true }))).toMatch(/^Expired reports are waiting for the operator purge/);
  });
  it("history entries and the attestation record a coverage window; they never say collection started or stopped", () => {
    expect(armingActionLabel).toEqual({ arm: "Coverage window start recorded", disarm: "Coverage window end recorded" });
    expect(armAttestation).toMatch(/^The owner has authorized arming/);
    expect(purgeDutyLabel(retention({ retained: 4, purge_duty: true }))).toContain("even when no coverage window is open");
    expect(purgeDutyLabel(retention({ retained: 4, expired: 1, purge_duty: true }))).not.toMatch(/collection/i);
  });
  it("reasons are sent as one trimmed line; actors are shortened", () => {
    expect(armingReason("  Owner\nauthorized\t EO-1  ")).toBe("Owner authorized EO-1");
    expect(actorLabel("e1250000-0000-4000-8000-000000000001")).toBe("Operator account …000001");
  });
});

// Probe module and route ------------------------------------------------------------------------------

const env = { ...process.env };
let fetchCalls: Array<{ url: string; init: RequestInit }> = [];
let providerAnswer: () => Promise<Response> = async () => new Response(JSON.stringify({ id: SENTINEL.emailId }), { status: 200 });
let logLines: string[] = [];

beforeEach(() => {
  process.env.RESEND_API_KEY = SENTINEL.resendKey;
  process.env.RESEND_FROM_EMAIL = "Mercurius <notifications@example.test>";
  process.env.OWNER_NOTIFICATION_EMAIL = "owner@example.test";
  process.env.RESEND_WEBHOOK_SECRET = SENTINEL.webhookSecret;
  process.env.EMAIL_EVIDENCE_PROBES_ENABLED = "true";
  // A mocked Production configuration (D-8). Every send below is still stubbed.
  process.env.VERCEL_ENV = "production";
  fetchCalls = [];
  providerAnswer = async () => new Response(JSON.stringify({ id: SENTINEL.emailId }), { status: 200 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url !== "https://api.resend.com/emails") throw new Error(`blocked network request to ${url}`);
    fetchCalls.push({ url, init });
    return providerAnswer();
  }));
  session.created = 0;
  session.user = { id: "e1250000-0000-4000-8000-000000000001" };
  session.authorizeError = null;
  session.readbackError = null;
  session.readback = { checked_at: "2026-11-20T18:00:00Z", not_probe: false, receipts: [] };
  session.rpcCalls = [];
  logLines = [];
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((line: unknown) => { logLines.push(String(line)); });
  }
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("probe module", () => {
  it("each choice resolves to its fixed Resend test address only", () => {
    expect(PROBE_CHOICES.map(probeRecipient)).toEqual(["delivered@resend.dev", "bounced@resend.dev", "complained@resend.dev", "suppressed@resend.dev"]);
  });
  it("the key is stable per test address per UTC day", () => {
    const morning = new Date("2026-11-20T00:00:01Z"), night = new Date("2026-11-20T23:59:59Z"), next = new Date("2026-11-21T00:00:00Z");
    expect(probeIdempotencyKey("bounced", morning)).toBe("email-evidence-probe:v1:bounced:2026-11-20");
    expect(probeIdempotencyKey("bounced", night)).toBe(probeIdempotencyKey("bounced", morning));
    expect(probeIdempotencyKey("bounced", next)).toBe("email-evidence-probe:v1:bounced:2026-11-21");
    expect(probeIdempotencyKey("delivered", morning)).not.toBe(probeIdempotencyKey("bounced", morning));
  });
  it("the gate is closed unless the flag is exactly 'true'", () => {
    for (const value of [undefined, "", "1", "TRUE", "yes", "true "]) {
      if (value === undefined) delete process.env.EMAIL_EVIDENCE_PROBES_ENABLED; else process.env.EMAIL_EVIDENCE_PROBES_ENABLED = value;
      expect(probeGate()).toEqual({ open: false, reason: "disabled" });
    }
  });
  it("D-8: open only with VERCEL_ENV exactly 'production'; absent (local, CI), Preview and every other value fail closed", () => {
    delete process.env.VERCEL_ENV;
    expect(probeGate()).toEqual({ open: false, reason: "environment" });
    for (const value of ["", "preview", "development", "staging", "Production", "PRODUCTION", " production", "production "]) {
      process.env.VERCEL_ENV = value;
      expect(probeGate()).toEqual({ open: false, reason: "environment" });
    }
    process.env.VERCEL_ENV = "production";
    expect(probeGate()).toEqual({ open: true });
    // The flag is still required in Production.
    delete process.env.EMAIL_EVIDENCE_PROBES_ENABLED;
    expect(probeGate()).toEqual({ open: false, reason: "disabled" });
  });
});

async function post(body: unknown, raw?: string) {
  const { POST } = await import("../../src/app/api/admin/email-evidence-probe/route");
  const request = new Request("http://localhost/api/admin/email-evidence-probe", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: raw ?? JSON.stringify(body),
  });
  const textSpy = vi.spyOn(request, "text");
  const response = await POST(request);
  return { response, json: await response.json(), bodyRead: textSpy.mock.calls.length > 0 };
}
const logged = () => logLines.map((line) => JSON.parse(line) as Record<string, unknown>);

describe("probe route (R3D-4)", () => {
  it("exports POST only", async () => {
    const route = await import("../../src/app/api/admin/email-evidence-probe/route");
    expect(Object.keys(route).sort()).toEqual(["POST", "runtime"]);
    expect(route.runtime).toBe("nodejs");
  });

  it("disabled by default: 404 before reading the request, the session or anything else", async () => {
    delete process.env.EMAIL_EVIDENCE_PROBES_ENABLED;
    const { response, bodyRead } = await post({ choice: "delivered" });
    expect(response.status).toBe(404);
    expect(bodyRead).toBe(false);
    expect(session.created).toBe(0);
    expect(fetchCalls).toHaveLength(0);
    expect(logged()).toMatchObject([{ event: "email_probe.refused", route: "email_evidence_probe", outcome: "refused", error_code: "probe_disabled" }]);
  });

  it("refused with VERCEL_ENV absent, in Preview and in any non-Production environment, even when enabled", async () => {
    for (const value of [undefined, "preview", "development", "Production"]) {
      if (value === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = value;
      const { response, bodyRead } = await post({ choice: "delivered" });
      expect(response.status).toBe(404);
      expect(bodyRead).toBe(false);
    }
    expect(session.created).toBe(0);
    expect(fetchCalls).toHaveLength(0);
    expect(logged().map((line) => line.error_code)).toEqual(Array(4).fill("probe_environment_refused"));
  });

  it("open in a mocked Production configuration with the flag: one stubbed send, nothing else on the network", async () => {
    expect(process.env.VERCEL_ENV).toBe("production");
    const { response } = await post({ choice: "delivered" });
    expect(response.status).toBe(200);
    expect(fetchCalls.map((call) => call.url)).toEqual(["https://api.resend.com/emails"]);
  });

  it("authenticates and authorizes every invocation", async () => {
    session.user = null;
    expect((await post({ choice: "delivered" })).response.status).toBe(401);
    session.user = { id: "e1250000-0000-4000-8000-000000000003" };
    session.authorizeError = { code: "42501", message: "Onboarding operator required" };
    expect((await post({ choice: "delivered" })).response.status).toBe(403);
    session.authorizeError = { code: "08006", message: "connection failure" };
    expect((await post({ choice: "delivered" })).response.status).toBe(503);
    expect(fetchCalls).toHaveLength(0);
    expect(session.rpcCalls.map((call) => call.name)).toEqual(["email_evidence_probe_authorize", "email_evidence_probe_authorize"]);
  });

  it("rejects any recipient, URL, header, content, ledger reference, claim or unknown choice", async () => {
    const bodies: unknown[] = [
      { choice: "delivered", to: "someone@example.test" }, { choice: "delivered", recipient: "x@example.test" },
      { choice: "delivered", url: "https://example.test" }, { choice: "delivered", headers: { "X-Test": "1" } },
      { choice: "delivered", subject: "Hello" }, { choice: "delivered", text: "Body" }, { choice: "delivered", html: "<p>" },
      { choice: "delivered", ledger: "owner_email", ref: "e1250000-0000-4000-8000-000000000001", attempt: 1 },
      { choice: "delivered", claim_id: "e1250000-0000-4000-8000-000000000001" }, { choice: "delivered", idempotencyKey: "k" },
      { choice: "failed" }, { choice: "delivered@resend.dev" }, { choice: ["delivered"] }, {}, [], ["delivered"], null, "delivered",
      { to: "delivered@resend.dev" },
    ];
    for (const body of bodies) expect((await post(body)).response.status, JSON.stringify(body)).toBe(400);
    expect((await post(null, "not json")).response.status).toBe(400);
    expect((await post(null, JSON.stringify({ choice: "delivered", pad: "x".repeat(300) }))).response.status).toBe(400);
    expect((await post(null, `{"choice":"delivered"${" ".repeat(300)}}`)).response.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it("fails closed when the provider or the receiver is not configured", async () => {
    for (const name of ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET"]) {
      const saved = process.env[name];
      delete process.env[name];
      const { response, json } = await post({ choice: "delivered" });
      expect(response.status, name).toBe(503);
      expect(json.error).toContain("Nothing was sent");
      process.env[name] = saved;
    }
    expect(fetchCalls).toHaveLength(0);
  });

  it("sends exactly the fixed synthetic email, untagged, with the stable key, and reads back only its own receipts", async () => {
    session.readback = { checked_at: "2026-11-20T18:00:00Z", not_probe: false, receipts: [receipt("email.sent"), receipt("email.delivered")] };
    const { response, json } = await post({ choice: "delivered" });
    expect(response.status).toBe(200);
    expect(fetchCalls).toHaveLength(1);
    const { init } = fetchCalls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(probeIdempotencyKey("delivered", new Date()));
    expect(Object.keys(headers).sort()).toEqual(["Authorization", "Content-Type", "Idempotency-Key"]);
    expect(JSON.parse(String(init.body))).toEqual({
      from: "Mercurius <notifications@example.test>", to: ["delivered@resend.dev"], subject: PROBE_SUBJECT, text: PROBE_TEXT,
    });
    expect(session.rpcCalls.at(-1)).toEqual({ name: "email_evidence_probe_readback", args: { p_provider_email_id: SENTINEL.emailId } });
    expect(json).toMatchObject({ state: "sent", choice: "delivered", verdict: "expected_event_observed" });
    expect(JSON.stringify(json)).not.toContain(SENTINEL.emailId);
    expect(JSON.stringify(json)).not.toContain("resend.dev");
    expect(logged()).toMatchObject([{ event: "email_probe.sent", outcome: "sent", source_kind: null, source_id: null }]);
  });

  it("D-11: a mixed readback is reported as not usable, with no receipts shown", async () => {
    session.readback = { checked_at: "2026-11-20T18:00:00Z", not_probe: false,
      receipts: [receipt("email.bounced", "content_conflict"), receipt("email.bounced")] };
    const { json } = await post({ choice: "bounced" });
    expect(json).toEqual({ state: "sent", choice: "bounced", verdict: "not_probe_evidence",
      readback: { checked_at: "2026-11-20T18:00:00Z", not_probe: false, receipts: [] } });
    session.readback = { checked_at: "2026-11-20T18:00:00Z", not_probe: true, receipts: [] };
    expect((await post({ choice: "bounced" })).json).toMatchObject({ verdict: "not_probe_evidence", readback: { receipts: [] } });
  });

  it("repeated invocation: one provider request each, the identical key and body, so Resend replays instead of sending again", async () => {
    await post({ choice: "bounced" });
    await post({ choice: "bounced" });
    expect(fetchCalls).toHaveLength(2);
    const [first, second] = fetchCalls.map(({ init }) => ({ key: (init.headers as Record<string, string>)["Idempotency-Key"], body: init.body }));
    expect(second).toEqual(first);
    expect(first.key).toMatch(/^email-evidence-probe:v1:bounced:\d{4}-\d{2}-\d{2}$/);
  });

  it("no automatic retry: a refusal, a 409, a server error or a timeout is one request and a reported failure", async () => {
    const answers: Array<[() => Promise<Response>, string]> = [
      [async () => new Response("refused", { status: 422 }), "failed"],
      [async () => new Response("concurrent", { status: 409 }), "unknown"],
      [async () => new Response("down", { status: 500 }), "unknown"],
      [async () => { throw new Error("The operation was aborted due to timeout"); }, "unknown"],
    ];
    for (const [answer, state] of answers) {
      fetchCalls = [];
      providerAnswer = answer;
      const { response, json } = await post({ choice: "complained" });
      expect(response.status).toBe(502);
      expect(json.state).toBe(state);
      expect(json.message).toContain("not retried");
      expect(fetchCalls).toHaveLength(1);
    }
    expect(session.rpcCalls.filter((call) => call.name === "email_evidence_probe_readback")).toHaveLength(0);
  });

  it("a send without an ID, or a failed readback, still reports the send and no receipts", async () => {
    providerAnswer = async () => new Response("{}", { status: 200 });
    expect((await post({ choice: "suppressed" })).json).toEqual({ state: "sent", choice: "suppressed", readback: null, verdict: null });
    providerAnswer = async () => new Response(JSON.stringify({ id: SENTINEL.emailId }), { status: 200 });
    session.readbackError = { code: "42501", message: "denied" };
    expect((await post({ choice: "suppressed" })).json).toEqual({ state: "sent", choice: "suppressed", readback: null, verdict: null });
  });

  it("redaction: no log line or response carries the key, secret, provider ID, recipient, idempotency key or content", async () => {
    providerAnswer = async () => new Response(`refused for delivered@resend.dev ${SENTINEL.emailId}`, { status: 422 });
    const failed = await post({ choice: "delivered" });
    providerAnswer = async () => new Response(JSON.stringify({ id: SENTINEL.emailId }), { status: 200 });
    const sent = await post({ choice: "delivered" });
    const output = [...logLines, JSON.stringify(failed.json), JSON.stringify(sent.json)].join("\n");
    for (const secret of [SENTINEL.resendKey, SENTINEL.webhookSecret, SENTINEL.emailId, "resend.dev", "email-evidence-probe:", PROBE_SUBJECT, PROBE_TEXT, "notifications@example.test"]) {
      expect(output).not.toContain(secret);
    }
    for (const line of logged()) {
      expect(Object.keys(line).sort()).toEqual(["application_id", "attempt", "correlation_id", "duration_ms", "env", "error_code", "event", "level",
        "mode", "outcome", "release", "route", "schema", "source_id", "source_kind", "ts"]);
    }
  });
});

describe("logger names", () => {
  it("the probe events are v2 with the 16 keys, and the new codes are accepted", () => {
    for (const event of ["email_probe.refused", "email_probe.sent", "email_probe.failed"] as const) {
      const record = buildOperationalLogRecord({ event, route: "email_evidence_probe", correlationId: "6f1c2a8e-0000-4000-8000-000000000001" });
      expect(record.schema).toBe("mercurius.oplog.v2");
      expect(Object.keys(record)).toHaveLength(16);
      expect(record.route).toBe("email_evidence_probe");
    }
    for (const code of ["probe_disabled", "probe_environment_refused"] as const) {
      expect(buildOperationalLogRecord({ event: "email_probe.refused", route: "email_evidence_probe", correlationId: "x", errorCode: code }).error_code).toBe(code);
    }
  });
});

describe("route inventory (readiness criterion 1)", () => {
  it("the probe and the arming commands are reachable only through the admin route and the admin page", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, relative } = await import("node:path");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk("src/app");
    const uses = (pattern: RegExp) => files.filter((file) => pattern.test(readFileSync(file, "utf8"))).map((file) => relative("src/app", file)).sort();
    expect(uses(/emailEvidence\/probe"|sendProbe\(/)).toEqual(["api/admin/email-evidence-probe/route.ts"]);
    expect(uses(/email_evidence_(arm|disarm|arming_readback)\b/)).toEqual(["admin/email-evidence/page.tsx"]);
    expect(uses(/email_evidence_probe_(authorize|readback)\b/)).toEqual(["api/admin/email-evidence-probe/route.ts"]);
    expect(files.filter((file) => /email-evidence/.test(file)).map((file) => relative("src/app", file)).sort())
      .toEqual(["admin/email-evidence/page.tsx", "api/admin/email-evidence-probe/route.ts"]);
  });
});
