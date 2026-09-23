import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRetentionAction, retentionRecordAction } from "@/lib/renewalRetention";
import { applicationRetentionStorageStep, isApplicationDocumentPath } from "@/lib/applicationRetention";
import { databaseRefusal, recordValue, serviceClient } from "@/lib/renewalDocumentsServer";

export const runtime = "nodejs";

// TRACE-084: one CFG-011 retention step for a file of a rejected or abandoned vendor
// application — quarantine, restore or permanent deletion. The same shape as the TRACE-074
// renewal route: the caller's session asks the database whether the step may start; the
// service client moves or removes the file (only it can reach quarantine); the caller's
// session records the step, which the database accepts only after reading storage.
export async function POST(request: Request) {
  try {
    const body = recordValue(await request.json().catch(() => null));
    const applicationId = typeof body?.applicationId === "string" ? body.applicationId.toLowerCase() : "";
    const path = typeof body?.path === "string" ? body.path : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const key = typeof body?.key === "string" ? body.key : "";
    if (!body || !/^[0-9a-f-]{36}$/.test(applicationId) || !isApplicationDocumentPath(applicationId, path) || !isRetentionAction(body.action)) {
      return NextResponse.json({ error: "Choose an application document and a retention step." }, { status: 400 });
    }
    if (!reason || reason.length > 1000 || !key || key.length > 200) {
      return NextResponse.json({ error: "A reason of up to 1000 characters is required." }, { status: 400 });
    }
    const action = body.action;
    const params = { p_application: applicationId, p_path: path, p_action: retentionRecordAction[action], p_reason: reason, p_key: key };

    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ error: "Sign in to manage document retention." }, { status: 401 });
    }

    const { data: preparedData, error: prepareError } = await supabase.rpc("vendor_application_retention_prepare", params);
    if (prepareError) {
      const refusal = databaseRefusal(prepareError);
      if (refusal) return refusal;
      throw prepareError;
    }
    const prepared = recordValue(preparedData);
    if (!prepared) throw new Error("Retention step was not prepared.");

    if (prepared.replay !== true) {
      const step = applicationRetentionStorageStep(action, applicationId, prepared);
      const storage = serviceClient().storage;
      const { error: storageError } =
        step.kind === "move"
          ? await storage.from(step.from).move(step.path, step.path, { destinationBucket: step.to })
          : await storage.from(step.bucket).remove([step.path]);
      if (storageError) {
        // Expected when a retry finds the file already moved; recording checks storage.
        console.warn("Application retention storage step reported an error", { applicationId, action, message: storageError.message });
      }
    }

    const { data, error } = await supabase.rpc("vendor_application_retention_record", params);
    if (error) {
      const refusal = databaseRefusal(error);
      if (refusal) return refusal;
      throw error;
    }
    const result = recordValue(data);
    if (result?.application_id !== applicationId || result.storage_path !== path) throw new Error("Retention step was not confirmed.");

    return NextResponse.json({
      applicationId,
      path,
      action,
      recorded: result.recorded === true,
      underHold: result.under_hold === true,
    });
  } catch (error) {
    console.error("Application retention step failed", error);
    return NextResponse.json(
      { error: "The retention step could not be completed. Refresh the queue before trying again." },
      { status: 500 },
    );
  }
}
