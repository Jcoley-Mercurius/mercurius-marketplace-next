import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applicationQueueState, type ApplicationQueueState } from "@/lib/applicationQueueState";

// Phase 7.5G-1 (TRACE-159), Codex C-1: cross-layer parity from real database results. The fixture is
// the database's own output for SQL 133's persisted fixtures (scripts/derive-application-review-parity.mjs):
// each application's status as the applications page selects it, the vendor_onboarding_intake_status
// fields the page passes to applicationQueueState, and admin_application_review_queue(). SQL 133 P1
// asserts in CI that the database returns exactly this. Here the real applicationQueueState runs over
// those readbacks, and its "awaiting_review" set must be the server's set.
// C-2: the claim covers fully loaded readbacks of one database state only. The page's per-row
// "checking" and "unavailable" states are outside it (last test).

type Readback = { application_id: string; status: string; onboarding_status: string | null; review_started: boolean };
type Item = { application_id: string; since: string };

const fixture = JSON.parse(readFileSync("tests/fixtures/application-review-queue-parity.json", "utf8")) as {
  source: string; applications: Readback[]; items: Item[];
};
const sql = readFileSync("supabase/tests/133_applications_review_queue.sql", "utf8");

const pageState = (row: Readback): ApplicationQueueState =>
  applicationQueueState(row.status, { onboarding_status: row.onboarding_status, review_started: row.review_started }, false);

describe("applications awaiting review: server reader vs applicationQueueState (7.5G-1)", () => {
  it("the fixture is the database output SQL 133 asserts", () => {
    const match = sql.match(/\$parity\$([\s\S]*?)\$parity\$/);
    if (!match) throw new Error("SQL 133 has no $parity$ literal");
    expect(JSON.parse(match[1])).toEqual({ applications: fixture.applications, items: fixture.items });
    expect(sql).toMatch(/^-- BEGIN 7\.5G-1 FIXTURES/m);
    expect(sql).toMatch(/^-- END 7\.5G-1 FIXTURES$/m);
  });

  it("the server lists exactly the applications the page classifies as awaiting review", () => {
    const pageAwaiting = fixture.applications.filter((row) => pageState(row) === "awaiting_review").map((row) => row.application_id).sort();
    const server = fixture.items.map((item) => item.application_id).sort();
    expect(server).toEqual(pageAwaiting);
    expect(server.length).toBeGreaterThan(0);
    expect(server.length).toBeLessThan(fixture.applications.length);
  });

  it("every application the server leaves out has a non-awaiting page state", () => {
    const listed = new Set(fixture.items.map((item) => item.application_id));
    for (const row of fixture.applications.filter((r) => !listed.has(r.application_id))) {
      expect(pageState(row), row.application_id).not.toBe("awaiting_review");
    }
  });

  it("the fixture exercises every loaded state and the precedence edges", () => {
    const states = new Set(fixture.applications.map(pageState));
    for (const state of ["awaiting_review", "in_review", "active", "suspended", "rejected", "abandoned", "legacy_approved"] as const) {
      expect(states.has(state), state).toBe(true);
    }
    const byId = new Map(fixture.applications.map((row) => [row.application_id.slice(-2), row]));
    // Linked onboarding without a review start (C-3): review and even active stay awaiting; rejected wins.
    expect(byId.get("03")).toMatchObject({ onboarding_status: "review", review_started: false });
    expect(pageState(byId.get("03")!)).toBe("awaiting_review");
    expect(byId.get("16")).toMatchObject({ onboarding_status: "active", review_started: false });
    expect(pageState(byId.get("16")!)).toBe("awaiting_review");
    expect(pageState(byId.get("07")!)).toBe("rejected");
    // Abandoned outranks a started review; a started review outranks legacy approval.
    expect(pageState(byId.get("12")!)).toBe("abandoned");
    expect(pageState(byId.get("11")!)).toBe("in_review");
    expect(pageState(byId.get("10")!)).toBe("legacy_approved");
    // Null contractor and an unrecognized legacy status are awaiting on both layers.
    expect(byId.get("01")).toMatchObject({ onboarding_status: null, review_started: false });
    expect(byId.get("17")?.status).toBe("reviewing");
    for (const id of ["01", "17"]) expect(fixture.items.some((item) => item.application_id.endsWith(id)), id).toBe(true);
  });

  it("items are ordered by received time, then application id, with only {application_id, since}", () => {
    const sorted = [...fixture.items].sort((a, b) => Date.parse(a.since) - Date.parse(b.since) || a.application_id.localeCompare(b.application_id));
    expect(fixture.items).toEqual(sorted);
    const tie = fixture.items.filter((item) => item.since === "2026-10-14T09:00:00+00:00").map((item) => item.application_id);
    expect(tie).toEqual(["c75a2000-0000-4000-8000-000000000014", "c75a2000-0000-4000-8000-000000000015"]);
    for (const item of fixture.items) expect(Object.keys(item).sort()).toEqual(["application_id", "since"]);
    // a13 was revised twice after receipt; it keeps its received time (R-3).
    expect(fixture.items.find((item) => item.application_id.endsWith("13"))?.since).toBe("2026-09-20T09:00:00+00:00");
  });

  it("parity does not cover a page row that has not loaded or failed to load (C-2)", () => {
    for (const row of fixture.applications) {
      expect(applicationQueueState(row.status, undefined)).toMatch(/^(checking|abandoned|rejected)$/);
      expect(applicationQueueState(row.status, null, true)).toMatch(/^(unavailable|abandoned|rejected)$/);
    }
  });
});
