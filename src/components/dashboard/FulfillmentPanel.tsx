"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fulfillmentTimeline, payoutLine, waitingLine, type Fulfillment } from "@/lib/fulfillment";
import { createClient } from "@/lib/supabase/client";

type State = { mode: "loading" } | { mode: "error"; message: string } | { mode: "ready"; data: Fulfillment; at: number };

// TRACE-128: who started, completed, confirmed or reported an issue, and when, for every
// participant. Provider completion and homeowner confirmation are separate lines; the provider
// and operations also see payout readiness, which the server reads from the payout check.
export function FulfillmentPanel({ jobId }: { jobId: string }) {
  const [state, setState] = useState<State>({ mode: "loading" });
  const load = useCallback(async () => {
    const result = await createClient().rpc("job_fulfillment", { _job_id: jobId });
    if (result.error) { setState({ mode: "error", message: result.error.message }); return; }
    setState({ mode: "ready", data: result.data as unknown as Fulfillment, at: Date.now() });
  }, [jobId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (state.mode === "ready" && state.data.plan) return null;
  const headingId = `fulfillment-${jobId}`;
  return <section aria-labelledby={headingId} className="space-y-3 rounded-xl border p-4">
    <div className="flex flex-wrap items-center gap-2">
      <h3 id={headingId} className="text-sm font-semibold">Work and completion</h3>
      {state.mode !== "loading" && <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={() => void load()}><RefreshCw />Refresh</Button>}
    </div>
    {state.mode === "loading" ? (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading work history…</p>
    ) : state.mode === "error" ? (
      <p role="alert" className="rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger">Work history couldn’t be loaded: {state.message}</p>
    ) : <FulfillmentDetails data={state.data} at={state.at} />}
  </section>;
}

function FulfillmentDetails({ data, at }: { data: Fulfillment; at: number }) {
  const steps = fulfillmentTimeline(data);
  const waiting = waitingLine(data, at);
  const payout = payoutLine(data.payout);
  const started = data.started?.payment_at_start;
  return <>
    {steps.length === 0
      ? <p className="text-sm text-muted-foreground">Work hasn’t started yet.</p>
      : <ol className="space-y-2 text-sm" aria-label="Work history">
        {steps.map(step => <li key={step.key} className="border-l-2 border-accent/40 pl-3">
          <p className="font-medium">{step.label}</p>
          <p className="text-muted-foreground">{step.detail}</p>
        </li>)}
      </ol>}
    {data.completion && !data.completion.recorded && <p className="text-sm text-status-warning">This completion has no recorded photo evidence.</p>}
    {waiting && <p className="text-sm">{waiting}</p>}
    {payout && <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Payout: </span>{payout}</p>}
    {data.role === "admin" && (started || data.payout?.blocker) && <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
      {started && <div><dt className="inline font-medium">Payment when work started: </dt><dd className="inline">{started.state.replaceAll("_", " ")}{started.reason ? ` (${started.reason.replaceAll("_", " ")})` : ""}</dd></div>}
      {data.payout?.blocker && <div><dt className="inline font-medium">Payout check: </dt><dd className="inline">{data.payout.blocker.replaceAll("_", " ")}</dd></div>}
    </dl>}
  </>;
}
