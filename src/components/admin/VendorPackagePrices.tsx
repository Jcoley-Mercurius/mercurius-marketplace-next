"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PackageContentEditor } from "@/components/admin/PackageContentEditor";
import { PackageInternalNotes } from "@/components/admin/PackageInternalNotes";
import { PackageDraftEditor, PackageDraftList, PackageTemplateStart } from "@/components/admin/PackageDrafts";
import { PackagePriceCorrection, PackageReplacementActions } from "@/components/admin/PackagePriceCorrection";
import { PackageContentSummary } from "@/components/pricing/PackageContentSummary";
import { loadDraftContext, type DraftService, type PackageDraft } from "@/lib/packageDrafts";
import { createClient } from "@/lib/supabase/client";
import { addonPriceLabel, priceKindLabel } from "@/lib/pricingContent";
import {
  approvalEvidenceLabel,
  describeChange,
  formatCorrectionTime,
  formatPrice,
  loadCorrectablePackages,
  parseCorrections,
  pricingModeLabel,
  type CorrectablePackage,
  type PriceCorrection,
} from "@/lib/packagePriceCorrections";

// DEC-2026-034 (TRACE-109): every package of one provider, template or custom, with the
// correction history. DEC-2026-041 item 4: corrections become replacement drafts, published
// with or without the vendor's approval (DEC-2026-046); an operator may suspend an incorrect
// listing meanwhile.
// DEC-2026-035 (TRACE-110): the operator can also add a price for this vendor as a draft.
// TRACE-112 (source items 4, 8, 13): live packages show their full content and price meaning,
// and the summary separates live prices from drafts waiting for the vendor's approval.
// TRACE-122: archived packages leave the list and counts and are kept under Archived prices.

export function VendorPackagePrices({ contractorId }: { contractorId: string }) {
  const [packages, setPackages] = useState<CorrectablePackage[] | null>(null);
  const [history, setHistory] = useState<PriceCorrection[]>([]);
  const [drafts, setDrafts] = useState<PackageDraft[]>([]);
  const [services, setServices] = useState<DraftService[]>([]);
  const [templates, setTemplates] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const supabase = createClient();
      const [rows, events, context, templateRows] = await Promise.all([
        loadCorrectablePackages(supabase, contractorId),
        supabase.rpc("admin_package_price_corrections", { p_contractor: contractorId }),
        loadDraftContext(supabase, contractorId),
        supabase.from("pricing_templates").select("id, name"),
      ]);
      if (events.error) throw events.error;
      if (templateRows.error) throw templateRows.error;
      setTemplates(new Map(((templateRows.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name])));
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

  const archived = packages.filter((pkg) => pkg.archive);
  const current = packages.filter((pkg) => !pkg.archive);
  const live = current.filter((pkg) => pkg.isActive).length;
  const awaiting = drafts.filter((draft) => draft.approvalState === "sent").length;
  const templatesInUse = [...new Set(current.flatMap((pkg) => pkg.templateId ? [templates.get(pkg.templateId) ?? "Managed template"] : []))];
  return <div className="space-y-6">
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>{countLabel(live, "live price", "live prices")} · {countLabel(current.length - live, "paused", "paused")} · {countLabel(awaiting, "awaiting vendor approval", "awaiting vendor approval")} · {countLabel(drafts.length - awaiting, "other draft", "other drafts")} ·{" "}
        <Link className="underline underline-offset-4" href={`/admin/vendor-prices?vendor=${contractorId}`}>Open in Vendor Prices</Link></p>
      <p>Templates in use: {templatesInUse.length ? templatesInUse.join(", ") : "none"}</p>
    </div>
    <section aria-labelledby={`price-drafts-${contractorId}`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`price-drafts-${contractorId}`} className="text-sm font-semibold">Draft prices</h3>
        <div className="flex flex-wrap gap-2">
          <PackageDraftEditor contractorId={contractorId} services={services} onSaved={load} />
          <PackageContentEditor contractorId={contractorId} services={services} onSaved={load} />
          <PackageTemplateStart contractorId={contractorId} onCreated={load} />
        </div>
      </div>
      <PackageDraftList drafts={drafts} services={services} showVendor={false} onChanged={load} />
    </section>
    {current.length === 0
      ? <p className="text-sm text-muted-foreground">{archived.length ? "This vendor has no current packages." : "This vendor has no packages yet."}</p>
      : <ul className="space-y-4">{current.map((pkg) => <li key={pkg.id} className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-medium break-words">{pkg.name}</h3>
            <p className="text-sm text-muted-foreground">{pkg.serviceName} · {pricingModeLabel(pkg.pricingMode)}{pkg.templateId ? " · Managed template" : ""}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">{pkg.isActive ? "Active" : "Paused"}</Badge>
              {pkg.needsReview && <Badge variant="outline" className="border-amber-300 text-amber-800 dark:text-amber-200">Needs review</Badge>}
              <ApprovalBadges pkg={pkg} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2"><PackagePriceCorrection pkg={pkg} onCorrected={load} /><PackageReplacementActions pkg={pkg} onChanged={load} /><PackageInternalNotes pkg={pkg} onSaved={load} /></div>
        </div>
        <PriceList pkg={pkg} />
        <PackageDetails pkg={pkg} />
      </li>)}</ul>}

    <ArchivedPackages packages={archived} />

    <section aria-labelledby={`price-history-${contractorId}`} className="space-y-3">
      <h3 id={`price-history-${contractorId}`} className="text-sm font-semibold">Corrections and suspensions by Mercurius</h3>
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

/** DEC-2026-041 item 5: what is recorded about this package's approval, and any open replacement. */
export function ApprovalBadges({ pkg }: { pkg: CorrectablePackage }) {
  if (!pkg.approval) return null;
  const { status, operatorCorrected, replacement } = pkg.approval;
  return <>
    <Badge variant="outline" className={status === "vendor_approved" ? "border-status-success text-status-success" : status === "operator_published" ? "border-status-warning text-status-warning" : undefined}>
      {approvalEvidenceLabel[status]}</Badge>
    {operatorCorrected && <Badge variant="outline">Price corrected by Mercurius before approval was required</Badge>}
    {replacement && <Badge variant="outline">Replacement draft: {replacementStateLabel(replacement.approvalState)}</Badge>}
  </>;
}

function replacementStateLabel(state: string) {
  if (state === "sent") return "waiting for the vendor";
  if (state === "approved") return "approved, not published";
  if (state === "changes_requested") return "vendor asked for changes";
  return "not sent yet";
}

function countLabel(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** Description, included scope, rules, add-ons and internal notes of a live package. */
export function PackageDetails({ pkg }: { pkg: CorrectablePackage }) {
  if (!pkg.content) return null;
  return <details className="rounded-lg border bg-muted/10 px-3 py-2 text-sm">
    <summary className="cursor-pointer font-medium">Description, scope and add-ons</summary>
    <div className="mt-2"><PackageContentSummary content={pkg.content} internalNotes={pkg.internalNotes?.notes} /></div>
  </details>;
}

/** TRACE-122: archived packages, kept for audit with who archived them and why. */
export function ArchivedPackages({ packages, showVendor = false }: { packages: CorrectablePackage[]; showVendor?: boolean }) {
  if (!packages.length) return null;
  return <details className="rounded-lg border px-3 py-2 text-sm">
    <summary className="cursor-pointer font-medium">Archived prices ({packages.length})</summary>
    <ul className="mt-3 space-y-3">{packages.map((pkg) => <li key={pkg.id} className="space-y-2 rounded-lg border bg-muted/20 p-3">
      <div>
        <p className="font-medium break-words">{showVendor ? `${pkg.contractorName} · ` : ""}{pkg.name}</p>
        <p className="text-xs text-muted-foreground">{pkg.serviceName} · archived {pkg.archive ? formatCorrectionTime(pkg.archive.archivedAt) : ""}{pkg.archive?.actorEmail ? ` by ${pkg.archive.actorEmail}` : ""}</p>
        {pkg.archive && <p className="mt-1 break-words"><span className="text-muted-foreground">Reason: </span>{pkg.archive.reason}</p>}
      </div>
      <PriceList pkg={pkg} />
      <PackageDetails pkg={pkg} />
    </li>)}</ul>
  </details>;
}

export function PriceList({ pkg }: { pkg: CorrectablePackage }) {
  // A range or starting-at level reads the same here as homeowners and vendors see it.
  const tierLabels = new Map(pkg.content?.tiers.map((tier) => [tier.id, priceKindLabel(tier.price_kind, tier.price, tier.price_max)]) ?? []);
  const addonLabels = new Map(pkg.content?.addons.map((addon) => [addon.id, addonPriceLabel(addon)]) ?? []);
  const rows = [
    ...pkg.tiers.map((line) => ({ key: line.id, label: line.detail ? `${line.name} (${line.detail})` : line.name, price: line.price as number | null, shown: tierLabels.get(line.id) })),
    ...pkg.addons.map((line) => ({ key: line.id, label: `${line.name} (${line.detail})`, price: line.price as number | null, shown: addonLabels.get(line.id) })),
    ...(pkg.pricingMode === "deposit_quote" ? [{ key: "deposit", label: "Deposit", price: pkg.depositAmount, shown: undefined }] : []),
  ];
  if (!rows.length) return <p className="text-sm text-muted-foreground">No prices saved.</p>;
  return <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
    {rows.map((row) => <div key={row.key} className="contents">
      <dt className="text-muted-foreground break-words">{row.label}</dt>
      <dd className="font-medium tabular-nums sm:text-right">{row.price === null ? "Not set" : row.shown ?? formatPrice(row.price)}</dd>
    </div>)}
  </dl>;
}
