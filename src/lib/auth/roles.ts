import { createClient } from "@/lib/supabase/client";

export async function fetchRoles(userId: string): Promise<string[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return (data ?? []).map(({ role }) => String(role));
}

export function defaultPathForRoles(roles: string[]): string {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("vendor")) return "/vendor/dashboard";
  return "/dashboard";
}
