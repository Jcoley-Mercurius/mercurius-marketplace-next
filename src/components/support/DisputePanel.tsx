"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { formatAppointment } from "@/lib/appointments";
import {
  describeSupportError, disputeStatusLabel, newRequestKey, payoutText, refundText, type Dispute, type DisputeDetail,
} from "@/lib/support";

// TRACE-133: one service's disputes for the homeowner, its provider or operations, from
// dispute_detail. Statements and photos are bound to this job and their author; an appeal answers the
// decision version the homeowner read. The decision, refund and payout lines are separate facts.
export function DisputePanel({ jobId, onChanged }: { jobId: string; onChanged?: () => void }) {
  const [detail, setDetail] = useState<DisputeDetail | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const result = await createClient().rpc("dispute_detail", { _job_id: jobId });
    if (result.error) { setError(describeSupportError(result.error)); return; }
    setError(""); setDetail(result.data as DisputeDetail);
  }, [jobId]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);
  const refresh = async () => { await load(); onChanged?.(); };

  if (error) return <div role="alert" className="space-y-2 rounded-xl border p-4 text-sm"><p>Dispute history couldn&apos;t be loaded. {error}</p>
    <Button variant="outline" onClick={() => void load()}>Try again</Button></div>;
  if (!detail) return <p role="status" className="text-sm text-muted-foreground">Loading dispute history…</p>;
  if (detail.disputes.length === 0) return null;
  const refund = refundText(detail.refund);
  const payout = payoutText(detail.payout);

  return <section aria-labelledby={`disputes-${jobId}`} className="space-y-4 rounded-xl border p-4">
    <h3 id={`disputes-${jobId}`} className="font-semibold">Service dispute</h3>
    {detail.disputes.map((dispute) => <DisputeRecord key={dispute.dispute_id} dispute={dispute} jobId={jobId} viewer={detail.viewer} onChanged={refresh} />)}
    {(refund || payout) && <dl className="grid gap-2 border-t pt-3 text-sm sm:grid-cols-2">
      {refund && <div><dt className="font-medium">Refund</dt><dd>{refund}</dd></div>}
      {payout && <div><dt className="font-medium">Payout</dt><dd>{payout}</dd></div>}
    </dl>}
  </section>;
}

function DisputeRecord({ dispute, jobId, viewer, onChanged }: { dispute: Dispute; jobId: string; viewer: DisputeDetail["viewer"]; onChanged: () => Promise<void> }) {
  return <div className="space-y-3">
    <p className="text-sm"><span className="font-medium">{disputeStatusLabel[dispute.status]}</span>
      {dispute.ticket_number && <> · ticket <span className="font-mono">{dispute.ticket_number}</span></>}
      {" · "}filed {formatAppointment(dispute.raised_at)}
      {dispute.completion_at && <> about the completion recorded {formatAppointment(dispute.completion_at)}</>}</p>
    {dispute.reason && <p className="whitespace-pre-wrap break-words text-sm">“{dispute.reason}”</p>}
    {dispute.status === "resolved" && dispute.resolution_notes && <div className="rounded-lg bg-muted/40 p-3 text-sm">
      <p className="font-medium">Decision (version {dispute.resolution_version})</p>
      <p className="whitespace-pre-wrap break-words">{dispute.resolution_notes}</p>
      <p className="mt-1 text-muted-foreground">A decision is not a refund. Any refund is authorized and sent separately and shows below.</p>
    </div>}
    {dispute.decisions.length > 0 && <details className="text-sm"><summary className="cursor-pointer">History ({dispute.decisions.length})</summary>
      <ol className="mt-2 space-y-1">{dispute.decisions.map((entry, index) => <li key={index}>
        {formatAppointment(entry.at)} · {entry.by} · {entry.action === "appealed" ? "appealed the decision" : `${disputeStatusLabel[entry.from]} → ${disputeStatusLabel[entry.to]}`}
        {entry.notes ? ` · “${entry.notes}”` : ""}</li>)}</ol>
    </details>}
    {dispute.appeals.length > 0 && <ul className="space-y-1 text-sm">{dispute.appeals.map((appeal) => <li key={appeal.resolution_version}>
      Appeal of decision {appeal.resolution_version}: “{appeal.reason}” · {appeal.ticket_status === "resolved" ? "answered" : "under review"}</li>)}</ul>}
    <section aria-label="Statements and photos" className="space-y-2">
      <h4 className="text-sm font-medium">Statements and photos</h4>
      {dispute.submissions.length === 0 ? <p className="text-sm text-muted-foreground">Nothing added yet.</p>
        : <ol className="space-y-2">{dispute.submissions.map((item) => <li key={item.id} className="rounded-lg border p-3 text-sm">
          <p className="font-medium">{item.mine ? "You" : item.role === "homeowner" ? "Homeowner" : "Provider"} · <span className="font-normal text-muted-foreground">{formatAppointment(item.at)}</span></p>
          {item.statement && <p className="whitespace-pre-wrap break-words">{item.statement}</p>}
          {item.photo_path && <EvidencePhoto path={item.photo_path} />}
        </li>)}</ol>}
    </section>
    {dispute.can_submit && viewer !== "operations" && <AddEvidence disputeId={dispute.dispute_id} jobId={jobId} uploaderRole={viewer === "provider" ? "vendor" : "homeowner"} onAdded={onChanged} />}
    {viewer === "homeowner" && dispute.can_appeal && <ConfirmAction requireReason triggerLabel="Appeal this decision" title="Appeal this decision?" entity={`Decision version ${dispute.resolution_version}`}
      consequence="Your reason opens an appeal ticket for this decision. The decision stays in history and the provider's payout stays held while the appeal is open."
      confirmLabel="Submit appeal" describeError={describeSupportError} onConfirm={async (reason) => {
        const result = await createClient().rpc("appeal_dispute_resolution", { _dispute_id: dispute.dispute_id, _reason: reason, _expected_version: dispute.resolution_version });
        if (result.error) throw result.error;
        await onChanged();
      }} />}
  </div>;
}

function EvidencePhoto({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void createClient().storage.from("job-photos").createSignedUrl(path, 600).then((result) => {
      if (!live) return;
      if (result.error || !result.data) setFailed(true); else setUrl(result.data.signedUrl);
    });
    return () => { live = false; };
  }, [path]);
  if (failed) return <p className="text-muted-foreground">Photo unavailable to you.</p>;
  if (!url) return <p className="text-muted-foreground">Loading photo…</p>;
  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
  return <img src={url} alt="Dispute evidence photo" className="mt-2 max-h-64 rounded-lg border object-contain" />;
}

function AddEvidence({ disputeId, jobId, uploaderRole, onAdded }: { disputeId: string; jobId: string; uploaderRole: "homeowner" | "vendor"; onAdded: () => Promise<void> }) {
  const [statement, setStatement] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const key = useRef(newRequestKey());
  // A photo uploaded and recorded once is reused on retry instead of uploading it again.
  const uploaded = useRef<{ name: string; id: string } | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    if (!statement.trim() && !file) { setError("Add a statement or a photo."); return; }
    setPending(true); setError(""); setDone("");
    try {
      const supabase = createClient();
      let photoId: string | null = null;
      if (file) {
        if (uploaded.current?.name === file.name) photoId = uploaded.current.id;
        else {
          const { data: auth } = await supabase.auth.getUser();
          if (!auth.user) throw { code: "42501" };
          const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[file.type];
          if (!extension) { setError("Use a JPEG, PNG or WebP photo."); return; }
          const path = `${auth.user.id}/${jobId}/dispute-${crypto.randomUUID()}.${extension}`;
          const upload = await supabase.storage.from("job-photos").upload(path, file, { upsert: false });
          if (upload.error) { setError("The photo couldn't be uploaded. Try again or add a statement only."); return; }
          const row = await supabase.from("job_photos").insert({ service_request_id: jobId, uploaded_by: auth.user.id, uploader_role: uploaderRole, photo_url: path, photo_type: "issue" }).select("id").single();
          if (row.error) { await supabase.storage.from("job-photos").remove([path]); throw row.error; }
          photoId = row.data.id as string;
          uploaded.current = { name: file.name, id: photoId };
        }
      }
      const result = await supabase.rpc("add_dispute_submission", { _dispute_id: disputeId, _request_key: key.current, _statement: statement.trim() || null, _photo_id: photoId });
      if (result.error) throw result.error;
      key.current = newRequestKey(); uploaded.current = null;
      setStatement(""); setFile(null); setDone("Added to the dispute.");
      await onAdded();
    } catch (caught) {
      setError(describeSupportError(caught));
    } finally {
      setPending(false);
    }
  }

  return <form className="space-y-3 rounded-lg border p-3" onSubmit={(event) => void submit(event)} noValidate>
    <FormField label="Add a statement" help="Up to 2,000 characters. Mercurius and the other party can read it.">
      {(control) => <Textarea {...control} rows={3} maxLength={2000} value={statement} onChange={(event) => { setStatement(event.target.value); key.current = newRequestKey(); }} />}
    </FormField>
    <FormField label="Add a photo (optional)" help="A photo you took of this service. JPEG, PNG or WebP.">
      {(control) => <input {...control} type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm"
        onChange={(event) => { setFile(event.target.files?.[0] ?? null); key.current = newRequestKey(); }} />}
    </FormField>
    {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
    {done && <p role="status" className="text-sm">{done}</p>}
    <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" aria-hidden="true" />}Add to dispute</Button>
  </form>;
}
