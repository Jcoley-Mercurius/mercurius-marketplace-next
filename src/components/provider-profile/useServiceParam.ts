"use client";

import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { serviceSelectionUrl } from "@/lib/providerProfile/model";

/**
 * The profile's service choice lives in the URL (?service=<id>; absent means All services), so
 * a copied link opens the same view.
 *
 * A change of service replaces the current history entry rather than adding one: Back leaves
 * the profile instead of stepping through every service looked at. Only the service parameter
 * changes; other query parameters and the hash are kept.
 *
 * The state argument is null on purpose. Next.js patches replaceState (documented under
 * "Native History API"): given state that is not its own, it copies its router state into the
 * entry and syncs useSearchParams. Handing back window.history.state would be read as Next's
 * own call and skip that sync.
 */
export function useServiceParam(param = "service") {
  const value = useSearchParams().get(param);
  const setValue = useCallback((next: string | null) => {
    const url = serviceSelectionUrl(window.location.href, next, param);
    if (url) window.history.replaceState(null, "", url);
  }, [param]);
  return [value, setValue] as const;
}
