// ─────────────────────────────────────────────
// Service data model — 2-level taxonomy
// Category → Service (like Google Business categories)
// ─────────────────────────────────────────────

export interface ServiceCategory {
  id: string;
  name: string;
  icon: string; // lucide icon name
  description: string;
}

export type ServiceFrequency = "weekly" | "monthly" | "bi-monthly" | "quarterly" | "one-time";

export interface Service {
  id: string;
  name: string;
  categoryId: string; // references ServiceCategory.id
  // legacy field kept for backward compat
  category: string;
  tags: string[];
  icon: string; // lucide icon name
  descriptor: string; // one-line description
  popular?: boolean;
  weeklyPrice?: number; // only for services that support weekly
  avgMonthlyPrice: number;
  biMonthlyPrice?: number;
  quarterlyPrice?: number;
  oneTimePrice: number;
  /** Default frequency suggestion for this service */
  defaultFrequency: ServiceFrequency;
  /** Which frequencies are available for this service */
  availableFrequencies?: ServiceFrequency[];
  /** Live launch availability. Fallback catalog prices never imply coverage. */
  availability?: "fixed" | "quote" | "sourcing";
}

// ─────────────────────────────────────────────
// CATEGORIES (top level tabs)
// ─────────────────────────────────────────────
export const serviceCategories: ServiceCategory[] = [
  { id: "lawn-landscape",  name: "Lawn & Landscape",    icon: "Leaf",         description: "Outdoor greenery, irrigation & yard care" },
  { id: "cleaning",        name: "Cleaning",             icon: "Sparkles",     description: "Interior & exterior cleaning services" },
  { id: "hvac-mechanical", name: "HVAC & Mechanical",   icon: "Wind",         description: "Heating, cooling, plumbing & electrical" },
  { id: "repairs-trades",  name: "Repairs & Trades",    icon: "Wrench",       description: "Handyman, structural & appliance repairs" },
  { id: "outdoor-exterior",name: "Outdoor & Exterior",  icon: "Home",         description: "Roofing, fencing, driveways & exteriors" },
  { id: "specialty",       name: "Specialty",            icon: "Star",         description: "Pest control, security, smart home & more" },
];

// ─────────────────────────────────────────────
// SERVICES (~40 across categories)
// Prices calibrated to Southwest Florida (Cape Coral / Fort Myers) market, 2025-2026
// ─────────────────────────────────────────────
export const services: Service[] = [
  // ── Lawn & Landscape ──────────────────────
  { id: "lawn-mowing", name: "Lawn Care", categoryId: "lawn-landscape", category: "outdoor", tags: ["grass", "mowing", "yard"], icon: "Scissors", descriptor: "Mowing, edging & yard upkeep", popular: true, weeklyPrice: 160, avgMonthlyPrice: 100, oneTimePrice: 65, defaultFrequency: "weekly", availableFrequencies: ["weekly", "monthly", "one-time"] },
  { id: "lawn-fertilization", name: "Lawn Fertilization", categoryId: "lawn-landscape", category: "outdoor", tags: ["fertilizer", "grass", "treatment"], icon: "Sprout", descriptor: "Seasonal feeding & weed control programs", avgMonthlyPrice: 65, oneTimePrice: 85, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },
  { id: "tree-trimming", name: "Tree Trimming", categoryId: "lawn-landscape", category: "outdoor", tags: ["trees", "pruning", "landscaping"], icon: "TreePine", descriptor: "Safe pruning, shaping & dead wood removal", avgMonthlyPrice: 90, oneTimePrice: 200, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },
  { id: "shrub-hedge-trimming", name: "Shrub & Hedge Trimming", categoryId: "lawn-landscape", category: "outdoor", tags: ["shrubs", "hedges", "bushes"], icon: "Scissors", descriptor: "Shape & maintain bushes and borders", avgMonthlyPrice: 70, oneTimePrice: 120, defaultFrequency: "monthly", availableFrequencies: ["monthly", "quarterly", "one-time"] },
  { id: "irrigation-maintenance", name: "Irrigation Maintenance", categoryId: "lawn-landscape", category: "outdoor", tags: ["sprinklers", "irrigation", "water"], icon: "Droplets", descriptor: "Sprinkler checks, repairs & seasonal activation", avgMonthlyPrice: 75, oneTimePrice: 125, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },
  { id: "mulching-bed-care", name: "Mulching & Bed Care", categoryId: "lawn-landscape", category: "outdoor", tags: ["mulch", "beds", "garden"], icon: "Shovel", descriptor: "Fresh mulch, edging & flower bed upkeep", avgMonthlyPrice: 65, oneTimePrice: 110, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },
  { id: "leaf-debris-removal", name: "Leaf & Debris Removal", categoryId: "lawn-landscape", category: "outdoor", tags: ["leaves", "cleanup", "seasonal"], icon: "Wind", descriptor: "Seasonal cleanup & haul-away", avgMonthlyPrice: 55, oneTimePrice: 95, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },

  // ── Cleaning ──────────────────────────────
  { id: "house-cleaning", name: "House Cleaning", categoryId: "cleaning", category: "indoor", tags: ["cleaning", "home", "interior"], icon: "Sparkles", descriptor: "Recurring interior cleaning visits", popular: true, weeklyPrice: 320, avgMonthlyPrice: 180, oneTimePrice: 250, defaultFrequency: "monthly", availableFrequencies: ["weekly", "monthly", "quarterly", "one-time"] },
  { id: "deep-cleaning", name: "Deep Cleaning", categoryId: "cleaning", category: "indoor", tags: ["deep", "scrub", "cleaning"], icon: "Sparkles", descriptor: "Top-to-bottom thorough clean for any home", avgMonthlyPrice: 250, oneTimePrice: 350, defaultFrequency: "one-time", availableFrequencies: ["quarterly", "one-time"] },
  { id: "window-cleaning", name: "Window Cleaning", categoryId: "cleaning", category: "indoor", tags: ["windows", "glass", "streak-free"], icon: "SquareDashedBottom", descriptor: "Streak-free interior & exterior glass", avgMonthlyPrice: 80, oneTimePrice: 150, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },
  { id: "pressure-washing", name: "Pressure Washing", categoryId: "cleaning", category: "outdoor", tags: ["pressure", "driveway", "exterior"], icon: "Droplets", descriptor: "Driveways, patios, walkways & siding", popular: true, avgMonthlyPrice: 85, oneTimePrice: 200, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },
  { id: "floor-cleaning", name: "Floor Cleaning", categoryId: "cleaning", category: "indoor", tags: ["floors", "tile", "hardwood", "carpet"], icon: "Layers", descriptor: "Hardwood, tile & carpet deep clean", avgMonthlyPrice: 110, oneTimePrice: 175, defaultFrequency: "monthly", availableFrequencies: ["monthly", "quarterly", "one-time"] },
  { id: "carpet-cleaning", name: "Carpet Cleaning", categoryId: "cleaning", category: "indoor", tags: ["carpet", "steam", "stains"], icon: "Waves", descriptor: "Steam cleaning & stain treatment", avgMonthlyPrice: 120, oneTimePrice: 195, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },
  { id: "rental-turnover-cleaning", name: "Rental Turnover Cleaning", categoryId: "cleaning", category: "specialty", tags: ["rental", "turnover", "move-out"], icon: "KeyRound", descriptor: "Move-out deep clean & staging prep", avgMonthlyPrice: 200, oneTimePrice: 300, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "move-in-cleaning", name: "Move-In Cleaning", categoryId: "cleaning", category: "indoor", tags: ["move-in", "cleaning", "new home"], icon: "Home", descriptor: "Fresh start clean before you settle in", avgMonthlyPrice: 220, oneTimePrice: 300, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },

  // ── HVAC & Mechanical ─────────────────────
  { id: "ac-maintenance", name: "AC Maintenance", categoryId: "hvac-mechanical", category: "hvac", tags: ["ac", "cooling", "hvac"], icon: "Wind", descriptor: "Filter, coil & seasonal tune-up", popular: true, avgMonthlyPrice: 85, oneTimePrice: 150, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },
  { id: "heating-maintenance", name: "Heating Maintenance", categoryId: "hvac-mechanical", category: "hvac", tags: ["heating", "furnace", "hvac"], icon: "Flame", descriptor: "Furnace & heat pump seasonal service", avgMonthlyPrice: 85, oneTimePrice: 150, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },
  { id: "duct-cleaning", name: "Duct Cleaning", categoryId: "hvac-mechanical", category: "hvac", tags: ["ducts", "air quality", "hvac"], icon: "AirVent", descriptor: "Remove dust, allergens & buildup from ducts", avgMonthlyPrice: 150, oneTimePrice: 300, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "plumbing-repair", name: "Plumbing Repair", categoryId: "hvac-mechanical", category: "repairs", tags: ["plumbing", "pipes", "leaks"], icon: "Pipette", descriptor: "Leaks, clogs & fixture repairs", avgMonthlyPrice: 110, oneTimePrice: 185, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "water-heater-service", name: "Water Heater Service", categoryId: "hvac-mechanical", category: "hvac", tags: ["water heater", "tank", "hot water"], icon: "Thermometer", descriptor: "Flush, inspect & repair water heaters", avgMonthlyPrice: 90, oneTimePrice: 175, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "electrical-repair", name: "Electrical Repair", categoryId: "hvac-mechanical", category: "repairs", tags: ["electrical", "wiring", "outlets"], icon: "Zap", descriptor: "Outlets, switches & panel inspections", avgMonthlyPrice: 130, oneTimePrice: 225, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },

  // ── Repairs & Trades ──────────────────────
  { id: "handyman", name: "Handyman", categoryId: "repairs-trades", category: "repairs", tags: ["repairs", "installation", "odd jobs"], icon: "Wrench", descriptor: "Odd jobs, installs & minor repairs", popular: true, avgMonthlyPrice: 120, oneTimePrice: 165, defaultFrequency: "monthly", availableFrequencies: ["monthly", "one-time"] },
  { id: "appliance-repair", name: "Appliance Repair", categoryId: "repairs-trades", category: "repairs", tags: ["appliances", "washer", "dryer", "fridge"], icon: "Settings", descriptor: "Washers, dryers, refrigerators & more", avgMonthlyPrice: 95, oneTimePrice: 175, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "garage-door-repair", name: "Garage Door Repair", categoryId: "repairs-trades", category: "repairs", tags: ["garage", "door", "opener"], icon: "DoorOpen", descriptor: "Springs, openers & track alignment", avgMonthlyPrice: 90, oneTimePrice: 175, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "drywall-repair", name: "Drywall Repair", categoryId: "repairs-trades", category: "repairs", tags: ["drywall", "patching", "walls"], icon: "PaintBucket", descriptor: "Patch holes, cracks & water damage", avgMonthlyPrice: 85, oneTimePrice: 150, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "painting-interior", name: "Interior Painting", categoryId: "repairs-trades", category: "indoor", tags: ["painting", "walls", "interior"], icon: "Paintbrush", descriptor: "Full rooms, ceilings & accent walls", avgMonthlyPrice: 350, oneTimePrice: 500, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "painting-touch-ups", name: "Painting Touch-Ups", categoryId: "repairs-trades", category: "indoor", tags: ["paint", "touch-up", "scuffs"], icon: "Paintbrush", descriptor: "Scuffs, chips & small area refreshes", avgMonthlyPrice: 85, oneTimePrice: 135, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "tile-grout-repair", name: "Tile & Grout Repair", categoryId: "repairs-trades", category: "repairs", tags: ["tile", "grout", "bathroom", "kitchen"], icon: "Grid3X3", descriptor: "Re-grout, seal & replace damaged tiles", avgMonthlyPrice: 95, oneTimePrice: 175, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "door-window-repair", name: "Door & Window Repair", categoryId: "repairs-trades", category: "repairs", tags: ["doors", "windows", "frames", "seals"], icon: "RectangleHorizontal", descriptor: "Stuck doors, broken seals & hardware", avgMonthlyPrice: 80, oneTimePrice: 145, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },

  // ── Outdoor & Exterior ────────────────────
  { id: "pool-service", name: "Pool Service", categoryId: "outdoor-exterior", category: "outdoor", tags: ["pool", "water", "chemical"], icon: "Waves", descriptor: "Chemical balance & weekly cleaning", popular: true, weeklyPrice: 140, avgMonthlyPrice: 140, oneTimePrice: 225, defaultFrequency: "weekly", availableFrequencies: ["weekly", "monthly", "one-time"] },
  { id: "gutter-cleaning", name: "Gutter Cleaning", categoryId: "outdoor-exterior", category: "outdoor", tags: ["gutters", "cleaning", "roof"], icon: "Home", descriptor: "Clear debris & prevent water damage", avgMonthlyPrice: 75, oneTimePrice: 150, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },
  { id: "roof-inspection", name: "Roof Inspection", categoryId: "outdoor-exterior", category: "outdoor", tags: ["roof", "inspection", "leaks"], icon: "TriangleAlert", descriptor: "Catch issues before they become leaks", avgMonthlyPrice: 70, oneTimePrice: 175, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "fence-repair", name: "Fence Repair", categoryId: "outdoor-exterior", category: "outdoor", tags: ["fence", "posts", "gate"], icon: "Fence", descriptor: "Posts, panels & gate adjustments", avgMonthlyPrice: 95, oneTimePrice: 185, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "deck-patio-repair", name: "Deck & Patio Repair", categoryId: "outdoor-exterior", category: "outdoor", tags: ["deck", "patio", "wood", "staining"], icon: "Layers", descriptor: "Board replacement, staining & sealing", avgMonthlyPrice: 120, oneTimePrice: 225, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "driveway-repair", name: "Driveway Repair", categoryId: "outdoor-exterior", category: "outdoor", tags: ["driveway", "concrete", "asphalt", "cracks"], icon: "Construction", descriptor: "Crack filling, sealing & resurfacing", avgMonthlyPrice: 100, oneTimePrice: 200, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "exterior-painting", name: "Exterior Painting", categoryId: "outdoor-exterior", category: "outdoor", tags: ["painting", "exterior", "siding"], icon: "Paintbrush", descriptor: "Siding, trim, doors & shutters", avgMonthlyPrice: 400, oneTimePrice: 650, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "solar-panel-cleaning", name: "Solar Panel Cleaning", categoryId: "outdoor-exterior", category: "outdoor", tags: ["solar", "panels", "cleaning"], icon: "Sun", descriptor: "Restore panel output with safe rinse & wash", avgMonthlyPrice: 90, oneTimePrice: 175, defaultFrequency: "quarterly", availableFrequencies: ["quarterly", "one-time"] },

  // ── Specialty ─────────────────────────────
  { id: "pest-control", name: "Pest Control", categoryId: "specialty", category: "specialty", tags: ["bugs", "insects", "prevention"], icon: "Bug", descriptor: "Prevention & treatment plans", popular: true, avgMonthlyPrice: 55, oneTimePrice: 110, defaultFrequency: "monthly", availableFrequencies: ["monthly", "quarterly", "one-time"] },
  { id: "junk-removal", name: "Junk Removal", categoryId: "specialty", category: "specialty", tags: ["junk", "hauling", "removal"], icon: "Trash2", descriptor: "Haul away furniture, debris & clutter", avgMonthlyPrice: 80, oneTimePrice: 175, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "smart-home-setup", name: "Smart Home Setup", categoryId: "specialty", category: "specialty", tags: ["smart home", "devices", "installation"], icon: "Wifi", descriptor: "Thermostats, cameras, locks & hubs", avgMonthlyPrice: 120, oneTimePrice: 200, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "home-inspection", name: "Home Inspection", categoryId: "specialty", category: "specialty", tags: ["inspection", "assessment", "report"], icon: "Home", descriptor: "Full property condition assessment", avgMonthlyPrice: 150, oneTimePrice: 300, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "locksmith", name: "Locksmith", categoryId: "specialty", category: "specialty", tags: ["locks", "keys", "security"], icon: "KeyRound", descriptor: "Lock changes, rekeying & emergency access", avgMonthlyPrice: 75, oneTimePrice: 140, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
  { id: "trash-can-cleaning", name: "Trash Can Cleaning", categoryId: "specialty", category: "specialty", tags: ["trash", "bins", "sanitation"], icon: "Trash2", descriptor: "Sanitize & deodorize curbside bins", avgMonthlyPrice: 30, biMonthlyPrice: 35, quarterlyPrice: 45, oneTimePrice: 50, defaultFrequency: "monthly", availableFrequencies: ["monthly", "bi-monthly", "quarterly", "one-time"] },
  { id: "dumpster-cleaning", name: "Dumpster Cleaning", categoryId: "specialty", category: "specialty", tags: ["dumpster", "bins", "sanitation"], icon: "Trash2", descriptor: "Pressure-wash & deodorize commercial dumpsters", avgMonthlyPrice: 95, quarterlyPrice: 130, oneTimePrice: 150, defaultFrequency: "monthly", availableFrequencies: ["monthly", "quarterly", "one-time"] },
  { id: "general-contracting", name: "General Contracting", categoryId: "repairs-trades", category: "repairs", tags: ["remodel", "renovation", "contractor"], icon: "HardHat", descriptor: "Remodels, additions & multi-trade projects", avgMonthlyPrice: 500, oneTimePrice: 750, defaultFrequency: "one-time", availableFrequencies: ["one-time"] },
];

// ── Plan Builder subset ─────────────────────
// Services shown in the homepage plan builder (curated top-10)
export const PLAN_BUILDER_SERVICE_IDS = [
  "lawn-mowing", "trash-can-cleaning", "pool-service", "pressure-washing",
  "house-cleaning", "window-cleaning", "pest-control",
  "ac-maintenance", "handyman", "electrical-repair", "plumbing-repair",
];

// ─────────────────────────────────────────────
// ADD-ON SUGGESTIONS
// ─────────────────────────────────────────────
export const addOnSuggestions: Record<string, string[]> = {
  "lawn-mowing":           ["lawn-fertilization", "pest-control"],
  "lawn-fertilization":    ["lawn-mowing", "irrigation-maintenance"],
  "tree-trimming":         ["lawn-mowing", "leaf-debris-removal"],
  "shrub-hedge-trimming":  ["lawn-mowing", "mulching-bed-care"],
  "irrigation-maintenance":["lawn-mowing", "lawn-fertilization"],
  "mulching-bed-care":     ["lawn-mowing", "shrub-hedge-trimming"],
  "leaf-debris-removal":   ["gutter-cleaning", "lawn-mowing"],
  "house-cleaning":        ["window-cleaning", "floor-cleaning"],
  "deep-cleaning":         ["carpet-cleaning", "window-cleaning"],
  "window-cleaning":       ["pressure-washing", "house-cleaning"],
  "pressure-washing":      ["gutter-cleaning", "window-cleaning"],
  "floor-cleaning":        ["house-cleaning", "carpet-cleaning"],
  "carpet-cleaning":       ["floor-cleaning", "house-cleaning"],
  "rental-turnover-cleaning":["junk-removal", "painting-touch-ups"],
  "move-in-cleaning":      ["house-cleaning", "window-cleaning"],
  "ac-maintenance":        ["duct-cleaning", "heating-maintenance"],
  "heating-maintenance":   ["ac-maintenance", "duct-cleaning"],
  "duct-cleaning":         ["ac-maintenance", "pest-control"],
  "plumbing-repair":       ["water-heater-service", "handyman"],
  "water-heater-service":  ["plumbing-repair", "handyman"],
  "electrical-repair":     ["smart-home-setup", "garage-door-repair"],
  "handyman":              ["painting-touch-ups", "drywall-repair"],
  "appliance-repair":      ["plumbing-repair", "electrical-repair"],
  "garage-door-repair":    ["electrical-repair", "handyman"],
  "drywall-repair":        ["painting-interior", "handyman"],
  "painting-interior":     ["drywall-repair", "floor-cleaning"],
  "painting-touch-ups":    ["handyman", "drywall-repair"],
  "tile-grout-repair":     ["plumbing-repair", "handyman"],
  "door-window-repair":    ["handyman", "painting-touch-ups"],
  "pool-service":          ["pressure-washing", "pest-control"],
  "gutter-cleaning":       ["roof-inspection", "pressure-washing"],
  "roof-inspection":       ["gutter-cleaning", "pressure-washing"],
  "fence-repair":          ["handyman", "deck-patio-repair"],
  "deck-patio-repair":     ["fence-repair", "pressure-washing"],
  "driveway-repair":       ["pressure-washing", "fence-repair"],
  "exterior-painting":     ["pressure-washing", "deck-patio-repair"],
  "pest-control":          ["lawn-mowing", "gutter-cleaning"],
  "junk-removal":          ["rental-turnover-cleaning", "handyman"],
  "smart-home-setup":      ["electrical-repair", "locksmith"],
  "home-inspection":       ["roof-inspection", "pest-control"],
  "locksmith":             ["smart-home-setup", "handyman"],
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Get the display price for a service at a given frequency */
export function getServicePrice(service: Service, frequency: ServiceFrequency): number {
  if (frequency === "weekly" && service.weeklyPrice) return service.weeklyPrice;
  if (frequency === "bi-monthly" && service.biMonthlyPrice) return service.biMonthlyPrice;
  if (frequency === "quarterly" && service.quarterlyPrice) return service.quarterlyPrice;
  if (frequency === "one-time") return service.oneTimePrice;
  return service.avgMonthlyPrice;
}

/** Get the frequency options available for a service */
export function getAvailableFrequencies(service: Service): ServiceFrequency[] {
  return service.availableFrequencies || ["monthly", "quarterly", "one-time"];
}

/** Check if a frequency is recurring (not one-time) */
export function isRecurring(frequency: ServiceFrequency): boolean {
  return frequency !== "one-time";
}

export function getServicesByCategory(categoryId: string): Service[] {
  return services.filter((s) => s.categoryId === categoryId);
}

export function getSuggestedAddOns(selectedIds: string[]): Service[] {
  const suggestions = new Set<string>();
  selectedIds.forEach((id) => {
    const addOns = addOnSuggestions[id] || [];
    addOns.forEach((addOn) => {
      if (!selectedIds.includes(addOn)) suggestions.add(addOn);
    });
  });
  return Array.from(suggestions)
    .slice(0, 2)
    .map((id) => services.find((s) => s.id === id)!)
    .filter(Boolean);
}

export function getServiceById(id: string): Service | undefined {
  return services.find((s) => s.id === id);
}

export function getServiceByName(name: string): Service | undefined {
  return services.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

export function calculateSavings(selectedIds: string[], discountPercent: number): number {
  const total = selectedIds.reduce((sum, id) => {
    const service = services.find((s) => s.id === id);
    return sum + (service?.avgMonthlyPrice || 0);
  }, 0);
  return Math.round(total * (discountPercent / 100));
}
