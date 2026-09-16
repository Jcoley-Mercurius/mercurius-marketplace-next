import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  MAX_VENDOR_DOCUMENT_SIZE,
  VENDOR_DOCUMENT_BUCKET,
  isAllowedVendorDocumentMimeType,
} from "@/lib/vendorApplicationDocuments";
import { isRenewalDocumentKind, renewalDocumentPath } from "@/lib/renewalDocuments";
import {
  databaseRefusal,
  optionalContractorId,
  recordValue,
  serviceClient,
} from "@/lib/renewalDocumentsServer";

export const runtime = "nodejs";

// TRACE-073: issues one signed upload URL for a renewed license or insurance document.
// The caller's session asks the database whether it may submit for this provider and
// item; only then is a private object path issued. Uploading records nothing until
// /api/renewal-documents/submit.
export async function POST(request: Request) {
  try {
    const body = recordValue(await request.json().catch(() => null));
    const file = recordValue(body?.file);
    const contractorId = optionalContractorId(body?.contractorId);
    const name = typeof file?.name === "string" ? file.name.trim() : "";
    const type = typeof file?.type === "string" ? file.type.toLowerCase() : "";
    const size = Number(file?.size);
    if (!body || !file || contractorId === undefined || !isRenewalDocumentKind(body.kind)) {
      return NextResponse.json({ error: "Choose license or insurance and a document." }, { status: 400 });
    }
    if (!name || name.length > 180 || !isAllowedVendorDocumentMimeType(type)) {
      return NextResponse.json({ error: "Use a PDF, JPG, PNG, WebP, HEIC, or HEIF file." }, { status: 400 });
    }
    if (!Number.isInteger(size) || size <= 0 || size > MAX_VENDOR_DOCUMENT_SIZE) {
      return NextResponse.json({ error: "Documents must be 10 MB or smaller." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ error: "Sign in to submit a document." }, { status: 401 });
    }
    const { data: authorization, error } = await supabase.rpc("vendor_authorize_renewal_upload", {
      p_kind: body.kind,
      ...(contractorId ? { p_contractor: contractorId } : {}),
    });
    if (error) {
      const refusal = databaseRefusal(error);
      if (refusal) return refusal;
      throw error;
    }
    const authorized = recordValue(authorization);
    if (typeof authorized?.contractor_id !== "string") throw new Error("Upload authorization was not confirmed.");

    const path = renewalDocumentPath(authorized.contractor_id, body.kind, randomUUID(), name, type);
    const { data: upload, error: uploadError } = await serviceClient()
      .storage.from(VENDOR_DOCUMENT_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    if (uploadError) throw uploadError;

    return NextResponse.json({ path, token: upload.token }, { status: 201 });
  } catch (error) {
    console.error("Renewal document upload authorization failed", error);
    return NextResponse.json(
      { error: "Secure document upload is temporarily unavailable. Please try again." },
      { status: 500 },
    );
  }
}
