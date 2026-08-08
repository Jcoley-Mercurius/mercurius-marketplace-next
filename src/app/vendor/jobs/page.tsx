/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle, Briefcase, Calendar, Camera, CheckCircle2, Clock, DollarSign,
  FileText, Inbox, Loader2, MapPin, MessageSquare, RefreshCw, User, X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Job = {
  id: string;
  customer_id: string;
  service_type: string;
  description: string | null;
  status: string;
  pricing_mode: string | null;
  quote_only: boolean | null;
  payment_status: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  address: string;
  city: string;
  state: string;
  zip_code: string | null;
  quote_amount: number | null;
  total_amount: number | null;
  created_at: string;
  updated_at: string;
  assigned_at: string | null;
  match_expires_at: string | null;
  homeowner_name?: string | null;
};

type Mode = "loading" | "live" | "unlinked" | "error";
type Action = { id: string; kind: string } | null;

const incoming = new Set(["matched", "pending"]);
const finished = new Set(["completed", "closed", "reviewed", "resolved", "homeowner_confirmed", "cancelled"]);
const statusConfig: Record<string, [string, string]> = {
  matched: ["New request", "border-blue-200 bg-blue-50 text-blue-700"],
  pending: ["Preparing match", "border-blue-200 bg-blue-50 text-blue-700"],
  quoted: ["Quote pending", "border-violet-200 bg-violet-50 text-violet-700"],
  scheduled: ["Scheduled", "border-blue-200 bg-blue-50 text-blue-700"],
  in_progress: ["In Progress", "border-accent/20 bg-accent/10 text-accent"],
  pending_review: ["Pending Confirmation", "border-amber-200 bg-amber-50 text-amber-700"],
  vendor_completed: ["Awaiting Homeowner", "border-amber-200 bg-amber-50 text-amber-700"],
  homeowner_confirmed: ["Confirmed", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  disputed: ["Issue Reported", "border-red-200 bg-red-50 text-red-700"],
  resolved: ["Resolved", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  review_requested: ["Review Requested", "border-violet-200 bg-violet-50 text-violet-700"],
  reviewed: ["Reviewed", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  closed: ["Closed", "border-border bg-muted text-muted-foreground"],
  completed: ["Completed", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  cancelled: ["Cancelled", "border-border bg-muted text-muted-foreground"],
};

export default function VendorJobsPage() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [action, setAction] = useState<Action>(null);
  const [selected, setSelected] = useState<Job | null>(null);
  const [declining, setDeclining] = useState<Job | null>(null);
  const [completing, setCompleting] = useState<Job | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    // The response-window clock begins only after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setMode("loading");
    setError("");
    try {
      const supabase = createClient();
      const contractorResult = await supabase.from("contractors").select("id").eq("user_id", user.id).maybeSingle();
      if (contractorResult.error) throw contractorResult.error;
      if (!contractorResult.data) {
        setJobs([]);
        setMode("unlinked");
        return;
      }
      const result = await supabase
        .from("service_requests")
        .select("id, customer_id, service_type, description, status, pricing_mode, quote_only, payment_status, preferred_date, preferred_time, address, city, state, zip_code, quote_amount, total_amount, created_at, updated_at, assigned_at, match_expires_at")
        .eq("contractor_id", contractorResult.data.id)
        .order("created_at", { ascending: false });
      if (result.error) throw result.error;

      const liveJobs = (result.data ?? []) as Job[];
      const customerIds = [...new Set(liveJobs.map((job) => job.customer_id).filter(Boolean))];
      const names = new Map<string, string>();
      if (customerIds.length) {
        const profiles = await supabase.from("profiles").select("user_id, full_name").in("user_id", customerIds);
        for (const profile of profiles.data ?? []) {
          if (profile.full_name) names.set(profile.user_id, profile.full_name);
        }
      }
      setJobs(liveJobs.map((job) => ({ ...job, homeowner_name: names.get(job.customer_id) ?? null })));
      setMode("live");
    } catch (reason) {
      console.error("Unable to load vendor jobs", reason);
      setJobs([]);
      setError(reason instanceof Error ? reason.message : "The jobs queue could not be loaded.");
      setMode("error");
    }
  }, [user]);

  useEffect(() => {
    // Loading is intentionally tied to the authenticated vendor identity.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const queues = useMemo(() => ({
    requests: jobs.filter((job) => incoming.has(job.status)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    active: jobs.filter((job) => !incoming.has(job.status) && !finished.has(job.status)).sort(sortBySchedule),
    completed: jobs.filter((job) => finished.has(job.status)).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
  }), [jobs]);

  async function update(job: Job, kind: "accept" | "decline" | "start") {
    setAction({ id: job.id, kind });
    const supabase = createClient();
    try {
      if (kind === "accept") {
        const result = await supabase.rpc("vendor_accept_job", { _job_id: job.id });
        if (result.error) throw result.error;
        replaceStatus(job.id, "scheduled");
        toast.success("Request accepted", { description: "The assignment is confirmed and now appears in Active Jobs. Use Messages to coordinate details before starting work." });
      } else if (kind === "decline") {
        const result = await supabase.rpc("vendor_decline_job", { _job_id: job.id, _reason: "Vendor declined" });
        if (result.error) throw result.error;
        setJobs((current) => current.filter((item) => item.id !== job.id));
        setDeclining(null);
        toast.success("Request declined", { description: "We will match the homeowner with another pro." });
      } else {
        const result = await supabase.rpc("transition_job_status", { _job_id: job.id, _to_status: "in_progress" });
        if (result.error) throw result.error;
        replaceStatus(job.id, "in_progress");
        toast.success("Job started");
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Please try again.";
      const expired = message.toLowerCase().includes("expired");
      toast.error(kind === "accept" && expired ? "Response window closed" : "Unable to update this job", {
        description: expired ? "This request returned to matching and is no longer available." : message,
      });
      if (expired) void load();
    } finally {
      setAction(null);
    }
  }

  function replaceStatus(id: string, status: string) {
    setJobs((current) => current.map((job) => job.id === id
      ? { ...job, status, updated_at: new Date().toISOString() }
      : job,
    ));
  }

  if (mode === "loading") return <Loading />;
  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 md:p-8">
      <header className="mb-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Work management</p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Jobs &amp; Requests</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Respond to new homeowner requests and manage every job from scheduling through completion.</p>
      </header>

      {mode === "unlinked" ? (
        <Empty icon={Briefcase} title="No contractor profile linked" copy="Your jobs will appear here once Mercurius links your approved vendor profile." />
      ) : mode === "error" ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : (
        <Tabs defaultValue="requests">
          <div className="mb-6 overflow-x-auto border-b border-border">
            <TabsList variant="line" className="h-11 min-w-max gap-5 p-0">
              <TabsTrigger value="requests" className="px-1">Requests <Count n={queues.requests.length} /></TabsTrigger>
              <TabsTrigger value="active" className="px-1">Active Jobs <Count n={queues.active.length} /></TabsTrigger>
              <TabsTrigger value="completed" className="px-1">Completed <Count n={queues.completed.length} /></TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="requests">
            <Heading title="Incoming Requests" copy="Accept before the response window closes, or decline so we can promptly rematch the homeowner." />
            {queues.requests.length ? <div className="space-y-4">{queues.requests.map((job) => (
              <RequestCard key={job.id} job={job} now={now} action={action} view={() => setSelected(job)} accept={() => void update(job, "accept")} decline={() => setDeclining(job)} />
            ))}</div> : <Empty icon={Inbox} title="No incoming requests" copy="New service matches will appear here when assigned to your business." />}
          </TabsContent>
          <TabsContent value="active">
            <Heading title="Active Jobs" copy="Upcoming and in-progress work, including jobs awaiting homeowner confirmation." />
            {queues.active.length ? <div className="space-y-4">{queues.active.map((job) => (
              <JobCard key={job.id} job={job} busy={action?.id === job.id} view={() => setSelected(job)} start={() => void update(job, "start")} complete={() => setCompleting(job)} />
            ))}</div> : <Empty icon={Briefcase} title="No active jobs" copy="Accepted requests will move into this queue." />}
          </TabsContent>
          <TabsContent value="completed">
            <Heading title="Completed Jobs" copy="Your completed and closed Mercurius work history." />
            {queues.completed.length ? <div className="space-y-4">{queues.completed.map((job) => (
              <JobCard key={job.id} job={job} busy={false} view={() => setSelected(job)} />
            ))}</div> : <Empty icon={CheckCircle2} title="No completed jobs yet" copy="Finished work will remain here for your records." />}
          </TabsContent>
        </Tabs>
      )}
      <Details job={selected} close={() => setSelected(null)} />
      <Decline job={declining} busy={Boolean(declining && action?.id === declining.id)} close={() => setDeclining(null)} confirm={() => declining && void update(declining, "decline")} />
      <Complete job={completing} close={() => setCompleting(null)} done={(id) => { replaceStatus(id, "vendor_completed"); setCompleting(null); }} />
    </div>
  );
}

function RequestCard({ job, now, action, view, accept, decline }: {
  job: Job; now: number; action: Action; view: () => void; accept: () => void; decline: () => void;
}) {
  const deadline = matchDeadline(job);
  const expired = Boolean(now && deadline && deadline <= now);
  const busy = action?.id === job.id;
  const canAccept = job.status === "matched" && !expired;
  const price = priceContext(job);
  const note = customerNote(job);
  return (
    <Card className={cn("overflow-hidden border-l-4 border-l-accent shadow-sm transition-shadow hover:shadow-md", expired && "border-l-destructive")}>
      <CardHeader className="border-b bg-muted/20 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Service request</p>
            <div className="flex flex-wrap items-center gap-2"><CardTitle className="font-heading text-xl">{job.service_type}</CardTitle><Status status={job.status} /></div>
            <p className="mt-1.5 text-xs text-muted-foreground">Received {relative(job.created_at, now)}<span aria-hidden="true"> · </span>{formatDateTime(job.created_at)}</p>
          </div>
          <Button variant="ghost" size="sm" className="w-full shrink-0 sm:w-auto" onClick={view}><FileText />View full details</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DecisionField icon={MapPin} label="Address / area"><span>{job.address}</span><span className="block text-muted-foreground">{job.city}, {job.state} {job.zip_code}</span></DecisionField>
          <DecisionField icon={Calendar} label="Preferred timing"><span>{job.preferred_date ? formatDate(job.preferred_date) : "Date to be confirmed"}</span>{job.preferred_time && <span className="block text-muted-foreground">{job.preferred_time}</span>}</DecisionField>
          <DecisionField icon={DollarSign} label={price.label}><span>{price.value}</span><span className="block text-muted-foreground">{price.note}</span></DecisionField>
          <DecisionField icon={Clock} label="Response window"><span className={cn(expired && "font-medium text-destructive")}>{responseWindow(job, now)}</span>{deadline && <span className="block text-muted-foreground">{formatDeadline(deadline)}</span>}</DecisionField>
        </div>
        <div className="rounded-xl border bg-background p-4"><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><FileText className="h-4 w-4 text-accent" />Customer note</p><p className={cn("whitespace-pre-wrap text-sm leading-6", !note && "text-muted-foreground")}>{note || "No customer note was provided."}</p></div>
      </CardContent>
      <CardFooter className="flex flex-col gap-4 border-t bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex max-w-xl items-start gap-2 text-xs leading-5 text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><span>{job.status === "matched" ? "Accept confirms the assignment and moves it to Active Jobs. Coordinate through Messages before using Start Job when work begins." : "Mercurius is still preparing this match. Accept becomes available when the request is actively matched to you."}</span></div>
        <div className="flex w-full shrink-0 gap-2 sm:w-auto">
          <Button className="min-h-11 flex-1 sm:min-w-28" variant="outline" disabled={busy || expired} onClick={decline}>{busy && action?.kind === "decline" ? <Loader2 className="animate-spin" /> : null}Decline</Button>
          <Button className="min-h-11 flex-1 bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active sm:min-w-40" disabled={busy || !canAccept} onClick={accept}>{busy && action?.kind === "accept" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}Accept request</Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function JobCard({ job, busy, view, start, complete }: {
  job: Job; busy: boolean; view: () => void; start?: () => void; complete?: () => void;
}) {
  const price = priceContext(job);
  const canStart = job.status === "scheduled" && Boolean(start);
  const canComplete = ["in_progress", "pending_review"].includes(job.status) && Boolean(complete);
  const waitingForHomeowner = job.status === "vendor_completed";
  return (
    <Card className="shadow-sm transition-shadow hover:shadow-md"><CardContent><div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex flex-wrap items-center gap-3"><h3 className="font-heading text-lg font-semibold">{job.service_type}</h3><Status status={job.status} /></div>
        <div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
          <span className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{job.address}, {job.city}, {job.state}</span>
          <span className="flex items-start gap-2"><Calendar className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{job.preferred_date ? formatDate(job.preferred_date) : "Date to be confirmed"}{job.preferred_time ? " · " + job.preferred_time : ""}</span>
          <span className="flex items-start gap-2"><User className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{job.homeowner_name ?? "Homeowner"}</span>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t pt-4 lg:min-w-56 lg:items-end lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <div className="text-left lg:text-right"><p className="font-heading text-xl font-semibold">{price.value}</p><p className="mt-0.5 text-xs text-muted-foreground">{price.label}</p></div>
        {waitingForHomeowner && <p className="text-xs text-amber-700 dark:text-amber-300">Completion submitted · awaiting homeowner confirmation</p>}
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {(canStart || canComplete) && <Button variant="outline" size="sm" onClick={view}><FileText />View details</Button>}
          {!finished.has(job.status) && <Link href={`/vendor/messages?request=${encodeURIComponent(job.id)}`} className={buttonVariants({ variant: "outline", size: "sm" })}><MessageSquare />Messages</Link>}
          {canStart && start && <Button size="sm" disabled={busy} onClick={start}>{busy ? <Loader2 className="animate-spin" /> : <Briefcase />}Start job</Button>}
          {canComplete && complete && <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active" onClick={complete}><CheckCircle2 />Mark done</Button>}
          {!canStart && !canComplete && <Button size="sm" onClick={view}><FileText />{finished.has(job.status) ? "View record" : "View job"}</Button>}
        </div>
      </div>
    </div></CardContent></Card>
  );
}

function Details({ job, close }: { job: Job | null; close: () => void }) {
  if (!job) return null;
  const price = priceContext(job);
  const note = customerNote(job);
  return <Dialog open onOpenChange={(open) => !open && close()}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><div className="flex flex-wrap items-center gap-2 pr-8"><DialogTitle>{job.service_type}</DialogTitle><Status status={job.status} /></div><DialogDescription>Job details and homeowner request information.</DialogDescription></DialogHeader>
    <div className="grid gap-4 py-2 sm:grid-cols-2">
      <Block icon={MapPin} title="Service address">{job.address}<br />{job.city}, {job.state} {job.zip_code}</Block>
      <Block icon={Calendar} title="Preferred timing">{job.preferred_date ? formatDate(job.preferred_date) : "Date to be confirmed"}{job.preferred_time && <><br />{job.preferred_time}</>}</Block>
      <Block icon={User} title="Homeowner">{job.homeowner_name ?? "Homeowner"}</Block>
      <Block icon={DollarSign} title={price.label}>{price.value}<br /><span className="text-muted-foreground">{price.note}</span></Block>
    </div>
    <div className="rounded-lg border bg-muted/35 p-4"><p className="mb-2 flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4 text-accent" />Customer notes</p><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{note || "No additional notes were provided."}</p></div>
    {!incoming.has(job.status) && <Link href={`/vendor/messages?request=${encodeURIComponent(job.id)}`} onClick={close} className={cn(buttonVariants({ variant: "outline" }), "w-full")}><MessageSquare />Open Messages</Link>}
  </DialogContent></Dialog>;
}

function Decline({ job, busy, close, confirm }: { job: Job | null; busy: boolean; close: () => void; confirm: () => void }) {
  return <Dialog open={Boolean(job)} onOpenChange={(open) => !open && !busy && close()}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>Decline this request?</DialogTitle><DialogDescription>{job ? "The " + job.service_type + " request will return to Mercurius for another provider match." : ""}</DialogDescription></DialogHeader>
    <DialogFooter><Button variant="outline" disabled={busy} onClick={close}>Keep request</Button><Button variant="destructive" disabled={busy} onClick={confirm}>{busy && <Loader2 className="animate-spin" />}Decline request</Button></DialogFooter>
  </DialogContent></Dialog>;
}

type Photo = { path: string; preview: string };
function Complete({ job, close, done }: { job: Job | null; close: () => void; done: (id: string) => void }) {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const reset = () => { if (!uploading && !saving) { setPhotos([]); close(); } };
  async function add(files: FileList | null) {
    if (!files?.length || !user || !job) return;
    setUploading(true);
    const supabase = createClient();
    const added: Photo[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const extension = file.name.split(".").pop() || "jpg";
      const path = user.id + "/" + job.id + "/" + crypto.randomUUID() + "." + extension;
      const uploaded = await supabase.storage.from("job-photos").upload(path, file, { upsert: false });
      if (uploaded.error) { toast.error("Photo upload failed", { description: uploaded.error.message }); continue; }
      const signed = await supabase.storage.from("job-photos").createSignedUrl(path, 3600);
      added.push({ path, preview: signed.data?.signedUrl ?? "" });
    }
    setPhotos((current) => [...current, ...added]);
    setUploading(false);
    if (input.current) input.current.value = "";
  }
  async function remove(path: string) {
    const result = await createClient().storage.from("job-photos").remove([path]);
    if (result.error) { toast.error("Could not remove photo", { description: result.error.message }); return; }
    setPhotos((current) => current.filter((photo) => photo.path !== path));
  }
  async function submit() {
    if (!job || !photos.length) return;
    setSaving(true);
    const result = await createClient().rpc("vendor_complete_job", { _job_id: job.id, _photo_urls: photos.map((photo) => photo.path) });
    setSaving(false);
    if (result.error) { toast.error("Could not complete job", { description: result.error.message }); return; }
    toast.success("Job marked complete", { description: "The homeowner will be asked to confirm the work." });
    setPhotos([]);
    done(job.id);
  }
  return <Dialog open={Boolean(job)} onOpenChange={(open) => !open && reset()}><DialogContent className="sm:max-w-lg">
    <DialogHeader><DialogTitle>Complete {job?.service_type ?? "job"}</DialogTitle><DialogDescription>Attach at least one photo of the finished work. The homeowner sees this proof when confirming completion.</DialogDescription></DialogHeader>
    <div className="space-y-4 py-2">
      {photos.length > 0 && <div className="grid grid-cols-3 gap-2">{photos.map((photo) => <div key={photo.path} className="relative"><img src={photo.preview} alt="Completion proof" className="h-24 w-full rounded-lg border object-cover" /><button type="button" aria-label="Remove photo" onClick={() => void remove(photo.path)} className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border bg-background shadow"><X className="h-3.5 w-3.5" /></button></div>)}</div>}
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void add(event.target.files)} />
      <Button variant="outline" className="w-full" disabled={uploading || saving} onClick={() => input.current?.click()}>{uploading ? <Loader2 className="animate-spin" /> : <Camera />}{uploading ? "Uploading…" : "Add completion photos"}</Button>
    </div>
    <DialogFooter><Button variant="outline" disabled={saving || uploading} onClick={reset}>Cancel</Button><Button className="bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active" disabled={!photos.length || saving || uploading} onClick={() => void submit()}>{saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}Mark complete</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function Status({ status }: { status: string }) {
  const config = statusConfig[status] ?? [status.replaceAll("_", " "), "border-border bg-muted text-muted-foreground"];
  return <Badge className={cn("border capitalize", config[1])}>{config[0]}</Badge>;
}
function Count({ n }: { n: number }) { return <span className="rounded-full bg-background px-1.5 py-0.5 text-[11px] leading-none ring-1 ring-border">{n}</span>; }
function Heading({ title, copy }: { title: string; copy: string }) { return <div className="mb-4"><h2 className="font-heading text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{copy}</p></div>; }
function DecisionField({ icon: Icon, label, children }: { icon: typeof MapPin; label: string; children: ReactNode }) { return <div className="rounded-xl border bg-background p-3.5"><span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-sage-dark"><Icon className="h-4 w-4" /></span><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><div className="mt-1 text-sm font-medium leading-5 text-foreground">{children}</div></div>; }
function Block({ icon: Icon, title, children }: { icon: typeof MapPin; title: string; children: ReactNode }) { return <div className="rounded-lg border p-4"><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="h-4 w-4 text-accent" />{title}</p><div className="text-sm leading-6">{children}</div></div>; }
function Empty({ icon: Icon, title, copy }: { icon: typeof MapPin; title: string; copy: string }) { return <Card className="border-dashed bg-card/70"><CardContent className="py-16 text-center"><span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted"><Icon className="h-7 w-7 text-muted-foreground" /></span><p className="font-heading font-semibold">{title}</p><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">{copy}</p></CardContent></Card>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <Card className="border-destructive/20 bg-destructive/5"><CardContent className="py-14 text-center"><AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" /><p className="font-heading text-lg font-semibold">We could not load your jobs</p><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">No preview jobs have been substituted. {message}</p><Button className="mt-5" variant="outline" onClick={retry}><RefreshCw />Try again</Button></CardContent></Card>; }
function Loading() { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />Loading jobs...</div>; }
function sortBySchedule(a: Job, b: Job) { if (!a.preferred_date) return 1; if (!b.preferred_date) return -1; return a.preferred_date.localeCompare(b.preferred_date); }
function matchDeadline(job: Job) { return job.match_expires_at ? Date.parse(job.match_expires_at) : null; }
function countdown(ms: number) { const minutes = Math.max(0, Math.ceil(ms / 60_000)); const hours = Math.floor(minutes / 60); if (hours >= 24) return Math.ceil(hours / 24) + " days remaining"; return hours ? hours + "h " + minutes % 60 + "m remaining" : minutes + "m remaining"; }
function relative(value: string, now: number) { if (!now) return "recently"; const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000)); if (minutes < 1) return "just now"; if (minutes < 60) return minutes + "m ago"; const hours = Math.floor(minutes / 60); if (hours < 24) return hours + "h ago"; const days = Math.floor(hours / 24); return days === 1 ? "1 day ago" : days + " days ago"; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value)); }
function formatDate(value: string) { const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T12:00:00") : new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }

function customerNote(job: Job) {
  return job.description?.trim() ?? "";
}

function responseWindow(job: Job, now: number) {
  if (job.status !== "matched") return "Not open yet";
  const deadline = matchDeadline(job);
  if (!deadline) return "No deadline recorded";
  if (!now) return "Calculating…";
  return deadline <= now ? "Window closed" : countdown(deadline - now);
}

function priceContext(job: Job) {
  const payment = paymentNote(job.payment_status);
  if (job.total_amount !== null) {
    const fixed = job.pricing_mode === "fixed" && !job.quote_only;
    return { label: fixed ? "Fixed price" : "Estimated value", value: money(job.total_amount), note: payment ?? (fixed ? "Provider-backed rate" : "Recorded request amount") };
  }
  if (job.quote_amount !== null) {
    return { label: "Quoted amount", value: money(job.quote_amount), note: payment ?? "Quote recorded on request" };
  }
  if (job.quote_only || job.pricing_mode === "custom_quote" || job.pricing_mode === "deposit_quote") {
    return { label: "Price context", value: "Quote required", note: "Final amount is not confirmed" };
  }
  return { label: "Price context", value: "Price pending", note: "No amount is recorded yet" };
}

function paymentNote(status: string | null) {
  if (!status) return null;
  const labels: Record<string, string> = { captured: "Payment captured", released: "Payment released", refunded: "Payment refunded", pending: "Payment pending", pending_release: "Payment pending release" };
  return labels[status] ?? `Payment: ${status.replaceAll("_", " ")}`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDeadline(value: number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `Closes ${date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}
