# Phase 7.5F — SLA-breach observation: design and implementation plan (TRACE-159)

**Status:** **TECHNICAL PLAN REVIEW CLEAR** (Codex, relayed by the owner in this conversation, 2026-11-25 ET), **subject to final-head CI and owner decisions**. Revision 4. Documentation only. **Nothing here is approved or built.** OD-1, OD-2 and P-1..P-7 remain **unapproved** (contract §9; DEC-2026-068 keeps OD-1/OD-2 open). Codex's decisions are technical direction, not owner approval and not a GitHub review object. No implementation starts until the owner approves explicitly (§10). Every "recommended" or "proposed" owner item below is still to be decided.
**Dated note (2026-11-25 ET, after #207 merged as `80100d3`):** the owner approved OD-1, OD-2 and P-1..P-7 ([DEC-2026-069](DECISION-LOG.md); P-2 = 90-day logical retention) and the 7.5F-1 implementation; it is [recorded here](PHASE-7-SLA-BREACH-OBSERVATION-7-5F-1.md) for review. The plan text below is kept as reviewed; where it says unapproved or unbuilt, this note supersedes it. Hosted steps (§10.2 B–E) remain unauthorized.
**Revision 4 (2026-11-25 ET):** records Codex's final technical decisions (§12): D-1..D-7 and D-9 accepted, D-8 superseded (§9); F-7..F-10 accepted, with the 24-hour key start window, the 7-day technical retention floor and timestamp-bearing run keys, none of which decides P-2. Two clarifications: a purge capped at n deletes up to 4n physical rows, reported as logical and physical counts (§4.11); a key's embedded timestamp is neither proof of server issuance nor authorization (§4.2, §4.5.1). Reconciled with `main` `397922e` (§1).
**Revision 3 (2026-11-25 ET):** applies Codex's review of revision 2 (head `47cb9da`), relayed by the owner in this conversation, not as a GitHub review object, as F-7..F-10 (§12): an attempt's `57014` is resolved through lookup; logical expiry is separate from deletion eligibility; run keys get a retry lifetime that holds after expiry and purge; M-7 corrected. P-2 and P-7 stay owner decisions; Codex's 90-day recommendation is shown apart from the proposal to build with retention unset (§9, §10). **No indefinite-retention policy is approved.**
**Revision 2 (2026-11-25 ET):** applied Codex's 7.5F review F-1..F-6 (§12) and consolidated the #204 duplicates (§1.2). Revision 1 was head `e18a4e6`; revision 2 was head `47cb9da`.
**Date:** 2026-11-25 (America/New_York).
**Base:** `main` `846dd34` (#204 merge, 2026-11-25 22:14:10 UTC), fetched before revisions 1–3; unchanged between them. This dated baseline is kept as written. **Revision 4:** `main` had moved to `397922e` (#206, /services revision 1, TRACE-161), merged into this branch as `835befe`; no 7.5F fact changed (§1). Branch `claude/phase7-5f-sla-observation-plan`, PR #207.
**Authority:** the owner's 7.5F preparation instruction and revision instruction (2026-11-25 ET). [Operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) (OQ-1) §4 (T-1..T-11), §6.1 (proposed design), §7.2 HQ-5, §9 OD-1/OD-2, §10 step 5. [7.5C record](PHASE-7-OPERATIONS-STAGED-FAILURES-7-5C.md) (method, SF-6b). [7.5D record](PHASE-7-SUPPORT-FIRST-REPLY-7-5D.md) (first reply, R-7). [7.5E record](PHASE-7-ADMIN-NOTIFICATION-READBACK-7-5E.md) (F-2 unknown outcomes). Roadmap Phase 7 gate. CFG-010, CFG-011, CFG-015; DEC-2026-003, -006, -045 choice 8, -063. Precedents: `public.email_provider_events_purge` (operator purge, counts-only log), `private.run_promotion_release_sweep` (try-lock, logged skip).

## What this plan does not do

- No application, database, test, CI or configuration change. No hosted Supabase, Vercel, Stripe, Resend or PostHog call; GitHub was read only. No scan.
- No scheduler, notice, alert, email, booking, payment or email activation, now or in the slices it proposes.
- No new threshold. Every rule below is already approved (contract §4); everything else keeps "no approved threshold". No retention period is chosen (P-2), and no indefinite retention is approved: an unset value means "not yet decided", not "keep forever" (§4.11).
- Does not accept any part of Phase 7. An observation is not an alert: the gate's alert outcome stays MISSING (OD-5 external channel, HQ-6).

---

## 0. Summary

1. **Five rules have a breach instant that existing readers already compute:** T-3 (three quote kinds), T-4 failure aging, T-5, T-8 and T-10 (§2). The qualifying condition is exactly the reader's own; `due_at` comes from one named source timestamp. T-1, T-2, T-6, T-7, T-9 and T-11 are left out, with reasons; T-9 overlaps T-8 (P-1).
2. **Design (§4):** append-only run, run-result and observation tables in `private`, written only by one admin-invoked detector that **calls the existing queue readers**, restating none. A run key is serialized before anything is checked (F-1); rows are inserted in foreign-key order with non-deferrable keys (F-2); already-recorded episodes are excluded before the per-rule cap (F-3); a missing run is "not visible yet", never "failed" (F-4); evaluation time and observation time are separate columns (F-5); finite retention is a policy value with read-time expiry and an operator purge (F-6). A cancelled attempt never settles a run; the lookup does (F-7). Expired rows are hidden even while they cannot yet be deleted, and the purge is bounded for every table, including its own log (F-8). A run key can start a scan only within 24 hours of issue, so a key whose run expired or was purged can never scan again (F-9).
3. **What it can prove:** "the reader listed item X as past `due_at` under rule T-n, evaluated at `evaluated_at`, in data that includes every commit before `observed_at`". **What it cannot:** that no other breach happened. A breach that begins and ends between two scans leaves no record (§3.2). Observation counts are a lower bound; lag is time past due when observed, not breach duration; scan intervals are descriptive only.
4. **The cap bounds writes, not reads (§4.8).** Each reader still computes and materializes its whole queue; a slow read can time out the whole call, which then writes nothing.
5. **Delivery (§5, §8):** two PRs, **7.5F-1** database (migration, SQL 131, `scripts/sla-detector-concurrency.mjs` and one proposed CI step) then **7.5F-2** operator page. Implementation approval, hosted schema push, release, first hosted scan, retention setting and first hosted purge are separate authorizations (§10.2).
6. **Open (owner):** OD-1, OD-2; P-1..P-7 (incl. retention value and purge invoker; Codex recommends 90 days, which the owner has not approved). **Technical:** D-1..D-7 and D-9 accepted by Codex, D-8 superseded (§9); technical plan review clear, subject to final-head CI and owner decisions.

## 1. Baseline and reconciliation

| Item | Observation (2026-11-25 ET; GitHub read only) |
|---|---|
| `origin/main` | `846dd34` (#204). Before it: `24fd251` (#205, /services Option C), `01a5dd1` (#203), `afa0be8` (#202). Re-fetched for revision 2: unchanged |
| `origin/main`, revision 4 | `397922e` (#206 merge: `d2edbb1`, /services revision 1, TRACE-161). Merged into this branch as `835befe`. It touched no migration, SQL test, reader or 7.5F document; the only overlap was the TRACEABILITY table, resolved by keeping this branch's single TRACE-159 row (§1.2) and `main`'s TRACE-161 row unchanged. HANDOFF merged automatically with the /services entries kept. Latest migration and SQL test unchanged (`20261202001000`, 130) |
| Open PRs | #207 (this plan) and #206 (draft, /services revision 1, TRACE-161, not touched) |
| Migrations / SQL tests | Latest `20261202001000` (7.5D); latest SQL test `130_admin_notification_readback.sql`. This plan adds none |
| OD-1, OD-2 | **Not approved.** No DECISION-LOG, OWNER-APPROVALS or CONFIGURATION-DECISIONS entry; DEC-2026-068 says they stay open |
| Main CI | `846dd34` run 45711471570 success; `01a5dd1` run 45537955099 success |
| Codex review of #207 | Relayed by the owner (2026-11-25 ET): revision 1 as F-1..F-6, revision 2 as F-7..F-10 (in this conversation). No GitHub review object or Codex comment exists on #207 |

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
| M-7 | Episodes that crossed `due_at` before the first scan after deployment | **Still qualifying at the first scan:** observed by it, like any other listed item, with `observed_at` at that scan, so lag can be large. **Already ended before the first scan** (left the queue or reclassified): never recorded; there is no backfill (P-5). The ledger therefore starts with whatever is overdue at the first scan, not with every breach since deployment |
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

`private.operations_sla_retention` — single row (§4.11): `retention interval` (null = **not yet decided**: nothing expires, and the purge refuses), check `retention is null or retention >= interval '7 days'` (a technical floor above the 24-hour key retry lifetime, §4.5.1; not a retention policy), `decision_ref text`; changed only by a reviewed migration after the owner decides P-2.

`private.operations_sla_purges` — counts-only purge log (§4.11): `id`, `actor`, `applied_limit`; **logical** deleted counts (observations, runs, purge-log rows) and **physical** deleted row counts (observation, run-result, run-start and purge-log rows); remaining expired counts per class; `ran_at`.

Within one transaction a run start, its observations and its result are inserted in that order and commit together; another session sees all of them or none. No table has a deferrable constraint, so nothing is checked later at commit that was not already checked at its statement.

### 4.2 Detector: `public.admin_detect_sla_breaches(p_run_key uuid, p_limit integer default 200) returns jsonb`

`SECURITY DEFINER`, `search_path = ''`, volatile. The page gets each new key from `public.admin_sla_new_run_key() returns uuid` (admin only, volatile, **writes nothing**): a version-7 UUID whose first 48 bits are `clock_timestamp()` in milliseconds. A lost response costs nothing; the page asks again. That function is a convenience that uses the database clock, **not a control**. The detector cannot tell who generated a key, and the embedded timestamp proves neither server issuance nor authority to scan. Any caller can compose a version-7 UUID with a timestamp of its choosing. The detector validates the timestamp only as step 1 and step 4 specify and calls it the key's **issue time** (§4.5.1). Authorization is the separate admin check in step 1, applied on every call whatever the key.

Steps, in order:

1. Refuse unless `auth.uid()` holds `admin` (`42501`); refuse a null key, a key that is not version 7, or a key issued more than 5 minutes after `clock_timestamp()` (`22023`); refuse unless `transaction_isolation = 'read committed'` (`55000`): step 3 relies on a statement after the lock seeing rows committed while it waited, which REPEATABLE READ and SERIALIZABLE do not give.
2. **Normalize** the parameters: `applied_limit := least(500, greatest(1, coalesce(p_limit, 200)))`.
3. **Serialize the key (F-1):** `pg_advisory_xact_lock(hashtextextended('private.operations_sla_detector:key:' || p_run_key::text, 0))`, blocking. A second call with the same key waits here until the first commits or rolls back. (A hash collision between two different keys only serializes them; it cannot cause a replay, because step 4 compares the stored key.)
4. **Recheck after serialization:** select the run start and result for `p_run_key` in a new statement.
   - Exists, different `actor` → `22023` "Run key reused by another operator". Exists, same actor, different `applied_limit` → `22023` "Run key reused with different parameters". Nothing is written. (Checked whether or not the run has expired.)
   - Exists, same `actor`, same `applied_limit`, not expired (§4.11) → return the stored result with `replayed: true`. Nothing else runs.
   - Exists, same `actor`, same `applied_limit`, **logically expired** → return `{run_key, state: 'expired', replayed: true}` with none of the stored content. Nothing runs or is written (F-9).
   - Does not exist, key issued within the last 24 hours → this call owns the key.
   - Does not exist, key issued more than 24 hours ago → `22023` "Run key is too old to start a scan". Nothing is written. This is what a retry gets after its run was purged (F-9).
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
| `public.admin_sla_detector_run(p_run_key uuid)` | `{state: 'visible', run}`; `{state: 'expired'}` (present, logically expired, content withheld); or `{state: 'not_visible', retry_until}`: **no committed result is visible** (§4.10), with the end of the key's retry lifetime (§4.5.1). Never "failed". A plain read: it does not wait on the key lock |
| `public.admin_sla_observation_summary(p_from timestamptz, p_to timestamptz)` | Per rule: unexpired observation count, min/max lag; counts of runs by outcome and by rule status; first and last run in which each rule completed; the intervals between those runs, labelled descriptive; the fixed statement that counts are a lower bound and that intervals do not bound or estimate missed breaches. No coverage, completeness or miss-rate field |

Not in `supabase_realtime`; nothing forwarded to PostHog (AC-1 D-1); no `anon`, `service_role` or `public` execute.

### 4.4 Permissions

Execute on the key issuer, the detector, the four readbacks and the purge (§4.11): `authenticated` only, admin checked inside. Tables: owner only; RLS enabled with no policies. Operator = an account with the `admin` role, the same population that can read every queue today (R0: Josh only, DEC-2026-025); narrowing it is P-3 (scan) and P-7 (purge). No scheduler or `service_role` path is granted (OD-2).

### 4.5 Idempotency, concurrency and episodes

- **Same key, same actor, same normalized limit:** replays; never scans twice, including when the calls overlap (step 3 waits, step 4 then sees the committed run).
- **Same key, another actor or another limit:** refused after serialization; nothing written.
- **Same key, first call rolled back:** the waiting call finds no run and owns the key.
- **Different keys at once:** one scans; the other records `skipped` (step 5). Lock order is key lock (blocking) then scan lock (non-blocking), so no deadlock.
- **Same episode, later scans:** same unique key, excluded before the cap and counted as `already_recorded`. Only the first sighting is stored, **while its observation is retained** (D-6): the ledger cannot say how long a breach lasted. After that observation is purged, a still-overdue episode is recorded again as a new, unlinked row (M-10, §4.11).
- **Reopened T-8 ticket:** target and first reply are unchanged on reopen (7.5D R-7), so an unanswered reopened ticket is the same episode: no new row.
- **Repeated episodes:** a new subject (new proposal, quote revision, attempt, terms) or a new `due_at` (T-3 `since` reset; T-5 new completion notice) is a new row.

#### 4.5.1 Run-key lifetime, expiry and purge (F-9)

A run key's **retry lifetime** is the 24 hours after its issue time (the time inside the version-7 key, §4.2). Only within it can the key start a scan. The guarantees below do not depend on who made the key. The timestamp is part of the key, so every retry of a key carries the same issue time. A caller who chooses a timestamp can only move that key's window inside the step-1 bounds: no more than 5 minutes ahead, and any amount in the past, where an absent key is refused. Admin authorization is checked separately on every call (§4.2 step 1). Retention cannot go below 7 days (§4.1). A run's result is written no earlier than 5 minutes before its key's issue time (the future-time tolerance, §4.2 step 1), so the run expires at least 5 days after the key's retry lifetime ends. Inside the lifetime a committed run is therefore always present and unexpired, and a retry replays it.

| Retry with the same key, same actor and limit | Run committed? | Detector | Lookup (`admin_sla_detector_run`) |
|---|---|---|---|
| Within the lifetime | No (never reached the database, rolled back) | Scans; this call owns the key | `not_visible`, `retry_until` = issue time + 24 h |
| Within the lifetime | Yes (cannot be expired: 7-day floor) | Replays the stored result | `visible` |
| After the lifetime, run not expired | Yes | Replays the stored result (harmless; no scan) | `visible` |
| After the run's logical expiry, not purged | Yes | `{state: 'expired'}`; no content; nothing written | `expired` |
| After the run's purge | It did; the row is gone | `22023` "too old to start a scan"; nothing written | `not_visible`, `retry_until` in the past |
| After the lifetime, never committed | No | `22023`; nothing written | `not_visible`, `retry_until` in the past |

So **a key starts at most one scan, ever**: inside the lifetime because the run is still there to replay, and after it because the age check refuses, whether or not the run was purged. No tombstone of purged keys is kept; tombstones would themselves need indefinite retention. The page cannot tell "purged" from "never committed" once a run is gone. After the lifetime it says the key can no longer be retried and offers a new scan. That is safe: a call still holding the scan lock would make the new scan `skipped`.

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
- **When a read is too slow:** the role's statement timeout cancels the whole call (`57014`). PL/pgSQL `when others` does not catch a cancellation, so the per-rule savepoints do not contain it: the transaction rolls back and the call writes nothing (no run, result or observation; M-11). The `57014` settles that **attempt** only. It does not settle the **run** (the key): another attempt with the same key may have committed (F-7). A retry that waited on the key lock behind a still-running original can be cancelled while the original commits. The page resolves the run through the lookup (§4.10).
- No loop over the clock, no retry, no pagination of readers.

### 4.9 Partial failures

A rule whose reader or insert raises an ordinary error records `error` with its SQLSTATE; other rules still record; outcome `partial` (some) or `failed` (all). The result row is always written for an executed scan, so a rule failure is audited. A failure of the call itself (timeout, cancellation, lost connection before commit) writes nothing (§4.8).

### 4.10 Unknown outcomes (F-4; as 7.5E F-2)

An **attempt** is one call; the **run** is everything done under one key. Only the lookup (`admin_sla_detector_run`) reports on the run. No error an attempt receives does that, apart from a definite refusal of that attempt's parameters. A lookup that returns `not_visible` means **no committed result is visible**. An attempt may still be running (holding the key lock), may not have reached the database, may have rolled back, or (after expiry) the run may have been purged (§4.5.1). It is never treated as confirmed failure.

| Client sees | Page says / does |
|---|---|
| Result, `replayed: false` | The run's outcome and counts |
| Result, `replayed: true` | The stored result; "This scan had already run" |
| `skipped` | "Another scan or purge was running. Nothing was recorded." A new key for a retry |
| Definite refusal (`42501`, `22023`, `55000`) | The refusal |
| Timeout or cancellation (`57014`), on a first attempt or a retry | "This attempt was cancelled before it finished." The run is **not** settled (F-7): the page reads `admin_sla_detector_run(key)` as in the next row. It never says the scan recorded nothing or did not run |
| No response, network error | Status stays **unknown**: "We couldn't confirm whether the scan ran." Reads `admin_sla_detector_run(key)`: `visible` settles it; `expired` says the run exists but is past retention; `not_visible` keeps the status unknown ("No result is visible yet") and, before `retry_until`, offers **Try again with the same key**; after it, "This key can no longer be retried" and a new scan |
| Retry with the same key | Serializes on the key: waits for an in-flight attempt, then replays its committed result, or runs if nothing committed (§4.5.1 for expired and purged runs). A visible result or a retry's own result is the only definite answer; the page never infers one |
| Account changed while waiting | Discarded (`stale`), as 7.5E F-1; the pending key is dropped |

### 4.11 Retention: expiry, readback exclusion and purge (F-6)

The records are append-only for their whole retention period. Whether a row is **logically expired** (hidden) and whether it is **eligible for deletion** are separate questions (F-8). Deletion happens only after expiry, only through one authorized function, and in bounded batches.

| Part | Specification |
|---|---|
| Retention value | `private.operations_sla_retention.retention` (one row). The value and its CFG-011 class are the owner's decision (P-2; Codex recommends 90 days, §9). It is set or changed only by a reviewed migration that names the decision. **Null means "not yet decided"**: nothing expires and the purge refuses. Null is not a retention policy, and indefinite retention is not approved (§10). Floor: 7 days (§4.1, §4.5.1) |
| Logical expiry (hidden) | Computed on read, never stamped: `private.operations_sla_expired(ts) := retention is not null and ts < now() - retention`. It depends on time only, never on references. Observation: `observed_at`. Run (start and result together): the result's `finished_at`. Purge-log row: `ran_at`, under the same value unless P-2 says otherwise. Changing the value applies to every row at once, with no row update. An observation never outlives its run: `observed_at <= finished_at` for every row (the result is inserted last), so its run is visible whenever it is |
| Readback exclusion | Every readback and the summary drop logically expired rows at read time. This holds **even when the row cannot be deleted yet**, for example an expired run that an expired, unpurged observation still references. `admin_sla_detector_run` and a same-key retry return `expired` with no content |
| Deletion eligibility | Observation: logically expired. Run: logically expired **and** no observation row (expired or not) references it, so foreign keys hold at every step. Purge-log row: logically expired and not written by the current purge. A row can be expired for some time before it is eligible; it stays hidden throughout |
| Purge | `public.admin_purge_sla_records(p_limit integer default 100) returns jsonb`: admin only (P-7), operator-invoked, no scheduler. READ COMMITTED required (`55000`). **Refused with `55000` while retention is null, and writes nothing.** It try-locks the **same** scan lock as the detector (busy → a logged `skipped`), so a purge and a scan never overlap. Each phase deletes eligible rows oldest first, at most the clamped limit (1–1,000), `for update skip locked`: (1) observations by `observed_at`; (2) runs (result, then start) by `finished_at`, eligible after phase 1 within the same transaction; (3) purge-log rows by `ran_at`. The limit applies to **logical** items: at most n observations, n runs and n purge-log rows. Every committed run has exactly one start row and one result row, because they commit together, so one run is two physical rows. **A call with limit n therefore deletes at most 4n physical rows** (n + 2n + n). Then it inserts one `private.operations_sla_purges` row with the actor and applied limit. It records logical counts deleted per class (observations, runs, purge-log rows) and physical rows deleted per table (observations, run results, run starts, purge logs; run results = run starts = runs). It also records the expired rows remaining per class (logical, capped at 10,000: `count(*)` over `limit 10001`), with runs also counted as "expired but still referenced". Every count names its unit; no total mixes the two units. It returns the same logical and physical counts and the oldest remaining expiry. Deleting old log rows is part of retention; each new log row records how many it deleted. Precedent: `email_provider_events_purge` |
| Append-only guard | A `before update or delete` trigger on the observation, run-start, run-result and purge-log tables. UPDATE: always refused. DELETE: refused unless the transaction-local setting `private.operations_sla_purge` equals the current transaction id (set only by the purge function with `set_config(…, true)`) **and** the row is logically expired under the same function. So even the purge cannot remove an unexpired row. Table privileges remain the primary control (no client can delete); the trigger guards definer code and mistakes. The table owner can still bypass triggers; that is outside any function's control and is stated |
| Re-recording | An expired, unpurged observation still blocks its key (M-10); after its purge, a still-overdue episode is recorded again as a new row |
| Run keys | Expiry and purge never let a key scan twice (§4.5.1) |

### 4.12 Separation from the lifecycle worker's completion escalation

The DEC-2026-006 escalation stays a T-5 business action inside `run_lifecycle_batch` (flag, event, admin and homeowner rows, run record; inactive without a scheduler). The detector does not read `lifecycle_worker_runs` or `needs_admin_review`, writes neither, and does not count an escalation as an observation. A T-5 observation is recorded whether or not the batch has run, and the batch escalates whether or not the detector has run (contract §6.1).

## 5. Exact files and functions (after approval; numbers re-derived from `main` at the time)

Delivery stays **two PRs, in order**. 7.5F-2 starts after 7.5F-1 is merged.

**7.5F-1 database** (one PR; the hosted push is authorized separately and happens before merge, DEC-2026-037):

| File | Content |
|---|---|
| `supabase/migrations/20261203001000_phase7_sla_breach_observations.sql` | The five tables (§4.1, including the 7-day retention floor), guard trigger, `private.operations_sla_expired`, `public.admin_sla_new_run_key`, `public.admin_detect_sla_breaches`, the four readbacks, `public.admin_purge_sla_records`, grants. Additive; no existing function restated. The retention row carries the owner's P-2 value if decided by then; otherwise `retention = null` ("not yet decided", §4.11) |
| `supabase/tests/131_sla_breach_observations.sql` | §6 single-session groups; rolled back; synthetic `example.invalid` users; 7.5C fixed-clock method |
| `scripts/sla-detector-concurrency.mjs` | §6 multi-session groups with real commits, following `scripts/*-concurrency.mjs` |
| `.github/workflows/ci.yml` | **Proposed CI step (a CI change; needs approval with 7.5F-1):** in the `backend` job, after the existing concurrency steps, `- name: Concurrent SLA detector run keys, scans and purges (TRACE-159)` / `run: node scripts/sla-detector-concurrency.mjs` |
| Records | 7.5F implementation record, contract revision note, TRACEABILITY, HANDOFF |

**7.5F-2 operator page** (one PR; no migration):

| File | Content |
|---|---|
| `src/lib/slaObservations.ts` | Types; outcome mapping (§4.10), including `57014` → lookup and `not_visible` → unknown, `expired`, and `retry_until`; wording; lag formatting |
| `src/app/admin/sla-observations/page.tsx` | "Scan now" (a new key from `admin_sla_new_run_key` per click; the same key on "Try again" until `retry_until`), recent runs, observations by rule, the summary with the lower-bound and descriptive-interval statements, links to the existing queues for overdue-now work. Purge control shown only when retention is set (P-7) |
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
| **U unknown outcome** (F-4, F-7) | script + unit | Script: while a call is held in an uncommitted transaction, another session's lookup returns `not_visible`; a same-key retry blocks, then replays after commit; after a rollback the retry runs. **Held original, cancelled retry (F-7):** session A holds key K uncommitted; session B, with a low `statement_timeout`, retries K, waits on the key lock and gets `57014`. A then commits: a third session's lookup returns `visible` with A's result, exactly one start and one result exist, and B's next retry replays (`replayed: true`). Variant: A rolls back after B's cancellation: lookup `not_visible`; B's next retry runs and owns K. Unit: `57014` on a first attempt and on a retry leads to the lookup, never to "recorded nothing", "failed" or "did not run"; `not_visible` stays unknown and offers the same key before `retry_until` only |
| **T time semantics** (F-5) | SQL + unit | `evaluated_at` = transaction `now()`; `observed_at` per rule ≥ `evaluated_at` and differs between rules read in order; an item due at `now() + 1 µs` is not listed; summary has no coverage, completeness or miss-rate field; wording test rejects "all breaches", "complete coverage", "no breaches missed", "guarantee" |
| **R retention** (F-6, F-8) | SQL + script | Retention null: nothing expires; purge refused `55000` and writes nothing (no log row). Retention below 7 days refused by the check. Retention set inside the test: expired observations, runs and purge-log rows leave every readback and summary count; lookup returns `expired`. **An expired run still referenced by an expired, unpurged observation is hidden from every readback, the lookup and the summary while its deletion is refused (F-8)**; `observed_at <= finished_at` holds for every row. UPDATE refused on all four tables; DELETE refused outside the purge, and of an unexpired row even with the purge setting. Purge, with limit n and more than n eligible items in each class: deletes exactly n observations, n runs and n purge-log rows, oldest first, only eligible ones, so **4n physical rows** (2n of them run rows: n results and n starts); deletes a run only after its observations (same call or later); deletes expired purge-log rows but never its own; the log row's logical and physical counts each equal before/after counts of the matching tables (logical runs = run starts deleted = run results deleted), with remaining capped at 10,000; repeated purges drain every class to 0; M-10 re-recording after purge. Script: purge during a scan → `skipped`, and the reverse; two purges never delete a row twice |
| **Q run-key lifetime** (F-9) | SQL | Synthetic version-7 keys with chosen issue times, composed by the test, not by `admin_sla_new_run_key`, to show that the detector treats any key alike. A valid fresh key from a non-admin is refused `42501` (the timestamp grants nothing); backdated run rows inserted by the test as table owner. Refused (`22023`, nothing written): non-v7 key; key issued > 5 min ahead; absent key issued > 24 h ago. **Before expiry:** within the lifetime, a committed run replays and an absent run scans; after the lifetime with the run unexpired, it replays. **After expiry, unpurged:** the retry returns `expired` with no content, scans nothing and writes nothing; the lookup says `expired`. **After purge:** the retry gets `22023` ("too old"), scans nothing and writes nothing; the lookup says `not_visible` with `retry_until` in the past. Actor and limit mismatches are refused in every state. With retention at its 7-day floor, a run committed in the key's lifetime is unexpired at `retry_until` |
| **L unbounded read** (§4.8) | script | A large synthetic queue with a low session statement timeout: the call fails `57014` and leaves no start, result or observation; with a normal timeout the same queue scans and inserts at most the cap per rule |
| **M missed between scans** | SQL | Scan before `due`; source resolves after `due`; scan again → **0 observations** (M-1); T-10 reclassified to `not_acceptable` → 0 (M-3). **First scan (M-7, F-10):** with an empty ledger, an item overdue since before the first scan and still qualifying is observed by it, with `observed_at` at that scan and lag = `observed_at − due_at`; an item that crossed `due_at` and left the queue before the first scan is not recorded |
| **A access refusal** | SQL | Detector, readbacks and purge refused for anon, homeowner, provider (`42501`); no `service_role` or `anon` execute; direct `select`/`delete` on every table refused for `authenticated` |
| **S summary consistency** | SQL | Totals = sum of rules; summary counts = unexpired ledger counts; a rule forced to raise inside the test transaction → `partial`, SQLSTATE stored, other rules recorded |
| **Z unchanged business state** | SQL | Before/after a scan and a purge: row count and content md5 of every `public`/`private` table except the 7.5F tables; `notifications`, `job_events`, `support_ticket_events`, `lifecycle_worker_runs`, `net.http_request_queue`, `cron.job` unchanged; definition md5s of the five readers, `admin_operations_summary` and `run_lifecycle_batch` unchanged; money fingerprint unchanged |
| **E escalation separation** | SQL | SF-6 setup: T-5 observed with and without a prior `run_lifecycle_batch`; batch output, flag, event and rows identical with and without a prior scan |
| **P page** | unit, browser | Each §4.10 outcome and its wording; stale on account change; observations never labelled "still overdue"; lower-bound and descriptive-interval statements present; purge hidden while retention is null; non-admin refused |

Mutations (each must fail a named test): key lock removed or taken after the lookup (K1/K2); actor check removed (K2); limit not normalized or not compared (N); a deferrable foreign key or result inserted before the start (F); anti-join removed (P); `not_visible` mapped to failure (U); `57014` mapped to "recorded nothing" without a lookup (U); `observed_at := evaluated_at` (T); expiry filter removed from a readback (R); run expiry made to wait for unreferenced status (R, F-8); purge-log rows never deleted, or a phase not limited (R); physical run rows reported as logical runs, or a mixed total (R); purge allowed while retention is null (R); guard allows deleting an unexpired row (R); purge without the shared lock (R script); key age check removed, so a purged key scans again (Q); expired run replayed with content (Q); retention floor removed (R/Q); `<=` for T-8; T-10 without `+ 24h`; unique key without `due_at`; savepoint removed; a detector write to `notifications`; `service_role` granted; error message stored instead of SQLSTATE.

## 7. Acceptance criteria

1. Every §6 group passes, including K, N, F, P, U, T, R and L for findings F-1..F-6 and U (held original, cancelled retry), R, Q and M (first scan) for F-7..F-10; every listed mutation is caught; the unmutated control passes.
2. Clean replay of all migrations; full SQL suite, the new concurrency script, unit, lint, typecheck, secret scan and production build pass; money fingerprint and all pre-existing function definitions unchanged.
3. The detector observes exactly the reader's qualifying items for the approved rules, and nothing else.
4. No business table, notification, event, HTTP request or cron job changes in any test.
5. The page states, wherever observations appear, that they are a lower bound, that intervals do not bound missed breaches, and that overdue-now work is in the queues. An unconfirmed scan stays unknown, including after a `57014` on any attempt; only a visible result or a retry's own result settles it.
6. Logically expired rows are absent from every readback whether or not they can yet be deleted. Each purge deletes at most n eligible items per class, including purge-log rows (at most 4n physical rows). Its log row reports logical and physical counts, each matching the table changes. No purge runs while retention is unset.
7. Every call is admin-checked whatever its key. A run key starts at most one scan in its life: within its 24-hour retry lifetime a committed run replays; afterwards, an expired run returns `expired` and a purged or never-committed key is refused.
8. Records name the OD-1/OD-2 and P-decisions, each hosted step performed (or not) with its evidence, and keep HQ-5 open until a hosted staged breach is observed under its own authorization.

## 8. Rollout and rollback

**Rollout**, each step separately authorized (§10.2):

1. Owner approves OD-1, OD-2 and the P-choices needed for implementation (implementation approval).
2. 7.5F-1: build and local evidence → Codex review → owner-authorized `supabase db push --linked --dry-run` listing only the new migration → push → read-only readback (tables empty, retention row, ACLs, definition md5s, reader md5s unchanged, money fingerprint) → merge (deploys; no client calls the functions) → deployment READY readback.
3. 7.5F-2: build → Codex review → merge (deploys the page).
4. **Retention:** after P-2, a reviewed migration sets the value (its own push authorization), unless the value was already in 7.5F-1. Proposed (owner decides, §10): this step comes **before** the first hosted scan, so production never holds observations under an unset value.
5. **First hosted scan:** writes production rows to the 7.5F tables only; the owner's action, authorized on its own.
6. **First hosted purge:** the owner's action (P-7), once rows have expired.

No scheduler at any step.

**Rollback.** Application: `vercel promote <previous dpl_id>`; the database objects are unused without the page. Database, forward only: a migration revoking execute on the detector (and purge) stops new scans and keeps the records; dropping the objects needs the owner's decision about the retained rows (P-2). No business data is written, so nothing needs repair.

## 9. Open items

**Policy choices for the owner (not decided here; the last column holds recommendations and proposals only, none approved):**

| ID | Choice | Options | Recommendation / proposal (unapproved) |
|---|---|---|---|
| P-1 | Dispute and dispute-appeal tickets in the T-8 reader | (a) record as T-8, as the queue does; (b) record as T-9; (c) exclude | (a), labelled by ticket kind |
| P-2 | **Owner decision.** Retention value for observations, runs and the purge log, and its CFG-011 class | 90 days (operational logs); 3 years (support); 7 years (financial / completed service). Any value ≥ 7 days works with the mechanism (§4.11). **Indefinite retention is not an option on offer and is not approved** | **Codex recommendation:** 90 days (operational logs). **Separately, a build proposal (Claude), not a retention policy:** if P-2 is still open when 7.5F-1 is built, ship with the value unset (`null` = not yet decided: nothing expires, the purge refuses), and set the value by a reviewed migration before the first hosted scan (§8 step 4) |
| P-3 | Who may scan | Any admin (as queue access) or the project owner only (CFG-010) | Any admin |
| P-4 | Show derived first-reply lateness (`first_response_at > response_due_at`) | In 7.5F or later | Later |
| P-5 | Backfill from source history | None, or a derivation clearly labelled as not observed | None |
| P-6 | Expected manual scan cadence | None stated, or an operating practice | None; coverage is whatever scans happen |
| P-7 | **Owner decision.** Who may purge, and when | Any admin; owner only; only after the owner names a first purge | Proposal (Claude): the owner authorizes the first hosted purge; thereafter any admin, manually. No Codex recommendation relayed |

**Design questions: Codex's final technical decisions** (relayed by the owner in this conversation, 2026-11-25 ET; technical direction, not owner approval; no GitHub review object). The decision column is Codex's text as supplied. Revision 3 recorded that the review then relayed held no per-item ruling. These decisions replace that status.

| ID | Question | Proposed | Codex decision (as supplied) | Plan |
|---|---|---|---|---|
| D-1 | Call the public readers inside the detector, or extract private item functions | Call them: no restatement, one computation | **ACCEPTED:** call existing public queue readers; do not restate their computations. | §2, §4.2 |
| D-2 | T-10 `due_at = since + 24h` computed in the detector, or restate the reader to expose it | Detector, with a parity test | **ACCEPTED:** derive T-10 due_at as since + 24 hours, verified by parity tests. | §2; test B |
| D-3 | T-4 from `admin_quote_queue` `aged`, or `money_payment_exceptions` directly | `admin_quote_queue` | **ACCEPTED:** use admin_quote_queue for T-4’s qualifying aged items. | §2 |
| D-4 | Concurrent call with another key: record `skipped`, or raise | Record, after key serialization (§4.2 step 5) | **ACCEPTED:** record different-key contention as skipped, after key serialization and replay checks. | §4.2 steps 3–5; test K4 |
| D-5 | Per-rule savepoints, or all-or-nothing | Per rule; cancellations still abort the whole call (§4.8) | **ACCEPTED:** per-rule savepoints for ordinary errors; cancellation aborts the attempt, while the logical run’s outcome is resolved separately. | §4.8–§4.10; tests S, U, L |
| D-6 | First sighting only | Yes | **ACCEPTED:** first sighting per episode while its observation remains retained; document re-recording after purge. | §4.5, M-10, §4.11; test R |
| D-7 | Key includes `due_at`, so a moved timestamp makes a second row | Accept and report (M-6) | **ACCEPTED:** include due_at in the episode key and disclose timestamp-reset duplicates. | §4.1, M-6 |
| D-8 | `observed_at = as_of` | **Superseded by F-5:** `evaluated_at` and `observed_at` are separate (§4.6) | **SUPERSEDED:** separate evaluated_at from per-rule observed_at, using the revised semantics. | §4.6; test T |
| D-9 | Two PRs (database, page) | Yes | **ACCEPTED:** database PR first, operator-page PR second. | §5 |

**Carried unchanged:** #203 Codex re-review and READY readback of `01a5dd1` and `846dd34`; OD-3..OD-7, OD-5 external channel; AC-1 D-1, D-4, D-5, D-6; SD-1, SD-2; 7.5D F-1, O-1..O-3; every 7.3D gate; CFG-011; HQ-1..HQ-6. Phase 7 is not accepted.

## 10. Decision card

### 10.1 Decisions

| | OD-1: rules recorded | OD-2: who runs the detector | P-2 + P-7: retention (**owner decisions**) |
|---|---|---|---|
| **Recommended (unapproved)** | T-3 (`proposal_missing` 24 h, `proposal_review` 4 h, `quote_decision` 12 h), T-4 failure aging (24 h), T-5 (72 h), T-8 (one business day), T-10 (24 h) | An admin, by pressing "Scan now"; no scheduler | **Codex recommendation: 90 days** (CFG-011 operational logs). Not approved. P-7: no Codex recommendation relayed |
| **Build proposal (Claude), separate from the recommendation** | — | — | If P-2 is still open at build time, ship 7.5F-1 with the value unset (`null` = not yet decided: nothing expires, purge refused), and set the value by a reviewed migration **before the first hosted scan**. This is a build sequence, not a retention policy. P-7: the owner authorizes the first hosted purge; thereafter any admin |
| **Alternatives** | A subset; or none (defer 7.5F) | Scheduler under the DEC-2026-003 activation sequence (not proposed); or both later | 3 years or 7 years under CFG-011, or another value ≥ 7 days. **Not offered and not approved: indefinite retention** |
| **Proposed mechanism** | Readers' own conditions; key `(rule, kind, subject, due_at)` | Admin-checked on every call; key-serialized, try-locked, audited runs; timestamp-bearing run keys that can start a scan only within 24 hours of their embedded time, so a key never scans twice (F-9). The timestamp is not an authorization | Read-time expiry from one policy row (7-day floor). Expired rows are hidden even while they cannot yet be deleted (F-8). Bounded admin purge of expired observations, runs and old purge-log rows (limit n: at most 4n physical rows), sharing the scan lock, logical and physical counts logged; refused while unset. Updates always refused |
| **Decide with it** | P-1 (disputes under T-8 / T-9 / excluded) | P-3 (any admin or owner only) | P-7 (who purges; first hosted purge) |
| **Cannot give** | Complete breach history: a breach that starts and ends between scans is never recorded | Any delivery guarantee: a scan only happens when someone runs it | Retention of anything already purged |

### 10.2 What each approval covers

| Approval | Covers | Does not cover |
|---|---|---|
| **A. Implementation** (OD-1, OD-2, P-1, P-3) | Building 7.5F-1 and 7.5F-2 as specified, including the proposed `backend` CI step; local evidence; opening the PRs | Any hosted action, merge, scan or purge |
| **B. Hosted schema** | Dry run and push of the 7.5F-1 migration, before its merge (DEC-2026-037) | Merge, scans |
| **C. Release** | Merging 7.5F-1, then 7.5F-2 (each deploys) | Running anything |
| **D. Activation: first hosted scan** | One operator scan writing to the 7.5F tables in production. Proposed: given only after E has set the value | A schedule, alerts, notices |
| **E. Retention** (P-2, P-7) | The value chosen by the owner, in a reviewed migration (with its own B-type push) or in 7.5F-1; the first hosted purge | Deleting unexpired rows (impossible by design) |

None of A–E authorizes new thresholds, notices, alerts, email, a scheduler, state changes or a backfill. None of them approves indefinite retention; approving A with P-2 still open approves only the build sequence above.

## 11. Validation of this PR

Documentation only. Revision 4 changes this file, the TRACE-159 row and the HANDOFF entry, and merges `main` `397922e` (§1). Revision 3 changed the same three. For each revision, `git diff --check`, relative-link existence, `npm run scan:secrets` and CI on the final head are reported in that revision's PR comment. Revision 2 changed: this file; the 7.5E record (duplicates consolidated, dated status line updated); TRACEABILITY (four TRACE-159 rows consolidated into one, revision-1 status kept as dated history, 7.5F note updated); HANDOFF (duplicate line removed, 7.5F entry updated). The contract's revision-6 notes are unchanged. `git diff --check`, relative-link existence and `npm run scan:secrets`: results in the PR comment for revision 2. No code, test, migration, workflow or configuration change; no hosted read or write; no scan.

## 12. Revision history and Codex review

| Revision | Date (ET) | Head / base | Change |
|---|---|---|---|
| 1 | 2026-11-25 | `e18a4e6` on `main` `846dd34` | First plan |
| 2 | 2026-11-25 | `47cb9da` on `main` `846dd34` | Codex F-1..F-6 applied (below); retention mechanism; read-cost limit stated; decision card split by approval; #204 duplicates consolidated |
| 3 | 2026-11-25 | `22d0054` on `main` `846dd34` | Codex F-7..F-10 applied (below): attempt vs run after `57014`; logical expiry vs deletion eligibility, bounded purge including its own log; run-key retry lifetime with timestamp-bearing keys and a 7-day retention floor; M-7 corrected. P-2/P-7 shown as owner decisions, with Codex's 90-day recommendation apart from the null-value build proposal; AC 5–7 and the decision card updated |
| 4 | 2026-11-25 | on `main` `397922e` (merge `835befe`) | Codex's final technical decisions recorded (below; D-1..D-9 in §9); 4n physical-deletion bound with logical and physical counts; key timestamp not issuance proof or authorization; `main` reconciled; status: technical plan review clear, subject to final-head CI and owner decisions |

**Codex 7.5F review (relayed by the owner, 2026-11-25 ET; recorded as Codex's technical direction, not owner approval):**

| ID | Defect in revision 1 | Direction | Applied in |
|---|---|---|---|
| F-1 | Run-key ownership was checked before any serialization, so overlapping same-key calls could both pass | Serialize the key, then recheck replay, actor and normalized parameters; cover concurrent same-key/same-actor and different-actor calls | §4.2 steps 1–5, §4.5; tests K, N |
| F-2 | Observations referenced a run row inserted after them | Valid foreign-key ordering with append-only records; verify at the commit boundary | §4.1 (start → observations → result, non-deferrable keys); test F |
| F-3 | `on conflict do nothing` under the cap let recorded keys consume the limit, so capped scans could stall | Exclude recorded keys before limiting; prove repeated capped scans progress | §4.2 step 7.3; test P |
| F-4 | A null run lookup was read as "did not commit" | Null means no committed result is visible yet; keep unknown; reuse the key | §4.3, §4.10; test U |
| F-5 | `observed_at` was described both as the evaluation instant and as later than it; the scan-gap metric claimed to bound missed breaches | Distinguish evaluation time from observation time; remove unsupported coverage guarantees | §4.6, §3.2, §4.3 summary; test T |
| F-6 | A finite retention class (P-2) conflicted with append-only guards and had no deletion path | Specify expiry, readback exclusion and an authorized purge | §4.11, §10; test R |

**Codex review of revision 2 (head `47cb9da`), relayed by the owner in this conversation, 2026-11-25 ET.** No GitHub review object or comment. Recorded as Codex's technical direction, not owner approval. Text as supplied:

> Correct:
> 1. A same-key retry receiving 57014 may have timed out while the original committed. Resolve the logical run through lookup; absent visible evidence remains unknown. Add a held-original/cancelled-retry test.
> 2. Separate logical expiry from physical deletion eligibility. Expired runs must be excluded even when references prevent deletion. Specify bounded deletion and accounting for expired purge-log rows.
> 3. Define run-key retry lifetime and expired/purged-key behavior. Reconcile retention with replay guarantees and test retries before expiry, after expiry and after purge.
> 4. Correct M-7: preexisting, still-qualifying episodes can be observed at the first scan; historical episodes already ended are not backfilled.
>
> Keep P-2 and P-7 as explicit owner decisions. Show Codex’s 90-day recommendation separately from any proposal to build with null retention. No indefinite-retention policy is approved.

The relayed text contains no separate decision on D-1..D-9; §9 records that and marks none accepted.

| ID | Defect in revision 2 | Direction | Applied in |
|---|---|---|---|
| F-7 | A `57014` was shown as "recorded nothing", though a same-key retry can time out on the key lock while the original commits | Resolve the logical run through lookup; without visible evidence it stays unknown; held-original/cancelled-retry test | §4.8, §4.10 (attempt vs run); test U; AC 5 |
| F-8 | Run expiry waited until no observation referenced the run, so an expired run stayed visible; purge-log rows had no deletion path or accounting | Separate logical expiry from deletion eligibility; hide expired runs even when references block deletion; bounded deletion and accounting for expired purge-log rows | §4.11 (expiry, eligibility, three-phase bounded purge, per-class counts; refused while unset); §4.1; test R; AC 6 |
| F-9 | A run key had no defined lifetime; after expiry or purge a retry could replay hidden content or start a second scan | Define retry lifetime and expired/purged-key behaviour; reconcile retention with replay; test before expiry, after expiry and after purge | §4.2 (timestamp-bearing v7 keys, age checks, `expired` reply), §4.5.1, §4.1 (7-day floor), §4.3 `retry_until`; test Q; AC 7 |
| F-10 | M-7 said every breach before the first scan is absent | Preexisting, still-qualifying episodes are observed at the first scan; ended ones are not backfilled | §3.2 M-7; test M |
| P-2, P-7 | The card showed "build with null" as the retention recommendation | Keep both as explicit owner decisions; show Codex's 90-day recommendation apart from any null-build proposal; no indefinite retention approved | §9, §10.1, §10.2, §8, header |

**Codex final technical decisions on revision 3 (head `22d0054`), relayed by the owner in this conversation, 2026-11-25 ET.** No GitHub review object. Technical direction, not owner approval. D-1..D-9 are recorded verbatim in §9. The rest, as supplied:

> Codex accepts the F-7..F-10 corrections and the proposed 24-hour key start window, seven-day technical retention floor and timestamp-bearing run keys. These do not decide P-2.
>
> Clarify:
> - A cap of n observations, n runs and n purge logs permits up to 4n physical deletions because runs have start/result rows. Report logical and physical counts accurately.
> - UUID timestamps are not proof of server issuance or an authorization mechanism. Validate them as specified; retain admin authorization independently.

| Clarification | Applied in |
|---|---|
| Up to 4n physical deletions; logical and physical counts | §4.1 purge log, §4.11 purge; test R; mutation list; AC 6; decision card |
| Key timestamp is not issuance proof or authorization | §4.2 (issuer is a convenience; admin check on every call), §4.5.1; test Q (test-composed keys; non-admin with a valid key refused); decision card |

**Outcome: technical plan review clear, subject to final-head CI and owner decisions.** OD-1, OD-2 and the P-choices (P-1..P-7, including the P-2 retention value) remain unapproved. Implementation, any migration push, scan, purge or hosted change each still needs the owner's separate authorization (§10.2).
