"use client";

import { useRef, useState } from "react";
import { ExternalLink, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import {
  RENEWAL_DOCUMENT_KINDS,
  formatFileSize,
  renewalDocumentKindLabel,
  renewalDocumentStateLabel,
  type RenewalDocumentKind,
  type RenewalDocumentState,
} from "@/lib/renewalDocuments";
import { uploadRenewalDocument } from "@/lib/renewalDocumentUpload";
import { retentionStateLabel, type RetentionState } from "@/lib/renewalRetention";
import { VENDOR_DOCUMENT_ACCEPT, VENDOR_DOCUMENT_BUCKET, validateVendorDocument } from "@/lib/vendorApplicationDocuments";

// TRACE-073 operator surface for renewal submissions, inside the activation checklist.
// Accepting happens in the checklist form (it records the evidence); this section opens,
// declines and uploads on the provider's behalf. Every change is confirmed by rereading.
// TRACE-074 adds the provider's retention hold and each declined file's retention state;
// quarantine, restore and deletion run from Admin → Document Retention.

export type RenewalDocument = {
  id: string;
  contractor_id: string;
  kind: RenewalDocumentKind;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  submitted_as: "provider" | "operator";
  created_at: string;
  state: RenewalDocumentState;
  note: string | null;
  decided_at: string | null;
  evidence_id: string | null;
  // TRACE-074, declined documents only.
  retention_state?: RetentionState;
  retention_ends_at?: string;
};

export type RenewalOverview = {
  contractor_id: string;
  onboarding_status: "review" | "active" | "suspended" | "rejected" | null;
  open_limit: number;
  retention_hold?: { reason: string; placed_at: string } | null;
  documents: RenewalDocument[];
};

const stateTone: Record<RenewalDocumentState, string> = {
  submitted: "border-status-warning bg-status-warning-bg text-status-warning",
  accepted: "border-status-success bg-status-success-bg text-status-success",
  declined: "border-status-danger bg-status-danger-bg text-status-danger",
};

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

function formatDateTime(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString();
}

export function VendorRenewalDocuments({
  contractorId,
  businessName,
  overview,
  loadError,
  disabled,
  reread,
}: {
  contractorId: string;
  businessName: string;
  overview: RenewalOverview | null;
  loadError: string;
  disabled: boolean;
  reread: () => Promise<RenewalOverview | null>;
}) {
  const [kind, setKind] = useState<RenewalDocumentKind | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [nonce] = useState(() => crypto.randomUUID());
  const [holdGeneration, setHoldGeneration] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const accepting = overview?.onboarding_status === "active" || overview?.onboarding_status === "suspended";
  const busy = disabled || uploading;

  const open = async (document: RenewalDocument) => {
    setOpening(document.id);
    try {
      const { data, error } = await createClient()
        .storage.from(VENDOR_DOCUMENT_BUCKET)
        .createSignedUrl(document.storage_path, 10 * 60);
      if (error) throw error;
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Document could not be opened", { description: "Please try again." });
    } finally {
      setOpening(null);
    }
  };

  const upload = async () => {
    if (!file || kind === "") return;
    setUploading(true);
    try {
      const result = await uploadRenewalDocument({ file, kind, contractorId });
      const next = await reread();
      if (!next?.documents.some((document) => document.id === result.documentId)) {
        throw new Error("The server did not confirm this submission. Review the list before retrying.");
      }
      toast.success("Renewal document uploaded", {
        description: `${renewalDocumentKindLabel[kind]} for ${businessName}. It awaits review; nothing else changed.`,
      });
      setKind("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (error) {
      toast.error("Document could not be uploaded", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setUploading(false);
    }
  };

  const changeHold = (action: "place" | "release") => async (reason: string) => {
    try {
      const { error } = await createClient().rpc(
        action === "place" ? "vendor_place_retention_hold" : "vendor_release_retention_hold",
        { p_contractor: contractorId, p_reason: reason, p_key: `retention-hold-${action}:${nonce}:${holdGeneration}` },
      );
      if (error) throw new Error(error.message);
      const next = await reread();
      if (Boolean(next?.retention_hold) !== (action === "place")) {
        throw new Error("The server did not confirm the hold. Review the provider before retrying.");
      }
      // A later change on this page is a new request, not a replay of this one.
      setHoldGeneration((value) => value + 1);
      toast.success(action === "place" ? "Retention hold placed" : "Retention hold released", { description: businessName });
    } catch (error) {
      toast.error(action === "place" ? "Hold could not be placed" : "Hold could not be released", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      throw error;
    }
  };

  const decline = (document: RenewalDocument) => async (note: string) => {
    try {
      const { error } = await createClient().rpc("vendor_decline_renewal_document", {
        p_document: document.id,
        p_note: note,
        p_key: `renewal-decline:${nonce}:${document.id}`,
      });
      if (error) throw new Error(error.message);
      const next = await reread();
      if (next?.documents.find((candidate) => candidate.id === document.id)?.state !== "declined") {
        throw new Error("The server did not confirm this decline. Review the list before retrying.");
      }
      toast.success("Renewal document declined", { description: "The provider sees your note." });
    } catch (error) {
      toast.error("Document could not be declined", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      throw error;
    }
  };

  return (
    <section aria-labelledby={`renewal-documents-${contractorId}`} className="space-y-3 border-t border-border pt-4">
      <div className="space-y-1">
        <h4 id={`renewal-documents-${contractorId}`} className="text-sm font-medium">Renewal documents</h4>
        <p className="text-xs leading-5 text-muted-foreground">
          Renewed license and insurance documents submitted outside the application. Accept one by selecting it as the document for Licensing or Insurance above. Neither uploading nor declining changes the provider&apos;s status, eligibility or application.
        </p>
      </div>

      {loadError ? (
        <p role="alert" className="text-sm text-destructive">{loadError}</p>
      ) : !overview ? (
        <p role="status" className="text-sm text-muted-foreground">Loading renewal documents...</p>
      ) : overview.documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No renewal documents have been submitted.</p>
      ) : (
        <ul aria-label="Renewal documents" className="divide-y divide-border rounded-lg border border-border">
          {overview.documents.map((document) => (
            <li key={document.id} className="space-y-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words text-sm font-medium">
                  {renewalDocumentKindLabel[document.kind]} · {document.file_name}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Badge variant="outline" className={stateTone[document.state]}>
                    {renewalDocumentStateLabel[document.state]}
                  </Badge>
                  {document.retention_state && document.retention_state !== "retained" && (
                    <Badge variant="outline">{retentionStateLabel[document.retention_state]}</Badge>
                  )}
                </span>
              </div>
              <p className="break-words text-xs leading-5 text-muted-foreground">
                {document.submitted_as === "provider" ? "Submitted by the provider" : "Uploaded by an operator"} ·{" "}
                {formatDateTime(document.created_at)} · {formatFileSize(document.size_bytes)}
                {document.decided_at ? ` · decided ${formatDateTime(document.decided_at)}` : ""}
              </p>
              {document.note && (
                <p className="break-words text-xs leading-5 text-foreground">Note to provider: {document.note}</p>
              )}
              <div className="flex flex-wrap items-start gap-2">
                {(document.retention_state ?? "retained") === "retained" ? (
                <Button
                  size="sm"
                  variant="outline"
                  loading={opening === document.id}
                  disabled={opening !== null}
                  onClick={() => void open(document)}
                  aria-label={`Open ${document.file_name}`}
                >
                  <ExternalLink />
                  Open
                </Button>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">
                    {document.retention_state === "deleted"
                      ? "The file was deleted under the retention policy. This record remains."
                      : "The file is in quarantine and cannot be opened. Restore it from Document Retention."}
                  </p>
                )}
                {document.state === "submitted" && (
                  <ConfirmAction
                    disabled={busy}
                    requireReason
                    reasonLabel="Note to the provider"
                    reasonHelp="The provider sees this note. Explain what is wrong and what to send instead."
                    triggerLabel="Decline"
                    title="Decline this renewal document?"
                    entity={`${businessName} · ${renewalDocumentKindLabel[document.kind]} · ${document.file_name}`}
                    consequence="Records the decline with your note, which the provider sees. The current evidence, status and eligibility do not change."
                    confirmLabel="Decline"
                    onConfirm={decline(document)}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {overview && (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{overview.retention_hold ? "Retention hold in force" : "No retention hold"}</p>
              <p className="break-words text-xs leading-5 text-muted-foreground">
                {overview.retention_hold
                  ? `${overview.retention_hold.reason} · placed ${formatDateTime(overview.retention_hold.placed_at)}. Declined documents for this provider cannot be quarantined or deleted.`
                  : "Declined documents are kept 90 days, then may be quarantined and deleted from Document Retention. Place a hold when an investigation or legal hold applies."}
              </p>
            </div>
            {overview.retention_hold ? (
              <ConfirmAction
                disabled={busy}
                requireReason
                reasonHelp="Recorded with the release. Explain why the hold no longer applies."
                triggerLabel="Release hold"
                title="Release this retention hold?"
                entity={businessName}
                consequence="Quarantine and permanent deletion open again for this provider's declined documents once their periods end."
                confirmLabel="Release hold"
                onConfirm={changeHold("release")}
              />
            ) : (
              <ConfirmAction
                disabled={busy}
                requireReason
                reasonHelp="Recorded with the hold and shown to operators. Name the investigation or legal hold."
                triggerLabel="Place hold"
                title="Place a retention hold?"
                entity={businessName}
                consequence="Stops quarantine and permanent deletion of this provider's declined renewal documents until an operator releases the hold. Nothing else about the provider changes."
                confirmLabel="Place hold"
                confirmationTone="commitment"
                onConfirm={changeHold("place")}
              />
            )}
          </div>
        </div>
      )}

      {overview && accepting && (
        <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
          <p className="text-xs leading-5 text-muted-foreground">
            Upload a document the provider sent Mercurius directly. It is recorded as uploaded by an operator and awaits review like any other submission.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Document for" required>
              {(control) => (
                <select
                  {...control}
                  className={selectClass}
                  value={kind}
                  disabled={busy}
                  onChange={(event) => setKind(event.target.value as RenewalDocumentKind | "")}
                >
                  <option value="">Select an item</option>
                  {RENEWAL_DOCUMENT_KINDS.map((value) => (
                    <option key={value} value={value}>{renewalDocumentKindLabel[value]}</option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="File" required help="PDF, JPG, PNG, WebP, HEIC or HEIF, up to 10 MB." error={fileError || undefined}>
              {(control) => (
                <Input
                  {...control}
                  ref={fileInput}
                  type="file"
                  accept={VENDOR_DOCUMENT_ACCEPT}
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.target.files?.[0] ?? null;
                    setFile(next);
                    setFileError(next ? validateVendorDocument(next) ?? "" : "");
                  }}
                />
              )}
            </FormField>
          </div>
          <Button
            size="sm"
            variant="outline"
            loading={uploading}
            disabled={busy || kind === "" || !file || Boolean(fileError)}
            onClick={() => void upload()}
          >
            <Upload />
            Upload for review
          </Button>
        </div>
      )}
    </section>
  );
}
