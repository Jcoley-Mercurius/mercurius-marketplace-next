"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertCircle, Briefcase, Calendar, CheckCircle2, DollarSign, Eye, FileText, Landmark, Loader2, Receipt, RefreshCw, Search, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import { createClient } from "@/lib/supabase/client";

// TRACE-136 (DEC-2026-057 item 7): the legacy invoice ledger is read-only. Client writes are closed
// in the database; the only writer is the lifecycle trigger. Refunds and payment corrections are
// reviewed finance commands, so this page offers no create, edit, status or refund control.

type Invoice = { id: string; invoice_number: string; customer_id: string; contractor_id: string | null; service_request_id: string | null; amount: number; platform_fee: number; vendor_payout: number; status: string; due_date: string | null; paid_at: string | null; created_at: string; notes: string | null };
type Profile = { user_id: string; full_name: string };
type Contractor = { id: string; name: string };
type Mode = "loading" | "live" | "error";

const STATUS_OPTIONS = ["draft", "pending", "sent", "paid", "pending_release", "released", "disputed", "overdue", "cancelled", "refunded"];
const statusStyle: Record<string, string> = {
  draft: "border-border bg-muted text-muted-foreground", pending: "border-slate-200 bg-slate-50 text-slate-700", sent: "border-blue-200 bg-blue-50 text-blue-700", paid: "border-emerald-200 bg-emerald-50 text-emerald-700", pending_release: "border-indigo-200 bg-indigo-50 text-indigo-700", released: "border-emerald-200 bg-emerald-50 text-emerald-700", disputed: "border-red-200 bg-red-50 text-red-700", overdue: "border-red-200 bg-red-50 text-red-700", cancelled: "border-border bg-muted text-muted-foreground", refunded: "border-amber-200 bg-amber-50 text-amber-700",
};

export default function AdminInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Invoice | null>(null);

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading"); setError("");
    try {
      const supabase = createClient();
      const [invoiceResult, profileResult, contractorResult] = await Promise.all([
        supabase.from("invoices").select("id, invoice_number, customer_id, contractor_id, service_request_id, amount, platform_fee, vendor_payout, status, due_date, paid_at, created_at, notes").order("created_at", { ascending: false }),
        supabase.from("profiles").select("user_id, full_name").order("full_name"),
        supabase.from("contractors").select("id, name").order("name"),
      ]);
      const firstError = invoiceResult.error ?? profileResult.error ?? contractorResult.error;
      if (firstError) throw firstError;
      const nextInvoices = (invoiceResult.data ?? []) as Invoice[];
      setInvoices(nextInvoices); setProfiles((profileResult.data ?? []) as Profile[]); setContractors((contractorResult.data ?? []) as Contractor[]);
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
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => (statusFilter === "all" || invoice.status === statusFilter) && (!query || [invoice.invoice_number, profileNames[invoice.customer_id] ?? "", invoice.contractor_id ? contractorNames[invoice.contractor_id] ?? "" : ""].some((value) => value.toLowerCase().includes(query))));
  }, [contractorNames, invoices, profileNames, search, statusFilter]);

  if (mode === "loading") return <Loading />;
  if (mode === "error") return <Failure message={error} retry={() => void load(true)} />;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Financial operations</p><h1 className="font-heading text-3xl font-semibold tracking-tight">Legacy invoices</h1><p className="mt-2 text-sm text-muted-foreground">{invoices.length} record{invoices.length === 1 ? "" : "s"} in the legacy invoice ledger. Read-only.</p></div><Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button></header>
      <section aria-labelledby="invoice-finance-note" className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center">
        <Landmark className="h-5 w-5 shrink-0 text-accent" aria-hidden />
        <div className="flex-1"><h2 id="invoice-finance-note" className="text-sm font-semibold">Refunds and payment corrections go through Finance review</h2><p className="mt-1 text-sm text-muted-foreground">These records aren’t the payment record and can’t be created, edited, marked paid or refunded here. Finance commands need finance authority.</p></div>
        <Link href="/admin/finance" className={buttonVariants({ variant: "outline" })}>Open Finance</Link>
      </section>
      <div className="flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search invoices" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice, homeowner, or vendor..." className="bg-card pl-9" /></div><select aria-label="Filter invoices by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-52"><option value="all">All statuses</option>{STATUS_OPTIONS.map((status) => <option key={status} value={status}>{label(status)}</option>)}</select></div>
      <Card><CardContent className="p-0">{filtered.length === 0 ? <Empty hasInvoices={invoices.length > 0} /> : <ResponsiveDataList label="Legacy invoices" rows={filtered} rowKey={(invoice) => invoice.id} rowLabel={(invoice) => invoice.invoice_number} columns={[
        { key: "invoice", label: "Invoice", render: (invoice) => <span className="font-mono text-xs">{invoice.invoice_number}</span> },
        { key: "homeowner", label: "Homeowner", render: (invoice) => profileNames[invoice.customer_id] ?? "Unknown" },
        { key: "vendor", label: "Vendor", render: (invoice) => invoice.contractor_id ? contractorNames[invoice.contractor_id] ?? "Unknown" : "—" },
        { key: "amount", label: "Amount", render: (invoice) => money(invoice.amount) },
        { key: "due", label: "Due", render: (invoice) => invoice.due_date ? formatDate(invoice.due_date) : "—" },
        { key: "status", label: "Status", render: (invoice) => <Badge className={statusStyle[invoice.status] ?? statusStyle.draft}>{label(invoice.status)}</Badge> },
        { key: "view", label: "Details", render: (invoice) => <Button variant="ghost" size="sm" aria-label={`View invoice ${invoice.invoice_number}`} onClick={() => setSelected(invoice)}><Eye /></Button> },
      ]} />}</CardContent></Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">{selected && <InvoiceView invoice={selected} homeowner={profileNames[selected.customer_id] ?? "Unknown"} vendor={selected.contractor_id ? contractorNames[selected.contractor_id] ?? "Unknown" : "None"} />}<DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Close</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}

function InvoiceView({ invoice, homeowner, vendor }: { invoice: Invoice; homeowner: string; vendor: string }) {
  return <><DialogHeader><DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />{invoice.invoice_number}<Badge className={statusStyle[invoice.status] ?? statusStyle.draft}>{label(invoice.status)}</Badge></DialogTitle><DialogDescription>Legacy record, issued {formatDate(invoice.created_at)}. Read-only.</DialogDescription></DialogHeader><div className="space-y-3 text-sm"><Detail icon={User}>Homeowner: {homeowner}</Detail><Detail icon={Briefcase}>Vendor: {vendor}</Detail><Detail icon={DollarSign}>Amount: {money(invoice.amount)}</Detail><div className="grid grid-cols-2 gap-4 rounded-xl bg-muted/40 p-4"><div><p className="text-xs text-muted-foreground">Platform fee (as recorded)</p><p className="mt-1 font-medium">{money(invoice.platform_fee)}</p></div><div><p className="text-xs text-muted-foreground">Vendor amount (as recorded)</p><p className="mt-1 font-medium">{money(invoice.vendor_payout)}</p></div></div><Detail icon={Calendar}>Due: {invoice.due_date ? formatDate(invoice.due_date) : "Not set"}</Detail>{invoice.paid_at && <Detail icon={CheckCircle2}>Paid: {formatDate(invoice.paid_at)}</Detail>}{invoice.service_request_id && <div className="rounded-xl border p-3"><p className="text-xs text-muted-foreground">Service Request</p><p className="mt-1 font-mono text-xs">{invoice.service_request_id}</p></div>}{invoice.notes && <p className="whitespace-pre-wrap rounded-xl bg-muted/40 p-4 text-muted-foreground">{invoice.notes}</p>}<p className="text-xs text-muted-foreground">Refunds and payment corrections go through <Link href="/admin/finance" className="underline">Finance review</Link>.</p></div></>;
}

function Detail({ icon: Icon, children }: { icon: typeof User; children: ReactNode }) { return <div className="flex items-center gap-2 rounded-lg border p-3"><Icon className="h-4 w-4 text-muted-foreground" />{children}</div>; }
function label(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatDate(value: string) { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value)); }
function Loading() { return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="mr-3 h-6 w-6 animate-spin text-accent" /><span className="text-muted-foreground">Loading invoices...</span></div>; }
function Failure({ message, retry }: { message: string; retry: () => void }) { return <div className="flex min-h-[60vh] items-center justify-center p-6"><Card className="max-w-lg"><CardContent className="py-10 text-center"><AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" /><h1 className="font-heading text-xl font-semibold">Invoices could not be loaded</h1><p className="mt-2 text-sm text-muted-foreground">{message}</p><Button className="mt-5" onClick={retry}><RefreshCw />Try Again</Button></CardContent></Card></div>; }
function Empty({ hasInvoices }: { hasInvoices: boolean }) { return <div className="py-16 text-center"><Receipt className="mx-auto mb-3 h-10 w-10 text-muted-foreground/60" /><p className="font-medium">{hasInvoices ? "No invoices match these filters" : "No legacy invoices"}</p></div>; }
