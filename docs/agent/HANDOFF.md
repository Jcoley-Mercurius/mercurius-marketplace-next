# Agent handoff — 2026-10-01

## Phase 6.7 fulfillment, completion evidence and homeowner confirmation (TRACE-128), 2026-10-29

- Branch `claude/phase6-7-fulfillment` from `main` `7502342` (the PR #113 merge; head `0ebc9ef` CI green). Record: [PHASE-6-FULFILLMENT.md](../../governance/PHASE-6-FULFILLMENT.md).
- **PR #113 was merged without a recorded two-person finance sign-off** (PRICING-FINANCE-REVIEW §10 still says none is recorded). This is flagged for the owner, not resolved.
- Migration `20261029001000` (additive, **not pushed**):
  - trigger `guard_fulfillment_start`: work starts only on an accepted assignment, on every path;
  - `start_job` (keyed, stale-safe; records the payment state at start);
  - `homeowner_confirm_completion` / `homeowner_dispute_completion` bound to the reviewed completion;
  - `job_fulfillment` readback;
  - `admin_fulfillment_queue` and `admin_record_fulfillment_follow_up`.
  - No money function changed (fingerprint `45 | 34c51131…`).
- UI: `FulfillmentPanel` (all roles), `AdminFulfillmentQueue`, keyed vendor start, confirmation dialog, issue deadline, abandoned-upload cleanup.
- Fixtures: SQL 003, 024 and 062 now record the provider acceptance they assumed.
- **Open decision DEC-2026-050 (PROPOSED): may work start unpaid?** Recommendation A: paid only, with an audited admin exception (never for held or terms-blocked); recurring visits now, one-time after TRACE-126. Start is unchanged until it's answered.
- Characterized, unchanged: F9 (admin no-show or provider cancel on a visit re-offers it to other providers; 6.9); F10 (payout doesn't re-verify evidence; legacy only, 0 hosted); F11 (`support_tickets` client grants; 6.10). TRACE-126 and TRACE-127 stay open.
- Evidence: SQL 098 159/159 (6/6 mutations killed); clean replay of 203 migrations, full SQL 89 files 5,387 PASS; concurrency 6 scenarios ×4; unit 552/552; lint, typecheck, secret scan clean; synthetic build; browser `fulfillment` 8/8, regression 65/65. Record §10. Not run: full non-visual suite, `@visual`, screen reader, real devices, CI, hosted push.
- Next: Codex review; owner answers DEC-2026-050 and records the 6.6c finance sign-off; then the hosted push (dry run first) and merge, both with owner authorization.

## Phase 6.6c recurring visit payments (TRACE-125), 2026-10-27

- Branch `claude/phase6-6c-recurring-payments` from `main` `5e6d6ce` (PR #112 merge; main CI 40515529609 green). Record: [PHASE-6-RECURRING-PAYMENTS-BRIEF.md](../../governance/PHASE-6-RECURRING-PAYMENTS-BRIEF.md).
- Owner decision 2026-10-27 recorded in DEC-2026-049: items 5–6 approved; items 7–8 kept blocked (proposed rules not approved). MPS §6.4 updated; 6.7 acceptance item for unpaid start added to PHASE-6-SCOPE.
- Migration `20261027001000` (additive; **pushed to hosted 2026-10-28** at the owner's instruction: the dry run listed only it, the readback shows fingerprint `45 | 34c51131…`, client grants as designed, all money counts 0, and the dry run is now up to date):
  - a visit priced from its bound plan terms (`recurring_visit_terms`, `recurring_visit_source_check`) with catalog-stable evidence (`money_source` restated, one-time path byte-identical);
  - shared G6 classification `money_payment_exceptions` (quote queue restated onto it);
  - `recurring_visit_payment`, `admin_recurring_payment_queue`, `recurring_series` restated.
- UI: homeowner "Review and pay" link to `/checkout/{snapshot}`; `AdminRecurringPaymentQueue` on `/admin/requests`.
- Evidence: brief §8. Fingerprint `45 | 34c51131…`. Draft PR opened with Codex review items (distinct review reasons, shared obligation identity, tie-break §5a, header contrast fixed).
- Open:
  - **two-person finance review before merge, reviewers not named**;
  - merge (separate authorization; hosted push done);
  - TRACE-126 one-time accepted-price exposure (separate slice);
  - TRACE-127 add-on visit acceptance after a price change (characterized, unchanged).
- Next: owner names the finance reviewers; Codex reviews the diff.

## Phase 6.6b recurring cadence and plan controls (TRACE-124), 2026-10-27

- Branch `claude/phase6-6b-recurring-cadence` from `main` `61f0601` (PR #111 merge; PR #111 checks and main CI 40435258272 green; nothing merged since). Record: [PHASE-6-RECURRING-VISITS.md §7](../../governance/PHASE-6-RECURRING-VISITS.md).
- Owner decision 2026-10-26 recorded in DEC-2026-049: items 1–4 and 9 approved with clarifications; items 5–8 still PROPOSED. MPS §6.4 updated.
- Migration `20261026002000` (additive, **not pushed**): anchors (basis, append-only chain), lifecycle (pause/resume/stop), skipped/replaced cadence dates, `private.recurring_cadence_preview`, shared `create_recurring_visit_core` (manual wrapper unchanged signature; pause/stop recorded on every path), `admin_create_cadence_visit`, `admin_record_recurring_anchor`, `admin_resolve_cadence_date`, `admin_set_recurring_plan_state`, `recurring_series` restated. UI `RecurringCadenceControls`.
- Implementation choices for review: off-cadence visits count toward the two but handle no date until linked; skips/links are scoped to their anchor; proposal creation recomputes proposals under the lock (stale → `40001`, nothing recorded); lifecycle actions notify nobody.
- Evidence: record §7. Not run: hosted migration, `@visual`, screen reader, full non-visual browser suite, CI (pending push).
- Open: 6.6c charge timing (DEC-2026-049 items 5–8, finance review); `money_source` current-tier-price gap; homeowner self-service pause; lifecycle notifications (Phase 7); 6.9 per-visit cancellation economics.
- PR #112 (CI green on `c54a5ba`; a cancelled duplicate push run is not a failure). Hosted: `20261026002000` pushed 2026-10-27 at the owner's instruction (dry run listed only it); read back as in the record §7; fingerprint `42 | 1fe362b…`; dry run now up to date.
- Next: owner merges PR #112 (production deploy); then 6.6c (DEC-2026-049 items 5–8, finance review) or the prepaid slice.

## Phase 6.6a recurring visits: identities and duplicate-safe creation (TRACE-123), 2026-10-25

- Branch `claude/phase6-6-recurring-visits` in worktree `../mercurius-phase6-6-recurring-visits`, from `main` `0138080` (main CI run 40242555358 green). Record: [PHASE-6-RECURRING-VISITS.md](../../governance/PHASE-6-RECURRING-VISITS.md). Committed as PR #111.
- Migration `20261026001000` (not pushed): accepted plan terms recorded at acceptance; visit identity = plan + Eastern date; `admin_create_recurring_visit` (replay, recorded blocked outcomes, plan provider/package/level/price only); `recurring_series` readback; plan never worked on itself; legacy `job_visits` triggers dropped; `create_service_occurrence` refuses. UI `RecurringVisitsPanel` (admin, homeowner, vendor).
- Open: DEC-2026-049 (PROPOSED) cadence, horizon, DST/month-end, missed visits, pause/end, per-visit charge timing, price changes, quote/promotion plans, replacement provider. 6.6 not complete. Tax confirmation (6.4) and appointment confirmation E1 (6.5) remain separate.
- Hosted read-only 2026-10-25: 3 recurring requests (cancelled), 0 occurrences, 0 `job_visits`, 0 identities. PR #110's `20261025001000` is in hosted history and effective (anon/authenticated cannot select `policy_notes`); PR #110 deployed at `0138080` (22:58 UTC); the push itself is not recorded elsewhere and its timing relative to the deploy was not verified.
- Evidence: record §5. SQL 095 99/99; full SQL 86 files 4,939 PASS after a clean replay of 200; concurrency 3/3; unit 518/518; lint, typecheck, secret scan clean; synthetic build; browser `recurring-visits` 8/8, regression 70/73 with the 3 load timeouts passing alone. Not run: full non-visual suite, `@visual`, screen reader, CI, hosted.
- PR #111. Hosted: `20261026001000` pushed 2026-10-26 at the owner's instruction (dry run listed only it); read back as in the record §6; dry run now up to date.
- Next: Codex review; owner answers DEC-2026-049; then 6.6b/6.6c or the prepaid slice.

## TRACE-122 review corrections (PR #110), 2026-10-25

- Branch `claude/onboarding-review-fixes`, base `main` `404ea29`, reviewed head `55c39f9` (unchanged when work started). Owner-approved Codex review items 1–6; PR #110 not merged.
- New forward migration `20261025001000` (not pushed; `20261024003000` untouched): column-level grants on `vendor_packages` without `policy_notes` (anon/authenticated cannot read, filter or write it); vendor draft/approval JSON drops legacy notes; `validate_package_promotion` reads named columns; archived packages read-only (row, levels, questions, add-ons) and `vendor_package_archives`; exception window today+1..today+14 Eastern, `recorded_seq`/`sequence`, NOT VALID check. Hashes, values and bound requests unchanged.
- Rollout: push `20261025001000` AFTER the PR #110 deploy lands (the old client selects `policy_notes`/`*`); PR #110 client works on either schema. Deviates from the push-before-merge rule; owner decision.
- Hosted read-only 2026-10-25: history ends at `20261024003000`; 0 exceptions (none out of policy), 0 archives; 4 inactive revisions and 4 drafts hold legacy notes; anon/authenticated can still select the column.
- DEC-2026-048 owner rules recorded; slice brief [PHASE-6-PREPAID-PLANS-BRIEF.md](../../governance/PHASE-6-PREPAID-PLANS-BRIEF.md). Nothing prepaid built.
- Evidence: run 2026-10-25 on this branch: SQL 094 93/93 new (3 consecutive passes after the sequence fix), 093 64/64 (two storage reads via a definer helper); clean replay of 199 migrations; full SQL 85 files 4,841 PASS; `scripts/pricing-concurrency.mjs` 3/3; unit 509/509 (`package-archives` new, `home-size-guide` rewritten); lint, typecheck, secret scan, `git diff --check` clean; synthetic build; full non-visual browser suite 572 tests: 490 passed first, 82 load timeouts (load ~10–30) re-run with 1 worker, 77 passed, last 5 passed alone; new/updated tests in `vendor-prices`, `pricing-approval`, `onboarding-checklist` with axe. Not run: `@visual`, screen reader, hosted migration, CI (pending push).
- Found during verification: exception `sequence` first ordered by `created_at`/UUID, wrong for two writes in one transaction; now `recorded_seq` (identity).
- Local Supabase stack was stopped for the browser runs (`supabase stop`, backup kept).
- Next: Codex review of the corrections; owner merges, then pushes `20261025001000` (dry run first) once the deploy lands.

## Vendor onboarding review fixes (TRACE-122, DEC-2026-047/048), 2026-10-24

- Branch `claude/onboarding-review-fixes` from `main` `404ea29`, uncommitted for review. Owner review items 1, 2, 3, 5, 6 implemented; item 4 (prepaid plans) answered and recorded as DEC-2026-048, not implemented (own slice: checkout, scheduling, payout, refunds, finance review).
- Migration `20261024003000` (additive; copies existing notes only). First cut was numbered `20261024002000`/TRACE-121/SQL 092, which PR #109 (appointments) took and pushed meanwhile; renumbered.
- Notes: kept outside revision content because `package_revision_hash` covers `policy_notes` and requests bind to it. Hosted read-only: 4 lineages carry notes, none on an active revision; the legacy column keeps values on those inactive revisions (API-readable until replaced).
- Exception: evidence `requirement_version = 'exception'`, `evidence_ref = 'Exception: document pending'`, expiring at the end of the follow-up date (Eastern); counts for activation and matching until then; never over a current document; scoped compliance unchanged.
- Evidence: SQL 093 64/64, 083 updated; clean replay; full SQL 84 files 4,748 PASS; unit 498/498; lint, typecheck, secret scan clean; synthetic build; browser `vendor-prices`, `pricing-approval`, `onboarding-checklist` 40/40 (19 re-run after load timeouts). Full non-visual suite and `@visual` not run.
- Owner actions: push `20261024003000` (dry run first) before merge; replace the four live package descriptions that repeat the size guide (replacement draft per package, description only), then archive superseded versions.
- 2026-10-25: PR #110 opened. `20261024003000` pushed to hosted at the owner's instruction (dry run listed only it). Read back: in history; 4 internal-note rows copied; 0 archives, 0 exceptions; both triggers present; commands not executable by anon; no active revision holds notes.
- Next: Codex review; then the prepaid-plan slice (DEC-2026-048 open items first).

## Phase 6.5 appointments: Eastern Time and schedule history (TRACE-121), 2026-10-24

- Branch `claude/phase6-5-appointment-confirmation` in worktree `../mercurius-phase6-5-appointments`, from `origin/main` `0ba710e` (6.4 PR #106 merged; its Codex review still open). PR #109. Record: [PHASE-6-APPOINTMENTS.md](../../governance/PHASE-6-APPOINTMENTS.md).
- Migration `20261024002000` (additive): `job_operations.seq`; `admin_record_appointment` (Eastern wall-time check, stale guard, replay, recorded/changed/kept, keeps preferred date); `job_schedule` readback; `record_job_operation` restated with the generic `appointment` kind retired. Hosted read-only: 0 appointments, 0 scheduled, 0 job operations.
- UI: `AppointmentPanel` on homeowner, vendor and admin job details; `EasternDateTimeField`; one format ("Tue, Nov 3, 2026, 9:00 AM EST").
- Evidence: SQL 092 68/68; clean replay, full SQL 83 files 4,683 PASS; `scripts/appointment-concurrency.mjs` 3/3; unit 495/495; lint, typecheck, secret scan clean; synthetic build; browser `appointments` 8/8; regression 64/65 with `homeowner.spec.ts:23` timing out once under load and passing on reruns. Full non-visual suite, `@visual` and screen reader not run.
- Open: MPS E1 (what makes an appointment confirmed; owner); 6.9 owns reschedule consequences and provider-withdrawal handling of a recorded time; 6.6 owns recurring visit times.
- Hosted: `20261024002000` pushed 2026-10-24 at the owner's instruction (dry run showed only this file). Read back: in history, `seq` present, both functions signed-in only, generic appointment kind refused, 0 job operations; dry run now up to date.
- Next: Codex review of PR #109; CI; merge.

## Next.js 16.4.3 and CI image registry fallback (PR #108), 2026-10-24

- `npm audit --omit=dev` failed CI on `next` 16.0.0–16.4.0 (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr critical; GHSA-p3m5-59mp-jv5r). `next` and `eslint-config-next` pinned to 16.4.3. Evidence: audit 0 vulnerabilities; `npm run check` (unit 468/468, synthetic build); CI backend, lifecycle and application green. Local browser suite did not start under machine load (first `/mds` render ~60 s exceeds the webServer timeout); CI ran it.
- public.ecr.aws refused Supabase image pulls ("toomanyrequests: Data limit exceeded"); CI start retries now alternate public.ecr.aws, ghcr.io, public.ecr.aws. Merged as `b8f1095`; deployed.

## Operators publish prices without the vendor's approval (TRACE-120, DEC-2026-046), 2026-10-24

- Branch `claude/admin-publish-without-vendor-approval` from `main` `66d495e` (independent of PR #106, which holds DEC-2026-045/TRACE-119 and SQL 090). Owner instruction: the admin publishes pricing without the vendor's approval.
- Migration `20261024001000` (additive; no data change): `admin_publish_package_draft` restated from `20261018002000` without the approval gate; returns, records and notifies `vendor_approved`. Send-for-approval, vendor approve/ask-for-changes and history unchanged and optional. Vendor-funded promotion offers keep vendor approval.
- UI: Publish enabled on every open draft; the dialog says whether the vendor approved and shows a pending change request; admin, vendor and email copy updated.
- Evidence: SQL 091 new (080/083/085 refusal assertions removed); clean replay, full SQL 81 files 4,494 PASS; unit 468/468; lint, typecheck, secret scan clean; synthetic build; browser `vendor-prices` + `pricing-approval` 23/23. Full non-visual suite and `@visual` not run.
- 2026-10-24: merged `main` `0675805` (PR #106 and #108); conflicts only in HANDOFF, DECISION-LOG and TRACEABILITY, both entries kept.
- Next: Codex review; owner pushes `20261024001000` (dry run first) before merge.

## Phase 6.4 quotes: itemized proposals and quotes, owner decisions G1–G6 (TRACE-119, DEC-2026-045), 2026-10-23

- Branch `claude/phase6-4-vendor-quote-proposals`, uncommitted for review, fast-forwarded to `main` `66d495e` (PR #105). Record: [PHASE-6-QUOTES.md](../../governance/PHASE-6-QUOTES.md). Decisions: DEC-2026-045 (G1–G6), CFG-015 (thresholds), CFG-005 quote-deposit note, MPS §6.3/§7.5/§9 notes.
- Migration `20261022001000_phase6_quotes.sql` (additive; replaces the unpushed first cut): `request_quote_proposals`, `request_quote_terms` (itemized, tax pending unless confirmed, deposit $0), `request_quote_exceptions`; `vendor_propose_quote`, `admin_send_itemized_quote`, `admin_return_quote_proposal`, `admin_open/close_quote_exception`, `admin_record_quote_review`, `admin_quote_queue`; restated `homeowner_respond_to_quote` (approval needs complete terms, confirmed tax, eligible provider) and `admin_send_quote` (retired); guards make decided quotes and accepted request quote fields immutable on every path.
- UI: vendor itemized estimate (prefilled from the priced selection); admin quote panel and "Quote and payment exceptions" queue; homeowner breakdown with "Tax pending confirmation", Approve only for confirmed terms; Stripe return reads "Waiting for payment confirmation".
- Evidence: clean replay of 195 migrations; SQL 090 118/118, 005/007/023 updated (10/16/44); full SQL 81 files 4,598 PASS; unit 481/481; lint, typecheck, secret scan clean; synthetic build; browser `quote-proposals` 12 tests, `portals`, `homeowner` (see below). Full non-visual suite on a quiet machine 555/556 in 26 min; the one failure (`request.spec.ts:904`, intake add-ons, not touched here) passed 3/3 alone. `@visual`, screen reader and hosted checks not run.
- Machine note: WSL has 5.7 GB; under load the browser suite times out at 5 s/30 s. Never wrap `playwright test` in `timeout`: killing it orphans `next start` on 3103, and the next run silently uses the stale build. Check `ss -ltn | grep 3103` before a run.
- Open: tax authority — no command confirms a quote's tax, so no quote can be approved yet (DEC-2026-015 §4); finance review of quote discount lines in snapshots; Codex review; owner pushes `20261022001000` (dry run first) before merge.
- 2026-10-24: `20261022001000` already on hosted; merged to `main` as PR #106 (`0675805`) at the owner's instruction with CI green; Vercel deployed. Codex review still open.
- Next: Codex review; then 6.5 appointments, or the tax-confirmation slice once the owner/accountant approves tax rules.

## Operators add services to the catalog (TRACE-118, DEC-2026-044), 2026-10-21

- Branch `claude/catalog-add-services` from `main` `60d4f06`. Owner request: no way to add roof and pool services while building vendor profiles. Service Catalog now has "Add service"; the id follows the name and is fixed once added; hiding ("Shown" switch) is how a service is taken away. No delete, no migration.
- Evidence: unit `service-catalog` 10/10; SQL 089 10/10; browser `catalog-cadences` 5/5; full non-visual browser suite 544/544 after re-running sleep-induced timeouts (`request.spec.ts:1060` passed 3/3 alone). `@visual` not run.
- Next: review and merge (client only); then the owner adds Roof Replacement, Roof Repair, Pool Construction, Pool Resurfacing (Outdoor & Exterior) and AC Repair (HVAC & Mechanical) in production, and prices AC Repair for the vendor through Vendor Prices.

## Pricing: packages, vendor approval and promotions (TRACE-112–114, DEC-2026-038/039/040), 2026-10-18

- Branch `claude/pricing-revisions` from `main` `fdfb450`; uncommitted working tree for review. Owner task: the pricing review's copy-ready prompt (slice A, slice B, PR-10). Full record, observed-vs-reported matrix, evidence map, pilot steps and rollout: [PRICING-IMPROVEMENTS.md](../../governance/PRICING-IMPROVEMENTS.md).
- Migrations (not pushed): `20261018001000` (lineage/revisions, price meaning, structured add-ons, rule conditions, `private.price_selection`; finder, request preview, submission and checkout source restated), `20261018002000` (draft content, revision-bound vendor approval, template copy, previews, history, inventory; publish restated), `20261018003000` (funded offers, 7.5% economics, reservations; not wired to checkout).
- Decisions: DEC-2026-038 promotional commission 7.5% (approved; CFG-005, MPS §7.2/7.6 and AGENTS.md note the exception); DEC-2026-039 vendor approval and price meaning (owner instruction; supersedes DEC-2026-035's ungated publish and same-cadence refusal); DEC-2026-040 legacy live packages (proposed).
- Evidence: SQL 082 61/61, 083 85/85, 084 61/61, 080 52/52 (updated for approval), 066 68/68 (two assertions strip new keys), 063 65/65; full SQL 4230 tests with only the known 003 local-data failure; `scripts/pricing-concurrency.mjs` passed 3 consecutive runs; unit 437/437; lint and typecheck clean; synthetic build; browser full non-visual suite 519/519 (`pricing-approval` 9 new, `vendor-prices` 9 updated); `@visual` not run.
- Hosted read-only aggregates: 14 active packages; none with overlapping rules, add-ons or same-name conflicts; 6 published from drafts without vendor approval, 8 vendor-authored; none with recorded vendor approval.
- 2026-10-19 (TRACE-115, DEC-2026-041 owner answers): source comparison (§1 renumbered by source item); four source fixes; decisions 1–7 implemented in new migrations `20261018004000` (corrections via vendor approval, suspension, legacy approval evidence, unlinked-vendor email, same-name guard) and `20261018005000` (add-on checkout, promotional commission/subsidy in the money path, refund reversal, release/restore, first booking, promotions gate closed), plus `20261018001000` edited for unmatched answers. Evidence: SQL 085/086 new, full SQL 4331 with only the 003 local failure, concurrency 3/3, unit 447/447; browser 525/525.
- Open: how a homeowner applies an offer (owner); two-person finance review of `20261018005000` before the promotions gate opens; scheduling the unpaid-terms sweep; production replacement drafts for the six packages; Codex review.
- Next: Codex review; owner pushes the five migrations (dry run first) before merge. Continuation notes: [PRICING-CONTINUATION.md](PRICING-CONTINUATION.md).
- 2026-10-20 (TRACE-116, DEC-2026-042, owner directions): explicit offer selection and code entry on the request review; reservation with the submission; homeowner replace/remove/confirm on the request; `money_source` refuses an unconfirmed change; matching bound to the priced package, level and revision (add-ons kept, recurring visits too); add-ons without an offering refused; cleanup exactly once under checkout's locks; retried in-app sends reuse an unread notice. New migration `20261018006000`, SQL 087, review package [PRICING-FINANCE-REVIEW.md](../../governance/PRICING-FINANCE-REVIEW.md), runbook [PRICING-ROLLOUT.md](../../governance/PRICING-ROLLOUT.md), inactive schedule template `scripts/install-promotion-sweep.sql`. Hosted read-only: six migrations pending, 0 cron jobs, 0 money authorities. Open: second finance reviewer; CFG-007 replacement for bound bookings; all production steps (owner).
- 2026-10-20 pre-PR audit: clean replay on the isolated stack and full SQL/concurrency evidence; fixes (finance subsidy display, offers outage states, regenerated types, sign-off fingerprint `scripts/promotion-money-fingerprint.sql`) and open items in [PRICING-CONTINUATION.md](PRICING-CONTINUATION.md) "Pre-PR audit". All 14 active production vendors are unlinked.

## Production deploy and automatic deploys from main (DEC-2026-037), 2026-10-16

- Hosted migrations verified current: `20261016002000` and `20261016003000` applied (draft commands present; 10 services offer every two months); dry run reports nothing pending.
- Production had been on `dpl_9wD5Yx2SqxkQvznMi8FTMhbDEjfJ` (`283cfe5`, 2026-10-05). Deployed `main` `a245a99` from a clean `git archive` (no env file uploaded) as `dpl_AZEyDTVU95PoyFyzdKRbaTyRHYfS` (READY, 76 pages), promoted 2026-10-17 02:0x UTC; `www` and apex inspect to it, `www` 200, apex 308 → `www`. Rollback: promote `dpl_9wD5Yx2SqxkQvznMi8FTMhbDEjfJ`.
- Cause of the drift: `vercel.json` `git.deploymentEnabled: false` (since 2026-09-04) although the repo was connected with production branch `main`. Branch `claude/auto-deploy-main` sets `{ "main": true, "**": false }`, adds the AGENTS.md release rule and a PR template. Previews stay off: the Preview environment holds production Supabase and email keys.
- Next: merge; confirm the merge itself deploys to production; then catalog work.

## Recurring cadences on routine-maintenance services (TRACE-111, DEC-2026-036), 2026-10-16

- Branch `claude/recurring-cadences`, stacked on `claude/admin-price-drafts` (PR #98). Owner request: vendors can price weekly, every two weeks, monthly and every two months; owner delegated which services.
- Migration `20261016003000`: adds cadences to 12 catalog services (list in the migration header and DEC-2026-036), merged and idempotent; no removals, defaults or prices changed. `seed.sql` matches (seed runs after migrations, so a local reset would otherwise lose them). Local catalog matched production before the change.
- Catalog editor: saves cadences recurring-first, then one-time; field labels now wrap their controls (axe `label` was failing on the existing fields).
- Evidence: SQL 081 19/19; full SQL 4022 with only the known 003 local-data failure; second run of the migration updates 0 rows; `npm run check` (unit 420/420, synthetic build); browser `catalog-cadences` 2/2.
- Next: review; merge after PR #98; owner pushes `20261016002000` then `20261016003000`.

## Operator draft prices and "every two months" (TRACE-110, DEC-2026-035), 2026-10-16

- Branch `claude/admin-price-drafts`, stacked on `claude/admin-vendor-pricing` (PR #97, `195bee0`). Owner request: an admin way to add a price for a specific vendor, saved as a draft first; monthly and every-two-months options. Owner choices: a new `every-two-months` cadence (`bi-monthly` stays every two weeks); the admin publishes the draft (reason; vendor notified).
- Migration `20261016002000`: cadence constraints widened; guardrail (monthly reference), request preview and submission accept `every-two-months` (the two request functions are restated in full from the applied state; only the cadence list changed); private `operator_package_drafts`; `admin_save_package_draft`, `admin_package_drafts`, `admin_discard_package_draft`, `admin_publish_package_draft` (creates a custom fixed package, one tier per cadence; refused while an active package for the service has the same cadence; price history + vendor `pricing` notice).
- UI: "Add a price" + Draft prices on `/admin/vendor-prices` and the vendor page; Publish price dialog; catalog "Cadences offered"; every-two-months label/suffix on vendor, customer and admin surfaces; `/services` and `/pricing` now say every two weeks for `bi-monthly`; history lines no longer repeat a cadence-named tier ("Monthly (Monthly)").
- Evidence: SQL 080 51/51; full SQL 4003 with only the known 003 local-data failure; `npm run check` (secrets, lint, typecheck, unit 420/420, synthetic build); browser `vendor-prices` 9/9 (3 new); full non-visual browser suite 507/507; vendor-page specs re-run after the default drafts stub.
- Open: no catalog service offers every two months until an operator ticks it in Service Catalog; the legacy visit generator schedules weekly/monthly only (pre-existing); hosted migration not pushed.
- Next: owner review; Codex review; merge after PR #97; owner pushes `20261016002000`.

## Operator vendor price corrections (TRACE-109, DEC-2026-034), 2026-10-15

- Branch `claude/admin-vendor-pricing` from `main` `81d7674`. Owner request: admins set or review vendor prices. Owner choices: an all-vendors price view, operator edits of custom packages, correction from the Package Reviews queue; reason and audit record required; vendor notified only (no acceptance).
- Migration `20261016001000`: `admin_correct_package_prices` (operator; tier, add-on and deposit prices only; all or nothing; refused on a stale package or price read; custom guardrail via the existing triggers, template packages re-evaluated against template ranges; a correction is not an approval), private history, `admin_package_price_corrections`, `vendor_my_package_price_corrections` (no operator identity), vendor `pricing` notification.
- UI: `/admin/vendor-prices` (sidebar "Vendor Prices"); vendor page "Vendor prices" card with history; Correct prices in Package Reviews (tiers and deposit); the managed-template editor is read-only for operators on the vendor page; vendor "Price changes by Mercurius" panel on `/vendor/packages` and `/vendor/pricing`.
- Evidence: SQL 079 43/43 (stable over 3 runs); full SQL 3952 with only the known 003 local-data failure; `npm run check` (secrets, lint, typecheck, unit 407/407, synthetic build); browser `vendor-prices` 6/6 plus legacy-provider-review, onboarding-checklist, vendor-readiness, existing-provider-access, portals (65/65 together).
- Open: direct admin writes to package tables are still allowed by RLS (only the UI routes through the command); add-on prices are corrected from Vendor Prices, not the queue; template activation still writes the template's suggested prices without a reason; managed-template `needs_review` is still set by the vendor's browser (pre-existing).
- Hosted: `20261016001000` pushed 2026-10-15 at the owner's instruction (the only pending migration; dry run first). Read back: in hosted history; the three functions exist, signed-in only (not anon); history table has RLS, no signed-in read, 0 rows. Additive; the live site does not call it until PR #97 is deployed.
- Next: owner review; Codex review of PR #97; merge; deploy. Numbering: PR #96 holds DEC-2026-032/033 and TRACE-108.

## Closed applications hidden from the queue (TRACE-108, DEC-2026-032/033), 2026-10-15

- Branch `claude/applications-hide-closed` from `main` `34a4bc9`. Owner request: rejected applications stayed on `/admin/applications` indefinitely. The queue now defaults to "Open applications" (Rejected and Abandoned hidden), with "All, including closed", per-state filters and a "Show closed applications" link. Nothing is deleted; documents keep CFG-011's 90-day retention. The table's scroll region is focusable and named (axe `scrollable-region-focusable` when no rows show).
- DEC-2026-033 is PROPOSED, drafted at the owner's request: applicant details erased 3 years after closure, de-identified closure and retention record deleted at 7 years, holds pause both. Owner (and counsel) review before any implementation slice.
- Evidence: unit 394/394 (`application-queue-state` 3 new), typecheck, lint, secret scan, synthetic build, browser applications-page suites 144/144 (`application-retention` 2 new, reject test extended).
- Numbering: PR #95 holds DEC-2026-031; renumber on merge if needed.
- Next: owner review; merge and deploy (client only, no migration).

## Required vendor application fields (TRACE-105, DEC-2026-031), 2026-10-14

- Branch `claude/application-required-fields`, stacked on `claude/review-operator-upload` (PR #94, merged); renumbered 2026-10-15 from DEC-2026-030 to DEC-2026-031 when merging main. Owner decision: require more application fields; insurance (policy number and documents) and all documents stay optional so uninsured vendors can still apply.
- `/vendors/apply` and `/api/vendor-applications` now require last name, business address (new field; previously sent empty), at least one Lee County service area and a license or business tax receipt number. Insurance policy number optional ("if insured"). No migration.
- Evidence: secret scan, lint, typecheck, unit 387/387 (five refusal cases, one uninsured acceptance), synthetic build, browser `vendor-service-areas` + `vendor-readiness` + `application-retention` + `existing-provider-access` 40/40 (new step-blocking test with axe).
- Open: the vendor-page prefill does not copy the new address (the application queue shows it).

## Operator document upload under review (TRACE-105, DEC-2026-030), 2026-10-14

- Branch `claude/review-operator-upload` from `main` `adca693`. Owner report: applicants can submit `/vendors/apply` with no documents, and the vendor page offered no upload during review (operator upload was limited to active/suspended and the eight legacy reviews), so emailed license, tax receipt and insurance documents could not satisfy checklist items 4/5.
- Migration `20261015001000`: `private.vendor_renewal_submitter` lets an operator upload for a provider in `review`; `vendor_renewal_document_overview.operator_upload` is true in review. The provider still submits only while active/suspended; rejected/unknown refused. The upload awaits review until an operator records item 4 or 5 from it (unchanged command).
- UI: the vendor page section is "Uploaded documents"; License is labeled "License or business tax receipt" (standard v1 item 4); no new document type.
- Evidence: SQL 078 19/19, 040 84/84 (operator-in-review assertion flipped), 074 60/60, 073 46/46, 057 49/49, 058 62/62, 039 44/44, each with the migration applied inside the rolled-back test transaction (the local stack holds an unrelated `20261013001000` not on this branch, so `migration up` was refused; history left untouched). The first run caught a NULL guard that let an operator upload without onboarding; fixed with `is not distinct from`. Secret scan, lint, typecheck, unit 381/381, synthetic build, browser renewal-documents + renewal-retention + legacy-provider-review + onboarding-checklist + evidence-renewal 60/60.
- Next: Codex review; merge; deploy; owner pushes `20261015001000`. Second slice (owner decision 2026-10-14): `/vendors/apply` makes more fields required (last name, address, service areas, license/insurance numbers) and keeps documents optional.
- Renumbered 2026-10-15 when merging main: main took DEC-2026-029, migration `20261014001000` (`invitation_open_link`, already applied on hosted) and SQL 076/077, so this slice is now DEC-2026-030, `20261015001000` and SQL 078. No function overlap with main's migrations.

## Bind a provider's account while suspended (TRACE-105, DEC-2026-028), 2026-10-05

- Branch `claude/bind-while-suspended` from `main` `f9a02a3`. Owner report: J & M All Purpose was activated before its accepted invitation was bound (`no_account`, no vendor role) and no bind control appeared. Cause: both bind commands and the panel accepted only `review`, and nothing returns an active provider to review.
- Migration `20261005001000`: `vendor_link_existing_account` and `vendor_bind_invited_account` also accept `suspended`; `active` is refused with "Suspend the provider before binding an account"; otherwise unchanged. Repair path: Suspend → Bind accepted account → Activate (re-checks the checklist, grants the role).
- UI: the provider account panel explains the repair on an active unbound provider and offers binding while suspended.
- Evidence: SQL 075 18/18, 034 80/80, 037 72/72; full SQL 3841 ok + the known 003 local-data failure; `npm run check` pass; synthetic build, browser `invitation-binding` + `onboarding-checklist` 29/29, `account-linking` 17/17.
- Recorded: PR #88 merged as `283cfe5`; deployed 2026-10-05 from a clean `git archive` of `283cfe5` with `vercel deploy --prod --skip-domain` as `dpl_9wD5Yx2SqxkQvznMi8FTMhbDEjfJ` (READY, 73 pages, no build errors) and promoted 23:17:31 UTC; `www` and apex inspect to it, `www` 200, apex 308 → `www`. Rollback: promote `dpl_5oU5YMQiYbht5uWRo7R4jRuUhHPs`. Owner then pushed `20261005001000` and reports the J & M repair (Suspend → Bind → Activate) worked; not independently verified here.
- Open: Codex review of PR #88; J & M evidence concerns (item 9 "Test", license/insurance file labels) and profile services/coverage from the application, per Grokbot's review.

## Provider service-area map (TRACE-105), 2026-10-05

- Branch `claude/provider-service-area-map` from `main` `955a485`. Owner request: show the Service Area as a map instead of a ZIP list. A drawn Lee County SVG (`ServiceAreaMap`) shades the provider's served ZIPs; the community/ZIP list moved behind a "See ZIP codes by community" disclosure. Google Maps not used (no key, billing, or third-party script). Shapes are 2020 Census ZCTA boundaries from TIGERweb, generated by `scripts/generate-lee-zip-map.mjs` into `src/lib/leeZipMap.ts` (35 of 48 allowlist ZIPs; PO-box ZIPs have no boundary and appear only in the list). The allowlist stays authoritative; no data or schema change. Owner may roll back if the look is not preferred.
- Evidence: `npm run check` (secrets, lint, typecheck, unit 381/381, build); browser `provider-service-area` 9/9 (320/1440 px, axe on main, broad-coverage and PO-box-only cases).

## Public provider service area (TRACE-105), 2026-10-05

- Branch `claude/provider-service-area` from `main` `d6e1db5`. Owner report: the public profile's Service Area card showed fixed text ("Southwest Florida", "Coverage is confirmed for your service address") for every provider. It now lists the provider's `contractor_service_zips` grouped by community from active `coverage_areas` (ZIPs outside the allowlist are dropped), "Service area not listed yet" when none, and "Service area unavailable" on a failed read. Client only; both tables were already publicly readable.
- Evidence: typecheck, lint, unit 379/379 (`publicServiceAreas`), synthetic build, browser `provider-service-area` 4/4 (320/1440 px, axe on main).
- Recorded: PR #85 deployed 2026-10-05 02:50 UTC as `dpl_8A1Ckm6ojDBN99QQ8d8wNuLfn9kT` (main `d6e1db5`, clean `git archive`, source 944/945 identical); owner pushed `20261003001000` and `20261004001000` (hosted history verified); P & P activated by the owner through the legacy review.

## Legacy provider review without an application (TRACE-105, DEC-2026-027), 2026-10-04

- Branch `claude/legacy-provider-review` from `main` `33679c0`. Owner decision DEC-2026-027: the eight listed legacy providers (full list confirmed) start review without `/vendors/apply`; everyone else applies.
- Migration `20261004001000`: closed list recorded once by exact name (access-managed, no onboarding; a NOTICE reports the count); `r0_start_legacy_provider_review` writes a marked operator application record from the profile and confirmed contact and opens review revision 1 (no new-application notice or owner-notification record); `r0_legacy_review_status`; the existing operator document upload also works while a legacy review is open, since license/insurance evidence must be an application or uploaded document. Checklist, activation and listing unchanged.
- UI: vendor page "Start legacy review" panel (reason required) where the checklist said "not under onboarding review"; the document panel follows the server's `operator_upload`.
- Evidence: SQL 074 60/60, 073 46/46, full SQL 3818 ok + the known 003 local-data failure; typecheck, lint, unit 377/377, synthetic build, browser legacy-provider-review + onboarding-checklist + existing-provider-access + onboarding-intake 33/33. Found, not fixed: vendor-page Visibility switches have no accessible name (axe `button-name`).
- Production, 2026-10-05 00:42 UTC: `main` `33679c0` (PRs #80–#84) deployed from a clean `git archive` (source 938/939 identical; `.gitignore` excluded) as `dpl_H4gRC39NAuaBbZ9Zc2vtXgd2Rjby` and promoted; `www` serves it. Rollback: promote `dpl_EiFw54cToP3hHqo1H4EfxEq5eQhP`. Hosted migrations `20261003001000` and `20261004001000` pending the owner's `supabase db push --linked`.
- Next: Codex review; merge; deploy; owner pushes both migrations and confirms "8 of 8"; per provider: Start legacy review → upload license and insurance → record nine items → Activate → Active on platform, Marketing enabled, Publish.

## Onboarding review for access-bound existing providers (TRACE-105), 2026-10-03

- Branch `claude/existing-provider-onboarding` from `main` `9a05b66`. Owner report: P & P Cleaning Solutions was bound through Existing Provider Access and set up its profile, but no screen could approve it. Access-managed providers lost legacy `is_active` eligibility (R0.5), and TRACE-065 refuses review for an existing provider, so no onboarding row, checklist or activation was reachable (the R0.5 open follow-up "compliance path for access-managed providers").
- Owner decision 2026-10-03: close it with a **real application**. Migration `20261003001000`: `r0_start_existing_provider_review` (operator; application email = current confirmed contact = bound, confirmed account; reviewed access binding; no live attempt, onboarding or exclusion; latest version) links the application to the existing record and opens review revision 1. A trigger stops TRACE-065 from creating a second provider for such an application. `vendor_onboarding_intake_status` adds `existing_provider`. Checklist, evidence, activation (records `inherited_link`; the binding's vendor role stays) and listing are unchanged.
- UI: `/admin/applications` shows "Start review for existing provider" with the blocking reason; account-linking and invitation panels are hidden for it. The access panel now says "account bound" on an accepted attempt that was bound.
- Evidence: SQL 073 46/46 (migration + test, one rolled-back transaction); related suites 032/036/037/039/040/051/072 pass; full suite 3758 ok, 1 failure in 003 (escalation count 8 vs 2) that also fails without this migration (local admin data). Typecheck, lint, unit 365/365, synthetic build, browser onboarding-intake + existing-provider-access + onboarding-checklist 29/29. Not run: hosted migration (needs owner authorization), `@visual`.
- Next: Codex review; owner authorizes the hosted migration; P & P submits `/vendors/apply` from the confirmed contact address with license/insurance documents; operator starts review, records the nine items, activates; confirm `marketing_enabled` and content for the listing.

## Vendor application services from the catalog (TRACE-105), 2026-10-02

- Branch `claude/vendor-application-prefill` from `main` `46ae6ae` (independent of the password-reset branch). Owner decision 2026-10-02: applicants choose services from the live catalog (at least one required), plus an optional "Other" with a description, reviewed later for catalog additions.
- `/vendors/apply`: primary category = active `service_categories` (replaces 24 hard-coded categories); services = active `services_catalog` grouped by category, primary first; "Other" opens a required description (150 chars). `vendor_applications.services` stores catalog ids plus one `Other: …` entry; no migration. The route refuses choices outside the active catalog (400). The admin queue shows catalog names; the vendor-page prefill matches by id, then name (legacy rows).
- Evidence: typecheck, lint, unit 375/375, synthetic build, browser `vendor-service-areas` + `vendor-readiness` + `existing-provider-access` + `application-retention` 39/39 (earlier 22/22 for the prefill ran on a stale build; rerun here on the new build). Not run: hosted submission, `@visual`.
- Open: "Other" descriptions have no review report yet (read from the admin queue); applications submitted before this keep free-text names.

## Vendor profile prefill from the application (TRACE-105), 2026-10-02

- Owner report: after "Start onboarding review", `/admin/vendors/[id]` showed only the business name. Cause: `vendor_start_onboarding_review` (migration `20260911001000`) inserts the contractor with `name` only.
- Fix (client only, no migration or hosted write): the vendor page reads the linked application and fills empty bio, website, years, email, phone, catalog services (exact name match) and ZIPs (service-area communities → `coverage_areas.city`). Values already on the profile are not changed. Nothing is saved until Publish. Credentials are not turned into badges. A notice lists filled fields and services with no catalog match. `serviceAreaCommunities` moved from the test into `src/lib/vendorServiceAreas.ts`.
- Evidence: typecheck, lint, unit 368/368 (new `vendor-application-prefill` 3/3), browser `vendor-readiness` + `existing-provider-access` 22/22. Not run: manual check on a real application.
- Open for Codex: whether the review-start function should also copy these fields server-side; free-text application services that don't match a catalog name still need selecting by hand.

## Vendor password reset and access routing (TRACE-105), 2026-10-01

- Branch `claude/vendor-password-reset` from `main` `46ae6ae`. Cause: two provider invites (TDJ Construction, All Surface) clicked after the 3-hour link lifetime; the fallback reset email used `{{ .ConfirmationURL }}` (PKCE, same-browser only, spent by any GET), so it confirmed the accounts but showed "expired", and later invites were refused `email_exists`.
- Hosted change (owner-approved): Auth recovery template now links to `/set-password?token_hash=…&type=recovery`; read back identical. Source in `supabase/templates/password-recovery.html`. Owner-approved recovery emails sent to both accounts; both then bound via existing-account access.
- Code: `/forgot-password?for=vendor` (vendor badge, back to `/login/vendor`); vendor sign-in, expired provider links and `/invitation` sign-in route to the vendor pages. Evidence: lint, typecheck, synthetic build, `invitations` + `existing-provider-access` specs 18/18.
- Open: the 3-hour invite lifetime (owner decision 2026-09-13); `/set-password` still verifies on page load (JS-running scanners can spend a link); the admin panel does not show the account ID after an `email_exists` refusal.

## R0 public cutover: mercuriusmarketplace.com live (TRACE-105), 2026-10-01

- Release `fa633f7` (PR #79 merge; CI 36854980590 attempt 2) → `dpl_EiFw54cToP3hHqo1H4EfxEq5eQhP`, source 927/927 identical, promoted 11:59:17 UTC. Edge functions byte-identical to the release; no migration since `7591134`. [Results](../../governance/R0-RELEASE-CANDIDATE.md#public-cutover-2026-10-01).
- Found unrecorded: three `469112e` builds (01:34–02:11 UTC) and R4–R8 already applied (values read back in the report).
- Pre-cutover on the release: T1, T2, T3, T4, T6, T7 PASS; T5 waived by owner.
- Cutover 12:33:50–12:33:52 UTC: both domains moved from `mercurius-landing-page`; `www` canonical, apex 308. DNS unchanged (GoDaddy). R9 at 12:34:47–58 UTC: Auth Site URL/allow-list and `SITE_URL`/`MERCURIUS_INVITATION_SITE_ORIGIN` → `https://www.mercuriusmarketplace.com`.
- Final domain: HTTPS/redirects, light-only, homeowner signup, vendor application/private upload/notification, booking/checkout denial, discovery PASS. **Outstanding:** synthetic invitation/password setup/login on `www` (owner sends to `+r0access3`).
- **R0 publicly live by owner go-ahead**; DEC-2026-025 reaffirmed; G2 (keep rehearsal until ~2026-10-08, then delete) and G5 (current emails) approved. Payments/transactions disabled; real invitations sent: 0.
- Next: the `www` invitation check; test-data cleanup (deletes refused by session policy; needs owner authorization); delete rehearsal project ~2026-10-08; decide on the public `vercel.app` alias; Codex review of this record.


## R0.5 step 2: upload configuration and legacy checkout closure (TRACE-105), 2026-09-30

- Release `759113496fd37ebfefb5e1da42ba640580ab7bdb` (PR #75; CI 36782043110), used from a clean detached worktree. Docs branch `codex/r0-rollout-step2`. [Results](../../governance/R0-RELEASE-CANDIDATE.md#step-2-results-2026-09-30-upload-configuration-and-checkout-closure).
- R1 upload configuration **PASS (config only)**: `VENDOR_UPLOAD_HMAC_SECRET` (64 chars, sensitive) and `VENDOR_UPLOAD_HMAC_VERSION=v1` added to Vercel `mercurius-marketplace-next` Production only. Other Vercel values not re-entered. Hosted upload unproven until T1 after R2 (B1 open until then).
- R3 checkout closure **PASS**: `create-checkout` v12, `checkout-request` v17, source byte-identical to the release; `MERCURIUS_MONEY_MODE` absent; temporary signed-in synthetic user → 6/6 `MONEY_NOT_ACTIVATED`; 0 checkout attempts, invoice/request counts unchanged; test user and its loyalty row removed. B2 closed.
- Unchanged: Vercel deployment `735df91` (not deployed/promoted), domains, DNS, Auth, SMTP, `vendor-invite`, invitations (0 sent), transactions disabled.
- R2: `dpl_B2ykDprcTQm75GZUFAvCu2jN3AUR` built from `7591134` (source identical), **not promoted**; public alias still `735df91`. Owner found non-Lee service areas (Naples, Punta Gorda) in `/vendors/apply` → PR #77 (`codex/r0-lee-county-service-areas`).
- Next: Codex reviews #76 and #77; merge #77; redeploy R2 from the new merge SHA, owner promotes, live checks on the alias (resolves B3); then T1 upload proof.

## R0.5 recruiting release: production verified, light-only built, hosted rollout prepared (TRACE-105)

- Base `main` `5df97a2`; branch `codex/r0-light-only-release`; code commit `cfdcf49` (light-only, DEC-2026-026; two homepage light-contrast fixes). Final release SHA = the reviewed merge into `main`; record it before R1. [Report](../../governance/R0-RELEASE-CANDIDATE.md): verified state, rollout package R1–R9, tests T1–T7, DNS/cutover D1–D3, running checklist, go/no-go G1–G7.
- Production, verified read-only 2026-09-30 (supersedes "nothing changed" below): 178/178 migrations, 0 pending (14 repaired + 81 pushed after `20260731172714`); restore point = daily backup 2026-09-30 10:17 UTC; 11 exclusions + 8 contacts at 18:22 UTC; `@mercurius.com` admins removed (their deletion cascaded 1 older service request); 0 listable/matchable providers; 0 access attempts. Push/dry-run logs were reported, not re-read. Unchanged: `vendor-invite` v11, Auth, SMTP, Vercel `735df91`, domain on `mercurius-landing-page`.
- Blockers: B1 Vercel lacks `VENDOR_UPLOAD_HMAC_*`; B2 legacy `create-checkout`/`checkout-request` (August builds) create Stripe sessions without the R0 admission gate → redeploy from release (money mode unset); B3 stale `735df91` publicly reachable on `mercurius-marketplace-next.vercel.app`; B4 hosted tests not run.
- DNS: GoDaddy authoritative; apex/www already match Vercel's recommended values → cutover is a Vercel project reassignment only (canonical `www`, apex 308).
- No external write was made in this session (only read-only checks were authorized). Real invitations sent: 0. Rehearsal project still running; deletion waits on G2 (pre-push state retention; backup rotates ~2026-10-08).
- Next: Codex reviews the branch; Josh authorizes G1 (R1–R3), then R4–R8, T1–T7, then cutover.

## R0.5 release candidate: existing-provider access implemented (TRACE-105); for Codex review

- Base: `main` `a88da4f` (R0.4 #72 merged). Branch `codex/r0-release-candidate`. Migration `20260930001000` (owner-confirmed contacts, access invitations with TRACE-063 protections, reviewed binding with vendor role per DEC-2026-024, legacy eligibility closed for access-managed providers). [Report](../../governance/R0-RELEASE-CANDIDATE.md).
- Evidence: SQL 072 128/128; full SQL 3710 + 071 update; local e2e 31/31 (`scripts/r0-existing-provider-access.mjs`); Edge 20/20; unit 352/352; browser specs 40/40; build.
- Hosted production: nothing changed. Rehearsal done on restored project `bykrrbasvjpuljnrkwdo` (delete after rollout): 14 migrations already present in production need a history repair, 81 apply; production contractor update-scope trigger never enforces — fixed by `20260930002000`. Resend verified by owner; test send accepted. Next: owner approval for the production push.
- Owner: Aristotle disposition, `@mercurius.com` admins, DEC-2026-025 exception at go/no-go. Real invitations sent: 0.

## R0.4 vendor/operator readiness implemented (TRACE-104); for Codex review

- Base: `main` `80a9aa6` (R0.1 #69, R0.2 #70 merged) merged into R0.3 head `3b2c7f6` (#71 open) as `ac8a502`; branch `codex/r0-vendor-readiness`. PR to `main` shows R0.3's diff until #71 merges.
- Migration `20260929003000`: owner-notification delivery ledger (trigger-created with the application; claim/record/resend/acknowledge), invitation attention, listing rule + operator exclusions (also leave matching), public projection, cleanup inventory, vendor listing readback. `/admin/recruiting`, vendor recruiting notice/listing card, owner-confirmed contacts. [Report](../../governance/R0-VENDOR-READINESS.md).
- Evidence and R0.5 checklist are in the report. Owner: name a backup admin or record an exception (conflict with the R0 gate). Not built: trial-admission operator UI (D9).
- Next: Codex reviews D1–D10; R0.5 hosted rehearsal. No hosted action taken.

## R0.3 early-access experience implemented (TRACE-103); PR #71 open

- Branch `codex/r0-early-access-ui` from PR #70 head `1965383` merged with PR #69 head `6c20314` (`791e1c9`). Public CTAs lead to `/early-access`; waiting/invited/closed account states; `/request` and checkout closed for unadmitted accounts; new read-only `r0_my_trial_access()` (migration `20260929002000`). [Report](../../governance/R0-EXPERIENCE.md).
- Evidence: SQL 070 17/17 (rolled back on the integration stack); unit 331/331; typecheck, lint, secret scan, synthetic build; browser non-visual 401/401. Not run: `@visual`, CI, full SQL/reset, human screen reader and real zoom.
- The transitive `undici`/`ip-address` refresh was later committed as `3b2c7f6`. First CI run failed in database start (runner infrastructure), not a test.
- Next: Codex reviews D1–D11; human accessibility pass; regenerate `@visual` baselines. No deployment or activation.

## R0.2 main integration — 2026-09-29

- Branch `codex/r0-interest-main` = `codex/r0-admission-main` + merge of #67 head `2c2e697` (R0.2 incl. review fix `219e85b`) + evidence docs. No R0.2 source change; migration `20260929001000` applies after 6.3 and R0.1.
- Throwaway stack 5652x after blank reset: full SQL 3491/3491 (60 files), 069 164/164; security advisor no issues; interest concurrency PASS (first local run); 6.3 matching 11/11; request 32/32; Phase 5 concurrency PASS; unit 320/320; typecheck/lint/secrets; build per [report](../../governance/R0-INTEREST.md#main-integration--2026-09-29-trace-102).
- Merge order: experience docs PR → R0.1 PR → R0.2 PR, each to `main` with merge commits. Next: Codex review. Open: CI, route/Edge/browser integration, email, double opt-in, expansion retention, hosted. R0.3 not started.

## R0.1 main integration — 2026-09-29

- PRs #66/#67 merged into already-merged stack branches, so R0.1/R0.2 never reached `main`. Branch `codex/r0-admission-main` = `main` `9cc4295` + experience docs `8fcf303` + merge of #66 head `7e582e6` + integration fix. R0.1 checkout migration renamed `20260929000500` (collided with 6.3's `20260929000000`); request script fixture admits the provider-homeowner and `tree-trimming`.
- Throwaway stack 5652x: full SQL 3327/3327 (59 files) incl. 067 and 068; migration replay 12/12; request script 32/32; 6.3 matching 11/11; concurrency PASS; unit 299/299; typecheck/lint/secrets. [Report](../../governance/R0-ADMISSION.md#main-integration--2026-09-29-trace-101).
- Next: Codex reviews R0.1 PR; R0.2 integration (`codex/r0-interest-main`) is stacked on it. Open: CI, Edge/browser, independent review, hosted. No R0.3 or hosted action.

## R0 early-access design checkpoint — 2026-09-29

- On branch `codex/r0-experience` from `9cc4295`, Josh's approved 2026-09-28 [homeowner experience](../../governance/HOMEOWNER-EARLY-ACCESS-EXPERIENCE.md) is in governance with [route/state reconciliation](../../governance/HOMEOWNER-EARLY-ACCESS-RECONCILIATION.md), TRACE-100/103 links, and MDS/roadmap references. Documentation only; Phase 6 branch and code remain untouched.
- Next bounded implementation remains R0.1 / TRACE-101 default-closed request and checkout authorization, before R0.2 interest storage and R0.3 public route work. External activation remains gated.

## R0.2 local checkpoint — 2026-09-28

- Branch `codex/r0-interest` stacked on R0.1 `5e31d55` (which fixes an `e7ccb07` regression that refused inactive/waitlist cells as uninvited; SQL 063 65/65, 068 27/27, full 3270/3270). R0.1 CI failures were public.ecr.aws image-pull rate limits, not code.
- R0.2/TRACE-102: private interest/consent/suppression/retention records and service-key, verified-account and operator commands; three public routes. Evidence and open decisions: [R0-INTEREST.md](../../governance/R0-INTEREST.md). Host memory was exhausted, so tests ran in rolled-back transactions on the existing R0 stack (5642x), which is unchanged.
- Open: companion early-access experience artifact (requested from owner), blank-reset replay, advisors, CI, concurrency/route integration, email delivery, double opt-in and expansion-retention decisions. No external action.

## R0.1 local checkpoint — 2026-09-28

- Branch `codex/r0-admission` stacked on R0 authority commit `87baae7`, isolated from Phase 6. Migration `20260928232242` defaults request/checkout admission closed; owner clarification DEC-2026-023 blocks every new checkout after revocation.
- Isolated Supabase stack (ports 5642x): migration applied. `e7ccb07` regressed SQL 063 (inactive/waitlist cells refused as uninvited); fixed so inactive cells gate only with admission history. SQL 068 27/27, full 58-file suite 3270/3270, security advisor no issues at `e7ccb07`. No shared Phase 6 database reset.
- Open: independent code review, direct Edge/browser and concurrency proof, CI, operator provisioning, already-issued Stripe session expiration for R1, hosted migration. R0.2 interest/consent follows reviewed R0.1; no external activation.

## R0 authority checkpoint — 2026-09-28

- Branch `codex/r0-launch-authority` from remote main `37d212e`, isolated from open Phase 6 PR #64. Founder-approved R0/R1/R2 decision is recorded as DEC-2026-022/CFG-014, with R0.0–R0.5 in the roadmap and TRACE-100–105.
- Read-only recheck: Vercel latest production deployment `735df91` (2026-09-04); hosted Mercurius Supabase migration latest `20260731172714` (83 entries); `vercel.json` disables Git deploy. The dated hosted rollout plan must be recalculated.
- Open: companion early-access design, Founding Vendor and Credits source files are absent from this checkout; exact copy/mechanics need reconciliation. R0.1 default-closed request/checkout gate is the next bounded code slice. No hosted mutation, deployment, domain move or transaction activation.


## Current checkpoint — 6.3 implemented (TRACE-099); awaiting Codex review

- Branch `codex/phase6-matching-offers`, stacked on `63f1537` (PR #62, unreviewed) by owner instruction.
  Presentation helper `offerStatus.ts`; homeowner offer/consent/exhaustion states; vendor confirmed,
  read-back accept/decline with ET deadline. Migration `20260929000000` repairs the vendor write-scope
  trigger (definer bypass let offered/assigned vendors rewrite homeowner address/ZIP). [Report](../../governance/PHASE-6-MATCHING.md).
- Evidence: SQL 067 54/54 (red check 5 fails pre-repair); full SQL and isolated clean reset 3298/58;
  scripts 11/11 (6.3), 32/32 (6.1), 62/62 (TRACE-097); unit 299/299; browser 328/328 non-visual;
  typecheck, secrets, full lint. No human screen-reader/zoom, @visual, CI or hosted run.
- PR to `main` also carries the P6-R2/P6-R3 repair `63f1537`: PR #62 merged into the already-merged
  review branch, so the repair was not in `main` after #63.
- Next: Codex reviews 6.3 and decisions 1–7; P6-R2/P6-R3 re-review; hosted trigger check needs owner authorization.

## Previous checkpoint — P6-R2/P6-R3 repaired; awaiting Codex re-review

- Uncommitted on `codex/phase6-intake` review branch `c9a4a23` (Codex review + `464ab34`), TRACE-098. P6-R2: the saved confirmation
  uses `canonicalRequestState` for scheduled and later states, and `quote_status`/`quote_amount`
  from the dashboard's existing readback for quotes. Paid, refunded or unknown payment is never
  shown as "nothing charged". Checkout and matching retry run only while the request is at
  intake (`intakeCheckoutAllowed`/`intakeMatchingAllowed`). P6-R3: an unknown attempt replays
  its persisted key/payload before contact validation, coverage or preview. The submit button
  stays enabled and labelled for replay whatever the coverage state.
- Evidence: Codex repro 4/4 pass; units 286/286 (20 new); typecheck, lint, synthetic build PASS;
  request browser suite 82/82 on `c9a4a23` incl. 4 new cases and visual (an earlier run on
  `0a02320` had one axe `frame.evaluate` timeout, 3/3 on rerun). No SQL/migration change; no DB, manual or CI run.
- Next: Codex re-reviews; then 6.3 / TRACE-099.

## Previous checkpoint — Codex 6.2 review; 6.3 brief prepared

- Reviewed `codex/phase6-intake` head `634837a`, implementation base `c2b9b81`.
  [Review](../../governance/PHASE-6-INTAKE-REVIEW.md), TRACE-098: changes required.
  P6-R2: confirmation ignores current lifecycle on saved reload (4 reproduced failures).
  P6-R3: coverage/form validation precedes unknown-attempt replay (code-path finding).
- P6-R1 local code re-review is clear. New evidence: SQL 063–066 **178/178**;
  focused units **70/70**; typecheck PASS; real RPC/concurrency/Storage script **32/32**,
  fixtures cleaned. No new browser/build/manual/CI result; owner-closed human gate preserved.
- Next: Claude repairs P6-R2/P6-R3 under TRACE-098, returns regression evidence for
  Codex re-review, then implements [6.3 / TRACE-099](../../governance/PHASE-6-MATCHING-BRIEF.md)
  from the reviewed merged base (or explicitly authorized stack).
- Open: merge/final-head and post-merge CI, local checkout integration, script CI wiring,
  promotion backend refusal/data cutover and intake orphan-retention decision; hosted
  rollout/reconciliation and delivery stay in their named later phases. No external activation.

## Previous checkpoint — 6.2 intake implemented (TRACE-098)

- Branch `codex/phase6-intake`, **stacked on the P6-R1 repair `c2b9b81`** (PR #59, not yet
  re-reviewed or merged) at the owner's request. Migration `20260928000000`: read-only anonymous
  `preview_service_request_selections` (mirrors the command; no identities) over answer-aware
  eligibility (five-argument wrapper unchanged in behavior). Intake reworked: early per-ZIP
  availability and interest, locked saved result with photo/matching/checkout recovery, honest
  per-service confirmation, sign-up continuation.
- Evidence: SQL 066 68/68; clean reset 3244 / 57 PASS; script 32/32 on the main local stack;
  274 unit; request browser suite and axe matrix. Owner-reported visual review and screen-reader
  checklist in Chrome on a laptop: no errors; the owner closed the human accessibility/visual gate.
  [Report](../../governance/PHASE-6-INTAKE.md).
- Open: P6-R1 re-review/merge, then Codex review of 6.2 (D1–D9, notably D6 promotion refusal and
  D7 intake orphan retention), PR #60 CI, checkout Edge function locally. Next: 6.3 after
  PR #60 is done. No
  external activation.

## Previous checkpoint — P6-R1 role repair implemented (TRACE-095)

- Branch `codex/phase6-role-repair` from `ab17e99` (PR #58 head). Migration `20260927020000`:
  public `submit_service_requests` now requires the homeowner role before validation, replay
  or writes; the unchanged 6.1 body is `private.submit_service_requests_core`.
- Evidence: SQL 065 29/29 (11 failed pre-fix), 063 65/65, 064 16/16, script 23/23; clean reset
  3176 / 56 PASS; types unchanged. [Report](../../governance/PHASE-6-REQUEST-SUBMISSION.md#p6-r1-repair-homeowner-role-enforcement-2026-09-27-branch-codex-phase6-role-repair-from-ab17e99).
- Open: Codex re-review; PR/CI; merge of #58 and this repair to main. Next: after re-review,
  Claude starts 6.2 (TRACE-098) on `codex/phase6-intake` from merged main. No external activation.

## Previous checkpoint — Codex 6.1 decisions reviewed; 6.2 brief prepared

- Branch `codex/phase6-cleanup`; reviewed base `0e4793b` (main merge `b85c887`).
  [Focused review](../../governance/PHASE-6-DECISION-REVIEW.md): D3 requires P6-R1,
  enforcing the existing homeowner capability at submission/replay. Other D1–D7
  dispositions and both owner-confirmed ZIP boundary calls are recorded there.
- New local evidence: SQL 063 65/65, SQL 064 16/16; rollback-only role reproduction
  4/4 confirms vendor-only submission. These are focused checks, not full acceptance.
- [6.2 brief](../../governance/PHASE-6-INTAKE-BRIEF.md), TRACE-098, is ready for Claude
  after the TRACE-095 role repair and Codex re-review. No 6.2 code implemented.
- Open: repair/re-review, merged follow-up/CI, script CI wiring, local checkout
  integration, human accessibility, hosted coverage reconciliation (Phase 8).
  Next: Claude implements the bounded D3 forward fix. No external activation.

## Previous checkpoint — 6.1 merged (PR #56); post-merge cleanup (TRACE-095)

- Branch `codex/phase6-cleanup` from main `b85c887` (main CI 36292614304 passed). Scope: review-step
  copy fix (CodeRabbit on #56), stale Phase 4 line in PHASE-6-SCOPE.md, and the Lee County
  allowlist: migration `20260927010000` with the 47 USPS Lee County ZIPs (owner DEC-2026-021).
- Evidence: SQL 064 (16), 3147 assertions / 55 suites on a clean reset; script 21/21;
  `npm run check`; 16/16 request browser tests. [Follow-up](../../governance/PHASE-6-REQUEST-SUBMISSION.md#post-merge-follow-up-2026-09-27-branch-codex-phase6-cleanup-from-main-b85c887).
- Open: PR/CI; Codex review of 6.1 (D1–D7) and this follow-up; script CI wiring; hosted
  coverage reconciliation (Phase 8). Next: Codex writes the 6.2 brief. No external activation.

## Previous checkpoint — Phase 6 slice 6.1 implemented (TRACE-095)

- Branch `codex/phase6-request-submission` from main `2ed8036`. Migration `20260927000000`
  (`submit_service_requests`, browser INSERT revoked, homeowner ZIP edit closed); intake adapted.
  Owner decisions DEC-2026-020 (all-or-nothing plans; uncataloged → interest).
- Evidence: SQL 063 (65), 3131 assertions / 54 suites, script 21/21 with concurrency, 11/12 SQL
  mutants (1 equivalent), 231 unit, 16/16 request browser tests, 251/252 non-visual browser (homeowner light 1440px
  axe contrast/timeout, unchanged code), `npm run check`.
  [Report](../../governance/PHASE-6-REQUEST-SUBMISSION.md).
- Open: Codex review (D1–D7), PR/CI, approved ZIP allowlist (CFG-001), script CI wiring.
  Next: slice 6.2 after review. No external activation.

## Previous checkpoint — Phase 4 accepted; Phase 6 released (DEC-2026-019)

- Owner accepted Phase 4 and released the Phase 6 hold after the TRACE-097 repair (PR #55) and a
  Codex re-review the owner reported as clear (not yet written in the repo).
- Open: merge PR #54 then #55 (retarget #55 to `main`) and their CI; whether to add
  `scripts/phase4-completion-integrity.mjs` to CI.
- Next: Phase 6 slice 6.1 (TRACE-095) per [PHASE-6-SCOPE.md](../../governance/PHASE-6-SCOPE.md).
  No external activation authorized.

## Previous checkpoint — TRACE-097 Phase 4 completion repair

- Branch `codex/phase4-completion-integrity`, stacked on the review branch (PR #54, `efb4244`).
- Scope: P4-R1/P4-R2 only ([report](../../governance/PHASE-4-COMPLETION-INTEGRITY.md)). Migration
  `20260926003000`, completion dialog wording, suite 062, script `phase4-completion-integrity.mjs`.
- Evidence: 3066 SQL assertions / 53 suites on a clean reset; 62 Storage/REST/concurrency checks;
  review reproductions no longer reproduce; 11/11 SQL mutants; lint, typecheck, 204 unit tests, build;
  244/246 non-visual browser cases (2 unchanged-spec timeouts passed on rerun).
- Open: Codex re-review (D1–D4); adding the script to CI (edit declined pending owner decision);
  PR CI; owner Phase 4 acceptance and Phase 6 hold release. TRACE-095 not started. No external activation.

## Previous checkpoint — Phase 4 review requires fixes; Phase 6 implementation held

- Base: merged main `1baf270` (PR #53, DEC-2026-017). Phase 5 is closed; Phase 4 is not accepted.
- Owner requested Phase 4 review before Phase 6 work (DEC-2026-018). [Review](../../governance/PHASE-4-CODE-REVIEW.md),
  TRACE-096: P4-R1 (NULL photo slots bypass evidence) and P4-R2 (completion/admin deadlock).
- New evidence: 251 SQL assertions / 15 rollback-only suites; 14 lifecycle unit tests;
  both defects reproduced on the isolated synthetic database, with fixture cleanup.
  Main CI 36263730879 passed all jobs after rerunning the failed invitation browser fixture.
- Phase 6 [scope](../../governance/PHASE-6-SCOPE.md): 13 planned slices across seven areas.
  TRACE-095 / 6.1 remains blocked; no Phase 6 implementation started.
- Next: Claude repairs Phase 4 completion evidence and lock order under a new trace entry;
  Codex re-reviews, then owner decides Phase 4 acceptance and release of the Phase 6 hold.
  No external activation authorized. Review branch: `codex/phase4-review-phase6-scope`.

## Previous checkpoint — TRACE-093 and TRACE-094 (closure review fixes)

- `main` is `6c41143` (PR #49). Branch `codex/phase5-review-fixes` is based on `b55fb1b`, which
  is `main` plus TRACE-092, DEC-2026-016, suite 059 and the Codex review. It targets `main` directly,
  so merging it also brings the closure package into `main`.
- TRACE-093 (P1): deletions go through the operator session and a quarantine delete policy
  that takes the hold locks inside Storage's transaction. TRACE-094 (P2): finalization appends
  under the application row lock. See the [fixes report](../../governance/PHASE-5-REVIEW-FIXES.md).
- Evidence: suites 060 and 061; two new CI scripts; local route replay and round trip; mutation
  checks (7 of 7).
- Open: CI on the PR head and on post-merge `main`; Codex re-review; then one owner decision
  accepting Phase 4, closing Phase 5 and authorizing Phase 6. No external activation was performed.

The sections below are historical checkpoints.


## Codex closure review — 2026-09-26

Fetched `origin/main` is `6c41143` (PR #49); main CI 36165305771 passed all three jobs.
PR #50 merged into the renewal-upload branch after PR #49's main merge, so TRACE-092,
DEC-2026-016 and suite 059 remain outside main. The earlier checkpoint below is historical.
[Codex review](../../governance/PHASE-5-CODE-REVIEW.md), tied to TRACE-092, requires changes:
P1 retention hold/Storage deletion race; P2 concurrent document-finalization lost update
(synthetic actual-route reproduction confirmed); and closure package inclusion in main.
Next: Claude implements a bounded retention coordination fix with concurrency evidence,
then atomic document finalization; Codex reviews the fixes before combined Phase 4/5
acceptance and owner Phase 6 authorization. No external activation was performed.

Historical checkpoint (2026-09-25): `main` at `cd0c041` after PR #48 (TRACE-090). The dated
sections below preserve earlier slice evidence; their old branch and PR statuses
are historical. Use the current checkpoint and the Phase 5 handoff for next work.

## Current repository and Phase 5 checkpoint

- PR #48 (TRACE-090) merged on 2026-09-25; post-merge
  [main CI run 36138739942](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/36138739942)
  passed backend, lifecycle and application. DEC-2026-012 is fully implemented
  (TRACE-084–090).
- DEC-2026-015 (owner, 2026-09-25): Phase 5 closes on its roadmap gate plus Codex review,
  with activation gates carried to named later phases; never-submitted renewal uploads get
  the TRACE-090 rule; no promotions at beta; taxability confirmed before private beta.
- Two stacked branches await CI and review: `codex/phase5-renewal-orphan-uploads`
  (TRACE-091) and `codex/phase5-closure-readiness` (TRACE-092, on top of it). See
  [closure readiness](../../governance/PHASE-5-CLOSURE-READINESS.md) for gate evidence,
  open review questions and carried-forward gates.
- Phase 5 remains **IN PROGRESS** until the owner closes it after Codex review. Phase 4
  (merged as PR #5) is not owner-accepted; DEC-2026-016 puts it in the same Codex review
  (questions P4-1–P4-7) and the owner accepts both phases together.

## TRACE-092 — Phase 5 closure readiness — 2026-09-25 UTC

- Branch `codex/phase5-closure-readiness`, stacked on TRACE-091 (`c32e2e9`).
- Scope: DEC-2026-015 items 1, 3 and 4. Documentation plus suite 059; no product code.
- Evidence: suite 059 (10 assertions); 2934 assertions across 50 suites; lint.
- Open: Codex review of the Phase 4 (P4-1–P4-7) and Phase 5 question sets; one owner
  decision accepting Phase 4 and closing Phase 5 (DEC-2026-016).
- Next: open PRs for TRACE-091 and TRACE-092, then hand the closure readiness report to Codex.

## TRACE-091 — never-submitted renewal uploads — 2026-09-25 UTC

- Branch `codex/phase5-renewal-orphan-uploads` on `main` `cd0c041` (after PR #48, TRACE-090).
- Scope: DEC-2026-015 item 2. Renewal uploads no submission lists follow TRACE-090's 7-day
  clock and TRACE-074's quarantine, 14-day wait, deletion and provider holds, on a new
  path-keyed ledger; submissions are refused from 7 days so they never race a quarantine. See
  [the slice report](../../governance/PHASE-5-RENEWAL-UNATTACHED-UPLOADS.md).
- Evidence: suite 058 (62 assertions); 2924 assertions across 49 suites on a clean reset;
  concurrency script (added to CI); mutation check (7 of 7); retention browser specs (13 + 13);
  lint, typecheck, 204 unit tests, build.
- Open: code review (H1–H6); CI; hosted migration.
- Next: TRACE-092 (closure readiness), then Codex review.

## TRACE-090 — never-attached application uploads — 2026-09-25 UTC

- Branch `codex/phase5-orphan-uploads` on `main` `6d1a11a` (after PR #47, TRACE-089).
- Scope: DEC-2026-012 item 5. Uploads no application version or row lists are due 7 days
  after their 2-hour upload link (from the object's `created_at`), then follow TRACE-084's
  quarantine, 14-day wait and deletion with holds and the evidence exemption. See
  [the slice report](../../governance/PHASE-5-UNATTACHED-UPLOADS.md).
- Evidence: suite 057 (49 assertions); 2862 assertions across 48 suites on a clean reset
  after the rebase; Storage move probe; mutation check (6 of 6); retention browser specs;
  lint, typecheck, 202 unit tests, build.
- Open: code review (G1–G6); CI; hosted checks of the upload URL lifetime and move
  behavior; hosted migration.
- Merged as PR #48 at `cd0c041`; post-merge main CI run 36138739942 passed all three jobs.
  DEC-2026-012 is fully implemented.

## TRACE-089 — per-network intake limit — 2026-09-24 UTC

- PR #47, merged at `6d1a11a`; branch `codex/phase5-intake-ip-limit` from `main` `3e4236c`.
- Scope: DEC-2026-012 item 1's per-IP limit, settled by DEC-2026-014 (GoDaddy DNS points
  straight at Vercel; `x-real-ip` on Vercel only; IPv6 by /64). See
  [the slice report](../../governance/PHASE-5-INTAKE-IP-LIMIT.md).
- Evidence: suite 056 (30 assertions); 2813 assertions across 47 suites on a clean reset;
  concurrency network race; mutation check; round trip with `VERCEL=1`; lint, typecheck,
  202 unit tests, build.
- Open: code review (F1–F5); CI; hosted rollout per
  [HOSTED-MIGRATION-ROLLOUT.md](../../governance/HOSTED-MIGRATION-ROLLOUT.md) (proposed; 78
  migrations pending on the hosted project; the domain currently serves a separate static
  page, not this app).
- Next: DEC-2026-012 item 5 (never-submitted uploads).

## TRACE-088 — intake abuse protection — 2026-09-24 UTC

- Branch `codex/phase5-intake-abuse` on `main` `0d47134`.
- Scope: DEC-2026-012 item 1 as settled by DEC-2026-013 (no Turnstile, per-IP limit
  deferred). Both public routes refuse a filled honeypot, a fill time under 3 seconds,
  and a fourth accepted submission per email per form per day with the same 429. See
  [the slice report](../../governance/PHASE-5-INTAKE-ABUSE.md).
- Evidence: suite 055 (37 assertions); 2783 assertions across 46 suites on a clean
  reset; concurrency script; mutation check; round trip through a production build and
  a browser; lint, typecheck, 192 unit tests, build; `/request` browser suite.
- Open: code review (E1–E6); CI; the per-IP limit; hosted migration (migration before
  the route, the reverse of TRACE-087).
- Next: DEC-2026-012 item 5 (never-submitted uploads).

## TRACE-087 — route-only contact submissions — 2026-09-24 UTC

- Branch `codex/phase5-contact-insert`, stacked on `codex/phase5-trace086-status`
  (PR #44, DEC-2026-012) on `main` `1d8a27e`.
- Scope: DEC-2026-012 items 2 and 4. The contact route inserts with the service key;
  the anonymous `contact_submissions` insert policy and `anon`/`authenticated` `INSERT`
  are removed; the duplicate `vendor-documents` read policy is dropped. See
  [the slice report](../../governance/PHASE-5-CONTACT-INSERT.md).
- Evidence: suite 054 (22 assertions, 12 of 12 mutants killed); 2746 assertions
  across 45 suites on a clean reset; round trip through a production build; lint,
  typecheck, unit, build.
- Open: code review (D1–D4); CI; deploy the route before the hosted migration.
- PR #44's lifecycle job failed twice with a 401 from the local worker gateway; the
  same step passes locally. Under investigation before PR #44 merges.
- Next: DEC-2026-012 item 1 (abuse protection), then item 5 (never-submitted uploads).

## TRACE-086 — direct applicant insert path — 2026-09-24 UTC

- Branch `codex/phase5-application-insert` on `main` `da64e4d` (PR #42 merged).
- Merged as PR #43 at `1d8a27e` on 2026-09-24 13:23 UTC. Final-head CI (including
  the concurrency scripts) and post-merge main run 36005291080 passed all three jobs.
- Scope: owner decision 2026-09-24 (option A) to drop the applicant `INSERT` policy on
  `vendor_applications` and revoke `INSERT` from `anon` and `authenticated`; the
  service-key application route is the only writer. See
  [the slice report](../../governance/PHASE-5-APPLICATION-INSERT.md).
- Evidence: suite 053 (22 assertions, 11 of 11 mutants killed); 2724 assertions
  across 44 suites on a clean reset; local REST round trip. Ran on this checkout's
  default local stack (Studio excluded: host port 55423 unavailable).
- Open: code review (B1–B4); route abuse protection and `contact_submissions`
  decisions; application-row deletion; hosted migration.
- Next: implement DEC-2026-012 (owner decisions 2026-09-24 on these open items).

## TRACE-085 — admin write paths to applications and documents — 2026-09-24 UTC

- Branch `codex/phase5-application-privileges` on `main` `7cc7203` (PR #41 merged).
- Scope: owner decision 2026-09-23 to revoke the legacy admin `UPDATE`/`DELETE`
  policies and grants on `vendor_applications` and the admin `UPDATE`/`DELETE`
  policies on `vendor-documents`; Document Retention totals include application
  documents. See [the slice report](../../governance/PHASE-5-APPLICATION-ADMIN-WRITES.md).
- Open: Codex review (A1–A5); application-row deletion needs a decision (the
  applicant insert policy is resolved by TRACE-086); hosted migration.
- Merged as PR #42 (`da64e4d`); final-head and post-merge CI passed.

## Historical repository checkpoint — 2026-09-10

- GitHub checked on 2026-09-10: latest merged PR is [#15, provider compliance operations](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/15), merged 2026-09-08.
- Synced base: `d815e900b158a5a4283c0aa073f872cc57e1eeb9` (`origin/main`).
- Working branch: `codex/vscode-system-setup`, rebased 2026-09-15 onto main `0d761f3`
  (PR #27 merged) and committed for its own PR.
- Local `main` was fast-forwarded from `94d608a` to the merged base.
- Recheck `git status --short --branch` and remote state before assuming this snapshot is current.

## Preserved older work

The pre-sync vendor edits, lockfile edits and untracked vendor components/temporary
compile route are saved in the Git stash named
`pre-vscode-sync-2026-09-10 vendor WIP at 94d608a`.
It was `stash@{0}` when created; use `git stash list` to locate it by name later.
It has not been reapplied over the newer implementation. Inspect/reconcile it in
an isolated recovery branch based on `94d608a` if those changes are needed.
Do not drop the stash until its contents have been reviewed. Existing ignored
local environment files were preserved and have not been validated for runtime use.

## Historical product checkpoint — 2026-09-10

PR #15 implements TRACE-062: admin compliance operations, version-bound private
document review/binding, evidence reuse, and protected provider decisions.
[The slice report](../../governance/PHASE-5-COMPLIANCE-OPERATIONS.md) defines its
limits. [Phase 5 handoff](../../governance/PHASE-5-HANDOFF.md) and
[validation](../../governance/PHASE-5-VALIDATION.md) remain the detailed evidence.

Phase 5 is open. Invitation/Auth provisioning, delivery/acceptance receipts,
renewal/retention operations, tax/promotions, recurring automation, finance
operations and authorized integration/manual acceptance remain follow-ups.
Phase 6 has not started according to the combined roadmap. Merged code is not
production activation or blanket phase acceptance.

## This slice

Bring the merged system into this local folder and provide a portable VS Code
workspace, tasks, concise system map and agent entry points. No product rules,
application code, database migrations or provider configuration are changed by
the editor setup additions.

Next: choose one remaining Phase 5 item from the governing handoff and inspect
its existing contracts before implementation. Do not treat historical checklists
as current branch/merge status; reconcile them with the latest slice evidence.

## Local verification

- Workspace/extension/task JSON parses; every task maps to an existing npm script.
- Relative links in the agent guide/handoff resolve; `git diff --check` passes.
- `npm ci --cache /tmp/mercurius-npm-cache --no-audit --no-fund` passed.
- `npm run scan:secrets`, `npm run lint`, and the current-source `npm run typecheck` passed.
- `npm run test:unit` passed: 7 test files, 84 tests.
- Initial TypeScript check found stale `.next/dev/types` referencing the stashed
  temporary route. Generated type directories were archived under
  `/tmp/mercurius-pre-sync-next-ibnyrxp_`; the original build cache remains.
  A partial full-cache copy also remains in that temporary directory.
- No dev server, browser verification, database tests, production build or external
  integration acceptance was performed for this documentation/editor slice.

## Current slice — TRACE-064 (2026-09-10, awaiting Codex review)

- Branch `codex/phase5-dependency-security` at `ce5527b`, base `d815e90`, worktree
  `../mercurius-dependency-security`. PR #17 open; final-head CI passed all three jobs.
- The fix was merged into PR #16's branch (`23f1150`, owner request 2026-09-11);
  append-only governance conflicts kept both TRACE-063 and TRACE-064. PR #16
  final-head CI (run 34561827113) passed all three jobs.
- 2026-09-11 16:29 UTC: owner merged PR #16 (main `5a3bffe`, tree identical to
  `23f1150`); PR #17 closed as merged because its commit was already included.
  Governance text written before the merge still says "draft PR #16" / "must
  incorporate"; refresh it in the next slice.
- TRACE-065 (start onboarding review) has since been implemented; see its own
  section below.
- Why: post-merge advisories (critical Next.js) fail the unchanged `audit:prod`
  CI gate on main and on draft PR #16 (TRACE-063 invitations, head `65198f1`).
- Change: next/eslint-config-next 16.3.0 → 16.3.4; lockfile-only sharp 0.35.4,
  js-yaml 4.3.2, hono 4.13.7. No app, schema, Edge or configuration change.
- Evidence: `governance/PHASE-5-DEPENDENCY-SECURITY.md` and the TRACE-064 section of
  `governance/PHASE-5-VALIDATION.md`.
- Open: post-merge Codex review of TRACE-063/064; shadcn dependency-classification
  decision. Merging is not phase acceptance or production activation.
- Next: see the TRACE-065 section below.

## Current slice — TRACE-065 (2026-09-12, awaiting Codex code review)

- Branch `codex/phase5-onboarding-intake` at `b2dadf2`, base main `5a3bffe`, worktree
  `../mercurius-onboarding-intake`. PR #18 converted from the design proposal to the
  implementation PR and marked ready for review.
- Owner authorized implementation without waiting for a separate Codex design
  confirmation; both 2026-09-11 Codex design corrections are implemented as written,
  so Codex review of this slice is a code review.
- Change: migration `20260911001000` adds the private, immutable
  `vendor_onboarding_review_starts` request table and the creation-only
  `vendor_start_onboarding_review`, plus operator-only
  `vendor_onboarding_intake_status` readback. The Applications queue replaces the
  disabled legacy approve action with a reason-required ConfirmAction gated on server
  readback. No Auth user, role, email, invitation, evidence, activation or public
  listing results from the command.
- Evidence: `governance/PHASE-5-ONBOARDING-INTAKE.md` and the TRACE-065 section of
  `governance/PHASE-5-VALIDATION.md`. Locally: 582 SQL assertions across 23 suites
  (64 new), new different-key/same-key start concurrency script wired into CI, clean
  reset and replay, 84 unit tests, 58-page build, 79 browser cases (5 new).
- Final-head CI on `b2dadf2` (run 34693678032) passed all three jobs, including the
  new onboarding concurrency step. The earlier red checks on PR #18 are the
  push-triggered run cancelled by the workflow's concurrency group.
- Open: Codex code review of PR #18; decision on applications with
  no intake version (fail closed today, no backfill invented); pre-existing
  dark-theme contrast defect in the Applications table; default contractor columns at
  activation. Merging is not phase acceptance or production activation.
- Next: invitation operator UI (operator-entered expiry, no default), then
  existing-account linking.

## Current slice — TRACE-066 (2026-09-12, awaiting Codex code review)

- Branch `codex/phase5-invitation-operations` at `2540744`, base main `f47ac84`,
  worktree `../mercurius-invitation-operations`. **Merged as PR #19 on 2026-09-12
  (main `717877d`).** The "not pushed" and "awaiting review" wording below predates
  that merge.
- PR #18 merged on 2026-09-12 (main `f47ac84`), so TRACE-065 is in and this slice
  builds on it rather than on `b2dadf2`.
- Change: migration `20260912001000` adds the read-only, operator-only
  `vendor_invitation_overview` readback. The Applications dialog gains a Provider
  invitation panel wiring the existing `vendor-invite` prepare/send/reconcile/close
  commands, each behind ConfirmAction and each confirmed by re-reading the server.
  Invitation expiry is operator-entered with no default, and the preparation key is
  derived from it so a retry replays. The blocked legacy resend/sync controls are
  removed; the recovered invite columns stay as labelled history. No transport,
  Edge, environment or delivery-mode change; dispatch stays disabled by default.
- Evidence: `governance/PHASE-5-INVITATION-OPERATIONS.md` and the TRACE-066 section
  of `governance/PHASE-5-VALIDATION.md`. Locally: 626 SQL assertions across 24
  suites (44 new), all four concurrency scripts unchanged and passing, clean reset
  and replay, 84 unit tests, 58-page build, 90 browser cases (11 new), zero audit
  findings.
- Second commit `2540744` fixes a 320px reflow defect this slice surfaced and
  corrects an earlier misdiagnosis of it. `DialogContent`'s single grid track was
  `auto`, so the `datetime-local` control's 271px intrinsic minimum widened the
  whole dialog; the track is now `minmax(0,1fr)`. It is not the `DialogFooter`
  bleed first blamed — `offsetWidth` equals `clientWidth`, so no scrollbar is
  involved. Shared primitive, so every dialog is affected; all 90 browser cases
  pass. Edge gates now run locally on pinned Deno 2.9.6 (installed at
  `~/.deno/bin`): 11 functions type-check clean, 44 handler tests pass.
- Pushed as PR #19. Final-head CI on `2540744` (run 34699048634) passed all three
  jobs; the red checks on the PR are the push-triggered run cancelled by the
  workflow's concurrency group. CodeRabbit produced only a free-plan summary, not a
  line-by-line review, so it is not review evidence.
- Open: Codex code review. The TRACE-065 dark-theme contrast defect in
  the queue table is unchanged. The `@visual` suite has no Linux baselines (only
  `-win32` is tracked), so it cannot compare here; adopting baselines is a separate
  decision. Merging is not phase acceptance or production activation.
- Next: TRACE-067, implemented below.

## Current slice — TRACE-067 (2026-09-12, implemented, unpushed)

- Branch `codex/phase5-account-linking` at `105a64e`, base main `717877d`, worktree
  `../mercurius-account-linking`. **Merged as PR #20 on 2026-09-12 (main `8f4ca0d`).**
- Owner instruction 2026-09-12: implement the next Phase 5 slice; Codex reviews after
  the phase or on request rather than gating the design. The four design decisions are
  recorded in the slice report for review, not presented as pre-approved.
- Change: migration `20260912002000` adds the immutable `vendor_account_link_decisions`
  log, the reviewed `vendor_link_existing_account` and `vendor_release_linked_account`
  commands, the operator-only `vendor_account_link_overview` readback, and a partial
  unique index on `contractors(user_id)`. The identity is verified by ID against the
  recipient in the bound application snapshot; no email directory is searched anywhere
  in the slice. The legacy `admin_link_contractor_to_user` / `admin_unlink_contractor`
  lose their `authenticated` grant and fail closed, and the ungated vendor-detail card
  is replaced by the reviewed panel, mounted there and in the Applications dialog.
- Linking grants no role, accepts no evidence, activates no provider and lists nothing.
- Evidence: `governance/PHASE-5-ACCOUNT-LINKING.md` and the TRACE-067 section of
  `governance/PHASE-5-VALIDATION.md`. Locally: 704 SQL assertions across 25 suites
  (78 new), a new three-race concurrency script wired into CI, clean reset and replay,
  84 unit tests, 58-page build, 103 browser cases (13 new), 0 audit findings, Edge
  gates unchanged.
- Open: **activation grants no vendor role** — `vendor_decide_onboarding('activate')`
  never inserted one, and removing the legacy grant makes that the only path, so a
  linked and activated provider still has no vendor access. It needs its own slice and
  is the next blocking question for provider access. The TRACE-065 dark-theme contrast
  defect is unchanged. Codex code review is open.
- Next: the vendor role grant at activation.

## Current slice — TRACE-068 (2026-09-12, PR #21 open)

- Branch `codex/phase5-activation-role` at `51a9fcc`, base main `8f4ca0d`, worktree
  `../mercurius-activation-role`. PR #21 open; pull-request CI run 34718397577 passed
  all three jobs (the red push run 34718383193 was cancelled by the concurrency group).
- Owner relayed Codex's go-ahead. Owner answered two semantics questions: a provider
  with no reviewed account activates without a grant; suspension keeps the role.
- Change: migration `20260912003000` makes `vendor_decide_onboarding('activate')` grant
  `vendor` to the live reviewed link after re-proving it (refuses a changed/unconfirmed
  binding), records every outcome in immutable `vendor_role_decisions`, and makes
  `vendor_release_linked_account` withdraw only an activation-owned grant. Account panel
  reports the role state. Forward-fixes TRACE-067 live-link ordering (identity column).
- Evidence: `governance/PHASE-5-ACTIVATION-ROLE.md` and the TRACE-068 section of
  `governance/PHASE-5-VALIDATION.md`. Locally: 753 SQL assertions across 26 suites (49
  new), new concurrency script wired into CI, clean reset and replay, 84 unit tests,
  58-page build, 107 browser cases (4 new), 0 audit findings, Edge gates unchanged.
- Open: Codex code review; rejection-after-activation keeps the role (owner decision);
  invitation-path providers get no portal access until accepted invitations are bound;
  account deletion vs. role audit rows; final-head CI.
- Next: see TRACE-069 below.

## Current slice — TRACE-069 (2026-09-12, draft PR #22, stacked on #21)

- Branch `codex/phase5-onboarding-decisions` at `20f0a4c`, based on TRACE-068 `51a9fcc`,
  worktree `../mercurius-onboarding-decisions`. Draft PR #22 targets
  `codex/phase5-activation-role`; retarget to `main` after #21 merges.
- Owner decision 2026-09-12: license/insurance are recorded against a reviewed
  application document with an operator-entered expiry (the workbench's scoped binding
  needs packages, which exist only after activation).
- Change: migration `20260912004000` adds read-only `vendor_onboarding_checklist`,
  idempotent `vendor_record_checklist_evidence` with an immutable request log, and
  revokes client execute on the raw `vendor_record_evidence`. New "Activation checklist"
  panel (Applications dialog and vendor detail) records evidence and runs
  activate/suspend/renew/reject behind readback-gated ConfirmAction.
- Evidence: `governance/PHASE-5-ONBOARDING-CHECKLIST.md` and the TRACE-069 section of
  `PHASE-5-VALIDATION.md`. Locally: 811 SQL assertions across 27 suites (58 new), new
  concurrency script in CI, clean reset and replay, 84 unit tests, 58-page build, 121
  browser cases (14 new), 0 audit findings.
- Open: Codex review of #21 and #22; CI on #22; document sufficiency; structured
  evidence references (owner decision); rejection-after-activation role policy.
- Next: bind accepted invitations to the provider under review, so invited providers
  receive the vendor role at activation.

## Current slice — TRACE-070 (2026-09-12, PR #24 open)

- Branch `codex/phase5-invitation-binding` at `126fec1`, based on `20f0a4c` (TRACE-069),
  worktree `../mercurius-invitation-binding`. PR #24 targets `main`.
- **TRACE-069 landed:** PR #23 (only `20f0a4c`, CI run 34725307231 green) merged to
  `main` as `14f82fe` on 2026-09-12. PR #24 now differs from `main` only by `126fec1`;
  its pull-request CI run 34726679013 passed all three jobs (red run 34726598257 is the
  cancelled push run). **Merging #24 was refused by the agent permission classifier
  (merge without review) and awaits the owner or Codex review.**
- GitHub cleanup 2026-09-12: 21 remote `codex/*` branches fully contained in `main` were
  deleted, including the stale `codex/phase5-activation-role` (content identical to
  `main`). Kept: `codex/phase5-invitation-binding` (PR #24) and the non-codex
  `v0/*` and `coderabbit/*` branches, which are merged but were created by other tools.
  Local worktrees and their local branches are untouched.
- Change: `vendor_bind_invited_account` binds the account named by the acceptance receipt
  as a reviewed link, so activation grants invited providers `vendor` unchanged.
  Recovery fix (owner direction): re-inviting a recipient who already accepted would
  wedge an unreconcilable, unclosable `unknown` attempt; prepare and claim now refuse it
  and the panels direct the operator to link by account ID.
- Evidence: `governance/PHASE-5-INVITATION-BINDING.md` and the TRACE-070 section of
  `PHASE-5-VALIDATION.md`. Locally: 883 SQL assertions across 28 suites (72 new), all
  eight concurrency scripts in CI order, clean reset and replay, 84 unit tests, 58-page
  build, 134 browser cases (13 new), 0 audit findings.
- Open: merge #24 after review; general Auth-refusal `unknown` wedge (TRACE-063)
  for addresses with an account outside this provider's receipts; rejection-after-
  activation role policy; account deletion vs role/link audit rows.
- Next: fix the TRACE-063 Auth-refusal wedge (definitive refusals recordable as failed
  and closable). Done on `codex/phase5-auth-refusal`; see below.

## Current slice — TRACE-063 forward fix (2026-09-12, awaiting review)

- Branch `codex/phase5-auth-refusal`, base `main` `26900eb` (PR #24 merged), worktree
  `../mercurius-auth-refusal`. Commit `97a423e`; PR #25 open; pull-request CI run 34731584926 passed all three jobs (red run 34731571398 is the cancelled push run).
- Change: migration `20260912006000` records Auth's definite `422 email_exists` refusal as a
  terminal `failed` attempt through service-only `vendor_refuse_invitation` (handler report
  on a started reservation, or an account read back by ID that held the address, confirmed,
  before dispatch). Edge `send` refusal branch and `refuse` action; panel explains refusals
  and offers "Record Auth refusal" for unknown attempts. Recovery is linking the existing
  account by ID.
- Evidence: `governance/PHASE-5-INVITATION-REFUSAL.md` and the forward-fix section of
  `PHASE-5-VALIDATION.md`. Locally: 936 SQL assertions across 29 suites (53 new), new
  concurrency script in CI, all nine scripts in CI order, clean reset and replay, 13
  `vendor-invite` Edge cases (4 new), real handler round-trip against local Auth, 84 unit
  tests, 58-page build, 139 browser cases (5 new), 0 audit findings.
- **Merged as PR #25** (main `6bdcff3`); see TRACE-071 below.
- Open: commit/PR and CI; Codex review; hosted refusal contract; owner question on
  re-inviting unconfirmed existing accounts; rejection-after-activation role policy;
  account deletion vs audit rows.

## Current slice — TRACE-071 hosted invitation delivery (2026-09-12, revised 2026-09-13, uncommitted)

- Branch `codex/phase5-hosted-invitation-delivery`, base main `6bdcff3`, worktree
  `../mercurius-hosted-invitation-delivery`. Not committed or pushed.
- Change: `vendor-invite` gains a `hosted` delivery mode (`delivery.ts`) that dispatches
  only when `MERCURIUS_INVITATION_PROJECT_REF` and `MERCURIUS_INVITATION_SITE_ORIGIN`
  match `SUPABASE_URL` and `SITE_URL`; anything else stays `INVITATION_DELIVERY_DISABLED`.
  Tracked invite template `supabase/templates/provider-invitation.html`; local
  `config.toml` mirrors the subject/template/expiry/allowlist; hosted arming runbook. No
  migration, app, product-rule, hosted secret, Auth setting or deployment change.
- Owner decisions 2026-09-13, implemented: Auth email-link lifetime 3 hours
  (`otp_expiry = 10800`); the recipient link is the site's own `/set-password` with
  `token_hash` and the attempt passed as invite metadata, which `/set-password` verifies
  by POST so a mail scanner's GET cannot burn it; MTS §9 lists the three invitation
  variables. Hosted Resend/SMTP setup is owner work, deliberately not attempted.
- Findings: earlier local round-trips never had the invitation redirect on the allowlist
  (Auth falls back to the Site URL root and drops the attempt ID); and appending to
  `{{ .RedirectTo }}` renders a malformed link on that fallback, which is why the link is
  built from `{{ .SiteURL }}` plus invite metadata.
- Evidence: `governance/PHASE-5-HOSTED-INVITATION-DELIVERY.md`, TRACE-071 section of
  `PHASE-5-VALIDATION.md`. 15 `vendor-invite` Edge cases (20-config disabled table, hosted
  dispatch with invite metadata, hosted refusal/unknown), all 12 guard mutants killed,
  three local Auth/mail-sink round-trips (including the scanner GET that consumes no
  token and a refused reuse), lint/types/secrets/audit and 84 unit tests. SQL, build and
  browser suites not re-run (no code in their scope changed).
- Open: owner-authorized hosted arming and acceptance (Resend SMTP, Auth URLs/template/
  expiry, secrets, deploy, one invitation to an owner mailbox), tracked as owner work;
  whether operators need a reviewed reissue command when a link outlives its 3 hours;
  Codex review; commit/PR/CI. Owner asked to hold the commit until these updates landed.
- **Merged as PR #26** (main `d307ba0`); the "not committed" wording above predates that.

## Current slice — TRACE-072 compliance expiry (2026-09-13, merged as PR #27)

- Branch `codex/phase5-evidence-renewal`, base main `d307ba0`, worktree
  `../mercurius-evidence-renewal`. PR #27 at `f57d46d` (`b5355f5` slice, `f57d46d`
  payout forward fix). **Merged 2026-09-14 (main `0d761f3`).**
- Owner decisions 2026-09-13: 30-day notice; a lapse flags only (no status change);
  lapsed qualifications remove matching but do not hold payouts (lapsed payout onboarding
  and suspension still hold; migration `20260913002000`, `private.vendor_payout_eligible`);
  renewed-document upload outside the application is the next slice.
- Change: migration `20260913001000` adds read-only `vendor_evidence_renewal_queue`
  (operator), `vendor_own_evidence_renewal` (vendor; item/expiry/state only) and checklist
  `renewal_due`. New `/admin/compliance/renewals` queue, "Renewal due" checklist badge,
  vendor-portal notice. No write command, table or scheduler.
- Evidence: `governance/PHASE-5-EVIDENCE-RENEWAL.md` and the TRACE-072 section of
  `PHASE-5-VALIDATION.md`. 987 SQL assertions across 30 suites (51 new; window mutant
  killed; payout cases fail without the fix), clean reset/replay, all nine concurrency
  scripts, 95 unit tests (11 new), 59-page build, 152 browser cases (one unrelated
  `mds.spec.ts` Escape/focus flake, passed 3/3 on rerun), lint/types/secrets, 0 audit.
- Open: Codex review.
- Next: private renewal-document upload bound to the provider.

## Current slice — TRACE-074 renewal document retention (2026-09-16, PR open)

- TRACE-073 renewal-document upload merged as PR #29 (main `bbb0482`).
- Branch `codex/phase5-renewal-retention`, base main `bbb0482`, worktree
  `../mercurius-renewal-retention`.
- Owner decisions 2026-09-15: CFG-011 applies to declined renewal documents only, 90 days
  from the decline; operator-run queue, no scheduler; provider-level retention hold; quarantine,
  then permanent deletion after 14 days (value to confirm at review).
- Change: migration `20260915002000` (private quarantine bucket, immutable hold events and
  retention actions, prepare/record commands that record only what `storage.objects` shows,
  hold commands, retention queue). Route `/api/renewal-documents/retention`; new
  `/admin/compliance/retention`; checklist hold control and retention badges.
- Evidence: `governance/PHASE-5-RENEWAL-RETENTION.md` and the TRACE-074 section of
  `PHASE-5-VALIDATION.md`. 1182 SQL assertions (111 new, eight guard mutants killed), all
  eleven concurrency scripts, clean reset/replay, 32-check local route/Storage round trip,
  108 unit tests, build, 175/182 browser cases (six `@visual` without Linux baselines, one
  teardown flake passed 3/3 on rerun), lint/types/secrets, 0 audit.
- Open: Codex review; CI; 14-day confirmation; never-submitted uploads and application
  documents outside retention; operator `DELETE` policy on `vendor-documents`.
- Next: choose between retention for never-submitted uploads/application documents (needs a
  clock decision) and another Phase 5 gate (tax/promotions, recurring automation, finance).

## Current slice — TRACE-075 finance reconciliation (2026-09-16, PR open)

- TRACE-074 merged as PR #30 (main `d422816`).
- Branch `codex/phase5-finance-reconciliation`, base main `d422816`, worktree
  `../mercurius-finance-reconciliation`. Committed and pushed; PR open against `main`.
- Owner direction 2026-09-16: finance operations (charges, refunds, earnings, payouts). Scope
  and decisions D1–D5 are implementer choices recorded for review.
- Change: migration `20260916001000` adds read-only `money_finance_reconciliation` (finance
  authority) with 13 per-invoice ledger checks, funds state mirroring `money_payable`, Stripe
  readback state, account totals and exceptions. New `/admin/finance` page and nav entry.
- Evidence: `governance/PHASE-5-FINANCE-RECONCILIATION.md` and the TRACE-075 section of
  `PHASE-5-VALIDATION.md`. 1295 SQL assertions (113 new, 12 guard mutants killed), clean
  reset, 115 unit tests, build, 184/190 browser cases (6 `@visual` without Linux baselines),
  lint/types/secrets, 0 audit.
- Open: Codex review; CI; owner question on the global unsupported-event payout hold.
- Next: finance operator command gateway (authenticated actor, second-person approval,
  ConfirmAction) for refunds, holds, readbacks and ACH outcomes.

## Current slice — TRACE-076 finance operator commands, part 1 (2026-09-17, merged as PR #32)

- **Merged 2026-09-17 14:44 UTC as PR #32 (main `f945910`)** on owner instruction, after both
  final-head CI runs passed (the push run's one unrelated `invitation-binding` browser failure,
  "Response has been disposed", passed on rerun). "PR open" wording below predates the merge.

- TRACE-075 merged as PR #31 (main `3f98939`).
- Branch `codex/phase5-finance-commands`, base main `3f98939`, worktree
  `../mercurius-finance-commands`. Committed and pushed; PR open.
- Owner direction 2026-09-16: part 1 of the finance operator command gateway (refund send and
  readback, payout holds, Stripe readback record/resolve, event replay/exclusion) with
  ConfirmAction; propose the actor and approval design for Codex review. Owner decision: keep
  the global unsupported-event payout hold.
- Change: migration `20260916002000` adds `authenticated` gateway commands whose actor is always
  `auth.uid()`, an immutable request → different-operator approval → requester execution flow
  bound to the exact command, readback and refund-readback attribution, and
  `money_finance_operations`. `refund-invoice` gains a Stripe readback action. The
  `/admin/finance` page gains the FinanceCommands panel. Kernels are unchanged.
- Evidence: `governance/PHASE-5-FINANCE-COMMANDS.md` (design G1–G9) and the TRACE-076 section of
  `PHASE-5-VALIDATION.md`. SQL 043 has 132 assertions (14 guard mutants killed); the full
  regression passes; a new concurrency script is in CI with all twelve passing in order;
  57 Edge cases (7 new); 125 unit tests; build; 191/198 browser cases (6 `@visual` without Linux baselines, one unrelated fixture flake passing 3/3 on rerun), finance specs 16/16; 0 audit findings.
- Open: Codex design and code review (G3 two-person hold release, G9 request expiry or
  withdrawal); CI; `paymentFunctionError` loses Edge error codes (shared helper, own fix);
  a stuck `reconcile` refund cannot be re-sent; part 2 (refund authorization, chargeback
  allocation, ACH preparation, bank outcomes, retry).
- Next: CI and Codex review of the PR; then part 2.

## Current slice — TRACE-077 finance commands, part 2A (2026-09-21, PR open)

- Branch `codex/phase5-finance-refunds`, base main `f945910`, worktree `../mercurius-finance-refunds`.
- Owner direction 2026-09-17: merge PR #32 after final CI (done), then start part 2A. Answers:
  G3 hold release needs one operator; G9 requests and approvals expire after 24 hours; refund
  authorization keeps its existing dual review.
- Change: migration `20260917001000`: one-operator hold release; 24-hour request window with
  approvals bound to their request; reviewed refund, cancellation refund and chargeback requests
  through unchanged kernels; reissue of a `reconcile` refund after a not-found Stripe readback
  taken 24 hours after preparation (only kernel change: `money_prepare_refund` window). Panel
  gains release, refund form, cancellation list, chargeback form, expiry and reissue.
- Evidence: `governance/PHASE-5-FINANCE-REFUNDS.md` (R1–R6) and the TRACE-077 section of
  `PHASE-5-VALIDATION.md`. 1534 SQL assertions across 35 suites (044 new, 126), 17/18 mutants
  killed (1 equivalent), 13 concurrency scripts in CI order, 129 unit tests, build, 198/198
  non-visual browser cases, 0 audit findings.
- Open: Codex review (R1 authority note on MPS high-risk, R5 single-operator reissue); CI;
  failed-refund recovery; `paymentFunctionError`; part 2B (ACH preparation, bank outcomes, retry).
- Next: part 2B after review.

## Current slice — TRACE-078 finance commands, part 2B (2026-09-21, PR open)

- PR #33 (TRACE-077) merged 2026-09-21 (main `da94fd8`); the "PR open" wording above predates it.
- Branch `codex/phase5-finance-ach`, base main `da94fd8`, worktree `../mercurius-finance-ach`.
- Owner direction 2026-09-21: part 2B (ACH preparation, bank outcomes, retry) after #33 merged.
- Change: migration `20260921001000`: a reviewed weekly batch request bound to each payout's
  amount, payee and bank authorization; one-operator bank outcomes where submission re-proves
  eligibility before sending; a reviewed retry bound to the failed attempt; an `ach` readback
  with reference hints only. Kernels unchanged. New FinanceAchCommands section.
- Evidence: `governance/PHASE-5-FINANCE-ACH.md` (B1–B8) and the TRACE-078 section of
  `PHASE-5-VALIDATION.md`. 1708 SQL assertions across 36 suites (045 new, 174), 30/30 mutants
  killed, 14 concurrency scripts in CI order, 135 unit tests, build, 202/202 non-visual browser
  cases, 0 audit findings.
- Open: Codex review (one-operator settlement, reference before sending, G5 holds on statement
  payouts); CI; replacement statements and prepared-attempt withdrawal; already-paid recovery.
- Next: CI and Codex review of the PR.

## Current slice — TRACE-079 ACH withdrawal and replacement statements (2026-09-21, PR open)

- PR #34 (TRACE-078) merged 2026-09-21 (main `7f696e1`); the "PR open" wording above predates it.
- Branch `codex/phase5-replacement-statements`, base main `7f696e1`, worktree
  `../mercurius-replacement-statements`. Committed and pushed; PR open against `main`.
- Owner decisions 2026-09-21: a withdrawal needs two finance operators; prepared, failed and
  returned transfers can be withdrawn (never submitted, unknown or settled).
- Change: migration `20260921002000`:
  - a reviewed `money_operator_request_ach_withdrawal`, bound to the transfer and its status;
  - the service kernel `money_withdraw_ach`, which records an immutable withdrawal and a
    `withdrawn` event and posts no journal;
  - a `replaces_item_id` chain trigger, so a payout has at most one live statement and its
    replacement goes on a later weekly batch through the unchanged kernel;
  - refund, chargeback, hold and batch guards now test a live statement. Payee reassignment stays
    closed.
  - The finance page gains a withdrawal form and shows withdrawn and replacement statements.
- Evidence: `governance/PHASE-5-ACH-REPLACEMENT.md` (W1–W7) and the TRACE-079 section of
  `PHASE-5-VALIDATION.md`:
  - 1856 SQL assertions across 37 suites (046 new, 148); 25 of 26 mutants killed (1 equivalent);
  - 15 concurrency scripts in CI order;
  - 138 unit tests; build; 204/204 non-visual browser cases; 0 audit findings.
- Open: CI; Codex review (W4 closed reassignment, W5 late outcome on a withdrawn
  transfer); already-paid recovery; bank statement reconciliation; failed-refund recovery;
  `paymentFunctionError`.
- Next: CI and Codex review of the PR, then already-paid recovery.

## Current slice — TRACE-080 already-paid payout recovery (2026-09-21, PR open)

- PR #35 (TRACE-079) merged 2026-09-21 (main `68f0da3`); the "PR open" wording above predates it.
- Branch `codex/phase5-already-paid-recovery`, base main `68f0da3`, worktree
  `../mercurius-already-paid-recovery`.
- Owner decisions 2026-09-21: cover a refund and a lost chargeback after a settled payout and a
  late bank payment of a withdrawn transfer; the late payment is a separate reviewed event; an
  amount owed closes only by a reviewed repayment or write-off (two operators, part amounts); no
  hold on the provider's other payouts.
- Change: migration `20260921003000`:
  - refunds and chargeback allocation now post on a settled payout; the provider's share becomes
    the debit balance of that payout's provider payable (the amount owed);
  - a reviewed `money_operator_request_ach_late_settlement` and kernel record a withdrawn
    transfer the bank paid, without changing the attempt;
  - a proceeds guard on every statement, attempt and submission writer refuses any transfer that
    would pay more than the payout's proceeds (`already_paid`);
  - a reviewed `money_operator_request_payout_recovery` and kernel record a repayment or a
    write-off to the new `provider_recovery_loss` account, bound to the amount owed and a key;
  - reconciliation counts late payments and recoveries, and lists a `provider_owes` exception;
    the finance page gains "Amounts providers owe".
- Evidence: `governance/PHASE-5-PAYOUT-RECOVERY.md` (R1–R8) and the TRACE-080 section of
  `PHASE-5-VALIDATION.md`.
- Open: CI; Codex review (R3 late payment of a returned transfer, R4 guard, R8 `reversed`); a
  return recorded after a repayment; bank statement reconciliation; provider-facing wording;
  failed-refund recovery; `paymentFunctionError`.
- Next: CI and Codex review of the PR, then bank statement reconciliation or failed-refund
  recovery.

## Current slice — TRACE-081 bank statement reconciliation (2026-09-22, PR #37 open)

- PR #36 (TRACE-080) merged 2026-09-21 (main `5e29da3`).
- Branch `codex/phase5-bank-statements`, base main `5e29da3`, worktree `../mercurius-bank-statements`.
- Owner decisions 2026-09-22 (asked before implementation, all four as recommended): the bank's CSV
  is parsed in the browser and never uploaded; only payout-related lines are imported; a line is
  evidence only; a period is closed by a two-operator review, refused while any exception is open.
- Change: migration `20260922001000`:
  - immutable statement periods, imports, lines (posting date, debit or credit, amount, bank
    reference only), matches, dismissals and closes; periods cannot overlap;
  - a line pairs with a recorded settlement, return, late payment (TRACE-080) or repayment of the
    same direction and reference, in date order; a differing amount is an exception, not a match;
  - `money_operator_resolve_bank_line` runs the existing bank outcome and late payment commands
    with the line as their evidence; manual matches and dismissals are one operator with a reason,
    and a line naming a transfer can never be dismissed;
  - the reviewed `bank_statement_close` binds the lines and totals, is refused while the period is
    open or anything is unresolved, and stores the statement's pairings;
  - readbacks: `statements` in `money_finance_operations`; `bank_line` and `bank_unevidenced`
    exceptions in `money_finance_reconciliation`.
  - `/admin/finance` gains a Bank statements section; `src/lib/bankStatementCsv.ts` reads the file.
- Evidence: `governance/PHASE-5-BANK-STATEMENTS.md` (S1–S8) and the TRACE-081 section of
  `governance/PHASE-5-VALIDATION.md`:
  - 2212 SQL assertions across 39 suites (048 new, 206); 33 of 33 mutants killed (five survivors on
    the first run each gained a case);
  - 17 concurrency scripts in CI order, clean reset and replay;
  - 159 unit tests (17 new), build, 216/216 non-visual browser cases (8 new; the `mds.spec.ts`
    Escape/focus flake passed 3/3 on rerun), 0 audit findings.
- CI run 35801711815 on `c979900` passed all three jobs; its first attempt failed only the
  unrelated `onboarding-checklist` "Response has been disposed" fixture flake, which passes 3/3
  locally and passed on rerun. Recheck CI on the final head after this note.
- Open: Codex review (S1–S8, especially correcting an amount mismatch or a
  conflicting outcome, and releasing a match or dismissal); the owner's real bank export format;
  authorized owner bank workflow acceptance with a real statement; failed-refund recovery;
  `paymentFunctionError`.
- Next: CI and Codex review of the PR.

## Slice — TRACE-082 failed-refund recovery (2026-09-22, merged as PR #38)

- PR #37 (TRACE-081) merged 2026-09-22 (main `28c52e9`).
- Branch `codex/phase5-failed-refund-recovery`, base main `28c52e9`, worktree
  `../mercurius-failed-refund-recovery`. The `paymentFunctionError` fix (TRACE-076 finding) is
  folded in at the owner's request.
- Owner decisions 2026-09-22 (asked before implementation, all four as recommended):
  - resend or release;
  - a resend is one operator (the refund's author or approver), a release is two;
  - either needs a Stripe readback showing the current send failed or canceled;
  - a refund that fails after it succeeded is a finding.
- Change: migration `20260922002000`:
  - the immutable `money_refund_releases`, and `money_refund_reissues.failed_reference`, so a
    resend shares the reissue generations;
  - `money_operator_resend_refund`, and the reviewed `refund_release` (request, and the
    service-only `money_release_refund` kernel);
  - guard triggers: an earlier send's failed refund is never recorded as the current one, and a
    released refund is never prepared or settled;
  - released authorizations are excluded from every pending check and refund cap (fourteen
    generated substitutions);
  - readbacks: resend and release state, release details and recent releases in
    `money_finance_operations`, and `refunds.released` in reconciliation.
- Also changed:
  - `refund-invoice`'s readback skips earlier failed refunds;
  - `paymentFunctionError` reads the `Response` first, and the finance panel's workaround is gone;
  - `/admin/finance` gains Resend refund and Request release.
- Evidence: `governance/PHASE-5-FAILED-REFUND-RECOVERY.md` (F1–F8) and the TRACE-082 section of
  `governance/PHASE-5-VALIDATION.md`:
  - 2335 SQL assertions across 40 suites (049 new, 123); 37 of 39 mutants killed, the other two
    equivalent;
  - 18 concurrency scripts in CI order, clean reset and replay;
  - 169 unit tests (10 new), build, and 220/221 non-visual browser cases (4 new; the `mds.spec.ts`
    Escape/focus flake passed 3/3 on rerun), 0 audit findings.
- Open:
  - Codex review of F1–F8, especially F3's guard, F5's substitutions, and whether a released
    cancellation refund should be offered again;
  - a reviewed path for a refund that fails after it succeeded;
  - provisioning finance operators;
  - Stripe test-mode acceptance.
- CI run 35810165963 on `740eb2b` passed all three jobs on its first attempt:
  - backend and lifecycle: 2335 SQL assertions across 40 suites on the clean reset and again on
    the clean replay, and all 18 concurrency scripts including the new failed refund script;
  - application: 221 of 221 non-visual browser cases (no flake).
- Next: Codex review of PR #38.

## Slice — TRACE-083 late reversals (2026-09-23, merged as PR #39)

- PR #38 (TRACE-082) merged 2026-09-23 (main `a39abf1`).
- Branch `codex/phase5-late-reversals`, base main `a39abf1`, worktree `../mercurius-late-reversals`.
- Owner decisions 2026-09-23 (asked before implementation):
  - a refund that fails after it settled stands, and the customer is owed. The owner first said
    "the provider owes it"; the conflict with CFG-005/008 (charging the provider twice) was raised,
    and this reading was confirmed;
  - every step takes two operators;
  - a return after a repayment reverses the repayment, as a separate reviewed record.
- Change: migration `20260923001000`:
  - late failures hold what Stripe returned in `customer_refund_payable`;
  - a resend's refund event resettles it through a handler routed from `money_process_event`;
  - a release reverses the refund and restores the fee and provider share;
  - repayment reversals, with the TRACE-080 R4 received amount counting them;
  - a `reversal` bank movement;
  - fifteen generated redefinitions.
- `/admin/finance` gains "Refunds that failed after they settled" and "Repayments Mercurius owes
  back".
- Evidence: `governance/PHASE-5-LATE-REVERSALS.md` (L1–L8) and the TRACE-083 section of
  `governance/PHASE-5-VALIDATION.md`.
- Open:
  - Codex review of L1–L8 and the review questions: a provider top-up where `payout_paid` refuses a
    release; whether a chargeback should block a release;
  - a write-off made unnecessary by a later return;
  - provisioning finance operators;
  - Stripe test-mode and owner bank acceptance.
- CI: `backend` failed on main (since the PR #38 merge at 18:03 UTC) and on this branch before any
  test ran. ghcr.io refused Supabase image pulls with `toomanyrequests`, even when authenticated.
  `.github/workflows/ci.yml` now pulls the same images from public.ecr.aws, retries the stack start
  up to three times, and prints redacted start errors on failure. Skipped jobs were `lifecycle`
  and `application` waiting on `backend`.
- CI run 35915476088 on `99279d7` passed all three jobs: 2531 SQL assertions across 41 suites on the
  clean reset and the replay, all 19 concurrency scripts, lifecycle, and the application job. The
  push run of the same commit was cancelled by the workflow's concurrency group, not failed.
- Next: Codex review of PR #39.

## Slice — TRACE-084 application document retention (2026-09-23, merged as PR #40)

- PR #39 (TRACE-083) merged 2026-09-23 (main `44e4efa`).
- Branch `codex/phase5-application-retention`, base main `44e4efa`, worktree
  `../mercurius-application-retention`.
- Merged as PR #40 at `76c833a` on 2026-09-24 00:10 UTC. Both final-head CI
  runs and post-merge main run 35937218157 passed all three jobs.
- Owner decisions 2026-09-23 (asked before implementation, all four as recommended):
  - the 90 days start at a recorded rejection (or an onboarding rejection); legacy rejections
    are not backfilled;
  - an operator marks an application abandoned with a reason; no inactivity timer;
  - a file that is compliance evidence is never purged;
  - holds can be placed on an application, and a provider hold covers its applications.
- Change: migration `20260923002000`:
  - immutable closures, application hold events and application retention actions;
  - `vendor_close_application` replaces the direct status update;
  - `vendor_application_retention_prepare`/`_record` on the TRACE-074 mechanics;
  - application hold place and release;
  - an evidence guard trigger;
  - queue and overview readbacks.
- Route `/api/vendor-applications/retention`. The Applications dialog gains Closure and
  retention; Document Retention gains Application documents.
- Evidence: `governance/PHASE-5-APPLICATION-RETENTION.md` (C1–C8) and the TRACE-084 section of
  `governance/PHASE-5-VALIDATION.md`:
  - 2678 SQL assertions across 42 suites (051 new, 147); 22 of 22 mutants killed;
  - 20 concurrency scripts in CI order, clean reset and replay;
  - a local route/Auth/Storage round trip (15 checks);
  - 182 unit tests (5 new), build, and 239/239 non-visual browser cases (11 new), 0 audit
    findings.
- Open:
  - Codex review of C1–C8;
  - never-submitted uploads;
  - the admin `UPDATE`/`DELETE` policies on `vendor_applications`;
  - hosted deployment.
- Next: Codex code review of the merged TRACE-084 slice and the remaining Phase 5 gates.

## Workflow update — 2026-09-10

Owner assigned Codex architecture and code review, with Claude implementing the
slices. The managed Next.js block now lives in `CLAUDE.md`; its `@AGENTS.md` import
preserves shared Mercurius authority. The installed Next.js generator recognizes
this placement and retains the block there. Shared role instructions and the agent
guide reflect this workflow.
