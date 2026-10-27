import { describe, expect, it } from "vitest";
import {
  anchorLine, cadenceDate, cadenceErrorMessage, cadenceIndex, dstNote, emptyProposalMessage, formatCadenceDate, lifecycleConsequence,
  planStateLabel, replacementCandidates, resolutionLine, type CadencePreview, type CadenceProposal, type CadenceResolution,
} from "@/lib/recurringCadence";
import { blockMessage, historyLine } from "@/lib/recurringVisits";

// TRACE-124: cadence dates mirror the server (SQL 096 is the authority); the empty states, DST
// notes and lifecycle confirmations say what the owner decision says (DEC-2026-049 items 1–4).

const dates = (anchor: string, frequency: string, count: number) =>
  Array.from({ length: count }, (_, n) => cadenceDate(anchor, frequency, n));
const proposal = (overrides: Partial<CadenceProposal>): CadenceProposal => ({
  cadence_date: "2031-04-15", index: 1, local_start: "2031-04-15T09:00:00", kind: "ok", choices: [], starts_at: "2031-04-15T13:00:00Z",
  opens_on: "2031-02-14", ...overrides,
});
const preview = (overrides: Partial<CadencePreview>): CadencePreview => ({
  as_of: "2031-01-20T14:00:00Z", today: "2031-01-20", horizon_end: "2031-03-21", state: "active", unavailable: null, anchor_id: "a1",
  upcoming: 0, capacity: 2, proposals: [], next: null, ...overrides,
});

describe("cadence dates", () => {
  it("adds calendar days for weekly and every two weeks", () => {
    expect(dates("2031-01-07", "weekly", 3)).toEqual(["2031-01-07", "2031-01-14", "2031-01-21"]);
    expect(dates("2031-12-23", "bi-monthly", 3)).toEqual(["2031-12-23", "2032-01-06", "2032-01-20"]);
  });
  it("counts months from the anchor, clamping month ends without drifting", () => {
    expect(dates("2031-01-31", "monthly", 5)).toEqual(["2031-01-31", "2031-02-28", "2031-03-31", "2031-04-30", "2031-05-31"]);
    expect(dates("2032-01-31", "monthly", 3)).toEqual(["2032-01-31", "2032-02-29", "2032-03-31"]);
    expect(dates("2030-12-31", "every-two-months", 4)).toEqual(["2030-12-31", "2031-02-28", "2031-04-30", "2031-06-30"]);
    expect(dates("2028-02-29", "quarterly", 5)).toEqual(["2028-02-29", "2028-05-29", "2028-08-29", "2028-11-29", "2029-02-28"]);
  });
  it("keeps a day of the month, weekends included", () => {
    expect(dates("2031-01-01", "monthly", 3)).toEqual(["2031-01-01", "2031-02-01", "2031-03-01"]);
    expect(formatCadenceDate("2031-02-01")).toBe("Sat, Feb 1, 2031");
  });
  it("recognises cadence dates and nothing else", () => {
    expect(cadenceIndex("2031-01-31", "monthly", "2031-02-28")).toBe(1);
    expect(cadenceIndex("2031-01-31", "monthly", "2031-03-31")).toBe(2);
    expect(cadenceIndex("2028-02-29", "quarterly", "2029-02-28")).toBe(4);
    expect(cadenceIndex("2031-01-31", "monthly", "2031-03-28")).toBeNull();
    expect(cadenceIndex("2031-01-07", "bi-monthly", "2031-01-14")).toBeNull();
    expect(cadenceIndex("2031-01-07", "weekly", "2031-01-06")).toBeNull();
    expect(cadenceDate("2031-01-07", "one-time", 1)).toBeNull();
  });
  it("offers the open cadence dates either side of an off-cadence visit", () => {
    expect(replacementCandidates("2031-01-07", "weekly", "2031-01-16", new Set())).toEqual(["2031-01-14", "2031-01-21"]);
    expect(replacementCandidates("2031-01-07", "weekly", "2031-01-16", new Set(["2031-01-14"]))).toEqual(["2031-01-07", "2031-01-21"]);
    expect(replacementCandidates("2031-01-07", "weekly", "2031-01-05", new Set())).toEqual(["2031-01-07"]);
  });
});

describe("what operations reads", () => {
  it("explains an empty proposal list, including quarterly plans outside the horizon", () => {
    expect(emptyProposalMessage(preview({ next: proposal({}) })))
      .toBe("No cadence date falls in the next 60 days that is at least 24 hours away. Next cadence date: Tue, Apr 15, 2031; it can be proposed from Fri, Feb 14, 2031.");
    expect(emptyProposalMessage(preview({ capacity: 0, upcoming: 2, next: proposal({ opens_on: "2031-01-20" }) })))
      .toBe("This plan already has 2 upcoming visits, so nothing more is proposed. Next cadence date: Tue, Apr 15, 2031.");
    expect(emptyProposalMessage(preview({ unavailable: "paused" }))).toMatch(/paused/);
    expect(emptyProposalMessage(preview({ unavailable: "no_anchor" }))).toMatch(/Record the agreed first visit time/);
  });
  it("asks for an explicit choice on daylight-saving dates and never moves the plan", () => {
    expect(dstNote(proposal({ kind: "nonexistent" }))).toMatch(/Choose a time on this date; the plan’s time stays the same/);
    expect(dstNote(proposal({ kind: "ambiguous" }))).toMatch(/Choose EDT or EST/);
    expect(dstNote(proposal({}))).toBeNull();
  });
  it("says stopping future visits leaves existing visits and offers in place", () => {
    expect(lifecycleConsequence("stop")).toMatch(/final/);
    expect(lifecycleConsequence("stop")).toMatch(/Existing visits and open offers remain in place and each needs to be handled individually/);
    expect(lifecycleConsequence("pause")).toMatch(/manually or from proposals/);
    expect(lifecycleConsequence("resume")).toMatch(/aren’t made up/);
    expect(planStateLabel("ended")).toBe("Future visits stopped");
  });
  it("labels the anchor, decisions under earlier anchors and the new refusals", () => {
    expect(anchorLine("Weekly", null)).toBe("No cadence anchor recorded yet");
    expect(anchorLine("Weekly", { starts_at: "2031-01-07T14:00:00Z" })).toMatch(/^Weekly, counted from Tue, Jan 7, 2031, 9:00 AM EST/);
    const resolution: CadenceResolution = { id: "r", at: "2031-01-01T00:00:00Z", anchor_id: "a0", current_anchor: false, cadence_date: "2031-01-14",
      kind: "skipped", occurrence_id: null, reason: "Away", actor: "operations", operation_key: null };
    expect(resolutionLine(resolution)).toBe("Cadence date skipped: Tue, Jan 14, 2031 (under an earlier anchor)");
    expect(blockMessage("series_paused")).toMatch(/paused/);
    expect(blockMessage("series_ended")).toMatch(/stopped/);
    expect(historyLine({ id: "g", at: "2031-01-01T00:00:00Z", outcome: "created", code: null, starts_at: "2031-01-07T14:00:00Z", local_start: "2031-01-07T09:00:00",
      occurrence_id: "v", actor: "operations", reason: "r", operation_key: null, source: "cadence" })).toMatch(/^Proposed visit added/);
  });
  it("maps server refusals to plain messages", () => {
    expect(cadenceErrorMessage({ code: "40001", message: "The cadence changed since you loaded it" })).toMatch(/cadence changed/);
    expect(cadenceErrorMessage({ code: "40001", message: "This proposed visit is no longer current" })).toMatch(/no longer current/);
    expect(cadenceErrorMessage({ code: "40001", message: "The plan changed since you loaded it" })).toMatch(/plan changed/);
    expect(cadenceErrorMessage({ code: "22023", message: "This visit already replaces a cadence date" })).toMatch(/already replaces/);
    expect(cadenceErrorMessage({ code: "42501", message: "Admin access required" })).toMatch(/permission/);
    expect(cadenceErrorMessage(new Error("Failed to fetch"))).toMatch(/couldn’t confirm/);
  });
});
