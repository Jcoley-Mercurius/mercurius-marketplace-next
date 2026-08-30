import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  MAX_VENDOR_DOCUMENT_COUNT,
  MAX_VENDOR_DOCUMENT_SIZE,
  VENDOR_DOCUMENT_BUCKET,
  isAllowedVendorDocumentMimeType,
} from "@/lib/vendorApplicationDocuments";
import { verifyVendorDocumentUploadGrant } from "@/lib/vendorApplicationUploadToken";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";

export const runtime = "nodejs";

function serviceClient() {
  const env = getServiceSupabaseEnvironment();
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const applicationId =
      typeof body.applicationId === "string" ? body.applicationId : "";
    const token = typeof body.finalizeToken === "string" ? body.finalizeToken : "";
    const paths = Array.isArray(body.paths)
      ? [...new Set(body.paths.filter((path): path is string => typeof path === "string"))]
      : [];
    const grant = verifyVendorDocumentUploadGrant(token);

    if (
      !grant ||
      grant.applicationId !== applicationId ||
      paths.length === 0 ||
      paths.length > MAX_VENDOR_DOCUMENT_COUNT ||
      paths.some(
        (path) =>
          !grant.paths.includes(path) ||
          !path.startsWith(`${applicationId}/`),
      )
    ) {
      return NextResponse.json(
        { error: "The secure document upload session is invalid or expired." },
        { status: 403 },
      );
    }

    const supabase = serviceClient();
    for (const path of paths) {
      const slashIndex = path.lastIndexOf("/");
      const folder = path.slice(0, slashIndex);
      const name = path.slice(slashIndex + 1);
      const { data, error } = await supabase.storage
        .from(VENDOR_DOCUMENT_BUCKET)
        .list(folder, { limit: 10, search: name });
      if (error) throw error;

      const object = data.find((candidate) => candidate.name === name);
      const metadata =
        object?.metadata && typeof object.metadata === "object"
          ? (object.metadata as Record<string, unknown>)
          : null;
      const storedSize = Number(metadata?.size);
      const storedMimeType =
        typeof metadata?.mimetype === "string" ? metadata.mimetype : "";

      if (
        !object ||
        !Number.isFinite(storedSize) ||
        storedSize <= 0 ||
        storedSize > MAX_VENDOR_DOCUMENT_SIZE ||
        !isAllowedVendorDocumentMimeType(storedMimeType)
      ) {
        return NextResponse.json(
          { error: "One or more uploaded documents could not be verified." },
          { status: 400 },
        );
      }
    }

    const { data: application, error: readError } = await supabase
      .from("vendor_applications")
      .select("id, document_urls")
      .eq("id", applicationId)
      .maybeSingle();
    if (readError) throw readError;
    if (!application) {
      return NextResponse.json(
        { error: "The vendor application could not be found." },
        { status: 404 },
      );
    }

    const existingPaths = Array.isArray(application.document_urls)
      ? application.document_urls.filter(
          (path: unknown): path is string => typeof path === "string",
        )
      : [];
    const documentPaths = [...new Set([...existingPaths, ...paths])];
    const { error: updateError } = await supabase
      .from("vendor_applications")
      .update({ document_urls: documentPaths })
      .eq("id", applicationId);
    if (updateError) throw updateError;

    return NextResponse.json({
      applicationId,
      documentPaths,
      attachedCount: paths.length,
    });
  } catch (error) {
    console.error("Vendor application document finalization failed", error);
    return NextResponse.json(
      { error: "Uploaded documents could not be attached to the application." },
      { status: 500 },
    );
  }
}
