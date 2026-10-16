"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Search, Tags } from "lucide-react";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { PackageDraftEditor, PackageDraftList } from "@/components/admin/PackageDrafts";
import { PackagePriceCorrection } from "@/components/admin/PackagePriceCorrection";
import { PriceList } from "@/components/admin/VendorPackagePrices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { ResponsiveDataList } from "@/components/ui/responsive-data-list";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { loadDraftContext, type DraftService, type DraftVendor, type PackageDraft } from "@/lib/packageDrafts";
import { loadCorrectablePackages, pricingModeLabel, type CorrectablePackage } from "@/lib/packagePriceCorrections";

// DEC-2026-034 (TRACE-109): every vendor's package prices in one place, with an operator
// price correction (reason required). Package state is shown as saved; whether a price is
// customer-facing also depends on the provider's eligibility and listing.
// DEC-2026-035 (TRACE-110): "Add a price" drafts a price for a chosen vendor; drafts stay
// private until published with a reason.

type StatusFilter = "all" | "active" | "paused" | "review";

export default function AdminVendorPricesPage() {
  const [packages, setPackages] = useState<CorrectablePackage[]>([]);
  const [drafts, setDrafts] = useState<PackageDraft[]>([]);
  const [services, setServices] = useState<DraftService[]>([]);
  const [vendors, setVendors] = useState<DraftVendor[]>([]);
  const [mode, setMode] = useState<"loading" | "live" | "error">("loading");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading");
    setError("");
    try {
      const supabase = createClient();
      const [rows, context, vendorResult] = await Promise.all([
        loadCorrectablePackages(supabase),
        loadDraftContext(supabase),
        supabase.from("contractors").select("id, name").order("name"),
      ]);
      if (vendorResult.error) throw vendorResult.error;
      setPackages(rows);
      setDrafts(context.drafts);
      setServices(context.services);
      setVendors((vendorResult.data ?? []) as DraftVendor[]);
      setMode("live");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Vendor prices could not be loaded.");
      setMode("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return packages
      .filter((pkg) => status === "all"
        || (status === "active" && pkg.isActive)
        || (status === "paused" && !pkg.isActive)
        || (status === "review" && pkg.needsReview))
      .filter((pkg) => !term || [pkg.contractorName, pkg.serviceName, pkg.name].some((value) => value.toLowerCase().includes(term)))
      .sort((a, b) => a.contractorName.localeCompare(b.contractorName) || a.serviceName.localeCompare(b.serviceName) || a.name.localeCompare(b.name));
  }, [packages, search, status]);

  const reviewCount = packages.filter((pkg) => pkg.needsReview).length;

  if (mode === "loading") return <AdminLoading label="Loading vendor prices..." />;
  if (mode === "error") return <AdminError title="Vendor prices could not be loaded" message={error} retry={() => void load(true)} />;

  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 md:p-8">
    <PageHeader eyebrow="Pricing operations" title="Vendor Prices"
      description="Every vendor package and its saved prices. Add a price for a vendor as a draft and publish it when ready, or correct a price. Both need a reason, which the vendor is notified of and sees. Neither changes prices already agreed on a request or quote."
      metadata={<p className="text-sm text-muted-foreground">{packages.length} packages · {drafts.length} {drafts.length === 1 ? "draft" : "drafts"} · {reviewCount} need review{reviewCount > 0 && <> · <Link className="underline underline-offset-4" href="/admin/pricing-reviews">Open Package Reviews</Link></>}</p>}
      actions={<div className="flex flex-wrap gap-2"><PackageDraftEditor vendors={vendors} services={services} onSaved={() => load(false)} /><Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button></div>} />

    <Card><CardHeader><CardTitle>Draft prices</CardTitle><CardDescription>Prices Mercurius is preparing for a vendor. Not visible to the vendor or customers until published with a reason.</CardDescription></CardHeader>
      <CardContent><PackageDraftList drafts={drafts} services={services} showVendor onChanged={() => load(false)} /></CardContent></Card>

    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search vendor prices" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search vendor, service or package..." className="bg-card pl-9" /></div>
      <Select aria-label="Filter packages by status" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="h-9 rounded-lg border border-input bg-card px-3 text-sm sm:w-52">
        <option value="all">All packages</option>
        <option value="active">Active</option>
        <option value="paused">Paused</option>
        <option value="review">Needs review</option>
      </Select>
    </div>

    <Card><CardContent className="p-0">{filtered.length === 0
      ? <AdminEmpty icon={Tags} title={packages.length ? "No packages match these filters" : "No vendor packages yet"} description={packages.length ? "Clear the search or choose another status." : "Packages appear here when vendors or Mercurius set them up."} />
      : <ResponsiveDataList label="Vendor packages" rows={filtered} rowKey={(pkg) => pkg.id} rowLabel={(pkg) => `${pkg.contractorName} · ${pkg.name}`} columns={[
        { key: "vendor", label: "Vendor", render: (pkg) => <Link className="font-medium underline-offset-4 hover:underline" href={`/admin/vendors/${pkg.contractorId}`}>{pkg.contractorName}</Link> },
        { key: "package", label: "Package", render: (pkg) => <><p className="font-medium break-words">{pkg.name}</p><p className="mt-1 text-xs text-muted-foreground">{pkg.serviceName} · {pricingModeLabel(pkg.pricingMode)}{pkg.templateId ? " · Managed template" : ""}</p></> },
        { key: "prices", label: "Prices", render: (pkg) => <div className="min-w-48"><PriceList pkg={pkg} /></div> },
        { key: "status", label: "Status", render: (pkg) => <div className="flex flex-wrap gap-2"><Badge variant="outline">{pkg.isActive ? "Active" : "Paused"}</Badge>{pkg.needsReview && <Badge variant="outline" className="border-amber-300 text-amber-800 dark:text-amber-200">Needs review</Badge>}</div> },
        { key: "action", label: "Action", render: (pkg) => <PackagePriceCorrection pkg={pkg} onCorrected={() => load(false)} /> },
      ]} />}
    </CardContent></Card>
  </div>;
}
