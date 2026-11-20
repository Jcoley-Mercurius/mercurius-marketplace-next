import { installAnalytics, stopAnalyticsReplay } from "@/lib/analytics/client";

// No PostHog initialization, identifiers, or requests until usage analytics is allowed.
installAnalytics();

export function onRouterTransitionStart() {
  // Stop before private content can render during an App Router transition.
  stopAnalyticsReplay();
}
