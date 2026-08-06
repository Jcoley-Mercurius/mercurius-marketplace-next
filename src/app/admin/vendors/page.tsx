"use client";

import { useEffect, useMemo, useState } from "react";
import { Briefcase, Loader2, MapPin, Search, Star, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type Vendor = { id: string; name: string; location: string | null; services: string[] | null; rating: number | null; jobs_completed: number | null; is_active: boolean | null; years_experience: number | null; created_at: string };
const previewVendors: Vendor[] = [
  { id: "preview-v1", name: "Gulf Coast Lawn & Landscape", location: "Cape Coral, FL", services: ["Lawn Care", "Landscaping"], rating: 4.9, jobs_completed: 42, is_active: true, years_experience: 8, created_at: "2026-04-10T12:00:00Z" },
  { id: "preview-v2", name: "Cape Clean Home Services", location: "Fort Myers, FL", services: ["House Cleaning", "Deep Cleaning"], rating: 4.8, jobs_completed: 28, is_active: true, years_experience: 6, created_at: "2026-05-12T12:00:00Z" },
  { id: "preview-v3", name: "Comfort First HVAC", location: "Cape Coral, FL", services: ["HVAC", "A/C Maintenance"], rating: null, jobs_completed: 0, is_active: false, years_experience: 12, created_at: "2026-07-18T12:00:00Z" },
];

export default function AdminVendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"loading" | "live" | "preview">("loading");
  useEffect(() => {
    let active = true;
    async function loadVendors() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.from("contractors").select("id, name, location, services, rating, jobs_completed, is_active, years_experience, created_at").order("created_at", { ascending: false });
        if (error) throw error;
        if (!active) return;
        setVendors(data ?? []);
        setMode("live");
      } catch {
        if (!active) return;
        setVendors(previewVendors);
        setMode("preview");
      }
    }
    void loadVendors();
    return () => { active = false; };
  }, []);
  const filtered = useMemo(() => vendors.filter((vendor) => { const query = search.toLowerCase(); return vendor.name.toLowerCase().includes(query) || (vendor.location ?? "").toLowerCase().includes(query) || (vendor.services ?? []).some((service) => service.toLowerCase().includes(query)); }), [search, vendors]);
  if (mode === "loading") return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />Loading vendors...</div>;
  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8"><div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Vendors</h1><p className="mt-1 text-sm text-muted-foreground">{vendors.length} registered providers</p></div>{mode === "preview" && <Badge className="bg-blue-100 text-blue-800">Preview data</Badge>}</div><div className="relative max-w-xl"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search vendors, services, or locations..." className="bg-card pl-9" /></div>{filtered.length === 0 ? <Card><CardContent className="py-16 text-center"><UserCheck className="mx-auto mb-3 h-11 w-11 text-muted-foreground" /><p className="font-medium">No matching vendors</p></CardContent></Card> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map((vendor) => <Card key={vendor.id} className="transition-shadow hover:shadow-md"><CardContent><div className="mb-4 flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10"><Briefcase className="h-5 w-5 text-accent" /></span><Badge className={vendor.is_active ? "bg-sage-light text-sage-dark" : "bg-muted text-muted-foreground"}>{vendor.is_active ? "Active" : "Inactive"}</Badge></div><h2 className="font-semibold">{vendor.name}</h2><p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{vendor.location || "Location not set"}</p><div className="mt-4 flex flex-wrap gap-1.5">{(vendor.services ?? []).slice(0, 3).map((service) => <Badge key={service} variant="secondary">{service}</Badge>)}{(vendor.services?.length ?? 0) > 3 && <Badge variant="secondary">+{(vendor.services?.length ?? 0) - 3}</Badge>}</div><div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4 text-center"><div><p className="flex items-center justify-center gap-1 font-semibold"><Star className="h-3.5 w-3.5 text-amber-500" />{vendor.rating?.toFixed(1) ?? "—"}</p><p className="text-[11px] text-muted-foreground">Rating</p></div><div><p className="font-semibold">{vendor.jobs_completed ?? 0}</p><p className="text-[11px] text-muted-foreground">Jobs</p></div><div><p className="font-semibold">{vendor.years_experience ?? "—"}</p><p className="text-[11px] text-muted-foreground">Years</p></div></div></CardContent></Card>)}</div>}<p className="text-xs text-muted-foreground">Vendor editing and account-link controls will be added after their protected server workflows are ported.</p></div>;
}
