"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import { Status } from "@/components/ui/status";
import { canonicalRequestState } from "@/lib/lifecycle";
import { SUMMARY_QUEUES, parseOperationsSummary, type OperationsSummary, type SummaryQueue } from "@/lib/adminOperations";
import { createClient } from "@/lib/supabase/client";

// TRACE-136: the overview reads admin_operations_summary, which calls the same queue functions the
// queue pages call in one transaction, so each count here equals its queue. No threshold, SLA or
// action of its own; finance counts are shown only to finance-authority holders.

type RequestRow = { id: string; service_type: string; city: string; status: string; matching_status: string; created_at: string };

export default function AdminOverviewPage() {
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const supabase = createClient();
      const [summaryResult, requestResult] = await Promise.all([
        supabase.rpc("admin_operations_summary"),
        supabase.from("service_requests").select("id, service_type, city, status, matching_status, created_at").order("created_at", { ascending: false }).limit(5),
      ]);
      if (summaryResult.error) throw summaryResult.error;
      if (requestResult.error) throw requestResult.error;
      setSummary(parseOperationsSummary(summaryResult.data));
      setRequests((requestResult.data ?? []) as RequestRow[]);
      setMode("live");
    } catch (reason) {
      console.error("Unable to load admin overview", reason);
      setError(reason instanceof Error ? reason.message : "The admin overview could not be loaded.");
      setMode("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (mode === "loading") return <AdminLoading label="Loading operations overview..." />;
  if (mode === "error" || !summary) return <AdminError title="Admin overview could not be loaded" message={error} retry={() => { setMode("loading"); void load(); }} />;

  const queues = summary.queues.filter((queue) => SUMMARY_QUEUES[queue.queue]);
  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-bold">Operations overview</h1><p className="mt-1 text-sm text-muted-foreground">Open work in each queue{summary.checkedAt ? `, checked ${formatTime(summary.checkedAt)}` : ""}.</p></div>
        <Button variant="outline" onClick={() => void load()}><RefreshCw />Refresh</Button>
      </header>

      <Card><CardHeader><CardTitle>Queues</CardTitle></CardHeader><CardContent className="p-0">
        <ResponsiveDataList label="Operational queues" rows={queues} rowKey={(queue) => queue.queue} rowLabel={(queue) => SUMMARY_QUEUES[queue.queue].label} columns={[
          { key: "queue", label: "Queue", render: (queue) => <Link href={SUMMARY_QUEUES[queue.queue].href} className="font-medium hover:text-accent hover:underline">{SUMMARY_QUEUES[queue.queue].label}</Link> },
          { key: "count", label: "Open", render: (queue) => countText(queue) },
          { key: "aged", label: "Needs attention first", render: (queue) => agedText(queue) },
        ]} />
      </CardContent></Card>

      <Card><CardHeader><div className="flex items-center justify-between"><CardTitle>Recent requests</CardTitle><Link href="/admin/requests" className="text-xs font-medium text-accent hover:underline">All requests</Link></div></CardHeader><CardContent>
        {requests.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No service requests yet.</p>
          : <ul className="divide-y">{requests.map((request) => <li key={request.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <Link href={`/admin/requests?request=${request.id}`} className="min-w-0 hover:underline"><p className="truncate font-medium">{request.service_type}</p><p className="text-xs text-muted-foreground">{request.city} · {formatDate(request.created_at)}</p></Link>
            <Status state={canonicalRequestState(request.status as Parameters<typeof canonicalRequestState>[0], request.matching_status)} />
          </li>)}</ul>}
      </CardContent></Card>
    </div>
  );
}

function countText(queue: SummaryQueue) {
  if (queue.state === "restricted") return "Finance authority required";
  if (queue.state === "error" || queue.count === null) return "Couldn’t load — open the queue";
  return String(queue.count);
}
function agedText(queue: SummaryQueue) {
  const rule = SUMMARY_QUEUES[queue.queue].agedLabel;
  if (queue.state !== "ready" || !rule || queue.aged === null) return "—";
  return `${queue.aged} ${rule}`;
}
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: "America/New_York" }).format(date) + " Eastern"; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
