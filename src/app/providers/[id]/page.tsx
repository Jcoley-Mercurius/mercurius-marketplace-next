"use client";

// TRACE-156 (P2B): the public provider profile renders the approved dynamic profile interior
// (ProviderProfileView) from the provider-scoped public reads. The inherited storefront's
// contracts are kept: the r0_public_providers listing decides whether a profile exists; offers,
// levels, extras, qualifying questions, reviews, gallery and coverage are the same public reads;
// legacy promotions stay closed (TRACE-134); admission comes from r0_my_trial_access (TRACE-103)
// and the request command still enforces it (TRACE-101).

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, MapPin, RefreshCw } from "lucide-react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { ProviderProfileView, type NextStepContext } from "@/components/provider-profile/ProviderProfileView";
import { useServiceParam } from "@/components/provider-profile/useServiceParam";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useTrialAccess } from "@/hooks/useTrialAccess";
import { earlyAccessHref } from "@/lib/earlyAccessExperience";
import {
  directoryContextFrom,
  profileServices,
  providerDirectoryHref,
  selectedOffer,
  serviceDisplayName,
  profileViewer,
  validProviderId,
} from "@/lib/providerProfile/model";
import { fetchPublicProviderProfile, type PublicProfile } from "@/lib/providerProfile/publicProfile";
import { createClient } from "@/lib/supabase/client";
import { captureAnalytics } from "@/lib/analytics/client";
import { CONSENT_EVENT } from "@/lib/analytics/policy";
import type { PricingFrequency } from "@/lib/vendorPricing";

type RouteState =
  | { mode: "loading" }
  | { mode: "missing" }
  | { mode: "error"; message: string }
  /** refreshFailed: a background refresh could not read the listing; prices are withdrawn. */
  | { mode: "ready"; profile: PublicProfile; refreshFailed: boolean };

const REFRESH_MS = 60_000;

export default function ProviderProfilePage() {
  const params = useParams<{ id: string }>();
  const providerId = typeof params.id === "string" ? params.id : "";
  // Keyed by provider: a move to another provider's profile starts from nothing, so no package,
  // ZIP, media failure, review or pending response from the last provider can carry over.
  return <Suspense fallback={<ProfileLoading />}>
    <ProviderProfileRoute key={providerId} providerId={providerId} />
  </Suspense>;
}

function ProviderProfileRoute({ providerId }: { providerId: string }) {
  const router = useRouter();
  const trial = useTrialAccess();
  const viewer = profileViewer(trial);
  const [service, setService] = useServiceParam();
  // The directory's search and category arrive as validated values, never as a return URL.
  const directory = directoryContextFrom(useSearchParams());
  const directoryHref = providerDirectoryHref({ ...directory, providerId });
  const [state, setState] = useState<RouteState>({ mode: "loading" });

  // Every load takes a ticket; only the newest one may change the page. A slow earlier read
  // (a retry, a refresh, a realtime event) can never overwrite a newer one, and nothing that
  // resolves after this provider's profile is left can reach the next one.
  const ticket = useRef(0);
  useEffect(() => () => { ticket.current += 1; }, []);

  const load = useCallback(async (background: boolean) => {
    const mine = ++ticket.current;
    if (!validProviderId(providerId)) {
      setState({ mode: "missing" });
      return;
    }
    if (!background) setState((current) => (current.mode === "ready" ? current : { mode: "loading" }));
    const result = await fetchPublicProviderProfile(providerId).catch((reason: unknown) => {
      console.error("Unable to load public provider profile", reason);
      return { status: "error" as const, message: "We couldn't confirm this provider's current public information." };
    });
    if (mine !== ticket.current) return;
    setState((current) => {
      if (result.status === "ready") return { mode: "ready", profile: result.profile, refreshFailed: false };
      if (result.status === "missing") return { mode: "missing" };
      // A failed refresh keeps the profile on screen, but no price it can no longer confirm.
      if (current.mode === "ready") {
        return {
          mode: "ready",
          refreshFailed: true,
          profile: { ...current.profile, data: { ...current.profile.data, offersStatus: "unavailable", packages: [] } },
        };
      }
      return { mode: "error", message: result.message };
    });
  }, [providerId]);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(false); }, 0);
    // The inherited storefront's refresh: offers, levels and extras can change without an event.
    const refresh = window.setInterval(() => { void load(true); }, REFRESH_MS);
    return () => { window.clearTimeout(first); window.clearInterval(refresh); };
  }, [load]);

  const ready = state.mode === "ready";
  useEffect(() => {
    if (!ready) return;
    const viewed = () => captureAnalytics("provider_profile_viewed", { provider_id: providerId });
    viewed();
    window.addEventListener(CONSENT_EVENT, viewed);
    return () => window.removeEventListener(CONSENT_EVENT, viewed);
  }, [ready, providerId]);
  useEffect(() => {
    if (!ready || !validProviderId(providerId)) return;
    const supabase = createClient();
    const refresh = () => { void load(true); };
    const channel = supabase
      .channel(`public-provider-${providerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "contractors", filter: `id=eq.${providerId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "vendor_packages", filter: `contractor_id=eq.${providerId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "contractor_gallery", filter: `contractor_id=eq.${providerId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "reviews", filter: `contractor_id=eq.${providerId}` }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [providerId, load, ready]);

  const retry = useCallback(() => { void load(true); }, [load]);

  if (state.mode === "loading") return <ProfileLoading />;
  if (state.mode === "missing") return <ProfileMissing directoryHref={providerDirectoryHref(directory)} />;
  if (state.mode === "error") return <ProfileError message={state.message} retry={() => void load(false)} />;

  const { data } = state.profile;
  const nextStep = (context: NextStepContext) => {
    if (context.kind === "retry") return trial.retry();
    if (context.kind === "closed") return router.push("/dashboard");
    if (context.kind === "early_access") return router.push(earlyAccessHref(context.serviceId ? [context.serviceId] : []));
    if (context.kind !== "request") return;
    router.push(requestHandoff(state.profile, context));
  };

  return <div className="min-h-screen bg-background">
    <Header />
    <main id="main-content" tabIndex={-1}>
      {state.refreshFailed && <div data-refresh-failed role="status" className="border-b border-border bg-secondary">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="text-sm text-foreground">This profile couldn&apos;t be refreshed. Prices are hidden until they can be confirmed again.</p>
          <Button type="button" variant="outline" onClick={retry}><RefreshCw aria-hidden="true" />Try again</Button>
        </div>
      </div>}
      <ProviderProfileView
        data={data}
        requestedServiceId={service}
        onServiceChange={(next) => { setService(next); }}
        viewer={viewer}
        directoryHref={directoryHref}
        onNextStep={nextStep}
        onRetryReviews={retry}
        onRetryCoverage={retry}
        onRetryOffers={retry}
        interactiveExtras={false}
      />
    </main>
    <Footer />
  </div>;
}

/**
 * The existing request entry (TRACE-103/112): the request step reads this tab's selection once,
 * binds the request to this provider for the service, and keeps the chosen package and cadence.
 * A level is bound only when the cadence publishes exactly one level without an answer rule;
 * otherwise the request step's server calculation resolves it from the homeowner's answers, so
 * the cheapest answer-based level is never sent as the homeowner's level. Extras are chosen in
 * the request step. Promotions are never handed over (TRACE-134).
 */
function requestHandoff(profile: PublicProfile, context: NextStepContext): string {
  const { data, questions } = profile;
  const { provider } = data;
  const services = data.offersStatus === "unavailable" ? [] : profileServices(data);
  const service = services.find((candidate) => candidate.id === context.serviceId) ?? null;
  const serviceId = service?.id ?? data.listedServiceIds?.[0] ?? null;
  const chosen = service && context.offerId
    ? selectedOffer(service, { serviceId: service.id, offerId: context.offerId, frequency: (context.frequency ?? "one-time") as PricingFrequency, addons: {} })
    : null;
  const offer = chosen?.offer ?? null;
  const cadence = chosen?.cadence ?? null;
  const serviceName = serviceId ? serviceDisplayName(serviceId, data.serviceNames) : "Home service";
  const frequency = cadence?.frequency ?? offer?.defaultFrequency ?? "one-time";

  try {
    if (serviceId) {
      const cadences = offer?.kind === "fixed" ? offer.cadences : [];
      window.sessionStorage.setItem("homePlanSelection", JSON.stringify({
        selectedServiceIds: [serviceId],
        frequencies: { [serviceId]: frequency },
        requestedServices: [{
          id: serviceId,
          name: serviceName,
          availability: cadence ? "fixed" : "quote",
          descriptor: offer?.description ?? `Requested from ${provider.name}`,
          defaultFrequency: frequency,
          frequencies: cadences.length ? cadences.map((option) => option.frequency) : [frequency],
          prices: cadences.length ? Object.fromEntries(cadences.map((option) => [option.frequency, option.baseCents / 100])) : undefined,
          packageId: offer?.id,
          tierId: cadence?.boundTier?.id,
          pricingMode: offer?.pricingMode,
          // Unreadable questions are left to the request step's server preview, never sent as "none".
          questions: offer && questions ? questions.get(offer.id) ?? [] : undefined,
          packageName: offer?.name,
          packageDescription: offer?.description,
          tierName: cadence?.boundTier?.name,
          tierIncludes: cadence?.boundTier?.includes,
        }],
      }));
    }
    window.sessionStorage.setItem("preferredProviderSelection", JSON.stringify({
      contractorId: provider.id,
      contractorName: provider.name,
      serviceId,
    }));
  } catch (reason) {
    // Storage can be unavailable (privacy mode, quota). The query below still binds the provider
    // and service; the request step then offers the provider's eligible offering for the address.
    console.warn("Unable to hand the provider selection to the request step", reason);
  }

  const query = new URLSearchParams({ provider: provider.id, providerName: provider.name, requested: serviceName });
  if (serviceId) query.set("service", serviceId);
  return `/request?${query.toString()}`;
}

function ProfileLoading() {
  return <div className="min-h-screen bg-background">
    <Header />
    <main id="main-content" tabIndex={-1} aria-busy="true">
      <p role="status" className="sr-only">Loading provider profile</p>
      <div className="mx-auto w-full max-w-6xl animate-pulse px-4 pb-16 pt-4 sm:px-8">
        <div className="h-11 w-28 rounded bg-secondary" />
        <div className="mt-2 flex items-center gap-6"><div className="size-16 rounded-xl bg-secondary" /><div className="flex-1 space-y-3"><div className="h-9 w-2/3 rounded bg-secondary" /><div className="h-4 w-1/3 rounded bg-secondary" /></div></div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"><div className="aspect-[16/9] rounded-xl bg-secondary" /><div className="h-72 rounded-xl bg-secondary" /></div>
      </div>
    </main>
    <Footer />
  </div>;
}

function ProfileMissing({ directoryHref }: { directoryHref: string }) {
  return <ProfileState
    icon={MapPin}
    title="Provider not found"
    copy="This provider is not currently available in the public Mercurius network."
    action={<Link href={directoryHref} className={buttonVariants({ size: "lg" })}>Browse providers<ArrowRight aria-hidden="true" /></Link>}
  />;
}

function ProfileError({ message, retry }: { message: string; retry: () => void }) {
  return <ProfileState
    icon={AlertCircle}
    title="Provider profile unavailable"
    copy={`${message} No substitute profile data has been shown.`}
    action={<Button size="lg" onClick={retry}><RefreshCw aria-hidden="true" />Try again</Button>}
  />;
}

function ProfileState({ icon: Icon, title, copy, action }: { icon: typeof AlertCircle; title: string; copy: string; action: React.ReactNode }) {
  return <div className="min-h-screen bg-background">
    <Header />
    <main id="main-content" tabIndex={-1} className="flex min-h-[65vh] items-center justify-center bg-hero px-4 py-16">
      <Card className="w-full max-w-xl border-border/70 shadow-lg">
        <CardContent className="py-12 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent/10"><Icon aria-hidden="true" className="size-7 text-accent" /></div>
          <h1 className="mt-5 font-heading text-2xl font-semibold">{title}</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{copy}</p>
          <div className="mt-6">{action}</div>
        </CardContent>
      </Card>
    </main>
    <Footer />
  </div>;
}
