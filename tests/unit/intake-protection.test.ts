import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MIN_FILL_MS,
  intakeClientIp,
  intakeEmailHash,
  intakeGuardRefusal,
  intakeNetwork,
  intakeNetworkHash,
  recordIntakeSubmission,
} from "../../src/lib/intakeProtection";

// TRACE-088 and TRACE-089. The database pattern the stored key must match (see migration
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

describe("intakeClientIp", () => {
  const headers = (value?: string) => new Headers(value === undefined ? {} : { "x-real-ip": value });

  it("reads Vercel's x-real-ip on Vercel", () => {
    expect(intakeClientIp(headers("203.0.113.7"), true)).toBe("203.0.113.7");
    expect(intakeClientIp(headers(" 2001:db8::1 "), true)).toBe("2001:db8::1");
  });

  it("ignores the header off Vercel, where the client controls it", () => {
    expect(intakeClientIp(headers("203.0.113.7"), false)).toBeNull();
  });

  it("returns null for a missing or malformed header", () => {
    expect(intakeClientIp(headers(), true)).toBeNull();
    expect(intakeClientIp(headers(""), true)).toBeNull();
    expect(intakeClientIp(headers("203.0.113.7, 198.51.100.2"), true)).toBeNull();
    expect(intakeClientIp(headers("unknown"), true)).toBeNull();
  });
});

describe("intakeNetwork", () => {
  it("counts an IPv4 client by its address", () => {
    expect(intakeNetwork("203.0.113.7")).toBe("203.0.113.7");
  });

  it("counts an IPv6 client by its /64 prefix", () => {
    expect(intakeNetwork("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
    expect(intakeNetwork("2001:DB8:1:2:ffff::9")).toBe("2001:db8:1:2::/64");
    expect(intakeNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(intakeNetwork("::1")).toBe("0:0:0:0::/64");
  });

  it("counts an IPv4-mapped IPv6 client as its IPv4 address", () => {
    expect(intakeNetwork("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(intakeNetwork("::ffff:cb00:7107")).toBe("203.0.113.7");
  });

  it("rejects anything that is not an IP address", () => {
    expect(intakeNetwork("")).toBeNull();
    expect(intakeNetwork("example.invalid")).toBeNull();
    expect(intakeNetwork("999.0.0.1")).toBeNull();
  });
});

describe("intakeNetworkHash", () => {
  it("hashes the network to the stored key format", () => {
    const hash = intakeNetworkHash("2001:db8:1:2:3:4:5:6");
    expect(hash).toMatch(databasePattern);
    expect(intakeNetworkHash("2001:db8:1:2:aaaa::1")).toBe(hash);
    expect(intakeNetworkHash("2001:db8:1:3::1")).not.toBe(hash);
    expect(intakeNetworkHash("not an address")).toBeNull();
  });
});

describe("recordIntakeSubmission", () => {
  function client(result: { data: unknown; error: unknown }) {
    const rpc = vi.fn().mockResolvedValue(result);
    return { rpc, supabase: { rpc } as unknown as SupabaseClient };
  }

  it("sends the form and the email and network hashes, never the email or address", async () => {
    const { rpc, supabase } = client({ data: "accepted", error: null });
    await expect(
      recordIntakeSubmission(supabase, "contact", "sender@example.invalid", "203.0.113.7"),
    ).resolves.toBe("accepted");
    expect(rpc).toHaveBeenCalledWith("intake_record_submission", {
      p_form: "contact",
      p_email_hash: intakeEmailHash("sender@example.invalid"),
      p_ip_hash: intakeNetworkHash("203.0.113.7"),
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("sender@");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("203.0.113");
  });

  it("sends a null network when the client IP is unknown", async () => {
    const { rpc, supabase } = client({ data: "accepted", error: null });
    await recordIntakeSubmission(supabase, "contact", "sender@example.invalid", null);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_ip_hash: null });
  });

  it("reports which limit refused", async () => {
    for (const limit of ["email_limit", "ip_limit"] as const) {
      const { supabase } = client({ data: limit, error: null });
      await expect(
        recordIntakeSubmission(supabase, "vendor_application", "sender@example.invalid", null),
      ).resolves.toBe(limit);
    }
  });

  it("throws on an unexpected result rather than accepting", async () => {
    for (const data of [true, false, null, "ok"]) {
      const { supabase } = client({ data, error: null });
      await expect(
        recordIntakeSubmission(supabase, "contact", "sender@example.invalid", null),
      ).rejects.toThrow("Unexpected intake limit result");
    }
  });

  it("throws a database error rather than accepting", async () => {
    const failure = new Error("synthetic failure");
    const { supabase } = client({ data: null, error: failure });
    await expect(
      recordIntakeSubmission(supabase, "contact", "sender@example.invalid", null),
    ).rejects.toBe(failure);
  });
});
