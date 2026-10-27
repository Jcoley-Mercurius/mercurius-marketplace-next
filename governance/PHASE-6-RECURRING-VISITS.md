# Phase 6.6 — recurring visits: identities, duplicate-safe creation, cadence and charge timing

**Slice:** 6.6 (PHASE-6-SCOPE): 6.6a / TRACE-123 (merged, PR #111) and 6.6b / TRACE-124 (§7). **Date:** 2026-10-25, 6.6b 2026-10-26/27 (America/New_York).
**Branch:** `claude/phase6-6-recurring-visits` from `main` `0138080`. **Status:** 6.6a merged (`61f0601`); 6.6b implemented for review on `claude/phase6-6b-recurring-cadence` (DEC-2026-049 items 1–4 and 9 approved 2026-10-26). 6.6 is **not** complete: charge timing (6.6c) and DEC-2026-049 items 5–8 are open.

## 1. Brief

### Outcome

Each recurring visit is a distinct, auditable service with its own appointment, provider acceptance, work and evidence, commercial identity and payment/payout state. Retrying or racing visit creation never duplicates a visit, offer, invoice or charge. Visits are created only on the plan's accepted terms; nothing is silently substituted.

### Governing requirements

| Source | Requirement |
|---|---|
| MPS §6.4 | Recurring work creates auditable occurrences rather than overwriting one request; only the assigned vendor or an admin starts/completes a job; invalid and duplicate transitions rejected |
| MPS §6.3 | Both parties see the same time and timezone; rescheduling preserves history |
| MPS §6.5 | Server-side commercial snapshots; idempotent payment operations; payout from an approved eligibility event |
| MPS §6.6 | The policy matrix covers recurring service |
| DEC-2026-010 | Separate jobs for recurring visits; a cancellation affects one visit; one completion photo per visit unless a category requires more |
| DEC-2026-007 | Provider acceptance schedules the service (applies to each visit's own offer) |
| DEC-2026-042 | Matching keeps the priced selection; recurring visits of a request with add-ons carry it |
| TRACE-059 | One commercial identity per visit; a plan (template) cannot be charged; subscription events fund nothing |
| CFG-006/007/008 | Cancellation/rescheduling per visit; provider cancellation rematch/refund; payout 48 h after homeowner-confirmed completion, holds on dispute |
| CFG-014 | No new service requests or checkout for a homeowner without admission |
| DEC-2026-048 | Prepaid plans reference 6.6 visit identities; implementation starts after this contract is merged |
| Roadmap Phase 6, PHASE-5-CLOSURE-READINESS | "Recurring visit generation and charge timing" needs an owner operating decision, then implementation |

### Dependencies

Phase 4 occurrence foundation (`20260904004000`), TRACE-059 identities (`20260905015000`), matching/acceptance (6.3), pricing revisions and add-ons (TRACE-112–116), 6.5 Eastern-time entry and `job_operations`. Downstream: 6.7 (per-visit evidence and homeowner confirmation), 6.9 (per-visit cancellation, rescheduling, provider withdrawal), prepaid plans (DEC-2026-048).

### Sub-slices

| Sub-slice | Scope | Gate |
|---|---|---|
| **6.6a (this)** | Accepted plan terms; visit identity from plan + Eastern date; operator-created visits on the plan terms only; append-only attempt history with blocked reasons; plan never worked on itself; legacy shadow visits stopped; readback and UI for all roles | Codex review |
| **6.6b (§7)** | Cadence: recorded anchor, proposed visits (horizon, capacity, lead time, month-end, explicit DST choice), skipped/replaced dates, pause/resume/stop future visits | DEC-2026-049 items 1–4, 9 (approved 2026-10-26); Codex review |
| 6.6c | Charge timing: when each visit's snapshot/invoice is issued and when payment is due; payment-due queue; no automatic charge | DEC-2026-049 item 5; finance review |
| 6.6d | Scheduled generation (Cron) | Scheduler activation approval (Phase 7/8) |
| Prepaid | DEC-2026-048 | After 6.6a is merged; own finance review |

## 2. Characterization (before this slice)

Credit where due: the Phase 4 foundation already made each visit a separate `service_requests` row (`recurrence_parent_id`, `occurrence_key`, unique per plan), offered each visit separately and kept cancellation per visit; TRACE-059 bound each visit to its own obligation and snapshot and refuses a snapshot on the plan; TRACE-116 carried priced add-ons into visits and refuses a changed revision for them.

| # | Finding | Effect |
|---|---|---|
| C1 | `create_service_occurrence` took a caller-chosen key | Two keys for the same intended date created two visits; retries were safe only with the same key |
| C2 | It raised "Not available yet" when no provider at all was eligible, and recorded nothing | No failure history or operator recovery; a raise rolled back silently |
| C3 | It checked `find_eligible_packages_core` (any provider) and then offered whoever ranked first | With the plan provider ineligible, the visit went to `awaiting_consent`; with no recorded plan provider, any provider could be offered the visit |
| C4 | A visit without add-ons was offered and priced from the provider's **current** package and tier | A price or package change after acceptance flowed silently into new visits |
| C5 | No checks on the plan's status, the homeowner's admission, the property, a promotion or quote pricing; no future-time or Eastern wall-time check; an occurrence could itself be used as a template | Visits for cancelled plans, revoked homeowners, moved properties or nested "plans" |
| C6 | The plan request itself could be started and completed like a one-time job | Work and evidence recorded on something that can never be paid |
| C7 | Legacy `generate_recurring_visits` / `top_up_recurring_visits` triggers inserted three `job_visits` rows (weekly/monthly only) when any recurring request — including each visit — was scheduled; vendors could update them | A second, unpaid, unaccepted "visit" model; nothing in the app reads `job_visits` |
| C8 | The admin "new visit" option was offered on any recurring request, including a visit | Visits of visits |
| C9 | `admin_record_appointment` (6.5) refuses all recurring requests because commercial identities bind `scheduled_start_at` | Intended; preserved |

**Cadences actually supported end to end before this slice: none.** Submission, matching and acceptance accepted weekly, every two weeks (`bi-monthly`), monthly, every two months and quarterly, but nothing produced payable, accepted visits except a manual admin call; the legacy generator's `job_visits` rows (weekly and monthly only) have no acceptance, evidence or payment identity. A cadence in the price editor is a priced level, not a functioning recurrence.

**After 6.6a:** for fixed-price plans of all five cadences, operations adds each visit; each visit is accepted, worked and (through the existing finance review) invoiced separately. No cadence is generated automatically, and quote-priced plans and plans with a promotion are refused until decided.

Hosted read-only (2026-10-25, aggregates only): 11 service requests; 3 recurring (all monthly, all cancelled); 0 occurrences, 0 `job_visits`, 0 recurring identities. Nothing to backfill.

## 3. What is implemented (6.6a)

Migration `20261026001000_phase6_recurring_visits.sql`:

- `private.recurring_series_terms` (append-only): recorded by an `AFTER UPDATE OF status` trigger when the plan's provider accepts it (the accepted `job_match_attempts` row): provider, package, price level, package revision hash, visit price and total (with add-ons), priced add-on selection, property, answers.
- `private.recurring_visit_generations` (append-only): every attempt with actor, reason, Eastern wall time and instant, visit identity, outcome `created` / `existing` / `blocked`, block code; unique per plan and operation key; one `created` per visit identity.
- `private.recurring_visit_key(plan, Eastern date)`: deterministic visit identity, stored in `occurrence_key` (existing unique index), so one plan has at most one visit per Eastern calendar date.
- `admin_create_recurring_visit(_series_id, _operation_key, _starts_at, _local_start, _reason)`: admin only; plan lock; replay (same key and intent returns the record; different time, reason or actor refused); input errors raise and record nothing (not a plan, Eastern wall-time mismatch incl. DST gaps, seconds, past, missing reason). Business conditions are **recorded and returned**, not raised: `visit_date_taken`, `series_not_active`, `terms_missing`, `quote_terms`, `promotion_decision`, `homeowner_not_admitted`, `terms_changed` (revision, tier price, package, level, cadence, property, service or answers differ from the accepted terms), `provider_ineligible` (the plan provider's exact package/level is not eligible). A created visit copies the plan, carries the accepted add-on selection, is offered only to the plan provider's package and level (4-hour exclusive offer), and is refused as `terms_changed` if the offer's price differs. In-app notice to the homeowner once per created visit; the provider's offer notice is the existing one. No invoice, obligation, checkout, charge or scheduler effect.
- `recurring_series(_id)`: plan or visit id; homeowner, current plan provider and admin only (others, missing and anonymous refused alike); terms, visits (own status, offer outcome, provider/homeowner completion, payment `none`/`awaiting_payment`/`paid` hidden from the provider), history (keys only to their actor).
- Guard trigger: a plan never enters `in_progress` … `reviewed` ("Work is recorded on each recurring visit, not on the plan").
- Legacy `job_visits` triggers dropped (rows and functions kept).
- `create_service_occurrence` restated to refuse (same signature/grants).

UI: `RecurringVisitsPanel` on the admin request dialog (terms, visits, "Add a visit" in Eastern Time with reason, visit history with blocked reasons), homeowner dialog and vendor job details (read-only; no payment for the provider). Admin "Change Status" hides work statuses for a plan; the JobOperations "new visit" option is removed; the vendor plan card has no "Start job" and says "Recurring plan · each visit is offered and started separately"; the vendor offer confirmation says each visit is offered separately at this price; a visit's dialog says its acceptance, work and payment are its own.

Decisions made in implementation (for review, not policy): one visit per plan per Eastern date (a cancelled visit keeps its date); a blocked attempt is replayed as blocked for its key — recovery is a new attempt; terms are re-recorded only by a new acceptance of the plan (e.g. after a provider withdrawal and rematch); a promotion on a plan and quote-priced plans block visits pending DEC-2026-049 items 6–7.

## 4. Unresolved operating decisions

Recorded as **DEC-2026-049**. Items 1–4 and 9 were approved by the owner on 2026-10-26 with clarifications and are implemented by 6.6b (§7). Items 5–8 remain **proposed** and unimplemented.

1. Cadence anchoring, 2. generation horizon, 3. month-end and DST rules, 4. missed visits and pause/resume/end, 5. when each visit becomes payable, 6. a price change during a plan, 7. quote-priced plans and promotions on plans, 8. per-visit provider replacement, 9. one visit per Eastern date and retiring `job_visits` (confirm the implementation choices).

Charge timing today, unchanged: a visit is payable only after two finance actors publish its snapshot and the homeowner opens checkout; online payment is not activated (`MERCURIUS_MONEY_MODE`), there is no stored card, no automatic charge and no payment deadline. Payout stays 48 hours after that visit's homeowner-confirmed completion with dispute holds (CFG-008); ordinary 15% and promotional 7.5% rules are untouched; the promotions gate stays closed.

Known gap for 6.6c (tracked, unchanged by 6.6b): after a visit is created, `money_source` still prices its snapshot from the tier's current price; a later in-place price correction (DEC-2026-034) before the snapshot would be visible only to the two finance reviewers. A revision (new package row) blocks the snapshot honestly.

Tracked separately, not resolved here: quote tax confirmation (DEC-2026-015 §4, 6.4) and appointment confirmation semantics (MPS E1, 6.5).

## 5. Evidence (2026-10-25, this branch; synthetic data only)

Run now:

| Check | Result |
|---|---|
| Clean replay of 200 migrations on the isolated stack (ports 5552x) | Pass |
| SQL `095_phase6_recurring_visits.sql` (new) | 99/99 |
| SQL 010 / 087 / 028 / 092 with the migration | 10/10 / 108/108 / 20/20 / 68/68 |
| Full SQL suite after the clean replay | 86 files, 4,939 assertions, PASS |
| `scripts/recurring-visit-concurrency.mjs` (new; separate connections; added to CI) | PASS on 3 consecutive runs; fixtures removed |
| `scripts/pricing-concurrency.mjs`, `scripts/appointment-concurrency.mjs` | PASS |
| Unit `recurring-visits` under TZ America/New_York, America/Los_Angeles, UTC, Pacific/Auckland | 9/9 each |
| Typecheck, lint of changed files | Clean |
| Regenerated `database.types.ts` | Additive only (two functions) |

| Full unit suite | 43 files, 518/518 |
| Lint (`eslint .`), secret scan, `git diff --check` (including new files) | Clean |
| Synthetic build (fixture URL, no env file, 1 worker) | Pass, 78 pages |
| Browser `recurring-visits.spec.ts` (new: Pacific device, 320/1440, blocked outcome, lost response and key reuse, plan statuses, homeowner, provider, load/permission errors, axe) | 8/8 in 59 s on a quiet machine. Two earlier runs during a WSL restart (load average ~20) timed out on page loads and axe; one real test error was found and fixed (the count was read while the failed-save confirmation was still open) |
| Browser regression `appointments`, `phase4`, `matching`, `quote-proposals`, `homeowner`, `portals`, `promotion-selection` | 70/73; the 3 failures (all `quote-proposals`, timeouts and a closed browser) moved between runs and the 4 affected tests passed 5/5 run alone |

For the quiet browser runs the main local stack's analytics container was stopped and started again afterwards; no data was touched. The full non-visual browser suite was not run.

SQL 095 covers: terms recorded only at acceptance through the real submit → offer → `vendor_accept_job` path, with revision, add-on total and no terms for a one-time request; grants and no direct table access; homeowner and provider refused; invalid input (one-time, missing, Pacific-shifted instant, seconds, past, blank reason, spring-forward 2:30 under both offsets) records nothing; creation fields (plan, date identity, Eastern time, plan provider, package, level, add-on total and priced selection); one exclusive offer on the plan terms; replay; same key with another time, reason or operator refused; another key reaching the existing visit; a second time on the same date blocked; one visit, one offer, three recorded attempts; separate identities per week; one homeowner notice per created visit with the Eastern time and reason; 9:00 AM Eastern across spring forward (167 h apart, 13:00 UTC); fall-back 1:30 EDT created and 1:30 EST blocked as the same date; month ends (Jan 31, Feb 28, Mar 31, Apr 30) kept as entered; per-visit acceptance and start; the plan cannot be started even by a direct write; no `job_visits`, obligations, invoices or checkout attempts from creation; visit 2's own reviewed snapshot binding plan, visit identity and appointment with the add-on in its source, visit 1 without one, the plan still uncharged; blocked `terms_changed` (tier price, add-on revision, property), `provider_ineligible`, `homeowner_not_admitted`, `promotion_decision`, `series_not_active`, `terms_missing`, `quote_terms`, a visit used as a plan — with no visit, offer, notice or offer to the cheaper provider; blocked replay and recovery with a new key; append-only history and terms; readback terms, per-visit status and payment for the homeowner, none for the provider, a visit resolving to its plan, other homeowner/provider/missing/one-time/anonymous refused, history order and own keys only; the retired command.

Concurrency: 8 parallel identical calls → 1 visit, 1 offer, 1 attempt; 5 operators with different keys for one visit → 1 created + 4 existing naming it; 5 times on one date → 1 visit + 4 `visit_date_taken`; 5 dates at once → 5 visits, one offer each; no obligations; 16 attempts recorded.

Historical evidence reused, not re-run: TRACE-059 money identity design (SQL 028 is re-run above).

Not performed: hosted migration, CI (pending push), `@visual`, human screen reader, real zoom, real devices in other timezones, notification delivery (none exists), any payment, payout or scheduler activity.

## 6. Migration and rollback

Additive: two private tables, two trigger functions and triggers on `service_requests`, one key function, two public functions; `create_service_occurrence` restated to refuse; the two legacy `job_visits` triggers dropped (not additive; their functions and rows remain, hosted has 0 rows). Hosted has 0 accepted recurring plans, so the terms table starts empty and nothing is backfilled; a plan accepted before this migration would block as `terms_missing` (none exists).

Order under DEC-2026-037: dry run, push with the owner's authorization, then merge. Done 2026-10-26 at the owner's instruction: the dry run listed only this file; after the push hosted history ends at `20261026001000`, `admin_create_recurring_visit` is signed-in only (not anon), `recurring_series` not anon, the private tables have no client access, both new triggers exist, both legacy `job_visits` triggers are gone, `create_service_occurrence` refuses, 0 terms, 0 attempts, 0 `job_visits`; the dry run reports up to date. Between push and deploy the live admin "new visit" option is refused with a clear message (the old UI has no replacement until the deploy); nothing else in the live client changes. Rollback: promote the previous deployment; the database stays forward (restoring the old command would reopen C1–C5). Do not drop the history tables once rows exist. The promotion money fingerprint (`scripts/promotion-money-fingerprint.sql`) changes because `create_service_occurrence` is listed; the list now also includes `admin_create_recurring_visit` (see PRICING-FINANCE-REVIEW §10).

## 7. Phase 6.6b — cadence, proposals and plan controls (TRACE-124)

**Branch:** `claude/phase6-6b-recurring-cadence` from `main` `61f0601` (PR #111 merge; PR #111 checks and main CI run 40435258272 green). **Governing:** DEC-2026-049 items 1–4 and 9 (owner decision 2026-10-26), MPS §6.4, DEC-2026-010, TRACE-123. **Out of scope:** charge timing (6.6c), Cron/scheduled generation, prepaid bundles, quote/promotion plans, replacement-provider policy, 6.9 cancellation economics, homeowner self-service pause, notifications for lifecycle actions.

### Implemented

Migration `20261026002000_phase6_recurring_cadence.sql` (additive):

- `private.recurring_series_anchors`: Eastern instant and wall time, **basis** for the agreed time, reason, operator, the anchor it replaces; append-only, one linear chain (`unique nulls not distinct (series_id, replaces_anchor_id)`).
- `private.recurring_series_lifecycle`: pause / resume / stop with from/to state and reason; append-only, one linear chain; state is `active` until a row says otherwise. The plan request's `status` is never changed.
- `private.recurring_cadence_resolutions`: a cadence date `skipped`, or `replaced` by an off-cadence visit of the same plan, recorded under the anchor in force; one decision per (anchor, date); one visit per decision (unique index).
- `private.recurring_visit_generations` gains `source` (`manual` / `cadence`), `anchor_id`, `cadence_date`, and block codes `series_paused`, `series_ended`. Hosted has 0 rows, so the defaults backfill nothing.
- Arithmetic: `recurring_cadence_date` (weeks by calendar days; months always from the anchor via `date + n months`, which clamps to month end), `recurring_cadence_index`, `eastern_instants` (0, 1 or 2 instants for a wall time).
- `private.recurring_cadence_preview(plan, at)`: a read. Proposals = cadence dates from today through today + 60 Eastern days, resolved instant ≥ `at` + 24 h, not handled (a visit on the date in any status, or a skip/replacement under the current anchor), capped so future non-cancelled visits (off-cadence included) + proposals ≤ 2. `next` is the first such date regardless of the horizon, with `opens_on` = date − 60. DST: `kind` `ok` / `ambiguous` (two choices) / `nonexistent` (none). Unavailable when ended, paused, no anchor, or the plan is not scheduled with a provider.
- `private.create_recurring_visit_core`: the 6.6a command body unchanged except that source/anchor/date are recorded and part of a replay's intent, and a paused/stopped plan is a **recorded** refusal checked after the date-identity check and before every other condition. `admin_create_recurring_visit` (same signature and grants) is now a wrapper with `source = 'manual'`, so direct manual RPC calls obey pause/stop.
- `admin_create_cadence_visit(plan, key, anchor, date, starts_at, local_start, reason)`: admin; same plan lock; replay first; the anchor must belong to the plan; while active, the anchor must be current (`40001`), the date must still be among the proposals recomputed under the lock (`40001` "no longer current"), the wall time must be the anchor's except on a spring-forward date (operator chooses any existing time that day), and the instant ≥ now + 24 h; then the core (eligibility, terms, identity, offer and notice as in 6.6a).
- `admin_record_recurring_anchor(plan, key, expected_anchor, starts_at, local_start, basis, reason)`: stale read `40001`; ended plan refused; same anchor refused; creates nothing.
- `admin_resolve_cadence_date(plan, key, anchor, date, 'skipped'|'replaced', visit, reason)`: stale anchor `40001`; must be a cadence date; refused when the date has a visit or a decision under the current anchor, when the visit is not this plan's, is cancelled, already replaces a date, or is itself on a cadence date. Skips are refused after stopping; links are allowed (they reconcile existing visits).
- `admin_set_recurring_plan_state(plan, key, action, expected_state, reason)`: `pause` (active→paused), `resume` (paused→active), `stop` (active/paused→ended, final); stale `40001`; returns how many visits stay in place.
- `recurring_series` restated: `plan_state` and `anchor` for every participant; operations also get `anchor_id`, `cadence` (preview as of now), `anchors` (with basis), `lifecycle`, `resolutions` (with `current_anchor`), each visit's `on_cadence`/`replaces`, and each attempt's `source`/`cadence_date`. Homeowner and provider see no basis, history or proposals.

UI: `RecurringCadenceControls` (operations) inside `RecurringVisitsPanel`: plan state with **Pause plan / Resume plan / Stop future visits** (reason required; the stop confirmation says it is final and that existing visits and open offers remain in place and need individual handling, with the count; afterwards "Visits still in place" lists them); **Proposed visits** with the horizon/capacity explanation, per-proposal "Review proposed visit" and "Skip this date", an EDT/EST choice on a fall-back date and a time entry on a spring-forward date (creation disabled until chosen); the empty state names the next cadence date and when it can be proposed; **Record the agreed first visit / Change the cadence anchor** with "How this time was agreed" and the note that it confirms no appointment; **Off-cadence visits** with a link to the open cadence date before or after; **Schedule history**. The manual form is now "Add a visit manually" (off-cadence or make-up; horizon and 24-hour limits don't apply) and is hidden while paused or stopped. Every participant sees "Active / Paused · no new visits / Future visits stopped · <cadence>, counted from <anchor>".

### Decisions made in implementation (for review, not policy)

- **Off-cadence interaction:** an off-cadence visit counts toward the two-visit capacity but handles no cadence date until it is explicitly linked; until then the nearby cadence date can still be proposed (or skipped).
- **Re-anchoring:** skips and links are scoped to the anchor they were recorded under. They stay listed (marked "under an earlier anchor") and do not handle the new anchor's dates; a date holding a visit stays handled under any anchor (identity is plan + date).
- **Proposal currency:** creation from a proposal recomputes the proposals under the plan lock, so capacity and horizon are enforced on the server and a second operator racing for the same or a surplus date gets "no longer current" (nothing recorded) rather than an `existing`/`visit_date_taken` record.
- **Lead time** for a spring-forward proposal is measured from the time after the gap; for a fall-back proposal from the earlier instant. Creation rechecks the chosen instant.
- **Lifecycle refusals** (stale, already in that state, stopped) raise and record nothing; creation refusals while paused/stopped are recorded (owner instruction). Lifecycle, anchor and skip/link actions send no notification; in-app notices remain one per created visit.
- Anchors may be in the past (e.g. recorded after a first manual visit); proposals are always future.

### Money and side effects

Proposals and previews are reads. Anchors, skips, links and lifecycle actions write only their history and a `job_events` entry. Created visits use the 6.6a path unchanged (offer to the plan provider's package and level; no obligation, snapshot, invoice or checkout). SQL 096 compares the row count of every `public.money_*` table and `invoices` before and after all non-creation commands and proposal creations; the concurrency script checks `money_obligations`. Recurring payments are not activated. The money fingerprint list gains `private.create_recurring_visit_core` and `public.admin_create_cadence_visit` (42 functions; see PRICING-FINANCE-REVIEW §10). The `money_source` current-tier-price gap (§4) is unchanged and stays with 6.6c.

### Evidence (2026-10-26/27, this branch; synthetic data only)

| Check | Result |
|---|---|
| Clean replay of 201 migrations on the isolated stack (ports 5552x) | Pass, history ends at `20261026002000` |
| SQL `096_phase6_recurring_cadence.sql` (new) | 157/157 |
| SQL 095 (one expectation updated: the replay response gains `source` and `cadence_date`), 010, 087, 028, 092 | 99/99, 10/10, 108/108, 20/20, 68/68 |
| Full SQL suite after the clean replay | 87 files, 5,096 assertions, PASS |
| `scripts/recurring-cadence-concurrency.mjs` (new; added to CI) | 3/3 on the main local stack; on the isolated stack the first run failed on a wrong test assumption (a proposal behind manual visits that filled the capacity is correctly refused "no longer current"); after accepting that outcome for proposals only, 5/5 |
| `scripts/recurring-visit-concurrency.mjs` (6.6a) against the new core | PASS (both stacks) |
| Money fingerprint (`scripts/promotion-money-fingerprint.sql`) after the clean replay | `42 | 1fe362b252a565ffe58d3f0ad36e1ee4` |
| Unit `recurring-cadence` (new) + `recurring-visits` under TZ America/New_York, America/Los_Angeles, UTC, Pacific/Auckland | 19/19 each |
| Full unit suite | 528/528 (an earlier run during the SQL suite, load ~20, reported 5 failures in 3 files that did not reproduce; their names were not captured) |
| Typecheck, `eslint .`, secret scan, `git diff --check` (new files included) | Clean |
| Regenerated `database.types.ts` | Additive only (four functions) |
| Synthetic build (fixture URL, explicit public env, 1 worker) | Pass |
| Browser `recurring-visits.spec.ts` (6.6a tests scoped to the "Visit time" field; 4 new: fall-back EDT/EST choice on a proposal from a Pacific device at 320px, anchor with basis + empty-horizon message + replacement link, pause then stop with visits in place, homeowner paused view; axe in each) | 12/12 (one selector fix after the first run: several empty confirm `status` regions) |
| Browser regression `appointments`, `phase4`, `matching`, `quote-proposals`, `homeowner`, `portals`, `promotion-selection` | 73/73 |

SQL 096 covers: cadence dates for all five cadences, month-end and leap clamping (31 Jan → 28/29 Feb → 31 Mar; 29 Feb 2028 quarterly), day-of-month weekends kept; cadence index; spring-forward (no instant) and fall-back (two) times; proposals at fixed instants — anchor first, two at most, horizon end today + 60, exactly-24-hours included and 24 h + 1 min excluded, cancelled visit handles its date without using capacity, off-cadence visit uses capacity, two future visits → none with `next` still shown, skipped date, re-anchor, paused/stopped/no-anchor/not-active, no backfill after resume, resume-day time under 24 h excluded, quarterly empty state with `opens_on` and the inclusive boundary, every two weeks/months, monthly, leap year, DST kinds and 9:00 AM across spring forward; grants (anon refused, private core and preview unreachable, no table access); homeowner/provider refused on every command; anchor validation (basis, reason, device-shifted instant, missing time, skipped DST time), recording, replay, key reuse, stale first anchor; readback per role; proposal creation through the 6.6a path (source, anchor, date, identity, single offer to the plan provider at the accepted price, one notice), replay, key reuse across paths, wrong time/date, beyond capacity, off-cadence date, another plan's anchor, 24-hour recheck; `terms_changed` and `homeowner_not_admitted` recorded on the cadence path and recovery; manual visits beyond 60 days and 2 hours away; skip/replace rules and conflicts with the linked visit's row unchanged; re-anchor chain, stale re-anchor, same anchor, stale proposal, earlier decisions listed and not applied; pause/resume/stop with replay, key reuse, stale and repeated commands, recorded `series_paused`/`series_ended` on manual and cadence paths, existing visit and offer rows unchanged, plan status unchanged, no lifecycle notices, stopped is final, anchor/skip refused after stop; resume of a cancelled plan still `series_not_active`; append-only tables and an unforkable anchor chain; no `job_visits`; no new row in any `money_*` table or `invoices`.

Concurrency: 2 proposals + 6 manual visits racing a pause (and 6 manual visits racing a stop): every created visit's transaction held the plan lock before the pause/stop, every recorded refusal after (xmin order), no visit after; 5 re-anchors from one read → 1, the rest stale; proposals racing a re-anchor are created before it or refused stale; 5 links/skips racing for 2 visits and 2 dates → at most one decision per visit and per date; 5 pauses from one read → 1; one resume key ×8 → one record; one offer per visit; no obligation.

Not performed: hosted migration (needs owner authorization), CI (pending push), full non-visual browser suite, `@visual`, human screen reader, real devices, notification delivery, any payment, payout, refund or scheduler activity.

### Migration, deployment and rollback

Additive: three private tables, three nullable/defaulted columns and a widened check on `recurring_visit_generations` (hosted has 0 rows), private functions, four new public commands, `admin_create_recurring_visit` and `recurring_series` restated with unchanged signatures and grants. Order under DEC-2026-037, with the owner's authorization: `supabase db push --linked --dry-run` (expect only `20261026002000`), push, read back (tables without client access, commands not executable by anon, `admin_create_recurring_visit` delegating to the core, fingerprint `42 | 1fe362b…`), then merge. The deployed 6.6a client keeps working on the new schema: its readback ignores the added fields and its manual command is unchanged except for pause/stop, which no one can set before the new client deploys. Rollback: promote the previous deployment; keep the database forward (the 6.6a client is compatible). Do not drop the history tables once rows exist.
