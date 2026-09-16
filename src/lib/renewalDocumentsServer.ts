import "server-only";

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";

// Shared by the TRACE-073 renewal document routes. The signed-in caller's own session
// runs every database command, so the database stays the authorization boundary; the
// service client only issues signed upload URLs and reads the provider name for the
// owner notification.

export function serviceClient() {
  const env = getServiceSupabaseEnvironment();
  return createServiceClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function optionalContractorId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value.toLowerCase() : undefined;
}

// Database refusals carry messages authored in the migration, so they are safe to show.
// Anything else is reported generically.
export function databaseRefusal(error: { code?: string; message?: string } | null) {
  if (error?.code === "42501") {
    return NextResponse.json({ error: error.message || "Not allowed." }, { status: 403 });
  }
  if (error?.code === "P0001" && error.message) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return null;
}
