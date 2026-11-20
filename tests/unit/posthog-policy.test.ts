import { describe, expect, it } from "vitest";
import { CONSENT_COOKIE, analyticsPath, campaignProperties, privacySignal, readAnalyticsConsent, replayAllowed, safeAnalyticsUrl, sanitizeProperties } from "@/lib/analytics/policy";

const site = "https://www.mercuriusmarketplace.com";
const provider = "00000000-0000-4000-8000-000000000002";

describe("TRACE-157 analytics privacy contract", () => {
  it("requires a versioned explicit opt-in, independent of auth or marketing cookies", () => {
    for (const cookie of ["", "marketing=true", `${CONSENT_COOKIE}=granted`, `${CONSENT_COOKIE}=v1-denied`]) expect(readAnalyticsConsent(cookie)).not.toBe("granted");
    expect(readAnalyticsConsent(`session=private; ${CONSENT_COOKIE}=v1-granted`)).toBe("granted");
    expect(privacySignal(new Headers({ "sec-gpc": "1" }))).toBe(true);
    expect(privacySignal(new Headers({ dnt: "1" }))).toBe(true);
  });

  it("normalizes provider IDs and refuses private or unknown dynamic paths", () => {
    expect(safeAnalyticsUrl(`${site}/providers/${provider}?q=PRIVATE&zip=33904#access_token=PRIVATE`)).toBe(`${site}/providers/[id]`);
    for (const path of ["/invitation/open", "/set-password", "/vendor/documents", "/admin", "/dashboard", "/private@example.com"]) expect(analyticsPath(path)).toBeNull();
    expect(safeAnalyticsUrl("https://evil.invalid/providers")).toBeNull();
    expect(safeAnalyticsUrl("javascript:alert(1)")).toBeNull();
  });

  it("retains only constrained campaign tags; auth, ad click IDs and search strings never pass", () => {
    expect(campaignProperties("utm_source=facebook&utm_medium=paid-social&utm_campaign=lee-county&gclid=PRIVATE&email=PRIVATE")).toEqual({ utm_source: "facebook", utm_medium: "paid-social", utm_campaign: "lee-county" });
    expect(campaignProperties("utm_source=person%40example.com&utm_campaign=tel1234567890&utm_term=https%3A%2F%2Fevil.invalid")).toEqual({});
  });

  it("excludes forms, portals, queries and fragments from replay", () => {
    for (const path of ["/login", "/request", "/early-access", "/contact", "/admin/finance", "/vendor/profile", "/dashboard", "/providers?q=PRIVATE", "/faq#PRIVATE"]) expect(replayAllowed(site + path)).toBe(false);
    for (const path of ["/", "/faq", "/services", `/providers/${provider}`]) expect(replayAllowed(site + path)).toBe(true);
  });

  it("projects every payload onto safe fields, including SDK-added properties", () => {
    const result = sanitizeProperties({
      $current_url: `${site}/login?code=SECRET#access_token=SECRET`,
      $referrer: "https://search.example/path?email=PRIVATE#SECRET", $set: { email: "PRIVATE" },
      email: "PRIVATE", address: "PRIVATE", $elements: [{ text: "PRIVATE" }], $exception_message: "PRIVATE", $initial_person_info: { email: "PRIVATE" },
      page: "/admin/vendors/PRIVATE", destination: "/request", provider_id: provider, service_id: "lawn-care",
      coverage: "covered", service_count: 2, depth: 50, step: "details", utm_source: "facebook",
    });
    expect(result).toEqual({ $current_url: `${site}/login`, $referrer: "https://search.example", destination: "/request", provider_id: provider, service_id: "lawn-care", coverage: "covered", service_count: 2, depth: 50, step: "details", utm_source: "facebook" });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|PRIVATE/);
  });
});
