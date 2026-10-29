"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquareQuote, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { draftErrorMessage } from "@/lib/packageDrafts";
import { catalogSaveErrorMessage, catalogServiceError, catalogServiceInsert, SERVICE_ID_MAX_LENGTH } from "@/lib/serviceCatalog";
import { createClient } from "@/lib/supabase/client";
import { catalogServiceFromApplication, customQuoteContent, QUOTE_REASON_MAX, quoteReasonError } from "@/lib/vendorServices";

type Category = { id: string; name: string; is_active: boolean };
type Existing = { id: string; name: string; sort_order: number };

/**
 * DEC-2026-044 / TRACE-129: adds a service named on the vendor's application to the catalog,
 * as Custom Quote and shown, without leaving the vendor record. Its reference prices stay $0;
 * the vendor's own package prices it.
 */
export function AddCatalogServiceButton({ name, onAdded }: { name: string; onAdded: (service: { id: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => catalogServiceFromApplication(name, "specialty"));
  const [categories, setCategories] = useState<Category[]>([]);
  const [existing, setExisting] = useState<Existing[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function load() {
    setLoading(true);
    const supabase = createClient();
    const [categoryResult, serviceResult] = await Promise.all([
      supabase.from("service_categories").select("id, name, is_active").order("sort_order"),
      supabase.from("services_catalog").select("id, name, sort_order"),
    ]);
    setLoading(false);
    const failure = categoryResult.error ?? serviceResult.error;
    if (failure) { setError(failure.message); return; }
    const rows = (categoryResult.data ?? []) as Category[];
    setCategories(rows);
    setExisting((serviceResult.data ?? []) as Existing[]);
    const fallback = rows.find((category) => category.id === "specialty") ?? rows[0];
    setForm(catalogServiceFromApplication(name, fallback?.id ?? ""));
  }

  async function add() {
    if (pending) return;
    const problem = catalogServiceError(form, existing, true);
    if (problem) { setError(problem); return; }
    setError("");
    setPending(true);
    const result = await createClient().from("services_catalog").insert(catalogServiceInsert(form, existing));
    setPending(false);
    if (result.error) { setError(catalogSaveErrorMessage(result.error)); return; }
    setOpen(false);
    toast.success(`${form.name} added to the catalog`, { description: "Added as Custom Quote and selected for this vendor. Save services to keep it on the record." });
    onAdded({ id: form.id, name: form.name.trim() });
  }

  return <Dialog open={open} onOpenChange={(next) => {
    if (pending) return;
    setOpen(next);
    if (next) { setError(""); void load(); }
  }}>
    <DialogTrigger render={<Button variant="outline" size="sm" aria-label={`Add ${name} to the catalog`} />}><Plus />Add to catalog</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Add a catalog service</DialogTitle>
        <DialogDescription>Added as Custom Quote and shown on the site. Each vendor sets its own price; until one offers it in an area, homeowners there see that it is not available yet. Edit icon, tags and reference prices later in Service Catalog.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <FormField id={`catalog-add-name-${form.id || "new"}`} label="Name" required>
          {(control) => <Input {...control} value={form.name} disabled={pending} onChange={(event) => setForm({ ...form, name: event.target.value, id: catalogServiceFromApplication(event.target.value, form.category_id).id })} />}
        </FormField>
        <FormField id={`catalog-add-id-${form.id || "new"}`} label="Service ID" required help="Used in links and records; it can't be changed after the service is added.">
          {(control) => <Input {...control} value={form.id} maxLength={SERVICE_ID_MAX_LENGTH} disabled={pending} onChange={(event) => setForm({ ...form, id: event.target.value.toLowerCase() })} />}
        </FormField>
        <FormField id={`catalog-add-category-${form.id || "new"}`} label="Category" required>
          {(control) => <Select {...control} value={form.category_id} disabled={pending || loading} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.is_active ? "" : " (hidden)"}</option>)}
          </Select>}
        </FormField>
        <FormField id={`catalog-add-description-${form.id || "new"}`} label="Description" help="Optional. A short line homeowners see.">
          {(control) => <Textarea {...control} value={form.descriptor} disabled={pending} onChange={(event) => setForm({ ...form, descriptor: event.target.value })} />}
        </FormField>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
        <p role="status" className="sr-only">{pending ? "Adding service…" : ""}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="commitment" loading={pending} disabled={loading} onClick={() => void add()}>{pending ? "Adding…" : "Add service"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

type Outcome = { serviceId: string; name: string; error: string | null };

/**
 * TRACE-129: offers saved services that have no price for this vendor as Custom Quote. Each one
 * is a draft published with the reason (DEC-2026-046): never sent for approval, no email; a
 * linked vendor gets the usual inbox notice. A failure leaves that service's draft in Vendor prices.
 */
export function OfferCustomQuote({ contractorId, services, onDone }: {
  contractorId: string;
  services: { id: string; name: string }[];
  onDone: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function publish() {
    if (pending) return;
    const selected = services.filter((service) => chosen.has(service.id));
    if (!selected.length) { setError("Choose at least one service."); return; }
    const problem = quoteReasonError(reason);
    if (problem) { setError(problem); return; }
    setError("");
    setPending(true);
    const supabase = createClient();
    const outcomes: Outcome[] = [];
    for (const service of selected) {
      const saved = await supabase.rpc("admin_save_package_draft_content", {
        p_draft: null, p_expected_updated_at: null, p_contractor: contractorId, p_service: service.id,
        p_target_package: null, p_content: customQuoteContent(service.name),
      });
      const draft = saved.data as { id?: string; updated_at?: string } | null;
      if (saved.error || !draft?.id || !draft.updated_at) {
        outcomes.push({ serviceId: service.id, name: service.name, error: saved.error ? draftErrorMessage(saved.error) : "The draft was not saved." });
        continue;
      }
      const published = await supabase.rpc("admin_publish_package_draft", {
        p_draft: draft.id, p_expected_updated_at: draft.updated_at, p_reason: reason.trim(),
      });
      outcomes.push({ serviceId: service.id, name: service.name, error: published.error ? `Saved as a draft in Vendor prices, not published: ${draftErrorMessage(published.error)}` : null });
    }
    setPending(false);
    const failed = outcomes.filter((outcome) => outcome.error);
    const done = outcomes.filter((outcome) => !outcome.error);
    if (done.length) toast.success(`Custom Quote published for ${done.map((outcome) => outcome.name).join(", ")}`, { description: "Not sent for approval; no email was sent." });
    if (failed.length) setError(failed.map((outcome) => `${outcome.name}: ${outcome.error}`).join(" "));
    else setOpen(false);
    await onDone();
  }

  return <Dialog open={open} onOpenChange={(next) => {
    if (pending) return;
    setOpen(next);
    if (next) { setChosen(new Set(services.map((service) => service.id))); setReason(""); setError(""); }
  }}>
    <DialogTrigger render={<Button variant="outline" size="sm" disabled={!services.length} />}><MessageSquareQuote />Offer as Custom Quote</DialogTrigger>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Offer as Custom Quote</DialogTitle>
        <DialogDescription>Publishes a Custom Quote price for this vendor only: homeowners request a quote and the vendor prices the job. Other vendors and the catalog are not changed. You can replace it with a fixed price later in Vendor prices.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Services with no price for this vendor</legend>
          {services.map((service) => <Checkbox key={service.id} label={service.name} checked={chosen.has(service.id)} disabled={pending}
            onChange={(event) => setChosen((current) => { const next = new Set(current); if (event.target.checked) next.add(service.id); else next.delete(service.id); return next; })} />)}
        </fieldset>
        <FormField id={`quote-reason-${contractorId}`} label="Reason" required help={`Not sent for approval and no email is sent. A linked vendor sees this reason in their inbox. Up to ${QUOTE_REASON_MAX} characters.`}>
          {(control) => <Textarea {...control} value={reason} maxLength={QUOTE_REASON_MAX} disabled={pending} onChange={(event) => setReason(event.target.value)} />}
        </FormField>
        {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
        <p role="status" className="sr-only">{pending ? "Publishing Custom Quote prices…" : ""}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="commitment" loading={pending} onClick={() => void publish()}>{pending ? "Publishing…" : "Publish Custom Quote"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
