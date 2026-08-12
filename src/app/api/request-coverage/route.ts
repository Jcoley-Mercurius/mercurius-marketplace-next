import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type {
  CoverageArea,
  RequestCoverageResult,
} from "@/lib/requestCoverage";

export const runtime = "nodejs";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Coverage lookup is not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(request: Request) {
  const zipCode = new URL(request.url).searchParams.get("zip")?.trim().slice(0, 5) ?? "";
  if (!/^\d{5}$/.test(zipCode)) {
    return NextResponse.json(
      { error: "Enter a valid five-digit ZIP code." },
      { status: 400 },
    );
  }

  try {
    // This server-only lookup can see inactive waitlist rows that public RLS
    // intentionally hides. The response reveals only the exact ZIP decision.
    const result = await serviceClient()
      .from("coverage_areas")
      .select("id, zip_code, city, state, is_active, has_waitlist")
      .eq("zip_code", zipCode)
      .maybeSingle();
    if (result.error) throw result.error;

    const area = result.data as CoverageArea | null;
    const payload: RequestCoverageResult = area?.is_active
      ? { status: "covered", area, checkedZip: zipCode }
      : area?.has_waitlist
        ? { status: "waitlist", area, checkedZip: zipCode }
        : { status: "uncovered", area: null, checkedZip: zipCode };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("Request coverage lookup failed", error);
    return NextResponse.json(
      { error: "We couldn’t verify the live service-area list right now." },
      { status: 503 },
    );
  }
}
