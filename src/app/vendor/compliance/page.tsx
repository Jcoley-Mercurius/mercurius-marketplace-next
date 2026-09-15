"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { createClient } from "@/lib/supabase/client";
import {
  RENEWAL_DOCUMENT_KINDS,
  renewalDocumentKindLabel,
  renewalDocumentStateLabel,
  type RenewalDocumentKind,
  type RenewalDocumentState,
} from "@/lib/renewalDocuments";
import { uploadRenewalDocument } from "@/lib/renewalDocumentUpload";
import { VENDOR_DOCUMENT_ACCEPT, validateVendorDocument } from "@/lib/vendorApplicationDocuments";
import { cn } from "@/lib/utils";

// TRACE-073: a provider submits renewed license and insurance documents and follows
// their review. The server returns only the item, file name, time, state and any decline
// note. Submitting records a file for review; it changes no status or listing.

type Submission = {
  id: string;
  kind: RenewalDocumentKind;
  file_name: string;
  submitted_as: "provider" | "operator";
  created_at: string;
  state: RenewalDocumentState;
  note: string | null;
  decided_at: string | null;
};

type OwnDocuments = { accepting: boolean; open_limit: number; documents: Submission[] };

const stateTone: Record<RenewalDocumentState, string> = {
  submitted: "border-status-warning bg-status-warning-bg text-status-warning",
  accepted: "border-status-success bg-status-success-bg text-status-success",
  declined: "border-status-danger bg-status-danger-bg text-status-danger",
};

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

function formatDate(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function VendorCompliancePage() {
  const [own, setOwn] = useState<OwnDocuments | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<RenewalDocumentKind | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: rpcError } = await createClient().rpc("vendor_own_renewal_documents");
      if (rpcError) throw rpcError;
      const next = data as unknown as OwnDocuments;
      setOwn(next);
      setError("");
      return next;
    } catch {
      setError("Your compliance documents could not be loaded.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const submit = async () => {
    if (!file || kind === "" || submitting) return;
    setSubmitting(true);
    setResult("");
    try {
      const submission = await uploadRenewalDocument({ file, kind });
      const next = await load();
      if (!next?.documents.some((document) => document.id === submission.documentId)) {
        throw new Error("Your upload was not confirmed. Check your submissions before trying again.");
      }
      const message = `${renewalDocumentKindLabel[kind]} submitted. Mercurius will review it and record the new expiry.`;
      setResult(message);
      toast.success("Document submitted", { description: message });
      setKind("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    } catch (reason) {
      toast.error("Document could not be submitted", {
        description: reason instanceof Error ? reason.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const header = (
    <PageHeader
      eyebrow="Compliance"
      title="Compliance documents"
      description="Send Mercurius your renewed license or insurance certificate. Mercurius reviews each document and records its new expiry. Uploading a document does not change your status or listing."
    />
  );

  if (!own) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
        {header}
        {error && !loading ? (
          <PageState
            kind="error"
            title="Compliance documents unavailable"
            description={error}
            action={<Button onClick={() => void load()}><RefreshCw />Try again</Button>}
          />
        ) : (
          <PageState kind="loading" title="Loading compliance documents" />
        )}
      </div>
    );
  }

  const openByKind = (value: RenewalDocumentKind) =>
    own.documents.filter((document) => document.kind === value && document.state === "submitted").length;
  const atLimit = kind !== "" && openByKind(kind) >= own.open_limit;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 md:p-8">
      {header}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} The list below is from the last successful load.
        </p>
      )}

      {own.accepting ? (
        <section aria-labelledby="renewal-upload-title" className="space-y-4 rounded-xl border bg-card p-4 text-card-foreground sm:p-6">
          <div className="space-y-1">
            <h2 id="renewal-upload-title" className="text-lg font-semibold">Upload a renewed document</h2>
            <p className="text-sm text-muted-foreground">
              Upload the complete certificate or license, showing the new expiry date. Do not upload bank details.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Document type" required>
              {(control) => (
                <select
                  {...control}
                  className={selectClass}
                  value={kind}
                  disabled={submitting}
                  onChange={(event) => setKind(event.target.value as RenewalDocumentKind | "")}
                >
                  <option value="">Select a document type</option>
                  {RENEWAL_DOCUMENT_KINDS.map((value) => (
                    <option key={value} value={value}>{renewalDocumentKindLabel[value]}</option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField
              label="File"
              required
              help="PDF, JPG, PNG, WebP, HEIC or HEIF, up to 10 MB."
              error={fileError || undefined}
            >
              {(control) => (
                <Input
                  {...control}
                  ref={fileInput}
                  type="file"
                  accept={VENDOR_DOCUMENT_ACCEPT}
                  disabled={submitting}
                  onChange={(event) => {
                    const next = event.target.files?.[0] ?? null;
                    setFile(next);
                    setFileError(next ? validateVendorDocument(next) ?? "" : "");
                  }}
                />
              )}
            </FormField>
          </div>
          {atLimit && (
            <p className="text-sm text-muted-foreground">
              You have {own.open_limit} {renewalDocumentKindLabel[kind as RenewalDocumentKind].toLowerCase()} documents awaiting review. Mercurius will review them before you can upload another.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              className="min-h-11"
              loading={submitting}
              disabled={submitting || kind === "" || !file || Boolean(fileError) || atLimit}
              onClick={() => void submit()}
            >
              <Upload />
              {submitting ? "Uploading…" : "Submit document"}
            </Button>
            <p role="status" className="text-sm text-sage-dark">{result}</p>
          </div>
        </section>
      ) : (
        <PageState
          kind="permission"
          title="Renewal uploads are not available yet"
          description="Renewal uploads open once Mercurius has activated your provider account. If your application is still being reviewed, contact Mercurius about your documents."
          action={<Link href="/contact" className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}>Contact Mercurius</Link>}
        />
      )}

      <section aria-labelledby="renewal-submissions-title" className="space-y-3">
        <h2 id="renewal-submissions-title" className="text-lg font-semibold">Your submissions</h2>
        {own.documents.length === 0 ? (
          <PageState kind="empty" title="No documents submitted yet" description="Documents you submit appear here with their review status." />
        ) : (
          <ul aria-label="Your submissions" className="divide-y rounded-xl border bg-card text-card-foreground">
            {own.documents.map((document) => (
              <li key={document.id} className="min-w-0 space-y-1.5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">
                    {renewalDocumentKindLabel[document.kind]} · {document.file_name}
                  </span>
                  <Badge variant="outline" className={stateTone[document.state]}>
                    {renewalDocumentStateLabel[document.state]}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {document.submitted_as === "operator" ? "Uploaded for you by Mercurius" : "Submitted"} {formatDate(document.created_at)}
                  {document.decided_at ? ` · reviewed ${formatDate(document.decided_at)}` : ""}
                </p>
                {document.state === "declined" && document.note && (
                  <p className="break-words text-sm text-foreground">
                    <span className="font-medium">Note from Mercurius:</span> {document.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
