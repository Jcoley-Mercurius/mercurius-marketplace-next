import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_REQUEST_SELECT, SUMMARY_QUEUES, adminActionError, completedJobsText, createKeyStore, isCorrectableRequest, parseOperationsSummary,
  parseRequestsQuery, requestsQueryString, reviewSummaryText, STALE_REQUEST_MESSAGE,
} from "./adminOperations";
import { navigationGroups } from "@/components/admin/AdminSidebar";

describe("request keys", () => {
  it("reuses a key for the same intent and issues a new one for a different intent", () => {
    const keyFor = createKeyStore();
    expect(keyFor("status:a:v1:matched")).toBe(keyFor("status:a:v1:matched"));
    expect(keyFor("status:a:v1:matched")).not.toBe(keyFor("status:a:v2:matched"));
  });
});

describe("refusal wording", () => {
  it("words a stale refusal and keeps other server messages", () => {
    expect(adminActionError({ code: "40001", message: "raw" })).toBe(STALE_REQUEST_MESSAGE);
    expect(adminActionError({ code: "42501", message: "raw" })).toBe("You don't have access to this action.");
    expect(adminActionError({ code: "55000", message: "This request can't be corrected here because a quote exists; use a change request instead" }))
      .toMatch(/change request/);
    expect(adminActionError(null)).toBe("");
  });
});

describe("operations summary", () => {
  it("keeps restricted and error states instead of inventing counts", () => {
    const parsed = parseOperationsSummary({ checked_at: "2026-11-02T15:00:00Z", queues: [
      { queue: "quote", state: "ready", count: 3, aged: 1 },
      { queue: "finance_exceptions", state: "restricted", count: null, aged: null },
      { queue: "support", state: "surprise", count: "7", aged: null },
      { queue: "fulfillment", state: "error", count: null, aged: null },
      { nope: true },
    ] });
    expect(parsed.checkedAt).toBe("2026-11-02T15:00:00Z");
    expect(parsed.queues).toEqual([
      { queue: "quote", state: "ready", count: 3, aged: 1 },
      { queue: "finance_exceptions", state: "restricted", count: null, aged: null },
      { queue: "support", state: "error", count: null, aged: null },
      { queue: "fulfillment", state: "error", count: null, aged: null },
    ]);
  });
  it("links every summarized queue to an admin route", () => {
    for (const entry of Object.values(SUMMARY_QUEUES)) expect(entry.href.startsWith("/admin")).toBe(true);
  });
});

// Phase 7.5B (TRACE-159): the browser fixture is the database's own summary. SQL 127 asserts the
// actual output of admin_operations_summary() on its synthetic fixtures equals two exact literals;
// these tests hold the committed fixture equal to those literals, and SUMMARY_QUEUES equal to the
// queues in them, in both directions.
describe("operations summary against the database (7.5B)", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  type Row = { queue: string; state: string; count: number | null; aged: number | null };
  const fixture = JSON.parse(read("tests/fixtures/admin-operations-summary.json")) as Record<"admin" | "finance", { checked_at: string; queues: Row[] }>;
  const sql = read("supabase/tests/127_operations_summary_truth.sql");
  const literal = (tag: string) => {
    const match = sql.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`));
    if (!match) throw new Error(`SQL 127 has no $${tag}$ literal`);
    return JSON.parse(match[1]) as { queues: Row[] };
  };

  it("the browser fixture equals SQL 127's asserted output, with checked_at normalized", () => {
    expect(fixture.admin.queues).toEqual(literal("admin_summary").queues);
    expect(fixture.finance.queues).toEqual(literal("finance_summary").queues);
    for (const caller of ["admin", "finance"] as const) expect(fixture[caller].checked_at).toBe("2026-11-23T14:00:00+00:00");
    expect(sql).toMatch(/^-- BEGIN 7\.5B FIXTURES/m);
    expect(sql).toMatch(/^-- END 7\.5B FIXTURES$/m);
  });

  it("every queue the database summarizes has a client entry", () => {
    for (const caller of ["admin", "finance"] as const) {
      const missing = fixture[caller].queues.map((row) => row.queue).filter((queue) => !(queue in SUMMARY_QUEUES));
      expect(missing, `queues without a SUMMARY_QUEUES entry (${caller})`).toEqual([]);
    }
  });

  it("every client entry is a queue the database summarizes", () => {
    for (const caller of ["admin", "finance"] as const) {
      const queues = new Set(fixture[caller].queues.map((row) => row.queue));
      expect(Object.keys(SUMMARY_QUEUES).filter((queue) => !queues.has(queue)), `SUMMARY_QUEUES keys the database does not return (${caller})`).toEqual([]);
    }
    expect(fixture.admin.queues.map((row) => row.queue)).toEqual(fixture.finance.queues.map((row) => row.queue));
  });

  it("an aged label exactly where the database reports an aged count", () => {
    // The finance holder's read has every row ready, so a null aged there means no aging rule.
    for (const row of fixture.finance.queues) {
      expect(row.state, row.queue).toBe("ready");
      expect(Boolean(SUMMARY_QUEUES[row.queue].agedLabel), `${row.queue} agedLabel`).toBe(typeof row.aged === "number");
    }
    expect(SUMMARY_QUEUES.fulfillment.agedLabel).toBeUndefined();
    expect(SUMMARY_QUEUES.offer_terms).toEqual({ label: "Offers at other terms", href: "/admin/requests#offer-terms-queue" });
  });

  it("parses the database's rows without changing them", () => {
    for (const caller of ["admin", "finance"] as const) {
      expect(parseOperationsSummary(fixture[caller])).toEqual({ checkedAt: fixture[caller].checked_at, queues: fixture[caller].queues });
    }
  });

  it("every queue link with an anchor points at an element id that exists", () => {
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name.endsWith(".tsx")) sources.push(readFileSync(path, "utf8"));
      }
    };
    walk(join(process.cwd(), "src"));
    const anchors = Object.values(SUMMARY_QUEUES).map((entry) => entry.href.split("#")[1]).filter(Boolean);
    expect(anchors).toContain("offer-terms-queue");
    expect(anchors.filter((anchor) => !sources.some((source) => source.includes(`id="${anchor}"`)))).toEqual([]);
  });
});

describe("mixed-version deployment (brief §12.5)", () => {
  const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
  it("the admin requests select never names notes, and SQL 108 runs this exact select", () => {
    const columns = ADMIN_REQUEST_SELECT.split(",").map((column) => column.trim());
    expect(columns).not.toContain("notes");
    expect(read("supabase/tests/108_admin_operations.sql")).toContain(`select ${ADMIN_REQUEST_SELECT} from public.service_requests where`);
  });
  it("no admin client selects or writes the legacy notes column", () => {
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts") && !path.endsWith("database.types.ts")) sources.push(path);
      }
    };
    walk(join(process.cwd(), "src"));
    const offenders = sources.filter((path) => /from\("service_requests"\)[^;]*(select\("[^"]*\bnotes\b|update\(\{[^}]*\bnotes\s*:)/.test(readFileSync(path, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("the review forward fix does not re-open the notes read", () => {
    const fix = read("supabase/migrations/20261109001000_phase6_admin_operations_review_fixes.sql");
    expect(fix).not.toMatch(/grant[^;]*select[^;]*on public\.service_requests/i);
  });
});

describe("request URL state", () => {
  const statuses = ["pending", "matched"];
  it("round-trips filters and the open record and drops unknown values", () => {
    const id = "c6132000-0000-4000-8000-000000000001";
    const state = parseRequestsQuery(new URLSearchParams(`q=lawn&status=matched&request=${id}`), statuses);
    expect(state).toEqual({ q: "lawn", status: "matched", request: id });
    expect(requestsQueryString(state)).toBe(`?q=lawn&status=matched&request=${id}`);
    expect(parseRequestsQuery(new URLSearchParams("status=hacked&request=../x"), statuses)).toEqual({ q: "", status: "all", request: null });
    expect(requestsQueryString({ q: " ", status: "all", request: null })).toBe("");
  });
});

describe("correction eligibility", () => {
  const base = { status: "pending", contractor_id: null, matching_status: "awaiting_match", current_quote_id: null, quote_status: null, total_amount: null, quote_amount: null, payment_status: "pending" };
  it("offers a correction only before any offer, quote, price or payment", () => {
    expect(isCorrectableRequest(base)).toBe(true);
    expect(isCorrectableRequest({ ...base, matching_status: "offered" })).toBe(false);
    expect(isCorrectableRequest({ ...base, contractor_id: "x" })).toBe(false);
    expect(isCorrectableRequest({ ...base, quote_status: "submitted" })).toBe(false);
    expect(isCorrectableRequest({ ...base, total_amount: 120 })).toBe(false);
    expect(isCorrectableRequest({ ...base, payment_status: "captured" })).toBe(false);
    expect(isCorrectableRequest({ ...base, status: "matched" })).toBe(false);
  });
});

describe("verified provider statistics", () => {
  it("never falls back to a stored value", () => {
    expect(reviewSummaryText(undefined)).toBe("Reviews unavailable");
    expect(reviewSummaryText({ reviewCount: 0, averageRating: null, completedJobs: 0 })).toBe("No reviews yet");
    expect(reviewSummaryText({ reviewCount: 3, averageRating: 4.333, completedJobs: 5 })).toBe("4.3 from 3 reviews");
    expect(completedJobsText({ reviewCount: null, averageRating: null, completedJobs: null })).toBe("Completed jobs unavailable");
    expect(completedJobsText({ reviewCount: 0, averageRating: null, completedJobs: 1 })).toBe("1 completed job");
  });
});

describe("admin navigation", () => {
  it("lists every admin page exactly once, grouped, with no Smart Picks entry", () => {
    const root = join(process.cwd(), "src", "app", "admin");
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (name === "page.tsx") routes.push(`/admin/${relative(root, dir).split(sep).join("/")}`.replace(/\/$/, ""));
      }
    };
    walk(root);
    const hrefs = navigationGroups.flatMap((group) => group.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    const listed = routes.filter((route) => route !== "/admin" && !route.includes("[") && route !== "/admin/smart-picks");
    expect([...listed].sort()).toEqual([...hrefs].sort());
    expect(hrefs).not.toContain("/admin/smart-picks");
    expect(navigationGroups.map((group) => group.label)).toEqual(["Marketplace Operations", "Catalog & Supply", "Money", "Trust & Support", "Merchandising & Insights"]);
  });
});
