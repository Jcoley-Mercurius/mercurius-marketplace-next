"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Layers, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { frequencyLabel, parsePriceInput } from "@/lib/packagePriceCorrections";
import { DRAFT_DESCRIPTION_MAX, DRAFT_NAME_MAX, draftErrorMessage, type DraftService, type DraftVendor, type PackageDraft } from "@/lib/packageDrafts";
import {
  lineAmountLabel,
  lineLabel,
  newContentId,
  parsePriceResult,
  PRICE_KINDS,
  priceResultLabel,
  PRICING_MODES,
  type ContentAddon,
  type ContentQuestion,
  type ContentTier,
  type PackageContent,
  type PriceKind,
  type PriceResult,
  type PricingMode,
} from "@/lib/pricingContent";
import { createClient } from "@/lib/supabase/client";
import type { PricingFrequency } from "@/lib/vendorPricing";

// TRACE-113 (DEC-2026-039): an operator builds a vendor's package as a private draft: price
// meaning, price levels and their rules, questions, add-ons, included scope and provider
// notes. The server validates the content (overlapping rules, scope charged twice, cadences)
// and the preview prices it with the same calculation requests use. Saving never publishes;
// the vendor approves the exact revision before an operator can publish it.

type QuestionInput = { question_key: string; question_label: string; input_type: ContentQuestion["input_type"]; unit: string; options: string; is_required: boolean };
type ConditionInput = { min: string; max: string };
type TierInput = { id: string; name: string; frequency: PricingFrequency; price_kind: PriceKind; price: string; price_max: string; conditions: Record<string, ConditionInput>; includes: string };
type AddonInput = { id: string; name: string; description: string; price_kind: "exact" | "range"; price: string; price_max: string; unit_label: string; min_quantity: string; max_quantity: string; is_required: boolean; frequencies: PricingFrequency[] };
type Model = { name: string; description: string; pricing_mode: PricingMode; deposit: string; included: string; policy_notes: string; questions: QuestionInput[]; tiers: TierInput[]; addons: AddonInput[] };

type VendorPackageOption = { id: string; name: string; is_active: boolean; lineage_id: string | null; revision_number: number };

const blankModel = (name = ""): Model => ({ name, description: "", pricing_mode: "fixed", deposit: "", included: "", policy_notes: "", questions: [], tiers: [], addons: [] });

const numberText = (value: number | null | undefined) => (value === null || value === undefined ? "" : String(value));

function modelFromContent(content: PackageContent): Model {
  return {
    name: content.name,
    description: content.description ?? "",
    pricing_mode: content.pricing_mode,
    deposit: numberText(content.deposit_amount),
    included: content.included_scope.join("\n"),
    policy_notes: content.policy_notes ?? "",
    questions: content.questions.map((q) => ({ question_key: q.question_key, question_label: q.question_label, input_type: q.input_type,
      unit: q.unit ?? "", options: (q.options ?? []).join(", "), is_required: q.is_required })),
    tiers: content.tiers.map((t) => ({ id: t.id, name: t.name, frequency: t.frequency, price_kind: t.price_kind, price: numberText(t.price),
      price_max: numberText(t.price_max), includes: t.includes.join(", "),
      conditions: Object.fromEntries(t.conditions.map((c) => [c.question_key, { min: numberText(c.min), max: numberText(c.max) }])) })),
    addons: content.addons.map((a) => ({ id: a.id, name: a.name, description: a.description ?? "", price_kind: a.price_kind,
      price: numberText(a.price), price_max: numberText(a.price_max), unit_label: a.unit_label ?? "",
      min_quantity: String(a.min_quantity), max_quantity: String(a.max_quantity), is_required: a.is_required, frequencies: a.frequencies })),
  };
}

const splitList = (value: string, separator: RegExp) => value.split(separator).map((item) => item.trim()).filter(Boolean);
const amount = (value: string) => (value.trim() ? parsePriceInput(value) : null);
const bound = (value: string) => { const text = value.trim().replace(/,/g, ""); return text === "" ? null : Number.isFinite(Number(text)) ? Number(text) : NaN; };
const quantity = (value: string, fallback: number) => (value.trim() === "" ? fallback : Number(value));

/** Builds the content document; the server performs the complete validation. */
export function contentFromModel(model: Model): { content: PackageContent; error: null } | { content: null; error: string } {
  const numberKeys = model.questions.filter((q) => q.input_type === "number").map((q) => q.question_key.trim());
  const tiers: ContentTier[] = [];
  for (const tier of model.tiers) {
    const price = amount(tier.price);
    if (price === null) return { content: null, error: `Enter a price for "${tier.name || "a price level"}" as dollars, at most two decimal places.` };
    const priceMax = tier.price_kind === "range" ? amount(tier.price_max) : null;
    if (tier.price_kind === "range" && priceMax === null) return { content: null, error: `Enter the upper amount of "${tier.name}".` };
    const conditions = [];
    for (const key of numberKeys) {
      const entered = tier.conditions[key];
      if (!entered || (!entered.min.trim() && !entered.max.trim())) continue;
      const min = bound(entered.min); const max = bound(entered.max);
      if (Number.isNaN(min) || Number.isNaN(max)) return { content: null, error: `Rule bounds for "${tier.name}" must be numbers.` };
      conditions.push({ question_key: key, min, max });
    }
    tiers.push({ id: tier.id, name: tier.name.trim(), frequency: tier.frequency, price_kind: model.pricing_mode === "fixed" ? "exact" : tier.price_kind,
      price, price_max: priceMax, conditions, includes: splitList(tier.includes, /,/) });
  }
  const addons: ContentAddon[] = [];
  for (const addon of model.addons) {
    const price = amount(addon.price);
    if (price === null) return { content: null, error: `Enter a price for the add-on "${addon.name || "add-on"}".` };
    const priceMax = addon.price_kind === "range" ? amount(addon.price_max) : null;
    if (addon.price_kind === "range" && priceMax === null) return { content: null, error: `Enter the upper amount of the add-on "${addon.name}".` };
    addons.push({ id: addon.id, name: addon.name.trim(), description: addon.description.trim() || null, price_kind: addon.price_kind,
      price, price_max: priceMax, unit_label: addon.unit_label.trim() || null,
      min_quantity: quantity(addon.min_quantity, addon.is_required ? 1 : 0), max_quantity: quantity(addon.max_quantity, 1),
      is_required: addon.is_required, frequencies: addon.frequencies });
  }
  const deposit = model.pricing_mode === "deposit_quote" ? amount(model.deposit) : null;
  if (model.pricing_mode === "deposit_quote" && deposit === null) return { content: null, error: "Enter the deposit as dollars, at most two decimal places." };
  return { error: null, content: {
    name: model.name.trim(), description: model.description.trim() || null, pricing_mode: model.pricing_mode, deposit_amount: deposit,
    included_scope: splitList(model.included, /\n/), policy_notes: model.policy_notes.trim() || null,
    questions: model.questions.map((q) => ({ question_key: q.question_key.trim(), question_label: q.question_label.trim(), input_type: q.input_type,
      unit: q.unit.trim() || null, options: q.input_type === "select" ? splitList(q.options, /,/) : null, is_required: q.is_required })),
    tiers, addons,
  } };
}

/** Start or edit a draft package. `vendors` lets the operator choose the vendor of a new draft. */
export function PackageContentEditor({ draft, contractorId, vendors, services, onSaved }: {
  draft?: PackageDraft;
  contractorId?: string;
  vendors?: DraftVendor[];
  services: DraftService[];
  onSaved: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [vendor, setVendor] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [target, setTarget] = useState("");
  const [model, setModel] = useState<Model>(blankModel());
  const [packages, setPackages] = useState<VendorPackageOption[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const key = draft?.id ?? "new";
  const fixedVendor = draft?.contractorId ?? contractorId;
  const service = services.find((item) => item.id === serviceId);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  useEffect(() => {
    if (!open || !vendor || !serviceId) return;
    let active = true;
    void createClient().from("vendor_packages").select("id, name, is_active, lineage_id, revision_number")
      .eq("contractor_id", vendor).eq("service_id", serviceId).order("name").then(({ data }) => {
        if (active) setPackages(((data ?? []) as VendorPackageOption[]).filter((item) => item.is_active));
      });
    return () => { active = false; };
  }, [open, vendor, serviceId]);

  function reset() {
    setVendor(fixedVendor ?? "");
    setServiceId(draft?.serviceId ?? "");
    setTarget(draft?.targetPackageId ?? "");
    setModel(draft ? modelFromContent(draft.content) : blankModel());
    setError("");
  }

  const update = (patch: Partial<Model>) => setModel((current) => ({ ...current, ...patch }));
  const built = useMemo(() => contentFromModel(model), [model]);

  async function save() {
    if (pending) return;
    if (!vendor) { setError("Choose the vendor this package is for."); return; }
    if (!service) { setError("Choose a catalog service."); return; }
    if (!model.name.trim()) { setError("Enter the package name homeowners will see."); return; }
    if (!built.content) { setError(built.error); return; }
    setError("");
    setPending(true);
    const { error: rpcError } = await createClient().rpc("admin_save_package_draft_content", {
      p_draft: draft?.id ?? null, p_expected_updated_at: draft?.updatedAt ?? null, p_contractor: vendor,
      p_service: service.id, p_target_package: target || null, p_content: built.content,
    });
    setPending(false);
    if (rpcError) { setError(draftErrorMessage(rpcError)); return; }
    setOpen(false);
    toast.success(draft ? "Draft updated" : "Draft saved", {
      description: draft?.approvalState && draft.approvalState !== "draft"
        ? "If anything changed, the vendor must approve this version again before it can be published."
        : "It stays private until the vendor approves it and you publish it.",
    });
    await onSaved();
  }

  return <Dialog open={open} onOpenChange={(next) => { if (pending) return; setOpen(next); if (next) reset(); }}>
    <DialogTrigger render={<Button variant={draft ? "outline" : "commitment"} className="min-h-10" />}>
      {draft ? "Edit package" : <><Layers />Build a package</>}
    </DialogTrigger>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle>{draft ? "Edit draft package" : "Build a package for a vendor"}</DialogTitle>
        <DialogDescription>A private draft. The vendor approves this exact version before you can publish it; any later change needs approval again.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="sr-only">Vendor and service</legend>
            {fixedVendor
              ? <p className="text-sm sm:col-span-2"><span className="text-muted-foreground">Vendor: </span>{draft?.contractorName ?? vendors?.find((item) => item.id === fixedVendor)?.name}</p>
              : <FormField id={`content-vendor-${key}`} label="Vendor" required>
                {(control) => <Select {...control} value={vendor} disabled={pending} onChange={(event) => { setVendor(event.target.value); setTarget(""); }}>
                  <option value="">Choose a vendor</option>
                  {(vendors ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </Select>}
              </FormField>}
            <FormField id={`content-service-${key}`} label="Service" required>
              {(control) => <Select {...control} value={serviceId} disabled={pending} onChange={(event) => {
                const next = services.find((item) => item.id === event.target.value);
                if (next && !model.name.trim()) update({ name: next.name });
                setServiceId(event.target.value);
                setTarget("");
              }}>
                <option value="">Choose a service</option>
                {services.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>}
            </FormField>
            <FormField id={`content-target-${key}`} label="Replaces" help="Optional. Publishing creates the next version of that package and pauses the current one; earlier bookings keep their version.">
              {(control) => <Select {...control} value={target} disabled={pending || !vendor || !serviceId} onChange={(event) => setTarget(event.target.value)}>
                <option value="">A new package</option>
                {packages.map((item) => <option key={item.id} value={item.id}>{item.name} (version {item.revision_number})</option>)}
              </Select>}
            </FormField>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Package</legend>
            <FormField id={`content-name-${key}`} label="Package name" required help="Homeowners see this name. Two active packages of a vendor and service cannot share a name.">
              {(control) => <Input {...control} value={model.name} maxLength={DRAFT_NAME_MAX} disabled={pending} onChange={(event) => update({ name: event.target.value })} />}
            </FormField>
            <FormField id={`content-mode-${key}`} label="Price type" help={PRICING_MODES.find((mode) => mode.value === model.pricing_mode)?.help}>
              {(control) => <Select {...control} value={model.pricing_mode} disabled={pending} onChange={(event) => update({ pricing_mode: event.target.value as PricingMode })}>
                {PRICING_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
              </Select>}
            </FormField>
            {model.pricing_mode === "deposit_quote" && <FormField id={`content-deposit-${key}`} label="Deposit" required help="Applied toward the final price; not an extra fee.">
              {(control) => <Input {...control} inputMode="decimal" value={model.deposit} disabled={pending} onChange={(event) => update({ deposit: event.target.value })} />}
            </FormField>}
            <div className="sm:col-span-2"><FormField id={`content-description-${key}`} label="Description" help="Optional. What the package is.">
              {(control) => <Textarea {...control} value={model.description} maxLength={DRAFT_DESCRIPTION_MAX} disabled={pending} onChange={(event) => update({ description: event.target.value })} />}
            </FormField></div>
            <FormField id={`content-included-${key}`} label="Included in every visit" help="One item per line. An add-on cannot charge for an included item.">
              {(control) => <Textarea {...control} value={model.included} disabled={pending} onChange={(event) => update({ included: event.target.value })} />}
            </FormField>
            <FormField id={`content-notes-${key}`} label="Provider notes" help="Shown with the package for information. Mercurius booking terms still apply; notes are not enforced.">
              {(control) => <Textarea {...control} value={model.policy_notes} maxLength={2000} disabled={pending} onChange={(event) => update({ policy_notes: event.target.value })} />}
            </FormField>
          </fieldset>

          <QuestionsEditor model={model} disabled={pending} keyPrefix={key} onChange={update} />
          <TiersEditor model={model} offered={service?.offered ?? []} disabled={pending} keyPrefix={key} onChange={update} />
          <AddonsEditor model={model} disabled={pending} keyPrefix={key} onChange={update} />
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-destructive">{error}</p>}
          <p role="status" className="sr-only">{pending ? "Saving draft…" : ""}</p>
        </div>
        <HomeownerPreview serviceId={service?.id ?? null} content={built.content} buildError={built.error} />
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="commitment" loading={pending} onClick={() => void save()}>{pending ? "Saving…" : "Save draft"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function SectionHeader({ title, help, action }: { title: string; help: string; action: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-2"><div><legend className="text-sm font-semibold">{title}</legend><p className="text-sm text-muted-foreground">{help}</p></div>{action}</div>;
}

function QuestionsEditor({ model, disabled, keyPrefix, onChange }: { model: Model; disabled: boolean; keyPrefix: string; onChange: (patch: Partial<Model>) => void }) {
  const set = (index: number, patch: Partial<QuestionInput>) => onChange({ questions: model.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)) });
  return <fieldset className="space-y-3">
    <SectionHeader title="Questions" help="Asked before pricing. Number questions can set the price level."
      action={<Button variant="outline" size="sm" disabled={disabled || model.questions.length >= 10} onClick={() => onChange({ questions: [...model.questions,
        { question_key: `q${model.questions.length + 1}`, question_label: "", input_type: "number", unit: "", options: "", is_required: true }] })}><Plus />Add question</Button>} />
    {model.questions.map((q, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_8rem_6rem_auto]">
      <FormField id={`${keyPrefix}-q-${index}-label`} label="Question">{(c) => <Input {...c} value={q.question_label} disabled={disabled} onChange={(e) => set(index, { question_label: e.target.value })} />}</FormField>
      <FormField id={`${keyPrefix}-q-${index}-type`} label="Answer">{(c) => <Select {...c} value={q.input_type} disabled={disabled} onChange={(e) => set(index, { input_type: e.target.value as QuestionInput["input_type"] })}>
        <option value="number">Number</option><option value="select">Choice</option><option value="text">Text</option></Select>}</FormField>
      <FormField id={`${keyPrefix}-q-${index}-unit`} label="Unit">{(c) => <Input {...c} value={q.unit} placeholder="sq ft" disabled={disabled} onChange={(e) => set(index, { unit: e.target.value })} />}</FormField>
      <Button variant="ghost" size="icon" className="self-end" aria-label={`Remove question ${q.question_label || index + 1}`} disabled={disabled}
        onClick={() => onChange({ questions: model.questions.filter((_, i) => i !== index) })}><Trash2 /></Button>
      <FormField id={`${keyPrefix}-q-${index}-key`} label="Key" help="Used by rules; letters, numbers, - or _.">{(c) => <Input {...c} value={q.question_key} disabled={disabled} onChange={(e) => set(index, { question_key: e.target.value })} />}</FormField>
      {q.input_type === "select" && <FormField id={`${keyPrefix}-q-${index}-options`} label="Choices" help="Comma separated.">{(c) => <Input {...c} value={q.options} disabled={disabled} onChange={(e) => set(index, { options: e.target.value })} />}</FormField>}
      <Checkbox label="Required" checked={q.is_required} disabled={disabled} onChange={(e) => set(index, { is_required: e.target.checked })} />
    </div>)}
  </fieldset>;
}

function TiersEditor({ model, offered, disabled, keyPrefix, onChange }: { model: Model; offered: PricingFrequency[]; disabled: boolean; keyPrefix: string; onChange: (patch: Partial<Model>) => void }) {
  const numberQuestions = model.questions.filter((q) => q.input_type === "number" && q.question_key.trim());
  const set = (index: number, patch: Partial<TierInput>) => onChange({ tiers: model.tiers.map((t, i) => (i === index ? { ...t, ...patch } : t)) });
  const kinds = model.pricing_mode === "fixed" ? PRICE_KINDS.filter((kind) => kind.value === "exact") : PRICE_KINDS.filter((kind) => kind.value !== "exact");
  return <fieldset className="space-y-3">
    <SectionHeader title="Price levels"
      help={model.pricing_mode === "fixed"
        ? "Exact prices per cadence. Give every level of a cadence a rule (bounds are inclusive and must not overlap), or none so the homeowner chooses."
        : "Estimates only: starting at or a range. With no level, the package shows quote after walkthrough."}
      action={<Button variant="outline" size="sm" disabled={disabled || !offered.length || model.tiers.length >= 24} onClick={() => onChange({ tiers: [...model.tiers, {
        id: newContentId("level", model.tiers.map((t) => t.id)), name: "", frequency: offered[0], price_kind: model.pricing_mode === "fixed" ? "exact" : "range",
        price: "", price_max: "", conditions: {}, includes: "" }] })}><Plus />Add price level</Button>} />
    {!offered.length && <p className="text-sm text-muted-foreground">Choose a service to add price levels.</p>}
    {model.tiers.map((tier, index) => <div key={tier.id} className="space-y-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_9rem_auto]">
        <FormField id={`${keyPrefix}-t-${index}-name`} label="Level name">{(c) => <Input {...c} value={tier.name} placeholder="Up to 1,500 sq ft" disabled={disabled} onChange={(e) => set(index, { name: e.target.value })} />}</FormField>
        <FormField id={`${keyPrefix}-t-${index}-cadence`} label="Cadence">{(c) => <Select {...c} value={tier.frequency} disabled={disabled} onChange={(e) => set(index, { frequency: e.target.value as PricingFrequency })}>
          {offered.map((frequency) => <option key={frequency} value={frequency}>{frequencyLabel(frequency)}</option>)}</Select>}</FormField>
        <FormField id={`${keyPrefix}-t-${index}-kind`} label="Meaning">{(c) => <Select {...c} value={model.pricing_mode === "fixed" ? "exact" : tier.price_kind} disabled={disabled || model.pricing_mode === "fixed"} onChange={(e) => set(index, { price_kind: e.target.value as PriceKind })}>
          {kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</Select>}</FormField>
        <Button variant="ghost" size="icon" className="self-end" aria-label={`Remove price level ${tier.name || index + 1}`} disabled={disabled}
          onClick={() => onChange({ tiers: model.tiers.filter((_, i) => i !== index) })}><Trash2 /></Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id={`${keyPrefix}-t-${index}-price`} label={tier.price_kind === "range" && model.pricing_mode !== "fixed" ? "From" : "Price"} required>{(c) => <Input {...c} inputMode="decimal" value={tier.price} disabled={disabled} onChange={(e) => set(index, { price: e.target.value })} />}</FormField>
        {tier.price_kind === "range" && model.pricing_mode !== "fixed" && <FormField id={`${keyPrefix}-t-${index}-max`} label="To" required>{(c) => <Input {...c} inputMode="decimal" value={tier.price_max} disabled={disabled} onChange={(e) => set(index, { price_max: e.target.value })} />}</FormField>}
        <FormField id={`${keyPrefix}-t-${index}-includes`} label="This level includes" help="Comma separated.">{(c) => <Input {...c} value={tier.includes} disabled={disabled} onChange={(e) => set(index, { includes: e.target.value })} />}</FormField>
      </div>
      {numberQuestions.length > 0 && <div className="space-y-2"><p className="text-sm font-medium">Rule (optional, bounds inclusive)</p>
        <div className="grid gap-3 sm:grid-cols-2">{numberQuestions.map((q) => {
          const condition = tier.conditions[q.question_key] ?? { min: "", max: "" };
          const setCondition = (patch: Partial<ConditionInput>) => set(index, { conditions: { ...tier.conditions, [q.question_key]: { ...condition, ...patch } } });
          return <div key={q.question_key} className="grid grid-cols-2 gap-2">
            <FormField id={`${keyPrefix}-t-${index}-${q.question_key}-min`} label={`${q.question_label || q.question_key} from`}>{(c) => <Input {...c} inputMode="decimal" value={condition.min} disabled={disabled} onChange={(e) => setCondition({ min: e.target.value })} />}</FormField>
            <FormField id={`${keyPrefix}-t-${index}-${q.question_key}-max`} label="to">{(c) => <Input {...c} inputMode="decimal" value={condition.max} disabled={disabled} onChange={(e) => setCondition({ max: e.target.value })} />}</FormField>
          </div>;
        })}</div></div>}
    </div>)}
  </fieldset>;
}

function AddonsEditor({ model, disabled, keyPrefix, onChange }: { model: Model; disabled: boolean; keyPrefix: string; onChange: (patch: Partial<Model>) => void }) {
  const cadences = [...new Set(model.tiers.map((tier) => tier.frequency))];
  const set = (index: number, patch: Partial<AddonInput>) => onChange({ addons: model.addons.map((a, i) => (i === index ? { ...a, ...patch } : a)) });
  return <fieldset className="space-y-3">
    <SectionHeader title="Add-ons" help="Priced per unit. A required add-on is always included; a range add-on makes the total an estimate."
      action={<Button variant="outline" size="sm" disabled={disabled || model.addons.length >= 20} onClick={() => onChange({ addons: [...model.addons, {
        id: newContentId("addon", model.addons.map((a) => a.id)), name: "", description: "", price_kind: "exact", price: "", price_max: "",
        unit_label: "", min_quantity: "0", max_quantity: "1", is_required: false, frequencies: [] }] })}><Plus />Add add-on</Button>} />
    {model.addons.map((addon, index) => <div key={addon.id} className="space-y-3 rounded-lg border p-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_8rem_auto]">
        <FormField id={`${keyPrefix}-a-${index}-name`} label="Add-on name">{(c) => <Input {...c} value={addon.name} placeholder="Extra can" disabled={disabled} onChange={(e) => set(index, { name: e.target.value })} />}</FormField>
        <FormField id={`${keyPrefix}-a-${index}-kind`} label="Price">{(c) => <Select {...c} value={addon.price_kind} disabled={disabled} onChange={(e) => set(index, { price_kind: e.target.value as AddonInput["price_kind"] })}>
          <option value="exact">Exact</option><option value="range">Range</option></Select>}</FormField>
        <FormField id={`${keyPrefix}-a-${index}-unit`} label="Per">{(c) => <Input {...c} value={addon.unit_label} placeholder="can" disabled={disabled} onChange={(e) => set(index, { unit_label: e.target.value })} />}</FormField>
        <Button variant="ghost" size="icon" className="self-end" aria-label={`Remove add-on ${addon.name || index + 1}`} disabled={disabled}
          onClick={() => onChange({ addons: model.addons.filter((_, i) => i !== index) })}><Trash2 /></Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <FormField id={`${keyPrefix}-a-${index}-price`} label={addon.price_kind === "range" ? "From" : "Amount"} required>{(c) => <Input {...c} inputMode="decimal" value={addon.price} disabled={disabled} onChange={(e) => set(index, { price: e.target.value })} />}</FormField>
        {addon.price_kind === "range" && <FormField id={`${keyPrefix}-a-${index}-max`} label="To" required>{(c) => <Input {...c} inputMode="decimal" value={addon.price_max} disabled={disabled} onChange={(e) => set(index, { price_max: e.target.value })} />}</FormField>}
        <FormField id={`${keyPrefix}-a-${index}-min`} label="Minimum">{(c) => <Input {...c} inputMode="numeric" value={addon.min_quantity} disabled={disabled} onChange={(e) => set(index, { min_quantity: e.target.value })} />}</FormField>
        <FormField id={`${keyPrefix}-a-${index}-maxq`} label="Maximum">{(c) => <Input {...c} inputMode="numeric" value={addon.max_quantity} disabled={disabled} onChange={(e) => set(index, { max_quantity: e.target.value })} />}</FormField>
      </div>
      <FormField id={`${keyPrefix}-a-${index}-description`} label="Description">{(c) => <Input {...c} value={addon.description} maxLength={160} disabled={disabled} onChange={(e) => set(index, { description: e.target.value })} />}</FormField>
      <div className="flex flex-wrap gap-x-6">
        <Checkbox label="Required" checked={addon.is_required} disabled={disabled} onChange={(e) => set(index, { is_required: e.target.checked, min_quantity: e.target.checked && addon.min_quantity === "0" ? "1" : addon.min_quantity })} />
        {cadences.length > 1 && cadences.map((frequency) => <Checkbox key={frequency} label={`Only ${frequencyLabel(frequency).toLowerCase()}`} checked={addon.frequencies.includes(frequency)} disabled={disabled}
          onChange={(e) => set(index, { frequencies: e.target.checked ? [...addon.frequencies, frequency] : addon.frequencies.filter((f) => f !== frequency) })} />)}
      </div>
    </div>)}
  </fieldset>;
}

/** The homeowner's view of the unsaved content, priced by the server's calculation. */
function HomeownerPreview({ serviceId, content, buildError }: { serviceId: string | null; content: PackageContent | null; buildError: string | null }) {
  const cadences = useMemo(() => [...new Set((content?.tiers ?? []).map((tier) => tier.frequency))], [content]);
  const [frequency, setFrequency] = useState<PricingFrequency | "">("");
  const [tierId, setTierId] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [result, setResult] = useState<PriceResult | null>(null);
  const [message, setMessage] = useState("");
  const cadence = frequency && cadences.includes(frequency) ? frequency : cadences[0] ?? "one-time";
  const options = useMemo(() => (content?.tiers ?? []).filter((tier) => tier.frequency === cadence && !tier.conditions.length), [content, cadence]);
  const addons = useMemo(() => (content?.addons ?? []).filter((addon) => !addon.frequencies.length || addon.frequencies.includes(cadence)), [content, cadence]);

  useEffect(() => {
    if (!serviceId || !content) return;
    let active = true;
    const timer = window.setTimeout(() => {
      const selected = addons.flatMap((addon) => {
        const entered = quantities[addon.id];
        return entered !== undefined && entered !== "" && Number.isInteger(Number(entered)) ? [{ id: addon.id, quantity: Number(entered) }] : [];
      });
      void createClient().rpc("pricing_preview_content", {
        p_service: serviceId, p_content: content, p_frequency: cadence, p_tier: options.length > 1 ? tierId : "",
        p_answers: answers, p_addons: selected,
      }).then(({ data, error }) => {
        if (!active) return;
        if (error) { setResult(null); setMessage(error.message); return; }
        setMessage("");
        setResult(parsePriceResult(data));
      });
    }, 400);
    return () => { active = false; window.clearTimeout(timer); };
  }, [serviceId, content, cadence, tierId, answers, quantities, addons, options.length]);

  return <aside aria-label="Homeowner preview" className="space-y-3 self-start rounded-xl border bg-muted/20 p-4 lg:sticky lg:top-0">
    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">Homeowner preview</h3><Badge variant="outline">Draft, not approved</Badge></div>
    <p className="text-xs text-muted-foreground">What a homeowner would see for these answers. Not live, not bookable.</p>
    {!serviceId ? <p className="text-sm text-muted-foreground">Choose a service to preview.</p> : buildError && !content ? <p className="text-sm text-muted-foreground">{buildError}</p> : <>
      {cadences.length > 1 && <FormField id="preview-cadence" label="Cadence">{(c) => <Select {...c} value={cadence} onChange={(e) => setFrequency(e.target.value as PricingFrequency)}>
        {cadences.map((item) => <option key={item} value={item}>{frequencyLabel(item)}</option>)}</Select>}</FormField>}
      {options.length > 1 && <FormField id="preview-tier" label="Price level">{(c) => <Select {...c} value={tierId} onChange={(e) => setTierId(e.target.value)}>
        <option value="">Not chosen</option>{options.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}</Select>}</FormField>}
      {(content?.questions ?? []).map((q) => <FormField key={q.question_key} id={`preview-${q.question_key}`} label={q.question_label || q.question_key}>
        {(c) => q.input_type === "select"
          ? <Select {...c} value={answers[q.question_key] ?? ""} onChange={(e) => setAnswers((current) => ({ ...current, [q.question_key]: e.target.value }))}><option value="">No answer</option>{(q.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</Select>
          : <Input {...c} inputMode={q.input_type === "number" ? "decimal" : undefined} value={answers[q.question_key] ?? ""} onChange={(e) => setAnswers((current) => ({ ...current, [q.question_key]: e.target.value }))} />}
      </FormField>)}
      {addons.filter((addon) => !addon.is_required || addon.max_quantity > addon.min_quantity).map((addon) => <FormField key={addon.id} id={`preview-addon-${addon.id}`}
        label={`${addon.name || "Add-on"}${addon.unit_label ? ` (${addon.unit_label}s)` : ""}`}>
        {(c) => <Input {...c} inputMode="numeric" placeholder={addon.is_required ? String(addon.min_quantity) : "0"} value={quantities[addon.id] ?? ""}
          onChange={(e) => setQuantities((current) => ({ ...current, [addon.id]: e.target.value }))} />}
      </FormField>)}
      <div role="status" aria-live="polite" className="space-y-2 border-t pt-3">
        {message ? <p className="text-sm text-destructive">{message}</p> : result ? <>
          <p className="font-medium">{priceResultLabel(result)}</p>
          {result.lines.length > 0 && <dl className="space-y-1 text-sm">{result.lines.map((line, index) => <div key={index} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{lineLabel(line)}</dt><dd className="tabular-nums">{lineAmountLabel(line)}</dd></div>)}</dl>}
          {result.depositCents != null && <p className="text-xs text-muted-foreground">Deposit toward the final price applies after the quote.</p>}
        </> : <p className="text-sm text-muted-foreground">Calculating…</p>}
      </div>
    </>}
  </aside>;
}
