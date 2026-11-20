"use client";

import posthog from "posthog-js";
import { ANALYTICS_EVENTS, CONSENT_COOKIE, CONSENT_EVENT, MARKETPLACE_ORIGINS, UUID, analyticsPath, campaignProperties, readAnalyticsConsent, replayAllowed, sanitizeProperties, safeAnalyticsUrl, safeReferrer, type AnalyticsConsent, type AnalyticsEvent, type AnalyticsProperties } from "./policy";

let installed = false;
let initialized = false;
let identity: string | null = null;
let identified: string | null = null;
let lastPage: string | null = null;
const depths = new Set<number>();

export function analyticsConfigured() {
  return process.env.NEXT_PUBLIC_POSTHOG_ENABLED === "1" && !!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && !!process.env.NEXT_PUBLIC_POSTHOG_HOST;
}

export function browserPrivacySignal() {
  return navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

export function analyticsPermitted() {
  try {
    if (typeof window === "undefined" || !analyticsConfigured() || browserPrivacySignal()) return false;
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    return (MARKETPLACE_ORIGINS.includes(window.location.origin) || local) && readAnalyticsConsent(document.cookie) === "granted";
  } catch { return false; }
}

export function setAnalyticsConsent(value: Exclude<AnalyticsConsent, "unset">) {
  // Essential preference only, without a visitor identifier. Refusing never disables auth.
  document.cookie = `${CONSENT_COOKIE}=v1-${value}; Path=/; Max-Age=15552000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  try { localStorage.setItem(CONSENT_COOKIE, value); } catch { /* Cookie preference still works without local storage. */ }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

export function stopAnalyticsReplay() {
  try { if (initialized) posthog.stopSessionRecording(); } catch { /* Navigation must still complete. */ }
}

function updateReplay() {
  if (!initialized) return;
  try {
    if (analyticsPermitted() && process.env.NEXT_PUBLIC_POSTHOG_REPLAY_ENABLED === "1" && replayAllowed(location.href)) posthog.startSessionRecording();
    else posthog.stopSessionRecording();
  } catch { /* An unavailable recorder cannot interrupt a page or account transition. */ }
}

export function captureAnalytics(event: AnalyticsEvent, properties: AnalyticsProperties = {}) {
  if (!initialized || !analyticsPermitted() || !analyticsPath(location.pathname)) return;
  try { posthog.capture(event, sanitizeProperties({ page: analyticsPath(location.pathname), ...properties })); } catch { /* Analytics never interrupts a customer action. */ }
}

export function syncAnalyticsIdentity(userId: string | null) {
  identity = userId && UUID.test(userId) ? userId : null;
  if (!initialized || !analyticsPermitted() || identity === identified) return;
  try {
    if (identified && identified !== identity) posthog.reset(true);
    if (identity) posthog.identify(identity);
    identified = identity;
  } catch { /* Authentication is independent of telemetry. */ }
}

export function trackAnalyticsPage() {
  if (!initialized || !analyticsPermitted()) return;
  const path = analyticsPath(location.pathname);
  updateReplay();
  const pageKey = path === "/providers/[id]" ? location.pathname : path;
  if (!path || pageKey === lastPage) return;
  lastPage = pageKey;
  depths.clear();
  captureAnalytics("$pageview", { $current_url: safeAnalyticsUrl(location.href) });
}

function reconcileConsent() {
  if (!analyticsPermitted()) {
    if (initialized) {
      posthog.stopSessionRecording();
      posthog.opt_out_capturing();
      posthog.set_config({ disable_persistence: true });
      posthog.reset(true);
      identified = null;
      lastPage = null;
    }
    return;
  }
  if (!initialized) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      defaults: "2026-08-30",
      capture_pageview: false,
      capture_pageleave: false,
      autocapture: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      capture_exceptions: false,
      disable_surveys: true,
      enable_recording_console_log: false,
      disable_session_recording: true,
      save_referrer: false,
      save_campaign_params: false,
      person_profiles: "identified_only",
      respect_dnt: true,
      ip: false,
      cross_subdomain_cookie: false,
      advanced_disable_feature_flags: true,
      disable_compression: process.env.NODE_ENV !== "production",
      tracing_headers: ["www.mercuriusmarketplace.com", "mercuriusmarketplace.com", "localhost", "127.0.0.1"],
      session_recording: {
        maskAllInputs: true, maskTextSelector: "*", maskAllElementAttributes: true,
        blockSelector: "img,video,canvas,iframe,object,embed,[data-private],.ph-no-capture",
        recordCrossOriginIframes: false,
        captureJsonLd: false, recordHeaders: false, recordBody: false,
        maskCapturedNetworkRequestFn: () => null,
      },
      before_send: event => {
        if (!event || !analyticsPermitted() || !analyticsPath(location.pathname) || !(ANALYTICS_EVENTS as readonly string[]).includes(event.event)) return null;
        return { ...event, properties: sanitizeProperties(event.properties) };
      },
    });
    initialized = true;
  }
  posthog.set_config({ disable_persistence: false });
  posthog.opt_in_capturing({ captureEventName: false });
  // Only sanitized campaign tags and the referring origin persist, after permission.
  posthog.register({ ...campaignProperties(location.search), $referrer: safeReferrer(document.referrer) });
  syncAnalyticsIdentity(identity);
  trackAnalyticsPage();
}

export function installAnalytics() {
  if (installed || typeof window === "undefined") return;
  if (!analyticsConfigured()) {
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_POSTHOG_ENABLED === "1") {
      if (!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) console.error("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured");
      if (!process.env.NEXT_PUBLIC_POSTHOG_HOST) console.error("NEXT_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_HOST is configured");
    }
    return;
  }
  installed = true;
  window.addEventListener(CONSENT_EVENT, () => { try { reconcileConsent(); } catch { /* Fail closed. */ } });
  window.addEventListener("storage", event => {
    if (event.key === CONSENT_COOKIE) { try { reconcileConsent(); } catch { /* Fail closed. */ } }
  });
  // Focus also catches preference changes in another tab (cookies aren't storage events).
  window.addEventListener("focus", () => { try { reconcileConsent(); } catch { /* Fail closed. */ } });
  window.addEventListener("popstate", () => trackAnalyticsPage());
  document.addEventListener("click", event => {
    if (!analyticsPermitted() || !analyticsPath(location.pathname)) return;
    const element = event.target instanceof Element ? event.target.closest("a[href],button") : null;
    if (!element || element.closest("[data-analytics-private]")) return;
    if (element instanceof HTMLAnchorElement) {
      const url = new URL(element.href, location.origin);
      const destination = url.origin === location.origin ? analyticsPath(url.pathname) : null;
      if (destination) captureAnalytics("navigation_clicked", { destination, provider_id: destination === "/providers/[id]" ? url.pathname.split("/")[2] : undefined });
    } else {
      // Attribute-free button positions reveal no labels or user-entered content.
      const action = element.getAttribute("data-analytics-action") ?? "other";
      captureAnalytics("button_clicked", { action, button_index: Array.from(document.querySelectorAll("button")).indexOf(element as HTMLButtonElement) });
    }
  }, { capture: true });
  window.addEventListener("scroll", () => {
    if (!analyticsPermitted() || !replayAllowed(location.href)) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    const percent = max > 0 ? Math.min(100, Math.round(scrollY / max * 100)) : 0;
    for (const depth of [25, 50, 75, 100]) if (percent >= depth && !depths.has(depth)) { depths.add(depth); captureAnalytics("page_scrolled", { depth }); }
  }, { passive: true });
  try { reconcileConsent(); } catch { /* A blocked SDK cannot block the website. */ }
}
