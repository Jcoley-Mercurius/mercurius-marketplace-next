import { actorLabel, formatAppointment, type ScheduleViewer } from "@/lib/appointments";

// TRACE-128: the job_fulfillment readback and its role-appropriate wording. The server decides
// every state and clock; these helpers only describe them.

export type FulfillmentActor = "provider" | "homeowner" | "operations";
export type PayoutState = "no_payment_record" | "awaiting_confirmation" | "confirmation_window" | "payment_incomplete"
  | "held" | "onboarding" | "eligible" | "paid" | "nothing_payable" | "unavailable";
export type FulfillmentOperation = {
  kind: "no_show" | "unable_to_complete" | "customer_unavailable" | "partial_completion" | "provider_cancel";
  at: string; reason: string; by: FulfillmentActor;
};
export type Fulfillment = {
  role: ScheduleViewer; status: string; plan: boolean; visit?: boolean;
  started?: { at: string; by: FulfillmentActor | null; rework: boolean; reason?: string | null;
    payment_at_start?: { state: string; reason?: string | null } | null } | null;
  completion?: { at: string; attempt: number | null; photos: number | null; minimum: number | null; by: FulfillmentActor | null; recorded: boolean } | null;
  confirmation?: { at: string; by: "homeowner" } | null;
  dispute?: { at: string; status: string; resolved_at: string | null } | null;
  dispute_window_ends_at?: string | null;
  review_at?: string | null;
  operations?: FulfillmentOperation[];
  payout?: { state: PayoutState; eligible_at: string | null; blocker?: string | null } | null;
};
export type FulfillmentQueueKind = "confirmation_overdue" | "fulfillment_exception" | "evidence_unverified";
export type FulfillmentQueueItem = {
  request_id: string; kind: FulfillmentQueueKind; since: string; detail: FulfillmentOperation["kind"] | null;
  service_type: string; status: string; series_id: string | null;
};

export type TimelineStep = { key: string; label: string; detail: string };

const who = (actor: FulfillmentActor | null | undefined, viewer: ScheduleViewer) => actor ? actorLabel(actor, viewer) : "Someone";

export function operationLabel(kind: FulfillmentOperation["kind"]) {
  return { no_show: "No-show reported", unable_to_complete: "Unable to complete", customer_unavailable: "Homeowner unavailable",
    partial_completion: "Partly completed", provider_cancel: "Provider cancelled" }[kind];
}

// What happened, in order, each with who acted and when. Provider completion and homeowner
// confirmation are always separate steps.
export function fulfillmentTimeline(data: Fulfillment): TimelineStep[] {
  const viewer = data.role;
  const steps: TimelineStep[] = [];
  if (data.started) {
    steps.push({ key: "started", label: data.started.rework ? "Work restarted for rework" : "Work started",
      detail: `${who(data.started.by, viewer)} · ${formatAppointment(data.started.at)}` });
  }
  if (data.completion) {
    const photos = data.completion.photos == null ? "no recorded photos"
      : `${data.completion.photos} photo${data.completion.photos === 1 ? "" : "s"}`;
    const attempt = data.completion.attempt && data.completion.attempt > 1 ? ` · submission ${data.completion.attempt}` : "";
    steps.push({ key: "completed", label: "Completion submitted",
      detail: `${who(data.completion.by, viewer)} · ${formatAppointment(data.completion.at)} · ${photos}${attempt}` });
  }
  for (const operation of data.operations ?? []) {
    steps.push({ key: `operation:${operation.kind}:${operation.at}`, label: operationLabel(operation.kind),
      detail: `${who(operation.by, viewer)} · ${formatAppointment(operation.at)}` });
  }
  if (data.confirmation) {
    steps.push({ key: "confirmed", label: "Homeowner confirmed the work",
      detail: `${actorLabel("homeowner", viewer)} · ${formatAppointment(data.confirmation.at)}` });
  }
  if (data.dispute) {
    steps.push({ key: "dispute", label: data.dispute.status === "resolved" ? "Issue resolved" : "Issue reported",
      detail: `${actorLabel("homeowner", viewer)} · ${formatAppointment(data.dispute.at)}${data.dispute.resolved_at ? ` · resolved ${formatAppointment(data.dispute.resolved_at)}` : ""}` });
  }
  return steps.sort((a, b) => stepTime(a, data) - stepTime(b, data));
}

function stepTime(step: TimelineStep, data: Fulfillment) {
  const at = step.key === "started" ? data.started?.at : step.key === "completed" ? data.completion?.at
    : step.key === "confirmed" ? data.confirmation?.at : step.key === "dispute" ? data.dispute?.at : step.key.split(":").slice(2).join(":");
  return at ? Date.parse(at) : 0;
}

// The next step for this viewer while a completion waits on the homeowner.
export function waitingLine(data: Fulfillment, now: number) {
  if (data.status !== "vendor_completed" || !data.completion) return null;
  const disputeEnds = data.dispute_window_ends_at ? Date.parse(data.dispute_window_ends_at) : null;
  const disputeOpen = disputeEnds !== null && now < disputeEnds;
  const review = formatAppointment(data.review_at);
  const issue = disputeOpen ? `report an issue by ${formatAppointment(data.dispute_window_ends_at)}` : "contact support about an issue";
  if (data.role === "homeowner") {
    return `Waiting for you to confirm the work or ${issue}.${review ? ` If there's no answer, Mercurius reviews it from ${review}; silence doesn't confirm it.` : ""}`;
  }
  return `Waiting for the homeowner to confirm. The provider's completion alone doesn't confirm the work or start payout.${review ? ` Mercurius reviews an unanswered completion from ${review}.` : ""}`;
}

export function payoutLine(payout: Fulfillment["payout"]) {
  if (!payout) return null;
  const opens = formatAppointment(payout.eligible_at);
  switch (payout.state) {
    case "no_payment_record": return "No payment is recorded for this service yet, so there's nothing to pay out.";
    case "awaiting_confirmation": return "Payout waits for the homeowner to confirm the work. Eligibility begins 48 hours after confirmation.";
    case "confirmation_window": return `Payout eligibility begins ${opens ?? "48 hours after confirmation"}, if no dispute or hold applies.`;
    case "payment_incomplete": return "The homeowner's payment isn't complete, so this service isn't payable yet.";
    case "held": return "Payout is held while a dispute, refund or review is open.";
    case "onboarding": return "Payout waits for the provider's payout setup to be complete and current.";
    case "eligible": return "Eligible for the next weekly payout.";
    case "paid": return "Paid out.";
    case "nothing_payable": return "Nothing is payable for this service.";
    default: return "Payout status couldn't be checked. Try again later.";
  }
}

export function queueItemCopy(item: Pick<FulfillmentQueueItem, "kind" | "detail">) {
  if (item.kind === "confirmation_overdue") {
    return { title: "Completion unanswered for 72 hours", action: "Review the evidence and contact the homeowner and provider. Silence doesn't confirm the work." };
  }
  if (item.kind === "evidence_unverified") {
    return { title: "Completion without recorded evidence", action: "Check the provider's proof with them before the homeowner decides. Nothing is backfilled." };
  }
  const title = item.detail ? operationLabel(item.detail) : "Service exception";
  const action = {
    no_show: "Confirm what happened. Rematch first; if no acceptable replacement exists, assess a full refund (CFG-007).",
    unable_to_complete: "Contact both parties and agree a return visit, a rematch or a cancellation under policy.",
    customer_unavailable: "Contact the homeowner to record a new appointment, or handle it under the cancellation policy.",
    partial_completion: "Agree the remaining work. The provider completes with evidence; the homeowner confirms or reports an issue.",
    provider_cancel: "Find an acceptable replacement; assess a full refund if none is available.",
  }[item.detail ?? "unable_to_complete"];
  return { title, action };
}

// Database refusals that mean "this changed since you loaded it".
export function isStaleRefusal(message: string | undefined | null) {
  return /no longer waiting|submitted new completion proof|no longer open/i.test(message ?? "");
}
