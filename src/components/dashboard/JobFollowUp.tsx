"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";

type Dispute = { id: string; status: string; resolution_notes: string | null; ticket_id: string | null };
type Review = { id: string; rating: number; comment: string | null; moderation_state: string };

export function JobFollowUp({ jobId, status, vendorCompletedAt }: { jobId: string; status: string; vendorCompletedAt?: string | null }) {
  const [dispute, setDispute] = useState<Dispute | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const client = createClient();
    const [d, r] = await Promise.all([
      client.from("disputes").select("id,status,resolution_notes,ticket_id").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      client.from("reviews").select("id,rating,comment,moderation_state").eq("service_request_id", jobId).maybeSingle(),
    ]);
    if (d.error || r.error) { setError("Follow-up history could not be loaded. Reopen the service to retry."); return; }
    setError(""); setDispute(d.data); setReview(r.data);
    if (r.data) { setRating(r.data.rating); setComment(r.data.comment ?? ""); }
  }, [jobId]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);

  return <section className="space-y-3">
    {error && <p role="alert">{error}</p>}
    {!dispute && ["completed", "review_requested", "reviewed"].includes(status) && vendorCompletedAt && <>
      <p className="text-sm">Disputes may be filed within 48 hours of the provider marking this visit complete. Contact support for other concerns.</p>
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
    {review && <div className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">Your review</h3>
      <p className="text-sm">{review.moderation_state.replaceAll("_", " ")}</p>
      <p className="text-sm text-muted-foreground">All star ratings use the same rules. Spam, personal information, threats or abuse, and content unrelated to the service may be moderated. A low rating alone is not grounds for removal.</p>
      <FormField label="Corrected rating" required>{control => <Input {...control} type="number" min={1} max={5} value={rating} onChange={event => setRating(Number(event.target.value))} />}</FormField>
      <FormField label="Corrected review">{control => <Textarea {...control} value={comment} onChange={event => setComment(event.target.value)} maxLength={5000} />}</FormField>
      <ConfirmAction requireReason disabled={!Number.isInteger(rating) || rating < 1 || rating > 5} triggerLabel="Save review correction" title="Correct this review?" entity="Your service review" consequence="The correction and your original review will remain in history." confirmLabel="Save correction" onConfirm={async reason => {
        const result = await createClient().rpc("revise_job_review", { _review_id: review.id, _rating: rating, _comment: comment, _reason: reason });
        if (result.error) throw result.error; await load();
      }} />
      {["rejected", "held_for_moderation"].includes(review.moderation_state) && <ConfirmAction requireReason triggerLabel="Appeal moderation" title="Appeal review moderation?" entity="Your service review" consequence="Mercurius will review your appeal in a support ticket." confirmLabel="Submit review appeal" onConfirm={async reason => {
        const result = await createClient().rpc("appeal_job_review", { _review_id: review.id, _reason: reason });
        if (result.error) throw result.error; await load();
      }} />}
    </div>}
  </section>;
}
