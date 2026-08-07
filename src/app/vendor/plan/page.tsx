"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Loader2,
  Mail,
  RefreshCw,
  Star,
  Zap,
} from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type ContractorPlan = {
  id: string;
  name: string;
  marketing_enabled: boolean;
};

type Plan = {
  id: "essential" | "growth" | "enterprise";
  name: string;
  price: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  features: string[];
};

const plans: Plan[] = [
  {
    id: "essential",
    name: "Essential",
    price: "Free",
    description: "Get listed and start receiving Mercurius job opportunities.",
    icon: Zap,
    features: [
      "Provider directory listing",
      "Job and request notifications",
      "Customer reviews from Mercurius jobs",
      "Core profile visibility",
      "Job tracking",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    price: "$79/mo",
    description: "Add marketing visibility, performance reporting, and hands-on support.",
    icon: Star,
    features: [
      "Everything in Essential",
      "Enhanced visibility support",
      "Marketing performance dashboard",
      "Review follow-up tools",
      "Profile marketing support",
      "Dedicated support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    description: "A custom marketing and operations scope for larger provider businesses.",
    icon: Building2,
    features: [
      "Everything in Growth",
      "Multi-location planning",
      "Custom visibility strategy",
      "Dedicated account coordination",
      "Custom integration discovery",
      "Service terms confirmed in writing",
    ],
  },
];

export default function VendorPlanPage() {
  const { user } = useAuth();
  const [contractor, setContractor] = useState<ContractorPlan | null>(null);
  const [mode, setMode] = useState<"loading" | "ready" | "unlinked" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    const result = await createClient()
      .from("contractors")
      .select("id, name, marketing_enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    if (result.error) {
      setContractor(null);
      setError(result.error.message);
      setMode("error");
      return;
    }
    if (!result.data) {
      setContractor(null);
      setMode("unlinked");
      return;
    }
    setContractor(result.data as ContractorPlan);
    setMode("ready");
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (mode === "loading") return <State loading />;
  if (mode === "unlinked") return <State title="No contractor profile linked" copy="Plan access will appear after Mercurius links your approved vendor profile." />;
  if (mode === "error") return <State title="Plan information couldn’t be loaded" copy={`No subscription status has been assumed. ${error}`} action={<Button variant="outline" onClick={() => { setMode("loading"); void load(); }}><RefreshCw />Try again</Button>} />;
  if (!contractor) return null;

  const currentPlan: Plan["id"] = contractor.marketing_enabled ? "growth" : "essential";
  const current = plans.find((plan) => plan.id === currentPlan)!;

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 md:p-8">
      <header className="mb-6">
        <h1 className="font-heading text-2xl font-semibold">Your Plan</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose the level of Mercurius marketing support that fits your growth goals.</p>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3">
        <Badge variant="outline" className="border-sage/40 bg-sage/10 text-sage-dark">Current Access</Badge>
        <span className="text-sm font-medium">{current.name} — {current.price}</span>
        <span className="text-sm text-muted-foreground">
          {currentPlan === "growth"
            ? "Marketing access is enabled for this vendor profile. Billing details are managed by Mercurius outside the portal."
            : "No paid vendor-plan entitlement is recorded for this profile."}
        </span>
      </div>

      <div className="grid items-start gap-6 pt-3 md:grid-cols-3 md:gap-7">
        {plans.map((plan) => <PlanCard key={plan.id} plan={plan} current={plan.id === currentPlan} currentPlan={currentPlan} contractorName={contractor.name} />)}
      </div>

      <div className="mx-auto mt-8 max-w-3xl rounded-xl border border-dashed bg-muted/25 px-5 py-4 text-center">
        <p className="text-sm text-muted-foreground">
          Vendor plan checkout and self-service billing are not connected yet. Mercurius confirms pricing, included services, effective dates, and cancellation terms before changing access.
        </p>
      </div>
    </div>
  );
}

function PlanCard({ plan, current, currentPlan, contractorName }: { plan: Plan; current: boolean; currentPlan: Plan["id"]; contractorName: string }) {
  const growth = plan.id === "growth";
  const inquiry = new URLSearchParams({
    subject: `Vendor plan inquiry — ${plan.name}`,
    body: `Hi Mercurius, I’d like to discuss the ${plan.name} plan for ${contractorName}.`,
  });
  const contactHref = `mailto:hello@mercurius.com?${inquiry.toString()}`;
  const actionLabel = plan.id === "enterprise" ? "Contact Sales" : currentPlan === "growth" && plan.id === "essential" ? "Request plan change" : "Ask about Growth";

  return <Card className={cn(
    "relative flex h-full flex-col rounded-2xl transition-shadow",
    growth ? "border-accent/60 bg-accent/[0.03] shadow-lg shadow-accent/10 md:-mt-2" : "border-border hover:shadow-sm",
    current && "border-sage/50 ring-1 ring-sage/15",
  )}>
    {growth && <div className="absolute -top-3 left-1/2 -translate-x-1/2"><Badge className="bg-accent text-accent-foreground shadow-sm">Most Popular</Badge></div>}
    <CardHeader className="pb-4">
      <div className="mb-4 flex items-center justify-between gap-3"><div className={cn("flex h-10 w-10 items-center justify-center rounded-xl", growth ? "bg-accent/10" : current ? "bg-sage/10" : "bg-muted")}><plan.icon className={cn("h-5 w-5", growth ? "text-accent" : current ? "text-sage" : "text-muted-foreground")} /></div>{current && <Badge variant="outline" className="border-sage/40 bg-sage/10 text-xs text-sage-dark">Current Access</Badge>}</div>
      <CardTitle className="text-base font-semibold">{plan.name}</CardTitle>
      <p className="mt-1 text-3xl font-bold tracking-tight">{plan.price}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
    </CardHeader>
    <CardContent className="flex flex-1 flex-col pt-0">
      <div className="border-t border-border/70 pt-5"><ul className="flex-1 space-y-3">{plan.features.map((feature) => <li key={feature} className="flex items-start gap-2.5 text-sm leading-snug text-foreground/80"><CheckCircle2 className={cn("mt-0.5 h-4 w-4 shrink-0", growth ? "text-accent" : "text-sage")} />{feature}</li>)}</ul></div>
      <div className="mt-7 pt-1">{current ? <Button variant="outline" className="w-full" disabled>Current Access</Button> : <a href={contactHref} className={cn(buttonVariants(), "w-full", growth ? "bg-accent text-accent-foreground hover:bg-accent/90" : "bg-foreground text-background hover:bg-foreground/90")}><Mail />{actionLabel}<ArrowUpRight /></a>}</div>
      {!current && <p className="mt-3 text-center text-[11px] leading-relaxed text-muted-foreground">Inquiry only — no charge or plan change occurs from this page.</p>}
    </CardContent>
  </Card>;
}

function State({ loading, title, copy, action }: { loading?: boolean; title?: string; copy?: string; action?: React.ReactNode }) {
  if (loading) return <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-6 w-6 animate-spin text-accent" />Loading plan access…</div>;
  return <div className="flex min-h-[520px] items-center justify-center p-8 text-center"><div><AlertCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" /><h1 className="text-xl font-semibold">{title}</h1><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{copy}</p>{action && <div className="mt-5">{action}</div>}</div></div>;
}
