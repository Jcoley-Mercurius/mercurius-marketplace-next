"use client";

import { JobOperations } from "@/components/dashboard/JobOperations";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
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
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Status as LifecycleStatus } from "@/components/ui/status";
import { canonicalRequestState, adminTransitionTargets } from "@/lib/lifecycle";
import { ConfirmAction } from "@/components/ui/confirm-action";
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
  matching_status: string;
  preferred_contractor_id: string | null;
  quote_revision?: number;
  frequency?: string | null;
  scheduled_start_at?: string | null;
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

type EligibleMatch = {
  contractor_id: string;
  contractor_name: string;
  package_id: string;
  package_tier_id: string | null;
  promotion_id: string | null;
  frequency: string;
  path: "fixed" | "quote";
  base_price: number | null;
  effective_price: number | null;
  median_fixed_price: number | null;
  fixed_score: number;
  profile_score: number;
  verification_score: number;
  price_band_score: number;
  response_score: number;
  freshness_score: number;
  total_score: number;
  preferred: boolean;
  score_breakdown: Record<string, number>;
  rank_order: number;
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
  pending: "border-status-warning bg-status-warning-bg text-status-warning",
  matched: "border-status-info bg-status-info-bg text-status-info",
  quoted: "border-status-info bg-status-info-bg text-status-info",
  scheduled: "border-status-info bg-status-info-bg text-status-info",
  in_progress: "border-accent/20 bg-accent/10 text-accent",
  pending_review: "border-status-warning bg-status-warning-bg text-status-warning",
  vendor_completed: "border-status-warning bg-status-warning-bg text-status-warning",
  homeowner_confirmed: "border-status-success bg-status-success-bg text-status-success",
  completed: "border-status-success bg-status-success-bg text-status-success",
  review_requested: "border-status-info bg-status-info-bg text-status-info",
  reviewed: "border-status-success bg-status-success-bg text-status-success",
  disputed: "border-status-danger bg-status-danger-bg text-status-danger",
  resolved: "border-status-success bg-status-success-bg text-status-success",
  closed: "border-border bg-muted text-muted-foreground",
  cancelled: "border-border bg-muted text-muted-foreground",
};
const outcomeStyle: Record<string, string> = {
  pending: "border-status-info bg-status-info-bg text-status-info",
  accepted: "border-status-success bg-status-success-bg text-status-success",
  declined: "border-status-warning bg-status-warning-bg text-status-warning",
  expired: "border-status-danger bg-status-danger-bg text-status-danger",
  withdrawn: "border-border bg-muted text-muted-foreground",
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
  const [eligibleMatches, setEligibleMatches] = useState<EligibleMatch[]>([]);
  const [eligibleError, setEligibleError] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const [actionError, setActionError] = useState("");
  const [quoteAmount, setQuoteAmount] = useState("");
  const [quoteReason, setQuoteReason] = useState("");
  const [note, setNote] = useState("");
  const [action, setAction] = useState<Action>(null);

  const contractorNames = useMemo(() => Object.fromEntries(contractors.map((contractor) => [contractor.id, contractor.name])), [contractors]);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading");
    setError("");
    try {
      const supabase = createClient();
      const expiryResult = await supabase.rpc("expire_stale_matches");
      if (expiryResult.error) console.warn("Unable to expire stale offers", expiryResult.error.message);
      const [requestResult, profileResult, contractorResult] = await Promise.all([
        supabase.from("service_requests").select("id, service_type, status, address, city, state, zip_code, preferred_date, preferred_time, created_at, updated_at, customer_id, contractor_id, description, notes, total_amount, quote_amount, assigned_at, match_expires_at, match_attempt_count, declined_contractor_ids, payment_status, needs_admin_review, matching_status, preferred_contractor_id, quote_revision, frequency, scheduled_start_at").order("created_at", { ascending: false }),
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

  const loadEligible = useCallback(async (requestId: string) => {
    setEligibleError("");
    const result = await createClient().rpc("find_eligible_packages", { _request_id: requestId });
    if (result.error) {
      setEligibleMatches([]);
      setEligibleError(result.error.message);
    } else setEligibleMatches((result.data ?? []) as EligibleMatch[]);
  }, []);

  const openDetail = (request: ServiceRequest) => {
    setQuoteError("");
    setActionError("");
    setSelected(request);
    setDetailTab("details");
    setAssignSearch("");
    setQuoteReason("");
    setQuoteAmount(String(request.quote_amount ?? request.total_amount ?? ""));
    setNote(request.notes ?? "");
    void loadAttempts(request.id);
    void loadEligible(request.id);
  };

  const runAction = async (request: ServiceRequest, kind: string, operation: () => Promise<{ error: { message: string } | null }>, success: string) => {
    setActionError("");
    setAction({ id: request.id, kind });
    try {
      const result = await operation();
      if (result.error) throw result.error;
      await load(false);
      if (selected?.id === request.id) {
        await Promise.all([loadAttempts(request.id), loadEligible(request.id)]);
      }
      toast.success(success);
      return true;
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Action could not be completed. Please try again.");
      return false;
    } finally {
      setAction(null);
    }
  };

  const assignVendor = async (request: ServiceRequest, candidate: EligibleMatch, reason: string) => {
    const assigned = await runAction(request, "assign", async () => {
      const result = await createClient().rpc("create_job_offer", {
        _request_id: request.id,
        _contractor_id: candidate.contractor_id,
        _package_id: candidate.package_id,
        _package_tier_id: candidate.package_tier_id,
        _force: true,
        _reason: reason,
      });
      return { error: result.error };
    }, `${candidate.contractor_name} received an exclusive four-hour offer.`);
    if (!assigned) throw new Error("The offer was not saved.");
  };

  const offerNext = async (request: ServiceRequest) => {
    await runAction(request, "next", async () => {
      const result = await createClient().rpc("offer_next_for_request", { _request_id: request.id });
      return { error: result.error };
    }, "Matching checked for another eligible provider. If none remain, service is not available yet in your area.");
  };

  const releaseMatch = async (request: ServiceRequest, reason: string) => {
    const released = await runAction(request, "release", async () => {
      const result = await createClient().rpc("release_job_match", { _job_id: request.id, _contractor_id: request.contractor_id!, _outcome: "withdrawn", _reason: reason });
      return { error: result.error };
    }, "The match was released and the request returned to the unmatched queue.");
    if (!released) throw new Error("The match could not be released. Please try again.");
  };

  const changeStatus = async (request: ServiceRequest, status: string, reason: string) => {
    if (status === request.status) return;
    const changed = await runAction(request, `status:${status}`, async () => {
      const result = await createClient().rpc("transition_job_status", { _job_id: request.id, _to_status: status, _reason: reason });
      return { error: result.error };
    }, `Status changed to ${label(status)}.`);
    if (!changed) throw new Error("The status change was not saved.");
  };

  const sendQuote = async (request: ServiceRequest) => {
    setQuoteError("");
    const amount = Number(quoteAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setQuoteError("Enter a quote amount greater than $0.");
      document.getElementById("quote-amount")?.focus();
      return;
    }
    if (!request.contractor_id) {
      setQuoteError("Assign a vendor before sending a quote.");
      document.getElementById("quote-amount")?.focus();
      return;
    }
    if (!quoteReason.trim()) {
      setQuoteError("Explain why this quote is being sent.");
      document.getElementById("quote-reason")?.focus();
      return;
    }
    await runAction(request, "quote", async () => {
      const result = await createClient().rpc("admin_send_quote", { _job_id: request.id, _amount: amount, _reason: quoteReason.trim(), _expected_revision: request.quote_revision ?? 0 });
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

  const visibleEligibleMatches = useMemo(() => {
    const query = assignSearch.trim().toLowerCase();
    return eligibleMatches.filter((candidate) => !query || candidate.contractor_name.toLowerCase().includes(query));
  }, [assignSearch, eligibleMatches]);

  if (mode === "loading") return <Loading />;
  if (mode === "error") return <ErrorState message={error} retry={() => void load(true)} />;

  const overdueCount = requests.filter(isOverdue).length;
  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
    <header><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Service operations</p><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="font-heading text-3xl font-semibold tracking-tight">Service Requests</h1><p className="mt-2 text-sm text-muted-foreground">{requests.length} live request{requests.length === 1 ? "" : "s"} across the platform</p></div><Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button></div></header>

    {overdueCount > 0 && <div className="flex flex-col gap-3 rounded-xl border border-status-danger bg-status-danger-bg p-4 text-status-danger sm:flex-row sm:items-center"><AlertTriangle className="h-5 w-5 shrink-0" /><div><p className="text-sm font-medium">{overdueCount} matched request{overdueCount === 1 ? " is" : "s are"} overdue</p><p className="mt-0.5 text-xs text-status-danger">Release the match for reassignment or coordinate directly with the vendor.</p></div><Button size="sm" variant="outline" className="sm:ml-auto" onClick={() => setStatusFilter("matched")}>View matched</Button></div>}

    <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search requests" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search service, homeowner, vendor, city, or ID..." className="bg-card pl-9" /></div><Select aria-label="Filter requests by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-52"><option value="all">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{label(status)}</option>)}</Select></div>

    <Card><CardContent className="p-0">{filtered.length === 0 ? <Empty title={requests.length ? "No requests match these filters" : "No service requests yet"} /> : <ResponsiveDataList label="Service requests" rows={filtered} rowKey={request => request.id} rowLabel={request => `${request.service_type} · ${request.id.slice(0, 10)}`} columns={[
      { key: "request", label: "Request", render: request => <><p className="font-medium">{request.service_type}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{request.id.slice(0, 10)}</p></> },
      { key: "homeowner", label: "Homeowner", render: request => profiles[request.customer_id] ?? "Unknown" },
      { key: "vendor", label: "Vendor", render: request => request.contractor_id ? contractorNames[request.contractor_id] ?? "Unknown vendor" : "Unassigned" },
      { key: "location", label: "Location", render: request => `${request.city}, ${request.state}` },
      { key: "date", label: "Preferred date", render: request => request.preferred_date ? formatDate(request.preferred_date) : "Not set" },
      { key: "match", label: "Match", render: request => <><p className={cn(isOverdue(request) && "font-medium text-status-danger")}>{waitingLabel(request)}</p>{request.match_attempt_count > 1 && <p>{request.match_attempt_count} vendor attempts</p>}</> },
      { key: "status", label: "Status", render: request => <div className="flex flex-wrap gap-2"><Status status={request.status} matchingStatus={request.matching_status} />{(isOverdue(request) || request.needs_admin_review) && <Badge variant="destructive">{isOverdue(request) ? "Overdue" : "Review"}</Badge>}</div> },
      { key: "actions", label: "Actions", render: request => <Button variant="outline" size="sm" aria-label={`Review ${request.service_type} ${request.id.slice(0, 10)}`} onClick={() => openDetail(request)}><Eye />Review</Button> },
    ]} />}</CardContent></Card>

    <RequestDialog saved={() => { void load(false); if (selected) { void loadAttempts(selected.id); void loadEligible(selected.id); } }} quoteReason={quoteReason} setQuoteReason={setQuoteReason} quoteError={quoteError} actionError={actionError} request={selected} tab={detailTab} setTab={setDetailTab} profiles={profiles} contractorNames={contractorNames} candidates={visibleEligibleMatches} eligibleError={eligibleError} assignSearch={assignSearch} setAssignSearch={setAssignSearch} attempts={attempts} attemptError={attemptError} quoteAmount={quoteAmount} setQuoteAmount={setQuoteAmount} note={note} setNote={setNote} action={action} close={() => { if (!action) setSelected(null); }} assign={assignVendor} offerNext={offerNext} release={releaseMatch} changeStatus={changeStatus} sendQuote={sendQuote} saveNote={saveNote} />
  </div>;
}

function RequestDialog(props: {
  saved: () => void;
  quoteError: string;
  actionError: string;
  request: ServiceRequest | null;
  tab: string;
  setTab: (value: string) => void;
  profiles: Record<string, string>;
  contractorNames: Record<string, string>;
  candidates: EligibleMatch[];
  eligibleError: string;
  assignSearch: string;
  setAssignSearch: (value: string) => void;
  attempts: MatchAttempt[];
  attemptError: string;
  quoteReason: string;
  setQuoteReason: (value: string) => void;
  quoteAmount: string;
  setQuoteAmount: (value: string) => void;
  note: string;
  setNote: (value: string) => void;
  action: Action;
  close: () => void;
  assign: (request: ServiceRequest, candidate: EligibleMatch, reason: string) => Promise<void>;
  offerNext: (request: ServiceRequest) => Promise<void>;
  release: (request: ServiceRequest, reason: string) => Promise<void>;
  changeStatus: (request: ServiceRequest, status: string, reason: string) => Promise<void>;
  sendQuote: (request: ServiceRequest) => Promise<void>;
  saveNote: (request: ServiceRequest) => Promise<void>;
}) {
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (props.actionError && !document.querySelector('[role=alertdialog]')) errorRef.current?.focus(); }, [props.actionError]);
  const request = props.request;
  if (!request) return null;
  const busy = props.action?.id === request.id;
  return <Dialog open onOpenChange={(open) => !open && props.close()}><DialogContent showCloseButton={!busy} className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-3xl"><DialogHeader><div className="flex flex-wrap items-center gap-2 pr-8"><DialogTitle>{request.service_type}</DialogTitle><Status status={request.status} matchingStatus={request.matching_status} /></div><DialogDescription>Request {request.id.slice(0, 8)} · submitted {formatDateTime(request.created_at)}</DialogDescription></DialogHeader><Tabs value={props.tab} onValueChange={props.setTab} className="min-h-0 flex-1 gap-0 overflow-hidden"><TabsList className="shrink-0 self-start"><TabsTrigger value="details"><Eye />Details</TabsTrigger><TabsTrigger value="chat"><MessageSquare />Chat</TabsTrigger></TabsList><TabsContent value="details" className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-4">
    {props.actionError && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{props.actionError}</p>}
    <div className="grid gap-3 text-sm sm:grid-cols-2"><Detail icon={User} label="Homeowner">{props.profiles[request.customer_id] ?? "Unknown"}</Detail><Detail icon={UserCheck} label="Vendor">{request.contractor_id ? props.contractorNames[request.contractor_id] ?? "Unknown" : "Unassigned"}</Detail><Detail icon={MapPin} label="Address">{request.address}, {request.city}, {request.state} {request.zip_code}</Detail><Detail icon={Calendar} label="Preferred timing">{request.preferred_date ? formatDate(request.preferred_date) : "No date set"}{request.preferred_time && ` · ${request.preferred_time}`}</Detail><Detail icon={DollarSign} label="Amount">{request.total_amount === null ? "Quote required" : money(request.total_amount)}</Detail><Detail icon={CheckCircle2} label="Payment">{label(request.payment_status)}</Detail></div>
    {request.description && <section className="rounded-xl border bg-muted/30 p-4"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer scope</p><p className="whitespace-pre-wrap text-sm leading-6">{request.description}</p></section>}

    <section className="rounded-xl border-2 border-accent/30 bg-accent/5 p-4"><div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center"><div className="flex flex-wrap items-center gap-2"><UserCheck className="h-4 w-4 text-accent" /><h3 className="text-sm font-semibold">Eligible Provider Ranking</h3><Badge className="border-accent/20 bg-accent/10 text-xs text-accent">Live rules</Badge></div><Button size="sm" className="sm:ml-auto" disabled={busy} onClick={() => void props.offerNext(request)}>{props.action?.kind === "next" ? <Loader2 className="animate-spin" /> : <ArrowRight />}Offer next</Button></div><p className="mb-3 text-xs text-muted-foreground">Only active, marketing-enabled providers with matching packages and ZIP coverage appear. Raw scores are for operations only.</p><div className="relative mb-3"><Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search eligible providers" placeholder="Search eligible providers..." value={props.assignSearch} onChange={(event) => props.setAssignSearch(event.target.value)} className="h-9 bg-card pl-9" /></div>{props.eligibleError ? <p className="py-4 text-center text-sm text-destructive">Eligibility unavailable: {props.eligibleError}</p> : <div className="max-h-80 space-y-2 overflow-y-auto">{props.candidates.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Not available yet in your area. No eligible providers remain for this service, frequency, and ZIP.</p> : props.candidates.slice(0, 20).map((candidate) => <div key={`${candidate.contractor_id}:${candidate.package_id}:${candidate.package_tier_id ?? "quote"}`} className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-bold text-muted-foreground">#{candidate.rank_order}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium">{candidate.contractor_name}</span><Badge variant="outline" className="text-xs">{candidate.path === "fixed" ? "Fixed" : "Quote"}</Badge>{candidate.preferred && <Badge className="border-accent/20 bg-accent/10 text-xs text-accent">Homeowner preference</Badge>}</span><span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span>Score {Number(candidate.total_score).toFixed(1)}</span><span>Profile +{Number(candidate.profile_score).toFixed(1)}</span><span>Credentials +{Number(candidate.verification_score).toFixed(0)}</span><span>Price band +{Number(candidate.price_band_score).toFixed(0)}</span><span>History +{Number(candidate.response_score).toFixed(1)}</span><span>Freshness +{Number(candidate.freshness_score).toFixed(0)}</span></span></span><div className="flex items-center justify-between gap-3 sm:justify-end"><span className="text-sm font-semibold">{candidate.path === "fixed" && candidate.effective_price !== null ? money(Number(candidate.effective_price)) : "Quote"}</span><ConfirmAction disabled={busy} requireReason triggerLabel="Force offer" title="Replace the current provider offer?" entity={candidate.contractor_name} consequence="The current offer will be withdrawn and this eligible provider will receive an exclusive four-hour offer. Homeowner fallback consent is still required." confirmLabel="Send offer" onConfirm={reason => props.assign(request, candidate, reason)} /></div></div>)}</div>}</section>

    {request.contractor_id && request.status !== "pending" && <section className="rounded-xl border bg-muted/30 p-4"><div className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-accent" /><span className="font-medium">Assigned to {props.contractorNames[request.contractor_id] ?? "Unknown vendor"}</span></div>{request.status === "matched" && <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className={cn("text-xs text-muted-foreground", isOverdue(request) && "font-medium text-status-danger")}>{waitingLabel(request)}{request.match_expires_at && ` · closes ${formatDateTime(request.match_expires_at)}`}</p><ConfirmAction disabled={busy} requireReason triggerLabel="Release match" title="Release this vendor?" entity={`${request.service_type} · ${request.id.slice(0, 8)}`} consequence="The vendor assignment will be released and the request returned to matching." confirmLabel="Release match" onConfirm={reason => props.release(request, reason)} /></div>}</section>}

    {(props.attempts.length > 0 || props.attemptError) && <section className="rounded-xl border bg-muted/30 p-4"><div className="mb-2 flex justify-between"><h3 className="text-sm font-medium">Match History</h3><span className="text-xs text-muted-foreground">{props.attempts.length} attempt{props.attempts.length === 1 ? "" : "s"}</span></div>{props.attemptError ? <p className="text-xs text-destructive">History unavailable: {props.attemptError}</p> : <div className="space-y-2">{props.attempts.map((attempt) => <div key={attempt.id} className="flex items-center justify-between gap-3 text-xs"><div><p className="font-medium">#{attempt.attempt_number} {props.contractorNames[attempt.contractor_id] ?? "Vendor"}</p><p className="text-muted-foreground">Offered {formatDateTime(attempt.offered_at)}{attempt.reason ? ` · ${attempt.reason}` : ""}</p></div><Badge className={cn("border", outcomeStyle[attempt.outcome] ?? "bg-muted text-muted-foreground")}>{attempt.outcome}</Badge></div>)}</div>}</section>}

    {request.scheduled_start_at && <p>Appointment: {new Date(request.scheduled_start_at).toLocaleString("en-US", { timeZone: "America/New_York" })} Eastern</p>}
    {["pending", "matched", "quoted", "scheduled", "in_progress"].includes(request.status) && <JobOperations key={request.id} jobId={request.id} role="admin" onSaved={props.saved} recurring={!!request.frequency && request.frequency !== "one-time"} />}
    <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Change Status</h3><div className="flex flex-wrap gap-2">{adminTransitionTargets(request.status).map((status) => <ConfirmAction key={status} disabled={busy || request.status === status} requireReason triggerLabel={label(status)} title="Change request status?" entity={`${request.service_type} · ${request.id.slice(0, 8)}`} consequence={`Change this request to ${label(status)}. Your reason will be recorded in its history.`} confirmLabel={`Change to ${label(status)}`} onConfirm={reason => props.changeStatus(request, status, reason)} />)}</div><p className="mt-2 text-xs text-muted-foreground">The server state machine validates every transition. Invalid or unsafe transitions are rejected without changing the request.</p></section>

    <section className="rounded-xl border bg-muted/30 p-4"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quote / Pricing</h3><FormField id="quote-reason" label="Quote reason" required>{control => <Textarea {...control} value={props.quoteReason} onChange={event => props.setQuoteReason(event.target.value)} maxLength={1000} />}</FormField><div className="flex flex-col gap-3 sm:flex-row sm:items-end"><div className="min-w-0 flex-1"><FormField id="quote-amount" label="Total amount ($)" error={props.quoteError} required>{control => <Input {...control} type="number" min="0" step="0.01" value={props.quoteAmount} onChange={(event) => props.setQuoteAmount(event.target.value)} className="bg-card" />}</FormField></div><Button className="bg-commitment text-commitment-foreground hover:bg-commitment-hover" disabled={busy || !props.quoteAmount} onClick={() => void props.sendQuote(request)}>{props.action?.kind === "quote" && <Loader2 className="animate-spin" />}Send Quote</Button></div>{request.status === "quoted" && <p className="mt-2 text-xs text-status-info">Current quote: {money(request.quote_amount ?? request.total_amount ?? 0)} · awaiting homeowner action.</p>}</section>

    <section><label htmlFor="admin-note" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Internal Notes</label><Textarea id="admin-note" rows={4} value={props.note} onChange={(event) => props.setNote(event.target.value)} placeholder="Add internal operations notes..." className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" /><Button size="sm" className="mt-2" disabled={busy} onClick={() => void props.saveNote(request)}>{props.action?.kind === "note" ? <Loader2 className="animate-spin" /> : <Save />}Save Note</Button></section>
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
  return <div className="flex min-h-0 flex-1 flex-col"><div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="mx-auto max-w-2xl space-y-3">{messages.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No messages on this request.</p>}{messages.map((message) => { const mine = message.sender_id === user?.id; const sender = mine ? "You" : message.sender_role === "admin" ? "Mercurius Support" : message.sender_role === "vendor" ? vendor : homeowner; return <div key={message.id} className={cn("max-w-[82%] rounded-2xl px-4 py-3 text-sm", mine ? "ml-auto rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted")}><p className="mb-1 text-xs font-medium opacity-65">{sender}</p><p className="whitespace-pre-wrap break-words">{message.content}</p><p className="mt-1 text-right text-xs opacity-50">{formatDateTime(message.created_at)}</p></div>; })}<div ref={bottomRef} /></div></div><div className="flex gap-2 border-t p-4"><Input aria-label="Message the homeowner and vendor" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void send(); } }} placeholder="Message the homeowner and vendor..." className="h-11" maxLength={2000} /><Button className="h-11" disabled={sending || !text.trim()} onClick={() => void send()}>{sending ? <Loader2 className="animate-spin" /> : <Send />}<span className="sr-only">Send</span></Button></div></div>;
}

function Status({ status, matchingStatus }: { status: string; matchingStatus?: string }) { if (statuses.includes(status)) return <LifecycleStatus state={canonicalRequestState(status as Parameters<typeof canonicalRequestState>[0], matchingStatus)} />; return <Badge className={cn("border capitalize", statusStyle[status] ?? "border-border bg-muted text-muted-foreground")}>{label(status)}</Badge>; }
function Detail({ icon: Icon, label: title, children }: { icon: ComponentType<{ className?: string }>; label: string; children: ReactNode }) { return <div className="rounded-lg border p-3"><p className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground"><Icon className="h-4 w-4 text-accent" />{title}</p><div className="leading-5">{children}</div></div>; }
function Loading() { return <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />Loading service requests...</div>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="mx-auto max-w-3xl p-6"><Card className="border-destructive/20 bg-destructive/5"><CardContent className="py-14 text-center"><AlertCircle className="mx-auto mb-4 h-10 w-10 text-destructive" /><h1 className="text-xl font-semibold">Requests could not be loaded</h1><p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">No sample requests have been substituted. {message}</p><Button variant="outline" className="mt-5" onClick={retry}><RefreshCw />Try again</Button></CardContent></Card></div>; }
function Empty({ title }: { title: string }) { return <div className="py-16 text-center"><FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><p className="font-medium">{title}</p></div>; }
function isOverdue(request: ServiceRequest) { return request.status === "matched" && Boolean(request.match_expires_at && Date.parse(request.match_expires_at) < Date.now()); }
function waitingLabel(request: ServiceRequest) { if (request.status !== "matched" || !request.assigned_at) return "—"; const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(request.assigned_at)) / 60_000)); return minutes < 60 ? `${minutes}m waiting` : `${Math.floor(minutes / 60)}h ${minutes % 60}m waiting`; }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatDate(value: string) { const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date); }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
