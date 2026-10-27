import { formatAppointment } from "@/lib/appointments";

// TRACE-124 (Phase 6.6b, DEC-2026-049 items 1–4 and 9): a recurring plan's cadence counts from an
// operator-recorded Eastern anchor. Operations reviews proposed visits (through today + 60 Eastern
// days, at least 24 hours away, up to two future visits) and creates each one explicitly; nothing
// is generated in the background. The server computes proposals and enforces every rule; the date
// arithmetic here only mirrors it to offer cadence dates an off-cadence visit can replace.

export type PlanState = "active" | "paused" | "ended";
export type DstKind = "ok" | "ambiguous" | "nonexistent";
export type CadenceProposal = {
  cadence_date: string;
  index: number;
  local_start: string;
  kind: DstKind;
  choices: { abbreviation: "EDT" | "EST"; starts_at: string }[];
  starts_at: string | null;
  opens_on: string;
};
export type CadencePreview = {
  as_of: string;
  today: string;
  horizon_end: string;
  state: PlanState;
  unavailable: "ended" | "paused" | "no_anchor" | "not_active" | null;
  anchor_id: string | null;
  upcoming: number;
  capacity: number;
  proposals: CadenceProposal[];
  next: CadenceProposal | null;
};
export type AnchorEntry = {
  id: string; at: string; starts_at: string; local_start: string; basis: string; reason: string;
  replaces_anchor_id: string | null; actor: "operations"; operation_key: string | null;
};
export type LifecycleEntry = {
  id: string; at: string; action: "pause" | "resume" | "stop"; from_state: PlanState; to_state: PlanState;
  reason: string; actor: "operations"; operation_key: string | null;
};
export type CadenceResolution = {
  id: string; at: string; anchor_id: string; current_anchor: boolean; cadence_date: string; kind: "skipped" | "replaced";
  occurrence_id: string | null; reason: string; actor: "operations"; operation_key: string | null;
};
export type LifecycleAction = LifecycleEntry["action"];

const monthsPerStep: Record<string, number> = { monthly: 1, "every-two-months": 2, quarterly: 3 };
const daysPerStep: Record<string, number> = { weekly: 7, "bi-monthly": 14 };

const parse = (date: string) => { const [y, m, d] = date.split("-").map(Number); return { y, m, d }; };
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const daysBetween = (from: string, to: string) => {
  const a = parse(from), b = parse(to);
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
};
const addDays = (date: string, days: number) => {
  const { y, m, d } = parse(date);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
};

/** The n-th cadence date (n = 0 is the anchor); months clamp to a shorter month's last day without drifting. */
export function cadenceDate(anchorDate: string, frequency: string, n: number): string | null {
  if (n < 0) return null;
  if (daysPerStep[frequency]) return addDays(anchorDate, daysPerStep[frequency] * n);
  const step = monthsPerStep[frequency];
  if (!step) return null;
  const { y, m, d } = parse(anchorDate);
  const total = (m - 1) + step * n;
  const year = y + Math.floor(total / 12), month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return iso(year, month, Math.min(d, last));
}

/** The index of a cadence date, or null when the date is not one. */
export function cadenceIndex(anchorDate: string, frequency: string, date: string): number | null {
  const days = daysBetween(anchorDate, date);
  if (days < 0) return null;
  if (daysPerStep[frequency]) return days % daysPerStep[frequency] === 0 ? days / daysPerStep[frequency] : null;
  const step = monthsPerStep[frequency];
  if (!step) return null;
  const a = parse(anchorDate), b = parse(date);
  const months = (b.y - a.y) * 12 + b.m - a.m;
  if (months % step !== 0) return null;
  return cadenceDate(anchorDate, frequency, months / step) === date ? months / step : null;
}

/**
 * The cadence dates nearest an off-cadence visit (the one before and the one after it) that are
 * not already handled; the server rechecks each choice.
 */
export function replacementCandidates(anchorDate: string, frequency: string, visitDate: string, handled: Set<string>) {
  const candidates: string[] = [];
  let before: string | null = null;
  for (let n = 0; n < 2000; n += 1) {
    const date = cadenceDate(anchorDate, frequency, n);
    if (!date) break;
    if (date > visitDate) {
      if (before) candidates.push(before);
      if (!handled.has(date)) candidates.push(date);
      break;
    }
    if (!handled.has(date)) before = date;
  }
  return candidates;
}

const dateFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** An Eastern calendar date (YYYY-MM-DD) as "Tue, Nov 3, 2026". */
export function formatCadenceDate(date: string) {
  const { y, m, d } = parse(date);
  return dateFormat.format(new Date(Date.UTC(y, m - 1, d)));
}

export function planStateLabel(state: PlanState) {
  if (state === "paused") return "Paused · no new visits";
  if (state === "ended") return "Future visits stopped";
  return "Active";
}

export function anchorLine(cadence: string, anchor: { starts_at: string } | null) {
  return anchor ? `${cadence}, counted from ${formatAppointment(anchor.starts_at)}` : "No cadence anchor recorded yet";
}

/** The proposal list's empty state. */
export function emptyProposalMessage(preview: CadencePreview) {
  switch (preview.unavailable) {
    case "ended": return "Future visits for this plan were stopped. Nothing is proposed.";
    case "paused": return "The plan is paused. Nothing is proposed until operations resumes it.";
    case "no_anchor": return "Record the agreed first visit time to see proposed visits.";
    case "not_active": return "The plan isn’t active with an accepted provider, so nothing is proposed.";
  }
  const next = preview.next
    ? ` Next cadence date: ${formatCadenceDate(preview.next.cadence_date)}${preview.next.opens_on > preview.today ? `; it can be proposed from ${formatCadenceDate(preview.next.opens_on)}` : ""}.`
    : "";
  if (preview.capacity === 0) return `This plan already has ${preview.upcoming} upcoming visits, so nothing more is proposed.${next}`;
  return `No cadence date falls in the next 60 days that is at least 24 hours away.${next}`;
}

export function dstNote(proposal: CadenceProposal) {
  if (proposal.kind === "nonexistent") return "Clocks spring forward on this date, so the plan’s time doesn’t exist. Choose a time on this date; the plan’s time stays the same for later visits.";
  if (proposal.kind === "ambiguous") return "Clocks fall back on this date, so the plan’s time happens twice. Choose EDT or EST; later visits are unaffected.";
  return null;
}

export function lifecycleConsequence(action: LifecycleAction) {
  if (action === "pause") return "No new visits can be added, manually or from proposals, until operations resumes the plan. Existing visits and open offers stay in place and are handled individually. Nothing is charged or refunded.";
  if (action === "resume") return "New visits can be added again. Proposals restart from the anchor at the next eligible cadence date; dates that passed while paused aren’t made up. The plan’s provider, terms and the homeowner’s access are checked again for each visit.";
  return "This is final: no new visits can be added to this plan, manually or from proposals. Existing visits and open offers remain in place and each needs to be handled individually; nothing is cancelled, charged or refunded by this action.";
}

export function lifecycleLine(entry: LifecycleEntry) {
  if (entry.action === "pause") return "Plan paused";
  if (entry.action === "resume") return "Plan resumed";
  return "Future visits stopped";
}

export function anchorHistoryLine(entry: AnchorEntry) {
  return `${entry.replaces_anchor_id ? "Cadence re-anchored" : "Cadence anchor recorded"}: ${formatAppointment(entry.starts_at)}`;
}

export function resolutionLine(entry: CadenceResolution) {
  const date = formatCadenceDate(entry.cadence_date);
  const prefix = entry.kind === "skipped" ? `Cadence date skipped: ${date}` : `Cadence date ${date} replaced by an off-cadence visit`;
  return entry.current_anchor ? prefix : `${prefix} (under an earlier anchor)`;
}

export function cadenceErrorMessage(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "42501" || message.includes("Admin access")) return "You don’t have permission to do this.";
  if (message.includes("cadence changed since you loaded it")) return "The cadence changed since this page loaded. The latest proposals are shown; review them and try again.";
  if (message.includes("no longer current")) return "This proposed visit is no longer current. The latest proposals are shown.";
  if (message.includes("plan changed since you loaded it")) return "The plan changed since this page loaded. Its latest state is shown.";
  if (message.includes("at least 24 hours away")) return "A proposed visit must be at least 24 hours away. Add a sooner visit manually if it’s needed.";
  if (message.includes("keeps the plan's Eastern time") || message.includes("stays on its cadence date")) return "A proposed visit keeps the plan’s date and time. Add a different time manually.";
  if (message.includes("already the plan's anchor")) return "That is already the plan’s anchor.";
  if (message.includes("does not match the Eastern Time")) return "The time couldn’t be read as Eastern Time. Re-enter the date and time.";
  if (message.includes("already has a visit")) return "That cadence date already has a visit.";
  if (message.includes("already skipped or replaced")) return "That cadence date was already skipped or replaced.";
  if (message.includes("already replaces a cadence date")) return "This visit already replaces a cadence date.";
  if (message.includes("cadence date of its own")) return "This visit is on a cadence date of its own, so it can’t replace another.";
  if (message.includes("cancelled visit cannot replace")) return "A cancelled visit can’t replace a cadence date.";
  if (message.includes("not a cadence date")) return "That date isn’t a cadence date of this plan.";
  if (message.includes("were already stopped") || message.includes("were stopped")) return "Future visits for this plan were stopped.";
  if (message.includes("already paused") || message.includes("already active")) return "The plan is already in that state. Its latest state is shown.";
  if (message.includes("reused with different intent")) return "This attempt conflicts with an earlier one. Review the latest state and try again.";
  return "We couldn’t confirm whether this was saved. The latest state is shown; check it before trying again.";
}
