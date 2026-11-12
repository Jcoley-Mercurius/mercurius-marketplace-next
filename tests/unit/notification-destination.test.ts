import { describe, expect, it } from "vitest";
import {
  notificationDestination,
  VENDOR_NOTIFICATION_ROUTES,
  vendorDestinationLabel,
} from "@/lib/notificationDestination";

// Phase 7.2B / TRACE-153: role-aware notification destinations.

// The homeowner page's implementation before extraction, kept verbatim as the parity oracle.
function legacyHomeownerDestination(notification: { link: string | null; related_request_id: string | null }) {
  const safeLink = legacySafeLocalLink(notification.link);
  if (notification.related_request_id && (!safeLink || safeLink === "/dashboard" || safeLink.startsWith("/dashboard?"))) {
    return `/dashboard?job=${encodeURIComponent(notification.related_request_id)}`;
  }
  return safeLink ?? "/dashboard";
}
function legacySafeLocalLink(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://mercurius.local");
    if (url.origin !== "https://mercurius.local") return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

const request = "00000000-0000-4000-8000-000000000010";
const links: Array<string | null> = [
  null, "", "/dashboard", "/dashboard?confirm=abc", "/dashboard#x", "/notifications", "/support", "/messages",
  "/vendor/jobs", "/vendor/requests", "/vendor/packages#price-approvals", "/admin/requests", "/admin/disputes",
  "https://evil.example/x", "http://127.0.0.1:3103/vendor", "//evil.example", "/\\evil.example", "\\\\evil",
  "javascript:alert(1)", "data:text/html,x", "/vendor/../admin", "/vendor/%2e%2e/admin", "/a b", "/x?y=1&z=2#h",
  "dashboard", "/%2F%2Fevil.example", "/vendor/jobs/", "/Vendor/Jobs",
];

describe("homeowner destinations are unchanged", () => {
  for (const link of links) {
    for (const related of [null, request]) {
      it(`${JSON.stringify(link)} ${related ? "with" : "without"} a request`, () => {
        const row = { link, related_request_id: related };
        expect(notificationDestination(row, "homeowner")).toBe(legacyHomeownerDestination(row));
      });
    }
  }
});

describe("vendor destinations", () => {
  const vendor = (link: string | null, related: string | null = null) =>
    notificationDestination({ link, related_request_id: related }, "vendor");

  it("keeps every supported vendor route, without query strings", () => {
    for (const route of VENDOR_NOTIFICATION_ROUTES.keys()) {
      expect(vendor(route)).toBe(route);
      expect(vendor(`${route}?job=${request}`)).toBe(route);
      expect(vendor(`${route}/`)).toBe(route);
    }
  });

  it("keeps only anchors that exist on the page", () => {
    expect(vendor("/vendor/packages#price-approvals")).toBe("/vendor/packages#price-approvals");
    expect(vendor("/vendor/packages#offer-approvals")).toBe("/vendor/packages#offer-approvals");
    expect(vendor("/vendor/packages#elsewhere")).toBe("/vendor/packages");
    expect(vendor("/vendor/jobs#price-approvals")).toBe("/vendor/jobs");
  });

  it("maps obsolete and homeowner-only links to the vendor surface with the same record", () => {
    expect(vendor("/vendor/requests", request)).toBe("/vendor/jobs");
    expect(vendor("/vendor/requests")).toBe("/vendor/jobs");
    expect(vendor("/notifications", request)).toBe("/vendor/jobs");
    expect(vendor("/notifications")).toBe("/vendor");
    expect(vendor("/dashboard", request)).toBe("/vendor/jobs");
    expect(vendor(`/dashboard?confirm=${request}`, request)).toBe("/vendor/jobs");
    expect(vendor("/support")).toBe("/vendor/support");
    expect(vendor("/messages")).toBe("/vendor/messages");
  });

  it("never keeps an admin, unknown or nested route", () => {
    for (const link of ["/admin/requests", "/admin", "/vendor/jobs/123", "/vendor/admin", "/Vendor/Jobs", "/pricing", "/vendors"]) {
      expect(vendor(link)).toBe("/vendor");
      expect(vendor(link, request)).toBe("/vendor/jobs");
    }
  });

  it("rejects external, protocol-relative, backslash, traversal and malformed links", () => {
    const unsafe = [
      "https://evil.example/vendor/jobs", "http://127.0.0.1:3103/vendor/jobs", "//evil.example/vendor/jobs",
      "/\\evil.example", "\\\\evil.example", "/vendor\\..\\admin", "javascript:alert(1)", "JAVASCRIPT:alert(1)",
      "data:text/html,<b>x</b>", "vendor/jobs", " /vendor/jobs", "/vendor/jobs ", "/vendor/\njobs", "/vendor/\tjobs",
      "/vendor/../admin", "/vendor/./jobs", "/vendor/jobs/..", "/vendor/%2e%2e/admin", "/vendor/%2E%2E/admin",
      "/%2F%2Fevil.example", "/vendor%2Fjobs", "/vendor/%5cjobs", "/vendor/jobs%00", "/" + "a".repeat(600), "",
    ];
    for (const link of unsafe) {
      expect(vendor(link), link).toBe("/vendor");
      expect(vendor(link, request), link).toBe("/vendor/jobs");
    }
    expect(vendor(null)).toBe("/vendor");
    expect(vendor(null, request)).toBe("/vendor/jobs");
  });

  it("only ever returns a supported vendor route", () => {
    for (const link of links) {
      for (const related of [null, request]) {
        const destination = vendor(link, related);
        expect(VENDOR_NOTIFICATION_ROUTES.has(destination.split("#")[0]), `${link} → ${destination}`).toBe(true);
      }
    }
  });

  it("labels destinations by their page", () => {
    expect(vendorDestinationLabel("/vendor/jobs")).toBe("Jobs & Requests");
    expect(vendorDestinationLabel("/vendor/packages#price-approvals")).toBe("Pricing & Packages");
    expect(vendorDestinationLabel("/vendor")).toBe("Overview");
    expect(vendorDestinationLabel("/somewhere")).toBe("Overview");
  });
});
