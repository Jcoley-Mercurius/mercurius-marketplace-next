"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  Home,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Star,
  WalletCards,
} from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import {
  HomeownerJobDetailDialog,
  type HomeownerDashboardJob,
} from "@/components/dashboard/HomeownerJobDetailDialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  dashboardSectionFromParam,
  dashboardSectionHref,
} from "@/lib/homeownerPortal";
import { paymentFunctionError } from "@/lib/payments";
import {
  isPastServiceRequestStatus,
  serviceRequestStatusLabel,
  serviceRequestStatusStyle,
} from "@/lib/serviceRequestStatus";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ServiceRequest = HomeownerDashboardJob;

type Invoice = {
  id: string;
  invoice_number: string;
  amount: number;
  status: string;
  created_at: string;
  paid_at: string | null;
};

type DataMode = "loading" | "live" | "error";
type PaymentMethod = { id: string; brand: string; last4: string; exp_month: number | null; exp_year: number | null; is_default: boolean };
type PaymentNotice = { tone: "success" | "warning"; title: string; description: string };

// Keep this aligned with the create-checkout Edge Function's accepted statuses.
const payableStatuses = new Set(["draft", "pending"]);

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
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedJob, setSelectedJob] = useState<ServiceRequest | null>(null);
  const [requestedJobId, setRequestedJobId] = useState<string | null>(null);
  const [dataMode, setDataMode] = useState<DataMode>("loading");
  const [dashboardError, setDashboardError] = useState("");
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);
  const [paymentMethodsError, setPaymentMethodsError] = useState("");
  const [openingPortal, setOpeningPortal] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState<PaymentNotice | null>(null);
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const paymentCallbackPresent =
    searchParams.has("paid") ||
    searchParams.has("subscribed") ||
    searchParams.has("cancelled");
  const activeTab = paymentCallbackPresent
    ? "invoices"
    : dashboardSectionFromParam(searchParams.get("tab"));

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, router, user]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRequestedJobId(searchParams.get("job"));
      if (searchParams.has("paid")) {
        setPaymentNotice({ tone: "success", title: "Payment submitted securely", description: "Stripe returned you to Mercurius. The invoice status below is authoritative and will update after webhook confirmation." });
      } else if (searchParams.has("subscribed")) {
        setPaymentNotice({ tone: "success", title: "Subscription checkout submitted", description: "Stripe is confirming the subscription. Your service and invoice status will update after confirmation." });
      } else if (searchParams.has("cancelled")) {
        setPaymentNotice({ tone: "warning", title: "Checkout cancelled", description: "No new payment was completed. An eligible invoice can be paid from this page when you’re ready." });
      }
      if (paymentCallbackPresent) {
        router.replace("/dashboard?tab=invoices", { scroll: false });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [paymentCallbackPresent, router, searchParams]);

  const loadDashboard = useCallback(async ({
    showLoading = true,
    surfaceError = true,
  }: {
    showLoading?: boolean;
    surfaceError?: boolean;
  } = {}) => {
    if (!user) return;
    await Promise.resolve();
    if (showLoading) setDataMode("loading");
    if (surfaceError) setDashboardError("");

    try {
      const supabase = createClient();
      const [requestResult, invoiceResult] = await Promise.all([
        supabase
          .from("service_requests")
          .select("id, service_type, status, preferred_date, preferred_time, address, city, state, contractor_id, description, photo_proof_urls, total_amount, created_at")
          .eq("customer_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("invoices")
          .select("id, invoice_number, amount, status, created_at, paid_at")
          .eq("customer_id", user.id)
          .order("created_at", { ascending: false }),
      ]);

      if (requestResult.error) throw requestResult.error;
      if (invoiceResult.error) throw invoiceResult.error;

      setRequests((requestResult.data ?? []) as ServiceRequest[]);
      setInvoices(invoiceResult.data ?? []);
      setDashboardError("");
      setDataMode("live");
    } catch (error) {
      if (!surfaceError) throw error;

      // Never substitute fabricated records for a failed authenticated query.
      // Empty arrays in the success branch above represent a real zero-row result;
      // this branch is reserved for an actual data-access failure.
      setRequests([]);
      setInvoices([]);
      setSelectedJob(null);
      setDashboardError(dashboardLoadErrorMessage(error));
      setDataMode("error");
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(() => {
      void loadDashboard();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard, user]);

  const refreshAfterJobAction = useCallback(
    () => loadDashboard({ showLoading: false, surfaceError: false }),
    [loadDashboard],
  );

  const updateJobStatusOptimistically = useCallback(
    (jobId: string, status: string) => {
      setRequests((current) =>
        current.map((job) => (job.id === jobId ? { ...job, status } : job)),
      );
    },
    [],
  );

  const removeJobFromDashboard = useCallback((jobId: string) => {
    setRequests((current) => current.filter((job) => job.id !== jobId));
  }, []);

  useEffect(() => {
    if (!user || activeTab !== "payment-methods" || dataMode !== "live") return;
    let active = true;
    const timer = window.setTimeout(() => {
      setPaymentMethodsLoading(true);
      setPaymentMethodsError("");
      createClient().functions.invoke("list-payment-methods", { body: {} }).then(async ({ data, error }) => {
        if (!active) return;
        if (error) {
          const detail = await paymentFunctionError(error);
          setPaymentMethodsError(detail.message);
          setPaymentMethods([]);
        } else {
          setPaymentMethods(Array.isArray(data?.payment_methods) ? data.payment_methods as PaymentMethod[] : []);
        }
        setPaymentMethodsLoading(false);
      });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [activeTab, dataMode, user]);

  async function startInvoiceCheckout(invoiceId: string) {
    if (dataMode !== "live") return;
    setPayingInvoiceId(invoiceId);
    try {
      const { data, error } = await createClient().functions.invoke("create-checkout", { body: { invoice_id: invoiceId } });
      if (error) {
        const detail = await paymentFunctionError(error);
        throw new Error(detail.message);
      }
      if (typeof data?.url !== "string") throw new Error("Secure checkout did not return a payment link.");
      window.location.assign(data.url);
    } catch (reason) {
      toast.error("Payment could not be started", { description: reason instanceof Error ? reason.message : "Please try again or contact support." });
      setPayingInvoiceId(null);
    }
  }

  async function openPaymentPortal() {
    if (dataMode !== "live") return;
    setOpeningPortal(true);
    try {
      const { data, error } = await createClient().functions.invoke("customer-portal", { body: {} });
      if (error) {
        const detail = await paymentFunctionError(error);
        throw new Error(detail.message);
      }
      if (typeof data?.url !== "string") throw new Error("Card management did not return a secure link.");
      window.location.assign(data.url);
    } catch (reason) {
      toast.error("Card management could not be opened", { description: reason instanceof Error ? reason.message : "Please try again later." });
      setOpeningPortal(false);
    }
  }

  const { upcoming, past, quoted, awaitingConfirmation, awaitingReview } = useMemo(
    () => ({
      upcoming: requests.filter((request) => !isPastServiceRequestStatus(request.status)),
      past: requests.filter((request) => isPastServiceRequestStatus(request.status)),
      quoted: requests.filter((request) => request.status === "quoted"),
      awaitingConfirmation: requests.filter((request) =>
        ["pending_review", "vendor_completed"].includes(request.status),
      ),
      awaitingReview: requests.filter((request) => request.status === "review_requested"),
    }),
    [requests],
  );

  useEffect(() => {
    if (!requestedJobId || dataMode !== "live") return;
    const timer = window.setTimeout(() => {
      const requestedJob = requests.find(
        (request) => request.id === requestedJobId,
      );
      if (requestedJob) {
        setSelectedJob(requestedJob);
      } else {
        toast.error("This service update is no longer available", {
          description:
            "The request may have been removed, or it may no longer be available to this account.",
        });
      }

      setRequestedJobId(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("job");
      window.history.replaceState(
        {},
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dataMode, requestedJobId, requests]);

  if (authLoading || !user) {
    return <FullPageLoading label={authLoading ? "Loading your dashboard..." : "Taking you to sign in..."} />;
  }

  const fullName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
  const firstName = fullName.split(" ")[0] || "Homeowner";
  const openInvoices = invoices.filter((invoice) => payableStatuses.has(invoice.status));

  return (
    <>
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 md:p-8">
        <header className="mb-7 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
              <Home className="h-4 w-4" /> Homeowner overview
            </p>
            <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
              Welcome back, {firstName}!
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Track upcoming work, review completed services, and manage billing
              from one place.
            </p>
          </div>
          <Link
            href="/request"
            className={cn(
              buttonVariants({ size: "lg" }),
              "h-11 w-full shrink-0 bg-accent px-4 text-accent-foreground hover:bg-accent-hover sm:w-auto",
            )}
          >
            <Plus className="h-4 w-4" /> Request Service
          </Link>
        </header>

            {dataMode === "error" ? (
              <DashboardLoadError
                message={dashboardError}
                onRetry={() => void loadDashboard()}
              />
            ) : (
              <>
              {paymentNotice && (
              <div className={cn("mb-6 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm", paymentNotice.tone === "success" ? "border-sage/30 bg-sage-light/60 text-sage-dark" : "border-amber-200 bg-amber-50 text-amber-950")}>
                {paymentNotice.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                <div><p className="font-semibold">{paymentNotice.title}</p><p className="mt-0.5 text-current/80">{paymentNotice.description}</p></div>
              </div>
            )}

            {dataMode !== "loading" && (quoted.length > 0 || awaitingConfirmation.length > 0 || awaitingReview.length > 0) && (
              <div className="mb-8 space-y-3">
                {quoted.map((job) => (
                  <ActionBanner key={job.id} icon={CreditCard} title={`A quote is ready for ${job.service_type}`} description="Review the price and service details before approving or declining." action="Review quote" onClick={() => setSelectedJob(job)} tone="violet" />
                ))}
                {awaitingConfirmation.map((job) => (
                  <ActionBanner key={job.id} icon={CheckCircle2} title={`Is your ${job.service_type} all set?`} description="Your provider marked this service complete. Review the details and confirm the work." action="Review service" onClick={() => setSelectedJob(job)} tone="amber" />
                ))}
                {awaitingReview.map((job) => (
                  <ActionBanner key={job.id} icon={Star} title={`How did your ${job.service_type} go?`} description="Share a rating for your provider — it only takes a moment." action="Leave review" onClick={() => setSelectedJob(job)} tone="sage" />
                ))}
              </div>
            )}

            {activeTab === "overview" && (
              <div className="space-y-8">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <StatCard icon={Calendar} label="Upcoming Services" value={upcoming.length} loading={dataMode === "loading"} />
                  <StatCard icon={CheckCircle2} label="Completed" value={past.length} loading={dataMode === "loading"} />
                  <StatCard icon={CreditCard} label="Open Invoices" value={openInvoices.length} loading={dataMode === "loading"} />
                </div>

                <div>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Quick actions</h2>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <QuickAction href="/request" icon={Plus} label="Request a Service" />
                    <QuickAction href="/messages" icon={MessageSquare} label="Messages" />
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
                      <Button size="sm" variant="outline" onClick={() => setSelectedJob(quoted[0])}>Review <ArrowRight className="h-3 w-3" /></Button>
                    </CardContent>
                  </Card>
                )}

                <div className="grid gap-8 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="flex-row items-center justify-between">
                      <CardTitle>Upcoming Services</CardTitle>
                      <Button variant="link" size="sm" onClick={() => router.push(dashboardSectionHref("upcoming"), { scroll: false })}>View All <ArrowRight className="h-3 w-3" /></Button>
                    </CardHeader>
                    <CardContent>
                      {dataMode === "loading" ? <ListLoading /> : upcoming.length === 0 ? <EmptyState icon={Calendar} title="No upcoming services" description="When you request a service, its status and schedule will appear here." actionHref="/request" actionLabel="Request a Service" compact /> : (
                        <div className="space-y-3">{upcoming.slice(0, 2).map((job) => <ServiceRow key={job.id} job={job} compact onOpen={() => setSelectedJob(job)} />)}</div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex-row items-center justify-between">
                      <CardTitle>Recent Invoices</CardTitle>
                      <Button variant="link" size="sm" onClick={() => router.push(dashboardSectionHref("invoices"), { scroll: false })}>View All <ArrowRight className="h-3 w-3" /></Button>
                    </CardHeader>
                    <CardContent>
                      {dataMode === "loading" ? <ListLoading /> : invoices.length === 0 ? <EmptyState icon={CreditCard} title="No invoices yet" description="Invoices will appear here after service work is billed." compact /> : (
                        <div className="divide-y divide-border">{invoices.slice(0, 3).map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} compact />)}</div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {activeTab === "upcoming" && (
              <div>
                <Card>
                  <CardHeader><CardTitle>Upcoming Services</CardTitle><CardDescription>Track requests, quotes, schedules, and active work.</CardDescription></CardHeader>
                  <CardContent>
                    {dataMode === "loading" ? <ListLoading large /> : upcoming.length === 0 ? <EmptyState icon={Calendar} title="No upcoming services scheduled" description="Build a service plan whenever your home needs attention." actionHref="/request" actionLabel="Request a Service" /> : (
                      <div className="space-y-4">{upcoming.map((job) => <ServiceRow key={job.id} job={job} onOpen={() => setSelectedJob(job)} />)}</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "past" && (
              <div>
                <Card>
                  <CardHeader><CardTitle>Past Services</CardTitle><CardDescription>Your completed and closed service history.</CardDescription></CardHeader>
                  <CardContent>
                    {dataMode === "loading" ? <ListLoading large /> : past.length === 0 ? <EmptyState icon={CheckCircle2} title="No completed services yet" description="Completed jobs will be saved here for easy reference." /> : (
                      <div className="space-y-4">{past.map((job) => <ServiceRow key={job.id} job={job} />)}</div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "invoices" && (
              <div>
                <Card>
                  <CardHeader><CardTitle>Invoices &amp; Payments</CardTitle><CardDescription>Review charges and track payment status.</CardDescription></CardHeader>
                  <CardContent>
                    {dataMode === "loading" ? <ListLoading large /> : invoices.length === 0 ? <EmptyState icon={CreditCard} title="No invoices yet" description="Invoices will appear after a provider bills completed work." /> : (
                      <div className="divide-y divide-border">{invoices.map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} paying={payingInvoiceId === invoice.id} paymentsEnabled={dataMode === "live"} onPay={startInvoiceCheckout} />)}</div>
                    )}
                    <div className="mt-5 flex items-start gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><p>Card details are entered on Stripe Checkout. Mercurius shows an invoice as paid only after server-side confirmation.</p></div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "payment-methods" && (
              <div>
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-accent" /> Payment Methods</CardTitle><CardDescription>Manage how you pay for Mercurius services.</CardDescription></CardHeader>
                  <CardContent className="space-y-4">
                    {paymentMethodsLoading ? <ListLoading large /> : paymentMethodsError ? <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-6 text-center"><p className="font-medium text-red-900">Payment methods could not be loaded</p><p className="mt-1 text-sm text-red-800">{paymentMethodsError}</p></div> : paymentMethods.length === 0 ? <div className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center"><CreditCard className="mx-auto mb-4 h-9 w-9 text-muted-foreground" /><p className="font-medium">No saved cards yet</p><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Cards saved through Stripe can make future invoice checkout faster.</p></div> : <div className="space-y-3">{paymentMethods.map((method) => <div key={method.id} className="flex items-center justify-between rounded-xl border border-border p-4"><div className="flex items-center gap-3"><span className="flex h-10 w-12 items-center justify-center rounded-lg bg-muted"><CreditCard className="h-5 w-5 text-muted-foreground" /></span><div><p className="font-medium capitalize">{cardBrand(method.brand)} •••• {method.last4}</p>{method.exp_month && method.exp_year && <p className="text-sm text-muted-foreground">Expires {String(method.exp_month).padStart(2, "0")}/{String(method.exp_year).slice(-2)}</p>}</div></div>{method.is_default && <Badge className="bg-sage-light text-sage-dark">Default</Badge>}</div>)}</div>}
                    <div className="flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" /><p>Cards are stored and managed by Stripe, not in the Mercurius app.</p></div><Button variant="outline" disabled={openingPortal || dataMode !== "live"} onClick={() => void openPaymentPortal()}>{openingPortal ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}Manage Cards</Button></div>
                  </CardContent>
                </Card>
              </div>
            )}
              </>
            )}
      </div>
      <HomeownerJobDetailDialog
        key={selectedJob?.id ?? "no-selected-job"}
        job={selectedJob}
        homeownerId={user.id}
        open={Boolean(selectedJob)}
        actionsEnabled={dataMode === "live"}
        onOpenChange={(open) => {
          if (!open) setSelectedJob(null);
        }}
        onRemoveJob={removeJobFromDashboard}
        onOptimisticStatus={updateJobStatusOptimistically}
        onRefresh={refreshAfterJobAction}
      />
    </>
  );
}

function FullPageLoading({ label }: { label: string }) {
  return <div className="flex min-h-screen items-center justify-center bg-background"><div className="flex items-center gap-3 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin text-accent" />{label}</div></div>;
}

function DashboardLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="mx-auto max-w-2xl border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/20">
      <CardContent className="flex flex-col items-center px-6 py-10 text-center sm:px-10">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-100 dark:bg-red-950/50">
          <AlertTriangle className="h-6 w-6 text-red-700 dark:text-red-300" />
        </div>
        <h2 className="text-xl font-semibold text-red-950 dark:text-red-100">
          We couldn’t load your dashboard
        </h2>
        <p className="mt-2 max-w-lg text-sm leading-6 text-red-900/80 dark:text-red-200/80">
          Your live services and invoices are temporarily unavailable. No sample records have been substituted.
        </p>
        {message && (
          <p className="mt-3 max-w-lg text-xs text-red-800/80 dark:text-red-300/80">
            {message}
          </p>
        )}
        <Button
          type="button"
          className="mt-6 bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active"
          onClick={onRetry}
        >
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      </CardContent>
    </Card>
  );
}

function StatCard({ icon: Icon, label, value, loading }: { icon: ComponentType<{ className?: string }>; label: string; value: number; loading: boolean }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm text-muted-foreground"><Icon className="h-4 w-4" /> {label}</CardTitle></CardHeader><CardContent>{loading ? <div className="h-9 w-12 animate-pulse rounded bg-muted" /> : <p className="text-3xl font-bold">{value}</p>}</CardContent></Card>;
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: ComponentType<{ className?: string }>; label: string }) {
  return <Link href={href} className="flex items-center rounded-xl border border-border bg-card p-4 font-medium transition-all hover:border-accent/40 hover:bg-muted/50"><Icon className="mr-3 h-5 w-5 text-accent" />{label}</Link>;
}

function ActionBanner({ icon: Icon, title, description, action, onClick, tone }: { icon: ComponentType<{ className?: string }>; title: string; description: string; action: string; onClick: () => void; tone: "amber" | "sage" | "violet" }) {
  const toneClasses = tone === "amber"
    ? "border-amber-200 bg-amber-50 ring-amber-200 dark:bg-amber-950/20"
    : tone === "violet"
      ? "border-violet-200 bg-violet-50 ring-violet-200 dark:bg-violet-950/20"
      : "border-sage/30 bg-sage-light/40 ring-sage/30";
  const iconClasses = tone === "amber" ? "text-amber-700" : tone === "violet" ? "text-violet-700" : "text-sage-dark";
  return <Card className={toneClasses}><CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><Icon className={cn("mt-0.5 h-5 w-5", iconClasses)} /><div><p className="font-medium">{title}</p><p className="text-sm text-muted-foreground">{description}</p></div></div><Button onClick={onClick} className="bg-accent text-accent-foreground hover:bg-accent-hover active:bg-accent-active">{action}</Button></CardContent></Card>;
}

function ListLoading({ large = false }: { large?: boolean }) {
  return <div className={cn("flex items-center justify-center", large ? "py-16" : "py-9")}><Loader2 className="h-6 w-6 animate-spin text-accent" /><span className="sr-only">Loading</span></div>;
}

function EmptyState({ icon: Icon, title, description, actionHref, actionLabel, compact = false }: { icon: ComponentType<{ className?: string }>; title: string; description: string; actionHref?: string; actionLabel?: string; compact?: boolean }) {
  return <div className={cn("flex flex-col items-center px-4 text-center", compact ? "py-7" : "py-12")}><div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted"><Icon className="h-6 w-6 text-muted-foreground" /></div><p className="font-medium">{title}</p><p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>{actionHref && actionLabel && <Link href={actionHref} className={cn(buttonVariants(), "mt-5 bg-accent text-accent-foreground hover:bg-accent/90")}>{actionLabel}</Link>}</div>;
}

function ServiceRow({ job, compact = false, onOpen }: { job: ServiceRequest; compact?: boolean; onOpen?: () => void }) {
  const displayDate = job.preferred_date ? formatDate(job.preferred_date) : "Date TBD";
  const location = [job.address, job.city, job.state].filter(Boolean).join(", ");
  const className = cn("flex w-full flex-col justify-between gap-4 rounded-xl bg-muted p-4 text-left sm:flex-row sm:items-center", !compact && "border border-border bg-card p-5", onOpen && "cursor-pointer transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring");
  const isPast = isPastServiceRequestStatus(job.status);
  const needsAttention = job.status === "disputed" || job.status === "cancelled";
  const content = <><div className="flex min-w-0 items-start gap-4"><div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", isPast ? "bg-sage-light" : "bg-background", needsAttention && "bg-red-100 dark:bg-red-950/30")} >{needsAttention ? <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-300" /> : isPast ? <CheckCircle2 className="h-5 w-5 text-sage-dark" /> : <Calendar className="h-5 w-5 text-accent" />}</div><div className="min-w-0"><p className="font-semibold">{job.service_type}</p><p className="text-sm text-muted-foreground">{job.contractor_id ? "Provider assigned" : "Awaiting assignment"}</p>{!compact && location && <p className="truncate text-sm text-muted-foreground">{location}</p>}<p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><Clock className="h-3.5 w-3.5" />{displayDate}{job.preferred_time ? ` • ${job.preferred_time}` : ""}</p></div></div><div className="flex items-center gap-2"><Badge className={cn("w-fit border", serviceRequestStatusStyle(job.status))}>{serviceRequestStatusLabel(job.status)}</Badge>{onOpen && <ArrowRight className="h-4 w-4 text-muted-foreground" />}</div></>;
  return onOpen ? <button type="button" className={className} onClick={onOpen} aria-label={`Open ${job.service_type} details`}>{content}</button> : <div className={className}>{content}</div>;
}

function InvoiceRow({ invoice, compact = false, paying = false, paymentsEnabled = false, onPay }: { invoice: Invoice; compact?: boolean; paying?: boolean; paymentsEnabled?: boolean; onPay?: (invoiceId: string) => Promise<void> }) {
  const payable = payableStatuses.has(invoice.status);
  return <div className={cn("flex flex-col justify-between gap-4 py-4 sm:flex-row sm:items-center", compact && "first:pt-0 last:pb-0", !compact && "sm:py-5")}><div className="flex items-center gap-4">{!compact && <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted"><CreditCard className="h-5 w-5 text-muted-foreground" /></div>}<div><p className="font-semibold">{invoice.invoice_number}</p><p className="text-sm text-muted-foreground">{formatDate(invoice.created_at)}</p>{invoice.paid_at && <p className="mt-1 text-xs text-sage-dark">Confirmed {formatDate(invoice.paid_at)}</p>}</div></div><div className="flex items-center justify-between gap-4 sm:justify-end"><div className="text-right"><p className="font-semibold">${Number(invoice.amount).toFixed(2)}</p><Badge variant="secondary" className={cn("capitalize", invoiceStatusColor[invoice.status] ?? "bg-muted text-muted-foreground")}>{formatStatus(invoice.status)}</Badge></div>{!compact && payable && <Button variant="outline" disabled={!paymentsEnabled || paying} onClick={() => void onPay?.(invoice.id)}>{paying ? <><Loader2 className="h-4 w-4 animate-spin" />Opening Stripe...</> : "Pay Securely"}</Button>}{!compact && !payable && ["sent", "overdue"].includes(invoice.status) && <Link href="/contact" className={buttonVariants({ variant: "outline", size: "sm" })}>Contact Support</Link>}</div></div>;
}

function cardBrand(value: string) {
  const labels: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", jcb: "JCB", diners: "Diners Club", unionpay: "UnionPay", card: "Card" };
  return labels[value] ?? value;
}

function dashboardLoadErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim()
  ) {
    return error.message;
  }
  return "Please check your connection and try again.";
}

function formatDate(value: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}
