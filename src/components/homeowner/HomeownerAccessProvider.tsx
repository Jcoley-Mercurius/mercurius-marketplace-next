"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/components/providers/AuthProvider";
import { useTrialAccess } from "@/hooks/useTrialAccess";
import { bookingState, type BookingState, type TrialAccess } from "@/lib/earlyAccessExperience";
import { createClient } from "@/lib/supabase/client";

export type HomeownerAccess =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "ready"; access: TrialAccess; booking: BookingState; hasHistory: boolean; retry: () => void };

const HomeownerAccessContext = createContext<HomeownerAccess>({ status: "loading" });

// TRACE-103: portal-wide booking state for navigation and the dashboard. A new account
// with no admission and no history gets the waiting home; history is never hidden. If
// the history check fails, history is assumed present so nothing legitimate disappears.
export function HomeownerAccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const trial = useTrialAccess();
  const [history, setHistory] = useState<{ userId: string; present: boolean } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const client = createClient();
    void Promise.all([
      client.from("service_requests").select("id").eq("customer_id", userId).limit(1),
      client.from("invoices").select("id").eq("customer_id", userId).limit(1),
    ]).then(([requests, invoices]) => {
      if (!active) return;
      const failed = Boolean(requests.error || invoices.error);
      if (failed) console.warn("Unable to check homeowner history; keeping history visible");
      setHistory({ userId, present: failed || Boolean(requests.data?.length || invoices.data?.length) });
    });
    return () => { active = false; };
  }, [userId]);

  let value: HomeownerAccess;
  if (trial.status === "error") value = { status: "error", retry: trial.retry };
  else if (trial.status !== "ready" || history?.userId !== userId) value = { status: "loading" };
  else value = { status: "ready", access: trial.access, booking: bookingState(trial.access), hasHistory: history.present, retry: trial.retry };

  return <HomeownerAccessContext.Provider value={value}>{children}</HomeownerAccessContext.Provider>;
}

export function useHomeownerAccess() {
  return useContext(HomeownerAccessContext);
}
