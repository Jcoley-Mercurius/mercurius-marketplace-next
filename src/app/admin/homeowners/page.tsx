"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  AlertCircle,
  Calendar,
  ClipboardList,
  Droplets,
  Eye,
  Fence,
  Home,
  Loader2,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  TreePine,
  Users,
  Waves,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";

type Profile = { id: string; user_id: string; full_name: string; phone: string | null; address: string | null; city: string | null; state: string | null; zip_code: string | null; created_at: string };
type HomeProfile = { property_type: string; square_footage: string; bedrooms: number | null; bathrooms: number | null; home_age_range: string; ownership_type: string; ownership_duration: string; has_yard: boolean | null; has_pool: boolean | null; has_trees: boolean | null; has_fence: boolean | null; has_deck_patio: boolean | null; has_irrigation: boolean | null; is_complete: boolean | null };
type ServiceRequest = { id: string; service_type: string; status: string; city: string; preferred_date: string | null; created_at: string; total_amount: number | null };
type Mode = "loading" | "live" | "error";

const statusStyle: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-700", matched: "border-blue-200 bg-blue-50 text-blue-700", quoted: "border-violet-200 bg-violet-50 text-violet-700", scheduled: "border-blue-200 bg-blue-50 text-blue-700", in_progress: "border-accent/20 bg-accent/10 text-accent", pending_review: "border-amber-200 bg-amber-50 text-amber-700", vendor_completed: "border-amber-200 bg-amber-50 text-amber-700", completed: "border-emerald-200 bg-emerald-50 text-emerald-700", cancelled: "border-border bg-muted text-muted-foreground", disputed: "border-red-200 bg-red-50 text-red-700",
};

export default function AdminHomeownersPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [requestCounts, setRequestCounts] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Profile | null>(null);
  const [homeProfile, setHomeProfile] = useState<HomeProfile | null>(null);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const load = useCallback(async () => {
    setMode("loading"); setError("");
    try {
      const supabase = createClient();
      const [roleResult, profileResult, requestResult] = await Promise.all([
        supabase.from("user_roles").select("user_id").eq("role", "homeowner"),
        supabase.from("profiles").select("id, user_id, full_name, phone, address, city, state, zip_code, created_at").order("created_at", { ascending: false }),
        supabase.from("service_requests").select("customer_id"),
      ]);
      const firstError = roleResult.error ?? profileResult.error ?? requestResult.error;
      if (firstError) throw firstError;
      const homeownerIds = new Set(((roleResult.data ?? []) as { user_id: string }[]).map((row) => row.user_id));
      setProfiles(((profileResult.data ?? []) as Profile[]).filter((profile) => homeownerIds.has(profile.user_id)));
      const counts: Record<string, number> = {};
      for (const row of (requestResult.data ?? []) as { customer_id: string }[]) counts[row.customer_id] = (counts[row.customer_id] ?? 0) + 1;
      setRequestCounts(counts);
      setMode("live");
    } catch (reason) {
      console.error("Unable to load homeowners", reason);
      setProfiles([]); setRequestCounts({}); setError(reason instanceof Error ? reason.message : "Homeowners could not be loaded."); setMode("error");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const openHomeowner = async (profile: Profile) => {
    setSelected(profile); setDetailLoading(true); setDetailError(""); setHomeProfile(null); setRequests([]);
    const supabase = createClient();
    const [homeResult, requestResult] = await Promise.all([
      supabase.from("home_profiles").select("property_type, square_footage, bedrooms, bathrooms, home_age_range, ownership_type, ownership_duration, has_yard, has_pool, has_trees, has_fence, has_deck_patio, has_irrigation, is_complete").eq("user_id", profile.user_id).maybeSingle(),
      supabase.from("service_requests").select("id, service_type, status, city, preferred_date, created_at, total_amount").eq("customer_id", profile.user_id).order("created_at", { ascending: false }),
    ]);
    const detailFailure = homeResult.error ?? requestResult.error;
    if (detailFailure) setDetailError(detailFailure.message);
    else { setHomeProfile(homeResult.data as HomeProfile | null); setRequests((requestResult.data ?? []) as ServiceRequest[]); }
    setDetailLoading(false);
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return profiles.filter((profile) => !query || [profile.full_name, profile.city ?? "", profile.phone ?? "", profile.zip_code ?? ""].some((value) => value.toLowerCase().includes(query)));
  }, [profiles, search]);

  if (mode === "loading") return <Loading />;
  if (mode === "error") return <Failure message={error} retry={() => void load()} />;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Customer operations</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Homeowners</h1><p className="mt-2 text-sm text-muted-foreground">{profiles.length} homeowner account{profiles.length === 1 ? "" : "s"}</p></div><Button variant="outline" onClick={() => void load()}><RefreshCw />Refresh</Button></header>
      <div className="relative max-w-xl"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, city, phone, or ZIP..." className="bg-card pl-9" /></div>
      <Card><CardContent className="p-0">{filtered.length === 0 ? <Empty title={profiles.length ? "No homeowners match this search" : "No homeowner accounts yet"} /> : <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead className="border-b bg-muted/60"><tr className="text-left">{["Name", "Phone", "Location", "Joined", "Requests", "Actions"].map((heading) => <th key={heading} className="p-4 font-medium text-muted-foreground">{heading}</th>)}</tr></thead><tbody className="divide-y">{filtered.map((profile) => <tr key={profile.id} className="transition-colors hover:bg-muted/30"><td className="p-4 font-medium">{profile.full_name || "Unnamed homeowner"}</td><td className="p-4 text-muted-foreground">{profile.phone ?? "—"}</td><td className="p-4 text-muted-foreground">{[profile.city, profile.state].filter(Boolean).join(", ") || "—"}</td><td className="p-4 text-muted-foreground">{formatDate(profile.created_at)}</td><td className="p-4">{requestCounts[profile.user_id] ?? 0}</td><td className="p-4"><Button variant="ghost" size="sm" onClick={() => void openHomeowner(profile)}><Eye />View</Button></td></tr>)}</tbody></table></div>}</CardContent></Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">{selected && <><DialogHeader><DialogTitle>{selected.full_name || "Homeowner"}</DialogTitle><DialogDescription>Contact, home profile, and live service-request history.</DialogDescription></DialogHeader>{detailLoading ? <div className="flex min-h-72 items-center justify-center"><Loader2 className="mr-2 animate-spin text-accent" />Loading homeowner details...</div> : detailError ? <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"><div className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4" />Details could not be loaded</div><p className="mt-2">{detailError}</p><Button variant="outline" size="sm" className="mt-4" onClick={() => void openHomeowner(selected)}><RefreshCw />Retry</Button></div> : <Tabs defaultValue="contact" className="space-y-4"><TabsList className="grid w-full grid-cols-3"><TabsTrigger value="contact">Contact</TabsTrigger><TabsTrigger value="property">Property</TabsTrigger><TabsTrigger value="requests">Requests ({requests.length})</TabsTrigger></TabsList><TabsContent value="contact" className="space-y-3"><Detail icon={Phone}>{selected.phone || "No phone on file"}</Detail><Detail icon={MapPin}>{[selected.address, selected.city, selected.state, selected.zip_code].filter(Boolean).join(", ") || "No address on file"}</Detail><Detail icon={Calendar}>Joined {formatDate(selected.created_at)}</Detail><div className="rounded-xl bg-muted/40 p-4 text-sm"><span className="text-muted-foreground">Total service requests: </span><strong>{requestCounts[selected.user_id] ?? 0}</strong></div></TabsContent><TabsContent value="property"><Property profile={homeProfile} /></TabsContent><TabsContent value="requests"><RequestHistory requests={requests} /></TabsContent></Tabs>}</>}</DialogContent></Dialog>
    </div>
  );
}

function Property({ profile }: { profile: HomeProfile | null }) {
  if (!profile) return <div className="py-10 text-center text-muted-foreground"><Home className="mx-auto mb-3 h-9 w-9 opacity-50" /><p>No home profile on file.</p></div>;
  const features: { label: string; enabled: boolean | null; icon: ComponentType<{ className?: string }> }[] = [
    { label: "Yard", enabled: profile.has_yard, icon: TreePine }, { label: "Pool", enabled: profile.has_pool, icon: Waves }, { label: "Trees", enabled: profile.has_trees, icon: TreePine }, { label: "Fence", enabled: profile.has_fence, icon: Fence }, { label: "Deck / Patio", enabled: profile.has_deck_patio, icon: Home }, { label: "Irrigation", enabled: profile.has_irrigation, icon: Droplets },
  ];
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2"><Info label="Property Type" value={profile.property_type} /><Info label="Square Footage" value={profile.square_footage} /><Info label="Bedrooms" value={profile.bedrooms?.toString()} /><Info label="Bathrooms" value={profile.bathrooms?.toString()} /><Info label="Home Age" value={profile.home_age_range} /><Info label="Ownership" value={profile.ownership_type} /><Info label="Ownership Duration" value={profile.ownership_duration} /><Info label="Profile Status" value={profile.is_complete ? "Complete" : "Incomplete"} /></div><div className="rounded-xl bg-muted/40 p-4"><p className="mb-3 text-sm font-medium">Property Features</p><div className="flex flex-wrap gap-2">{features.some((feature) => feature.enabled) ? features.filter((feature) => feature.enabled).map((feature) => <Badge key={feature.label} variant="secondary"><feature.icon />{feature.label}</Badge>) : <span className="text-sm text-muted-foreground">No features selected.</span>}</div></div></div>;
}

function RequestHistory({ requests }: { requests: ServiceRequest[] }) {
  if (!requests.length) return <div className="py-10 text-center text-muted-foreground"><ClipboardList className="mx-auto mb-3 h-9 w-9 opacity-50" /><p>No service requests yet.</p></div>;
  return <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">{requests.map((request) => <div key={request.id} className="flex flex-col gap-3 rounded-xl bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{request.service_type}</p><p className="mt-1 text-xs text-muted-foreground">{request.city} · {formatDate(request.preferred_date ?? request.created_at)}</p></div><div className="flex items-center gap-2">{request.total_amount !== null && <span className="text-sm font-medium">{money(request.total_amount)}</span>}<Badge className={statusStyle[request.status] ?? "border-border bg-muted text-muted-foreground"}>{label(request.status)}</Badge></div></div>)}</div>;
}

function Detail({ icon: Icon, children }: { icon: typeof Phone; children: ReactNode }) { return <div className="flex items-center gap-2 rounded-lg border p-3 text-sm"><Icon className="h-4 w-4 text-muted-foreground" />{children}</div>; }
function Info({ label: infoLabel, value }: { label: string; value?: string | null }) { return <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{infoLabel}</p><p className="mt-1 font-medium capitalize">{value || "—"}</p></div>; }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value)); }
function Loading() { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">Loading homeowners...</span></div>; }
function Failure({ message, retry }: { message: string; retry: () => void }) { return <div className="flex min-h-[60vh] items-center justify-center p-6"><Card className="max-w-lg"><CardContent className="py-10 text-center"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" /><h1 className="font-heading text-xl font-semibold">Homeowners could not be loaded</h1><p className="mt-2 text-sm text-muted-foreground">{message}</p><Button className="mt-5" onClick={retry}><RefreshCw />Try Again</Button></CardContent></Card></div>; }
function Empty({ title }: { title: string }) { return <div className="py-16 text-center"><Users className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" /><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">Live homeowner accounts will appear here.</p></div>; }
