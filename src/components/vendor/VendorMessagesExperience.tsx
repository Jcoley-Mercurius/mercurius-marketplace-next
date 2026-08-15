"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  Clock,
  DollarSign,
  FolderOpen,
  Loader2,
  MapPin,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type JobSummary = {
  id: string;
  service_type: string;
  status: string;
  address: string;
  city: string;
  state: string;
  zip_code: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  description: string | null;
  total_amount: number | null;
  quote_amount: number | null;
  contractor_id: string | null;
  customer_id: string;
  created_at: string;
  updated_at: string;
  homeowner_name: string | null;
};

type Message = {
  id: string;
  service_request_id: string;
  sender_id: string;
  sender_role: "homeowner" | "vendor" | "admin";
  content: string;
  created_at: string;
  read_at: string | null;
};

type Thread = {
  id: string;
  serviceType: string;
  status: string;
  updatedAt: string;
  homeownerName: string | null;
  lastMessage: string | null;
  lastMessageTime: string | null;
  unread: boolean;
  job: JobSummary;
};

type Mode = "loading" | "ready" | "unlinked" | "error";

export function VendorMessagesExperience({ requestedRequestId = null }: { requestedRequestId?: string | null }) {
  const { user } = useAuth();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [requestedThreadMissing, setRequestedThreadMissing] = useState(false);
  const appliedRequestRef = useRef<string | null>(null);

  const loadThreads = useCallback(async (showLoading = false) => {
    if (!user) return;
    if (showLoading) setMode("loading");
    setError("");
    try {
      const supabase = createClient();
      const contractorResult = await supabase.from("contractors").select("id").eq("user_id", user.id).maybeSingle();
      if (contractorResult.error) throw contractorResult.error;
      if (!contractorResult.data) {
        setThreads([]);
        setSelectedId(null);
        setMode("unlinked");
        return;
      }
      const requestResult = await supabase
        .from("service_requests")
        .select("id, service_type, status, address, city, state, zip_code, preferred_date, preferred_time, description, total_amount, quote_amount, contractor_id, customer_id, created_at, updated_at")
        .eq("contractor_id", contractorResult.data.id)
        .order("updated_at", { ascending: false });
      if (requestResult.error) throw requestResult.error;
      const jobs = (requestResult.data ?? []) as Omit<JobSummary, "homeowner_name">[];
      const requestIds = jobs.map((job) => job.id);
      const customerIds = [...new Set(jobs.map((job) => job.customer_id).filter(Boolean))];
      const [profileResult, messageResult] = await Promise.all([
        customerIds.length
          ? supabase.from("profiles").select("user_id, full_name").in("user_id", customerIds)
          : Promise.resolve({ data: [], error: null }),
        requestIds.length
          ? supabase.from("messages").select("id, service_request_id, sender_id, sender_role, content, created_at, read_at").in("service_request_id", requestIds).order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (messageResult.error) throw messageResult.error;
      const names = new Map(((profileResult.data ?? []) as { user_id: string; full_name: string | null }[]).map((profile) => [profile.user_id, profile.full_name]));
      const lastByRequest = new Map<string, Message>();
      for (const message of (messageResult.data ?? []) as Message[]) {
        if (!lastByRequest.has(message.service_request_id)) lastByRequest.set(message.service_request_id, message);
      }
      const nextThreads = jobs.map((job) => {
        const last = lastByRequest.get(job.id);
        const homeownerName = names.get(job.customer_id) ?? null;
        return {
          id: job.id,
          serviceType: job.service_type,
          status: job.status,
          updatedAt: job.updated_at,
          homeownerName,
          lastMessage: last?.content ?? null,
          lastMessageTime: last?.created_at ?? null,
          unread: Boolean(last && last.sender_id !== user.id && !last.read_at),
          job: { ...job, homeowner_name: homeownerName },
        } satisfies Thread;
      }).sort((a, b) => Date.parse(b.lastMessageTime ?? b.updatedAt) - Date.parse(a.lastMessageTime ?? a.updatedAt));
      setThreads(nextThreads);
      if (!requestedRequestId) {
        appliedRequestRef.current = null;
        setRequestedThreadMissing(false);
      }
      const hasPendingDeepLink = Boolean(requestedRequestId && appliedRequestRef.current !== requestedRequestId);
      if (hasPendingDeepLink && requestedRequestId) {
        appliedRequestRef.current = requestedRequestId;
        const matchingThread = nextThreads.some((thread) => thread.id === requestedRequestId);
        setRequestedThreadMissing(!matchingThread);
        setSelectedId(matchingThread ? requestedRequestId : null);
      } else {
        setSelectedId((current) => current && nextThreads.some((thread) => thread.id === current) ? current : null);
      }
      setMode("ready");
    } catch (reason) {
      console.error("Unable to load vendor messages", reason);
      setThreads([]);
      setError(reason instanceof Error ? reason.message : "Messages could not be loaded.");
      setMode("error");
    }
  }, [requestedRequestId, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadThreads(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadThreads]);

  useEffect(() => {
    if (!user) return;
    const supabase = createClient();
    const channel = supabase.channel(`vendor-message-inbox:${user.id}`).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      () => { void loadThreads(false); },
    ).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadThreads, user]);

  const selected = threads.find((thread) => thread.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) => thread.serviceType.toLowerCase().includes(query) || (thread.homeownerName ?? "").toLowerCase().includes(query));
  }, [searchQuery, threads]);

  if (mode === "unlinked") return <PageState icon={AlertCircle} title="No contractor profile linked" copy="Your conversations will appear here once Mercurius links your approved vendor profile." />;
  if (mode === "error") return <PageState icon={AlertCircle} title="Messages couldn’t be loaded" copy={error} action={<Button variant="outline" onClick={() => void loadThreads(true)}><RefreshCw />Try again</Button>} />;

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-[560px] overflow-hidden bg-background">
      <aside className={cn("flex w-full flex-col border-r bg-card md:w-72 lg:w-80", selected && "hidden md:flex")}>
        <div className="border-b p-4">
          <h1 className="mb-3 font-heading text-xl font-semibold">Messages</h1>
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search conversations" placeholder="Search..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="h-10 pl-9" /></div>
          {requestedThreadMissing && <div role="status" className="mt-3 rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:border-amber-700/70 dark:bg-amber-950/40 dark:text-amber-100"><p className="font-semibold">Conversation not found</p><p className="mt-0.5">This request is not available in your current message inbox.</p><Link href="/vendor/messages" className="mt-1 inline-flex font-semibold underline underline-offset-2">View all conversations</Link></div>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mode === "loading" ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-accent" /><span className="sr-only">Loading conversations</span></div> : filtered.length === 0 ? <div className="p-8 text-center"><MessageSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><p className="mb-1 font-medium">{searchQuery ? "No matching conversations" : "No conversations yet"}</p><p className="text-sm text-muted-foreground">{searchQuery ? "Try a different service or homeowner name." : "Conversations appear here once you’re assigned to a job."}</p></div> : <div className="divide-y">{filtered.map((thread) => <button key={thread.id} type="button" onClick={() => { setSelectedId(thread.id); setRequestedThreadMissing(false); }} className={cn("w-full p-4 text-left transition-colors hover:bg-muted", selectedId === thread.id && "bg-muted")}><div className="mb-1 flex items-start justify-between gap-2"><p className="truncate text-sm font-medium">{thread.serviceType}</p>{thread.lastMessageTime && <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(thread.lastMessageTime)}</span>}</div><p className="mb-1.5 text-xs text-muted-foreground">{thread.homeownerName ?? "Homeowner"}</p><div className="flex items-center justify-between gap-2"><p className="flex-1 truncate text-xs text-muted-foreground">{thread.lastMessage ?? "No messages yet"}</p>{thread.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unread activity" />}</div><StatusBadge status={thread.status} className="mt-2" /></button>)}</div>}
        </div>
      </aside>

      {selected ? <section className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex shrink-0 items-center gap-3 border-b p-4"><Button variant="ghost" size="icon" className="md:hidden" aria-label="Back to conversations" onClick={() => setSelectedId(null)}><ChevronLeft /></Button><div className="min-w-0 flex-1"><p className="truncate font-semibold">{selected.serviceType}</p><p className="text-sm text-muted-foreground">{selected.homeownerName ?? "Homeowner"}</p></div><StatusBadge status={selected.status} /><Button size="sm" variant="outline" className="hidden gap-1.5 sm:inline-flex" onClick={() => setDetailsOpen(true)}><FolderOpen />Project Details</Button></header>
        <Tabs defaultValue="chat" className="min-h-0 flex-1 gap-0 overflow-hidden">
          <TabsList className="mx-4 mt-3 shrink-0 self-start"><TabsTrigger value="chat"><MessageSquare />Chat</TabsTrigger><TabsTrigger value="project"><FolderOpen />Project</TabsTrigger></TabsList>
          <TabsContent value="chat" className="min-h-0 flex-1 overflow-hidden data-active:flex data-active:flex-col"><VendorMessageThread key={selected.id} serviceRequestId={selected.id} homeownerName={selected.homeownerName ?? "Homeowner"} onSent={() => void loadThreads(false)} /></TabsContent>
          <TabsContent value="project" className="min-h-0 flex-1 overflow-y-auto"><ProjectSummary job={selected.job} homeownerName={selected.homeownerName} openDetails={() => setDetailsOpen(true)} /></TabsContent>
        </Tabs>
        <ProjectDetailsDialog job={selected.job} open={detailsOpen} onOpenChange={setDetailsOpen} />
      </section> : <section className="hidden flex-1 items-center justify-center bg-muted/40 md:flex"><div className="max-w-sm px-6 text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-card shadow-sm">{requestedThreadMissing ? <AlertCircle className="h-8 w-8 text-amber-600 dark:text-amber-400" /> : <MessageSquare className="h-8 w-8 text-muted-foreground" />}</div><h2 className="mb-2 text-lg font-semibold">{requestedThreadMissing ? "Conversation not found" : "Job Messages"}</h2><p className="text-sm text-muted-foreground">{requestedThreadMissing ? "This request is not assigned to your vendor account, is no longer available, or the link is outdated." : "Select a job thread to view messages and project details."}</p>{requestedThreadMissing && <div className="mt-5 flex justify-center gap-2"><Link href="/vendor/jobs" className={buttonVariants({ variant: "outline" })}>Back to Jobs</Link><Link href="/vendor/messages" className={buttonVariants()}>View inbox</Link></div>}</div></section>}
    </div>
  );
}

function VendorMessageThread({ serviceRequestId, homeownerName, onSent }: { serviceRequestId: string; homeownerName: string; onSent: () => void }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    const result = await createClient().from("messages").select("id, service_request_id, sender_id, sender_role, content, created_at, read_at").eq("service_request_id", serviceRequestId).order("created_at", { ascending: true });
    if (result.error) setError(result.error.message);
    else setMessages((result.data ?? []) as Message[]);
    setLoading(false);
  }, [serviceRequestId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadMessages(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMessages]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`messages:${serviceRequestId}`).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `service_request_id=eq.${serviceRequestId}` },
      (payload) => {
        const incoming = payload.new as Message;
        setMessages((current) => current.some((message) => message.id === incoming.id) ? current : [...current, incoming]);
      },
    ).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [serviceRequestId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = async () => {
    const content = text.trim();
    if (!content || !user || sending) return;
    if (content.length > 2000) {
      toast.error("Message is too long", { description: "Keep messages under 2,000 characters." });
      return;
    }
    setSending(true);
    const result = await createClient().from("messages").insert({ service_request_id: serviceRequestId, sender_id: user.id, sender_role: "vendor", content }).select("id, service_request_id, sender_id, sender_role, content, created_at, read_at").single();
    setSending(false);
    if (result.error || !result.data) {
      toast.error("Failed to send", { description: result.error?.message ?? "Please try again." });
      return;
    }
    const sent = result.data as Message;
    setMessages((current) => current.some((message) => message.id === sent.id) ? current : [...current, sent]);
    setText("");
    onSent();
  };

  if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /><span className="sr-only">Loading messages</span></div>;
  if (error) return <div className="flex flex-1 items-center justify-center p-8 text-center"><div><AlertCircle className="mx-auto mb-3 h-9 w-9 text-destructive" /><p className="font-medium">This thread couldn’t be loaded</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{error}</p><Button className="mt-4" variant="outline" onClick={() => { setError(""); setLoading(true); void loadMessages(); }}><RefreshCw />Try again</Button></div></div>;

  return <div className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mx-auto max-w-2xl space-y-4" aria-live="polite">{messages.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">No messages yet. Say hello!</div>}{messages.map((message) => { const mine = message.sender_id === user?.id; const admin = message.sender_role === "admin"; return <div key={message.id} className={cn("flex max-w-[88%] gap-3 sm:max-w-[80%]", mine && "ml-auto flex-row-reverse")}><div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", mine ? "bg-accent text-accent-foreground" : admin ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground")}><User className="h-4 w-4" /></div><div className={cn("rounded-2xl px-4 py-3 text-sm", mine ? "ml-auto rounded-br-md bg-accent text-accent-foreground" : admin ? "rounded-bl-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground")}><p className="mb-1 text-xs font-medium opacity-70">{mine ? "You" : admin ? "Mercurius Support" : homeownerName}</p><p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p><p className="mt-1 text-right text-[11px] opacity-50">{messageTime(message.created_at)}</p></div></div>; })}<div ref={bottomRef} /></div></div><div className="shrink-0 border-t bg-background p-4"><div className="mx-auto flex max-w-2xl gap-3"><Input aria-label="Message" placeholder="Type a message..." maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} className="h-12" disabled={sending} /><Button size="lg" className="h-12 shrink-0 bg-accent text-accent-foreground hover:bg-accent-hover" aria-label="Send message" disabled={!text.trim() || sending} onClick={() => void send()}>{sending ? <Loader2 className="animate-spin" /> : <Send />}</Button></div></div></div>;
}

function ProjectSummary({ job, homeownerName, openDetails }: { job: JobSummary; homeownerName: string | null; openDetails: () => void }) {
  return <div className="space-y-4 p-4 sm:p-6"><div className="space-y-3 rounded-xl border bg-card p-5 shadow-sm"><h3 className="text-sm font-semibold uppercase tracking-wide">Job Details</h3><div className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2"><p><span className="font-medium text-foreground">Address: </span>{job.address}, {job.city} {job.state}</p>{job.preferred_date && <p><span className="font-medium text-foreground">Date: </span>{formatDate(job.preferred_date)}</p>}{job.preferred_time && <p><span className="font-medium text-foreground">Time: </span>{job.preferred_time}</p>}{(job.total_amount ?? job.quote_amount) !== null && <p><span className="font-medium text-foreground">Amount: </span>{money(job.total_amount ?? job.quote_amount)}</p>}<p><span className="font-medium text-foreground">Homeowner: </span>{homeownerName ?? "—"}</p><p><span className="font-medium text-foreground">Status: </span>{statusLabel(job.status)}</p></div>{job.description && <div className="border-t pt-3"><p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Scope of Work</p><p className="whitespace-pre-wrap text-sm leading-relaxed">{job.description}</p></div>}</div><button type="button" onClick={openDetails} className="w-full rounded-xl border border-dashed bg-muted/30 p-5 text-center transition-colors hover:bg-muted/60"><FolderOpen className="mx-auto mb-2 h-8 w-8 text-accent" /><p className="text-sm font-medium">View Full Project Details</p><p className="mt-1 text-xs text-muted-foreground">Review the service address, schedule, scope, and job value.</p></button></div>;
}

function ProjectDetailsDialog({ job, open, onOpenChange }: { job: JobSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
  const amount = job.total_amount ?? job.quote_amount;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><div className="flex flex-wrap items-center gap-2 pr-8"><DialogTitle className="text-lg">{job.service_type}</DialogTitle><StatusBadge status={job.status} /></div><DialogDescription>Project details for this homeowner request.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Detail icon={MapPin} title="Service address">{job.address}<br />{job.city}, {job.state} {job.zip_code}</Detail><Detail icon={Calendar} title="Preferred timing">{job.preferred_date ? formatDate(job.preferred_date) : "Date to be confirmed"}{job.preferred_time && <><br />{job.preferred_time}</>}</Detail><Detail icon={User} title="Homeowner">{job.homeowner_name ?? "Homeowner"}</Detail><Detail icon={DollarSign} title="Job value">{amount !== null ? money(amount) : "Quote required"}</Detail></div><div className="rounded-lg border bg-muted/35 p-4"><p className="mb-2 text-sm font-medium">Scope of work</p><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{job.description || "No additional notes were provided."}</p></div><Link href="/vendor/jobs" className={buttonVariants({ variant: "outline", className: "w-full" })}>Open Jobs &amp; Requests</Link></DialogContent></Dialog>;
}

function Detail({ icon: Icon, title, children }: { icon: typeof MapPin; title: string; children: React.ReactNode }) {
  return <div className="rounded-lg border p-4"><p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><Icon className="h-4 w-4 text-accent" />{title}</p><div className="text-sm leading-6">{children}</div></div>;
}

function StatusBadge({ status, className }: { status: string; className?: string }) {
  const completed = ["completed", "closed", "reviewed", "resolved", "homeowner_confirmed"].includes(status);
  return <Badge variant={completed ? "secondary" : "outline"} className={cn("gap-1 capitalize", className)}>{completed ? <CheckCircle2 className="h-3 w-3" /> : <Clock className="h-3 w-3" />}{statusLabel(status)}</Badge>;
}

function PageState({ icon: Icon, title, copy, action }: { icon: typeof AlertCircle; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="flex min-h-[520px] items-center justify-center p-8 text-center"><div><Icon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" /><h1 className="text-lg font-semibold">{title}</h1><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{copy}</p>{action && <div className="mt-5">{action}</div>}</div></div>;
}

function statusLabel(status: string) { return status.replaceAll("_", " "); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function messageTime(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)); }
function money(value: number | null) { return value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
function relativeTime(value: string) {
  const seconds = Math.round((Date.parse(value) - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  return formatter.format(Math.round(hours / 24), "day");
}
