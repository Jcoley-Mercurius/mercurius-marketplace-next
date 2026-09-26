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

    // TRACE-094: the database appends under the application's row lock, so concurrent
    // finalizations of different paths from one grant cannot overwrite each other.
    const { data, error: attachError } = await supabase.rpc("vendor_application_attach_documents", {
      p_application: applicationId,
      p_paths: paths,
    });
    if (attachError) {
      if (attachError.code === "P0001" && attachError.message === "Application not found") {
        return NextResponse.json(
          { error: "The vendor application could not be found." },
          { status: 404 },
        );
      }
      throw attachError;
    }
    const documentPaths: string[] = isRecord(data) && Array.isArray(data.document_paths)
      ? data.document_paths.filter((path: unknown): path is string => typeof path === "string")
      : [];
    if (paths.some((path) => !documentPaths.includes(path))) {
      throw new Error("Attached documents were not confirmed.");
    }

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
