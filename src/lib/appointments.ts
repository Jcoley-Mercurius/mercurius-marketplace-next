import { formatAppointment, offerTimeZone } from "@/lib/offerStatus";
import type { OpenRescheduleRequest, ReplacementState } from "@/lib/exceptionResolutions";

export { formatAppointment };

// TRACE-121 (Phase 6.5): one-time appointments. Provider acceptance schedules the job with or
// without a time (DEC-2026-007); operations records, changes or keeps the appointment with a
// reason; homeowner and provider may request a different time, which never replaces the
// appointment by itself. Every time is entered and shown in America/New_York, whatever the
// device's timezone. The server re-checks the Eastern wall time, stale reads and retries.

export const appointmentTimeZone = offerTimeZone;

export type ScheduleActor = "homeowner" | "provider" | "previous_provider" | "operations";
export type ScheduleEntry = {
  id: string;
  // TRACE-132: the homeowner's answer to a provider's time, and replacement proposals and answers.
  kind: "appointment" | "reschedule_request" | "reschedule_response" | "replacement_proposal" | "replacement_response";
  outcome: "recorded" | "changed" | "kept" | "requested" | "accepted" | "declined" | "proposed";
  actor: ScheduleActor;
  at: string;
  reason: string;
  previous_start: string | null;
  new_start: string | null;
  requested_start: string | null;
  operation_key: string | null;
  initiator?: "homeowner" | "provider" | null;
  fee?: number | null;
  fee_waived_later?: boolean;
  provider_name?: string | null;
};
export type ScheduleReadback = {
  timezone: string;
  status: string;
  matching_status: string | null;
  has_provider: boolean;
  recurring: boolean;
  appointment: string | null;
  open_request: (OpenRescheduleRequest & { actor: ScheduleActor }) | null;
  history: ScheduleEntry[];
  replacement?: ReplacementState | null;
};
export type ScheduleViewer = "admin" | "vendor" | "homeowner";

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: appointmentTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** The Eastern wall date and time of an instant, as date/time input values. */
export function easternParts(value: Date) {
  const part = (type: string) => partsFormat.formatToParts(value).find(item => item.type === type)?.value ?? "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}

export type EasternChoice = { instant: Date; abbreviation: "EDT" | "EST"; label: string };
export type EasternResolution =
  | { kind: "empty" }
  | { kind: "invalid"; message: string }
  | { kind: "nonexistent"; message: string }
  | { kind: "ambiguous"; message: string; choices: EasternChoice[] }
  | { kind: "ok"; instant: Date; label: string };

/**
 * Reads a date and time as Eastern wall time. Eastern is UTC−4 (EDT) or UTC−5 (EST); a reading
 * is valid when that offset maps back to the same wall time. None means the clocks skipped it
 * (spring forward); two means it happened twice (fall back) and the person must choose.
 */
export function resolveEasternTime(date: string, time: string): EasternResolution {
  if (!date && !time) return { kind: "empty" };
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return { kind: "invalid", message: "Enter both a date and a time." };
  const [year, month, day, hour, minute] = [d[1], d[2], d[3], t[1], t[2]].map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const calendar = new Date(wall);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59) {
    return { kind: "invalid", message: "Enter a real calendar date and time." };
  }
  const choices = ([["EDT", 4], ["EST", 5]] as const)
    .map(([abbreviation, hours]) => ({ abbreviation, instant: new Date(wall + hours * 3_600_000) }))
    .filter(choice => { const parts = easternParts(choice.instant); return parts.date === date && parts.time === time; })
    .map(choice => ({ ...choice, label: formatAppointment(choice.instant)! }));
  if (choices.length === 0) {
    return { kind: "nonexistent", message: `${clock(hour, minute)} doesn’t exist on this date in Eastern Time because clocks spring forward from 2:00 AM to 3:00 AM. Choose a time before 2:00 AM or from 3:00 AM.` };
  }
  if (choices.length > 1) {
    return { kind: "ambiguous", message: `Clocks fall back on this date, so ${clock(hour, minute)} happens twice in Eastern Time. Choose which one.`, choices };
  }
  return { kind: "ok", instant: choices[0].instant, label: choices[0].label };
}

/** The server's _local_start: the Eastern wall time the person entered. */
export function localStartParam(date: string, time: string) {
  return `${date}T${time}:00`;
}

/** Explains the device equivalent when this device is not on Eastern Time. */
export function deviceTimeNote(instant: Date, deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!deviceZone) return null;
  const device = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: deviceZone, timeZoneName: "short" });
  const eastern = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: appointmentTimeZone });
  const plain = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: deviceZone });
  if (plain.format(instant) === eastern.format(instant)) return null;
  return `This device uses a different timezone; there it is ${device.format(instant)}. The appointment is kept in Eastern Time.`;
}

export type AppointmentStateKind = "not_accepted" | "accepted_no_time" | "recorded" | "changed" | "reschedule_requested" | "provider_released" | "replacement_pending" | "closed";
export type AppointmentState = { kind: AppointmentStateKind; heading: string; detail: string };

const closedStatuses = new Set(["cancelled", "closed"]);

/** One wording for every role. A requested or preferred time is never called an appointment. */
export function appointmentState(schedule: Pick<ScheduleReadback, "status" | "matching_status" | "has_provider" | "appointment" | "open_request" | "history">): AppointmentState {
  const appointment = formatAppointment(schedule.appointment);
  const requested = formatAppointment(schedule.open_request?.requested_start);
  if (closedStatuses.has(schedule.status)) {
    return { kind: "closed", heading: "No upcoming appointment", detail: appointment ? `This service is ${schedule.status}. It was scheduled for ${appointment}.` : `This service is ${schedule.status}.` };
  }
  // TRACE-132 (E5): a replacement provider who accepted is not committed to any time until the homeowner accepts.
  if (schedule.matching_status === "awaiting_homeowner") {
    return { kind: "replacement_pending", heading: "Replacement waiting for the homeowner",
      detail: appointment ? `No appointment is set. The earlier time (${appointment}) isn't carried over; the homeowner accepts the replacement and a time first.`
        : "No appointment is set. The homeowner accepts the replacement and a time first." };
  }
  if (!schedule.has_provider) {
    return appointment
      ? { kind: "provider_released", heading: "Appointment on hold", detail: `An appointment was recorded for ${appointment}, but no provider is assigned right now, so no provider is committed to that time.` }
      : { kind: "not_accepted", heading: "No appointment yet", detail: "An appointment time is arranged after a provider accepts this request. A preferred date is a request, not an appointment." };
  }
  if (["pending", "matched", "quoted"].includes(schedule.status) && schedule.matching_status === "offered") {
    return { kind: "not_accepted", heading: "No appointment yet", detail: "The provider hasn’t accepted yet. An appointment time is arranged after a provider accepts." };
  }
  if (requested) {
    return {
      kind: "reschedule_requested", heading: "Reschedule requested",
      detail: appointment
        ? `The current appointment stays ${appointment} until Mercurius changes it. Requested time: ${requested}.`
        : `Requested time: ${requested}. No appointment is recorded yet; Mercurius will review the request.`,
    };
  }
  if (!appointment) {
    return { kind: "accepted_no_time", heading: "Provider accepted · appointment time not recorded yet", detail: "Mercurius records the appointment time once it is arranged. A preferred date is a request, not an appointment." };
  }
  const last = [...schedule.history].reverse().find(entry => entry.kind === "appointment");
  if (last?.outcome === "changed" && last.previous_start) {
    return { kind: "changed", heading: "Appointment changed", detail: `${appointment}. Previously ${formatAppointment(last.previous_start)}.` };
  }
  return { kind: "recorded", heading: "Appointment recorded", detail: appointment };
}

export function actorLabel(actor: ScheduleActor, viewer: ScheduleViewer) {
  if (actor === "operations") return viewer === "admin" ? "Operations" : "Mercurius";
  if (actor === "homeowner") return viewer === "homeowner" ? "You" : "Homeowner";
  if (actor === "provider") return viewer === "vendor" ? "You" : "Provider";
  return "Previous provider";
}

export function historyLine(entry: ScheduleEntry) {
  const next = formatAppointment(entry.new_start);
  if (entry.kind === "reschedule_response") return `${entry.outcome === "accepted" ? "Accepted" : "Declined"} the provider’s proposed time: ${formatAppointment(entry.requested_start) ?? "time unavailable"}`;
  if (entry.kind === "replacement_proposal") return `Replacement proposed: ${entry.provider_name ?? "provider"} on ${next}`;
  if (entry.kind === "replacement_response") return entry.outcome === "accepted"
    ? `Replacement accepted: ${entry.provider_name ?? "provider"} on ${next}` : `Replacement declined: ${entry.provider_name ?? "provider"}`;
  if (entry.outcome === "requested") return `Different time requested${entry.initiator === "provider" ? " by the provider" : ""}: ${formatAppointment(entry.requested_start) ?? "time unavailable"}`;
  if (entry.outcome === "kept") return `Appointment kept at ${next}; reschedule request answered`;
  if (entry.outcome === "changed") return `Appointment changed from ${formatAppointment(entry.previous_start) ?? "no time"} to ${next}`;
  return `Appointment recorded: ${next}`;
}

/** A lost response is a success when the readback holds this caller's operation key. */
export function recordedInHistory(schedule: ScheduleReadback | null, operationKey: string) {
  return Boolean(schedule?.history.some(entry => entry.operation_key === operationKey));
}

export function scheduleErrorMessage(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (message.includes("changed since you loaded")) return "Someone changed this appointment while you were editing. The latest appointment is shown; review it before trying again.";
  if (message.includes("already recorded")) return "That is already the current appointment. Choose a different time.";
  if (message.includes("future")) return "Choose a time in the future.";
  if (message.includes("does not match the Eastern Time")) return "The time couldn’t be read as Eastern Time. Re-enter the date and time.";
  if (message.includes("only after a provider accepts")) return "An appointment can be recorded only after a provider accepts and before work starts. The current status is shown.";
  if (message.includes("Recurring visits")) return "Recurring visits are scheduled separately.";
  if (message.includes("reused with different intent")) return "This save conflicts with an earlier attempt. Review the latest appointment and try again.";
  if (message.includes("no longer accepts")) return "This service no longer accepts schedule changes.";
  if (message.includes("hasn't accepted this time") || message.includes("hasn’t accepted this time")) return "The homeowner hasn’t accepted this time. Keep the current appointment, or ask the provider to propose a time the homeowner accepts.";
  if (message.includes("price or terms differ")) return "The replacement’s price or terms differ from what the homeowner agreed. A replacement works for the agreed amount; otherwise record no replacement.";
  if (message.includes("changed since you opened it") || message.includes("answered or replaced")) return "This changed while you were looking at it. The latest details are shown; review them before answering.";
  if (message.includes("already answered")) return "This was already answered. The latest details are shown.";
  if (message.includes("time has passed")) return "That time has passed. The latest details are shown.";
  if (message.includes("only for yourself") || message.includes("Say whether")) return "Choose who asked for the new time.";
  if (code === "42501" || message.includes("Admin access") || message.includes("Not a participant") || message.includes("cannot perform")) return "You don’t have permission to make this change.";
  return "We couldn’t confirm whether this was saved. The latest schedule is shown; check it before trying again.";
}

function clock(hour: number, minute: number) {
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}
