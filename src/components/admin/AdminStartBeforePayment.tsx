"use client";

import { useRef } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { createClient } from "@/lib/supabase/client";

type StartableRequest = {
  id: string;
  service_type: string;
  status: string;
  matching_status: string;
  frequency?: string | null;
  recurrence_parent_id?: string | null;
};

/**
 * CS-5 one-time extension (TRACE-145, DEC-2026-050 A): whether to offer operations the recorded payment
 * exception for a one-time job. The server decides: it starts a paid job, records an exception for a job that
 * is ready but unpaid, processing, failed or of unknown outcome, and refuses a held, terms-blocked or
 * unreviewed one. Recurring visits use the recurring payment queue.
 */
export function canOfferOneTimeStartException(request: Omit<StartableRequest, "id" | "service_type">) {
  return request.status === "scheduled" && request.matching_status === "matched" && !request.recurrence_parent_id
    && (request.frequency ?? "one-time") === "one-time";
}

export function AdminStartBeforePayment({ request, onStarted }: { request: StartableRequest; onStarted: () => void }) {
  const key = useRef<string | null>(null);
  if (!canOfferOneTimeStartException(request)) return null;
  return <section className="rounded-xl border bg-muted/30 p-4">
    <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Start before payment</h3>
    <p className="mb-3 text-sm text-muted-foreground">Work starts only when the job is paid. Operations can start a job that is ready but unpaid, still processing, failed or unconfirmed, with a recorded reason. A held, blocked or unreviewed job can&apos;t start.</p>
    <ConfirmAction requireReason triggerLabel="Start without payment" title="Start this job before it's paid?"
      entity={request.service_type} reasonLabel="Reason" reasonHelp="For example, the homeowner is paying on site. The reason is kept with the start."
      consequence="The job starts now with a recorded payment exception. Nothing is charged, and the provider's payout still waits for full payment."
      confirmLabel="Start job" describeError={(error) => (error as { message?: string } | null)?.message} onConfirm={async (reason) => {
        if (!key.current) key.current = crypto.randomUUID();
        const result = await createClient().rpc("admin_start_visit_payment_exception", { _job_id: request.id, _operation_key: key.current, _reason: reason });
        if (result.error) throw result.error;
        key.current = null;
        onStarted();
      }} />
  </section>;
}
