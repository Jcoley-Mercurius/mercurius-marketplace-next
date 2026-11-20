import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ after: vi.fn(), capture: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({ after: mock.after }));
vi.mock("posthog-node", () => ({ PostHog: class { capture = mock.capture; flush = mock.flush; } }));
import { CONSENT_COOKIE } from "@/lib/analytics/policy";
const id = "00000000-0000-4000-8000-000000000001";
const request = (headers: Record<string, string> = {}) => new Request("https://www.mercuriusmarketplace.com/api/early-access", { headers: { cookie: `${CONSENT_COOKIE}=v1-granted`, "X-POSTHOG-DISTINCT-ID": id, ...headers } });
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENABLED", "1"); vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_synthetic"); vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com"); mock.flush.mockResolvedValue(undefined); });
afterEach(() => vi.unstubAllEnvs());

describe("TRACE-157 server outcome analytics", () => {
  it("schedules only consented, privacy-safe outcomes and never forwards the request payload", async () => {
    const { captureServerAnalytics } = await import("@/server/analytics");
    captureServerAnalytics(request(), "early_access_submitted", { kind: "early_access", email: "PRIVATE", address: "PRIVATE" });
    expect(mock.capture).not.toHaveBeenCalled();
    await mock.after.mock.calls[0][0]();
    expect(mock.capture).toHaveBeenCalledExactlyOnceWith({ distinctId: id, event: "early_access_submitted", properties: { kind: "early_access", $process_person_profile: false }, disableGeoip: true });
  });
  it("does nothing without consent, usable telemetry IDs, or when GPC/DNT is set", async () => {
    const { captureServerAnalytics } = await import("@/server/analytics");
    for (const headers of [{ cookie: "" }, { "X-POSTHOG-DISTINCT-ID": "person@example.com" }, { "sec-gpc": "1" }, { dnt: "1" }]) captureServerAnalytics(request(headers), "coverage_checked", { coverage: "covered" });
    expect(mock.after).not.toHaveBeenCalled();
  });
  it("contains analytics and scheduling failures without changing the customer's result", async () => {
    const { captureServerAnalytics } = await import("@/server/analytics");
    mock.flush.mockRejectedValue(new Error("synthetic outage"));
    captureServerAnalytics(request(), "coverage_checked", { coverage: "covered" });
    await expect(mock.after.mock.calls[0][0]()).resolves.toBeUndefined();
    mock.after.mockImplementationOnce(() => { throw new Error("outside request context"); });
    expect(() => captureServerAnalytics(request(), "coverage_checked", {})).not.toThrow();
  });
});
