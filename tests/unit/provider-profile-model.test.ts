// Dynamic provider profile view model (exploration; docs/agent/DYNAMIC-PROFILES-HANDOFF.md).
// Synthetic fixtures only.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROFILE_SCENARIOS, SYNTHETIC_COVERAGE_AREAS, profileScenario } from "@/components/mds/profiles/profileFixtures";
import {
  billingBasisLabel,
  cardOffer,
  checkZip,
  defaultOfferSelection,
  logoShape,
  mediaForService,
  nextStepCopy,
  offerPriceLine,
  pricePreview,
  profileServices,
  providerInitials,
  publishedOffers,
  questionsForService,
  reconcileOfferSelection,
  resolveServiceSelection,
  selectedOffer,
  selectionAnnouncement,
  type ProfileService,
} from "@/lib/providerProfile/model";

const data = (slug: string) => profileScenario(slug)!.data;
const services = (slug: string) => profileServices(data(slug));
const service = (slug: string, id: string): ProfileService => services(slug).find((candidate) => candidate.id === id)!;

describe("published offers follow the existing public-eligibility rules", () => {
  it("hides a withdrawn offer and one still under review", () => {
    const ids = publishedOffers(data("palmetto-exterior-care").packages).map((offer) => offer.id);
    expect(ids).toEqual(["pe-windows", "pe-gutters", "pe-pressure"]);
    expect(services("palmetto-exterior-care").map((item) => item.id)).toEqual(["window-cleaning", "gutter-cleaning", "pressure-washing"]);
  });

  it("drops a fixed package with an unpriced level and a deposit quote with no deposit", () => {
    const [fixed] = data("brightbin-can-care").packages;
    const broken = { ...fixed, id: "broken", tiers: [...fixed.tiers, { id: "zero", name: "Zero", price: 0, sort_order: 99 }] };
    const noDeposit = { ...fixed, id: "no-deposit", pricing_mode: "deposit_quote", deposit_amount: null, tiers: [] };
    const unknownMode = { ...fixed, id: "unknown-mode", pricing_mode: "subscription" };
    expect(publishedOffers([broken, noDeposit, unknownMode])).toEqual([]);
  });

  it("classifies each scenario's services by pricing mode", () => {
    expect(services("brightbin-can-care").map((item) => item.mode)).toEqual(["fixed"]);
    expect(services("harborline-remodeling").map((item) => item.mode)).toEqual(["quote", "quote", "quote", "quote"]);
    expect(services("palmetto-exterior-care").map((item) => item.mode)).toEqual(["fixed", "fixed", "quote"]);
  });
});

describe("fixed, recurring and quoted prices stay distinct", () => {
  it("shows a one-time fixed price with its scope", () => {
    const [oneTime] = service("brightbin-can-care", "trash-can-cleaning").offers;
    expect(offerPriceLine(oneTime)).toEqual({ amount: "$45", detail: "Up to 2 cans", kind: "fixed" });
    expect(billingBasisLabel("one-time")).toBe("One-time service");
  });

  it("labels a recurring price with its cadence and per-visit billing", () => {
    const plan = service("brightbin-can-care", "trash-can-cleaning").offers[2];
    expect(plan.cadences.map((cadence) => [cadence.frequency, cadence.baseCents])).toEqual([["monthly", 3000], ["quarterly", 3800]]);
    expect(offerPriceLine(plan)).toEqual({ amount: "$30", detail: "monthly, per visit · Up to 2 cans per visit", kind: "fixed" });
    expect(billingBasisLabel("quarterly")).toBe("Quarterly · billed per visit");
  });

  it("never shows a quoted service as a price", () => {
    const [bath, tub] = service("harborline-remodeling", "bathroom-remodeling").offers;
    expect(offerPriceLine(bath)).toEqual({ amount: "Quote after walkthrough", detail: null, kind: "quote" });
    expect(offerPriceLine(tub)).toEqual({ amount: "Quote after walkthrough", detail: "$6,500–$11,000 estimate", kind: "quote" });
    expect(offerPriceLine(service("harborline-remodeling", "kitchen-remodeling").offers[0]).detail).toBe("From $14,000 estimate");
    expect(bath.cadences).toEqual([]);
  });

  it("keeps a deposit apart from the quote headline", () => {
    const [paint] = service("harborline-remodeling", "interior-painting").offers;
    expect(paint.depositCents).toBe(15000);
    expect(offerPriceLine(paint).amount).toBe("Quote after walkthrough");
  });

  it("qualifies answer-based levels and includes required extras in the price shown", () => {
    const [windows] = service("palmetto-exterior-care", "window-cleaning").offers;
    const [cadence] = windows.cadences;
    expect(cadence).toMatchObject({ baseCents: 16000, qualifier: "from", levels: 2, ruleBased: true });
    expect(cadence.requiredAddons.map((addon) => addon.id)).toEqual(["pe-screens"]);
    expect(cadence.optionalAddons.map((addon) => addon.id)).toEqual(["pe-interior"]);
    expect(offerPriceLine(windows).amount).toBe("From $160");
  });
});

describe("price preview", () => {
  const cans = service("brightbin-can-care", "trash-can-cleaning");
  const [oneTime] = cans.offers;

  it("adds chosen optional extras to an exact published price", () => {
    const preview = pricePreview(oneTime, oneTime.cadences[0], { "bb-extra-can": 2, "bb-deodorize": 1 });
    expect(preview.totalCents).toBe(4500 + 2400 + 800);
    expect(preview.totalLabel).toBe("$77");
    expect(preview.lines.map((line) => [line.label, line.amount])).toEqual([
      ["One-time can cleaning", "$45"], ["Extra can × 2", "$24"], ["Citrus deodorizing treatment", "$8"],
    ]);
  });

  it("caps a quantity at the published maximum", () => {
    expect(pricePreview(oneTime, oneTime.cadences[0], { "bb-extra-can": 40 }).totalCents).toBe(4500 + 4 * 1200);
  });

  it("gives no exact total when a level or an extra is not exact", () => {
    const [windows] = service("palmetto-exterior-care", "window-cleaning").offers;
    const preview = pricePreview(windows, windows.cadences[0], { "pe-interior": 1 });
    expect(preview.totalCents).toBeNull();
    expect(preview.totalLabel).toBe("From $220");
  });
});

describe("service selection comes from the link", () => {
  const list = services("palmetto-exterior-care");

  it("opens All services with no service in the link", () => {
    expect(resolveServiceSelection(null, list)).toEqual({ kind: "all" });
    expect(resolveServiceSelection("  ", list)).toEqual({ kind: "all" });
  });

  it("opens a published service named in the link", () => {
    expect(resolveServiceSelection("gutter-cleaning", list)).toMatchObject({ kind: "service", service: { id: "gutter-cleaning" } });
  });

  it("reports a withdrawn, unoffered or unknown service instead of selecting it", () => {
    expect(resolveServiceSelection("roof-cleaning", list)).toEqual({ kind: "unavailable", requestedId: "roof-cleaning" });
    expect(resolveServiceSelection("trash-can-cleaning", list)).toEqual({ kind: "unavailable", requestedId: "trash-can-cleaning" });
    expect(resolveServiceSelection("retired-service", list)).toEqual({ kind: "unavailable", requestedId: "retired-service" });
  });

  it("announces each view in one sentence", () => {
    expect(selectionAnnouncement("Palmetto Exterior Care", { kind: "all" }, list))
      .toBe("Showing all services from Palmetto Exterior Care: 3 published services.");
    expect(selectionAnnouncement("Palmetto Exterior Care", resolveServiceSelection("pressure-washing", list), list))
      .toBe("Showing Pressure washing: Driveway and walkway washing, Quote after walkthrough.");
    expect(selectionAnnouncement("Palmetto Exterior Care", resolveServiceSelection("roof-cleaning", list), list))
      .toMatch(/^The linked service is not currently offered\. Showing all services/);
  });
});

describe("a stale offer selection never survives a service change", () => {
  const cans = service("brightbin-can-care", "trash-can-cleaning");
  const gutters = service("palmetto-exterior-care", "gutter-cleaning");

  it("defaults to the first offer and its default cadence", () => {
    expect(defaultOfferSelection(cans)).toEqual({ serviceId: "trash-can-cleaning", offerId: "bb-one-time", frequency: "one-time", addons: {} });
    expect(reconcileOfferSelection(cans, null)).toEqual(defaultOfferSelection(cans));
  });

  it("discards a selection made for another service", () => {
    const fromCans = { serviceId: "trash-can-cleaning", offerId: "bb-one-time", frequency: "one-time" as const, addons: { "bb-extra-can": 3 } };
    expect(reconcileOfferSelection(gutters, fromCans)).toEqual(defaultOfferSelection(gutters));
    // Even when the stale selection is relabelled with the new service id.
    expect(reconcileOfferSelection(gutters, { ...fromCans, serviceId: "gutter-cleaning" })).toEqual(defaultOfferSelection(gutters));
  });

  it("drops extras the chosen cadence does not publish and clamps quantities", () => {
    const next = reconcileOfferSelection(cans, {
      serviceId: "trash-can-cleaning", offerId: "bb-plan", frequency: "quarterly",
      addons: { "bb-extra-can": 2, "bb-plan-extra": 9, "pe-guards": 1, "bb-deodorize": -1 },
    });
    expect(next).toEqual({ serviceId: "trash-can-cleaning", offerId: "bb-plan", frequency: "quarterly", addons: { "bb-plan-extra": 4 } });
  });

  it("falls back to a published cadence and clears extras on a quote", () => {
    expect(reconcileOfferSelection(cans, { serviceId: "trash-can-cleaning", offerId: "bb-plan", frequency: "weekly", addons: {} }).frequency).toBe("monthly");
    const bath = service("harborline-remodeling", "bathroom-remodeling");
    const quote = reconcileOfferSelection(bath, { serviceId: "bathroom-remodeling", offerId: "hl-tub", frequency: "weekly", addons: { x: 1 } });
    expect(quote).toEqual({ serviceId: "bathroom-remodeling", offerId: "hl-tub", frequency: "one-time", addons: {} });
    expect(selectedOffer(bath, quote).cadence).toBeNull();
  });
});

describe("directory card offer", () => {
  it("uses the first published offer without a service context", () => {
    expect(cardOffer(services("palmetto-exterior-care"), null)?.offer.id).toBe("pe-windows");
  });

  it("uses the matching service's offer, and omits the provider when it has none", () => {
    expect(cardOffer(services("palmetto-exterior-care"), "pressure-washing")?.line.amount).toBe("Quote after walkthrough");
    expect(cardOffer(services("palmetto-exterior-care"), "roof-cleaning")).toBeNull();
    expect(cardOffer(services("brightbin-can-care"), "pressure-washing")).toBeNull();
  });
});

describe("media and questions follow the selected service", () => {
  const media = data("harborline-remodeling").media;

  it("prefers media linked to the service", () => {
    expect(mediaForService(media, "bathroom-remodeling")).toMatchObject({ general: false, items: [{ id: "hl-m1" }] });
  });

  it("falls back to general media, flagged, and never borrows another service's media", () => {
    expect(mediaForService(media, "drywall-repair")).toMatchObject({ general: true, items: [{ id: "hl-m3" }] });
    expect(mediaForService(media, null)).toMatchObject({ general: true, items: [{ id: "hl-m3" }] });
    expect(mediaForService([], "drywall-repair")).toEqual({ general: true, items: [] });
  });

  it("returns only the selected service's questions", () => {
    const questions = data("palmetto-exterior-care").questions;
    expect(questionsForService(questions, "window-cleaning").map((item) => item.id)).toEqual(["pe-q1"]);
    expect(questionsForService(questions, "gutter-cleaning")).toEqual([]);
  });
});

describe("ZIP check", () => {
  const brightbin = data("brightbin-can-care");
  const check = (zip: string, source = brightbin) => checkZip(zip, source.serviceArea, source.marketplaceZips);

  it("rejects anything that is not five digits", () => {
    for (const value of ["", "3390", "339044", "33 04", "abcde"]) expect(check(value)).toEqual({ status: "invalid" });
  });

  it("separates listed, outside the provider's list and outside the Marketplace area", () => {
    expect(check(" 33904 ")).toEqual({ status: "listed", zip: "33904", city: "Cape Coral" });
    expect(check("33915")).toEqual({ status: "listed", zip: "33915", city: "Cape Coral" });
    expect(check("33901")).toEqual({ status: "outside_provider", zip: "33901" });
    expect(check("33955")).toEqual({ status: "outside_marketplace", zip: "33955" });
  });

  it("is unknown when the provider lists no ZIPs or coverage cannot be read", () => {
    expect(check("33904", data("northside-handyman"))).toEqual({ status: "unknown", zip: "33904", reason: "unlisted" });
    expect(check("33904", data("caloosa-riverbend-property-care"))).toEqual({ status: "unknown", zip: "33904", reason: "unreadable" });
    expect(checkZip("33904", brightbin.serviceArea, null)).toEqual({ status: "unknown", zip: "33904", reason: "unreadable" });
  });
});

describe("next step follows the viewer's current access state", () => {
  it("keeps the live early-access wording for anyone not admitted", () => {
    for (const view of ["all", "fixed", "quote"] as const) expect(nextStepCopy("public", view).label).toBe("Join early access");
  });

  it("names the request step for an admitted homeowner", () => {
    expect(nextStepCopy("invited", "fixed").label).toBe("Continue to request");
    expect(nextStepCopy("invited", "quote").label).toBe("Request a quote");
  });
});

describe("identity fallbacks", () => {
  it("builds initials and classifies logo proportions", () => {
    expect(providerInitials("Northside Handyman")).toBe("NH");
    expect(providerInitials("Brightbin")).toBe("BR");
    expect(providerInitials("  & Sons ")).toBe("SO");
    expect([logoShape(520, 130), logoShape(240, 240), logoShape(220, 300), logoShape(0, 0)]).toEqual(["wide", "square", "tall", "square"]);
  });
});

describe("gallery fixtures", () => {
  it("mirror the approved CFG-001 allowlist migration exactly", () => {
    const sql = readFileSync("supabase/migrations/20260927010000_cfg001_lee_county_coverage.sql", "utf8");
    const allowlist = [...sql.matchAll(/\('(\d{5})', '([^']+)', 'FL'/g)].map(([, zip_code, city]) => `${zip_code}:${city}`).sort();
    expect(allowlist).toHaveLength(47);
    expect(SYNTHETIC_COVERAGE_AREAS.map((area) => `${area.zip_code}:${area.city}`).sort()).toEqual(allowlist);
  });

  it("give every scenario unique ids and links that resolve as described", () => {
    expect(new Set(PROFILE_SCENARIOS.map((scenario) => scenario.slug)).size).toBe(PROFILE_SCENARIOS.length);
    for (const scenario of PROFILE_SCENARIOS) {
      const ids = scenario.data.packages.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(profileServices(scenario.data).length).toBeGreaterThan(0);
    }
  });
});
