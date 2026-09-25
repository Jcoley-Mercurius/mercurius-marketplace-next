import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MIN_FILL_MS,
  intakeEmailHash,
  intakeGuardRefusal,
  recordIntakeSubmission,
} from "../../src/lib/intakeProtection";

// TRACE-088. The database pattern the stored key must match (see migration
// 20260924004000): 64 lowercase hex characters.
const databasePattern = /^[0-9a-f]{64}$/;

describe("intakeGuardRefusal", () => {
  it("accepts an empty honeypot and a fill time of at least 3 seconds", () => {
    expect(intakeGuardRefusal({ trap: "", elapsedMs: MIN_FILL_MS })).toBeNull();
    expect(intakeGuardRefusal({ trap: "", elapsedMs: 600_000 })).toBeNull();
  });

  it("refuses a filled honeypot whatever the fill time", () => {
    expect(intakeGuardRefusal({ trap: "x", elapsedMs: 60_000 })).toBe("trap");
    expect(intakeGuardRefusal({ trap: " ", elapsedMs: 60_000 })).toBe("trap");
  });

  it("refuses a honeypot that is missing or not a string", () => {
    expect(intakeGuardRefusal({ elapsedMs: 60_000 })).toBe("trap");
    expect(intakeGuardRefusal({ trap: null, elapsedMs: 60_000 })).toBe("trap");
    expect(intakeGuardRefusal({ trap: 0, elapsedMs: 60_000 })).toBe("trap");
  });

  it("refuses a form sent in under 3 seconds", () => {
    expect(intakeGuardRefusal({ trap: "", elapsedMs: MIN_FILL_MS - 1 })).toBe("too_fast");
    expect(intakeGuardRefusal({ trap: "", elapsedMs: 0 })).toBe("too_fast");
    expect(intakeGuardRefusal({ trap: "", elapsedMs: -5_000 })).toBe("too_fast");
  });

  it("refuses a missing or malformed fill time", () => {
    expect(intakeGuardRefusal({ trap: "" })).toBe("too_fast");
    expect(intakeGuardRefusal({ trap: "", elapsedMs: "60000" })).toBe("too_fast");
    expect(intakeGuardRefusal({ trap: "", elapsedMs: Number.NaN })).toBe("too_fast");
    expect(intakeGuardRefusal({ trap: "", elapsedMs: Number.POSITIVE_INFINITY })).toBe("too_fast");
  });

  it("refuses a missing or malformed guard", () => {
    expect(intakeGuardRefusal(undefined)).toBe("too_fast");
    expect(intakeGuardRefusal(null)).toBe("too_fast");
    expect(intakeGuardRefusal("guard")).toBe("too_fast");
    expect(intakeGuardRefusal([])).toBe("too_fast");
  });
});

describe("intakeEmailHash", () => {
  it("hashes the normalized email to the stored key format", () => {
    const hash = intakeEmailHash("sender@example.invalid");
    expect(hash).toMatch(databasePattern);
    expect(hash).not.toContain("sender");
    expect(intakeEmailHash("  Sender@Example.INVALID ")).toBe(hash);
    expect(intakeEmailHash("other@example.invalid")).not.toBe(hash);
  });
});

describe("recordIntakeSubmission", () => {
  function client(result: { data: unknown; error: unknown }) {
    const rpc = vi.fn().mockResolvedValue(result);
    return { rpc, supabase: { rpc } as unknown as SupabaseClient };
  }

  it("sends the form and the email hash, never the email", async () => {
    const { rpc, supabase } = client({ data: true, error: null });
    await expect(recordIntakeSubmission(supabase, "contact", "sender@example.invalid")).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("intake_record_submission", {
      p_form: "contact",
      p_email_hash: intakeEmailHash("sender@example.invalid"),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("sender@");
  });

  it("reports a reached limit", async () => {
    const { supabase } = client({ data: false, error: null });
    await expect(
      recordIntakeSubmission(supabase, "vendor_application", "sender@example.invalid"),
    ).resolves.toBe(false);
  });

  it("throws a database error rather than accepting", async () => {
    const failure = new Error("synthetic failure");
    const { supabase } = client({ data: null, error: failure });
    await expect(recordIntakeSubmission(supabase, "contact", "sender@example.invalid")).rejects.toBe(failure);
  });
});
