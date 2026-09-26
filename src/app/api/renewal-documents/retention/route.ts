import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  isRetentionAction,
  retentionRecordAction,
  retentionStorageStep,
} from "@/lib/renewalRetention";
import { databaseRefusal, recordValue, runRetentionStorageStep } from "@/lib/renewalDocumentsServer";

export const runtime = "nodejs";

// TRACE-074: one CFG-011 retention step for a declined renewal document — quarantine,
// restore or permanent deletion. The caller's session asks the database whether the step
// may start; the service client moves the file (only it can reach the quarantine bucket)
// and, since TRACE-093, the caller's session deletes it, so a hold committed after prepare
// stops the deletion; the caller's session records the step, which the database accepts
// only after reading storage to confirm it. A storage error is not trusted either way:
// recording decides, so a retry after an interrupted request completes it.
export async function POST(request: Request) {
  try {
    const body = recordValue(await request.json().catch(() => null));
    const documentId = typeof body?.documentId === "string" ? body.documentId.toLowerCase() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const key = typeof body?.key === "string" ? body.key : "";
    if (!body || !/^[0-9a-f-]{36}$/.test(documentId) || !isRetentionAction(body.action)) {
      return NextResponse.json({ error: "Choose a renewal document and a retention step." }, { status: 400 });
    }
    if (!reason || reason.length > 1000 || !key || key.length > 200) {
      return NextResponse.json({ error: "A reason of up to 1000 characters is required." }, { status: 400 });
    }
    const action = body.action;
    const params = { p_document: documentId, p_action: retentionRecordAction[action], p_reason: reason, p_key: key };

    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ error: "Sign in to manage document retention." }, { status: 401 });
    }

    const { data: preparedData, error: prepareError } = await supabase.rpc("vendor_prepare_renewal_retention", params);
    if (prepareError) {
      const refusal = databaseRefusal(prepareError);
      if (refusal) return refusal;
      throw prepareError;
    }
    const prepared = recordValue(preparedData);
    if (!prepared) throw new Error("Retention step was not prepared.");

    if (prepared.replay !== true) {
      const step = retentionStorageStep(action, prepared);
      const { error: storageError } = await runRetentionStorageStep(step, supabase);
      if (storageError) {
        // Expected when a retry finds the file already moved; recording checks storage.
        console.warn("Renewal retention storage step reported an error", { documentId, action, message: storageError.message });
      }
    }

    const { data, error } = await supabase.rpc("vendor_record_renewal_retention", params);
    if (error) {
      const refusal = databaseRefusal(error);
      if (refusal) return refusal;
      throw error;
    }
    const result = recordValue(data);
    if (result?.document_id !== documentId) throw new Error("Retention step was not confirmed.");

    return NextResponse.json({
      documentId,
      action,
      recorded: result.recorded === true,
      underHold: result.under_hold === true,
    });
  } catch (error) {
    console.error("Renewal retention step failed", error);
    return NextResponse.json(
      { error: "The retention step could not be completed. Refresh the queue before trying again." },
      { status: 500 },
    );
  }
}
