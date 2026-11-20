/** TRACE-157: the allowlist is the analytics data contract, not an auth boundary. */
export const CONSENT_COOKIE = "mercurius_usage_analytics";
export const CONSENT_EVENT = "mercurius:analytics-consent";
export const PREFERENCES_EVENT = "mercurius:analytics-preferences";
export type AnalyticsConsent = "granted" | "denied" | "unset";
export const MARKETPLACE_ORIGINS = ["https://www.mercuriusmarketplace.com", "https://mercuriusmarketplace.com"];
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PUBLIC_PAGES = new Set(["/", "/services", "/providers", "/how-it-works", "/pricing", "/homeowners", "/vendors", "/faq", "/contact", "/early-access", "/privacy", "/terms", "/reschedule-policy"]);
const EVENT_PAGES = new Set([...PUBLIC_PAGES, "/request", "/login", "/login/vendor", "/signup", "/register"]);
const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export const ANALYTICS_EVENTS = ["$pageview", "$identify", "navigation_clicked", "button_clicked", "page_scrolled", "provider_profile_viewed", "service_viewed", "login_succeeded", "login_failed", "signup_submitted", "request_started", "request_step_completed", "request_submitted", "coverage_checked", "early_access_submitted"] as const;
export type AnalyticsEvent = typeof ANALYTICS_EVENTS[number];
export type AnalyticsProperties = Record<string, unknown>;

export function readAnalyticsConsent(cookie: string): AnalyticsConsent {
  const value = cookie.split(";").map(part => part.trim()).find(part => part.startsWith(`${CONSENT_COOKIE}=`))?.split("=")[1];
  return value === "v1-granted" ? "granted" : value === "v1-denied" ? "denied" : "unset";
}

export function privacySignal(headers: { get(name: string): string | null }): boolean {
  return headers.get("sec-gpc") === "1" || headers.get("dnt") === "1";
}

/** Never forward unknown path segments, resource IDs, query strings, or fragments. */
export function analyticsPath(pathname: string): string | null {
  const path = pathname.replace(/\/$/, "") || "/";
  if (EVENT_PAGES.has(path) || path === "/providers/[id]") return path;
  if (/^\/providers\/[a-f0-9-]+$/i.test(path) && UUID.test(path.slice(11))) return "/providers/[id]";
  return null;
}

export function campaignProperties(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  return Object.fromEntries(CAMPAIGN_KEYS.flatMap(key => {
    const value = params.get(key);
    // No URLs, emails, encoded payloads, phone-like numbers or long tokens in tags.
    return value && /^[a-z][a-z0-9 _.-]{0,63}$/i.test(value) && !/\d{7}/.test(value) ? [[key, value]] : [];
  }));
}

export function safeAnalyticsUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (!MARKETPLACE_ORIGINS.includes(url.origin) && !["localhost", "127.0.0.1"].includes(url.hostname)) return null;
    const path = analyticsPath(url.pathname);
    return path ? `${url.origin}${path}` : null;
  } catch { return null; }
}

export function safeReferrer(raw: string): string {
  try { return new URL(raw).origin; } catch { return ""; }
}

export function replayAllowed(raw: string): boolean {
  try {
    const url = new URL(raw);
    const path = analyticsPath(url.pathname);
    return !url.search && !url.hash && !!path && (PUBLIC_PAGES.has(path) || path === "/providers/[id]")
      && !["/contact", "/early-access"].includes(path);
  } catch { return false; }
}

const SYSTEM_KEYS = new Set(["token", "distinct_id", "$device_id", "$session_id", "$window_id", "$lib", "$lib_version", "$browser", "$browser_version", "$os", "$os_version", "$device_type", "$screen_height", "$screen_width", "$viewport_height", "$viewport_width", "$is_identified", "$process_person_profile", "$anon_distinct_id", "$had_persisted_distinct_id"]);

/** Projection, not a denylist: SDK-added/DOM/form properties cannot silently expand capture. */
export function sanitizeProperties(input: AnalyticsProperties): AnalyticsProperties {
  const out: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(input)) {
    if (SYSTEM_KEYS.has(key) && ["string", "number", "boolean"].includes(typeof value)) out[key] = value;
  }
  for (const key of ["$current_url", "$initial_current_url"]) {
    const value = safeAnalyticsUrl(input[key]);
    if (value) out[key] = value;
  }
  for (const key of ["$pathname", "page", "destination"]) {
    if (typeof input[key] === "string") {
      const value = input[key] === "/providers/[id]" ? input[key] : analyticsPath(input[key] as string);
      if (value) out[key] = value;
    }
  }
  for (const key of ["$referrer", "$initial_referrer"]) {
    if (typeof input[key] === "string") out[key] = safeReferrer(input[key] as string);
  }
  if (typeof input.provider_id === "string" && UUID.test(input.provider_id)) out.provider_id = input.provider_id;
  if (typeof input.service_id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/i.test(input.service_id)) out.service_id = input.service_id;
  for (const key of CAMPAIGN_KEYS) {
    const safe = campaignProperties(new URLSearchParams({ [key]: String(input[key] ?? "") }).toString());
    if (safe[key]) out[key] = safe[key];
  }
  if ([25, 50, 75, 100].includes(Number(input.depth))) out.depth = Number(input.depth);
  if (["services", "details", "contact"].includes(String(input.step))) out.step = input.step;
  if (["covered", "uncovered", "waitlist"].includes(String(input.coverage))) out.coverage = input.coverage;
  if (["early_access", "expansion"].includes(String(input.kind))) out.kind = input.kind;
  if (["continue", "submit", "request", "join", "service_select", "service_focus", "other"].includes(String(input.action))) out.action = input.action;
  if (typeof input.service_count === "number" && Number.isInteger(input.service_count) && input.service_count >= 0 && input.service_count <= 100) out.service_count = input.service_count;
  if (typeof input.button_index === "number" && Number.isInteger(input.button_index) && input.button_index >= 0 && input.button_index < 2000) out.button_index = input.button_index;
  return out;
}
