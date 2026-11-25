import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getAnonymousSupabaseEnvironment } from "@/lib/env/server";
import { parsePublicCatalog, type PublicCatalog } from "@/lib/servicesPage/catalog";

const TIMEOUT_MS = 4000;

/**
 * TRACE-161: reads the active categories and services with the anonymous key, exactly the rows the
 * browser already reads under RLS, so their names, descriptions and links are in the initial HTML.
 * No cookie or session is used. Any failure returns null and the page keeps its browser read.
 */
export async function readPublicCatalog(): Promise<PublicCatalog | null> {
  try {
    const env = getAnonymousSupabaseEnvironment();
    const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const [categories, services] = await Promise.all([
      supabase.from("service_categories").select("id, name").eq("is_active", true).order("sort_order").abortSignal(signal),
      supabase.from("services_catalog").select("id, name, category_id, descriptor, icon").eq("is_active", true).order("sort_order").abortSignal(signal),
    ]);
    if (categories.error || services.error) return null;
    return parsePublicCatalog(categories.data, services.data);
  } catch {
    return null;
  }
}
