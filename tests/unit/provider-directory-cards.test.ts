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
  type ProfilePackage,
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

type Answer = {
  rows?: unknown[];
  /** Fail this table's read with this zero-based index among its requests. */
  failAt?: number;
  /** Stop returning rows after this many, while the exact count still reports the whole set. */
  truncateAfter?: number;
};

type Request = { table: string; from: number; to: number; ids: string[] | null; count: boolean };

/**
 * A PostgREST-shaped client: `in` filters, `range` windows, an exact count only when it was
 * asked for, and — the point of these tests — a server ceiling on how many rows one successful
 * response may carry. A capped response is a success, not an error.
 */
function client(answers: Record<string, Answer>, { cap = 1000 } = {}) {
  const requests: Request[] = [];
  const from = (table: string) => {
    const answer = answers[table] ?? { rows: [] };
    const state: Request = { table, from: 0, to: Number.MAX_SAFE_INTEGER, ids: null, count: false };
    let column: string | null = null;
    const chain: Record<string, unknown> = {};
    chain.select = (_columns: string, options?: { count?: string }) => {
      state.count = options?.count === "exact";
      return chain;
    };
    chain.in = (name: string, values: string[]) => { column = name; state.ids = values; return chain; };
    for (const step of ["eq", "is", "order", "limit"]) chain[step] = () => chain;
    chain.range = (start: number, end: number) => { state.from = start; state.to = end; return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => {
      const index = requests.filter((request) => request.table === table).length;
      requests.push({ ...state });
      if (answer.failAt === index) {
        return Promise.resolve(resolve({ data: null, error: { message: "Synthetic failure" }, count: null }));
      }
      const all = (answer.rows ?? []).filter((row) =>
        !state.ids || !column || state.ids.includes((row as Record<string, string>)[column]));
      const available = answer.truncateAfter === undefined ? all : all.slice(0, answer.truncateAfter);
      const window = available.slice(state.from, Math.min(state.to + 1, state.from + cap));
      return Promise.resolve(resolve({ data: window, error: null, count: state.count ? all.length : null }));
    };
    return chain;
  };
  return { supabase: { from } as unknown as ReturnType<typeof createClient>, requests };
}

const tablesRead = (requests: Request[]) => [...new Set(requests.map((request) => request.table))];

describe("the directory reads published offers in batches", () => {
  it("reads packages, then levels and extras, and groups them by provider", async () => {
    const { supabase, requests } = client({
      vendor_packages: { rows: [
        packageRow({ id: "p1", contractor_id: "c1", service_id: "lawn-mowing", included_scope: ["Up to 1/4 acre"] }),
        packageRow({ id: "p2", contractor_id: "c2", service_id: "kitchen-remodel", pricing_mode: "custom_quote" }),
      ] },
      package_tiers: { rows: [tierRow({ id: "t1", package_id: "p1", price: "60" })] },
      package_addons: { rows: [addonRow({ id: "a1", package_id: "p1", price: "15", is_required: true })] },
    });

    const result = await fetchPublicProviderOffers(["c1", "c2", "c1"], supabase);

    expect(tablesRead(requests)).toEqual(["vendor_packages", "package_tiers", "package_addons"]);
    // The first window of each read asks for the exact count; the rest do not.
    expect(requests.filter((request) => request.count)).toHaveLength(3);
    if (result.status !== "ready") throw new Error("expected a readable result");
    expect([...result.packages.keys()]).toEqual(["c1", "c2"]);
    const lawn = profileServices({ packages: result.packages.get("c1")!, serviceNames });
    // $60 level plus the required $15 extra: the published starting price, not the level alone.
    expect(offerPriceLine(lawn[0].offers[0])).toEqual({ amount: "$75", detail: "Up to 1/4 acre", kind: "fixed" });
    expect(lawn[0].name).toBe("Lawn Mowing");
  });

  it("asks for nothing when no provider is listed", async () => {
    const { supabase, requests } = client({});
    expect(await fetchPublicProviderOffers([], supabase)).toEqual({ status: "ready", packages: new Map() });
    expect(requests).toEqual([]);
  });

  it("does not read levels or extras when no provider publishes a package", async () => {
    const { supabase, requests } = client({ vendor_packages: { rows: [] } });
    const result = await fetchPublicProviderOffers(["c1"], supabase);
    expect(result).toEqual({ status: "ready", packages: new Map() });
    expect(tablesRead(requests)).toEqual(["vendor_packages"]);
  });

  it("reports a failed package read as unreadable, never as nothing published", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { supabase } = client({ vendor_packages: { failAt: 0 } });
    expect(await fetchPublicProviderOffers(["c1"], supabase)).toEqual({ status: "unavailable" });
  });

  it("refuses to price an offer when a level or extra read fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const packages = { rows: [packageRow({ id: "p1", contractor_id: "c1", service_id: "lawn-mowing" })] };
    const tiers = { rows: [tierRow({ id: "t1", package_id: "p1", price: 60 })] };

    // A missing extra would advertise $60 instead of $75, so the read is reported unreadable.
    expect(await fetchPublicProviderOffers(["c1"], client({ vendor_packages: packages, package_tiers: tiers, package_addons: { failAt: 0 } }).supabase))
      .toEqual({ status: "unavailable" });
    expect(await fetchPublicProviderOffers(["c1"], client({ vendor_packages: packages, package_tiers: { failAt: 0 } }).supabase))
      .toEqual({ status: "unavailable" });
  });
});

// ---------------------------------------------------------------------------------------------
// Response ceilings (Codex P2A review, finding 1)
// ---------------------------------------------------------------------------------------------

/**
 * The reviewer's reproduction: one hundred providers, each with a $100 level and eleven required
 * $1 extras, so 1,100 add-on rows meet a 1,000-row response ceiling. Taking one successful
 * response as the whole set drops the extras that did not arrive and advertises $100 where the
 * provider published $111.
 */
function crowdedDirectory(providerCount = 100, extrasPerPackage = 11) {
  const providerIds = Array.from({ length: providerCount }, (_, index) => `c${String(index).padStart(3, "0")}`);
  const packages = providerIds.map((contractor) => packageRow({
    id: `p-${contractor}`, contractor_id: contractor, service_id: "lawn-mowing",
  }));
  const tiers = providerIds.map((contractor) => tierRow({ id: `t-${contractor}`, package_id: `p-${contractor}`, price: 100 }));
  const addons = providerIds.flatMap((contractor) => Array.from({ length: extrasPerPackage }, (_, index) => addonRow({
    id: `a-${contractor}-${String(index).padStart(2, "0")}`, package_id: `p-${contractor}`, price: 1,
    is_required: true, min_quantity: 1, max_quantity: 1, sort_order: index,
  })));
  return {
    providerIds, packages, tiers, addons,
    answers: { vendor_packages: { rows: packages }, package_tiers: { rows: tiers }, package_addons: { rows: addons } },
  };
}

const priceOf = (offers: Map<string, ProfilePackage[]>, provider: string) =>
  offerPriceLine(profileServices({ packages: offers.get(provider)!, serviceNames })[0].offers[0]).amount;

describe("a capped response is never taken as the whole set", () => {
  it("pages past the ceiling and prices the last provider's complete offer", async () => {
    const { providerIds, packages, tiers, addons, answers } = crowdedDirectory();
    const { supabase, requests } = client(answers, { cap: 1000 });

    // What one capped response alone would have published: the defect this repairs.
    expect(priceOf(groupPublicPackages(packages, tiers, addons.slice(0, 1000)), "c099")).toBe("$100");

    const result = await fetchPublicProviderOffers(providerIds, supabase);

    if (result.status !== "ready") throw new Error("expected a readable result");
    // $100 plus eleven required $1 extras. One response would have said $100.
    expect(priceOf(result.packages, "c099")).toBe("$111");
    expect(priceOf(result.packages, "c000")).toBe("$111");

    const addonRequests = requests.filter((request) => request.table === "package_addons");
    expect(addonRequests.length).toBeGreaterThan(2);
    // Every window starts where the previous one ended, so no row is skipped or read twice.
    expect(addonRequests.map((request) => request.from)).toEqual([0, 500, 1000, 1100]);
    // The ceiling cuts through a package's required extras, not between packages.
    expect(1000 % 11).not.toBe(0);
  });

  it("reports unreadable when the rows that arrive fall short of the reported count", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { providerIds, answers } = crowdedDirectory();
    // The server reports 1,100 add-ons and then stops at 1,000: completeness cannot be shown.
    const { supabase } = client({ ...answers, package_addons: { ...answers.package_addons, truncateAfter: 1000 } });

    expect(await fetchPublicProviderOffers(providerIds, supabase)).toEqual({ status: "unavailable" });
  });

  it("reports unreadable when a later page fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { providerIds, answers } = crowdedDirectory();
    // The first window succeeds; the second does not. The partial rows are not used.
    const { supabase } = client({ ...answers, package_addons: { ...answers.package_addons, failAt: 1 } });

    expect(await fetchPublicProviderOffers(providerIds, supabase)).toEqual({ status: "unavailable" });
  });

  it("pages within every identifier batch, not only the first", async () => {
    // 150 providers: two identifier batches for packages, and two more for their package ids.
    const { providerIds, answers } = crowdedDirectory(150, 11);
    const { supabase, requests } = client(answers, { cap: 1000 });

    const result = await fetchPublicProviderOffers(providerIds, supabase);

    if (result.status !== "ready") throw new Error("expected a readable result");
    expect(priceOf(result.packages, "c149")).toBe("$111");
    expect(result.packages.size).toBe(150);
    const batches = requests.filter((request) => request.table === "package_addons")
      .map((request) => request.ids?.length ?? 0);
    // Two batches of package identifiers, each paged to its own end.
    expect(new Set(batches)).toEqual(new Set([100, 50]));
    expect(batches.filter((size) => size === 50).length).toBeGreaterThan(1);
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
