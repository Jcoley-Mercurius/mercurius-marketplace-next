import { describe, expect, it } from "vitest";
import {
  choiceFromOption,
  codeMessage,
  offerEndsLabel,
  parseOption,
  parsePromotionOptions,
  parseRequestPromotion,
  promotionPayload,
  promotionReason,
  reconcileChoice,
} from "@/lib/promotionSelection";
import { parseSubmissionResult, refusalMessage } from "@/lib/requestSubmission";
import { describeConfirmation } from "@/lib/requestConfirmation";

// TRACE-116 (DEC-2026-042): offers are chosen explicitly; savings come from the server.
const raw = (id: string, discount: number, extra: Record<string, unknown> = {}) => ({
  offer_id: id, fingerprint: "f".repeat(64), label: `Offer ${id}`, terms: "Synthetic", ends_at: "2026-12-31T23:59:00Z",
  timezone: "America/New_York", first_booking_only: false, requires_code: false, service_cents: 8000, discount_cents: discount,
  total_after_cents: 8000 - discount, best: false, ...extra,
});
const usd = (value: number) => `$${value.toFixed(2)}`;

describe("offer options", () => {
  it("parses an option and refuses one whose total does not follow from its saving", () => {
    expect(parseOption(raw("a", 1000))).toMatchObject({ offerId: "a", serviceCents: 8000, discountCents: 1000, totalAfterCents: 7000 });
    expect(parseOption({ ...raw("a", 1000), total_after_cents: 7100 })).toBeNull();
    expect(parseOption({ ...raw("a", 0) })).toBeNull();
  });

  it("treats an unrecognized response as an error, not as no offers", () => {
    expect(() => parsePromotionOptions(null)).toThrow();
    expect(() => parsePromotionOptions({ selections: [] })).toThrow();
    expect(parsePromotionOptions({ available: false, selections: [] })).toEqual({ available: false, selections: [] });
  });

  it("keeps the server's best-savings label and order, and never selects anything", () => {
    const result = parsePromotionOptions({ available: true, selections: [{ selection_index: 0, service_id: "cans", status: "priced",
      service_cents: 8000, options: [raw("a", 1600, { best: true }), raw("b", 1000)], code: null }] });
    expect(result.selections[0].options.map((option) => [option.offerId, option.best])).toEqual([["a", true], ["b", false]]);
  });
});

describe("choices", () => {
  const option = parseOption(raw("a", 1000))!;
  const choice = choiceFromOption(option, null);

  it("keeps a choice only while the same offer, revision and saving are offered", () => {
    const offers = (options: ReturnType<typeof raw>[]) => ({ selectionIndex: 0, serviceId: "cans", priced: true, serviceCents: 8000,
      options: options.map((item) => parseOption(item)!), code: null });
    expect(reconcileChoice(choice, offers([raw("a", 1000)]))).toEqual({ choice, notice: null });
    expect(reconcileChoice(choice, offers([raw("a", 800)])).choice).toBeNull();
    expect(reconcileChoice(choice, offers([raw("a", 800)])).notice).toBe("“Offer a” changed: it now saves $8 on $80. Choose again.");
    expect(reconcileChoice(choice, offers([{ ...raw("a", 1000), fingerprint: "e".repeat(64) }])).choice).toBeNull();
    expect(reconcileChoice(choice, offers([raw("b", 2000)])).notice).toBe("“Offer a” no longer applies to this service. Choose again.");
  });

  it("sends the offer, revision and saving the homeowner saw, and a code only for a code offer", () => {
    expect(promotionPayload(choice)).toEqual({ offer_id: "a", fingerprint: "f".repeat(64), expected_discount_cents: 1000 });
    const coded = choiceFromOption(parseOption(raw("c", 500, { requires_code: true }))!, "FALL-25");
    expect(promotionPayload(coded)).toEqual({ offer_id: "c", fingerprint: "f".repeat(64), expected_discount_cents: 500, code: "FALL-25" });
    expect(choiceFromOption(option, "IGNORED").code).toBeNull();
    expect(promotionPayload(undefined)).toBeUndefined();
  });
});

describe("wording", () => {
  it("words every server reason for homeowners and never shows a code", () => {
    expect(promotionReason("redemption_limit_reached")).toBe("this offer has been fully claimed");
    expect(promotionReason("first_booking_already_reserved")).toBe("a first-booking offer is already applied to another request");
    expect(promotionReason("something_new")).toBe("this offer can’t be applied");
    expect(codeMessage({ status: "ineligible", reason: "not_first_booking" })).toBe("That code is valid, but this offer is for a first booking only.");
    expect(codeMessage({ status: "too_many_attempts" })).toBe("Too many codes were tried. Try again in an hour.");
    expect(codeMessage({ status: "eligible", offerId: "a" })).toBeNull();
  });

  it("labels an offer's end in its own time zone", () => {
    expect(offerEndsLabel("2026-12-31T23:59:00Z", "America/New_York")).toBe("Ends Dec 31, 2026, 6:59 PM EST");
    expect(offerEndsLabel(null)).toBeNull();
  });

  it("explains a refused offer at submission", () => {
    const result = parseSubmissionResult({ status: "refused", coverage: "covered", requests: [],
      outcomes: [{ selection_index: 0, service_id: "cans", outcome: "promotion_changed", reason: "discount_changed" }] });
    expect(refusalMessage(result.outcomes[0], "Cans", usd)).toBe(
      "Cans: the offer you chose wasn’t applied because the saving changed. Review the offers and choose again, or continue without one.");
  });
});

describe("a request's offer", () => {
  it("parses the applied offer, its problem and the alternatives", () => {
    const state = parseRequestPromotion({ available: true, state: "applied", reason: null, service_cents: 8000, confirmed_service_cents: 7000,
      editable: true, locked_reason: null, credits: null,
      applied: { offer_id: "a", label: "Offer a", terms: "Synthetic", ends_at: null, service_cents: 8000, discount_cents: 1000,
        total_after_cents: 7000, committed: false, problem: "expired" },
      options: [raw("b", 1200)], code: { status: "not_found" } });
    expect(state.applied).toMatchObject({ offerId: "a", problem: "expired", totalAfterCents: 7000 });
    expect(state.options.map((option) => option.offerId)).toEqual(["b"]);
    expect(state.code).toEqual({ status: "not_found" });
    expect(state.offersOpen).toBe(true);
    expect(parseRequestPromotion({ available: true, offers_open: false }).offersOpen).toBe(false);
    expect(() => parseRequestPromotion({})).toThrow();
  });
});

describe("confirmation", () => {
  it("names the saving of an offer submitted with a fixed-price service", () => {
    const [item] = describeConfirmation({
      requests: [{ selection_index: 0, request_id: "r", service_id: "cans", pricing_mode: "fixed", quote_only: false, total_amount: 80,
        package_id: "p", package_tier_id: "t" }],
      serviceNames: { cans: "Cans" }, preferredProviderNames: {}, readback: null, matching: {}, checkout: { kind: "pending" },
      formatMoney: usd, offers: { cans: 1000 },
    });
    expect(item.payment).toContain("Your offer saves $10.00; your dashboard shows it, and checkout shows the final amount.");
  });
});
