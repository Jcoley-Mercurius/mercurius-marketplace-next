"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2, MapPin, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { vendorCoverageReadback } from "@/lib/vendorServiceAreas";

type Readback = ReturnType<typeof vendorCoverageReadback>;

// TRACE-134 (6.11B): coverage is operator-managed (MPS §8; DEC-2026-051 item 3). The vendor sees the
// exact ZIP codes on file, which of them are inside current coverage, and how to ask for a change.
export function VendorCoverageReadback({ contractorId }: { contractorId: string }) {
  const [state, setState] = useState<{ mode: "loading" } | { mode: "error"; message: string } | { mode: "ready"; readback: Readback }>({ mode: "loading" });

  const load = useCallback(async () => {
    const supabase = createClient();
    const [zipResult, areaResult] = await Promise.all([
      supabase.from("contractor_service_zips").select("zip_code").eq("contractor_id", contractorId),
      supabase.from("coverage_areas").select("zip_code, city").eq("is_active", true),
    ]);
    const error = zipResult.error ?? areaResult.error;
    if (error) {
      setState({ mode: "error", message: error.message });
      return;
    }
    setState({ mode: "ready", readback: vendorCoverageReadback(
      ((zipResult.data ?? []) as { zip_code: string }[]).map((row) => row.zip_code),
      (areaResult.data ?? []) as { zip_code: string; city: string }[],
    ) });
  }, [contractorId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return <Card role="region" aria-labelledby="vendor-service-area">
    <CardHeader>
      <CardTitle id="vendor-service-area" className="flex items-center gap-2 text-base"><MapPin className="h-4 w-4 text-accent" />Service area</CardTitle>
      <CardDescription>Mercurius sets your service area during review. Homeowners are matched only in ZIP codes listed here that are inside current coverage.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {state.mode === "loading" && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Loading your service area…</p>}
      {state.mode === "error" && <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm sm:flex-row sm:items-center sm:justify-between" role="alert">
        <p className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />Your service area couldn’t be loaded. {state.message}</p>
        <Button variant="outline" size="sm" className="min-h-10" onClick={() => { setState({ mode: "loading" }); void load(); }}><RefreshCw />Try again</Button>
      </div>}
      {state.mode === "ready" && (state.readback.covered.length === 0 && state.readback.outside.length === 0
        ? <p className="text-sm text-muted-foreground">No service ZIP codes are on file yet, so no requests are matched to you.</p>
        : <>
          {state.readback.covered.length > 0 && <ul className="space-y-2" aria-label="ZIP codes in current coverage">
            {state.readback.covered.map((area) => <li key={area.city} className="text-sm"><span className="font-medium">{area.city}</span><span className="text-muted-foreground"> · {area.zips.join(", ")}</span></li>)}
          </ul>}
          {state.readback.outside.length > 0 && <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">Outside current coverage</Badge><span>{state.readback.outside.join(", ")}</span></p>
            <p className="text-xs text-muted-foreground">Requests from these ZIP codes are not matched until Mercurius covers them.</p>
          </div>}
        </>)}
      <Link href="/vendor/support" className={buttonVariants({ variant: "outline", className: "min-h-11 w-full sm:w-auto" })}>Ask Mercurius to change your service area</Link>
    </CardContent>
  </Card>;
}
