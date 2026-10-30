"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { authorizationText, entitlementText, movementText, type CancellationOutcome as Outcome } from "@/lib/cancellation";

/**
 * TRACE-131: what a cancellation or provider withdrawal means for the homeowner's money, read from
 * the server in three separate layers. A cancelled status alone never says money was returned.
 */
export function CancellationOutcome({ jobId, role }: { jobId: string; role: "admin" | "homeowner" }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    const result = await createClient().rpc("job_cancellation_outcome", { _job_id: jobId });
    if (result.error) { setOutcome(null); setError("We couldn’t load the refund status."); return; }
    setOutcome(result.data as unknown as Outcome);
  }, [jobId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) return <section className="rounded-xl border p-4" aria-labelledby={`refund-${jobId}`}>
    <h3 id={`refund-${jobId}`} className="font-semibold">Refund status</h3>
    <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>
    <Button className="mt-2" type="button" variant="outline" onClick={() => void load()}>Try again</Button>
  </section>;
  if (!outcome) return null;
  const lines = [entitlementText(outcome), authorizationText(outcome), movementText(outcome)].filter(Boolean);
  if (lines.length === 0) return null;
  return <section className="rounded-xl border p-4" aria-labelledby={`refund-${jobId}`}>
    <h3 id={`refund-${jobId}`} className="font-semibold">Refund status</h3>
    <dl className="mt-2 space-y-2 text-sm">
      {[["Under the policy", entitlementText(outcome)], ["Approval", authorizationText(outcome)], ["Money returned", movementText(outcome)]]
        .filter(([, text]) => text).map(([term, text]) => <div key={term}><dt className="font-medium">{term}</dt><dd className="text-muted-foreground">{text}</dd></div>)}
    </dl>
    {role === "admin" && (outcome.follow_up?.length ?? 0) > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
      {outcome.follow_up!.map(item => <li key={item.code}>{item.message}</li>)}
    </ul>}
  </section>;
}
