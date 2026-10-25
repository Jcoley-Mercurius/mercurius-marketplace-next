import type { createClient } from "@/lib/supabase/client";
import { parseContent, type PackageContent } from "@/lib/pricingContent";

// DEC-2026-034 (TRACE-109): an operator corrects a vendor's package prices with a reason
// through admin_correct_package_prices. The server owns validation, stale-read refusal,
// the review flag, history and the vendor notification; this module only prepares the
// request from what the operator read and explains what comes back.

export type PricingMode = "fixed" | "deposit_quote" | "custom_quote";

export type PriceLine = { kind: "tier" | "addon"; id: string; name: string; detail: string | null; price: number };

export type CorrectablePackage = {
  id: string;
  contractorId: string;
  contractorName: string;
  serviceName: string;
  name: string;
  pricingMode: PricingMode;
  templateId: string | null;
  isActive: boolean;
  needsReview: boolean;
  updatedAt: string;
  depositAmount: number | null;
  tiers: PriceLine[];
  addons: PriceLine[];
  /** The live package's content document (description, scope, price meaning, add-ons), when readable. */
  content: PackageContent | null;
  /** DEC-2026-041 item 5: approval evidence as recorded; never inferred. */
  approval: PackageApproval | null;
  /** TRACE-122: the package's internal notes (all revisions), never shown to homeowners. */
  internalNotes: InternalNotes | null;
  /** TRACE-122: set when an operator archived this paused or replaced package. */
  archive: PackageArchive | null;
};

export type InternalNotes = { notes: string; updatedAt: string | null; updatedByEmail: string | null };
export type PackageArchive = { reason: string; archivedAt: string; actorEmail: string | null };

const optionalText = (value: unknown) => (typeof value === "string" ? value : null);

function parseInternalNotes(value: unknown): InternalNotes | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return typeof item.notes === "string" && item.notes.trim()
    ? { notes: item.notes, updatedAt: optionalText(item.updated_at), updatedByEmail: optionalText(item.updated_by_email) } : null;
}

function parseArchive(value: unknown): PackageArchive | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  return typeof item.reason === "string" && typeof item.archived_at === "string"
    ? { reason: item.reason, archivedAt: item.archived_at, actorEmail: optionalText(item.actor_email) } : null;
}

export type ApprovalEvidence = "vendor_approved" | "operator_published" | "managed_template" | "unrecorded";
export type PackageApproval = {
  status: ApprovalEvidence;
  operatorCorrected: boolean;
  replacement: { draftId: string; approvalState: string } | null;
};

export const approvalEvidenceLabel: Record<ApprovalEvidence, string> = {
  vendor_approved: "Vendor approved this revision",
  operator_published: "Published by Mercurius without vendor approval",
  managed_template: "From a Mercurius template; no approval recorded",
  unrecorded: "No approval recorded",
};

function parseApproval(value: unknown): PackageApproval | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const statuses: ApprovalEvidence[] = ["vendor_approved", "operator_published", "managed_template", "unrecorded"];
  if (!statuses.includes(item.status as ApprovalEvidence)) return null;
  const replacement = item.replacement && typeof item.replacement === "object" ? item.replacement as Record<string, unknown> : null;
  return {
    status: item.status as ApprovalEvidence,
    operatorCorrected: item.operator_corrected === true,
    replacement: replacement && typeof replacement.draft_id === "string"
      ? { draftId: replacement.draft_id, approvalState: String(replacement.approval_state ?? "draft") } : null,
  };
}

/** Entered text per tier/add-on id, plus "deposit". Untouched lines are absent or unchanged. */
export type PriceDraft = Record<string, string>;

export type CorrectionRequest = {
  tiers: Array<{ id: string; from: number; price: number }>;
  addons: Array<{ id: string; from: number; price: number }>;
  deposit?: number;
  deposit_from?: number | null;
};

export type PriceCorrectionChange =
  | { kind: "tier" | "addon" | "deposit"; name: string; frequency: string | null; from: number | null; to: number }
  /** DEC-2026-041 item 4: an operator suspended the listing while approval is obtained. */
  | { kind: "suspended" };

export type PriceCorrection = {
  id: number;
  packageId: string;
  packageName: string;
  changes: PriceCorrectionChange[];
  reason: string;
  createdAt: string;
  actorEmail: string | null;
};

export const PRICE_CORRECTION_REASON_MAX = 500;
const PRICE_MAX = 1_000_000;

/** A positive whole-cent amount up to $1,000,000, or null. Accepts "$1,250.50". */
export function parsePriceInput(value: string): number | null {
  const cleaned = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return amount > 0 && amount <= PRICE_MAX ? amount : null;
}

export function hasCorrectablePrices(pkg: CorrectablePackage) {
  return pkg.tiers.length > 0 || pkg.addons.length > 0 || pkg.pricingMode === "deposit_quote";
}

/**
 * Builds the server request from the operator's draft. Each changed price carries the
 * value the operator read, so the server refuses the correction if it moved since.
 */
export function buildCorrection(pkg: CorrectablePackage, draft: PriceDraft):
  { ok: true; prices: CorrectionRequest; changed: number } | { ok: false; invalid: string[]; message: string } {
  const prices: CorrectionRequest = { tiers: [], addons: [] };
  const invalid: string[] = [];
  const lines: Array<PriceLine | { kind: "deposit"; id: "deposit"; price: number | null }> = [...pkg.tiers, ...pkg.addons];
  if (pkg.pricingMode === "deposit_quote") lines.push({ kind: "deposit", id: "deposit", price: pkg.depositAmount });
  for (const line of lines) {
    const entered = draft[line.id];
    if (entered === undefined || entered.trim() === "") continue;
    const amount = parsePriceInput(entered);
    if (amount === null) { invalid.push(line.id); continue; }
    if (amount === line.price) continue;
    if (line.kind === "deposit") { prices.deposit = amount; prices.deposit_from = line.price; }
    else prices[line.kind === "tier" ? "tiers" : "addons"].push({ id: line.id, from: line.price, price: amount });
  }
  if (invalid.length) return { ok: false, invalid, message: "Enter each price as a positive dollar amount, at most two decimal places." };
  const changed = prices.tiers.length + prices.addons.length + (prices.deposit === undefined ? 0 : 1);
  if (!changed) return { ok: false, invalid: [], message: "Change at least one price before saving." };
  return { ok: true, prices, changed };
}

/** Server refusals worded for the operator. */
export function correctionErrorMessage(error: { code?: string; message: string }) {
  if (error.code === "40001") return "This package changed since you opened it. Reload and review the vendor’s current prices before correcting.";
  if (error.code === "55000" && /already open/.test(error.message)) return "A replacement draft for this package is already open. Edit it under Draft prices.";
  return error.message;
}

export function parseCorrections(value: unknown): PriceCorrection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    if (typeof item.package_id !== "string" || typeof item.reason !== "string" || typeof item.created_at !== "string") return [];
    const changes = Array.isArray(item.changes) ? item.changes.flatMap((change): PriceCorrectionChange[] => {
      if (!change || typeof change !== "object") return [];
      const entry = change as Record<string, unknown>;
      if (entry.kind === "suspended") return [{ kind: "suspended" } satisfies PriceCorrectionChange];
      if (entry.kind !== "tier" && entry.kind !== "addon" && entry.kind !== "deposit") return [];
      const to = Number(entry.to);
      if (!Number.isFinite(to)) return [];
      return [{
        kind: entry.kind,
        name: typeof entry.name === "string" ? entry.name : "Price",
        frequency: typeof entry.frequency === "string" ? entry.frequency : null,
        from: entry.from === null || entry.from === undefined ? null : Number(entry.from),
        to,
      } satisfies PriceCorrectionChange];
    }) : [];
    return [{
      id: Number(item.id),
      packageId: item.package_id,
      packageName: typeof item.package_name === "string" ? item.package_name : "Package",
      changes,
      reason: item.reason,
      createdAt: item.created_at,
      actorEmail: typeof item.actor_email === "string" ? item.actor_email : null,
    }];
  });
}

export function describeChange(change: PriceCorrectionChange) {
  if (change.kind === "suspended") return "Listing suspended by Mercurius";
  const label = change.frequency && change.frequency !== "one-time" && change.name !== frequencyLabel(change.frequency)
    ? `${change.name} (${frequencyLabel(change.frequency)})` : change.name;
  return `${label}: ${change.from === null ? "not set" : formatPrice(change.from)} → ${formatPrice(change.to)}`;
}

export function formatCorrectionTime(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(value)) + " Eastern";
}

export function frequencyLabel(value: string) {
  if (value === "one-time") return "One-time";
  if (value === "bi-monthly") return "Every two weeks";
  if (value === "every-two-months") return "Every two months";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function pricingModeLabel(value: PricingMode) {
  if (value === "fixed") return "Fixed price";
  if (value === "deposit_quote") return "Quote + deposit";
  return "Custom quote";
}

export function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 }).format(value);
}

type PackageRow = {
  id: string; contractor_id: string; service_id: string; template_id: string | null; name: string;
  pricing_mode: string; deposit_amount: number | string | null; is_active: boolean; needs_review: boolean; updated_at: string;
};
type NamedRow = { id: string; name: string };
type TierRow = { id: string; package_id: string; name: string; price: number | string; frequency: string };
type AddonRow = { id: string; package_id: string; template_addon_id: string | null; name: string | null; price: number | string; is_offered: boolean };

function isPricingMode(value: unknown): value is PricingMode {
  return value === "fixed" || value === "deposit_quote" || value === "custom_quote";
}

/** Every package (or one provider's), with tier, add-on and deposit prices. Admin RLS reads all rows. */
export async function loadCorrectablePackages(supabase: ReturnType<typeof createClient>, contractorId?: string): Promise<CorrectablePackage[]> {
  let query = supabase.from("vendor_packages")
    .select("id, contractor_id, service_id, template_id, name, pricing_mode, deposit_amount, is_active, needs_review, updated_at, sort_order")
    .order("sort_order").order("name");
  if (contractorId) query = query.eq("contractor_id", contractorId);
  const packageResult = await query;
  if (packageResult.error) throw packageResult.error;
  const packages = (packageResult.data ?? []) as PackageRow[];
  if (!packages.length) return [];
  const ids = packages.map((item) => item.id);
  const [contractorResult, serviceResult, tierResult, addonResult, templateAddonResult, contentResult] = await Promise.all([
    supabase.from("contractors").select("id, name").in("id", [...new Set(packages.map((item) => item.contractor_id))]),
    supabase.from("services_catalog").select("id, name").in("id", [...new Set(packages.map((item) => item.service_id))]),
    supabase.from("package_tiers").select("id, package_id, name, price, frequency, sort_order").in("package_id", ids).order("sort_order"),
    supabase.from("package_addons").select("id, package_id, template_addon_id, name, price, is_offered, sort_order").in("package_id", ids).order("sort_order"),
    supabase.from("pricing_template_addons").select("id, label"),
    supabase.rpc("admin_package_contents", contractorId ? { p_contractor: contractorId } : {}),
  ]);
  const firstError = contractorResult.error ?? serviceResult.error ?? tierResult.error ?? addonResult.error ?? templateAddonResult.error ?? contentResult.error;
  if (firstError) throw firstError;
  const contractors = new Map(((contractorResult.data ?? []) as NamedRow[]).map((item) => [item.id, item.name]));
  const services = new Map(((serviceResult.data ?? []) as NamedRow[]).map((item) => [item.id, item.name]));
  const addonLabels = new Map(((templateAddonResult.data ?? []) as Array<{ id: string; label: string }>).map((item) => [item.id, item.label]));
  const tiers = (tierResult.data ?? []) as TierRow[];
  const addons = (addonResult.data ?? []) as AddonRow[];
  const contents = new Map((Array.isArray(contentResult.data) ? contentResult.data : []).flatMap((entry) => {
    const row = entry as { package_id?: unknown; content?: unknown; approval?: unknown; internal_notes?: unknown; archive?: unknown } | null;
    return typeof row?.package_id === "string"
      ? [[row.package_id, { content: parseContent(row.content), approval: parseApproval(row.approval),
        internalNotes: parseInternalNotes(row.internal_notes), archive: parseArchive(row.archive) }] as const] : [];
  }));
  return packages.map((item) => ({
    id: item.id,
    contractorId: item.contractor_id,
    contractorName: contractors.get(item.contractor_id) ?? "Unknown vendor",
    serviceName: services.get(item.service_id) ?? item.service_id,
    name: item.name,
    pricingMode: isPricingMode(item.pricing_mode) ? item.pricing_mode : "custom_quote",
    templateId: item.template_id,
    isActive: item.is_active,
    needsReview: item.needs_review,
    updatedAt: item.updated_at,
    depositAmount: item.deposit_amount === null ? null : Number(item.deposit_amount),
    tiers: tiers.filter((tier) => tier.package_id === item.id).map((tier) => ({
      kind: "tier" as const, id: tier.id, name: tier.name, detail: frequencyLabel(tier.frequency), price: Number(tier.price),
    })),
    addons: addons.filter((addon) => addon.package_id === item.id).map((addon) => ({
      kind: "addon" as const,
      id: addon.id,
      name: addon.name?.trim() || (addon.template_addon_id ? addonLabels.get(addon.template_addon_id) : null) || "Add-on",
      detail: addon.is_offered ? "Add-on" : "Add-on, not offered",
      price: Number(addon.price),
    })),
    content: contents.get(item.id)?.content ?? null,
    approval: contents.get(item.id)?.approval ?? null,
    internalNotes: contents.get(item.id)?.internalNotes ?? null,
    archive: contents.get(item.id)?.archive ?? null,
  }));
}
