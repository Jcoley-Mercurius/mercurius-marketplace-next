import { formatAppointment } from "@/lib/appointments";

// TRACE-133: support requests, service disputes and their reads. The server decides every state,
// participant and money fact; these helpers only describe them. Resolution, refund authorization,
// refund movement and payout are separate facts and are never merged into one "status".

export type TicketStatus = "open" | "in-progress" | "resolved" | "closed";
export type TicketKind = "general" | "dispute" | "dispute_appeal" | "review_appeal" | "schedule_exception" | "plan_stop_request" | string;
export type TicketMessage = {
  id: string; role: "requester" | "operations"; visibility: "participant" | "internal";
  body: string; at: string; mine: boolean; author?: string | null;
};
export type TicketHistory = { action: "opened" | "status" | "assigned" | "next_action"; from: string | null; to: string | null; reason: string | null; version: number; at: string; by: string | null };
export type SupportTicket = {
  ticket_id: string; ticket_number: string; subject: string; description: string; kind: TicketKind;
  status: TicketStatus; created_at: string; updated_at: string; closed_at: string | null;
  response_due_at: string | null; priority: "standard" | "same_day"; version: number;
  job: { id: string; service_type: string; status: string } | null;
  can_reply: boolean; messages: TicketMessage[];
  // Operations view only.
  requester?: { user_id: string; name: string | null; role: "homeowner" | "provider" };
  opened_by?: string | null; next_action?: string; assigned_to?: string | null; assignee?: string | null;
  overdue?: boolean; history?: TicketHistory[];
  dispute?: { dispute_id: string; status: DisputeStatus; resolution_version: number } | null;
  review_appeal?: { review_id: string; moderation_state: string; decided: boolean } | null;
};
export type QueueItem = {
  ticket_id: string; ticket_number: string; subject: string; kind: TicketKind; status: TicketStatus;
  priority: "standard" | "same_day"; created_at: string; updated_at: string; response_due_at: string | null;
  overdue: boolean; next_action: string; queue_owner: string; version: number; assigned_to: string | null;
  assignee: string | null; requester: string | null; job_id: string | null; dispute_status: DisputeStatus | null;
  decision_recorded: boolean | null; messages: number;
};
export type SupportQueue = {
  checked_at: string; counts: { open: number; overdue: number; same_day: number; unassigned: number };
  operators: { user_id: string; name: string }[]; items: QueueItem[];
};

export type DisputeStatus = "open" | "vendor_contacted" | "resolved" | "escalated";
export type DisputeViewer = "homeowner" | "provider" | "operations";
export type DisputeDecision = { action: "decided" | "appealed"; from: DisputeStatus; to: DisputeStatus; version: number; notes: string | null; at: string; by: string };
export type DisputeSubmission = { id: string; role: "homeowner" | "provider"; statement: string | null; photo_path: string | null; mine: boolean; at: string };
export type Dispute = {
  dispute_id: string; status: DisputeStatus; raised_at: string; reason: string | null;
  completion_at: string | null; window_ends_at: string | null; resolution_version: number;
  resolution_notes: string | null; resolved_at: string | null; ticket_number: string | null;
  decisions: DisputeDecision[]; appeals: { resolution_version: number; reason: string; at: string; ticket_number: string | null; ticket_status: TicketStatus | null }[];
  can_appeal: boolean; can_submit: boolean; submissions: DisputeSubmission[];
};
export type RefundState = {
  payment_record: boolean; authorization: "none" | "authorized"; authorized?: number;
  movement: "none" | "not_sent" | "in_flight" | "unknown" | "failed" | "settled" | "partly_settled";
};
export type PayoutHoldState = { state: string; blocker?: string | null };
export type DisputeDetail = {
  job_id: string; viewer: DisputeViewer; status: string; checked_at: string; vendor_completed_at: string | null;
  disputes: Dispute[]; refund: RefundState | null; payout: PayoutHoldState | null;
};

export const ticketStatusLabel: Record<TicketStatus, string> = {
  open: "Open", "in-progress": "In progress", resolved: "Resolved", closed: "Closed",
};

export function ticketKindLabel(kind: TicketKind) {
  return ({
    general: "Support request", dispute: "Service dispute", dispute_appeal: "Dispute appeal", review_appeal: "Review appeal",
    schedule_exception: "Service exception", plan_stop_request: "Plan stop request",
  } as Record<string, string>)[kind] ?? "Support request";
}

export const disputeStatusLabel: Record<DisputeStatus, string> = {
  open: "Open", vendor_contacted: "Mercurius is following up", resolved: "Decision recorded", escalated: "Appeal under review",
};

// A ticket of these kinds follows another record's decision; the queue can't close it directly.
export function ticketFollowsDecision(item: Pick<QueueItem, "kind" | "decision_recorded">) {
  if (item.kind === "dispute" || item.kind === "dispute_appeal") return "Closes with the dispute decision";
  if (item.kind === "review_appeal" && item.decision_recorded === false) return "Decide the review appeal first";
  return null;
}

export function responseDueText(ticket: Pick<SupportTicket, "status" | "response_due_at" | "priority">) {
  if (ticket.status === "resolved" || ticket.status === "closed" || !ticket.response_due_at) return null;
  const when = formatAppointment(ticket.response_due_at);
  return ticket.priority === "same_day" ? `Same-day priority · response by ${when}` : `Response expected by ${when}`;
}

// Separate money facts in plain words. A decision is not a refund, an authorization is not money
// moved, and a payout hold belongs to the provider.
export function refundText(refund: RefundState | null | undefined) {
  if (!refund) return null;
  if (!refund.payment_record) return "No payment on record for this service.";
  if (refund.authorization === "none") return "No refund has been authorized.";
  return ({
    none: "A refund is authorized; no money has moved yet.",
    not_sent: "A refund is authorized and not yet sent.",
    in_flight: "A refund is authorized and on its way.",
    unknown: "A refund is authorized; its outcome is being confirmed.",
    failed: "A refund attempt failed; Mercurius is following up.",
    settled: "The authorized refund has been sent.",
    partly_settled: "Part of the authorized refund has been sent.",
  })[refund.movement];
}

export function payoutText(payout: PayoutHoldState | null | undefined) {
  if (!payout) return null;
  return ({
    dispute_hold: "Payout is held while this dispute or its appeal is open.",
    no_payment_record: "No payment on record for this service yet.",
    awaiting_confirmation: "Payout waits for the homeowner's confirmation.",
    confirmation_window: "Payout becomes eligible 48 hours after confirmation.",
    payment_incomplete: "Payout waits for the full payment.",
    onboarding: "Payout waits for your payout details.",
    eligible: "Eligible for the next weekly payout.",
    paid: "Paid.",
    nothing_payable: "Nothing is payable for this service.",
    unavailable: "Payout status is unavailable right now.",
    held: "Payout is on hold.",
  } as Record<string, string>)[payout.state] ?? "Payout is on hold.";
}

export function newRequestKey() {
  return crypto.randomUUID();
}

// Server refusals in words a person can act on. Unknown errors keep a generic, safe message.
export function describeSupportError(error: unknown): string {
  const raw = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
  if (raw.code === "40001") return "This changed since you opened it. Reload to see the latest, then try again.";
  if (raw.code === "42501") return "You don't have access to this. If you think that's wrong, contact Mercurius.";
  if (raw.code === "22023" && raw.message) return raw.message;
  return "That didn't go through. Check your connection and try again.";
}
