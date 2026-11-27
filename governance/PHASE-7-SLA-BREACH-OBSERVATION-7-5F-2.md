# Phase 7.5F-2 — SLA-breach observation: operator page (TRACE-159)

**Status:** **IMPLEMENTED FOR REVIEW.** Not merged, not deployed. No migration and no database-function change. No scan or purge has run anywhere outside synthetic tests.
**Date:** 2026-11-27 (America/New_York).
**Base:** `main` `5cfe5b0` (#211 merge), fetched before work. Branch `claude/phase7-5f2-sla-observation-page`.
**Authority:** the owner's 7.5F-2 implementation instruction (2026-11-27 ET); [DEC-2026-069](DECISION-LOG.md) (OD-1, OD-2, P-1..P-7); [7.5F plan](PHASE-7-SLA-BREACH-OBSERVATION-PLAN-7-5F.md) revision 4 (§3, §4.10, §4.11, §5, §6 group P, §7 AC 5); [7.5F-1 record](PHASE-7-SLA-BREACH-OBSERVATION-7-5F-1.md) (I-15 deferred the client mutations here; §8 F208-1 repair); 7.5E F-1/F-2 (account-bound state, unknown outcomes); 7.3D-2 (purge control precedent).

## What this slice does not do

- No migration, database function, grant or SQL test change. The page calls the seven 7.5F client functions exactly as merged (`20261203001000`, with the detector as repaired by `20261204001000`).
- No hosted query, migration push, merge, deployment, production scan or purge. No scheduler, alert, notice, email activation, booking or payment change.
- Nothing scans or purges on page load, refresh, filtering, paging, waiting or a read retry. There is no polling and no timer.
- No new threshold or rule; no first-reply lateness (P-4); no backfill (P-5); no cadence (P-6). Not Phase 7 acceptance; HQ-5 and HQ-6 stay open.

## 1. State verified before work (dated facts)

| Item | Evidence (2026-11-27 ET, GitHub reads only) |
|---|---|
| #211 (F208-1 repair) | merged as `5cfe5b0` at 2026-11-26 23:55:34 UTC from head `fe89f98` |
| `main` CI on `5cfe5b0` | run 45913754650 `CI` (push), **success**, 23:55:37 → 2026-11-27 00:30:44 UTC |
| #212 (hosted state and readback of `20261204001000`) | **open**, head `c53b3fe`, documentation only; checks: one cancelled run of `backend`/`lifecycle`/`application`, then each **success**. Its record §8.6.1 states that the 2026-11-27 dry run found `20261204001000` already on hosted (applier and time unrecorded) and that the detector md5 `8556973a…` and the other readbacks matched. **Not re-verified here**: no hosted query was made for this slice |
| Deployment of `5cfe5b0` | not verified (no Vercel query was made) |
| Numbering | no migration or SQL test added |

**Hosted dry run (2026-11-27 ET, owner instruction "run any migration needed"):** `npx supabase db push --linked --dry-run` (CLI 2.116.0), 15:02:39–15:02:48 UTC: `Remote database is up to date`, no pending migration; the newest migration in this branch is `20261204001000`. No push was run (nothing pending), and no readback query was made, so detector and function md5s were not re-read here.

**Release dependency (kept separate from this PR).** The page calls `admin_detect_sla_breaches`, whose unrepaired body could return an incomplete `visible` replay (F208-1). Releasing this page therefore requires confirmation that `20261204001000` is applied on hosted and read back. That confirmation is #212's record, which is not on `main`; it should be accepted (and, if the owner wants it re-checked, re-read under its own authorization) before this PR merges. As a second line of defence the page refuses to show an incomplete run (§3, I-3): that shape is treated as an unknown outcome and resolved through the lookup.

## 2. What was built

| File | Content |
|---|---|
| `src/lib/slaObservations.ts` | Rule labels and targets (OD-1), queue links for overdue-now work, strict parsers for every 7.5F answer, scan-error classification, key lifetime from a version-7 key, wording (lower bound, descriptive intervals, lag, "not still overdue"), purge texts with logical and physical counts kept apart |
| `src/lib/slaObservationsController.ts` | Account-bound page state: reads, the scan state machine (new key → detector → lookup → same-key retry), the purge; every answer discarded after an owner change |
| `src/hooks/useSlaObservations.ts` | Binds the controller to the signed-in account; never renders another account's snapshot |
| `src/app/admin/sla-observations/page.tsx` | The page (§3); remounted per account |
| `src/components/admin/AdminSidebar.tsx` | "SLA Observations" entry beside Notifications (primary entries) |
| `src/lib/adminOperations.test.ts` | Navigation test updated for the new entry |
| `src/lib/notificationDestination.ts` | The new page listed as an existing admin route (I-13) |
| `tests/fixtures/sla-observations.ts` | Synthetic detector answers shared by the unit and browser tests |
| `tests/unit/sla-observations.test.ts`, `tests/unit/sla-observations-controller.test.ts` | Unit groups (§5.1) |
| `tests/e2e/admin-sla-observations.spec.ts` | Browser groups (§5.3) |

## 3. Behaviour against the instruction and plan

| Requirement | Implementation |
|---|---|
| Manual "Scan now" | Each press: `admin_sla_new_run_key()` then one `admin_detect_sla_breaches(key, 200)`. A failed or non-v7 key: "The scan couldn't start … nothing was scanned or recorded"; the detector is not called |
| Recent runs | `admin_sla_detector_runs(20)`, "Show up to 100 runs" (the readback's maximum); outcome badge, description, actor, per-rule details, key |
| Observations filtered by rule | `admin_sla_observations(rule, before_id, 50)`, "All rules" or one rule; keyset "Load older observations"; a page started under another filter is discarded |
| Summary | `admin_sla_observation_summary(from, to)` for all retained records, the last 30 days or the last 7 days: runs by outcome, per rule "At least N" recorded, lag range, rule read/failed/skipped counts, first and last read, longest gap labelled descriptive; the database's own statement shown verbatim |
| Separate overdue-now, observations, first-response facts | An explainer with three labelled facts: overdue-now work links to Quote exceptions, Fulfillment follow-up, Support tickets and Offers at other terms; observations are records that never say "still overdue"; first replies are on Support tickets, and lateness is not reported (P-4) |
| Lower bound; intervals establish no coverage | Stated in the explainer, the summary and the observation list (`LOWER_BOUND_STATEMENT`, `INTERVAL_STATEMENT`, `LAG_STATEMENT`); a wording test rejects completeness claims |
| Complete, partial, failed, skipped | Shown as the database recorded them; a run whose outcome does not match its rule statuses, whose per-rule counts break `listed = already_recorded + inserted + conflicted + over_limit`, or whose totals do not add up is unreadable, never shown (I-3). Skipped: "Nothing was read or recorded … press Scan now to start a new scan" |
| Uncertain outcomes via the run-key lookup | `57014` ("This attempt was cancelled before it finished … another attempt with the same key may have finished"), no answer, an unreadable answer (including the F208-1 incomplete shape) and every non-refusal code (including `XX000`) are **unknown** and call `admin_sla_detector_run(key)`. `visible` settles it ("Confirmed by looking up the scan's run key"); `expired` shows no content; `not_visible` stays unknown ("No result is visible yet …"); a failed lookup stays unknown, with "Check again" (lookup only) |
| Same key on retry; lifetime; expired | "Try again with the same key" re-sends the same key and the same limit, only before `retry_until` (from the lookup, or from the key's embedded time if the lookup failed); checked again at the click. Past it: "This key can no longer be retried" and only a new scan. `22023` "too old" retires the key. An expired run is never shown with content |
| Stale results after account changes | The controller's epoch (as 7.5E F-1): a new owner, sign-out or unmount resets state, drops the pending key and discards every late read, scan, lookup or purge answer; the page also remounts per account, closing any dialog |
| Purge | `ConfirmAction` dialog, Cancel focused; "Permanently delete expired SLA records?"; expired-only scope and the per-class limit stated; one confirmation sends exactly one `admin_purge_sla_records(1000)`. Complete: "Records deleted: …" and "Database rows deleted: …" on separate lines with named units, remaining expired counts (cap 10,000, runs still referenced) and the oldest remaining expiry. Skipped: an error in the dialog, never "Done". Refused (`42501`, `22023`, `55000`, `PGRST202/301/302`): "Nothing was deleted". Anything else: "We couldn't confirm whether the purge ran … Expired records may have been deleted; no unexpired record can be" |
| Accessible states | Loading (`role=status`), empty, error with "Try again" (reads only) and permission states through `PageState`; focus moves to each settled scan status; older-page failure keeps the list; screen-reader announcement on paging; axe WCAG 2.2 AA at 320 and 1440 px |
| Admin navigation | "SLA Observations" (Hourglass icon) after Notifications |
| Access denial | The admin layout's `has_role` guard; a `42501` from any readback shows "Admin access required … Nothing was scanned or changed" and hides the actions; the database checks admin on every call |

## 4. API capability gaps (reported; scope not expanded)

| ID | Gap | What the page does instead | Would need |
|---|---|---|---|
| G-1 | No readback of the retention value. Plan §5 said the purge control is "shown only when retention is set" | The control is always shown (retention is 90 days in `20261203001000`); a `55000` "retention is not decided" is shown as a refusal with "Nothing was deleted" | A retention readback (database change) |
| G-2 | No purge-outcome lookup or purge-log readback | An unknown purge cannot be resolved: the page says expired records may have been deleted, no unexpired record can be, and to refresh before running it again | A purge key or a purge-log readback |
| G-3 | No count of expired records before a purge | The confirmation states the per-class limit, not how many are waiting; the result reports what remains | An expired-backlog count |
| G-4 | `admin_sla_detector_runs` has no cursor and returns at most 100 | "Show up to 100 runs"; then "older retained runs aren't listed here" | A keyset on runs |

None blocks the instruction's requirements; each is a decision for Codex and the owner (D-1).

## 5. Evidence

Local, 2026-11-27 ET. No local Supabase stack was needed: every 7.5F function is served synthetically in the unit and browser tests; the database contract is SQL 131/132 (unchanged).

### 5.1 Unit

`npx vitest run tests/unit/sla-observations.test.ts tests/unit/sla-observations-controller.test.ts`: **38/38** (14 + 24).

| Group | What it proves |
|---|---|
| Parsing | Complete, partial, failed, skipped runs; the F208-1 incomplete shape, invariant breaks, outcome/status mismatch, wrong totals, order or rule count refused; detector answers only for the key sent; expired carries no content; lookup's three states (not_visible requires `retry_until`); runs, pages, summary (no coverage field); purge logical vs physical consistency, skipped, cap |
| Classification | `57014` cancelled; only `42501`, `22023`, `55000`, `PGRST202/301/302` are refusals; too-old retires the key; `XX000`, `08007`, `PGRST000`, no code and thrown errors unknown; key lifetime from the v7 timestamp, none for other keys |
| Wording | No "all breaches", "complete coverage", "no breaches missed", "guarantee", "every breach"; kind labels never say "still overdue"; rule results never invent counts; lag text; links only to `/admin/requests?request=<uuid>`, `/admin/tickets` or the queue anchor (a non-UUID request id falls back to the queue) |
| Reads only | Load, refresh, filter, period, more runs and older pages call only the four readbacks; keyset; superseded pages discarded; failed older page keeps rows; `42501` → denied |
| Scan | New key, then one detector call with `{p_run_key, p_limit: 200}`; a second press while running sends nothing; replayed, partial, failed, skipped as stated; expired without content; no key → no detector call; refusals settle only the attempt |
| Unknown | `57014` → lookup → `not_visible` stays unknown with `retry_until`; lost answer settled by lookup; unreadable/`XX000`/gateway → lookup; failed lookup stays unknown, Check again reads only; retry reuses key and limit, `57014` on the retry is looked up again, then a replay settles it; past the lifetime nothing is sent and a new scan gets a new key; retry refused as too old retires the key |
| Accounts | A's scan answer after B signs in discarded, no lookup or reread follows; a lookup answer after A → B → A discarded and the pending key gone; reads answered after a switch never shown; a purge answered after a switch is stale |
| Purge | One call with `p_limit: 1000`, a second press sends nothing, complete re-reads; skipped is its own outcome; `55000`/`42501` refused; `XX000`/`57014`/no answer/inconsistent counts unknown; scan and purge exclusive in the UI |

### 5.2 Mutations

Each mutant is one literal edit of the source, the two unit files run, the source restored (`git diff` clean afterwards).

| Mutation | Result | Unit |
|---|---|---|
| **`not_visible` mapped to failure** (deferred from 7.5F-1, I-15) | caught | 5 failed |
| **`57014` mapped to "recorded nothing" without a lookup** (deferred from 7.5F-1, I-15) | caught | 3 failed |
| `57014` classified as a refusal | caught | 3 failed |
| Retry with a different key | caught | 1 failed |
| Retry ignores the key lifetime | caught | 1 failed |
| Retry with a different limit | caught | 2 failed |
| Epoch check removed from the scan answer | caught | 1 failed |
| Owner change keeps the pending scan | caught | 2 failed |
| Loading also scans | caught | 19 failed |
| Purge `XX000` treated as a refusal | caught | 1 failed |
| Scan `XX000` treated as a refusal | caught | 3 failed |
| Expired detector answer shown | caught | 1 failed |
| Purge logical/physical consistency check removed | caught | 2 failed |
| Epoch check removed from the lookup | **survived (equivalent)**: the next statement discards an answer whose key is not the pending one, and a new owner never has the old key | 0 |
| Outcome-value check removed from `parseRun` | **survived (equivalent)**: the outcome/rule-status consistency check and the rules-array check still refuse every such answer, including F208-1's | 0 |

### 5.3 Browser

`npx playwright test tests/e2e/admin-sla-observations.spec.ts` against a production build made with CI's synthetic environment (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831`, as the `application` job): **16/16**. Every 7.5F function is served per test and every call recorded; other origins are aborted.

| Test | What it proves |
|---|---|
| Reads only (1440 and 320 px) | Opening, Refresh, the rule filter, Load older, the period, a reload and 1.5 s of waiting make no key, detector or purge call; the three facts, lower-bound and interval statements are shown; axe clean, no horizontal overflow |
| Observations | Labelled as records with lag; T-8 shows the ticket kind; links go to `/admin/requests?request=<uuid>` or `/admin/tickets`; never "still overdue"; summary "At least N", no coverage claim; the request link navigates |
| Scan now | One key, one detector call `{p_run_key, p_limit: 200}`, per-rule counts, focus on the status, runs re-read, no further write |
| Outcomes | Partial (with the failed rule's SQLSTATE), failed, skipped as recorded; a replay says it had already run; a skipped scan says the key is used up and the next press uses a new key |
| Unknown | `57014`: cancelled, looked up, stays unknown (never "nothing was recorded", "did not run" or "failed"), axe clean, same-key retry replays (same key and limit twice, one key issued). Aborted answer and aborted lookup: still unknown; Check again settles it by lookup without another detector call. F208-1 incomplete answer: unknown; `retry_until` passed: no retry button; expired lookup: no content |
| Refusal and access | `22023` too old: refused, recorded nothing, key retired. A signed-in non-admin is sent home by the server proxy and no 7.5F function is called; an admin whose readback returns `42501` sees the permission state and no actions |
| Stale and navigation | Sign-out while a scan is held: after release nothing is shown, requested or navigated. Leaving mid-scan and returning: the page is idle, nothing re-sent |
| Purge | Dialog text (permanent, expired-only, per-class limit, Cancel focused), axe clean; Cancel calls nothing; one confirmation is one `{p_limit: 1000}`; logical and physical lines; nothing repeats. `55000` refusal, aborted (unknown) and skipped answers shown in the dialog; skipped recorded as "skipped", not "Done" |
| States | Loading, empty runs and observations, summary error with Try again (reads only) at 320 px, axe clean |

Regression specs sharing the sidebar, admin layout and `ConfirmAction` (`admin-notifications`, `admin-operations`, `email-evidence-purge`, `portals`): **67/67**. Final-source rerun: §5.5.

**Local incident (disclosed).** The first local build used `.env.local`, whose hosted `NEXT_PUBLIC_SUPABASE_URL` Next.js inlines at build time. In that run every admin page redirected to sign-in: the browser aborted all non-local origins, but the server-side proxy (`src/proxy.ts`, `auth.getUser()`) sent about 17 `GET /auth/v1/user` requests to hosted Supabase Auth carrying the synthetic, unsigned test token. Each was rejected; no database query, write or user data was involved. The build was redone with CI's synthetic values and checked to contain no project host before any further run.

### 5.4 Repository checks

| Check | Result |
|---|---|
| `npm run typecheck` | pass |
| `npx eslint` on every changed source and test file | pass, no warnings |
| `npx vitest run` (full unit suite) | **87 files, 1,448 tests, pass** |
| `npm run scan:secrets` | pass |
| `npm run build` | pass (synthetic environment) |
| `git diff --check` | pass |
| Final-head CI | PR body |

### 5.5 Final-source rerun

After the last source change (I-13), a fresh production build with CI's synthetic environment (no project host anywhere under `.next/server` or `.next/static`), then `admin-sla-observations`, `admin-notifications`, `admin-operations`, `email-evidence-purge` and `portals`: **83/83** (16 + 67). The full browser lane and the database jobs run in CI.

**Not run locally:** browser-level mutants (each needs a rebuild); the deferred mutations are unit-level, as plan §6 U places them. The SQL suite and concurrency scripts are unaffected (no database change) and run in CI.

## 6. Implementation decisions for Codex review

| ID | Choice | Reason |
|---|---|---|
| I-1 | Scan refusals are `42501`, `22023`, `55000` (each raised before the detector writes) and PostgREST's `PGRST202/301/302` (answered before the database); everything else, including `XX000`, is unknown | Plan §4.10 "definite refusal" rows; 7.3D-2 precedent for the PostgREST codes |
| I-2 | Purge `XX000` and `57014` are unknown, not refusals | A code alone does not prove a rollback (7.3D-2 precedent) |
| I-3 | Parsers are strict (outcome vs rule statuses, per-rule invariant, totals, rule order, rule count); an unreadable scan answer is unknown and looked up; an unreadable read is an error state | Never show an inaccurate or incomplete run; second line of defence for F208-1 |
| I-4 | The retry lifetime is the lookup's `retry_until`, or the key's embedded time + 24 h when the lookup failed; checked at the click, not on a timer | No polling; the database still refuses a too-old key |
| I-5 | "Scan now" stays available while an outcome is unknown, with the statement that a new key starts a separate run and no item is recorded twice | Otherwise an unresolved key would block scans for 24 hours; the scan lock and the episode key keep it safe |
| I-6 | Scan and purge are exclusive in the page (each disabled while the other is in flight); the database's shared lock remains the control | Avoids a self-inflicted `skipped` |
| I-7 | Summary periods: all retained records (`from` = epoch; expired rows are excluded by the readback), 30 days, 7 days; `to` = browser now + 1 day | No retention value restated for the window; tolerates a browser clock behind the database |
| I-8 | Purge limit 1,000 (the maximum), as 7.3D-2 | One confirmation, one bounded call |
| I-9 | A skipped purge is shown in the dialog as an error, not "Done" | It deleted nothing |
| I-10 | The page names "90-day retention (DEC-2026-069)" | Policy-sourced copy; it changes with a new decision and migration (no readback, G-1) |
| I-11 | The pending run key lives only in page memory; a reload or account change drops it | No client storage of run keys; a committed run is still listed under Recent runs |
| I-12 | Rule targets are copied from OD-1 as display text; the database holds the rule logic | One place for wording; a rule change needs a migration and this table |
| I-13 | `/admin/sla-observations` added to `ADMIN_NOTIFICATION_ROUTES` (7.5E) | That test requires every static admin page to be a valid notice destination; no producer links here and the detector writes no notice |

## 7. Decisions needed

- **D-1 (Codex, owner):** accept G-1..G-4 as known limits for this release, or authorize a separate database slice for any of them.
- **D-2 (owner):** merging this PR deploys a page on which any admin (R0: Josh only, DEC-2026-025) can press "Scan now" and the purge. Pressing either in production is the separately authorized activation (plan §10.2 D; DEC-2026-069 P-7, "after separately authorized production activation"); the page adds no technical gate. Confirm that is the intended control.
- **D-3 (owner):** accept #212's record of `20261204001000` on hosted (or re-read it under its own authorization) before merging this PR (§1).

## 8. Open items

- Codex review of this PR (I-1..I-13, G-1..G-4).
- Owner authorizations: release (merge) after D-3; first hosted scan (D) and first hosted purge (P-7) remain separate actions.
- Carried unchanged: HQ-1..HQ-6 (HQ-5 open until a hosted staged breach is observed under its own authorization); OD-3..OD-7; OD-5 external channel; AC-1 D-1, D-4..D-6; SD-1, SD-2; 7.5D F-1, O-1..O-3; 7.5F-1 O-1.
