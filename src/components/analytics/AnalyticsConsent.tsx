"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { analyticsConfigured, browserPrivacySignal, installAnalytics, setAnalyticsConsent, syncAnalyticsIdentity, trackAnalyticsPage } from "@/lib/analytics/client";
import { CONSENT_EVENT, PREFERENCES_EVENT, readAnalyticsConsent, type AnalyticsConsent } from "@/lib/analytics/policy";

export function AnalyticsConsent() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [choice, setChoice] = useState<AnalyticsConsent | null>(null);
  const [editing, setEditing] = useState(false);
  const [signal, setSignal] = useState(false);
  useEffect(() => {
    const refresh = () => { setChoice(readAnalyticsConsent(document.cookie)); setSignal(browserPrivacySignal()); };
    const open = () => setEditing(true);
    refresh();
    installAnalytics();
    window.addEventListener(CONSENT_EVENT, refresh);
    window.addEventListener(PREFERENCES_EVENT, open);
    return () => { window.removeEventListener(CONSENT_EVENT, refresh); window.removeEventListener(PREFERENCES_EVENT, open); };
  }, []);
  useEffect(() => { syncAnalyticsIdentity(user?.id ?? null); }, [user?.id, choice]);
  useEffect(() => { trackAnalyticsPage(); }, [pathname, choice]);

  if (!analyticsConfigured() || !choice || (!editing && (choice !== "unset" || signal))) return null;
  const decide = (value: "granted" | "denied") => { setAnalyticsConsent(value); setEditing(false); };
  return <section aria-label="Usage analytics preferences" data-analytics-private className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-xl border border-border-strong bg-card p-4 text-foreground shadow-xl sm:p-5">
    <h2 className="text-lg font-semibold">Help us improve Mercurius</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">With your permission, PostHog measures visits and clicks and records masked interactions on public pages. Form inputs, text and images are hidden in replays. Your choice does not affect booking or signing in. <Link href="/privacy#usage-analytics" className="text-sage-dark underline">About usage analytics</Link></p>
    {signal && <p className="mt-2 text-sm">Your browser’s privacy signal is on, so optional tracking stays off.</p>}
    <div className="mt-4 flex flex-wrap gap-3">
      <Button type="button" variant="outline" onClick={() => decide("denied")}>Decline analytics</Button>
      <Button type="button" variant="outline" disabled={signal} onClick={() => decide("granted")}>Allow analytics</Button>
      {editing && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Close preferences</Button>}
    </div>
  </section>;
}

export function AnalyticsPreferencesButton() {
  if (!analyticsConfigured()) return null;
  return <button type="button" className="min-h-11 text-sm text-muted-foreground underline-offset-4 hover:underline" onClick={() => window.dispatchEvent(new Event(PREFERENCES_EVENT))}>Analytics preferences</button>;
}
