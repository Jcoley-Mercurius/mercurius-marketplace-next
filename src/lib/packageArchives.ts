import type { createClient } from "@/lib/supabase/client";

// TRACE-122: which of a provider's packages Mercurius archived (vendor_package_archives,
// migration 20261025001000). That migration narrows vendor_packages privileges, so it is pushed
// after this client is deployed; until then the function does not exist and no package is
// reported archived. Any other failure is raised.

const FUNCTION_NOT_FOUND = "PGRST202";

export async function loadPackageArchives(supabase: ReturnType<typeof createClient>, contractorId: string) {
  const { data, error } = await supabase.rpc("vendor_package_archives", { p_contractor: contractorId });
  if (error) {
    if (error.code === FUNCTION_NOT_FOUND) return new Map<string, string>();
    throw error;
  }
  return parsePackageArchives(data);
}

/** package id → archived_at, ignoring malformed entries. */
export function parsePackageArchives(data: unknown) {
  return new Map((Array.isArray(data) ? data : []).flatMap((entry) => {
    const row = entry as { package_id?: unknown; archived_at?: unknown } | null;
    return typeof row?.package_id === "string" && typeof row.archived_at === "string" ? [[row.package_id, row.archived_at] as const] : [];
  }));
}
