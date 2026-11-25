# /services Option C redesign (TRACE-161) — 2026-11-24 ET

**Owner instruction (2026-11-24 ET):** implement the Option C reference for `/services` with live catalog data and commercially licensed stock photos; defer the dedicated Plan Builder and keep existing builder behavior and entry points; open one draft PR for Josh's review.
**Base:** `main` `afa0be8`. **Branch:** `claude/services-option-c-redesign`.
**Status:** implemented, not reviewed or released. Photos `pending_owner_review`.

## 1. Characterized before the change

- `/services` was one client component: its catalog appeared only after the browser read finished (a spinner in the initial HTML), and its only metadata was the site default title.
- Category filters were local state, with one link per service to `earlyAccessHref([id])` (`/early-access?service=<id>`), named "Join early access for <name>".
- There is **no service detail route** (`/services/[id]` does not exist). `/request?service=<id>` exists but is booking-gated, and `early-access.spec.ts` requires that `/services` carry no `/request` link.
- When the browser read failed, the hook substituted the static fallback catalog marked `sourcing`, so the page showed every service as "Not available yet" without saying anything had failed.
- No public page sets a canonical URL or `metadataBase`.
- Hosted catalog (read-only, 2026-11-24): 78 active services in 6 active categories; one service has an empty description. `lawn-mowing` "Lawn Care", `house-cleaning` "House Cleaning", `pool-service` "Pool Service" and `handyman` "Handyman" are active.

## 2. What changed

| Area | Change |
|---|---|
| Hero | H1 "Explore home services in Lee County", the requested supporting copy, "Join early access" → `/early-access` (unchanged), "Browse all services" → `#all-services` (`scroll-mt-24` clears the 64 px sticky header). Photo panel from 1024 px; a 2:1 banner below the actions on smaller screens. |
| Featured | Four equal 3:2 cards; 4 columns from 1024 px, 2 from 360 px, 1 below. Whole card is one link with a focus ring; photo `alt=""`; one "Representative photos" caption. |
| Catalog | "All home services"; the same category filters (now `aria-pressed`); compact rows with icon, name, description when present, price or availability when the browser read supports it, and the existing early-access link. |
| Closing | One block, "Want to know when booking opens?", with the existing early-access link. The "Mercurius Standard" panel and the dark CTA band were removed. |
| Initial HTML | `page.tsx` is a server component (`dynamic = "force-dynamic"`). An anonymous, cookie-less read of active `service_categories` and `services_catalog` (the rows the browser already reads under RLS) puts every name, description and link in the HTML. A failed read falls back to the previous browser-only behavior. |
| Icons | Resolved on the server from the catalog's Lucide name; the client no longer imports the whole icon set. |
| States | Loading: rows from the server read plus "Checking current pricing and availability…" (spinner only if the server read failed). Error: an alert with "Try again"; rows stay with no price or availability claim. Empty category: message and "Show all services". |
| Metadata | Title "Home services in Lee County \| Mercurius Marketplace" and a description. URL unchanged; canonical behavior unchanged (none). |

## 3. Service destinations (verified 2026-11-24)

| Card | Catalog id (hosted, active) | Destination | Note |
|---|---|---|---|
| Lawn Care | `lawn-mowing` | `/early-access?service=lawn-mowing` | No detail page exists |
| House Cleaning | `house-cleaning` | `/early-access?service=house-cleaning` | No detail page exists |
| Pool Service | `pool-service` | `/early-access?service=pool-service` | No detail page exists |
| Handyman | `handyman` | `/early-access?service=handyman` | No detail page exists |

**Flag (D-1):** none of the four has a service detail URL; each uses the existing direct URL that preselects that service in the early-access form. The reference's "View details" label is therefore not used: rows keep "Join early access" (accessible name "Join early access for <name>") because the link does not open details. A detail page needs its own slice.

## 4. Photos

Pipeline: `scripts/build-services-page-imagery.mjs` (same rules as the provider-profile pipeline: SHA-256 of each reviewed source must match the manifest; no enlargement) writes WebP crops to `public/images/services-page/`; `<img srcset>` with intrinsic `width`/`height`, so boxes are reserved. Record: [`docs/imagery/services-page-imagery-manifest.json`](../docs/imagery/services-page-imagery-manifest.json).

| Use | Source | Creator | Licence |
|---|---|---|---|
| Hero | https://www.pexels.com/photo/facade-of-a-house-12558933/ | Christopher Moon | Pexels License |
| Lawn Care | https://www.pexels.com/photo/a-person-mowing-the-lawn-6728926/ | Magic K | Pexels License |
| House Cleaning | https://www.pexels.com/photo/man-cleaning-a-counter-top-15293006/ | Jason Deines | Pexels License |
| Pool Service | https://www.pexels.com/photo/swimming-pool-in-a-backyard-15948530/ | Mia Dalisay | Pexels License |
| Handyman | https://www.pexels.com/photo/hands-using-a-drill-1249609/ | Bidvine | Pexels License |

Pexels License (https://www.pexels.com/license/, read 2026-11-24): free to use including commercially, modification allowed, attribution not required; restrictions recorded in the manifest. Each photo page showed the creator and "Free" linking to the licence.

Review notes: the suggested Lawn Care candidate (15131952, a dark wooded park with a string trimmer) was replaced, and 4162011 was rejected because its operator is barefoot; the hero is Pexels-tagged "Palm Beach" and the pool "Bali Villa", so no copy or alt text names a place; the drill has no readable logo but resembles a known brand's colours; the hand-with-watch crop leaves the watch out.

## 5. SEO findings

- One H1; section headings "Featured services", "All home services", "Want to know when booking opens?"; each service name is an H3 in its row.
- Service destinations are ordinary `<a href>` links in the initial HTML.
- Still client-side: price, quote and availability lines and the coverage count. They depend on the provider-listing and package-eligibility rules in `useServiceCatalog`, which run against several tables and an RPC in the browser; moving them to the server is a broader data change.
- Not changed: no canonical URL or `metadataBase` exists site-wide (F-1). Adding one needs the production origin decided once in the root layout.

## 6. Evidence

Local, 2026-11-24 ET, on `claude/services-option-c-redesign`. Browser runs used a production build against the synthetic fixture (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831`), as CI does; `.env.local` targets production and was not used to run the app.

**6.1 Checks.** Secret scan pass; `npm run lint` pass; `npm run typecheck` pass; unit 84 files / 1,383 tests pass (new `services-page.test.ts` 17); `npm run build` pass (`/services` dynamic).

**6.2 Browser (`services-page.spec.ts`, 12 tests).** Initial HTML (one H1, title and description, no canonical, featured and row links, every name and description, no `/request` link); at 1440×900 and 390×844: both actions and the featured heading on the first screen, 4 / 2 equal card columns, 3:2 photos with empty alt, price/quote/unavailable lines, layout shift < 0.05, every photo decoded, no horizontal overflow, axe (WCAG 2.2 AA tags) clean; "Browse all services" lands the heading clear of the sticky header and the next Tab reaches the first filter; a filter narrows the rows and the empty category offers "Show all services"; Pool Service opened by keyboard with a visible focus ring lands on `/early-access?service=pool-service` with Pool Service checked; hero "Join early access" opens `/early-access`; a failed pricing read keeps the rows, makes no availability claim and recovers on "Try again"; 320 and 768 px overflow and axe.

- Isolated run: 12/12 pass (50.8 s).
- Combined run with `early-access.spec.ts`, `early-access-account.spec.ts` and `light-only.spec.ts`: 101/103; the two failures were `services-page` 30 s timeouts (axe analysis; a click that resolved its target) at load average 9–11 from other sessions. Both pass in the isolated run; the earlier-run keyboard navigation slip (URL commit after 5 s) passed 6/6 on repeat and now waits up to 15 s.
- Every existing spec that visits `/services` (including "truthful public entry points") passed.

**6.3 Mutations (unit).** Destination to `/request`, malformed category id accepted, empty category read accepted, default cadence ignored: 4/4 caught; source restored.

**6.4 Screenshots** (synthetic catalog): [`docs/agent/evidence/trace161-services-option-c/`](../docs/agent/evidence/trace161-services-option-c/) — desktop first screen, full page and filtered; phone first screen, full page and keyboard focus.

## 7. Decisions for review

- **D-1** Destinations and link label (§3).
- **D-2** `force-dynamic` rendering: one small anonymous read per request and no build-time database read. ISR would be cheaper per request but reads the database during builds.
- **D-3** Unavailable copy is the approved "Not available yet in your area" (CFG-002) instead of the previous "Not available yet".
- **D-4** A pricing-read failure now says so instead of marking every service unavailable.
- **D-5** Photo choices and crops (`pending_owner_review`).

## 8. Not done

Plan Builder (deferred; homepage builder and its entry points untouched), a service detail page, canonical/`metadataBase`, merge, deploy.
