import { NextResponse } from "next/server";
import { submitEarlyAccess } from "@/lib/earlyAccess";
import { earlyAccessServiceClient } from "@/lib/earlyAccessServer";
import { intakeClientIp } from "@/lib/intakeProtection";

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
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error("Early-access submission failed", error);
    return NextResponse.json(
      { error: "Your interest could not be saved. Please try again." },
      { status: 500 },
    );
  }
}
