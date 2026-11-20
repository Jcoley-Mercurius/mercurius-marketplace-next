import "server-only";

import { after } from "next/server";
import { PostHog } from "posthog-node";
import { MARKETPLACE_ORIGINS, UUID, privacySignal, readAnalyticsConsent, sanitizeProperties, type AnalyticsProperties } from "@/lib/analytics/policy";

let client: PostHog | undefined;

/** A response outcome only; no request body, IP, form data, error text or auth token. */
export function captureServerAnalytics(request: Request, event: "early_access_submitted" | "coverage_checked", properties: AnalyticsProperties) {
  try {
    if (process.env.NEXT_PUBLIC_POSTHOG_ENABLED !== "1" || !process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || !process.env.NEXT_PUBLIC_POSTHOG_HOST) return;
    if (readAnalyticsConsent(request.headers.get("cookie") ?? "") !== "granted" || privacySignal(request.headers)) return;
    const url = new URL(request.url);
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (!MARKETPLACE_ORIGINS.includes(url.origin) && !local) return;
    // These IDs link telemetry only and never supply authentication or authorization.
    const distinctId = request.headers.get("X-POSTHOG-DISTINCT-ID");
    if (!distinctId || !UUID.test(distinctId)) return;
    const sessionId = request.headers.get("X-POSTHOG-SESSION-ID");
    const safe = sanitizeProperties({ ...properties, ...(sessionId && UUID.test(sessionId) ? { $session_id: sessionId } : {}), $process_person_profile: false });
    after(async () => {
      try {
        client ??= new PostHog(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN!, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST, flushAt: 1, flushInterval: 0, requestTimeout: 1500, fetchRetryCount: 0, captureMaxRetries: 0, disableGeoip: true });
        client.capture({ distinctId, event, properties: safe, disableGeoip: true });
        await client.flush();
      } catch { /* Analytics failure never changes a saved submission or its response. */ }
    });
  } catch { /* Also tolerate execution outside a Next.js request context. */ }
}
