"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, ClipboardList, FileText, Loader2, UserCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type RequestRow = { id: string; service_type: string; city: string; status: string; created_at: string };
type Stats = { totalRequests: number; pendingRequests: number; activeRequests: number; completedRequests: number; homeowners: number; vendors: number; activeVendors: number; pendingApplications: number };
const initialStats: Stats = { totalRequests: 0, pendingRequests: 0, activeRequests: 0, completedRequests: 0, homeowners: 0, vendors: 0, activeVendors: 0, pendingApplications: 0 };
const statusStyle: Record<string, string> = { pending: "bg-amber-100 text-amber-800", matched: "bg-blue-100 text-blue-800", scheduled: "bg-sage-light text-sage-dark", in_progress: "bg-accent/10 text-accent", completed: "bg-green-100 text-green-800", cancelled: "bg-muted text-muted-foreground" };

export default function AdminOverviewPage() {
  const [stats, setStats] = useState(initialStats);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "preview">("loading");

  useEffect(() => {
    let active = true;
    async function loadOverview() {
      try {
        const supabase = createClient();
        const [requestResult, profileResult, vendorResult, applicationResult] = await Promise.all([
          supabase.from("service_requests").select("id, service_type, city, status, created_at").order("created_at", { ascending: false }),
          supabase.from("profiles").select("id"),
          supabase.from("contractors").select("id, is_active"),
          supabase.from("vendor_applications").select("id, status"),
        ]);
        const error = requestResult.error ?? profileResult.error ?? vendorResult.error ?? applicationResult.error;
        if (error) throw error;
        if (!active) return;
        const allRequests = requestResult.data ?? [];
        const vendors = vendorResult.data ?? [];
        const applications = applicationResult.data ?? [];
        setStats({
          totalRequests: allRequests.length,
          pendingRequests: allRequests.filter((item) => item.status === "pending").length,
          activeRequests: allRequests.filter((item) => ["matched", "scheduled", "in_progress", "pending_review"].includes(item.status)).length,
          completedRequests: allRequests.filter((item) => item.status === "completed").length,
          homeowners: profileResult.data?.length ?? 0,
          vendors: vendors.length,
          activeVendors: vendors.filter((item) => item.is_active).length,
          pendingApplications: applications.filter((item) => item.status === "pending").length,
        });
        setRequests(allRequests.slice(0, 5));
        setMode("live");
      } catch {
        if (!active) return;
        setStats({ totalRequests: 24, pendingRequests: 4, activeRequests: 7, completedRequests: 13, homeowners: 18, vendors: 9, activeVendors: 7, pendingApplications: 3 });
        setRequests([
          { id: "preview-1", service_type: "Pool Service", city: "Cape Coral", status: "pending", created_at: "2026-08-05T12:00:00Z" },
          { id: "preview-2", service_type: "Lawn Care", city: "Fort Myers", status: "scheduled", created_at: "2026-08-04T12:00:00Z" },
          { id: "preview-3", service_type: "House Cleaning", city: "Cape Coral", status: "completed", created_at: "2026-08-03T12:00:00Z" },
        ]);
        setMode("preview");
      }
    }
    void loadOverview();
    return () => { active = false; };
  }, []);

  if (mode === "loading") return <LoadingState label="Loading platform overview..." />;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-7 p-4 sm:p-6 md:p-8">
      <PageTitle title="Dashboard" description="Platform operations at a glance" preview={mode === "preview"} />

      {(stats.pendingApplications > 0 || stats.pendingRequests > 0) && <div className="space-y-3">{stats.pendingApplications > 0 && <Alert href="/admin/applications" icon={FileText} text={`${stats.pendingApplications} vendor application${stats.pendingApplications === 1 ? "" : "s"} awaiting review`} action="Review applications" />}{stats.pendingRequests > 0 && <Alert href="/admin/requests" icon={AlertTriangle} text={`${stats.pendingRequests} unassigned service request${stats.pendingRequests === 1 ? "" : "s"} need attention`} action="View requests" />}</div>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric icon={ClipboardList} label="Total Requests" value={stats.totalRequests} />
        <Metric icon={AlertTriangle} label="Pending" value={stats.pendingRequests} tone="amber" />
        <Metric icon={CheckCircle2} label="Active Jobs" value={stats.activeRequests} tone="accent" />
        <Metric icon={UserCheck} label="Active Vendors" value={stats.activeVendors} tone="accent" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card><CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader><CardContent className="space-y-2"><QuickLink href="/admin/applications" icon={FileText} label="Vendor Applications" value={stats.pendingApplications} /><QuickLink href="/admin/requests" icon={ClipboardList} label="Service Requests" value={stats.totalRequests} /><QuickLink href="/admin/vendors" icon={UserCheck} label="Vendor Directory" value={stats.vendors} /><QuickLink href="/dashboard" icon={Users} label="Homeowner Portal" value={stats.homeowners} /></CardContent></Card>
        <Card className="lg:col-span-2"><CardHeader><div className="flex items-center justify-between"><CardTitle>Recent Requests</CardTitle><Link href="/admin/requests" className="text-xs font-medium text-accent hover:underline">View all →</Link></div></CardHeader><CardContent>{requests.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No service requests yet.</p> : <div className="divide-y divide-border">{requests.map((request) => <div key={request.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"><div className="min-w-0"><p className="truncate text-sm font-medium">{request.service_type}</p><p className="text-xs text-muted-foreground">{request.city} · {formatDate(request.created_at)}</p></div><Badge className={cn("capitalize", statusStyle[request.status] ?? "bg-muted text-muted-foreground")}>{request.status.replaceAll("_", " ")}</Badge></div>)}</div>}</CardContent></Card>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone = "default" }: { icon: typeof ClipboardList; label: string; value: number; tone?: "default" | "amber" | "accent" }) { return <Card className={cn(tone === "amber" && "border-amber-200 bg-amber-50", tone === "accent" && "border-accent/25 bg-accent/5")}><CardContent><Icon className={cn("mb-4 h-5 w-5 text-muted-foreground", tone === "amber" && "text-amber-700", tone === "accent" && "text-accent")} /><p className="text-3xl font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></CardContent></Card>; }
function Alert({ href, icon: Icon, text, action }: { href: string; icon: typeof FileText; text: string; action: string }) { return <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center"><Icon className="h-5 w-5 shrink-0 text-amber-700" /><p className="flex-1 text-sm font-medium text-amber-900">{text}</p><Link href={href} className="flex items-center gap-1 text-sm font-medium text-amber-800 hover:underline">{action}<ArrowUpRight className="h-3.5 w-3.5" /></Link></div>; }
function QuickLink({ href, icon: Icon, label, value }: { href: string; icon: typeof FileText; label: string; value: number }) { return <Link href={href} className="flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-muted"><Icon className="h-4 w-4 text-muted-foreground" /><span className="flex-1 text-sm">{label}</span><span className="text-xs text-muted-foreground">{value}</span><ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" /></Link>; }
function PageTitle({ title, description, preview }: { title: string; description: string; preview: boolean }) { return <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{preview && <Badge className="bg-blue-100 text-blue-800">Preview data</Badge>}</div>; }
function LoadingState({ label }: { label: string }) { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">{label}</span></div>; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
