"use client";

import { useState } from "react";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useMyInterest } from "@/components/early-access/useMyInterest";
import { createClient } from "@/lib/supabase/client";

// TRACE-103 (R0.3): the independent marketing choice for a verified account (TRACE-102
// r0_set_my_marketing). Early-access status email is separate and follows the interest.
export function EmailPreferences() {
  const { state, reload, replace } = useMyInterest();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  async function change(optedIn: boolean) {
    if (state.status !== "ready" || !state.value.verified) return;
    setBusy(true);
    setMessage(null);
    try {
      const { data, error } = await createClient().rpc("r0_set_my_marketing", { p_opted_in: optedIn });
      if (error) throw error;
      const confirmed = (data as { marketing_opted_in?: unknown } | null)?.marketing_opted_in;
      if (typeof confirmed !== "boolean") throw new Error("Preference not confirmed");
      replace({ ...state.value, marketingOptedIn: confirmed });
      setMessage({ tone: "ok", text: confirmed ? "Saved. You’ll get Mercurius news, offers and product updates." : "Saved. You won’t get Mercurius news, offers or product updates." });
    } catch {
      setMessage({ tone: "error", text: "Your email preference wasn’t saved. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card id="email-preferences" className="scroll-mt-24 shadow-sm">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-lg"><Mail aria-hidden="true" className="size-5 text-accent" />Email preferences</CardTitle>
        <CardDescription className="mt-1">Early-access status emails follow your early-access interest. Updates are a separate choice.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        {state.status === "loading" && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-4 animate-spin" />Loading your email preferences…</p>}
        {state.status === "error" && (
          <div role="alert" className="space-y-2 text-sm">
            <p>Your email preferences couldn’t be loaded.</p>
            <Button type="button" variant="outline" size="sm" onClick={reload}><RefreshCw aria-hidden="true" />Try again</Button>
          </div>
        )}
        {state.status === "ready" && !state.value.verified && (
          <p className="text-sm">Verify your email address to choose email preferences.</p>
        )}
        {state.status === "ready" && state.value.verified && (
          <Switch label="Mercurius news, offers and product updates" checked={state.value.marketingOptedIn} disabled={busy}
            onChange={(event) => void change(event.target.checked)} />
        )}
        <p role="status" className={message ? (message.tone === "ok" ? "text-sm text-sage-dark" : "text-sm text-destructive") : "sr-only"}>{message?.text ?? ""}</p>
      </CardContent>
    </Card>
  );
}
