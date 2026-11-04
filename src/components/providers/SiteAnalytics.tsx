"use client";

import { Analytics } from "@vercel/analytics/next";
import { redactAnalyticsEvent } from "@/lib/analyticsRedaction";

// beforeSend is a function, so it is attached here rather than in the server layout.
export function SiteAnalytics() {
  return <Analytics beforeSend={redactAnalyticsEvent} />;
}
