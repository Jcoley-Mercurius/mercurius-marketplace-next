import { NextResponse } from "next/server";
import { submitEarlyAccess } from "@/lib/earlyAccess";
import { earlyAccessServiceClient } from "@/lib/earlyAccessServer";
import { intakeClientIp } from "@/lib/intakeProtection";
import { captureServerAnalytics } from "@/server/analytics";

export const runtime = "nodejs";

// TRACE-102: anonymous R0 early-access or expansion interest. Joining sends no email here
// and grants no request, checkout or Credits; admission is the separate TRACE-101 command.
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const result = await submitEarlyAccess(
      earlyAccessServiceClient(),
      body,
      intakeClientIp(request.headers),
    );
    if (result.status === 201) captureServerAnalytics(request, "early_access_submitted", { kind: (result.body as { kind?: string }).kind });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Early-access submission failed", error);
    return NextResponse.json(
      { error: "Your interest could not be saved. Please try again." },
      { status: 500 },
    );
  }
}
