import { formatEastern, isQuoteWork } from "@/lib/offerStatus";

// TRACE-119 / DEC-2026-045 (Phase 6.4): the assigned provider proposes an itemized estimate,
// Mercurius sends an itemized quote (corrected with a reason if needed) and the homeowner
// decides within 24 hours (DEC-2026-008). Tax stays "pending confirmation" until a confirmed
// treatment exists; only then can a quote be approved. The server commands own every rule and
// compute every total; this module prepares input and explains stored state. The browser clock
// never decides expiry; it only stops offering an action the server would refuse.

export type QuoteItemKind = "service" | "labor" | "materials" | "addon" | "discount";
export const quoteItemKinds: QuoteItemKind[] = ["service", "labor", "materials", "addon", "discount"];
export const quoteItemKindLabel: Record<QuoteItemKind, string> = {
  service: "Service", labor: "Labor", materials: "Materials", addon: "Add-on", discount: "Discount",
};

/** A stored, server-normalized line. */
export type QuoteItem = { kind: QuoteItemKind; description: string; quantity: number; unit_cents: number; amount_cents: number };
/** An editable line as typed: quantity and unit price in dollars, as text. */
export type QuoteItemDraft = { kind: QuoteItemKind; description: string; quantity: string; unit: string };

export type QuoteProposalStatus = "pending" | "sent" | "returned" | "superseded";
export type QuoteProposal = {
  id: string;
  request_id: string;
  contractor_id: string;
  items: QuoteItem[];
  subtotal_cents: number;
  scope: string;
  based_on_revision: number;
  created_at: string;
  status: QuoteProposalStatus | string;
  decided_at: string | null;
  decision_reason: string | null;
  quote_id: string | null;
  corrected: boolean | null;
};
export const proposalColumns = "id, request_id, contractor_id, items, subtotal_cents, scope, based_on_revision, created_at, status, decided_at, decision_reason, quote_id, corrected";

export type QuoteTerms = {
  quote_id: string;
  items: QuoteItem[];
  scope: string;
  service_cents: number;
  addons_cents: number;
  discount_cents: number;
  subtotal_cents: number;
  tax_status: "pending" | "confirmed" | string;
  tax_cents: number | null;
  total_cents: number | null;
  deposit_cents: number;
  payment_terms: string;
  policy_version: string;
};
export const termsColumns = "quote_id, items, scope, service_cents, addons_cents, discount_cents, subtotal_cents, tax_status, tax_cents, total_cents, deposit_cents, payment_terms, policy_version";

export const maxQuoteScopeLength = 2000;
export const maxQuoteItems = 50;
export const taxPendingLabel = "Tax pending confirmation";

export const emptyItem = (): QuoteItemDraft => ({ kind: "service", description: "", quantity: "1", unit: "" });

/** Drafts from stored lines (to start from a proposal or a sent quote). */
export function draftsFromItems(items: QuoteItem[] | null | undefined): QuoteItemDraft[] {
  return (items ?? []).map((item) => ({ kind: item.kind, description: item.description, quantity: String(item.quantity), unit: (item.unit_cents / 100).toFixed(2) }));
}

type PricingLine = { kind?: unknown; name?: unknown; quantity?: unknown; unit_cents?: unknown; price_kind?: unknown };
/**
 * Starting lines from the homeowner's priced selection (TRACE-112 `pricing_inputs`): the price
 * level as a service line and each add-on with its quantity. Estimates prefill their lower
 * bound; the provider checks every line before proposing.
 */
export function draftsFromPricingInputs(pricingInputs: unknown): QuoteItemDraft[] {
  const lines = (pricingInputs as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines)) return [];
  return (lines as PricingLine[]).flatMap((line) => {
    const unit = typeof line.unit_cents === "number" && line.unit_cents > 0 ? line.unit_cents : null;
    if (unit === null || (line.kind !== "tier" && line.kind !== "addon")) return [];
    const quantity = typeof line.quantity === "number" && line.quantity > 0 ? line.quantity : 1;
    const name = typeof line.name === "string" && line.name.trim() ? line.name.trim() : line.kind === "tier" ? "Service" : "Add-on";
    return [{ kind: line.kind === "tier" ? "service" : "addon", description: name.slice(0, 200), quantity: String(quantity), unit: (unit / 100).toFixed(2) }];
  });
}

export type ItemsResult =
  | { ok: true; items: { kind: QuoteItemKind; description: string; quantity: number; unit_cents: number }[]; subtotal_cents: number }
  | { ok: false; error: string; row: number | null };

/**
 * Validates typed lines the way the server does (whole cents, no rounding) so errors show
 * before sending. The subtotal here is a preview; the server computes the recorded one.
 */
export function parseQuoteItems(drafts: QuoteItemDraft[]): ItemsResult {
  if (!drafts.length || drafts.length > maxQuoteItems) return { ok: false, error: `List between 1 and ${maxQuoteItems} items.`, row: null };
  let positive = 0;
  let discount = 0;
  const items = [];
  for (const [index, draft] of drafts.entries()) {
    const row = index + 1;
    const description = draft.description.trim();
    if (!description || description.length > 200) return { ok: false, error: `Line ${row}: add a description (up to 200 characters).`, row };
    const quantityText = draft.quantity.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(quantityText) || Number(quantityText) <= 0 || Number(quantityText) > 10_000) {
      return { ok: false, error: `Line ${row}: quantity must be greater than 0 with at most two decimals.`, row };
    }
    const unitText = draft.unit.trim().replace(/^\$/, "").replaceAll(",", "");
    if (!/^\d+(\.\d{1,2})?$/.test(unitText) || Number(unitText) <= 0) {
      return { ok: false, error: `Line ${row}: enter a unit price in dollars and cents, like 120 or 119.99.`, row };
    }
    const quantityHundredths = Math.round(Number(quantityText) * 100);
    const unitCents = Math.round(Number(unitText) * 100);
    if ((quantityHundredths * unitCents) % 100 !== 0) {
      return { ok: false, error: `Line ${row}: quantity times unit price must come to whole cents.`, row };
    }
    const amount = (quantityHundredths * unitCents) / 100;
    if (draft.kind === "discount") discount += amount; else positive += amount;
    items.push({ kind: draft.kind, description, quantity: Number(quantityText), unit_cents: unitCents });
  }
  if (positive === 0) return { ok: false, error: "Add at least one service, labor, materials or add-on line.", row: null };
  if (discount >= positive) return { ok: false, error: "Discounts must leave a subtotal greater than $0.", row: null };
  return { ok: true, items, subtotal_cents: positive - discount };
}

export type QuoteFields = { quote_status?: string | null; quote_expires_at?: string | null };

/**
 * Whether a sent quote can still be answered. Before the page clock starts (now = 0) the
 * stored state decides; afterwards a passed deadline closes the window even if the expiry
 * worker has not run yet. The server refuses a late answer either way.
 */
export function quoteWindowOpen(quote: QuoteFields, now: number) {
  if (quote.quote_status !== "submitted") return false;
  if (!now || !quote.quote_expires_at) return true;
  const end = Date.parse(quote.quote_expires_at);
  return Number.isNaN(end) || end > now;
}

/** What the homeowner can do with the current quote (DEC-2026-045 G1). */
export function quoteApproval(terms: QuoteTerms | null): { approvable: boolean; reason: string | null } {
  if (!terms) return { approvable: false, reason: "Mercurius must send an itemized quote before it can be approved." };
  if (terms.tax_status !== "confirmed" || terms.total_cents == null) {
    return { approvable: false, reason: `${taxPendingLabel}. You can review the items now; approval opens when Mercurius sends a final quote with tax confirmed.` };
  }
  return { approvable: true, reason: null };
}

export type VendorQuoteJob = QuoteFields & {
  status: string;
  matching_status?: string | null;
  pricing_mode?: string | null;
  quote_only?: boolean | null;
  quote_revision?: number | null;
  quote_amount?: number | null;
};

export type VendorQuoteView = {
  /** False when the job is not quote work; the panel is then not shown. */
  quoteWork: boolean;
  canPropose: boolean;
  title: string;
  detail: string;
  tone: "info" | "success" | "warning";
};

const proposalStates = new Set(["matched", "quoted", "scheduled"]);

/** What the assigned provider sees about the quote on their job, latest proposal first. */
export function vendorQuoteView(job: VendorQuoteJob, latest: QuoteProposal | null, now: number): VendorQuoteView {
  const quoteWork = isQuoteWork(job);
  if (!quoteWork) return { quoteWork, canPropose: false, title: "", detail: "", tone: "info" };
  const open = job.matching_status === "matched" && proposalStates.has(job.status);
  const amount = job.quote_amount == null ? null : money(job.quote_amount);

  if (job.quote_status === "accepted") {
    return { quoteWork, canPropose: false, tone: "success", title: "Quote accepted",
      detail: `The homeowner accepted ${amount ?? "the quote"}. Agreed terms can’t be changed here; contact Mercurius if the work needs to change.` };
  }
  if (!open) {
    return { quoteWork, canPropose: false, tone: "info", title: "Quote closed", detail: "Quotes can be proposed while the job is scheduled." };
  }
  if (latest?.status === "pending") {
    const stale = latest.based_on_revision !== (job.quote_revision ?? 0);
    return { quoteWork, canPropose: true, tone: stale ? "warning" : "info", title: "Proposal awaiting Mercurius review",
      detail: stale
        ? `You proposed ${cents(latest.subtotal_cents)}, but the quote changed since. Propose again with the current details.`
        : `You proposed ${cents(latest.subtotal_cents)} before tax. Mercurius sends it to the homeowner, corrected with a reason if needed, or returns it to you.` };
  }
  if (latest?.status === "returned" && latest.based_on_revision === (job.quote_revision ?? 0)) {
    return { quoteWork, canPropose: true, tone: "warning", title: "Proposal returned",
      detail: `Mercurius returned your ${cents(latest.subtotal_cents)} proposal: ${latest.decision_reason ?? "no reason recorded"}. Propose again.` };
  }
  if (job.quote_status === "submitted") {
    const deadline = formatEastern(job.quote_expires_at);
    return quoteWindowOpen(job, now)
      ? { quoteWork, canPropose: true, tone: "info", title: "Quote sent to the homeowner",
        detail: `${amount ?? "The quote"} before tax is with the homeowner${deadline ? ` until ${deadline}` : ""}. You can propose a revision; Mercurius decides whether to send it.` }
      : { quoteWork, canPropose: true, tone: "warning", title: "Approval window closed",
        detail: "The homeowner didn’t answer within 24 hours. You can propose a new quote." };
  }
  if (job.quote_status === "declined") {
    return { quoteWork, canPropose: true, tone: "warning", title: "Homeowner declined the quote",
      detail: "The job is not cancelled. Mercurius will follow up; you can propose a revised quote." };
  }
  if (job.quote_status === "expired") {
    return { quoteWork, canPropose: true, tone: "warning", title: "Quote expired",
      detail: "The homeowner didn’t answer within 24 hours. The job is not cancelled; you can propose a new quote." };
  }
  return { quoteWork, canPropose: true, tone: "info", title: "No quote yet",
    detail: "List the work line by line. Mercurius reviews your estimate before the homeowner sees a quote; tax is added only once confirmed." };
}

export const proposalStatusLabel: Record<string, string> = {
  pending: "Awaiting review", sent: "Sent", returned: "Returned", superseded: "Replaced",
};

/** Whether an operator can send this proposal: pending, same provider, current revision. */
export function proposalSendable(proposal: QuoteProposal | null, request: { contractor_id: string | null; quote_revision?: number | null }) {
  return Boolean(proposal && proposal.status === "pending" && proposal.contractor_id === request.contractor_id
    && proposal.based_on_revision === (request.quote_revision ?? 0));
}

// ---------------------------------------------------------------- operator queue (G4–G6)

export type QueueKind = "proposal_missing" | "proposal_review" | "quote_decision" | "deposit_review" | "provider_review" | "accepted_change" | "payment_failed" | "payment_unresolved";
export type QueueItem = {
  kind: QueueKind | string;
  request_id: string;
  service_type: string;
  since: string | null;
  due_at: string | null;
  aged: boolean;
  exception_id: string | null;
  detail: Record<string, unknown>;
};
export const queueKindLabel: Record<string, { title: string; action: string }> = {
  proposal_missing: { title: "Provider proposal missing", action: "No proposal 24 hours after a quote became due. Contact the provider." },
  proposal_review: { title: "Proposal waiting to be sent", action: "Submitted more than 4 hours ago. Send it, correct it or return it." },
  quote_decision: { title: "Homeowner hasn’t decided", action: "Sent more than 12 hours ago. The 24-hour expiry is unchanged." },
  deposit_review: { title: "Deposit review needed", action: "This job asks for a deposit. Record a review before a quote is sent; the beta deposit is $0." },
  provider_review: { title: "Provider not eligible", action: "The assigned provider is suspended or ineligible. Review the job; nothing was unassigned or cancelled." },
  accepted_change: { title: "Change after acceptance", action: "Accepted terms stay as agreed. Resolve through the approved resolution or cancellation process." },
  payment_failed: { title: "Payment not completed", action: "Checkout ended unpaid (confirmed). The quote and request are kept; no new charge was attempted." },
  payment_unresolved: { title: "Payment outcome unknown", action: "No confirmed result. Investigate before any new checkout; do not assume success or failure." },
};

export function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}
export function cents(value: number) {
  return money(Number(value) / 100);
}
