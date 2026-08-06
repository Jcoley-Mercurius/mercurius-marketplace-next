"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, ClipboardList, Loader2, MapPin, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type RequestRow = { id: string; service_type: string; status: string; preferred_date: string | null; address: string; city: string; state: string; contractor_id: string | null; total_amount: number | null; created_at: string };
const previewRequests: RequestRow[] = [
  { id: "preview-a1", service_type: "Pool Service", status: "pending", preferred_date: "2026-08-18", address: "SW 20th Avenue", city: "Cape Coral", state: "FL", contractor_id: null, total_amount: 135, created_at: "2026-08-05T12:00:00Z" },
  { id: "preview-b2", service_type: "Lawn Care", status: "matched", preferred_date: "2026-08-12", address: "Palm Tree Boulevard", city: "Fort Myers", state: "FL", contractor_id: "preview-vendor", total_amount: 89, created_at: "2026-08-04T12:00:00Z" },
  { id: "preview-c3", service_type: "House Cleaning", status: "completed", preferred_date: "2026-08-01", address: "Del Prado Boulevard", city: "Cape Coral", state: "FL", contractor_id: "preview-vendor-2", total_amount: 165, created_at: "2026-07-28T12:00:00Z" },
];
const statusStyle: Record<string, string> = { pending: "bg-amber-100 text-amber-800", matched: "bg-blue-100 text-blue-800", quoted: "bg-violet-100 text-violet-800", scheduled: "bg-sage-light text-sage-dark", in_progress: "bg-accent/10 text-accent", completed: "bg-green-100 text-green-800", cancelled: "bg-muted text-muted-foreground" };

export default function AdminRequestsPage() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [mode, setMode] = useState<"loading" | "live" | "preview">("loading");

  useEffect(() => {
    let active = true;
    async function loadRequests() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.from("service_requests").select("id, service_type, status, preferred_date, address, city, state, contractor_id, total_amount, created_at").order("created_at", { ascending: false });
        if (error) throw error;
        if (!active) return;
        setRequests(data ?? []);
        setMode("live");
      } catch {
        if (!active) return;
        setRequests(previewRequests);
        setMode("preview");
      }
    }
    void loadRequests();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => requests.filter((request) => {
    const query = search.toLowerCase();
    return (status === "all" || request.status === status) && (request.service_type.toLowerCase().includes(query) || request.city.toLowerCase().includes(query) || request.id.toLowerCase().includes(query));
  }), [requests, search, status]);

  if (mode === "loading") return <Loading label="Loading service requests..." />;
  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8"><Title title="Service Requests" description={`${requests.length} total requests across the platform`} preview={mode === "preview"} /><div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by service, city, or ID..." className="bg-card pl-9" /></div><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm outline-none focus:ring-2 focus:ring-ring sm:w-48"><option value="all">All statuses</option>{["pending", "matched", "quoted", "scheduled", "in_progress", "completed", "cancelled"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div><Card><CardContent className="p-0">{filtered.length === 0 ? <Empty icon={ClipboardList} title="No matching requests" /> : <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead className="border-b border-border bg-muted"><tr className="text-left text-muted-foreground"><th className="p-4 font-medium">Request</th><th className="p-4 font-medium">Location</th><th className="p-4 font-medium">Preferred Date</th><th className="p-4 font-medium">Vendor</th><th className="p-4 font-medium">Amount</th><th className="p-4 font-medium">Status</th></tr></thead><tbody className="divide-y divide-border">{filtered.map((request) => <tr key={request.id} className="hover:bg-muted/40"><td className="p-4"><p className="font-medium">{request.service_type}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{request.id.slice(0, 10)}</p></td><td className="p-4"><p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{request.city}, {request.state}</p><p className="mt-1 max-w-52 truncate text-xs text-muted-foreground">{request.address}</p></td><td className="p-4"><span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5 text-muted-foreground" />{request.preferred_date ? formatDate(request.preferred_date) : "TBD"}</span></td><td className="p-4 text-muted-foreground">{request.contractor_id ? "Assigned" : "Unassigned"}</td><td className="p-4 font-medium">{request.total_amount === null ? "Quote" : `$${Number(request.total_amount).toFixed(2)}`}</td><td className="p-4"><Badge className={cn("capitalize", statusStyle[request.status] ?? "bg-muted text-muted-foreground")}>{request.status.replaceAll("_", " ")}</Badge></td></tr>)}</tbody></table></div>}</CardContent></Card><p className="text-xs text-muted-foreground">Assignment and status-transition controls will be added after their server workflows are ported.</p></div>;
}
function Title({ title, description, preview }: { title: string; description: string; preview: boolean }) { return <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{preview && <Badge className="bg-blue-100 text-blue-800">Preview data</Badge>}</div>; }
function Loading({ label }: { label: string }) { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />{label}</div>; }
function Empty({ icon: Icon, title }: { icon: typeof ClipboardList; title: string }) { return <div className="py-16 text-center"><Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><p className="font-medium">{title}</p></div>; }
function formatDate(value: string) { const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
