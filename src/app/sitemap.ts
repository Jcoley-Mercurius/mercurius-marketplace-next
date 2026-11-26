import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";
import { getAnonymousSupabaseEnvironment } from "@/lib/env/server";

// TRACE-103: expose the same eligible provider profiles as the public directory.
export const dynamic = "force-dynamic";

const SITE_ORIGIN = "https://www.mercuriusmarketplace.com";
const PUBLIC_PATHS = ["/", "/services", "/providers"];
const PAGE_SIZE = 500;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { supabaseUrl, supabaseAnonKey } = getAnonymousSupabaseEnvironment();
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const signal = AbortSignal.timeout(4000);
  const providerIds = new Set<string>();

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc("r0_public_providers")
      .select("id")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1)
      .abortSignal(signal);

    // Let crawlers retry on error instead of serving a partial sitemap.
    if (error) throw new Error("Could not load public providers for the sitemap", { cause: error });
    for (const { id } of data) providerIds.add(id);
    if (data.length < PAGE_SIZE) break;
  }

  return [
    ...PUBLIC_PATHS.map((path) => ({ url: new URL(path, SITE_ORIGIN).href })),
    ...Array.from(providerIds, (id) => ({ url: `${SITE_ORIGIN}/providers/${id}` })),
  ];
}
