import { createHash } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";

// Abuse protection for the public intake routes (TRACE-088; DEC-2026-012 item 1 as amended
// by DEC-2026-013): a honeypot field, a minimum fill time, and per-email and per-network
// limits recorded in the database (the network limit is TRACE-089; DEC-2026-014). Every refusal gets the same response, so a sender cannot tell which check
// refused it.

export type IntakeForm = "contact" | "vendor_application";

export const MIN_FILL_MS = 3_000;

export const INTAKE_REFUSAL_MESSAGE = "Please try again later.";

export type IntakeGuardRefusal = "trap" | "too_fast";

// The browser sends { trap, elapsedMs }: the honeypot's value and how long the form was open,
// measured by the browser's own clock so clock skew between browser and server does not
// matter. Anything missing or malformed is treated as too fast.
export function intakeGuardRefusal(value: unknown): IntakeGuardRefusal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "too_fast";
  }
  const guard = value as Record<string, unknown>;
  if (typeof guard.trap !== "string" || guard.trap.length > 0) return "trap";
  const elapsed = guard.elapsedMs;
  if (typeof elapsed !== "number" || !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) {
    return "too_fast";
  }
  return null;
}

export function intakeEmailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

// The client IP on Vercel. mercuriusmarketplace.com's DNS (GoDaddy) points straight at
// Vercel with no proxy in between, and Vercel sets x-real-ip to the connecting address,
// replacing any value the client sent (DEC-2026-014). Off Vercel the header is whatever the
// client sent, so it is ignored and only the per-email limit applies.
export function intakeClientIp(
  headers: Headers,
  onVercel = process.env.VERCEL === "1",
): string | null {
  if (!onVercel) return null;
  const value = headers.get("x-real-ip")?.trim() ?? "";
  return isIPv4(value) || isIPv6(value) ? value : null;
}

// The network a client is counted as: an IPv4 address, or the /64 prefix of an IPv6 address,
// because one IPv6 host usually holds a whole /64. An IPv4-mapped IPv6 address counts as its
// IPv4 address. Returns null for anything that is not an IP address.
export function intakeNetwork(ip: string): string | null {
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return null;
  let host: string;
  try {
    host = new URL(`http://[${ip}]`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const [head, tail] = host.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const groups = [
    ...headGroups,
    ...Array<string>(8 - headGroups.length - tailGroups.length).fill("0"),
    ...tailGroups,
  ].map((group) => Number.parseInt(group, 16));
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}

export function intakeNetworkHash(ip: string): string | null {
  const network = intakeNetwork(ip);
  return network ? createHash("sha256").update(network).digest("hex") : null;
}

export type IntakeLimitResult = "accepted" | "email_limit" | "ip_limit";

// Records the submission against the email and network limits and returns which limit
// refused it, if any. A null IP skips the network limit. Call it after validation and
// immediately before the insert.
export async function recordIntakeSubmission(
  supabase: SupabaseClient,
  form: IntakeForm,
  email: string,
  ip: string | null,
): Promise<IntakeLimitResult> {
  const { data, error } = await supabase.rpc("intake_record_submission", {
    p_form: form,
    p_email_hash: intakeEmailHash(email),
    p_ip_hash: ip === null ? null : intakeNetworkHash(ip),
  });
  if (error) throw error;
  if (data === "accepted" || data === "email_limit" || data === "ip_limit") return data;
  throw new Error("Unexpected intake limit result");
}
