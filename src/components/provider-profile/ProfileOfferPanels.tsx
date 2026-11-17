"use client";

import { ArrowRight, Check, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCents } from "@/lib/pricingContent";
import {
  addonMaxQuantity,
  addonUnitLabel,
  billingBasisLabel,
  cadenceLabel,
  cadencePriceLabel,
  cadenceQualifierNote,
  offerPriceLine,
  pricePreview,
  quoteHeadline,
  selectedOffer,
  type OfferSelection,
  type ProfileAddon,
  type ProfileOffer,
  type ProfileService,
} from "@/lib/providerProfile/model";
import type { PricingFrequency } from "@/lib/vendorPricing";
import { cn } from "@/lib/utils";

const anywhere = "[overflow-wrap:anywhere]";

// ---------------------------------------------------------------------------------------------
// Selected-offer summary: one price, with its scope and conditions beside it
// ---------------------------------------------------------------------------------------------

export function OfferSummary({ service, selection, headingId }: {
  service: ProfileService;
  selection: OfferSelection;
  headingId: string;
}) {
  const { offer, cadence } = selectedOffer(service, selection);
  const preview = cadence ? pricePreview(offer, cadence, selection.addons) : null;
  const extrasChosen = (preview?.lines.length ?? 0) > 1;

  return <div data-offer-summary={offer.kind}>
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Selected service · {service.name}</p>
    <h2 id={headingId} className={cn("mt-2 text-xl font-semibold leading-7 text-foreground", anywhere)}>{offer.name}</h2>

    {cadence ? <>
      <p data-offer-price className="mt-1 text-4xl font-semibold leading-tight tracking-tight text-commitment">{cadencePriceLabel(cadence)}</p>
      <p className={cn("mt-1 text-base text-foreground", anywhere)}>{[billingBasisLabel(cadence.frequency), ...offer.scope].join(" · ")}</p>
      {cadenceQualifierNote(cadence) && <p className="mt-1 text-sm text-muted-foreground">{cadenceQualifierNote(cadence)}</p>}
      {cadence.includes.length > 0 && <p className={cn("mt-1 text-sm text-muted-foreground", anywhere)}>{cadence.levels > 1 ? "Starting level" : "Includes"}: {cadence.includes.join(", ")}</p>}

      {cadence.requiredAddons.length > 0 && <div className="mt-4 border-t border-border pt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Required · included in the price shown</p>
        <ul className="mt-2 space-y-1">{cadence.requiredAddons.map((addon) => <AddonRow key={addon.id} addon={addon} />)}</ul>
      </div>}

      {cadence.optionalAddons.length > 0 && !extrasChosen && <div className="mt-4 border-t border-border pt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Optional extras</p>
        <ul className="mt-2 space-y-1">{cadence.optionalAddons.map((addon) => <AddonRow key={addon.id} addon={addon} />)}</ul>
      </div>}

      {preview && extrasChosen && <div data-price-preview className="mt-4 rounded-xl bg-secondary p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate">Price preview</p>
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <p className="text-base font-semibold text-foreground">Service subtotal</p>
          <p data-price-total className="text-xl font-semibold tabular-nums text-foreground">{preview.totalLabel}</p>
        </div>
        <ul className="mt-2 space-y-1">{preview.lines.map((line) => <li key={line.id} className="flex items-baseline justify-between gap-3 text-sm text-foreground">
          <span className={cn("min-w-0", anywhere)}>{line.label}</span><span className="shrink-0 tabular-nums">{line.amount}</span>
        </li>)}</ul>
        <p className="mt-3 text-xs leading-5 text-slate">Calculated from the published offer. Applicable taxes or other approved charges are disclosed in the request step, which confirms the final amount.</p>
      </div>}
    </> : <>
      <p data-offer-price className="mt-1 text-3xl font-semibold leading-tight tracking-tight text-foreground">{quoteHeadline()}</p>
      {offer.estimateLabel && <p className="mt-2 text-base text-foreground"><span className="font-semibold tabular-nums">{offer.estimateLabel}</span> · the provider confirms the final price</p>}
      <p className="mt-2 text-sm text-muted-foreground">Final scope and price are confirmed after the walkthrough. No price is shown as bookable until then.</p>
      {offer.scope.length > 0 && <p className={cn("mt-2 text-sm text-foreground", anywhere)}><span className="font-medium">Included:</span> {offer.scope.join(" · ")}</p>}
      {offer.depositCents != null && <div data-offer-deposit className="mt-4 border-t border-border pt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deposit</p>
        <p className="mt-1 text-sm text-foreground">A {formatCents(offer.depositCents)} deposit may apply after scope, final pricing, and booking details are confirmed. Nothing is charged with the initial request.</p>
      </div>}
      {offer.quoteAddons.length > 0 && <div className="mt-4 border-t border-border pt-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Published extras · confirmed in the quote</p>
        <ul className="mt-2 space-y-1">{offer.quoteAddons.map((addon) => <AddonRow key={addon.id} addon={addon} />)}</ul>
      </div>}
    </>}
  </div>;
}

function AddonRow({ addon }: { addon: ProfileAddon }) {
  return <li className="flex items-baseline justify-between gap-3 text-sm">
    <span className={cn("min-w-0 font-medium text-foreground", anywhere)}>{addon.name}</span>
    <span className="shrink-0 font-semibold tabular-nums text-foreground">{addonUnitLabel(addon)}</span>
  </li>;
}

/** The All services summary: no single price stands in for the business. */
export function BusinessSummary({ providerName, services, headingId }: {
  providerName: string;
  services: readonly ProfileService[];
  headingId: string;
}) {
  const fixed = services.filter((service) => service.mode !== "quote").length;
  const quoted = services.filter((service) => service.mode !== "fixed").length;
  return <div data-offer-summary="all">
    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">All services</p>
    <h2 id={headingId} className={cn("mt-2 text-xl font-semibold leading-7 text-foreground", anywhere)}>
      {services.length === 0 ? "No published services yet" : `${services.length} published service${services.length === 1 ? "" : "s"}`}
    </h2>
    <p className={cn("mt-2 text-sm text-muted-foreground", anywhere)}>
      {services.length === 0
        ? `${providerName} has no live prices or quotes yet.`
        : [
          fixed > 0 ? `${fixed} with published prices` : null,
          quoted > 0 ? `${quoted} quoted after a walkthrough` : null,
        ].filter(Boolean).join(" · ") + ". Choose a service to see its offer, scope and price."}
    </p>
  </div>;
}

// ---------------------------------------------------------------------------------------------
// Package, cadence and extras selection
// ---------------------------------------------------------------------------------------------

export function PackageSelector({ service, selection, onChange, idPrefix }: {
  service: ProfileService;
  selection: OfferSelection;
  onChange: (next: OfferSelection) => void;
  idPrefix: string;
}) {
  const { offer, cadence } = selectedOffer(service, selection);
  const several = service.offers.length > 1;

  const chooseOffer = (next: ProfileOffer) => onChange({
    serviceId: service.id, offerId: next.id, frequency: next.cadences[0]?.frequency ?? next.defaultFrequency, addons: {},
  });
  const chooseFrequency = (frequency: PricingFrequency) => onChange({ ...selection, frequency, addons: {} });
  const setAddon = (addon: ProfileAddon, quantity: number) => {
    const addons = { ...selection.addons };
    if (quantity > 0) addons[addon.id] = Math.min(quantity, addonMaxQuantity(addon)); else delete addons[addon.id];
    onChange({ ...selection, addons });
  };

  return <section aria-labelledby={`${idPrefix}-packages`} className="space-y-5">
    <h2 id={`${idPrefix}-packages`} className="text-2xl font-semibold text-foreground">{several ? "Choose your package" : "Published offer"}</h2>

    {several ? <fieldset className="space-y-3">
      <legend className="sr-only">{service.name} packages</legend>
      {service.offers.map((candidate) => <label
        key={candidate.id}
        data-offer-option={candidate.id}
        className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-xl border border-border-strong bg-card p-4 has-checked:border-commitment has-checked:bg-accent-subtle sm:grid-cols-[auto_minmax(0,1fr)_auto]"
      >
        <input
          type="radio"
          name={`${idPrefix}-offer`}
          value={candidate.id}
          checked={candidate.id === offer.id}
          onChange={() => chooseOffer(candidate)}
          className="mt-0.5 size-5 shrink-0 accent-commitment"
        />
        <OfferText offer={candidate} />
        <OfferPrice offer={candidate} className="col-start-2 sm:col-start-3 sm:text-right" />
      </label>)}
    </fieldset> : <div data-offer-option={offer.id} className="grid grid-cols-[minmax(0,1fr)] gap-1 rounded-xl border border-border-strong bg-card p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-3">
      <OfferText offer={offer} />
      <OfferPrice offer={offer} className="sm:text-right" />
    </div>}

    {offer.kind === "fixed" && offer.cadences.length > 1 && <fieldset>
      <legend className="text-base font-semibold text-foreground">How often?</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {offer.cadences.map((candidate) => <label
          key={candidate.frequency}
          className="relative inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border-strong bg-card px-4 py-2 text-sm font-medium text-foreground has-checked:border-commitment has-checked:bg-accent-soft has-checked:font-semibold has-focus-visible:ring-3 has-focus-visible:ring-ring"
        >
          <input
            type="radio"
            name={`${idPrefix}-cadence`}
            value={candidate.frequency}
            checked={candidate.frequency === cadence?.frequency}
            onChange={() => chooseFrequency(candidate.frequency)}
            className="sr-only"
          />
          {candidate.frequency === cadence?.frequency && <Check aria-hidden="true" className="size-4 text-sage-dark" />}
          <span>{cadenceLabel(candidate.frequency)} · {cadencePriceLabel(candidate)}{candidate.frequency === "one-time" ? "" : " per visit"}</span>
        </label>)}
      </div>
    </fieldset>}

    {cadence && cadence.optionalAddons.length > 0 && <div data-optional-extras>
      <h3 className="text-base font-semibold text-foreground">Optional extras</h3>
      <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card">
        {cadence.optionalAddons.map((addon) => {
          const quantity = selection.addons[addon.id] ?? 0;
          const max = addonMaxQuantity(addon);
          return <li key={addon.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4">
            <div className="min-w-0 flex-1 basis-40">
              <p className={cn("text-base font-medium text-foreground", anywhere)}>{addon.name} <span className="font-normal text-muted-foreground">{addonUnitLabel(addon)}</span></p>
              {addon.description && <p className={cn("text-sm text-muted-foreground", anywhere)}>{addon.description}</p>}
            </div>
            {max > 1 ? <div role="group" aria-label={`${addon.name} quantity`} className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" size="icon" aria-label={`Remove one ${addon.name}`} disabled={quantity === 0} focusableWhenDisabled onClick={() => setAddon(addon, quantity - 1)}><Minus aria-hidden="true" /></Button>
              <span data-addon-quantity={addon.id} className="min-w-8 text-center text-base font-semibold tabular-nums text-foreground">{quantity}</span>
              <Button type="button" variant="outline" size="icon" aria-label={`Add one ${addon.name}`} disabled={quantity >= max} focusableWhenDisabled onClick={() => setAddon(addon, quantity + 1)}><Plus aria-hidden="true" /></Button>
            </div> : <Checkbox label={`Add ${addon.name}`} checked={quantity > 0} onChange={(event) => setAddon(addon, event.target.checked ? 1 : 0)} className="max-w-full min-w-0 [overflow-wrap:anywhere]" />}
          </li>;
        })}
      </ul>
    </div>}
  </section>;
}

function OfferText({ offer }: { offer: ProfileOffer }) {
  return <span className="min-w-0">
    <span className={cn("block text-base font-semibold text-foreground", anywhere)}>{offer.name}</span>
    {offer.scope.length > 0 && <span className={cn("block text-sm text-foreground", anywhere)}>{offer.scope.join(" · ")}</span>}
    {offer.description && <span className={cn("block text-sm text-slate", anywhere)}>{offer.description}</span>}
  </span>;
}

function OfferPrice({ offer, className }: { offer: ProfileOffer; className?: string }) {
  const line = offerPriceLine(offer);
  const cadences = offer.cadences.length;
  return <span className={cn("min-w-0", className)}>
    <span className="block text-base font-semibold tabular-nums text-foreground">{line.amount}</span>
    {offer.kind === "quote" && line.detail && <span className="block text-sm text-slate">{line.detail}</span>}
    {offer.kind === "fixed" && <span className="block text-sm text-slate">
      {offer.cadences[0].frequency === "one-time" ? "One-time" : `${cadenceLabel(offer.cadences[0].frequency)}, per visit`}{cadences > 1 ? ` · ${cadences} cadences` : ""}
    </span>}
  </span>;
}

// ---------------------------------------------------------------------------------------------
// Service list (All services view, and other services under a selected one)
// ---------------------------------------------------------------------------------------------

export function ServiceList({ heading, headingId, services, onSelect, allServices }: {
  heading: string;
  headingId: string;
  services: readonly ProfileService[];
  onSelect: (serviceId: string | null) => void;
  /** Adds a row that returns to the whole business. */
  allServices?: boolean;
}) {
  const row = "flex w-full min-h-14 items-center justify-between gap-3 rounded-xl border border-border-strong bg-card p-4 text-left hover:bg-surface-hover";
  return <section aria-labelledby={headingId}>
    <h2 id={headingId} className="text-2xl font-semibold text-foreground">{heading}</h2>
    <ul className="mt-3 space-y-3">
      {services.map((service) => {
        const line = offerPriceLine(service.offers[0]);
        return <li key={service.id}>
          <button type="button" data-service-row={service.id} onClick={() => onSelect(service.id)} className={row}>
            <span className="min-w-0">
              <span className={cn("block text-base font-semibold text-foreground", anywhere)}>{service.name}</span>
              <span className={cn("block text-sm text-muted-foreground", anywhere)}>
                {line.amount}{line.detail ? ` · ${line.detail}` : ""}{service.offers.length > 1 ? ` · ${service.offers.length} packages` : ""}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-sage-dark">View options<ArrowRight aria-hidden="true" className="size-4" /></span>
          </button>
        </li>;
      })}
      {allServices && <li>
        <button type="button" data-service-row="all" onClick={() => onSelect(null)} className={row}>
          <span className="text-base font-semibold text-foreground">All services</span>
          <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-sage-dark">Browse the business<ArrowRight aria-hidden="true" className="size-4" /></span>
        </button>
      </li>}
    </ul>
  </section>;
}
