# Phase 7.5F — SLA-breach observation: design and implementation plan (TRACE-159)

**Status:** PLAN FOR REVIEW (Codex). Documentation only. **Nothing here is approved or built.** OD-1 and OD-2 are open (contract §9; DEC-2026-068 keeps them open). No implementation starts until the owner approves both explicitly (§10).
**Date:** 2026-11-25 (America/New_York).
**Base:** `main` `846dd34` (#204 merge, 2026-11-25 22:14:10 UTC), fetched before work. Branch `claude/phase7-5f-sla-observation-plan`.
**Authority:** the owner's 7.5F preparation instruction (2026-11-25 ET). [Operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) (OQ-1) §4 (T-1..T-11), §6.1 (proposed design), §7.2 HQ-5, §9 OD-1/OD-2, §10 step 5. [7.5C record](PHASE-7-OPERATIONS-STAGED-FAILURES-7-5C.md) (method, SF-6b). [7.5D record](PHASE-7-SUPPORT-FIRST-REPLY-7-5D.md) (first reply, R-7). [7.5E record](PHASE-7-ADMIN-NOTIFICATION-READBACK-7-5E.md) (F-2 unknown outcomes). Roadmap Phase 7 gate. CFG-010, CFG-011, CFG-015; DEC-2026-003, -006, -045 choice 8, -063.

## What this plan does not do

- No application, database, test, CI or configuration change. No hosted Supabase, Vercel, Stripe, Resend or PostHog call; GitHub was read only.
- No scheduler, notice, alert, email, booking, payment or email activation, now or in the slices it proposes.
- No new threshold. Every rule below is already approved (contract §4); everything else keeps "no approved threshold".
- Does not accept any part of Phase 7. An observation is not an alert: the gate's alert outcome stays MISSING (OD-5 external channel, HQ-6).

---

## 0. Summary

1. **Five rules have a breach instant that existing readers already compute:** T-3 (three quote kinds), T-4 failure aging, T-5, T-8 and T-10 (§2). For each, the qualifying condition is exactly the queue's own "aged"/"overdue" condition, and `due_at` comes from one named source timestamp. T-1, T-2, T-6, T-7, T-9 and T-11 are left out, with reasons; T-9 overlaps T-8 and needs a choice (P-1).
2. **Design:** an append-only observation ledger and an audited run record in `private`, written only by one admin-invoked detector that **calls the existing queue readers** and copies identifiers and times. It never replaces or restates a reader (§4).
3. **What it can prove:** "at `observed_at`, item X was past its `due_at` under rule T-n". **What it cannot:** that no other breach happened. A breach that begins and ends between two scans leaves no record (§3.2). Observation counts are a lower bound; lag is detection delay, not breach duration.
4. **Three facts stay separate:** overdue now (queue, computed on read), recorded observation (ledger, never updated), first-response fact (7.5D `first_response_at`, derived from messages) (§3.1).
5. **Proposed delivery:** 7.5F-1 database (migration, SQL tests, concurrency script) and 7.5F-2 operator page, as two PRs (§5). Hosted push and the first hosted scan each need the owner's authorization (§8).
6. **Open:** OD-1, OD-2 (card §10); policy choices P-1..P-6 and design questions D-1..D-9 (§9).

## 1. Baseline and reconciliation

| Item | Observation (2026-11-25 ET; GitHub read only) |
|---|---|
| `origin/main` | `846dd34` (#204). Before it: `24fd251` (#205, /services Option C), `01a5dd1` (#203), `afa0be8` (#202) |
| Open PRs | #206 only (draft, /services revision 1, TRACE-161). Not touched |
| Migrations / SQL tests | Latest `20261202001000` (7.5D); latest SQL test `130_admin_notification_readback.sql`. This plan adds none |
| OD-1, OD-2 | **Not approved.** No DECISION-LOG, OWNER-APPROVALS or CONFIGURATION-DECISIONS entry; DEC-2026-068 says they stay open |
| Main CI | `846dd34` run 45711471570 success; `01a5dd1` run 45537955099 success |

### 1.1 #203 (7.5E review repair): merged; review and deployment evidence open

| Item | Status | Source |
|---|---|---|
| Merge | **Merged** 2026-11-25 03:09:07 UTC as `01a5dd1`, from head `5fc09e1` | GitHub PR record |
| Exact-head CI | Run 45521103690 success (backend, lifecycle, application) | #203 owner comment |
| Codex re-review of the repair | **Not recorded.** No GitHub review object; no review note in any record. Open | GitHub; 7.5E record §11 |
| Production deployment of `01a5dd1` | GitHub deployment 8047197415 (Production) status `success`. **READY not verified** (no Vercel query) | GitHub deployments API |
| Effect | `main` now carries the F-1/F-2 repairs; the window in which production ran the unrepaired #202 code (`afa0be8`, 00:33–03:09 UTC) is not otherwise characterized | — |

### 1.2 #204: merged the inert copies; its documentation is not repeated here

#204 merged `claude/phase7-5e-admin-notification-readback` (#202's branch, head `632a600`) as `846dd34` at 22:14:10 UTC, with no review object. Its source commits `d34b2a2` and `8b75582` have **trees identical** to #203's `7b72d18` and `0610688` (checked with `git rev-parse <commit>^{tree}`), so no code changed (the merge diff touches three documents only). It added, as duplicates of what #203 already recorded:

| Added by #204 | Duplicate of |
|---|---|
| 7.5E record header: a second "Review (2026-11-24 ET)" line | the line two lines below it |
| 7.5E record §11.4: five result rows citing `d34b2a2`/`8b75582` | the five rows citing `7b72d18`/`0610688` (same trees) |
| TRACEABILITY: a fourth TRACE-159 row (line 178), a stale copy without the #202-merged note | row 179 |
| HANDOFF: "Next (after repair): Codex re-reviews the new head" | the next line |

Following the 7.5E precedent (F-3: "none deleted"), nothing is removed. This plan adds one dated status line to the 7.5E record header and appends to the most complete TRACE-159 row (179) only. Removing the duplicates is a separate owner choice (R-F1, §9).

## 2. Rule evaluation (OD-1 recommendation tested against the source)

Every reader below is `SECURITY DEFINER`, admin-only (`42501`) and evaluates at transaction `now()`.

| Rule | Kind(s) | Reader the detector calls | Qualifying condition (exactly the reader's) | `due_at` source | At `due_at` exactly | Subject (key) | Leaves the queue when |
|---|---|---|---|---|---|---|---|
| T-3 proposal missing | `proposal_missing` | `public.admin_quote_queue()` ([20261027001000:453](../supabase/migrations/20261027001000_phase6_recurring_payments.sql#L453)) | listed (`now() >= since + 24h`), `aged` | `since + 24h`, where `since` = greatest of the current provider's acceptance (or `assigned_at`), latest declined quote's `decided_at`, latest expired quote's `expires_at`, latest returned proposal's `decided_at` | observed (lag 0) | `request_id` | proposal submitted; quote submitted/accepted; request leaves open quote work |
| T-3 awaiting operator send | `proposal_review` | same | pending proposal, `now() >= created_at + 4h` | `request_quote_proposals.created_at + 4h` | observed | `detail.proposal_id` | proposal sent or returned |
| T-3 awaiting homeowner | `quote_decision` | same | submitted current quote, `now() >= sent_at + 12h` | `request_quotes.sent_at + 12h` | observed | `detail.quote_id` | decided, or expired at 24 h (T-2) |
| T-4 failure aging | `payment_failed` | same (its G6 rows come from `private.money_payment_exceptions(now())`) | latest attempt `expired`, obligation not fully captured, `aged` | first `checkout_expired` webhook `received_at` for the attempt (else attempt `expires_at`) + 24 h | observed | `detail.attempt_id` | capture, a newer attempt, or reconciliation resolved |
| T-5 | `confirmation_overdue` | `public.admin_fulfillment_queue()` → `private.fulfillment_queue_items(now())` ([20261029001000](../supabase/migrations/20261029001000_phase6_fulfillment.sql)) | `vendor_completed`, `coalesce(confirmation_sent_at, vendor_completed_at) + 72h <= now()`, no follow-up since | the item's `since` (it **is** the 72-hour mark) | observed | `request_id` | follow-up recorded after `since`, or status change |
| T-8 | open/in-progress support ticket | `public.admin_support_queue(false)` ([20261202001000](../supabase/migrations/20261202001000_phase7_support_first_reply.sql)) | `overdue`: open/in progress, `response_due_at < now()` (strict), no qualifying first reply (CD-1) | `support_tickets.response_due_at` (set once at open by CFG-010 routing; never reset, 7.5D R-7) | **not** observed; first at `due + 1 µs` | `ticket_id` | first participant-visible operations reply; resolved/closed |
| T-10 | `unanswered` | `public.admin_offer_terms_queue()` ([20261118001000:941](../supabase/migrations/20261118001000_phase6_o10_review_forward_fix.sql#L941)) | `unanswered` (no problem, no response, `accepted_at <= now() - 24h`) | `accepted_at + 24h` (the item's `since` is the acceptance, so the detector adds 24 h; D-2) | observed | `terms_id` | terms answered; a problem appears (becomes `not_acceptable`); request leaves `awaiting_terms` |

**Kinds deliberately excluded** inside included rules: `payment_unresolved` (T-4 "queued immediately", no aging instant), `deposit_review`, `provider_review`, `accepted_change` (no threshold), `not_acceptable`, `blocked_inactive`, `rematch_failed` (immediate, no threshold), `fulfillment_exception`, `evidence_unverified` (no threshold).

**Rules not recommended for OD-1:**

| Rule | Why not |
|---|---|
| T-1 (4 h offer) | The expiry *is* the outcome (next offer or exhaustion), applied lazily; there is no "overdue" state to observe, only an expired offer already recorded in `job_match_attempts` |
| T-2 (quote 24 h) | A state change recorded by `expire_request_quotes`; the T-3 `quote_decision` observation covers the waiting period before it |
| T-6 (recurring visibility) | Sets when an item appears, not an aging time; the recurring `aged` (after appointment start) is an implementation choice, not an approved SLA (contract §4) |
| T-7 (replacement search) | An exhaustion boundary, not a response target |
| T-9 (dispute acknowledgement) | Implemented as T-8 on the dispute ticket; the same ticket is already in the T-8 reader. Labelling is P-1 |
| T-11 (compliance expiry) | A document validity date and a flag, not an operations response target; recording it would be a new measure |

## 3. What is being recorded, and what a manual scan misses

### 3.1 Three different facts

| Fact | Where | Meaning | Does not mean |
|---|---|---|---|
| **Overdue now** | Existing queue readers, at page load | The item is past its target at this instant; work is open | Anything about the past |
| **Recorded observation** | New ledger row | At `observed_at` a detector run saw the item past `due_at` under rule T-n | That it is still overdue, how long it lasted, how it ended, or that unobserved items never breached |
| **First-response fact** | `first_response_at` in support queue items and operator detail (7.5D) | The earliest participant-visible operations message was recorded at that time | That anyone read it; and it is not an observation. For T-8, "was the first reply late" is derivable from it for every ticket, scanned or not, but 7.5F does not report that (P-4) |

The detector never writes `first_response_at` or any queue input. A T-8 observation stays in the ledger after the reply arrives.

### 3.2 What a manual scan can miss (M-1..M-9)

| ID | Case | Result |
|---|---|---|
| M-1 | Crosses `due_at` and leaves the queue between two scans (reply, decision, follow-up, capture, status change) | **No observation, ever.** Example: quote sent 09:00, scans at 20:00 and 10:00 next day, homeowner decides at 22:00 (past the 21:00 mark): breached, unrecorded |
| M-2 | No scan since the crossing | Not observed yet; the ledger is only as current as the last complete scan |
| M-3 | Reclassified before a scan: T-10 `unanswered` → `not_acceptable`; T-3 `quote_decision` expires at 24 h (T-2); T-8 ticket closed without a reply | Leaves the qualifying condition; as M-1 |
| M-4 | A rule fails in a partial run (§4.9) | That rule observes nothing in that run |
| M-5 | Per-rule limit reached (§4.8) | Remaining items observed by a later run, with larger lag |
| M-6 | A source timestamp moves (a later acceptance, decline or expiry resets T-3 `since`; a direct correction) | A new `due_at` is a new key: one real episode can produce two rows (D-7) |
| M-7 | Breaches before the first scan after deployment | Absent. No backfill (P-5) |
| M-8 | Concurrent run skipped (§4.7) | The skipped call observes nothing |
| M-9 | Row state read during the scan (READ COMMITTED; each reader statement takes its own snapshot, milliseconds after `as_of`) | An item resolved mid-scan may or may not be recorded; anything recorded was overdue at `as_of` against the row state its reader saw |

**Consequences stated wherever observations are shown:** counts are a lower bound; absence is not evidence of compliance; lag = `observed_at − due_at` is detection delay. The readback reports scan times and the **largest gap between consecutive complete scans** in the window, which bounds how short a breach can be and still be missed.

## 4. Design

### 4.1 Tables (`private`, RLS enabled, no grants to `anon`, `authenticated` or `service_role`)

`private.operations_sla_detector_runs` — one row per executed call:

| Column | Type / rule |
|---|---|
| `id` | `uuid` primary key: the caller's run key |
| `actor` | `uuid not null` (`auth.uid()`) |
| `as_of` | `timestamptz not null`: transaction `now()`, the instant every reader evaluated |
| `finished_at` | `timestamptz not null`: `clock_timestamp()` at the end |
| `outcome` | `complete`, `partial`, `failed`, `skipped` |
| `applied_limit` | `integer`, 1–500 |
| `rules` | `jsonb`: per rule `{status: ok\|error\|skipped, sqlstate, listed, inserted, already_recorded, over_limit}`; SQLSTATE only, never an error message or row content |

`private.operations_sla_observations` — one row per first sighting of a breach episode:

| Column | Type / rule |
|---|---|
| `id` | `bigint` identity primary key |
| `rule_id` | `text`, check in the OD-1 set only (`T-3`, `T-4`, `T-5`, `T-8`, `T-10` if approved as recommended) |
| `queue`, `item_kind` | `text`, checked lists (§2) |
| `subject_id` | `uuid not null` (§2 "Subject"); **no foreign key**, so no business delete is blocked or cascaded |
| `request_id` | `uuid` (nullable; the related request or job) |
| `due_at`, `observed_at` | `timestamptz not null`; check `observed_at >= due_at` |
| `run_id` | `uuid not null` references the runs table |
| unique | `(rule_id, item_kind, subject_id, due_at)` |

Both tables: a `before update or delete` guard trigger raises (append-only, as `email_provider_events_guard`); no `truncate` grant. No personal data, free text, amounts or names are stored. Lag is computed on read.

### 4.2 Detector: `public.admin_detect_sla_breaches(p_run_key uuid, p_limit integer default 200) returns jsonb`

`SECURITY DEFINER`, `search_path = ''`, volatile. Steps:

1. Refuse unless `auth.uid()` holds `admin` (`42501`); refuse a null key (`22023`).
2. **Replay:** if a run with `p_run_key` exists: same actor → return its stored summary with `replayed: true`; another actor → `22023` "Run key reused".
3. **Concurrency:** `pg_try_advisory_xact_lock(hashtextextended('private.operations_sla_detector', 0))`. If not acquired: insert the run with `outcome = 'skipped'` (`on conflict (id) do nothing`, which waits for and then yields to a concurrent insert of the same key) and return it. Precedent: `private.run_promotion_release_sweep`.
4. `as_of := now()`; clamp `p_limit` to 1–500.
5. For each rule, inside its own `begin … exception when others` block (a savepoint): call the reader(s) of §2, keep only qualifying items, order by `due_at, subject_id`, insert up to the limit with `on conflict do nothing`; record `listed`, `inserted`, `already_recorded`, `over_limit`. On error: record `error` and the SQLSTATE; that rule's inserts roll back; continue.
6. Insert the run record (`complete`, `partial` or `failed`) and return `{run_key, as_of, finished_at, outcome, rules, totals, replayed: false}`.

It writes nothing else. It sends no notice, sets no flag, changes no job, ticket, quote, payment or offer, and does not call `run_lifecycle_batch`, `expire_stale_matches` or any command.

### 4.3 Readback (admin-only, `42501` otherwise; `stable`)

| Function | Returns |
|---|---|
| `public.admin_sla_observations(p_rule text default null, p_before_id bigint default null, p_limit integer default 50)` | Observations newest first (keyset on `id`), with `lag_seconds`; limit clamped 1–200 |
| `public.admin_sla_detector_runs(p_limit integer default 20)` | Recent runs with outcome, per-rule counts, `as_of`, `finished_at`, actor name |
| `public.admin_sla_detector_run(p_run_key uuid)` | One run, or `null`: how an unknown outcome is resolved (§4.10) |
| `public.admin_sla_observation_summary(p_from timestamptz, p_to timestamptz)` | Per rule: observation count, min/max lag; complete, partial, failed and skipped run counts; first and last complete `as_of`; largest gap between consecutive complete runs; the fixed statement that counts are a lower bound |

Not in `supabase_realtime`; nothing forwarded to PostHog (AC-1 D-1); no `anon`, `service_role` or `public` execute.

### 4.4 Permissions

Execute on the four readback functions and the detector: `authenticated` only, admin checked inside. Tables: owner only. Operator = an account with the `admin` role, the same population that can read every queue today (R0: Josh only, DEC-2026-025). A scheduler or `service_role` path is not granted (OD-2).

### 4.5 Idempotency and episodes

- **Same run key:** replays the stored result; never scans twice.
- **Same episode, later scans:** same key `(rule, kind, subject, due_at)`, so no new row; counted as `already_recorded`. Only the first sighting is stored (D-6): the ledger cannot say how long a breach lasted.
- **Reopened T-8 ticket:** target and first reply are unchanged on reopen (7.5D R-7), so an unanswered reopened ticket is the same episode: no new row.
- **Repeated episodes:** a new subject (new proposal, quote revision, attempt, terms) or a new `due_at` (T-3 `since` reset by a decline, expiry or return; T-5 new completion notice) is a new row.

### 4.6 Resolved and deleted sources

Rows are never updated when the source resolves, changes or is deleted (admins may delete service requests). The readback shows stored fields only and does not claim the item is still open; a link to a deleted record shows that page's own not-found state. An observation's identifiers may outlive the source record; whether that is acceptable for deletion requests is part of P-2.

### 4.7 Concurrency

One scan at a time through the transaction-scoped try-lock; a concurrent call is recorded as `skipped` rather than waiting. The unique key with `on conflict do nothing` is a second guard against duplicates; the run key's primary key stops a duplicate run record.

### 4.8 Bounded scan

Per rule, at most `p_limit` inserts (default 200, maximum 500), oldest `due_at` first; `over_limit` reports the remainder truthfully. Each reader is called once per scan, the same cost as opening the four queue pages. No loop over the clock, no retry.

### 4.9 Partial failures

A rule that raises records `error` with its SQLSTATE; other rules still record; outcome `partial` (some) or `failed` (all). The run record is always written for an executed call, so a failure is audited. If the call itself fails (timeout, lost connection before commit), nothing is written and no run exists for the key.

### 4.10 Unknown outcomes (as 7.5E F-2)

| Client sees | Page says / does |
|---|---|
| Result, `replayed: false` | The run's outcome and counts |
| Result, `replayed: true` | The stored result; "This scan had already run" |
| `skipped` | "Another scan was running. Nothing was recorded." New key for a retry |
| Error with a definite refusal (`42501`, `22023`) | The refusal |
| No response, network error, timeout | **"We couldn't confirm whether the scan ran."** Reads `admin_sla_detector_run(key)`: a row settles it; `null` means it did not commit. A retry reuses the same key, so it cannot double-record. Nothing is inferred |
| Account changed while waiting | Discarded (`stale`), as 7.5E F-1 |

### 4.11 Separation from the lifecycle worker's completion escalation

The DEC-2026-006 escalation stays a T-5 business action inside `run_lifecycle_batch` (flag, event, admin and homeowner rows, run record; inactive without a scheduler). The detector does not read `lifecycle_worker_runs` or `needs_admin_review`, writes neither, and does not count an escalation as an observation. A T-5 observation is recorded whether or not the batch has run, and the batch escalates whether or not the detector has run (contract §6.1).

## 5. Exact files and functions (after approval; numbers re-derived from `main` at the time)

**7.5F-1 database** (one PR; owner-authorized hosted push before merge):

| File | Content |
|---|---|
| `supabase/migrations/20261203001000_phase7_sla_breach_observations.sql` | The two tables, guard trigger, `public.admin_detect_sla_breaches`, the four readback functions, grants. Additive; no existing function restated |
| `supabase/tests/131_sla_breach_observations.sql` | §6 groups B, R, M, A, S, U, E; rolled back; synthetic `example.invalid` users; 7.5C fixed-clock method |
| `scripts/sla-detector-concurrency.mjs` | Two real sessions (§6 C), following `scripts/*-concurrency.mjs` |
| `.github/workflows/ci.yml` | One step running the concurrency script (a CI change: needs approval with the slice) |
| Records | 7.5F implementation record, contract revision note, TRACEABILITY, HANDOFF |

**7.5F-2 operator page** (one PR; no migration):

| File | Content |
|---|---|
| `src/lib/slaObservations.ts` | Types; outcome mapping (§4.10); wording; lag formatting |
| `src/app/admin/sla-observations/page.tsx` | "Scan now" (new run key per click, reused on retry), recent runs, observations by rule, the summary with the lower-bound statement and largest gap; links to the existing queues for overdue-now work |
| `src/components/admin/AdminSidebar.tsx` | One entry beside Notifications |
| `tests/unit/sla-observations.test.ts`, `tests/e2e/admin-sla-observations.spec.ts` | §6 group P |

## 6. Tests (7.5F-1 SQL unless noted)

| Group | Assertions |
|---|---|
| **B boundaries** | Per rule at `due − 1 µs` (absent), `due` (present except T-8), `due + 1 µs` (present); recorded `due_at` equals the named source; `lag = observed_at − due_at`; observed set equals the reader's qualifying set at the same instant |
| **R replay / episodes** | Same key, same actor → stored result, `replayed: true`, no new rows; same key, other actor → `22023`; a second key over the same breaches → 0 inserted, all `already_recorded`; reopened T-8 → no new row; T-3 `since` reset → second row; new attempt / revision / terms → new row |
| **C concurrency** (script) | Two sessions, different keys, held lock → one `complete`, one `skipped`, no duplicate observation; two sessions, same key → one run row, the second returns the replay; result identical across 20 repetitions |
| **M missed between scans** | Scan before `due`; source resolves after `due`; scan again → **0 observations** (pins M-1); T-10 reclassified to `not_acceptable` → 0 (M-3); limit 1 with 2 items → 1 row and `over_limit 1`, next scan records the other with larger lag (M-5) |
| **A access refusal** | Detector and each readback refused for anon, homeowner, provider (`42501`); no `service_role` or `anon` execute; direct `select` on both tables refused for `authenticated`; update/delete refused by the guard |
| **S summary consistency** | Per run `listed = inserted + already_recorded + over_limit`; totals = sum of rules; `inserted` = rows with that `run_id`; summary counts = ledger counts; largest gap computed from complete runs only; partial run (a reader forced to raise inside the test transaction) → `partial`, SQLSTATE stored, other rules recorded |
| **U unchanged business state** | Before/after a scan: row count and content md5 of every `public`/`private` table except the two new ones; `notifications`, `job_events`, `support_ticket_events`, `lifecycle_worker_runs`, `net.http_request_queue`, `cron.job` unchanged; definition md5s of the five readers, `admin_operations_summary` and `run_lifecycle_batch` unchanged; money fingerprint unchanged |
| **E escalation separation** | SF-6 setup: T-5 observed with and without a prior `run_lifecycle_batch`; batch output, flag, event and rows identical with and without a prior scan |
| **P page** (unit, browser) | Each §4.10 outcome and its wording; unknown → run lookup, never inferred; stale on account change; observations never labelled "still overdue"; lower-bound statement present; non-admin refused |

Mutations (each must fail a named test): `<=` for T-8; T-10 without `+ 24h`; drop the unique key; key without `due_at`; replay without the actor check; lock removed; savepoint removed (a rule error aborts the run); a detector write to `notifications`; `service_role` granted; error message stored instead of SQLSTATE.

## 7. Acceptance criteria

1. Every §6 group passes; every listed mutation is caught; the unmutated control passes.
2. Clean replay of all migrations; full SQL suite, unit, lint, typecheck, secret scan and production build pass; money fingerprint and all pre-existing function definitions unchanged.
3. The detector observes exactly the reader's qualifying items for the five rules at one instant, and nothing else.
4. No business table, notification, event, HTTP request or cron job changes in any test.
5. The page states, wherever observations appear, that they are a lower bound and that overdue-now work is in the queues.
6. Records name OD-1/OD-2 approvals, the hosted steps performed (or not) and their evidence, and keep HQ-5 open until a hosted staged breach is observed under its own authorization.

## 8. Rollout and rollback

**Rollout.** (1) Owner approves OD-1/OD-2 (and P-1, P-2). (2) 7.5F-1: Codex review → owner-authorized `supabase db push --linked --dry-run` listing only the new migration → push → read-only readback (tables empty, ACLs, definition md5s, reader md5s unchanged, money fingerprint) → merge (deploys; no client calls it) → deployment READY readback. (3) 7.5F-2: Codex review → merge. (4) The **first hosted scan** writes production rows (only the two new tables) and is the owner's action, separately authorized. No scheduler at any step.

**Rollback.** Application: `vercel promote <previous dpl_id>`; the database objects are unused without the page. Database, forward only: a migration revoking execute on the detector stops new scans and keeps the ledger; dropping the objects needs the owner's decision about retained rows (P-2). No business data is written, so nothing needs repair.

## 9. Open items

**Policy choices for the owner (not decided here):**

| ID | Choice | Options (none approved) |
|---|---|---|
| P-1 | Dispute and dispute-appeal tickets in the T-8 reader | (a) record as T-8, as the queue does; (b) record as T-9; (c) exclude |
| P-2 | Retention of observations and runs under CFG-011 | 90 days (operational logs); 3 years (support); 7 years (financial / completed service); or keep until decided. Until decided: no deletion path is built |
| P-3 | Who may scan | Any admin (as queue access) or the project owner only (CFG-010) |
| P-4 | Show derived first-reply lateness (`first_response_at > response_due_at`) | Not in 7.5F (recommended scope); a later measure if wanted |
| P-5 | Backfill from source history | None (recommended: a backfill would be a derivation, not an observation) |
| P-6 | Expected manual scan cadence | None stated; coverage is whatever scans happen. A cadence is an operating practice the owner may set, not code |

**Design questions for Codex:**

| ID | Question | Proposed |
|---|---|---|
| D-1 | Call the public readers inside the detector, or extract private item functions | Call them: no restatement, one computation |
| D-2 | T-10 `due_at = since + 24h` computed in the detector, or restate the reader to expose it | Detector, with a parity test against the reader |
| D-3 | T-4 from `admin_quote_queue` `aged`, or `money_payment_exceptions` directly | `admin_quote_queue` (one `aged` predicate) |
| D-4 | Concurrent call: record `skipped`, or raise | Record (sweep precedent; audited) |
| D-5 | Per-rule savepoints, or all-or-nothing | Per rule |
| D-6 | First sighting only | Yes; no "last seen" updates |
| D-7 | Key includes `due_at`, so a moved timestamp makes a second row | Accept and report (M-6) |
| D-8 | `observed_at = as_of` (transaction start) | Yes; `finished_at` on the run |
| D-9 | Two PRs (database, page) | Yes |

**Reconciliation:** R-F1 remove #204's duplicate lines (§1.2) or leave them as history (default: leave). #203 Codex re-review and READY readback of `01a5dd1` and `846dd34`: open.

**Carried unchanged:** OD-3..OD-7, OD-5 external channel; AC-1 D-1, D-4, D-5, D-6; SD-1, SD-2; 7.5D F-1, O-1..O-3; every 7.3D gate; CFG-011; HQ-1..HQ-6. Phase 7 is not accepted.

## 10. Decision card — OD-1 and OD-2

| | OD-1: which approved rules are recorded as observations | OD-2: who runs the detector |
|---|---|---|
| **Recommended** | T-3 (`proposal_missing` 24 h, `proposal_review` 4 h, `quote_decision` 12 h), T-4 failure aging (24 h), T-5 (72 h), T-8 (one business day), T-10 (24 h) | An admin, by pressing "Scan now"; no scheduler |
| **Alternatives** | A subset; or none (defer 7.5F) | Scheduler under the DEC-2026-003 activation sequence (not proposed); or both later |
| **Decide with it** | P-1 (disputes under T-8 / T-9 / excluded); P-2 (retention) | P-3 (any admin or owner only) |
| **Approving authorizes** | Building 7.5F-1 and 7.5F-2 as specified, including the CI step | — |
| **Does not authorize** | New thresholds, notices, alerts, email, scheduler, state changes, backfill, hosted push, the first hosted scan, merge | same |
| **What it cannot give** | Complete breach history: a breach that starts and ends between scans is never recorded | — |

## 11. Validation of this PR

Documentation only: this file; a dated status line in the 7.5E record header; contract revision 6 (§6.1, §10, §12); one TRACEABILITY append to TRACE-159; a HANDOFF entry. `git diff --check`, relative-link existence and `npm run scan:secrets`: results in the PR body. No code, test, migration, workflow or configuration change; no hosted read or write.
