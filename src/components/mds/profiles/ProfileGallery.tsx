"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { ProviderDirectoryCard } from "@/components/provider-profile/ProviderDirectoryCard";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { PROFILE_SCENARIOS, SYNTHETIC_SERVICE_NAMES, ZIP_EXAMPLES } from "@/components/mds/profiles/profileFixtures";
import { cardOffer, profileServices } from "@/lib/providerProfile/model";

/** Gated review gallery: directory cards and profile scenarios built from synthetic providers. */
export function ProfileGallery() {
  const [context, setContext] = useState("");
  const providers = useMemo(() => PROFILE_SCENARIOS.map((scenario) => ({ scenario, services: profileServices(scenario.data) })), []);
  const offered = useMemo(() => {
    const ids = new Set(providers.flatMap(({ services }) => services.map((service) => service.id)));
    return Object.entries(SYNTHETIC_SERVICE_NAMES).filter(([id]) => ids.has(id));
  }, [providers]);
  const cards = providers.flatMap(({ scenario, services }) => {
    const card = cardOffer(services, context || null);
    return card ? [{ scenario, card }] : [];
  });

  return <>
    <Header />
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-8">
      <PageHeader
        eyebrow="Mercurius Design System · Review gallery"
        title="Provider cards and dynamic profiles"
        description="Fictional providers rendered through the shared card and profile components. Card and interior visual direction are approved; the service-focused profile is an exploration for owner review. Nothing here reads or changes Marketplace data."
      />
      <Link href="/mds" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Back to component foundation</Link>

      <section aria-labelledby="gallery-cards" className="space-y-4">
        <h2 id="gallery-cards" className="text-xl font-semibold">Directory cards</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Without a service context each card shows the provider&apos;s first published offer. With one, it shows that service&apos;s offer, and providers that do not publish it are left out.
        </p>
        <label className="flex max-w-sm flex-col gap-1 text-sm font-medium">
          Directory service context
          <Select value={context} onChange={(event) => setContext(event.target.value)}>
            <option value="">All providers</option>
            {offered.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        </label>
        <p role="status" className="text-sm text-muted-foreground">{cards.length} provider{cards.length === 1 ? "" : "s"} shown</p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ scenario, card }) => <ProviderDirectoryCard
            key={scenario.slug}
            provider={scenario.data.provider}
            card={card}
            media={scenario.data.media}
            href={`/mds/profiles/${scenario.slug}${context ? `?service=${encodeURIComponent(context)}` : ""}`}
          />)}
        </div>
      </section>

      <section aria-labelledby="gallery-scenarios" className="space-y-4">
        <h2 id="gallery-scenarios" className="text-xl font-semibold">Profile scenarios and direct links</h2>
        <ul className="grid gap-4 md:grid-cols-2">
          {PROFILE_SCENARIOS.map((scenario) => <li key={scenario.slug} className="min-w-0 rounded-xl border bg-card p-4 sm:p-6">
            <h3 className="text-lg font-semibold [overflow-wrap:anywhere]">{scenario.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">{scenario.data.provider.name}. {scenario.summary}</p>
            <ul className="mt-3 space-y-1">
              {scenario.links.map((link) => <li key={link.label}>
                <Link href={`/mds/profiles/${scenario.slug}${link.query}`} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{link.label}</Link>
                <span className="block text-sm text-muted-foreground">{link.note}</span>
              </li>)}
            </ul>
          </li>)}
        </ul>
      </section>

      <section aria-labelledby="gallery-zips" className="space-y-2">
        <h2 id="gallery-zips" className="text-xl font-semibold">ZIP results to try</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">In any profile&apos;s service-area check. Northside Handyman lists no ZIP codes and the long-name scenario cannot read coverage, so both return an unknown result.</p>
        <ul className="space-y-1 text-sm">
          {ZIP_EXAMPLES.map((example) => <li key={example.zip}><span className="font-mono font-semibold">{example.zip}</span> · {example.note}</li>)}
        </ul>
      </section>
    </main>
  </>;
}
