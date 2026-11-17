// SYNTHETIC review data for the gated /mds profile gallery. Every business, offer, price,
// review and image here is fictional. Nothing is read from or written to a Marketplace backend,
// and nothing in this file is a production business record.

import type { ProfileAddon, ProfileData, ProfileMedia, ProfilePackage, ProfileTier } from "@/lib/providerProfile/model";
import { publicServiceAreas } from "@/lib/vendorServiceAreas";

// A synthetic coverage_areas readback. It mirrors the CFG-001 allowlist migration
// (20260927010000_cfg001_lee_county_coverage.sql); a unit test keeps the two in step.
const coverageByCity: Record<string, string[]> = {
  "Fort Myers": ["33901", "33905", "33907", "33908", "33912", "33913", "33916", "33919", "33966", "33967", "33965", "33902", "33906", "33994"],
  "North Fort Myers": ["33903", "33917", "33918"],
  "Cape Coral": ["33904", "33909", "33914", "33990", "33991", "33993", "33910", "33915"],
  Alva: ["33920"],
  Bokeelia: ["33922"],
  Estero: ["33928", "33929"],
  "Fort Myers Beach": ["33931", "33932"],
  "Lehigh Acres": ["33936", "33971", "33972", "33973", "33974", "33976", "33970"],
  "Saint James City": ["33956"],
  Sanibel: ["33957"],
  "Bonita Springs": ["34134", "34135", "34133", "34136"],
  "Boca Grande": ["33921"],
  Captiva: ["33924"],
  Pineland: ["33945"],
};

export const SYNTHETIC_COVERAGE_AREAS = Object.entries(coverageByCity)
  .flatMap(([city, zips]) => zips.map((zip_code) => ({ zip_code, city })));

const marketplaceZips = SYNTHETIC_COVERAGE_AREAS.map((area) => area.zip_code);

/** A synthetic services_catalog readback. */
export const SYNTHETIC_SERVICE_NAMES: Record<string, string> = {
  "trash-can-cleaning": "Trash can cleaning",
  "pressure-washing": "Pressure washing",
  "window-cleaning": "Window cleaning",
  "gutter-cleaning": "Gutter cleaning",
  "roof-cleaning": "Roof cleaning",
  "bathroom-remodeling": "Bathroom remodeling",
  "kitchen-remodeling": "Kitchen remodeling",
  "drywall-repair": "Drywall repair",
  "interior-painting": "Interior painting",
  handyman: "Handyman",
  "seasonal-home-watch": "Whole-property seasonal home watch and storm preparation visits",
  "landscape-maintenance": "Landscape maintenance, irrigation checks and palm trimming",
};

// ---------------------------------------------------------------------------------------------
// Illustrations and logos: inline SVG, so no synthetic file is published under /public.
// ---------------------------------------------------------------------------------------------

const svg = (width: number, height: number, body: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`)}`;

const sky = `<rect width="1200" height="675" fill="#eef3ee"/><circle cx="1010" cy="130" r="64" fill="#f6dccf"/>`;
const palm = (x: number, y: number) =>
  `<rect x="${x - 7}" y="${y - 190}" width="14" height="190" rx="7" fill="#8a7a66"/><g fill="#4f8a69"><ellipse cx="${x - 58}" cy="${y - 196}" rx="64" ry="18" transform="rotate(-18 ${x - 58} ${y - 196})"/><ellipse cx="${x + 58}" cy="${y - 196}" rx="64" ry="18" transform="rotate(18 ${x + 58} ${y - 196})"/><ellipse cx="${x - 30}" cy="${y - 232}" rx="56" ry="16" transform="rotate(-52 ${x - 30} ${y - 232})"/><ellipse cx="${x + 30}" cy="${y - 232}" rx="56" ry="16" transform="rotate(52 ${x + 30} ${y - 232})"/></g>`;
const house = `<rect x="560" y="210" width="640" height="300" fill="#fbf8f2"/><polygon points="520,210 880,70 1240,210" fill="#c9b8a4"/><rect x="820" y="290" width="300" height="220" rx="6" fill="#e3dfd6"/><g stroke="#cfc9bd" stroke-width="4"><line x1="820" y1="345" x2="1120" y2="345"/><line x1="820" y1="400" x2="1120" y2="400"/><line x1="820" y1="455" x2="1120" y2="455"/></g><rect x="620" y="300" width="120" height="130" rx="6" fill="#cfe0e6"/>`;
const bin = (x: number) =>
  `<rect x="${x}" y="330" width="130" height="210" rx="14" fill="#2f3a40"/><rect x="${x - 10}" y="306" width="150" height="34" rx="12" fill="#3b484f"/><circle cx="${x + 26}" cy="548" r="20" fill="#1f272b"/><circle cx="${x + 104}" cy="548" r="20" fill="#1f272b"/><g fill="#cfe0e6"><circle cx="${x + 36}" cy="390" r="6"/><circle cx="${x + 82}" cy="430" r="5"/><circle cx="${x + 54}" cy="474" r="6"/></g>`;

const scenes = {
  bins: `${sky}${house}${palm(150, 520)}<rect y="510" width="1200" height="165" fill="#d9d4c8"/><rect y="510" width="1200" height="14" fill="#c8c2b4"/>${bin(330)}${bin(500)}<rect x="0" y="560" width="290" height="115" fill="#8fbf9f"/>`,
  binsDetail: `<rect width="1200" height="675" fill="#e6efe9"/><rect y="470" width="1200" height="205" fill="#d9d4c8"/><rect x="400" y="150" width="400" height="390" rx="26" fill="#2f3a40"/><rect x="372" y="104" width="456" height="70" rx="24" fill="#3b484f"/><g fill="#cfe0e6"><circle cx="480" cy="250" r="12"/><circle cx="640" cy="300" r="10"/><circle cx="560" cy="390" r="12"/><circle cx="710" cy="440" r="9"/></g><path d="M120 210 C 250 250, 300 330, 396 360" stroke="#9fc4d4" stroke-width="16" fill="none" stroke-linecap="round" stroke-dasharray="4 30"/>`,
  bathroom: `<rect width="1200" height="675" fill="#f4f1ea"/><g stroke="#e2ddd2" stroke-width="3">${Array.from({ length: 7 }, (_, row) => `<line x1="0" y1="${60 + row * 60}" x2="1200" y2="${60 + row * 60}"/>`).join("")}${Array.from({ length: 11 }, (_, column) => `<line x1="${100 + column * 100}" y1="0" x2="${100 + column * 100}" y2="450"/>`).join("")}</g><rect x="130" y="90" width="330" height="250" rx="10" fill="#cfe0e6"/><rect x="100" y="400" width="520" height="200" rx="8" fill="#c9a77e"/><rect x="80" y="380" width="560" height="32" rx="6" fill="#fbf8f2"/><g fill="#a98860"><rect x="130" y="440" width="210" height="130" rx="6"/><rect x="380" y="440" width="210" height="130" rx="6"/></g><rect x="352" y="300" width="14" height="84" rx="7" fill="#2f3a40"/><rect x="300" y="300" width="66" height="14" rx="7" fill="#2f3a40"/><rect x="760" y="60" width="340" height="560" rx="10" fill="#e8f0f2" stroke="#b9c7cc" stroke-width="6"/><rect x="900" y="110" width="110" height="16" rx="8" fill="#2f3a40"/><rect x="0" y="600" width="1200" height="75" fill="#ddd6c8"/>`,
  kitchen: `<rect width="1200" height="675" fill="#f4f1ea"/><g fill="#5f7f6c"><rect x="80" y="70" width="230" height="210" rx="6"/><rect x="330" y="70" width="230" height="210" rx="6"/><rect x="640" y="70" width="230" height="210" rx="6"/><rect x="890" y="70" width="230" height="210" rx="6"/></g><rect x="60" y="390" width="1080" height="34" rx="6" fill="#fbf8f2"/><g fill="#5f7f6c"><rect x="80" y="430" width="330" height="190" rx="6"/><rect x="430" y="430" width="330" height="190" rx="6"/><rect x="780" y="430" width="340" height="190" rx="6"/></g><rect x="520" y="300" width="150" height="90" rx="10" fill="#c9cfd2"/><rect x="0" y="620" width="1200" height="55" fill="#ddd6c8"/>`,
  driveway: `${sky}${house}${palm(190, 520)}<rect y="510" width="1200" height="165" fill="#b9b3a6"/><polygon points="420,675 700,510 1010,510 1200,675" fill="#eee9dd"/><g stroke="#d8d2c4" stroke-width="4"><line x1="560" y1="592" x2="1105" y2="592"/><line x1="640" y1="548" x2="1055" y2="548"/><line x1="480" y1="640" x2="1160" y2="640"/></g><path d="M250 470 C 330 520, 380 560, 470 610" stroke="#9fc4d4" stroke-width="14" fill="none" stroke-linecap="round" stroke-dasharray="4 26"/>`,
  windows: `${sky}<rect x="140" y="150" width="920" height="400" fill="#fbf8f2"/><polygon points="90,150 600,30 1110,150" fill="#c9b8a4"/><g fill="#cfe0e6" stroke="#b9c7cc" stroke-width="6"><rect x="220" y="230" width="170" height="210" rx="6"/><rect x="515" y="230" width="170" height="210" rx="6"/><rect x="810" y="230" width="170" height="210" rx="6"/></g><g stroke="#ffffff" stroke-width="8" stroke-linecap="round"><line x1="250" y1="290" x2="300" y2="250"/><line x1="545" y1="290" x2="595" y2="250"/><line x1="840" y1="290" x2="890" y2="250"/></g><rect y="550" width="1200" height="125" fill="#8fbf9f"/>`,
  general: `${sky}${house}${palm(170, 520)}${palm(420, 520)}<rect y="510" width="1200" height="165" fill="#8fbf9f"/><rect x="760" y="510" width="420" height="165" fill="#d9d4c8"/>`,
};

const illustration = (scene: keyof typeof scenes) => svg(1200, 675, scenes[scene]);

const wideLogo = svg(520, 130, `<rect width="520" height="130" fill="#ffffff"/><rect x="18" y="26" width="64" height="78" rx="10" fill="#256346"/><rect x="10" y="18" width="80" height="18" rx="8" fill="#1d5038"/><circle cx="50" cy="68" r="14" fill="#cfe8da"/><text x="112" y="72" font-family="Arial, Helvetica, sans-serif" font-size="52" font-weight="700" fill="#1f2a37" letter-spacing="1">BRIGHTBIN</text><text x="114" y="106" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="600" fill="#256346" letter-spacing="6">CAN CARE</text>`);
const tallLogo = svg(220, 300, `<rect width="220" height="300" fill="#ffffff"/><path d="M110 14 L204 52 V150 C204 214 164 262 110 286 C56 262 16 214 16 150 V52 Z" fill="#26313d"/><path d="M110 70 L160 110 V182 H60 V110 Z" fill="#f4f1ea"/><rect x="96" y="140" width="28" height="42" fill="#c8643f"/><text x="110" y="236" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="17" font-weight="700" fill="#f4f1ea" letter-spacing="1">HARBORLINE</text>`);
const squareLogo = svg(240, 240, `<rect width="240" height="240" fill="#ffffff"/><circle cx="120" cy="120" r="104" fill="#e6efe9" stroke="#256346" stroke-width="8"/><path d="M120 190 V98" stroke="#256346" stroke-width="10" stroke-linecap="round"/><g fill="#3f7f5c"><ellipse cx="86" cy="96" rx="46" ry="14" transform="rotate(-24 86 96)"/><ellipse cx="154" cy="96" rx="46" ry="14" transform="rotate(24 154 96)"/><ellipse cx="102" cy="68" rx="40" ry="12" transform="rotate(-58 102 68)"/><ellipse cx="138" cy="68" rx="40" ry="12" transform="rotate(58 138 68)"/></g>`);

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

let order = 0;
const tier = (id: string, name: string, price: number, extra: Partial<ProfileTier> = {}): ProfileTier =>
  ({ id, name, price, sort_order: order++, ...extra });
const addon = (id: string, name: string, price: number, extra: Partial<ProfileAddon> = {}): ProfileAddon =>
  ({ id, name, price, sort_order: order++, ...extra });
const pkg = (id: string, service_id: string, name: string, extra: Partial<ProfilePackage> = {}): ProfilePackage => ({
  id, service_id, name, description: null, pricing_mode: "fixed", default_frequency: "one-time", deposit_amount: null,
  is_active: true, needs_review: false, sort_order: order++, included_scope: [], tiers: [], addons: [], ...extra,
});
const media = (id: string, scene: keyof typeof scenes, caption: string, service_id: string | null = null): ProfileMedia =>
  ({ id, image_url: illustration(scene), caption, sort_order: order++, service_id });
const areasFor = (zips: string[]) => ({ areas: publicServiceAreas(zips, SYNTHETIC_COVERAGE_AREAS), hasListedZips: zips.length > 0 });

export type ProfileScenario = {
  slug: string;
  title: string;
  summary: string;
  data: ProfileData;
  /** Deep links worth trying in review. */
  links: { label: string; query: string; note: string }[];
};

// ---------------------------------------------------------------------------------------------
// 1. Fixed-price provider with package scope and optional extras
// ---------------------------------------------------------------------------------------------

const brightbin: ProfileScenario = {
  slug: "brightbin-can-care",
  title: "Fixed-price provider",
  summary: "Wide wordmark. One-time and recurring packages with scope, optional extras, service media, questions and reviews.",
  data: {
    provider: {
      id: "synthetic-brightbin", name: "Brightbin Can Care", logo_url: wideLogo, location: "Cape Coral, FL",
      tagline: "Curbside trash can cleaning with the package spelled out.",
      bio: "Brightbin Can Care is a fictional two-person crew that washes and deodorizes curbside trash and recycling cans at the home. Packages list how many cans are covered, so the price on the page is the price for that scope.",
      badges: ["Licensed", "Insured", "Top Rated"],
    },
    serviceNames: SYNTHETIC_SERVICE_NAMES,
    packages: [
      pkg("bb-one-time", "trash-can-cleaning", "One-time can cleaning", {
        description: "A single wash, rinse and deodorize visit on your collection day.",
        included_scope: ["Up to 2 cans"],
        tiers: [tier("bb-one-time-t", "Standard", 45)],
        addons: [
          addon("bb-extra-can", "Extra can", 12, { unit_label: "can", max_quantity: 4 }),
          addon("bb-deodorize", "Citrus deodorizing treatment", 8, { description: "Applied to every can in the visit." }),
        ],
      }),
      pkg("bb-empty", "trash-can-cleaning", "Empty and clean", {
        description: "For cans that still hold loose debris. The crew empties, bags and then cleans them.",
        included_scope: ["Up to 2 cans, emptied and cleaned"],
        tiers: [tier("bb-empty-t", "Standard", 85)],
      }),
      pkg("bb-plan", "trash-can-cleaning", "Scheduled can cleaning", {
        description: "The same cleaning on a repeating schedule.",
        default_frequency: "monthly",
        included_scope: ["Up to 2 cans per visit"],
        tiers: [tier("bb-plan-monthly", "Monthly", 30, { frequency: "monthly" }), tier("bb-plan-quarterly", "Quarterly", 38, { frequency: "quarterly" })],
        addons: [addon("bb-plan-extra", "Extra can", 10, { unit_label: "can", max_quantity: 4 })],
      }),
    ],
    media: [
      media("bb-m1", "bins", "Illustration: two cans rinsed and set back at the curb.", "trash-can-cleaning"),
      media("bb-m2", "binsDetail", "Illustration: the inside of a can after the wash.", "trash-can-cleaning"),
    ],
    reviews: {
      summary: { count: 3, average: 4.7 },
      reviews: [
        { id: "bb-r1", rating: 5, comment: "Synthetic review. Both cans were cleaned on collection day and set back by the garage.", created_at: "2026-10-12T14:00:00Z", edited: false },
        { id: "bb-r2", rating: 5, comment: "Synthetic review. The extra recycling can was added without any confusion about the price.", created_at: "2026-09-28T14:00:00Z", edited: false },
        { id: "bb-r3", rating: 4, comment: "Synthetic review. Arrived later in the window than expected, but the work was thorough.", created_at: "2026-09-03T14:00:00Z", edited: true },
      ],
    },
    serviceArea: areasFor(["33904", "33990", "33914", "33915"]),
    marketplaceZips,
    questions: [
      { id: "bb-q1", service_id: "trash-can-cleaning", question: "How many cans are included?", answer: "Each package covers up to two cans. An extra can is $12 for the one-time package and $10 per visit on a schedule.", source: "provider" },
      { id: "bb-q2", service_id: "trash-can-cleaning", question: "Do the cans need to be empty?", answer: "Yes for the standard packages. Choose Empty and clean if they still hold loose debris.", source: "provider" },
      { id: "bb-q3", service_id: "trash-can-cleaning", question: "When is the price confirmed?", answer: "The price shown is the published package price. Your request step confirms the service address, any extras and applicable charges before anything is booked.", source: "marketplace" },
    ],
  },
  links: [
    { label: "All services", query: "", note: "A direct business link opens the whole business." },
    { label: "Trash can cleaning", query: "?service=trash-can-cleaning", note: "An explicit service link opens that service." },
    { label: "Pressure washing (not offered)", query: "?service=pressure-washing", note: "A catalog service this provider does not publish." },
    { label: "Unknown service", query: "?service=retired-service", note: "A link to a service that no longer exists." },
  ],
};

// ---------------------------------------------------------------------------------------------
// 2. Quote-only provider with several services
// ---------------------------------------------------------------------------------------------

const harborline: ProfileScenario = {
  slug: "harborline-remodeling",
  title: "Quote-only provider",
  summary: "Tall emblem. Four quoted services: plain quotes, published estimates and a deposit. No public reviews yet. Broad coverage.",
  data: {
    provider: {
      id: "synthetic-harborline", name: "Harborline Remodeling & Repair", logo_url: tallLogo, location: "North Fort Myers, FL",
      tagline: null,
      bio: "Harborline Remodeling & Repair is a fictional remodeling contractor. Every job starts with a walkthrough so the scope and price reflect the home.",
      badges: ["Licensed", "Insured"],
    },
    serviceNames: SYNTHETIC_SERVICE_NAMES,
    packages: [
      pkg("hl-bath", "bathroom-remodeling", "Bathroom remodeling", {
        pricing_mode: "custom_quote", description: "Start with a walkthrough to discuss layout, fixtures and finishes.",
        included_scope: ["Walkthrough and written scope"],
      }),
      pkg("hl-tub", "bathroom-remodeling", "Tub-to-shower conversion", {
        pricing_mode: "custom_quote", description: "Replace an existing tub with a tiled walk-in shower.",
        tiers: [tier("hl-tub-t", "Estimate", 6500, { price_kind: "range", price_max: 11000 })],
      }),
      pkg("hl-kitchen", "kitchen-remodeling", "Kitchen remodeling", {
        pricing_mode: "custom_quote", description: "Cabinets, counters and layout changes, planned after measuring the room.",
        tiers: [tier("hl-kitchen-t", "Estimate", 14000, { price_kind: "starting_at" })],
      }),
      pkg("hl-drywall", "drywall-repair", "Drywall repair", {
        pricing_mode: "custom_quote", description: "Patches, water damage and texture matching.",
      }),
      pkg("hl-paint", "interior-painting", "Interior painting", {
        pricing_mode: "deposit_quote", deposit_amount: 150, description: "Walls, ceilings and trim, quoted by room.",
      }),
    ],
    media: [
      media("hl-m1", "bathroom", "Illustration: a vanity wall and glass shower enclosure.", "bathroom-remodeling"),
      media("hl-m2", "kitchen", "Illustration: painted cabinets along a kitchen wall.", "kitchen-remodeling"),
      media("hl-m3", "general", "Illustration: a home exterior. General business image."),
    ],
    reviews: { summary: { count: 0, average: null }, reviews: [] },
    serviceArea: areasFor(["33903", "33917", "33918", "33901", "33905", "33916", "33919", "33904", "33909", "33990", "33991", "33993", "33936", "33971", "33920"]),
    marketplaceZips,
    questions: [
      { id: "hl-q1", service_id: "bathroom-remodeling", question: "Why is there no price on this page?", answer: "Remodeling depends on the room. The provider prices the job after a walkthrough, and you review the written quote before anything is booked.", source: "marketplace" },
      { id: "hl-q2", service_id: "bathroom-remodeling", question: "What should I have ready for the walkthrough?", answer: "Clear access to the bathroom, and any fixtures or finishes you have already chosen.", source: "provider" },
    ],
  },
  links: [
    { label: "All services", query: "", note: "Four services listed without answering the prompt." },
    { label: "Bathroom remodeling", query: "?service=bathroom-remodeling", note: "Two quoted offers, one with a published range." },
    { label: "Interior painting", query: "?service=interior-painting", note: "Deposit shown apart from the quote. General media, labelled." },
  ],
};

// ---------------------------------------------------------------------------------------------
// 3. Mixed provider: fixed-price and quoted services
// ---------------------------------------------------------------------------------------------

const palmetto: ProfileScenario = {
  slug: "palmetto-exterior-care",
  title: "Mixed fixed and quoted provider",
  summary: "Square emblem. Answer-based levels, a required extra, a range-priced extra, a recurring cadence and a quoted service. Withdrawn offers stay hidden.",
  data: {
    provider: {
      id: "synthetic-palmetto", name: "Palmetto Exterior Care", logo_url: squareLogo, location: "Fort Myers, FL",
      tagline: "Windows, gutters and pressure washing for single-family homes.",
      bio: "Palmetto Exterior Care is a fictional exterior-cleaning company. Window and gutter work is sold as published packages; pressure washing is quoted after seeing the surfaces.",
      badges: ["Insured"],
    },
    serviceNames: SYNTHETIC_SERVICE_NAMES,
    packages: [
      pkg("pe-windows", "window-cleaning", "Exterior window cleaning", {
        description: "Glass, frames and sills on the outside of the home.",
        included_scope: ["Exterior glass, frames and sills"],
        tiers: [
          tier("pe-windows-s", "Up to 15 windows", 140, { rule_question_key: "window_count", includes: ["Up to 15 windows"] }),
          tier("pe-windows-l", "16 to 30 windows", 220, { rule_question_key: "window_count", includes: ["16 to 30 windows"] }),
        ],
        addons: [
          addon("pe-screens", "Screen rinse", 20, { is_required: true, description: "Screens are removed, rinsed and refitted." }),
          addon("pe-interior", "Interior glass", 60, { price_kind: "range", price_max: 120, description: "Priced by window count." }),
        ],
      }),
      pkg("pe-gutters", "gutter-cleaning", "Gutter clean-out", {
        description: "Debris removed by hand and downspouts flushed.",
        included_scope: ["Single-story home, up to 150 linear feet"],
        tiers: [tier("pe-gutters-once", "One-time", 160), tier("pe-gutters-qtr", "Quarterly", 130, { frequency: "quarterly" })],
        addons: [addon("pe-guards", "Gutter guard rinse", 35)],
      }),
      pkg("pe-pressure", "pressure-washing", "Driveway and walkway washing", {
        pricing_mode: "custom_quote", description: "Concrete and paver surfaces, quoted after seeing the area.",
        tiers: [tier("pe-pressure-t", "Estimate", 180, { price_kind: "starting_at" })],
      }),
      // Never shown: a withdrawn offer and one still under review.
      pkg("pe-roof", "roof-cleaning", "Roof soft wash", { is_active: false, tiers: [tier("pe-roof-t", "Standard", 400)] }),
      pkg("pe-pressure-flat", "pressure-washing", "Flat-rate patio wash", { needs_review: true, tiers: [tier("pe-flat-t", "Standard", 95)] }),
    ],
    media: [
      media("pe-m1", "windows", "Illustration: front windows after an exterior clean.", "window-cleaning"),
      media("pe-m2", "driveway", "Illustration: a driveway with one washed section.", "pressure-washing"),
      media("pe-m3", "general", "Illustration: a home exterior. General business image."),
    ],
    reviews: {
      summary: { count: 2, average: 4.5 },
      reviews: [
        { id: "pe-r1", rating: 5, comment: "Synthetic review. The quote for the driveway matched what was done.", created_at: "2026-10-20T14:00:00Z", edited: false },
        { id: "pe-r2", rating: 4, comment: null, created_at: "2026-10-02T14:00:00Z", edited: false },
      ],
    },
    serviceArea: areasFor(["33901", "33907", "33919"]),
    marketplaceZips,
    questions: [
      { id: "pe-q1", service_id: "window-cleaning", question: "How is the window price set?", answer: "By the number of windows you enter in the request step. The page shows the starting price with the required screen rinse included.", source: "provider" },
      { id: "pe-q2", service_id: "pressure-washing", question: "Is the estimate the final price?", answer: "No. The estimate is a published starting point. The provider confirms the price after seeing the surfaces.", source: "marketplace" },
    ],
  },
  links: [
    { label: "All services", query: "", note: "Three services; the withdrawn roof offer is absent." },
    { label: "Window cleaning", query: "?service=window-cleaning", note: "Starting price, required extra and a range-priced extra." },
    { label: "Gutter cleaning", query: "?service=gutter-cleaning", note: "One-time and quarterly cadences with separate billing labels." },
    { label: "Pressure washing", query: "?service=pressure-washing", note: "Quoted, with a qualified estimate." },
    { label: "Roof cleaning (withdrawn)", query: "?service=roof-cleaning", note: "A link to an offer the provider has withdrawn." },
  ],
};

// ---------------------------------------------------------------------------------------------
// 4. Sparse profile
// ---------------------------------------------------------------------------------------------

const northside: ProfileScenario = {
  slug: "northside-handyman",
  title: "Sparse profile",
  summary: "No logo, story, media or reviews. One quoted service. No service ZIP codes listed, so a ZIP check is unknown.",
  data: {
    provider: { id: "synthetic-northside", name: "Northside Handyman", logo_url: null, location: null, tagline: null, bio: null, badges: [] },
    serviceNames: SYNTHETIC_SERVICE_NAMES,
    packages: [pkg("ns-repairs", "handyman", "Small home repairs", { pricing_mode: "custom_quote" })],
    media: [],
    reviews: { summary: { count: 0, average: null }, reviews: [] },
    serviceArea: areasFor([]),
    marketplaceZips,
    questions: [],
  },
  links: [
    { label: "All services", query: "", note: "A compact page built only from identity and one offer." },
    { label: "Handyman", query: "?service=handyman", note: "A quote with no media and no published questions." },
  ],
};

// ---------------------------------------------------------------------------------------------
// 5. Long names with failed supporting reads
// ---------------------------------------------------------------------------------------------

const caloosa: ProfileScenario = {
  slug: "caloosa-riverbend-property-care",
  title: "Long names and failed reads",
  summary: "Very long business and service names. The logo and photo fail to load, and the review and coverage reads fail.",
  data: {
    provider: {
      id: "synthetic-caloosa",
      name: "Caloosa Riverbend Property Maintenance, Landscaping & Seasonal Home Watch Services of Southwest Florida",
      logo_url: "/mds/profiles/synthetic-missing-logo.png", location: "Fort Myers Beach, FL",
      tagline: "Year-round property care for owners who are away for part of the year.",
      bio: "A fictional property-care company with a deliberately long name, used to check wrapping at narrow widths and large text sizes.",
      badges: [],
    },
    serviceNames: SYNTHETIC_SERVICE_NAMES,
    packages: [
      pkg("cr-watch", "seasonal-home-watch", "Weekly interior and exterior home watch visit with photo report", {
        default_frequency: "weekly", included_scope: ["One visit per week, interior and exterior checklist"],
        tiers: [tier("cr-watch-w", "Weekly", 55, { frequency: "weekly" }), tier("cr-watch-b", "Every two weeks", 65, { frequency: "bi-monthly" })],
        addons: [addon("cr-storm", "Storm shutter check before a named storm", 40)],
      }),
      pkg("cr-landscape", "landscape-maintenance", "Landscape maintenance, irrigation check and palm trimming plan", { pricing_mode: "custom_quote" }),
    ],
    media: [{ id: "cr-m1", image_url: "/mds/profiles/synthetic-missing-photo.jpg", caption: "A photo that fails to load.", sort_order: 0, service_id: "seasonal-home-watch" }],
    reviews: null,
    serviceArea: null,
    marketplaceZips: null,
    questions: [],
  },
  links: [
    { label: "All services", query: "", note: "Long names wrap. Reviews and coverage report that they could not be read." },
    { label: "Seasonal home watch", query: "?service=seasonal-home-watch", note: "Weekly and every-two-weeks cadences, with a broken photo." },
  ],
};

export const PROFILE_SCENARIOS: readonly ProfileScenario[] = [brightbin, harborline, palmetto, northside, caloosa];

export function profileScenario(slug: string) {
  return PROFILE_SCENARIOS.find((scenario) => scenario.slug === slug);
}

/** ZIPs worth trying in the service-area check. */
export const ZIP_EXAMPLES = [
  { zip: "33904", note: "listed by Brightbin" },
  { zip: "33901", note: "in the Marketplace area, not listed by Brightbin" },
  { zip: "33955", note: "outside the Marketplace area" },
] as const;
