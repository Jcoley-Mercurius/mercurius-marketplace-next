"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

export type CorrectionResult = { changed: number; needs_review: boolean; updated_at: string; vendor_notified: boolean };

// DEC-2026-034 (TRACE-109): the operator enters new prices and a reason the vendor will
// read. Nothing is saved until the server accepts the whole correction.

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
    const { data, error: rpcError } = await createClient().rpc("admin_correct_package_prices", {
      p_package: pkg.id,
      p_expected_updated_at: pkg.updatedAt,
      p_prices: built.prices,
      p_reason: reason.trim(),
    });
    setPending(false);
    if (rpcError) { setError(correctionErrorMessage(rpcError)); return; }
    const result = data as CorrectionResult;
    setOpen(false);
    toast.success(`${result.changed === 1 ? "1 price" : `${result.changed} prices`} corrected`, {
      description: [
        result.needs_review ? "A price is still outside the guardrail band, so the package stays in Package Reviews until approved." : null,
        result.vendor_notified ? "The vendor was notified with your reason." : "No vendor account is linked, so no one was notified.",
      ].filter(Boolean).join(" "),
    });
    await onCorrected(result);
  }

  return <Dialog open={open} onOpenChange={(next) => {
    if (pending) return;
    setOpen(next);
    if (next) { setDraft({}); setReason(""); setInvalid([]); setError(""); }
  }}>
    <DialogTrigger render={<Button variant="outline" className="min-h-10" />}>Correct prices</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Correct prices</DialogTitle>
        <DialogDescription>
          {pkg.contractorName} · {pkg.name}. Only the prices you change are saved; name, tiers and availability stay as they are.
          Requests and quotes already agreed keep their price.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {lines.map((line) => <PriceInput key={line.id} id={`price-${pkg.id}-${line.id}`} label={line.detail ? `${line.name} (${line.detail})` : line.name}
          current={line.price} value={draft[line.id] ?? ""} invalid={invalid.includes(line.id)} disabled={pending}
          onChange={(value) => setDraft((current) => ({ ...current, [line.id]: value }))} />)}
        {pkg.pricingMode === "deposit_quote" && <PriceInput id={`price-${pkg.id}-deposit`} label="Deposit" current={pkg.depositAmount}
          value={draft.deposit ?? ""} invalid={invalid.includes("deposit")} disabled={pending}
          onChange={(value) => setDraft((current) => ({ ...current, deposit: value }))} />}
        <FormField label="Reason" required help={`The vendor is notified and sees this reason. Up to ${PRICE_CORRECTION_REASON_MAX} characters.`}>
          {(control) => <Textarea {...control} value={reason} maxLength={PRICE_CORRECTION_REASON_MAX} disabled={pending} onChange={(event) => setReason(event.target.value)} />}
        </FormField>
        <p className="text-sm text-muted-foreground">A price outside the guardrail band keeps the package in Package Reviews; correcting is not approving.</p>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
        <p role="status" className="sr-only">{pending ? "Saving corrected prices…" : ""}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="commitment" loading={pending} onClick={() => void save()}>{pending ? "Saving…" : "Save corrected prices"}</Button>
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
