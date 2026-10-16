import type { createClient } from "@/lib/supabase/client";
import { frequencyLabel, parsePriceInput } from "@/lib/packagePriceCorrections";
import { isPricingFrequency, pricingFrequencies, type PricingFrequency } from "@/lib/vendorPricing";

// DEC-2026-035 (TRACE-110): an operator drafts a price for a specific vendor, then
// publishes it with a reason. Drafts are private to Mercurius until published. The server
// (admin_save_package_draft / admin_publish_package_draft) owns validation, stale-read
// refusal, the duplicate-cadence check, the review flag, history and the vendor notice;
// this module prepares requests and reads what comes back.

export type DraftPrice = { frequency: PricingFrequency; price: number };

export type PackageDraft = {
  id: string;
  contractorId: string;
  contractorName: string;
  serviceId: string;
  serviceName: string;
  name: string;
  description: string | null;
  prices: DraftPrice[];
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DraftService = { id: string; name: string; defaultFrequency: string; offered: PricingFrequency[] };
export type DraftVendor = { id: string; name: string };

/** Entered text per cadence. Blank cadences are not priced. */
export type DraftPriceInput = Partial<Record<PricingFrequency, string>>;

export type PublishResult = { package_id: string; needs_review: boolean; vendor_notified: boolean };

export const DRAFT_NAME_MAX = 120;
export const DRAFT_DESCRIPTION_MAX = 1000;
export const DRAFT_REASON_MAX = 500;

/** The cadences a service offers, in display order; a service without a list offers all. */
export function offeredCadences(available: readonly string[] | null | undefined): PricingFrequency[] {
  const listed = (available ?? []).filter(isPricingFrequency);
  return listed.length ? pricingFrequencies.filter((frequency) => listed.includes(frequency)) : [...pricingFrequencies];
}

/** Builds the server's price list from what the operator entered for the offered cadences. */
export function buildDraftPrices(input: DraftPriceInput, offered: readonly PricingFrequency[]):
  { ok: true; prices: DraftPrice[] } | { ok: false; invalid: PricingFrequency[]; message: string } {
  const prices: DraftPrice[] = [];
  const invalid: PricingFrequency[] = [];
  for (const frequency of offered) {
    const entered = input[frequency]?.trim();
    if (!entered) continue;
    const amount = parsePriceInput(entered);
    if (amount === null) invalid.push(frequency);
    else prices.push({ frequency, price: amount });
  }
  if (invalid.length) return { ok: false, invalid, message: "Enter each price as a positive dollar amount, at most two decimal places." };
  if (!prices.length) return { ok: false, invalid: [], message: "Enter a price for at least one cadence." };
  return { ok: true, prices };
}

export function draftPriceInput(prices: readonly DraftPrice[]): DraftPriceInput {
  return Object.fromEntries(prices.map((price) => [price.frequency, String(price.price)]));
}

/** Server refusals worded for the operator. */
export function draftErrorMessage(error: { code?: string; message: string }) {
  if (error.code === "40001") return "This draft changed since you opened it. Reload and review it before trying again.";
  return error.message;
}

export function describeDraftPrice(price: DraftPrice) {
  return `${frequencyLabel(price.frequency)}: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(price.price) ? 0 : 2, maximumFractionDigits: 2 }).format(price.price)}`;
}

export function parseDraft(value: unknown): PackageDraft | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.contractor_id !== "string" || typeof item.service_id !== "string"
    || typeof item.name !== "string" || typeof item.updated_at !== "string") return null;
  const prices = Array.isArray(item.prices) ? item.prices.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const price = entry as Record<string, unknown>;
    const amount = Number(price.price);
    return typeof price.frequency === "string" && isPricingFrequency(price.frequency) && Number.isFinite(amount)
      ? [{ frequency: price.frequency, price: amount }] : [];
  }) : [];
  return {
    id: item.id,
    contractorId: item.contractor_id,
    contractorName: typeof item.contractor_name === "string" ? item.contractor_name : "Unknown vendor",
    serviceId: item.service_id,
    serviceName: typeof item.service_name === "string" ? item.service_name : item.service_id,
    name: item.name,
    description: typeof item.description === "string" ? item.description : null,
    prices,
    createdByEmail: typeof item.created_by_email === "string" ? item.created_by_email : null,
    createdAt: typeof item.created_at === "string" ? item.created_at : item.updated_at,
    updatedAt: item.updated_at,
  };
}

export function parseDrafts(value: unknown): PackageDraft[] {
  return Array.isArray(value) ? value.flatMap((row) => { const draft = parseDraft(row); return draft ? [draft] : []; }) : [];
}

type ServiceRow = { id: string; name: string; default_frequency: string; available_frequencies: string[] | null };

/** Open drafts (one vendor's or all) and the active catalog services they can price. */
export async function loadDraftContext(supabase: ReturnType<typeof createClient>, contractorId?: string) {
  const [draftResult, serviceResult] = await Promise.all([
    supabase.rpc("admin_package_drafts", { p_contractor: contractorId ?? null }),
    supabase.from("services_catalog").select("id, name, default_frequency, available_frequencies").eq("is_active", true).order("name"),
  ]);
  if (draftResult.error) throw draftResult.error;
  if (serviceResult.error) throw serviceResult.error;
  const services: DraftService[] = ((serviceResult.data ?? []) as ServiceRow[]).map((service) => ({
    id: service.id, name: service.name, defaultFrequency: service.default_frequency, offered: offeredCadences(service.available_frequencies),
  }));
  return { drafts: parseDrafts(draftResult.data), services };
}
