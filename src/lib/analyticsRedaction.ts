import type { BeforeSendEvent } from "@vercel/analytics/next";

// TRACE-139: Vercel Web Analytics reports `location.href`. Invitation keys, Auth
// token hashes/codes and session tokens arrive in the query or fragment, so only
// campaign tags are kept and the fragment is always dropped.
const KEPT_PARAM = /^utm_[a-z]+$/;

export function redactAnalyticsUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const kept = new URLSearchParams();
  url.searchParams.forEach((value, key) => {
    if (KEPT_PARAM.test(key)) kept.append(key, value);
  });
  url.search = kept.toString();
  url.hash = "";
  return url.toString();
}

/** Unparseable URLs drop the event rather than send it unredacted. */
export function redactAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = redactAnalyticsUrl(event.url);
  return url ? { ...event, url } : null;
}
