"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Package,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PricingToggle } from "@/components/vendor/PricingToggle";
import { createClient } from "@/lib/supabase/client";

type TemplateQuestion = {
  id: string;
  template_id: string;
  question_label: string;
  unit: string | null;
  sort_order: number;
};
type TemplateTier = {
  id: string;
  template_id: string;
  name: string;
  description: string | null;
  min_price: number;
  max_price: number;
  suggested_price: number | null;
  includes: string[];
  sort_order: number;
};
type TemplateAddon = {
  id: string;
  template_id: string;
  label: string;
  description: string | null;
  default_price: number;
  price_min: number;
  price_max: number;
  sort_order: number;
};
type PricingTemplate = {
  id: string;
  service_id: string;
  name: string;
  description: string | null;
  questions: TemplateQuestion[];
  tiers: TemplateTier[];
  addons: TemplateAddon[];
};
type ManagedPackage = {
  packageId: string;
  template: PricingTemplate;
  serviceName: string;
  tierPrices: Record<string, number>;
  addonPrices: Record<string, { price: number; isOffered: boolean }>;
  isActive: boolean;
  needsReview: boolean;
};
type AvailableTemplate = { template: PricingTemplate; serviceName: string };

export function ManagedPricingEditor({ contractorId }: { contractorId: string }) {
  const [managed, setManaged] = useState<ManagedPackage[]>([]);
  const [availableTemplates, setAvailableTemplates] = useState<AvailableTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [templatesResult, servicesResult, packagesResult] = await Promise.all([
      supabase.from("pricing_templates").select("*").eq("is_active", true).order("name"),
      supabase.from("services_catalog").select("id, name").eq("is_active", true),
      supabase.from("vendor_packages").select("*").eq("contractor_id", contractorId).not("template_id", "is", null),
    ]);
    const firstError = templatesResult.error ?? servicesResult.error ?? packagesResult.error;
    if (firstError) {
      setLoadError(firstError.message);
      setLoading(false);
      return;
    }
    const templates = (templatesResult.data ?? []) as Omit<PricingTemplate, "questions" | "tiers" | "addons">[];
    const templateIds = templates.map((template) => template.id);
    const [questionResult, tierResult, addonResult] = templateIds.length
      ? await Promise.all([
          supabase.from("pricing_template_questions").select("*").in("template_id", templateIds).order("sort_order"),
          supabase.from("pricing_template_tiers").select("*").in("template_id", templateIds).order("sort_order"),
          supabase.from("pricing_template_addons").select("*").in("template_id", templateIds).order("sort_order"),
        ])
      : [
          { data: [] as TemplateQuestion[], error: null },
          { data: [] as TemplateTier[], error: null },
          { data: [] as TemplateAddon[], error: null },
        ];
    const relatedError = questionResult.error ?? tierResult.error ?? addonResult.error;
    if (relatedError) {
      setLoadError(relatedError.message);
      setLoading(false);
      return;
    }
    const questions = (questionResult.data ?? []) as TemplateQuestion[];
    const tiers = (tierResult.data ?? []) as TemplateTier[];
    const addons = (addonResult.data ?? []) as TemplateAddon[];
    const fullTemplates: PricingTemplate[] = templates.map((template) => ({
      ...template,
      questions: questions.filter((question) => question.template_id === template.id),
      tiers: tiers.filter((tier) => tier.template_id === template.id),
      addons: addons.filter((addon) => addon.template_id === template.id),
    }));
    const serviceMap = new Map(((servicesResult.data ?? []) as { id: string; name: string }[]).map((service) => [service.id, service.name]));
    const packageRows = (packagesResult.data ?? []) as { id: string; template_id: string; is_active: boolean; needs_review: boolean }[];
    const packageIds = packageRows.map((item) => item.id);
    const [packageTierResult, packageAddonResult] = packageIds.length
      ? await Promise.all([
          supabase.from("package_tiers").select("package_id, template_tier_id, price").in("package_id", packageIds),
          supabase.from("package_addons").select("package_id, template_addon_id, price, is_offered").in("package_id", packageIds),
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    const packageError = packageTierResult.error ?? packageAddonResult.error;
    if (packageError) {
      setLoadError(packageError.message);
      setLoading(false);
      return;
    }
    const packageTiers = (packageTierResult.data ?? []) as { package_id: string; template_tier_id: string | null; price: number }[];
    const packageAddons = (packageAddonResult.data ?? []) as { package_id: string; template_addon_id: string; price: number; is_offered: boolean }[];
    const activeManaged: ManagedPackage[] = [];
    const available: AvailableTemplate[] = [];
    for (const template of fullTemplates) {
      const packageRow = packageRows.find((item) => item.template_id === template.id);
      const serviceName = serviceMap.get(template.service_id) ?? template.service_id;
      if (!packageRow) {
        available.push({ template, serviceName });
        continue;
      }
      activeManaged.push({
        packageId: packageRow.id,
        template,
        serviceName,
        isActive: packageRow.is_active,
        needsReview: packageRow.needs_review,
        tierPrices: Object.fromEntries(template.tiers.map((tier) => {
          const saved = packageTiers.find((item) => item.package_id === packageRow.id && item.template_tier_id === tier.id);
          return [tier.id, Number(saved?.price ?? tier.suggested_price ?? tier.min_price)];
        })),
        addonPrices: Object.fromEntries(template.addons.map((addon) => {
          const saved = packageAddons.find((item) => item.package_id === packageRow.id && item.template_addon_id === addon.id);
          return [addon.id, { price: Number(saved?.price ?? addon.default_price), isOffered: saved?.is_offered ?? true }];
        })),
      });
    }
    setManaged(activeManaged);
    setAvailableTemplates(available);
    setLoading(false);
  }, [contractorId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activateTemplate = async ({ template, serviceName }: AvailableTemplate) => {
    if (!template.tiers.length) {
      toast.error("This template is not ready", { description: "Mercurius must add at least one pricing tier before you can activate it." });
      return;
    }
    setSavingId(template.id);
    const supabase = createClient();
    const packageResult = await supabase.from("vendor_packages").insert({
      contractor_id: contractorId,
      service_id: template.service_id,
      template_id: template.id,
      name: `${serviceName} — Managed Pricing`,
      description: template.description,
      pricing_mode: "fixed",
      default_frequency: "one-time",
      is_active: false,
      needs_review: false,
    }).select("id").single();
    if (packageResult.error || !packageResult.data) {
      setSavingId(null);
      toast.error("Couldn’t activate this template", { description: packageResult.error?.message ?? "No package was created." });
      return;
    }
    const packageId = (packageResult.data as { id: string }).id;
    const tierResult = await supabase.from("package_tiers").insert(template.tiers.map((tier, index) => ({
      package_id: packageId,
      template_tier_id: tier.id,
      name: tier.name,
      price: tier.suggested_price ?? tier.min_price,
      includes: tier.includes,
      sort_order: index,
    })));
    if (tierResult.error) {
      await supabase.from("vendor_packages").delete().eq("id", packageId).eq("contractor_id", contractorId);
      setSavingId(null);
      toast.error("Couldn’t activate this template", { description: tierResult.error.message });
      return;
    }
    if (template.addons.length) {
      const addonResult = await supabase.from("package_addons").insert(template.addons.map((addon) => ({
        package_id: packageId,
        template_addon_id: addon.id,
        price: addon.default_price,
        is_offered: true,
      })));
      if (addonResult.error) {
        await supabase.from("vendor_packages").delete().eq("id", packageId).eq("contractor_id", contractorId);
        setSavingId(null);
        toast.error("Couldn’t activate this template", { description: addonResult.error.message });
        return;
      }
    }
    const publishResult = await supabase.from("vendor_packages").update({ is_active: true }).eq("id", packageId).eq("contractor_id", contractorId);
    if (publishResult.error) {
      setSavingId(null);
      toast.error("Template saved but not published", { description: publishResult.error.message });
      await load();
      return;
    }
    setSavingId(null);
    toast.success("Template activated", { description: `Customer pricing is now live for ${serviceName}.` });
    await load();
  };

  const savePackage = async (item: ManagedPackage) => {
    if (item.template.tiers.some((tier) => !Number.isFinite(item.tierPrices[tier.id]) || item.tierPrices[tier.id] <= 0)) {
      toast.error("Every tier needs a price greater than $0.");
      return;
    }
    setSavingId(item.packageId);
    const supabase = createClient();
    const pauseResult = await supabase.from("vendor_packages").update({ is_active: false }).eq("id", item.packageId).eq("contractor_id", contractorId);
    if (pauseResult.error) {
      setSavingId(null);
      toast.error("Couldn’t begin saving prices", { description: pauseResult.error.message });
      return;
    }
    const clearTiers = await supabase.from("package_tiers").delete().eq("package_id", item.packageId);
    if (clearTiers.error) return failSave(clearTiers.error.message);
    const tierResult = await supabase.from("package_tiers").insert(item.template.tiers.map((tier, index) => ({
      package_id: item.packageId,
      template_tier_id: tier.id,
      name: tier.name,
      price: item.tierPrices[tier.id],
      includes: tier.includes,
      sort_order: index,
    })));
    if (tierResult.error) return failSave(tierResult.error.message);
    const clearAddons = await supabase.from("package_addons").delete().eq("package_id", item.packageId);
    if (clearAddons.error) return failSave(clearAddons.error.message);
    if (item.template.addons.length) {
      const addonResult = await supabase.from("package_addons").insert(item.template.addons.map((addon) => ({
        package_id: item.packageId,
        template_addon_id: addon.id,
        price: item.addonPrices[addon.id]?.price ?? addon.default_price,
        is_offered: item.addonPrices[addon.id]?.isOffered ?? true,
      })));
      if (addonResult.error) return failSave(addonResult.error.message);
    }
    const needsReview = item.template.tiers.some((tier) => item.tierPrices[tier.id] < tier.min_price || item.tierPrices[tier.id] > tier.max_price)
      || item.template.addons.some((addon) => {
        const value = item.addonPrices[addon.id];
        return value?.isOffered !== false && ((value?.price ?? addon.default_price) < addon.price_min || (value?.price ?? addon.default_price) > addon.price_max);
      });
    const updateResult = await supabase.from("vendor_packages").update({ needs_review: needsReview, is_active: item.isActive }).eq("id", item.packageId).eq("contractor_id", contractorId);
    if (updateResult.error) return failSave(updateResult.error.message);
    setSavingId(null);
    toast.success("Prices saved", { description: needsReview ? "Some prices are outside the typical range and have been flagged for review." : "Your live customer pricing is up to date." });
    await load();

    function failSave(message: string) {
      setSavingId(null);
      toast.error("Couldn’t finish saving prices", { description: `${message} The package has been kept hidden so incomplete pricing is not shown to customers.` });
    }
  };

  const togglePackage = async (item: ManagedPackage) => {
    setSavingId(item.packageId);
    const result = await createClient().from("vendor_packages").update({ is_active: !item.isActive }).eq("id", item.packageId).eq("contractor_id", contractorId);
    setSavingId(null);
    if (result.error) toast.error("Couldn’t update availability", { description: result.error.message });
    else await load();
  };

  if (loading) return <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading managed pricing…</div>;
  if (loadError) return <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center"><h2 className="font-semibold">Managed pricing couldn’t be loaded</h2><p className="mt-2 text-sm text-muted-foreground">{loadError}</p><Button variant="outline" className="mt-4" onClick={() => { setLoadError(null); setLoading(true); void load(); }}>Try again</Button></div>;

  return <div className="space-y-6">
    {availableTemplates.length > 0 && <section className="space-y-3"><div><h2 className="font-medium">Available templates</h2><p className="mt-1 text-sm text-muted-foreground">Activate a Mercurius-approved structure, then set the live prices customers will see.</p></div><div className="grid gap-3 md:grid-cols-2">{availableTemplates.map((item) => <article key={item.template.id} className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-accent/40 bg-accent/5 p-4"><div><p className="font-medium">{item.serviceName}</p><p className="text-xs text-muted-foreground">{item.template.tiers.length} tiers · {item.template.addons.length} add-ons</p></div><Button size="sm" disabled={savingId === item.template.id} onClick={() => void activateTemplate(item)}>{savingId === item.template.id && <Loader2 className="animate-spin" />}Activate</Button></article>)}</div></section>}

    {!managed.length && !availableTemplates.length && <div className="rounded-xl border border-dashed bg-card p-10 text-center"><Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><h2 className="text-lg font-medium">No managed templates available</h2><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Mercurius has not published an approved pricing template for your services yet. You can still publish a fixed price from Your Prices.</p></div>}

    {managed.map((item) => <article key={item.packageId} className="space-y-5 rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">{item.serviceName}</h2><Badge variant="outline">{item.template.name}</Badge>{!item.isActive && <Badge variant="secondary">Paused</Badge>}{item.needsReview && <Badge variant="destructive">Review flagged</Badge>}</div>{item.template.description && <p className="mt-1 text-sm text-muted-foreground">{item.template.description}</p>}</div><div className="flex items-center gap-2"><PricingToggle checked={item.isActive} disabled={savingId === item.packageId} onCheckedChange={() => void togglePackage(item)} label={`${item.isActive ? "Pause" : "Publish"} ${item.serviceName} managed pricing`} /><span className="text-xs text-muted-foreground">Live</span></div></div>
      <div className="rounded-lg border bg-muted/30 p-3"><p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Customers will be asked</p><div className="flex flex-wrap gap-2">{item.template.questions.length ? item.template.questions.map((question) => <Badge key={question.id} variant="secondary">{question.question_label}{question.unit ? ` (${question.unit})` : ""}</Badge>) : <span className="text-sm text-muted-foreground">No qualifying questions</span>}</div></div>
      <section className="space-y-2"><h3 className="text-sm font-medium">Price per tier</h3>{item.template.tiers.map((tier) => { const price = item.tierPrices[tier.id] ?? 0; const outOfBand = price < tier.min_price || price > tier.max_price; return <div key={tier.id} className="grid items-center gap-3 rounded-lg border bg-background/50 p-3 sm:grid-cols-[1fr_130px_1fr]"><div><p className="text-sm font-medium">{tier.name}</p>{tier.includes.length > 0 && <p className="text-xs text-muted-foreground">{tier.includes.join(", ")}</p>}</div><div><Label htmlFor={`tier-${tier.id}`} className="mb-1 text-xs text-muted-foreground">Price ($)</Label><Input id={`tier-${tier.id}`} type="number" min="0" value={price} aria-invalid={outOfBand} onChange={(event) => setManaged((current) => current.map((candidate) => candidate.packageId === item.packageId ? { ...candidate, tierPrices: { ...candidate.tierPrices, [tier.id]: Number(event.target.value) } } : candidate))} /></div><div className="text-xs"><p className="text-muted-foreground">Expected: <span className="text-foreground">${tier.min_price}–${tier.max_price}</span></p>{outOfBand ? <p className="mt-1 flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" />Outside typical range</p> : <p className="mt-1 flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3 w-3" />Within range</p>}</div></div>; })}</section>
      {item.template.addons.length > 0 && <section className="space-y-2"><h3 className="text-sm font-medium">Add-ons</h3>{item.template.addons.map((addon) => { const state = item.addonPrices[addon.id] ?? { price: addon.default_price, isOffered: true }; const outOfBand = state.isOffered && (state.price < addon.price_min || state.price > addon.price_max); const patch = (change: Partial<typeof state>) => setManaged((current) => current.map((candidate) => candidate.packageId === item.packageId ? { ...candidate, addonPrices: { ...candidate.addonPrices, [addon.id]: { ...state, ...change } } } : candidate)); return <div key={addon.id} className="grid items-center gap-3 rounded-lg border bg-background/50 p-3 sm:grid-cols-[1fr_110px_130px_1fr]"><div><p className="text-sm font-medium">{addon.label}</p>{addon.description && <p className="text-xs text-muted-foreground">{addon.description}</p>}</div><div className="flex items-center gap-2"><PricingToggle checked={state.isOffered} onCheckedChange={(checked) => patch({ isOffered: checked })} label={`${state.isOffered ? "Remove" : "Offer"} ${addon.label}`} /><span className="text-xs text-muted-foreground">{state.isOffered ? "Offered" : "Off"}</span></div><div><Label htmlFor={`addon-${addon.id}`} className="mb-1 text-xs text-muted-foreground">Price ($)</Label><Input id={`addon-${addon.id}`} type="number" min="0" disabled={!state.isOffered} value={state.price} aria-invalid={outOfBand} onChange={(event) => patch({ price: Number(event.target.value) })} /></div><div className="text-xs"><p className="text-muted-foreground">Expected: <span className="text-foreground">${addon.price_min}–${addon.price_max}</span></p>{outOfBand && <p className="mt-1 flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" />Outside typical range</p>}</div></div>; })}</section>}
      <div className="flex justify-end"><Button className="min-h-10" disabled={savingId === item.packageId} onClick={() => void savePackage(item)}>{savingId === item.packageId && <Loader2 className="animate-spin" />}Save prices</Button></div>
    </article>)}
  </div>;
}
