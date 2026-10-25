"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { createClient } from "@/lib/supabase/client";
import {
  buildCorrection,
  correctionErrorMessage,
  formatPrice,
  hasCorrectablePrices,
  PRICE_CORRECTION_REASON_MAX,
  type CorrectablePackage,
  type PriceDraft,
  type PriceLine,
} from "@/lib/packagePriceCorrections";

export type CorrectionResult = { prices_changed: number; conversions: string[] };

// DEC-2026-034 (TRACE-109), superseded for material changes by DEC-2026-041 item 4: the
// operator enters new prices and a reason the vendor will read. They become a replacement
// draft of the live package; the live price is unchanged until the operator publishes it
// from Draft prices, with or without the vendor's approval (DEC-2026-046).

/** Words the result of admin_draft_from_package for a toast. */
function draftCreatedDescription(result: CorrectionResult) {
  return ["Live prices are unchanged. Send the draft to the vendor from Draft prices; it is published only after they approve it.",
    result.conversions.length ? `Converted: ${result.conversions.join("; ")}.` : null].filter(Boolean).join(" ");
}

function parseDraftResult(data: unknown): CorrectionResult {
  const item = (data ?? {}) as { prices_changed?: unknown; conversions?: unknown };
  return {
    prices_changed: Number(item.prices_changed) || 0,
    conversions: Array.isArray(item.conversions) ? item.conversions.filter((entry): entry is string => typeof entry === "string") : [],
  };
}

export function PackagePriceCorrection({ pkg, onCorrected }: {
  pkg: CorrectablePackage;
  onCorrected: (result: CorrectionResult) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PriceDraft>({});
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  if (!hasCorrectablePrices(pkg)) return null;

  const lines: PriceLine[] = [...pkg.tiers, ...pkg.addons];

  async function save() {
    if (pending) return;
    const built = buildCorrection(pkg, draft);
    if (!built.ok) { setInvalid(built.invalid); setError(built.message); return; }
    if (!reason.trim()) { setInvalid([]); setError("Enter the reason. The vendor will see it."); return; }
    setInvalid([]);
    setError("");
    setPending(true);
    const { data, error: rpcError } = await createClient().rpc("admin_draft_from_package", {
      p_package: pkg.id,
      p_expected_updated_at: pkg.updatedAt,
      p_prices: built.prices,
      p_reason: reason.trim(),
    });
    setPending(false);
    if (rpcError) { setError(correctionErrorMessage(rpcError)); return; }
    const result = parseDraftResult(data);
    setOpen(false);
    toast.success(`Correction drafted: ${result.prices_changed === 1 ? "1 price" : `${result.prices_changed} prices`}`, { description: draftCreatedDescription(result) });
    await onCorrected(result);
  }

  return <Dialog open={open} onOpenChange={(next) => {
    if (pending) return;
    setOpen(next);
    if (next) { setDraft({}); setReason(""); setInvalid([]); setError(""); }
  }}>
    <DialogTrigger render={<Button variant="outline" className="min-h-10" />}>Propose corrected prices</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Propose corrected prices</DialogTitle>
        <DialogDescription>
          {pkg.contractorName} · {pkg.name}. This creates a replacement draft with the prices you change; everything else is copied from
          the live package. The live price stays until you publish the draft from Draft prices. Requests and quotes already
          agreed keep their price.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {lines.map((line) => <PriceInput key={line.id} id={`price-${pkg.id}-${line.id}`} label={line.detail ? `${line.name} (${line.detail})` : line.name}
          current={line.price} value={draft[line.id] ?? ""} invalid={invalid.includes(line.id)} disabled={pending}
          onChange={(value) => setDraft((current) => ({ ...current, [line.id]: value }))} />)}
        {pkg.pricingMode === "deposit_quote" && <PriceInput id={`price-${pkg.id}-deposit`} label="Deposit" current={pkg.depositAmount}
          value={draft.deposit ?? ""} invalid={invalid.includes("deposit")} disabled={pending}
          onChange={(value) => setDraft((current) => ({ ...current, deposit: value }))} />}
        <FormField label="Reason" required help={`Kept with the draft's history for the vendor. Up to ${PRICE_CORRECTION_REASON_MAX} characters.`}>
          {(control) => <Textarea {...control} value={reason} maxLength={PRICE_CORRECTION_REASON_MAX} disabled={pending} onChange={(event) => setReason(event.target.value)} />}
        </FormField>
        <p className="text-sm text-muted-foreground">Notifying the vendor is not their approval. If the live price is wrong now, suspend the listing while you wait.</p>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
        <p role="status" className="sr-only">{pending ? "Creating the replacement draft…" : ""}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="commitment" loading={pending} onClick={() => void save()}>{pending ? "Creating…" : "Create replacement draft"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function PriceInput({ id, label, current, value, invalid, disabled, onChange }: {
  id: string; label: string; current: number | null; value: string; invalid: boolean; disabled: boolean; onChange: (value: string) => void;
}) {
  return <FormField id={id} label={label} help={`Now ${current === null ? "not set" : formatPrice(current)}. Leave blank to keep it.`}
    error={invalid ? "Enter a positive dollar amount, at most two decimal places." : undefined}>
    {(control) => <Input {...control} inputMode="decimal" autoComplete="off" placeholder={current === null ? "" : String(current)}
      value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}
  </FormField>;
}

/**
 * DEC-2026-041 items 4 and 5: start a replacement draft from the live package without price
 * changes (for a legacy package, or other material changes made in the draft editor), or
 * suspend an incorrect listing meanwhile. TRACE-122: archive a paused or replaced package.
 */
export function PackageReplacementActions({ pkg, onChanged }: { pkg: CorrectablePackage; onChanged: () => Promise<void> | void }) {
  return <>
    <ConfirmAction triggerLabel="Start replacement draft" title="Start a replacement draft" entity={`${pkg.contractorName} · ${pkg.name}`}
      consequence="Copies the live package into a draft that replaces the live one when you publish it. The live package is unchanged until then."
      confirmLabel="Create draft" confirmationTone="commitment" requireReason reasonHelp="The vendor sees this reason with the draft."
      onConfirm={async (reason) => {
        const { data, error } = await createClient().rpc("admin_draft_from_package", {
          p_package: pkg.id, p_expected_updated_at: pkg.updatedAt, p_prices: null, p_reason: reason,
        });
        if (error) throw new Error(correctionErrorMessage(error));
        toast.success("Replacement draft created", { description: draftCreatedDescription(parseDraftResult(data)) });
        await onChanged();
      }} />
    {pkg.isActive && <ConfirmAction triggerLabel="Suspend listing" title="Suspend this listing" entity={`${pkg.contractorName} · ${pkg.name}`}
      consequence="Homeowners can no longer book it. Accepted bookings keep their terms. The vendor is told, with your reason."
      confirmLabel="Suspend listing" requireReason reasonHelp="The vendor sees this reason."
      onConfirm={async (reason) => {
        const { error } = await createClient().rpc("admin_suspend_package", { p_package: pkg.id, p_expected_updated_at: pkg.updatedAt, p_reason: reason });
        if (error) throw new Error(correctionErrorMessage(error));
        await onChanged();
      }} />}
    {!pkg.isActive && !pkg.archive && <ConfirmAction triggerLabel="Archive" title="Archive this price" entity={`${pkg.contractorName} · ${pkg.name}`}
      consequence="Removes this paused or replaced price from Vendor Prices and its counts. It stays under Archived prices with your reason and cannot be turned back on. Requests and bookings keep their terms. The vendor is not notified."
      confirmLabel="Archive" requireReason reasonHelp="Kept with the archive record for audit. The vendor does not see it."
      onConfirm={async (reason) => {
        const { error } = await createClient().rpc("admin_archive_package", { p_package: pkg.id, p_expected_updated_at: pkg.updatedAt, p_reason: reason });
        if (error) throw new Error(correctionErrorMessage(error));
        toast.success("Price archived", { description: "The vendor was not notified." });
        await onChanged();
      }} />}
  </>;
}
