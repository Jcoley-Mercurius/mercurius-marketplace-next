// TRACE-118 (DEC-2026-044): operators add services to the catalog. The id is fixed at creation;
// these cover the id derived from the name, tag parsing, validation and the rows written.
import { describe, expect, it } from "vitest";
import {
  catalogSaveErrorMessage,
  catalogServiceChanges,
  catalogServiceError,
  catalogServiceInsert,
  emptyCatalogService,
  parseTags,
  serviceIdFromName,
  type CatalogService,
} from "@/lib/serviceCatalog";

const existing = [
  { id: "roof-inspection", name: "Roof Inspection", sort_order: 31 },
  { id: "pool-service", name: "Pool Service", sort_order: 29 },
];
const roofReplacement: CatalogService = {
  ...emptyCatalogService("outdoor-exterior"),
  id: "roof-replacement", name: "  Roof Replacement ", descriptor: " Shingle, metal & tile roof replacement ", icon: "HardHat",
  tags: ["roof", "shingles"],
};

describe("serviceIdFromName", () => {
  it("makes a lowercase hyphenated id", () => {
    expect(serviceIdFromName("AC Repair")).toBe("ac-repair");
    expect(serviceIdFromName("Shrub & Hedge Trimming")).toBe("shrub-hedge-trimming");
    expect(serviceIdFromName("  Pool  Resurfacing!! ")).toBe("pool-resurfacing");
    expect(serviceIdFromName("Café Décor")).toBe("cafe-decor");
    expect(serviceIdFromName("&&")).toBe("");
  });

  it("stays within 100 characters without a trailing hyphen", () => {
    const id = serviceIdFromName(`${"a".repeat(99)} b`);
    expect(id).toBe("a".repeat(99));
  });
});

describe("parseTags", () => {
  it("splits on commas, trims, lowercases and drops duplicates and blanks", () => {
    expect(parseTags(" Roof, shingles ,, ROOF, leaks ")).toEqual(["roof", "shingles", "leaks"]);
    expect(parseTags("")).toEqual([]);
  });
});

describe("catalogServiceError", () => {
  it("accepts a new service", () => {
    expect(catalogServiceError(roofReplacement, existing, true)).toBeNull();
  });

  it("refuses a missing, malformed or taken id when adding", () => {
    expect(catalogServiceError({ ...roofReplacement, id: "" }, existing, true)).toBe("Service ID is required.");
    expect(catalogServiceError({ ...roofReplacement, id: "Roof Replacement" }, existing, true)).toMatch(/lowercase letters/);
    expect(catalogServiceError({ ...roofReplacement, id: "roof--replacement" }, existing, true)).toMatch(/lowercase letters/);
    expect(catalogServiceError({ ...roofReplacement, id: "-roof" }, existing, true)).toMatch(/lowercase letters/);
    expect(catalogServiceError({ ...roofReplacement, id: "pool-service" }, existing, true)).toBe('A service with the ID "pool-service" already exists.');
  });

  it("refuses a name already in the catalog, ignoring case and spacing, but not the service's own", () => {
    expect(catalogServiceError({ ...roofReplacement, name: " roof inspection" }, existing, true)).toBe('"Roof Inspection" is already in the catalog.');
    expect(catalogServiceError({ ...roofReplacement, id: "roof-inspection", name: "Roof Inspection" }, existing, false)).toBeNull();
  });

  it("keeps the existing price and cadence rules", () => {
    expect(catalogServiceError({ ...roofReplacement, name: " " }, existing, true)).toBe("Service name is required.");
    expect(catalogServiceError({ ...roofReplacement, category_id: "" }, existing, true)).toBe("Select a category.");
    expect(catalogServiceError({ ...roofReplacement, one_time_price: -1 }, existing, true)).toBe("Prices cannot be negative.");
    expect(catalogServiceError({ ...roofReplacement, pricing_mode: "deposit_quote" }, existing, true)).toMatch(/deposit greater than \$0/);
    expect(catalogServiceError({ ...roofReplacement, available_frequencies: [] }, existing, true)).toBe("Choose at least one cadence the service offers.");
    expect(catalogServiceError({ ...roofReplacement, default_frequency: "weekly" }, existing, true)).toBe("The default cadence must be one the service offers.");
  });
});

describe("rows written", () => {
  it("inserts a trimmed service after every existing one", () => {
    expect(catalogServiceInsert({ ...roofReplacement, available_frequencies: ["one-time", "quarterly"] }, existing)).toEqual({
      id: "roof-replacement", name: "Roof Replacement", descriptor: "Shingle, metal & tile roof replacement", category_id: "outdoor-exterior",
      icon: "HardHat", tags: ["roof", "shingles"], weekly_price: null, monthly_price: 0, one_time_price: 0, default_frequency: "one-time",
      available_frequencies: ["quarterly", "one-time"], pricing_mode: "custom_quote", default_deposit_amount: null,
      is_active: true, is_popular: false, sort_order: 32,
    });
    expect(catalogServiceInsert(roofReplacement, []).sort_order).toBe(0);
  });

  it("never writes the id, sort order or switches on an edit, and clears the deposit outside deposit + quote", () => {
    const changes = catalogServiceChanges({ ...roofReplacement, default_deposit_amount: 50 });
    expect(changes).not.toHaveProperty("id");
    expect(changes).not.toHaveProperty("sort_order");
    expect(changes).not.toHaveProperty("is_active");
    expect(changes.default_deposit_amount).toBeNull();
    expect(catalogServiceChanges({ ...roofReplacement, pricing_mode: "deposit_quote", default_deposit_amount: 50 }).default_deposit_amount).toBe(50);
  });
});

describe("catalogSaveErrorMessage", () => {
  it("explains id and category clashes and passes other messages through", () => {
    expect(catalogSaveErrorMessage({ code: "23505", message: "duplicate key" })).toMatch(/already exists/);
    expect(catalogSaveErrorMessage({ code: "23503", message: "fk" })).toMatch(/category no longer exists/);
    expect(catalogSaveErrorMessage({ code: "42501", message: "permission denied" })).toBe("permission denied");
    expect(catalogSaveErrorMessage(null)).toBe("Please try again.");
  });
});
