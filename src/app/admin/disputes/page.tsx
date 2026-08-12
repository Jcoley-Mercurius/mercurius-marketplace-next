/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Calendar, CheckCircle2, Eye, ImageIcon, Loader2, MapPin, Pause, Play, RefreshCw, Search, User } from "lucide-react";
import { toast } from "sonner";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";

type Dispute = { id: string; service_type: string; address: string; city: string; state: string; zip_code: string | null; status: string; customer_id: string; contractor_id: string | null; total_amount: number | null; dispute_reason: string | null; disputed_at: string | null; dispute_resolved_at: string | null; dispute_resolution: string | null; disputed: boolean; created_at: string };
type Photo = { id: string; service_request_id: string; photo_url: string; caption: string | null; uploader_role: string; photo_type: string; visit_date: string; created_at: string };
type Vendor = { id: string; name: string; payouts_paused: boolean; payouts_paused_reason: string | null; payouts_paused_at: string | null; jobs_completed: number | null };
type Mode = "loading" | "live" | "error";

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState<Dispute[]>([]); const [vendors, setVendors] = useState<Vendor[]>([]); const [profiles, setProfiles] = useState<Record<string, string>>({}); const [photos, setPhotos] = useState<Record<string, Photo[]>>({});
  const [mode, setMode] = useState<Mode>("loading"); const [error, setError] = useState(""); const [search, setSearch] = useState(""); const [selected, setSelected] = useState<Dispute | null>(null); const [resolution, setResolution] = useState(""); const [pauseTarget, setPauseTarget] = useState<Vendor | null>(null); const [pauseReason, setPauseReason] = useState(""); const [saving, setSaving] = useState(false);
  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading"); setError("");
    try {
      const supabase = createClient();
      const [disputeResult, vendorResult, profileResult] = await Promise.all([
        supabase.from("service_requests").select("id, service_type, address, city, state, zip_code, status, customer_id, contractor_id, total_amount, dispute_reason, disputed_at, dispute_resolved_at, dispute_resolution, disputed, created_at").eq("disputed", true).order("disputed_at", { ascending: false }),
        supabase.from("contractors").select("id, name, payouts_paused, payouts_paused_reason, payouts_paused_at, jobs_completed").order("name"),
        supabase.from("profiles").select("user_id, full_name"),
      ]);
      const firstError = disputeResult.error ?? vendorResult.error ?? profileResult.error; if (firstError) throw firstError;
      const nextDisputes = (disputeResult.data ?? []) as Dispute[]; const nextPhotos: Record<string, Photo[]> = {};
      if (nextDisputes.length) { const photoResult = await supabase.from("job_photos").select("id, service_request_id, photo_url, caption, uploader_role, photo_type, visit_date, created_at").in("service_request_id", nextDisputes.map((item) => item.id)).order("visit_date", { ascending: false }); if (photoResult.error) throw photoResult.error; for (const photo of (photoResult.data ?? []) as Photo[]) { nextPhotos[photo.service_request_id] ??= []; nextPhotos[photo.service_request_id].push(photo); } }
      setDisputes(nextDisputes); setVendors((vendorResult.data ?? []) as Vendor[]); setProfiles(Object.fromEntries(((profileResult.data ?? []) as { user_id: string; full_name: string }[]).map((row) => [row.user_id, row.full_name || "Unnamed homeowner"]))); setPhotos(nextPhotos); setMode("live");
    } catch (reason) { console.error("Unable to load disputes", reason); setError(reason instanceof Error ? reason.message : "Disputes could not be loaded."); setMode("error"); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(true); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const resolve = async (markResolved: boolean) => {
    if (!selected) return;
    const notes = resolution.trim();
    if (markResolved && !notes) {
      toast.error("Resolution notes required", { description: "Document the outcome before resolving this dispute." });
      return;
    }

    setSaving(true);
    try {
      const supabase = createClient();
      const disputeResult = await supabase
        .from("disputes")
        .select("id")
        .eq("job_id", selected.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (disputeResult.error) throw disputeResult.error;
      if (!disputeResult.data) {
        throw new Error("This legacy flag has no canonical dispute record. It was not changed; review the request before attempting a state transition.");
      }

      const result = await supabase.rpc("admin_resolve_dispute", {
        _dispute_id: disputeResult.data.id,
        _status: markResolved ? "resolved" : "vendor_contacted",
        _notes: notes,
      });
      if (result.error) throw result.error;

      toast.success(markResolved ? "Dispute resolved" : "Dispute follow-up saved", {
        description: markResolved
          ? "The canonical dispute workflow moved the service request out of disputed status."
          : "The dispute remains open and the notes were saved to its canonical record.",
      });
      setSelected(null);
      setResolution("");
      await load(false);
    } catch (reason) {
      toast.error("Dispute could not be updated", {
        description: reason instanceof Error ? reason.message : "The canonical dispute workflow failed. No UI-only resolution was applied.",
      });
    } finally {
      setSaving(false);
    }
  };
  const togglePayouts = async (vendor: Vendor, pause: boolean) => { if (pause && !pauseReason.trim()) return toast.error("Add an internal reason before pausing payouts."); if (!pause && !window.confirm(`Resume future payouts for ${vendor.name}?`)) return; setSaving(true); const result = await createClient().from("contractors").update({ payouts_paused: pause, payouts_paused_reason: pause ? pauseReason.trim() : null, payouts_paused_at: pause ? new Date().toISOString() : null }).eq("id", vendor.id); setSaving(false); if (result.error) return toast.error("Payout setting could not be updated", { description: result.error.message }); toast.success(pause ? "Payouts paused" : "Payouts resumed"); setPauseTarget(null); setPauseReason(""); await load(false); };
  const filtered = useMemo(() => { const query = search.trim().toLowerCase(); return disputes.filter((item) => !query || [item.service_type, item.address, item.city, profiles[item.customer_id] ?? ""].some((value) => value.toLowerCase().includes(query))); }, [disputes, profiles, search]);
  if (mode === "loading") return <AdminLoading label="Loading disputes and payout holds..." />; if (mode === "error") return <AdminError title="Disputes could not be loaded" message={error} retry={() => void load(true)} />;
  const activeCount = disputes.length; const pausedCount = vendors.filter((vendor) => vendor.payouts_paused).length;
  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8"><header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">State-machine backed queue</p><h1 className="flex items-center gap-2 font-heading text-3xl font-semibold tracking-tight"><AlertTriangle className="text-amber-500" />Disputes Queue</h1><p className="mt-2 text-sm text-muted-foreground">Review flagged requests through the canonical dispute workflow and manage vendor payout holds.</p></div><div className="flex gap-3"><Stat label="Active disputes" value={activeCount} /><Stat label="Paused vendors" value={pausedCount} /><Button variant="outline" onClick={() => void load(false)}><RefreshCw /></Button></div></header><Tabs defaultValue="disputes"><TabsList><TabsTrigger value="disputes">Flagged Jobs ({activeCount})</TabsTrigger><TabsTrigger value="vendors">Vendor Payouts ({vendors.length})</TabsTrigger></TabsList><TabsContent value="disputes" className="mt-5 space-y-4"><div className="relative max-w-xl"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search service, address, city, or homeowner..." className="pl-9" /></div>{filtered.length === 0 ? <Card><CardContent className="p-0"><AdminEmpty icon={CheckCircle2} title="No disputes to review" description="All flagged service requests have been resolved." /></CardContent></Card> : <div className="space-y-3">{filtered.map((item) => { const stateMismatch = item.status === "disputed" && Boolean(item.dispute_resolved_at); return <Card key={item.id} className={stateMismatch ? "border-red-300" : ""}><CardContent className="p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{item.service_type}</h2><Badge variant="outline">{label(item.status)}</Badge><Badge className={stateMismatch ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}>{stateMismatch ? "State mismatch — still disputed" : "Open dispute"}</Badge>{photos[item.id]?.length > 0 && <Badge variant="secondary"><ImageIcon />{photos[item.id].length} photos</Badge>}</div><div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2"><span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{profiles[item.customer_id] ?? "Unknown homeowner"}</span><span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{item.address}, {item.city}</span>{item.disputed_at && <span className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" />Flagged {formatDate(item.disputed_at)}</span>}{item.total_amount !== null && <span>Job total: {money(item.total_amount)}</span>}</div>{item.dispute_reason && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><p className="mb-1 font-medium text-amber-900">Homeowner&apos;s reason</p>{item.dispute_reason}</div>}</div><Button variant="outline" onClick={() => { setSelected(item); setResolution(item.dispute_resolution ?? ""); }}><Eye />Review</Button></div></CardContent></Card>; })}</div>}</TabsContent><TabsContent value="vendors" className="mt-5 space-y-3"><p className="text-sm text-muted-foreground">Pause future payouts for vendors under investigation. Existing held funds are unaffected.</p>{vendors.length === 0 ? <Card><CardContent className="p-0"><AdminEmpty icon={Play} title="No vendors available" /></CardContent></Card> : vendors.map((vendor) => <Card key={vendor.id}><CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{vendor.name}</p><Badge className={vendor.payouts_paused ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}>{vendor.payouts_paused ? <><Pause />Payouts paused</> : <><Play />Active</>}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{vendor.jobs_completed ?? 0} completed jobs{vendor.payouts_paused_at ? ` · paused ${formatDate(vendor.payouts_paused_at)}` : ""}</p>{vendor.payouts_paused_reason && <p className="mt-1 text-xs italic text-muted-foreground">“{vendor.payouts_paused_reason}”</p>}</div>{vendor.payouts_paused ? <Button variant="outline" disabled={saving} onClick={() => void togglePayouts(vendor, false)}><Play />Resume</Button> : <Button variant="outline" disabled={saving} onClick={() => setPauseTarget(vendor)}><Pause />Pause</Button>}</CardContent></Card>)}</TabsContent></Tabs>
    <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open && !saving) setSelected(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Review dispute</DialogTitle><DialogDescription>{selected?.service_type} · {selected?.address}, {selected?.city}</DialogDescription></DialogHeader>{selected && <div className="space-y-5">{selected.dispute_reason && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><p className="mb-1 font-medium text-amber-900">Homeowner&apos;s complaint</p>{selected.dispute_reason}</div>}<section><h3 className="mb-2 flex items-center gap-2 text-sm font-medium"><ImageIcon className="h-4 w-4" />Job photos ({photos[selected.id]?.length ?? 0})</h3>{photos[selected.id]?.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{photos[selected.id].map((photo) => <a key={photo.id} href={photo.photo_url} target="_blank" rel="noreferrer" className="group"><div className="aspect-square overflow-hidden rounded-lg border bg-muted"><img src={photo.photo_url} alt={photo.caption || "Job evidence"} className="h-full w-full object-cover transition-transform group-hover:scale-105" /></div><p className="mt-1 truncate text-xs text-muted-foreground">{photo.uploader_role} · {formatDate(photo.visit_date)}</p>{photo.caption && <p className="truncate text-xs">{photo.caption}</p>}</a>)}</div> : <p className="text-sm italic text-muted-foreground">No photos uploaded for this request.</p>}</section><label className="block space-y-2 text-sm font-medium">Resolution notes (required to resolve)<textarea rows={4} value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="Document the decision, refund, warning, or follow-up..." className={textareaClass} /></label></div>}<DialogFooter><Button variant="outline" disabled={saving} onClick={() => setSelected(null)}>Cancel</Button><Button variant="secondary" disabled={saving} onClick={() => void resolve(false)}>Save Follow-Up — Keep Open</Button><Button disabled={saving || !resolution.trim()} onClick={() => void resolve(true)}>{saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}Resolve Through Workflow</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(pauseTarget)} onOpenChange={(open) => { if (!open && !saving) { setPauseTarget(null); setPauseReason(""); } }}><DialogContent><DialogHeader><DialogTitle>Pause payouts for {pauseTarget?.name}?</DialogTitle><DialogDescription>Future payouts will remain held until an administrator resumes them.</DialogDescription></DialogHeader><label className="block space-y-2 text-sm font-medium">Internal reason<textarea rows={4} value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} placeholder="Why payouts are being paused..." className={textareaClass} /></label><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setPauseTarget(null)}>Cancel</Button><Button disabled={saving || !pauseReason.trim()} onClick={() => pauseTarget && void togglePayouts(pauseTarget, true)}><Pause />Pause Payouts</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
const textareaClass = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
function Stat({ label: statLabel, value }: { label: string; value: number }) { return <Card className="py-2"><CardContent className="px-4"><p className="text-xs text-muted-foreground">{statLabel}</p><p className="text-xl font-semibold">{value}</p></CardContent></Card>; }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value)); }
