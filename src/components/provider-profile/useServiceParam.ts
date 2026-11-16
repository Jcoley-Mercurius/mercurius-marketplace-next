"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";

/**
 * The profile's service choice lives in the URL (?service=<id>; absent means All services).
 * Changes use history.pushState, which Next.js syncs with useSearchParams, so Back and Forward
 * restore the choice and a copied link opens the same view.
 */
export function useServiceParam(param = "service") {
  const value = useSearchParams().get(param);
  const setValue = useCallback((next: string | null) => {
    const params = new URLSearchParams(window.location.search);
    if ((params.get(param) ?? null) === next) return;
    if (next) params.set(param, next); else params.delete(param);
    const query = params.toString();
    window.history.pushState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [param]);
  return [value, setValue] as const;
}
