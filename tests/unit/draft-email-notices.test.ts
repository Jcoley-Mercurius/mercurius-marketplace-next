// DEC-2026-041 item 6: the email notice to an unbound vendor's contact on file.
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverDraftEmail, draftEmailKey, draftEmailMessage } from "../../src/lib/draftEmailNotices";

const draftId = "22222222-2222-4222-8222-222222222222";

function fakeClient(responses: Record<string, { data?: unknown; error?: { code?: string; message: string } | null }>) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const response = responses[name] ?? { data: null, error: null };
      return { data: response.data ?? null, error: response.error ?? null };
    }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const claimed = { claimed: true, claim_id: "claim-1", attempt: 1, recipient: "contact@example.test", vendor_name: "Synthetic  Cans" };

describe("draft email notice", () => {
  it("names no price, says email is not approval and points to the linked account", () => {
    const message = draftEmailMessage("Synthetic  Cans", "https://example.test/");
    expect(message.subject).toBe("Mercurius: a price is waiting for your approval");
    expect(message.text).toContain("Hello Synthetic Cans,");
    expect(message.text).toContain("This email cannot approve it, and replying does nothing.");
    expect(message.text).toContain("Link your Mercurius vendor account");
    expect(message.text).toContain("https://example.test/vendor/packages#price-approvals");
    expect(message.text).not.toMatch(/\$\d/);
    expect(message).not.toHaveProperty("replyTo");
  });

  it("does not send when the notice is not claimable", async () => {
    const { client } = fakeClient({ pricing_claim_draft_email: { data: { claimed: false, state: "sent" } } });
    const send = vi.fn();
    expect(await deliverDraftEmail(client, draftId, "initial", send)).toEqual({ state: "not_claimed", current: "sent" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends to the contact on file with a per-attempt key and records the result", async () => {
    const { client, calls } = fakeClient({ pricing_claim_draft_email: { data: claimed } });
    const send = vi.fn(async () => ({ ok: true as const, id: "msg_1" }));
    expect(await deliverDraftEmail(client, draftId, "initial", send)).toEqual({ state: "sent", attempt: 1 });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: draftEmailKey(draftId, 1) }), "contact@example.test");
    expect(calls[1]).toEqual({ name: "pricing_record_draft_email",
      args: { p_draft: draftId, p_claim: "claim-1", p_outcome: "sent", p_provider_id: "msg_1", p_error: null } });
  });

  it("records a timeout as unknown, not as sent or failed", async () => {
    const { client, calls } = fakeClient({ pricing_claim_draft_email: { data: claimed } });
    const send = vi.fn(async () => ({ ok: false as const, definite: false, error: "timeout" }));
    expect(await deliverDraftEmail(client, draftId, "initial", send)).toEqual({ state: "unknown", attempt: 1 });
    expect(calls[1].args.p_outcome).toBe("unknown");
  });
});
