"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { createClient } from "@/lib/supabase/client";
import { errorMessage, isStale, money, type CancellationOutcome } from "@/lib/cancellation";

type WaiverPreview = {
  operation_id: string; kind: "customer_cancel" | "reschedule_request"; allowed: boolean; refusal: string | null;
  original: { refund_percent: number | null; fee: number | null; basis: string | null; at: string } | null;
  revised: { refund_percent?: number; fee?: number } | null;
  refund: CancellationOutcome | null; expected: unknown;
};

/**
 * TRACE-132 (DEC-2026-053 E11, operations only): accept a weather or emergency exception after the
 * record. The original assessment and refunds stay as they are; the server appends the adjustment.
 * No money moves: any additional refund needs its own reviewed authorization.
 */
export function LaterWaiver({ operationId, onDone }: { operationId: string; onDone?: () => void }) {
  const [preview, setPreview] = useState<WaiverPreview | null>(null);
  const keys = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    const result = await createClient().rpc("admin_waiver_preview", { _operation_id: operationId });
    setPreview(result.error ? null : result.data as unknown as WaiverPreview);
  }, [operationId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!preview?.allowed) return null;
  const cancellation = preview.kind === "customer_cancel";
  const refund = preview.refund;
  const authorized = refund?.authorization?.amount ?? 0;
  const consequence = cancellation
    ? `The cancellation stays recorded at ${preview.original?.refund_percent ?? 0}%; this adds an exception so 100% is owed${typeof refund?.entitlement?.captured === "number" ? ` (${money(refund.entitlement.captured)} paid, ${money(authorized)} already approved)` : ""}. No money moves. Any additional refund needs its own reviewed authorization, which isn't available yet.`
    : "The request stays recorded with its $25 assessment; this adds an exception so the fee no longer applies. Nothing was charged.";
  return <ConfirmAction requireReason triggerLabel={cancellation ? "Accept exception after cancellation" : "Waive the rescheduling fee"}
    title={cancellation ? "Accept a weather or emergency exception?" : "Waive this rescheduling fee?"} entity={cancellation ? "Cancellation refund" : "Rescheduling fee"}
    consequence={consequence} confirmLabel="Record exception" confirmationTone="commitment"
    reasonHelp="Record the accepted weather, emergency or uncontrollable event. The homeowner sees this reason."
    describeError={caught => isStale(caught) ? "Refunds changed since you opened this. The current amounts are now shown; review them and try again."
      : errorMessage(caught, "The exception could not be recorded. Review the current state before trying again.")}
    onConfirm={async reason => {
      const intent = JSON.stringify([operationId, reason]);
      let key = keys.current.get(intent);
      if (!key) { key = crypto.randomUUID(); keys.current.set(intent, key); }
      const result = await createClient().rpc("admin_record_waiver_adjustment", {
        _operation_id: operationId, _adjustment_key: key, _reason: reason, _expected: preview.expected as never,
      });
      if (result.error) {
        if (isStale(result.error)) void load();
        throw result.error;
      }
      keys.current.delete(intent);
      await load();
      onDone?.();
    }} />;
}
