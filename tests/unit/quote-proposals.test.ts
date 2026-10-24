import { describe, expect, it } from "vitest";
import {
  draftsFromItems, draftsFromPricingInputs, parseQuoteItems, proposalSendable, quoteApproval, quoteWindowOpen, vendorQuoteView,
  type QuoteItemDraft, type QuoteProposal, type QuoteTerms,
} from "@/lib/quoteProposals";

const now = Date.parse("2026-10-22T15:00:00Z");
const job = { status: "scheduled", matching_status: "matched", pricing_mode: "custom_quote", quote_only: true, quote_revision: 0, quote_status: null, quote_expires_at: null, quote_amount: null };
const proposal = (over: Partial<QuoteProposal> = {}): QuoteProposal => ({
  id: "p1", request_id: "r1", contractor_id: "c1", items: [], subtotal_cents: 25000, scope: "Full scope", based_on_revision: 0,
  created_at: "2026-10-22T14:00:00Z", status: "pending", decided_at: null, decision_reason: null, quote_id: null, corrected: null, ...over,
});
const line = (over: Partial<QuoteItemDraft> = {}): QuoteItemDraft => ({ kind: "labor", description: "Stump removal", quantity: "2", unit: "100", ...over });
const terms = (over: Partial<QuoteTerms> = {}): QuoteTerms => ({
  quote_id: "q1", items: [], scope: "Scope", service_cents: 25500, addons_cents: 0, discount_cents: 0, subtotal_cents: 25500,
  tax_status: "pending", tax_cents: null, total_cents: null, deposit_cents: 0, payment_terms: "No deposit.", policy_version: "DEC-2026-045", ...over,
});

describe("parseQuoteItems (G1)", () => {
  it("prices lines in whole cents and subtracts discounts", () => {
    const result = parseQuoteItems([line(), line({ kind: "materials", quantity: "1.5", unit: "$20" }), line({ kind: "addon", quantity: "1", unit: "50" }), line({ kind: "discount", quantity: "1", unit: "25" })]);
    expect(result).toMatchObject({ ok: true, subtotal_cents: 25500 });
    if (result.ok) expect(result.items[1]).toEqual({ kind: "materials", description: "Stump removal", quantity: 1.5, unit_cents: 2000 });
  });
  it("names the failing line", () => {
    expect(parseQuoteItems([line(), line({ description: " " })])).toMatchObject({ ok: false, row: 2 });
    expect(parseQuoteItems([line({ quantity: "0" })])).toMatchObject({ ok: false, row: 1 });
    expect(parseQuoteItems([line({ unit: "10.005" })])).toMatchObject({ ok: false, row: 1 });
    expect(parseQuoteItems([line({ quantity: "0.33", unit: "1.01" })])).toMatchObject({ ok: false, error: expect.stringContaining("whole cents") });
  });
  it("refuses discount-only or zeroed quotes", () => {
    expect(parseQuoteItems([line({ kind: "discount" })]).ok).toBe(false);
    expect(parseQuoteItems([line({ quantity: "1" }), line({ kind: "discount", quantity: "1" })]).ok).toBe(false);
    expect(parseQuoteItems([]).ok).toBe(false);
  });
});

describe("prefill", () => {
  it("starts from the homeowner's priced selection: the level and each add-on", () => {
    expect(draftsFromPricingInputs({ lines: [
      { kind: "tier", name: "Up to 2,000 sq ft", quantity: 1, unit_cents: 18000, price_kind: "exact" },
      { kind: "addon", name: "Inside windows", quantity: 3, unit_cents: 1500 },
      { kind: "tier", name: null, unit_cents: null },
    ] })).toEqual([
      { kind: "service", description: "Up to 2,000 sq ft", quantity: "1", unit: "180.00" },
      { kind: "addon", description: "Inside windows", quantity: "3", unit: "15.00" },
    ]);
    expect(draftsFromPricingInputs(null)).toEqual([]);
  });
  it("round-trips stored lines", () => {
    expect(draftsFromItems([{ kind: "labor", description: "x", quantity: 1.5, unit_cents: 2000, amount_cents: 3000 }])).toEqual([{ kind: "labor", description: "x", quantity: "1.5", unit: "20.00" }]);
  });
});

describe("quoteApproval (G1)", () => {
  it("never offers approval while tax is pending or terms are missing", () => {
    expect(quoteApproval(null)).toMatchObject({ approvable: false });
    expect(quoteApproval(terms())).toMatchObject({ approvable: false, reason: expect.stringContaining("Tax pending confirmation") });
  });
  it("offers approval for complete terms with confirmed tax", () => {
    expect(quoteApproval(terms({ tax_status: "confirmed", tax_cents: 1750, total_cents: 27250 }))).toEqual({ approvable: true, reason: null });
  });
});

describe("quoteWindowOpen", () => {
  it("is open only for a submitted quote before its deadline", () => {
    expect(quoteWindowOpen({ quote_status: "submitted", quote_expires_at: "2026-10-22T16:00:00Z" }, now)).toBe(true);
    expect(quoteWindowOpen({ quote_status: "submitted", quote_expires_at: "2026-10-22T15:00:00Z" }, now)).toBe(false);
    expect(quoteWindowOpen({ quote_status: "accepted", quote_expires_at: "2026-10-22T16:00:00Z" }, now)).toBe(false);
  });
  it("defers to stored state before the page clock starts", () => {
    expect(quoteWindowOpen({ quote_status: "submitted", quote_expires_at: "2026-10-22T15:00:00Z" }, 0)).toBe(true);
  });
});

describe("vendorQuoteView", () => {
  it("hides the panel on fixed-price work and before acceptance", () => {
    expect(vendorQuoteView({ ...job, pricing_mode: "fixed", quote_only: false }, null, now).quoteWork).toBe(false);
    expect(vendorQuoteView({ ...job, status: "matched", matching_status: "offered" }, null, now).canPropose).toBe(false);
  });
  it("invites a first estimate, then shows it awaiting review or out of date", () => {
    expect(vendorQuoteView(job, null, now)).toMatchObject({ canPropose: true, title: "No quote yet" });
    expect(vendorQuoteView(job, proposal(), now).detail).toContain("$250.00 before tax");
    expect(vendorQuoteView({ ...job, quote_revision: 1, quote_status: "submitted", quote_expires_at: "2026-10-22T20:00:00Z" }, proposal(), now)).toMatchObject({ tone: "warning" });
  });
  it("explains returned, declined and expired states and stops after acceptance", () => {
    expect(vendorQuoteView(job, proposal({ status: "returned", decision_reason: "Include the permit fee" }), now).detail).toContain("Include the permit fee");
    expect(vendorQuoteView({ ...job, quote_revision: 1, quote_status: "declined" }, proposal({ status: "sent" }), now).canPropose).toBe(true);
    expect(vendorQuoteView({ ...job, quote_revision: 1, quote_status: "expired" }, proposal({ status: "sent" }), now).title).toBe("Quote expired");
    expect(vendorQuoteView({ ...job, quote_revision: 1, quote_status: "accepted", quote_amount: 272.5 }, proposal({ status: "sent" }), now))
      .toMatchObject({ canPropose: false, title: "Quote accepted" });
  });
});

describe("proposalSendable", () => {
  it("needs a pending proposal from the assigned provider on the current revision", () => {
    expect(proposalSendable(proposal(), { contractor_id: "c1", quote_revision: 0 })).toBe(true);
    expect(proposalSendable(proposal(), { contractor_id: "c2", quote_revision: 0 })).toBe(false);
    expect(proposalSendable(proposal(), { contractor_id: "c1", quote_revision: 1 })).toBe(false);
    expect(proposalSendable(proposal({ status: "returned" }), { contractor_id: "c1", quote_revision: 0 })).toBe(false);
  });
});
