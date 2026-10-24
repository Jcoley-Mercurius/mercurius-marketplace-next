"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  cents, emptyItem, maxQuoteItems, parseQuoteItems, quoteItemKindLabel, quoteItemKinds, taxPendingLabel,
  type QuoteItem, type QuoteItemDraft, type QuoteItemKind, type QuoteTerms,
} from "@/lib/quoteProposals";
import { cn } from "@/lib/utils";

// DEC-2026-045 G1: itemized quote lines. The editor previews the subtotal; the server
// recomputes and records it. Tax is never shown as $0 or exempt unless confirmed.

export function QuoteItemsEditor({ idPrefix, drafts, onChange, disabled, errorRow }: {
  idPrefix: string;
  drafts: QuoteItemDraft[];
  onChange: (drafts: QuoteItemDraft[]) => void;
  disabled?: boolean;
  errorRow?: number | null;
}) {
  const update = (index: number, patch: Partial<QuoteItemDraft>) => onChange(drafts.map((draft, at) => at === index ? { ...draft, ...patch } : draft));
  const preview = parseQuoteItems(drafts);
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-medium">Quote lines <span className="text-muted-foreground">(required)</span></legend>
      <ol className="space-y-3">
        {drafts.map((draft, index) => {
          const row = index + 1;
          const id = `${idPrefix}-line-${row}`;
          return (
            <li key={index} id={id} tabIndex={-1} aria-label={`Line ${row}`} className={cn("grid gap-2 rounded-lg border p-3 sm:grid-cols-[8rem_1fr_5rem_7rem_auto] sm:items-end", errorRow === row && "border-destructive")}>
              <label className="grid gap-1 text-xs font-medium">Type
                <Select density="compact" value={draft.kind} onChange={(event) => update(index, { kind: event.target.value as QuoteItemKind })}>
                  {quoteItemKinds.map((kind) => <option key={kind} value={kind}>{quoteItemKindLabel[kind]}</option>)}
                </Select>
              </label>
              <label className="grid gap-1 text-xs font-medium">Description
                <Input value={draft.description} maxLength={200} onChange={(event) => update(index, { description: event.target.value })} />
              </label>
              <label className="grid gap-1 text-xs font-medium">Quantity
                <Input inputMode="decimal" value={draft.quantity} onChange={(event) => update(index, { quantity: event.target.value })} />
              </label>
              <label className="grid gap-1 text-xs font-medium">Unit price ($)
                <Input inputMode="decimal" value={draft.unit} onChange={(event) => update(index, { unit: event.target.value })} />
              </label>
              <Button type="button" variant="outline" size="sm" aria-label={`Remove line ${row}`} disabled={drafts.length === 1}
                onClick={() => onChange(drafts.filter((_, at) => at !== index))}><Trash2 /></Button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="sm" disabled={drafts.length >= maxQuoteItems} onClick={() => onChange([...drafts, emptyItem()])}><Plus />Add line</Button>
        <p className="text-sm" aria-live="polite">
          {preview.ok ? <>Subtotal <span className="font-semibold">{cents(preview.subtotal_cents)}</span> · {taxPendingLabel}</> : <span className="text-muted-foreground">Subtotal shows when every line is complete.</span>}
        </p>
      </div>
    </fieldset>
  );
}

export function QuoteLines({ items }: { items: QuoteItem[] }) {
  return (
    <ul className="divide-y rounded-lg border text-sm">
      {items.map((item, index) => (
        <li key={index} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 p-2.5">
          <span><span className="text-muted-foreground">{quoteItemKindLabel[item.kind] ?? item.kind}:</span> {item.description}
            <span className="block text-xs text-muted-foreground">{item.quantity} × {cents(item.unit_cents)}</span></span>
          <span className="font-medium tabular-nums">{item.kind === "discount" ? `−${cents(item.amount_cents)}` : cents(item.amount_cents)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The recorded terms of a quote revision: lines, subtotal, tax, total, deposit and payment terms. */
export function QuoteBreakdown({ terms }: { terms: QuoteTerms }) {
  const confirmed = terms.tax_status === "confirmed" && terms.total_cents != null;
  return (
    <div className="space-y-3">
      <QuoteLines items={terms.items} />
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        <dt>Service subtotal</dt><dd className="text-right font-medium tabular-nums">{cents(terms.subtotal_cents)}</dd>
        <dt>Tax</dt><dd className="text-right tabular-nums">{confirmed ? cents(terms.tax_cents ?? 0) : taxPendingLabel}</dd>
        {confirmed && <><dt className="font-semibold">Total</dt><dd className="text-right font-semibold tabular-nums">{cents(terms.total_cents!)}</dd></>}
        <dt>Deposit</dt><dd className="text-right tabular-nums">{cents(terms.deposit_cents)}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">Covers: {terms.scope}</p>
      <p className="text-xs text-muted-foreground">{terms.payment_terms} Policy {terms.policy_version}.</p>
    </div>
  );
}
