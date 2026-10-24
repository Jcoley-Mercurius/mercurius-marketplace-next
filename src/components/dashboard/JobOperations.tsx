"use client";

import { useRef, useState } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { EasternDateTimeField, easternInstant, type EasternDateTimeValue } from "@/components/ui/eastern-date-time-field";
import { FormField } from "@/components/ui/form-field";
import { createClient } from "@/lib/supabase/client";

// Appointments and reschedule requests live in AppointmentPanel (TRACE-121).
export function JobOperations({ jobId, role, recurring = false, onSaved }: {
  jobId: string; role: "admin" | "vendor" | "homeowner"; recurring?: boolean; onSaved?: () => void;
}) {
  const [kind, setKind] = useState(role === "vendor" ? "provider_cancel" : "customer_cancel");
  const [time, setTime] = useState<EasternDateTimeValue>({ date: "", time: "", choice: "" });
  const [waived, setWaived] = useState(false);
  const keys = useRef(new Map<string, string>());
  const choices = role === "admin" ? ["customer_cancel", "provider_cancel", "no_show", "partial_completion", "customer_unavailable", "unable_to_complete", ...(recurring ? ["new_visit"] : [])]
    : role === "vendor" ? ["provider_cancel", "partial_completion", "customer_unavailable", "unable_to_complete"]
      : ["customer_cancel", "no_show"];
  const needsTime = kind === "new_visit";
  const instant = needsTime ? easternInstant(time) : null;
  const label = (value: string) => value.replaceAll("_", " ");
  return <section className="space-y-3 rounded-xl border p-4">
    <h3 className="font-semibold">Service changes</h3>
    <FormField label="Change" required>{control => <select {...control} className="min-h-11 w-full rounded-md border bg-background px-3" value={kind} onChange={event => setKind(event.target.value)}>{choices.map(value => <option key={value} value={value}>{label(value)}</option>)}</select>}</FormField>
    {needsTime && <EasternDateTimeField legend="Visit time" value={time} onChange={setTime} />}
    {role === "admin" && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={waived} onChange={event => setWaived(event.target.checked)} />Accept weather or emergency exception; explain the reason below</label>}
    <p className="text-sm text-muted-foreground">Cancellation applies to this visit only. Refund policy: 72+ hours, 100%; 24–72 hours, 50%; under 24 hours, 0%. Accepted emergency exceptions waive penalties. No charge or refund is processed by this action.</p>
    <ConfirmAction requireReason disabled={needsTime && !instant} triggerLabel="Review service change" title="Record this service change?" entity={label(kind)} consequence={kind === "new_visit" ? "Create a separate visit that needs its own provider acceptance. Existing visits are preserved." : "Record this change and its policy assessment. A reported issue requires operations follow-up; it does not promise a replacement appointment."} confirmLabel="Record change" onConfirm={async reason => {
      const scheduledAt = instant ? instant.toISOString() : undefined;
      const intent = JSON.stringify([jobId, kind, reason, scheduledAt, waived]);
      let key = keys.current.get(intent); if (!key) { key = crypto.randomUUID(); keys.current.set(intent, key); }
      const client = createClient();
      const result = kind === "new_visit"
        ? await client.rpc("create_service_occurrence", { _template_id: jobId, _occurrence_key: key, _scheduled_at: scheduledAt!, _reason: reason })
        : await client.rpc("record_job_operation", { _job_id: jobId, _operation_key: key, _kind: kind, _reason: reason, _scheduled_at: scheduledAt, _waived: waived });
      if (result.error) throw result.error;
      onSaved?.();
    }} />
  </section>;
}
