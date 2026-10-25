import { describe, expect, it } from "vitest";
import { loadPackageArchives, parsePackageArchives } from "@/lib/packageArchives";
import type { createClient } from "@/lib/supabase/client";

// TRACE-122: the archive readback, and its absence before 20261025001000 is pushed.
const client = (result: { data: unknown; error: { code?: string; message: string } | null }) =>
  ({ rpc: async () => result }) as unknown as ReturnType<typeof createClient>;

describe("package archives", () => {
  it("maps archived package ids to their archive time", async () => {
    const archived = await loadPackageArchives(client({ data: [{ package_id: "p1", archived_at: "2026-10-20T15:00:00Z" }, { package_id: 7 }], error: null }), "c1");
    expect([...archived]).toEqual([["p1", "2026-10-20T15:00:00Z"]]);
  });

  it("reports none while the readback is not deployed", async () => {
    expect((await loadPackageArchives(client({ data: null, error: { code: "PGRST202", message: "not found" } }), "c1")).size).toBe(0);
  });

  it("raises any other failure", async () => {
    await expect(loadPackageArchives(client({ data: null, error: { code: "42501", message: "Provider not found" } }), "c1")).rejects.toMatchObject({ code: "42501" });
  });

  it("ignores a malformed readback", () => {
    expect(parsePackageArchives({}).size).toBe(0);
    expect(parsePackageArchives([null, { package_id: "p", archived_at: null }]).size).toBe(0);
  });
});
