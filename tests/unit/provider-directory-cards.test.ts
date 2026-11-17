// TRACE-156 (P2A): the provider directory's published-offer reader and the card each listed
// provider gets. Synthetic rows only, shaped like the public reads the storefront already makes.
import { describe, expect, it, vi } from "vitest";
import {
  cardOfferFor,
  cardUnpricedLine,
  offerPriceLine,
  profileServices,
  publishedOffers,
  type CardContext,
} from "@/lib/providerProfile/model";
import {
  fetchPublicProviderOffers,
  groupPublicPackages,
  type AddonRow,
  type PackageRow,
  type TierRow,
} from "@/lib/providerProfile/publicOffers";
import type { createClient } from "@/lib/supabase/client";

const serviceNames = {
  "lawn-mowing": "Lawn Mowing",
  "pest-control": "Pest Control",
  "kitchen-remodel": "Kitchen Remodel",
};

const packageRow = (row: Partial<PackageRow> & Pick<PackageRow, "id" | "contractor_id" | "service_id">): PackageRow => ({
  name: `Package ${row.id}`,
  description: null,
  pricing_mode: "fixed",
  default_frequency: "one-time",
  deposit_amount: null,
  is_active: true,
  needs_review: false,
  sort_order: 0,
  included_scope: null,
  ...row,
});

const tierRow = (row: Partial<TierRow> & Pick<TierRow, "id" | "package_id" | "price">): TierRow => ({
  name: `Level ${row.id}`,
  frequency: null,
  price_kind: null,
  price_max: null,
  includes: null,
  rule_question_key: null,
  rule_conditions: null,
  sort_order: 0,
  ...row,
});

const addonRow = (row: Partial<AddonRow> & Pick<AddonRow, "id" | "package_id" | "price">): AddonRow => ({
  name: `Extra ${row.id}`,
  description: null,
  price_kind: null,
  price_max: null,
  unit_label: null,
  min_quantity: null,
  max_quantity: null,
  is_required: null,
  frequencies: null,
  sort_order: 0,
  ...row,
});

/** A client that answers each table once, in the shape PostgREST returns. */
function client(answers: Record<string, { data?: unknown; error?: { message: string } | null }>) {
  const tables: string[] = [];
  const from = (table: string) => {
    tables.push(table);
    const answer = answers[table] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const step of ["select", "in", "eq", "is", "order", "limit"]) chain[step] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: answer.data ?? null, error: answer.error ?? null }));
    return chain;
  };
  return { supabase: { from } as unknown as ReturnType<typeof createClient>, tables };
}

describe("the directory reads published offers in batches", () => {
  it("reads packages, then levels and extras, and groups them by provider", async () => {
    const { supabase, tables } = client({
      vendor_packages: { data: [
        packageRow({ id: "p1", contractor_id: "c1", service_id: "lawn-mowing", included_scope: ["Up to 1/4 acre"] }),
        packageRow({ id: "p2", contractor_id: "c2", service_id: "kitchen-remodel", pricing_mode: "custom_quote" }),
      ] },
      package_tiers: { data: [tierRow({ id: "t1", package_id: "p1", price: "60" })] },
      package_addons: { data: [addonRow({ id: "a1", package_id: "p1", price: "15", is_required: true })] },
    });

    const result = await fetchPublicProviderOffers(["c1", "c2", "c1"], supabase);

    expect(tables).toEqual(["vendor_packages", "package_tiers", "package_addons"]);
    if (result.status !== "ready") throw new Error("expected a readable result");
    expect([...result.packages.keys()]).toEqual(["c1", "c2"]);
    const lawn = profileServices({ packages: result.packages.get("c1")!, serviceNames });
    // $60 level plus the required $15 extra: the published starting price, not the level alone.
    expect(offerPriceLine(lawn[0].offers[0])).toEqual({ amount: "$75", detail: "Up to 1/4 acre", kind: "fixed" });
    expect(lawn[0].name).toBe("Lawn Mowing");
  });

  it("asks for nothing when no provider is listed", async () => {
    const { supabase, tables } = client({});
    expect(await fetchPublicProviderOffers([], supabase)).toEqual({ status: "ready", packages: new Map() });
    expect(tables).toEqual([]);
  });

  it("does not read levels or extras when no provider publishes a package", async () => {
    const { supabase, tables } = client({ vendor_packages: { data: [] } });
    const result = await fetchPublicProviderOffers(["c1"], supabase);
    expect(result).toEqual({ status: "ready", packages: new Map() });
    expect(tables).toEqual(["vendor_packages"]);
  });

  it("reports a failed package read as unreadable, never as nothing published", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase } = client({ vendor_packages: { error: { message: "Synthetic failure" } } });
    expect(await fetchPublicProviderOffers(["c1"], supabase)).toEqual({ status: "unavailable" });
  });

  it("refuses to price an offer when a level or extra read fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const packages = { data: [packageRow({ id: "p1", contractor_id: "c1", service_id: "lawn-mowing" })] };
    const tiers = { data: [tierRow({ id: "t1", package_id: "p1", price: 60 })] };
    const failure = { error: { message: "Synthetic failure" } };

    // A missing extra would advertise $60 instead of $75, so the read is reported unreadable.
    expect(await fetchPublicProviderOffers(["c1"], client({ vendor_packages: packages, package_tiers: tiers, package_addons: failure }).supabase))
      .toEqual({ status: "unavailable" });
    expect(await fetchPublicProviderOffers(["c1"], client({ vendor_packages: packages, package_tiers: failure }).supabase))
      .toEqual({ status: "unavailable" });
  });
});

describe("rows become packages the shared model can price", () => {
  it("reads numeric strings, a missing cadence and a missing sort order", () => {
    const grouped = groupPublicPackages(
      [packageRow({ id: "p1", contractor_id: "c1", service_id: "lawn-mowing", default_frequency: null, sort_order: null, deposit_amount: "40", pricing_mode: "deposit_quote" })],
      [tierRow({ id: "t1", package_id: "p1", price: "120.50", price_kind: "starting_at", sort_order: null })],
      [],
    );
    const [item] = grouped.get("c1")!;
    expect(item).toMatchObject({ default_frequency: "one-time", sort_order: 0, deposit_amount: 40 });
    expect(item.tiers[0]).toMatchObject({ price: 120.5, frequency: "one-time", sort_order: 0 });
    expect(publishedOffers([item])[0]).toMatchObject({ kind: "quote", estimateLabel: "From $120.50 estimate", depositCents: 4000 });
  });

  it("keeps each package's own levels and extras", () => {
    const grouped = groupPublicPackages(
      [
        packageRow({ id: "p1", contractor_id: "c1", service_id: "lawn-mowing" }),
        packageRow({ id: "p2", contractor_id: "c1", service_id: "pest-control", sort_order: 1 }),
      ],
      [tierRow({ id: "t1", package_id: "p1", price: 60 }), tierRow({ id: "t2", package_id: "p2", price: 90 })],
      [addonRow({ id: "a1", package_id: "p2", price: 10 })],
    );
    expect(grouped.get("c1")!.map((item) => [item.id, item.tiers.map((tier) => tier.id), item.addons.map((addon) => addon.id)]))
      .toEqual([["p1", ["t1"], []], ["p2", ["t2"], ["a1"]]]);
  });

  it("orders equal sort values by id, whichever order the rows arrive in", () => {
    const rows = [
      packageRow({ id: "pb", contractor_id: "c1", service_id: "lawn-mowing" }),
      packageRow({ id: "pa", contractor_id: "c1", service_id: "pest-control" }),
    ];
    const tiers = [tierRow({ id: "tb", package_id: "pa", price: 60 }), tierRow({ id: "ta", package_id: "pa", price: 60 })];
    const order = (packages: PackageRow[], levels: TierRow[]) => {
      const grouped = groupPublicPackages(packages, levels, []);
      return grouped.get("c1")!.map((item) => [item.id, item.tiers.map((tier) => tier.id)]);
    };
    expect(order(rows, tiers)).toEqual([["pa", ["ta", "tb"]], ["pb", []]]);
    expect(order([...rows].reverse(), [...tiers].reverse())).toEqual(order(rows, tiers));
  });
});

describe("a card leads with an offer from its own context", () => {
  const packages = groupPublicPackages(
    [
      packageRow({ id: "p-remodel", contractor_id: "c1", service_id: "kitchen-remodel", pricing_mode: "custom_quote" }),
      packageRow({ id: "p-lawn", contractor_id: "c1", service_id: "lawn-mowing", sort_order: 1, included_scope: ["Up to 1/4 acre"] }),
    ],
    [tierRow({ id: "t1", package_id: "p-lawn", price: 60 })],
    [],
  );
  const services = profileServices({ packages: packages.get("c1")!, serviceNames });
  const card = (context: CardContext) => cardOfferFor(services, context);

  it("shows the provider's first published offer with no narrower context", () => {
    expect(card({ kind: "all" })?.offer.id).toBe("p-remodel");
  });

  it("never answers one category with another category's offer", () => {
    expect(card({ kind: "category", serviceIds: new Set(["lawn-mowing"]) })?.offer.id).toBe("p-lawn");
    // The provider is listed under this category but publishes no offer in it.
    expect(card({ kind: "category", serviceIds: new Set(["pest-control"]) })).toBeNull();
  });

  it("uses only the named service when the directory has an explicit context", () => {
    expect(card({ kind: "service", serviceId: "lawn-mowing" })?.offer.id).toBe("p-lawn");
    expect(card({ kind: "service", serviceId: "pest-control" })).toBeNull();
  });
});

describe("an unpriced card says which case it is", () => {
  it("separates nothing published from a failed read", () => {
    expect(cardUnpricedLine("no_offer").amount).toBe("No published price yet");
    expect(cardUnpricedLine("unavailable").amount).toBe("Pricing unavailable right now");
    for (const reason of ["no_offer", "unavailable"] as const) {
      const line = cardUnpricedLine(reason);
      expect(line.amount).not.toMatch(/\$/);
      expect(line.detail).not.toMatch(/\$/);
    }
  });
});
