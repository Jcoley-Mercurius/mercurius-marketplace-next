// Server-owned price catalog. This is the ONLY trusted source for catalog
// (non-vendor-package) pricing at checkout time. Values mirror
// src/lib/serviceData.ts but are deployed with the edge function so a
// tampered client payload can never influence the charged amount.
export type CatalogFrequency =
  | "weekly" | "bi-weekly" | "monthly" | "bi-monthly" | "quarterly" | "yearly" | "one-time";

export interface CatalogPrice {
  name: string;
  weekly: number | null;
  monthly: number | null;
  biMonthly: number | null;
  quarterly: number | null;
  oneTime: number | null;
}

export const CATALOG_PRICES = new Map<string, CatalogPrice>([
  ["lawn-mowing", { name: "Lawn Care", weekly: 160, monthly: 100, biMonthly: null, quarterly: null, oneTime: 65 }],
  ["lawn-fertilization", { name: "Lawn Fertilization", weekly: null, monthly: 65, biMonthly: null, quarterly: null, oneTime: 85 }],
  ["tree-trimming", { name: "Tree Trimming", weekly: null, monthly: 90, biMonthly: null, quarterly: null, oneTime: 200 }],
  ["shrub-hedge-trimming", { name: "Shrub & Hedge Trimming", weekly: null, monthly: 70, biMonthly: null, quarterly: null, oneTime: 120 }],
  ["irrigation-maintenance", { name: "Irrigation Maintenance", weekly: null, monthly: 75, biMonthly: null, quarterly: null, oneTime: 125 }],
  ["mulching-bed-care", { name: "Mulching & Bed Care", weekly: null, monthly: 65, biMonthly: null, quarterly: null, oneTime: 110 }],
  ["leaf-debris-removal", { name: "Leaf & Debris Removal", weekly: null, monthly: 55, biMonthly: null, quarterly: null, oneTime: 95 }],
  ["house-cleaning", { name: "House Cleaning", weekly: 320, monthly: 180, biMonthly: null, quarterly: null, oneTime: 250 }],
  ["deep-cleaning", { name: "Deep Cleaning", weekly: null, monthly: 250, biMonthly: null, quarterly: null, oneTime: 350 }],
  ["window-cleaning", { name: "Window Cleaning", weekly: null, monthly: 80, biMonthly: null, quarterly: null, oneTime: 150 }],
  ["pressure-washing", { name: "Pressure Washing", weekly: null, monthly: 85, biMonthly: null, quarterly: null, oneTime: 200 }],
  ["floor-cleaning", { name: "Floor Cleaning", weekly: null, monthly: 110, biMonthly: null, quarterly: null, oneTime: 175 }],
  ["carpet-cleaning", { name: "Carpet Cleaning", weekly: null, monthly: 120, biMonthly: null, quarterly: null, oneTime: 195 }],
  ["rental-turnover-cleaning", { name: "Rental Turnover Cleaning", weekly: null, monthly: 200, biMonthly: null, quarterly: null, oneTime: 300 }],
  ["move-in-cleaning", { name: "Move-In Cleaning", weekly: null, monthly: 220, biMonthly: null, quarterly: null, oneTime: 300 }],
  ["ac-maintenance", { name: "AC Maintenance", weekly: null, monthly: 85, biMonthly: null, quarterly: null, oneTime: 150 }],
  ["heating-maintenance", { name: "Heating Maintenance", weekly: null, monthly: 85, biMonthly: null, quarterly: null, oneTime: 150 }],
  ["duct-cleaning", { name: "Duct Cleaning", weekly: null, monthly: 150, biMonthly: null, quarterly: null, oneTime: 300 }],
  ["plumbing-repair", { name: "Plumbing Repair", weekly: null, monthly: 110, biMonthly: null, quarterly: null, oneTime: 185 }],
  ["water-heater-service", { name: "Water Heater Service", weekly: null, monthly: 90, biMonthly: null, quarterly: null, oneTime: 175 }],
  ["electrical-repair", { name: "Electrical Repair", weekly: null, monthly: 130, biMonthly: null, quarterly: null, oneTime: 225 }],
  ["handyman", { name: "Handyman", weekly: null, monthly: 120, biMonthly: null, quarterly: null, oneTime: 165 }],
  ["appliance-repair", { name: "Appliance Repair", weekly: null, monthly: 95, biMonthly: null, quarterly: null, oneTime: 175 }],
  ["garage-door-repair", { name: "Garage Door Repair", weekly: null, monthly: 90, biMonthly: null, quarterly: null, oneTime: 175 }],
  ["drywall-repair", { name: "Drywall Repair", weekly: null, monthly: 85, biMonthly: null, quarterly: null, oneTime: 150 }],
  ["painting-interior", { name: "Interior Painting", weekly: null, monthly: 350, biMonthly: null, quarterly: null, oneTime: 500 }],
  ["painting-touch-ups", { name: "Painting Touch-Ups", weekly: null, monthly: 85, biMonthly: null, quarterly: null, oneTime: 135 }],
  ["tile-grout-repair", { name: "Tile & Grout Repair", weekly: null, monthly: 95, biMonthly: null, quarterly: null, oneTime: 175 }],
  ["door-window-repair", { name: "Door & Window Repair", weekly: null, monthly: 80, biMonthly: null, quarterly: null, oneTime: 145 }],
  ["pool-service", { name: "Pool Service", weekly: 140, monthly: 140, biMonthly: null, quarterly: null, oneTime: 225 }],
  ["gutter-cleaning", { name: "Gutter Cleaning", weekly: null, monthly: 75, biMonthly: null, quarterly: null, oneTime: 150 }],
  ["roof-inspection", { name: "Roof Inspection", weekly: null, monthly: 70, biMonthly: null, quarterly: null, oneTime: 175 }],
  ["fence-repair", { name: "Fence Repair", weekly: null, monthly: 95, biMonthly: null, quarterly: null, oneTime: 185 }],
  ["deck-patio-repair", { name: "Deck & Patio Repair", weekly: null, monthly: 120, biMonthly: null, quarterly: null, oneTime: 225 }],
  ["driveway-repair", { name: "Driveway Repair", weekly: null, monthly: 100, biMonthly: null, quarterly: null, oneTime: 200 }],
  ["exterior-painting", { name: "Exterior Painting", weekly: null, monthly: 400, biMonthly: null, quarterly: null, oneTime: 650 }],
  ["pest-control", { name: "Pest Control", weekly: null, monthly: 55, biMonthly: null, quarterly: null, oneTime: 110 }],
  ["junk-removal", { name: "Junk Removal", weekly: null, monthly: 80, biMonthly: null, quarterly: null, oneTime: 175 }],
  ["smart-home-setup", { name: "Smart Home Setup", weekly: null, monthly: 120, biMonthly: null, quarterly: null, oneTime: 200 }],
  ["home-inspection", { name: "Home Inspection", weekly: null, monthly: 150, biMonthly: null, quarterly: null, oneTime: 300 }],
  ["locksmith", { name: "Locksmith", weekly: null, monthly: 75, biMonthly: null, quarterly: null, oneTime: 140 }],
  ["trash-can-cleaning", { name: "Trash Can Cleaning", weekly: null, monthly: 30, biMonthly: 35, quarterly: 45, oneTime: 50 }],
]);

/** Resolve a catalog entry by catalog id, or by exact service name as a fallback. */
export function findCatalogEntry(serviceId?: string | null, serviceName?: string | null): { id: string; entry: CatalogPrice } | null {
  if (serviceId) {
    const entry = CATALOG_PRICES.get(serviceId);
    if (entry) return { id: serviceId, entry };
  }
  if (serviceName) {
    const target = serviceName.trim().toLowerCase();
    for (const [id, entry] of CATALOG_PRICES) {
      if (entry.name.toLowerCase() === target) return { id, entry };
    }
  }
  return null;
}

/** Price for a catalog service at a given frequency. Returns null when unpriced. */
export function catalogPriceFor(entry: CatalogPrice, frequency?: string | null): number | null {
  switch (frequency) {
    case "one-time": return entry.oneTime;
    case "weekly": return entry.weekly ?? entry.monthly;
    case "bi-weekly": return entry.weekly ?? entry.monthly;
    case "bi-monthly": return entry.biMonthly ?? entry.monthly;
    case "quarterly": return entry.quarterly ?? entry.monthly;
    case "monthly":
    case "yearly":
    default: return entry.monthly;
  }
}
