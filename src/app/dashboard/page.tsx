"use client";

import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Home,
  Loader2,
  MessageSquare,
  Plus,
  ShieldCheck,
  Star,
  WalletCards,
} from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Header } from "@/components/layout/Header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type ServiceRequest = {
  id: string;
  service_type: string;
  status: string;
  preferred_date: string | null;
  preferred_time: string | null;
  address: string;
  city: string;
  state: string;
  contractor_id: string | null;
  total_amount: number | null;
  created_at: string;
};

type Invoice = {
  id: string;
  invoice_number: string;
  amount: number;
  status: string;
  created_at: string;
  paid_at: string | null;
};

type DataMode = "loading" | "live" | "preview";

const previewRequests: ServiceRequest[] = [
  {
    id: "preview-service-1",
    service_type: "Lawn Care",
    status: "scheduled",
    preferred_date: "2026-08-12",
    preferred_time: "9:00–11:00 AM",
    address: "123 Palm Avenue",
    city: "Cape Coral",
    state: "FL",
    contractor_id: "preview-contractor-1",
    total_amount: 89,
    created_at: "2026-08-02T12:00:00Z",
  },
  {
    id: "preview-service-2",
    service_type: "Pool Service",
    status: "matched",
    preferred_date: "2026-08-18",
    preferred_time: null,
    address: "123 Palm Avenue",
    city: "Cape Coral",
    state: "FL",
    contractor_id: "preview-contractor-2",
    total_amount: null,
    created_at: "2026-08-01T12:00:00Z",
  },
  {
    id: "preview-service-3",
    service_type: "Air Conditioning Tune-Up",
    status: "completed",
    preferred_date: "2026-07-24",
    preferred_time: null,
    address: "123 Palm Avenue",
    city: "Cape Coral",
    state: "FL",
    contractor_id: "preview-contractor-3",
    total_amount: 149,
    created_at: "2026-07-20T12:00:00Z",
  },
];

const previewInvoices: Invoice[] = [
  { id: "preview-invoice-1", invoice_number: "INV-1048", amount: 89, status: "sent", created_at: "2026-08-02T12:00:00Z", paid_at: null },
  { id: "preview-invoice-2", invoice_number: "INV-1029", amount: 149, status: "paid", created_at: "2026-07-24T12:00:00Z", paid_at: "2026-07-24T16:00:00Z" },
];

const closedStatuses = new Set(["completed", "cancelled", "closed", "reviewed"]);
const payableStatuses = new Set(["draft", "pending", "overdue", "sent"]);

const statusColor: Record<string, string> = {
  pending: "border-yellow-200 bg-yellow-100 text-yellow-800",
  matched: "border-blue-200 bg-blue-100 text-blue-800",
  quoted: "border-violet-200 bg-violet-100 text-violet-700",
  scheduled: "border-sage/20 bg-sage-light text-sage-dark",
  in_progress: "border-accent/20 bg-accent/10 text-accent",
  pending_review: "border-amber-200 bg-amber-100 text-amber-700",
  vendor_completed: "border-amber-200 bg-amber-100 text-amber-700",
  review_requested: "border-sage/20 bg-sage-light text-sage-dark",
  completed: "border-border bg-muted text-muted-foreground",
  cancelled: "border-red-200 bg-red-100 text-red-800",
};

const invoiceStatusColor: Record<string, string> = {
  paid: "bg-sage-light text-sage-dark",
  pending: "bg-blue-100 text-blue-800",
  sent: "bg-blue-100 text-blue-800",
  draft: "bg-muted text-muted-foreground",
  overdue: "bg-red-100 text-red-800",
  pending_release: "bg-amber-100 text-amber-800",
  released: "bg-sage-light text-sage-dark",
};

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [dataMode, setDataMode] = useState<DataMode>("loading");
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    let active = true;

    async function loadDashboard() {
      setDataMode("loading");
      try {
        const supabase = createClient();
        const [requestResult, invoiceResult] = await Promise.all([
          supabase
            .from("service_requests")
            .select("id, service_type, status, preferred_date, preferred_time, address, city, state, contractor_id, total_amount, created_at")
            .eq("customer_id", user!.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("invoices")
            .select("id, invoice_number, amount, status, created_at, paid_at")
            .eq("customer_id", user!.id)
            .order("created_at", { ascending: false }),
        ]);

        if (requestResult.error) throw requestResult.error;
        if (invoiceResult.error) throw invoiceResult.error;
        if (!active) return;

        setRequests(requestResult.data ?? []);
        setInvoices(invoiceResult.data ?? []);
        setDataMode("live");
      } catch {
        if (!active) return;
        setRequests(previewRequests);
        setInvoices(previewInvoices);
        setDataMode("preview");
      }
    }

    void loadDashboard();
    return () => {
      active = false;
    };
  }, [user]);

  const { upcoming, past, quoted, awaitingConfirmation, awaitingReview } = useMemo(
    () => ({
      upcoming: requests.filter((request) => !closedStatuses.has(request.status)),
      past: requests.filter((request) => closedStatuses.has(request.status)),
      quoted: requests.filter((request) => request.status === "quoted"),
      awaitingConfirmation: requests.filter((request) =>
        ["pending_review", "vendor_completed"].includes(request.status),
      ),
      awaitingReview: requests.filter((request) => request.status === "review_requested"),
    }),
    [requests],
  );

  if (authLoading || !user) {
    return <FullPageLoading label={authLoading ? "Loading your dashboard..." : "Taking you to sign in..."} />;
  }

  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
  const firstName = fullName.split(" ")[0] || "Homeowner";
  const openInvoices = invoices.filter((invoice) => payableStatuses.has(invoice.status));

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <section className="bg-primary py-8">
          <div className="container-wide flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-primary-foreground/70">
                <Home className="h-4 w-4" /> Homeowner Portal
              </div>
              <h1 className="text-2xl font-semibold !text-primary-foreground">Welcome back, {firstName}!</h1>
            </div>
            <Link href="/request" className={cn(buttonVariants({ size: "lg" }), "h-11 bg-accent px-4 text-accent-foreground hover:bg-accent/90")}>
              <Plus className="h-4 w-4" /> Request Service
            </Link>
          </div>
        </section>

        <section className="bg-background py-12 md:py-16">
          <div className="container-wide">
            {dataMode === "preview" && (
              <div className="mb-6 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p><strong>Preview mode:</strong> Live dashboard data is unavailable, so sample services and invoices are shown below.</p>
              </div>
            )}

            {dataMode !== "loading" && (awaitingConfirmation.length > 0 || awaitingReview.length > 0) && (
              <div className="mb-8 space-y-3">
                {awaitingConfirmation.map((job) => (
                  <ActionBanner key={job.id} icon={CheckCircle2} title={`Is your ${job.service_type} all set?`} description="Your provider marked this service complete. Review the details and confirm the work." action="Review service" onClick={() => setActiveTab("upcoming")} tone="amber" />
                ))}
                {awaitingReview.map((job) => (
                  <ActionBanner key={job.id} icon={Star} title={`How did your ${job.service_type} go?`} description="Share a rating for your provider — it only takes a moment." action="View service" onClick={() => setActiveTab("upcoming")} tone="sage" />
                ))}
              </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="mb-8 overflow-x-auto pb-1">
                <TabsList className="h-auto min-w-max gap-1 p-1">
                  <TabsTrigger value="overview" className="px-3 py-1.5">Overview</TabsTrigger>
                  <TabsTrigger value="upcoming" className="px-3 py-1.5">Upcoming</TabsTrigger>
                  <TabsTrigger value="past" className="px-3 py-1.5">Past Services</TabsTrigger>
                  <TabsTrigger value="invoices" className="px-3 py-1.5">Invoices</TabsTrigger>
                  <TabsTrigger value="payment-methods" className="px-3 py-1.5">Payment Methods</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="overview" className="space-y-8">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <StatCard icon={Calendar} label="Upcoming Services" value={upcoming.length} loading={dataMode === "loading"} />
                  <StatCard icon={CheckCircle2} label="Completed" value={past.length} loading={dataMode === "loading"} />
                  <StatCard icon={CreditCard} label="Open Invoices" value={openInvoices.length} loading={dataMode === "loading"} />
                </div>

                <div>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Quick actions</h2>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <QuickAction href="/request" icon={Plus} label="Request a Service" />
                    <QuickAction href="/contact" icon={MessageSquare} label="Contact Support" />
                    <QuickAction href="/contact" icon={AlertTriangle} label="Report an Issue" />
                  </div>
                </div>

                {quoted.length > 0 && (
                  <Card className="border-violet-200 bg-violet-50 ring-violet-200">
                    <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3 text-violet-800">
                        <CreditCard className="h-5 w-5" />
                        <p className="font-medium">{quoted.length} quote{quoted.length === 1 ? "" : "s"} awaiting your approval</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setActiveTab("upcoming")}>Review <ArrowRight className="h-3 w-3" /></Button>
                    </CardContent>
                  </Card>
                )}

                <div className="grid gap-8 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="flex-row items-center justify-between">
                      <CardTitle>Upcoming Services</CardTitle>
                      <Button variant="link" size="sm" onClick={() => setActiveTab("upcoming")}>View All <ArrowRight className="h-3 w-3" /></Button>
                    </CardHeader>
                    <CardContent>
                      {dataMode === "loading" ? <ListLoading /> : upcoming.length === 0 ? <EmptyState icon={Calendar} title="No upcoming services" description="When you request a service, its status and schedule will appear here." actionHref="/request" actionLabel="Request a Service" compact /> : (
                        <div className="space-y-3">{upcoming.slice(0, 2).map((job) => <ServiceRow key={job.id} job={job} compact />)}</div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex-row items-center justify-between">
                      <CardTitle>Recent Invoices</CardTitle>
                      <Button variant="link" size="sm" onClick={() => setActiveTab("invoices")}>View All <ArrowRight className="h-3 w-3" /></Button>
                    </CardHeader>
                    <CardContent>
                      {dataMode === "loading" ? <ListLoading /> : invoices.length === 0 ? <EmptyState icon={CreditCard} title="No invoices yet" description="Invoices will appear here after service work is billed." compact /> : (
                        <div className="divide-y divide-border">{invoices.slice(0, 3).map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} compact />)}</div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="upcoming">
                <Card>
                  <CardHeader><CardTitle>Upcoming Services</CardTitle><CardDescription>Track requests, quotes, schedules, and active work.</CardDescription></CardHeader>
                  <CardContent>
                    {dataMode === "loading" ? <ListLoading large /> : upcoming.length === 0 ? <EmptyState icon={Calendar} title="No upcoming services scheduled" description="Build a service plan whenever your home needs attention." actionHref="/request" actionLabel="Request a Service" /> : (
                      <div className="space-y-4">{upcoming.map((job) => <ServiceRow key={job.id} job={job} />)}</div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="past">
                <Card>
                  <CardHeader><CardTitle>Past Services</CardTitle><CardDescription>Your completed and closed service history.</CardDescription></CardHeader>
                  <CardContent>
                    {dataMode === "loading" ? <ListLoading large /> : past.length === 0 ? <EmptyState icon={CheckCircle2} title="No completed services yet" description="Completed jobs will be saved here for easy reference." /> : (
                      <div className="space-y-4">{past.map((job) => <ServiceRow key={job.id} job={job} />)}</div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="invoices">
                <Card>
                  <CardHeader><CardTitle>Invoices &amp; Payments</CardTitle><CardDescription>Review charges and track payment status.</CardDescription></CardHeader>
                  <CardContent>
                    {dataMode === "loading" ? <ListLoading large /> : invoices.length === 0 ? <EmptyState icon={CreditCard} title="No invoices yet" description="Invoices will appear after a provider bills completed work." /> : (
                      <div className="divide-y divide-border">{invoices.map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} />)}</div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="payment-methods">
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-accent" /> Payment Methods</CardTitle><CardDescription>Manage how you pay for Mercurius services.</CardDescription></CardHeader>
                  <CardContent>
                    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
                      <ShieldCheck className="mb-4 h-10 w-10 text-accent" />
                      <p className="font-medium">Secure payment setup is coming soon</p>
                      <p className="mt-1 max-w-md text-sm text-muted-foreground">Your payment details will be securely managed by our connected payment provider.</p>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </section>
      </main>
    </div>
  );
}

function FullPageLoading({ label }: { label: string }) {
  return <div className="flex min-h-screen items-center justify-center bg-background"><div className="flex items-center gap-3 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin text-accent" />{label}</div></div>;
}

function StatCard({ icon: Icon, label, value, loading }: { icon: ComponentType<{ className?: string }>; label: string; value: number; loading: boolean }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" /> {label}</CardTitle></CardHeader><CardContent>{loading ? <div className="h-9 w-12 animate-pulse rounded bg-muted" /> : <p className="text-3xl font-bold">{value}</p>}</CardContent></Card>;
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: ComponentType<{ className?: string }>; label: string }) {
  return <Link href={href} className="flex items-center rounded-xl border border-border bg-card p-4 font-medium transition-all hover:border-accent/40 hover:bg-muted/50"><Icon className="mr-3 h-5 w-5 text-accent" />{label}</Link>;
}

function ActionBanner({ icon: Icon, title, description, action, onClick, tone }: { icon: ComponentType<{ className?: string }>; title: string; description: string; action: string; onClick: () => void; tone: "amber" | "sage" }) {
  return <Card className={tone === "amber" ? "border-amber-200 bg-amber-50 ring-amber-200" : "border-sage/30 bg-sage-light/40 ring-sage/30"}><CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><Icon className={cn("mt-0.5 h-5 w-5", tone === "amber" ? "text-amber-700" : "text-sage-dark")} /><div><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{description}</p></div></div><Button onClick={onClick} className="bg-accent text-accent-foreground hover:bg-accent/90">{action}</Button></CardContent></Card>;
}

function ListLoading({ large = false }: { large?: boolean }) {
  return <div className={cn("flex items-center justify-center", large ? "py-16" : "py-9")}><Loader2 className="h-6 w-6 animate-spin text-accent" /><span className="sr-only">Loading</span></div>;
}

function EmptyState({ icon: Icon, title, description, actionHref, actionLabel, compact = false }: { icon: ComponentType<{ className?: string }>; title: string; description: string; actionHref?: string; actionLabel?: string; compact?: boolean }) {
  return <div className={cn("flex flex-col items-center px-4 text-center", compact ? "py-7" : "py-12")}><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted"><Icon className="h-6 w-6 text-muted-foreground" /></div><p className="font-medium">{title}</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>{actionHref && actionLabel && <Link href={actionHref} className={cn(buttonVariants(), "mt-5 bg-accent text-accent-foreground hover:bg-accent/90")}>{actionLabel}</Link>}</div>;
}

function ServiceRow({ job, compact = false }: { job: ServiceRequest; compact?: boolean }) {
  const displayDate = job.preferred_date ? formatDate(job.preferred_date) : "Date TBD";
  const location = [job.address, job.city, job.state].filter(Boolean).join(", ");
  return <div className={cn("flex flex-col justify-between gap-4 rounded-xl bg-muted p-4 sm:flex-row sm:items-center", !compact && "border border-border bg-card p-5 hover:bg-muted/40")}><div className="flex min-w-0 items-start gap-4"><div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", closedStatuses.has(job.status) ? "bg-sage-light" : "bg-background")} >{closedStatuses.has(job.status) ? <CheckCircle2 className="h-5 w-5 text-sage-dark" /> : <Calendar className="h-5 w-5 text-accent" />}</div><div className="min-w-0"><p className="font-semibold">{job.service_type}</p><p className="text-sm text-muted-foreground">{job.contractor_id ? "Provider assigned" : "Awaiting assignment"}</p>{!compact && location && <p className="truncate text-sm text-muted-foreground">{location}</p>}<p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />{displayDate}{job.preferred_time ? ` • ${job.preferred_time}` : ""}</p></div></div><Badge className={cn("w-fit border capitalize", statusColor[job.status] ?? "border-border bg-muted text-muted-foreground")}>{formatStatus(job.status)}</Badge></div>;
}

function InvoiceRow({ invoice, compact = false }: { invoice: Invoice; compact?: boolean }) {
  return <div className={cn("flex flex-col justify-between gap-4 py-4 sm:flex-row sm:items-center", compact && "first:pt-0 last:pb-0", !compact && "sm:py-5")}><div className="flex items-center gap-4">{!compact && <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted"><CreditCard className="h-5 w-5 text-muted-foreground" /></div>}<div><p className="font-semibold">{invoice.invoice_number}</p><p className="text-sm text-muted-foreground">{formatDate(invoice.created_at)}</p></div></div><div className="flex items-center justify-between gap-4 sm:justify-end"><div className="text-right"><p className="font-semibold">${Number(invoice.amount).toFixed(2)}</p><Badge variant="secondary" className={cn("capitalize", invoiceStatusColor[invoice.status] ?? "bg-muted text-muted-foreground")}>{formatStatus(invoice.status)}</Badge></div>{!compact && <Button variant="outline" disabled>{payableStatuses.has(invoice.status) ? "Review & Pay" : "View Details"}</Button>}</div></div>;
}

function formatDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}
