"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import {
  formatRenewalDate,
  kindLabel,
  renewalTiming,
  type RenewalState,
} from "@/lib/evidenceRenewal";
import { cn } from "@/lib/utils";

// TRACE-072: tells a vendor which of its own compliance evidence expires within the
// notice window or has lapsed. The server returns only the item, expiry and state.
// The notice is advisory; operators work the authoritative queue. If it cannot load,
// nothing is shown rather than an unrelated error on every vendor page.

type Notice = {
  evaluated_at: string;
  notice_days: number;
  items: { kind: string; expires_at: string; state: RenewalState }[];
};

export function VendorEvidenceRenewalNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await createClient().rpc("vendor_own_evidence_renewal");
      if (active && !error && data) setNotice(data as unknown as Notice);
    })();
    return () => { active = false; };
  }, []);

  if (!notice || notice.items.length === 0) return null;
  const lapsed = notice.items.some((item) => item.state === "lapsed");

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6 md:px-8">
      <section
        aria-labelledby="evidence-renewal-title"
        className={cn(
          "rounded-xl border px-4 py-3.5 text-sm",
          lapsed ? "border-status-danger bg-status-danger-bg" : "border-status-warning bg-status-warning-bg",
        )}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <CalendarClock aria-hidden="true" className={cn("mt-0.5 h-5 w-5 shrink-0", lapsed ? "text-status-danger" : "text-status-warning")} />
            <div className="min-w-0 space-y-1.5">
              <h2 id="evidence-renewal-title" className="font-medium text-foreground">
                {lapsed ? "Compliance documents have lapsed" : "Compliance documents need renewal"}
              </h2>
              <ul className="space-y-0.5 text-foreground">
                {notice.items.map((item) => (
                  <li key={`${item.kind}:${item.expires_at}`} className="break-words">
                    <span className="font-medium">{kindLabel(item.kind)}</span>
                    {" · "}
                    {renewalTiming(item.state, item.expires_at, notice.evaluated_at)} ({formatRenewalDate(item.expires_at)})
                  </li>
                ))}
              </ul>
              <p className="text-xs leading-5 text-foreground">
                {lapsed
                  ? "While required evidence has lapsed, Mercurius cannot send you new job requests and payouts wait until it is renewed. Send your renewed documents to Mercurius."
                  : "Send your renewed documents to Mercurius before they expire. Once evidence lapses, new job requests stop and payouts wait until it is renewed."}
              </p>
            </div>
          </div>
          <Link href="/contact" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 w-full shrink-0 bg-background sm:w-auto")}>
            Contact Mercurius
          </Link>
        </div>
      </section>
    </div>
  );
}
