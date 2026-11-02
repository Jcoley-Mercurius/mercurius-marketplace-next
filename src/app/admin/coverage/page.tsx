"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin, RefreshCw, Search } from "lucide-react";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import { createClient } from "@/lib/supabase/client";

// TRACE-136 (DEC-2026-057 item 1): the Lee County ZIP allowlist is authoritative and its change
// authority is the owner (CFG-001). It changes only by reviewed migration, as DEC-2026-021 did, so
// this page is a read-only readback; client writes to coverage_areas are closed in the database.

type Area = { id: string; zip_code: string; city: string; state: string; is_active: boolean; has_waitlist: boolean };

export default function AdminCoveragePage() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const result = await createClient().from("coverage_areas").select("id, zip_code, city, state, is_active, has_waitlist").order("zip_code");
    if (result.error) { setError(result.error.message); setAreas([]); } else setAreas((result.data ?? []) as Area[]);
    setLoading(false);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const cities = useMemo(() => [...new Set(areas.map((area) => area.city))].sort(), [areas]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return areas.filter((area) => (cityFilter === "all" || area.city === cityFilter) && (!query || area.zip_code.includes(query) || area.city.toLowerCase().includes(query)));
  }, [areas, cityFilter, search]);
  if (loading) return <AdminLoading label="Loading coverage areas..." />;
  if (error) return <AdminError title="Coverage areas could not be loaded" message={error} retry={() => void load()} />;
  const active = areas.filter((area) => area.is_active).length;
  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Service footprint</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Coverage Areas</h1><p className="mt-2 text-sm text-muted-foreground">{active} of {areas.length} ZIP codes active. Read-only.</p></div><Button variant="outline" onClick={() => void load()}><RefreshCw />Refresh</Button></header>
    <section aria-labelledby="coverage-authority" className="rounded-xl border bg-muted/30 p-4 text-sm"><h2 id="coverage-authority" className="font-semibold">The service area changes only with the owner’s approval</h2><p className="mt-1 text-muted-foreground">The Lee County ZIP allowlist decides where requests are accepted. Adding, removing or pausing a ZIP is an owner decision, applied as a reviewed database change.</p></section>
    <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search ZIP codes" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ZIP or city..." className="bg-card pl-9" /></div><select aria-label="Filter by city" value={cityFilter} onChange={(event) => setCityFilter(event.target.value)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-56"><option value="all">All cities</option>{cities.map((city) => <option key={city} value={city}>{city}</option>)}</select></div>
    <Card><CardContent className="p-0">{filtered.length === 0 ? <AdminEmpty icon={MapPin} title={areas.length ? "No ZIP codes match these filters" : "No coverage areas"} /> : <ResponsiveDataList label="Coverage areas" rows={filtered} rowKey={(area) => area.id} rowLabel={(area) => `${area.zip_code} ${area.city}`} columns={[
      { key: "zip", label: "ZIP", render: (area) => <span className="font-mono">{area.zip_code}</span> },
      { key: "city", label: "City", render: (area) => `${area.city}, ${area.state}` },
      { key: "status", label: "Status", render: (area) => <Badge variant={area.is_active ? "secondary" : "outline"}>{area.is_active ? "Active" : "Inactive"}</Badge> },
      { key: "waitlist", label: "Waitlist", render: (area) => area.has_waitlist ? "Collects interest" : "—" },
    ]} />}</CardContent></Card>
  </div>;
}
