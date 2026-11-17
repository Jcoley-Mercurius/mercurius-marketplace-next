"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BadgeCheck, Check, RefreshCw, Star } from "lucide-react";
import { ProfileMediaGallery } from "@/components/provider-profile/ProfileMediaGallery";
import { BusinessSummary, OfferSummary, PackageSelector, ServiceList } from "@/components/provider-profile/ProfileOfferPanels";
import { ProfileServiceArea } from "@/components/provider-profile/ProfileServiceArea";
import { ProviderLogo } from "@/components/provider-profile/ProviderCover";
import { PublicReviewAuthor } from "@/components/reviews/PublicReviewAuthor";
import { Button } from "@/components/ui/button";
import { displayedProviderBadges } from "@/lib/providerBadges";
import {
  cadenceLabel,
  mediaForService,
  nextStepCopy,
  pricePreview,
  profileServices,
  questionsForService,
  reconcileOfferSelection,
  resolveServiceSelection,
  selectedOffer,
  selectionAnnouncement,
  type OfferSelection,
  type ProfileData,
  type ProfileViewer,
} from "@/lib/providerProfile/model";
import { summaryLine } from "@/lib/reviews/serviceReview";
import { cn } from "@/lib/utils";

export type NextStepContext = {
  serviceId: string | null;
  offerId: string | null;
  frequency: string | null;
  addons: Record<string, number>;
};

const anywhere = "[overflow-wrap:anywhere]";
const sectionLink = "inline-flex min-h-11 items-center border-b-2 border-transparent px-1 text-sm font-medium text-foreground hover:border-border-strong";

/**
 * Shared provider profile composition (interior visual direction approved 2026-11-05; the
 * service-focused behavior is an exploration for owner review). It renders only what it is
 * given: eligibility, prices, reviews and coverage are decided before the data arrives here.
 */
export function ProviderProfileView({ data, requestedServiceId, onServiceChange, viewer, directoryHref, onNextStep, onRetryReviews, onRetryCoverage }: {
  data: ProfileData;
  /** The URL's service choice; null or empty is All services. */
  requestedServiceId: string | null;
  onServiceChange: (serviceId: string | null) => void;
  viewer: ProfileViewer;
  directoryHref: string;
  onNextStep: (context: NextStepContext) => void;
  onRetryReviews?: () => void;
  onRetryCoverage?: () => void;
}) {
  const id = useId();
  const { provider } = data;
  const services = useMemo(() => profileServices(data), [data]);
  const selection = resolveServiceSelection(requestedServiceId, services);
  const service = selection.kind === "service" ? selection.service : null;
  const viewKey = service?.id ?? (selection.kind === "unavailable" ? `unavailable:${selection.requestedId}` : "all");

  // Package, cadence and extras belong to one service view. Any change of view, including
  // Back and Forward, discards them, so a choice made for one service never prices another.
  const [stored, setStored] = useState<OfferSelection | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [seenView, setSeenView] = useState(viewKey);
  if (seenView !== viewKey) {
    setSeenView(viewKey);
    setStored(null);
    setAnnouncement(selectionAnnouncement(provider.name, selection, services));
  }
  const offerSelection = service ? reconcileOfferSelection(service, stored) : null;
  const chosen = service && offerSelection ? selectedOffer(service, offerSelection) : null;

  // Selecting from a list that then leaves the page returns focus to the service chooser.
  const chooser = useRef<HTMLFieldSetElement>(null);
  const focusChooser = useRef(false);
  useEffect(() => {
    if (!focusChooser.current) return;
    focusChooser.current = false;
    chooser.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
  }, [viewKey]);
  const selectFromList = (serviceId: string | null) => {
    focusChooser.current = true;
    onServiceChange(serviceId);
  };

  const changeOffer = (next: OfferSelection) => {
    if (!service) return;
    const reconciled = reconcileOfferSelection(service, next);
    setStored(reconciled);
    const { offer, cadence } = selectedOffer(service, reconciled);
    setAnnouncement(cadence
      ? `${offer.name}, ${cadenceLabel(cadence.frequency).toLowerCase()}: ${pricePreview(offer, cadence, reconciled.addons).totalLabel} service subtotal.`
      : `${offer.name}: quote after walkthrough.`);
  };

  const media = mediaForService(data.media, service?.id ?? null);
  const questions = service ? questionsForService(data.questions, service.id) : [];
  const badges = displayedProviderBadges(provider.badges);
  const step = nextStepCopy(viewer, chosen ? chosen.offer.kind : "all");
  const next = () => onNextStep({
    serviceId: service?.id ?? null,
    offerId: chosen?.offer.id ?? null,
    frequency: chosen?.cadence?.frequency ?? null,
    addons: offerSelection?.addons ?? {},
  });
  const unavailableName = selection.kind === "unavailable" ? data.serviceNames[selection.requestedId] ?? null : null;
  const summary = (headingId: string) => service && offerSelection
    ? <OfferSummary service={service} selection={offerSelection} headingId={headingId} />
    : <BusinessSummary providerName={provider.name} services={services} headingId={headingId} />;

  return <div data-profile={provider.id} data-profile-view={service?.id ?? "all"} className="mx-auto w-full max-w-6xl px-4 pb-36 pt-4 sm:px-8 lg:pb-16">
    <Link href={directoryHref} className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-sage-dark">
      <ArrowLeft aria-hidden="true" className="size-4" />Providers
    </Link>

    <header className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
      <ProviderLogo name={provider.name} logoUrl={provider.logo_url} size="header" />
      <div className="min-w-0 sm:border-l sm:border-border sm:pl-6">
        <h1 className={cn("text-[1.75rem] font-semibold leading-9 tracking-tight text-foreground sm:text-4xl lg:text-[2.5rem] lg:leading-[3rem]", anywhere)}>{provider.name}</h1>
        {provider.location && <p className="mt-1 text-sm leading-5 text-muted-foreground">Based in {provider.location}</p>}
        {provider.tagline && <p className={cn("mt-2 text-base leading-6 text-foreground", anywhere)}>{provider.tagline}</p>}
        <p data-review-summary className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Star aria-hidden="true" className="size-4" />{data.reviews ? summaryLine(data.reviews.summary) : "Reviews unavailable"}
        </p>
      </div>
    </header>

    {services.length > 0 && <fieldset ref={chooser} className="mt-6">
      <legend className="text-base font-semibold text-foreground">What can we help with?</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {[{ id: null as string | null, name: "All services" }, ...services].map((option) => {
          const checked = (service?.id ?? null) === option.id;
          return <label
            key={option.id ?? "all"}
            className={cn(
              "relative inline-flex min-h-11 max-w-full cursor-pointer items-center gap-2 rounded-full border border-border-strong bg-card px-4 py-2 text-sm font-medium text-foreground has-checked:border-commitment has-checked:bg-accent-soft has-checked:font-semibold has-focus-visible:ring-3 has-focus-visible:ring-ring",
              anywhere,
            )}
          >
            <input
              type="radio"
              name={`${id}-service`}
              value={option.id ?? ""}
              checked={checked}
              onChange={() => onServiceChange(option.id)}
              className="sr-only"
            />
            {checked && <Check aria-hidden="true" className="size-4 shrink-0 text-sage-dark" />}
            <span>{option.name}</span>
          </label>;
        })}
      </div>
    </fieldset>}

    <p role="status" aria-live="polite" data-profile-announcement className="sr-only">{announcement}</p>

    {selection.kind === "unavailable" && <div data-unavailable-service role="note" className="mt-4 rounded-xl border border-border-strong bg-secondary p-4">
      <p className={cn("text-base font-semibold text-foreground", anywhere)}>
        {unavailableName ?? "The linked service"} is not currently offered by {provider.name}.
      </p>
      <p className="mt-1 text-sm text-foreground">
        {services.length > 0
          ? "It may have been withdrawn or changed. All services are shown instead; choose one above to see its current offer."
          : "It may have been withdrawn or changed. This provider has no published services right now."}
      </p>
    </div>}

    <nav aria-label="Profile sections" className="mt-4 flex flex-wrap gap-x-4 border-b border-border">
      <a href="#profile-services" className={sectionLink}>Work &amp; services</a>
      <a href="#profile-about" className={sectionLink}>About</a>
      <a href="#profile-reviews" className={sectionLink}>Reviews</a>
      <a href="#profile-area" className={sectionLink}>Service area</a>
    </nav>

    <div id="profile-services" className="mt-6 grid scroll-mt-24 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
      <div className="min-w-0 space-y-6">
        {/* Phones and tablets: the decision details come before the large media. */}
        <div className="lg:hidden">{summary(`${id}-summary-inline`)}</div>

        <ProfileMediaGallery
          key={viewKey}
          providerName={provider.name}
          logoUrl={provider.logo_url}
          items={media.items}
          general={media.general}
          serviceName={service?.name ?? null}
        />

        {service && offerSelection
          ? <PackageSelector key={service.id} service={service} selection={offerSelection} onChange={changeOffer} idPrefix={`${id}-${service.id}`} />
          : services.length > 0 && <ServiceList heading="Explore services" headingId={`${id}-explore`} services={services} onSelect={selectFromList} />}
      </div>

      <aside className="hidden lg:block">
        <div className="sticky top-24 rounded-xl bg-card p-6 ring-1 ring-border-strong">
          {summary(`${id}-summary-aside`)}
          <Button type="button" variant="commitment" size="lg" className="mt-5 w-full text-base" onClick={next}>
            {step.label}<ArrowRight aria-hidden="true" />
          </Button>
          <p className="mt-2 text-center text-sm text-muted-foreground">{step.note}</p>
          <a href="#profile-area" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-sage-dark">See service area<ArrowRight aria-hidden="true" className="size-4" /></a>
        </div>
      </aside>
    </div>

    <div className="mt-10 space-y-8">
      <section id="profile-about" aria-labelledby={`${id}-about`} className="scroll-mt-24 border-t border-border pt-8">
        <h2 id={`${id}-about`} className={cn("text-2xl font-semibold text-foreground", anywhere)}>About {provider.name}</h2>
        {provider.bio
          ? <p className="mt-3 max-w-3xl whitespace-pre-line text-base leading-6 text-foreground">{provider.bio}</p>
          : <p className="mt-3 text-base text-muted-foreground">This provider has not added a business description yet.</p>}
        {badges.length > 0 && <ul aria-label="Credentials" className="mt-4 flex flex-wrap gap-2">
          {badges.map((badge) => <li key={badge} className="flex min-h-9 items-center gap-2 rounded-lg bg-sage-light px-3 text-sm font-medium text-sage-dark">
            <BadgeCheck aria-hidden="true" className="size-4" />{badge}
          </li>)}
        </ul>}
      </section>

      <section id="profile-reviews" aria-labelledby={`${id}-reviews`} className="scroll-mt-24 border-t border-border pt-8">
        <h2 id={`${id}-reviews`} className="text-2xl font-semibold text-foreground">Customer reviews</h2>
        {!data.reviews && <div data-reviews="unavailable" className="mt-3 rounded-xl bg-secondary p-4">
          <p className="text-base font-semibold text-foreground">Reviews could not be loaded</p>
          <p className="mt-1 text-sm text-slate">No rating or review count is shown until they can be read.</p>
          {onRetryReviews && <Button type="button" variant="outline" className="mt-3" onClick={onRetryReviews}><RefreshCw aria-hidden="true" />Try again</Button>}
        </div>}
        {data.reviews && <>
          <p className="mt-1 text-base text-muted-foreground">
            {summaryLine(data.reviews.summary)}{data.reviews.summary.count > 0 && services.length > 1 ? " · Reviews cover the whole business, not one service." : ""}
          </p>
          {data.reviews.reviews.length === 0
            ? <p data-reviews="empty" className="mt-3 text-sm text-muted-foreground">Published feedback appears here as reviews become available.</p>
            : <ul data-reviews="list" className="mt-4 divide-y divide-border">
              {data.reviews.reviews.map((review) => <li key={review.id} className="py-4 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <PublicReviewAuthor />
                    <p className="flex items-center gap-0.5" role="img" aria-label={`${review.rating} out of 5 stars`}>
                      {Array.from({ length: 5 }, (_, star) => <Star key={star} aria-hidden="true" className={cn("size-4", star < review.rating ? "fill-sage-dark text-sage-dark" : "text-border-strong")} />)}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground"><time dateTime={review.created_at}>{formatDate(review.created_at)}</time>{review.edited && " · Edited"}</p>
                </div>
                {review.comment && <p className={cn("mt-2 text-base leading-6 text-foreground", anywhere)}>{review.comment}</p>}
              </li>)}
            </ul>}
        </>}
      </section>

      {service && questions.length > 0 && <section aria-labelledby={`${id}-questions`} className="border-t border-border pt-8">
        <h2 id={`${id}-questions`} className={cn("text-2xl font-semibold text-foreground", anywhere)}>Questions about {service.name.toLowerCase()}</h2>
        <div className="mt-3 divide-y divide-border border-y border-border">
          {questions.map((question, index) => <details key={question.id} open={index === 0} className="group">
            <summary className={cn("flex min-h-11 cursor-pointer items-center py-2 text-base font-semibold text-foreground", anywhere)}>{question.question}</summary>
            <div className="pb-4">
              <p className="text-base leading-6 text-foreground">{question.answer}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{question.source === "provider" ? "From the provider" : "Marketplace policy"}</p>
            </div>
          </details>)}
        </div>
      </section>}

      <ProfileServiceArea
        key={viewKey}
        providerName={provider.name}
        serviceName={service?.name ?? null}
        serviceArea={data.serviceArea}
        marketplaceZips={data.marketplaceZips}
        directoryHref={directoryHref}
        onRetry={onRetryCoverage}
      />

      {service && <div className="border-t border-border pt-8">
        <ServiceList
          heading="Other services"
          headingId={`${id}-other`}
          services={services.filter((candidate) => candidate.id !== service.id)}
          onSelect={selectFromList}
          allServices
        />
      </div>}
    </div>

    {/* Phones and tablets: one visible action, clear of the device safe area. */}
    <div data-profile-action-bar className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-4 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-3 lg:hidden">
      <Button type="button" variant="commitment" size="lg" className="w-full text-base" onClick={next}>{step.label}<ArrowRight aria-hidden="true" /></Button>
      <p className="mt-1 text-center text-xs text-muted-foreground">{step.note}</p>
    </div>
  </div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date(value));
}
