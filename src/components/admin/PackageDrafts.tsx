"use client";

import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCorrectionTime, frequencyLabel } from "@/lib/packagePriceCorrections";
import {
  buildDraftPrices,
  describeDraftPrice,
  DRAFT_DESCRIPTION_MAX,
  DRAFT_NAME_MAX,
  DRAFT_REASON_MAX,
  draftErrorMessage,
  draftPriceInput,
  type DraftPriceInput,
  type DraftService,
  type DraftVendor,
  type PackageDraft,
  type PublishResult,
} from "@/lib/packageDrafts";
import { createClient } from "@/lib/supabase/client";
import type { PricingFrequency } from "@/lib/vendorPricing";

// DEC-2026-035 (TRACE-110): an operator adds a price for a specific vendor as a private
// draft, then publishes it with a reason the vendor reads. Nothing reaches the vendor or
// customers until the server accepts the publish.

/** Start a draft (no `draft`) or edit an open one. `vendors` lets the operator choose the vendor. */
export function PackageDraftEditor({ draft, contractorId, vendors, services, onSaved }: {
  draft?: PackageDraft;
  contractorId?: string;
  vendors?: DraftVendor[];
  services: DraftService[];
  onSaved: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prices, setPrices] = useState<DraftPriceInput>({});
  const [invalid, setInvalid] = useState<PricingFrequency[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const service = services.find((item) => item.id === serviceId);
  const fixedVendor = draft?.contractorId ?? contractorId;
  const key = draft?.id ?? "new";
  const vendorName = draft?.contractorName ?? vendors?.find((item) => item.id === fixedVendor)?.name;

  function reset() {
    setVendor(fixedVendor ?? "");
    setServiceId(draft?.serviceId ?? "");
    setName(draft?.name ?? "");
    setDescription(draft?.description ?? "");
    setPrices(draft ? draftPriceInput(draft.prices) : {});
    setInvalid([]);
    setError("");
  }

  async function save() {
    if (pending) return;
    if (!vendor) { setError("Choose the vendor this price is for."); return; }
    if (!service) { setError("Choose a catalog service."); return; }
    if (!name.trim()) { setError("Enter the package name customers will see."); return; }
    const built = buildDraftPrices(prices, service.offered);
    if (!built.ok) { setInvalid(built.invalid); setError(built.message); return; }
    setInvalid([]);
    setError("");
    setPending(true);
    const { error: rpcError } = await createClient().rpc("admin_save_package_draft", {
      p_draft: draft?.id ?? null,
      p_expected_updated_at: draft?.updatedAt ?? null,
      p_contractor: vendor,
      p_service: service.id,
      p_name: name.trim(),
      p_description: description.trim() || null,
      p_prices: built.prices,
    });
    setPending(false);
    if (rpcError) { setError(draftErrorMessage(rpcError)); return; }
    setOpen(false);
    toast.success(draft ? "Draft updated" : "Draft saved", { description: "It stays private to Mercurius until you publish it." });
    await onSaved();
  }

  return <Dialog open={open} onOpenChange={(next) => {
    if (pending) return;
    setOpen(next);
    if (next) reset();
  }}>
    <DialogTrigger render={<Button variant={draft ? "outline" : "commitment"} className="min-h-10" />}>{draft ? "Edit draft" : <><Plus />Add a price</>}</DialogTrigger>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{draft ? "Edit draft price" : "Add a price for a vendor"}</DialogTitle>
        <DialogDescription>Saved as a private draft. The vendor and customers see nothing until you publish it with a reason.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {fixedVendor
          ? vendorName && <p className="text-sm"><span className="text-muted-foreground">Vendor: </span>{vendorName}</p>
          : <FormField id={`draft-vendor-${key}`} label="Vendor" required>
            {(control) => <Select {...control} value={vendor} disabled={pending} onChange={(event) => setVendor(event.target.value)}>
              <option value="">Choose a vendor</option>
              {(vendors ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>}
          </FormField>}
        <FormField id={`draft-service-${key}`} label="Service" required>
          {(control) => <Select {...control} value={serviceId} disabled={pending} onChange={(event) => {
            const next = services.find((item) => item.id === event.target.value);
            if (next && (!name.trim() || name === service?.name)) setName(next.name);
            setServiceId(event.target.value);
          }}>
            <option value="">Choose a service</option>
            {services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>}
        </FormField>
        <FormField id={`draft-name-${key}`} label="Package name" required help="Customers see this name.">
          {(control) => <Input {...control} value={name} maxLength={DRAFT_NAME_MAX} disabled={pending} onChange={(event) => setName(event.target.value)} />}
        </FormField>
        <FormField id={`draft-description-${key}`} label="Description" help="Optional. What the price includes.">
          {(control) => <Textarea {...control} value={description} maxLength={DRAFT_DESCRIPTION_MAX} disabled={pending} onChange={(event) => setDescription(event.target.value)} />}
        </FormField>
        {service ? <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Price per visit</legend>
          <p className="text-sm text-muted-foreground">Enter a price for each cadence this vendor offers; leave the rest blank. Only cadences the catalog offers for {service.name} are listed.</p>
          {service.offered.map((frequency) => <FormField key={frequency} id={`draft-price-${key}-${frequency}`} label={frequencyLabel(frequency)}
            error={invalid.includes(frequency) ? "Enter a positive dollar amount, at most two decimal places." : undefined}>
            {(control) => <Input {...control} inputMode="decimal" autoComplete="off" placeholder="Not offered" value={prices[frequency] ?? ""} disabled={pending}
              onChange={(event) => setPrices((current) => ({ ...current, [frequency]: event.target.value }))} />}
          </FormField>)}
        </fieldset> : <p className="text-sm text-muted-foreground">Choose a service to enter prices.</p>}
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
        <p role="status" className="sr-only">{pending ? "Saving draft…" : ""}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="commitment" loading={pending} onClick={() => void save()}>{pending ? "Saving…" : "Save draft"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function PackageDraftPublish({ draft, onPublished }: { draft: PackageDraft; onPublished: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function publish() {
    if (pending) return;
    if (!reason.trim()) { setError("Enter the reason. The vendor will see it."); return; }
    setError("");
    setPending(true);
    const { data, error: rpcError } = await createClient().rpc("admin_publish_package_draft", {
      p_draft: draft.id, p_expected_updated_at: draft.updatedAt, p_reason: reason.trim(),
    });
    setPending(false);
    if (rpcError) { setError(draftErrorMessage(rpcError)); return; }
    const result = data as PublishResult;
    setOpen(false);
    toast.success("Price published", {
      description: [
        result.needs_review ? "A price is outside the guardrail band, so it waits in Package Reviews until approved." : null,
        result.vendor_notified ? "The vendor was notified with your reason." : "No vendor account is linked, so no one was notified.",
      ].filter(Boolean).join(" "),
    });
    await onPublished();
  }

  return <Dialog open={open} onOpenChange={(next) => {
    if (pending) return;
    setOpen(next);
    if (next) { setReason(""); setError(""); }
  }}>
    <DialogTrigger render={<Button variant="commitment" className="min-h-10" />}>Publish</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Publish price</DialogTitle>
        <DialogDescription>
          {draft.contractorName} · {draft.name}. This becomes the vendor’s package, active for customers once the vendor is eligible and listed.
          The vendor is notified with your reason and manages the package from then on.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <ul className="list-disc space-y-0.5 pl-5 text-sm">{draft.prices.map((price) => <li key={price.frequency}>{describeDraftPrice(price)}</li>)}</ul>
        <FormField id={`draft-reason-${draft.id}`} label="Reason" required help={`The vendor is notified and sees this reason. Up to ${DRAFT_REASON_MAX} characters.`}>
          {(control) => <Textarea {...control} value={reason} maxLength={DRAFT_REASON_MAX} disabled={pending} onChange={(event) => setReason(event.target.value)} />}
        </FormField>
        <p className="text-sm text-muted-foreground">A price outside the guardrail band waits in Package Reviews; publishing is not approving.</p>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
        <p role="status" className="sr-only">{pending ? "Publishing price…" : ""}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="commitment" loading={pending} onClick={() => void publish()}>{pending ? "Publishing…" : "Publish price"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** Open drafts with edit, publish and discard. */
export function PackageDraftList({ drafts, services, showVendor, onChanged }: {
  drafts: PackageDraft[];
  services: DraftService[];
  showVendor: boolean;
  onChanged: () => Promise<void> | void;
}) {
  if (!drafts.length) return <p className="text-sm text-muted-foreground">No draft prices.</p>;
  return <ul className="space-y-3">{drafts.map((draft) => <li key={draft.id} className="space-y-3 rounded-lg border border-dashed p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium break-words">{showVendor ? `${draft.contractorName} · ` : ""}{draft.name}</p>
        <p className="text-sm text-muted-foreground">{draft.serviceName} · Draft, not visible to the vendor or customers</p>
        <p className="text-xs text-muted-foreground">Saved {formatCorrectionTime(draft.updatedAt)}{draft.createdByEmail ? ` · started by ${draft.createdByEmail}` : ""}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <PackageDraftEditor draft={draft} services={services} onSaved={onChanged} />
        <PackageDraftPublish draft={draft} onPublished={onChanged} />
        <ConfirmAction triggerLabel="Discard" title="Discard draft price" entity={`${draft.contractorName} · ${draft.name}`}
          consequence="The draft is closed and never published. Nothing changes for the vendor." confirmLabel="Discard draft"
          onConfirm={async () => {
            const { error } = await createClient().rpc("admin_discard_package_draft", { p_draft: draft.id, p_expected_updated_at: draft.updatedAt });
            if (error) throw error;
            await onChanged();
          }} />
      </div>
    </div>
    <ul className="list-disc space-y-0.5 pl-5 text-sm">{draft.prices.map((price) => <li key={price.frequency}>{describeDraftPrice(price)}</li>)}</ul>
  </li>)}</ul>;
}
