"use client";

// Phase 7.5G-2 (TRACE-159): the read-only sourcing list. It calls only public.admin_sourcing_queue(),
// once on open and once per Refresh press, so its items are the overview's sourcing count for the
// same database state. No other read, no business write, no settling of expired offers, no
// matching, no per-row link and no control other than Refresh (plan §8.3, SG-7, SG-9). It has no
// sidebar entry; the overview row links here. The admin layout's has_role('admin') check runs
// first, and the reader checks admin again on every call.

import { RefreshCw } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { PageState } from "@/components/ui/page-state";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import { useSourcingQueue } from "@/hooks/useSourcingQueue";
import {
  EMPTY_TEXT, KIND_LABEL, ORDER_TEXT, READ_ONLY_TEXT, RELATED_EVENT_HEADING, SOURCING_DESCRIPTION, SOURCING_NAME,
  type SourcingItem, formatEasternTime, itemNotes, relatedEventText,
} from "@/lib/sourcingQueue";

// Page state belongs to one account: another account or a sign-out gets a fresh page, and the
// controller discards the previous account's answers.
export default function AdminSourcingPage() {
  const { user } = useAuth();
  return <SourcingQueuePage key={user?.id ?? "signed-out"} />;
}

function SourcingQueuePage() {
  const { state, controller } = useSourcingQueue();
  const { status, data, message } = state;
  const loading = status === "loading";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <PageHeader
        eyebrow="Operations"
        title={SOURCING_NAME}
        description={SOURCING_DESCRIPTION}
        metadata={data && status === "ready" ? <p className="text-sm text-muted-foreground">Checked {formatEasternTime(data.checkedAt)}.</p> : null}
        actions={<Button variant="outline" onClick={() => void controller.refresh()} disabled={loading || status === "denied"} loading={loading}>
          {!loading && <RefreshCw aria-hidden="true" className="h-4 w-4" />}Refresh
        </Button>}
      />

      {status === "denied" && <PageState kind="permission" title="Admin access required" description={message ?? undefined} />}
      {status === "error" && <PageState kind="error" title="The sourcing queue couldn’t be loaded" description={message ?? undefined} />}
      {loading && !data && <PageState kind="loading" title="Loading the sourcing queue…" />}

      {data && status !== "denied" && status !== "error" && (
        data.items.length === 0
          ? <PageState kind="empty" title={EMPTY_TEXT} description={READ_ONLY_TEXT} />
          : <section aria-labelledby="sourcing-items" className="space-y-3">
            <div>
              <h2 id="sourcing-items" className="text-lg font-semibold">{data.items.length === 1 ? "1 request" : `${data.items.length} requests`}</h2>
              <p className="text-sm text-muted-foreground">{ORDER_TEXT}</p>
              <p className="text-sm text-muted-foreground">{READ_ONLY_TEXT}</p>
            </div>
            <Card><CardContent className="p-0">
              <ResponsiveDataList<SourcingItem>
                label="Sourcing requests"
                rows={data.items}
                rowKey={(item) => item.requestId}
                rowLabel={(item) => `Request ${item.requestId}`}
                columns={[
                  { key: "request", label: "Request", render: (item) => <span className="font-mono text-xs break-all">{item.requestId}</span> },
                  { key: "kind", label: "Kind", render: (item) => KIND_LABEL[item.kind] },
                  { key: "event", label: RELATED_EVENT_HEADING, render: (item) => relatedEventText(item) },
                  { key: "notes", label: "Notes", render: (item) => {
                    const notes = itemNotes(item);
                    return notes.length === 0 ? "—" : <ul className="space-y-1">{notes.map((note) => <li key={note}>{note}</li>)}</ul>;
                  } },
                ]}
              />
            </CardContent></Card>
          </section>
      )}
    </div>
  );
}
