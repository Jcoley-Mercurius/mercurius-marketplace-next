# Phase 7.5C — Local staged-failure characterization (TRACE-159, SF-1..SF-12)

**Status:** TESTS FOR REVIEW (Codex). Not merged. Tests and documentation only: no migration, no application change, no hosted query, no email, no scheduler, no booking, payment or policy change.
**Characterization, not acceptance.** These tests pin current behavior, including missing alerts and a known defect. A pass does not show that the Phase 7 gate ("staged failures and SLA breaches create the correct alert, queue item, audit event, and user communication") is met (contract §7.1, RV-4).
**Base:** `main` `126c85f` (#197, 7.5B, merged 2026-11-23 18:38:01 UTC), fetched before work. No 7.5C branch or PR existed. Branch `claude/phase7-5c-staged-failure-characterization`, in its own worktree.
**Authority:** the owner's Phase 7.5C instruction (2026-11-23 ET). [Operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) (OQ-1 revision 2) §7.1, with Codex's RV-1 (SF-6b run records) and RV-4 (characterization only); §5.3 DF-1, DF-3; §9 CD-1. [7.5B record](PHASE-7-OPERATIONS-SUMMARY-TRUTH-7-5B.md) (SF-12 expects `null`).

## What this slice does not do

No migration and no change to any database function: every expectation is today's behavior. No application, CI, configuration or policy change. No hosted Supabase, Vercel, Stripe, Resend or PostHog call. Does not touch open PR #198 (pilot commission); see §6.

## 1. What changed

| File | Change |
|---|---|
| `supabase/tests/128_operations_staged_failures.sql` | New. SF-1..SF-12, 147 assertions, one rolled-back transaction |
| `governance/PHASE-7-OPERATIONS-STAGED-FAILURES-7-5C.md` | This record |
| `governance/PHASE-7-OPERATIONS-QUEUES-CONTRACT.md` | §7.1 coverage note and §12 revision 3 (dated; no expectation rewritten) |
| `governance/PHASE-7-OPERATIONS-SUMMARY-TRUTH-7-5B.md` | Dated merge-status note (§8) |
| `governance/TRACEABILITY.md`, `docs/agent/HANDOFF.md` | TRACE-159 status; handoff entry |

**File number.** `128` is the next number unused on `main` (`127_operations_summary_truth.sql` is the latest). Open PR #198 adds `127_pilot_standard_commission.sql`, which already shares the `127` prefix with `main`'s file; it does not use `128`. Not changed here (§6).

## 2. Method

- **Real functions.** Every reader is the deployed one (`admin_quote_queue`, `admin_recurring_payment_queue`, `admin_fulfillment_queue`, `admin_offer_terms_queue`, `admin_support_queue`, `owner_email_overview`, `money_finance_reconciliation`, `admin_operations_summary`). Every failure step uses its real producer where one exists: `run_lifecycle_batch`, `expire_stale_matches`, `private.create_job_offer_internal` + `vendor_accept_job`, `vendor_propose_quote`, `admin_send_itemized_quote`, the Stripe webhook pair `money_receive_event` → `money_process_event` (as `supabase/functions/stripe-webhook` calls them), `money_flag_checkout`, `open_support_ticket`, `post_support_message`, `admin_update_support_ticket`, `owner_email_claim`.
- **Direct preconditions.** Written as the owner where no single command reaches the state cheaply, as SQL 003, 090 and 127 do: the SF-3/SF-4 obligation, snapshot and checkout attempt; the SF-5 recurring series (SQL 097 drives the same boundary through the real series, visit and acceptance commands); the SF-6 completed jobs and their evidence rows (a real start needs a captured payment, DEC-2026-050 A); the SF-8 appointment jobs.
- **Deterministic time.** `now()` is fixed for the transaction. "The clock passes" means recorded times are moved back, as the owner with triggers off (`session_replication_role = replica`), and nothing else changes. Boundaries are tested at 1 µs on each side. The support calendar is checked at fixed instants. One exception: SF-8c (§4, SD-2).
- **Four outcomes per scenario.** Queue item from the reader. Audit from the source rows and events. Alert and communication from a snapshot of **every** outbound channel the database has, compared before and after each stage:
  - *alert* (to operations): admin in-app rows (write-only, NM-1 §4.1), the owner-email ledger and its events, `net.http_request_queue` (pg_net), `cron.job`;
  - *communication* (to a homeowner or provider): their in-app rows, job messages, participant-visible operations support replies, application and package-draft emails, invitation and access dispatches.
  "None" is asserted as an exact empty change. A whole-file check pins every in-app row written for every staged request (setup notices listed), and asserts no HTTP request or cron job at all.
- **Isolation.** Synthetic `example.invalid` users and `c75c…` ids; providers in synthetic zips `00128`/`00129`. A guard refuses to run on a database that already has queue items (SF-12 is exact), as SQL 127's does. Ends in `rollback`.

## 3. Scenario-to-test map

"Reused" names existing assertions that already cover part of a scenario; SQL 128 does not repeat them in the same form and adds the outcomes they do not assert.

| ID | Stage | SQL 128 asserts | Result (current behavior) | Reused coverage |
|---|---|---|---|---|
| SF-1 | Accepted quote job, no proposal, 24 h − 1 µs / 24 h | queue, due time, alert, communication, audit | none / `proposal_missing` aged, due = acceptance + 24 h. Alert none; communication none (CFG-015); aging writes nothing; the acceptance row is the only record | SQL 090 G4 (exactly 24 h aged; an edit does not reset) |
| SF-2 | Pending proposal 4 h − 1 µs / 4 h; sent quote 12 h − 1 µs / 12 h / 24 h; batch R0 | queue, batch summary, state, event, alert, communication | `proposal_review` at 4 h; `quote_decision` at 12 h (`deadline_passed` false) and 24 h (true); R0 expires exactly this quote; `expired` + `needs_admin_review`; one `status_changed`/`quote_expired` event; alert none; communication none before expiry, then **N-QTE-06 "Price quote expired" once, to the homeowner**; the quote leaves the queue; O-2 | SQL 090 (3 h 59 m / 4 h, 11 h 59 m / 12 h, deadline flag, worker expires once, late answer refused) |
| SF-3 | `checkout_expired` webhook while unpaid; 24 h − 1 µs / 24 h | webhook outcome, attempt, queue, alert, communication | processed once; attempt `expired`; `payment_failed` at once, not aged, aged at exactly 24 h after receipt; alert none; communication none (N-CXL-07); request unchanged | SQL 090 G6 (aged at 24 h, webhook row written directly) |
| SF-4 | Attempt flagged for reconciliation | attempt, queue, due, alert, communication | `reconcile` with its code; `payment_unresolved`, `due_at` null, not aged, still not aged 30 days later; alert none; communication none | SQL 090 G6 (unknown outcome not aged) |
| SF-5 | Accepted, unpaid recurring visit at appointment − 24 h (+ 1 µs absent) | queue, since, aged, payment state, alert, communication | `review_missing` (`source_blocked`: the direct fixture has no bound terms) from exactly 24 h before; not aged; `review_pending`; alert none; communication none (N-REC-04) | SQL 097 (real path: absent 24 h + 1 min, `review_missing`/`no_snapshot` at 24 h, `ready_unpaid` after publication, aged after start, late acceptance, no "pay" notice) |
| SF-6a | Completion notice 72 h − 1 µs / 72 h; read path | queue, kind set, alert, communication, audit, state | none / `confirmation_overdue` since the 72-hour mark; the only item (evidence recorded); no `aged` field; nothing written, nothing flagged | SQL 098 (72 h − 1 µs / 72 h) |
| SF-6b | Batch R1, R1 replayed, new R2 | summaries, run records, state, events, alert, communication, queue | R1 flags exactly the 72 h job; **run records: R1 +1, replay +0 (stored summary, `replayed: true`), R2 +1 with `admin_flagged` 0** (RV-1); one admin row per admin (2); homeowner "under review" once; one `flagged_for_admin_review` event; nothing from the replay or R2; the item stays until a follow-up | SQL 003 (batch boundary, replay, new ID flags 0, one escalation audit per job, a failed run rolls back) |
| SF-7 | Offer at 4 h (4 h − 1 µs survives); read through `expire_stale_matches` as the homeowner | expiry count, state, events, blocks, offer-terms queue, alert, communication | 1 expired, then 0; `pending/exhausted`, `needs_admin_review`, unassigned; one `match_expired` event and nothing for the exhaustion (AC-1 L-4); alert none; communication none (N-REQ-04 ABSENT). **Also: one `offer_terms_blocks` row (candidates `[]`) and a `blocked_inactive` offer-terms item (SD-1)** | SQL 004 (exact 4 h, duplicate expiry, exhausted), SQL 067 (homeowner read advances it) |
| SF-8 | (a) calendar at fixed instants; (b) general ticket; (c) appointment today / tomorrow | due, priority, owner, event, alert, communication | Fri 16:30 → Mon 16:30 ET; Fri 17:00 → Mon 17:00; Mon 09:00 → Mon 17:00. Ticket due = calendar from opening, `standard`, `project_owner`, one `opened` event; one admin row per admin (write-only); no acknowledgement (N-SUP-01). Same-day: SD-2 | SQL 011 (Friday → Monday, DST, weekend), SQL 103 (routed under CFG-010) |
| SF-9 | **KNOWN DEFECT DF-3.** Operator replies before the due time; it passes. Also: a ticket closed without a reply | message, alert, communication, `overdue`, overview | one operations/participant message; alert none; N-SUP-03 "Mercurius replied on …" once to the requester; **`overdue` true although answered in time; counted "past response target" in the overview; a ticket closed without any reply is never overdue** | SQL 103 (`overdue` flagged) |
| SF-10 | Owner email `sending` exactly 10 min / 10 min + 1 µs after the claim | window, view, attention count, stored row, alert, communication | still `sending` at exactly 10 minutes; `unknown` after; attention count +1; stored row unchanged (`sending/1`); no new ledger event, admin row, HTTP request or job | SQL 120 (unknown at 11 min, never auto-claimed, attestations) |
| SF-11 | A webhook whose effect cannot apply, processed five times | results, row, finance exception, overview, alert, communication | `failed` ×5, then `dead_letter/5`, a sixth call does nothing; `provider_event` exception (`P0002`, no obligation); counted in the finance row for the authority holder; **alert NONE — MISSING (MTS §10 step 7, §11)** | SQL 042 (a failed event is an exception and holds its obligation) |
| SF-12 | Summary after SF-6a | fulfillment row, parity | `{"count":1,"aged":null}` for both operators; count = queue length (DF-1 repaired by 7.5B) | SQL 127 S3/S3b (aged null on nonempty fixtures) |

## 4. Discrepancies and observations (reported, not repaired)

| ID | Finding | Evidence | For Codex |
|---|---|---|---|
| SD-1 | **SF-7's contract row says "queue item: none (no server queue)", but the exhaustion is listed.** While the offer-terms gate is off (its state on a clean replay), every one-time exhaustion writes `private.offer_terms_blocks`, even when no candidate was skipped for the gate (`candidates: []`), so `admin_offer_terms_queue` lists it as `blocked_inactive`, and since 7.5B the overview counts it under "Offers at other terms" | `private.offer_next_for_request_internal` ([20261117001000:725](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L725), comment "every such exhaustion is recorded"); `admin_offer_terms_queue` ([20261118001000:960](../supabase/migrations/20261118001000_phase6_o10_review_forward_fix.sql#L960)); SQL 128 SF-7 (SD-1 assertions); M12 | Either amend contract §7.1 SF-7 and Q-01 (a one-time exhaustion has a server-visible item while the gate is off), or record a defect if a `blocked_inactive` item with no gate-skipped candidate misstates the cause. SQL 128 pins today's behavior either way |
| SD-2 | **SF-8's same-day branch cannot be staged deterministically.** `private.route_support_ticket` reads `now()` itself; only a run inside weekday hours 09:00–17:00 ET exercises `same_day`. SQL 128 asserts CFG-010 at the run's clock and prints which branch ran. The local runs (≈ 22:40–23:30 ET, Monday) exercised `standard`. No other test covers the `same_day` branch | [route_support_ticket](../supabase/migrations/20261103001000_phase6_support_disputes.sql#L154); SQL 128 SF-8c diagnostic | Accept the clock-conditional check, or schedule a later slice for a clock seam (a production function change, out of scope here). The CI run's branch is in its log |
| O-1 | Contract SF-6b (RV-1) is confirmed as written: no difference | SQL 128 SF-6b | — |
| O-2 | After quote expiry the request is in no quote item for 24 hours; only `needs_admin_review` marks it (no queue reads that flag; `/admin/quality` lists it). It returns as `proposal_missing`, since the expiry, 24 hours later. Consistent with CFG-015 T-3 as implemented; recorded, not a finding | SQL 128 SF-2 (last two assertions) | — |
| O-3 | Expiry (SF-2) sets `needs_admin_review` with no admin row; the 72-hour escalation (SF-6b) writes one per admin. Both are as the contract describes (no alert channel exists, X-4) | SQL 128 SF-2, SF-6b | — |

## 5. Verification

### 5.1 Baseline (derived, not adopted)

Local isolated stack (`phase5-isolated`, reused for this slice) reset on `main` `126c85f`: 236 migrations, latest `20261130001000`.

| Measure | Value |
|---|---|
| Money fingerprint (`scripts/promotion-money-fingerprint.sql` as on `main`) | `58 \| af0fae6e0c5b604e9073e10bc060957e` (equals the 7.5B record and the hosted readback recorded on #197). #198's proposed `61 \| eb3f9702…` belongs to its unmerged migration and is not used here |
| `public`/`private` functions: name, arguments, ACL and definition md5 | `844 \| d6e4707a5f797a411b8c6020069516bd` |
| `public`/`private` tables and views with kind and ACL | `210 \| 4ae328ee340b05ff035b52bc96652654` |
| Non-internal triggers on `public`/`private` tables | `221 \| 71b2215db8824c1dd8f08f0ff76b1ad4` |

All four are identical after SQL 128 and after the full suite (the file is rolled back and creates only `pg_temp` objects).

### 5.2 Results

Local, 2026-11-23 ET.

| Check | Result |
|---|---|
| SQL 128 through CI's runner (`scripts/test-phase4-db.sh` loop and TAP validator, local container) | 147/147 (SQL 127 alongside: 67/67) |
| Full SQL suite (`supabase test db`) on the clean replay | 120 files, 8765 tests, PASS (8618 before + 147) |
| Mutation checks (§5.3) | 19/19 caught; unmutated control passes |
| Schema fingerprints after the runs | unchanged (§5.1) |
| `git diff --check`, relative links, secret scan | pass (204 relative links in the changed documents resolve) |
| Exact-head CI | reported on the PR for the final head (a commit cannot record its own run) |

Unit, lint, typecheck and build are not affected (no TypeScript, configuration or application file changed); CI runs them on the final head.

### 5.3 Mutation checks

Each mutation rewrites one live function inside SQL 128's own transaction (applied to `pg_get_functiondef` output; the harness refuses to run if the edit does not apply), then runs the file. Nothing is committed.

| ID | Scenario | Mutation | Caught by (failing assertions) |
|---|---|---|---|
| M1 | SF-1 | `proposal_missing` enters after 24 h, not at it | at 24 h queued and aged; due time; SF-2's return to `proposal_missing` 24 h after expiry (3) |
| M2 | SF-2 | `proposal_review` at 3 h | 4 h − 1 µs not queued (1) |
| M3 | SF-2 | `quote_decision` after 12 h, not at it | at 12 h queued (1) |
| M4 | SF-2 | expiry notice sent to an admin instead of the homeowner | alert none on expiry; one participant row; N-QTE-06 to the homeowner; whole-file rows for the request (4) |
| M5 | SF-3 | `payment_failed` ages at 23 h | 24 h − 1 µs not aged (1) |
| M6 | SF-4 | an unresolved outcome gets a 24 h due time | no due time; never aged (2) |
| M7 | SF-5 | recurring visit visible from appointment − 23 h | the four SF-5 queue and state assertions (4) |
| M8 | SF-6a | `confirmation_overdue` after 72 h, not at it | SF-6a queue (3), SF-12 (2), item stays (1) |
| M9 | SF-6b | a new run ID re-escalates an already flagged job | R2 flags 0; R2 record; alert, communication, events none from the second run; whole-file rows (6) |
| M10 | SF-6b | a same-run replay deletes and re-runs instead of replaying | replay returns `replayed` (1) |
| M11 | SF-7 | homeowner notified on exhaustion | communication none; whole-file rows (2) |
| M12 | SF-7 | exhaustion not recorded as a gate block | the three SD-1 assertions (3) |
| M13 | SF-8 | nine support hours instead of eight | the three fixed-instant calendar checks (3) |
| M14 | SF-8 | a requester acknowledgement added | SF-8b and SF-8c communication; whole-file rows for both tickets' jobs (4) |
| M15 | SF-9 | DF-3 repaired the CD-1 way (a reply before the due time ends "overdue") | the defect pin and the overview pin (2): the pins bite when 7.5D lands |
| M16 | SF-10 | `unknown` at exactly 10 minutes | still sending at 10 minutes; not in the attention count (2) |
| M17 | SF-11 | dead letter after six attempts | dead-lettered after five; sixth call; exception shape (3) |
| M18 | SF-11 | an admin alert written on webhook failure | alert NONE — MISSING (1): the missing-alert pin bites when an alert is added |
| M19 | SF-12 | restore fulfillment's `aged` key (undo DF-1) | SF-12 for both operators (2) |

## 6. Open PR #198 (pilot commission) — checked, not incorporated

#198 (head `f3eb7e2`, open) changes money functions, `scripts/promotion-money-fingerprint.sql` and adds migration `20261201001000` and `supabase/tests/127_pilot_standard_commission.sql`. This slice reads none of its changes: the baseline above is `main`'s. Naming: #198's SQL file shares the `127` prefix with `main`'s `127_operations_summary_truth.sql` (two files with one prefix already exist at `122`; the runner globs every file, so both run). SQL 128 avoids both. If #198 renumbers before merge, it should not take `128`.

### 6.1 Reconciled with `main` after #198 merged (2026-11-24 ET)

#198 merged as `7f66d9a` (2026-11-24 12:43:40 UTC). `main` was merged into this branch as `373861c`; its CI (pull-request run 45407981719) failed in "Database role and money contracts": SQL 128's SF-3 fixture inserts `money_snapshots` directly, and #198's migration `20261201001000` made `commission_rate_bps` NOT NULL with no default.

| Item | Value |
|---|---|
| Fix | The SF-3 fixture stamps `commission_rate_bps = 1000` (the pilot standard rate in effect since the push) on its two synthetic snapshots. No assertion, expectation, scenario or count changed; SF-3 reads no commission |
| Base | `main` `7f66d9a`: 237 migrations, latest `20261201001000` |
| Money fingerprint (`scripts/promotion-money-fingerprint.sql` as on `main` `7f66d9a`) | `61 \| eb3f9702d45f9f22e61f6a7da17349c4`, equal to #198's recorded hosted readback. This replaces §5.1's `58 \| af0fae6e…` as the current baseline; §5.1 stays as the evidence for the original base |
| SQL 128 | 147/147 (unchanged count); same-day branch exercised: `same_day` (run inside weekday hours, SD-2) |
| Full SQL suite (`supabase test db`, CI's step) | 121 files, 8843 tests, PASS (8765 + #198's 78) |

The §5.1 function/table/trigger fingerprints were taken with an unrecorded query; they are not re-derived here. 7.5D records its own baseline with a stated query.

## 7. 7.5B merged status (reconciled; separate from hosted evidence)

| Item | Status | Source |
|---|---|---|
| Merge | #197 merged 2026-11-23 18:38:01 UTC as `126c85f` (head `278162b`) | GitHub PR record |
| Hosted migration `20261130001000` | Recorded as pushed 2026-11-23 17:39:29 UTC, owner-authorized, before merge, with a read-only readback (definition md5 `3bc2497f…`, money `58 \| af0fae6e…`) | #197 PR comment (2026-11-23 17:41 UTC). **Not re-verified by this slice** (no hosted query) |
| Production deployment of `126c85f` | GitHub records deployment `8007693849` (Production, by Vercel) with status `success` | GitHub deployments API. **Not verified as READY by this slice** (no Vercel query) |
| Main CI on `126c85f` | Run 45240469564 **failed**: backend and lifecycle succeeded; application failed one test, `tests/e2e/mds.spec.ts:108` ("confirmation defaults to cancel…"), an axe `color-contrast` result (2.39 for `#db8b8b` on `#fcf4f4`); 962 other browser tests passed. 7.5B changed no MDS component; PR head CI 45222000868 passed the same test. Not rerun (owner handles CI) | GitHub run log |
| HQ-1, HQ-2 | Not done | — |

## 8. For Codex review

| ID | Question or decision |
|---|---|
| R-1 | **SD-1:** amend contract SF-7/Q-01, or record a defect for a `blocked_inactive` item with no gate-skipped candidate? |
| R-2 | **SD-2:** accept the clock-conditional same-day check (branch printed per run), or plan a clock seam later? |
| R-3 | **Direct preconditions (§2).** Obligations, a recurring series, completed jobs and evidence are written as the owner; failure steps and readers are real. Acceptable for characterization? |
| R-4 | **Channel definition (§2).** Is the alert/communication split, and the list of channels, the right "none" for the contract's four outcomes? |
| R-5 | **Reuse vs repetition (§3).** SQL 128 repeats a boundary only where it adds a 1 µs edge or the real producer; SQL 090, 097, 098, 003, 004, 011, 042, 103, 120 and 127 stay the primary coverage named. |
| R-6 | **Main CI failure on `126c85f` (§7)** is outside this slice; owner decision on the rerun. |

**Unresolved and carried unchanged:** DF-3 (7.5D, CD-1), OD-1..OD-7, AC-1 D-1, D-4, D-5, D-6, every 7.3D gate, O-1..O-9, CFG-011, HQ-1..HQ-6. Phase 7 is not accepted.
