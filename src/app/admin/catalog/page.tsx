"use client";

import { createElement, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import * as LucideIcons from "lucide-react";
import { AlertCircle, DollarSign, Layers, Loader2, Pencil, Plus, RefreshCw, Search, Star, Tag, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { frequencyLabel } from "@/lib/packagePriceCorrections";
import {
  CATALOG_ICONS,
  PRICING_MODES,
  SERVICE_ID_MAX_LENGTH,
  catalogSaveErrorMessage,
  catalogServiceChanges,
  catalogServiceError,
  catalogServiceInsert,
  emptyCatalogService,
  parseTags,
  serviceIdFromName,
  type CatalogService as Service,
} from "@/lib/serviceCatalog";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { pricingFrequencies } from "@/lib/vendorPricing";

type Category = { id: string; name: string; icon: string; description: string; sort_order: number; is_active: boolean };
type Mode = "loading" | "live" | "error";
// TRACE-118: one form adds a service or edits one. Adding sets the id; editing never changes it.
type Editing = { kind: "add" | "edit"; service: Service };

// TRACE-110: every cadence, including every two weeks and every two months. The
// cadences a service offers limit what vendors and operators can price for it.
const FREQUENCIES: readonly string[] = pricingFrequencies;
const lucideIcons = LucideIcons as unknown as Record<string, LucideIcon | undefined>;
const iconFor = (name: string) => lucideIcons[name] ?? Star;
const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function AdminCatalogPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading"); setError("");
    try {
      const supabase = createClient();
      const [categoryResult, serviceResult] = await Promise.all([
        supabase.from("service_categories").select("id, name, icon, description, sort_order, is_active").order("sort_order"),
        supabase.from("services_catalog").select("id, name, category_id, icon, tags, descriptor, is_popular, is_active, weekly_price, monthly_price, one_time_price, default_frequency, available_frequencies, sort_order, pricing_mode, default_deposit_amount").order("sort_order"),
      ]);
      const firstError = categoryResult.error ?? serviceResult.error;
      if (firstError) throw firstError;
      setCategories((categoryResult.data ?? []) as Category[]);
      setServices(((serviceResult.data ?? []) as Service[]).map((service) => ({ ...service, descriptor: service.descriptor ?? "", tags: service.tags ?? [], available_frequencies: service.available_frequencies ?? [] })));
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
      toast.success(field === "is_active" ? `${service.name} ${value ? "shown" : "hidden"}` : `Popular flag ${value ? "enabled" : "removed"}`);
    } catch (reason) { toast.error("Service could not be updated", { description: reason instanceof Error ? reason.message : "Please try again." }); }
    finally { setToggling(null); }
  };

  const save = async (form: Service, kind: Editing["kind"]) => {
    const problem = catalogServiceError(form, services, kind === "add");
    if (problem) { toast.error(problem); return; }
    setSaving(true);
    try {
      const table = createClient().from("services_catalog");
      const result = kind === "add" ? await table.insert(catalogServiceInsert(form, services)) : await table.update(catalogServiceChanges(form)).eq("id", form.id);
      if (result.error) throw result.error;
      toast.success(kind === "add" ? `${form.name.trim()} added to the catalog` : "Service updated"); setEditing(null); await load(false);
    } catch (reason) { toast.error(kind === "add" ? "Service could not be added" : "Service could not be saved", { description: catalogSaveErrorMessage(reason) }); }
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
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Marketplace configuration</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Service Catalog</h1><p className="mt-2 text-sm text-muted-foreground">Add services, manage presentation, pricing modes, and availability. Hide a service to take it off the site; its history and vendor prices are kept.</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button><Button disabled={!categories.length} onClick={() => setEditing({ kind: "add", service: emptyCatalogService(categoryFilter !== "all" ? categoryFilter : categories[0]?.id ?? "") })}><Plus />Add service</Button></div></header>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{stats.map((stat) => <Card key={stat.label}><CardContent className="py-4"><div className="mb-2 flex items-center gap-2 text-muted-foreground"><stat.icon className="h-4 w-4" /><span className="text-xs">{stat.label}</span></div><p className="text-2xl font-semibold">{stat.value}</p></CardContent></Card>)}</div>
      <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search services..." className="bg-card pl-9" /></div><select aria-label="Filter by category" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={cn(selectClass, "sm:w-56")}><option value="all">All Categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
      <Card><CardContent className="p-0">{filtered.length === 0 ? <Empty hasServices={services.length > 0} /> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="border-b bg-muted/60"><tr className="text-left"><th className="p-4 font-medium text-muted-foreground">Service</th><th className="p-4 font-medium text-muted-foreground">Category</th><th className="p-4 font-medium text-muted-foreground">Pricing Mode</th><th className="p-4 text-right font-medium text-muted-foreground">Monthly</th><th className="p-4 text-right font-medium text-muted-foreground">One-Time</th><th className="p-4 text-center font-medium text-muted-foreground">Popular</th><th className="p-4 text-center font-medium text-muted-foreground">Shown</th><th className="p-4 text-right font-medium text-muted-foreground">Actions</th></tr></thead><tbody className="divide-y">{filtered.map((service) => <tr key={service.id} className={cn("transition-colors hover:bg-muted/30", !service.is_active && "opacity-55")}><td className="p-4"><div className="flex items-start gap-3"><ServiceIcon name={service.icon} className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div><p className="font-medium">{service.name}</p><p className="mt-1 max-w-sm text-xs text-muted-foreground">{service.descriptor || "No description"}</p></div></div></td><td className="p-4"><Badge variant="secondary">{categoryNames[service.category_id] ?? service.category_id}</Badge></td><td className="p-4"><Badge variant="outline">{pricingLabel(service.pricing_mode)}</Badge></td><td className="p-4 text-right font-medium">{money(service.monthly_price)}</td><td className="p-4 text-right font-medium">{money(service.one_time_price)}</td><td className="p-4 text-center"><Toggle checked={service.is_popular} disabled={Boolean(toggling)} label={`Set ${service.name} popular`} onChange={() => void toggle(service, "is_popular")} loading={toggling === `${service.id}:is_popular`} /></td><td className="p-4 text-center"><Toggle checked={service.is_active} disabled={Boolean(toggling)} label={`Show ${service.name} on the site`} onChange={() => void toggle(service, "is_active")} loading={toggling === `${service.id}:is_active`} /></td><td className="p-4 text-right"><Button variant="ghost" size="sm" aria-label={`Edit ${service.name}`} onClick={() => setEditing({ kind: "edit", service })}><Pencil />Edit</Button></td></tr>)}</tbody></table></div>}</CardContent></Card>
      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !saving) setEditing(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{editing && <ServiceForm key={`${editing.kind}:${editing.service.id}`} kind={editing.kind} service={editing.service} categories={categories} saving={saving} close={() => setEditing(null)} save={(form) => save(form, editing.kind)} />}</DialogContent></Dialog>
    </div>
  );
}

function ServiceForm({ kind, service, categories, saving, close, save }: { kind: Editing["kind"]; service: Service; categories: Category[]; saving: boolean; close: () => void; save: (service: Service) => Promise<void> }) {
  const [form, setForm] = useState(service);
  const [tagText, setTagText] = useState(service.tags.join(", "));
  // Until the operator types an ID, it follows the name.
  const [idEdited, setIdEdited] = useState(false);
  const adding = kind === "add";
  const icons: readonly string[] = CATALOG_ICONS.includes(form.icon as (typeof CATALOG_ICONS)[number]) ? CATALOG_ICONS : [form.icon, ...CATALOG_ICONS];
  const setName = (name: string) => setForm({ ...form, name, id: adding && !idEdited ? serviceIdFromName(name) : form.id });
  const submit = () => save({ ...form, tags: parseTags(tagText) });
  return <><DialogHeader><DialogTitle>{adding ? "Add Service" : "Edit Service"}</DialogTitle><DialogDescription>{adding ? "The service is added to the catalog and shown on the site. Vendors and Mercurius can then price it; until a vendor offers it, homeowners see that it is not available yet in their area." : "Changes affect public service discovery and default request pricing behavior."}</DialogDescription></DialogHeader><div className="space-y-4"><Field label="Name"><Input value={form.name} onChange={(event) => setName(event.target.value)} /></Field>{adding ? <Field label="Service ID"><Input value={form.id} maxLength={SERVICE_ID_MAX_LENGTH} aria-describedby="service-id-help" onChange={(event) => { setIdEdited(true); setForm({ ...form, id: event.target.value.toLowerCase() }); }} /><span id="service-id-help" className="block text-xs text-muted-foreground">Lowercase letters, numbers and hyphens. Used in links and records; it can&apos;t be changed after the service is added.</span></Field> : <div className="space-y-1"><p className="text-sm font-medium">Service ID</p><p className="font-mono text-sm text-muted-foreground">{form.id}</p></div>}<Field label="Description"><textarea rows={3} value={form.descriptor} onChange={(event) => setForm({ ...form, descriptor: event.target.value })} className={textareaClass} /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Category"><select value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })} className={selectClass}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.is_active ? "" : " (hidden)"}</option>)}</select></Field><Field label="Icon"><span className="flex items-center gap-2"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40"><ServiceIcon name={form.icon} className="h-4 w-4" /></span><select value={form.icon} onChange={(event) => setForm({ ...form, icon: event.target.value })} className={selectClass}>{icons.map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select></span></Field></div><Field label="Search tags"><Input value={tagText} placeholder="roof, shingles, leaks" aria-describedby="service-tags-help" onChange={(event) => setTagText(event.target.value)} /><span id="service-tags-help" className="block text-xs text-muted-foreground">Separate tags with commas. They help homeowners find the service.</span></Field><div className="grid gap-4 sm:grid-cols-3"><Field label="Weekly $"><Input type="number" min="0" step="0.01" value={form.weekly_price ?? ""} onChange={(event) => setForm({ ...form, weekly_price: optionalNumber(event.target.value) })} /></Field><Field label="Monthly $"><Input type="number" min="0" step="0.01" value={form.monthly_price} onChange={(event) => setForm({ ...form, monthly_price: Number(event.target.value) })} /></Field><Field label="One-Time $"><Input type="number" min="0" step="0.01" value={form.one_time_price} onChange={(event) => setForm({ ...form, one_time_price: Number(event.target.value) })} /></Field></div><Field label="Default Frequency"><select value={form.default_frequency} onChange={(event) => setForm({ ...form, default_frequency: event.target.value })} className={selectClass}>{FREQUENCIES.map((frequency) => <option key={frequency} value={frequency}>{frequencyLabel(frequency)}</option>)}</select></Field><fieldset className="space-y-1"><legend className="text-sm font-medium">Cadences offered</legend><p className="text-sm text-muted-foreground">Vendors and Mercurius can price only these cadences for this service. Existing vendor prices are not changed.</p><div className="grid sm:grid-cols-2">{FREQUENCIES.map((frequency) => <Checkbox key={frequency} label={frequencyLabel(frequency)} checked={form.available_frequencies.includes(frequency)} onChange={(event) => setForm({ ...form, available_frequencies: event.target.checked ? [...form.available_frequencies, frequency] : form.available_frequencies.filter((value) => value !== frequency) })} />)}</div></fieldset><div className="grid gap-4 sm:grid-cols-2"><Field label="Pricing Mode"><select value={form.pricing_mode} onChange={(event) => setForm({ ...form, pricing_mode: event.target.value })} className={selectClass}>{PRICING_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}</select></Field><Field label="Default Deposit $"><Input type="number" min="0" step="0.01" disabled={form.pricing_mode !== "deposit_quote"} value={form.default_deposit_amount ?? ""} onChange={(event) => setForm({ ...form, default_deposit_amount: optionalNumber(event.target.value) })} /></Field></div><div className="rounded-xl border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground"><strong className="text-foreground">Fixed:</strong> full upfront price. <strong className="text-foreground">Deposit + Quote:</strong> deposit first, followed by a confirmed total. <strong className="text-foreground">Custom Quote:</strong> coordination required before pricing is confirmed.</div>{adding && <Checkbox label="Mark as popular" checked={form.is_popular} onChange={(event) => setForm({ ...form, is_popular: event.target.checked })} />}</div><DialogFooter><Button variant="outline" disabled={saving} onClick={close}>Cancel</Button><Button disabled={saving} onClick={() => void submit()}>{saving ? <Loader2 className="animate-spin" /> : adding ? <Plus /> : <DollarSign />}{saving ? "Saving..." : adding ? "Add Service" : "Save Changes"}</Button></DialogFooter></>;
}

function ServiceIcon({ name, className }: { name: string; className?: string }) { return createElement(iconFor(name), { className, "aria-hidden": true }); }
function Toggle({ checked, disabled, label: ariaLabel, onChange, loading }: { checked: boolean; disabled: boolean; label: string; onChange: () => void; loading: boolean }) { return <button type="button" role="switch" aria-label={ariaLabel} aria-checked={checked} disabled={disabled} onClick={onChange} className={cn("relative inline-flex h-6 w-11 rounded-full transition-colors disabled:opacity-50", checked ? "bg-accent" : "bg-muted-foreground/30")}>{loading ? <Loader2 className="absolute left-3.5 top-1 h-4 w-4 animate-spin text-white" /> : <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", checked ? "left-5" : "left-0.5")} />}</button>; }
const textareaClass = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
// The control sits inside its label so each field is named (axe "label").
function Field({ label: fieldLabel, children }: { label: string; children: ReactNode }) { return <label className="block space-y-2"><span className="block text-sm leading-none font-medium">{fieldLabel}</span>{children}</label>; }
function optionalNumber(value: string) { const number = Number(value); return value === "" || !Number.isFinite(number) ? null : number; }
function titleCase(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function pricingLabel(value: string) { return PRICING_MODES.find((mode) => mode.value === value)?.label ?? titleCase(value); }
function money(value: number | null) { return value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value)); }
function Loading() { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">Loading service catalog...</span></div>; }
function Failure({ message, retry }: { message: string; retry: () => void }) { return <div className="flex min-h-[60vh] items-center justify-center p-6"><Card className="max-w-lg"><CardContent className="py-10 text-center"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" /><h1 className="font-heading text-xl font-semibold">Service catalog could not be loaded</h1><p className="mt-2 text-sm text-muted-foreground">{message}</p><Button className="mt-5" onClick={retry}><RefreshCw />Try Again</Button></CardContent></Card></div>; }
function Empty({ hasServices }: { hasServices: boolean }) { return <div className="py-16 text-center"><Layers className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" /><p className="font-medium">{hasServices ? "No services match these filters" : "No services in the catalog"}</p><p className="mt-1 text-sm text-muted-foreground">Live catalog records will appear here.</p></div>; }
