// TRACE-156 (P2B): the provider profile route's reader, access states, request binding and
// directory return. Synthetic rows only, shaped like the public reads the storefront makes.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/completedJobs", () => ({ fetchCompletedJobCounts: vi.fn(async (ids: string[]) => new Map(ids.map((id) => [id, 4]))) }));

import {
  directoryContextFrom,
  nextStepCopy,
  profileServices,
  profileViewer,
  providerDirectoryHref,
  providerProfileHref,
  publishedOffers,
  validProviderId,
  validSearch,
  validSlug,
  type ProfilePackage,
} from "@/lib/providerProfile/model";
import { fetchPublicProviderProfile } from "@/lib/providerProfile/publicProfile";
import type { createClient } from "@/lib/supabase/client";

const PROVIDER = "00000000-0000-4000-8000-0000000000a1";

// ---------------------------------------------------------------------------------------------
// A PostgREST-shaped client: `in`/`eq` filters by column, `range` windows, an exact count only
// when asked for, a server ceiling per response, and RPC answers.
// ---------------------------------------------------------------------------------------------

type Answer = { rows?: Record<string, unknown>[]; fail?: boolean; truncateAfter?: number };
type RpcAnswer = { data?: unknown; error?: unknown };

function client(tables: Record<string, Answer>, rpcs: Record<string, RpcAnswer>, { cap = 1000 } = {}) {
  const requests: string[] = [];
  const from = (table: string) => {
    const answer = tables[table] ?? { rows: [] };
    const filters: Array<[string, unknown[]]> = [];
    let range = [0, Number.MAX_SAFE_INTEGER];
    let count = false;
    const chain: Record<string, unknown> = {};
    chain.select = (_columns: string, options?: { count?: string }) => { count = options?.count === "exact"; return chain; };
    chain.in = (column: string, values: unknown[]) => { filters.push([column, values]); return chain; };
    chain.eq = (column: string, value: unknown) => { filters.push([column, [value]]); return chain; };
    for (const step of ["is", "order", "limit"]) chain[step] = () => chain;
    chain.range = (start: number, end: number) => { range = [start, end]; return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => {
      requests.push(table);
      if (answer.fail) return Promise.resolve(resolve({ data: null, error: { message: "Synthetic failure" }, count: null }));
      const all = (answer.rows ?? []).filter((row) => filters.every(([column, values]) => !(column in row) || values.includes(row[column])));
      const available = answer.truncateAfter === undefined ? all : all.slice(0, answer.truncateAfter);
      const window = available.slice(range[0], Math.min(range[1] + 1, range[0] + cap));
      return Promise.resolve(resolve({ data: window, error: null, count: count ? all.length : null }));
    };
    return chain;
  };
  const rpc = (name: string) => {
    requests.push(`rpc:${name}`);
    const answer = rpcs[name] ?? { data: null };
    const result = { data: answer.data ?? null, error: answer.error ?? null };
    return { maybeSingle: () => Promise.resolve(result), then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result)) };
  };
  return { supabase: { from, rpc } as unknown as ReturnType<typeof createClient>, requests };
}

const listing = {
  id: PROVIDER, name: "Synthetic Gutter Co", logo_url: null, bio: "Synthetic description", location: "Cape Coral, FL",
  badges: ["Licensed"], services: ["gutter-cleaning", "pressure-washing"], years_experience: 7, our_promise: "Synthetic promise",
  verified_specialty: "Gutters", video_url: "https://www.youtube.com/watch?v=synthetic", tagline: null, website: null,
};

const packages = [
  { id: "pkg-gutter", contractor_id: PROVIDER, service_id: "gutter-cleaning", name: "Gutter clean-out", description: null, pricing_mode: "fixed",
    default_frequency: "one-time", deposit_amount: null, is_active: true, needs_review: false, sort_order: 0, included_scope: ["Up to 150 ft"] },
  { id: "pkg-sized", contractor_id: PROVIDER, service_id: "gutter-cleaning", name: "Sized clean-out", description: null, pricing_mode: "fixed",
    default_frequency: "one-time", deposit_amount: null, is_active: true, needs_review: false, sort_order: 1, included_scope: null },
  { id: "pkg-wash", contractor_id: PROVIDER, service_id: "pressure-washing", name: "Driveway wash", description: null, pricing_mode: "custom_quote",
    default_frequency: "one-time", deposit_amount: null, is_active: true, needs_review: false, sort_order: 2, included_scope: null },
];

const tiers = [
  { id: "t-gutter", package_id: "pkg-gutter", name: "Standard", price: 120, frequency: "one-time", price_kind: null, price_max: null, includes: null, rule_question_key: null, rule_conditions: null, sort_order: 0 },
  { id: "t-small", package_id: "pkg-sized", name: "Small home", price: 100, frequency: "one-time", price_kind: null, price_max: null, includes: null, rule_question_key: null, rule_conditions: [{ question_key: "bedrooms", max: 2 }], sort_order: 0 },
  { id: "t-large", package_id: "pkg-sized", name: "Large home", price: 180, frequency: "one-time", price_kind: null, price_max: null, includes: null, rule_question_key: null, rule_conditions: [{ question_key: "bedrooms", min: 3 }], sort_order: 1 },
];

const addons = [
  { id: "a-req", package_id: "pkg-gutter", name: "Downspout flush", description: null, price: 25, price_kind: null, price_max: null, unit_label: null, min_quantity: 1, max_quantity: 1, is_required: true, frequencies: null, sort_order: 0 },
  { id: "a-opt", package_id: "pkg-gutter", name: "Guard install", description: null, price: 40, price_kind: null, price_max: null, unit_label: "section", min_quantity: 1, max_quantity: 4, is_required: false, frequencies: null, sort_order: 1 },
];

const questions = [
  { id: "q-bed", package_id: "pkg-sized", question_key: "bedrooms", question_label: "Bedrooms", input_type: "number", unit: "bedrooms", options: null, is_required: true, sort_order: 0 },
];

const reviews = { summary: { count: 2, average: 4.5 }, reviews: [
  { id: "r1", rating: 5, comment: "Synthetic", created_at: "2026-11-01T12:00:00Z", edited: false },
  { id: "r2", rating: 4, comment: null, created_at: "2026-11-02T12:00:00Z", edited: false },
] };

const coverage = [{ zip_code: "33904", city: "Cape Coral" }, { zip_code: "33901", city: "Fort Myers" }];

const healthy = (): Record<string, Answer> => ({
  vendor_packages: { rows: packages },
  package_tiers: { rows: tiers },
  package_addons: { rows: addons },
  package_qualifying_questions: { rows: questions },
  services_catalog: { rows: [{ id: "gutter-cleaning", name: "Gutter cleaning" }, { id: "pressure-washing", name: "Pressure washing" }] },
  contractor_gallery: { rows: [{ id: "g1", contractor_id: PROVIDER, image_url: "https://synthetic.invalid/1.jpg", caption: "Synthetic", sort_order: 0, contractor_gallery_services: [{ service_id: "gutter-cleaning" }] }] },
  contractor_service_zips: { rows: [{ contractor_id: PROVIDER, zip_code: "33904" }] },
  coverage_areas: { rows: coverage },
});

const rpcs = (overrides: Record<string, RpcAnswer> = {}): Record<string, RpcAnswer> => ({
  r0_public_providers: { data: listing },
  public_provider_reviews: { data: reviews },
  ...overrides,
});

async function read(tables = healthy(), rpcAnswers = rpcs(), options?: { cap?: number }) {
  const { supabase, requests } = client(tables, rpcAnswers, options);
  return { result: await fetchPublicProviderProfile(PROVIDER, supabase), requests };
}

function ready(result: Awaited<ReturnType<typeof fetchPublicProviderProfile>>) {
  if (result.status !== "ready") throw new Error(`expected ready, got ${result.status}`);
  return result.profile;
}

describe("the profile reads one provider through the existing public reads", () => {
  it("assembles a complete profile, keeping supported business information", async () => {
    const { result, requests } = await read();
    const { data, questions: byPackage } = ready(result);
    expect(data.offersStatus).toBe("ready");
    expect(data.packages.map((item) => item.id)).toEqual(["pkg-gutter", "pkg-sized", "pkg-wash"]);
    expect(data.business).toEqual({ yearsExperience: 7, ourPromise: "Synthetic promise", verifiedSpecialty: "Gutters", videoUrl: "https://www.youtube.com/watch?v=synthetic", completedJobs: 4 });
    expect(data.reviews?.summary.count).toBe(2);
    expect(data.serviceArea?.hasListedZips).toBe(true);
    expect([...(data.marketplaceZips ?? [])].sort()).toEqual(["33901", "33904"]);
    expect(data.mediaStatus).toBe("ready");
    expect(data.listedServiceIds).toEqual(["gutter-cleaning", "pressure-washing"]);
    // No published service-question source exists, so none is invented.
    expect(data.questions).toEqual([]);
    expect(byPackage?.get("pkg-sized")?.map((question) => question.question_key)).toEqual(["bedrooms"]);
    // TRACE-122: the size guide follows the bedroom-conditioned levels, for that offer only.
    expect(Object.keys(data.sizeGuides ?? {})).toEqual(["pkg-sized"]);
    // Legacy promotions stay closed: no promotion read, no clock read.
    expect(requests.some((name) => name.includes("promotion") || name === "rpc:pricing_server_now")).toBe(false);
  });

  it("is missing when the listing has no such provider, and an error when the listing fails", async () => {
    expect((await read(healthy(), rpcs({ r0_public_providers: { data: null } }))).result).toEqual({ status: "missing" });
    const failed = (await read(healthy(), rpcs({ r0_public_providers: { error: { message: "Synthetic" } } }))).result;
    expect(failed.status).toBe("error");
  });

  it("never prices from an incomplete extras read: the offers are unavailable, not cheaper and not absent", async () => {
    for (const broken of [{ package_addons: { fail: true } }, { package_tiers: { fail: true } }, { vendor_packages: { fail: true } },
      { package_addons: { rows: addons, truncateAfter: 1 } }]) {
      const { data } = ready((await read({ ...healthy(), ...broken })).result);
      expect(data.offersStatus).toBe("unavailable");
      expect(data.packages).toEqual([]);
      // The provider's listing is still shown, so the profile can say what it is listed for.
      expect(data.listedServiceIds).toEqual(["gutter-cleaning", "pressure-washing"]);
    }
  });

  it("keeps each level's whole published rule, including rule_min and rule_max", async () => {
    const ruled = { ...tiers[1], rule_question_key: "bedrooms", rule_min: 0, rule_max: 2, rule_conditions: null };
    const { data } = ready((await read({ ...healthy(), package_tiers: { rows: [tiers[0], ruled, tiers[2]] } })).result);
    const level = data.packages.find((item) => item.id === "pkg-sized")!.tiers.find((tier) => tier.id === "t-small")!;
    expect(level).toMatchObject({ rule_question_key: "bedrooms", rule_min: 0, rule_max: 2 });
    // A rule_question_key level is answer-based, so the request binds no level for it.
    const sized = profileServices(data).find((service) => service.id === "gutter-cleaning")!.offers.find((offer) => offer.id === "pkg-sized")!;
    expect(sized.cadences[0]).toMatchObject({ ruleBased: true, boundTier: null, qualifier: "from" });
  });

  it("prices the required extra into the starting price when every row arrives", async () => {
    const { data } = ready((await read()).result);
    const gutter = profileServices(data).find((service) => service.id === "gutter-cleaning")!;
    expect(gutter.offers[0].cadences[0].baseCents).toBe(14500);
  });

  it("reports unreadable questions as unknown, not as none, and shows no size guide it cannot derive", async () => {
    const { data, questions: byPackage } = ready((await read({ ...healthy(), package_qualifying_questions: { fail: true } })).result);
    expect(byPackage).toBeNull();
    expect(data.sizeGuides).toEqual({});
    expect(data.offersStatus).toBe("ready");
  });

  it("carries each photo's saved service links, and none means general business", async () => {
    const rows = [
      { id: "g1", contractor_id: PROVIDER, image_url: "https://synthetic.invalid/1.jpg", caption: null, sort_order: 0, contractor_gallery_services: [{ service_id: "gutter-cleaning" }, { service_id: "pressure-washing" }] },
      { id: "g2", contractor_id: PROVIDER, image_url: "https://synthetic.invalid/2.jpg", caption: null, sort_order: 1, contractor_gallery_services: [] },
    ];
    const { data } = ready((await read({ ...healthy(), contractor_gallery: { rows } })).result);
    expect(data.mediaStatus).toBe("ready");
    expect(data.media.map((item) => item.service_ids)).toEqual([["gutter-cleaning", "pressure-washing"], []]);
  });

  it("treats unreadable service links as an unavailable gallery, never as general photos", async () => {
    const rows = [{ id: "g1", contractor_id: PROVIDER, image_url: "https://synthetic.invalid/1.jpg", caption: null, sort_order: 0 }];
    const { data } = ready((await read({ ...healthy(), contractor_gallery: { rows } })).result);
    expect(data.mediaStatus).toBe("unavailable");
    expect(data.media).toEqual([]);
  });

  it("marks each other unreadable section separately", async () => {
    const { data } = ready((await read(
      { ...healthy(), contractor_gallery: { fail: true }, contractor_service_zips: { fail: true } },
      rpcs({ public_provider_reviews: { data: [] } }),
    )).result);
    expect(data.mediaStatus).toBe("unavailable");
    expect(data.media).toEqual([]);
    expect(data.serviceArea).toBeNull();
    expect(data.marketplaceZips).not.toBeNull();
    // An array is not the review RPC's shape: unreadable, never "no reviews".
    expect(data.reviews).toBeNull();
    expect(data.offersStatus).toBe("ready");
  });

  it("treats a capped coverage read as unreadable rather than as a smaller county", async () => {
    const { data } = ready((await read({ ...healthy(), coverage_areas: { rows: coverage, truncateAfter: 1 } })).result);
    expect(data.marketplaceZips).toBeNull();
    expect(data.serviceArea).toBeNull();
  });
});

describe("a request binds a level only when the homeowner has nothing to choose", () => {
  const offer = (tierRows: ProfilePackage["tiers"]) => publishedOffers([{
    id: "p", service_id: "s", name: "P", description: null, pricing_mode: "fixed", default_frequency: "one-time",
    deposit_amount: null, is_active: true, needs_review: false, sort_order: 0, tiers: tierRows, addons: [],
  }])[0];

  it("binds the one published level without an answer rule", () => {
    expect(offer([{ id: "only", name: "Only", price: 90, sort_order: 0 }]).cadences[0].boundTier).toEqual({ id: "only", name: "Only", includes: [] });
  });

  it("does not bind the cheapest of several levels, nor an answer-based level", () => {
    expect(offer([{ id: "a", name: "A", price: 90, sort_order: 0 }, { id: "b", name: "B", price: 150, sort_order: 1 }]).cadences[0].boundTier).toBeNull();
    expect(offer([{ id: "r", name: "R", price: 90, sort_order: 0, rule_question_key: "sqft" }]).cadences[0].boundTier).toBeNull();
    expect(offer([{ id: "c", name: "C", price: 90, sort_order: 0, rule_conditions: [{ question_key: "bedrooms", max: 2 }] }]).cadences[0].boundTier).toBeNull();
  });
});

describe("the next step follows the live admission read", () => {
  const cell = (state: string) => ({ state });
  it("maps each admission state, and never reads an error as access", () => {
    expect(profileViewer({ status: "loading" })).toBe("loading");
    expect(profileViewer({ status: "signed_out" })).toBe("signed_out");
    expect(profileViewer({ status: "error" })).toBe("error");
    expect(profileViewer({ status: "ready", access: { homeowner: true, cells: [cell("active")] } })).toBe("invited");
    expect(profileViewer({ status: "ready", access: { homeowner: false, cells: [cell("active")] } })).toBe("not_homeowner");
    expect(profileViewer({ status: "ready", access: { homeowner: true, cells: [] } })).toBe("waiting");
    expect(profileViewer({ status: "ready", access: { homeowner: true, cells: [cell("revoked")] } })).toBe("revoked");
    expect(profileViewer({ status: "ready", access: { homeowner: true, cells: [cell("unavailable"), cell("revoked")] } })).toBe("unavailable");
  });

  it("offers a request only to an invited homeowner, and asks for a service first in All services", () => {
    expect(nextStepCopy("signed_out", "fixed")).toMatchObject({ label: "Join early access", kind: "early_access" });
    expect(nextStepCopy("not_homeowner", "fixed").kind).toBe("early_access");
    expect(nextStepCopy("loading", "fixed").kind).toBe("pending");
    expect(nextStepCopy("error", "fixed").kind).toBe("retry");
    for (const viewer of ["waiting", "revoked", "unavailable"] as const) expect(nextStepCopy(viewer, "fixed").kind).toBe("closed");
    expect(nextStepCopy("invited", "fixed")).toMatchObject({ label: "Continue to request", kind: "request" });
    expect(nextStepCopy("invited", "all", { hasServices: true }).kind).toBe("choose_service");
    expect(nextStepCopy("invited", "all", { hasServices: false }).kind).toBe("request");
  });
});

describe("directory links carry validated values, never a URL", () => {
  it("validates ids and search text", () => {
    expect(validSlug("gutter-cleaning")).toBe("gutter-cleaning");
    for (const bad of ["", " ", "__proto__", "../x", "Gutter", "a".repeat(65), "https://evil.invalid"]) expect(validSlug(bad)).toBeNull();
    expect(validProviderId(PROVIDER)).toBe(PROVIDER);
    expect(validProviderId("not-a-uuid")).toBeNull();
    expect(validSearch("  palm\u0000 beach\n ")).toBe("palm  beach");
    expect(validSearch("x".repeat(300))).toHaveLength(100);
  });

  it("builds the profile link from the card", () => {
    expect(providerProfileHref(PROVIDER, { serviceId: "gutter-cleaning", search: "palm", categoryId: "outdoor" }))
      .toBe(`/providers/${PROVIDER}?service=gutter-cleaning&q=palm&category=outdoor`);
    expect(providerProfileHref(PROVIDER, { serviceId: "Bad Id", categoryId: "//evil" })).toBe(`/providers/${PROVIDER}`);
  });

  it("always returns to the directory, whatever the address carries", () => {
    const context = directoryContextFrom(new URLSearchParams("q=https%3A%2F%2Fevil.invalid&category=%2F%2Fevil&return=https://evil.invalid"));
    expect(context).toEqual({ search: "https://evil.invalid", categoryId: null });
    const href = providerDirectoryHref({ ...context, providerId: PROVIDER });
    expect(href.startsWith("/providers?")).toBe(true);
    expect(new URL(href, "https://mercurius.invalid").origin).toBe("https://mercurius.invalid");
    expect(new URL(href, "https://mercurius.invalid").searchParams.get("q")).toBe("https://evil.invalid");
    expect(providerDirectoryHref({ search: "palm", categoryId: "outdoor", providerId: PROVIDER }))
      .toBe(`/providers?q=palm&category=outdoor&provider=${PROVIDER}`);
    expect(providerDirectoryHref()).toBe("/providers");
  });
});
