"use client";

import { useRef, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";

/** UI duplicate guard only. The caller still owns server authorization/idempotency. */
export function ConfirmAction({ triggerLabel, title, consequence, entity, confirmLabel, requireReason = false, onConfirm }: {
  triggerLabel: string; title: string; consequence: string; entity: string;
  confirmLabel: string; requireReason?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const inFlight = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  async function confirm() {
    if (inFlight.current || (requireReason && !reason.trim())) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await onConfirm(reason.trim());
      setOpen(false);
      setResult(`${confirmLabel}: ${entity}. Done.`);
    } catch {
      setError("The action could not be confirmed. Review the current state before trying again.");
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <div>
    <AlertDialog.Root open={open} onOpenChange={(nextOpen) => {
      if (inFlight.current) return;
      setOpen(nextOpen);
      if (nextOpen) { setReason(""); setError(""); setResult(""); }
    }}>
      <AlertDialog.Trigger render={<Button variant="outline" />}>{triggerLabel}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
        <AlertDialog.Popup initialFocus={cancelRef} className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-xl border bg-popover p-6 text-popover-foreground shadow-xl">
          <AlertDialog.Title className="text-xl font-semibold">{title}</AlertDialog.Title>
          <p className="font-medium break-words">{entity}</p>
          <AlertDialog.Description className="text-sm text-muted-foreground">{consequence}</AlertDialog.Description>
          {requireReason && <FormField label="Reason" required help="Explain why this change is needed.">{(control) => <Textarea {...control} value={reason} maxLength={1000} disabled={pending} onChange={(event) => setReason(event.target.value)} />}</FormField>}
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
          <p role="status" className="text-sm">{pending ? "Confirming action…" : ""}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Close render={<Button ref={cancelRef} variant="outline" disabled={pending} />}>Cancel</AlertDialog.Close>
            <Button variant="destructive" loading={pending} disabled={requireReason && !reason.trim()} onClick={() => void confirm()}>{pending ? "Confirming…" : confirmLabel}</Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
    <p role="status" className="mt-2 text-sm text-sage-dark">{result}</p>
  </div>;
}
