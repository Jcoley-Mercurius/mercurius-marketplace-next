"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Briefcase, CheckCircle2, Circle, Gauge, Inbox, Loader2, Star, User } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Contractor = { id: string; name: string; rating: number | null; jobs_completed: number | null; is_active: boolean | null; bio: string | null; location: string | null; services: string[] | null };
type Mode = "loading" | "live" | "preview" | "unlinked";

export default function VendorOverviewPage() {
  const { user } = useAuth();
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [requestCount, setRequestCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [mode, setMode] = useState<Mode>("loading");

  useEffect(() => {
    if (!user) return;
    let active = true;
    async function loadOverview() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.from("contractors").select("id, name, rating, jobs_completed, is_active, bio, location, services").eq("user_id", user!.id).maybeSingle();
        if (error) throw error;
        if (!active) return;
        if (!data) { setMode("unlinked"); return; }
        const { data: jobs, error: jobsError } = await supabase.from("service_requests").select("id, status").eq("contractor_id", data.id);
        if (jobsError) throw jobsError;
        if (!active) return;
        setContractor(data);
        setRequestCount((jobs ?? []).filter((job) => ["matched", "pending"].includes(job.status)).length);
        setActiveCount((jobs ?? []).filter((job) => ["scheduled", "in_progress", "pending_review", "vendor_completed"].includes(job.status)).length);
        setMode("live");
      } catch {
        if (!active) return;
        setContractor({ id: "preview", name: "Your Service Business", rating: 5, jobs_completed: 0, is_active: true, bio: null, location: "Cape Coral, FL", services: ["Home Services"] });
        setRequestCount(2);
        setActiveCount(1);
        setMode("preview");
      }
    }
    void loadOverview();
    return () => { active = false; };
  }, [user]);

  const setupItems = useMemo(() => {
    if (!contractor) return [];
    const profileComplete = Boolean(contractor.name.trim() && contractor.location?.trim() && contractor.bio?.trim() && contractor.services?.length);
    return [
      { label: "Complete your public profile", done: profileComplete, href: "/vendor/profile" },
      { label: "Review incoming requests", done: requestCount === 0, href: "/vendor/jobs" },
      { label: "Keep your availability current", done: false, href: "/vendor/profile" },
    ];
  }, [contractor, requestCount]);

  if (mode === "loading") return <PageLoading />;
  if (mode === "unlinked") return <UnlinkedState />;
  if (!contractor) return null;

  const completed = setupItems.filter((item) => item.done).length;
  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 md:p-8">
      <PageHeader title={contractor.name} description="Manage requests, active work, and the profile customers see." mode={mode} />

      <Card className="mb-8 border-accent/35 bg-accent/5 ring-accent/20">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Get ready for customers</CardTitle><CardDescription className="mt-1">Complete the essentials that keep your business bookable.</CardDescription></div><Badge variant="secondary" className="w-fit">{completed} of {setupItems.length} complete</Badge></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full border border-border/40 bg-background"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((completed / setupItems.length) * 100)}%` }} /></div>
        </CardHeader>
        <CardContent className="space-y-3">{setupItems.map((item) => <Link key={item.label} href={item.href} className="flex items-center gap-3 rounded-lg border border-border bg-background p-4 transition-colors hover:border-accent/40"><span className="shrink-0">{item.done ? <CheckCircle2 className="h-5 w-5 text-accent" /> : <Circle className="h-5 w-5 text-muted-foreground" />}</span><span className="flex-1 text-sm font-medium">{item.label}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /></Link>)}</CardContent>
      </Card>

      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Performance</h2>
      <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard icon={Inbox} label="New Requests" value={String(requestCount)} note={requestCount ? "Awaiting your response" : "No open requests"} highlight={requestCount > 0} />
        <MetricCard icon={Briefcase} label="Active Jobs" value={String(activeCount)} note="Currently in progress" />
        <MetricCard icon={CheckCircle2} label="Jobs Completed" value={String(contractor.jobs_completed ?? 0)} note="Verified completed work" />
        <MetricCard icon={Star} label="Average Rating" value={contractor.rating ? contractor.rating.toFixed(1) : "—"} note="From verified homeowners" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="flex items-center gap-2"><Gauge className="h-5 w-5 text-accent" />Business status</CardTitle></CardHeader><CardContent><div className="flex items-center justify-between rounded-xl bg-muted p-4"><div><p className="font-medium">Marketplace visibility</p><p className="text-sm text-muted-foreground">{contractor.is_active === false ? "Your profile is currently hidden." : "Your profile is eligible to appear to homeowners."}</p></div><Badge className={contractor.is_active === false ? "bg-muted text-muted-foreground" : "bg-sage-light text-sage-dark"}>{contractor.is_active === false ? "Inactive" : "Active"}</Badge></div></CardContent></Card>
        <Card><CardHeader><CardTitle>Quick actions</CardTitle><CardDescription>Keep your work and listing moving.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><Link href="/vendor/jobs" className={cn(buttonVariants({ variant: "outline" }), "h-11")}><Briefcase className="h-4 w-4" />View jobs</Link><Link href="/vendor/profile" className={cn(buttonVariants({ variant: "outline" }), "h-11")}><User className="h-4 w-4" />Edit profile</Link></CardContent></Card>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, note, highlight = false }: { icon: typeof Inbox; label: string; value: string; note: string; highlight?: boolean }) {
  return <Card className={highlight ? "border-accent/40 bg-accent/5 ring-accent/20" : ""}><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" />{label}</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></CardContent></Card>;
}

function PageHeader({ title, description, mode }: { title: string; description: string; mode: Mode }) {
  return <div className="mb-7 flex items-start justify-between gap-4"><div><h1 className="text-2xl font-semibold">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{mode === "preview" && <Badge className="bg-blue-100 text-blue-800">Preview data</Badge>}</div>;
}

function PageLoading() { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">Loading your business...</span></div>; }
function UnlinkedState() { return <div className="mx-auto max-w-lg px-6 py-20 text-center"><User className="mx-auto mb-4 h-12 w-12 text-muted-foreground" /><h1 className="text-xl font-semibold">No vendor profile linked</h1><p className="mt-2 text-sm text-muted-foreground">Your account has vendor access, but its contractor profile is still being prepared.</p><Link href="/vendors/apply" className={cn(buttonVariants({ variant: "outline" }), "mt-6")}>Contact onboarding</Link></div>; }
