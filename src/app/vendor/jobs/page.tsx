"use client";

import { useEffect, useMemo, useState } from "react";
import { Briefcase, Calendar, CheckCircle2, Clock, Inbox, Loader2, MapPin } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Job = { id: string; service_type: string; status: string; preferred_date: string | null; preferred_time: string | null; address: string; city: string; state: string; total_amount: number | null; created_at: string };
const previewJobs: Job[] = [
  { id: "preview-request", service_type: "Pool Service", status: "matched", preferred_date: "2026-08-18", preferred_time: null, address: "SW 20th Avenue", city: "Cape Coral", state: "FL", total_amount: 135, created_at: "2026-08-05T12:00:00Z" },
  { id: "preview-active", service_type: "Lawn Care", status: "scheduled", preferred_date: "2026-08-12", preferred_time: "9:00–11:00 AM", address: "Palm Tree Boulevard", city: "Cape Coral", state: "FL", total_amount: 89, created_at: "2026-08-02T12:00:00Z" },
  { id: "preview-complete", service_type: "Pressure Washing", status: "completed", preferred_date: "2026-07-22", preferred_time: null, address: "Del Prado Boulevard", city: "Cape Coral", state: "FL", total_amount: 189, created_at: "2026-07-20T12:00:00Z" },
];
const statusStyle: Record<string, string> = { matched: "border-violet-200 bg-violet-100 text-violet-800", pending: "border-yellow-200 bg-yellow-100 text-yellow-800", scheduled: "border-blue-200 bg-blue-100 text-blue-800", in_progress: "border-accent/20 bg-accent/10 text-accent", pending_review: "border-amber-200 bg-amber-100 text-amber-800", vendor_completed: "border-amber-200 bg-amber-100 text-amber-800", completed: "border-border bg-muted text-muted-foreground" };

export default function VendorJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "preview" | "unlinked">("loading");
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    let active = true;
    async function loadJobs() {
      try {
        const supabase = createClient();
        const { data: contractor, error: contractorError } = await supabase.from("contractors").select("id").eq("user_id", user!.id).maybeSingle();
        if (contractorError) throw contractorError;
        if (!active) return;
        if (!contractor) { setMode("unlinked"); return; }
        const { data, error } = await supabase.from("service_requests").select("id, service_type, status, preferred_date, preferred_time, address, city, state, total_amount, created_at").eq("contractor_id", contractor.id).order("created_at", { ascending: false });
        if (error) throw error;
        if (!active) return;
        setJobs(data ?? []);
        setMode("live");
      } catch {
        if (!active) return;
        setJobs(previewJobs);
        setMode("preview");
      }
    }
    void loadJobs();
    return () => { active = false; };
  }, [user]);

  const queues = useMemo(() => ({
    requests: jobs.filter((job) => ["matched", "pending", "quoted"].includes(job.status)),
    active: jobs.filter((job) => ["scheduled", "in_progress", "pending_review", "vendor_completed", "homeowner_confirmed", "review_requested"].includes(job.status)),
    completed: jobs.filter((job) => ["completed", "closed", "reviewed"].includes(job.status)),
  }), [jobs]);

  if (mode === "loading") return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />Loading jobs...</div>;

  return <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 md:p-8"><div className="mb-8 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">Jobs &amp; Requests</h1><p className="mt-1 text-sm text-muted-foreground">Review new opportunities and track work from scheduling through completion.</p></div>{mode === "preview" && <Badge className="bg-blue-100 text-blue-800">Preview data</Badge>}</div>{mode === "unlinked" ? <EmptyQueue icon={Briefcase} title="No contractor profile linked" description="Jobs will become available after onboarding links your vendor profile." /> : <Tabs defaultValue="requests"><div className="mb-6 overflow-x-auto"><TabsList className="h-auto min-w-max p-1"><TabsTrigger value="requests" className="px-3 py-1.5">Requests ({queues.requests.length})</TabsTrigger><TabsTrigger value="active" className="px-3 py-1.5">Active ({queues.active.length})</TabsTrigger><TabsTrigger value="completed" className="px-3 py-1.5">Completed ({queues.completed.length})</TabsTrigger></TabsList></div><JobQueue value="requests" jobs={queues.requests} icon={Inbox} emptyTitle="No incoming requests" emptyDescription="New homeowner matches will appear here." /><JobQueue value="active" jobs={queues.active} icon={Briefcase} emptyTitle="No active jobs" emptyDescription="Accepted requests will move here." /><JobQueue value="completed" jobs={queues.completed} icon={CheckCircle2} emptyTitle="No completed jobs yet" emptyDescription="Your completed work history will appear here." /></Tabs>}</div>;
}

function JobQueue({ value, jobs, icon, emptyTitle, emptyDescription }: { value: string; jobs: Job[]; icon: typeof Inbox; emptyTitle: string; emptyDescription: string }) {
  return <TabsContent value={value}>{jobs.length === 0 ? <EmptyQueue icon={icon} title={emptyTitle} description={emptyDescription} /> : <div className="space-y-4">{jobs.map((job) => <JobCard key={job.id} job={job} />)}</div>}</TabsContent>;
}
function JobCard({ job }: { job: Job }) {
  return <Card className="transition-shadow hover:shadow-md"><CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="mb-3 flex flex-wrap items-center gap-3"><p className="font-semibold">{job.service_type}</p><Badge className={cn("border capitalize", statusStyle[job.status] ?? "border-border bg-muted text-muted-foreground")}>{job.status.replaceAll("_", " ")}</Badge></div><div className="space-y-1.5 text-sm text-muted-foreground"><p className="flex items-center gap-2"><MapPin className="h-4 w-4" />{job.address}, {job.city}, {job.state}</p><p className="flex items-center gap-2"><Calendar className="h-4 w-4" />{job.preferred_date ? formatDate(job.preferred_date) : "Date to be confirmed"}{job.preferred_time ? ` · ${job.preferred_time}` : ""}</p></div></div><div className="flex items-center justify-between gap-5 border-t border-border pt-4 sm:block sm:border-0 sm:pt-0 sm:text-right">{job.total_amount !== null && <p className="text-lg font-semibold">${Number(job.total_amount).toFixed(2)}</p>}<p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" />Updated {formatDate(job.created_at)}</p></div></CardContent></Card>;
}
function EmptyQueue({ icon: Icon, title, description }: { icon: typeof Inbox; title: string; description: string }) { return <Card><CardContent className="py-16 text-center"><Icon className="mx-auto mb-4 h-11 w-11 text-muted-foreground" /><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{description}</p></CardContent></Card>; }
function formatDate(value: string) { const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
