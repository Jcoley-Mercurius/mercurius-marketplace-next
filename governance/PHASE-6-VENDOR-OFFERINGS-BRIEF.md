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

## 8. 6.11A — offering versions and write boundaries (implemented for review)

Owner approval 2026-10-31: DEC-2026-055 items 1 and 2 (recorded in the decision log; DEC-2026-046 clarified; MPS §4 note). Branch `claude/phase6-11a-offering-boundaries` stacked on this brief (`4e97ac7`); own diff `4e97ac7..HEAD`. Migration `20261104001000_phase6_vendor_offerings.sql` (additive; requires `20261103001000`; **not pushed to hosted**).

**Behavior.**
- *Immutable versions (F611-1).* A package version that is live, or in use (a request, match attempt or recurring plan names it or one of its levels), refuses every content change on every path: package content columns, levels, add-ons and questions refuse INSERT/UPDATE/DELETE, and the package refuses DELETE (a live one must be paused first; an in-use, operator-published or corrected one is history). The guard applies to vendors, operators and owner sessions alike. Pausing, the review flag and operator suspension/archive stay available. A version created in the current transaction is still being built (operator publication inserts its rows live). Only the newest revision of a lineage can go live (one live revision per lineage stays the existing unique index).
- *Vendor save (DEC-2026-055 item 2).* `vendor_save_package(package, expected_revision, content, publish, save_key)`: vendor role and own provider required; the key is replayed or refused before anything is read (same key + other content → 22023); the vendor's provider row and the lineage are locked; a superseded version or stale content hash → 40001. A paused version no one has used is rewritten in place; otherwise the content becomes the next revision, and publishing it pauses the live one in the same transaction. The editors' rows are written through the existing triggers (price meaning, archive, guardrail); levels must belong to the package's template and use only the catalog's cadences. `vendor_set_package_active` publishes or pauses against the row read (40001 when stale). `vendor_package_revisions` gives the vendor its version hashes.
- *Guardrail.* Managed Pricing (template) packages now get their review flag on the server (levels and offered add-ons inside their template ranges), as custom fixed packages already did; a vendor can no longer clear it.
- *Promotions and ZIPs (F611-2/3).* The vendor policies on `package_promotions` and `contractor_service_zips` are dropped; operator policies, public reads and vendor-funded offer approval are unchanged. Service ZIP codes are five digits (`NOT VALID` then `VALIDATE`; 0 hosted malformed rows).
- *Editors.* Pricing & Packages and Managed Pricing save through the command (a retry of the same content after an unknown outcome reuses its key) and publish/pause through `vendor_set_package_active`; superseded revisions are no longer listed. No editor writes package tables directly. The legacy promotion editor is removed in 6.11B; until then a vendor attempt is refused by RLS.

**Evidence (6.11A head, local isolated stack, synthetic data; 2026-11-01).**
- SQL: clean reset through `20261104001000`, then the full suite: **95 files, 5,998 tests, PASS**. New SQL 104 (71 assertions) covers vendor A/B isolation, anonymous refusal, every direct write path on a live and a paused in-use version (vendor, operator, owner session), the request's package, level, stored revision and amount before and after each refused write, the save, pause and archive, keyed replay and reuse, stale and superseded reads, in-place drafts, the custom and Managed Pricing guardrail, catalog cadences, closed vendor promotion/ZIP writes with operator ZIP writes and the five-digit check, exact-ZIP matching, internal notes, archived history, the owner-maintenance switch, and TRACE-126's checkout refusal after a replacement (with a control showing it resolved before). SQL 023/082/087/094/095/096/097 updated as described above.
- Concurrency: `scripts/vendor-offerings-concurrency.mjs` (C1 six saves from one read → one replacement; C2 one key ×6 → one revision; C3 eight submissions racing a save: every bound request names an intact version, level, price and stored revision, the rest are refused as changed or no longer offered, observed 0/8, 4/8, 7/8 and 8/8 bound across runs; C3b forced order; C4 operator publication racing a vendor save → one live revision). All 34 CI concurrency/coordination scripts pass: 30 in one CI-order run after a clean reset; `recurring-payment-concurrency` after widening its new refusal assertion; three Phase 5 timing scripts (bank statement, late reversal, retention-hold coordination) on a fresh reset after leftover fixtures from that run (they do not touch package tables).
- Unit 599/599 (new `vendor-package-versions`); typecheck and lint of changed files pass; production build passes.
- Browser (fixture build): a quiet run passed 47/48 (the one failure, an axe contrast finding on the existing Live badge, is fixed: `text-commitment`). Later runs on this 5 GB machine under load: final run with two retries 41 passed, 2 flaky, 5 failed by timeout or slow load, all on operator surfaces 6.11A does not change (onboarding exceptions, operator price drafts and corrections, promotion offers) that passed in the quiet run. New `vendor-offering-versions` 4/4 passes in the final run.
- Not performed: CI on this branch, screen reader, real devices, `@visual`, hosted dry run or push.

**TRACE-126/127 are not closed.** In-place edits of an in-use version are no longer possible on application paths, but a replacement (vendor or operator) still pauses the version an unpaid request was priced from, and `money_source` then refuses that request's checkout ("Selected offering is not eligible", SQL 104), exactly as after an operator replacement today. Nothing is re-priced; the request keeps its stored terms. SQL 023/082/087/095/096/097 still characterize the in-place exposures, applied under owner maintenance (version guards disabled for that statement) after asserting the application-path refusal. The agreed-price source for one-time requests (TRACE-126) and accepting an already-offered visit at its bound terms (TRACE-127) keep their own owner decisions, slices and finance review.

**Compatibility.** Hosted read-only counts (2026-10-31): 0 template packages, 0 lineages with two live revisions, 0 live non-newest revisions, 3 packages referenced by 6 historical requests (these become immutable history), 0 enabled legacy promotions, 0 malformed ZIPs. The client deployed today keeps working on the new schema except where the new rules refuse: saving content into a live or in-use version (refused in its first statement, nothing changed), legacy promotion edits and vendor ZIP writes (RLS). Its Managed Pricing save pauses before rewriting and would leave an in-use template package paused; there are no template packages on hosted. The new client needs the migration (its revision readback tolerates a missing function; saves do not), so the order is: dry run and push `20261104001000` with owner authorization → merge.

**Rollback.** Client: promote the previous production deployment; it works on the new schema as above. Database (forward fix, no data to restore): drop the four `*_version_guard` triggers and the two template-review triggers, and recreate the two vendor policies, to return to the previous write behavior. The command functions and `private.vendor_package_saves` can stay unused.

## 9. 6.11B — vendor listing honesty and portal states (implemented for review)

Branch `claude/phase6-11b-vendor-listing` stacked on 6.11A (`dbc8e0e`, PR #123); own diff `dbc8e0e..HEAD`. Migration `20261105001000_phase6_vendor_listing.sql` (additive; requires `20261104001000`; **not pushed to hosted**).

**Behavior.**
- *Special Offer (DEC-2026-055 item 1).* Not shown on the public profile, in the vendor profile editor or in completeness prompts; profile strength tops out at 95 (Differentiation 15) in the portal and in matching. Matching no longer reads `special_offer`, and new offers record ranking `balanced-v2` (`find_eligible_packages_with_answers` and `create_job_offer_internal` restated with only those changes; `find_eligible_packages_core`, the fingerprinted wrapper, is unchanged). The stored text is kept: anonymous column SELECT is revoked, `r0_public_providers` returns null for it, vendors can no longer change it, and operators read it read-only on the vendor record through `admin_vendor_special_offer`. Signed-in column SELECT stays for now because the deployed client still selects it (DEC-2026-037); revoking it is a follow-up once 6.11B's client, which no longer selects it, is live.
- *Legacy promotions (F611-2).* No path enables a `package_promotions` row (trigger, 55000; 0 enabled rows on hosted). The vendor editor no longer has a promotion editor; the public profile and intake no longer read overlays, so public display, intake and matching show the same published price. Reviewed promotion offers (DEC-2026-038/041/042) and their closed checkout gate are unchanged.
- *Offered services (F611-4).* `r0_public_providers` (same signature; used by the public profile, directory, spotlight and intake) returns Services Offered as the catalog services the provider currently offers through a live, review-cleared, unarchived offering: fixed price with valid exact levels, Custom Quote, or quote with a deposit. A listed service without such an offering is not shown as offered, and nothing becomes Custom Quote by itself (DEC-2026-051 item 2).
- *Plans and teasers (F611-6).* No Plans link; `/vendor/plan` redirects to `/vendor`; the "Coming after soft launch" teasers on Plans and Marketing are gone. Free marketing tools stay.
- *States (F611-7).* Each price reads Live, Paused, Draft, Needs review or Archived, with its type (Fixed price, Custom Quote, Custom Quote + deposit). Paused versus Draft comes from `vendor_packages.first_published_at` (set by trigger when a version first goes live; existing rows treated as published; clients cannot write it). The summary separates Paused and Drafts. Each listed service reads Fixed price, Custom Quote or Not priced yet (with Live/Paused/Draft saved).
- *Coverage readback (F611-3).* The vendor profile shows the exact service ZIP codes on file grouped by city, any outside current coverage (not matched), and "Ask Mercurius to change your service area" (support). There is no ZIP editor. Saving the profile states that it does not publish prices, change visibility or turn Marketing on or off.

**Compatibility.** The deployed client keeps working on the new schema: its signed-in reads of `special_offer` stay allowed, the public RPC keeps its signature, a vendor profile save that resends the unchanged offer is accepted (only a change is refused), and legacy promotion edits are refused (0 rows exist). The new client selects `first_published_at` and calls `admin_vendor_special_offer`, so it needs the migration first. Matching changes ranking only (profile-strength weights; recorded `balanced-v2`); eligibility, prices and money are unchanged.

**Rollback.** Client: promote the previous deployment (it works on the new schema as above). Database (forward fix): grant `select (special_offer)` back to `anon`, drop `trg_package_promotion_legacy_closed`, restate the two matching functions and `r0_public_providers` from `20261018001000`/`20260904000100`/their last definitions, drop `trg_vendor_package_first_published` (the column can stay).
