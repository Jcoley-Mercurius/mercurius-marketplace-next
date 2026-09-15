import { createClient } from "@/lib/supabase/client";
import { VENDOR_DOCUMENT_BUCKET, validateVendorDocument } from "@/lib/vendorApplicationDocuments";
import type { RenewalDocumentKind } from "@/lib/renewalDocuments";

// TRACE-073 browser flow shared by the vendor portal and the operator panel: ask the
// server for a signed upload URL, upload the file directly to private storage, then ask
// the server to record the submission. Omitting contractorId submits for the signed-in
// vendor's own provider; an operator names the provider.

export type RenewalSubmission = { documentId: string; kind: RenewalDocumentKind; recorded: boolean };

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "The document could not be submitted.");
  }
  return payload ?? {};
}

export async function uploadRenewalDocument({
  file,
  kind,
  contractorId,
}: {
  file: File;
  kind: RenewalDocumentKind;
  contractorId?: string;
}): Promise<RenewalSubmission> {
  const invalid = validateVendorDocument(file);
  if (invalid) throw new Error(invalid);
  const grant = await post("/api/renewal-documents", {
    kind,
    contractorId,
    file: { name: file.name, type: file.type, size: file.size },
  });
  if (typeof grant.path !== "string" || typeof grant.token !== "string") {
    throw new Error("Secure document upload is temporarily unavailable.");
  }
  const { error } = await createClient()
    .storage.from(VENDOR_DOCUMENT_BUCKET)
    .uploadToSignedUrl(grant.path, grant.token, file, { contentType: file.type });
  if (error) throw new Error("The document could not be uploaded. Please try again.");
  // A retry after a lost response replays the same path, so it never submits twice.
  const submitted = await post("/api/renewal-documents/submit", { path: grant.path, contractorId });
  return submitted as unknown as RenewalSubmission;
}
