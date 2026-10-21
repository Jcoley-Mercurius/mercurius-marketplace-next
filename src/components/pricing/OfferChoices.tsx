"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { centsLabel, offerEndsLabel, type PromotionOption } from "@/lib/promotionSelection";

// TRACE-116 (DEC-2026-042): the homeowner picks one offer, or none. "No offer" is the starting
// choice; the greatest saving is labelled, never selected; every saving and total comes from
// the server for this exact service and its add-ons.
export function OfferChoices({ name, legend, serviceCents, options, chosenOfferId, onChoose, unavailable, disabled = false }: {
  name: string;
  legend: string;
  serviceCents: number;
  options: PromotionOption[];
  chosenOfferId: string | null;
  onChoose: (option: PromotionOption | null) => void;
  /** Why an option can't be chosen here (shown under it), if it can't. */
  unavailable?: (option: PromotionOption) => string | null;
  disabled?: boolean;
}) {
  return <fieldset className="space-y-2" disabled={disabled}>
    <legend className="mb-2 text-sm font-medium">{legend}</legend>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-subtle/40">
      <input type="radio" name={name} className="mt-0.5 size-5 shrink-0 accent-accent" checked={chosenOfferId === null} onChange={() => onChoose(null)} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">No offer</span>
        <span className="block text-sm text-muted-foreground">{centsLabel(serviceCents)}</span>
      </span>
    </label>
    {options.map((option) => {
      const blocked = unavailable?.(option) ?? null;
      const id = `${name}-${option.offerId}`;
      const ends = offerEndsLabel(option.endsAt, option.timezone);
      return <label key={option.offerId} htmlFor={id}
        className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-subtle/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-70">
        <input id={id} type="radio" name={name} className="mt-0.5 size-5 shrink-0 accent-accent" checked={chosenOfferId === option.offerId}
          disabled={Boolean(blocked)} aria-describedby={`${id}-detail`} onChange={() => onChoose(option)} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{option.label}</span>
            {option.best && <Badge className="border-transparent bg-accent-active text-accent-foreground">Best savings</Badge>}
          </span>
          <span id={`${id}-detail`} className="mt-0.5 block text-sm text-muted-foreground">
            Save {centsLabel(option.discountCents)}: {centsLabel(option.serviceCents)} → <span className="font-medium text-foreground tabular-nums">{centsLabel(option.totalAfterCents)}</span>
            {option.firstBookingOnly ? " · First booking only" : ""}{ends ? ` · ${ends}` : ""}
            {blocked ? <span className="block text-foreground">{blocked}</span> : null}
          </span>
          {option.terms && <span className="mt-1 block text-xs leading-5 text-muted-foreground">{option.terms}</span>}
        </span>
      </label>;
    })}
  </fieldset>;
}

export function CodeEntry({ id, onApply, message, busy = false, disabled = false }: {
  id: string;
  onApply: (code: string) => void;
  message: string | null;
  busy?: boolean;
  disabled?: boolean;
}) {
  const [code, setCode] = useState("");
  const valid = /^[A-Za-z0-9-]{4,24}$/.test(code.trim());
  return <div className="space-y-2">
    <label htmlFor={id} className="block text-sm font-medium">Promotion code</label>
    <div className="flex gap-2">
      <Input id={id} value={code} maxLength={24} autoComplete="off" spellCheck={false} disabled={disabled} className="h-11 uppercase"
        aria-describedby={message ? `${id}-message` : undefined} onChange={(event) => setCode(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && valid) { event.preventDefault(); onApply(code.trim()); } }} />
      <Button type="button" variant="outline" className="min-h-11" disabled={!valid || disabled} loading={busy} onClick={() => onApply(code.trim())}>Apply code</Button>
    </div>
    {message && <p id={`${id}-message`} role="status" className="text-sm text-foreground">{message}</p>}
  </div>;
}
