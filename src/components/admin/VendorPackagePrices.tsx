"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PackageDraftEditor, PackageDraftList } from "@/components/admin/PackageDrafts";
import { PackagePriceCorrection } from "@/components/admin/PackagePriceCorrection";
import { loadDraftContext, type DraftService, type PackageDraft } from "@/lib/packageDrafts";
import { createClient } from "@/lib/supabase/client";
import {
  describeChange,
  formatCorrectionTime,
  formatPrice,
  loadCorrectablePackages,
  parseCorrections,
  pricingModeLabel,
  type CorrectablePackage,
  type PriceCorrection,
} from "@/lib/packagePriceCorrections";

// DEC-2026-034 (TRACE-109): every package of one provider, template or custom, with an
// operator price correction (reason required) and the correction history.
// DEC-2026-035 (TRACE-110): the operator can also add a price for this vendor as a draft.

export function VendorPackagePrices({ contractorId }: { contractorId: string }) {
  const [packages, setPackages] = useState<CorrectablePackage[] | null>(null);
  const [history, setHistory] = useState<PriceCorrection[]>([]);
  const [drafts, setDrafts] = useState<PackageDraft[]>([]);
  const [services, setServices] = useState<DraftService[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const supabase = createClient();
      const [rows, events, context] = await Promise.all([
        loadCorrectablePackages(supabase, contractorId),
        supabase.rpc("admin_package_price_corrections", { p_contractor: contractorId }),
        loadDraftContext(supabase, contractorId),
      ]);
      if (events.error) throw events.error;
      setPackages(rows);
      setDrafts(context.drafts);
      setServices(context.services);
      setHistory(parseCorrections(events.data));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Vendor prices could not be loaded.");
    }
  }, [contractorId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (error) return <div role="alert" className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
    <p className="font-medium">Vendor prices could not be loaded</p><p className="text-muted-foreground">{error}</p>
    <Button variant="outline" onClick={() => void load()}>Try again</Button>
  </div>;
  if (!packages) return <p role="status" className="text-sm text-muted-foreground">Loading vendor prices…</p>;

  return <div className="space-y-6">
    <section aria-labelledby={`price-drafts-${contractorId}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`price-drafts-${contractorId}`} className="text-sm font-semibold">Draft prices</h3>
        <PackageDraftEditor contractorId={contractorId} services={services} onSaved={load} />
      </div>
      <PackageDraftList drafts={drafts} services={services} showVendor={false} onChanged={load} />
    </section>
    {packages.length === 0
      ? <p className="text-sm text-muted-foreground">This vendor has no packages yet.</p>
      : <ul className="space-y-4">{packages.map((pkg) => <li key={pkg.id} className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-medium break-words">{pkg.name}</h3>
            <p className="text-sm text-muted-foreground">{pkg.serviceName} · {pricingModeLabel(pkg.pricingMode)}{pkg.templateId ? " · Managed template" : ""}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{pkg.isActive ? "Active" : "Paused"}</Badge>
              {pkg.needsReview && <Badge variant="outline" className="border-amber-300 text-amber-800 dark:text-amber-200">Needs review</Badge>}
            </div>
          </div>
          <PackagePriceCorrection pkg={pkg} onCorrected={load} />
        </div>
        <PriceList pkg={pkg} />
      </li>)}</ul>}

    <section aria-labelledby={`price-history-${contractorId}`} className="space-y-3">
      <h3 id={`price-history-${contractorId}`} className="text-sm font-semibold">Price corrections by Mercurius</h3>
      {history.length === 0
        ? <p className="text-sm text-muted-foreground">No corrections recorded.</p>
        : <ol className="space-y-3">{history.map((item) => <li key={item.id} className="rounded-lg border bg-muted/20 p-3 text-sm">
          <p className="font-medium break-words">{item.packageName}</p>
          <p className="text-xs text-muted-foreground">{formatCorrectionTime(item.createdAt)}{item.actorEmail ? ` · ${item.actorEmail}` : ""}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">{item.changes.map((change, index) => <li key={index}>{describeChange(change)}</li>)}</ul>
          <p className="mt-2 break-words"><span className="text-muted-foreground">Reason: </span>{item.reason}</p>
        </li>)}</ol>}
    </section>
  </div>;
}

export function PriceList({ pkg }: { pkg: CorrectablePackage }) {
  const rows = [
    ...pkg.tiers.map((line) => ({ key: line.id, label: line.detail ? `${line.name} (${line.detail})` : line.name, price: line.price as number | null })),
    ...pkg.addons.map((line) => ({ key: line.id, label: `${line.name} (${line.detail})`, price: line.price as number | null })),
    ...(pkg.pricingMode === "deposit_quote" ? [{ key: "deposit", label: "Deposit", price: pkg.depositAmount }] : []),
  ];
  if (!rows.length) return <p className="text-sm text-muted-foreground">No prices saved.</p>;
  return <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
    {rows.map((row) => <div key={row.key} className="contents">
      <dt className="text-muted-foreground break-words">{row.label}</dt>
      <dd className="font-medium tabular-nums sm:text-right">{row.price === null ? "Not set" : formatPrice(row.price)}</dd>
    </div>)}
  </dl>;
}
