# /services Option C redesign (TRACE-161) — 2026-11-24 ET

**Owner instruction (2026-11-24 ET):** implement the Option C reference for `/services` with live catalog data and commercially licensed stock photos; defer the dedicated Plan Builder and keep existing builder behavior and entry points; open one draft PR for Josh's review.
**Base:** `main` `afa0be8`. **Branch:** `claude/services-option-c-redesign`.
**Status:** implemented, not reviewed or released. Photos `pending_owner_review`.
**#205 merged (dated note, 2026-11-25):** the original slice merged as `24fd251` at 21:29:45 UTC (from `fe88e2b`), so it releases to Production under DEC-2026-037; the deployment was not verified here. The five photos it carries, including the replaced Pool Service photo, were still recorded `pending_owner_review`.
**Revision 1 (owner instruction 2026-11-25 ET):** branch `claude/services-option-c-r1` from `main` `24fd251` (the instruction named draft #205, which had merged meanwhile). featured cards now lead to their own row in "All home services" (§3.1); the Pool Service photo is replaced with a screened residential pool (§4). Layout, hero and closing destinations, rows' early-access links and the deferral of the Plan Builder and service detail pages are unchanged.

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
| Featured | Four equal 3:2 cards; 4 columns from 1024 px, 2 from 360 px, 1 below. Whole card is one link with a focus ring to its service's catalog row (`#service-<id>`, §3.1), named "<service>, view in All home services"; photo `alt=""`; one "Representative photos" caption. |
| Catalog | "All home services"; the same category filters (now `aria-pressed`); compact rows with icon, name, description when present, price or availability when the browser read supports it, and the existing early-access link. Each row carries `id="service-<catalog id>"`, is focusable from script (`tabindex="-1"`, named by its heading) and has a 96 px scroll margin. |
| Closing | One block, "Want to know when booking opens?", with the existing early-access link. The "Mercurius Standard" panel and the dark CTA band were removed. |
| Initial HTML | `page.tsx` is a server component (`dynamic = "force-dynamic"`). An anonymous, cookie-less read of active `service_categories` and `services_catalog` (the rows the browser already reads under RLS) puts every name, description and link in the HTML. A failed read falls back to the previous browser-only behavior. |
| Icons | Resolved on the server from the catalog's Lucide name; the client no longer imports the whole icon set. |
| States | Loading: rows from the server read plus "Checking current pricing and availability…" (spinner only if the server read failed). Error: an alert with "Try again"; rows stay with no price or availability claim. Empty category: message and "Show all services". |
| Metadata | Title "Home services in Lee County \| Mercurius Marketplace" and a description. URL unchanged; canonical behavior unchanged (none). |

## 3. Service destinations (ids verified 2026-11-24; revised 2026-11-25)

| Card | Catalog id (hosted, active) | Card leads to | That row's action |
|---|---|---|---|
| Lawn Care | `lawn-mowing` | `#service-lawn-mowing` | `/early-access?service=lawn-mowing` |
| House Cleaning | `house-cleaning` | `#service-house-cleaning` | `/early-access?service=house-cleaning` |
| Pool Service | `pool-service` | `#service-pool-service` | `/early-access?service=pool-service` |
| Handyman | `handyman` | `#service-handyman` | `/early-access?service=handyman` |

No service has a detail URL. Revision 1 resolves D-1 as the owner directed: cards lead to their catalog entry, and each row keeps "Join early access" (accessible name "Join early access for <name>"), which preselects that service. The hero's "Join early access" (`/early-access`), "Browse all services" (`#all-services`) and the closing block's link are unchanged.

### 3.1 How the jump works

- **Anchors:** `src/lib/servicesPage/rowAnchor.ts` derives `service-<catalog id>` from the catalog id; a fragment is read back only if it names a well-formed id.
- **Without scripts:** a card is a plain `<a href="#service-<id>">`, and every row is in the initial HTML with all services shown, so the browser jumps natively.
- **With scripts:** a plain click or Enter (`CatalogRowLink`) pushes the fragment as a new history entry (only if it changed) and asks the catalog to reveal the row. Modified clicks (new tab or window) are left to the browser. The catalog also reveals the row for a `#service-<id>` URL on load and on `hashchange` (back/forward).
- **Reveal:** if the row is not rendered (a category filter hides it), the filter returns to **All services** first. Once rendered, the row is scrolled into view (`scroll-mt-24`, 96 px, clears the 64 px sticky header) and focused, with an inset focus ring; the next Tab reaches its early-access link. A second jump to the same card works after a filter change, because the request does not depend on the fragment changing.

## 4. Photos

Pipeline: `scripts/build-services-page-imagery.mjs` (same rules as the provider-profile pipeline: SHA-256 of each reviewed source must match the manifest; no enlargement) writes WebP crops to `public/images/services-page/`; `<img srcset>` with intrinsic `width`/`height`, so boxes are reserved. Record: [`docs/imagery/services-page-imagery-manifest.json`](../docs/imagery/services-page-imagery-manifest.json).

| Use | Source | Creator | Licence |
|---|---|---|---|
| Hero | https://www.pexels.com/photo/facade-of-a-house-12558933/ | Christopher Moon | Pexels License |
| Lawn Care | https://www.pexels.com/photo/a-person-mowing-the-lawn-6728926/ | Magic K | Pexels License |
| House Cleaning | https://www.pexels.com/photo/man-cleaning-a-counter-top-15293006/ | Jason Deines | Pexels License |
| Pool Service (revision 1) | https://www.pexels.com/photo/pool-chairs-beside-a-swimming-pool-11400444/ | An Flamand | Pexels License |
| Handyman | https://www.pexels.com/photo/hands-using-a-drill-1249609/ | Bidvine | Pexels License |

Pexels License (https://www.pexels.com/license/, read 2026-11-24): free to use including commercially, modification allowed, attribution not required; restrictions recorded in the manifest. Each photo page showed the creator and "Free" linking to the licence.

**Pool Service replacement (2026-11-25 ET).** "Pool Chairs Beside a Swimming Pool", Pexels 11400444, by An Flamand (https://www.pexels.com/@an-flamand-190129687/), 5184×3456, location given only as "FL, United States"; the photo page shows "Free" linking to the Pexels License. Source SHA-256 `4f84f42b…91514` (full value in the manifest). A curved pool and deck under an aluminium-framed screen enclosure, with neighbouring screened pools across a lawn. The source is already 3:2, so the card is the full frame: the enclosure's roof framing and the pool both read at the 171 px phone card and the 296 px desktop card (checked at both sizes; a 1.15× and 1.3× zoom lost the roof framing). No people, house numbers or readable branding; the grill is unbadged; a neighbour's small door sticker and pool-safety sign are not legible at card sizes. Searched first: Unsplash "screened pool enclosure" and "pool cage florida" (the screened candidates were storm-dark or backlit at sunset) and Pexels "pool enclosure" (the other screened results were paid iStock placements). Replaced: Pexels 15948530 (Mia Dalisay), tagged "Bali Villa", with a bamboo fence rather than a screen enclosure. Regenerating with the pipeline changed only the three Pool Service files; the other four sources were re-downloaded, matched their recorded hashes and produced byte-identical output.

Review notes: the suggested Lawn Care candidate (15131952, a dark wooded park with a string trimmer) was replaced, and 4162011 was rejected because its operator is barefoot; the hero is Pexels-tagged "Palm Beach" (and the replaced pool was "Bali Villa"), so no copy or alt text names a place; the drill has no readable logo but resembles a known brand's colours; the hand-with-watch crop leaves the watch out.

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

### 6.5 Revision 1 (2026-11-25 ET)

Same setup as §6 (production build against the synthetic fixture).

- **Checks:** secret scan pass; `npm run lint` pass; `npm run typecheck` pass; `npm run build` pass (`/services` dynamic); unit 84 files / 1,386 tests pass. (`npm run test:unit` from the main checkout also collects an ignored local worktree under `.phase5-local/`; the count above excludes it.)
- **Unit:** `services-page.test.ts` 20/20 (new: anchors derived from the id, fragment parsing rejects malformed ids, the reveal records the fragment once and always dispatches).
- **Browser:** `services-page.spec.ts` 15/15. New or changed, at 1440×900 and 390×844: initial HTML has `href="#service-<id>"` on every card and `id="service-<id>"` on every row; each of the four cards (clicked) lands on its own row, focused, in view and ≥ 8 px below the sticky header, whose early-access link targets that service; the Handyman card again after "Lawn & Landscape" hid its row resets the filter to All services and reaches the row; by keyboard only: "Cleaning" filter (hides Pool Service), Shift+Tab back to the Pool Service card (visible focus ring), Enter → filter reset, row focused with a visible ring, axe clean, Tab → "Join early access for Pool Service", Enter → `/early-access?service=pool-service` with Pool Service checked. Once at 390×844: `/services#service-house-cleaning` opens with that row focused below the header, and Back from `#all-services` returns to it.
- **Combined run** with `early-access.spec.ts` and the screenshot capture: 52/53; the failure was the 320 px overflow/axe test timing out at 30 s under load, and it passed on an immediate rerun (with 768 px, 2/2).
- **Screenshots** (synthetic catalog, §6.4 folder): refreshed desktop first screen and full pages with the new pool photo; new `*-featured-cards.png` (both crops), `*-keyboard-pool-card-focus.png` (focus ring on the card after "Cleaning" hid the row) and `*-jump-pool-row-focused.png` (filter reset, row focused below the header). In the synthetic catalog Pool Service is the last row, so the page bottoms out with the row about 30 px below the header rather than at the full 96 px margin.
- **Axe caught** a first attempt that tinted the focused row's background (muted description text 4.35:1); the tint was removed and the row uses the inset focus ring only.
- **Mutations (browser):** see §6.6.

### 6.6 Browser mutations (revision 1)

Each applied to `ServicesCatalog.tsx`, rebuilt, and run against the jump tests; source restored afterwards.

| Mutation | Result |
|---|---|
| M1 no filter reset before revealing | Caught: both card-jump and keyboard tests, both viewports (All services not pressed) |
| M2 row not focused | Caught: both tests, both viewports (row not focused) |
| M3 no scroll margin on the row | Caught: both tests, both viewports and the shared-link test (row under the sticky header) |
| M4 no reveal for a `#service-<id>` URL on load | **Not distinguished.** The shared-link test passed without it: Chrome focuses a focusable fragment target natively (rows have `tabindex="-1"` and are in the initial HTML). The other tests in that run failed only by 30 s timeouts while the host was overloaded (the next build was killed), so they are not counted. The mount-time reveal remains for the case where the server read failed and rows arrive with the browser read; no test covers that case. |

## 7. Decisions for review

- **D-1** Resolved by revision 1: cards lead to their catalog row; rows keep "Join early access" (§3).
- **D-2** `force-dynamic` rendering: one small anonymous read per request and no build-time database read. ISR would be cheaper per request but reads the database during builds.
- **D-3** Unavailable copy is the approved "Not available yet in your area" (CFG-002) instead of the previous "Not available yet".
- **D-4** A pricing-read failure now says so instead of marking every service unavailable.
- **D-5** Photo choices and crops, including the replacement Pool Service photo (`pending_owner_review`).

## 8. Not done

Plan Builder (deferred; homepage builder and its entry points untouched), a service detail page, canonical/`metadataBase`, merge, deploy.
