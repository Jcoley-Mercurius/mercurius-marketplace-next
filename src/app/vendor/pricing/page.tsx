"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DollarSign, Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers/AuthProvider";
import { ManagedPricingEditor } from "@/components/vendor/ManagedPricingEditor";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export default function VendorManagedPricingPage() {
  const { user } = useAuth();
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void createClient().from("contractors").select("id").eq("user_id", user.id).maybeSingle().then((result) => {
      if (!active) return;
      setContractorId((result.data as { id: string } | null)?.id ?? null);
      setError(result.error?.message ?? null);
      setLoading(false);
    });
    return () => { active = false; };
  }, [user]);

  if (loading) return <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading managed pricing…</div>;

  return <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="flex items-center gap-2 text-2xl font-semibold"><DollarSign className="h-6 w-6 text-accent" />Managed Pricing</h1><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Set your own prices inside the template Mercurius has approved for your trade. Customers see a live estimate as they answer the qualifying questions.</p></div><Link href="/vendor/packages" className={buttonVariants({ variant: "outline", className: "min-h-10" })}>Your Prices</Link></div>
    {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center"><h2 className="font-semibold">Vendor profile couldn’t be loaded</h2><p className="mt-2 text-sm text-muted-foreground">{error}</p></div> : contractorId ? <ManagedPricingEditor contractorId={contractorId} /> : <div className="rounded-xl border bg-card p-8 text-center"><h2 className="font-semibold">Vendor profile not linked</h2><p className="mt-2 text-sm text-muted-foreground">Your account does not have a linked contractor record yet. Contact Mercurius support before publishing prices.</p></div>}
  </div>;
}
