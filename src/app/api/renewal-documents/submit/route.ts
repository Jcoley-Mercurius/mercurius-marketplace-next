import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deliverOwnerEmail } from "@/lib/ownerEmailNotifications";
import {
  createCorrelationId,
  elapsedSince,
  logOperationalEvent,
} from "@/lib/observability/operationalLog";
import {
  databaseRefusal,
  optionalContractorId,
  recordValue,
  serviceClient,
} from "@/lib/renewalDocumentsServer";

export const runtime = "nodejs";

// TRACE-073: records an uploaded renewal document as a submission. The database reads
// the object's existence, size and type from storage and refuses a path outside the
// caller's authorized provider. A new provider submission notifies the owner (owner
// decision 2026-09-15); operator uploads and replays do not.
//
// TRACE-154 (Phase 7.2C-2): a provider submission and its owner-email record commit together
// (AFTER INSERT trigger). The email is claimed and sent after the response from the saved
// document and the provider's current business name; whatever happens to it, the document
// stays saved and its delivery state stays visible in Owner Emails. Each request has its own
// server correlation ID. Logs carry codes and the document ID only: never a name, file name,
// path or provider body.
const ROUTE = "renewal_document_submit" as const;

export async function POST(request: Request) {
  const trace = { route: ROUTE, correlationId: createCorrelationId() } as const;
  const startedAt = Date.now();
  try {
    const body = recordValue(await request.json().catch(() => null));
    const contractorId = optionalContractorId(body?.contractorId);
    const path = typeof body?.path === "string" ? body.path : "";
    if (!body || contractorId === undefined || !path.startsWith("renewals/") || path.length > 300) {
      return NextResponse.json({ error: "The document upload could not be matched." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ error: "Sign in to submit a document." }, { status: 401 });
    }
    const { data, error } = await supabase.rpc("vendor_submit_renewal_document", {
      p_path: path,
      ...(contractorId ? { p_contractor: contractorId } : {}),
    });
    if (error) {
      const refusal = databaseRefusal(error);
      if (refusal) return refusal;
      throw error;
    }
    const result = recordValue(data);
    if (typeof result?.document_id !== "string") throw new Error("Submission was not confirmed.");
    const documentId = result.document_id;

    if (result.recorded === true && result.submitted_as === "provider") {
      after(async () => {
        try {
          await deliverOwnerEmail(serviceClient(), "renewal_document", documentId, "initial", undefined, trace);
        } catch (caught) {
          logOperationalEvent({
            ...trace,
            sourceKind: "renewal_document",
            sourceId: documentId,
            mode: "initial",
            event: "owner_email.background_failed",
            outcome: "failed",
            error: caught,
          });
        }
      });
    }

    if (result.recorded === true) {
      logOperationalEvent({
        ...trace,
        sourceKind: "renewal_document",
        sourceId: documentId,
        event: "renewal_document_submission.saved",
        outcome: "saved",
        durationMs: elapsedSince(startedAt),
      });
    }
    return NextResponse.json({
      documentId: result.document_id,
      kind: result.kind,
      recorded: result.recorded === true,
    });
  } catch (error) {
    logOperationalEvent({
      ...trace,
      event: "renewal_document_submission.failed",
      outcome: "failed",
      error,
      durationMs: elapsedSince(startedAt),
    });
    return NextResponse.json(
      { error: "The document could not be submitted. Please try again." },
      { status: 500 },
    );
  }
}
