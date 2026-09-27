# Phase 6 slice 6.1 — Authoritative request submission (TRACE-095)

Date: 2026-09-26. Branch `codex/phase6-request-submission` from merged main `2ed8036`
(PR #55). Scope: [PHASE-6-SCOPE.md](PHASE-6-SCOPE.md) slice 6.1. Authorities: MPS §6.1/§6.2,
CFG-001–003/009, MDS forms/status/content style, MTS §§4/7/13, DEC-2026-017/019/020.
Local synthetic data only. No external activation, hosted migration, merge or deployment.

## Baseline (characterized on main before any change)

Probes: [review-evidence/trace-095-baseline.sql](review-evidence/trace-095-baseline.sql),
run against a clean reset of main's 166 migrations.

| # | Baseline behavior | Result on main |
|---|---|---|
| B1 | The intake page inserted `service_requests` from the browser. `authenticated` held INSERT on every column; the only check was `customer_id = auth.uid()` | A homeowner inserted `status=completed`, `total_amount=1`, uncovered ZIP: **accepted** |
| B2 | A configuration with no eligible provider was still inserted, then matching set `matching_status=exhausted` | **Active request created** (contrary to CFG-002) |
| B3 | `enforce_homeowner_update_scope` allowed `zip_code` on pending requests | Pending request **moved to an uncovered ZIP** |
| B4 | No retry identity | Identical submissions stored **twice** |
| B5 | Photo-failure "rollback" deleted the request from the browser | Homeowner DELETE is revoked, so the rollback **always failed** |
| B6 | A failed package or price lookup was caught and the request submitted as a quote | Code path (`resolveLivePackages` catch) |

Already protected on main and kept: checkout charges only an operator-published commercial
snapshot (Phase 5 TRACE-059), so browser totals never reached a charge; RLS for reads; photo
ownership policies; lifecycle guards on updates.

## Implemented contract (migration `20260927000000`)

1. `public.submit_service_requests(p_submission_key, p_payload)`, security definer,
   `search_path=''`, EXECUTE for `authenticated` only. Owner = `auth.uid()`.
2. Validates the payload (key, ZIP, address, date not before today in America/New_York,
   frequency, 1–20 unique services, identifier formats, answer bounds) with `22023` messages.
3. Exact coverage: no active `coverage_areas` row → `refused` / `uncovered` or `waitlist`;
   nothing written.
4. Per selection: active catalog service; existing provider; offering of that service and
   provider; tier of that offering; required answers of a chosen offering. Then
   `private.find_eligible_packages_core` on a provisional row decides eligibility (coverage,
   provider ZIP, active/reviewed package, marketing, TRACE-060 onboarding eligibility).
5. Server-derived commercial fields: without an explicit offering, the lowest eligible fixed
   price (the intake page's previous choice); an explicit tier must itself match frequency and
   answers; quote supply → the offering's mode, or `custom_quote` without an offering. The
   answer snapshot uses stored question labels and drops unknown keys.
6. `expected` (what the homeowner saw) is compared, never stored. A different mode or amount
   → `price_changed` with the current terms.
7. Plans are all or nothing (DEC-2026-020). Any refused selection rolls back every
   provisional row and returns each selection's outcome: `eligible_fixed`, `eligible_quote`,
   `unavailable` (`service_not_offered` | `no_eligible_provider`), `invalid_provider`,
   `invalid_package`, `package_unavailable`, `preferred_provider_unavailable`,
   `answers_required`, `price_changed`.
8. Retry identity: advisory lock on actor+key; an accepted submission stores its result and a
   SHA-256 of the payload in `service_request_submissions` (RLS on, no client grants) and one
   `service_request_submission_items` row per selection (unique per selection and request).
   Same key and payload → stored result, `reused: true`. Same key, different payload →
   `22023 Submission key reused with a different request`. Refusals store nothing.
9. `revoke insert on service_requests from authenticated`; `zip_code` removed from the
   homeowner update scope. Admin and security-definer writers are unaffected.

## Intake adaptation (`src/app/request/page.tsx`, `src/lib/requestSubmission.ts`)

Minimal changes; the UI rebuild is slice 6.2.

- One submission key per draft, stored with the browser draft, so sign-in continuation and
  retries reuse it. A key conflict rotates the key and tells the homeowner to check the
  dashboard.
- Direct insert, client price resolution and the silent quote fallback are removed. An RPC or
  network failure, or an unrecognized response, is a recoverable verification error.
- Refusals render an error summary plus a review-step panel with explicit actions:
  **Notify me when available** (existing contact-submission path), **Match me with another
  provider** (clears the selection, which is the fallback consent), **Remove from this
  request**. `price_changed` updates the displayed terms before the next submission.
- Photos attach after the save. On failure the request is kept and the homeowner submits again:
  the replay returns the same request, and photos are attached only if none are recorded.
- Matching and single-fixed checkout continuation are unchanged.

## Evidence (synthetic, local stack)

| Check | Result |
|---|---|
| Baseline probes B1–B5 on main | Reproduced as tabled above |
| SQL suite `063_phase6_request_submission.sql` | 65/65 — privileges, anon/no-user/homeowner/admin bypass probes, validation, boundary ZIPs (covered/waitlist/absent/other covered ZIP without supply), eligible fixed/quote, tampered total/mode, explicit tier, cross-offering tier, out-of-area offering, frequency, inactive/uncataloged/no-supply services, invalid/ineligible/eligible selected provider, required answers, rule tier and label snapshot, mixed plan, key reuse after refusal, replay, changed payload, per-actor keys, suspension and onboarding review, ZIP edit, matching/photo continuation, cross-owner photo |
| Full database suite on the migrated reset | PASS — 3131 assertions / 54 suites |
| `scripts/phase6-request-submission.mjs` (real REST/RPC/Storage) | 21/21 — includes 8 concurrent same-key submissions → one row; 8 racing different payloads on one key → one request; failure-after-save replay and photo attach; cleanup verified (0 rows, 0 objects) |
| SQL mutation check (12 mutants) | 11 killed. Survivor M6 (store client total) is equivalent: `total_amount` is `numeric(10,2)` and a total that differs after rounding is refused before storage |
| Unit (`tests/unit/request-submission.test.ts`) | 27 new; 231/231 total |
| Browser `tests/e2e/request.spec.ts` | 16/16 — 6 new: verification failure then same-key retry; unavailable refusal + explicit interest + axe/reflow light and dark at 320px; selected-provider consent; sign-in continuation with the original key; photo failure after save retried without a duplicate |
| `npm run check` (secret scan, lint, typecheck, unit, build) | PASS |
| Full non-visual browser suite (`npm run test:a11y`, fixture build) | 251/252. `homeowner.spec.ts` light 1440px failed: one axe color-contrast result, then axe timeouts in 4 isolated reruns. The dashboard imports no changed runtime module (only a type-only `database.types` import), so this is recorded as pre-existing/intermittent, not accepted as passing |

Commands: `npm run test:db`; `PHASE6_DB_CONTAINER=supabase_db_<project> PHASE6_SUPABASE_WORKDIR=. node scripts/phase6-request-submission.mjs`;
`npm run check`; build with the fixture public URL, then `npx playwright test tests/e2e/request.spec.ts`.

## Upgrade order and recovery

Apply the migration before (or with) the application deploy. The old intake page inserts
directly and fails with `42501` once the migration is applied, so do not run the old app
against the migrated database. Rolling back the app alone is therefore unsafe; recover
forward with a migration that restores `grant insert ... to authenticated` only if an
emergency requires the old page. New tables are additive. Hosted rollout is Phase 8.

## Decisions for Codex review

Reviewed on 2026-09-27 at `0e4793b`: [D1–D7 dispositions and ZIP boundary review](PHASE-6-DECISION-REVIEW.md).
D3 requires a forward role-enforcement repair before 6.2 implementation. The statements
below preserve the implementation's original review questions, not new policy approval.

- D1 Plans are all or nothing and uncataloged services (including **Something Else**) are
  unavailable → explicit interest (owner, DEC-2026-020). **Something Else** stays visible on the
  Services step and is refused at submission; slice 6.2 should present this earlier.
- D2 An ineligible selected provider is refused with `preferred_provider_unavailable`, never
  queued for later consent. Clearing the selection in the intake is the consent.
- D3 Any authenticated account may submit (all signups receive `homeowner`); no new role gate.
- D4 Fixed requests still enter matching only when an admin offers them, as before. Only quote
  requests start matching from intake. Slice 6.3 owns this.
- D5 Without an explicit offering, a quote request stores `custom_quote` and no package even when
  the only supply is deposit-quote, as before.
- D6 Contact-us for a coverage verification error remains an explicit homeowner action.
- D7 `database.types.ts` regeneration also adds TRACE-097's `job_completion_evidence`, which
  that slice did not regenerate.

## Not performed / open

- ~~No approved Lee County ZIP allowlist is committed.~~ Closed in the post-merge follow-up below.
- Checkout Edge function not served locally. The unchanged handler returns the review URL or
  `COMMERCIAL_REVIEW_REQUIRED`; the browser path is covered with scripted responses.
- The concurrency script is not wired into CI (same pending owner decision as TRACE-097's).
- Human screen-reader, zoom and cross-browser checks; PR CI; Codex review; hosted migration.
- While debugging the browser suite, one ad hoc run against a build that had inlined the
  hosted `NEXT_PUBLIC_SUPABASE_URL` made unauthenticated read-only catalog requests to the
  hosted project (public catalog tables and `pricing_server_now`). No writes, no sign-in and no
  customer data. Evidence runs used the documented fixture build.

## Post-merge follow-up (2026-09-27, branch `codex/phase6-cleanup` from main `b85c887`)

- **Review-step copy** (CodeRabbit finding on PR #56): the intake said an ineligible rate
  "becomes a quote or matching request instead", which DEC-2026-020 no longer does. It now says
  nothing is submitted and the homeowner sees what changed first.
- **Allowlist (DEC-2026-021):** migration `20260927010000_cfg001_lee_county_coverage.sql`
  activates the 47 USPS Lee County ZIPs. SQL 064 (16 assertions) checks the exact list, that no
  other real ZIP is active, and submissions at covered split/island ZIPs (33917, 33936, 34134,
  33921, 33957) versus uncovered neighbors (33955, 33948, 34110, 34119, 33935).
- **Scope doc:** PHASE-6-SCOPE.md no longer says Phase 4 is unaccepted (DEC-2026-019).
- Evidence: clean local reset, 3147 assertions / 55 suites; `phase6-request-submission.mjs` 21/21;
  `npm run check` (secrets, lint, typecheck, 231 unit, build); request browser tests 16/16 on the
  fixture build. Hosted migration is not performed.

## P6-R1 repair: homeowner role enforcement (2026-09-27, branch `codex/phase6-role-repair` from `ab17e99`)

Codex's [decision review](PHASE-6-DECISION-REVIEW.md#p6-r1--p2--authenticated-identity-substitutes-for-homeowner-authorization)
found that `submit_service_requests` accepted any authenticated identity (D3).

- **Migration `20260927020000_trace095_homeowner_role.sql`** moves the unchanged 6.1 body to
  `private.submit_service_requests_core` (no EXECUTE for anon, authenticated or service_role) and
  puts a same-signature public wrapper in front, following the `money_prepare_checkout`
  precedent. The wrapper refuses a missing user, then a caller without `homeowner`
  (`42501 Homeowner authorization required`), before validation, the replay lookup or any write.
  Dual-role homeowner+vendor/admin accounts keep working. Signup roles, data, coverage,
  eligibility, pricing, replay and dispatch semantics are unchanged; no other caller exists.
  Generated types are unchanged. Forward recovery: a later migration can replace the wrapper;
  the core is untouched.
- **SQL 065** (29 assertions): privileges on command and core; homeowner, homeowner+vendor and
  homeowner+admin submit; forged payload owner ignored; no-role, vendor-only and admin-only
  refused with nothing stored; no-user, anonymous and direct core calls refused; RLS read
  isolation; replay and new submission refused after role removal, original request preserved,
  replay works again once the role is restored. Before the migration, 11 of its behavioral
  assertions failed (the defect); after it, 29/29.
- **Script** `phase6-request-submission.mjs`, now 23 checks: adds a real REST vendor-only refusal
  (403/42501, no request) and a dual-role provider+homeowner submission.
- Evidence (local synthetic stack `vugqqyemuptlvcieihww`): upgrade from head `20260927010000`
  with 063 65/65, 064 16/16, 065 29/29, script 23/23; the rollback-only
  [D3 characterization](review-evidence/trace-095-role-scope.sql) now stops at its submission
  with `Homeowner authorization required` (it characterized the defect and is kept unchanged as
  review evidence). Clean `supabase db reset --local`: 169 migrations, head `20260927020000`;
  `supabase test db` 3176 assertions / 56 files PASS; script 23/23 again; `supabase gen types`
  identical to the committed file. No application code changed, so `npm run check` and browser
  suites were not rerun. Hosted migration remains Phase 8.
