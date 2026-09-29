import { NextResponse } from "next/server";
import { manageEarlyAccess } from "@/lib/earlyAccess";
import { earlyAccessServiceClient } from "@/lib/earlyAccessServer";

export const runtime = "nodejs";

// TRACE-102: read, update or withdraw the one interest named by an emailed link token.
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    const result = await manageEarlyAccess(earlyAccessServiceClient(), body);
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    console.error("Early-access management failed", error);
    return NextResponse.json(
      { error: "Your early-access details could not be changed. Please try again." },
      { status: 500 },
    );
  }
}
