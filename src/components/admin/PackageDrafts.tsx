"use client";

import { useEffect, useRef, useState } from "react";
import { History, Plus, Send } from "lucide-react";
import { toast } from "sonner";
import { PackageContentEditor } from "@/components/admin/PackageContentEditor";
import { PackageContentSummary } from "@/components/pricing/PackageContentSummary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCorrectionTime, frequencyLabel } from "@/lib/packagePriceCorrections";
import {
  approvalStateLabel,
  buildDraftPrices,
  deliveryLabel,
  emailNeedsAttention,
  emailStateLabel,
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
import { isSimpleContent } from "@/lib/pricingContent";
import { createClient } from "@/lib/supabase/client";
import type { PricingFrequency } from "@/lib/vendorPricing";

// DEC-2026-035 (TRACE-110): an operator adds a price for a specific vendor as a private
// draft, then publishes it with a reason the vendor reads. Nothing reaches the vendor or
// customers until the server accepts the publish.
// DEC-2026-039 (TRACE-113): the draft is sent to the bound vendor account, which approves
// the exact revision; only then can it be published. A notice is not consent.

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
    toast.success(draft ? "Draft updated" : "Draft saved", { description: "It stays private until the vendor approves it and you publish it." });
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
        <DialogDescription>Saved as a private draft. Send it to the vendor for approval; once they approve this exact version, publish it with a reason.</DialogDescription>
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
        result.replaced_package_id ? `Version ${result.revision_number ?? ""} is live; the previous version is paused.` : null,
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
    <DialogTrigger render={<Button variant="commitment" className="min-h-10" disabled={!draft.approvalCurrent} />}>Publish</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Publish price</DialogTitle>
        <DialogDescription>
          {draft.contractorName} · {draft.name}, the version the vendor approved{draft.approvedAt ? ` ${formatCorrectionTime(draft.approvedAt)}` : ""}.
          {draft.targetPackageName ? ` It replaces "${draft.targetPackageName}"; the current version is paused and earlier bookings keep theirs.` : " It becomes a new package of the vendor."}
          {" "}It is active for customers once the vendor is eligible and listed. The vendor is notified with your reason.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <PackageContentSummary content={draft.content} />
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

/** Asks the server to email the sent revision's notice, or allows one more attempt. */
async function requestDraftEmail(draftId: string, resend: boolean, confirmUnknown = false) {
  const response = await fetch("/api/admin/package-draft-emails", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draftId, resend, confirmUnknown }),
  });
  const body = (await response.json().catch(() => null)) as { state?: string; message?: string; error?: string } | null;
  const message = body?.message ?? body?.error ?? "The email result is unknown. Refresh to see its state.";
  if (response.ok && body?.state === "sent") toast.success("Email notice sent", { description: message });
  else toast.error("Email notice not confirmed", { description: message });
}

/**
 * Sends the revision on screen to the bound vendor account. Without a bound account, the
 * notice goes to the contact email on file (DEC-2026-041 item 6); approval still needs the
 * vendor to link their account. Otherwise it says why it cannot be sent.
 */
export function PackageDraftSend({ draft, onSent }: { draft: PackageDraft; onSent: () => Promise<void> | void }) {
  const [pending, setPending] = useState(false);
  const blocked = !draft.vendorLink.vendorRole && !draft.vendorLink.emailOnFile;
  const again = draft.approvalState === "sent";
  if (draft.approvalState === "approved" && draft.approvalCurrent) return null;
  async function send() {
    if (pending) return;
    setPending(true);
    const { data, error } = await createClient().rpc("admin_send_package_draft", { p_draft: draft.id, p_revision: draft.revision });
    if (error) { setPending(false); toast.error("Not sent", { description: draftErrorMessage(error) }); return; }
    const result = data as { status: string; reason?: string; channel?: string; email_queued?: boolean };
    if (result.status === "blocked") toast.error("Not sent", { description: result.reason });
    else if (result.channel === "email") {
      if (result.email_queued) await requestDraftEmail(draft.id, false);
      else toast.message("Already emailed", { description: "This revision's notice was already emailed. Use Resend email if it did not arrive." });
    } else toast.success(again ? "Reminder sent" : "Sent for approval", { description: "The vendor sees it in their Mercurius inbox and on Pricing & Packages. No email is sent." });
    setPending(false);
    await onSent();
  }
  return <Button variant="outline" className="min-h-10" loading={pending} disabled={blocked}
    title={blocked ? draft.vendorLink.blocker ?? undefined : undefined} onClick={() => void send()}>
    <Send />{again ? "Send reminder" : "Send for approval"}
  </Button>;
}

/** Resends a failed, missed or unknown email notice; an unknown one may already have arrived. */
export function PackageDraftEmailResend({ draft, onSent }: { draft: PackageDraft; onSent: () => Promise<void> | void }) {
  const [pending, setPending] = useState(false);
  if (draft.approvalState !== "sent" || draft.delivery.status !== "emailed" || !emailNeedsAttention(draft.delivery.email)) return null;
  async function resend() {
    if (pending) return;
    const unknown = draft.delivery.email === "unknown";
    if (unknown && !window.confirm("The earlier email may have arrived. Resend only if the vendor confirms they did not get it.")) return;
    setPending(true);
    await requestDraftEmail(draft.id, true, unknown);
    setPending(false);
    await onSent();
  }
  return <Button variant="outline" className="min-h-10" loading={pending} onClick={() => void resend()}><Send />Resend email</Button>;
}

type DraftEvent = { kind: string; actor_role: string; actor_email: string | null; note: string | null; created_at: string; changes: Array<{ field: string }> | null };
const eventLabel: Record<string, string> = {
  saved: "Saved", sent: "Sent for approval", resent: "Reminder sent", send_blocked: "Could not be sent", approved: "Approved by the vendor",
  changes_requested: "Vendor asked for changes", published: "Published", discarded: "Discarded",
};

export function PackageDraftHistory({ draft }: { draft: PackageDraft }) {
  const [events, setEvents] = useState<DraftEvent[] | null>(null);
  const [error, setError] = useState("");
  return <Dialog onOpenChange={(next) => {
    if (!next) return;
    setEvents(null); setError("");
    void createClient().rpc("admin_package_draft_events", { p_draft: draft.id }).then(({ data, error: rpcError }) => {
      if (rpcError) setError(rpcError.message); else setEvents((data ?? []) as DraftEvent[]);
    });
  }}>
    <DialogTrigger render={<Button variant="ghost" className="min-h-10" />}><History />History</DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Draft history</DialogTitle><DialogDescription>{draft.contractorName} · {draft.name}</DialogDescription></DialogHeader>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !events ? <p role="status" className="text-sm text-muted-foreground">Loading history…</p>
        : events.length === 0 ? <p className="text-sm text-muted-foreground">No recorded steps yet. Drafts saved before approval tracking have no history.</p>
        : <ol className="space-y-3 text-sm">{events.map((event, index) => <li key={index} className="border-l-2 pl-3">
          <p className="font-medium">{eventLabel[event.kind] ?? event.kind}</p>
          <p className="text-xs text-muted-foreground">{formatCorrectionTime(event.created_at)} · {event.actor_role === "vendor" ? "Vendor" : "Mercurius"}{event.actor_email ? ` (${event.actor_email})` : ""}</p>
          {event.changes && event.changes.length > 0 && <p className="text-xs text-muted-foreground">Changed: {event.changes.map((change) => change.field.replace(/_/g, " ")).join(", ")}</p>}
          {event.note && <p className="mt-1 whitespace-pre-line">{event.note}</p>}
        </li>)}</ol>}
    </DialogContent>
  </Dialog>;
}

type TemplateOption = { id: string; name: string; service_id: string };

/** Starts a draft by copying a pricing template; the copy never follows later template edits. */
export function PackageTemplateStart({ contractorId, vendors, onCreated }: { contractorId?: string; vendors?: DraftVendor[]; onCreated: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [vendor, setVendor] = useState(contractorId ?? "");
  const [template, setTemplate] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function create() {
    if (!vendor || !template) { setError("Choose a vendor and a template."); return; }
    setPending(true); setError("");
    const { data, error: rpcError } = await createClient().rpc("admin_draft_from_template", { p_contractor: vendor, p_template: template });
    setPending(false);
    if (rpcError) { setError(draftErrorMessage(rpcError)); return; }
    const notes = ((data as { copy_notes?: string[] }).copy_notes ?? []);
    setOpen(false);
    toast.success("Draft copied from the template", { description: notes.length ? notes.join(". ") : "Review the prices, then send it to the vendor for approval." });
    await onCreated();
  }
  return <Dialog open={open} onOpenChange={(next) => {
    if (pending) return;
    setOpen(next);
    if (next) {
      setVendor(contractorId ?? ""); setTemplate(""); setError("");
      void createClient().from("pricing_templates").select("id, name, service_id").eq("is_active", true).order("name")
        .then(({ data }) => setTemplates((data ?? []) as TemplateOption[]));
    }
  }}>
    <DialogTrigger render={<Button variant="outline" className="min-h-10" />}>Start from template</DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Start from a pricing template</DialogTitle>
        <DialogDescription>Copies the template&apos;s questions, levels, rules and add-ons into a draft for this vendor. Later template edits do not change the copy.</DialogDescription></DialogHeader>
      <div className="space-y-4">
        {!contractorId && <FormField id="template-vendor" label="Vendor" required>{(control) => <Select {...control} value={vendor} disabled={pending} onChange={(event) => setVendor(event.target.value)}>
          <option value="">Choose a vendor</option>{(vendors ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>}</FormField>}
        <FormField id="template-choice" label="Template" required help={templates.length ? undefined : "No active templates."}>{(control) => <Select {...control} value={template} disabled={pending} onChange={(event) => setTemplate(event.target.value)}>
          <option value="">Choose a template</option>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>}</FormField>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="commitment" loading={pending} onClick={() => void create()}>Copy into a draft</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** Open drafts with edit, send, publish, history and discard. */
export function PackageDraftList({ drafts, services, showVendor, onChanged }: {
  drafts: PackageDraft[];
  services: DraftService[];
  showVendor: boolean;
  onChanged: () => Promise<void> | void;
}) {
  if (!drafts.length) return <p className="text-sm text-muted-foreground">No draft prices.</p>;
  return <ul className="space-y-3">{drafts.map((draft) => <li key={draft.id} className="space-y-3 rounded-lg border border-dashed p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="font-medium break-words">{showVendor ? `${draft.contractorName} · ` : ""}{draft.name}</p>
        <p className="text-sm text-muted-foreground">{draft.serviceName}{draft.targetPackageName ? ` · replaces "${draft.targetPackageName}"` : ""} · not visible to customers</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={draft.approvalCurrent ? "border-status-success text-status-success" : draft.approvalState === "changes_requested" ? "border-status-warning text-status-warning" : undefined}>
            {draft.approvalState === "approved" && !draft.approvalCurrent ? approvalStateLabel.draft : approvalStateLabel[draft.approvalState]}
          </Badge>
          {draft.approvalState === "sent" && <Badge variant="outline">{deliveryLabel[draft.delivery.status]}</Badge>}
          {draft.approvalState === "sent" && draft.delivery.status === "emailed" && <Badge variant="outline"
            className={emailNeedsAttention(draft.delivery.email) ? "border-status-warning text-status-warning" : undefined}>{emailStateLabel[draft.delivery.email]}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">Saved {formatCorrectionTime(draft.updatedAt)}{draft.createdByEmail ? ` · started by ${draft.createdByEmail}` : ""}{draft.sentAt ? ` · sent ${formatCorrectionTime(draft.sentAt)}` : ""}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {isSimpleContent(draft.content) && <PackageDraftEditor draft={draft} services={services} onSaved={onChanged} />}
        <PackageContentEditor draft={draft} services={services} onSaved={onChanged} />
        <PackageDraftSend draft={draft} onSent={onChanged} />
        <PackageDraftEmailResend draft={draft} onSent={onChanged} />
        <PackageDraftPublish draft={draft} onPublished={onChanged} />
        <PackageDraftHistory draft={draft} />
        <ConfirmAction triggerLabel="Discard" title="Discard draft price" entity={`${draft.contractorName} · ${draft.name}`}
          consequence="The draft is closed and never published. Nothing changes for the vendor." confirmLabel="Discard draft"
          onConfirm={async () => {
            const { error } = await createClient().rpc("admin_discard_package_draft", { p_draft: draft.id, p_expected_updated_at: draft.updatedAt });
            if (error) throw error;
            await onChanged();
          }} />
      </div>
    </div>
    {!draft.vendorLink.vendorRole && <p role="note" className="rounded-md border border-status-warning bg-status-warning-bg px-3 py-2 text-sm text-status-warning">
      {draft.vendorLink.emailOnFile
        ? "No vendor account is bound to this provider. Sending emails a notice to the contact email on file; the email is not approval. The vendor must link their account and approve before this can be published."
        : `${draft.vendorLink.blocker}${draft.vendorLink.linked ? "" : " and no contact email is on file"}. Nothing can be sent. The vendor must approve before this can be published; bind their account from the vendor page first.`}</p>}
    {draft.approvalState === "sent" && draft.delivery.status === "emailed" && draft.delivery.emailError && emailNeedsAttention(draft.delivery.email) &&
      <p role="alert" className="text-sm text-status-warning">Email error: {draft.delivery.emailError}</p>}
    {draft.changeRequest && draft.approvalState === "changes_requested" && <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm"><p className="font-medium">The vendor asked for changes</p><p className="whitespace-pre-line">{draft.changeRequest}</p></div>}
    <PackageContentSummary content={draft.content} />
  </li>)}</ul>;
}
