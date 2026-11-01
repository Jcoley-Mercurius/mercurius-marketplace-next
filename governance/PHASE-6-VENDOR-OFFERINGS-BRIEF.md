# Phase 6.11 vendor profile, offerings and exact coverage — characterization brief

Slice 6.11 / TRACE-134. Date 2026-10-31 (America/New_York). **Characterization only: no implementation, migration or hosted change.**
Decisions needed: DEC-2026-055 (PROPOSED), two items, §6. Everything else in §7 follows from approved authority.

## 0. Base and integration path

- `main` = `737474f` (PR #117, the 6.9 brief). 6.9A/6.9B are **not on `main`**: PR #118 merged into the already-merged brief branch and PR #119 merged into `claude/phase6-9a-exceptions` (`a1855f2`).
- Integration PR **#121** (`claude/phase6-9a-exceptions` → `main`, head `a1855f2`) carries the reviewed 6.9A/6.9B commits unchanged, merges cleanly, and needs no hosted push (`20261101001000`/`20261102001000` already applied). It must be merged with **a merge commit** (not squash/rebase) so the stacked SHAs stay on `main`.
- After #121: retarget PR #120 (6.10) to `main` (`gh pr edit 120 --base main`). Its own diff is then `a1855f2..f226669`. `20261103001000` is already on hosted.
- This brief: branch `claude/phase6-11-vendor-offerings` from 6.10 head `f226669`; own diff `f226669..HEAD`. 6.11 implementation will be a separate stacked branch.

## 1. Authorities applied

MPS §1 (show only supported coverage/providers/prices), §3 (paid vendor plans deferred), §4 permission matrix ("Configure provider offerings: vendor own, admin supervised"; offering prices DEC-2026-039/041/046), §6.1–6.2 (exact coverage; eligibility before ranking; ranking factors approved and versioned), §7.3 ($0 subscription; any plan is a separate release), §7.6 promotions, §8 (coverage approved at activation; eligibility follows coverage). CFG-002 ("Not available yet in your area"). DEC-2026-034 (out-of-band guardrail is the only gate on vendor custom prices), 038/041/042 (promotion gate), 039 item 2 (replacement = new lineage revision; earlier bookings keep theirs), 040(a) (vendor-authored packages are the vendor's own prices), 044, 046, 047 (+2026-10-25 amendment), 051 items 1–5 (6–8 PROPOSED, not implemented here). Roadmap Phase 6: hide promotion UI; remove premature Vendor Plans.

## 2. Current surfaces

| Surface | What it does today |
|---|---|
| Vendor nav (`VendorSidebar`) | Overview, Jobs, Messages, Pricing & Packages, Marketing Tools, **Plans ("Free")**, Compliance, Profile, Support |
| `/vendor/profile` | Vendor edits name, bio, location, phone, email, **Services Offered**, years, **Special Offer**, promise, tagline, website, video, logo, gallery; completeness score prompts "Add a special offer" |
| `/vendor/packages` (`VendorPackagesManager`, 1,741 lines) | Vendor's own fixed/quote packages, tiers, questions, add-ons; saves by **deleting and reinserting** tiers/questions/add-ons; publish/pause toggle; **legacy per-package promotion editor** (`package_promotions`); operator approvals/corrections panels; "Draft or Paused" shown as one state |
| `/vendor/pricing` (`ManagedPricingEditor`) | Template-based levels within the template range; same delete-and-reinsert save |
| `/vendor/plan` | No paid plans; "Coming after soft launch" Growth / Managed marketing cards |
| `/vendor/marketing` | Free share/review tools plus a "Coming after soft launch" teaser grid |
| Vendor coverage | No editor. `VendorRecruitingStatus` lists ZIPs on file: "Mercurius sets your service area during review." |
| `/admin/vendors/[id]` | Operator: Save services (services + ZIPs only, DEC-2026-051 item 3), Custom Quote, drafts/publish, archive, activation, Marketing |
| `/providers/[id]` (public) | Packages with live tiers and **legacy promotions applied**; **every `contractors.services` entry as a badge**; **"Current Offer" card from `special_offer`**; service area = vendor ZIPs ∩ active coverage |
| Matching (`private.find_eligible_packages_with_answers`) | Live, review-cleared package; vendor `is_active` and `marketing_enabled`; active `coverage_areas` row **and** exact vendor ZIP. Price from `resolve_package_tier_price` (**applies legacy promotions**). Profile strength gives `special_offer` 5 points |
| Checkout (`private.money_source`) | Refuses a request with an enabled legacy promotion ("Promotion allocation integration required") |

Database boundaries for `authenticated` vendors (RLS + grants + triggers):

| Table | Vendor can | Guard |
|---|---|---|
| `contractors` | UPDATE own row | `enforce_contractor_update_scope`: only name, bio, location, phone, email, services, years, special_offer, promise, tagline, website, video, logo. `is_active`, `marketing_enabled`, `badges`, `verified_specialty`, `user_id` refused |
| `vendor_packages` | INSERT/UPDATE/DELETE own (column grants include `is_active`, `needs_review`) | name, mode/kind, lineage, archive, guardrail-review triggers |
| `package_tiers`, `package_addons`, `package_qualifying_questions` | ALL on own packages | archived-history, tier-kind, guardrail refresh |
| `package_promotions` | ALL on own packages | `validate_package_promotion` (live fixed package, valid tiers) |
| `contractor_service_zips` | **ALL on own record** | none (no format or coverage check) |

## 3. Characterization evidence

Rolled-back transaction on the local isolated stack (migrations through `20261103001000`), synthetic fixtures: operator, vendors A and B (linked, active, Marketing on), one fixed service, both priced 100/month by operator publication, both serving the same active coverage ZIP.

| Probe | Action (as vendor A unless noted) | Result |
|---|---|---|
| P1 | Update the tier price of its live package 100 → 40 | Applied in place |
| P2 | Insert its own active, review-cleared fixed package | Inserted live (guardrail decides review) |
| P3 | Pause then reactivate its own live package | Allowed |
| P4 | Update vendor B's package and tier | 0 rows (isolated) |
| P5 | Insert an enabled 50% legacy promotion on its live package | Inserted; **matching returns 50.00 for A** (B 100). Checkout would refuse it |
| P6 | Set `is_active`, `marketing_enabled`, `badges`, `verified_specialty` | All refused (42501) |
| P7 | Edit bio, services (adds an unknown id), special_offer "20% off everything", years | Applied; public immediately |
| P8 | Edit vendor B's profile | 0 rows |
| P9 | Insert service ZIPs `90210` and `abcde` | **Inserted** |
| P10 | Insert/delete vendor B's ZIPs | Refused / 0 rows |
| P11 | Delete its own live package | Deleted |
| P12 | Change a fixed package to Custom Quote with exact tiers | Refused (`package_mode_kind_guard`) |
| P13 | Anonymous writes to contractors / ZIPs / promotions; anonymous read of contact fields | All refused |
| Q1 | Editor save path (delete tiers, reinsert) on a package bound to a **scheduled** request | **Request `package_tier_id` set to NULL** |
| Q2 | Delete a package bound to a scheduled request | **`package_id` and `package_tier_id` set to NULL** |

Q1/Q2 follow from `service_requests` and `job_match_attempts` FKs `ON DELETE SET NULL` to packages and tiers. `money_source` then cannot load the offering, so the request cannot be priced.

Hosted, read-only aggregate counts (2026-10-31, no row data): 29 vendors, 13 linked, 4 listed (active + Marketing); 23 live packages; **0** legacy promotions enabled; **8** vendors with `special_offer` text; **23** vendors list at least one service with no live package; **0** service ZIPs outside active coverage; 0 malformed ZIPs; 0 open requests (Q1/Q2 are latent today).

## 4. Findings

| ID | Severity | Finding | Authority |
|---|---|---|---|
| F611-1 | High (latent) | A vendor's normal save in either price editor, or a package delete, unbinds requests and match attempts from their package/tier (Q1/Q2). Scheduled, unpaid requests become unpriceable; history loses its offering | DEC-2026-039 item 2; DEC-2026-034; slice rule "accepted requests and snapshots are not silently repriced" |
| F611-2 | Medium | Vendors write legacy `package_promotions` (UI editor and direct API). An enabled one lowers the matched and displayed price (P5), which checkout then refuses: a misleading price and an unbookable listing outside the DEC-2026-038/041/042 gate | MPS §7.6; roadmap "hide promotion UI" |
| F611-3 | Medium | Vendors write their own service ZIPs directly (any string, P9), which counts for matching at once inside active coverage. The portal says Mercurius sets the service area; operators save ZIPs (DEC-2026-051 item 3) | MPS §8 (coverage approved); §6.1 exact coverage |
| F611-4 | Medium | The public profile lists every `contractors.services` entry as offered, whether or not a live package exists (23 hosted vendors) | MPS §1; CFG-002 |
| F611-5 | Decision | "Current Offer" (`special_offer`) is free-text promotion copy, shown publicly (8 vendors), prompted by the profile score and worth 5 ranking points; no checkout path honors it | MPS §7.6; §6.2 (ranking weights approved); DEC-2026-055 item 1 |
| F611-6 | Low | Premature Plans nav and page, and "Coming after soft launch" teasers on Plans and Marketing | MPS §3 deferred; roadmap Phase 6 |
| F611-7 | Low | Vendor pricing states blur: "Draft or Paused" is one label; unpriced listed services and archived history are not shown together with live/paused/review states; Custom Quote vs fixed is not stated per service | Slice outcome; MDS state patterns |

**Authority conflict recorded (C1):** DEC-2026-046 says "Unchanged: only operators publish", but DEC-2026-034 (guardrail is the only gate), DEC-2026-040(a) (vendor-authored packages are the vendor's own prices), MPS §4 ("configure provider offerings: own") and the code (P2, P3, Managed Pricing) let a vendor publish its own fixed price inside the guardrail band. DEC-2026-055 item 2 asks the owner to confirm. Until answered, 6.11 keeps the current behavior and does not rebuild either price editor.

## 5. Already correct; preserve

Vendor A/B isolation on every table (P4, P8, P10); vendor cannot change activation, Marketing, badges, verified specialty or ownership (P6); anonymous writes refused (P13); matching requires both active platform coverage and an exact vendor ZIP (no inferred expansion); public service area is vendor ZIPs ∩ active coverage; catalog prices never price a vendor (DEC-2026-051 item 1); Custom Quote only by explicit operator action; operator publication without vendor approval with reason, stale guard and guardrail (DEC-2026-046); vendor-funded offers still need vendor approval (`vendor_approve_promotion_offer`); internal notes private and archived versions read-only (DEC-2026-047 + amendment, SQL 093/094); quote/fixed kind guard (P12); checkout refuses legacy promotions.

## 6. Decision sheet — DEC-2026-055 (PROPOSED)

1. **Special Offer.** Recommended: stop showing `special_offer` publicly and in the vendor profile editor and score prompts (data kept, operator-readable), and drop its 5 profile-strength points from ranking with a recorded matching-version note. Alternative: keep showing it only after operator review, with no ranking weight.
2. **Vendor self-published prices (C1).** Recommended: confirm the status quo. A vendor may publish and pause its own fixed prices inside the guardrail band (out-of-band prices wait in Package Reviews), and DEC-2026-046's "only operators publish" covers operator-prepared drafts. With F611-1's fix, a vendor change to a package already bound to a request becomes a new lineage revision (DEC-2026-039 item 2) instead of an in-place edit. Alternative: vendor changes become drafts an operator publishes, which rebuilds both editors.

Not decided here and not implemented: DEC-2026-051 items 6–8 (twice-a-year cadence, cadences outside the catalog list, guardrail band source).

## 7. Proposed implementation (after review; separate stacked branch)

**6.11A — database boundaries (one additive migration; no money function changed).**
- F611-1: refuse DELETE of a package or tier referenced by a request, match attempt or operator draft (pause or archive instead). For a referenced live package, the vendor save path creates a replacement revision in its lineage and pauses the old one (existing lineage guard), never edits in place. Unreferenced draft or paused packages keep their current edit and delete behavior.
- F611-2: revoke vendor INSERT/UPDATE/DELETE on `package_promotions` (operator policy unchanged; 0 hosted rows, so no data change).
- F611-3: revoke vendor writes on `contractor_service_zips` (operator policy unchanged); add a 5-digit format check (`NOT VALID` then `VALIDATE`; 0 hosted malformed rows).
- SQL test 104: A/B isolation, anonymous refusal, every direct-write bypass above refused, Q1/Q2 refused with the request binding intact, operator Save services / Custom Quote / publish unchanged, archived read-only, internal notes not readable by vendor/anon, exact-ZIP eligibility (vendor ZIP outside active coverage never matches; covered ZIP without vendor ZIP never matches). Concurrency: vendor save vs request submission on the same package (binding kept or refused, never nulled).

**6.11B — portal and public UI.**
- Remove the Plans nav item; `/vendor/plan` redirects to `/vendor`; remove the "Coming after soft launch" teasers (F611-6).
- Remove the legacy promotion editor from Pricing & Packages; public profile and intake stop applying legacy promotions to displayed prices (F611-2).
- Public profile lists offered services from live packages (fixed or Custom Quote); listed-but-unpriced services are not shown as offered (F611-4).
- Vendor coverage readback on Profile: exact ZIPs on file, which are inside current coverage, and "Mercurius sets your service area" with a support path; no ZIP editor (F611-3).
- Pricing & Packages states: Live, Paused, Draft, Needs review, Archived (read-only), and per listed service "Fixed price", "Custom Quote" or "Not priced yet" (F611-7). The vendor's Save services on Profile states it does not publish prices or change visibility/Marketing.
- Special Offer per DEC-2026-055 item 1 once answered.
- Loading, empty, error, permission (unlinked), stale-edit (refused save → reload) and recovery states; keyboard and 320 px.
- Browser: `vendor-profile`, `vendor-prices`, `pricing-approval`, `onboarding-checklist`, public provider profile, vendor nav; axe at 320/1440.

**Not in 6.11:** compliance renewals, earnings, statements, ACH exceptions (6.12); admin navigation (6.13); TRACE-126 (one-time agreed-price source; finance review) and TRACE-127; DEC-2026-050/052/053 F-items/054; P-K1/P-K2; promotions gate (finance review). No hosted push or merge without owner authorization.
