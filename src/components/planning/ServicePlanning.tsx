"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Check, Clock3, Plus, ReceiptText, ShieldCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PricingFrequency, PublicPackageSelection } from "@/lib/vendorPricing";

export type PlanningAvailability = "fixed" | "quote" | "sourcing";
export type PlanningVariant = "light" | "dark";

export type PlanningService = {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  availability: PlanningAvailability;
  defaultFrequency: PricingFrequency;
  frequencies: PricingFrequency[];
  prices: Partial<Record<PricingFrequency, number>>;
  basePrices?: Partial<Record<PricingFrequency, number>>;
  promotionLabels?: Partial<Record<PricingFrequency, string>>;
  promotionIds?: Partial<Record<PricingFrequency, string>>;
  packageSelections?: Partial<Record<PricingFrequency, PublicPackageSelection>>;
};

export type PlanningSummaryItem = {
  id: string;
  name: string;
  cadence: string;
  price: number;
  priceLabel: string;
  availability: PlanningAvailability;
};

export type PlanningTotalRow = {
  key: string;
  label: string;
  amount: number;
  detail?: string;
  emphasis?: boolean;
};

export function PlanningServiceCard({
  service,
  selected,
  frequency,
  onToggle,
  onFrequencyChange,
  variant = "light",
  layout = "tile",
  disabled = false,
  requestedProviderName,
  showSingleFrequency = true,
}: {
  service: PlanningService;
  selected: boolean;
  frequency: PricingFrequency;
  onToggle: () => void;
  onFrequencyChange: (frequency: PricingFrequency) => void;
  variant?: PlanningVariant;
  layout?: "tile" | "row";
  disabled?: boolean;
  requestedProviderName?: string;
  showSingleFrequency?: boolean;
}) {
  const dark = variant === "dark";
  const liveFrequencies = planningLiveFrequencies(service);
  const availableNow = service.availability === "fixed" && liveFrequencies.length > 0;
  const cardPrice = planningCardPriceLabel(service);
  const selectedPackage = service.packageSelections?.[frequency];
  const teaserIncludes = selectedPackage?.tierIncludes?.filter(Boolean).slice(0, 2) ?? [];
  const packageDescription = selectedPackage?.packageDescription?.trim();
  const showPills = selected && availableNow && (showSingleFrequency || liveFrequencies.length > 1);
  const ServiceIcon = service.icon;

  return (
    <div className={cn(
      "group relative overflow-hidden border transition-all duration-200",
      layout === "row" ? "rounded-3xl" : "rounded-xl",
      dark
        ? selected
          ? "border-2 border-coral/40 bg-coral/[0.06] shadow-[inset_0_0_20px_hsl(15_65%_55%_/_0.05),0_18px_40px_-20px_hsl(15_65%_35%_/_0.55)]"
          : "border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.03] shadow-[0_10px_28px_-18px_hsl(220_40%_2%_/_0.9)] hover:border-white/20 hover:from-white/[0.10] hover:to-white/[0.05]"
        : selected
          ? "-translate-y-0.5 border-accent-border bg-card shadow-lg shadow-sage/10 ring-2 ring-accent"
          : "border-border bg-card hover:border-accent-border hover:shadow-md",
    )}>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={selected}
        className={cn(
          "w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset",
          dark ? "focus-visible:ring-coral/70" : "focus-visible:ring-focus-ring",
          disabled && "cursor-wait opacity-70",
        )}
      >
        <div className={cn("flex gap-3", layout === "row" ? "items-center justify-between p-4 sm:gap-5 sm:p-6" : "items-start p-5")}>
          <div className={cn("flex min-w-0 flex-1", layout === "row" ? "items-center gap-3 sm:gap-5" : "items-start gap-4")}>
            <span className={cn(
              "flex shrink-0 items-center justify-center transition-all",
              layout === "row" ? "h-11 w-11 rounded-xl sm:h-14 sm:w-14 sm:rounded-2xl" : "h-12 w-12 rounded-xl",
              dark
                ? selected ? "bg-coral text-white" : "border border-white/10 bg-white/5 text-sage"
                : selected ? "bg-accent text-accent-foreground" : "bg-accent-soft text-sage-dark",
            )}>
              <ServiceIcon className={layout === "row" ? "h-5 w-5 sm:h-7 sm:w-7" : "h-5 w-5"} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <p className={cn("font-semibold leading-5", layout === "row" && "font-display text-base font-bold sm:text-lg")}>{service.name}</p>
                {layout === "tile" && <SelectionMark selected={selected} variant={variant} />}
              </div>
              <p className={cn("mt-1 text-sm leading-5", dark ? "text-white/50" : "text-muted-foreground")}>{service.description}</p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <PlanningAvailabilityBadge availability={availableNow ? "fixed" : service.availability} variant={variant} />
                {layout === "tile" && <PlanningCardPrice variant={variant} label={cardPrice} />}
                {layout === "row" && <span className="sm:hidden"><PlanningCardPrice variant={variant} label={cardPrice} /></span>}
              </div>
              {requestedProviderName && (
                <p className={cn("mt-3 flex items-center gap-1 text-xs font-medium", dark ? "text-accent" : "text-sage-dark")}>
                  <ShieldCheck className="h-3.5 w-3.5" /> Requested provider: {requestedProviderName}
                </p>
              )}
            </div>
          </div>
          {layout === "row" && (
            <>
              <div className="hidden shrink-0 text-right sm:block"><PlanningCardPrice variant={variant} label={cardPrice} /></div>
              <SelectionMark selected={selected} variant={variant} showPlus />
            </>
          )}
        </div>
      </button>

      {showPills && (
        <div className={cn("border-t px-5 py-4", dark ? "border-white/10 bg-white/[0.025] sm:px-6" : "border-accent-border bg-accent-subtle/50")}>
          <p className={cn("mb-2 text-xs font-medium", dark ? "uppercase tracking-wider text-white/40" : "text-muted-foreground")}>Choose cadence and live rate</p>
          <PlanningFrequencyPills service={service} frequency={frequency} onChange={onFrequencyChange} variant={variant} />
        </div>
      )}

      {selected && !availableNow && (
        <div className={cn("border-t px-5 py-3 text-xs leading-5", dark ? "border-white/10 bg-white/[0.025] text-white/50 sm:px-6" : "border-border bg-muted/30 text-muted-foreground")}>
          Continue with your request. Mercurius will coordinate provider matching and confirm pricing before booking.
        </div>
      )}

      {selected && availableNow && (teaserIncludes.length > 0 || packageDescription) && (
        <div className={cn("border-t px-5 py-3", dark ? "border-white/10 text-white/50 sm:px-6" : "border-border text-muted-foreground")}>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">Package details</p>
          {packageDescription && <p className="mt-1 line-clamp-2 text-xs leading-5">{packageDescription}</p>}
          {teaserIncludes.length > 0 && <p className="mt-1 text-xs leading-5">Includes: {teaserIncludes.join(" · ")}</p>}
        </div>
      )}
    </div>
  );
}

export function PlanningFrequencyPills({ service, frequency, onChange, variant = "light" }: { service: PlanningService; frequency: PricingFrequency; onChange: (frequency: PricingFrequency) => void; variant?: PlanningVariant }) {
  const dark = variant === "dark";
  return (
    <div className="flex flex-wrap gap-2">
      {planningLiveFrequencies(service).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={frequency === option}
          onClick={() => onChange(option)}
          className={cn(
            "rounded-full border px-3 py-2 text-left text-xs transition-all",
            dark
              ? frequency === option ? "border-coral bg-coral font-semibold text-white shadow-md shadow-coral/20" : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
              : frequency === option ? "border-accent bg-accent font-semibold text-accent-foreground shadow-sm" : "border-border-strong bg-background text-muted-foreground hover:border-accent-border hover:text-foreground",
          )}
        >
          <span className="block">{planningFrequencyLabel(option)}</span>
          <span className={cn("mt-0.5 block text-[11px]", dark ? frequency === option ? "text-white/80" : "text-white/65" : frequency === option ? "text-accent-foreground/80" : "text-foreground")}>
            {planningPriceLabel(service, option)}
          </span>
        </button>
      ))}
    </div>
  );
}

export function PlanningPlanSummary({
  items,
  totalRows,
  variant = "light",
  title = "Your service plan",
  emptyTitle = "No services selected",
  emptyCopy = "Choose one or more services to build your plan.",
  actionLabel,
  actionHref,
  onAction,
  onRemove,
  onActionBeforeNavigate,
  actionClassName,
  showMobileBar = false,
  footer,
}: {
  items: PlanningSummaryItem[];
  totalRows: PlanningTotalRow[];
  variant?: PlanningVariant;
  title?: string;
  emptyTitle?: string;
  emptyCopy?: string;
  actionLabel: string;
  actionHref?: string;
  onAction?: () => void;
  onRemove: (serviceId: string) => void;
  onActionBeforeNavigate?: () => void;
  actionClassName?: string;
  showMobileBar?: boolean;
  footer?: ReactNode;
}) {
  const dark = variant === "dark";
  const pricedItems = items.filter((item) => item.availability === "fixed" && item.price > 0);
  const matchingItems = items.filter((item) => item.availability !== "fixed" || item.price <= 0);
  const primaryTotal = totalRows.find((row) => row.emphasis) ?? totalRows[0];
  const content = (
    <>
      <div className={cn("border-b px-5 py-5 sm:px-6", dark ? "border-white/10 bg-white/[0.035]" : "border-accent-border bg-accent-subtle")}>
        <h3 className="flex items-center gap-2 text-lg font-semibold"><ReceiptText className={cn("h-5 w-5", dark ? "text-coral" : "text-accent")} />{title}</h3>
        <p className={cn("mt-1 text-xs leading-5", dark ? "text-white/45" : "text-muted-foreground")}>Live prices and matching requests stay separate until every rate is confirmed.</p>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        {items.length === 0 ? (
          <div className={cn("rounded-xl border border-dashed px-4 py-8 text-center", dark ? "border-white/10" : "border-border")}>
            <p className="text-sm font-medium">{emptyTitle}</p>
            <p className={cn("mt-1 text-xs leading-5", dark ? "text-white/35" : "text-muted-foreground")}>{emptyCopy}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {pricedItems.length > 0 && <SummaryGroup title="Live-priced" variant={variant}>{pricedItems.map((item) => <SummaryRow key={item.id} item={item} onRemove={onRemove} variant={variant} />)}</SummaryGroup>}
            {matchingItems.length > 0 && <SummaryGroup title="Needs matching or quote" variant={variant}>{matchingItems.map((item) => <SummaryRow key={item.id} item={item} onRemove={onRemove} variant={variant} />)}</SummaryGroup>}
          </div>
        )}
        {items.length > 0 && (
          <div className={cn("space-y-3 border-t pt-4", dark ? "border-white/10" : "border-border")}>
            {totalRows.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-4">
                <span className={cn("text-sm", dark ? "text-white/55" : "text-muted-foreground")}>{row.label}</span>
                <div className="text-right"><p className={cn("font-semibold tabular-nums", row.emphasis ? "text-2xl" : "text-lg")}>{formatPlanningMoney(row.amount)}</p>{row.detail && <p className={cn("text-[10px] uppercase tracking-wider", dark ? "text-white/35" : "text-muted-foreground")}>{row.detail}</p>}</div>
              </div>
            ))}
            {matchingItems.length > 0 && (
              <div className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs", dark ? "border-coral/20 bg-coral/[0.06] text-white/60" : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100")}>
                <Clock3 className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", dark ? "text-coral" : "text-amber-700")} />
                <p>{matchingItems.length} service{matchingItems.length === 1 ? "" : "s"} still need provider matching or a quote. No price is included for those items.</p>
              </div>
            )}
            <PlanningAction label={actionLabel} href={actionHref} onAction={onAction} onBeforeNavigate={onActionBeforeNavigate} disabled={items.length === 0} className={actionClassName} variant={variant} />
            {footer}
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <aside className={cn(showMobileBar && "hidden lg:block")}>
        {dark ? <div className="sticky top-24 overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-white/10 to-white/[0.02] shadow-2xl backdrop-blur-3xl">{content}</div> : <Card className="sticky top-24 gap-0 overflow-hidden border-accent-border bg-card py-0 shadow-lg shadow-slate/5">{content}</Card>}
      </aside>
      {showMobileBar && items.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border-strong bg-background/95 px-4 py-3 shadow-[0_-12px_35px_-20px_hsl(215_25%_20%_/_0.35)] backdrop-blur lg:hidden [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="min-w-0 flex-1"><p className="truncate text-xs text-muted-foreground">{items.length} selected{matchingItems.length > 0 ? ` · ${matchingItems.length} need matching` : " · live-priced"}</p><p className="font-semibold tabular-nums">{primaryTotal ? `${primaryTotal.label}: ${formatPlanningMoney(primaryTotal.amount)}` : "Pricing confirmed after matching"}</p></div>
            <PlanningAction label="Continue" onAction={onAction} disabled={false} variant="light" compact />
          </div>
        </div>
      )}
    </>
  );
}

function PlanningAction({ label, href, onAction, onBeforeNavigate, disabled, className, variant, compact = false }: { label: string; href?: string; onAction?: () => void; onBeforeNavigate?: () => void; disabled: boolean; className?: string; variant: PlanningVariant; compact?: boolean }) {
  const styles = cn(buttonVariants({ size: compact ? "default" : "lg" }), "w-full", variant === "dark" ? "rounded-2xl bg-coral font-bold text-coral-foreground shadow-xl shadow-coral/20 hover:bg-coral-dark" : "bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active", compact && "w-auto shrink-0", className);
  if (href) return <Link href={href} onClick={onBeforeNavigate} aria-disabled={disabled} className={cn(styles, disabled && "pointer-events-none opacity-50")}>{label}<ArrowRight className="h-4 w-4" /></Link>;
  return <Button type="button" size={compact ? "default" : "lg"} disabled={disabled} onClick={onAction} className={styles}>{label}<ArrowRight className="h-4 w-4" /></Button>;
}

function PlanningCardPrice({ variant, label }: { variant: PlanningVariant; label: string | null }) {
  if (label) return <span className={cn("text-sm font-semibold", variant === "dark" ? "text-white" : "text-foreground")}>{label}</span>;
  return <span className={cn("text-xs", variant === "dark" ? "text-white/45" : "text-muted-foreground")}>Price confirmed before booking</span>;
}

function SelectionMark({ selected, variant, showPlus = false }: { selected: boolean; variant: PlanningVariant; showPlus?: boolean }) {
  const dark = variant === "dark";
  return <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-all", dark ? selected ? "border-coral bg-coral text-white shadow-lg shadow-coral/30" : "border-white/10 bg-white/5 text-white/50 group-hover:border-coral group-hover:bg-coral group-hover:text-white" : selected ? "border-accent bg-accent text-accent-foreground" : "border-border bg-background text-transparent")}>{selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : showPlus ? <Plus className="h-3.5 w-3.5" strokeWidth={3} /> : <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>;
}

function SummaryGroup({ title, children, variant }: { title: string; children: ReactNode; variant: PlanningVariant }) {
  return <section><p className={cn("mb-2 text-[11px] font-semibold uppercase tracking-[0.14em]", variant === "dark" ? "text-white/35" : "text-muted-foreground")}>{title}</p><div className="space-y-3">{children}</div></section>;
}

function SummaryRow({ item, onRemove, variant }: { item: PlanningSummaryItem; onRemove: (serviceId: string) => void; variant: PlanningVariant }) {
  const isPriced = item.availability === "fixed" && item.price > 0;
  const dark = variant === "dark";
  return <div className="group flex items-start gap-2"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", isPriced ? "bg-accent" : dark ? "bg-coral" : "bg-amber-500")} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-medium">{item.name}</p><p className={cn("shrink-0 text-sm font-semibold", dark && "text-white/75")}>{isPriced ? item.priceLabel : item.availability === "quote" ? "Quote" : "Matching"}</p></div><p className={cn("mt-0.5 text-[11px]", dark ? "text-white/35" : "text-muted-foreground")}>{isPriced ? item.cadence : "Price confirmed before booking"}</p></div><button type="button" onClick={() => onRemove(item.id)} className={cn("rounded-md p-1 transition-colors hover:text-destructive", dark ? "text-white/30 hover:bg-white/5" : "text-muted-foreground hover:bg-destructive/10")} aria-label={`Remove ${item.name}`}><X className="h-3.5 w-3.5" /></button></div>;
}

export function PlanningAvailabilityBadge({ availability, variant = "light", className }: { availability: PlanningAvailability; variant?: PlanningVariant; className?: string }) {
  const label = availability === "fixed" ? "Available now" : availability === "quote" ? "Quote required" : "Matching required";
  return <Badge variant="secondary" className={cn("w-fit", variant === "dark" ? availability === "fixed" ? "border-accent/30 bg-accent/10 text-accent" : availability === "quote" ? "border-info/30 bg-info/10 text-info" : "border-white/15 bg-white/5 text-white/50" : availability === "fixed" ? "border-accent-border bg-accent-soft text-sage-dark" : availability === "quote" ? "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200" : "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200", className)}>{label}</Badge>;
}

export function planningLiveFrequencies(service: PlanningService) {
  return service.frequencies.filter((frequency) => planningPrice(service, frequency) > 0);
}

export function planningPrice(service: PlanningService, frequency: PricingFrequency) {
  if (service.availability !== "fixed") return 0;
  const price = Number(service.prices[frequency]);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

export function planningPriceLabel(service: PlanningService, frequency: PricingFrequency) {
  const price = planningPrice(service, frequency);
  if (!price) return "Quote";
  const base = service.basePrices?.[frequency];
  const amount = formatPlanningMoney(price);
  const promoted = Boolean(service.promotionIds?.[frequency] && base && base > price);
  const priceWithPromotion = promoted ? `${amount} promo (was ${formatPlanningMoney(base!)})` : amount;
  if (frequency === "one-time") return priceWithPromotion;
  if (frequency === "weekly") return `${priceWithPromotion}/wk`;
  if (frequency === "bi-monthly") return `${priceWithPromotion}/2 wks`;
  if (frequency === "quarterly") return `${priceWithPromotion}/qtr`;
  return `${priceWithPromotion}/mo`;
}

export function planningCardPriceLabel(service: PlanningService) {
  if (service.availability !== "fixed") return null;
  const liveFrequencies = planningLiveFrequencies(service);
  if (liveFrequencies.length === 0) return null;
  const prices = liveFrequencies.map((frequency) => planningPrice(service, frequency));
  const lowestPrice = Math.min(...prices);
  if (prices.length === 1) return planningPriceLabel(service, liveFrequencies[0]);
  return `From ${formatPlanningMoney(lowestPrice)}`;
}

export function planningFrequencyLabel(frequency: PricingFrequency) {
  if (frequency === "one-time") return "One-time";
  if (frequency === "bi-monthly") return "Every two weeks";
  return frequency.charAt(0).toUpperCase() + frequency.slice(1);
}

export function planningSummaryItem(service: PlanningService, frequency: PricingFrequency): PlanningSummaryItem {
  return { id: service.id, name: service.name, cadence: planningFrequencyLabel(frequency), price: planningPrice(service, frequency), priceLabel: planningPriceLabel(service, frequency), availability: service.availability };
}

export function formatPlanningMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}
