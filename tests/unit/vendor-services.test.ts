// TRACE-129 (DEC-2026-051): vendor services are saved without publishing; a saved service with
// no price for the vendor can be offered as that vendor's Custom Quote; a service named on an
// application can be added to the catalog as Custom Quote.
import { describe, expect, it } from "vitest";
import { catalogServiceError, catalogServiceInsert } from "@/lib/serviceCatalog";
import {
  catalogServiceFromApplication,
  customQuoteContent,
  QUOTE_REASON_MAX,
  quoteReasonError,
  serviceSaveChanges,
  unpricedServices,
} from "@/lib/vendorServices";

describe("serviceSaveChanges", () => {
  it("writes only the services column, de-duplicated", () => {
    const changes = serviceSaveChanges(["pest-control", "termite-control", "pest-control"]);
    expect(changes).toEqual({ services: ["pest-control", "termite-control"] });
    expect(Object.keys(changes)).toEqual(["services"]);
  });

  it("never touches visibility or marketing", () => {
    const changes = serviceSaveChanges([]) as Record<string, unknown>;
    expect(changes).not.toHaveProperty("is_active");
    expect(changes).not.toHaveProperty("marketing_enabled");
  });
});

describe("unpricedServices", () => {
  it("lists saved services with no package and no open draft", () => {
    expect(unpricedServices(["pest-control", "termite-control", "lawn-mowing"], ["lawn-mowing"], ["termite-control"]))
      .toEqual(["pest-control"]);
  });

  it("treats any package, paused or replaced, as priced", () => {
    expect(unpricedServices(["pest-control"], ["pest-control"], [])).toEqual([]);
  });

  it("is empty when nothing is saved", () => {
    expect(unpricedServices([], [], [])).toEqual([]);
  });
});

describe("customQuoteContent", () => {
  it("is a Custom Quote with no price levels, so nothing is charged without a quote", () => {
    const content = customQuoteContent("  Termite Control ");
    expect(content).toMatchObject({ name: "Termite Control", pricing_mode: "custom_quote", deposit_amount: null, tiers: [], addons: [], questions: [] });
  });
});

describe("quoteReasonError", () => {
  it("requires a reason the vendor can read", () => {
    expect(quoteReasonError("   ")).toMatch(/reason/i);
    expect(quoteReasonError("Onboarding: pricing per job")).toBeNull();
    expect(quoteReasonError("x".repeat(QUOTE_REASON_MAX + 1))).toMatch(/500/);
  });
});

describe("catalogServiceFromApplication", () => {
  const existing = [{ id: "pest-control", name: "Pest Control", sort_order: 37 }];

  it("adds a Custom Quote, shown service with zero reference prices", () => {
    const service = catalogServiceFromApplication(" Bed  Bug Treatment ", "specialty");
    expect(service).toMatchObject({ id: "bed-bug-treatment", name: "Bed Bug Treatment", category_id: "specialty", pricing_mode: "custom_quote", is_active: true, monthly_price: 0, one_time_price: 0, weekly_price: null });
    expect(catalogServiceError(service, existing, true)).toBeNull();
    expect(catalogServiceInsert(service, existing)).toMatchObject({ id: "bed-bug-treatment", sort_order: 38, pricing_mode: "custom_quote", is_active: true });
  });

  it("refuses a service already in the catalog, by id or by name", () => {
    expect(catalogServiceError(catalogServiceFromApplication("pest control", "specialty"), existing, true)).toMatch(/already exists/);
    expect(catalogServiceError({ ...catalogServiceFromApplication("Pest Control", "specialty"), id: "pest-control-2" }, existing, true)).toMatch(/already in the catalog/);
  });
});
