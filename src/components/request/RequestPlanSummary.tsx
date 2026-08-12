"use client";

import type { ReactNode } from "react";
import { ArrowRight, Clock3, ReceiptText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type RequestPlanSummaryItem = {
  id: string;
  name: string;
  cadence: string;
  price: number;
  priceLabel: string;
  availability: "fixed" | "quote" | "sourcing";
};

export function RequestPlanSummary({
  items,
  pricedSubtotal,
  onContinue,
  onRemove,
}: {
  items: RequestPlanSummaryItem[];
  pricedSubtotal: number;
  onContinue: () => void;
  onRemove: (serviceId: string) => void;
}) {
  const pricedItems = items.filter(
    (item) => item.availability === "fixed" && item.price > 0,
  );
  const matchingItems = items.filter(
    (item) => item.availability !== "fixed" || item.price <= 0,
  );

  return (
    <>
      <aside className="hidden lg:block">
        <Card className="sticky top-24 overflow-hidden border-accent-border bg-card shadow-lg shadow-slate/5">
          <CardHeader className="border-b border-accent-border bg-accent-subtle">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ReceiptText className="h-5 w-5 text-accent" />
              Your service plan
            </CardTitle>
            <p className="text-xs leading-5 text-muted-foreground">
              Live prices and matching requests stay separate until every rate is
              confirmed.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm font-medium">No services selected</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Choose one or more services to build your request.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {pricedItems.length > 0 && (
                  <SummaryGroup title="Live-priced">
                    {pricedItems.map((item) => (
                      <SummaryRow key={item.id} item={item} onRemove={onRemove} />
                    ))}
                  </SummaryGroup>
                )}

                {matchingItems.length > 0 && (
                  <SummaryGroup title="Needs matching or quote">
                    {matchingItems.map((item) => (
                      <SummaryRow key={item.id} item={item} onRemove={onRemove} />
                    ))}
                  </SummaryGroup>
                )}
              </div>
            )}

            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm text-muted-foreground">Priced today</span>
                <span className="text-2xl font-semibold tabular-nums">
                  {pricedSubtotal > 0 ? formatMoney(pricedSubtotal) : "$0"}
                </span>
              </div>
              {matchingItems.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                  <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>
                    {matchingItems.length} service
                    {matchingItems.length === 1 ? "" : "s"} still need provider
                    matching or a quote. No price is included for those items.
                  </p>
                </div>
              )}
              <Button
                type="button"
                size="lg"
                disabled={items.length === 0}
                onClick={onContinue}
                className="w-full bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active"
              >
                Continue to Your Home
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </aside>

      {items.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border-strong bg-background/95 px-4 py-3 shadow-[0_-12px_35px_-20px_hsl(215_25%_20%_/_0.35)] backdrop-blur lg:hidden [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-muted-foreground">
                {items.length} selected
                {matchingItems.length > 0
                  ? ` · ${matchingItems.length} need matching`
                  : " · live-priced"}
              </p>
              <p className="font-semibold tabular-nums">
                Priced today: {pricedSubtotal > 0 ? formatMoney(pricedSubtotal) : "$0"}
              </p>
            </div>
            <Button
              type="button"
              onClick={onContinue}
              className="shrink-0 bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function SummaryGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function SummaryRow({
  item,
  onRemove,
}: {
  item: RequestPlanSummaryItem;
  onRemove: (serviceId: string) => void;
}) {
  const isPriced = item.availability === "fixed" && item.price > 0;
  return (
    <div className="group flex items-start gap-2">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          isPriced ? "bg-accent" : "bg-amber-500"
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="shrink-0 text-sm font-semibold">
            {isPriced
              ? item.priceLabel
              : item.availability === "quote"
                ? "Quote"
                : "Matching"}
          </p>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {isPriced ? item.cadence : "Price confirmed before booking"}
        </p>
      </div>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        aria-label={`Remove ${item.name}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}
