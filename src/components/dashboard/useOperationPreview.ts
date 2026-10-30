"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { OperationKind, OperationPreview } from "@/lib/cancellation";

/** TRACE-131: the server preview for an exception, reloaded when the choice changes or on demand. */
export function useOperationPreview(jobId: string, kind: OperationKind, waived: boolean, enabled = true) {
  const [preview, setPreview] = useState<OperationPreview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    const result = await createClient().rpc("job_cancellation_preview", { _job_id: jobId, _kind: kind, _waived: waived });
    if (result.error) {
      setPreview(null);
      setError("We couldn't load what this change would do. Try again before continuing.");
    } else {
      setPreview(result.data as unknown as OperationPreview);
    }
    setLoading(false);
  }, [jobId, kind, waived]);

  useEffect(() => {
    if (!enabled) return;
    // Load on open and whenever the choice changes; the state updates follow the request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [enabled, reload]);

  return { preview, error, loading, reload };
}
