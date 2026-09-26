import "server-only";

import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";
import type { StorageStep } from "@/lib/renewalRetention";
import type { createClient } from "@/lib/supabase/server";

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

// TRACE-093: the one storage call of a prepared retention step. Moves use the service key,
// the only caller that reaches quarantine. A permanent deletion uses the operator's own
// session, so Storage's delete passes the quarantine policy: it takes the lock hold
// placement takes, refuses while a hold is in force and records the deletion in Storage's
// transaction. Refused, it removes nothing and reports no error; recording decides.
export function runRetentionStorageStep(step: StorageStep, session: Awaited<ReturnType<typeof createClient>>) {
  return step.kind === "move"
    ? serviceClient().storage.from(step.from).move(step.path, step.path, { destinationBucket: step.to })
    : session.storage.from(step.bucket).remove([step.path]);
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
