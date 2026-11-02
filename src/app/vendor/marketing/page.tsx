"use client";

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ListChecks,
  Loader2,
  MessageSquareQuote,
  RefreshCw,
  Share2,
  Sparkles,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";

type Contractor = {
  id: string;
  name: string;
  is_active: boolean | null;
};

type Mode = "loading" | "ready" | "unlinked" | "error";

export default function VendorMarketingPage() {
  const { user } = useAuth();
  const [contractor, setContractor] = useState<Contractor | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const result = await createClient()
        .from("contractors")
        .select("id, name, is_active")
        .eq("user_id", user.id)
        .maybeSingle();
      if (result.error) throw result.error;
      if (!result.data) {
        setContractor(null);
        setMode("unlinked");
        return;
      }
      setContractor(result.data as Contractor);
      setMode("ready");
    } catch (reason) {
      console.error("Unable to load vendor marketing", reason);
      setContractor(null);
      setError(reason instanceof Error ? reason.message : "Marketing tools could not be loaded.");
      setMode("error");
    }
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (mode === "loading") return <Loading />;
  if (mode === "unlinked") return <State icon={AlertCircle} title="No contractor profile linked" copy="Your free marketing tools will become available after Mercurius links your approved vendor profile." />;
  if (mode === "error") return <State icon={AlertCircle} title="Marketing tools couldn’t be loaded" copy={`No preview content has been substituted. ${error}`} action={<Button variant="outline" onClick={() => { setMode("loading"); void load(); }}><RefreshCw />Try again</Button>} />;
  if (!contractor) return null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-9 p-4 sm:p-6 md:p-8">
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-accent">Free vendor tools</p>
        <h1 className="font-heading text-2xl font-semibold sm:text-3xl">Marketing</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Use these free tools to strengthen and share your Mercurius presence.</p>
      </header>

      <div className="flex flex-col gap-3 rounded-xl border border-accent-border bg-accent-subtle px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-sage-dark" /><div><p className="text-sm font-medium">Soft-launch marketing access</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">Listing sharing, review-request guidance, and the launch checklist remain free and available.</p></div></div>
        <Badge variant="outline" className="w-fit border-accent-border bg-background text-sage-dark">Available now</Badge>
      </div>

      <FreeTools contractor={contractor} />
    </div>
  );
}

function FreeTools({ contractor }: { contractor: Contractor }) {
  const listingPath = `/providers/${contractor.id}`;

  const copy = async (value: string, title: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(title);
    } catch {
      toast.error("Copy failed", { description: "Your browser did not allow clipboard access." });
    }
  };

  const copyListing = () => void copy(`${window.location.origin}${listingPath}`, "Listing link copied");
  const copyReviewRequest = () => void copy(
    `Hi! Thank you for choosing ${contractor.name}. If Mercurius sends you a review invitation for our completed service, we’d appreciate your honest feedback.`,
    "Review request message copied",
  );

  return <section className="space-y-4">
    <div><h2 className="font-heading text-xl font-semibold">Available now</h2><p className="mt-1 text-sm text-muted-foreground">Free tools for every linked Mercurius vendor.</p></div>
    <div className="grid gap-4 md:grid-cols-3">
      <ToolCard icon={Share2} title="Share your public listing" copy={contractor.is_active === false ? "Your listing link is ready to copy, but your storefront will remain marked as not publicly listed until the vendor profile is activated." : "Copy your directory listing link and share it with customers or on social media."}><Button variant="outline" size="sm" className="w-full" onClick={copyListing}><Copy />Copy listing link</Button></ToolCard>
      <ToolCard icon={MessageSquareQuote} title="Review request guidance" copy="Copy a professional follow-up note for a customer after a completed Mercurius job. Reviews still follow the verified Mercurius invitation flow."><Button variant="outline" size="sm" className="w-full" onClick={copyReviewRequest}><Star />Copy guidance</Button></ToolCard>
      <Card className="rounded-2xl border-accent-border bg-accent-subtle"><CardHeader className="pb-3"><IconBox icon={ListChecks} /><CardTitle className="text-base">Launch checklist</CardTitle></CardHeader><CardContent><ul className="space-y-3"><ChecklistItem href="/vendor/profile">Complete and strengthen your profile</ChecklistItem><ChecklistItem href="/vendor/packages">Publish at least one live fixed price</ChecklistItem><ChecklistItem href={listingPath}>Review your public listing</ChecklistItem></ul></CardContent></Card>
    </div>
  </section>;
}

function ToolCard({ icon, title, copy, children }: { icon: ComponentType<{ className?: string }>; title: string; copy: string; children: ReactNode }) {
  return <Card className="rounded-2xl border-border/60 transition-shadow hover:shadow-md"><CardHeader className="pb-3"><IconBox icon={icon} /><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="space-y-4"><p className="text-sm leading-relaxed text-muted-foreground">{copy}</p>{children}</CardContent></Card>;
}

function IconBox({ icon: Icon }: { icon: ComponentType<{ className?: string }> }) {
  return <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft"><Icon className="h-4 w-4 text-sage-dark" /></div>;
}

function ChecklistItem({ href, children }: { href: string; children: ReactNode }) {
  return <li><Link href={href} className="group flex items-start gap-2 text-sm leading-5 text-foreground/80 hover:text-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage" /><span className="flex-1 group-hover:underline group-hover:underline-offset-2">{children}</span></Link></li>;
}

function Loading() { return <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-6 w-6 animate-spin text-accent" />Loading marketing tools…</div>; }
function State({ icon: Icon, title, copy, action }: { icon: typeof AlertCircle; title: string; copy: string; action?: ReactNode }) { return <div className="flex min-h-[520px] items-center justify-center p-8 text-center"><div><Icon className="mx-auto mb-4 h-12 w-12 text-muted-foreground" /><h1 className="text-xl font-semibold">{title}</h1><p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{copy}</p>{action && <div className="mt-5">{action}</div>}</div></div>; }
