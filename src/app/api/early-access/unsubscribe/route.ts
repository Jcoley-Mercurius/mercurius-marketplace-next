import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeMarketing } from "@/lib/earlyAccess";
import { earlyAccessServiceClient } from "@/lib/earlyAccessServer";

export const runtime = "nodejs";

// TRACE-102: promotional unsubscribe. Mail clients send an RFC 8058 one-click POST to the
// List-Unsubscribe URL with the token in its query string; a page may instead send JSON
// { token }. Early-access status mail has its own withdrawal link (manage route).
export async function POST(request: NextRequest) {
  try {
    let token = request.nextUrl.searchParams.get("token");
    if (!token && request.headers.get("content-type")?.includes("application/json")) {
      const body: unknown = await request.json().catch(() => null);
      const value = typeof body === "object" && body !== null ? (body as Record<string, unknown>).token : null;
      token = typeof value === "string" ? value : null;
    }
    const result = await unsubscribeMarketing(earlyAccessServiceClient(), token);
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    console.error("Marketing unsubscribe failed", error);
    return NextResponse.json(
      { error: "You could not be unsubscribed. Please try again." },
      { status: 500 },
    );
  }
}
