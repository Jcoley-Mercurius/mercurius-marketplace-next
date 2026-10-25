import { frequencyLabel } from "@/lib/packagePriceCorrections";
import { INTERNAL_NOTES_LABEL } from "@/lib/packageDrafts";
import { addonPriceLabel, conditionsLabel, formatCents, priceKindLabel, toCents, walkthroughLabel, type PackageContent } from "@/lib/pricingContent";

// TRACE-112/113: the full content of a package revision, read-only, worded the same way for
// operators and vendors: price meaning, rules, included scope and add-ons. TRACE-122: notes are
// Mercurius-internal and shown only when an operator view passes them in.

export function PackageContentSummary({ content, internalNotes }: { content: PackageContent; internalNotes?: string | null }) {
  const cadences = [...new Set(content.tiers.map((tier) => tier.frequency))];
  return <div className="space-y-3 text-sm">
    {content.description && <p className="text-muted-foreground">{content.description}</p>}
    {content.tiers.length === 0
      ? <p>{walkthroughLabel(content.pricing_mode)}</p>
      : cadences.map((cadence) => <div key={cadence}>
        <p className="font-medium">{frequencyLabel(cadence)}{content.pricing_mode === "fixed" ? "" : " · estimate, quote required"}</p>
        <ul className="mt-1 space-y-1">{content.tiers.filter((tier) => tier.frequency === cadence).map((tier) => <li key={tier.id} className="flex flex-wrap justify-between gap-x-4">
          <span>{tier.name}{tier.conditions.length > 0 && <span className="text-muted-foreground"> · {conditionsLabel(tier.conditions, content.questions)}</span>}
            {tier.includes.length > 0 && <span className="text-muted-foreground"> · includes {tier.includes.join(", ")}</span>}</span>
          <span className="font-medium tabular-nums">{priceKindLabel(tier.price_kind, tier.price, tier.price_max)}</span>
        </li>)}</ul>
      </div>)}
    {content.pricing_mode === "deposit_quote" && content.deposit_amount != null && <p>Deposit {formatCents(toCents(content.deposit_amount) ?? 0)}, applied toward the final price.</p>}
    {content.included_scope.length > 0 && <div><p className="font-medium">Included</p><p className="text-muted-foreground">{content.included_scope.join(" · ")}</p></div>}
    {content.addons.length > 0 && <div><p className="font-medium">Add-ons</p>
      <ul className="mt-1 space-y-1">{content.addons.map((addon) => <li key={addon.id} className="flex flex-wrap justify-between gap-x-4">
        <span>{addon.name}{addon.is_required ? " (required)" : ""}
          <span className="text-muted-foreground"> · {addon.min_quantity === addon.max_quantity ? `quantity ${addon.max_quantity}` : `${addon.min_quantity} to ${addon.max_quantity}`}
            {addon.frequencies.length > 0 ? ` · ${addon.frequencies.map((f) => frequencyLabel(f).toLowerCase()).join(", ")} only` : ""}</span></span>
        <span className="font-medium tabular-nums">{addonPriceLabel(addon)}</span>
      </li>)}</ul></div>}
    {content.questions.length > 0 && <p className="text-muted-foreground">Asks: {content.questions.map((q) => q.question_label).join(" · ")}</p>}
    {internalNotes && <div><p className="font-medium">{INTERNAL_NOTES_LABEL}</p><p className="whitespace-pre-line text-muted-foreground">{internalNotes}</p></div>}
  </div>;
}
