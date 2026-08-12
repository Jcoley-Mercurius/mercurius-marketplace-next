"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { buttonVariants } from "@/components/ui/button";
import {
  dismissVendorPasswordNudgeForSession,
  shouldShowVendorPasswordNudge,
} from "@/lib/vendorPasswordNudge";
import { cn } from "@/lib/utils";

/** Non-blocking security reminder for vendors onboarded through an invitation. */
export function VendorPasswordNudge() {
  const { user } = useAuth();
  const [dismissedForUserId, setDismissedForUserId] = useState<string | null>(null);

  if (dismissedForUserId === user?.id || !shouldShowVendorPasswordNudge(user)) return null;

  function dismiss() {
    dismissVendorPasswordNudgeForSession();
    setDismissedForUserId(user?.id ?? null);
  }

  return (
    <aside className="mb-6 flex flex-col gap-4 rounded-xl border border-amber-300/70 bg-amber-50/80 p-4 shadow-sm dark:border-amber-800/70 dark:bg-amber-950/20 sm:flex-row sm:items-center">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-300 bg-background text-amber-700 dark:border-amber-800 dark:text-amber-300">
        <ShieldCheck className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          Set your password for secure access
        </p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          If you joined with an invitation or temporary password, choose one only
          you know. You can keep using the portal while this reminder is visible.
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/vendor/profile#password"
          className={cn(buttonVariants({ size: "sm" }), "min-h-10 flex-1 sm:flex-none")}
        >
          Set password
        </Link>
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Dismiss password reminder for this session"
          title="Not now"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
