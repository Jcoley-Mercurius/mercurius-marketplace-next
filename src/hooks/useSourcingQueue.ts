"use client";

// Phase 7.5G-2 (TRACE-159): binds SourcingQueueController to the signed-in account. The behavior,
// including discarding every answer that arrives after an account change or sign-out, lives in the
// controller.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { createClient } from "@/lib/supabase/client";
import { SourcingQueueController, initialSourcingState } from "@/lib/sourcingQueueController";

export function useSourcingQueue() {
  const { user } = useAuth();
  const owner = user?.id ?? null;
  const [controller] = useState(() => new SourcingQueueController(createClient()));

  // A new account, sign-out or unmounting resets the state and discards in-flight answers.
  useEffect(() => {
    controller.setOwner(owner);
    return () => controller.setOwner(null);
  }, [controller, owner]);

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  // Until the effect has switched the controller, its state belongs to the previous account.
  const blank = useMemo(() => initialSourcingState(owner), [owner]);
  const state = snapshot.owner === owner ? snapshot : blank;
  return { state, controller };
}
