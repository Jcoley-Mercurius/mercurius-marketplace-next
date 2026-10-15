import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INVITATION_LINK_INVALID_MESSAGE,
  invitationSetPasswordPath,
  parseInvitationOpenRequest,
} from "../../src/lib/invitationOpenLink";

// DEC-2026-029 follow-up: the Mercurius invitation link valid for the whole invitation.
const attempt = "d4000000-0000-4000-8000-000000000001";
const key = "A".repeat(20) + "b-_" + "9".repeat(20);

describe("parseInvitationOpenRequest", () => {
  it("reads an application or existing-provider link", () => {
    expect(parseInvitationOpenRequest({ invitation: attempt, key })).toEqual({ attempt, source: "application", key });
    expect(parseInvitationOpenRequest({ invitation: attempt.toUpperCase(), kind: "existing_provider", key }))
      .toEqual({ attempt, source: "existing_provider", key });
  });

  it("refuses a missing or malformed attempt, key or kind", () => {
    expect(parseInvitationOpenRequest({ key })).toBeNull();
    expect(parseInvitationOpenRequest({ invitation: "not-a-uuid", key })).toBeNull();
    expect(parseInvitationOpenRequest({ invitation: attempt })).toBeNull();
    expect(parseInvitationOpenRequest({ invitation: attempt, key: key.slice(1) })).toBeNull();
    expect(parseInvitationOpenRequest({ invitation: attempt, key: key.slice(1) + "=" })).toBeNull();
    expect(parseInvitationOpenRequest({ invitation: attempt, key, kind: "admin" })).toBeNull();
  });
});

describe("invitationSetPasswordPath", () => {
  it("hands the fresh sign-in to the existing password step", () => {
    expect(invitationSetPasswordPath({ attempt, source: "application", key }, "hash123"))
      .toBe(`/set-password?invitation=${attempt}&token_hash=hash123&type=magiclink`);
    expect(invitationSetPasswordPath({ attempt, source: "existing_provider", key }, "hash123"))
      .toBe(`/set-password?invitation=${attempt}&kind=existing_provider&token_hash=hash123&type=magiclink`);
  });
});

describe("POST /api/invitations/open", () => {
  type RpcResult = { data: unknown; error: { code?: string; message: string; details?: string } | null };
  type LinkResult = { data: { properties?: { hashed_token?: string } } | null; error: { message: string } | null };
  let rpcCalls: Array<[string, Record<string, unknown>]>;
  let linkCalls: unknown[];

  function mockSupabase(rpc: () => RpcResult, link: () => LinkResult = () => ({ data: { properties: { hashed_token: "minted" } }, error: null })) {
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push([name, args]); return rpc(); },
        auth: { admin: { generateLink: async (args: unknown) => { linkCalls.push(args); return link(); } } },
      }),
    }));
  }
  async function post(body: unknown) {
    const { POST } = await import("../../src/app/api/invitations/open/route");
    const response = await POST(new Request("http://localhost/api/invitations/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  }

  beforeEach(() => {
    rpcCalls = [];
    linkCalls = [];
    vi.resetModules();
    vi.doMock("@/lib/env/server", () => ({
      getServiceSupabaseEnvironment: () => ({ supabaseUrl: "http://127.0.0.1:1", serviceRoleKey: "synthetic" }),
    }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.doUnmock("@supabase/supabase-js");
    vi.doUnmock("@/lib/env/server");
    vi.restoreAllMocks();
  });

  it("checks only the key's hash and mints a sign-in for the database's recipient", async () => {
    mockSupabase(() => ({ data: { auth_user_id: "u1", email: "owner@example.invalid" }, error: null }));
    const result = await post({ invitation: attempt, kind: "existing_provider", key, email: "attacker@example.invalid" });
    expect(result).toEqual({
      status: 200,
      body: { redirect: `/set-password?invitation=${attempt}&kind=existing_provider&token_hash=minted&type=magiclink` },
    });
    expect(rpcCalls).toEqual([["provider_invitation_open", {
      p_source: "existing_provider",
      p_attempt: attempt,
      p_key_hash: createHash("sha256").update(key).digest("hex"),
    }]]);
    expect(linkCalls).toEqual([{ type: "magiclink", email: "owner@example.invalid" }]);
  });

  it("refuses a malformed link before any database call", async () => {
    mockSupabase(() => ({ data: null, error: null }));
    for (const body of [{ invitation: attempt }, { invitation: "x", key }, "not json", [attempt]]) {
      expect(await post(body)).toEqual({ status: 410, body: { error: INVITATION_LINK_INVALID_MESSAGE } });
    }
    expect(rpcCalls).toEqual([]);
  });

  it("gives every database refusal the same answer, mints nothing and never logs the key", async () => {
    mockSupabase(() => ({ data: null, error: { code: "P0001", message: "Invitation link not valid", details: "open_limit" } }));
    expect(await post({ invitation: attempt, key })).toEqual({ status: 410, body: { error: INVITATION_LINK_INVALID_MESSAGE } });
    expect(linkCalls).toEqual([]);
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(logged).toContain("open_limit");
    expect(logged).not.toContain(key);
  });

  it("reports an outage, not an invalid link, when the database or Auth fails", async () => {
    mockSupabase(() => ({ data: null, error: { code: "08006", message: "connection failure" } }));
    expect((await post({ invitation: attempt, key })).status).toBe(503);
    expect(linkCalls).toEqual([]);

    mockSupabase(
      () => ({ data: { auth_user_id: "u1", email: "owner@example.invalid" }, error: null }),
      () => ({ data: null, error: { message: "Auth unavailable" } }),
    );
    vi.resetModules();
    const failed = await post({ invitation: attempt, key });
    expect(failed.status).toBe(503);
    expect(failed.body.redirect).toBeUndefined();
  });
});
