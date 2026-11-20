import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn(), register: vi.fn(), identify: vi.fn(), reset: vi.fn(), opt_in_capturing: vi.fn(), opt_out_capturing: vi.fn(), startSessionRecording: vi.fn(), stopSessionRecording: vi.fn() }));
vi.mock("posthog-js", () => ({ default: sdk }));
import { CONSENT_COOKIE } from "@/lib/analytics/policy";

const site = "https://www.mercuriusmarketplace.com";
const user = "00000000-0000-4000-8000-000000000001";
let documentStub: { cookie: string; referrer: string; addEventListener: ReturnType<typeof vi.fn> };
let locationStub: URL;

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENABLED", "1"); vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_synthetic"); vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.com"); vi.stubEnv("NEXT_PUBLIC_POSTHOG_REPLAY_ENABLED", "1");
  locationStub = new URL(site + "/faq");
  documentStub = { cookie: "", referrer: "https://search.invalid/?email=PRIVATE", addEventListener: vi.fn() };
  vi.stubGlobal("location", locationStub);
  vi.stubGlobal("window", { location: locationStub, addEventListener: vi.fn() });
  vi.stubGlobal("document", documentStub);
  vi.stubGlobal("navigator", { doNotTrack: "0", globalPrivacyControl: false });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("TRACE-157 consent and identity runtime", () => {
  it("does not initialize, capture, persist or record before consent or after refusal", async () => {
    const client = await import("@/lib/analytics/client");
    client.installAnalytics(); client.captureAnalytics("request_started");
    expect(sdk.init).not.toHaveBeenCalled(); expect(sdk.capture).not.toHaveBeenCalled();
    documentStub.cookie = `${CONSENT_COOKIE}=v1-denied`;
    client.trackAnalyticsPage(); expect(sdk.init).not.toHaveBeenCalled();
  });

  it("uses the same stable account ID, resets identity on logout, and never sends names/emails", async () => {
    documentStub.cookie = `${CONSENT_COOKIE}=v1-granted`;
    const client = await import("@/lib/analytics/client"); client.installAnalytics();
    client.syncAnalyticsIdentity(user); client.syncAnalyticsIdentity(user);
    expect(sdk.identify).toHaveBeenCalledExactlyOnceWith(user);
    client.syncAnalyticsIdentity(null); expect(sdk.reset).toHaveBeenCalledExactlyOnceWith(true);
    client.syncAnalyticsIdentity("person@example.com"); expect(sdk.identify).toHaveBeenCalledTimes(1);
    expect(sdk.register).toHaveBeenCalledWith({ $referrer: "https://search.invalid" });
  });

  it("checks consent again at send time and rejects unknown SDK event families and private pages", async () => {
    documentStub.cookie = `${CONSENT_COOKIE}=v1-granted`;
    const client = await import("@/lib/analytics/client"); client.installAnalytics();
    const config = sdk.init.mock.calls[0][1];
    expect(config.before_send({ event: "$autocapture", properties: { text: "PRIVATE" } })).toBeNull();
    expect(config.before_send({ event: "$pageview", properties: { $current_url: `${site}/faq?code=SECRET`, email: "PRIVATE" } }).properties).toEqual({ $current_url: site + "/faq" });
    locationStub.pathname = "/dashboard";
    expect(config.before_send({ event: "$pageview", properties: {} })).toBeNull();
    locationStub.pathname = "/faq"; documentStub.cookie = `${CONSENT_COOKIE}=v1-denied`;
    expect(config.before_send({ event: "$pageview", properties: {} })).toBeNull();
  });

  it("sets strict masking and cannot start replay on forms or URLs with private parameters", async () => {
    documentStub.cookie = `${CONSENT_COOKIE}=v1-granted`;
    locationStub.pathname = "/request";
    const client = await import("@/lib/analytics/client"); client.installAnalytics();
    const config = sdk.init.mock.calls[0][1];
    expect(config.autocapture).toBe(false); expect(config.capture_pageview).toBe(false);
    expect(config.session_recording).toMatchObject({ maskAllInputs: true, maskTextSelector: "*", captureJsonLd: false, recordHeaders: false, recordBody: false });
    expect(config.session_recording.maskCapturedNetworkRequestFn({ body: "PRIVATE" })).toBeNull();
    expect(sdk.startSessionRecording).not.toHaveBeenCalled();
    locationStub.pathname = "/faq"; locationStub.search = "?token_hash=SECRET"; client.trackAnalyticsPage();
    expect(sdk.startSessionRecording).not.toHaveBeenCalled();
    locationStub.search = ""; client.trackAnalyticsPage(); expect(sdk.startSessionRecording).toHaveBeenCalled();
  });

  it("honors browser privacy signals and leaves unconfigured and preview hosts inert", async () => {
    documentStub.cookie = `${CONSENT_COOKIE}=v1-granted`;
    navigator.doNotTrack = "1";
    let client = await import("@/lib/analytics/client"); client.installAnalytics(); expect(sdk.init).not.toHaveBeenCalled();
    vi.resetModules(); vi.stubGlobal("navigator", { doNotTrack: "0", globalPrivacyControl: true });
    client = await import("@/lib/analytics/client"); client.installAnalytics(); expect(sdk.init).not.toHaveBeenCalled();
    vi.resetModules(); vi.stubGlobal("navigator", { doNotTrack: "0", globalPrivacyControl: false }); locationStub.hostname = "preview.vercel.app";
    client = await import("@/lib/analytics/client"); client.installAnalytics(); expect(sdk.init).not.toHaveBeenCalled();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_ENABLED", "0"); expect(client.analyticsConfigured()).toBe(false);
  });
});
