"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Award,
  Calendar,
  CheckCircle2,
  DollarSign,
  Eye,
  FileText,
  Loader2,
  MapPin,
  MessageSquare,
  RefreshCw,
  Save,
  Search,
  Send,
  Star,
  User,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type ServiceRequest = {
  id: string;
  service_type: string;
  status: string;
  address: string;
  city: string;
  state: string;
  zip_code: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  created_at: string;
  updated_at: string;
  customer_id: string;
  contractor_id: string | null;
  description: string | null;
  notes: string | null;
  total_amount: number | null;
  quote_amount: number | null;
  assigned_at: string | null;
  match_expires_at: string | null;
  match_attempt_count: number;
  declined_contractor_ids: string[];
  payment_status: string;
  needs_admin_review: boolean;
};

type Contractor = {
  id: string;
  name: string;
  services: string[];
  location: string | null;
  rating: number | null;
  jobs_completed: number | null;
  badges: string[] | null;
  is_active: boolean;
};

type MatchAttempt = {
  id: string;
  contractor_id: string;
  attempt_number: number;
  offered_at: string;
  expires_at: string | null;
  responded_at: string | null;
  outcome: string;
  reason: string | null;
};

type Message = {
  id: string;
  sender_id: string;
  sender_role: "homeowner" | "vendor" | "admin";
  content: string;
  created_at: string;
};

type Action = { id: string; kind: string } | null;
type Mode = "loading" | "live" | "error";

const statuses = ["pending", "matched", "quoted", "scheduled", "in_progress", "pending_review", "vendor_completed", "homeowner_confirmed", "completed", "review_requested", "reviewed", "disputed", "resolved", "closed", "cancelled"];
const statusStyle: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  matched: "border-blue-200 bg-blue-50 text-blue-700",
  quoted: "border-violet-200 bg-violet-50 text-violet-700",
  scheduled: "border-blue-200 bg-blue-50 text-blue-700",
  in_progress: "border-accent/20 bg-accent/10 text-accent",
  pending_review: "border-amber-200 bg-amber-50 text-amber-700",
  vendor_completed: "border-amber-200 bg-amber-50 text-amber-700",
  homeowner_confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  review_requested: "border-violet-200 bg-violet-50 text-violet-700",
  reviewed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  disputed: "border-red-200 bg-red-50 text-red-700",
  resolved: "border-emerald-200 bg-emerald-50 text-emerald-700",
  closed: "border-border bg-muted text-muted-foreground",
  cancelled: "border-border bg-muted text-muted-foreground",
};
const outcomeStyle: Record<string, string> = {
  pending: "border-blue-200 bg-blue-50 text-blue-700",
  accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  declined: "border-amber-200 bg-amber-50 text-amber-700",
  expired: "border-red-200 bg-red-50 text-red-700",
  reassigned: "border-border bg-muted text-muted-foreground",
};

export default function AdminRequestsPage() {
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<ServiceRequest | null>(null);
  const [detailTab, setDetailTab] = useState("details");
  const [assignSearch, setAssignSearch] = useState("");
  const [attempts, setAttempts] = useState<MatchAttempt[]>([]);
  const [attemptError, setAttemptError] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [note, setNote] = useState("");
  const [action, setAction] = useState<Action>(null);

  const contractorNames = useMemo(() => Object.fromEntries(contractors.map((contractor) => [contractor.id, contractor.name])), [contractors]);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading");
    setError("");
    try {
      const supabase = createClient();
      const [requestResult, profileResult, contractorResult] = await Promise.all([
        supabase.from("service_requests").select("id, service_type, status, address, city, state, zip_code, preferred_date, preferred_time, created_at, updated_at, customer_id, contractor_id, description, notes, total_amount, quote_amount, assigned_at, match_expires_at, match_attempt_count, declined_contractor_ids, payment_status, needs_admin_review").order("created_at", { ascending: false }),
        supabase.from("profiles").select("user_id, full_name"),
        supabase.from("contractors").select("id, name, services, location, rating, jobs_completed, badges, is_active").order("name"),
      ]);
      const loadError = requestResult.error ?? profileResult.error ?? contractorResult.error;
      if (loadError) throw loadError;
      const nextRequests = ((requestResult.data ?? []) as ServiceRequest[]).map((request) => ({
        ...request,
        declined_contractor_ids: request.declined_contractor_ids ?? [],
      }));
      setRequests(nextRequests);
      setProfiles(Object.fromEntries(((profileResult.data ?? []) as { user_id: string; full_name: string | null }[]).map((profile) => [profile.user_id, profile.full_name || "Unknown"])));
      setContractors(((contractorResult.data ?? []) as Contractor[]).map((contractor) => ({
        ...contractor,
        services: contractor.services ?? [],
      })));
      setSelected((current) => current ? nextRequests.find((request) => request.id === current.id) ?? null : null);
      setMode("live");
    } catch (reason) {
      console.error("Unable to load admin requests", reason);
      setRequests([]);
      setError(reason instanceof Error ? reason.message : "Service requests could not be loaded.");
      setMode("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const loadAttempts = useCallback(async (requestId: string) => {
    setAttemptError("");
    const result = await createClient().from("job_match_attempts").select("id, contractor_id, attempt_number, offered_at, expires_at, responded_at, outcome, reason").eq("service_request_id", requestId).order("offered_at", { ascending: false });
    if (result.error) {
      setAttempts([]);
      setAttemptError(result.error.message);
    } else setAttempts((result.data ?? []) as MatchAttempt[]);
  }, []);

  const openDetail = (request: ServiceRequest) => {
    setSelected(request);
    setDetailTab("details");
    setAssignSearch("");
    setQuoteAmount(String(request.quote_amount ?? request.total_amount ?? ""));
    setNote(request.notes ?? "");
    void loadAttempts(request.id);
  };

  const runAction = async (request: ServiceRequest, kind: string, operation: () => Promise<{ error: { message: string } | null }>, success: string) => {
    setAction({ id: request.id, kind });
    try {
      const result = await operation();
      if (result.error) throw result.error;
      await load(false);
      if (selected?.id === request.id) await loadAttempts(request.id);
      toast.success(success);
    } catch (reason) {
      toast.error("Action could not be completed", { description: reason instanceof Error ? reason.message : "Please try again." });
    } finally {
      setAction(null);
    }
  };

  const assignVendor = async (request: ServiceRequest, contractor: Contractor) => {
    await runAction(request, "assign", async () => {
      const result = await createClient().rpc("admin_assign_contractor", { _job_id: request.id, _contractor_id: contractor.id });
      return { error: result.error };
    }, `${contractor.name} was assigned and the response window started.`);
  };

  const releaseMatch = async (request: ServiceRequest) => {
    if (!window.confirm("Release this vendor and return the request to matching?")) return;
    await runAction(request, "release", async () => {
      const result = await createClient().rpc("vendor_decline_job", { _job_id: request.id, _reason: "Released by admin for rematching" });
      return { error: result.error };
    }, "The match was released and the request returned to the unmatched queue.");
  };

  const changeStatus = async (request: ServiceRequest, status: string) => {
    if (status === request.status) return;
    await runAction(request, `status:${status}`, async () => {
      const result = await createClient().rpc("transition_job_status", { _job_id: request.id, _to_status: status });
      return { error: result.error };
    }, `Status changed to ${label(status)}.`);
  };

  const sendQuote = async (request: ServiceRequest) => {
    const amount = Number(quoteAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a quote amount greater than $0.");
      return;
    }
    if (!request.contractor_id) {
      toast.error("Assign a vendor before sending a quote.");
      return;
    }
    await runAction(request, "quote", async () => {
      const result = await createClient().rpc("admin_send_quote", { _job_id: request.id, _amount: amount });
      return { error: result.error };
    }, "The quote was recorded and sent into the homeowner approval workflow.");
  };

  const saveNote = async (request: ServiceRequest) => {
    await runAction(request, "note", async () => {
      const result = await createClient().from("service_requests").update({ notes: note.trim() || null }).eq("id", request.id);
      return { error: result.error };
    }, "Internal note saved.");
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return requests.filter((request) => {
      const matchesStatus = statusFilter === "all" || request.status === statusFilter;
      const values = [request.service_type, request.city, request.id, profiles[request.customer_id] ?? "", request.contractor_id ? contractorNames[request.contractor_id] ?? "" : ""];
      return matchesStatus && (!query || values.some((value) => value.toLowerCase().includes(query)));
    });
  }, [contractorNames, profiles, requests, search, statusFilter]);

  const matchingVendors = useMemo(() => {
    if (!selected) return [];
    const requestService = normalize(selected.service_type);
    const query = assignSearch.trim().toLowerCase();
    return contractors.filter((contractor) => contractor.is_active).map((contractor) => ({
      ...contractor,
      servicesMatch: contractor.services.some((service) => normalize(service).includes(requestService) || requestService.includes(normalize(service))),
      declined: selected.declined_contractor_ids.includes(contractor.id),
      trustScore: Math.min(100, Math.round(Number(contractor.rating ?? 0) * 15 + Number(contractor.jobs_completed ?? 0) * 0.3)),
    })).filter((contractor) => !query || contractor.name.toLowerCase().includes(query) || (contractor.location ?? "").toLowerCase().includes(query)).sort((a, b) => Number(a.declined) - Number(b.declined) || Number(b.servicesMatch) - Number(a.servicesMatch) || b.trustScore - a.trustScore);
  }, [assignSearch, contractors, selected]);

  if (mode === "loading") return <Loading />;
  if (mode === "error") return <ErrorState message={error} retry={() => void load(true)} />;

  const overdueCount = requests.filter(isOverdue).length;
  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
    <header><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Service operations</p><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="font-heading text-3xl font-semibold tracking-tight">Service Requests</h1><p className="mt-2 text-sm text-muted-foreground">{requests.length} live request{requests.length === 1 ? "" : "s"} across the platform</p></div><Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button></div></header>

    {overdueCount > 0 && <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 sm:flex-row sm:items-center"><AlertTriangle className="h-5 w-5 shrink-0" /><div><p className="text-sm font-medium">{overdueCount} matched request{overdueCount === 1 ? " is" : "s are"} overdue</p><p className="mt-0.5 text-xs text-red-700">Release the match for reassignment or coordinate directly with the vendor.</p></div><Button size="sm" variant="outline" className="sm:ml-auto" onClick={() => setStatusFilter("matched")}>View matched</Button></div>}

    <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search service, homeowner, vendor, city, or ID..." className="bg-card pl-9" /></div><select aria-label="Filter requests by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-52"><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></div>

    <Card><CardContent className="p-0">{filtered.length === 0 ? <Empty title={requests.length ? "No requests match these filters" : "No service requests yet"} /> : <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-sm"><thead className="border-b bg-muted/60"><tr className="text-left">{["Request", "Homeowner", "Vendor", "Location", "Preferred date", "Match", "Status", "Actions"].map((heading) => <th key={heading} className="whitespace-nowrap p-4 font-medium text-muted-foreground">{heading}</th>)}</tr></thead><tbody className="divide-y">{filtered.map((request) => { const overdue = isOverdue(request); return <tr key={request.id} className={cn("transition-colors hover:bg-muted/30", overdue && "bg-red-50/40")}><td className="p-4"><p className="font-medium">{request.service_type}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{request.id.slice(0, 10)}</p></td><td className="p-4">{profiles[request.customer_id] ?? "Unknown"}</td><td className="p-4">{request.contractor_id ? contractorNames[request.contractor_id] ?? "Unknown vendor" : <span className="text-muted-foreground">Unassigned</span>}</td><td className="p-4 text-muted-foreground">{request.city}, {request.state}</td><td className="p-4 text-muted-foreground">{request.preferred_date ? formatDate(request.preferred_date) : "Not set"}</td><td className="p-4 text-xs text-muted-foreground"><p className={cn(overdue && "font-medium text-red-700")}>{waitingLabel(request)}</p>{request.match_attempt_count > 1 && <p>{request.match_attempt_count} vendor attempts</p>}</td><td className="p-4"><div className="flex flex-wrap items-center gap-2"><Status status={request.status} />{(overdue || request.needs_admin_review) && <Badge variant="destructive"><AlertTriangle />{overdue ? "Overdue" : "Review"}</Badge>}</div></td><td className="p-4"><Button variant="ghost" size="sm" onClick={() => openDetail(request)}><Eye />Review</Button></td></tr>; })}</tbody></table></div>}</CardContent></Card>

    <RequestDialog request={selected} tab={detailTab} setTab={setDetailTab} profiles={profiles} contractorNames={contractorNames} vendors={matchingVendors} assignSearch={assignSearch} setAssignSearch={setAssignSearch} attempts={attempts} attemptError={attemptError} quoteAmount={quoteAmount} setQuoteAmount={setQuoteAmount} note={note} setNote={setNote} action={action} close={() => { if (!action) setSelected(null); }} assign={assignVendor} release={releaseMatch} changeStatus={changeStatus} sendQuote={sendQuote} saveNote={saveNote} />
  </div>;
}

type RankedContractor = Contractor & { servicesMatch: boolean; declined: boolean; trustScore: number };

function RequestDialog(props: {
  request: ServiceRequest | null;
  tab: string;
  setTab: (value: string) => void;
  profiles: Record<string, string>;
  contractorNames: Record<string, string>;
  vendors: RankedContractor[];
  assignSearch: string;
  setAssignSearch: (value: string) => void;
  attempts: MatchAttempt[];
  attemptError: string;
  quoteAmount: string;
  setQuoteAmount: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  action: Action;
  close: () => void;
  assign: (request: ServiceRequest, contractor: Contractor) => Promise<void>;
  release: (request: ServiceRequest) => Promise<void>;
  changeStatus: (request: ServiceRequest, status: string) => Promise<void>;
  sendQuote: (request: ServiceRequest) => Promise<void>;
  saveNote: (request: ServiceRequest) => Promise<void>;
}) {
  const request = props.request;
  if (!request) return null;
  const busy = props.action?.id === request.id;
  return <Dialog open onOpenChange={(open) => !open && props.close()}><DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-3xl"><DialogHeader><div className="flex flex-wrap items-center gap-2 pr-8"><DialogTitle>{request.service_type}</DialogTitle><Status status={request.status} /></div><DialogDescription>Request {request.id.slice(0, 8)} · submitted {formatDateTime(request.created_at)}</DialogDescription></DialogHeader><Tabs value={props.tab} onValueChange={props.setTab} className="min-h-0 flex-1 gap-0 overflow-hidden"><TabsList className="shrink-0 self-start"><TabsTrigger value="details"><Eye />Details</TabsTrigger><TabsTrigger value="chat"><MessageSquare />Chat</TabsTrigger></TabsList><TabsContent value="details" className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-4">
    <div className="grid gap-3 text-sm sm:grid-cols-2"><Detail icon={User} label="Homeowner">{props.profiles[request.customer_id] ?? "Unknown"}</Detail><Detail icon={UserCheck} label="Vendor">{request.contractor_id ? props.contractorNames[request.contractor_id] ?? "Unknown" : "Unassigned"}</Detail><Detail icon={MapPin} label="Address">{request.address}, {request.city}, {request.state} {request.zip_code}</Detail><Detail icon={Calendar} label="Preferred timing">{request.preferred_date ? formatDate(request.preferred_date) : "No date set"}{request.preferred_time && ` · ${request.preferred_time}`}</Detail><Detail icon={DollarSign} label="Amount">{request.total_amount === null ? "Quote required" : money(request.total_amount)}</Detail><Detail icon={CheckCircle2} label="Payment">{label(request.payment_status)}</Detail></div>
    {request.description && <section className="rounded-xl border bg-muted/30 p-4"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer scope</p><p className="whitespace-pre-wrap text-sm leading-6">{request.description}</p></section>}

    {(!request.contractor_id || request.status === "pending") && <section className="rounded-xl border-2 border-accent/30 bg-accent/5 p-4"><div className="mb-3 flex items-center gap-2"><UserCheck className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold">Assign Vendor</h3><Badge className="border-accent/20 bg-accent/10 text-[10px] text-accent">Smart Match</Badge></div><div className="relative mb-3"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search vendors..." value={props.assignSearch} onChange={(event) => props.setAssignSearch(event.target.value)} className="h-9 bg-card pl-9" /></div><div className="max-h-64 space-y-2 overflow-y-auto">{props.vendors.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">No eligible active vendors found.</p> : props.vendors.slice(0, 15).map((vendor) => <button key={vendor.id} type="button" disabled={busy || vendor.declined} onClick={() => void props.assign(request, vendor)} className={cn("flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50", vendor.servicesMatch && "border-accent/30")}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted font-bold text-muted-foreground">{vendor.name.charAt(0)}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium">{vendor.name}</span>{vendor.servicesMatch && <Badge className="border-accent/20 bg-accent/10 text-[10px] text-accent"><CheckCircle2 />Matches</Badge>}{vendor.declined && <Badge variant="destructive">Previously declined</Badge>}</span><span className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">{vendor.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{vendor.location}</span>}<span className="flex items-center gap-1"><Star className="h-3 w-3" />{vendor.rating ?? "—"}</span><span className="flex items-center gap-1"><Award className="h-3 w-3" />Trust {vendor.trustScore}</span><span>{vendor.jobs_completed ?? 0} jobs</span></span></span>{props.action?.kind === "assign" && <Loader2 className="animate-spin" />}</button>)}</div></section>}

    {request.contractor_id && request.status !== "pending" && <section className="rounded-xl border bg-muted/30 p-4"><div className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-accent" /><span className="font-medium">Assigned to {props.contractorNames[request.contractor_id] ?? "Unknown vendor"}</span></div>{request.status === "matched" && <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className={cn("text-xs text-muted-foreground", isOverdue(request) && "font-medium text-red-700")}>{waitingLabel(request)}{request.match_expires_at && ` · closes ${formatDateTime(request.match_expires_at)}`}</p><Button size="sm" variant="outline" disabled={busy} onClick={() => void props.release(request)}>{props.action?.kind === "release" && <Loader2 className="animate-spin" />}Release &amp; Rematch</Button></div>}</section>}

    {(props.attempts.length > 0 || props.attemptError) && <section className="rounded-xl border bg-muted/30 p-4"><div className="mb-2 flex justify-between"><h3 className="text-sm font-medium">Match History</h3><span className="text-xs text-muted-foreground">{props.attempts.length} attempt{props.attempts.length === 1 ? "" : "s"}</span></div>{props.attemptError ? <p className="text-xs text-destructive">History unavailable: {props.attemptError}</p> : <div className="space-y-2">{props.attempts.map((attempt) => <div key={attempt.id} className="flex items-center justify-between gap-3 text-xs"><div><p className="font-medium">#{attempt.attempt_number} {props.contractorNames[attempt.contractor_id] ?? "Vendor"}</p><p className="text-muted-foreground">Offered {formatDateTime(attempt.offered_at)}{attempt.reason ? ` · ${attempt.reason}` : ""}</p></div><Badge className={cn("border", outcomeStyle[attempt.outcome] ?? "bg-muted text-muted-foreground")}>{attempt.outcome}</Badge></div>)}</div>}</section>}

    <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Change Status</h3><div className="flex flex-wrap gap-2">{statuses.map((status) => <Button key={status} size="sm" variant={request.status === status ? "default" : "outline"} disabled={busy || request.status === status} onClick={() => void props.changeStatus(request, status)}>{props.action?.kind === `status:${status}` && <Loader2 className="animate-spin" />}{label(status)}</Button>)}</div><p className="mt-2 text-xs text-muted-foreground">The server state machine validates every transition. Invalid or unsafe transitions are rejected without changing the request.</p></section>

    <section className="rounded-xl border bg-muted/30 p-4"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quote / Pricing</h3><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className="flex-1 text-xs text-muted-foreground">Total amount ($)<Input type="number" min="0" step="0.01" value={props.quoteAmount} onChange={(event) => props.setQuoteAmount(event.target.value)} className="mt-1 bg-card" /></label><Button className="bg-violet-600 text-white hover:bg-violet-700" disabled={busy || !props.quoteAmount} onClick={() => void props.sendQuote(request)}>{props.action?.kind === "quote" && <Loader2 className="animate-spin" />}Send Quote</Button></div>{request.status === "quoted" && <p className="mt-2 text-xs text-violet-700">Current quote: {money(request.quote_amount ?? request.total_amount ?? 0)} · awaiting homeowner action.</p>}</section>

    <section><label htmlFor="admin-note" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal Notes</label><textarea id="admin-note" rows={4} value={props.note} onChange={(event) => props.setNote(event.target.value)} placeholder="Add internal operations notes..." className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" /><Button size="sm" className="mt-2" disabled={busy} onClick={() => void props.saveNote(request)}>{props.action?.kind === "note" ? <Loader2 className="animate-spin" /> : <Save />}Save Note</Button></section>
  </TabsContent><TabsContent value="chat" className="min-h-[460px] flex-1 overflow-hidden data-active:flex data-active:flex-col"><AdminChat key={request.id} requestId={request.id} homeowner={props.profiles[request.customer_id] ?? "Homeowner"} vendor={request.contractor_id ? props.contractorNames[request.contractor_id] ?? "Vendor" : "Vendor"} /></TabsContent></Tabs><DialogFooter><Button variant="outline" disabled={busy} onClick={props.close}>Close</Button></DialogFooter></DialogContent></Dialog>;
}

function AdminChat({ requestId, homeowner, vendor }: { requestId: string; homeowner: string; vendor: string }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const result = await createClient().from("messages").select("id, sender_id, sender_role, content, created_at").eq("service_request_id", requestId).order("created_at");
    if (result.error) setError(result.error.message);
    else setMessages((result.data ?? []) as Message[]);
    setLoading(false);
  }, [requestId]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`admin-messages:${requestId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `service_request_id=eq.${requestId}` }, (payload) => {
      const incoming = payload.new as Message;
      setMessages((current) => current.some((message) => message.id === incoming.id) ? current : [...current, incoming]);
    }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [requestId]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [messages]);

  const send = async () => {
    const content = text.trim();
    if (!content || !user || sending) return;
    setSending(true);
    const result = await createClient().from("messages").insert({ service_request_id: requestId, sender_id: user.id, sender_role: "admin", content }).select("id, sender_id, sender_role, content, created_at").single();
    setSending(false);
    if (result.error || !result.data) {
      toast.error("Message could not be sent", { description: result.error?.message ?? "Please try again." });
      return;
    }
    const sent = result.data as Message;
    setMessages((current) => current.some((message) => message.id === sent.id) ? current : [...current, sent]);
    setText("");
  };

  if (loading) return <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>;
  if (error) return <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-destructive">Chat unavailable: {error}</div>;
  return <div className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mx-auto max-w-2xl space-y-3">{messages.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No messages on this request.</p>}{messages.map((message) => { const mine = message.sender_id === user?.id; const sender = mine ? "You" : message.sender_role === "admin" ? "Mercurius Support" : message.sender_role === "vendor" ? vendor : homeowner; return <div key={message.id} className={cn("max-w-[82%] rounded-2xl px-4 py-3 text-sm", mine ? "ml-auto rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted")}><p className="mb-1 text-xs font-medium opacity-65">{sender}</p><p className="whitespace-pre-wrap break-words">{message.content}</p><p className="mt-1 text-right text-[11px] opacity-50">{formatDateTime(message.created_at)}</p></div>; })}<div ref={bottomRef} /></div></div><div className="flex gap-2 border-t p-4"><Input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void send(); } }} placeholder="Message the homeowner and vendor..." className="h-11" maxLength={2000} /><Button className="h-11" disabled={sending || !text.trim()} onClick={() => void send()}>{sending ? <Loader2 className="animate-spin" /> : <Send />}<span className="sr-only">Send</span></Button></div></div>;
}

function Status({ status }: { status: string }) { return <Badge className={cn("border capitalize", statusStyle[status] ?? "border-border bg-muted text-muted-foreground")}>{label(status)}</Badge>; }
function Detail({ icon: Icon, label: title, children }: { icon: ComponentType<{ className?: string }>; label: string; children: ReactNode }) { return <div className="rounded-lg border p-3"><p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className="h-4 w-4 text-accent" />{title}</p><div className="leading-5">{children}</div></div>; }
function Loading() { return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />Loading service requests...</div>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="mx-auto max-w-3xl p-6"><Card className="border-destructive/20 bg-destructive/5"><CardContent className="py-14 text-center"><AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" /><h1 className="text-xl font-semibold">Requests could not be loaded</h1><p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">No sample requests have been substituted. {message}</p><Button variant="outline" className="mt-5" onClick={retry}><RefreshCw />Try again</Button></CardContent></Card></div>; }
function Empty({ title }: { title: string }) { return <div className="py-16 text-center"><FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><p className="font-medium">{title}</p></div>; }
function isOverdue(request: ServiceRequest) { return request.status === "matched" && Boolean(request.match_expires_at && Date.parse(request.match_expires_at) < Date.now()); }
function waitingLabel(request: ServiceRequest) { if (request.status !== "matched" || !request.assigned_at) return "—"; const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(request.assigned_at)) / 60_000)); return minutes < 60 ? `${minutes}m waiting` : `${Math.floor(minutes / 60)}h ${minutes % 60}m waiting`; }
function normalize(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatDate(value: string) { const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date); }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
