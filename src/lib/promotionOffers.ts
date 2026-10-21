// TRACE-114 (DEC-2026-038): funded promotion offers. The server owns validation, approval,
// limits and every amount (private.promotion_economics); this module parses what it
// returns and words it. Ordinary commission is 15%; with one valid promotion applied it is
// 7.5%. A homeowner chooses an offer (TRACE-116, src/lib/promotionSelection.ts) only while the
// promotions gate is open after the two-person finance review (DEC-2026-015 §3 until then).

export type OfferFunding = "vendor" | "platform";
export type OfferKind = "percent" | "amount" | "package_price";
export type OfferStatus = "draft" | "awaiting_vendor" | "approved" | "retired";

export type OfferEconomics = {
  eligibleCents: number;
  discountCents: number;
  homeownerServiceCents: number;
  commissionRateBps: number;
  commissionBaseCents: number;
  commissionCents: number;
  vendorProceedsCents: number;
  platformSubsidyCents: number;
};

export type OfferUsage = {
  reserved: number;
  finalized: number;
  released: number;
  subsidyCommittedCents: number;
  vendorDiscountCents: number;
  commissionReliefCents: number;
};

export type PromotionOffer = {
  id: string;
  revision: number;
  fingerprint: string;
  status: OfferStatus;
  live: boolean;
  funding: OfferFunding;
  contractorId: string | null;
  contractorName: string | null;
  kind: OfferKind;
  percentBps: number | null;
  amountCents: number | null;
  maxDiscountCents: number | null;
  minSpendCents: number;
  packageLineageIds: string[];
  packageNames: string[];
  serviceIds: string[];
  zipCodes: string[];
  firstBookingOnly: boolean;
  requiresCode: boolean;
  label: string;
  terms: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  maxRedemptions: number | null;
  budgetCents: number | null;
  vendorApprovedAt: string | null;
  vendorNote: string | null;
  authorizedAt: string | null;
  authorizationReason: string | null;
  updatedAt: string;
  usage: OfferUsage;
  example: OfferEconomics | null;
};

export const ORDINARY_COMMISSION_BPS = 1500;
export const PROMOTIONAL_COMMISSION_BPS = 750;

const num = (value: unknown) => { const n = Number(value); return value === null || value === undefined || value === "" || !Number.isFinite(n) ? null : n; };
const text = (value: unknown) => (typeof value === "string" ? value : null);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

export function parseEconomics(value: unknown): OfferEconomics | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const fields = ["eligible_cents", "discount_cents", "homeowner_service_cents", "commission_rate_bps", "commission_base_cents",
    "commission_cents", "vendor_proceeds_cents", "platform_subsidy_cents"].map((key) => num(item[key]));
  if (fields.some((field) => field === null)) return null;
  const [eligibleCents, discountCents, homeownerServiceCents, commissionRateBps, commissionBaseCents, commissionCents, vendorProceedsCents, platformSubsidyCents] = fields as number[];
  return { eligibleCents, discountCents, homeownerServiceCents, commissionRateBps, commissionBaseCents, commissionCents, vendorProceedsCents, platformSubsidyCents };
}

export function parseOffer(value: unknown): PromotionOffer | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.fingerprint !== "string" || typeof item.label !== "string") return null;
  const statuses: OfferStatus[] = ["draft", "awaiting_vendor", "approved", "retired"];
  const usage = (item.usage ?? {}) as Record<string, unknown>;
  return {
    id: item.id, revision: num(item.revision) ?? 1, fingerprint: item.fingerprint,
    status: statuses.includes(item.status as OfferStatus) ? item.status as OfferStatus : "draft",
    live: item.live === true,
    funding: item.funding === "platform" ? "platform" : "vendor",
    contractorId: text(item.contractor_id), contractorName: text(item.contractor_name),
    kind: item.kind === "percent" || item.kind === "package_price" ? item.kind : "amount",
    percentBps: num(item.percent_bps), amountCents: num(item.amount_cents), maxDiscountCents: num(item.max_discount_cents),
    minSpendCents: num(item.min_spend_cents) ?? 0,
    packageLineageIds: strings(item.package_lineage_ids), packageNames: strings(item.package_names),
    serviceIds: strings(item.service_ids), zipCodes: strings(item.zip_codes),
    firstBookingOnly: item.first_booking_only === true, requiresCode: item.requires_code === true,
    label: item.label, terms: text(item.terms) ?? "",
    startsAt: text(item.starts_at) ?? "", endsAt: text(item.ends_at) ?? "", timezone: text(item.timezone) ?? "America/New_York",
    maxRedemptions: num(item.max_redemptions), budgetCents: num(item.budget_cents),
    vendorApprovedAt: text(item.vendor_approved_at), vendorNote: text(item.vendor_note),
    authorizedAt: text(item.authorized_at), authorizationReason: text(item.authorization_reason),
    updatedAt: text(item.updated_at) ?? "",
    usage: {
      reserved: num(usage.reserved) ?? 0, finalized: num(usage.finalized) ?? 0, released: num(usage.released) ?? 0,
      subsidyCommittedCents: num(usage.subsidy_committed_cents) ?? 0, vendorDiscountCents: num(usage.vendor_discount_cents) ?? 0,
      commissionReliefCents: num(usage.commission_relief_cents) ?? 0,
    },
    example: parseEconomics(item.example),
  };
}

export function parseOffers(value: unknown): PromotionOffer[] {
  return Array.isArray(value) ? value.flatMap((row) => { const offer = parseOffer(row); return offer ? [offer] : []; }) : [];
}

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);

export function formatPromotionDiscount(offer: Pick<PromotionOffer, "kind" | "percentBps" | "amountCents" | "maxDiscountCents">) {
  if (offer.kind === "percent" && offer.percentBps != null) {
    const percent = `${(offer.percentBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}% off`;
    return offer.maxDiscountCents != null ? `${percent}, up to ${usd(offer.maxDiscountCents)}` : percent;
  }
  if (offer.kind === "amount" && offer.amountCents != null) return `${usd(offer.amountCents)} off`;
  return "Promotional package price";
}

export const fundingLabel: Record<OfferFunding, string> = { vendor: "Vendor-funded", platform: "Mercurius-funded" };

export const offerStatusLabel: Record<OfferStatus, string> = {
  draft: "Draft",
  awaiting_vendor: "Waiting for the vendor's approval",
  approved: "Approved",
  retired: "Retired",
};

export function commissionRateLabel(bps: number) {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

/** Rows of a worked example, worded for the role reading it. */
export function economicsRows(economics: OfferEconomics, role: "operator" | "vendor"): [string, string][] {
  const rows: [string, string][] = [
    ["Eligible service", usd(economics.eligibleCents)],
    [economics.platformSubsidyCents > 0 ? "Discount (Mercurius-funded)" : "Discount (vendor-funded)", economics.discountCents ? `−${usd(economics.discountCents)}` : usd(0)],
    ["Homeowner pays for the service", usd(economics.homeownerServiceCents)],
    [`Commission (${commissionRateLabel(economics.commissionRateBps)} of ${usd(economics.commissionBaseCents)})`, usd(economics.commissionCents)],
    [role === "vendor" ? "You receive" : "Vendor proceeds", usd(economics.vendorProceedsCents)],
  ];
  if (role === "operator") rows.push(["Mercurius subsidy (not commission)", usd(economics.platformSubsidyCents)]);
  return rows;
}

/** Dollars entered to whole cents, or null. */
export function dollarsToCents(value: string): number | null {
  const cleaned = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return cents > 0 ? cents : null;
}

/** A whole-number or decimal percentage to basis points (10% → 1000), or null. */
export function percentToBps(value: string): number | null {
  const cleaned = value.trim().replace(/%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const bps = Math.round(Number(cleaned) * 100);
  return bps >= 1 && bps <= 8000 ? bps : null;
}

export const OFFER_TIMEZONE = "America/New_York";

/** Offset of a timezone from UTC, in minutes, at an instant. */
function zoneOffsetMinutes(instant: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return (asUtc - instant) / 60000;
}

/** "2026-11-01T09:00" read as wall time in `timeZone`, as an ISO instant; null if invalid. */
export function zonedLocalToIso(local: string, timeZone = OFFER_TIMEZONE): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let instant = wall - zoneOffsetMinutes(wall, timeZone) * 60000;
  instant = wall - zoneOffsetMinutes(instant, timeZone) * 60000;
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

/** An ISO instant as "YYYY-MM-DDTHH:mm" wall time in `timeZone`, for a datetime-local input. */
export function isoToZonedLocal(iso: string, timeZone = OFFER_TIMEZONE): string {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant)) return "";
  const shifted = new Date(instant + zoneOffsetMinutes(instant, timeZone) * 60000);
  return shifted.toISOString().slice(0, 16);
}
