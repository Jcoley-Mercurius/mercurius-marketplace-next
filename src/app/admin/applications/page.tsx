"use client";

import { useEffect, useMemo, useState } from "react";
import { Briefcase, Calendar, Eye, FileText, Loader2, Mail, MapPin, Phone, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Application = { id: string; first_name: string; last_name: string; business_name: string; email: string; phone: string; services: string[]; years_experience: number; service_areas: string | null; status: string; created_at: string; primary_category: string | null; team_size: string | null; business_description: string | null; license_number: string | null; insurance_policy_number: string | null; credentials: string[] | null; additional_notes: string | null };
const previewApplications: Application[] = [
  { id: "preview-app-1", first_name: "Jordan", last_name: "Rivera", business_name: "Rivera Pool Care", email: "jordan@example.com", phone: "(239) 555-0142", services: ["Weekly pool cleaning", "Chemical balancing"], years_experience: 7, service_areas: "Cape Coral, Fort Myers", status: "pending", created_at: "2026-08-04T12:00:00Z", primary_category: "Pool Service", team_size: "2–5", business_description: "Family-owned pool care serving Lee County.", license_number: null, insurance_policy_number: "POL-1048", credentials: ["insured", "google_reviews"], additional_notes: null },
  { id: "preview-app-2", first_name: "Taylor", last_name: "Nguyen", business_name: "Bright Coast Electric", email: "taylor@example.com", phone: "(239) 555-0188", services: ["Lighting install", "Outlet repair"], years_experience: 10, service_areas: "Fort Myers, Estero", status: "approved", created_at: "2026-08-01T12:00:00Z", primary_category: "Electrical", team_size: "6–10", business_description: null, license_number: "EC-123456", insurance_policy_number: null, credentials: ["licensed", "insured"], additional_notes: null },
];
const statusStyle: Record<string, string> = { pending: "border-amber-200 bg-amber-100 text-amber-800", approved: "border-green-200 bg-green-100 text-green-800", rejected: "border-red-200 bg-red-100 text-red-800" };

export default function AdminApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [selected, setSelected] = useState<Application | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [mode, setMode] = useState<"loading" | "live" | "preview">("loading");

  useEffect(() => {
    let active = true;
    async function loadApplications() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.from("vendor_applications").select("id, first_name, last_name, business_name, email, phone, services, years_experience, service_areas, status, created_at, primary_category, team_size, business_description, license_number, insurance_policy_number, credentials, additional_notes").order("created_at", { ascending: false });
        if (error) throw error;
        if (!active) return;
        setApplications(data ?? []);
        setMode("live");
      } catch {
        if (!active) return;
        setApplications(previewApplications);
        setMode("preview");
      }
    }
    void loadApplications();
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => applications.filter((application) => {
    const query = search.toLowerCase();
    return (status === "all" || application.status === status) && (application.business_name.toLowerCase().includes(query) || application.email.toLowerCase().includes(query) || (application.primary_category ?? "").toLowerCase().includes(query));
  }), [applications, search, status]);

  if (mode === "loading") return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" />Loading vendor applications...</div>;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Vendor Applications</h1><p className="mt-1 text-sm text-muted-foreground">{applications.filter((item) => item.status === "pending").length} awaiting review</p></div>{mode === "preview" && <Badge className="bg-blue-100 text-blue-800">Preview data</Badge>}</div>
      <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search business, category, or email..." className="bg-card pl-9" /></div><select value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-44"><option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></div>

      {filtered.length === 0 ? <Card><CardContent className="py-16 text-center"><FileText className="mx-auto mb-3 h-11 w-11 text-muted-foreground" /><p className="font-medium">No matching applications</p></CardContent></Card> : <div className="grid gap-4 lg:grid-cols-2">{filtered.map((application) => <Card key={application.id} className="transition-shadow hover:shadow-md"><CardContent><div className="mb-4 flex items-start justify-between gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10"><Briefcase className="h-5 w-5 text-primary" /></span><Badge className={cn("border capitalize", statusStyle[application.status] ?? "border-border bg-muted text-muted-foreground")}>{application.status}</Badge></div><h2 className="font-semibold">{application.business_name}</h2><p className="mt-1 text-sm text-muted-foreground">{application.primary_category || "Category not provided"} · {application.team_size || "Team size not provided"}</p><div className="mt-4 space-y-2 text-sm text-muted-foreground"><p className="flex items-center gap-2"><Mail className="h-4 w-4" />{application.email}</p><p className="flex items-center gap-2"><MapPin className="h-4 w-4" />{application.service_areas || "Service area not provided"}</p><p className="flex items-center gap-2"><Calendar className="h-4 w-4" />Applied {formatDate(application.created_at)}</p></div><Button variant="outline" className="mt-5 w-full" onClick={() => setSelected(application)}><Eye className="h-4 w-4" />Review Details</Button></CardContent></Card>)}</div>}

      <p className="text-xs text-muted-foreground">Approval, rejection, and vendor invitation actions will be enabled after their protected edge-function workflow is ported.</p>
      <ApplicationDialog application={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function ApplicationDialog({ application, onClose }: { application: Application | null; onClose: () => void }) {
  if (!application) return null;
  const rows = [
    ["Applicant", `${application.first_name} ${application.last_name}`.trim()],
    ["Email", application.email], ["Phone", application.phone], ["Category", application.primary_category ?? "—"],
    ["Team size", application.team_size ?? "—"], ["Experience", `${application.years_experience} years`],
    ["Service areas", application.service_areas ?? "—"], ["Services", application.services.join(", ") || "—"],
    ["Credentials", application.credentials?.join(", ") || "—"], ["License", application.license_number ?? "—"],
    ["Insurance policy", application.insurance_policy_number ?? "—"], ["Description", application.business_description ?? "—"],
    ["Notes", application.additional_notes ?? "—"],
  ];
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>{application.business_name}</DialogTitle></DialogHeader><div className="divide-y divide-border rounded-xl border border-border">{rows.map(([label, value]) => <div key={label} className="grid gap-1 p-3 sm:grid-cols-3"><p className="text-sm text-muted-foreground">{label}</p><p className="break-words text-sm sm:col-span-2">{value}</p></div>)}</div><div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground"><Phone className="h-4 w-4" />Contact the applicant directly while approval tooling is being ported.</div></DialogContent></Dialog>;
}

function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
