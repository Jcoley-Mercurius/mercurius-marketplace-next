import { describe, expect, it } from "vitest";
import { canonicalRequestState } from "../../src/lib/lifecycle";
import { offerTermsErrorMessage, offerTermsView } from "../../src/lib/offerTerms";
import { isOpenVendorOffer, providerStatus, vendorOfferOutcome } from "../../src/lib/offerStatus";
import { serviceRequestStatusLabel } from "../../src/lib/serviceRequestStatus";

const vendor = "00000000-0000-4000-8000-00000000000a";

const record = {
  id: "00000000-0000-4000-8000-0000000000c1",
  consent_hash: "c".repeat(64),
  total_cents: 8000,
  terms: {
    version: "offer-terms-v1",
    provider: { id: vendor, name: "Synthetic other provider" },
    service: { id: "synthetic-lawn", name: "Synthetic lawn" },
    frequency: "one-time",
    offering: { name: "Synthetic other lawn", description: "Mow and haul", policy_notes: "Synthetic policy notes" },
    level: { name: "Standard" },
    scope: { included: ["Edging", "Mowing"], answers: { lot: { answer: 3, label: "Lot size", unit: "acres" } } },
    lines: [
      { kind: "tier", id: "t", name: "Standard", quantity: 1, amount_cents: 7000, required: true },
      { kind: "addon", id: "a", name: "Haul away", quantity: 1, amount_cents: 1000, required: true },
    ],
    amounts: { level_cents: 7000, addon_cents: 1000, total_cents: 8000, currency: "usd" },
    exclusions: {
      earlier_addons_not_included: [{ id: "e", name: "Edge trimming", quantity: 1, amount_cents: 500, required_by_earlier_offering: false }],
      promotion: "none",
      tax: "Any tax is confirmed by Mercurius before payment and shown at checkout",
      tip: "Optional; chosen at checkout",
    },
    submission: { total_cents: 6500 },
  },
};

describe("TRACE-150 offers at other terms", () => {
  it("shows the complete terms, every charge and what isn't included", () => {
    const view = offerTermsView(record);
    expect(view.provider).toBe("Synthetic other provider");
    expect(view.offering).toBe("Synthetic other lawn");
    expect(view.level).toBe("Standard");
    expect(view.frequency).toBe("One time");
    expect(view.included).toEqual(["Edging", "Mowing"]);
    expect(view.answers).toEqual(["Lot size: 3 acres"]);
    expect(view.lines.map((line) => `${line.label}=${line.amount}`)).toEqual(["Standard=$70.00", "Haul away (required by this provider)=$10.00"]);
    expect(view.total).toBe("$80.00");
    expect(view.earlierTotal).toBe("$65.00");
    expect(view.omitted).toEqual(["Edge trimming ($5.00 with the earlier provider) isn't offered in these terms"]);
    expect(view.policy).toBe("Synthetic policy notes");
  });

  it("words refusals without implying the answer was saved", () => {
    expect(offerTermsErrorMessage({ code: "40001", message: "These terms changed" })).toMatch(/changed since you opened them/);
    expect(offerTermsErrorMessage({ code: "22023", message: "You already answered these terms" })).toBe("You already answered these terms.");
    expect(offerTermsErrorMessage({ code: "22023", message: "This provider can't take the service at these terms right now." })).toMatch(/can't take the service/);
    expect(offerTermsErrorMessage(new Error("network"))).toMatch(/wasn't saved/);
  });

  it("never presents a provider's acceptance as confirmation", () => {
    const status = providerStatus({ status: "matched", matching_status: "awaiting_terms", contractor_id: vendor, pricing_mode: "fixed" });
    expect(status.kind).toBe("terms_answer_needed");
    expect(status.assigned).toBe(false);
    expect(status.explanation).toMatch(/Nothing is scheduled or charged until you accept them/);
    expect(serviceRequestStatusLabel("matched", "awaiting_terms")).toBe("Provider terms need your answer");
    expect(canonicalRequestState("matched", "awaiting_terms")).toBe("matching");
  });

  it("tells the provider it accepted and is waiting for the homeowner", () => {
    const row = { status: "matched", matching_status: "awaiting_terms", contractor_id: vendor, pricing_mode: "fixed", quote_only: false, scheduled_start_at: null };
    expect(vendorOfferOutcome(row, vendor, false)).toEqual({ kind: "accepted", quote: false, appointment: null, awaitingTerms: true });
    expect(isOpenVendorOffer(row)).toBe(false);
  });
});
