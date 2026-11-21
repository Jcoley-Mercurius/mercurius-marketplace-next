// TRACE-155 (Phase 7.3D-2): the operator purge control's request, answer and wording. Synthetic
// values only; nothing here touches a database or the network. The database contract (clamp,
// expired-only, operator guard, run record) is SQL 121 and is unchanged by this slice.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import {
  PURGE_BATCH_MAX,
  PURGE_REMAINING_CAP,
  PURGE_UNREADABLE,
  classifyPurgeError,
  parsePurgeResult,
  purgeArgs,
  purgeDeletedLabel,
  purgeFailureMessage,
  purgeRemainingLabel,
  type PurgeResult,
} from "../../src/lib/emailEvidence/purge";

const answer = (extra: Partial<PurgeResult> = {}): PurgeResult => ({
  checked_at: "2026-11-21T15:00:00+00:00", limit: 1000, deleted: 37, remaining_expired: 0, remaining_over_cap: false,
  oldest_remaining_expires_at: null, ...extra,
});
const time = (value: string) => `<${value}>`;

describe("request", () => {
  it("asks for the largest batch the database accepts, and nothing else", () => {
    expect(PURGE_BATCH_MAX).toBe(1000);
    expect(purgeArgs()).toEqual({ p_limit: 1000 });
  });
});

describe("parsePurgeResult", () => {
  it("accepts the function's documented answer", () => {
    expect(parsePurgeResult(answer())).toEqual(answer());
    const over = answer({ deleted: 1000, remaining_expired: 10000, remaining_over_cap: true, oldest_remaining_expires_at: "2026-10-01T00:00:00+00:00" });
    expect(parsePurgeResult(over)).toEqual(over);
  });

  it("drops keys it does not know", () => {
    expect(parsePurgeResult({ ...answer(), svix_id: "x" })).toEqual(answer());
  });

  it("tolerates a count and an oldest expiry that a concurrent purge left out of step", () => {
    expect(parsePurgeResult(answer({ remaining_expired: 3, oldest_remaining_expires_at: null }))).not.toBeNull();
    expect(parsePurgeResult(answer({ remaining_expired: 0, oldest_remaining_expires_at: "2026-10-01T00:00:00+00:00" }))).not.toBeNull();
  });

  it.each([
    ["null", null],
    ["an array", [answer()]],
    ["a string", "37"],
    ["no checked_at", { ...answer(), checked_at: undefined }],
    ["an empty checked_at", answer({ checked_at: "" })],
    ["a limit of 0", answer({ limit: 0, deleted: 0 })],
    ["a limit over 1,000", answer({ limit: 1001 })],
    ["a deleted count over the limit", answer({ limit: 100, deleted: 101 })],
    ["a negative deleted count", answer({ deleted: -1 })],
    ["a fractional deleted count", answer({ deleted: 1.5 })],
    ["a deleted count as a string", { ...answer(), deleted: "37" }],
    ["a remaining count over the cap", answer({ remaining_expired: 10001 })],
    ["an over-cap flag with a smaller count", answer({ remaining_expired: 9999, remaining_over_cap: true, oldest_remaining_expires_at: "2026-10-01T00:00:00+00:00" })],
    ["an over-cap flag that is not a boolean", { ...answer(), remaining_over_cap: "false" }],
    ["an oldest expiry that is not a string", { ...answer(), oldest_remaining_expires_at: 0 }],
  ])("refuses %s", (_name, value) => {
    expect(parsePurgeResult(value)).toBeNull();
  });
});

describe("failures", () => {
  it("a coded refusal means the transaction rolled back: nothing was deleted", () => {
    const failure = classifyPurgeError({ code: "42501", message: "Operator access required", details: null, hint: null });
    expect(failure).toEqual({ kind: "refused", message: "Operator access required" });
    expect(purgeFailureMessage(failure)).toBe("The purge was refused: Operator access required. Nothing was deleted.");
  });

  it("an API-level refusal also carries a code", () => {
    expect(classifyPurgeError({ code: "PGRST202", message: "Could not find the function" }).kind).toBe("refused");
  });

  it.each([
    ["a transport failure (empty code)", { code: "", message: "TypeError: Failed to fetch" }],
    ["a gateway answer with no code", { message: "upstream timed out" }],
    ["a thrown value", new Error("socket hang up")],
    ["nothing at all", undefined],
  ])("%s is unknown: the run may have committed", (_name, error) => {
    const failure = classifyPurgeError(error);
    expect(failure.kind).toBe("unknown");
    const text = purgeFailureMessage(failure);
    expect(text).toMatch(/^The purge's result is unknown: .+\. Reports may have been deleted\. Refresh the counts before running it again\.$/);
    expect(text).not.toContain("Nothing was deleted");
  });

  it("an unreadable answer never claims a rollback", () => {
    expect(PURGE_UNREADABLE).toContain("Reports may have been deleted");
    expect(PURGE_UNREADABLE).not.toMatch(/nothing was deleted|rolled back/i);
  });

  it("does not double the final full stop", () => {
    expect(purgeFailureMessage({ kind: "refused", message: "Refused. " })).toBe("The purge was refused: Refused. Nothing was deleted.");
  });
});

describe("wording", () => {
  it("counts what was deleted, singular and plural", () => {
    expect(purgeDeletedLabel(answer({ deleted: 0 }))).toBe("0 expired reports deleted");
    expect(purgeDeletedLabel(answer({ deleted: 1 }))).toBe("1 expired report deleted");
    expect(purgeDeletedLabel(answer({ deleted: 1000 }))).toBe("1,000 expired reports deleted");
  });

  it("says when nothing expired remains", () => {
    expect(purgeRemainingLabel(answer(), time)).toBe("No expired reports remain.");
  });

  it("gives the exact backlog below the cap with its oldest expiry, and asks for another run", () => {
    expect(purgeRemainingLabel(answer({ deleted: 1000, remaining_expired: 250, oldest_remaining_expires_at: "2026-10-01T00:00:00Z" }), time))
      .toBe("250 expired reports remain, the oldest expired <2026-10-01T00:00:00Z>. Run it again to delete up to 1,000 more.");
    expect(purgeRemainingLabel(answer({ remaining_expired: 1, oldest_remaining_expires_at: "2026-10-01T00:00:00Z" }), time))
      .toBe("1 expired report remains, the oldest expired <2026-10-01T00:00:00Z>. Run it again to delete up to 1,000 more.");
  });

  it("says only 'more than 10,000' above the cap", () => {
    expect(PURGE_REMAINING_CAP).toBe(10000);
    expect(purgeRemainingLabel(answer({ deleted: 1000, remaining_expired: 10000, remaining_over_cap: true, oldest_remaining_expires_at: "2026-09-01T00:00:00Z" }), time))
      .toBe("More than 10,000 expired reports remain, the oldest expired <2026-09-01T00:00:00Z>. Each run deletes up to 1,000; run it again to delete more.");
  });

  it("leaves out an oldest expiry the answer did not give", () => {
    expect(purgeRemainingLabel(answer({ remaining_expired: 3 }), time)).toBe("3 expired reports remain. Run it again to delete up to 1,000 more.");
  });
});

describe("call sites (no repetition, no scheduling)", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  walk("src");

  it("only the Email evidence page calls the purge, from one place", () => {
    const callers = files.filter((file) => /email_provider_events_purge/.test(readFileSync(file, "utf8")));
    expect(callers.map((file) => relative("src", file)).sort()).toEqual(["app/admin/email-evidence/page.tsx", "lib/emailEvidence/purge.ts"]);
    const page = readFileSync("src/app/admin/email-evidence/page.tsx", "utf8");
    expect(page.match(/rpc\("email_provider_events_purge"/g)).toHaveLength(1);
    // The helper only names the function in its comment; it never calls it.
    expect(readFileSync("src/lib/emailEvidence/purge.ts", "utf8")).not.toMatch(/\.rpc\(|fetch\(/);
  });

  it("the page has no timer, loop or retry around the purge", () => {
    const page = readFileSync("src/app/admin/email-evidence/page.tsx", "utf8");
    const body = page.slice(page.indexOf("const runPurge"), page.indexOf("const history"));
    expect(body).toContain('rpc("email_provider_events_purge", purgeArgs())');
    expect(body).not.toMatch(/setInterval|setTimeout|while\s*\(|for\s*\(|runPurge\(/);
    expect(page).not.toMatch(/setInterval/);
  });

  it("no scheduler is configured", () => {
    expect(JSON.parse(readFileSync("vercel.json", "utf8"))).not.toHaveProperty("crons");
  });
});
