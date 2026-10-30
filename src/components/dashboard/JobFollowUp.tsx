"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { createClient } from "@/lib/supabase/client";
import { formatAppointment } from "@/lib/appointments";

type Dispute = { id: string; status: string; resolution_notes: string | null; ticket_id: string | null };

export function JobFollowUp({ jobId, status, vendorCompletedAt }: { jobId: string; status: string; vendorCompletedAt?: string | null }) {
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const load = useCallback(async () => {
    const client = createClient();
    const d = await client.from("disputes").select("id,status,resolution_notes,ticket_id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (d.error) { setError("Follow-up history could not be loaded. Reopen the service to retry."); return; }
    setError(""); setDispute(d.data); setNow(Date.now());
  }, [jobId]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);

  return <section className="space-y-3">
    {error && <p role="alert">{error}</p>}
    {!dispute && ["completed", "review_requested", "reviewed"].includes(status) && vendorCompletedAt && now > 0 && now >= disputeEnds(vendorCompletedAt) &&
      <p className="text-sm">The 48-hour window to report an issue ended {formatAppointment(disputeEnds(vendorCompletedAt))}. Contact support about a problem.</p>}
    {!dispute && ["completed", "review_requested", "reviewed"].includes(status) && vendorCompletedAt && now > 0 && now < disputeEnds(vendorCompletedAt) && <>
      <p className="text-sm">You can report an issue with this service until {formatAppointment(disputeEnds(vendorCompletedAt))}. Contact support for other concerns.</p>
      <ConfirmAction requireReason triggerLabel="Dispute completed service" title="Open a service dispute?" entity="Completed service" consequence="Mercurius will create a dispute ticket and review your reason and evidence." confirmLabel="Open dispute" onConfirm={async reason => {
        const result = await createClient().rpc("homeowner_raise_dispute", { _job_id: jobId, _reason: reason });
        if (result.error) throw result.error; await load();
      }} />
    </>}
    {dispute && <div className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">Dispute follow-up</h3>
      <p className="text-sm">Status: {dispute.status.replaceAll("_", " ")}. Your support ticket is linked to this service.</p>
      {dispute.resolution_notes && <p className="whitespace-pre-wrap text-sm">{dispute.resolution_notes}</p>}
      {dispute.status === "resolved" && <ConfirmAction requireReason triggerLabel="Appeal resolution" title="Appeal this resolution?" entity="Service dispute" consequence="Your reason will create an appeal ticket. The original decision stays in history." confirmLabel="Submit appeal" onConfirm={async reason => {
        const result = await createClient().rpc("appeal_dispute_resolution", { _dispute_id: dispute.id, _reason: reason });
        if (result.error) throw result.error; await load();
      }} />}
    </div>}
  </section>;
}

// The Phase 4 dispute window: 48 hours from the provider's completion. The server enforces it.
function disputeEnds(vendorCompletedAt: string) { return Date.parse(vendorCompletedAt) + 48 * 3_600_000; }
