import { describe, expect, it } from "vitest";
import {
  formatEastern,
  isOpenVendorOffer,
  offerTimeLeft,
  providerStatus,
  vendorOfferOutcome,
} from "../../src/lib/offerStatus";

const vendor = "00000000-0000-4000-8000-00000000000a";
const other = "00000000-0000-4000-8000-00000000000b";
const deadline = "2026-09-27T20:15:00.000Z"; // 4:15 PM EDT

describe("TRACE-099 homeowner provider status", () => {
  it("never presents a pending offer as an assignment", () => {
    const status = providerStatus({ status: "matched", matching_status: "offered", contractor_id: vendor, match_expires_at: deadline, pricing_mode: "fixed" });
    expect(status.kind).toBe("offer_pending");
    expect(status.assigned).toBe(false);
    expect(status.line).not.toMatch(/assigned|accepted/i);
    expect(status.explanation).toContain("No provider has accepted yet");
    expect(status.explanation).toContain("Sep 27, 2026, 4:15 PM ET");
  });

  it("names a preferred provider's offer and quote work without claiming acceptance", () => {
    const status = providerStatus({ status: "quoted", matching_status: "offered", contractor_id: vendor, preferred_contractor_id: vendor, pricing_mode: "custom_quote" });
    expect(status.explanation).toMatch(/^Offered to your preferred provider for a quote\./);
    const fallback = providerStatus({ status: "matched", matching_status: "offered", contractor_id: other, preferred_contractor_id: vendor, pricing_mode: "fixed" });
    expect(fallback.explanation).toMatch(/^Offered to an eligible provider\./);
  });

  it("asks for consent in both stored consent states and never offers it silently", () => {
    for (const status of ["pending", "matched"]) {
      const result = providerStatus({ status, matching_status: "awaiting_consent", preferred_contractor_id: vendor });
      expect(result.kind).toBe("consent_needed");
      expect(result.explanation).toContain("won’t be offered to anyone else unless you allow it");
      expect(result.nextAction).toMatch(/Allow another eligible provider/);
    }
  });

  it("uses the exact unavailable copy for exhausted and legacy sourcing without a sourcing promise", () => {
    for (const matching of ["exhausted", "sourcing"]) {
      const result = providerStatus({ status: "pending", matching_status: matching, pricing_mode: "custom_quote" });
      expect(result.kind).toBe("unavailable");
      expect(result.line).toBe("Not available yet in your area");
      expect(`${result.explanation} ${result.nextAction}`).not.toMatch(/search|sourcing|looking|finding|we’ll let you know/i);
    }
  });

  it("keeps fixed requests with operations and a preference as a preference", () => {
    const fixed = providerStatus({ status: "pending", matching_status: "awaiting_match", pricing_mode: "fixed", preferred_contractor_id: vendor });
    expect(fixed.kind).toBe("awaiting_operations");
    expect(fixed.explanation).toContain("preference, not an assignment");
    const quote = providerStatus({ status: "pending", matching_status: "awaiting_match", pricing_mode: "custom_quote" });
    expect(quote.kind).toBe("finding_provider");
    expect(quote.assigned).toBe(false);
  });

  it("shows acceptance without inventing an appointment or a price", () => {
    const quote = providerStatus({ status: "scheduled", matching_status: "matched", contractor_id: vendor, pricing_mode: "custom_quote", quote_only: true });
    expect(quote.kind).toBe("accepted");
    expect(quote.assigned).toBe(true);
    expect(quote.explanation).toContain("a quote is required");
    expect(quote.explanation).toContain("No appointment time is recorded yet");
    const booked = providerStatus({ status: "scheduled", matching_status: "matched", contractor_id: vendor, pricing_mode: "fixed", scheduled_start_at: deadline });
    expect(booked.explanation).toBe("A provider accepted this request. Appointment: Sep 27, 2026, 4:15 PM ET.");
    const accepted = providerStatus({ status: "scheduled", matching_status: "matched", contractor_id: vendor, pricing_mode: "deposit_quote", quote_status: "accepted" });
    expect(accepted.explanation).not.toContain("quote is required");
  });

  it("does not show a provider for closed or cancelled requests", () => {
    expect(providerStatus({ status: "cancelled", matching_status: "offered", contractor_id: vendor }).assigned).toBe(false);
    expect(providerStatus({ status: "closed", contractor_id: vendor }).kind).toBe("closed");
  });
});

describe("TRACE-099 offer window formatting", () => {
  const end = Date.parse(deadline);
  it("labels the deadline in Eastern Time from the server timestamp", () => {
    expect(formatEastern(deadline)).toBe("Sep 27, 2026, 4:15 PM ET");
    expect(formatEastern("not a date")).toBeNull();
    expect(formatEastern(null)).toBeNull();
  });
  it("describes remaining time around the boundary without a negative clock", () => {
    expect(offerTimeLeft(deadline, end - 4 * 3_600_000)).toBe("4h 0m left");
    expect(offerTimeLeft(deadline, end - 61_000)).toBe("1m left");
    expect(offerTimeLeft(deadline, end - 1)).toBe("Less than 1 minute left");
    expect(offerTimeLeft(deadline, end)).toBe("Response window closed");
    expect(offerTimeLeft(deadline, end + 1)).toBe("Response window closed");
    expect(offerTimeLeft(null, end)).toBeNull();
    expect(offerTimeLeft(deadline, 0)).toBeNull();
  });
});

describe("TRACE-099 vendor accept/decline read-back", () => {
  it("recognizes an acceptance even when the call's response was lost", () => {
    expect(vendorOfferOutcome({ status: "scheduled", matching_status: "matched", contractor_id: vendor, pricing_mode: "custom_quote", quote_only: true }, vendor, false))
      .toEqual({ kind: "accepted", quote: true, appointment: null });
    expect(vendorOfferOutcome({ status: "scheduled", matching_status: "matched", contractor_id: vendor, pricing_mode: "fixed", scheduled_start_at: deadline }, vendor, false))
      .toEqual({ kind: "accepted", quote: false, appointment: "Sep 27, 2026, 4:15 PM ET" });
  });
  it("treats a hidden or reassigned request as no longer this vendor's offer", () => {
    expect(vendorOfferOutcome(null, vendor, false)).toEqual({ kind: "gone" });
    expect(vendorOfferOutcome({ status: "matched", matching_status: "offered", contractor_id: other }, vendor, false)).toEqual({ kind: "gone" });
    expect(vendorOfferOutcome({ status: "pending", matching_status: "awaiting_match", contractor_id: vendor }, vendor, false)).toEqual({ kind: "gone" });
  });
  it("keeps a still-open offer actionable and never guesses when the read fails", () => {
    expect(vendorOfferOutcome({ status: "quoted", matching_status: "offered", contractor_id: vendor }, vendor, false)).toEqual({ kind: "still_open" });
    expect(vendorOfferOutcome(null, vendor, true)).toEqual({ kind: "unknown" });
  });
  it("identifies actionable offers only from the stored offer state", () => {
    expect(isOpenVendorOffer({ status: "matched", matching_status: "offered" })).toBe(true);
    expect(isOpenVendorOffer({ status: "quoted", matching_status: "offered" })).toBe(true);
    expect(isOpenVendorOffer({ status: "matched", matching_status: "matched" })).toBe(false);
    expect(isOpenVendorOffer({ status: "pending", matching_status: "offered" })).toBe(false);
  });
});
