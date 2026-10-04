// TRACE-104 (R0.4): owner-notification delivery, recovery and vendor/operator readiness.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const afterCallbacks: Array<() => Promise<void>> = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => Promise<void>) => { afterCallbacks.push(callback); },
}));

import {
  applicationNotificationKey,
  applicationNotificationMessage,
  deliverApplicationNotification,
  outcomeState,
  type ClaimedApplication,
} from "../../src/lib/applicationNotifications";
import { sendOwnerNotification } from "../../src/lib/ownerNotifications";
import {
  listingBlockers,
  listingSteps,
  notificationNeedsConfirmation,
  type ListingInventoryItem,
} from "../../src/lib/recruitingReadiness";

const application: ClaimedApplication = {
  id: "11111111-1111-4111-8111-111111111111",
  created_at: "2026-09-30T12:00:00Z",
  business_name: "Synthetic Lawn   Co",
  first_name: "Ann",
  last_name: null,
  email: "applicant@example.test",
  phone: "synthetic",
  primary_category: null,
  services: ["lawn-mowing"],
  service_areas: null,
};

type RpcCall = { name: string; args: Record<string, unknown> };

function fakeClient(responses: Record<string, { data?: unknown; error?: { code?: string; message: string } | null }>) {
  const calls: RpcCall[] = [];
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const response = responses[name] ?? { data: null, error: null };
      return { data: response.data ?? null, error: response.error ?? null };
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const claimed = { claimed: true, claim_id: "claim-1", attempt: 2, application };

describe("sendOwnerNotification", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_synthetic_key_value";
    process.env.RESEND_FROM_EMAIL = "Mercurius <notifications@example.test>";
    process.env.OWNER_NOTIFICATION_EMAIL = "owner@example.test";
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it("sends an idempotency key and returns the provider id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await sendOwnerNotification({ subject: "s", text: "t", idempotencyKey: "key-1" });
    expect(result).toEqual({ ok: true, id: "msg_1" });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-1");
    expect(JSON.parse(init.body as string).to).toEqual(["owner@example.test"]);
  });

  it.each([
    [422, true],
    [429, true],
    [403, true],
    [409, false],
    [500, false],
    [503, false],
  ])("classifies HTTP %i as definite=%s", async (status, definite) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("refused", { status })));
    const result = await sendOwnerNotification({ subject: "s", text: "t" });
    expect(result).toMatchObject({ ok: false, definite });
  });

  it("treats a network error or timeout as uncertain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("The operation was aborted due to timeout"); }));
    expect(await sendOwnerNotification({ subject: "s", text: "t" })).toMatchObject({ ok: false, definite: false });
  });

  it("reports missing configuration as a definite failure without calling Resend", async () => {
    delete process.env.RESEND_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendOwnerNotification({ subject: "s", text: "t" })).toMatchObject({ ok: false, definite: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the owner-confirmed recipient", async () => {
    delete process.env.OWNER_NOTIFICATION_EMAIL;
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendOwnerNotification({ subject: "s", text: "t" });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string).to).toEqual(["jcoley@mercuriusmarketplace.com"]);
  });
});

describe("deliverApplicationNotification", () => {
  it("does not send when another caller holds the claim", async () => {
    const { client } = fakeClient({ r0_claim_application_notification: { data: { claimed: false, state: "sending" } } });
    const send = vi.fn();
    expect(await deliverApplicationNotification(client, application.id, "initial", send)).toEqual({ state: "not_claimed", current: "sending" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the saved application with a per-attempt key and records success", async () => {
    const { client, calls } = fakeClient({ r0_claim_application_notification: { data: claimed } });
    const send = vi.fn(async () => ({ ok: true as const, id: "msg_2" }));
    expect(await deliverApplicationNotification(client, application.id, "resend", send)).toEqual({ state: "sent", attempt: 2 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: applicationNotificationKey(application.id, 2),
      replyTo: "applicant@example.test",
    }));
    expect(calls[0]).toEqual({ name: "r0_claim_application_notification", args: { p_application: application.id, p_mode: "resend" } });
    expect(calls[1]).toEqual({ name: "r0_record_application_notification", args: {
      p_application: application.id, p_claim: "claim-1", p_outcome: "sent", p_provider_id: "msg_2", p_error: null,
    } });
  });

  it("records a definite refusal as failed and an uncertain one as unknown", async () => {
    for (const [definite, state] of [[true, "failed"], [false, "unknown"]] as const) {
      const { client, calls } = fakeClient({ r0_claim_application_notification: { data: claimed } });
      const send = vi.fn(async () => ({ ok: false as const, definite, error: "Resend returned 500." }));
      expect((await deliverApplicationNotification(client, application.id, "initial", send)).state).toBe(state);
      expect(calls[1].args).toMatchObject({ p_outcome: state, p_error: "Resend returned 500.", p_provider_id: null });
    }
  });

  it("reports an unrecorded outcome instead of throwing, leaving the claim for operators", async () => {
    const { client } = fakeClient({
      r0_claim_application_notification: { data: claimed },
      r0_record_application_notification: { error: { code: "40001", message: "Notification claim is not current" } },
    });
    const send = vi.fn(async () => ({ ok: true as const, id: null }));
    expect(await deliverApplicationNotification(client, application.id, "initial", send)).toEqual({ state: "unrecorded", attempt: 2 });
  });

  it("throws when the claim itself fails, so the record stays pending and later reads as missed", async () => {
    const { client } = fakeClient({ r0_claim_application_notification: { error: { message: "connection refused" } } });
    const send = vi.fn();
    await expect(deliverApplicationNotification(client, application.id, "initial", send)).rejects.toMatchObject({ message: "connection refused" });
    expect(send).not.toHaveBeenCalled();
  });

  it("builds the message from saved data", () => {
    const message = applicationNotificationMessage(application);
    expect(message.subject).toBe("New vendor application — Synthetic Lawn Co");
    expect(message.text).toContain("Contact: Ann\n");
    expect(message.text).toContain("Primary category: Not provided");
    expect(outcomeState({ ok: true, id: null })).toBe("sent");
  });
});

// Importing the route compiles its dependency graph; allow for a loaded CI host.
describe("POST /api/vendor-applications", { timeout: 60_000 }, () => {
  const inserted: unknown[] = [];

  beforeEach(() => {
    inserted.length = 0;
    afterCallbacks.length = 0;
    vi.resetModules();
    vi.doMock("@/lib/env/server", () => ({
      getServiceSupabaseEnvironment: () => ({ supabaseUrl: "http://127.0.0.1:1", serviceRoleKey: "synthetic" }),
      getOwnerNotificationEnvironment: () => { throw new Error("RESEND_API_KEY is required."); },
    }));
    vi.doMock("@/lib/intakeProtection", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/lib/intakeProtection")>()),
      intakeGuardRefusal: () => null,
      recordIntakeSubmission: async () => "accepted",
    }));
  });
  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
    vi.doUnmock("@/lib/env/server");
    vi.doUnmock("@/lib/intakeProtection");
  });

  function mockSupabase(rpc: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown }) {
    const rpcCalls: RpcCall[] = [];
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        from: (table: string) => ({
          insert: async (row: unknown) => { inserted.push(row); return { error: null }; },
          // TRACE-105: the active catalog the route checks choices against.
          select: () => ({ eq: async () => ({ data: table === "services_catalog" ? [{ id: "lawn-mowing" }] : [{ name: "Lawn & Landscape" }], error: null }) }),
        }),
        rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return rpc(name, args); },
      }),
    }));
    return rpcCalls;
  }

  function submit(overrides: Record<string, unknown> = {}) {
    return new Request("http://localhost/api/vendor-applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        intake: {},
        application: {
          business_name: "Synthetic Lawn Co", first_name: "Ann", email: "Applicant@Example.test", phone: "synthetic",
          years_experience: 3, services: ["lawn-mowing", "Other: lanai rescreening"], primary_category: "Lawn & Landscape", team_size: "1",
          ...overrides,
        },
      }),
    });
  }

  it("saves the application and answers 201 even when the owner email fails", async () => {
    const rpcCalls = mockSupabase((name) => name === "r0_claim_application_notification"
      ? { data: { claimed: true, claim_id: "claim-9", attempt: 1, application }, error: null }
      : { data: { state: "failed" }, error: null });
    const { POST } = await import("../../src/app/api/vendor-applications/route");
    const response = await POST(submit());
    expect(response.status).toBe(201);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ status: "pending", email: "applicant@example.test", document_urls: [], services: ["lawn-mowing", "Other: lanai rescreening"] });
    // The email runs after the response and cannot change it.
    await Promise.all(afterCallbacks.map((callback) => callback()));
    expect(rpcCalls.map((call) => call.name)).toEqual(["r0_claim_application_notification", "r0_record_application_notification"]);
    expect(rpcCalls[1].args).toMatchObject({ p_outcome: "failed", p_claim: "claim-9" });
  });

  it("keeps the saved application when the delivery ledger is unreachable after saving", async () => {
    mockSupabase(() => ({ data: null, error: { message: "connection reset" } }));
    const { POST } = await import("../../src/app/api/vendor-applications/route");
    const response = await POST(submit());
    expect(response.status).toBe(201);
    await expect(Promise.all(afterCallbacks.map((callback) => callback()))).resolves.toBeDefined();
    expect(inserted).toHaveLength(1);
  });

  it.each([
    [{ services: ["Other: lanai rescreening"] }, "Choose at least one service from the list."],
    [{ services: ["lawn-mowing", "Mowing"] }, "A selected service is no longer offered. Refresh the page and choose again."],
    [{ primary_category: "Lawn Care & Mowing" }, "Choose a primary category from the list."],
  ])("refuses choices outside the active catalog (%o)", async (overrides, message) => {
    mockSupabase(() => ({ data: null, error: null }));
    const { POST } = await import("../../src/app/api/vendor-applications/route");
    const response = await POST(submit(overrides));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
    expect(inserted).toHaveLength(0);
  });
});

describe("recruiting readiness presentation", () => {
  const base: ListingInventoryItem = {
    contractor_id: "c", name: "Synthetic", is_active: true, marketing_enabled: true, account_linked: true,
    onboarding_status: "active", eligible: true, has_content: true, listable: true, excluded: false,
    exclusion_reason: null, excluded_at: null, test_signal: false, featured: false,
    request_count: 0, invoice_count: 0, review_count: 0,
  };

  it("requires confirmation only where an earlier email may have arrived", () => {
    expect(notificationNeedsConfirmation("unknown")).toBe(true);
    expect(notificationNeedsConfirmation("untracked")).toBe(true);
    expect(notificationNeedsConfirmation("failed")).toBe(false);
    expect(notificationNeedsConfirmation("missed")).toBe(false);
  });

  it("explains why a provider is not listed", () => {
    expect(listingBlockers(base)).toEqual([]);
    expect(listingBlockers({ ...base, eligible: false, has_content: false, is_active: false, marketing_enabled: false }))
      .toEqual(["Not approved and eligible", "Inactive", "Not accepting work", "Missing name, description or a live catalog service"]);
    expect(listingBlockers({ ...base, excluded: true, eligible: false })).toEqual(["Hidden by an operator"]);
  });

  it("gives a vendor actionable preparation steps without a vendor-editable visibility link", () => {
    const steps = listingSteps({
      linked: true, contractor_id: "c", listed: false, active: true, accepting_work: false, approved: true, held: false,
      has_name: true, has_description: false, has_catalog_service: true, service_zips: [],
    });
    expect(steps.map((step) => [step.id, step.done])).toEqual([
      ["approved", true], ["description", false], ["services", true], ["available", false],
    ]);
    expect(steps.find((step) => step.id === "available")?.href).toBeNull();
  });
});
