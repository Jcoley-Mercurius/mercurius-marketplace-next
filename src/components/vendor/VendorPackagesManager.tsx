"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  DollarSign,
  ExternalLink,
  Loader2,
  Package,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/AuthProvider";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PricingToggle } from "@/components/vendor/PricingToggle";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type ServiceOption = { id: string; name: string };
type QuestionRow = {
  id?: string;
  question_key: string;
  question_label: string;
  input_type: "number" | "select" | "text";
  unit?: string | null;
  sort_order: number;
};
type TierRow = {
  id?: string;
  name: string;
  price: number;
  rule_question_key?: string | null;
  rule_min?: number | null;
  rule_max?: number | null;
  includes: string[];
  sort_order: number;
};
type PackageRow = {
  id: string;
  name: string;
  description: string | null;
  service_id: string;
  pricing_mode: "fixed" | "deposit_quote" | "custom_quote";
  default_frequency: string;
  deposit_amount: number | null;
  is_active: boolean;
  template_id?: string | null;
  tiers: TierRow[];
  questions: QuestionRow[];
};

const FREQUENCIES: Record<string, string> = {
  "one-time": "One-time",
  weekly: "Weekly",
  "bi-monthly": "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

const nativeSelect = "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const slugKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "size";
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function VendorPackagesManager() {
  const { user } = useAuth();
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [profileServices, setProfileServices] = useState<string[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PackageRow | null>(null);
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [customerPrice, setCustomerPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [liveSuccessOpen, setLiveSuccessOpen] = useState(false);

  const refresh = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data: packageData, error: packageError } = await supabase
      .from("vendor_packages")
      .select("*")
      .eq("contractor_id", id)
      .is("template_id", null)
      .order("sort_order");
    if (packageError) throw packageError;
    const rows = (packageData ?? []) as PackageRow[];
    if (!rows.length) {
      setPackages([]);
      return;
    }
    const ids = rows.map((item) => item.id);
    const [questionsResult, tiersResult] = await Promise.all([
      supabase.from("package_qualifying_questions").select("*").in("package_id", ids).order("sort_order"),
      supabase.from("package_tiers").select("*").in("package_id", ids).order("sort_order"),
    ]);
    if (questionsResult.error) throw questionsResult.error;
    if (tiersResult.error) throw tiersResult.error;
    const questions = (questionsResult.data ?? []) as (QuestionRow & { package_id: string })[];
    const tiers = (tiersResult.data ?? []) as (TierRow & { package_id: string })[];
    setPackages(rows.map((item) => ({
      ...item,
      questions: questions.filter((question) => question.package_id === item.id),
      tiers: tiers.filter((tier) => tier.package_id === item.id),
    })));
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const supabase = createClient();
    void (async () => {
      setLoading(true);
      setLoadError(null);
      const [contractorResult, serviceResult] = await Promise.all([
        supabase.from("contractors").select("id, services").eq("user_id", user.id).maybeSingle(),
        supabase.from("services_catalog").select("id, name").eq("is_active", true).order("name"),
      ]);
      if (!active) return;
      if (contractorResult.error || serviceResult.error) {
        setLoadError(contractorResult.error?.message ?? serviceResult.error?.message ?? "Pricing could not be loaded.");
        setLoading(false);
        return;
      }
      setServices((serviceResult.data ?? []) as ServiceOption[]);
      const contractor = contractorResult.data as { id: string; services?: string[] | null } | null;
      if (contractor?.id) {
        setContractorId(contractor.id);
        setProfileServices((contractor.services ?? []).filter(Boolean));
        try { await refresh(contractor.id); } catch (error) {
          if (active) setLoadError(error instanceof Error ? error.message : "Pricing could not be loaded.");
        }
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [refresh, user]);

  const closeEditor = () => {
    setOpen(false);
    setEditing(null);
    setAdvancedOpen(false);
    setCustomerPrice("");
    setSaving(false);
  };

  const openEditor = (item: PackageRow) => {
    const minimum = item.tiers.length ? Math.min(...item.tiers.map((tier) => Number(tier.price) || 0)) : 0;
    setEditing(structuredClone(item));
    setCustomerPrice(minimum > 0 ? String(minimum) : "");
    setAdvancedOpen(false);
    setOpen(true);
  };

  const newPackage = (serviceId?: string) => openEditor({
    id: "",
    name: "",
    description: null,
    service_id: serviceId ?? services[0]?.id ?? "",
    pricing_mode: "fixed",
    default_frequency: "one-time",
    deposit_amount: null,
    is_active: true,
    tiers: [],
    questions: [],
  });

  const updateField = <K extends keyof PackageRow>(key: K, value: PackageRow[K]) => {
    setEditing((current) => current ? { ...current, [key]: value } : current);
  };

  const enterAdvanced = () => {
    setAdvancedOpen(true);
    setEditing((current) => {
      if (!current || current.tiers.length > 1 || current.questions.length) return current;
      const price = Number(customerPrice) || current.tiers[0]?.price || 0;
      return {
        ...current,
        questions: [{ question_key: "size", question_label: "", input_type: "number", unit: "", sort_order: 0 }],
        tiers: [{ name: "Standard", price, rule_question_key: "size", rule_min: 0, rule_max: 100, includes: [], sort_order: 0 }],
      };
    });
  };

  const savePackage = async () => {
    if (!editing || !contractorId || saving) return;
    const name = editing.name.trim();
    if (!name || !editing.service_id) {
      toast.error("Name and service are required.");
      return;
    }
    let questions: QuestionRow[] = [];
    let tiers: TierRow[] = [];
    if (advancedOpen) {
      if (!editing.tiers.length || editing.tiers.some((tier) => !tier.name.trim() || tier.price <= 0)) {
        toast.error("Every price level needs a name and a price greater than $0.");
        return;
      }
      const question = editing.questions[0];
      if (!question?.question_label.trim()) {
        toast.error("Add the customer question used to choose a price level.");
        return;
      }
      questions = [{ ...question, question_key: slugKey(question.question_label), sort_order: 0 }];
      tiers = editing.tiers.map((tier, index) => ({ ...tier, rule_question_key: questions[0].question_key, sort_order: index }));
    } else {
      const price = Number(customerPrice);
      if (!Number.isFinite(price) || price <= 0) {
        toast.error("Enter a customer price greater than $0.");
        return;
      }
      tiers = [{ name: "Standard", price, rule_question_key: null, rule_min: null, rule_max: null, includes: [], sort_order: 0 }];
    }

    setSaving(true);
    const supabase = createClient();
    let packageId = editing.id;
    const payload = {
      name,
      description: editing.description || null,
      service_id: editing.service_id,
      pricing_mode: "fixed",
      default_frequency: editing.default_frequency,
      deposit_amount: null,
      is_active: false,
      needs_review: false,
    };
    try {
      if (!packageId) {
        const result = await supabase.from("vendor_packages").insert({ contractor_id: contractorId, ...payload }).select("id").single();
        if (result.error || !result.data) throw result.error ?? new Error("The price record was not created.");
        packageId = (result.data as { id: string }).id;
      } else {
        const result = await supabase.from("vendor_packages").update(payload).eq("id", packageId).eq("contractor_id", contractorId);
        if (result.error) throw result.error;
      }
      const clearQuestions = await supabase.from("package_qualifying_questions").delete().eq("package_id", packageId);
      if (clearQuestions.error) throw clearQuestions.error;
      const clearTiers = await supabase.from("package_tiers").delete().eq("package_id", packageId);
      if (clearTiers.error) throw clearTiers.error;
      if (questions.length) {
        const result = await supabase.from("package_qualifying_questions").insert(questions.map((question) => ({
          package_id: packageId,
          question_key: question.question_key,
          question_label: question.question_label,
          input_type: question.input_type,
          unit: question.unit || null,
          sort_order: question.sort_order,
        })));
        if (result.error) throw result.error;
      }
      const tierResult = await supabase.from("package_tiers").insert(tiers.map((tier) => ({
        package_id: packageId,
        name: tier.name,
        price: tier.price,
        rule_question_key: tier.rule_question_key || null,
        rule_min: tier.rule_min ?? null,
        rule_max: tier.rule_max ?? null,
        includes: tier.includes,
        sort_order: tier.sort_order,
      })));
      if (tierResult.error) throw tierResult.error;
      const publishResult = await supabase.from("vendor_packages").update({ is_active: editing.is_active }).eq("id", packageId).eq("contractor_id", contractorId);
      if (publishResult.error) throw publishResult.error;
      const live = editing.is_active;
      closeEditor();
      await refresh(contractorId);
      if (live) setLiveSuccessOpen(true);
      else toast.success("Saved as hidden", { description: "Turn Live on when you are ready for customers to book." });
    } catch (error) {
      setSaving(false);
      toast.error("Couldn’t save this price", { description: `${error instanceof Error ? error.message : "Please try again."} Verify the package’s Live setting before retrying.` });
    }
  };

  const togglePackage = async (item: PackageRow) => {
    if (!contractorId) return;
    setMutatingId(item.id);
    const supabase = createClient();
    const result = await supabase.from("vendor_packages").update({ is_active: !item.is_active }).eq("id", item.id).eq("contractor_id", contractorId);
    setMutatingId(null);
    if (result.error) toast.error("Couldn’t update availability", { description: result.error.message });
    else await refresh(contractorId);
  };

  const deletePackage = async (item: PackageRow) => {
    if (!contractorId || !window.confirm(`Delete “${item.name}”? This cannot be undone.`)) return;
    setMutatingId(item.id);
    const supabase = createClient();
    const result = await supabase.from("vendor_packages").delete().eq("id", item.id).eq("contractor_id", contractorId);
    setMutatingId(null);
    if (result.error) toast.error("Couldn’t delete this price", { description: result.error.message });
    else { toast.success("Price deleted"); await refresh(contractorId); }
  };

  const unpricedServices = useMemo(() => {
    const priced = new Set(packages.flatMap((item) => {
      const service = services.find((candidate) => candidate.id === item.service_id);
      return [normalize(item.service_id), service ? normalize(service.name) : ""].filter(Boolean);
    }));
    return profileServices.filter((service) => !priced.has(normalize(service)));
  }, [packages, profileServices, services]);

  const serviceForProfileValue = (raw: string) => services.find((service) => normalize(service.id) === normalize(raw) || normalize(service.name) === normalize(raw));

  if (loading) return <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading pricing…</div>;
  if (loadError) return <div className="mx-auto max-w-3xl p-6"><div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center"><h2 className="font-semibold">Pricing couldn’t be loaded</h2><p className="mt-2 text-sm text-muted-foreground">{loadError}</p></div></div>;
  if (!contractorId) return <div className="mx-auto max-w-3xl p-6"><div className="rounded-xl border bg-card p-8 text-center"><h2 className="font-semibold">Vendor profile not linked</h2><p className="mt-2 text-sm text-muted-foreground">Your account does not have a linked contractor record yet. Contact Mercurius support before publishing prices.</p></div></div>;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Package className="h-6 w-6 text-primary" />Your prices</h1>
          <p className="mt-1 text-sm text-muted-foreground">Set fixed prices customers can book online. Takes about a minute.</p>
        </div>
        <Button className="min-h-11 w-full sm:w-auto" onClick={() => newPackage()}><Plus />Add a price</Button>
      </div>

      {packages.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center sm:p-10">
          <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <h2 className="text-lg font-medium">No prices yet</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Add your first bookable price. Customers can only book fixed prices online right now.</p>
          <p className="mx-auto mt-3 max-w-md rounded-lg border bg-muted/50 px-3 py-2.5 text-sm">Example: <span className="font-medium">Standard lawn mow · $55 · Weekly</span></p>
          <Button className="mt-5 min-h-11" onClick={() => newPackage()}><Plus />Add a bookable price</Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {packages.map((item) => {
            const advanced = item.tiers.length > 1;
            const displayPrice = item.tiers.length ? Math.min(...item.tiers.map((tier) => Number(tier.price))) : null;
            return (
              <article key={item.id} className="rounded-xl border bg-card p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{item.name}</h2><Badge variant={item.is_active ? "secondary" : "outline"}>{item.is_active ? "Live" : "Hidden"}</Badge><Badge variant="outline">{FREQUENCIES[item.default_frequency] ?? item.default_frequency}</Badge></div>
                    <p className="mt-1 text-xs text-muted-foreground">{services.find((service) => service.id === item.service_id)?.name ?? "Service"}</p>
                  </div>
                  <PricingToggle checked={item.is_active} disabled={mutatingId === item.id} onCheckedChange={() => void togglePackage(item)} label={`${item.is_active ? "Hide" : "Publish"} ${item.name}`} />
                </div>
                {item.pricing_mode === "fixed" && displayPrice !== null ? (
                  <div className="mt-4">
                    {!advanced ? <p className="flex items-center text-2xl font-semibold"><DollarSign className="h-5 w-5" />{displayPrice}</p> : (
                      <div className="space-y-2"><p className="text-sm text-muted-foreground">From <span className="font-semibold text-foreground">${displayPrice}</span> · {item.tiers.length} price levels</p>{item.tiers.slice(0, 3).map((tier) => <div key={tier.id ?? tier.name} className="flex items-center justify-between rounded-lg border bg-background/50 px-3 py-2"><div><p className="text-sm font-medium">{tier.name}</p>{(tier.rule_min != null || tier.rule_max != null) && <p className="text-xs text-muted-foreground">{tier.rule_min}–{tier.rule_max} {item.questions[0]?.unit ?? ""}</p>}</div><p className="text-sm font-semibold text-primary">${tier.price}</p></div>)}</div>
                    )}
                  </div>
                ) : <p className="mt-4 text-sm text-muted-foreground">Not bookable online during launch — edit and publish a fixed price.</p>}
                <div className="mt-4 flex justify-end gap-1">
                  <Button variant="ghost" className="h-11 w-11" aria-label={`Duplicate ${item.name}`} onClick={() => openEditor({ ...structuredClone(item), id: "", name: `${item.name} (copy)` })}><Copy /></Button>
                  <Button variant="ghost" className="h-11 w-11" aria-label={`Edit ${item.name}`} onClick={() => openEditor(item)}><Pencil /></Button>
                  <Button variant="ghost" className="h-11 w-11" disabled={mutatingId === item.id} aria-label={`Delete ${item.name}`} onClick={() => void deletePackage(item)}><Trash2 className="text-destructive" /></Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {unpricedServices.length > 0 && <section className="space-y-3"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Not priced yet</h2><Badge variant="outline">{unpricedServices.length}</Badge></div><p className="text-sm text-muted-foreground">These services are on your profile but customers can’t book them online yet.</p><div className="grid gap-4 lg:grid-cols-2">{unpricedServices.map((raw) => { const service = serviceForProfileValue(raw); return <article key={raw} className="flex flex-col rounded-xl border border-dashed bg-muted/20 p-5"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{service?.name ?? raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}</h3><Badge variant="outline">Needs pricing</Badge></div><p className="mt-2 flex-1 text-sm text-muted-foreground">Add a fixed price so customers can book this service online.</p><Button variant="outline" className="mt-4 min-h-11 self-start" disabled={!service} onClick={() => newPackage(service?.id)}><Plus />Set pricing</Button></article>; })}</div></section>}

      <div className="flex flex-col gap-2 border-t pt-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><p>Need Mercurius-approved tiers and price guardrails?</p><Link href="/vendor/pricing" className={buttonVariants({ variant: "outline" })}>Open Managed Pricing</Link></div>

      <Dialog open={open} onOpenChange={(value) => { if (!value) closeEditor(); }}>
        <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto p-5 sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit price" : "Add a price"}</DialogTitle><DialogDescription>Publish a real customer-facing price for one of your services.</DialogDescription></DialogHeader>
          {editing && <div className="space-y-5">
            <div className="space-y-2"><Label htmlFor="package-name">What customers see</Label><Input id="package-name" className="h-11" placeholder="Standard lawn mow" value={editing.name} onChange={(event) => updateField("name", event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="package-service">Service</Label><select id="package-service" className={nativeSelect} value={editing.service_id} onChange={(event) => updateField("service_id", event.target.value)}><option value="" disabled>Choose a service</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></div>
            {!advancedOpen && <div className="space-y-2"><Label htmlFor="package-price">Price customers pay ($)</Label><Input id="package-price" className="h-12 text-lg" type="number" min="0" step="1" inputMode="decimal" placeholder="e.g. 80" value={customerPrice} onChange={(event) => setCustomerPrice(event.target.value)} /><p className="text-xs text-muted-foreground">This is the amount charged at checkout.</p>{editing.tiers.length > 1 && <p className="text-xs text-amber-700">Publishing here replaces the existing size-based levels with this single price. Expand advanced pricing below to keep and edit the levels.</p>}</div>}
            <div className="space-y-2"><Label htmlFor="package-frequency">How often this price applies</Label><select id="package-frequency" className={nativeSelect} value={editing.default_frequency} onChange={(event) => updateField("default_frequency", event.target.value)}>{Object.entries(FREQUENCIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
            <div className="flex items-center gap-2"><PricingToggle checked={editing.is_active} onCheckedChange={(checked) => updateField("is_active", checked)} label="Make this price live" /><span className="text-sm">Live — customers can book this</span></div>
            <div className="overflow-hidden rounded-lg border">
              <button type="button" onClick={() => { if (advancedOpen) { setCustomerPrice(String(editing.tiers[0]?.price || "")); setAdvancedOpen(false); } else enterAdvanced(); }} className="flex w-full items-center justify-between bg-muted/30 px-3 py-3 text-left text-sm hover:bg-muted/50" aria-expanded={advancedOpen}><span><span className="font-medium">Price depends on size or home details</span><span className="mt-0.5 block text-xs text-muted-foreground">Optional — for cleaning, lawn size, or similar.</span></span><ChevronDown className={cn("transition-transform", advancedOpen && "rotate-180")} /></button>
              {advancedOpen && <div className="space-y-5 border-t p-3">
                <div className="space-y-3"><Label className="text-base">Ask the customer</Label>{editing.questions.slice(0, 1).map((question, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2"><div className="space-y-1.5 sm:col-span-2"><Label className="text-xs text-muted-foreground">Question</Label><Input placeholder="How many bedrooms?" value={question.question_label} onChange={(event) => { const next = [...editing.questions]; const key = slugKey(event.target.value); next[index] = { ...next[index], question_label: event.target.value, question_key: key }; updateField("questions", next); updateField("tiers", editing.tiers.map((tier) => ({ ...tier, rule_question_key: key }))); }} /></div><div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Unit (optional)</Label><Input placeholder="bedrooms, sq ft…" value={question.unit ?? ""} onChange={(event) => { const next = [...editing.questions]; next[index] = { ...next[index], unit: event.target.value }; updateField("questions", next); }} /></div></div>)}</div>
                <div className="space-y-3"><div className="flex items-center justify-between"><Label className="text-base">Price levels</Label><Button type="button" variant="outline" size="sm" onClick={() => updateField("tiers", [...editing.tiers, { name: `Level ${editing.tiers.length + 1}`, price: 0, rule_question_key: editing.questions[0]?.question_key ?? "size", rule_min: 0, rule_max: 100, includes: [], sort_order: editing.tiers.length }])}><Plus />Add level</Button></div>
                  {editing.tiers.map((tier, index) => <div key={index} className="space-y-3 rounded-lg border p-3"><div className="grid gap-3 sm:grid-cols-2"><Field label="Level name"><Input className="h-11" placeholder="e.g. 3–4 bedrooms" value={tier.name} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], name: event.target.value }; updateField("tiers", next); }} /></Field><Field label="Price $"><Input className="h-11" type="number" min="0" value={tier.price || ""} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], price: Number(event.target.value) }; updateField("tiers", next); }} /></Field><Field label="From"><Input className="h-11" type="number" value={tier.rule_min ?? ""} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], rule_min: event.target.value ? Number(event.target.value) : null }; updateField("tiers", next); }} /></Field><Field label="To"><Input className="h-11" type="number" value={tier.rule_max ?? ""} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], rule_max: event.target.value ? Number(event.target.value) : null }; updateField("tiers", next); }} /></Field></div><div className="flex items-end gap-2"><Field label="What’s included (optional)" className="flex-1"><Input className="h-11" placeholder="Mow, edge, blow" value={tier.includes.join(", ")} onChange={(event) => { const next = [...editing.tiers]; next[index] = { ...next[index], includes: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) }; updateField("tiers", next); }} /></Field><Button type="button" variant="ghost" className="h-11 w-11" aria-label={`Remove ${tier.name || "level"}`} onClick={() => updateField("tiers", editing.tiers.filter((_, tierIndex) => tierIndex !== index))}><Trash2 className="text-destructive" /></Button></div></div>)}
                </div>
              </div>}
            </div>
          </div>}
          <DialogFooter><Button variant="ghost" className="min-h-11" onClick={closeEditor}>Cancel</Button><Button className="min-h-11" disabled={saving} onClick={() => void savePackage()}>{saving ? <><Loader2 className="animate-spin" />Publishing…</> : "Publish price"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={liveSuccessOpen} onOpenChange={setLiveSuccessOpen}><DialogContent className="max-w-md sm:max-w-md"><DialogHeader><div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15"><CheckCircle2 className="h-6 w-6 text-accent" /></div><DialogTitle className="text-center text-xl">Your price is live</DialogTitle><DialogDescription className="text-center">Customers can now see this fixed price in Mercurius pricing and use it while requesting service.</DialogDescription></DialogHeader><div className="flex flex-col gap-2 pt-2"><Link href="/providers" className={buttonVariants({ className: "min-h-11 w-full" })} onClick={() => setLiveSuccessOpen(false)}><ExternalLink />View provider directory</Link><Button variant="outline" className="min-h-11 w-full" onClick={() => { setLiveSuccessOpen(false); newPackage(); }}><Plus />Add another price</Button></div></DialogContent></Dialog>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return <div className={cn("space-y-1.5", className)}><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
