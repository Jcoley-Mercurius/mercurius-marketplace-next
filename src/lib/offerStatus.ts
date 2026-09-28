// TRACE-099: provider and offer presentation from stored request state only (MPS §5.2/§6.2,
// CFG-002/009, DEC-2026-007). An offer is never an assignment, "scheduled" after acceptance
// is not an appointment time, and exhausted supply never implies further sourcing.

export const offerTimeZone = "America/New_York";

export type ProviderStatusInput = {
  status: string;
  matching_status?: string | null;
  contractor_id?: string | null;
  preferred_contractor_id?: string | null;
  match_expires_at?: string | null;
  pricing_mode?: string | null;
  quote_only?: boolean | null;
  quote_status?: string | null;
  scheduled_start_at?: string | null;
};

export type ProviderStatusKind =
  | "awaiting_operations"
  | "finding_provider"
  | "offer_pending"
  | "consent_needed"
  | "unavailable"
  | "quote_follow_up"
  | "accepted"
  | "closed";

export type ProviderStatus = {
  kind: ProviderStatusKind;
  /** Short list line; never names an offered provider as assigned. */
  line: string;
  explanation: string;
  nextAction: string | null;
  /** Whether a provider has accepted and is attached to the request. */
  assigned: boolean;
};

const openStatuses = new Set(["pending", "matched", "quoted"]);
const closedStatuses = new Set(["cancelled", "closed"]);

export function isQuoteWork(input: Pick<ProviderStatusInput, "pricing_mode" | "quote_only">) {
  return Boolean(input.quote_only) || (input.pricing_mode != null && input.pricing_mode !== "fixed");
}

export function formatEastern(value: string | number | null | undefined) {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: offerTimeZone }).format(date)} ET`;
}

/** Readable time left in an offer window; the server deadline stays authoritative. */
export function offerTimeLeft(deadline: string | number | null | undefined, now: number) {
  const end = deadline == null ? NaN : new Date(deadline).getTime();
  if (!Number.isFinite(end) || !now) return null;
  const ms = end - now;
  if (ms <= 0) return "Response window closed";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Less than 1 minute left";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m left` : `${minutes}m left`;
}

export function providerStatus(input: ProviderStatusInput): ProviderStatus {
  const matching = input.matching_status ?? null;
  const preferred = Boolean(input.preferred_contractor_id);
  const quote = isQuoteWork(input);

  if (closedStatuses.has(input.status)) {
    return { kind: "closed", line: "No provider will visit", explanation: "This request is closed. No provider will visit for it.", nextAction: null, assigned: false };
  }

  if (openStatuses.has(input.status) && matching !== "matched") {
    if (matching === "awaiting_consent") {
      return {
        kind: "consent_needed",
        line: "Your choice is needed",
        explanation: "Your preferred provider can’t take this request. It won’t be offered to anyone else unless you allow it.",
        nextAction: "Allow another eligible provider, or cancel the request.",
        assigned: false,
      };
    }
    if (matching === "exhausted" || matching === "sourcing") {
      return {
        kind: "unavailable",
        line: "Not available yet in your area",
        explanation: "Not available yet in your area. No eligible provider accepted this request, so nothing is scheduled.",
        nextAction: "You can cancel this request. Nothing has been scheduled.",
        assigned: false,
      };
    }
    if (matching === "offered") {
      const deadline = formatEastern(input.match_expires_at);
      const who = preferred && input.contractor_id === input.preferred_contractor_id ? "your preferred provider" : "an eligible provider";
      return {
        kind: "offer_pending",
        line: "Waiting for a provider to respond",
        explanation: `Offered to ${who}${quote ? " for a quote" : ""}. No provider has accepted yet${deadline ? `; they have until ${deadline} to respond` : ""}.`,
        nextAction: null,
        assigned: false,
      };
    }
    if (matching === "quote_pending") {
      return {
        kind: "quote_follow_up",
        line: "Quote follow-up",
        explanation: "Mercurius is following up on this request’s quote. Nothing is scheduled.",
        nextAction: null,
        assigned: false,
      };
    }
    const preference = preferred ? " Your preferred provider is a preference, not an assignment." : "";
    if (!quote) {
      return {
        kind: "awaiting_operations",
        line: "No provider assigned yet",
        explanation: `Mercurius confirms a provider for fixed-price requests. No provider is assigned yet.${preference}`,
        nextAction: null,
        assigned: false,
      };
    }
    return {
      kind: "finding_provider",
      line: "No provider assigned yet",
      explanation: `This request needs a quote. No provider has been offered it yet.${preference}`,
      nextAction: null,
      assigned: false,
    };
  }

  if (!input.contractor_id) {
    return { kind: "closed", line: "See request details", explanation: "No provider is attached to this request.", nextAction: null, assigned: false };
  }

  const appointment = formatEastern(input.scheduled_start_at);
  const quoteOpen = quote && input.quote_status !== "accepted";
  if (input.status === "scheduled" || input.status === "matched" || input.status === "quoted") {
    return {
      kind: "accepted",
      line: "Provider accepted",
      explanation: [
        "A provider accepted this request.",
        quoteOpen ? "The price isn’t set yet; a quote is required." : null,
        appointment ? `Appointment: ${appointment}.` : "No appointment time is recorded yet.",
      ].filter(Boolean).join(" "),
      nextAction: null,
      assigned: true,
    };
  }
  return { kind: "accepted", line: "Provider assigned", explanation: "A provider is assigned to this request.", nextAction: null, assigned: true };
}

// ---------------------------------------------------------------- vendor offers

export type VendorOfferRow = {
  status: string;
  matching_status?: string | null;
  contractor_id?: string | null;
  pricing_mode?: string | null;
  quote_only?: boolean | null;
  scheduled_start_at?: string | null;
};

export type VendorOfferOutcome =
  | { kind: "accepted"; quote: boolean; appointment: string | null }
  | { kind: "still_open" }
  | { kind: "gone" }
  | { kind: "unknown" };

/**
 * Reads the vendor's own row back after an accept/decline call, whether the call succeeded,
 * failed or lost its response. RLS hides a request once the offer leaves this vendor, so a
 * missing row means the offer is gone (declined, expired, withdrawn or reassigned).
 */
export function vendorOfferOutcome(row: VendorOfferRow | null, contractorId: string, readFailed: boolean): VendorOfferOutcome {
  if (readFailed) return { kind: "unknown" };
  if (!row || row.contractor_id !== contractorId) return { kind: "gone" };
  if (row.matching_status === "matched") {
    return { kind: "accepted", quote: isQuoteWork(row), appointment: formatEastern(row.scheduled_start_at) };
  }
  if (row.matching_status === "offered" && ["matched", "quoted"].includes(row.status)) return { kind: "still_open" };
  return { kind: "gone" };
}

export function isOpenVendorOffer(row: Pick<VendorOfferRow, "status" | "matching_status">) {
  return ["matched", "quoted"].includes(row.status) && row.matching_status === "offered";
}
