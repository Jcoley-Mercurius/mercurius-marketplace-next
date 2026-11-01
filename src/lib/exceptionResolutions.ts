import { formatAppointment } from "@/lib/offerStatus";
import { money, type CancellationOutcome } from "@/lib/cancellation";

// TRACE-132 (Phase 6.9B, DEC-2026-053 E3, E5, E8, E11): wording for reschedule answers, replacement
// consent, plan stop requests and later waivers. The server decides every state (job_schedule,
// recurring_plan_stop_preview, job_cancellation_outcome); this file only names them. A proposed time
// is never an appointment, a request is never a completed change, and an owed refund is never "sent".

export type RescheduleInitiator = "homeowner" | "provider";

export type OpenRescheduleRequest = {
  id: string; actor: string; at: string; reason: string; requested_start: string;
  initiator?: RescheduleInitiator; fee?: number | null; fee_responsibility?: "homeowner" | "none" | "operations_decides" | null;
  fee_waived_later?: boolean; requires_homeowner_acceptance?: boolean;
  answer?: { accepted: boolean; at: string; reason: string | null } | null;
  expected?: { request_id: string; appointment: string | null; contractor_id: string | null };
};

export type ReplacementState = {
  state: "searching" | "awaiting_proposal" | "awaiting_homeowner" | "search_ended" | "accepted" | "closed";
  withdrawn_at: string; original_start: string | null; search_deadline: string | null; search_closed: boolean;
  inside_search_deadline: boolean;
  proposal: {
    id: string; contractor_id: string; provider_name: string | null; starts_at: string; created_at: string; reason: string;
    after_search_deadline: boolean; answer: { accepted: boolean; at: string; reason: string | null } | null;
  } | null;
  expected: { proposal_id: string; contractor_id: string; starts_at: string } | null;
  admin_expected: { contractor_id: string; proposal_id: string | null } | null;
};

/** Who asked for the new time and what that means for the homeowner's fee (E2/E3). */
export function requestFeeLine(request: Pick<OpenRescheduleRequest, "initiator" | "fee" | "fee_waived_later">): string {
  if (request.initiator === "provider") return "The provider asked for this time, so no rescheduling fee applies to you.";
  if (request.fee_waived_later) return "Mercurius accepted an exception, so the rescheduling fee no longer applies.";
  if (request.fee === 25) return "Rescheduling fee under the policy: $25, assessed but not charged. Mercurius confirms any charge separately.";
  if (request.fee === 0) return "No rescheduling fee applies.";
  return "Less than 24 hours' notice: Mercurius decides case by case and can't guarantee a new time. No fee unless Mercurius tells you otherwise.";
}

/** The state of a provider's proposed time, in the homeowner's or operations' words. */
export function proposalAnswerLine(request: Pick<OpenRescheduleRequest, "requires_homeowner_acceptance" | "answer" | "requested_start">, viewer: "admin" | "vendor" | "homeowner"): string | null {
  if (!request.requires_homeowner_acceptance) return null;
  const time = formatAppointment(request.requested_start);
  if (!request.answer) {
    return viewer === "homeowner"
      ? `The provider proposed ${time}. Accept or decline it; your current appointment stays until you agree to a new time and Mercurius records it.`
      : `Waiting for the homeowner to accept or decline ${time}. The appointment can't move to it until they accept.`;
  }
  if (request.answer.accepted) {
    return viewer === "admin"
      ? `The homeowner accepted ${time}. Record it with Use requested time.`
      : `The homeowner accepted ${time}. The appointment changes when Mercurius records it.`;
  }
  return viewer === "admin"
    ? "The homeowner declined. Keep the current appointment if the provider can honor it; otherwise record the provider's withdrawal (CFG-007)."
    : "The homeowner declined the proposed time. The current appointment stays unless Mercurius changes it.";
}

/** What the homeowner or operations should know about a replacement after a provider withdrew (E5). */
export function replacementLine(replacement: ReplacementState | null, viewer: "admin" | "vendor" | "homeowner"): { heading: string; detail: string } | null {
  if (!replacement) return null;
  const original = formatAppointment(replacement.original_start);
  const deadline = formatAppointment(replacement.search_deadline);
  const proposal = replacement.proposal;
  switch (replacement.state) {
    case "searching":
      return { heading: "Finding a replacement provider",
        detail: `The provider withdrew${original ? ` from ${original}` : ""}. Mercurius is looking for a replacement${deadline ? ` until ${deadline}` : ""}. You'll be asked to accept any replacement and its time; nothing is scheduled until you do.` };
    case "awaiting_proposal":
      return { heading: "Replacement provider found",
        detail: viewer === "admin" ? "A replacement accepted the offer. Propose the provider and an appointment time for the homeowner to accept."
          : "A replacement accepted. Mercurius will propose an appointment time for you to accept. Nothing is scheduled yet." };
    case "awaiting_homeowner":
      return { heading: viewer === "homeowner" ? "Accept your replacement provider?" : "Waiting for the homeowner",
        detail: `${proposal?.provider_name ?? "A replacement provider"} on ${formatAppointment(proposal?.starts_at)}. ${viewer === "homeowner"
          ? "Accepting agrees to both the provider and the time. Declining keeps the search going, or Mercurius refunds you in full if no one else is available."
          : "Nothing is scheduled until the homeowner accepts both."}` };
    case "search_ended":
      return { heading: replacement.inside_search_deadline ? "Withdrawal close to the appointment" : "No replacement found yet",
        detail: viewer === "admin"
          ? "The automatic search has ended. Propose a replacement the homeowner accepts, or record no replacement (full refund)."
          : "Mercurius is deciding what happens next. If there's no acceptable replacement, you get a full refund." };
    case "accepted":
      return { heading: "Replacement accepted",
        detail: `${proposal?.provider_name ?? "The replacement provider"} on ${formatAppointment(proposal?.starts_at)}, as you accepted.` };
    default:
      return null;
  }
}

export type PlanStopVisit = {
  id: string; status: string; matching_status: string | null; scheduled_start_at: string | null; provider_name: string | null;
  offer_open: boolean;
  cancellation: { allowed: true; refund_percent: number | null; basis: string | null } | { allowed: false; message: string };
  payment: { captured: number; open_checkout: boolean } | null;
};
export type PlanStopPreview = {
  series_id: string; plan_state: "active" | "paused" | "ended"; expected_state: string; accepted: boolean;
  request: { id: string; at: string; reason: string; state: "open" | "stopped" | "closed"; closed_at: string | null; resolution: string | null } | null;
  visits: PlanStopVisit[];
};

/** The homeowner's stop request, never presented as a cancellation (E8). */
export function planStopLine(preview: PlanStopPreview, viewer: "admin" | "homeowner"): string | null {
  const request = preview.request;
  if (!request) return null;
  const when = formatAppointment(request.at);
  if (request.state === "stopped") return `Future visits were stopped after the request on ${when}. Visits already in place stay until each one is handled.`;
  if (request.state === "closed") return `The request on ${when} was closed without stopping future visits: ${request.resolution}`;
  return viewer === "admin"
    ? `The homeowner asked on ${when} to stop future visits. Review the visits below, then use Stop future visits; handle each visit on its own.`
    : `You asked on ${when} to stop future visits. Mercurius will stop them; visits already in place stay until each one is handled. Nothing has been cancelled.`;
}

/** What happens to one visit in place: it stays, and is handled on its own. */
export function planStopVisitLine(visit: PlanStopVisit): string {
  const when = formatAppointment(visit.scheduled_start_at) ?? "No time recorded";
  const where = visit.offer_open ? "offer open to the provider" : visit.status === "scheduled" ? "scheduled" : visit.status.replaceAll("_", " ");
  const cancel = visit.cancellation.allowed
    ? `cancelling it now would refund ${visit.cancellation.refund_percent ?? 0}% of what was paid`
    : visit.cancellation.message;
  return `${when} · ${where}. It stays in place; ${cancel}.`;
}

/** E11: the original assessment, the later waiver and what remains, in the homeowner's words. */
export function adjustmentText(outcome: CancellationOutcome): string {
  const adjustment = outcome.adjustment;
  if (!adjustment) return "";
  const original = `${adjustment.original_percent ?? 0}%${typeof adjustment.original_amount === "number" ? ` (${money(adjustment.original_amount)})` : ""}`;
  return `Originally assessed at ${original}. Mercurius later accepted an exception, so ${outcome.entitlement?.refund_percent ?? 100}% is owed.`;
}

export function remainingText(outcome: CancellationOutcome, viewer: "admin" | "homeowner"): string {
  const remaining = outcome.remaining;
  if (!remaining || remaining.state === "none") return "";
  const amount = typeof remaining.amount === "number" ? money(remaining.amount) : "The rest";
  if (remaining.state === "original_unauthorized") return "";
  return viewer === "admin"
    ? `${amount} more is owed after the exception. It needs its own reviewed refund authorization, which isn't available yet.`
    : `${amount} more is owed to you after the exception. Mercurius reviews it separately before it's sent; it hasn't been sent yet.`;
}
