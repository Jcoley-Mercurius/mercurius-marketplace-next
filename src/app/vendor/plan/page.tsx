"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import {
  AlertCircle,
  BadgePercent,
  Building2,
  CheckCircle2,
  Clock3,
  Loader2,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

type ContractorPlan = {
  id: string;
  name: string;
};

type DeferredOffering = {
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  features: string[];
};

const includedAccess = [
  "Public provider profile and directory presence",
  "Job and request notifications",
  "Pricing and package publishing",
  "Vendor messaging and job tracking",
  "Reviews from completed Mercurius jobs",
  "Free listing-share and review-request tools",
];

const deferredOfferings: DeferredOffering[] = [
  {
    name: "Growth tools",
    description: "Expanded visibility, performance reporting, and additional profile marketing support.",
    icon: Megaphone,
    features: ["Marketing performance insights", "Expanded campaign tools", "Additional listing support"],
  },
  {
    name: "Managed marketing",
    description: "A future hands-on marketing option for vendors that want additional help beyond the core platform.",
    icon: Building2,
    features: ["Custom marketing scope", "Campaign coordination", "Terms confirmed before activation"],
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
      .select("id, name")
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
  if (mode === "unlinked") return <State title="No contractor profile linked" copy="Plan information will appear after Mercurius links your approved vendor profile." />;
  if (mode === "error") return <State title="Plan information couldn’t be loaded" copy={`No plan or billing status has been assumed. ${error}`} action={<Button variant="outline" onClick={() => { setMode("loading"); void load(); }}><RefreshCw />Try again</Button>} />;
  if (!contractor) return null;

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 md:p-8">
      <header className="mb-7">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Vendor plans</p>
        <h1 className="font-heading text-2xl font-semibold sm:text-3xl">Plans</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">No paid plans are offered during the Mercurius soft launch. Every approved vendor receives core platform access with no subscription; Mercurius charges a flat 15% commission on completed jobs.</p>
      </header>

      <Card className="mb-8 overflow-hidden border-accent-border bg-card shadow-sm">
        <CardHeader className="border-b border-accent-border bg-accent-subtle p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-sage-dark"><ShieldCheck className="h-6 w-6" /></span>
              <div>
                <div className="flex flex-wrap items-center gap-2"><CardTitle className="text-xl">Soft-launch vendor access</CardTitle><Badge className="border-accent-border bg-background text-sage-dark">Current</Badge></div>
                <p className="mt-1 text-sm text-muted-foreground">Active for {contractor.name}</p>
              </div>
            </div>
            <div className="sm:text-right"><p className="text-3xl font-semibold tracking-tight">Free</p><p className="text-xs text-muted-foreground">No monthly subscription</p></div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 p-5 sm:p-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <h2 className="text-sm font-semibold">Included now</h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {includedAccess.map((feature) => <li key={feature} className="flex items-start gap-2.5 text-sm leading-5 text-foreground/80"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" />{feature}</li>)}
            </ul>
          </div>
          <div className="rounded-2xl border border-accent-border bg-accent-subtle p-5 lg:col-span-2">
            <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-background text-sage-dark ring-1 ring-accent-border"><BadgePercent className="h-5 w-5" /></span>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Platform commission</p>
            <p className="mt-1 font-heading text-4xl font-semibold text-foreground">15%</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">A flat commission applies to completed Mercurius jobs. There is no monthly vendor subscription during soft launch.</p>
          </div>
        </CardContent>
      </Card>

      <section>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="font-heading text-xl font-semibold">Coming after soft launch</h2><p className="mt-1 text-sm text-muted-foreground">Paid Growth and managed marketing options are deferred while Mercurius focuses on core operations.</p></div>
          <Badge variant="outline" className="w-fit gap-1.5 text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Not available yet</Badge>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {deferredOfferings.map((offering) => <DeferredCard key={offering.name} offering={offering} />)}
        </div>
      </section>

      <div className="mt-8 flex items-start gap-3 rounded-xl border border-dashed bg-muted/25 p-4 sm:p-5">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <p className="text-sm leading-6 text-muted-foreground">No checkout, upgrade, or paid-plan activation is available from this page. Mercurius will communicate future features, pricing, and terms before any paid option becomes available.</p>
      </div>
    </div>
  );
}

function DeferredCard({ offering }: { offering: DeferredOffering }) {
  return <Card className="rounded-2xl border-border bg-muted/15 shadow-none"><CardHeader className="pb-4"><div className="mb-3 flex items-center justify-between gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><offering.icon className="h-5 w-5" /></span><Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground"><Clock3 className="h-3 w-3" />Coming after soft launch</Badge></div><CardTitle className="text-base">{offering.name}</CardTitle><p className="mt-1 text-sm leading-6 text-muted-foreground">{offering.description}</p></CardHeader><CardContent className="pt-0"><ul className="space-y-2.5 border-t pt-4">{offering.features.map((feature) => <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" />{feature}</li>)}</ul></CardContent></Card>;
}

function State({ loading, title, copy, action }: { loading?: boolean; title?: string; copy?: string; action?: React.ReactNode }) {
  if (loading) return <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-6 w-6 animate-spin text-accent" />Loading plans…</div>;
  return <div className="flex min-h-[520px] items-center justify-center p-8 text-center"><div><AlertCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" /><h1 className="text-xl font-semibold">{title}</h1><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{copy}</p>{action && <div className="mt-5">{action}</div>}</div></div>;
}
