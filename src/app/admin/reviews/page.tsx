"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Briefcase, Calendar, Eye, MessageSquare, RefreshCw, Search, Star, ThumbsDown, ThumbsUp, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type Review = { id: string; rating: number; comment: string | null; contractor_id: string; customer_id: string; service_request_id: string; created_at: string; visibility?: string };
type Feedback = { id: string; workmanship: number; punctuality: number; communication: number; would_recommend: boolean; internal_notes: string | null; contractor_id: string; customer_id: string; service_request_id: string; created_at: string };
type Mode = "loading" | "live" | "error";

export default function AdminReviewsPage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [contractors, setContractors] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"reviews" | "quality">("reviews");
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<Feedback | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading"); setError("");
    try {
      const supabase = createClient();
      const [reviewResult, feedbackResult, profileResult, contractorResult] = await Promise.all([
        supabase.from("reviews").select("id, rating, comment, contractor_id, customer_id, service_request_id, created_at, visibility").order("created_at", { ascending: false }),
        supabase.from("quality_feedback").select("id, workmanship, punctuality, communication, would_recommend, internal_notes, contractor_id, customer_id, service_request_id, created_at").order("created_at", { ascending: false }),
        supabase.from("profiles").select("user_id, full_name"),
        supabase.from("contractors").select("id, name"),
      ]);
      const firstError = reviewResult.error ?? feedbackResult.error ?? profileResult.error ?? contractorResult.error;
      if (firstError) throw firstError;
      setReviews((reviewResult.data ?? []) as Review[]); setFeedback((feedbackResult.data ?? []) as Feedback[]);
      setProfiles(Object.fromEntries(((profileResult.data ?? []) as { user_id: string; full_name: string }[]).map((row) => [row.user_id, row.full_name || "Unnamed homeowner"])));
      setContractors(Object.fromEntries(((contractorResult.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name])));
      setMode("live");
    } catch (reason) { console.error("Unable to load reviews", reason); setError(reason instanceof Error ? reason.message : "Reviews could not be loaded."); setMode("error"); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(true); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const deleteReview = async (review: Review) => {
    if (!window.confirm("Delete this public review? This cannot be undone.")) return;
    setDeleting(true);
    const result = await createClient().from("reviews").delete().eq("id", review.id);
    setDeleting(false);
    if (result.error) {
      toast.error("Review could not be deleted", { description: result.error.message });
      return;
    }
    setReviews((current) => current.filter((item) => item.id !== review.id)); setSelectedReview(null); toast.success("Review deleted");
  };

  const filteredReviews = useMemo(() => filter(reviews, search, (item) => [contractors[item.contractor_id] ?? "", profiles[item.customer_id] ?? "", item.comment ?? ""]), [contractors, profiles, reviews, search]);
  const filteredFeedback = useMemo(() => filter(feedback, search, (item) => [contractors[item.contractor_id] ?? "", profiles[item.customer_id] ?? "", item.internal_notes ?? ""]), [contractors, feedback, profiles, search]);
  const average = reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : null;
  const recommendRate = feedback.length ? Math.round(feedback.filter((item) => item.would_recommend).length / feedback.length * 100) : 0;
  if (mode === "loading") return <AdminLoading label="Loading reviews and quality feedback..." />;
  if (mode === "error") return <AdminError title="Reviews could not be loaded" message={error} retry={() => void load(true)} />;

  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Reputation operations</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Reviews &amp; Feedback</h1><p className="mt-2 text-sm text-muted-foreground">{reviews.length} public review{reviews.length === 1 ? "" : "s"} · {feedback.length} quality report{feedback.length === 1 ? "" : "s"}</p></div><Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button></header>
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[{ label: "Total Reviews", value: reviews.length }, { label: "Average Rating", value: average?.toFixed(1) ?? "—" }, { label: "Quality Reports", value: feedback.length }, { label: "Would Recommend", value: `${recommendRate}%` }].map((stat) => <Card key={stat.label}><CardContent className="py-4"><p className="text-xl font-semibold">{stat.value}</p><p className="mt-1 text-xs text-muted-foreground">{stat.label}</p></CardContent></Card>)}</div>
    <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search vendor, homeowner, or content..." className="bg-card pl-9" /></div><select value={tab} onChange={(event) => setTab(event.target.value as typeof tab)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-52"><option value="reviews">Public Reviews</option><option value="quality">Quality Feedback</option></select></div>
    <Card><CardContent className="p-0">{tab === "reviews" ? <ReviewsTable rows={filteredReviews} profiles={profiles} contractors={contractors} view={setSelectedReview} remove={deleteReview} deleting={deleting} /> : <FeedbackTable rows={filteredFeedback} profiles={profiles} contractors={contractors} view={setSelectedFeedback} />}</CardContent></Card>
    <Dialog open={Boolean(selectedReview)} onOpenChange={(open) => { if (!open && !deleting) setSelectedReview(null); }}><DialogContent>{selectedReview && <><DialogHeader><DialogTitle className="flex items-center gap-2">Review <span className="flex items-center gap-1 text-accent"><Star className="fill-accent" />{selectedReview.rating}/5</span></DialogTitle><DialogDescription>Service request {selectedReview.service_request_id}</DialogDescription></DialogHeader><div className="space-y-3"><Detail icon={User}>{profiles[selectedReview.customer_id] ?? "Unknown homeowner"}</Detail><Detail icon={Briefcase}>{contractors[selectedReview.contractor_id] ?? "Unknown vendor"}</Detail><Detail icon={Calendar}>{formatDateTime(selectedReview.created_at)}</Detail><Badge variant="outline">{label(selectedReview.visibility ?? "public")}</Badge><div className="rounded-xl bg-muted/40 p-4"><MessageSquare className="mb-2 h-4 w-4 text-muted-foreground" /><p>{selectedReview.comment || "No comment left."}</p></div><Button variant="destructive" disabled={deleting} onClick={() => void deleteReview(selectedReview)}><Trash2 />Delete Review</Button></div></>}</DialogContent></Dialog>
    <Dialog open={Boolean(selectedFeedback)} onOpenChange={(open) => { if (!open) setSelectedFeedback(null); }}><DialogContent>{selectedFeedback && <><DialogHeader><DialogTitle>Quality Feedback</DialogTitle><DialogDescription>Internal quality report for request {selectedFeedback.service_request_id}</DialogDescription></DialogHeader><div className="space-y-3"><Detail icon={User}>{profiles[selectedFeedback.customer_id] ?? "Unknown homeowner"}</Detail><Detail icon={Briefcase}>{contractors[selectedFeedback.contractor_id] ?? "Unknown vendor"}</Detail><Detail icon={Calendar}>{formatDateTime(selectedFeedback.created_at)}</Detail><div className="grid grid-cols-3 gap-3"><Score label="Workmanship" value={selectedFeedback.workmanship} /><Score label="Punctuality" value={selectedFeedback.punctuality} /><Score label="Communication" value={selectedFeedback.communication} /></div><div className="flex items-center gap-2 rounded-xl bg-muted/40 p-4">{selectedFeedback.would_recommend ? <><ThumbsUp className="text-emerald-600" /><span className="font-medium text-emerald-700">Would recommend</span></> : <><ThumbsDown className="text-destructive" /><span className="font-medium text-destructive">Would not recommend</span></>}</div>{selectedFeedback.internal_notes && <div className="rounded-xl bg-muted/40 p-4"><p className="mb-1 text-xs text-muted-foreground">Internal Notes</p><p>{selectedFeedback.internal_notes}</p></div>}</div></>}</DialogContent></Dialog>
  </div>;
}

function ReviewsTable({ rows, profiles, contractors, view, remove, deleting }: { rows: Review[]; profiles: Record<string, string>; contractors: Record<string, string>; view: (row: Review) => void; remove: (row: Review) => Promise<void>; deleting: boolean }) { if (!rows.length) return <AdminEmpty icon={Star} title="No reviews found" />; return <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><Head cells={["Homeowner", "Vendor", "Rating", "Comment", "Date", "Actions"]} /><tbody className="divide-y">{rows.map((row) => <tr key={row.id} className="hover:bg-muted/30"><td className="p-4">{profiles[row.customer_id] ?? "—"}</td><td className="p-4">{contractors[row.contractor_id] ?? "—"}</td><td className="p-4"><span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{row.rating}</span></td><td className="max-w-xs truncate p-4 text-muted-foreground">{row.comment || "—"}</td><td className="p-4 text-muted-foreground">{formatDate(row.created_at)}</td><td className="p-4"><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => view(row)}><Eye /></Button><Button variant="ghost" size="sm" disabled={deleting} className="text-destructive" onClick={() => void remove(row)}><Trash2 /></Button></div></td></tr>)}</tbody></table></div>; }
function FeedbackTable({ rows, profiles, contractors, view }: { rows: Feedback[]; profiles: Record<string, string>; contractors: Record<string, string>; view: (row: Feedback) => void }) { if (!rows.length) return <AdminEmpty icon={MessageSquare} title="No quality feedback found" />; return <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><Head cells={["Homeowner", "Vendor", "Work", "Punctual", "Communication", "Recommend", "Date", "Actions"]} /><tbody className="divide-y">{rows.map((row) => <tr key={row.id} className="hover:bg-muted/30"><td className="p-4">{profiles[row.customer_id] ?? "—"}</td><td className="p-4">{contractors[row.contractor_id] ?? "—"}</td><td className="p-4 font-medium">{row.workmanship}/5</td><td className="p-4 font-medium">{row.punctuality}/5</td><td className="p-4 font-medium">{row.communication}/5</td><td className="p-4">{row.would_recommend ? <ThumbsUp className="text-emerald-600" /> : <ThumbsDown className="text-destructive" />}</td><td className="p-4 text-muted-foreground">{formatDate(row.created_at)}</td><td className="p-4"><Button variant="ghost" size="sm" onClick={() => view(row)}><Eye /></Button></td></tr>)}</tbody></table></div>; }
function Head({ cells }: { cells: string[] }) { return <thead className="border-b bg-muted/60"><tr className="text-left">{cells.map((cell) => <th key={cell} className="p-4 font-medium text-muted-foreground">{cell}</th>)}</tr></thead>; }
function Detail({ icon: Icon, children }: { icon: typeof User; children: ReactNode }) { return <div className="flex items-center gap-2 rounded-lg border p-3 text-sm"><Icon className="h-4 w-4 text-muted-foreground" />{children}</div>; }
function Score({ label: scoreLabel, value }: { label: string; value: number }) { return <div className="rounded-xl bg-muted/40 p-3 text-center"><p className="text-xs text-muted-foreground">{scoreLabel}</p><p className={value >= 4 ? "text-lg font-bold text-emerald-600" : value >= 3 ? "text-lg font-bold text-amber-600" : "text-lg font-bold text-destructive"}>{value}/5</p></div>; }
function filter<T>(rows: T[], query: string, values: (row: T) => string[]) { const normalized = query.trim().toLowerCase(); return rows.filter((row) => !normalized || values(row).some((value) => value.toLowerCase().includes(normalized))); }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
