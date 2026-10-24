import { describe, expect, it } from "vitest";
import {
  actorLabel, appointmentState, deviceTimeNote, easternParts, formatAppointment, historyLine, localStartParam,
  recordedInHistory, resolveEasternTime, scheduleErrorMessage, type ScheduleEntry, type ScheduleReadback,
} from "@/lib/appointments";

// TRACE-121: Eastern entry is independent of the device timezone. Run under several TZ values
// (see the 6.5 report) to show the same instants come back.

const entry = (overrides: Partial<ScheduleEntry>): ScheduleEntry => ({
  id: "e1", kind: "appointment", outcome: "recorded", actor: "operations", at: "2026-10-24T15:00:00Z", reason: "Synthetic",
  previous_start: null, new_start: "2026-11-03T14:00:00Z", requested_start: null, operation_key: null, ...overrides,
});
const schedule = (overrides: Partial<ScheduleReadback>): ScheduleReadback => ({
  timezone: "America/New_York", status: "scheduled", matching_status: "matched", has_provider: true, recurring: false,
  appointment: null, open_request: null, history: [], ...overrides,
});

describe("Eastern wall-time entry", () => {
  it("reads standard and daylight time as Eastern", () => {
    const winter = resolveEasternTime("2026-11-03", "09:00");
    expect(winter).toMatchObject({ kind: "ok", label: "Tue, Nov 3, 2026, 9:00 AM EST" });
    expect(winter.kind === "ok" && winter.instant.toISOString()).toBe("2026-11-03T14:00:00.000Z");
    const summer = resolveEasternTime("2026-07-01", "09:00");
    expect(summer.kind === "ok" && summer.instant.toISOString()).toBe("2026-07-01T13:00:00.000Z");
  });

  it("refuses a spring-forward time that does not exist", () => {
    expect(resolveEasternTime("2027-03-14", "02:30")).toMatchObject({ kind: "nonexistent" });
    expect(resolveEasternTime("2027-03-14", "02:00").kind).toBe("nonexistent");
    const before = resolveEasternTime("2027-03-14", "01:59");
    expect(before.kind === "ok" && before.instant.toISOString()).toBe("2027-03-14T06:59:00.000Z");
    const after = resolveEasternTime("2027-03-14", "03:00");
    expect(after.kind === "ok" && after.instant.toISOString()).toBe("2027-03-14T07:00:00.000Z");
  });

  it("asks which fall-back reading is meant", () => {
    const twice = resolveEasternTime("2027-11-07", "01:30");
    expect(twice.kind).toBe("ambiguous");
    if (twice.kind !== "ambiguous") return;
    expect(twice.choices.map(choice => [choice.abbreviation, choice.instant.toISOString(), choice.label])).toEqual([
      ["EDT", "2027-11-07T05:30:00.000Z", "Sun, Nov 7, 2027, 1:30 AM EDT"],
      ["EST", "2027-11-07T06:30:00.000Z", "Sun, Nov 7, 2027, 1:30 AM EST"],
    ]);
    const after = resolveEasternTime("2027-11-07", "02:00");
    expect(after.kind === "ok" && after.instant.toISOString()).toBe("2027-11-07T07:00:00.000Z");
    expect(resolveEasternTime("2027-11-07", "00:59").kind).toBe("ok");
  });

  it("refuses incomplete and impossible dates", () => {
    expect(resolveEasternTime("", "").kind).toBe("empty");
    expect(resolveEasternTime("2026-11-03", "").kind).toBe("invalid");
    expect(resolveEasternTime("2026-02-30", "09:00").kind).toBe("invalid");
    expect(resolveEasternTime("2026-11-03", "24:00").kind).toBe("invalid");
  });

  it("round-trips Eastern parts and the server wall-time parameter", () => {
    expect(easternParts(new Date("2027-11-07T06:30:00Z"))).toEqual({ date: "2027-11-07", time: "01:30" });
    expect(localStartParam("2026-11-03", "09:00")).toBe("2026-11-03T09:00:00");
  });

  it("explains the device equivalent only when the device differs", () => {
    const instant = new Date("2026-11-03T14:00:00Z");
    expect(deviceTimeNote(instant, "America/Los_Angeles")).toContain("6:00 AM PST");
    expect(deviceTimeNote(instant, "Asia/Kolkata")).toContain("7:30 PM");
    expect(deviceTimeNote(instant, "America/New_York")).toBeNull();
    expect(deviceTimeNote(instant, "America/Detroit")).toBeNull();
  });
});

describe("appointment state", () => {
  it("separates acceptance without a time from a recorded appointment", () => {
    expect(appointmentState(schedule({})).kind).toBe("accepted_no_time");
    expect(appointmentState(schedule({})).heading).toBe("Provider accepted · appointment time not recorded yet");
    const recorded = appointmentState(schedule({ appointment: "2026-11-03T14:00:00Z", history: [entry({})] }));
    expect(recorded).toEqual({ kind: "recorded", heading: "Appointment recorded", detail: "Tue, Nov 3, 2026, 9:00 AM EST" });
  });

  it("keeps the appointment in place while a reschedule request is open", () => {
    const state = appointmentState(schedule({
      appointment: "2026-11-03T14:00:00Z",
      open_request: { id: "r1", actor: "homeowner", at: "2026-10-25T12:00:00Z", reason: "Away", requested_start: "2026-11-05T15:00:00Z" },
    }));
    expect(state.kind).toBe("reschedule_requested");
    expect(state.detail).toBe("The current appointment stays Tue, Nov 3, 2026, 9:00 AM EST until Mercurius changes it. Requested time: Thu, Nov 5, 2026, 10:00 AM EST.");
    const noTime = appointmentState(schedule({ open_request: { id: "r1", actor: "provider", at: "x", reason: "x", requested_start: "2026-11-05T15:00:00Z" } }));
    expect(noTime.detail).toContain("No appointment is recorded yet");
  });

  it("names a change with its previous value", () => {
    const state = appointmentState(schedule({
      appointment: "2026-11-04T19:30:00Z",
      history: [entry({}), entry({ id: "e2", outcome: "changed", previous_start: "2026-11-03T14:00:00Z", new_start: "2026-11-04T19:30:00Z" })],
    }));
    expect(state).toEqual({ kind: "changed", heading: "Appointment changed", detail: "Wed, Nov 4, 2026, 2:30 PM EST. Previously Tue, Nov 3, 2026, 9:00 AM EST." });
  });

  it("never treats an offer, a missing provider or a closed job as an appointment", () => {
    expect(appointmentState(schedule({ status: "matched", matching_status: "offered" })).kind).toBe("not_accepted");
    expect(appointmentState(schedule({ status: "pending", has_provider: false })).kind).toBe("not_accepted");
    expect(appointmentState(schedule({ status: "pending", has_provider: false, appointment: "2026-11-03T14:00:00Z" })).kind).toBe("provider_released");
    expect(appointmentState(schedule({ status: "cancelled", appointment: "2026-11-03T14:00:00Z" })).detail).toBe("This service is cancelled. It was scheduled for Tue, Nov 3, 2026, 9:00 AM EST.");
  });
});

describe("history and recovery", () => {
  it("describes each outcome with its values", () => {
    expect(historyLine(entry({}))).toBe("Appointment recorded: Tue, Nov 3, 2026, 9:00 AM EST");
    expect(historyLine(entry({ outcome: "changed", previous_start: "2026-11-03T14:00:00Z", new_start: "2026-11-04T19:30:00Z" })))
      .toBe("Appointment changed from Tue, Nov 3, 2026, 9:00 AM EST to Wed, Nov 4, 2026, 2:30 PM EST");
    expect(historyLine(entry({ outcome: "kept" }))).toBe("Appointment kept at Tue, Nov 3, 2026, 9:00 AM EST; reschedule request answered");
    expect(historyLine(entry({ kind: "reschedule_request", outcome: "requested", new_start: null, requested_start: "2026-11-05T15:00:00Z" })))
      .toBe("Different time requested: Thu, Nov 5, 2026, 10:00 AM EST");
  });

  it("labels actors for the viewer", () => {
    expect(actorLabel("operations", "homeowner")).toBe("Mercurius");
    expect(actorLabel("operations", "admin")).toBe("Operations");
    expect(actorLabel("homeowner", "homeowner")).toBe("You");
    expect(actorLabel("provider", "homeowner")).toBe("Provider");
    expect(actorLabel("provider", "vendor")).toBe("You");
    expect(actorLabel("previous_provider", "vendor")).toBe("Previous provider");
  });

  it("recognizes a lost response from the caller's own key", () => {
    const readback = schedule({ history: [entry({ operation_key: "k1" })] });
    expect(recordedInHistory(readback, "k1")).toBe(true);
    expect(recordedInHistory(readback, "k2")).toBe(false);
    expect(recordedInHistory(null, "k1")).toBe(false);
  });

  it("explains refusals without claiming success", () => {
    expect(scheduleErrorMessage({ code: "40001", message: "The appointment changed since you loaded it" })).toContain("Someone changed this appointment");
    expect(scheduleErrorMessage({ code: "42501", message: "Admin access required" })).toBe("You don’t have permission to make this change.");
    expect(scheduleErrorMessage({ message: "This appointment is already recorded" })).toContain("already the current appointment");
    expect(scheduleErrorMessage(new TypeError("Failed to fetch"))).toBe("We couldn’t confirm whether this was saved. The latest schedule is shown; check it before trying again.");
    expect(formatAppointment("not a date")).toBeNull();
  });
});
