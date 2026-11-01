"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { DisputePanel } from "@/components/support/DisputePanel";
import { createClient } from "@/lib/supabase/client";
import { formatAppointment } from "@/lib/appointments";
import { describeSupportError } from "@/lib/support";

// Filing stays the Phase 4 48-hour command; the dispute's history, evidence, decision, appeal and
// money facts come from dispute_detail (TRACE-133). General support is a separate, non-dispute path.
export function JobFollowUp({ jobId, status, vendorCompletedAt }: { jobId: string; status: string; vendorCompletedAt?: string | null }) {
  const [hasDispute, setHasDispute] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [version, setVersion] = useState(0);
  const load = useCallback(async () => {
    const d = await createClient().from("disputes").select("id").eq("job_id", jobId).limit(1).maybeSingle();
    if (d.error) { setError("Follow-up history could not be loaded. Reopen the service to retry."); return; }
    setError(""); setHasDispute(Boolean(d.data)); setNow(Date.now());
  }, [jobId]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  const support = <Link className="underline" href={`/support?job=${encodeURIComponent(jobId)}`}>contact support</Link>;

  return <section className="space-y-3">
    {error && <p role="alert">{error}</p>}
    {hasDispute === false && ["completed", "review_requested", "reviewed"].includes(status) && vendorCompletedAt && now > 0 && now >= disputeEnds(vendorCompletedAt) &&
      <p className="text-sm">The 48-hour window to report an issue ended {formatAppointment(disputeEnds(vendorCompletedAt))}. You can still {support} about a problem.</p>}
    {hasDispute === false && ["completed", "review_requested", "reviewed"].includes(status) && vendorCompletedAt && now > 0 && now < disputeEnds(vendorCompletedAt) && <>
      <p className="text-sm">You can report an issue with this service until {formatAppointment(disputeEnds(vendorCompletedAt))}. For anything else, {support}.</p>
      <ConfirmAction requireReason triggerLabel="Dispute completed service" title="Open a service dispute?" entity="Completed service" describeError={describeSupportError}
        consequence="Mercurius will open a dispute ticket and review your reason and evidence. The provider's payout is held until the dispute is decided. A dispute doesn't by itself refund you."
        confirmLabel="Open dispute" onConfirm={async reason => {
          const result = await createClient().rpc("homeowner_raise_dispute", { _job_id: jobId, _reason: reason });
          if (result.error) throw result.error; await load(); setVersion((v) => v + 1);
        }} />
    </>}
    {hasDispute && <DisputePanel key={version} jobId={jobId} />}
  </section>;
}

// The Phase 4 dispute window: 48 hours from the provider's completion. The server enforces it.
function disputeEnds(vendorCompletedAt: string) { return Date.parse(vendorCompletedAt) + 48 * 3_600_000; }
