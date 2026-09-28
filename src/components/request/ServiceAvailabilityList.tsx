"use client";

import { AlertTriangle, CheckCircle2, CircleSlash, FileQuestion, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UNAVAILABLE_IN_AREA } from "@/lib/requestSubmission";
import type { ServiceAvailability } from "@/lib/requestPreview";

export type AvailabilityItem = {
  serviceId: string;
  name: string;
  cadence: string;
  /** undefined while checking; "error" when the check failed. */
  availability: ServiceAvailability | "error" | undefined;
  preferredProviderName?: string;
  explicitOffering?: string;
  interestSent: boolean;
  isSomethingElse: boolean;
};

/**
 * Address-specific outcome for every selected service (TRACE-098). Known unavailable services
 * never look bookable, and every blocking state offers an explicit correction.
 */
export function ServiceAvailabilityList({ items, formatMoney, onRemove, onUseAnyProvider, onRegisterInterest, onRetry, headingId }: {
  items: AvailabilityItem[];
  formatMoney: (value: number) => string;
  onRemove: (serviceId: string) => void;
  onUseAnyProvider: (serviceId: string) => void;
  /** Omitted where contact details are not collected yet. */
  onRegisterInterest?: (serviceId: string) => void;
  onRetry: () => void;
  headingId: string;
}) {
  return (
    <section aria-labelledby={headingId} className="rounded-2xl border border-border-strong bg-card p-4 sm:p-5">
      <h3 id={headingId} className="font-semibold">Availability at this address</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Checked against providers who serve your ZIP code. Your whole plan is submitted together, so every service must be available before you submit.
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((item) => <AvailabilityRow key={item.serviceId} item={item} formatMoney={formatMoney} onRemove={onRemove} onUseAnyProvider={onUseAnyProvider} onRegisterInterest={onRegisterInterest} onRetry={onRetry} />)}
      </ul>
    </section>
  );
}

function AvailabilityRow({ item, formatMoney, onRemove, onUseAnyProvider, onRegisterInterest, onRetry }: {
  item: AvailabilityItem;
  formatMoney: (value: number) => string;
  onRemove: (serviceId: string) => void;
  onUseAnyProvider: (serviceId: string) => void;
  onRegisterInterest?: (serviceId: string) => void;
  onRetry: () => void;
}) {
  const state = describe(item, formatMoney);
  const Icon = state.icon;
  const outcome = item.availability && item.availability !== "error" ? item.availability.outcome.outcome : null;
  const needsConsent = outcome === "preferred_provider_unavailable" || outcome === "package_unavailable" || outcome === "invalid_package" || outcome === "invalid_provider";
  const unavailable = item.availability !== "error" && (item.availability?.kind === "unavailable" || item.availability?.kind === "promotion");
  return (
    <li id={`availability-${item.serviceId}`} tabIndex={-1} className="scroll-mt-24 rounded-xl border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className={state.iconClass} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-medium">{item.name}</p>
            <p className="text-sm font-semibold tabular-nums">{state.amount}</p>
          </div>
          <p className="text-xs text-muted-foreground">{item.cadence}</p>
          <p className="mt-2 text-sm"><span className="font-medium">{state.label}.</span> {state.detail}</p>
          {item.preferredProviderName && (
            <p className="mt-1 text-xs text-muted-foreground">Preferred provider: {item.preferredProviderName}. This is a preference until a provider accepts.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {item.availability === "error" && <Button type="button" variant="outline" size="sm" onClick={onRetry}><RefreshCw className="size-4" /> Check again</Button>}
            {needsConsent && <Button type="button" variant="outline" size="sm" onClick={() => onUseAnyProvider(item.serviceId)}>Use any eligible provider</Button>}
            {unavailable && onRegisterInterest && (
              <Button type="button" variant="outline" size="sm" disabled={item.interestSent} onClick={() => onRegisterInterest(item.serviceId)}>
                {item.interestSent ? "Interest saved" : "Notify me when available"}
              </Button>
            )}
            {(unavailable || needsConsent || item.availability === "error") && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(item.serviceId)}>Remove {item.name}</Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function describe(item: AvailabilityItem, formatMoney: (value: number) => string) {
  const ok = { icon: CheckCircle2, iconClass: "mt-0.5 size-5 shrink-0 text-status-success" };
  const quote = { icon: FileQuestion, iconClass: "mt-0.5 size-5 shrink-0 text-status-info" };
  const stop = { icon: CircleSlash, iconClass: "mt-0.5 size-5 shrink-0 text-muted-foreground" };
  const warn = { icon: AlertTriangle, iconClass: "mt-0.5 size-5 shrink-0 text-status-warning" };
  if (item.availability === undefined) return { icon: Loader2, iconClass: "mt-0.5 size-5 shrink-0 animate-spin text-muted-foreground", amount: "", label: "Checking", detail: "Confirming providers and price for this address." };
  if (item.availability === "error") return { ...warn, amount: "", label: "Couldn’t check availability", detail: "Nothing was submitted. Check again, or remove this service." };
  const availability = item.availability;
  switch (availability.kind) {
    case "fixed":
      return availability.exact
        ? { ...ok, amount: formatMoney(availability.total), label: "Available", detail: "Fixed price from an eligible provider here. It’s re-checked when you submit." }
        : { ...ok, amount: `From ${formatMoney(availability.total)}`, label: "Available", detail: "The price depends on your answers to the questions for this service." };
    case "quote":
      return { ...quote, amount: "Quote", label: "Quote required", detail: availability.offeringMode === "deposit_quote"
        ? "A provider here quotes this service. The quote, and any deposit, is set only when you accept it."
        : "A provider here quotes this service. No price is set until you accept a quote." };
    case "promotion":
      return { ...stop, amount: "", label: "Online pricing unavailable", detail: "This service’s current price can’t be booked online yet. Remove it, or ask us to notify you." };
    case "unavailable":
      return item.isSomethingElse
        ? { ...stop, amount: "", label: UNAVAILABLE_IN_AREA.replace(/\.$/, ""), detail: "Something Else isn’t a bookable service. We can record your description as interest; it won’t create a request or a quote." }
        : { ...stop, amount: "", label: UNAVAILABLE_IN_AREA.replace(/\.$/, ""), detail: "No eligible provider offers this service here at this frequency. It can’t be booked." };
    case "needs_attention":
      switch (availability.outcome.outcome) {
        case "answers_required": return { ...warn, amount: "", label: "Answers needed", detail: "Answer this service’s questions to see its price." };
        case "preferred_provider_unavailable": return { ...warn, amount: "", label: "Your preferred provider isn’t available here", detail: "Another eligible provider is offered this request only if you choose to allow it." };
        case "package_unavailable":
        case "invalid_package": return { ...warn, amount: "", label: "The offering you chose isn’t available here", detail: item.explicitOffering ? `${item.explicitOffering} can’t be booked at this address.` : "Choose any eligible provider instead, or remove this service." };
        case "invalid_provider": return { ...warn, amount: "", label: "We couldn’t find the provider you chose", detail: "Remove the preference to use any eligible provider." };
        default: return { ...warn, amount: "", label: "Needs attention", detail: "Check this service, then continue." };
      }
  }
}
