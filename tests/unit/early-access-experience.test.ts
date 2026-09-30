import { describe, expect, it } from "vitest";
import {
  admittedFor,
  bookingState,
  describeCells,
  earlyAccessHref,
  earlyAccessServicesFromQuery,
  isExistingAccountSignUpError,
  joinOutcome,
  parseMyInterest,
  parseTrialAccess,
  type TrialAccess,
} from "../../src/lib/earlyAccessExperience";

// TRACE-103: the account and form states derive only from authoritative readbacks,
// and anything unexpected is closed rather than open.
const cell = (state: string, service_id = "lawn-mowing", zip_code = "33904", service_name = "Lawn Mowing") =>
  ({ zip_code, service_id, service_name, state, changed_at: "2026-09-29T12:00:00Z" });

describe("early-access links", () => {
  it("carries valid, distinct catalog services and drops anything else", () => {
    expect(earlyAccessHref()).toBe("/early-access");
    expect(earlyAccessHref(["lawn-mowing", "lawn-mowing", null, "Bad ID", "pool-cleaning"]))
      .toBe("/early-access?service=lawn-mowing&service=pool-cleaning");
    expect(earlyAccessHref(["x".repeat(65)])).toBe("/early-access");
  });
  it("reads repeated or comma-separated services from the query", () => {
    expect(earlyAccessServicesFromQuery(["lawn-mowing", "pool-cleaning,ac-maintenance"]))
      .toEqual(["lawn-mowing", "pool-cleaning", "ac-maintenance"]);
    expect(earlyAccessServicesFromQuery("../admin,<b>")).toEqual([]);
    expect(earlyAccessServicesFromQuery(undefined)).toEqual([]);
  });
});

describe("trial access readback", () => {
  it("fails closed on anything malformed", () => {
    for (const bad of [null, [], {}, { homeowner: true }, { homeowner: "yes", cells: [] },
      { homeowner: true, cells: [cell("open")] }, { homeowner: true, cells: [{ ...cell("active"), zip_code: 33904 }] }]) {
      expect(() => parseTrialAccess(bad)).toThrow();
    }
  });
  it("derives invited, unavailable, revoked and waiting in that precedence", () => {
    const access = (homeowner: boolean, ...states: string[]) => parseTrialAccess({ homeowner, cells: states.map((s, i) => cell(s, `s-${i}`)) });
    expect(bookingState(access(true))).toBe("waiting");
    expect(bookingState(access(true, "revoked", "active"))).toBe("invited");
    expect(bookingState(access(true, "revoked", "unavailable"))).toBe("unavailable");
    expect(bookingState(access(true, "revoked"))).toBe("revoked");
    // An active cell without the homeowner role never opens booking.
    expect(bookingState(access(false, "active"))).toBe("waiting");
  });
  it("matches a checkout cell by five-digit ZIP and service only when active", () => {
    const access: TrialAccess = parseTrialAccess({ homeowner: true, cells: [cell("active"), cell("revoked", "pool-cleaning")] });
    expect(admittedFor(access, "33904-1234", "lawn-mowing")).toBe(true);
    expect(admittedFor(access, "33904", "pool-cleaning")).toBe(false);
    expect(admittedFor(access, "33990", "lawn-mowing")).toBe(false);
    expect(admittedFor(access, null, "lawn-mowing")).toBe(false);
  });
  it("describes invited scope by service and ZIP", () => {
    const access = parseTrialAccess({ homeowner: true, cells: [
      cell("active"), cell("active", "ac", "33904", "AC Maintenance"), cell("active", "ac", "33990", "AC Maintenance"),
    ] });
    expect(describeCells(access.cells)).toBe("Lawn Mowing in 33904; AC Maintenance in 33904 and 33990");
  });
});

describe("account interest readback", () => {
  it("separates unverified, early-access, expansion and marketing", () => {
    expect(parseMyInterest({ verified: false })).toEqual({ verified: false });
    const parsed = parseMyInterest({ verified: true, marketing_opted_in: true, interests: [
      { kind: "expansion", status: "active", first_name: null, zip_code: "10001", service_ids: [], still_exploring: true, linked: true },
      { kind: "early_access", status: "withdrawn", first_name: "Sam", zip_code: "33904", service_ids: ["lawn-mowing"], still_exploring: false, linked: true },
    ] });
    expect(parsed).toMatchObject({ verified: true, marketingOptedIn: true,
      earlyAccess: { status: "withdrawn", firstName: "Sam", serviceIds: ["lawn-mowing"] },
      expansion: { zipCode: "10001", stillExploring: true } });
    expect(parseMyInterest({ verified: true, marketing_opted_in: false, interests: [] }))
      .toEqual({ verified: true, earlyAccess: null, expansion: null, marketingOptedIn: false });
  });
  it("rejects malformed rows", () => {
    expect(() => parseMyInterest({ verified: true, interests: [], marketing_opted_in: "no" })).toThrow();
    expect(() => parseMyInterest({ verified: true, marketing_opted_in: false, interests: [{ kind: "early_access", status: "deidentified" }] })).toThrow();
  });
});

describe("join outcome", () => {
  it("shows success only for a confirmed save", () => {
    expect(joinOutcome(201, { outcome: "saved", kind: "early_access" })).toEqual({ kind: "saved", interestKind: "early_access" });
    expect(joinOutcome(200, { outcome: "saved", kind: "early_access" })).toEqual({ kind: "not_saved" });
    expect(joinOutcome(201, { outcome: "saved" })).toEqual({ kind: "not_saved" });
    expect(joinOutcome(500, { error: "x" })).toEqual({ kind: "not_saved" });
    expect(joinOutcome(502, null)).toEqual({ kind: "not_saved" });
  });
  it("maps boundary, validation and refusal", () => {
    expect(joinOutcome(409, { outcome: "boundary", kind: "early_access", error: "…" })).toEqual({ kind: "boundary", interestKind: "early_access" });
    expect(joinOutcome(400, { error: "Enter a five-digit ZIP code." })).toEqual({ kind: "invalid", message: "Enter a five-digit ZIP code." });
    expect(joinOutcome(400, {})).toEqual({ kind: "invalid", message: "Check the form and try again." });
    expect(joinOutcome(429, { error: "Please try again later." })).toEqual({ kind: "refused" });
  });
});

describe("neutral account step", () => {
  it("recognizes existing-account sign-up errors so they get the neutral response", () => {
    expect(isExistingAccountSignUpError({ code: "user_already_exists" })).toBe(true);
    expect(isExistingAccountSignUpError({ code: "email_exists" })).toBe(true);
    expect(isExistingAccountSignUpError({ message: "User already registered" })).toBe(true);
    expect(isExistingAccountSignUpError({ code: "weak_password", message: "Password should be at least 8 characters" })).toBe(false);
    expect(isExistingAccountSignUpError(null)).toBe(false);
  });
});
