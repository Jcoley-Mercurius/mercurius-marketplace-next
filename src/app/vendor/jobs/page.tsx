/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { JobOperations } from "@/components/dashboard/JobOperations";
import Link from "next/link";
import {
  AlertCircle, Briefcase, Calendar, Camera, CheckCircle2, Clock, DollarSign,
  FileText, Inbox, Loader2, MapPin, MessageSquare, RefreshCw, User, X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatEastern, isOpenVendorOffer, isQuoteWork, offerTimeLeft, vendorOfferOutcome } from "@/lib/offerStatus";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { VendorRecruitingNotice } from "@/components/vendor/VendorRecruitingStatus";

type Job = {
  id: string;
  customer_id: string;
  service_type: string;
  description: string | null;
  status: string;
  service_catalog_id?: string | null;
  scheduled_start_at?: string | null;
  matching_status?: string;
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
  package_question_answers: Record<string, { question?: unknown; answer?: unknown; unit?: unknown }> | null;
  homeowner_name?: string | null;
};

type Mode = "loading" | "live" | "unlinked" | "error";
type Action = { id: string; kind: string } | null;
type Notice = { tone: "success" | "warning" | "error"; title: string; text: string } | null;

// TRACE-099: an offer is actionable only in the stored offer state; the server decides expiry.
const isIncoming = (job: Job) => isOpenVendorOffer(job) || job.status === "pending";
const readbackColumns = "status, matching_status, contractor_id, pricing_mode, quote_only, scheduled_start_at";
const finished = new Set(["completed", "closed", "reviewed", "resolved", "homeowner_confirmed", "cancelled"]);
const statusConfig: Record<string, [string, string]> = {
  matched: ["New offer", "border-status-info bg-status-info-bg text-status-info"],
  pending: ["Preparing match", "border-status-info bg-status-info-bg text-status-info"],
  quoted: ["Quote offer", "border-status-info bg-status-info-bg text-status-info"],
  scheduled: ["Scheduled", "border-status-info bg-status-info-bg text-status-info"],
  in_progress: ["In Progress", "border-accent/20 bg-accent/10 text-accent"],
  pending_review: ["Pending Confirmation", "border-status-warning bg-status-warning-bg text-status-warning"],
  vendor_completed: ["Awaiting Homeowner", "border-status-warning bg-status-warning-bg text-status-warning"],
  homeowner_confirmed: ["Confirmed", "border-status-success bg-status-success-bg text-status-success"],
  disputed: ["Issue Reported", "border-status-danger bg-status-danger-bg text-status-danger"],
  resolved: ["Resolved", "border-status-success bg-status-success-bg text-status-success"],
  review_requested: ["Review Requested", "border-status-info bg-status-info-bg text-status-info"],
  reviewed: ["Reviewed", "border-status-success bg-status-success-bg text-status-success"],
  closed: ["Closed", "border-border bg-muted text-muted-foreground"],
  completed: ["Completed", "border-status-success bg-status-success-bg text-status-success"],
  cancelled: ["Cancelled", "border-border bg-muted text-muted-foreground"],
};

export default function VendorJobsPage() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [action, setAction] = useState<Action>(null);
  const [selected, setSelected] = useState<Job | null>(null);
  const [completing, setCompleting] = useState<Job | null>(null);
  const [now, setNow] = useState(0);
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [staleRefresh, setStaleRefresh] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef(false);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [notice]);

  useEffect(() => {
    // The response-window clock begins only after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!user) return;
    if (!silent) {
      setMode("loading");
      setError("");
    }
    try {
      const supabase = createClient();
      const expiryResult = await supabase.rpc("expire_stale_matches");
      if (expiryResult.error) console.warn("Unable to expire stale offers", expiryResult.error.message);
      const contractorResult = await supabase.from("contractors").select("id").eq("user_id", user.id).maybeSingle();
      if (contractorResult.error) throw contractorResult.error;
      if (!contractorResult.data) {
        setJobs([]);
        setContractorId(null);
        setMode("unlinked");
        return;
      }
      setContractorId(contractorResult.data.id);
      const result = await supabase
        .from("service_requests")
        .select("id, customer_id, service_type, description, status, matching_status, pricing_mode, quote_only, payment_status, preferred_date, preferred_time, address, city, state, zip_code, quote_amount, total_amount, created_at, updated_at, assigned_at, match_expires_at, package_question_answers, scheduled_start_at, service_catalog_id")
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
      setNow(Date.now());
      setStaleRefresh(false);
      setMode("live");
    } catch (reason) {
      if (silent) {
        // Keep the last list but say it may be out of date; actions still recheck the server.
        console.warn("Unable to refresh vendor jobs", reason);
        setStaleRefresh(true);
        return;
      }
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

  // Offers change while the page is in the background; re-read them on return.
  useEffect(() => {
    let last = 0;
    function refresh() {
      if (document.visibilityState !== "visible" || actionRef.current || Date.now() - last < 10_000) return;
      last = Date.now();
      void load({ silent: true });
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const queues = useMemo(() => ({
    requests: jobs.filter((job) => isIncoming(job)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    active: jobs.filter((job) => !isIncoming(job) && !finished.has(job.status)).sort(sortBySchedule),
    completed: jobs.filter((job) => finished.has(job.status)).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
  }), [jobs]);

  // TRACE-099: accept/decline outcomes come from reading the request back, whether the call
  // succeeded, failed or lost its response. A hidden row means the offer left this vendor.
  async function respond(job: Job, kind: "accept" | "decline") {
    if (!contractorId || actionRef.current) return false;
    actionRef.current = true;
    setAction({ id: job.id, kind });
    setNotice(null);
    setCardErrors((current) => { const next = { ...current }; delete next[job.id]; return next; });
    const supabase = createClient();
    try {
      const call = kind === "accept"
        ? await supabase.rpc("vendor_accept_job", { _job_id: job.id })
        : await supabase.rpc("vendor_decline_job", { _job_id: job.id, _reason: "Vendor declined" });
      const read = await supabase.from("service_requests").select(readbackColumns).eq("id", job.id).maybeSingle();
      const outcome = vendorOfferOutcome(read.data, contractorId, Boolean(read.error));
      const message = call.error?.message ?? "";

      if (outcome.kind === "accepted") {
        setJobs((current) => current.map((item) => item.id === job.id ? { ...item, ...read.data, updated_at: new Date().toISOString() } : item));
        setNotice({ tone: "success", title: kind === "accept" ? "Offer accepted" : "This offer was already accepted", text: [
          `${job.service_type} is now in Active Jobs.`,
          outcome.quote ? "This is quote work, so the price isn’t set yet." : null,
          outcome.appointment ? `Appointment: ${outcome.appointment}.` : "No appointment time is recorded yet.",
        ].filter(Boolean).join(" ") });
        return true;
      }
      if (outcome.kind === "gone") {
        setJobs((current) => current.filter((item) => item.id !== job.id));
        setNotice(kind === "decline" && !call.error
          ? { tone: "success", title: "Offer declined", text: `${job.service_type} won’t be offered to you again.` }
          : { tone: "warning", title: "Offer no longer available", text: `${job.service_type} expired, was withdrawn or was reassigned, so your response wasn’t recorded.` });
        return true;
      }
      if (outcome.kind === "unknown") {
        setCardErrors((current) => ({ ...current, [job.id]: "We couldn’t confirm whether your response was saved. Check again before responding." }));
        return false;
      }
      // Still open: the server refused the response and the offer stays with this vendor.
      if (/expired/i.test(message)) {
        await load({ silent: true });
        setNotice({ tone: "warning", title: "Response window closed", text: `${job.service_type} wasn’t accepted because its response window closed.` });
        return true;
      }
      setCardErrors((current) => ({ ...current, [job.id]: /no longer eligible/i.test(message)
        ? "You aren’t currently eligible for this request, so it wasn’t accepted. Check your compliance status and coverage, or decline the offer."
        : `Your response wasn’t saved. ${message || "Please try again."}` }));
      return false;
    } finally {
      actionRef.current = false;
      setAction(null);
    }
  }

  async function start(job: Job) {
    setAction({ id: job.id, kind: "start" });
    try {
      const result = await createClient().rpc("transition_job_status", { _job_id: job.id, _to_status: "in_progress" });
      if (result.error) throw result.error;
      replaceStatus(job.id, "in_progress");
      toast.success("Job started");
    } catch (reason) {
      toast.error("Unable to update this job", { description: reason instanceof Error ? reason.message : "Please try again." });
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
        <h1 id="vendor-jobs-heading" tabIndex={-1} className="font-heading text-3xl font-semibold tracking-tight">Jobs &amp; Requests</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Respond to new homeowner requests and manage every job from scheduling through completion.</p>
      </header>

      <VendorRecruitingNotice />

      {mode === "unlinked" ? (
        <Empty icon={Briefcase} title="No contractor profile linked" copy="Your jobs will appear here once Mercurius links your approved vendor profile." />
      ) : mode === "error" ? (
        <ErrorState message={error} retry={() => void load()} />
      ) : (
        <Tabs defaultValue="requests">
          {notice && <div ref={noticeRef} tabIndex={-1} role={notice.tone === "error" ? "alert" : "status"} className={cn("mb-6 rounded-lg border p-4 text-sm",
            notice.tone === "success" ? "border-status-success bg-status-success-bg text-status-success" : "border-status-warning bg-status-warning-bg text-status-warning")}>
            <p className="font-semibold">{notice.title}</p><p className="mt-1">{notice.text}</p>
          </div>}
          <div className="mb-6 overflow-x-auto border-b border-border">
            <TabsList variant="line" className="min-h-11 w-full flex-wrap gap-2 p-0 sm:w-auto sm:gap-5">
              <TabsTrigger value="requests" className="px-1">Offers <Count n={queues.requests.length} /></TabsTrigger>
              <TabsTrigger value="active" className="px-1">Active Jobs <Count n={queues.active.length} /></TabsTrigger>
              <TabsTrigger value="completed" className="px-1">Completed <Count n={queues.completed.length} /></TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="requests">
            <Heading title="Offers" copy="Each offer is exclusive to you until its response deadline. Accept or decline before it closes." />
            {staleRefresh && <p role="status" className="mb-4 rounded-lg border border-status-warning bg-status-warning-bg p-3 text-sm text-status-warning">We couldn’t refresh your offers. Accept and decline still check the current offer. <Button variant="link" className="h-auto min-h-0 p-0" onClick={() => void load()}>Refresh now</Button></p>}
            {queues.requests.length ? <div className="space-y-4">{queues.requests.map((job) => (
              <RequestCard key={job.id} job={job} now={now} action={action} error={cardErrors[job.id]} recheck={() => void load()} view={() => setSelected(job)}
                accept={async () => { if (!await respond(job, "accept")) throw new Error("Accept not recorded"); }}
                decline={async () => { if (!await respond(job, "decline")) throw new Error("Decline not recorded"); }} />
            ))}</div> : <Empty icon={Inbox} title="No open offers" copy="No homeowner jobs yet. While booking is by invitation, offers are rare; when Mercurius offers you a request, it appears here with its response deadline." />}
          </TabsContent>
          <TabsContent value="active">
            <Heading title="Active Jobs" copy="Upcoming and in-progress work, including jobs awaiting homeowner confirmation." />
            {queues.active.length ? <div className="space-y-4">{queues.active.map((job) => (
              <JobCard key={job.id} job={job} busy={action?.id === job.id} view={() => setSelected(job)} start={() => void start(job)} complete={() => setCompleting(job)} />
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
      <Details saved={() => { setSelected(null); void load(); }} job={selected} close={() => setSelected(null)} />
      <Complete job={completing} close={() => setCompleting(null)} done={(id) => { replaceStatus(id, "vendor_completed"); setCompleting(null); }} />
    </div>
  );
}

function RequestCard({ job, now, action, error, recheck, view, accept, decline }: {
  job: Job; now: number; action: Action; error?: string; recheck: () => void; view: () => void; accept: () => Promise<void>; decline: () => Promise<void>;
}) {
  const deadline = formatEastern(job.match_expires_at);
  const left = offerTimeLeft(job.match_expires_at, now);
  // The browser clock only disables the buttons; the server still decides expiry.
  const closed = left === "Response window closed";
  const busy = action?.id === job.id;
  const open = isOpenVendorOffer(job);
  const canRespond = open && !closed && !busy;
  const quote = isQuoteWork(job);
  const price = priceContext(job);
  const note = customerNote(job);
  const entity = `${job.service_type} · ${job.city}, ${job.state}`;
  return (
    <Card className={cn("overflow-hidden border-l-4 border-l-accent shadow-sm transition-shadow hover:shadow-md", closed && "border-l-destructive")}>
      <CardHeader className="border-b bg-muted/20 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{open ? "Exclusive offer" : "Service request"}</p>
            <div className="flex flex-wrap items-center gap-2"><CardTitle className="font-heading text-xl">{job.service_type}</CardTitle><Status status={job.status} /></div>
            <p className="mt-1.5 text-xs text-muted-foreground">Received {relative(job.created_at, now)}<span aria-hidden="true"> · </span>{formatDateTime(job.created_at)}</p>
          </div>
          <Button variant="ghost" size="sm" className="w-full shrink-0 sm:w-auto" onClick={view}><FileText />View full details</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DecisionField icon={MapPin} label="Address / area"><span>{job.address}</span><span className="block text-muted-foreground">{job.city}, {job.state} {job.zip_code}</span></DecisionField>
          <DecisionField icon={Calendar} label="Preferred timing"><span>{job.preferred_date ? formatDate(job.preferred_date) : "No preferred date"}</span>{job.preferred_time && <span className="block text-muted-foreground">{job.preferred_time}</span>}</DecisionField>
          <DecisionField icon={DollarSign} label={price.label}><span>{price.value}</span><span className="block text-muted-foreground">{price.note}</span></DecisionField>
          <DecisionField icon={Clock} label="Respond by">{open ? <><span className={cn(closed && "text-destructive")}>{deadline ?? "No deadline recorded"}</span>{left && <span className={cn("block text-muted-foreground", closed && "font-medium text-destructive")}>{left}</span>}</> : <span>Not open for a response</span>}</DecisionField>
        </div>
        <div className="rounded-xl border bg-background p-4"><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><FileText className="h-4 w-4 text-accent" />Customer note</p><p className={cn("whitespace-pre-wrap text-sm leading-6", !note && "text-muted-foreground")}>{note || "No customer note was provided."}</p></div>
        <QuestionAnswers job={job} />
        {error && <div role="alert" className="space-y-2 rounded-lg border border-status-danger bg-status-danger-bg p-3 text-sm text-status-danger"><p>{error}</p><Button variant="outline" size="sm" onClick={recheck}><RefreshCw />Check again</Button></div>}
      </CardContent>
      <CardFooter className="flex flex-col gap-4 border-t bg-muted/20 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">{!open
          ? "Mercurius is still preparing this request. You can respond once it’s offered to you."
          : closed ? "The response window has closed. Mercurius will move this request on; refresh to see your current offers."
          : quote ? "Quote work: accepting commits you to this request; the price is set later by quote."
          : "Accepting commits you to this request at the fixed price shown."}</p>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
          <ConfirmAction triggerLabel="Decline" title="Decline this offer?" entity={entity}
            consequence="It won’t be offered to you again. Mercurius may offer it to another eligible provider, ask the homeowner how to proceed, or tell them it isn’t available yet."
            confirmLabel="Decline offer" disabled={!canRespond} onConfirm={decline} />
          <ConfirmAction triggerLabel="Accept offer" triggerVariant="commitment" confirmationTone="commitment" title="Accept this offer?" entity={entity}
            consequence={`${quote ? "This is quote work: the price isn’t set until a quote is agreed." : job.total_amount !== null ? `You agree to the fixed price of ${money(job.total_amount)}.` : "You agree to the fixed price on this request."} The request moves to Active Jobs as scheduled, with no appointment time until one is recorded. If you cancel later, Mercurius rematches the homeowner and records a provider cancellation.`}
            confirmLabel="Accept offer" disabled={!canRespond} onConfirm={accept} />
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
          <span className="flex items-start gap-2"><Calendar className="mt-0.5 h-4 w-4 shrink-0 text-accent" />{job.scheduled_start_at ? `Appointment: ${formatEastern(job.scheduled_start_at)}` : job.status === "scheduled" ? "No appointment time recorded yet" : job.preferred_date ? `Preferred: ${formatDate(job.preferred_date)}${job.preferred_time ? " · " + job.preferred_time : ""}` : "No preferred date"}</span>
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

function Details({ job, close, saved }: { job: Job | null; close: () => void; saved: () => void }) {
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
    {job.scheduled_start_at && <p>Appointment: {formatEastern(job.scheduled_start_at)}</p>}
    {["scheduled", "in_progress"].includes(job.status) && <JobOperations key={job.id} jobId={job.id} role="vendor" onSaved={saved} />}
    <QuestionAnswers job={job} />
    {!isIncoming(job) && <Link href={`/vendor/messages?request=${encodeURIComponent(job.id)}`} onClick={close} className={cn(buttonVariants({ variant: "outline" }), "w-full")}><MessageSquare />Open Messages</Link>}
  </DialogContent></Dialog>;
}

type Photo = { path: string; preview: string };
function Complete({ job, close, done }: { job: Job | null; close: () => void; done: (id: string) => void }) {
  const { user } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState("");
  const photoErrorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (photoError) photoErrorRef.current?.focus(); }, [photoError]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  // The server enforces the category's current minimum; this only explains it. Services
  // without a versioned rule use the approved one-photo baseline.
  const [ruleAttempt, setRuleAttempt] = useState(0);
  const [rule, setRule] = useState<{ key: string; required: number | null } | null>(null);
  const serviceId = job ? job.service_catalog_id ?? null : null;
  const ruleKey = serviceId ? `${serviceId}:${ruleAttempt}` : null;
  useEffect(() => {
    if (!serviceId || !ruleKey) return;
    let active = true;
    void createClient().from("completion_evidence_rules").select("minimum_photos").eq("service_id", serviceId)
      .order("version", { ascending: false }).limit(1).maybeSingle()
      .then((result) => {
        if (active) setRule({ key: ruleKey, required: result.error ? null : result.data?.minimum_photos ?? 1 });
      });
    return () => { active = false; };
  }, [serviceId, ruleKey]);
  const loaded = rule?.key === ruleKey ? rule : null;
  const required = !job ? null : !serviceId ? 1 : loaded?.required ?? null;
  const ruleError = Boolean(loaded && loaded.required === null);
  const photoWord = (count: number) => (count === 1 ? "photo" : "photos");
  const enough = required !== null && photos.length >= required;
  const reset = () => { if (!uploading && !saving) { setPhotoError(""); setPhotos([]); close(); } };
  async function add(files: FileList | null) {
    if (!files?.length || !user || !job) return;
    setPhotoError("");
    setUploading(true);
    const supabase = createClient();
    const added: Photo[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const extension = file.name.split(".").pop() || "jpg";
      const path = user.id + "/" + job.id + "/" + crypto.randomUUID() + "." + extension;
      const uploaded = await supabase.storage.from("job-photos").upload(path, file, { upsert: false });
      if (uploaded.error) { setPhotoError("Photo upload failed. " + uploaded.error.message); continue; }
      const signed = await supabase.storage.from("job-photos").createSignedUrl(path, 3600);
      added.push({ path, preview: signed.data?.signedUrl ?? "" });
    }
    setPhotos((current) => [...current, ...added]);
    setUploading(false);
    if (input.current) input.current.value = "";
  }
  async function remove(path: string) {
    const result = await createClient().storage.from("job-photos").remove([path]);
    if (result.error) { setPhotoError("Could not remove photo. " + result.error.message); return; }
    setPhotos((current) => current.filter((photo) => photo.path !== path));
  }
  async function submit() {
    if (!job || !enough) return;
    setSaving(true);
    const result = await createClient().rpc("vendor_complete_job", { _job_id: job.id, _photo_urls: photos.map((photo) => photo.path) });
    setSaving(false);
    if (result.error) { setPhotoError("Could not complete job. " + result.error.message); return; }
    toast.success("Job marked complete", { description: "The homeowner will be asked to confirm the work." });
    setPhotos([]);
    done(job.id);
  }
  return <Dialog open={Boolean(job)} onOpenChange={(open) => !open && reset()}><DialogContent showCloseButton={!saving && !uploading} className="sm:max-w-lg">
    <DialogHeader><DialogTitle>Complete {job?.service_type ?? "job"}</DialogTitle><DialogDescription>{required === null ? "Attach photos of the finished work." : `This service requires at least ${required} ${photoWord(required)} of the finished work.`} The homeowner sees this proof when confirming completion.</DialogDescription></DialogHeader>
    <div className="space-y-4 py-2" aria-busy={uploading || saving || (required === null && !ruleError)}>
      {ruleError && <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"><p>We could not load this service&apos;s photo requirement, so the job cannot be marked complete yet.</p><Button type="button" variant="outline" size="sm" onClick={() => setRuleAttempt((attempt) => attempt + 1)}><RefreshCw />Try again</Button></div>}
      {photoError && <p ref={photoErrorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{photoError}</p>}
      {required !== null && <p aria-live="polite" className="text-sm text-muted-foreground">{photos.length} of {required} required {photoWord(required)} attached.</p>}
      {photos.length > 0 && <div className="grid grid-cols-3 gap-2">{photos.map((photo, index) => <div key={photo.path} className="relative"><img src={photo.preview} alt="Completion proof" className="h-24 w-full rounded-lg border object-cover" /><button type="button" aria-label={`Remove completion photo ${index + 1}`} disabled={uploading || saving} onClick={() => void remove(photo.path)} className="absolute -right-2 -top-2 flex h-11 w-11 items-center justify-center rounded-full border bg-background shadow"><X className="h-3.5 w-3.5" /></button></div>)}</div>}
      <input aria-label="Completion photos" ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void add(event.target.files)} />
      <Button variant="outline" className="w-full" disabled={uploading || saving} onClick={() => input.current?.click()}>{uploading ? <Loader2 className="animate-spin" /> : <Camera />}{uploading ? "Uploading…" : "Add completion photos"}</Button>
    </div>
    <DialogFooter><Button variant="outline" disabled={saving || uploading} onClick={reset}>Cancel</Button><Button className="bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active" disabled={!enough || saving || uploading} onClick={() => void submit()}>{saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}Mark complete</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function Status({ status }: { status: string }) {
  const config = statusConfig[status] ?? [status.replaceAll("_", " "), "border-border bg-muted text-muted-foreground"];
  return <Badge className={cn("border capitalize", config[1])}>{config[0]}</Badge>;
}
function Count({ n }: { n: number }) { return <span className="rounded-full bg-background px-1.5 py-0.5 text-xs leading-none ring-1 ring-border">{n}</span>; }
function Heading({ title, copy }: { title: string; copy: string }) { return <div className="mb-4"><h2 className="font-heading text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{copy}</p></div>; }
function DecisionField({ icon: Icon, label, children }: { icon: typeof MapPin; label: string; children: ReactNode }) { return <div className="rounded-xl border bg-background p-3.5"><span className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-sage-dark"><Icon className="h-4 w-4" /></span><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><div className="mt-1 text-sm font-medium leading-5 text-foreground">{children}</div></div>; }
function Block({ icon: Icon, title, children }: { icon: typeof MapPin; title: string; children: ReactNode }) { return <div className="rounded-lg border p-4"><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="h-4 w-4 text-accent" />{title}</p><div className="text-sm leading-6">{children}</div></div>; }
function Empty({ icon: Icon, title, copy }: { icon: typeof MapPin; title: string; copy: string }) { return <Card className="border-dashed bg-card/70"><CardContent className="py-16 text-center"><span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted"><Icon className="h-7 w-7 text-muted-foreground" /></span><p className="font-heading font-semibold">{title}</p><p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">{copy}</p></CardContent></Card>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <Card className="border-destructive/20 bg-destructive/5"><CardContent className="py-14 text-center"><AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" /><p className="font-heading text-lg font-semibold">We could not load your jobs</p><p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">No preview jobs have been substituted. {message}</p><Button className="mt-5" variant="outline" onClick={retry}><RefreshCw />Try again</Button></CardContent></Card>; }
function Loading() { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />Loading jobs...</div>; }
function sortBySchedule(a: Job, b: Job) { if (!a.preferred_date) return 1; if (!b.preferred_date) return -1; return a.preferred_date.localeCompare(b.preferred_date); }
function relative(value: string, now: number) { if (!now) return "recently"; const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000)); if (minutes < 1) return "just now"; if (minutes < 60) return minutes + "m ago"; const hours = Math.floor(minutes / 60); if (hours < 24) return hours + "h ago"; const days = Math.floor(hours / 24); return days === 1 ? "1 day ago" : days + " days ago"; }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value)); }
function formatDate(value: string) { const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T12:00:00") : new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }

function customerNote(job: Job) {
  return job.description?.trim() ?? "";
}

function QuestionAnswers({ job }: { job: Job }) {
  const answers = Object.entries(job.package_question_answers ?? {}).flatMap(([key, value]) => {
    const answer = typeof value?.answer === "string" || typeof value?.answer === "number" ? String(value.answer) : "";
    if (!answer) return [];
    return [{ key, question: typeof value.question === "string" ? value.question : key.replaceAll("_", " "), answer, unit: typeof value.unit === "string" ? value.unit : "" }];
  });
  if (!answers.length) return null;
  return <div className="rounded-xl border bg-accent-subtle p-4"><p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-accent" />Service answers</p><dl className="space-y-3">{answers.map((item) => <div key={item.key}><dt className="text-xs text-muted-foreground">{item.question}</dt><dd className="mt-0.5 text-sm font-medium text-foreground">{item.answer}{item.unit ? ` ${item.unit}` : ""}</dd></div>)}</dl></div>;
}


function priceContext(job: Job) {
  const payment = paymentNote(job.payment_status);
  if (isQuoteWork(job)) {
    return job.quote_amount === null
      ? { label: "Price", value: "Quote required", note: "No price is set yet" }
      : { label: "Quoted amount", value: money(job.quote_amount), note: payment ?? "Quote recorded on request" };
  }
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

