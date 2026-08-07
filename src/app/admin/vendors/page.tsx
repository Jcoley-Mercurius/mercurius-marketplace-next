"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Briefcase,
  ExternalLink,
  Eye,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Star,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type Vendor = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  logo_url: string | null;
  bio: string | null;
  location: string | null;
  rating: number | null;
  badges: string[];
  services: string[];
  years_experience: number | null;
  jobs_completed: number | null;
  is_active: boolean;
  created_at: string;
  user_id: string | null;
  marketing_enabled: boolean;
  special_offer: string | null;
  our_promise: string | null;
  verified_specialty: string | null;
};

type NewVendor = {
  name: string;
  email: string;
  phone: string;
  location: string;
  services: string;
  years_experience: string;
  bio: string;
};

const SAFE_SELECT = "id, name, logo_url, bio, location, rating, badges, services, years_experience, jobs_completed, is_active, created_at, user_id, marketing_enabled, special_offer, our_promise, verified_specialty";
const EMPTY_VENDOR: NewVendor = { name: "", email: "", phone: "", location: "", services: "", years_experience: "", bio: "" };

export default function AdminVendorsPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [selected, setSelected] = useState<Vendor | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newVendor, setNewVendor] = useState<NewVendor>(EMPTY_VENDOR);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const supabase = createClient();
      const [vendorResult, contactResult] = await Promise.all([
        supabase.from("contractors").select(SAFE_SELECT).order("created_at", { ascending: false }),
        supabase.rpc("admin_list_contractor_contacts"),
      ]);
      if (vendorResult.error) throw vendorResult.error;
      if (contactResult.error) throw contactResult.error;
      const contactMap = new Map(
        ((contactResult.data ?? []) as { id: string; email: string | null; phone: string | null }[])
          .map((contact) => [contact.id, contact]),
      );
      const next = ((vendorResult.data ?? []) as Omit<Vendor, "email" | "phone">[]).map((vendor) => ({
        ...vendor,
        email: contactMap.get(vendor.id)?.email ?? null,
        phone: contactMap.get(vendor.id)?.phone ?? null,
        services: vendor.services ?? [],
        badges: vendor.badges ?? [],
        is_active: Boolean(vendor.is_active),
        marketing_enabled: Boolean(vendor.marketing_enabled),
      }));
      setVendors(next);
      setSelected((current) => current ? next.find((vendor) => vendor.id === current.id) ?? null : null);
    } catch (reason) {
      console.error("Unable to load vendors", reason);
      setVendors([]);
      setError(reason instanceof Error ? reason.message : "Vendors could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const createVendor = async () => {
    const name = newVendor.name.trim();
    if (!name) return;
    const years = newVendor.years_experience ? Number(newVendor.years_experience) : null;
    if (years !== null && (!Number.isInteger(years) || years < 0)) {
      toast.error("Years of experience must be a positive whole number.");
      return;
    }
    setCreating(true);
    try {
      const result = await createClient().from("contractors").insert({
        name,
        email: newVendor.email.trim() || null,
        phone: newVendor.phone.trim() || null,
        location: newVendor.location.trim() || null,
        bio: newVendor.bio.trim() || null,
        services: newVendor.services.split(",").map((service) => service.trim()).filter(Boolean),
        years_experience: years,
        is_active: true,
        marketing_enabled: false,
      }).select("id").single();
      if (result.error) throw result.error;
      toast.success("Vendor created", { description: "Open the profile to publish details and link a login account." });
      setAddOpen(false);
      setNewVendor(EMPTY_VENDOR);
      await load(false);
      if (result.data?.id) router.push(`/admin/vendors/${result.data.id}`);
    } catch (reason) {
      toast.error("Vendor could not be created", { description: reason instanceof Error ? reason.message : "Please try again." });
    } finally {
      setCreating(false);
    }
  };

  const toggleField = async (vendor: Vendor, field: "is_active" | "marketing_enabled") => {
    const value = !vendor[field];
    setBusyId(vendor.id);
    try {
      const result = await createClient().from("contractors").update({ [field]: value }).eq("id", vendor.id);
      if (result.error) throw result.error;
      setVendors((current) => current.map((item) => item.id === vendor.id ? { ...item, [field]: value } : item));
      setSelected((current) => current?.id === vendor.id ? { ...current, [field]: value } : current);
      toast.success(field === "is_active" ? `Vendor ${value ? "activated" : "deactivated"}` : `Marketing ${value ? "enabled" : "disabled"}`);
    } catch (reason) {
      toast.error("Vendor could not be updated", { description: reason instanceof Error ? reason.message : "Please try again." });
    } finally {
      setBusyId(null);
    }
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return vendors.filter((vendor) => {
      const matchesStatus = status === "all" || (status === "active" ? vendor.is_active : !vendor.is_active);
      return matchesStatus && (!query || [vendor.name, vendor.email ?? "", vendor.location ?? "", ...vendor.services].some((value) => value.toLowerCase().includes(query)));
    });
  }, [search, status, vendors]);

  if (loading) return <LoadingState label="Loading vendors..." />;
  if (error) return <ErrorState message={error} retry={() => void load(true)} />;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Provider operations</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Vendors</h1><p className="mt-2 text-sm text-muted-foreground">{vendors.length} registered vendor{vendors.length === 1 ? "" : "s"}</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button><Button onClick={() => setAddOpen(true)}><Plus />Add Vendor</Button></div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, contact, location, or service..." className="bg-card pl-9" /></div><select aria-label="Filter vendors" value={status} onChange={(event) => setStatus(event.target.value)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-44"><option value="all">All vendors</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>

      <Card><CardContent className="p-0">{filtered.length === 0 ? <EmptyState icon={UserCheck} title={vendors.length ? "No vendors match these filters" : "No vendors have been created"} /> : <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead className="border-b bg-muted/60"><tr className="text-left">{["Vendor", "Services", "Location", "Rating", "Jobs", "Account", "Status", "Actions"].map((heading) => <th key={heading} className="p-4 font-medium text-muted-foreground">{heading}</th>)}</tr></thead><tbody className="divide-y">{filtered.map((vendor) => <tr key={vendor.id} className="transition-colors hover:bg-muted/30"><td className="p-4"><p className="font-medium">{vendor.name}</p><p className="mt-1 text-xs text-muted-foreground">{vendor.email ?? "No contact email"}</p></td><td className="p-4 text-xs text-muted-foreground">{vendor.services.slice(0, 2).join(", ") || "—"}{vendor.services.length > 2 && ` +${vendor.services.length - 2}`}</td><td className="p-4 text-muted-foreground">{vendor.location ?? "—"}</td><td className="p-4">{vendor.rating === null ? "—" : <span className="flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />{Number(vendor.rating).toFixed(1)}</span>}</td><td className="p-4">{vendor.jobs_completed ?? 0}</td><td className="p-4"><Badge variant={vendor.user_id ? "secondary" : "outline"}>{vendor.user_id ? "Linked" : "Not linked"}</Badge></td><td className="p-4"><Badge className={vendor.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-border bg-muted text-muted-foreground"}>{vendor.is_active ? "Active" : "Inactive"}</Badge></td><td className="p-4"><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => setSelected(vendor)} title="Quick view"><Eye /></Button><Link href={`/admin/vendors/${vendor.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>Edit</Link></div></td></tr>)}</tbody></table></div>}</CardContent></Card>

      <Dialog open={addOpen} onOpenChange={(open) => { if (!creating) setAddOpen(open); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Add Vendor</DialogTitle><DialogDescription>Create the contractor record first, then link its vendor account from the full profile.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Business name *"><Input value={newVendor.name} onChange={(event) => setNewVendor({ ...newVendor, name: event.target.value })} placeholder="Gulf Coast Lawn Co." /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Email"><Input type="email" value={newVendor.email} onChange={(event) => setNewVendor({ ...newVendor, email: event.target.value })} placeholder="vendor@example.com" /></Field><Field label="Phone"><Input value={newVendor.phone} onChange={(event) => setNewVendor({ ...newVendor, phone: event.target.value })} placeholder="(239) 555-0100" /></Field></div><Field label="Location"><Input value={newVendor.location} onChange={(event) => setNewVendor({ ...newVendor, location: event.target.value })} placeholder="Cape Coral, FL" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Services (comma separated)"><Input value={newVendor.services} onChange={(event) => setNewVendor({ ...newVendor, services: event.target.value })} placeholder="Lawn Care, Pressure Washing" /></Field><Field label="Years of experience"><Input type="number" min="0" value={newVendor.years_experience} onChange={(event) => setNewVendor({ ...newVendor, years_experience: event.target.value })} /></Field></div><Field label="Bio"><textarea rows={4} value={newVendor.bio} onChange={(event) => setNewVendor({ ...newVendor, bio: event.target.value })} placeholder="Short description of the business..." className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" /></Field></div><DialogFooter><Button variant="outline" disabled={creating} onClick={() => setAddOpen(false)}>Cancel</Button><Button disabled={creating || !newVendor.name.trim()} onClick={() => void createVendor()}>{creating && <Loader2 className="animate-spin" />}{creating ? "Creating..." : "Create Vendor"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open && !busyId) setSelected(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">{selected && <><DialogHeader><DialogTitle>{selected.name}</DialogTitle><DialogDescription>Vendor account, performance, and public profile summary.</DialogDescription></DialogHeader><div className="space-y-4"><div className="grid gap-3 text-sm sm:grid-cols-2"><Detail icon={Mail} value={selected.email || "No email"} /><Detail icon={Phone} value={selected.phone || "No phone"} /><Detail icon={MapPin} value={selected.location || "No location"} /><Detail icon={Star} value={`Rating ${selected.rating ?? "N/A"} · ${selected.jobs_completed ?? 0} jobs`} /><Detail icon={Briefcase} value={`${selected.years_experience ?? "—"} years experience`} /><Detail icon={Shield} value={selected.user_id ? "Vendor login linked" : "No vendor login linked"} /></div><div className="rounded-xl bg-muted/40 p-4"><p className="mb-2 text-sm font-medium">Services</p><div className="flex flex-wrap gap-1.5">{selected.services.length ? selected.services.map((service) => <Badge key={service} variant="secondary">{service}</Badge>) : <span className="text-sm text-muted-foreground">No services selected.</span>}</div></div>{selected.badges.length > 0 && <div className="rounded-xl bg-muted/40 p-4"><p className="mb-2 text-sm font-medium">Trust badges</p><div className="flex flex-wrap gap-1.5">{selected.badges.map((badge) => <Badge key={badge} className="border-accent/20 bg-accent/10 text-accent"><Shield />{badge}</Badge>)}</div></div>}{selected.bio && <p className="rounded-xl bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground">{selected.bio}</p>}<div className="flex flex-wrap gap-2 border-t pt-4"><Link href={`/admin/vendors/${selected.id}`} className={buttonVariants()}>Edit Full Profile</Link><Link href="/providers" target="_blank" className={buttonVariants({ variant: "outline" })}><ExternalLink />Provider Directory</Link><Button variant={selected.is_active ? "destructive" : "default"} disabled={busyId === selected.id} onClick={() => void toggleField(selected, "is_active")}>{selected.is_active ? "Deactivate" : "Activate"}</Button><Button variant="outline" disabled={busyId === selected.id} onClick={() => void toggleField(selected, "marketing_enabled")}>{selected.marketing_enabled ? "Disable Marketing" : "Enable Marketing"}</Button></div></div></>}</DialogContent></Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
function Detail({ icon: Icon, value }: { icon: typeof Mail; value: string }) { return <div className="flex items-center gap-2 rounded-lg border bg-card p-3"><Icon className="h-4 w-4 text-muted-foreground" /><span>{value}</span></div>; }
function LoadingState({ label }: { label: string }) { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">{label}</span></div>; }
function ErrorState({ message, retry }: { message: string; retry: () => void }) { return <div className="flex min-h-[60vh] items-center justify-center p-6"><Card className="max-w-lg"><CardContent className="py-10 text-center"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" /><h1 className="font-heading text-xl font-semibold">Vendors could not be loaded</h1><p className="mt-2 text-sm text-muted-foreground">{message}</p><Button className="mt-5" onClick={retry}><RefreshCw />Try Again</Button></CardContent></Card></div>; }
function EmptyState({ icon: Icon, title }: { icon: typeof UserCheck; title: string }) { return <div className="py-16 text-center"><Icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" /><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">Live records will appear here when available.</p></div>; }
