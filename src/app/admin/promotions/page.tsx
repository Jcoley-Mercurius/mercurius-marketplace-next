"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgePercent, History, Plus, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { AdminEmpty, AdminError, AdminLoading } from "@/components/admin/AdminPageState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCorrectionTime } from "@/lib/packagePriceCorrections";
import {
  dollarsToCents,
  economicsRows,
  formatPromotionDiscount,
  fundingLabel,
  isoToZonedLocal,
  OFFER_TIMEZONE,
  offerStatusLabel,
  parseOffers,
  percentToBps,
  type OfferFunding,
  type OfferKind,
  type PromotionOffer,
  zonedLocalToIso,
} from "@/lib/promotionOffers";
import { createClient } from "@/lib/supabase/client";

// TRACE-114 (DEC-2026-038): operators prepare funded offers. A vendor-funded offer is live
// only after the bound vendor approves its exact version; a Mercurius-funded offer only
// after an operator authorizes it with a reason and a budget. With one valid offer applied,
// commission is 7.5% instead of 15%. TRACE-116: homeowners choose offers only while the
// promotions gate is open (after the two-person finance review); operators see the gate and
// the cleanup of unpaid reservations here.

type Vendor = { id: string; name: string };
type ReservationHealth = {
  gate_open: boolean; scheduled: boolean; reserved: number; releasable: number; held_by_checkout: number; needs_homeowner: number;
  runs_24h: number; last_run: { outcome: string; released: number; finished_at: string } | null;
};
type PackageOption = { id: string; name: string; contractor_id: string; lineage_id: string | null; is_active: boolean };
type ServiceOption = { id: string; name: string };

export default function AdminPromotionsPage() {
  const [offers, setOffers] = useState<PromotionOffer[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [health, setHealth] = useState<ReservationHealth | null>(null);
  const [mode, setMode] = useState<"loading" | "live" | "error">("loading");
  const [error, setError] = useState("");

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setMode("loading");
    try {
      const supabase = createClient();
      const [offerResult, vendorResult, packageResult, serviceResult, healthResult] = await Promise.all([
        supabase.rpc("admin_promotion_offers"),
        supabase.from("contractors").select("id, name").order("name"),
        supabase.from("vendor_packages").select("id, name, contractor_id, lineage_id, is_active").order("name"),
        supabase.from("services_catalog").select("id, name").eq("is_active", true).order("name"),
        supabase.rpc("admin_promotion_reservation_health"),
      ]);
      for (const result of [offerResult, vendorResult, packageResult, serviceResult]) if (result.error) throw result.error;
      setOffers(parseOffers(offerResult.data));
      setVendors((vendorResult.data ?? []) as Vendor[]);
      setPackages(((packageResult.data ?? []) as PackageOption[]).filter((item) => item.lineage_id === item.id));
      setServices((serviceResult.data ?? []) as ServiceOption[]);
      // Monitoring is informative: without it the offers still load.
      setHealth(healthResult.error ? null : healthResult.data as ReservationHealth | null);
      setMode("live");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Promotions could not be loaded.");
      setMode("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (mode === "loading") return <AdminLoading label="Loading promotions..." />;
  if (mode === "error") return <AdminError title="Promotions could not be loaded" message={error} retry={() => void load(true)} />;

  const context = { vendors, packages, services };
  return <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 md:p-8">
    <PageHeader eyebrow="Pricing operations" title="Promotions"
      description="Funded offers and their economics. Ordinary commission is 15%; with one valid offer applied it is 7.5%, on the discounted amount for vendor funding and on the full amount for Mercurius funding."
      actions={<div className="flex flex-wrap gap-2"><OfferEditor context={context} onSaved={() => load(false)} /><Button variant="outline" onClick={() => void load(false)}><RefreshCw />Refresh</Button></div>} />
    {health?.gate_open
      ? <div role="note" className="rounded-lg border border-accent-border bg-accent-subtle/40 p-4 text-sm">
          <p className="font-medium">Homeowners can choose live offers</p>
          <p className="mt-1 text-muted-foreground">An approved offer within its dates is shown on the request review for services it covers; code-only offers apply only with their code. Nothing is applied without the homeowner choosing it.</p>
        </div>
      : <div role="note" className="rounded-lg border border-status-warning bg-status-warning-bg p-4 text-sm text-status-warning">
          <p className="font-medium">Offers are not shown to homeowners yet</p>
          <p className="mt-1">The promotions gate stays closed until the two-person finance review passes. Approving or authorizing an offer records the agreement; it does not discount any booking.</p>
        </div>}
    {health && <ReservationHealthCard health={health} />}
    {offers.length === 0
      ? <Card><CardContent className="p-0"><AdminEmpty icon={BadgePercent} title="No offers yet" description="Create an offer, then send it to the vendor or authorize Mercurius funding." /></CardContent></Card>
      : <div className="grid gap-4 lg:grid-cols-2">{offers.map((offer) => <OfferCard key={offer.id} offer={offer} context={context} onChanged={() => load(false)} />)}</div>}
  </div>;
}

function ReservationHealthCard({ health }: { health: ReservationHealth }) {
  const rows: [string, string][] = [
    ["Reserved offers", String(health.reserved)],
    ["Waiting for cleanup", String(health.releasable)],
    ["Held by a checkout in progress", String(health.held_by_checkout)],
    ["Homeowners asked to choose again", String(health.needs_homeowner)],
    ["Cleanup runs, last 24 hours", String(health.runs_24h)],
    ["Last cleanup", health.last_run ? `${formatCorrectionTime(health.last_run.finished_at)}, ${health.last_run.released} released` : "Never"],
  ];
  return <Card>
    <CardHeader>
      <CardTitle>Unpaid reservation cleanup</CardTitle>
      <CardDescription>{health.scheduled ? "Scheduled." : "Not scheduled: unpaid reservations whose terms expired or whose offer ended are released only when cleanup runs."}</CardDescription>
    </CardHeader>
    <CardContent>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">{rows.map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>)}</dl>
    </CardContent>
  </Card>;
}

type Context = { vendors: Vendor[]; packages: PackageOption[]; services: ServiceOption[] };

function OfferCard({ offer, context, onChanged }: { offer: PromotionOffer; context: Context; onChanged: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  async function send() {
    setPending(true);
    const { data, error } = await createClient().rpc("admin_send_promotion_for_vendor_approval", { p_offer: offer.id, p_fingerprint: offer.fingerprint });
    setPending(false);
    if (error) { toast.error("Not sent", { description: error.message }); return; }
    const result = data as { status: string; reason?: string };
    if (result.status === "blocked") toast.error("Not sent", { description: result.reason });
    else toast.success("Sent to the vendor", { description: "They see it on Pricing & Packages and in their inbox. No email is sent." });
    await onChanged();
  }
  const scope = [
    offer.contractorName ?? "Any eligible vendor",
    offer.packageNames.length ? offer.packageNames.join(", ") : "all packages",
    offer.serviceIds.length ? `${offer.serviceIds.length} ${offer.serviceIds.length === 1 ? "service" : "services"}` : "all services",
    offer.zipCodes.length ? offer.zipCodes.join(", ") : "all covered ZIPs",
  ].join(" · ");
  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><CardTitle>{offer.label}</CardTitle><CardDescription>{fundingLabel[offer.funding]} · {formatPromotionDiscount(offer)} · version {offer.revision}</CardDescription></div>
        <Badge variant="outline">{offerStatusLabel[offer.status]}{offer.status === "approved" && !offer.live ? " · outside its dates" : ""}</Badge>
      </div>
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p className="text-muted-foreground">{scope}</p>
      <p>{formatCorrectionTime(offer.startsAt)} to {formatCorrectionTime(offer.endsAt)} ({offer.timezone})
        {offer.maxRedemptions ? ` · up to ${offer.maxRedemptions} uses` : ""}{offer.budgetCents ? ` · budget ${(offer.budgetCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}` : ""}
        {offer.minSpendCents ? ` · minimum ${(offer.minSpendCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}` : ""}
        {offer.firstBookingOnly ? " · first booking only" : ""}{offer.requiresCode ? " · code required" : ""}</p>
      <p className="text-muted-foreground">{offer.terms}</p>
      {offer.example && <dl aria-label={`Worked example for ${offer.label}`} className="divide-y rounded-lg border px-3">
        {economicsRows(offer.example, "operator").map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-1.5"><dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{value}</dd></div>)}
      </dl>}
      <p className="text-xs text-muted-foreground">Uses: {offer.usage.reserved} reserved, {offer.usage.finalized} committed · vendor discounts {(offer.usage.vendorDiscountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} · Mercurius subsidy {(offer.usage.subsidyCommittedCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} · commission relief {(offer.usage.commissionReliefCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}</p>
      {offer.vendorNote && offer.status === "draft" && <p><span className="text-muted-foreground">Vendor: </span>{offer.vendorNote}</p>}
      {offer.status !== "retired" && <div className="flex flex-wrap gap-2 border-t pt-3">
        <OfferEditor offer={offer} context={context} onSaved={onChanged} />
        {offer.funding === "vendor" && offer.status !== "approved" && <Button variant="outline" className="min-h-10" loading={pending} onClick={() => void send()}><Send />{offer.status === "awaiting_vendor" ? "Send reminder" : "Send to vendor"}</Button>}
        {offer.funding === "platform" && offer.status === "draft" && <ConfirmAction triggerLabel="Authorize funding" triggerVariant="outline" confirmationTone="commitment" title="Authorize Mercurius funding"
          entity={`${offer.label} · ${formatPromotionDiscount(offer)}`} consequence="Mercurius funds this version of the offer within its budget. Any later change needs authorization again."
          confirmLabel="Authorize" requireReason reasonLabel="Reason" reasonHelp="Recorded with the authorization."
          onConfirm={async (reason) => {
            const { error } = await createClient().rpc("admin_authorize_platform_promotion", { p_offer: offer.id, p_fingerprint: offer.fingerprint, p_reason: reason ?? "" });
            if (error) throw error;
            await onChanged();
          }} />}
        <OfferHistory offer={offer} />
        <ConfirmAction triggerLabel="Retire" title="Retire offer" entity={offer.label} consequence="The offer stops applying. Committed uses keep their terms."
          confirmLabel="Retire offer" requireReason onConfirm={async (reason) => {
            const { error } = await createClient().rpc("admin_retire_promotion_offer", { p_offer: offer.id, p_reason: reason ?? "" });
            if (error) throw error;
            await onChanged();
          }} />
      </div>}
    </CardContent>
  </Card>;
}

type OfferEvent = { kind: string; actor_role: string; actor_email: string | null; revision: number; note: string | null; created_at: string };
const eventText: Record<string, string> = { saved: "Saved", sent: "Sent to the vendor", send_blocked: "Could not be sent", vendor_approved: "Approved by the vendor",
  vendor_declined: "Declined by the vendor", authorized: "Mercurius funding authorized", retired: "Retired" };

function OfferHistory({ offer }: { offer: PromotionOffer }) {
  const [events, setEvents] = useState<OfferEvent[] | null>(null);
  return <Dialog onOpenChange={(next) => {
    if (!next) return;
    setEvents(null);
    void createClient().rpc("admin_promotion_offer_events", { p_offer: offer.id }).then(({ data }) => setEvents((data ?? []) as OfferEvent[]));
  }}>
    <DialogTrigger render={<Button variant="ghost" className="min-h-10" />}><History />History</DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Offer history</DialogTitle><DialogDescription>{offer.label}</DialogDescription></DialogHeader>
      {!events ? <p role="status" className="text-sm text-muted-foreground">Loading history…</p> : <ol className="space-y-3 text-sm">{events.map((event, index) => <li key={index} className="border-l-2 pl-3">
        <p className="font-medium">{eventText[event.kind] ?? event.kind} · version {event.revision}</p>
        <p className="text-xs text-muted-foreground">{formatCorrectionTime(event.created_at)} · {event.actor_role === "vendor" ? "Vendor" : "Mercurius"}{event.actor_email ? ` (${event.actor_email})` : ""}</p>
        {event.note && <p className="mt-1">{event.note}</p>}
      </li>)}</ol>}
    </DialogContent>
  </Dialog>;
}

type Form = {
  funding: OfferFunding; contractorId: string; kind: OfferKind; percent: string; amount: string; cap: string; minSpend: string;
  packages: string[]; services: string[]; zips: string; firstBooking: boolean; code: string; label: string; terms: string;
  starts: string; ends: string; maxRedemptions: string; budget: string;
};

const centsText = (cents: number | null) => (cents == null ? "" : String(cents / 100));

function OfferEditor({ offer, context, onSaved }: { offer?: PromotionOffer; context: Context; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const set = (patch: Partial<Form>) => setForm((current) => (current ? { ...current, ...patch } : current));

  function reset() {
    setError("");
    setForm(offer ? {
      funding: offer.funding, contractorId: offer.contractorId ?? "", kind: offer.kind, percent: offer.percentBps ? String(offer.percentBps / 100) : "",
      amount: centsText(offer.amountCents), cap: centsText(offer.maxDiscountCents), minSpend: offer.minSpendCents ? centsText(offer.minSpendCents) : "",
      packages: offer.packageLineageIds, services: offer.serviceIds, zips: offer.zipCodes.join(", "), firstBooking: offer.firstBookingOnly, code: "",
      label: offer.label, terms: offer.terms, starts: isoToZonedLocal(offer.startsAt), ends: isoToZonedLocal(offer.endsAt),
      maxRedemptions: offer.maxRedemptions ? String(offer.maxRedemptions) : "", budget: centsText(offer.budgetCents),
    } : { funding: "vendor", contractorId: "", kind: "amount", percent: "", amount: "", cap: "", minSpend: "", packages: [], services: [], zips: "",
      firstBooking: false, code: "", label: "", terms: "", starts: "", ends: "", maxRedemptions: "", budget: "" });
  }

  async function save() {
    if (!form || pending) return;
    const starts = zonedLocalToIso(form.starts); const ends = zonedLocalToIso(form.ends);
    if (!starts || !ends) { setError("Enter a start and an end."); return; }
    const percent = form.kind === "percent" ? percentToBps(form.percent) : null;
    if (form.kind === "percent" && percent === null) { setError("Enter a percentage from 0.01 to 80."); return; }
    const amount = form.kind === "amount" ? dollarsToCents(form.amount) : null;
    if (form.kind === "amount" && amount === null) { setError("Enter the discount in dollars."); return; }
    const terms = {
      funding: form.funding, contractor_id: form.contractorId || null, kind: form.kind, percent_bps: percent, amount_cents: amount,
      max_discount_cents: form.kind === "percent" && form.cap ? dollarsToCents(form.cap) : null,
      min_spend_cents: form.minSpend ? dollarsToCents(form.minSpend) : 0,
      package_lineage_ids: form.packages, service_ids: form.services,
      zip_codes: form.zips.split(",").map((zip) => zip.trim()).filter(Boolean), first_booking_only: form.firstBooking,
      ...(form.code.trim() ? { code: form.code.trim() } : {}),
      label: form.label, terms: form.terms, starts_at: starts, ends_at: ends, timezone: OFFER_TIMEZONE,
      max_redemptions: form.maxRedemptions ? Number(form.maxRedemptions) : null,
      budget_cents: form.funding === "platform" ? dollarsToCents(form.budget) : null,
    };
    setPending(true); setError("");
    const { error: rpcError } = await createClient().rpc("admin_save_promotion_offer", { p_offer: offer?.id ?? null, p_expected_updated_at: offer?.updatedAt ?? null, p_terms: terms });
    setPending(false);
    if (rpcError) { setError(rpcError.code === "40001" ? "This offer changed since you opened it. Reload and review it." : rpcError.message); return; }
    setOpen(false);
    toast.success(offer ? "Offer saved" : "Offer created", { description: offer && offer.status !== "draft" ? "If its terms changed, it needs approval again before it applies." : "Send it to the vendor, or authorize Mercurius funding." });
    await onSaved();
  }

  const vendorPackages = context.packages.filter((item) => item.contractor_id === form?.contractorId);
  return <Dialog open={open} onOpenChange={(next) => { if (pending) return; setOpen(next); if (next) reset(); }}>
    <DialogTrigger render={<Button variant={offer ? "outline" : "commitment"} className="min-h-10" />}>{offer ? "Edit" : <><Plus />New offer</>}</DialogTrigger>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>{offer ? "Edit offer" : "New offer"}</DialogTitle>
        <DialogDescription>One funder per offer. Example amounts are not campaigns; times are {OFFER_TIMEZONE.replace("_", " ")} time. A change to the terms needs approval again.</DialogDescription></DialogHeader>
      {form && <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="offer-funding" label="Funded by" required>{(c) => <Select {...c} value={form.funding} disabled={pending} onChange={(e) => set({ funding: e.target.value as OfferFunding, kind: e.target.value === "platform" && form.kind === "package_price" ? "amount" : form.kind })}>
          <option value="vendor">The vendor</option><option value="platform">Mercurius</option></Select>}</FormField>
        <FormField id="offer-vendor" label="Vendor" required={form.funding === "vendor"} help={form.funding === "platform" ? "Optional: limit to one vendor." : undefined}>{(c) => <Select {...c} value={form.contractorId} disabled={pending} onChange={(e) => set({ contractorId: e.target.value, packages: [] })}>
          <option value="">{form.funding === "platform" ? "Any eligible vendor" : "Choose a vendor"}</option>{context.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>}</FormField>
        <FormField id="offer-kind" label="Offer" required>{(c) => <Select {...c} value={form.kind} disabled={pending} onChange={(e) => set({ kind: e.target.value as OfferKind })}>
          <option value="amount">Dollar amount off</option><option value="percent">Percentage off</option>{form.funding === "vendor" && <option value="package_price">Promotional package (its own price)</option>}</Select>}</FormField>
        {form.kind === "amount" && <FormField id="offer-amount" label="Amount off" required>{(c) => <Input {...c} inputMode="decimal" value={form.amount} disabled={pending} onChange={(e) => set({ amount: e.target.value })} />}</FormField>}
        {form.kind === "percent" && <FormField id="offer-percent" label="Percent off" required help="Up to 80%.">{(c) => <Input {...c} inputMode="decimal" value={form.percent} disabled={pending} onChange={(e) => set({ percent: e.target.value })} />}</FormField>}
        {form.kind === "percent" && <FormField id="offer-cap" label="Maximum discount" help="Optional, dollars.">{(c) => <Input {...c} inputMode="decimal" value={form.cap} disabled={pending} onChange={(e) => set({ cap: e.target.value })} />}</FormField>}
        {form.kind === "package_price" && <p className="text-sm text-muted-foreground sm:col-span-2">The package&apos;s own approved price is the promotional price; no discount is computed and no regular price is invented. Choose exactly one package.</p>}
        <FormField id="offer-min" label="Minimum eligible spend" help="Optional, dollars.">{(c) => <Input {...c} inputMode="decimal" value={form.minSpend} disabled={pending} onChange={(e) => set({ minSpend: e.target.value })} />}</FormField>
        <FormField id="offer-uses" label="Maximum uses" help="Optional.">{(c) => <Input {...c} inputMode="numeric" value={form.maxRedemptions} disabled={pending} onChange={(e) => set({ maxRedemptions: e.target.value })} />}</FormField>
        {form.funding === "platform" && <FormField id="offer-budget" label="Mercurius budget" required help="Total subsidy, dollars.">{(c) => <Input {...c} inputMode="decimal" value={form.budget} disabled={pending} onChange={(e) => set({ budget: e.target.value })} />}</FormField>}
        <FormField id="offer-starts" label="Starts" required>{(c) => <Input {...c} type="datetime-local" value={form.starts} disabled={pending} onChange={(e) => set({ starts: e.target.value })} />}</FormField>
        <FormField id="offer-ends" label="Ends" required>{(c) => <Input {...c} type="datetime-local" value={form.ends} disabled={pending} onChange={(e) => set({ ends: e.target.value })} />}</FormField>
        <FormField id="offer-zips" label="ZIP codes" help="Optional, comma separated. Blank means every covered ZIP.">{(c) => <Input {...c} value={form.zips} disabled={pending} onChange={(e) => set({ zips: e.target.value })} />}</FormField>
        <FormField id="offer-code" label="Code" help={offer?.requiresCode ? "Leave blank to keep the current code." : "Optional, 4 to 24 letters, numbers or dashes."}>{(c) => <Input {...c} value={form.code} autoComplete="off" disabled={pending} onChange={(e) => set({ code: e.target.value })} />}</FormField>
        {form.contractorId && <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Packages</legend><p className="text-sm text-muted-foreground">None chosen means all of this vendor&apos;s packages.</p>
          <div className="grid sm:grid-cols-2">{vendorPackages.map((item) => <Checkbox key={item.id} label={`${item.name}${item.is_active ? "" : " (paused)"}`} checked={form.packages.includes(item.id)} disabled={pending}
            onChange={(e) => set({ packages: e.target.checked ? [...form.packages, item.id] : form.packages.filter((id) => id !== item.id) })} />)}</div></fieldset>}
        <fieldset className="sm:col-span-2"><legend className="text-sm font-medium">Services</legend><p className="text-sm text-muted-foreground">None chosen means every service.</p>
          <div className="grid max-h-40 overflow-y-auto sm:grid-cols-2">{context.services.map((item) => <Checkbox key={item.id} label={item.name} checked={form.services.includes(item.id)} disabled={pending}
            onChange={(e) => set({ services: e.target.checked ? [...form.services, item.id] : form.services.filter((id) => id !== item.id) })} />)}</div></fieldset>
        <div className="sm:col-span-2"><Checkbox label="First booking only (from the homeowner's records)" checked={form.firstBooking} disabled={pending} onChange={(e) => set({ firstBooking: e.target.checked })} /></div>
        <FormField id="offer-label" label="Label" required help="Shown with the offer; up to 48 characters.">{(c) => <Input {...c} value={form.label} maxLength={48} disabled={pending} onChange={(e) => set({ label: e.target.value })} />}</FormField>
        <div className="sm:col-span-2"><FormField id="offer-terms" label="Terms" required help="What homeowners and the vendor read: who qualifies, limits, expiry.">{(c) => <Textarea {...c} value={form.terms} maxLength={600} disabled={pending} onChange={(e) => set({ terms: e.target.value })} />}</FormField></div>
        {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
      </div>}
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="commitment" loading={pending} onClick={() => void save()}>{pending ? "Saving…" : "Save offer"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
