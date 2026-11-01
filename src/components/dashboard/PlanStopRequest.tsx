"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/cancellation";
import { planStopLine, planStopVisitLine, type PlanStopPreview } from "@/lib/exceptionResolutions";

/**
 * TRACE-132 (DEC-2026-053 E8): the homeowner asks Mercurius to stop future visits; operations sees
 * each visit still in place with what handling it would mean, then uses Stop future visits (in the
 * plan schedule controls) or closes the request with a reason. Nothing here cancels a visit.
 */
export function PlanStopRequest({ seriesId, role, onChanged }: { seriesId: string; role: "admin" | "homeowner"; onChanged?: () => void }) {
  const headingId = useId();
  const [preview, setPreview] = useState<PlanStopPreview | null>(null);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const keys = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    setError("");
    const result = await createClient().rpc("recurring_plan_stop_preview", { _series_id: seriesId });
    if (result.error) { setPreview(null); setError("We couldn’t load the plan’s stop status."); return; }
    setPreview(result.data as unknown as PlanStopPreview);
  }, [seriesId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) return <section aria-labelledby={headingId} className="space-y-2 rounded-lg border p-3" data-testid="plan-stop">
    <h4 id={headingId} className="text-sm font-semibold">Stop future visits</h4>
    <p role="alert" className="text-sm text-destructive">{error}</p>
    <Button type="button" variant="outline" size="sm" onClick={() => void load()}>Try again</Button>
  </section>;
  if (!preview) return null;

  const request = preview.request;
  const open = request?.state === "open";
  const line = planStopLine(preview, role);
  if (role === "admin" && !request) return null;
  if (role === "homeowner" && (preview.plan_state === "ended" || !preview.accepted) && !request) return null;

  async function ask(reason: string) {
    let key = keys.current.get(reason);
    if (!key) { key = crypto.randomUUID(); keys.current.set(reason, key); }
    const result = await createClient().rpc("homeowner_request_plan_stop", { _series_id: seriesId, _request_key: key, _reason: reason });
    await load();
    if (result.error) throw result.error;
    keys.current.delete(reason);
    setAnnouncement("Request sent. Mercurius will stop future visits; visits already in place stay until each one is handled.");
    onChanged?.();
  }

  async function close(resolution: string) {
    const result = await createClient().rpc("admin_close_plan_stop_request", { _request_id: request!.id, _resolution: resolution });
    await load();
    if (result.error) throw result.error;
    setAnnouncement("Request closed. Future visits were not stopped.");
    onChanged?.();
  }

  const visits = preview.visits.length === 0 ? "No visits are in place."
    : `${preview.visits.length === 1 ? "1 visit is" : `${preview.visits.length} visits are`} in place; each stays until it is handled on its own.`;
  return <section aria-labelledby={headingId} className="space-y-3 rounded-lg border p-3" data-testid="plan-stop">
    <h4 id={headingId} className="text-sm font-semibold">Stop future visits</h4>
    <p role="status" className="text-sm text-sage-dark">{announcement}</p>
    {line && <p className="text-sm" data-testid="plan-stop-state">{line}</p>}
    {(open || role === "homeowner") && preview.visits.length > 0 && <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{visits}</p>
      <ul className="space-y-1 text-sm">{preview.visits.map(visit => <li key={visit.id} className="border-l-2 border-border pl-3">
        {planStopVisitLine(visit)}
        {role === "admin" && visit.payment && <span className="text-muted-foreground"> Paid so far: {visit.payment.captured > 0 ? "yes" : "no"}{visit.payment.open_checkout ? "; a checkout is open" : ""}.</span>}
      </li>)}</ul>
    </div>}
    {role === "homeowner" && !open && preview.plan_state !== "ended" && <ConfirmAction requireReason triggerLabel="Ask to stop future visits"
      title="Ask Mercurius to stop future visits?" entity="Recurring plan"
      consequence={`Mercurius stops new visits for this plan. ${visits} Nothing is cancelled by this request; to cancel a visit, open it and use its own cancellation, which follows the policy for that visit.`}
      reasonHelp="Mercurius sees this reason." confirmLabel="Send request" confirmationTone="commitment"
      describeError={caught => errorMessage(caught, "The request couldn’t be sent. The current status is shown.")} onConfirm={ask} />}
    {role === "admin" && open && <div className="flex flex-wrap gap-2">
      <ConfirmAction requireReason triggerLabel="Close without stopping" title="Close the homeowner’s request without stopping?" entity="Stop request"
        consequence="Future visits are not stopped. The homeowner sees your reason. To stop them instead, use Stop future visits in the plan schedule."
        reasonLabel="Resolution" reasonHelp="The homeowner sees this resolution." confirmLabel="Close request"
        describeError={caught => errorMessage(caught, "The request couldn’t be closed. The current status is shown.")} onConfirm={close} />
    </div>}
  </section>;
}
