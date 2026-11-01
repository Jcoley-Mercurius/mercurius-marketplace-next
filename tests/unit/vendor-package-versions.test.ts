import { describe, expect, it } from "vitest";
import type { createClient } from "@/lib/supabase/client";
import {
  loadPackageRevisions,
  packageSaveKey,
  PackageVersionError,
  parsePackageRevisions,
  savePackageVersion,
  setPackageActive,
} from "@/lib/vendorPackageVersions";

// TRACE-134 (6.11A): the vendor's keyed, stale-guarded save and publish/pause commands.
const client = (result: { data: unknown; error: { code?: string; message: string } | null }, calls: unknown[] = []) =>
  ({ rpc: async (name: string, args: unknown) => { calls.push([name, args]); return result; } }) as unknown as ReturnType<typeof createClient>;

const content = { service_id: "lawn", package: { name: "Plan", pricing_mode: "fixed" as const, default_frequency: "monthly" },
  tiers: [{ name: "Monthly", price: 80, frequency: "monthly" }] };

describe("vendor package versions", () => {
  it("sends one keyed save with the version it was read from", async () => {
    const calls: unknown[] = [];
    const result = await savePackageVersion(client({ data: { package_id: "p2", new_version: true }, error: null }, calls),
      { packageId: "p1", expectedRevision: "hash-1", content, publish: true, saveKey: "key-0000000000000001" });
    expect(result).toMatchObject({ package_id: "p2", new_version: true });
    expect(calls).toEqual([["vendor_save_package", { p_package: "p1", p_expected_revision: "hash-1", p_content: content, p_publish: true, p_save_key: "key-0000000000000001" }]]);
  });

  it("marks a stale read so the editor can reload", async () => {
    const failure = savePackageVersion(client({ data: null, error: { code: "40001", message: "A newer version of this price was saved; reload before saving" } }),
      { packageId: "p1", expectedRevision: "old", content, publish: true, saveKey: "key-0000000000000002" });
    await expect(failure).rejects.toBeInstanceOf(PackageVersionError);
    await expect(failure).rejects.toMatchObject({ stale: true, message: expect.stringContaining("Reload") });
  });

  it("passes a refusal's own message through", async () => {
    await expect(setPackageActive(client({ data: null, error: { code: "55000", message: "A newer version of this price exists; publish that version instead" } }), "p1", true, "2026-10-31T00:00:00Z"))
      .rejects.toMatchObject({ stale: false, message: "A newer version of this price exists; publish that version instead" });
  });

  it("reuses a key only to retry the same content", () => {
    const pending = { payload: '{"a":1}', key: "kept-key-000000000001" };
    expect(packageSaveKey('{"a":1}', pending)).toBe("kept-key-000000000001");
    expect(packageSaveKey('{"a":2}', pending)).not.toBe("kept-key-000000000001");
    expect(packageSaveKey('{"a":1}', null)).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
  });

  it("reads version hashes, use and newest revision", async () => {
    const revisions = await loadPackageRevisions(client({ data: [
      { package_id: "p1", package_revision: "h1", in_use: true, is_head: false },
      { package_id: "p2", package_revision: "h2", in_use: false, is_head: true },
      { package_id: 3 },
    ], error: null }), ["p1", "p2"]);
    expect([...revisions]).toEqual([["p1", { revision: "h1", inUse: true, isHead: false }], ["p2", { revision: "h2", inUse: false, isHead: true }]]);
    expect((await loadPackageRevisions(client({ data: null, error: null }), [])).size).toBe(0);
    expect(parsePackageRevisions({}).size).toBe(0);
  });
});
