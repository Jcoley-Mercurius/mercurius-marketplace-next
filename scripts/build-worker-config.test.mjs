import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("opt-in build worker limit", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it("preserves the default configuration when unset", async () => {
    vi.stubEnv("MERCURIUS_BUILD_WORKERS", "");
    expect((await import("../next.config.ts")).default).toEqual({});
  });

  it.each(["1", "16"])("accepts %s workers", async (workers) => {
    vi.stubEnv("MERCURIUS_BUILD_WORKERS", workers);
    expect((await import("../next.config.ts")).default.experimental.cpus).toBe(Number(workers));
  });

  it.each(["0", "17", "2.5"])("rejects invalid worker count %s", async (workers) => {
    vi.stubEnv("MERCURIUS_BUILD_WORKERS", workers);
    await expect(import("../next.config.ts")).rejects.toThrow("MERCURIUS_BUILD_WORKERS must be an integer from 1 to 16.");
  });
});
