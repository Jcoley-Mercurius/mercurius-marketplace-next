"use client";

import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { addonPriceLabel } from "@/lib/pricingContent";
import type { PreviewOutcome } from "@/lib/requestPreview";

export type AddonOption = NonNullable<PreviewOutcome["addon_options"]>[number];

// DEC-2026-041 item 2: the homeowner chooses optional add-ons for an offering they picked.
// Required add-ons are always included and shown with their quantity; the server prices the
// selection again, so nothing here is a price the homeowner is charged.
export function AddonPicker({ serviceId, serviceName, options, quantities, onChange }: {
  serviceId: string;
  serviceName: string;
  options: AddonOption[];
  quantities: Record<string, number>;
  onChange: (addonId: string, quantity: number) => void;
}) {
  if (!options.length) return null;
  return <fieldset className="space-y-4 rounded-xl border border-border-strong bg-card p-4 shadow-sm">
    <legend className="px-1 font-medium">{serviceName}: add-ons</legend>
    {options.map((option) => {
      const id = `addon-${serviceId}-${option.id}`;
      const min = option.is_required ? Math.max(option.min_quantity, 1) : 0;
      const value = quantities[option.id] ?? min;
      const price = addonPriceLabel({ price_kind: option.price_kind === "range" ? "range" : "exact", price: option.price,
        price_max: option.price_max, unit_label: option.unit_label });
      const fixed = option.is_required && option.max_quantity <= min;
      return <FormField key={option.id} id={id} label={`${option.name} (${price})`}
        help={option.is_required
          ? fixed ? `Included in every booking: ${min}.` : `Required: at least ${min}, up to ${option.max_quantity}.`
          : `Optional: 0 to ${option.max_quantity}.${option.price_kind === "range" ? " A range price makes this a quote request." : ""}`}>
        {(control) => <Input {...control} type="number" inputMode="numeric" min={min} max={option.max_quantity} step={1} disabled={fixed}
          value={String(value)} onChange={(event) => {
            const next = Math.trunc(Number(event.target.value));
            if (Number.isFinite(next)) onChange(option.id, Math.min(Math.max(next, min), option.max_quantity));
          }} />}
      </FormField>;
    })}
  </fieldset>;
}
