"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { parseMyInterest, type MyInterest } from "@/lib/earlyAccessExperience";
import { createClient } from "@/lib/supabase/client";

export type MyInterestState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; value: MyInterest };

// TRACE-103: the account's own early-access interest (r0_my_interest, TRACE-102). Reading
// links unlinked interests carrying the account's confirmed email; an unconfirmed email
// reads as verified=false and links nothing.
export function useMyInterest() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<{ key: string; value: MyInterestState } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${userId}:${attempt}`;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void createClient().rpc("r0_my_interest").then(({ data, error }) => {
      if (!active) return;
      try {
        if (error) throw error;
        setState({ key, value: { status: "ready", value: parseMyInterest(data) } });
      } catch (failure) {
        console.warn("Unable to read early-access interest", failure);
        setState({ key, value: { status: "error" } });
      }
    });
    return () => { active = false; };
  }, [key, userId]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  const replace = useCallback((value: MyInterest) => setState({ key, value: { status: "ready", value } }), [key]);
  return { state: state?.key === key ? state.value : { status: "loading" as const }, reload, replace };
}
