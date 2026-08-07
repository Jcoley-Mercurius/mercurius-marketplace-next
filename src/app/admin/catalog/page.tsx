"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, DollarSign, Layers, Loader2, Pencil, RefreshCw, Search, Tag } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Category = { id: string; name: string; icon: string; description: string; sort_order: number; is_active: boolean };
type Service = { id: string; name: string; category_id: string; icon: string; descriptor: string; is_popular: boolean; is_active: boolean; weekly_price: number | null; monthly_price: number; one_time_price: number; default_frequency: string; available_frequencies: string[]; sort_order: number; pricing_mode: string; default_deposit_amount: number | null };
type Mode = "loading" | "live" | "error";

const PRICING_MODES = [{ value: "fixed", label: "Fixed Price" }, { value: "deposit_quote", label: "Deposit + Quote" }, { value: "custom_quote", label: "Custom Quote" }];
const FREQUENCIES = ["weekly", "monthly", "quarterly", "one-time"];
const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function AdminCatalogPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editing, setEditing] = useState<Service | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading"); setError("");
    try {
      const supabase = createClient();
      const [categoryResult, serviceResult] = await Promise.all([
        supabase.from("service_categories").select("id, name, icon, description, sort_order, is_active").order("sort_order"),
        supabase.from("services_catalog").select("id, name, category_id, icon, descriptor, is_popular, is_active, weekly_price, monthly_price, one_time_price, default_frequency, available_frequencies, sort_order, pricing_mode, default_deposit_amount").order("sort_order"),
      ]);
      const firstError = categoryResult.error ?? serviceResult.error;
      if (firstError) throw firstError;
      setCategories((categoryResult.data ?? []) as Category[]);
      setServices(((serviceResult.data ?? []) as Service[]).map((service) => ({ ...service, descriptor: service.descriptor ?? "", available_frequencies: service.available_frequencies ?? [] })));
      setMode("live");
    } catch (reason) {
      console.error("Unable to load service catalog", reason);
      setCategories([]); setServices([]); setError(reason instanceof Error ? reason.message : "The service catalog could not be loaded."); setMode("error");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(true); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const toggle = async (service: Service, field: "is_active" | "is_popular") => {
    const key = `${service.id}:${field}`; setToggling(key);
    try {
      const value = !service[field];
      const result = await createClient().from("services_catalog").update({ [field]: value }).eq("id", service.id);
      if (result.error) throw result.error;
      setServices((current) => current.map((item) => item.id === service.id ? { ...item, [field]: value } : item));
      toast.success(field === "is_active" ? `Service ${value ? "activated" : "hidden"}` : `Popular flag ${value ? "enabled" : "removed"}`);
    } catch (reason) { toast.error("Service could not be updated", { description: reason instanceof Error ? reason.message : "Please try again." }); }
    finally { setToggling(null); }
  };

  const save = async (form: Service) => {
    if (!form.name.trim()) { toast.error("Service name is required."); return; }
    if (!form.category_id) { toast.error("Select a category."); return; }
    if ([form.weekly_price, form.monthly_price, form.one_time_price, form.default_deposit_amount].some((value) => value !== null && (!Number.isFinite(Number(value)) || Number(value) < 0))) { toast.error("Prices cannot be negative."); return; }
    if (form.pricing_mode === "deposit_quote" && (!form.default_deposit_amount || form.default_deposit_amount <= 0)) { toast.error("Deposit + Quote services require a deposit greater than $0."); return; }
    setSaving(true);
    try {
      const result = await createClient().from("services_catalog").update({ name: form.name.trim(), descriptor: form.descriptor.trim(), category_id: form.category_id, weekly_price: form.weekly_price, monthly_price: form.monthly_price, one_time_price: form.one_time_price, default_frequency: form.default_frequency, pricing_mode: form.pricing_mode, default_deposit_amount: form.pricing_mode === "deposit_quote" ? form.default_deposit_amount : null }).eq("id", form.id);
      if (result.error) throw result.error;
      toast.success("Service updated"); setEditing(null); await load(false);
    } catch (reason) { toast.error("Service could not be saved", { description: reason instanceof Error ? reason.message : "Please try again." }); }
    finally { setSaving(false); }
  };

  const categoryNames = useMemo(() => Object.fromEntries(categories.map((category) => [category.id, category.name])), [categories]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return services.filter((service) => (categoryFilter === "all" || service.category_id === categoryFilter) && (!query || [service.name, service.descriptor, categoryNames[service.category_id] ?? ""].some((value) => value.toLowerCase().includes(query))));
  }, [categoryFilter, categoryNames, search, services]);

  if (mode === "loading") return <Loading />;
  if (mode === "error") return <Failure message={error} retry={() => void load(true)} />;

  const stats = [{ label: "Total Services", value: services.length, icon: Layers }, { label: "Active", value: services.filter((service) => service.is_active).length, icon: Tag }, { label: "Popular", value: services.filter((service) => service.is_popular).length, icon: Tag }, { label: "Categories", value: categories.length, icon: Layers }];
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Marketplace configuration</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Service Catalog</h1><p className="mt-2 text-sm text-muted-foreground">Manage service presentation, pricing modes, and availability.</p></div><Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button></header>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{stats.map((stat) => <Card key={stat.label}><CardContent className="py-4"><div className="mb-2 flex items-center gap-2 text-muted-foreground"><stat.icon className="h-4 w-4" /><span className="text-xs">{stat.label}</span></div><p className="text-2xl font-semibold">{stat.value}</p></CardContent></Card>)}</div>
      <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search services..." className="bg-card pl-9" /></div><select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={cn(selectClass, "sm:w-56")}><option value="all">All Categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
      <Card><CardContent className="p-0">{filtered.length === 0 ? <Empty hasServices={services.length > 0} /> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="border-b bg-muted/60"><tr className="text-left"><th className="p-4 font-medium text-muted-foreground">Service</th><th className="p-4 font-medium text-muted-foreground">Category</th><th className="p-4 font-medium text-muted-foreground">Pricing Mode</th><th className="p-4 text-right font-medium text-muted-foreground">Monthly</th><th className="p-4 text-right font-medium text-muted-foreground">One-Time</th><th className="p-4 text-center font-medium text-muted-foreground">Popular</th><th className="p-4 text-center font-medium text-muted-foreground">Active</th><th className="p-4 text-right font-medium text-muted-foreground">Actions</th></tr></thead><tbody className="divide-y">{filtered.map((service) => <tr key={service.id} className={cn("transition-colors hover:bg-muted/30", !service.is_active && "opacity-55")}><td className="p-4"><p className="font-medium">{service.name}</p><p className="mt-1 max-w-sm text-xs text-muted-foreground">{service.descriptor || "No description"}</p></td><td className="p-4"><Badge variant="secondary">{categoryNames[service.category_id] ?? service.category_id}</Badge></td><td className="p-4"><Badge variant="outline">{pricingLabel(service.pricing_mode)}</Badge></td><td className="p-4 text-right font-medium">{money(service.monthly_price)}</td><td className="p-4 text-right font-medium">{money(service.one_time_price)}</td><td className="p-4 text-center"><Toggle checked={service.is_popular} disabled={Boolean(toggling)} label={`Set ${service.name} popular`} onChange={() => void toggle(service, "is_popular")} loading={toggling === `${service.id}:is_popular`} /></td><td className="p-4 text-center"><Toggle checked={service.is_active} disabled={Boolean(toggling)} label={`Set ${service.name} active`} onChange={() => void toggle(service, "is_active")} loading={toggling === `${service.id}:is_active`} /></td><td className="p-4 text-right"><Button variant="ghost" size="sm" onClick={() => setEditing(service)}><Pencil />Edit</Button></td></tr>)}</tbody></table></div>}</CardContent></Card>
      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{editing && <EditService key={editing.id} service={editing} categories={categories} saving={saving} close={() => setEditing(null)} save={save} />}</DialogContent></Dialog>
    </div>
  );
}

function EditService({ service, categories, saving, close, save }: { service: Service; categories: Category[]; saving: boolean; close: () => void; save: (service: Service) => Promise<void> }) {
  const [form, setForm] = useState(service);
  return <><DialogHeader><DialogTitle>Edit Service</DialogTitle><DialogDescription>Changes affect public service discovery and default request pricing behavior.</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Name"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field><Field label="Description"><textarea rows={3} value={form.descriptor} onChange={(event) => setForm({ ...form, descriptor: event.target.value })} className={textareaClass} /></Field><Field label="Category"><select value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })} className={selectClass}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-3"><Field label="Weekly $"><Input type="number" min="0" step="0.01" value={form.weekly_price ?? ""} onChange={(event) => setForm({ ...form, weekly_price: optionalNumber(event.target.value) })} /></Field><Field label="Monthly $"><Input type="number" min="0" step="0.01" value={form.monthly_price} onChange={(event) => setForm({ ...form, monthly_price: Number(event.target.value) })} /></Field><Field label="One-Time $"><Input type="number" min="0" step="0.01" value={form.one_time_price} onChange={(event) => setForm({ ...form, one_time_price: Number(event.target.value) })} /></Field></div><Field label="Default Frequency"><select value={form.default_frequency} onChange={(event) => setForm({ ...form, default_frequency: event.target.value })} className={selectClass}>{FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{label(frequency)}</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Pricing Mode"><select value={form.pricing_mode} onChange={(event) => setForm({ ...form, pricing_mode: event.target.value })} className={selectClass}>{PRICING_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></Field><Field label="Default Deposit $"><Input type="number" min="0" step="0.01" disabled={form.pricing_mode !== "deposit_quote"} value={form.default_deposit_amount ?? ""} onChange={(event) => setForm({ ...form, default_deposit_amount: optionalNumber(event.target.value) })} /></Field></div><div className="rounded-xl border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground"><strong className="text-foreground">Fixed:</strong> full upfront price. <strong className="text-foreground">Deposit + Quote:</strong> deposit first, followed by a confirmed total. <strong className="text-foreground">Custom Quote:</strong> coordination required before pricing is confirmed.</div></div><DialogFooter><Button variant="outline" disabled={saving} onClick={close}>Cancel</Button><Button disabled={saving} onClick={() => void save(form)}>{saving ? <Loader2 className="animate-spin" /> : <DollarSign />}{saving ? "Saving..." : "Save Changes"}</Button></DialogFooter></>;
}

function Toggle({ checked, disabled, label: ariaLabel, onChange, loading }: { checked: boolean; disabled: boolean; label: string; onChange: () => void; loading: boolean }) { return <button type="button" role="switch" aria-label={ariaLabel} aria-checked={checked} disabled={disabled} onClick={onChange} className={cn("relative inline-flex h-6 w-11 rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-muted-foreground/30")}>{loading ? <Loader2 className="absolute left-3.5 top-1 h-4 w-4 animate-spin text-white" /> : <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "left-5" : "left-0.5")} />}</button>; }
const textareaClass = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
function Field({ label: fieldLabel, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label>{fieldLabel}</Label>{children}</div>; }
function optionalNumber(value: string) { const number = Number(value); return value === "" || !Number.isFinite(number) ? null : number; }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function pricingLabel(value: string) { return PRICING_MODES.find((mode) => mode.value === value)?.label ?? label(value); }
function money(value: number | null) { return value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value)); }
function Loading() { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">Loading service catalog...</span></div>; }
function Failure({ message, retry }: { message: string; retry: () => void }) { return <div className="flex min-h-[60vh] items-center justify-center p-6"><Card className="max-w-lg"><CardContent className="py-10 text-center"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" /><h1 className="font-heading text-xl font-semibold">Service catalog could not be loaded</h1><p className="mt-2 text-sm text-muted-foreground">{message}</p><Button className="mt-5" onClick={retry}><RefreshCw />Try Again</Button></CardContent></Card></div>; }
function Empty({ hasServices }: { hasServices: boolean }) { return <div className="py-16 text-center"><Layers className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" /><p className="font-medium">{hasServices ? "No services match these filters" : "No services in the catalog"}</p><p className="mt-1 text-sm text-muted-foreground">Live catalog records will appear here.</p></div>; }
