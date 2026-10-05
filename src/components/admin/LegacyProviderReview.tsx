"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { createClient } from "@/lib/supabase/client";
import { legacyReviewBlocker, legacyReviewOffered, type LegacyReviewStatus } from "@/lib/legacyProviderReview";

// DEC-2026-027 (TRACE-105): the eight listed legacy providers start onboarding review
// without applying. The server decides who is listed and whether the start can run;
// this panel only explains what it reads back.

export function LegacyProviderReview({
  contractorId,
  businessName,
  onStarted,
}: {
  contractorId: string;
  businessName: string;
  onStarted: () => Promise<void> | void;
}) {
  const [status, setStatus] = useState<LegacyReviewStatus | null>(null);
  const [nonce] = useState(() => crypto.randomUUID());

  const read = useCallback(async () => {
    const { data, error } = await createClient().rpc("r0_legacy_review_status", { p_contractor: contractorId });
    if (error) throw new Error(error.message);
    return data as unknown as LegacyReviewStatus;
  }, [contractorId]);

  useEffect(() => {
    let current = true;
    read()
      .then((next) => current && setStatus(next))
      .catch(() => current && setStatus(null));
    return () => {
      current = false;
    };
  }, [read]);

  if (!legacyReviewOffered(status)) return null;
  const blocker = legacyReviewBlocker(status);

  const start = async (reason: string) => {
    const { error } = await createClient().rpc("r0_start_legacy_provider_review", {
      p_contractor: contractorId,
      p_reason: reason,
      p_key: `legacy-review:${contractorId}:${nonce}`,
    });
    if (error) {
      toast.error("Legacy review could not start", { description: error.message });
      throw new Error(error.message);
    }
    const next = await read();
    setStatus(next);
    if (!next.started) {
      toast.error("The server did not confirm the start", { description: "Reload the page before retrying." });
      throw new Error("Legacy review start was not confirmed");
    }
    toast.success("Legacy review started", { description: "Record the checklist items, then activate." });
    await onStarted();
  };

  return (
    <section aria-label="Legacy provider review" className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-sm leading-6 text-muted-foreground">
        Legacy provider (DEC-2026-027): review can start without an application. An operator record is written from
        this profile and the confirmed contact. After starting, upload the license and insurance documents you hold,
        record each checklist item and activate.
      </p>
      {blocker && <p className="text-sm text-muted-foreground">{blocker}</p>}
      <ConfirmAction
        disabled={Boolean(blocker)}
        requireReason
        confirmationTone="commitment"
        triggerLabel="Start legacy review"
        title="Start onboarding review for this legacy provider?"
        entity={businessName}
        consequence="Writes an operator application record from this profile and opens review at revision 1. No email, evidence, approval, role change or public listing results."
        confirmLabel="Start review"
        onConfirm={start}
      />
    </section>
  );
}
