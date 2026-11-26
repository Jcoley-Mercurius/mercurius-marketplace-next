// TRACE-161: /services redesign. Public catalog parsing, featured destinations, the package price
// shown, the photo set against its provenance manifest, and the server read's failure handling.
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Service } from "@/lib/serviceData";
import {
  FEATURED_SERVICE_IDS,
  fallbackPublicCatalog,
  featuredServices,
  livePriceFor,
  parsePublicCatalog,
  serviceDestination,
  type PublicCatalog,
} from "@/lib/servicesPage/catalog";
import { FEATURED_PHOTO_KEYS, SERVICES_HERO_IMAGE, featuredPhoto, type ResponsiveImage } from "@/lib/servicesPage/imagery";
import { REVEAL_SERVICE_ROW_EVENT, revealServiceRow, serviceIdFromHash, serviceRowAnchor, serviceRowHref } from "@/lib/servicesPage/rowAnchor";

const category = (id: string, name = id) => ({ id, name, icon: "Leaf", sort_order: 0 });
const service = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Name ${id}`, category_id: "lawn-landscape", descriptor: ` About ${id} `, icon: "Leaf", ...extra });

describe("parsePublicCatalog", () => {
  it("keeps well-formed rows in database order and trims text", () => {
    const parsed = parsePublicCatalog([category("lawn-landscape", " Lawn ")], [service("b-service"), service("a-service")]);
    expect(parsed).toEqual({
      categories: [{ id: "lawn-landscape", name: "Lawn" }],
      services: [
        { id: "b-service", name: "Name b-service", categoryId: "lawn-landscape", descriptor: "About b-service", icon: "Leaf" },
        { id: "a-service", name: "Name a-service", categoryId: "lawn-landscape", descriptor: "About a-service", icon: "Leaf" },
      ],
    });
  });

  it("drops malformed rows and keeps a service without a description", () => {
    const parsed = parsePublicCatalog(
      [category("lawn-landscape"), { id: "Bad Id", name: "x" }, { id: "no-name" }, null],
      [service("ok", { descriptor: null }), service("BAD"), service("no-name", { name: "  " }), service("no-category", { category_id: null }), "row"],
    );
    expect(parsed?.categories.map((item) => item.id)).toEqual(["lawn-landscape"]);
    expect(parsed?.services).toEqual([{ id: "ok", name: "Name ok", categoryId: "lawn-landscape", descriptor: "", icon: "Leaf" }]);
  });

  it("bounds long text", () => {
    const parsed = parsePublicCatalog([category("c")], [service("long", { name: "n".repeat(500), descriptor: "d".repeat(500) })]);
    expect(parsed?.services[0].name).toHaveLength(200);
    expect(parsed?.services[0].descriptor).toHaveLength(300);
  });

  it("returns null for an unusable or empty read, so the browser read takes over", () => {
    expect(parsePublicCatalog(null, [service("a")])).toBeNull();
    expect(parsePublicCatalog([category("c")], { rows: [] })).toBeNull();
    expect(parsePublicCatalog([], [service("a")])).toBeNull();
    expect(parsePublicCatalog([category("c")], [])).toBeNull();
  });
});

describe("featured services", () => {
  const catalog: PublicCatalog = {
    categories: [{ id: "c", name: "C" }],
    services: [
      { id: "handyman", name: "Handyman Pro", categoryId: "c", descriptor: "", icon: "" },
      { id: "pool-service", name: "Pool Service", categoryId: "c", descriptor: "", icon: "" },
      { id: "lawn-mowing", name: "Lawn Care", categoryId: "c", descriptor: "", icon: "" },
    ],
  };

  it("are the four verified catalog ids in display order, each with its own photo", () => {
    expect(FEATURED_SERVICE_IDS).toEqual(["lawn-mowing", "house-cleaning", "pool-service", "handyman"]);
    expect(FEATURED_PHOTO_KEYS).toEqual(FEATURED_SERVICE_IDS);
  });

  it("use the catalog's names, lead to their own catalog row, and skip a missing service", () => {
    expect(featuredServices(catalog).map(({ id, name, href }) => ({ id, name, href }))).toEqual([
      { id: "lawn-mowing", name: "Lawn Care", href: "#service-lawn-mowing" },
      { id: "pool-service", name: "Pool Service", href: "#service-pool-service" },
      { id: "handyman", name: "Handyman Pro", href: "#service-handyman" },
    ]);
  });

  it("fall back to the static catalog names when the read failed", () => {
    expect(featuredServices(null).map((item) => item.name)).toEqual(["Lawn Care", "House Cleaning", "Pool Service", "Handyman"]);
  });

  it("never lead to the request form", () => {
    expect(serviceDestination("pool-service")).toBe("/early-access?service=pool-service");
    expect(fallbackPublicCatalog().services.every((item) => !serviceDestination(item.id).startsWith("/request"))).toBe(true);
  });
});

describe("catalog row anchors", () => {
  it("are derived from the catalog id", () => {
    expect(serviceRowAnchor("pool-service")).toBe("service-pool-service");
    expect(serviceRowHref("pool-service")).toBe("#service-pool-service");
  });

  it("read back only a well-formed service fragment", () => {
    expect(serviceIdFromHash("#service-pool-service")).toBe("pool-service");
    expect(serviceIdFromHash("service-handyman")).toBe("handyman");
    for (const hash of ["", "#", "#all-services", "#service-", "#service-Pool", "#service-a b", `#service-${"a".repeat(65)}`, "#services-pool"]) {
      expect(serviceIdFromHash(hash)).toBeNull();
    }
  });

  describe("revealServiceRow", () => {
    const pushState = vi.fn();
    const dispatchEvent = vi.fn();
    beforeEach(() => {
      vi.stubGlobal("window", { location: { hash: "" }, history: { pushState }, dispatchEvent });
      vi.stubGlobal("CustomEvent", class { constructor(public type: string, public init: { detail: string }) {} });
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      pushState.mockReset();
      dispatchEvent.mockReset();
    });

    it("records the fragment once and always asks the catalog to reveal the row", () => {
      revealServiceRow("pool-service");
      expect(pushState).toHaveBeenCalledWith(null, "", "#service-pool-service");
      expect(dispatchEvent.mock.calls[0][0]).toMatchObject({ type: REVEAL_SERVICE_ROW_EVENT, init: { detail: "pool-service" } });

      (window as unknown as { location: { hash: string } }).location.hash = "#service-pool-service";
      revealServiceRow("pool-service");
      expect(pushState).toHaveBeenCalledTimes(1);
      expect(dispatchEvent).toHaveBeenCalledTimes(2);
    });
  });
});

describe("livePriceFor", () => {
  const base = { id: "s", name: "S", categoryId: "c", category: "outdoor", tags: [], icon: "", descriptor: "", avgMonthlyPrice: 0, oneTimePrice: 0, availableFrequencies: [] } as unknown as Service;
  it("shows the default cadence's price when it has one", () => {
    expect(livePriceFor({ ...base, weeklyPrice: 40, oneTimePrice: 90, defaultFrequency: "one-time" })).toEqual({ frequency: "one-time", price: 90, suffix: " one-time" });
  });
  it("otherwise shows the first priced cadence", () => {
    expect(livePriceFor({ ...base, quarterlyPrice: 75, oneTimePrice: 90, defaultFrequency: "weekly" })).toEqual({ frequency: "quarterly", price: 75, suffix: "/quarterly visit" });
  });
  it("shows nothing without a price", () => {
    expect(livePriceFor({ ...base, defaultFrequency: "weekly" })).toBeNull();
  });
});

describe("photos", () => {
  const manifest = JSON.parse(readFileSync("docs/imagery/services-page-imagery-manifest.json", "utf8")) as {
    assets: { key: string; role: string; altText: string; sourcePage: string; creator: string; license: string; licenseUrl: string; sourceSha256: string; approvalStatus: string }[];
  };
  const files = (image: ResponsiveImage) => image.srcSet.split(", ").map((entry) => entry.split(" ")[0]);

  it("every referenced file exists, the largest matches the stated size, and src is in the set", () => {
    const images = [SERVICES_HERO_IMAGE.panel, SERVICES_HERO_IMAGE.banner, ...FEATURED_PHOTO_KEYS.map(featuredPhoto)];
    for (const image of images) {
      for (const file of files(image)) expect(existsSync(`public${file}`), file).toBe(true);
      expect(files(image)).toContain(image.src);
      expect(image.srcSet).toContain(`${image.width}w`);
    }
    expect(SERVICES_HERO_IMAGE.panel.width / SERVICES_HERO_IMAGE.panel.height).toBeCloseTo(1.5, 2);
    expect(SERVICES_HERO_IMAGE.banner.width / SERVICES_HERO_IMAGE.banner.height).toBeCloseTo(2, 2);
    for (const key of FEATURED_PHOTO_KEYS) expect(featuredPhoto(key).width / featuredPhoto(key).height).toBeCloseTo(1.5, 2);
  });

  it("all five have a recorded source, creator and licence, and await the owner's review", () => {
    expect(manifest.assets.map((asset) => asset.key)).toEqual(["hero-home", ...FEATURED_PHOTO_KEYS]);
    for (const asset of manifest.assets) {
      expect(asset.sourcePage).toMatch(/^https:\/\/www\.pexels\.com\/photo\/[a-z0-9-]+-\d+\/$/);
      expect(asset.creator).not.toBe("");
      expect(asset.license).toBe("Pexels License");
      expect(asset.licenseUrl).toBe("https://www.pexels.com/license/");
      expect(asset.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset.approvalStatus).toBe("pending_owner_review");
    }
  });

  it("featured photos have empty alt text; the hero's describes the home without naming a place", () => {
    for (const asset of manifest.assets.filter((item) => item.role === "featured")) expect(asset.altText).toBe("");
    const hero = manifest.assets.find((item) => item.key === "hero-home")!;
    expect(hero.altText).toBe(SERVICES_HERO_IMAGE.alt);
    expect(SERVICES_HERO_IMAGE.alt).not.toMatch(/Lee County|Florida|Palm Beach|Fort Myers|Cape Coral|Mercurius/i);
  });
});

describe("readPublicCatalog", () => {
  const result = { categories: { data: [category("c")], error: null as unknown }, services: { data: [service("a")], error: null as unknown } };
  let throws = false;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55831");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon-key-for-tests");
    throws = false;
    vi.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        from: (table: string) => {
          if (throws) throw new Error("synthetic");
          const reply = table === "service_categories" ? result.categories : result.services;
          const chain = { select: () => chain, eq: () => chain, order: () => chain, abortSignal: () => Promise.resolve(reply) };
          return chain;
        },
      }),
    }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@supabase/supabase-js");
    result.categories.error = null;
    result.services.error = null;
  });

  it("returns the parsed catalog", async () => {
    const { readPublicCatalog } = await import("@/lib/servicesPage/publicCatalogServer");
    expect((await readPublicCatalog())?.services.map((item) => item.id)).toEqual(["a"]);
  });

  it("returns null when either read errors or the client throws", async () => {
    const { readPublicCatalog } = await import("@/lib/servicesPage/publicCatalogServer");
    result.services.error = { message: "denied" };
    expect(await readPublicCatalog()).toBeNull();
    result.services.error = null;
    result.categories.error = { message: "timeout" };
    expect(await readPublicCatalog()).toBeNull();
    result.categories.error = null;
    throws = true;
    expect(await readPublicCatalog()).toBeNull();
  });

  it("returns null when the environment is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const { readPublicCatalog } = await import("@/lib/servicesPage/publicCatalogServer");
    expect(await readPublicCatalog()).toBeNull();
  });
});
