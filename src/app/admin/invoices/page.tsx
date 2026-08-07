"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Briefcase,
  Calendar,
  CheckCircle2,
  DollarSign,
  Eye,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Search,
  User,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type Invoice = { id: string; invoice_number: string; customer_id: string; contractor_id: string | null; service_request_id: string | null; amount: number; platform_fee: number; vendor_payout: number; status: string; due_date: string | null; paid_at: string | null; created_at: string; notes: string | null };
type Profile = { user_id: string; full_name: string };
type Contractor = { id: string; name: string };
type Form = { invoice_number: string; customer_id: string; contractor_id: string; service_request_id: string; amount: number; platform_fee: number; vendor_payout: number; status: string; due_date: string; notes: string };
type Mode = "loading" | "live" | "error";
type DialogMode = "create" | "view" | "edit";

const STATUS_OPTIONS = ["draft", "pending", "sent", "paid", "pending_release", "released", "disputed", "overdue", "cancelled", "refunded"];
const statusStyle: Record<string, string> = {
  draft: "border-border bg-muted text-muted-foreground", pending: "border-slate-200 bg-slate-50 text-slate-700", sent: "border-blue-200 bg-blue-50 text-blue-700", paid: "border-emerald-200 bg-emerald-50 text-emerald-700", pending_release: "border-indigo-200 bg-indigo-50 text-indigo-700", released: "border-emerald-200 bg-emerald-50 text-emerald-700", disputed: "border-red-200 bg-red-50 text-red-700", overdue: "border-red-200 bg-red-50 text-red-700", cancelled: "border-border bg-muted text-muted-foreground", refunded: "border-amber-200 bg-amber-50 text-amber-700",
};
const emptyForm = (): Form => ({ invoice_number: generateInvoiceNumber(), customer_id: "", contractor_id: "", service_request_id: "", amount: 0, platform_fee: 0, vendor_payout: 0, status: "draft", due_date: "", notes: "" });

export default function AdminInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [homeownerIds, setHomeownerIds] = useState<Set<string>>(new Set());
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("view");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [quickAction, setQuickAction] = useState<string | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading"); setError("");
    try {
      const supabase = createClient();
      const [invoiceResult, profileResult, contractorResult, roleResult] = await Promise.all([
        supabase.from("invoices").select("id, invoice_number, customer_id, contractor_id, service_request_id, amount, platform_fee, vendor_payout, status, due_date, paid_at, created_at, notes").order("created_at", { ascending: false }),
        supabase.from("profiles").select("user_id, full_name").order("full_name"),
        supabase.from("contractors").select("id, name").order("name"),
        supabase.from("user_roles").select("user_id").eq("role", "homeowner"),
      ]);
      const firstError = invoiceResult.error ?? profileResult.error ?? contractorResult.error ?? roleResult.error;
      if (firstError) throw firstError;
      const nextInvoices = (invoiceResult.data ?? []) as Invoice[];
      setInvoices(nextInvoices); setProfiles((profileResult.data ?? []) as Profile[]); setContractors((contractorResult.data ?? []) as Contractor[]); setHomeownerIds(new Set(((roleResult.data ?? []) as { user_id: string }[]).map((row) => row.user_id)));
      setSelected((current) => current ? nextInvoices.find((invoice) => invoice.id === current.id) ?? null : null);
      setMode("live");
    } catch (reason) {
      console.error("Unable to load invoices", reason);
      setInvoices([]); setError(reason instanceof Error ? reason.message : "Invoices could not be loaded."); setMode("error");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(true); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const profileNames = useMemo(() => Object.fromEntries(profiles.map((profile) => [profile.user_id, profile.full_name || "Unnamed homeowner"])), [profiles]);
  const contractorNames = useMemo(() => Object.fromEntries(contractors.map((contractor) => [contractor.id, contractor.name])), [contractors]);
  const homeownerOptions = useMemo(() => profiles.filter((profile) => homeownerIds.has(profile.user_id)), [homeownerIds, profiles]);

  const openCreate = () => { setSelected(null); setForm(emptyForm()); setDialogMode("create"); setDialogOpen(true); };
  const openView = (invoice: Invoice) => { setSelected(invoice); setDialogMode("view"); setDialogOpen(true); };
  const openEdit = (invoice: Invoice) => { setSelected(invoice); setForm({ invoice_number: invoice.invoice_number, customer_id: invoice.customer_id, contractor_id: invoice.contractor_id ?? "", service_request_id: invoice.service_request_id ?? "", amount: Number(invoice.amount), platform_fee: Number(invoice.platform_fee), vendor_payout: Number(invoice.vendor_payout), status: invoice.status, due_date: invoice.due_date ?? "", notes: invoice.notes ?? "" }); setDialogMode("edit"); setDialogOpen(true); };

  const updateAmount = (amount: number) => setForm((current) => { const platformFee = round(amount * 0.15); return { ...current, amount, platform_fee: platformFee, vendor_payout: round(amount - platformFee) }; });
  const updateFee = (platformFee: number) => setForm((current) => ({ ...current, platform_fee: platformFee, vendor_payout: round(current.amount - platformFee) }));

  const validate = () => {
    if (!form.customer_id) return "Select a homeowner.";
    if (!Number.isFinite(form.amount) || form.amount <= 0) return "Invoice amount must be greater than $0.";
    if (!Number.isFinite(form.platform_fee) || form.platform_fee < 0 || form.platform_fee > form.amount) return "Platform fee must be between $0 and the invoice amount.";
    return "";
  };

  const saveInvoice = async () => {
    const validationError = validate(); if (validationError) return toast.error(validationError);
    setSaving(true);
    try {
      const supabase = createClient();
      if (dialogMode === "create") {
        const result = await supabase.from("invoices").insert({ invoice_number: form.invoice_number, customer_id: form.customer_id, contractor_id: form.contractor_id || null, service_request_id: form.service_request_id || null, amount: round(form.amount), platform_fee: round(form.platform_fee), vendor_payout: round(form.vendor_payout), status: form.status, due_date: form.due_date || null, notes: form.notes.trim() || null });
        if (result.error) throw result.error;
        toast.success("Invoice created", { description: `${form.invoice_number} is now in the operations ledger.` });
      } else if (selected) {
        const result = await supabase.from("invoices").update({ contractor_id: form.contractor_id || null, amount: round(form.amount), platform_fee: round(form.platform_fee), vendor_payout: round(form.vendor_payout), status: form.status, due_date: form.due_date || null, notes: form.notes.trim() || null, paid_at: form.status === "paid" && selected.status !== "paid" ? new Date().toISOString() : selected.paid_at }).eq("id", selected.id);
        if (result.error) throw result.error;
        toast.success("Invoice updated");
      }
      setDialogOpen(false); await load(false);
    } catch (reason) {
      toast.error(dialogMode === "create" ? "Invoice could not be created" : "Invoice could not be updated", { description: reason instanceof Error ? reason.message : "Please try again." });
    } finally { setSaving(false); }
  };

  const changeStatus = async (invoice: Invoice, nextStatus: string) => {
    if ((nextStatus === "paid" || nextStatus === "cancelled") && !window.confirm(`Mark ${invoice.invoice_number} as ${label(nextStatus)}?`)) return;
    setQuickAction(`${invoice.id}:${nextStatus}`);
    try {
      const patch: { status: string; paid_at?: string } = { status: nextStatus };
      if (nextStatus === "paid") patch.paid_at = new Date().toISOString();
      const result = await createClient().from("invoices").update(patch).eq("id", invoice.id);
      if (result.error) throw result.error;
      toast.success(`Invoice marked ${label(nextStatus)}`); await load(false); setDialogOpen(false);
    } catch (reason) { toast.error("Invoice status could not be updated", { description: reason instanceof Error ? reason.message : "Please try again." }); }
    finally { setQuickAction(null); }
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => (statusFilter === "all" || invoice.status === statusFilter) && (!query || [invoice.invoice_number, profileNames[invoice.customer_id] ?? "", invoice.contractor_id ? contractorNames[invoice.contractor_id] ?? "" : ""].some((value) => value.toLowerCase().includes(query))));
  }, [contractorNames, invoices, profileNames, search, statusFilter]);
  const paidInvoices = invoices.filter((invoice) => invoice.status === "paid" || invoice.status === "pending_release" || invoice.status === "released");
  const totalCollected = paidInvoices.reduce((sum, invoice) => sum + Number(invoice.amount), 0);
  const platformRevenue = paidInvoices.reduce((sum, invoice) => sum + Number(invoice.platform_fee), 0);

  if (mode === "loading") return <Loading />;
  if (mode === "error") return <Failure message={error} retry={() => void load(true)} />;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Financial operations</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Invoices</h1><p className="mt-2 text-sm text-muted-foreground">{invoices.length} invoice{invoices.length === 1 ? "" : "s"} in the live ledger</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button><Button onClick={openCreate}><Plus />Create Invoice</Button></div></header>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[{ label: "Total Invoices", value: invoices.length }, { label: "Paid / Collected", value: paidInvoices.length }, { label: "Total Collected", value: money(totalCollected) }, { label: "Platform Revenue", value: money(platformRevenue) }].map((stat) => <Card key={stat.label}><CardContent className="py-4"><p className="text-xl font-semibold">{stat.value}</p><p className="mt-1 text-xs text-muted-foreground">{stat.label}</p></CardContent></Card>)}</div>
      <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice, homeowner, or vendor..." className="bg-card pl-9" /></div><select aria-label="Filter invoices by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-52"><option value="all">All statuses</option>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></div>
      <Card><CardContent className="p-0">{filtered.length === 0 ? <Empty hasInvoices={invoices.length > 0} /> : <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="border-b bg-muted/60"><tr className="text-left">{["Invoice", "Homeowner", "Vendor", "Amount", "Platform Fee", "Due", "Status", "Actions"].map((heading) => <th key={heading} className="p-4 font-medium text-muted-foreground">{heading}</th>)}</tr></thead><tbody className="divide-y">{filtered.map((invoice) => <tr key={invoice.id} className="transition-colors hover:bg-muted/30"><td className="p-4 font-mono text-xs">{invoice.invoice_number}</td><td className="p-4">{profileNames[invoice.customer_id] ?? "Unknown"}</td><td className="p-4 text-muted-foreground">{invoice.contractor_id ? contractorNames[invoice.contractor_id] ?? "Unknown" : "—"}</td><td className="p-4 font-medium">{money(invoice.amount)}</td><td className="p-4 text-accent">{money(invoice.platform_fee)}</td><td className="p-4 text-muted-foreground">{invoice.due_date ? formatDate(invoice.due_date) : "—"}</td><td className="p-4"><Badge className={statusStyle[invoice.status] ?? statusStyle.draft}>{label(invoice.status)}</Badge></td><td className="p-4"><div className="flex gap-1"><Button variant="ghost" size="sm" onClick={() => openView(invoice)} title="View invoice"><Eye /></Button><Button variant="ghost" size="sm" onClick={() => openEdit(invoice)} title="Edit invoice"><Pencil /></Button>{invoice.status === "sent" && <Button variant="ghost" size="sm" disabled={Boolean(quickAction)} className="text-emerald-700" onClick={() => void changeStatus(invoice, "paid")} title="Mark paid">{quickAction === `${invoice.id}:paid` ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}</Button>}{["draft", "sent"].includes(invoice.status) && <Button variant="ghost" size="sm" disabled={Boolean(quickAction)} className="text-destructive" onClick={() => void changeStatus(invoice, "cancelled")} title="Cancel invoice"><XCircle /></Button>}</div></td></tr>)}</tbody></table></div>}</CardContent></Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saving && !quickAction) setDialogOpen(open); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{dialogMode === "view" && selected ? <InvoiceView invoice={selected} homeowner={profileNames[selected.customer_id] ?? "Unknown"} vendor={selected.contractor_id ? contractorNames[selected.contractor_id] ?? "Unknown" : "None"} edit={() => openEdit(selected)} changeStatus={changeStatus} busy={Boolean(quickAction)} /> : <><DialogHeader><DialogTitle>{dialogMode === "create" ? "Create Invoice" : `Edit ${form.invoice_number}`}</DialogTitle><DialogDescription>{dialogMode === "create" ? "Create a live invoice record for a homeowner." : "Update accounting details and operational status."}</DialogDescription></DialogHeader><InvoiceForm form={form} setForm={setForm} homeownerOptions={homeownerOptions} contractors={contractors} create={dialogMode === "create"} updateAmount={updateAmount} updateFee={updateFee} /><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setDialogOpen(false)}>Cancel</Button><Button disabled={saving} onClick={() => void saveInvoice()}>{saving && <Loader2 className="animate-spin" />}{saving ? "Saving..." : dialogMode === "create" ? "Create Invoice" : "Save Changes"}</Button></DialogFooter></>}</DialogContent></Dialog>
    </div>
  );
}

function InvoiceView({ invoice, homeowner, vendor, edit, changeStatus, busy }: { invoice: Invoice; homeowner: string; vendor: string; edit: () => void; changeStatus: (invoice: Invoice, status: string) => Promise<void>; busy: boolean }) {
  return <><DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{invoice.invoice_number}<Badge className={statusStyle[invoice.status] ?? statusStyle.draft}>{label(invoice.status)}</Badge></DialogTitle><DialogDescription>Issued {formatDate(invoice.created_at)}</DialogDescription></DialogHeader><div className="space-y-3 text-sm"><Detail icon={User}>Homeowner: {homeowner}</Detail><Detail icon={Briefcase}>Vendor: {vendor}</Detail><Detail icon={DollarSign}>Amount: {money(invoice.amount)}</Detail><div className="grid grid-cols-2 gap-4 rounded-xl bg-muted/40 p-4"><div><p className="text-xs text-muted-foreground">Platform Fee</p><p className="mt-1 font-medium text-accent">{money(invoice.platform_fee)}</p></div><div><p className="text-xs text-muted-foreground">Vendor Payout</p><p className="mt-1 font-medium">{money(invoice.vendor_payout)}</p></div></div><Detail icon={Calendar}>Due: {invoice.due_date ? formatDate(invoice.due_date) : "Not set"}</Detail>{invoice.paid_at && <Detail icon={CheckCircle2}>Paid: {formatDate(invoice.paid_at)}</Detail>}{invoice.service_request_id && <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">Service Request</p><p className="mt-1 font-mono text-xs">{invoice.service_request_id}</p></div>}{invoice.notes && <p className="whitespace-pre-wrap rounded-xl bg-muted/40 p-4 text-muted-foreground">{invoice.notes}</p>}<div className="flex flex-wrap gap-2 border-t pt-4"><Button onClick={edit}><Pencil />Edit</Button>{invoice.status === "draft" && <Button variant="outline" disabled={busy} onClick={() => void changeStatus(invoice, "sent")}>Send Invoice</Button>}{invoice.status === "sent" && <Button disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => void changeStatus(invoice, "paid")}><CheckCircle2 />Mark Paid</Button>}</div></div></>;
}

function InvoiceForm({ form, setForm, homeownerOptions, contractors, create, updateAmount, updateFee }: { form: Form; setForm: React.Dispatch<React.SetStateAction<Form>>; homeownerOptions: Profile[]; contractors: Contractor[]; create: boolean; updateAmount: (amount: number) => void; updateFee: (fee: number) => void }) {
  return <div className="space-y-4">{create && <Field label="Invoice Number"><Input readOnly value={form.invoice_number} className="bg-muted/40 font-mono" /></Field>}{create && <Field label="Homeowner *"><select value={form.customer_id} onChange={(event) => setForm({ ...form, customer_id: event.target.value })} className={selectClass}><option value="">Select homeowner</option>{homeownerOptions.map((profile) => <option key={profile.user_id} value={profile.user_id}>{profile.full_name || "Unnamed homeowner"}</option>)}</select>{homeownerOptions.length === 0 && <p className="text-xs text-amber-700">No homeowner accounts are available.</p>}</Field>}<Field label="Vendor"><select value={form.contractor_id} onChange={(event) => setForm({ ...form, contractor_id: event.target.value })} className={selectClass}><option value="">No vendor selected</option>{contractors.map((contractor) => <option key={contractor.id} value={contractor.id}>{contractor.name}</option>)}</select></Field><div className="grid gap-4 sm:grid-cols-3"><Field label="Amount *"><Input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => updateAmount(Number(event.target.value))} /></Field><Field label="Platform Fee"><Input type="number" min="0" step="0.01" value={form.platform_fee} onChange={(event) => updateFee(Number(event.target.value))} /></Field><Field label="Vendor Payout"><Input readOnly value={form.vendor_payout} className="bg-muted/40" /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Status"><select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })} className={selectClass}>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></Field><Field label="Due Date"><Input type="date" value={form.due_date} onChange={(event) => setForm({ ...form, due_date: event.target.value })} /></Field></div><Field label="Notes"><textarea rows={4} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Internal notes about this invoice..." className={textareaClass} /></Field><p className="text-xs text-muted-foreground">Amounts default to the Mercurius 15% platform fee and remain manually reviewable by administrators.</p></div>;
}
const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const textareaClass = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
function Field({ label: fieldLabel, children }: { label: string; children: ReactNode }) { return <div className="space-y-2"><Label>{fieldLabel}</Label>{children}</div>; }
function Detail({ icon: Icon, children }: { icon: typeof User; children: ReactNode }) { return <div className="flex items-center gap-2 rounded-lg border p-3"><Icon className="h-4 w-4 text-muted-foreground" />{children}</div>; }
function generateInvoiceNumber() { const date = new Date(); return `INV-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`; }
function round(value: number) { return Math.round(Number(value || 0) * 100) / 100; }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value)); }
function Loading() { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">Loading invoices...</span></div>; }
function Failure({ message, retry }: { message: string; retry: () => void }) { return <div className="flex min-h-[60vh] items-center justify-center p-6"><Card className="max-w-lg"><CardContent className="py-10 text-center"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" /><h1 className="font-heading text-xl font-semibold">Invoices could not be loaded</h1><p className="mt-2 text-sm text-muted-foreground">{message}</p><Button className="mt-5" onClick={retry}><RefreshCw />Try Again</Button></CardContent></Card></div>; }
function Empty({ hasInvoices }: { hasInvoices: boolean }) { return <div className="py-16 text-center"><Receipt className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" /><p className="font-medium">{hasInvoices ? "No invoices match these filters" : "No invoices have been created"}</p><p className="mt-1 text-sm text-muted-foreground">Live invoice records will appear here.</p></div>; }
