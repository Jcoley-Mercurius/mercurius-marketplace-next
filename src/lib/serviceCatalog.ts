// TRACE-118 (DEC-2026-044): operators add services to the catalog and edit them. A service's
// id is the key vendor packages, drafts, requests and compliance rows refer to, so it is set
// once when the service is created and never changed; removing a service means hiding it.
import { pricingFrequencies } from "@/lib/vendorPricing";

export type CatalogService = {
  id: string;
  name: string;
  category_id: string;
  icon: string;
  tags: string[];
  descriptor: string;
  is_popular: boolean;
  is_active: boolean;
  weekly_price: number | null;
  monthly_price: number;
  one_time_price: number;
  default_frequency: string;
  available_frequencies: string[];
  sort_order: number;
  pricing_mode: string;
  default_deposit_amount: number | null;
};

export const PRICING_MODES = [
  { value: "fixed", label: "Fixed Price" },
  { value: "deposit_quote", label: "Deposit + Quote" },
  { value: "custom_quote", label: "Custom Quote" },
] as const;

// Stored lists keep the catalog's order: recurring from most to least frequent, then one-time.
export const CATALOG_FREQUENCY_ORDER: readonly string[] = [...pricingFrequencies.filter((frequency) => frequency !== "one-time"), "one-time"];

// Lucide icon names the public catalog renders (any Lucide name works; these are the ones offered).
export const CATALOG_ICONS = [
  "Home", "Wrench", "Hammer", "HardHat", "Construction", "Waves", "Droplets", "Wind", "AirVent", "Snowflake", "Thermometer",
  "Flame", "Fan", "Zap", "Sparkles", "Leaf", "Sprout", "TreePine", "Scissors", "Shovel", "Fence", "Paintbrush", "PaintBucket",
  "DoorOpen", "KeyRound", "Layers", "Bug", "Shield", "Wifi", "Settings", "Sun", "TriangleAlert", "Truck", "Trash2", "Star",
] as const;

export const SERVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SERVICE_ID_MAX_LENGTH = 100;

/** "AC Repair" → "ac-repair"; "Shrub & Hedge Trimming" → "shrub-hedge-trimming". */
export function serviceIdFromName(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SERVICE_ID_MAX_LENGTH)
    .replace(/-+$/, "");
}

/** Comma-separated search tags, trimmed, lowercased and de-duplicated. */
export function parseTags(text: string) {
  return [...new Set(text.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

export function emptyCatalogService(categoryId: string): CatalogService {
  return {
    id: "", name: "", category_id: categoryId, icon: "Home", tags: [], descriptor: "", is_popular: false, is_active: true,
    weekly_price: null, monthly_price: 0, one_time_price: 0, default_frequency: "one-time", available_frequencies: ["one-time"],
    sort_order: 0, pricing_mode: "custom_quote", default_deposit_amount: null,
  };
}

/** The first problem with the form, or null. `existing` is the loaded catalog, hidden services included. */
export function catalogServiceError(form: CatalogService, existing: readonly Pick<CatalogService, "id" | "name">[], isNew: boolean) {
  const name = form.name.trim();
  if (!name) return "Service name is required.";
  if (isNew) {
    if (!form.id) return "Service ID is required.";
    if (form.id.length > SERVICE_ID_MAX_LENGTH || !SERVICE_ID_PATTERN.test(form.id)) return "Service ID can use lowercase letters, numbers and single hyphens only.";
    if (existing.some((service) => service.id === form.id)) return `A service with the ID "${form.id}" already exists.`;
  }
  const sameName = existing.find((service) => service.id !== form.id && service.name.trim().toLowerCase() === name.toLowerCase());
  if (sameName) return `"${sameName.name}" is already in the catalog.`;
  if (!form.category_id) return "Select a category.";
  const prices = [form.weekly_price, form.monthly_price, form.one_time_price, form.default_deposit_amount];
  if (prices.some((value) => value !== null && (!Number.isFinite(Number(value)) || Number(value) < 0))) return "Prices cannot be negative.";
  if (form.pricing_mode === "deposit_quote" && (!form.default_deposit_amount || form.default_deposit_amount <= 0)) return "Deposit + Quote services require a deposit greater than $0.";
  if (!form.available_frequencies.length) return "Choose at least one cadence the service offers.";
  if (!form.available_frequencies.includes(form.default_frequency)) return "The default cadence must be one the service offers.";
  return null;
}

/** Columns an edit writes. The id, sort order and the two switches are not part of an edit. */
export function catalogServiceChanges(form: CatalogService) {
  return {
    name: form.name.trim(),
    descriptor: form.descriptor.trim(),
    category_id: form.category_id,
    icon: form.icon || "Star",
    tags: form.tags,
    weekly_price: form.weekly_price,
    monthly_price: form.monthly_price,
    one_time_price: form.one_time_price,
    default_frequency: form.default_frequency,
    available_frequencies: CATALOG_FREQUENCY_ORDER.filter((frequency) => form.available_frequencies.includes(frequency)),
    pricing_mode: form.pricing_mode,
    default_deposit_amount: form.pricing_mode === "deposit_quote" ? form.default_deposit_amount : null,
  };
}

/** The row an add inserts: placed after every existing service. */
export function catalogServiceInsert(form: CatalogService, existing: readonly Pick<CatalogService, "sort_order">[]) {
  const sortOrder = existing.reduce((highest, service) => Math.max(highest, service.sort_order), -1) + 1;
  return { id: form.id, ...catalogServiceChanges(form), is_active: form.is_active, is_popular: form.is_popular, sort_order: sortOrder };
}

/** A unique-key refusal from the database names the clash; anything else keeps its message. */
export function catalogSaveErrorMessage(reason: unknown) {
  const error = reason as { code?: string; message?: string } | null;
  if (error?.code === "23505") return "A service with this ID already exists. Refresh the catalog and choose another ID.";
  if (error?.code === "23503") return "The selected category no longer exists. Refresh the catalog and try again.";
  return error?.message || "Please try again.";
}
