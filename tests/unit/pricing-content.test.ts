import { describe, expect, it } from "vitest";
import { contentFromModel } from "@/components/admin/PackageContentEditor";
import {
  addonPriceLabel,
  blockingDetail,
  conditionsLabel,
  isSimpleContent,
  lineAmountLabel,
  newContentId,
  parseBlocking,
  parseContent,
  parsePriceResult,
  priceKindLabel,
  priceResultLabel,
  unresolvedReason,
} from "@/lib/pricingContent";

// TRACE-112/113: price meaning is worded one way everywhere and an estimate is never shown
// as a payable total. Amounts come from the server calculation in whole cents.

describe("price meaning labels", () => {
  it("words exact, starting-at and range prices", () => {
    expect(priceKindLabel("exact", 49.95)).toBe("$49.95");
    expect(priceKindLabel(null, 100)).toBe("$100");
    expect(priceKindLabel("starting_at", 120)).toBe("From $120");
    expect(priceKindLabel("range", 180, 210)).toBe("$180–$210 estimate");
  });

  it("words per-unit, range and plain add-ons", () => {
    expect(addonPriceLabel({ price_kind: "exact", price: 15, price_max: null, unit_label: "can" })).toBe("+$15 per can");
    expect(addonPriceLabel({ price_kind: "range", price: 30, price_max: 60, unit_label: null })).toBe("+$30–$60");
  });

  it("describes rules from the questions they use", () => {
    const questions = [{ question_key: "sqft", question_label: "Square feet", input_type: "number" as const, is_required: true }];
    expect(conditionsLabel([{ question_key: "sqft", min: 0, max: 1500 }], questions)).toBe("Square feet 0–1,500");
    expect(conditionsLabel([{ question_key: "sqft", min: 1501, max: null }], questions)).toBe("Square feet 1,501 or more");
  });
});

describe("calculation results", () => {
  const exact = parsePriceResult({ status: "exact", total_cents: 7995, lines: [
    { kind: "tier", id: "t", name: "One-time", price_kind: "exact", quantity: 1, amount_cents: 4995, amount_max_cents: 4995, required: true },
    { kind: "addon", id: "a", name: "Extra can", unit_label: "can", price_kind: "exact", quantity: 2, amount_cents: 3000, amount_max_cents: 3000, required: false },
  ] })!;

  it("states an exact total only for an exact result", () => {
    expect(priceResultLabel(exact)).toBe("$79.95 total");
    expect(exact.lines).toHaveLength(2);
    expect(lineAmountLabel(exact.lines[1])).toBe("$30");
  });

  it("never presents an estimate, walkthrough or unresolved result as payable", () => {
    expect(priceResultLabel(parsePriceResult({ status: "estimate", min_cents: 18000, max_cents: 21000, lines: [] })!))
      .toBe("Estimate $180–$210; the provider confirms the final price");
    expect(priceResultLabel(parsePriceResult({ status: "estimate", min_cents: 12000, max_cents: null, lines: [] })!))
      .toBe("Estimate from $120; the provider confirms the final price");
    expect(priceResultLabel(parsePriceResult({ status: "quote", lines: [] })!)).toMatch(/^Quote after walkthrough/);
    expect(priceResultLabel(parsePriceResult({ status: "unresolved", reason: "ambiguous_price_levels", min_cents: 9000, lines: [] })!))
      .toMatch(/^Price requires confirmation/);
    expect(priceResultLabel(parsePriceResult({ status: "invalid", reason: "addon_quantity", lines: [] })!)).toMatch(/quantity/);
  });

  it("rejects unknown statuses rather than guessing", () => {
    expect(parsePriceResult({ status: "maybe" })).toBeNull();
    expect(parsePriceResult(null)).toBeNull();
  });
});

describe("content documents", () => {
  it("reads server content and recognises the simple one-price-per-cadence shape", () => {
    const simple = parseContent({ name: "Plan", pricing_mode: "fixed", tiers: [
      { id: "level-monthly", name: "Monthly", frequency: "monthly", price_kind: "exact", price: 40, conditions: [], includes: [] },
    ] })!;
    expect(isSimpleContent(simple)).toBe(true);
    const ruled = parseContent({ name: "Plan", pricing_mode: "fixed", questions: [{ question_key: "sqft", question_label: "Sq ft", input_type: "number" }],
      tiers: [{ id: "a", name: "Small", frequency: "one-time", price: 100, conditions: [{ question_key: "sqft", max: 1500 }] }] })!;
    expect(isSimpleContent(ruled)).toBe(false);
    expect(ruled.tiers[0].conditions).toEqual([{ question_key: "sqft", min: null, max: 1500 }]);
    expect(parseContent({ pricing_mode: "fixed" })).toBeNull();
  });

  it("gives new levels and add-ons ids that do not collide", () => {
    expect(newContentId("level", ["level-1", "level-2"])).toBe("level-3");
    expect(newContentId("addon", ["addon-2"])).toBe("addon-3");
  });

  it("builds editor input into content, refusing amounts it cannot read", () => {
    const model = {
      name: " Synthetic clean ", description: "", pricing_mode: "fixed" as const, deposit: "", included: "Kitchen\nBathrooms\n", policy_notes: "",
      questions: [{ question_key: "sqft", question_label: "Square feet", input_type: "number" as const, unit: "", options: "", is_required: true }],
      tiers: [{ id: "level-1", name: "Small", frequency: "one-time" as const, price_kind: "exact" as const, price: "$120", price_max: "",
        conditions: { sqft: { min: "0", max: "1,500" } }, includes: "" }],
      addons: [{ id: "addon-1", name: "Extra can", description: "", price_kind: "exact" as const, price: "15", price_max: "", unit_label: "can",
        min_quantity: "0", max_quantity: "6", is_required: false, frequencies: [] }],
    };
    const built = contentFromModel(model);
    expect(built.error).toBeNull();
    expect(built.content).toMatchObject({ name: "Synthetic clean", included_scope: ["Kitchen", "Bathrooms"],
      tiers: [{ price: 120, conditions: [{ question_key: "sqft", min: 0, max: 1500 }] }], addons: [{ price: 15, max_quantity: 6, unit_label: "can" }] });
    expect(contentFromModel({ ...model, tiers: [{ ...model.tiers[0], price: "12.345" }] }).error).toMatch(/Enter a price/);
    expect(contentFromModel({ ...model, tiers: [{ ...model.tiers[0], conditions: { sqft: { min: "a lot", max: "" } } }] }).error).toMatch(/must be numbers/);
  });
});

describe("live package content", () => {
  it("reads a legacy single rule ahead of added conditions, as the server does", () => {
    const content = parseContent({ name: "Dump & Clean", pricing_mode: "fixed", tiers: [
      { id: "t1", name: "Up to 2 cans", frequency: "one-time", price: 90, price_kind: null,
        rule_question_key: "cans", rule_min: 1, rule_max: 2, conditions: [{ question_key: "sqft", max: 900 }] },
    ] });
    expect(content?.tiers[0].conditions).toEqual([
      { question_key: "cans", min: 1, max: 2 },
      { question_key: "sqft", min: null, max: 900 },
    ]);
    expect(content?.tiers[0].price_kind).toBe("exact");
  });
});

describe("unmatched answers (DEC-2026-041 item 7)", () => {
  const blocking = (combination: boolean, answers: Array<[string, string | null]>) => ({
    combination, answers: answers.map(([questionLabel, answer]) => ({ questionKey: questionLabel.toLowerCase(), questionLabel, answer })),
  });
  it("says price requires confirmation and names the blocking answer, never an amount", () => {
    expect(unresolvedReason("no_matching_price_level", blocking(false, [["Square feet", "9000"]])))
      .toBe("Price requires confirmation: no price level covers Square feet 9000");
    expect(unresolvedReason("no_matching_price_level", blocking(true, [["Bedrooms", "3"], ["Square feet", "1100"]])))
      .toBe("Price requires confirmation: no single price level covers Bedrooms 3 with Square feet 1100");
    expect(blockingDetail(blocking(false, [["Bedrooms", null]]))).toBe("no price level covers Bedrooms (not answered)");
    expect(unresolvedReason("no_matching_price_level")).toBe("Price requires confirmation: no price level matches these answers");
  });
  it("reads the server shape", () => {
    expect(parseBlocking({ answers: [{ question_key: "sqft", question_label: "Square feet", answer: "9000" }], combination: false }))
      .toEqual(blocking(false, [["Square feet", "9000"]]).answers.length === 1
        ? { answers: [{ questionKey: "sqft", questionLabel: "Square feet", answer: "9000" }], combination: false } : null);
    expect(parseBlocking(null)).toBeNull();
  });
});
