# Pricing continuation handoff — 2026-10-18, updated 2026-10-20

Short-lived navigation note for the next session on TRACE-112–116. Policy lives in the
governance files linked below, not here. Delete this file once the slice merges.

## Pre-PR audit (2026-10-20)

- **Clean replay:** the isolated CI stack (`scripts/phase5-db.sh`, own project and ports) applied every migration on an empty database; full SQL suite 78 files / 4443 checks passed; `pricing-concurrency.mjs` 3/3 and the finance concurrency scripts passed. Before/after `pg_get_functiondef` diff of the 23 restated functions: ordinary bookings unchanged (fee sites now go through `money_split`, which returns `round(service × 15 / 100)` and no subsidy without a promotion). The main local stack was stopped (data kept) for memory, not reset.
- **Fixed in the audit:** finance reconciliation shows the promotion subsidy and labels its account and issue (`src/lib/financeReconciliation.ts`, `src/app/admin/finance/page.tsx`); the intake and the request's Offer panel say when offers can't be checked, keep what will be sent on screen, and offer a retry (`src/app/request/page.tsx`, `src/components/dashboard/RequestPromotionPanel.tsx`); `database.types.ts` regenerated from the replay; trailing whitespace in `20261018001000`; finance sign-off now binds all six files and a deployed fingerprint (`scripts/promotion-money-fingerprint.sql`).
- **Open for the finance review/owner:** late refund release after an automatic promotion restoration; gate opening is procedural (PRICING-FINANCE-REVIEW.md §9 items 10–11). All 14 active production vendors are unlinked, so replacement drafts can only email notices until vendors link (PRICING-ROLLOUT.md §5).

## Current state (2026-10-20, TRACE-116)

- **Owner directions 2026-10-20 → DEC-2026-042.** Offers are applied by explicit homeowner choice or code; matching keeps the priced selection; Starting-at fallback and typo edits deferred. Built in `supabase/migrations/20261018006000_promotion_selection.sql` (new, sixth migration), SQL `087_promotion_selection.sql`, `src/lib/promotionSelection.ts`, `src/components/pricing/OfferChoices.tsx`, `src/components/dashboard/RequestPromotionPanel.tsx`, Offers card on `/request` review, gate/cleanup card on `/admin/promotions`, `scripts/install-promotion-sweep.sql`.
- **Review and rollout:** [governance/PRICING-FINANCE-REVIEW.md](../../governance/PRICING-FINANCE-REVIEW.md) (package for the two-person finance review; not reviewed) and [governance/PRICING-ROLLOUT.md](../../governance/PRICING-ROLLOUT.md) (inventory, hosted push, replacement drafts, schedule, gate, order, recovery, owner decisions).
- **Hosted (read-only, 2026-10-20):** none of the six pricing migrations applied (head `20261016003000`), 0 `cron.job`, 0 `money_authorities`, 14 active packages.
- **Local DB:** `20261018006000` applied by psql and recorded by hand. Iterating on it: drop its new objects and replay the file (the drop list is the "new" rows of the migration's §2–§8 plus its four tables), or reset when local data no longer matters.
- **Gates still closed:** promotions gate; cleanup job not installed; no vendor message sent; no hosted push.
- **Next:** Codex review; commit and PR; owner steps in PRICING-ROLLOUT.md §8. Owner decisions open: second finance reviewer; provider replacement for bookings with add-ons or an offer (CFG-007); Credits comparison when Credits exist.

## Earlier record (2026-10-18/19)

- **Branch:** `claude/pricing-revisions` from `main` `fdfb450`. **Everything is uncommitted** in the working tree (no commit, no push, no PR). Check `git status` first; do not discard it.
- **Full record:** [governance/PRICING-IMPROVEMENTS.md](../../governance/PRICING-IMPROVEMENTS.md) (observed-vs-reported matrix, design, requirement-to-evidence map, hosted inventory, blocked items, deferred list, pilot steps, rollout/rollback).
- **Decisions:** DEC-2026-038 (7.5% promotional commission, approved), DEC-2026-039 (vendor approval of exact revision; price meaning; add-ons priced end to end), DEC-2026-040 (legacy live packages, PROPOSED) in [DECISION-LOG.md](../../governance/DECISION-LOG.md). CFG-005, MPS §7.2/§7.6 and AGENTS.md carry the 7.5% exception. TRACE-112/113/114 in [TRACEABILITY.md](../../governance/TRACEABILITY.md). Dated entry in [HANDOFF.md](HANDOFF.md).

## What was built

| Area | Files |
|---|---|
| Catalog + calculation (slice A) | `supabase/migrations/20261018001000_pricing_catalog_calculation.sql`; SQL `supabase/tests/082_pricing_catalog_calculation.sql` |
| Vendor approval (slice B) | `supabase/migrations/20261018002000_pricing_vendor_approval.sql`; SQL `083_pricing_vendor_approval.sql`; `080` updated |
| Promotions (PR-10, not wired to checkout) | `supabase/migrations/20261018003000_promotion_offers.sql`; SQL `084_promotion_offers.sql` |
| Client libraries | `src/lib/pricingContent.ts`, `src/lib/promotionOffers.ts`, `src/lib/packageDrafts.ts`, `src/lib/requestPreview.ts`, `src/lib/requestSubmission.ts` |
| Operator UI | `src/components/admin/PackageContentEditor.tsx`, `PackageDrafts.tsx`, `VendorPackagePrices.tsx`, `src/app/admin/vendor-prices/page.tsx` (`?vendor=` filter), `src/app/admin/promotions/page.tsx`, sidebar |
| Vendor UI | `src/components/vendor/VendorPriceApprovals.tsx` (on Pricing & Packages and Managed Pricing), Managed Pricing copy |
| Public / intake | `src/app/providers/[id]/page.tsx`, `src/components/request/ServiceAvailabilityList.tsx`, `src/app/request/page.tsx`, `src/components/pricing/PackageContentSummary.tsx` |
| Tests / CI | unit `pricing-content`, `promotion-offers`, `package-drafts`; browser `tests/e2e/pricing-approval.spec.ts`, `vendor-prices.spec.ts`; `scripts/pricing-concurrency.mjs` (added to CI); SQL `066` two assertions strip new keys |

Migration 1 restates `private.find_eligible_packages_with_answers`, `public.preview_service_request_selections`, `private.submit_service_requests_core` and `private.money_source` in full (changes marked TRACE-112). Migration 2 restates `admin_save_package_draft`, `admin_publish_package_draft`, `admin_discard_package_draft`.

## Evidence (2026-10-18, not yet re-run on any later change)

SQL 082 61/61, 083 85/85, 084 61/61, 080 52/52, 066 68/68, 063 65/65; full SQL 4230 checks with only the known 003 local-data failure; concurrency script 3/3; unit 437/437; lint, typecheck, secret scan, `git diff --check` clean; synthetic build; full non-visual browser suite 519/519. Not run: `@visual`, hosted push, manual screen reader.

## Local environment notes

- The local Supabase stack has all three migrations applied. `20261018001000` went in through `supabase migration up --local`; `20261018002000` and `20261018003000` were applied by psql and recorded by hand in `supabase_migrations.schema_migrations` (empty `statements`). If a migration file changes, re-apply it locally (or reset when local data no longer matters) before re-running SQL tests.
- The iteration helper scripts used in the previous session lived in a session scratchpad and are gone. To rebuild migration 1 there is no generator any more: edit the SQL file directly.
- Concurrency script locally: `PRICING_DB_CONTAINER=supabase_db_vugqqyemuptlvcieihww node scripts/pricing-concurrency.mjs` (cleans up its own synthetic rows).
- Browser tests need a synthetic build first: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831 NEXT_PUBLIC_SUPABASE_ANON_KEY=mds-synthetic-anon-key MERCURIUS_BUILD_WORKERS=1 npm run build`, then `npx playwright test --grep-invert @visual`. In specs, register the catch-all `**/*` route before test-specific routes (later routes win).
- Production read access is read-only aggregates only (`npx supabase db query --linked`); counts from 2026-10-18 are in the slice record §4.

## Owner decisions (answered 2026-10-18, DEC-2026-041)

All seven are recorded in [DECISION-LOG.md](../../governance/DECISION-LOG.md) DEC-2026-041 (policy text lives there): (1) proportional refund reversal from the accepted snapshot, release on failed/expired checkout, restore only after a full refund before service; (2) add-on checkout yes, through the two-person `money_publish_snapshot` review, plus the optional add-on picker; (3) first booking = no previous completed service, one active first-booking reservation per homeowner; (4) material corrections need vendor approval, typo fixes don't, suspension allowed; (5) DEC-2026-040 option (a); (6) unlinked vendor notice by email on file, not approval; (7) unmatched answers show "Price requires confirmation" with the blocking answer.

**Order:** four decision-free fixes → these decisions → finance review and end-to-end verification → migrations prepared for review. No deploy, no hosted push.

## Progress since the decisions (2026-10-19, TRACE-115)

- **Done:** the four source fixes and DEC-2026-041 items 1–7. New migrations `20261018004000_pricing_owner_decisions.sql` and `20261018005000_pricing_checkout_promotions.sql`; `20261018001000` edited in place for item 7. Details in [PRICING-IMPROVEMENTS.md](../../governance/PRICING-IMPROVEMENTS.md) §2 and §3, TRACE-115.
- **Evidence (2026-10-19):** full SQL 4335 checks / 77 files, only the known 003 local failure (SQL 085 and 086 new; 079, 082, 083, 084 updated); concurrency script 3/3 (adds first-booking and same-name races); unit 447/447; lint, typecheck, `git diff --check` clean; synthetic build; full non-visual browser suite 525/525. Not run: `@visual`, hosted push, screen reader, a clean `supabase db reset` replay (it would wipe local data).
- **Local DB:** migrations 4–5 applied by psql and recorded by hand in `supabase_migrations.schema_migrations`; function bodies checked against the files.
- **Gates:** promotions gate `private.money_feature_gates.promotions_checkout` is closed until the two-person finance review of `20261018005000`; `private.promotion_release_unpaid()` is not scheduled.
- **Owner decision needed:** how a homeowner applies an offer (code, choosing a shown offer, automatic) and which offer wins when several qualify. Nothing reserves an offer for a request until then.
- **Not built (allowed, not required):** vendor-approved "Starting at" fallback rules; operator typo-only edits; optional add-ons for automatically matched providers.

## Not done / next candidates

- First-visit vs recurring pricing; template activation still copies levels without questions/rules (template-copy-to-draft is the supported path).
- Commit, open the PR (template in `.github/pull_request_template.md`), Codex review, owner dry-run push of the five migrations before merge (DEC-2026-037).
