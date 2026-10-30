"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, MessageSquare, RefreshCw, Search, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatAppointment } from "@/lib/appointments";
import {
  formatAverage, historyDetail, historyLabel, MODERATION_CRITERIA, MODERATION_RULE, reviewErrorMessage, reviewStateLabel,
  type AdminReview, type AdminReviews, type ModerationCriterion, type ReviewState,
} from "@/lib/reviews/serviceReview";
import { createClient } from "@/lib/supabase/client";

// TRACE-130: one operations view of every review from the admin_reviews readback. Counts and the
// public average come from the server and match the public profile. Private feedback (legacy
// internal reviews and quality reports) is read-only and never moderated into public view.

type Feedback = { id: string; workmanship: number; punctuality: number; communication: number; would_recommend: boolean; internal_notes: string | null; contractor_id: string; service_request_id: string; created_at: string };
type Filter = "decision" | "published" | "rejected" | "private" | "all";
type Mode = "loading" | "live" | "error";

const filters: { value: Filter; label: string; states: ReviewState[] }[] = [
  { value: "decision", label: "Needs a decision", states: ["held_for_moderation", "appealed"] },
  { value: "published", label: "Public", states: ["published"] },
  { value: "rejected", label: "Not public", states: ["rejected"] },
  { value: "private", label: "Private feedback", states: ["private"] },
  { value: "all", label: "All reviews", states: ["published", "held_for_moderation", "rejected", "appealed", "private"] },
];

// The decisions an operator can record from each state (the server enforces the same list).
const decisions: Record<ReviewState, { state: "published" | "held_for_moderation" | "rejected"; label: string }[]> = {
  published: [{ state: "held_for_moderation", label: "Hide while checking" }, { state: "rejected", label: "Don't publish" }],
  held_for_moderation: [{ state: "published", label: "Publish" }, { state: "rejected", label: "Don't publish" }],
  rejected: [{ state: "published", label: "Publish" }],
  appealed: [{ state: "published", label: "Uphold appeal and publish" }, { state: "rejected", label: "Deny appeal" }],
  private: [],
};

export default function AdminReviewsPage() {
  const [data, setData] = useState<AdminReviews | null>(null);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [contractors, setContractors] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [tab, setTab] = useState<"reviews" | "quality">("reviews");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading");
    const supabase = createClient();
    const [reviewResult, feedbackResult, contractorResult] = await Promise.all([
      supabase.rpc("admin_reviews"),
      supabase.from("quality_feedback").select("id, workmanship, punctuality, communication, would_recommend, internal_notes, contractor_id, service_request_id, created_at").order("created_at", { ascending: false }),
      supabase.from("contractors").select("id, name"),
    ]);
    const firstError = reviewResult.error ?? feedbackResult.error ?? contractorResult.error;
    if (firstError) { setError(reviewErrorMessage(firstError, "Reviews could not be loaded.")); setMode("error"); return; }
    setData(reviewResult.data as unknown as AdminReviews);
    setFeedback((feedbackResult.data ?? []) as Feedback[]);
    setContractors(Object.fromEntries(((contractorResult.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name])));
    setError(""); setMode("live");
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(true); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const items = useMemo(() => {
    const states = filters.find((item) => item.value === filter)!.states;
    const query = search.trim().toLowerCase();
    return (data?.items ?? []).filter((item) => states.includes(item.state)
      && (!query || [item.contractor_name ?? "", item.author_name, item.service_type, item.comment ?? ""].some((value) => value.toLowerCase().includes(query))));
  }, [data, filter, search]);
  const selected = data?.items.find((item) => item.id === selectedId) ?? null;

  if (mode === "loading") return <AdminLoading label="Loading reviews and private feedback..." />;
  if (mode === "error" || !data) return <AdminError title="Reviews could not be loaded" message={error} retry={() => void load(true)} />;
  const counts = data.counts;
  const average = formatAverage(counts.public_average);

  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Reputation operations</p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Reviews &amp; Feedback</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{MODERATION_RULE}</p>
      </div>
      <Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button>
    </header>
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-5">
      {[
        { label: "Public reviews", value: String(counts.public) },
        { label: "Public average", value: average ?? "—" },
        { label: "Needs a decision", value: String(counts.held_for_moderation + counts.appealed) },
        { label: "Not public", value: String(counts.rejected) },
        { label: "Private feedback", value: String(counts.private + counts.quality_feedback) },
      ].map((stat) => <Card key={stat.label}><CardContent className="py-4"><dd className="text-xl font-semibold">{stat.value}</dd><dt className="mt-1 text-xs text-muted-foreground">{stat.label}</dt></CardContent></Card>)}
    </dl>
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search reviews" placeholder="Search provider, homeowner, service or text..." className="bg-card pl-9" /></div>
      <select aria-label="Records" value={tab} onChange={(event) => setTab(event.target.value as typeof tab)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-56">
        <option value="reviews">Reviews</option><option value="quality">Private quality reports (legacy)</option>
      </select>
      {tab === "reviews" && <select aria-label="Review state" value={filter} onChange={(event) => setFilter(event.target.value as Filter)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-52">
        {filters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>}
    </div>
    <Card><CardContent className="p-0">{tab === "reviews"
      ? <ReviewsTable rows={items} view={setSelectedId} />
      : <FeedbackTable rows={feedback} contractors={contractors} view={setSelectedFeedback} />}</CardContent></Card>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">{selected && <ReviewDetail review={selected} onSaved={() => load(false)} />}</DialogContent>
    </Dialog>
    <Dialog open={Boolean(selectedFeedback)} onOpenChange={(open) => { if (!open) setSelectedFeedback(null); }}><DialogContent>{selectedFeedback && <>
      <DialogHeader><DialogTitle>Private quality report</DialogTitle><DialogDescription>Legacy internal report for request {selectedFeedback.service_request_id}. Read-only; never published.</DialogDescription></DialogHeader>
      <div className="space-y-3 text-sm">
        <p>{contractors[selectedFeedback.contractor_id] ?? "Unknown provider"} · {formatAppointment(selectedFeedback.created_at)}</p>
        <div className="grid grid-cols-3 gap-3">{([["Workmanship", selectedFeedback.workmanship], ["Punctuality", selectedFeedback.punctuality], ["Communication", selectedFeedback.communication]] as const).map(([label, value]) => <div key={label} className="rounded-xl bg-muted/40 p-3 text-center"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}/5</p></div>)}</div>
        <p className="flex items-center gap-2">{selectedFeedback.would_recommend ? <><ThumbsUp className="h-4 w-4" />Would recommend</> : <><ThumbsDown className="h-4 w-4" />Would not recommend</>}</p>
        {selectedFeedback.internal_notes && <p className="rounded-xl bg-muted/40 p-4">{selectedFeedback.internal_notes}</p>}
      </div>
    </>}</DialogContent></Dialog>
  </div>;
}

function ReviewDetail({ review, onSaved }: { review: AdminReview; onSaved: () => Promise<void> }) {
  const [criterion, setCriterion] = useState<ModerationCriterion | "">(review.criterion ?? "");
  const moderate = async (state: "published" | "held_for_moderation" | "rejected", reason: string) => {
    const result = await createClient().rpc("moderate_job_review", { _review_id: review.id, _state: state, _reason: reason,
      _criterion: state === "published" ? undefined : criterion || undefined, _expected_version: review.moderation_version });
    if (result.error) {
      if (result.error.code === "40001") await onSaved();
      throw new Error(reviewErrorMessage(result.error, "The decision wasn't saved."));
    }
    toast.success("Moderation decision saved", { description: "The original review and earlier decisions stay in history." });
    await onSaved();
  };
  const options = decisions[review.state];
  return <>
    <DialogHeader>
      <DialogTitle className="flex flex-wrap items-center gap-2">{review.service_type}<Badge variant="outline">{reviewStateLabel(review.state)}</Badge></DialogTitle>
      <DialogDescription>{review.contractor_name ?? "Unknown provider"} · {review.author_name}{review.visit ? " · recurring visit" : ""}</DialogDescription>
    </DialogHeader>
    <div className="space-y-4 text-sm">
      <p className="flex items-center gap-1 font-semibold" aria-label={`${review.rating} out of 5 stars`}><Star className="h-4 w-4 fill-status-warning text-status-warning" aria-hidden="true" />{review.rating}/5</p>
      <p className="whitespace-pre-wrap rounded-xl bg-muted/40 p-4">{review.comment || "No written review."}</p>
      <p className="text-xs text-muted-foreground">Submitted {formatAppointment(review.created_at)}{review.edited_at ? ` · edited ${formatAppointment(review.edited_at)} (revision ${review.revision})` : ""}{review.criterion_label ? ` · ${review.criterion_label}` : ""}</p>
      {review.state === "private"
        ? <p className="rounded-lg border p-3 text-muted-foreground">Private feedback is never published or moderated (DEC-2026-009).</p>
        : <div className="space-y-3 rounded-xl border p-4">
          <p className="font-medium">Record a decision</p>
          <p className="text-muted-foreground">{MODERATION_RULE}</p>
          {options.some((option) => option.state !== "published") && <label className="block space-y-1">
            <span className="font-medium">Criterion (required to hide or not publish)</span>
            <select value={criterion} onChange={(event) => setCriterion(event.target.value as ModerationCriterion | "")} className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm">
              <option value="">Choose a criterion</option>
              {MODERATION_CRITERIA.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>}
          <div className="flex flex-wrap gap-2">{options.map((option) => <ConfirmAction key={option.state} requireReason
            disabled={option.state !== "published" && !criterion} triggerLabel={option.label} title={`${option.label}?`} entity={`${review.service_type} review`}
            consequence={option.state === "published" ? "The review becomes public and counts toward the provider's rating. The author is notified in the app." : "The review leaves the public profile and the rating. The author sees the criterion and your reason, and may correct or appeal."}
            reasonLabel="Reason the author will read" confirmLabel="Save decision" onConfirm={(reason) => moderate(option.state, reason)} />)}</div>
        </div>}
      {review.history.length > 0 && <div>
        <p className="mb-2 font-medium">History</p>
        <ol aria-label="Review history" className="space-y-2">{review.history.map((entry, index) => <li key={`${entry.at}-${index}`} className="border-l-2 border-accent/40 pl-3">
          <p className="font-medium">{historyLabel(entry)}</p>
          <p className="text-muted-foreground">{historyDetail(entry)}</p>
          <p className="text-muted-foreground">Reason: {entry.reason}</p>
          {entry.action === "corrected" && entry.previous && <p className="text-muted-foreground">Before: {entry.previous.rating}/5{entry.previous.comment ? ` — “${entry.previous.comment}”` : ""}</p>}
          {entry.ticket_id && <p className="text-muted-foreground">Appeal ticket {entry.ticket_id.slice(0, 8)}</p>}
        </li>)}</ol>
      </div>}
    </div>
  </>;
}

function ReviewsTable({ rows, view }: { rows: AdminReview[]; view: (id: string) => void }) {
  if (!rows.length) return <AdminEmpty icon={Star} title="No reviews in this view" description="Reviews appear after homeowners review completed services." />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm">
    <Head cells={["Service", "Provider", "Homeowner", "Rating", "State", "Submitted", "Actions"]} />
    <tbody className="divide-y">{rows.map((row) => <tr key={row.id} className="hover:bg-muted/30">
      <td className="p-4">{row.service_type}{row.visit && <span className="block text-xs text-muted-foreground">Recurring visit</span>}</td>
      <td className="p-4">{row.contractor_name ?? "—"}</td>
      <td className="p-4">{row.author_name}</td>
      <td className="p-4">{row.rating}/5</td>
      <td className="p-4"><Badge variant="outline">{reviewStateLabel(row.state)}</Badge>{row.criterion_label && <span className="block text-xs text-muted-foreground">{row.criterion_label}</span>}</td>
      <td className="p-4 text-muted-foreground">{formatAppointment(row.created_at)}</td>
      <td className="p-4"><Button variant="ghost" size="sm" onClick={() => view(row.id)}><Eye /><span className="sr-only">Open review of {row.service_type} by {row.author_name}</span></Button></td>
    </tr>)}</tbody>
  </table></div>;
}

function FeedbackTable({ rows, contractors, view }: { rows: Feedback[]; contractors: Record<string, string>; view: (row: Feedback) => void }) {
  if (!rows.length) return <AdminEmpty icon={MessageSquare} title="No private quality reports" description="Historical reports appear here read-only. Nothing creates new ones." />;
  return <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm">
    <Head cells={["Provider", "Work", "Punctual", "Communication", "Recommend", "Date", "Actions"]} />
    <tbody className="divide-y">{rows.map((row) => <tr key={row.id} className="hover:bg-muted/30">
      <td className="p-4">{contractors[row.contractor_id] ?? "—"}</td><td className="p-4">{row.workmanship}/5</td><td className="p-4">{row.punctuality}/5</td><td className="p-4">{row.communication}/5</td>
      <td className="p-4">{row.would_recommend ? "Yes" : "No"}</td><td className="p-4 text-muted-foreground">{formatAppointment(row.created_at)}</td>
      <td className="p-4"><Button variant="ghost" size="sm" onClick={() => view(row)}><Eye /><span className="sr-only">Open quality report</span></Button></td>
    </tr>)}</tbody>
  </table></div>;
}

function Head({ cells }: { cells: string[] }) { return <thead className="border-b bg-muted/60"><tr className="text-left">{cells.map((cell) => <th key={cell} scope="col" className="p-4 font-medium text-muted-foreground">{cell}</th>)}</tr></thead>; }
