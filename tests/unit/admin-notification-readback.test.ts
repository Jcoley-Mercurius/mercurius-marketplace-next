import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_NOTIFICATION_FALLBACK,
  ADMIN_NOTIFICATION_ROUTES,
  adminDestinationLabel,
  notificationDestination,
} from "@/lib/notificationDestination";
import {
  ADMIN_NOTICE_BODY_LIMIT,
  ADMIN_NOTICE_FALLBACK_TITLE,
  ADMIN_NOTICE_TITLE_LIMIT,
  presentAdminNotification,
} from "@/lib/adminNotificationPresentation";
import { parseRequestsQuery } from "@/lib/adminOperations";

// Phase 7.5E / TRACE-159: admin notification destinations and presentation.

const request = "00000000-0000-4000-8000-000000000010";
const record = `/admin/requests?request=${request}`;
const admin = (link: string | null, related: string | null = null) =>
  notificationDestination({ link, related_request_id: related }, "admin");

function adminPages() {
  const root = join(process.cwd(), "src", "app", "admin");
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "page.tsx") routes.push(`/admin/${relative(root, dir).split(sep).join("/")}`.replace(/\/$/, ""));
    }
  };
  walk(root);
  return routes;
}

describe("admin destinations", () => {
  it("keeps only existing admin pages, every static page except this list and the retired Smart Picks", () => {
    const pages = adminPages();
    for (const route of ADMIN_NOTIFICATION_ROUTES.keys()) expect(pages).toContain(route);
    const expected = pages.filter((p) => !p.includes("[") && p !== "/admin/notifications" && p !== "/admin/smart-picks");
    expect([...ADMIN_NOTIFICATION_ROUTES.keys()].sort()).toEqual(expected.sort());
  });

  // The links the 14 live admin producers write (record §2).
  it.each([
    ["/admin/requests", request, record],
    ["/admin/requests", null, "/admin/requests"],
    ["/admin/disputes", request, "/admin/disputes"],
    ["/admin/applications", null, "/admin/applications"],
    ["/admin/tickets", request, "/admin/tickets"],
    ["/admin/tickets", null, "/admin/tickets"],
    // record_job_operation, respond_to_reschedule_request, homeowner_respond_replacement share
    // "/notifications" with homeowners and providers; it would send an admin away.
    ["/notifications", request, record],
    ["/notifications", null, ADMIN_NOTIFICATION_FALLBACK],
  ])("producer link %s (request %s) opens %s", (link, related, expected) => {
    expect(admin(link, related)).toBe(expected);
  });

  it("opens a request record only for a well-formed id, which the requests page accepts", () => {
    expect(admin("/admin/requests", request.toUpperCase())).toBe(record);
    expect(parseRequestsQuery(new URLSearchParams(record.split("?")[1]), []).request).toBe(request);
    for (const bad of ["", "x", `${request}x`, `${request}&status=all`, "../../admin", "00000000-0000-4000-8000-00000000001g"]) {
      expect(admin("/admin/requests", bad)).toBe("/admin/requests");
      expect(admin(null, bad)).toBe(ADMIN_NOTIFICATION_FALLBACK);
    }
  });

  it.each([
    // Not an admin page, or a page a notice should not open.
    "/dashboard", "/dashboard?job=1", "/support", "/messages", "/vendor/jobs", "/vendor/requests", "/admin/notifications",
    "/admin/smart-picks", "/admin/requests/x", "/admin/nonexistent", "/Admin/Requests",
    // Unsafe or malformed.
    null, "", "admin/requests", "https://evil.example/admin", "http://127.0.0.1:3103/admin", "//evil.example/admin",
    "/\\evil.example", "\\\\evil", "javascript:alert(1)", "data:text/html,x", "/admin/../vendor", "/admin/%2e%2e/vendor",
    "/admin/%2F%2Fevil", "/admin/tickets%00", "/admin tickets", "/admin/tickets\n", `/admin/${"x".repeat(600)}`,
  ])("drops %j to the request record or the overview", (link) => {
    expect(admin(link, request)).toBe(record);
    expect(admin(link, null)).toBe(ADMIN_NOTIFICATION_FALLBACK);
  });

  it("never keeps a query string or anchor, except the validated request record", () => {
    expect(admin("/admin/tickets?ticket=MS-1#reply", null)).toBe("/admin/tickets");
    expect(admin("/admin/requests?request=11111111-1111-4111-8111-111111111111", null)).toBe("/admin/requests");
    expect(admin("/admin/requests?request=11111111-1111-4111-8111-111111111111", request)).toBe(record);
    expect(admin("/admin/requests#offer-terms-queue", null)).toBe("/admin/requests");
    expect(admin("/admin/tickets/", null)).toBe("/admin/tickets");
  });

  it("labels each destination", () => {
    expect(adminDestinationLabel(record)).toBe("the service request record");
    expect(adminDestinationLabel("/admin/tickets")).toBe("Support Tickets");
    expect(adminDestinationLabel("/admin")).toBe("Overview");
    expect(adminDestinationLabel("/elsewhere")).toBe("Overview");
  });

  it("leaves the homeowner and vendor readers unchanged for admin links", () => {
    expect(notificationDestination({ link: "/admin/requests", related_request_id: request }, "vendor")).toBe("/vendor/jobs");
    expect(notificationDestination({ link: "/admin/requests", related_request_id: null }, "homeowner")).toBe("/admin/requests");
  });
});

describe("admin presentation", () => {
  it("shows the stored title and body as recorded, with categories by type", () => {
    expect(presentAdminNotification({ type: "support", title: "Support request MS-42", body: "Gate code question" }))
      .toEqual({ category: "support", title: "Support request MS-42", body: "Gate code question" });
    expect(presentAdminNotification({ type: "dispute", title: "Service dispute needs review", body: "x" }).category).toBe("dispute");
    expect(presentAdminNotification({ type: "vendor_application", title: "t", body: null }).category).toBe("application");
    expect(presentAdminNotification({ type: "job_confirmation", title: "t", body: null }).category).toBe("completion");
    expect(presentAdminNotification({ type: "job_status", title: "t", body: null }).category).toBe("service");
    for (const type of ["legacy", "", null, 7, "__proto__", "constructor"]) {
      expect(presentAdminNotification({ type, title: "t", body: null }).category).toBe("general");
    }
  });

  it("falls back for blank or missing titles and omits blank bodies", () => {
    for (const title of ["", "   ", null, undefined, 3, "\u0000\u0007"]) {
      expect(presentAdminNotification({ type: "support", title, body: " " })).toEqual({ category: "support", title: ADMIN_NOTICE_FALLBACK_TITLE, body: null });
    }
  });

  it("collapses whitespace and control characters, and bounds length", () => {
    expect(presentAdminNotification({ type: "x", title: " A\n\tB\u0000C ", body: "line 1\r\nline 2" }))
      .toMatchObject({ title: "A B C", body: "line 1 line 2" });
    const long = presentAdminNotification({ type: "x", title: "t".repeat(500), body: "b".repeat(5000) });
    expect(Array.from(long.title)).toHaveLength(ADMIN_NOTICE_TITLE_LIMIT);
    expect(long.title.endsWith("…")).toBe(true);
    expect(Array.from(long.body!)).toHaveLength(ADMIN_NOTICE_BODY_LIMIT);
    // Astral characters are not split.
    const emoji = presentAdminNotification({ type: "x", title: "😀".repeat(300), body: null }).title;
    expect(Array.from(emoji)).toHaveLength(ADMIN_NOTICE_TITLE_LIMIT);
  });

  it("returns markup as plain text for React to escape", () => {
    expect(presentAdminNotification({ type: "x", title: "<img src=x onerror=alert(1)>", body: "<b>x</b>" }))
      .toMatchObject({ title: "<img src=x onerror=alert(1)>", body: "<b>x</b>" });
  });
});
