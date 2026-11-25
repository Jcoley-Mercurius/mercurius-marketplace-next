# Phase 7.5F — SLA-breach observation: design and implementation plan (TRACE-159)

**Status:** PLAN FOR REVIEW (Codex), **revision 2**. Documentation only. **Nothing here is approved or built.** OD-1 and OD-2 are open (contract §9; DEC-2026-068 keeps them open). No implementation starts until the owner approves explicitly (§10). Every "recommended" or "proposed" item below is an owner or Codex decision still to be made.
**Revision 2 (2026-11-25 ET):** applies Codex's 7.5F review F-1..F-6 (§12) and consolidates the #204 duplicates (§1.2). Revision 1 was head `e18a4e6`.
**Date:** 2026-11-25 (America/New_York).
**Base:** `main` `846dd34` (#204 merge, 2026-11-25 22:14:10 UTC), fetched before each revision; unchanged between them. Branch `claude/phase7-5f-sla-observation-plan`, PR #207.
**Authority:** the owner's 7.5F preparation instruction and revision instruction (2026-11-25 ET). [Operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) (OQ-1) §4 (T-1..T-11), §6.1 (proposed design), §7.2 HQ-5, §9 OD-1/OD-2, §10 step 5. [7.5C record](PHASE-7-OPERATIONS-STAGED-FAILURES-7-5C.md) (method, SF-6b). [7.5D record](PHASE-7-SUPPORT-FIRST-REPLY-7-5D.md) (first reply, R-7). [7.5E record](PHASE-7-ADMIN-NOTIFICATION-READBACK-7-5E.md) (F-2 unknown outcomes). Roadmap Phase 7 gate. CFG-010, CFG-011, CFG-015; DEC-2026-003, -006, -045 choice 8, -063. Precedents: `public.email_provider_events_purge` (operator purge, counts-only log), `private.run_promotion_release_sweep` (try-lock, logged skip).

## What this plan does not do

- No application, database, test, CI or configuration change. No hosted Supabase, Vercel, Stripe, Resend or PostHog call; GitHub was read only. No scan.
- No scheduler, notice, alert, email, booking, payment or email activation, now or in the slices it proposes.
- No new threshold. Every rule below is already approved (contract §4); everything else keeps "no approved threshold". No retention period is chosen (P-2).
- Does not accept any part of Phase 7. An observation is not an alert: the gate's alert outcome stays MISSING (OD-5 external channel, HQ-6).

---

## 0. Summary

1. **Five rules have a breach instant that existing readers already compute:** T-3 (three quote kinds), T-4 failure aging, T-5, T-8 and T-10 (§2). The qualifying condition is exactly the reader's own; `due_at` comes from one named source timestamp. T-1, T-2, T-6, T-7, T-9 and T-11 are left out, with reasons; T-9 overlaps T-8 (P-1).
2. **Design (§4):** append-only run, run-result and observation tables in `private`, written only by one admin-invoked detector that **calls the existing queue readers**, restating none. A run key is serialized before anything is checked (F-1); rows are inserted in foreign-key order with non-deferrable keys (F-2); already-recorded episodes are excluded before the per-rule cap (F-3); a missing run is "not visible yet", never "failed" (F-4); evaluation time and observation time are separate columns (F-5); finite retention is a policy value with read-time expiry and an operator purge (F-6).
3. **What it can prove:** "the reader listed item X as past `due_at` under rule T-n, evaluated at `evaluated_at`, in data that includes every commit before `observed_at`". **What it cannot:** that no other breach happened. A breach that begins and ends between two scans leaves no record (§3.2). Observation counts are a lower bound; lag is time past due when observed, not breach duration; scan intervals are descriptive only.
4. **The cap bounds writes, not reads (§4.8).** Each reader still computes and materializes its whole queue; a slow read can time out the whole call, which then writes nothing.
5. **Delivery (§5, §8):** two PRs, **7.5F-1** database (migration, SQL 131, `scripts/sla-detector-concurrency.mjs` and one proposed CI step) then **7.5F-2** operator page. Implementation approval, hosted schema push, release, first hosted scan, retention setting and first hosted purge are separate authorizations (§10.2).
6. **Open:** OD-1, OD-2; P-1..P-7 (incl. retention value and purge invoker); D-1..D-9 not ruled on by the relayed review (§9).

## 1. Baseline and reconciliation

| Item | Observation (2026-11-25 ET; GitHub read only) |
|---|---|
| `origin/main` | `846dd34` (#204). Before it: `24fd251` (#205, /services Option C), `01a5dd1` (#203), `afa0be8` (#202). Re-fetched for revision 2: unchanged |
| Open PRs | #207 (this plan) and #206 (draft, /services revision 1, TRACE-161, not touched) |
| Migrations / SQL tests | Latest `20261202001000` (7.5D); latest SQL test `130_admin_notification_readback.sql`. This plan adds none |
| OD-1, OD-2 | **Not approved.** No DECISION-LOG, OWNER-APPROVALS or CONFIGURATION-DECISIONS entry; DEC-2026-068 says they stay open |
| Main CI | `846dd34` run 45711471570 success; `01a5dd1` run 45537955099 success |
| Codex review of #207 | Relayed by the owner (2026-11-25 ET) as F-1..F-6; no GitHub review object or comment exists on #207 |

### 1.1 #203 (7.5E review repair): merged; review and deployment evidence open

| Item | Status | Source |
|---|---|---|
| Merge | **Merged** 2026-11-25 03:09:07 UTC as `01a5dd1`, from head `5fc09e1` | GitHub PR record |
| Exact-head CI | Run 45521103690 success (backend, lifecycle, application) | #203 owner comment |
| Codex re-review of the repair | **Not recorded.** No GitHub review object; no review note in any record. Open | GitHub; 7.5E record §11 |
| Production deployment of `01a5dd1` | GitHub deployment 8047197415 (Production) status `success`. **READY not verified** (no Vercel query) | GitHub deployments API |
| Effect | `main` carries the F-1/F-2 repairs; the window in which production ran the unrepaired #202 code (`afa0be8`, 00:33–03:09 UTC) is not otherwise characterized | — |

### 1.2 #204: inert copies merged; duplicates consolidated in revision 2

#204 merged `claude/phase7-5e-admin-notification-readback` (#202's branch, head `632a600`) as `846dd34` at 22:14:10 UTC, with no review object; GitHub deployment 8070829356 (Production) status `success`, READY not verified. Its source commits `d34b2a2` and `8b75582` have **trees identical** to #203's `7b72d18` and `0610688` (`git rev-parse <commit>^{tree}`: `0979a8d9…` and `181bda23…` for each pair), so no code changed; the merge diff touches three documents only.

Revision 1 left the duplicates in place (the 7.5E F-3 precedent). Revision 2 consolidates them on the owner's instruction, keeping every unique fact and dated line:

| Duplicate added by #204 | Consolidation (revision 2) | Unique content kept |
|---|---|---|
| 7.5E record header: a second "Review (2026-11-24 ET)" line | Removed; the fuller line (which adds "in a follow-up PR because #202 had merged") stays | none lost: the removed line is a prefix of the kept one |
| 7.5E record §11.4: five result rows citing `d34b2a2`/`8b75582` | Removed; one row states that those commits have trees identical to `7b72d18`/`0610688`, so the results apply to both | the two commit IDs and their identity to the tested trees |
| TRACEABILITY: four TRACE-159 rows (#204's stale copy, the revision-1 row, the 7.5B-era row, the current row) | One row. The current row already contained the 7.5B-era and #204 rows verbatim; the revision-1 status ("CONTRACT FOR REVIEW; recommended first slice 7.5B … not started; no hosted read, migration or activation") is kept in it as a dated history entry | the revision-1 status line |
| HANDOFF: "Next (after repair): Codex re-reviews the new head." | Removed; the next line ("…the follow-up PR's head; merging it is the owner's release decision") supersedes it | none lost |

## 2. Rule evaluation (OD-1 recommendation tested against the source)

Every reader below is `SECURITY DEFINER`, admin-only (`42501`) and evaluates at transaction `now()`. Volatility matters for §4.6: `admin_quote_queue`, `admin_fulfillment_queue` and `admin_support_queue` are declared `stable`; `admin_offer_terms_queue` is not (volatile by default).

| Rule | Kind(s) | Reader the detector calls | Qualifying condition (exactly the reader's) | `due_at` source | At `due_at` exactly | Subject (key) | Leaves the queue when |
|---|---|---|---|---|---|---|---|
| T-3 proposal missing | `proposal_missing` | `public.admin_quote_queue()` ([20261027001000:453](../supabase/migrations/20261027001000_phase6_recurring_payments.sql#L453)) | listed (`now() >= since + 24h`), `aged` | `since + 24h`, where `since` = greatest of the current provider's acceptance (or `assigned_at`), latest declined quote's `decided_at`, latest expired quote's `expires_at`, latest returned proposal's `decided_at` | observed (lag 0 at evaluation) | `request_id` | proposal submitted; quote submitted/accepted; request leaves open quote work |
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
| **Recorded observation** | Observation row | A detector run's reader listed the item past `due_at` under rule T-n (times as §4.6) | That it is still overdue, how long it lasted, how it ended, or that unobserved items never breached |
| **First-response fact** | `first_response_at` in support queue items and operator detail (7.5D) | The earliest participant-visible operations message was recorded at that time | That anyone read it; and it is not an observation. For T-8, "was the first reply late" is derivable from it for every ticket, scanned or not, but 7.5F does not report that (P-4) |

The detector never writes `first_response_at` or any queue input. A T-8 observation stays in the ledger after the reply arrives.

### 3.2 What a manual scan can miss (M-1..M-11)

| ID | Case | Result |
|---|---|---|
| M-1 | Crosses `due_at` and leaves the queue between two scans (reply, decision, follow-up, capture, status change) | **No observation, ever.** Example: quote sent 09:00, scans at 20:00 and 10:00 next day, homeowner decides at 22:00 (past the 21:00 mark): breached, unrecorded |
| M-2 | No scan since the crossing | Not observed yet; the ledger is only as current as the last run in which that rule completed |
| M-3 | Reclassified before a scan: T-10 `unanswered` → `not_acceptable`; T-3 `quote_decision` expires at 24 h (T-2); T-8 ticket closed without a reply | Leaves the qualifying condition; as M-1 |
| M-4 | A rule fails in a partial run (§4.9) | That rule observes nothing in that run |
| M-5 | Per-rule cap reached (§4.8) | New episodes beyond the cap are observed by later runs, oldest first, with larger lag; repeated runs make progress (F-3) |
| M-6 | A source timestamp moves (a later acceptance, decline or expiry resets T-3 `since`; a direct correction) | A new `due_at` is a new key: one real episode can produce two rows (D-7) |
| M-7 | Breaches before the first scan after deployment | Absent. No backfill (P-5) |
| M-8 | Concurrent run skipped (§4.5) | The skipped call observes nothing |
| M-9 | An item becomes due between `evaluated_at` and `observed_at`, or changes while its reader runs | Not listed in that run (the predicate uses `evaluated_at`); a change committed during the read may or may not be seen (§4.6) |
| M-10 | An observation expires under retention while its episode is still overdue (§4.11) | Hidden from readback but still blocks re-recording until purged; after the purge the next scan records it again as a new row with a later `observed_at`; the two rows are not linked |
| M-11 | The whole call fails (reader timeout, lost connection before commit) | Nothing from that call is recorded (§4.8, §4.10) |

**Wherever observations are shown:** counts are a lower bound; absence is not evidence of compliance; lag is time past due when observed, not breach duration. Scan intervals are shown as facts about when runs happened. **They do not bound, estimate or count missed breaches**, and no metric claims coverage (F-5).

## 4. Design

### 4.1 Tables (`private`; RLS enabled; no privileges for `anon`, `authenticated` or `service_role`)

Foreign keys are ordinary, **non-deferrable, immediate** constraints, and every insert happens after the row it references (F-2).

`private.operations_sla_detector_runs` — the run start, inserted first, immutable:

| Column | Type / rule |
|---|---|
| `id` | `uuid` primary key: the caller's run key |
| `actor` | `uuid not null` (`auth.uid()`) |
| `applied_limit` | `integer not null`, 1–500: the normalized limit (§4.2) |
| `rule_set` | `text not null`: the OD-1 rule set version compiled into the detector (record only) |
| `evaluated_at` | `timestamptz not null`: transaction `now()` (§4.6) |
| `started_at` | `timestamptz not null`: `clock_timestamp()` at insert |

`private.operations_sla_observations` — one row per first sighting of a breach episode; references the run start:

| Column | Type / rule |
|---|---|
| `id` | `bigint` identity primary key |
| `run_id` | `uuid not null references private.operations_sla_detector_runs(id)` |
| `rule_id` | `text`, check in the OD-1 set only (`T-3`, `T-4`, `T-5`, `T-8`, `T-10` if approved as recommended) |
| `queue`, `item_kind` | `text`, checked lists (§2) |
| `subject_id` | `uuid not null` (§2 "Subject"); **no foreign key to the source**, so no business delete is blocked or cascaded |
| `request_id` | `uuid` (nullable; the related request or job) |
| `due_at` | `timestamptz not null` |
| `evaluated_at` | `timestamptz not null`: copied from the run |
| `observed_at` | `timestamptz not null`: the rule's read time (§4.6) |
| checks | `due_at <= evaluated_at` (T-8: `<`), `evaluated_at <= observed_at` |
| unique | `(rule_id, item_kind, subject_id, due_at)` |

`private.operations_sla_detector_run_results` — inserted last; its presence completes a run:

| Column | Type / rule |
|---|---|
| `run_id` | `uuid` primary key `references private.operations_sla_detector_runs(id)` |
| `outcome` | `complete`, `partial`, `failed`, `skipped` |
| `rules` | `jsonb`: per rule `{status: ok\|error\|skipped, sqlstate, observed_at, listed, already_recorded, inserted, over_limit, conflicted}`; SQLSTATE only, never an error message or row content |
| `finished_at` | `timestamptz not null`: `clock_timestamp()` |

`private.operations_sla_retention` — single row (§4.11): `retention interval` (null = no expiry), `decision_ref text`; changed only by a reviewed migration after the owner decides P-2.

`private.operations_sla_purges` — counts-only purge log (§4.11).

Within one transaction a run start, its observations and its result are inserted in that order and commit together; another session sees all of them or none. No table has a deferrable constraint, so nothing is checked later at commit that was not already checked at its statement.

### 4.2 Detector: `public.admin_detect_sla_breaches(p_run_key uuid, p_limit integer default 200) returns jsonb`

`SECURITY DEFINER`, `search_path = ''`, volatile. Steps, in order:

1. Refuse unless `auth.uid()` holds `admin` (`42501`); refuse a null key (`22023`); refuse unless `transaction_isolation = 'read committed'` (`55000`): step 3 relies on a statement after the lock seeing rows committed while it waited, which REPEATABLE READ and SERIALIZABLE do not give.
2. **Normalize** the parameters: `applied_limit := least(500, greatest(1, coalesce(p_limit, 200)))`.
3. **Serialize the key (F-1):** `pg_advisory_xact_lock(hashtextextended('private.operations_sla_detector:key:' || p_run_key::text, 0))`, blocking. A second call with the same key waits here until the first commits or rolls back. (A hash collision between two different keys only serializes them; it cannot cause a replay, because step 4 compares the stored key.)
4. **Recheck after serialization:** select the run start and result for `p_run_key` in a new statement.
   - Exists, same `actor`, same `applied_limit` → return the stored result with `replayed: true`. Nothing else runs.
   - Exists, different `actor` → `22023` "Run key reused by another operator". Exists, same actor, different `applied_limit` → `22023` "Run key reused with different parameters". Nothing is written.
   - Does not exist → this call owns the key.
5. **Scan lock:** `pg_try_advisory_xact_lock(hashtextextended('private.operations_sla_detector:scan', 0))`, shared with the purge (§4.11). If not acquired: insert the run start, then a result with `outcome = 'skipped'`, and return it (precedent: `run_promotion_release_sweep`). The key now names a skipped attempt; a retry needs a new key.
6. Insert the run start (`evaluated_at := now()`).
7. For each rule, inside its own `begin … exception when others` block (a savepoint):
   1. `observed_at := clock_timestamp()`; then call the reader(s) of §2 in the next statement;
   2. keep the qualifying items; count them (`listed`);
   3. **exclude keys already in the ledger** (`not exists` on the unique key, expired-but-unpurged rows included) and count them (`already_recorded`) (F-3);
   4. order the remaining new episodes by `due_at, subject_id`; take the first `applied_limit`; insert with `on conflict do nothing` (`inserted`; any conflict counted as `conflicted`, expected 0 under the scan lock); `over_limit` = the rest.
   5. On error: that rule's inserts roll back to the savepoint; record `error` and the SQLSTATE; continue.
8. Insert the result (`complete`, `partial` when some rules erred, `failed` when all did) and return `{run_key, evaluated_at, started_at, finished_at, outcome, rules, totals, replayed: false}`.

Invariant per rule: `listed = already_recorded + inserted + conflicted + over_limit`.

It writes nothing else. It sends no notice, sets no flag, changes no job, ticket, quote, payment or offer, and calls no command (`run_lifecycle_batch`, `expire_stale_matches` or any `admin_*` writer).

### 4.3 Readback (admin-only, `42501` otherwise; `stable`; expired rows excluded, §4.11)

| Function | Returns |
|---|---|
| `public.admin_sla_observations(p_rule text default null, p_before_id bigint default null, p_limit integer default 50)` | Unexpired observations newest first (keyset on `id`), with `evaluated_at`, `observed_at` and `lag_seconds = observed_at − due_at`; limit clamped 1–200 |
| `public.admin_sla_detector_runs(p_limit integer default 20)` | Recent unexpired runs: start, result, per-rule counts, actor name |
| `public.admin_sla_detector_run(p_run_key uuid)` | `{state: 'visible', run}`; `{state: 'expired'}` (present, past retention); or `{state: 'not_visible'}` — **no committed result is visible yet** (§4.10). Never "failed" |
| `public.admin_sla_observation_summary(p_from timestamptz, p_to timestamptz)` | Per rule: unexpired observation count, min/max lag; counts of runs by outcome and by rule status; first and last run in which each rule completed; the intervals between those runs, labelled descriptive; the fixed statement that counts are a lower bound and that intervals do not bound or estimate missed breaches. No coverage, completeness or miss-rate field |

Not in `supabase_realtime`; nothing forwarded to PostHog (AC-1 D-1); no `anon`, `service_role` or `public` execute.

### 4.4 Permissions

Execute on the detector, the four readbacks and the purge (§4.11): `authenticated` only, admin checked inside. Tables: owner only; RLS enabled with no policies. Operator = an account with the `admin` role, the same population that can read every queue today (R0: Josh only, DEC-2026-025); narrowing it is P-3 (scan) and P-7 (purge). No scheduler or `service_role` path is granted (OD-2).

### 4.5 Idempotency, concurrency and episodes

- **Same key, same actor, same normalized limit:** replays; never scans twice, including when the calls overlap (step 3 waits, step 4 then sees the committed run).
- **Same key, another actor or another limit:** refused after serialization; nothing written.
- **Same key, first call rolled back:** the waiting call finds no run and owns the key.
- **Different keys at once:** one scans; the other records `skipped` (step 5). Lock order is key lock (blocking) then scan lock (non-blocking), so no deadlock.
- **Same episode, later scans:** same unique key, excluded before the cap and counted as `already_recorded`. Only the first sighting is stored (D-6): the ledger cannot say how long a breach lasted.
- **Reopened T-8 ticket:** target and first reply are unchanged on reopen (7.5D R-7), so an unanswered reopened ticket is the same episode: no new row.
- **Repeated episodes:** a new subject (new proposal, quote revision, attempt, terms) or a new `due_at` (T-3 `since` reset; T-5 new completion notice) is a new row.

### 4.6 Evaluation time and observation time (F-5)

Revision 1 said `observed_at` was "the instant every reader evaluated" and also that each reader "takes its own snapshot milliseconds after `as_of`". Both cannot describe one timestamp. Revision 2 records two:

| Time | Value | What it means |
|---|---|---|
| `evaluated_at` (run, copied to each row) | transaction `now()` | The clock every reader's predicate compares against (`now() >= due`, `due < now()`). Guarantees `due_at <= evaluated_at` (T-8 `<`) |
| `observed_at` (per rule, on each row) | `clock_timestamp()` in the detector statement immediately before the one that calls the rule's reader | The detector is volatile, so its next statement takes a fresh snapshot after `observed_at`. Stable readers run entirely in that snapshot; `admin_offer_terms_queue` (volatile) takes a fresh snapshot per internal query, each also after `observed_at`. So **every transaction committed before `observed_at` is visible to the read**; one committing during the read may or may not be |

An observation therefore states: the reader listed the item as past `due_at`, judged at `evaluated_at`, in data that includes every commit before `observed_at`. It says nothing about any later instant. Lag = `observed_at − due_at`. An item due after `evaluated_at` but before `observed_at` is not listed in that run (M-9).

### 4.7 Resolved and deleted sources

Rows are never updated when the source resolves, changes or is deleted (admins may delete service requests). Readbacks show stored fields only and do not claim the item is still open; a link to a deleted record shows that page's own not-found state. Identifiers may outlive the source record until expiry (§4.11; P-2).

### 4.8 What the cap bounds, and what it does not

- **Bounded:** inserts per rule per run (`applied_limit`, at most 500), and the work after a reader returns.
- **Not bounded:** the reads. Each reader computes and materializes its **whole** queue as one `jsonb` value (the support reader also builds names and message counts for every open ticket), exactly as when the page loads. 7.5F does not change any reader and adds no read limit. A large queue costs what loading that queue's page costs, every scan.
- **When a read is too slow:** the role's statement timeout cancels the whole call (`57014`). PL/pgSQL `when others` does not catch a cancellation, so the per-rule savepoints do not contain it: the transaction rolls back and the call writes nothing (no run, result or observation; M-11). The client sees an error; if the response is lost, §4.10 applies.
- No loop over the clock, no retry, no pagination of readers.

### 4.9 Partial failures

A rule whose reader or insert raises an ordinary error records `error` with its SQLSTATE; other rules still record; outcome `partial` (some) or `failed` (all). The result row is always written for an executed scan, so a rule failure is audited. A failure of the call itself (timeout, cancellation, lost connection before commit) writes nothing (§4.8).

### 4.10 Unknown outcomes (F-4; as 7.5E F-2)

A lookup that returns `not_visible` means **no committed result is visible yet**. The call may still be running (holding the key lock), may not have reached the database, may have rolled back, or (long after) may have been purged. It is never treated as confirmed failure.

| Client sees | Page says / does |
|---|---|
| Result, `replayed: false` | The run's outcome and counts |
| Result, `replayed: true` | The stored result; "This scan had already run" |
| `skipped` | "Another scan or purge was running. Nothing was recorded." A new key for a retry |
| Definite refusal (`42501`, `22023`, `55000`) | The refusal |
| Timeout or cancellation error (`57014`) | "The scan didn't finish and recorded nothing." (definite: the error arrived) |
| No response, network error | Status stays **unknown**: "We couldn't confirm whether the scan ran." Reads `admin_sla_detector_run(key)`: `visible` settles it; `not_visible` keeps the status unknown ("No result is visible yet") and offers **Try again with the same key** |
| Retry with the same key | Serializes on the key: waits for an in-flight call, then replays its committed result, or runs if nothing committed. A retry is the only path to a definite answer; the page never infers one |
| Account changed while waiting | Discarded (`stale`), as 7.5E F-1; the pending key is dropped |

### 4.11 Retention: expiry, readback exclusion and purge (F-6)

The records are append-only for their whole retention period; deletion is possible only after expiry and only through one authorized function.

| Part | Specification |
|---|---|
| Retention value | `private.operations_sla_retention.retention` (one row). Null = no expiry. The value and the class under CFG-011 are the owner's decision (P-2); it is set or changed only by a reviewed migration that names the decision. Until decided, null, so nothing expires and the purge deletes nothing |
| Expiry | Computed on read, not stamped: `private.operations_sla_expired(ts) := retention is not null and ts < now() - retention`. Observation: `observed_at`. Run (start and result): `finished_at`, and only once no observation references it. Purge log: `ran_at`, under the same value unless P-2 says otherwise. A later change of the value applies to every row at once, with no row update |
| Readback exclusion | Every readback and the summary filter out expired rows at read time, so an expired row is invisible before it is purged. `admin_sla_detector_run` reports `expired` instead of the run |
| Purge | `public.admin_purge_sla_records(p_limit integer default 100) returns jsonb`: admin only (P-7), operator-invoked, no scheduler; READ COMMITTED required; try-locks the **same** scan lock as the detector (busy → logged `skipped`), so a purge and a scan never overlap; deletes up to the clamped limit (1–1,000) of expired observations, oldest `observed_at` first, `for update skip locked`; then expired run results and run starts that no observation references, up to the limit; writes one `private.operations_sla_purges` row (actor, limit, deleted observations, deleted runs, remaining expired capped at 10,000, `ran_at`); returns the counts and the oldest remaining expiry. Precedent: `email_provider_events_purge` |
| Append-only guard | A `before update or delete` trigger on the observation, run-start, run-result and purge-log tables. UPDATE: always refused. DELETE: refused unless the transaction-local setting `private.operations_sla_purge` equals the current transaction id (set only by the purge function with `set_config(…, true)`) **and** the row is expired under the same function. So even the purge cannot remove an unexpired row. Table privileges remain the primary control (no client can delete); the trigger guards definer code and mistakes. The table owner can still bypass triggers; that is outside any function's control and is stated |
| Re-recording | An expired, unpurged observation still blocks its key (M-10); after its purge, a still-overdue episode is recorded again as a new row |

### 4.12 Separation from the lifecycle worker's completion escalation

The DEC-2026-006 escalation stays a T-5 business action inside `run_lifecycle_batch` (flag, event, admin and homeowner rows, run record; inactive without a scheduler). The detector does not read `lifecycle_worker_runs` or `needs_admin_review`, writes neither, and does not count an escalation as an observation. A T-5 observation is recorded whether or not the batch has run, and the batch escalates whether or not the detector has run (contract §6.1).

## 5. Exact files and functions (after approval; numbers re-derived from `main` at the time)

Delivery stays **two PRs, in order**. 7.5F-2 starts after 7.5F-1 is merged.

**7.5F-1 database** (one PR; the hosted push is authorized separately and happens before merge, DEC-2026-037):

| File | Content |
|---|---|
| `supabase/migrations/20261203001000_phase7_sla_breach_observations.sql` | The five tables (§4.1), guard trigger, `private.operations_sla_expired`, `public.admin_detect_sla_breaches`, the four readbacks, `public.admin_purge_sla_records`, grants. Additive; no existing function restated. Retention row inserted with `retention = null` unless P-2 is decided first |
| `supabase/tests/131_sla_breach_observations.sql` | §6 single-session groups; rolled back; synthetic `example.invalid` users; 7.5C fixed-clock method |
| `scripts/sla-detector-concurrency.mjs` | §6 multi-session groups with real commits, following `scripts/*-concurrency.mjs` |
| `.github/workflows/ci.yml` | **Proposed CI step (a CI change; needs approval with 7.5F-1):** in the `backend` job, after the existing concurrency steps, `- name: Concurrent SLA detector run keys, scans and purges (TRACE-159)` / `run: node scripts/sla-detector-concurrency.mjs` |
| Records | 7.5F implementation record, contract revision note, TRACEABILITY, HANDOFF |

**7.5F-2 operator page** (one PR; no migration):

| File | Content |
|---|---|
| `src/lib/slaObservations.ts` | Types; outcome mapping (§4.10), including `not_visible` → unknown; wording; lag formatting |
| `src/app/admin/sla-observations/page.tsx` | "Scan now" (new key per click; the same key on "Try again"), recent runs, observations by rule, the summary with the lower-bound and descriptive-interval statements, links to the existing queues for overdue-now work. Purge control shown only when retention is set (P-7) |
| `src/components/admin/AdminSidebar.tsx` | One entry beside Notifications |
| `tests/unit/sla-observations.test.ts`, `tests/e2e/admin-sla-observations.spec.ts` | §6 group P |

## 6. Tests (acceptance)

SQL 131 runs single-session cases in one rolled-back transaction. Cases that need two sessions or a real commit run in `scripts/sla-detector-concurrency.mjs` (CI step §5).

| Group | Where | Assertions |
|---|---|---|
| **B boundaries** | SQL | Per rule at `due − 1 µs` (absent), `due` (present except T-8), `due + 1 µs` (present); recorded `due_at` equals the named source; `due_at <= evaluated_at <= observed_at` (T-8 `<`); observed set equals the reader's qualifying set in the same transaction |
| **K run-key serialization** (F-1) | script | K1 same key, same actor, overlapping: the second waits, then returns the first's stored result with `replayed: true`; exactly one start and one result. K2 same key, different actor, overlapping: the second gets `22023` after the first commits; it writes nothing. K3 first call rolled back while the second (same key, same actor) waits: the second runs and owns the key; exactly one run. K4 different keys, overlapping: one `complete`, one `skipped`; no duplicate observation. Repeated 20 times with the same result |
| **N normalization** (F-1) | SQL | Same key, same actor: `null` vs `200`, `0` vs `1`, `999` vs `500` replay; `100` vs `200` → `22023`; REPEATABLE READ caller → `55000` |
| **F foreign keys and commit boundary** (F-2) | SQL + script | No deferrable constraint on any 7.5F table (`pg_constraint.condeferrable = false`); after a scan inside the test transaction `set constraints all immediate` succeeds. Script: after a real commit, a fresh session sees every run with exactly one result, every observation's run with a result, and per-run `inserted` = rows with that `run_id`; a call made inside an explicit transaction and rolled back leaves no start, result or observation visible to another session; a skipped call commits a start and a result and no observation |
| **P progress under the cap** (F-3) | SQL | Limit 1, three new episodes due t1 < t2 < t3: runs insert t1, t2, t3 in turn, then 0; `already_recorded` 0, 1, 2, 3; invariant `listed = already_recorded + inserted + conflicted + over_limit` on every run. Already-recorded episodes that sort first never consume the cap |
| **U unknown outcome** (F-4) | script + unit | Script: while a call is held in an uncommitted transaction, another session's lookup returns `not_visible`; a same-key retry blocks, then replays after commit; after a rollback the retry runs. Unit: `not_visible` stays unknown, offers the same key, never says "failed" or "did not run" |
| **T time semantics** (F-5) | SQL + unit | `evaluated_at` = transaction `now()`; `observed_at` per rule ≥ `evaluated_at` and differs between rules read in order; an item due at `now() + 1 µs` is not listed; summary has no coverage, completeness or miss-rate field; wording test rejects "all breaches", "complete coverage", "no breaches missed", "guarantee" |
| **R retention** (F-6) | SQL + script | Retention null: nothing expires, purge deletes 0. Retention set inside the test: expired observations and runs leave every readback and summary count; lookup returns `expired`; UPDATE refused on all four tables; DELETE refused outside the purge, and of an unexpired row even with the purge setting; purge deletes only expired rows, oldest first, respects the limit, deletes runs only when unreferenced, logs counts; M-10 re-recording after purge. Script: purge during a scan → `skipped`, and the reverse; two purges never delete a row twice |
| **L unbounded read** (§4.8) | script | A large synthetic queue with a low session statement timeout: the call fails `57014` and leaves no start, result or observation; with a normal timeout the same queue scans and inserts at most the cap per rule |
| **M missed between scans** | SQL | Scan before `due`; source resolves after `due`; scan again → **0 observations** (M-1); T-10 reclassified to `not_acceptable` → 0 (M-3) |
| **A access refusal** | SQL | Detector, readbacks and purge refused for anon, homeowner, provider (`42501`); no `service_role` or `anon` execute; direct `select`/`delete` on every table refused for `authenticated` |
| **S summary consistency** | SQL | Totals = sum of rules; summary counts = unexpired ledger counts; a rule forced to raise inside the test transaction → `partial`, SQLSTATE stored, other rules recorded |
| **Z unchanged business state** | SQL | Before/after a scan and a purge: row count and content md5 of every `public`/`private` table except the 7.5F tables; `notifications`, `job_events`, `support_ticket_events`, `lifecycle_worker_runs`, `net.http_request_queue`, `cron.job` unchanged; definition md5s of the five readers, `admin_operations_summary` and `run_lifecycle_batch` unchanged; money fingerprint unchanged |
| **E escalation separation** | SQL | SF-6 setup: T-5 observed with and without a prior `run_lifecycle_batch`; batch output, flag, event and rows identical with and without a prior scan |
| **P page** | unit, browser | Each §4.10 outcome and its wording; stale on account change; observations never labelled "still overdue"; lower-bound and descriptive-interval statements present; purge hidden while retention is null; non-admin refused |

Mutations (each must fail a named test): key lock removed or taken after the lookup (K1/K2); actor check removed (K2); limit not normalized or not compared (N); a deferrable foreign key or result inserted before the start (F); anti-join removed (P); `not_visible` mapped to failure (U); `observed_at := evaluated_at` (T); expiry filter removed from a readback (R); guard allows deleting an unexpired row (R); purge without the shared lock (R script); `<=` for T-8; T-10 without `+ 24h`; unique key without `due_at`; savepoint removed; a detector write to `notifications`; `service_role` granted; error message stored instead of SQLSTATE.

## 7. Acceptance criteria

1. Every §6 group passes, including K, N, F, P, U, T, R and L for findings F-1..F-6; every listed mutation is caught; the unmutated control passes.
2. Clean replay of all migrations; full SQL suite, the new concurrency script, unit, lint, typecheck, secret scan and production build pass; money fingerprint and all pre-existing function definitions unchanged.
3. The detector observes exactly the reader's qualifying items for the approved rules, and nothing else.
4. No business table, notification, event, HTTP request or cron job changes in any test.
5. The page states, wherever observations appear, that they are a lower bound, that intervals do not bound missed breaches, and that overdue-now work is in the queues; an unconfirmed scan stays unknown.
6. Records name the OD-1/OD-2 and P-decisions, each hosted step performed (or not) with its evidence, and keep HQ-5 open until a hosted staged breach is observed under its own authorization.

## 8. Rollout and rollback

**Rollout**, each step separately authorized (§10.2):

1. Owner approves OD-1, OD-2 and the P-choices needed for implementation (implementation approval).
2. 7.5F-1: build and local evidence → Codex review → owner-authorized `supabase db push --linked --dry-run` listing only the new migration → push → read-only readback (tables empty, retention row, ACLs, definition md5s, reader md5s unchanged, money fingerprint) → merge (deploys; no client calls the functions) → deployment READY readback.
3. 7.5F-2: build → Codex review → merge (deploys the page).
4. **First hosted scan:** writes production rows to the 7.5F tables only; the owner's action, authorized on its own.
5. **Retention:** after P-2, a reviewed migration sets the value (its own push authorization). The **first hosted purge** is again the owner's action.

No scheduler at any step.

**Rollback.** Application: `vercel promote <previous dpl_id>`; the database objects are unused without the page. Database, forward only: a migration revoking execute on the detector (and purge) stops new scans and keeps the records; dropping the objects needs the owner's decision about the retained rows (P-2). No business data is written, so nothing needs repair.

## 9. Open items

**Policy choices for the owner (not decided here; the "proposed" column is a recommendation only):**

| ID | Choice | Options | Proposed (unapproved) |
|---|---|---|---|
| P-1 | Dispute and dispute-appeal tickets in the T-8 reader | (a) record as T-8, as the queue does; (b) record as T-9; (c) exclude | (a), labelled by ticket kind |
| P-2 | Retention value for observations, runs and the purge log, and its CFG-011 class | 90 days (operational logs); 3 years (support); 7 years (financial / completed service); or none until decided | None until decided (`retention = null`); the mechanism (§4.11) works with any value |
| P-3 | Who may scan | Any admin (as queue access) or the project owner only (CFG-010) | Any admin |
| P-4 | Show derived first-reply lateness (`first_response_at > response_due_at`) | In 7.5F or later | Later |
| P-5 | Backfill from source history | None, or a derivation clearly labelled as not observed | None |
| P-6 | Expected manual scan cadence | None stated, or an operating practice | None; coverage is whatever scans happen |
| P-7 | Who may purge, and when | Any admin; owner only; only after the owner names a first purge | Owner authorizes the first hosted purge; thereafter any admin, manually |

**Design questions (proposals; not ruled on in the relayed review):**

| ID | Question | Proposed | Status |
|---|---|---|---|
| D-1 | Call the public readers inside the detector, or extract private item functions | Call them: no restatement, one computation | Open |
| D-2 | T-10 `due_at = since + 24h` computed in the detector, or restate the reader to expose it | Detector, with a parity test | Open |
| D-3 | T-4 from `admin_quote_queue` `aged`, or `money_payment_exceptions` directly | `admin_quote_queue` | Open |
| D-4 | Concurrent call with another key: record `skipped`, or raise | Record, after key serialization (§4.2 step 5) | Open; ordering now fixed by F-1 |
| D-5 | Per-rule savepoints, or all-or-nothing | Per rule; cancellations still abort the whole call (§4.8) | Open |
| D-6 | First sighting only | Yes | Open |
| D-7 | Key includes `due_at`, so a moved timestamp makes a second row | Accept and report (M-6) | Open |
| D-8 | `observed_at = as_of` | **Superseded by F-5:** `evaluated_at` and `observed_at` are separate (§4.6) | Replaced |
| D-9 | Two PRs (database, page) | Yes | Kept by the revision instruction |

**Carried unchanged:** #203 Codex re-review and READY readback of `01a5dd1` and `846dd34`; OD-3..OD-7, OD-5 external channel; AC-1 D-1, D-4, D-5, D-6; SD-1, SD-2; 7.5D F-1, O-1..O-3; every 7.3D gate; CFG-011; HQ-1..HQ-6. Phase 7 is not accepted.

## 10. Decision card

### 10.1 Decisions

| | OD-1: rules recorded | OD-2: who runs the detector | P-2 + P-7: retention |
|---|---|---|---|
| **Recommended (unapproved)** | T-3 (`proposal_missing` 24 h, `proposal_review` 4 h, `quote_decision` 12 h), T-4 failure aging (24 h), T-5 (72 h), T-8 (one business day), T-10 (24 h) | An admin, by pressing "Scan now"; no scheduler | Build the mechanism with no expiry (`retention = null`); choose the value later |
| **Alternatives** | A subset; or none (defer 7.5F) | Scheduler under the DEC-2026-003 activation sequence (not proposed); or both later | A value now (90 days, 3 years or 7 years under CFG-011) |
| **Proposed mechanism** | Readers' own conditions; key `(rule, kind, subject, due_at)` | Key-serialized, try-locked, audited runs | Read-time expiry from one policy row; expired rows hidden from readback; admin purge after expiry only, sharing the scan lock, counts logged; updates always refused |
| **Decide with it** | P-1 (disputes under T-8 / T-9 / excluded) | P-3 (any admin or owner only) | P-7 (who purges; first hosted purge) |
| **Cannot give** | Complete breach history: a breach that starts and ends between scans is never recorded | Any delivery guarantee: a scan only happens when someone runs it | Retention of anything already purged |

### 10.2 What each approval covers

| Approval | Covers | Does not cover |
|---|---|---|
| **A. Implementation** (OD-1, OD-2, P-1, P-3) | Building 7.5F-1 and 7.5F-2 as specified, including the proposed `backend` CI step; local evidence; opening the PRs | Any hosted action, merge, scan or purge |
| **B. Hosted schema** | Dry run and push of the 7.5F-1 migration, before its merge (DEC-2026-037) | Merge, scans |
| **C. Release** | Merging 7.5F-1, then 7.5F-2 (each deploys) | Running anything |
| **D. Activation: first hosted scan** | One operator scan writing to the 7.5F tables in production | A schedule, alerts, notices |
| **E. Retention** (P-2, P-7) | A reviewed migration setting the value (with its own B-type push); the first hosted purge | Deleting unexpired rows (impossible by design) |

None of A–E authorizes new thresholds, notices, alerts, email, a scheduler, state changes or a backfill.

## 11. Validation of this PR

Documentation only. Revision 2 changes: this file; the 7.5E record (duplicates consolidated, dated status line updated); TRACEABILITY (four TRACE-159 rows consolidated into one, revision-1 status kept as dated history, 7.5F note updated); HANDOFF (duplicate line removed, 7.5F entry updated). The contract's revision-6 notes are unchanged. `git diff --check`, relative-link existence and `npm run scan:secrets`: results in the PR comment for revision 2. No code, test, migration, workflow or configuration change; no hosted read or write; no scan.

## 12. Revision history and Codex review

| Revision | Date (ET) | Head / base | Change |
|---|---|---|---|
| 1 | 2026-11-25 | `e18a4e6` on `main` `846dd34` | First plan |
| 2 | 2026-11-25 | on `main` `846dd34` | Codex F-1..F-6 applied (below); retention mechanism; read-cost limit stated; decision card split by approval; #204 duplicates consolidated |

**Codex 7.5F review (relayed by the owner, 2026-11-25 ET; recorded as Codex's technical direction, not owner approval):**

| ID | Defect in revision 1 | Direction | Applied in |
|---|---|---|---|
| F-1 | Run-key ownership was checked before any serialization, so overlapping same-key calls could both pass | Serialize the key, then recheck replay, actor and normalized parameters; cover concurrent same-key/same-actor and different-actor calls | §4.2 steps 1–5, §4.5; tests K, N |
| F-2 | Observations referenced a run row inserted after them | Valid foreign-key ordering with append-only records; verify at the commit boundary | §4.1 (start → observations → result, non-deferrable keys); test F |
| F-3 | `on conflict do nothing` under the cap let recorded keys consume the limit, so capped scans could stall | Exclude recorded keys before limiting; prove repeated capped scans progress | §4.2 step 7.3; test P |
| F-4 | A null run lookup was read as "did not commit" | Null means no committed result is visible yet; keep unknown; reuse the key | §4.3, §4.10; test U |
| F-5 | `observed_at` was described both as the evaluation instant and as later than it; the scan-gap metric claimed to bound missed breaches | Distinguish evaluation time from observation time; remove unsupported coverage guarantees | §4.6, §3.2, §4.3 summary; test T |
| F-6 | A finite retention class (P-2) conflicted with append-only guards and had no deletion path | Specify expiry, readback exclusion and an authorized purge | §4.11, §10; test R |
