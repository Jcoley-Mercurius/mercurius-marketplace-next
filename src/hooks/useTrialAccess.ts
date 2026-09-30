"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { parseTrialAccess, type TrialAccess } from "@/lib/earlyAccessExperience";
import { createClient } from "@/lib/supabase/client";

export type TrialAccessResult =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "error" }
  | { status: "ready"; access: TrialAccess };

// TRACE-103: the signed-in account's own R0 admission (r0_my_trial_access). Presentation
// only; request and checkout commands enforce admission. Errors are never read as access.
export function useTrialAccess(): TrialAccessResult & { retry: () => void } {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const [result, setResult] = useState<{ userId: string; value: TrialAccessResult } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void createClient().rpc("r0_my_trial_access").then(({ data, error }) => {
      if (!active) return;
      try {
        if (error) throw error;
        setResult({ userId, value: { status: "ready", access: parseTrialAccess(data) } });
      } catch (failure) {
        console.warn("Unable to read booking access", failure);
        setResult({ userId, value: { status: "error" } });
      }
    });
    return () => { active = false; };
  }, [userId, attempt]);

  const retry = useCallback(() => {
    setResult(null);
    setAttempt((value) => value + 1);
  }, []);

  if (loading) return { status: "loading", retry };
  if (!userId) return { status: "signed_out", retry };
  if (result?.userId !== userId) return { status: "loading", retry };
  return { ...result.value, retry };
}
