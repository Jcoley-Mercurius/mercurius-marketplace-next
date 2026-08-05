"use client";

import { useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";

type Service = {
  id: string;
  name: string;
  provider: string;
  date: string;
  time?: string;
  status: "scheduled" | "matched" | "completed";
};

type Invoice = {
  id: string;
  number: string;
  date: string;
  amount: number;
  status: "paid" | "sent";
};

const upcomingServices: Service[] = [
  {
    id: "service-1",
    name: "Lawn Care",
    provider: "Gulf Coast Lawn & Landscape",
    date: "Aug 12, 2026",
    time: "9:00–11:00 AM",
    status: "scheduled",
  },
  {
    id: "service-2",
    name: "Pool Service",
    provider: "Awaiting provider assignment",
    date: "Aug 18, 2026",
    status: "matched",
  },
];

const pastServices: Service[] = [
  {
    id: "service-3",
    name: "Air Conditioning Tune-Up",
    provider: "Comfort First HVAC",
    date: "Jul 24, 2026",
    status: "completed",
  },
  {
    id: "service-4",
    name: "House Cleaning",
    provider: "Cape Clean Home Services",
    date: "Jul 11, 2026",
    status: "completed",
  },
];

const invoices: Invoice[] = [
  { id: "invoice-1", number: "INV-1048", date: "Aug 2, 2026", amount: 89, status: "sent" },
  { id: "invoice-2", number: "INV-1029", date: "Jul 24, 2026", amount: 149, status: "paid" },
  { id: "invoice-3", number: "INV-1014", date: "Jul 11, 2026", amount: 120, status: "paid" },
];

const serviceStatusStyles = {
  scheduled: "border-sage/20 bg-sage-light text-sage-dark",
  matched: "border-blue-200 bg-blue-100 text-blue-800",
  completed: "border-border bg-muted text-muted-foreground",
};

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, router, user]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
          {loading ? "Loading your dashboard..." : "Taking you to sign in..."}
        </div>
      </div>
    );
  }

  const fullName =
    typeof user.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name.trim()
      : "";
  const firstName = fullName.split(" ")[0] || "Homeowner";

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main>
        <section className="bg-primary py-8">
          <div className="container-wide flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-primary-foreground/70">
                <Home className="h-4 w-4" />
                Homeowner Portal
              </div>
              <h1 className="text-2xl font-semibold !text-primary-foreground">
                Welcome back, {firstName}!
              </h1>
              <p className="mt-1 text-sm text-primary-foreground/60">
                Here&apos;s what&apos;s happening with your home.
              </p>
            </div>
            <Link
              href="/#bundle-builder"
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-11 bg-accent px-4 text-accent-foreground hover:bg-accent/90",
              )}
            >
              <Plus className="h-4 w-4" /> Request Service
            </Link>
          </div>
        </section>

        <section className="py-10 md:py-12">
          <div className="container-wide">
            <Card className="mb-7 border-amber-200 bg-amber-50 ring-amber-200">
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                  <div>
                    <p className="font-medium text-foreground">You have an invoice ready to review</p>
                    <p className="text-sm text-muted-foreground">
                      Invoice INV-1048 for your recent lawn service is awaiting payment.
                    </p>
                  </div>
                </div>
                <Button variant="outline" onClick={() => setActiveTab("invoices")}>
                  Review invoice <ArrowRight className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>

            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">Your home dashboard</h2>
                <p className="text-sm text-muted-foreground">
                  Preview data is shown while live service history is connected.
                </p>
              </div>
              <Badge variant="secondary">Preview</Badge>
            </div>

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

              <TabsContent value="overview">
                <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <StatCard icon={Calendar} label="Upcoming Services" value={upcomingServices.length} />
                  <StatCard icon={CheckCircle2} label="Completed" value={pastServices.length} />
                  <StatCard icon={CreditCard} label="Open Invoices" value={invoices.filter((invoice) => invoice.status === "sent").length} />
                </div>

                <div className="mb-8 grid gap-4 sm:grid-cols-3">
                  <QuickAction href="/#bundle-builder" icon={Plus} label="Request a Service" />
                  <QuickAction href="/contact" icon={MessageSquare} label="Contact Support" />
                  <QuickAction href="/contact" icon={AlertTriangle} label="Report an Issue" />
                </div>

                <div className="grid gap-8 lg:grid-cols-2">
                  <Card>
                    <CardHeader className="flex-row items-center justify-between">
                      <CardTitle>Upcoming Services</CardTitle>
                      <Button variant="link" size="sm" onClick={() => setActiveTab("upcoming")}>
                        View all <ArrowRight className="h-3 w-3" />
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {upcomingServices.map((service) => <ServiceRow key={service.id} service={service} compact />)}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="flex-row items-center justify-between">
                      <CardTitle>Recent Invoices</CardTitle>
                      <Button variant="link" size="sm" onClick={() => setActiveTab("invoices")}>
                        View all <ArrowRight className="h-3 w-3" />
                      </Button>
                    </CardHeader>
                    <CardContent className="divide-y divide-border">
                      {invoices.slice(0, 3).map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} compact />)}
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              <TabsContent value="upcoming">
                <Card>
                  <CardHeader>
                    <CardTitle>Upcoming Services</CardTitle>
                    <CardDescription>Track scheduled work and provider assignments.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {upcomingServices.map((service) => <ServiceRow key={service.id} service={service} />)}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="past">
                <Card>
                  <CardHeader>
                    <CardTitle>Past Services</CardTitle>
                    <CardDescription>Your recently completed home services.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {pastServices.map((service) => <ServiceRow key={service.id} service={service} />)}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="invoices">
                <Card>
                  <CardHeader>
                    <CardTitle>Invoices &amp; Payments</CardTitle>
                    <CardDescription>Review recent charges and payment status.</CardDescription>
                  </CardHeader>
                  <CardContent className="divide-y divide-border">
                    {invoices.map((invoice) => <InvoiceRow key={invoice.id} invoice={invoice} />)}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="payment-methods">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-accent" /> Payment Methods</CardTitle>
                    <CardDescription>Secure payment-method management is coming in the live dashboard.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/50 px-6 py-12 text-center">
                      <ShieldCheck className="mb-4 h-10 w-10 text-accent" />
                      <p className="font-medium">No saved payment methods</p>
                      <p className="mt-1 max-w-md text-sm text-muted-foreground">
                        Payment details will be securely managed through the connected payment provider.
                      </p>
                      <Button className="mt-5" disabled>Add payment method</Button>
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

function StatCard({ icon: Icon, label, value }: { icon: typeof Calendar; label: string; value: number }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4 text-accent" /> {label}
        </CardTitle>
      </CardHeader>
      <CardContent><p className="text-3xl font-bold">{value}</p></CardContent>
    </Card>
  );
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: typeof Plus; label: string }) {
  return (
    <Link href={href} className="flex items-center rounded-xl border border-border bg-card p-4 font-medium transition-colors hover:border-accent/40 hover:bg-muted/50">
      <Icon className="mr-3 h-5 w-5 text-accent" /> {label}
    </Link>
  );
}

function ServiceRow({ service, compact = false }: { service: Service; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col justify-between gap-4 rounded-xl bg-muted p-4 sm:flex-row sm:items-center", !compact && "border border-border bg-card p-5")}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background">
          {service.status === "completed" ? <CheckCircle2 className="h-5 w-5 text-accent" /> : <Calendar className="h-5 w-5 text-accent" />}
        </div>
        <div>
          <p className="font-medium">{service.name}</p>
          <p className="text-sm text-muted-foreground">{service.provider}</p>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> {service.date}{service.time ? ` • ${service.time}` : ""}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 self-start sm:self-auto">
        <Badge className={cn("capitalize", serviceStatusStyles[service.status])}>{service.status}</Badge>
        {service.status === "completed" && <Star className="h-4 w-4 text-amber-500" />}
      </div>
    </div>
  );
}

function InvoiceRow({ invoice, compact = false }: { invoice: Invoice; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center", compact && "first:pt-0 last:pb-0")}>
      <div className="flex items-center gap-3">
        {!compact && <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted"><CreditCard className="h-5 w-5 text-muted-foreground" /></div>}
        <div>
          <p className="font-medium">{invoice.number}</p>
          <p className="text-sm text-muted-foreground">{invoice.date}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <div className="text-right">
          <p className="font-semibold">${invoice.amount.toFixed(2)}</p>
          <Badge variant="secondary" className={cn("capitalize", invoice.status === "paid" ? "bg-sage-light text-sage-dark" : "bg-blue-100 text-blue-800")}>
            {invoice.status}
          </Badge>
        </div>
        {!compact && <Button variant="outline" disabled>{invoice.status === "sent" ? "Review & Pay" : "View"}</Button>}
      </div>
    </div>
  );
}
