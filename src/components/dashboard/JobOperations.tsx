"use client";

import { useRef, useState } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { describeAssessment, errorMessage, isStale, operationLabels, type OperationKind } from "@/lib/cancellation";
import { useOperationPreview } from "@/components/dashboard/useOperationPreview";

// Appointments and reschedule requests live in AppointmentPanel (TRACE-121); recurring visits are
// added in RecurringVisitsPanel (TRACE-123). TRACE-131: every change is previewed by the server, sent
// with the state the preview showed, and refused if that state changed.
export function JobOperations({ jobId, role, onSaved }: {
  jobId: string; role: "admin" | "vendor" | "homeowner"; onSaved?: (assessment: Record<string, unknown>) => void;
}) {
  const [kind, setKind] = useState<OperationKind>(role === "vendor" ? "provider_cancel" : "customer_cancel");
  const [waived, setWaived] = useState(false);
  const keys = useRef(new Map<string, string>());
  const { preview, error, loading, reload } = useOperationPreview(jobId, kind, waived);
  const choices: OperationKind[] = role === "admin" ? ["customer_cancel", "provider_cancel", "no_show", "partial_completion", "customer_unavailable", "unable_to_complete"]
    : role === "vendor" ? ["provider_cancel", "partial_completion", "customer_unavailable", "unable_to_complete"]
      : ["customer_cancel", "no_show"];

  if (preview?.plan) {
    return <section className="space-y-2 rounded-xl border p-4">
      <h3 className="font-semibold">Service changes</h3>
      <p className="text-sm text-muted-foreground">{role === "admin"
        ? "This is a recurring plan. Change it with Stop future visits or pause; cancel or replace each visit on its own."
        : "This is a recurring plan. Changes are made on each visit. To stop future visits, use Ask to stop future visits in the plan’s visits."}</p>
    </section>;
  }

  const consequence = preview?.allowed ? describeAssessment(kind, preview.assessment) : "";
  return <section className="space-y-3 rounded-xl border p-4">
    <h3 className="font-semibold">Service changes</h3>
    <FormField label="Change" required>{control => <select {...control} className="min-h-11 w-full rounded-md border bg-background px-3" value={kind} onChange={event => setKind(event.target.value as OperationKind)}>{choices.map(value => <option key={value} value={value}>{operationLabels[value]}</option>)}</select>}</FormField>
    {role === "admin" && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={waived} onChange={event => setWaived(event.target.checked)} />Accept weather or emergency exception; explain the reason below</label>}
    <div role="status" aria-live="polite" className="text-sm">
      {loading ? <p className="text-muted-foreground">Checking what this change would do…</p>
        : error ? <p className="text-destructive">{error}</p>
          : preview && !preview.allowed ? <p>{preview.refusal?.message}</p>
            : <p className="text-muted-foreground">{consequence}</p>}
    </div>
    {error && <Button type="button" variant="outline" onClick={() => void reload()}>Try again</Button>}
    <ConfirmAction requireReason disabled={loading || !preview?.allowed} triggerLabel="Review service change" title="Record this service change?" entity={operationLabels[kind]}
      consequence={`${consequence} A reported issue requires operations follow-up; it does not promise a replacement appointment.`} confirmLabel="Record change"
      describeError={caught => isStale(caught) ? "This service changed since you opened it. The current details are now shown; review them and try again."
        : errorMessage(caught, "The change could not be recorded. Review the current state before trying again.")}
      onConfirm={async reason => {
        const intent = JSON.stringify([jobId, kind, reason, waived]);
        let key = keys.current.get(intent); if (!key) { key = crypto.randomUUID(); keys.current.set(intent, key); }
        const result = await createClient().rpc("record_job_operation", { _job_id: jobId, _operation_key: key, _kind: kind, _reason: reason, _waived: waived, _expected: preview?.expected ?? null });
        if (result.error) {
          if (isStale(result.error)) void reload();
          throw result.error;
        }
        onSaved?.(result.data as Record<string, unknown>);
      }} />
  </section>;
}
