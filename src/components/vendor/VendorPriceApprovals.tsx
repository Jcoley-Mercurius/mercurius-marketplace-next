"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { PackageContentSummary } from "@/components/pricing/PackageContentSummary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCorrectionTime, frequencyLabel } from "@/lib/packagePriceCorrections";
import { emptyContent, lineAmountLabel, lineLabel, parseContent, parsePriceResult, priceResultLabel, type PackageContent, type PriceResult } from "@/lib/pricingContent";
import { formatPromotionDiscount, parseOffers, type PromotionOffer } from "@/lib/promotionOffers";
import { createClient } from "@/lib/supabase/client";
import type { PricingFrequency } from "@/lib/vendorPricing";

// TRACE-113 (DEC-2026-039): prices Mercurius prepared for this vendor wait here for the
// vendor's decision on the exact version shown. Approving does not publish anything by
// itself. TRACE-120 (DEC-2026-046): Mercurius may publish without the vendor's approval.
// TRACE-114 (DEC-2026-038): offers the vendor would fund wait here for approval too.

type Approval = {
  id: string;
  serviceName: string;
  content: PackageContent;
  revision: string;
  targetPackageName: string | null;
  status: string;
  approvalState: "sent" | "approved" | "changes_requested" | "draft";
  sentAt: string | null;
  approvedAt: string | null;
  changeRequest: string | null;
};

function parseApprovals(value: unknown): Approval[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): Approval[] => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.revision !== "string") return [];
    const text = (v: unknown) => (typeof v === "string" ? v : null);
    return [{
      id: item.id, serviceName: text(item.service_name) ?? "Service", content: parseContent(item.content) ?? emptyContent("Package"),
      revision: item.revision, targetPackageName: text(item.target_package_name), status: text(item.status) ?? "draft",
      approvalState: (["sent", "approved", "changes_requested"].includes(String(item.approval_state)) ? item.approval_state : "draft") as Approval["approvalState"],
      sentAt: text(item.sent_at), approvedAt: text(item.approved_at), changeRequest: text(item.change_request),
    }];
  });
}

const stateText: Record<Approval["approvalState"], string> = {
  sent: "Waiting for your approval",
  approved: "You approved this version; Mercurius publishes it",
  changes_requested: "You asked for changes",
  draft: "Being revised by Mercurius",
};

export function VendorPriceApprovals() {
  const [items, setItems] = useState<Approval[]>([]);
  const [offers, setOffers] = useState<PromotionOffer[]>([]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [approvals, offerResult] = await Promise.all([supabase.rpc("vendor_package_approvals"), supabase.rpc("vendor_promotion_offers")]);
    if (!approvals.error) setItems(parseApprovals(approvals.data).filter((item) => item.status === "draft" || item.approvalState === "approved"));
    if (!offerResult.error) setOffers(parseOffers(offerResult.data).filter((offer) => offer.status !== "draft" || offer.vendorNote));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!items.length && !offers.length) return null;

  return <div className="space-y-4">
    {items.length > 0 && <section id="price-approvals" aria-labelledby="vendor-price-approvals" className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
      <div>
        <h2 id="vendor-price-approvals" className="font-semibold">Prices waiting for your approval</h2>
        <p className="mt-1 text-sm text-muted-foreground">Mercurius prepared these for you and asks you to approve exactly this version or ask for changes. Mercurius can also publish a price without your approval; you are notified when a price goes live.</p>
      </div>
      <ul className="space-y-3">{items.map((item) => <ApprovalItem key={item.id} item={item} onChanged={load} />)}</ul>
    </section>}
    {offers.length > 0 && <section id="offer-approvals" aria-labelledby="vendor-offer-approvals" className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
      <div>
        <h2 id="vendor-offer-approvals" className="font-semibold">Offers you would fund</h2>
        <p className="mt-1 text-sm text-muted-foreground">With an offer applied, Mercurius&apos;s commission is 7.5% instead of 15%. An offer applies to a booking only when the homeowner chooses it; approving records your agreement to this version.</p>
      </div>
      <ul className="space-y-3">{offers.map((offer) => <OfferItem key={offer.id} offer={offer} onChanged={load} />)}</ul>
    </section>}
  </div>;
}

function ApprovalItem({ item, onChanged }: { item: Approval; onChanged: () => Promise<void> }) {
  const [pending, setPending] = useState(false);
  async function approve() {
    setPending(true);
    const { error } = await createClient().rpc("vendor_approve_package_draft", { p_draft: item.id, p_revision: item.revision });
    setPending(false);
    if (error) { toast.error("Not approved", { description: error.code === "40001" ? "This price changed since you opened it. Reload to review the current version." : error.message }); await onChanged(); return; }
    toast.success("Approved", { description: "Mercurius has your approval of this version. You'll be notified when it's live." });
    await onChanged();
  }
  return <li className="space-y-3 rounded-lg border bg-muted/10 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium break-words">{item.content.name}</p>
        <p className="text-sm text-muted-foreground">{item.serviceName}{item.targetPackageName ? ` · replaces "${item.targetPackageName}"` : " · new package"}{item.sentAt ? ` · sent ${formatCorrectionTime(item.sentAt)}` : ""}</p>
        <Badge variant="outline" className="mt-2">{stateText[item.approvalState]}</Badge>
      </div>
      {item.approvalState === "sent" && <div className="flex flex-wrap gap-2">
        <ApprovalPreview item={item} />
        <RequestChanges item={item} onChanged={onChanged} />
        <Button variant="commitment" className="min-h-10" loading={pending} onClick={() => void approve()}><CheckCircle2 />Approve this version</Button>
      </div>}
    </div>
    {item.changeRequest && item.approvalState === "changes_requested" && <p className="text-sm"><span className="text-muted-foreground">You asked: </span>{item.changeRequest}</p>}
    <PackageContentSummary content={item.content} />
  </li>;
}

function RequestChanges({ item, onChanged }: { item: Approval; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit() {
    if (!note.trim()) { setError("Say what should change."); return; }
    setPending(true);
    const { error: rpcError } = await createClient().rpc("vendor_request_package_changes", { p_draft: item.id, p_revision: item.revision, p_note: note.trim() });
    setPending(false);
    if (rpcError) { setError(rpcError.code === "40001" ? "This price changed since you opened it. Reload to review the current version." : rpcError.message); return; }
    setOpen(false);
    toast.success("Sent to Mercurius", { description: "Mercurius will revise it and send it back for your approval." });
    await onChanged();
  }
  return <Dialog open={open} onOpenChange={(next) => { if (pending) return; setOpen(next); if (next) { setNote(""); setError(""); } }}>
    <DialogTrigger render={<Button variant="outline" className="min-h-10" />}><MessageSquare />Ask for changes</DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Ask for changes</DialogTitle><DialogDescription>{item.content.name}. Mercurius reads your note before publishing.</DialogDescription></DialogHeader>
      <FormField id={`changes-${item.id}`} label="What should change" required error={error || undefined}>
        {(control) => <Textarea {...control} value={note} maxLength={1000} disabled={pending} onChange={(event) => setNote(event.target.value)} />}
      </FormField>
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="commitment" loading={pending} onClick={() => void submit()}>Send to Mercurius</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** What homeowners would pay for this version, from the same calculation requests use. */
function ApprovalPreview({ item }: { item: Approval }) {
  const cadences = [...new Set(item.content.tiers.map((tier) => tier.frequency))];
  const [frequency, setFrequency] = useState<PricingFrequency | "">("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PriceResult | null>(null);
  const [open, setOpen] = useState(false);
  const cadence = frequency || cadences[0] || "one-time";
  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void createClient().rpc("pricing_preview_draft", { p_draft: item.id, p_frequency: cadence, p_tier: "", p_answers: answers, p_addons: [] })
        .then(({ data, error }) => { if (active) setResult(error ? null : parsePriceResult(data)); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, item.id, cadence, answers]);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger render={<Button variant="ghost" className="min-h-10" />}>Preview</DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>What homeowners would see</DialogTitle><DialogDescription>{item.content.name}. A preview of this version; not live.</DialogDescription></DialogHeader>
      <div className="space-y-3">
        {cadences.length > 1 && <FormField id={`approval-cadence-${item.id}`} label="Cadence">{(c) => <Select {...c} value={cadence} onChange={(e) => setFrequency(e.target.value as PricingFrequency)}>
          {cadences.map((value) => <option key={value} value={value}>{frequencyLabel(value)}</option>)}</Select>}</FormField>}
        {item.content.questions.map((q) => <FormField key={q.question_key} id={`approval-${item.id}-${q.question_key}`} label={q.question_label}>
          {(c) => <Input {...c} inputMode={q.input_type === "number" ? "decimal" : undefined} value={answers[q.question_key] ?? ""} onChange={(e) => setAnswers((current) => ({ ...current, [q.question_key]: e.target.value }))} />}
        </FormField>)}
        <div role="status" aria-live="polite" className="space-y-1 border-t pt-3 text-sm">
          {result ? <><p className="font-medium">{priceResultLabel(result)}</p>
            {result.lines.map((line, index) => <div key={index} className="flex justify-between gap-3"><span className="text-muted-foreground">{lineLabel(line)}</span><span className="tabular-nums">{lineAmountLabel(line)}</span></div>)}</>
            : <p className="text-muted-foreground">Calculating…</p>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}

function OfferItem({ offer, onChanged }: { offer: PromotionOffer; onChanged: () => Promise<void> }) {
  const [pending, setPending] = useState<"approve" | "decline" | null>(null);
  const [note, setNote] = useState("");
  async function decide(action: "approve" | "decline") {
    if (action === "decline" && !note.trim()) { toast.error("Say why, or what would work"); return; }
    setPending(action);
    const { error } = action === "approve"
      ? await createClient().rpc("vendor_approve_promotion_offer", { p_offer: offer.id, p_fingerprint: offer.fingerprint })
      : await createClient().rpc("vendor_decline_promotion_offer", { p_offer: offer.id, p_fingerprint: offer.fingerprint, p_note: note.trim() });
    setPending(null);
    if (error) { toast.error("Not saved", { description: error.code === "40001" ? "This offer changed since you opened it. Reload to review it." : error.message }); await onChanged(); return; }
    toast.success(action === "approve" ? "Offer approved" : "Sent to Mercurius");
    await onChanged();
  }
  const example = offer.example;
  return <li className="space-y-2 rounded-lg border bg-muted/10 p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="font-medium">{offer.label}</p><p className="text-muted-foreground">{formatPromotionDiscount(offer)} · {offer.packageNames.length ? offer.packageNames.join(", ") : "your packages"} · {formatCorrectionTime(offer.startsAt)} to {formatCorrectionTime(offer.endsAt)} ({offer.timezone})</p></div>
      <Badge variant="outline">{offer.status === "approved" ? "Approved" : offer.status === "awaiting_vendor" ? "Waiting for your approval" : offer.status === "retired" ? "Ended" : "With Mercurius"}</Badge>
    </div>
    <p>{offer.terms}</p>
    {example && <p className="text-muted-foreground">On a $100 service: homeowner pays {formatCents(example.homeownerServiceCents)}, Mercurius commission {formatCents(example.commissionCents)} (7.5%), you receive {formatCents(example.vendorProceedsCents)} before other applicable fees.</p>}
    {offer.vendorNote && offer.status === "draft" && <p><span className="text-muted-foreground">You said: </span>{offer.vendorNote}</p>}
    {offer.status === "awaiting_vendor" && <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="flex-1"><FormField id={`offer-note-${offer.id}`} label="Note (to decline)">{(c) => <Input {...c} value={note} onChange={(e) => setNote(e.target.value)} />}</FormField></div>
      <Button variant="outline" className="min-h-10" loading={pending === "decline"} disabled={pending !== null} onClick={() => void decide("decline")}>Decline</Button>
      <Button variant="commitment" className="min-h-10" loading={pending === "approve"} disabled={pending !== null} onClick={() => void decide("approve")}>Approve this offer</Button>
    </div>}
  </li>;
}

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
