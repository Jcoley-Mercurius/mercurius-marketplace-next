import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renewalDocumentKindLabel, type RenewalDocumentKind } from "@/lib/renewalDocuments";
import { sendOwnerNotification } from "@/lib/ownerNotifications";
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
export async function POST(request: Request) {
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

    if (result.recorded === true && result.submitted_as === "provider") {
      const submittedAt = new Date().toISOString();
      const contractor = String(result.contractor_id);
      const kind = renewalDocumentKindLabel[result.kind as RenewalDocumentKind] ?? "Compliance";
      after(async () => {
        const { data: provider } = await serviceClient()
          .from("contractors")
          .select("name")
          .eq("id", contractor)
          .maybeSingle();
        const business = (provider?.name ?? "A provider").replace(/\s+/g, " ").slice(0, 100);
        const sent = await sendOwnerNotification({
          subject: `Renewal document submitted — ${business}`,
          text: [
            "A provider submitted a renewed compliance document",
            "",
            `Submitted: ${submittedAt}`,
            `Business: ${business}`,
            `Item: ${kind}`,
            "",
            "Review it from Admin → Compliance Expiry. Nothing changes until an operator accepts or declines it.",
          ].join("\n"),
        });
        if (!sent.ok) {
          console.error("Renewal document owner notification failed", { documentId: result.document_id, error: sent.error });
        }
      });
    }

    return NextResponse.json({
      documentId: result.document_id,
      kind: result.kind,
      recorded: result.recorded === true,
    });
  } catch (error) {
    console.error("Renewal document submission failed", error);
    return NextResponse.json(
      { error: "The document could not be submitted. Please try again." },
      { status: 500 },
    );
  }
}
