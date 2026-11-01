"use client";

import { useRef } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { describeAssessment, errorMessage, isStale, type Assessment } from "@/lib/cancellation";
import { useOperationPreview } from "@/components/dashboard/useOperationPreview";

/** TRACE-131: a pending request is cancelled through the assessed command, never a status edit. */
export function CancelPendingRequest({ jobId, entity, disabled, onCancelled }: {
  jobId: string; entity: string; disabled: boolean; onCancelled: (assessment: Assessment) => Promise<void>;
}) {
  const key = useRef<string | null>(null);
  const { preview, error, loading, reload } = useOperationPreview(jobId, "customer_cancel", false, !disabled);
  const consequence = preview?.allowed ? describeAssessment("customer_cancel", preview.assessment) : preview?.refusal?.message ?? "";
  return <div className="space-y-2">
    {error && <p role="status" className="text-sm text-destructive">{error} <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>Try again</Button></p>}
    <ConfirmAction triggerLabel="Cancel request" title="Cancel this pending request?" entity={entity}
      consequence={`${consequence} You can submit a new request later, but this action can’t be undone.`}
      confirmLabel="Yes, cancel request" disabled={disabled || loading || !preview?.allowed}
      describeError={caught => isStale(caught) ? "This request changed since you opened it. The current details are now shown; review them and try again."
        : errorMessage(caught, "We couldn’t cancel this request. Please try again.")}
      onConfirm={async () => {
        key.current ??= crypto.randomUUID();
        const result = await createClient().rpc("record_job_operation", { _job_id: jobId, _operation_key: key.current,
          _kind: "customer_cancel", _reason: "Homeowner cancelled pending request", _waived: false, _expected: preview?.expected ?? null });
        if (result.error) {
          if (isStale(result.error)) { key.current = null; void reload(); }
          throw result.error;
        }
        await onCancelled(result.data as Assessment);
      }} />
  </div>;
}
