import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getServiceSupabaseEnvironment } from "@/lib/env/server";

// TRACE-102: the early-access routes reach interest, consent and link records only
// through service-role database commands; the key holds no privilege on the tables.
export function earlyAccessServiceClient() {
  const env = getServiceSupabaseEnvironment();
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
