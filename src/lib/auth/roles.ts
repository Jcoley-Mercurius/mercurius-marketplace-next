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

  return [...new Set((data ?? []).map(({ role }) => String(role)))];
}

export function defaultPathForRoles(roles: string[]): string {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("vendor")) return "/vendor";
  return "/dashboard";
}

function isWithin(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(root + "/");
}

/**
 * Returns a safe, role-appropriate local redirect, or null when the requested
 * destination should be replaced by the user's highest-priority portal.
 */
export function safeRedirectForRoles(
  requestedDestination: string | null | undefined,
  roles: string[],
): string | null {
  if (
    !requestedDestination ||
    requestedDestination.trim() !== requestedDestination ||
    !requestedDestination.startsWith("/") ||
    requestedDestination.startsWith("//") ||
    requestedDestination.includes("\\")
  ) {
    return null;
  }

  let destination: URL;
  try {
    destination = new URL(requestedDestination, "https://mercurius.local");
  } catch {
    return null;
  }

  if (destination.origin !== "https://mercurius.local") return null;

  const { pathname } = destination;
  const isAuthEntry =
    isWithin(pathname, "/login") ||
    isWithin(pathname, "/register") ||
    isWithin(pathname, "/forgot-password") ||
    isWithin(pathname, "/set-password");

  if (isAuthEntry) return null;
  if (isWithin(pathname, "/admin") && !roles.includes("admin")) return null;
  if (isWithin(pathname, "/vendor") && !roles.includes("vendor")) return null;
  if (isWithin(pathname, "/dashboard") && !roles.includes("homeowner")) return null;
  if (isWithin(pathname, "/account") && !roles.includes("homeowner")) return null;
  if (isWithin(pathname, "/messages") && !roles.includes("homeowner")) return null;
  if (isWithin(pathname, "/notifications") && !roles.includes("homeowner")) return null;

  return destination.pathname + destination.search + destination.hash;
}

export function postLoginPathForRoles(
  roles: string[],
  requestedDestination?: string | null,
): string {
  return (
    safeRedirectForRoles(requestedDestination, roles) ??
    defaultPathForRoles(roles)
  );
}
