// Phase 7.2B / TRACE-153: where opening an in-app notification goes, by the reader's portal.
//
// A destination is navigation only. It confers no permission: every destination page still checks
// the signed-in account itself, and an unauthorized detail page stays inaccessible.
//
// Homeowner results are unchanged from the original homeowner notifications page. Vendor results
// accept only supported vendor routes. Anything external, protocol-relative, containing a backslash,
// control character or whitespace, or using dot segments or encoded separators is dropped. Obsolete
// and homeowner-only links map to an existing vendor surface. The stored body is never read.

export type NotificationReader = "homeowner" | "vendor";

export type NotificationLinkFields = {
  link: string | null;
  related_request_id: string | null;
};

const BASE = "https://mercurius.local";

export function notificationDestination(
  notification: NotificationLinkFields,
  reader: NotificationReader,
): string {
  return reader === "vendor"
    ? vendorNotificationDestination(notification)
    : homeownerNotificationDestination(notification);
}

// ----- Homeowner (behavior preserved exactly) -------------------------------------------------------

function homeownerNotificationDestination(notification: NotificationLinkFields) {
  const safeLink = safeLocalLink(notification.link);
  if (
    notification.related_request_id &&
    (!safeLink || safeLink === "/dashboard" || safeLink.startsWith("/dashboard?"))
  ) {
    return `/dashboard?job=${encodeURIComponent(notification.related_request_id)}`;
  }
  return safeLink ?? "/dashboard";
}

function safeLocalLink(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return null;
  }

  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

// ----- Vendor ----------------------------------------------------------------------------------------

export const VENDOR_NOTIFICATION_FALLBACK = "/vendor";
const VENDOR_JOBS = "/vendor/jobs";

// Existing vendor portal routes (src/app/vendor/**/page.tsx). A link outside this set is not kept.
export const VENDOR_NOTIFICATION_ROUTES: ReadonlyMap<string, string> = new Map([
  ["/vendor", "Overview"],
  ["/vendor/jobs", "Jobs & Requests"],
  ["/vendor/notifications", "Notifications"],
  ["/vendor/messages", "Messages"],
  ["/vendor/earnings", "Earnings & Payouts"],
  ["/vendor/packages", "Pricing & Packages"],
  ["/vendor/pricing", "Pricing & Packages"],
  ["/vendor/marketing", "Marketing Tools"],
  ["/vendor/compliance", "Compliance Documents"],
  ["/vendor/profile", "Profile"],
  ["/vendor/support", "Support"],
]);

// Section anchors that exist on a vendor page (VendorPriceApprovals). Query strings are never kept.
const VENDOR_ANCHORS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["/vendor/packages", new Set(["#price-approvals", "#offer-approvals"])],
]);

// Links that producers write but a vendor cannot open, mapped to the vendor surface that holds the
// same record. "/vendor/requests" never existed (N-REQ-05); "/notifications", "/dashboard" and
// "/support" are homeowner routes (N-APT-01..03, N-FUL-07, N-CXL-01/02/05, N-SUP-03).
const VENDOR_EQUIVALENTS: ReadonlyMap<string, string> = new Map([
  ["/vendor/requests", VENDOR_JOBS],
  ["/support", "/vendor/support"],
  ["/messages", "/vendor/messages"],
]);

function vendorNotificationDestination(notification: NotificationLinkFields) {
  const related = Boolean(notification.related_request_id);
  const parsed = strictLocalPath(notification.link);
  const contextual = related ? VENDOR_JOBS : VENDOR_NOTIFICATION_FALLBACK;
  if (!parsed) return contextual;

  if (VENDOR_NOTIFICATION_ROUTES.has(parsed.pathname)) {
    const anchors = VENDOR_ANCHORS.get(parsed.pathname);
    return anchors?.has(parsed.hash) ? `${parsed.pathname}${parsed.hash}` : parsed.pathname;
  }
  return VENDOR_EQUIVALENTS.get(parsed.pathname) ?? contextual;
}

export function vendorDestinationLabel(destination: string): string {
  const pathname = destination.split("#")[0];
  return VENDOR_NOTIFICATION_ROUTES.get(pathname) ?? "Overview";
}

function strictLocalPath(value: string | null): { pathname: string; hash: string } | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // Backslashes, whitespace and control characters (browsers strip or rewrite some of them).
  if (/[\\\s\u0000-\u001f\u007f]/.test(value)) return null;
  // Encoded dot, slash, backslash or NUL can hide traversal from a path check.
  if (/%(?:2e|2f|5c|00)/i.test(value)) return null;
  const path = value.split(/[?#]/, 1)[0];
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return null;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }
  if (url.origin !== BASE) return null;
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  return { pathname, hash: url.hash };
}
