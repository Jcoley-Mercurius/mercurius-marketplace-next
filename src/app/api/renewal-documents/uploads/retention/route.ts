import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  isRenewalUploadPath,
  isRetentionAction,
  retentionRecordAction,
  retentionStorageStep,
} from "@/lib/renewalRetention";
import { databaseRefusal, recordValue, serviceClient } from "@/lib/renewalDocumentsServer";

export const runtime = "nodejs";

// TRACE-091: one CFG-011 retention step for a renewal upload that was never submitted —
// quarantine, restore or permanent deletion. There is no document row, so the upload is
// named by its path. The same shape as the TRACE-074 route: the caller's session asks the
// database whether the step may start; the service client moves or removes the file (only
// it can reach quarantine); the caller's session records the step, which the database
// accepts only after reading storage.
export async function POST(request: Request) {
  try {
    const body = recordValue(await request.json().catch(() => null));
    const path = body?.path;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const key = typeof body?.key === "string" ? body.key : "";
    if (!body || !isRenewalUploadPath(path) || !isRetentionAction(body.action)) {
      return NextResponse.json({ error: "Choose a renewal upload and a retention step." }, { status: 400 });
    }
    if (!reason || reason.length > 1000 || !key || key.length > 200) {
      return NextResponse.json({ error: "A reason of up to 1000 characters is required." }, { status: 400 });
    }
    const action = body.action;
    const params = { p_path: path, p_action: retentionRecordAction[action], p_reason: reason, p_key: key };

    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return NextResponse.json({ error: "Sign in to manage document retention." }, { status: 401 });
    }

    const { data: preparedData, error: prepareError } = await supabase.rpc("vendor_renewal_upload_retention_prepare", params);
    if (prepareError) {
      const refusal = databaseRefusal(prepareError);
      if (refusal) return refusal;
      throw prepareError;
    }
    const prepared = recordValue(preparedData);
    if (!prepared) throw new Error("Retention step was not prepared.");

    if (prepared.replay !== true) {
      if (prepared.storage_path !== path) throw new Error("Prepared retention step names another upload.");
      const step = retentionStorageStep(action, prepared);
      const storage = serviceClient().storage;
      const { error: storageError } =
        step.kind === "move"
          ? await storage.from(step.from).move(step.path, step.path, { destinationBucket: step.to })
          : await storage.from(step.bucket).remove([step.path]);
      if (storageError) {
        // Expected when a retry finds the file already moved; recording checks storage.
        console.warn("Renewal upload retention storage step reported an error", { action, message: storageError.message });
      }
    }

    const { data, error } = await supabase.rpc("vendor_renewal_upload_retention_record", params);
    if (error) {
      const refusal = databaseRefusal(error);
      if (refusal) return refusal;
      throw error;
    }
    const result = recordValue(data);
    if (result?.storage_path !== path) throw new Error("Retention step was not confirmed.");

    return NextResponse.json({
      path,
      action,
      recorded: result.recorded === true,
      underHold: result.under_hold === true,
    });
  } catch (error) {
    console.error("Renewal upload retention step failed", error);
    return NextResponse.json(
      { error: "The retention step could not be completed. Refresh the queue before trying again." },
      { status: 500 },
    );
  }
}
