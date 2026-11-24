# Phase 7.5A — Operations queues, ownership and SLA contract (TRACE-159)

**Status:** CONTRACT FOR REVIEW (Codex), revision 2. Documentation and planning only. It approves no policy, sets no threshold, implements nothing and activates nothing.
**Matrix version:** OQ-1 (revision 2, 2026-11-22 ET: Codex's 7.5A review applied, §12). Revision 3 (2026-11-23 ET) adds only the §7.1 coverage note for 7.5C.
**Checkpoint (revision 2):** 2026-11-22 (America/New_York), `main` `83c8fea` (#194 merge), merged into this branch. Every source reference below was rechecked at this commit: #194 changed no migration and no admin source, so all line references still hold.
**Original baseline (history, 2026-11-22 ET):** `main` `63c8010` (#193 merge), the commit the first revision was written against (§1).
**Branch:** `claude/phase7-5a-operations-queues-contract`, from `main` `63c8010`, with `main` `83c8fea` merged.
**Authority:** the owner's Phase 7.5A instruction (2026-11-22). Roadmap Phase 7 ("Create owned operational queues with age, priority, SLA, alert, and next action"; gate: "staged failures and SLA breaches create the correct alert, queue item, audit event, and user communication"). MPS §5, §6.2–§6.6, §9, §10, §11, §12. MTS §10 (webhook step 7), §11 detective controls, §14, §15 item 6. CFG-009, CFG-010, CFG-015. [PHASE-6-ADMIN-OPERATIONS-BRIEF](PHASE-6-ADMIN-OPERATIONS-BRIEF.md) (TRACE-136). [Analytics coverage contract](PHASE-7-ANALYTICS-COVERAGE-CONTRACT.md) (AC-1, TRACE-158). [Notification contract](PHASE-7-NOTIFICATION-CONTRACT.md) (NM-1, TRACE-152).

## What this slice does not do

- **Independent of 7.4C.** #194 (7.4C, `request_started` once per draft) was open when revision 1 was written and was not incorporated. It has since merged (`83c8fea`) and is now in this branch's history through a merge of `main`. Nothing here depends on it. The D-2 decision it records is outside this scope.
- **Read-only.** No hosted query, no Supabase, Vercel, Stripe, Resend or PostHog call. Hosted state is cited only as history from earlier records.
- **No application, database, CI, email, scheduler, retry, suppression, booking, payment or profile change.**
- **Carried unchanged:** every 7.3D email activation gate (EO-1..EO-8, PG-1/G-1, H- and T-checks, the §7 owner card); O-1..O-9; CFG-011 90-day log retention (unmet); AC-1 D-1..D-6; NM-1 open items. Nothing here accepts any part of Phase 7.

---

## 0. Summary

1. **Fourteen queue families (Q-01..Q-14); ten have a server reader.** Quote aging, payment exceptions (read through the quote reader), recurring-visit payment, fulfillment, cancellation, offers at other terms, support, compliance renewal, finance exceptions and email failures are computed by `SECURITY DEFINER` database functions with a role check. Disputes (Q-09) are read through the support reader and, on `/admin/disputes`, from the `disputes` table under row-level security. Coverage interest (Q-14) is an aggregate, not a work queue. Sourcing (Q-01) and applications awaiting review (Q-12) have no server queue (TRACE-136 §12.4 item 4).
2. **Aging is computed on every read, by design.** DEC-2026-045 implementation choice 8 computes queue items from recorded events "so they cannot be skipped or reset". The cost: no general breach observation exists. No queue records when an item crossed its threshold, so no SLA history, breach rate or lag can be reported. Recording must add an observation record next to the computed queue, never replace it (§6.1).
3. **One approved escalation is already built to record itself, but never runs.** This is the only exception to item 2, and it is a different kind of record. `run_lifecycle_batch` records the DEC-2026-006 72-hour completion escalation as a state change (`needs_admin_review`), a `flagged_for_admin_review` `job_events` row, an admin in-app row, a homeowner notice and a run record. It flags each job once, and a replayed run ID writes nothing (§7.1 SF-6b). It runs only when invoked, and no scheduler job is installed (DEC-2026-003/004/010). It covers T-5 only, and it is a business action, not a breach observation (§6.1).
4. **There is no operator alert channel.** Admin in-app rows are written but cannot be read (NM-1 §4.1). No error-monitoring or uptime provider is selected (MTS §15 item 6). MTS §10 step 7 and §11 alerts are MISSING.
5. **Ownership is approved only as "the project owner".** CFG-010 names the project owner as escalation owner until a delegate is recorded. DEC-2026-025 makes Josh the sole admin for R0 (not carried to R1). Only support tickets store an owner and an assignee.
6. **Three defects in existing behavior** (§5): the overview always shows 0 aged fulfillment items (DF-1); it omits the offers-at-other-terms queue (DF-2); support "past response target" measures "still open", not "not yet answered" (DF-3).
7. **Two AC-1 statements need correction** (§6.2, §6.3). The live matcher no longer computes an eligible-provider count at all; AC-1 L-1 cited a superseded function body. The only "sourcing" state ever produced came from the superseded Phase 1 matcher.
8. **Recommended first slice, 7.5B (§8):** repair DF-1 and DF-2 in one function-only migration with summary parity tests. No owner policy decision is needed. The hosted push needs the owner's authorization (DEC-2026-037).

---

## 1. Baseline

### 1.1 Revision 2 recheck (2026-11-22 ET)

| Item | Observation |
|---|---|
| `origin/main` | `83c8fea` (#194 merge). Fetched before the revision; merged into this branch (the merge conflicted only in TRACEABILITY and HANDOFF, both resolved by keeping every entry) |
| Changes since the original baseline | #194 only: analytics client, request intake, its tests and the AC-1 / 7.4C records. No migration, admin page, `adminOperations.ts` or SQL test changed, so every source reference in this contract still holds |
| Open PRs | #196 (this PR) only |
| Migrations | Latest file still `20261129001000`. This slice adds none |
| Hosted | Not queried |

### 1.2 Original baseline (history, as written for revision 1 on 2026-11-22 ET)

| Item | Observation (2026-11-22) |
|---|---|
| `origin/main` | `63c8010` (#193 merge). Fetched before work |
| Open PRs | #194 only (7.4C, head `e68cfcf`, no migration). Not touched |
| Migrations | Latest file `20261129001000`. This slice adds none |
| Hosted | Not queried. Last recorded hosted state: HANDOFF 7.3D preflight (235/235 migrations, `pg_cron` 0 jobs) |
| Local working tree | `next dev`'s generated `AGENTS.md` block is uncommitted and left out of this PR |

## 2. Status vocabulary

| Status | Meaning |
|---|---|
| APPROVED | An owner decision, CFG entry or approved authority states the rule |
| IMPLEMENTED | Source produces the behavior, and a test asserts it |
| IMPLEMENTED — UNTESTED | Source produces it; no test asserts it |
| MISSING | Required by an approved authority; no producer |
| DEFECT | Source behavior contradicts an approved rule or its own stated contract |
| PROPOSED | A recommendation needing an owner (or Codex) decision; not approved |

## 3. Cross-cutting facts

| ID | Fact | Evidence |
|---|---|---|
| X-1 | **Accountable role vs. assignment.** Approved: the project owner is the support escalation owner until a delegate is recorded (CFG-010); Josh is the sole admin in R0 (DEC-2026-025, an exception that does not carry to R1). Implemented: `support_tickets.queue_owner` is always `project_owner`, and `assigned_to` is optional. No other queue stores an owner or an assignee; any admin may act. MPS §6.6 requires an owner for every open dispute and support request, which support satisfies through `queue_owner` | [route_support_ticket](../supabase/migrations/20261103001000_phase6_support_disputes.sql#L154) |
| X-2 | **Read-time aging.** Every queue function computes items at `now()` from source rows. Nothing stores "entered queue", "aged", "breached" or "acknowledged", except the records named per queue in §4 | DEC-2026-045 implementation choice 8 |
| X-3 | **No scheduler.** Supabase Cron is selected but no job is installed or active. `run_lifecycle_batch` (quote expiry, offer expiry, completion notices, 72-hour escalation) runs only when called. Offer and quote expiry also run when `/admin/requests`, the homeowner dashboard or vendor jobs load (`expire_stale_matches`, F613-17) | [SUPABASE-CRON-SETUP](SUPABASE-CRON-SETUP.md); [run_lifecycle_batch](../supabase/migrations/20260904007000_phase4_confirmation_schedule.sql#L3); [requests/page.tsx:233](../src/app/admin/requests/page.tsx#L233) |
| X-4 | **No alert channel.** Admin in-app rows are written for applications, quotes, fulfillment, disputes, support and cancellations, but no admin screen lists them (NM-1 §4.1). Owner email covers vendor applications, contact submissions and renewal documents only. No error/uptime provider is in `package.json`, and MTS §15 item 6 is undecided | NM-1 §4.1, §5.0 |
| X-5 | **Summary surface.** `admin_operations_summary` (TRACE-136 A8) feeds `/admin`. SQL 108 asserts count parity with each queue. **Aged parity is not asserted** | [summary](../supabase/migrations/20261109001000_phase6_admin_operations_review_fixes.sql#L329); [SQL 108](../supabase/tests/108_admin_operations.sql) |
| X-6 | **Access.** Every reader is `SECURITY DEFINER`, refuses non-operators with `42501` and is not granted to `anon`. Finance requires money authority (`restricted`, not `error`, on denial; SQL 108 Q3–Q5). Owner email requires `vendor_require_operator` | Per queue, §4 |
| X-7 | **Reachability.** R1 is not open and R0 admission is default-closed, so the request, quote, payment, fulfillment and payout queues should receive no Production items (AC-1 §6). Not queried | AC-1 §6 |

## 4. Approved timing rules (complete list)

Every timing rule an approved authority states. Anything not listed has **no approved threshold**.

| ID | Rule | Authority | Effect | Implemented |
|---|---|---|---|---|
| T-1 | One exclusive offer for 4 hours | CFG-009 | Offer expires; next offer or exhaustion | Lazily, on read or batch (X-3) |
| T-2 | Quote expires 24 hours after sending | DEC-2026-008 | State change | `expire_request_quotes`, on read or batch |
| T-3 | Proposal missing 24 h; awaiting operator send 4 h; awaiting homeowner 12 h | CFG-015 (DEC-2026-045 G4) | Queue item only; aged at threshold | `admin_quote_queue` |
| T-4 | Confirmed payment failure: queued immediately, aged at 24 h. Unresolved outcome: queued immediately | CFG-015 (G6) | Queue item only | `private.money_payment_exceptions` |
| T-5 | Unanswered completion escalates to admin review at 72 h; silence never confirms | DEC-2026-006 | Admin-review flag; queue item | Batch flag (inactive) and fulfillment queue |
| T-6 | Accepted, unpaid recurring visit visible from appointment − 24 h (or later acceptance) | DEC-2026-049 item 6 | Queue item | `private.recurring_payment_queue` |
| T-7 | Replacement search ends at appointment − 24 h; a withdrawal inside it goes to operations at once | DEC-2026-053 E5 | Exhaustion | `replacement_search_closed` |
| T-8 | Support response within one business day (Mon–Fri 9–5 ET); same-day priority for a same-day appointment during hours | CFG-010 | Response target | `support_response_deadline` (8 support hours) |
| T-9 | Dispute acknowledgement under CFG-010; resolution target after pilot data; no provider response deadline | DEC-2026-054 items 3–4 (approved by DEC-2026-060 D-6a) | Response target only | As T-8 on the dispute ticket |
| T-10 | Unanswered offer terms visible to operations after 24 h; no automatic timeout | DEC-2026-063 | Queue item | `admin_offer_terms_queue` |
| T-11 | Compliance evidence "expiring" within 30 days, "lapsed" after expiry; flags only | Owner decisions 2026-09-13 ([PHASE-5-EVIDENCE-RENEWAL](PHASE-5-EVIDENCE-RENEWAL.md)) | Queue entry | `vendor_renewal_notice()` |

**No approved threshold** (MPS §2 sets targets "after an instrumented pilot baseline"; OWNER-APPROVALS leaves operational SLAs open): sourcing deadline (MPS §9 "close transparently by deadline"), fulfillment exceptions, unverified evidence, cancellation follow-up, dispute resolution, finance and payout exceptions, applications awaiting review, email failures, and the MTS §14 baselines (stated as proposals "requiring owner approval").

**Implemented windows that are not owner-approved SLAs:** the 10-minute email stale window (`missed`/`unknown`, [R0-VENDOR-READINESS](R0-VENDOR-READINESS.md), TRACE-104) is a technical detection window. The recurring-payment `due_at` (appointment start, after which an item is aged) is an implementation choice; DEC-2026-049 item 6 sets visibility, not an aging time.

---

## 5. Matrix OQ-1 — queues

### 5.1 Entry, scope and timing

| ID | Queue (MPS §9) | Trigger and authoritative source | Eligible → leaves (terminal) | Accountable / assigned | Age, priority, SLA | Status |
|---|---|---|---|---|---|---|
| Q-01 | Sourcing / matching | Request needs a provider: pending offer (`job_match_attempts`), `exhausted` or `awaiting_consent` with `needs_admin_review`. **No server queue**; `/admin/requests` badges, a client "overdue" for `matched` past `match_expires_at` ([:532](../src/app/admin/requests/page.tsx#L532)), and a `needs_admin_review` list on `/admin/quality` | → accepted, next offer, operator offer or release, cancelled | Project owner (X-1) / none | T-1 applied lazily; exhaustion has no age or deadline; no priority | PARTIAL |
| Q-02 | Offers at other terms (O-10) | [`admin_offer_terms_queue`](../supabase/migrations/20261118001000_phase6_o10_review_forward_fix.sql#L941): `unanswered`, `not_acceptable`, `blocked_inactive`, `rematch_failed` | → terms answered, retry after block, rematch succeeds | Project owner / none | T-10 for `unanswered`; others immediate; ordered by `since` | IMPLEMENTED (SQL 116/117) |
| Q-03 | Quote aging | [`admin_quote_queue`](../supabase/migrations/20261027001000_phase6_recurring_payments.sql#L453): `proposal_missing`, `proposal_review`, `quote_decision` (T-3); `deposit_review`, `provider_review`, `accepted_change` (no threshold) | → proposal submitted, sent, decided; exception closed | Project owner / none | `since`, `due_at`, `aged`; aged first | IMPLEMENTED (SQL 090 boundaries) |
| Q-04 | Payment exception and unpaid one-time jobs | Inside Q-03 via [`money_payment_exceptions`](../supabase/migrations/20261027001000_phase6_recurring_payments.sql#L320): `payment_failed`, `payment_unresolved` | → capture, new attempt, reconciliation resolved | Project owner / none | T-4. **A scheduled one-time job with no checkout attempt is in no queue**; it shows only in the record dialog ([:468](../src/app/admin/requests/page.tsx#L468)), and the start guard blocks unpaid starts (DEC-2026-050 A) | IMPLEMENTED for T-4; gap G-4 |
| Q-05 | Recurring visit payment | [`recurring_payment_queue`](../supabase/migrations/20261027001000_phase6_recurring_payments.sql#L408): `review_missing`, `ready_unpaid`, plus T-4 kinds | → paid, cancelled | Project owner / none | T-6; aged after the appointment start (implementation choice) | IMPLEMENTED (SQL 097) |
| Q-06 | Schedule / fulfillment exception | [`fulfillment_queue_items`](../supabase/migrations/20261029001000_phase6_fulfillment.sql#L266): `confirmation_overdue` (T-5), `fulfillment_exception`, `evidence_unverified` | → follow-up recorded after `since`, state change | Project owner / none | `since` only; **no `aged` field**; ordered by `since` | IMPLEMENTED (SQL 098 72 h boundary); DF-1 |
| Q-07 | Cancellation follow-up | [`admin_cancellation_queue`](../supabase/migrations/20261101001000_phase6_exceptions.sql#L800): cancelled with an obligation, or provider cancel / no-show, while follow-up remains | → follow-up empty | Project owner / none | No age; ordered by `updated_at` | IMPLEMENTED (SQL 101) |
| Q-08 | Support | [`admin_support_queue`](../supabase/migrations/20261103001000_phase6_support_disputes.sql#L692): open / in-progress tickets | → `resolved`, `closed` | `queue_owner = project_owner` / optional `assigned_to` | T-8 as `response_due_at` at open; `overdue` = still open after it (DF-3); same-day first | IMPLEMENTED (SQL 011, 103) |
| Q-09 | Dispute | Dispute tickets in Q-08, plus `/admin/disputes` (`disputes`, `admin_decide_dispute`) | `open`, `vendor_contacted`, `escalated` → `resolved` | As Q-08 | T-9 (acknowledgement only); no resolution target | IMPLEMENTED (SQL 103) |
| Q-10 | Payout, refund and reconciliation exceptions | [`money_finance_reconciliation`](../supabase/migrations/20260923001000_money_late_reversals.sql#L1285): ledger mismatch, provider event (failed / dead-letter webhook), checkout reconcile, refund pending / failed late, chargeback, payout hold, provider owes, customer refund owed, bank outcome / line / unevidenced, and others | → the source row resolves | Money-authority holder (0 hosted, per TRACE-136 history) / none | `since` only; no threshold | IMPLEMENTED (SQL 042–050) |
| Q-11 | Compliance expiry | `vendor_evidence_renewal_queue`, `vendor_renewal_document_queue` | → renewed, lapsed flag | Project owner / none | T-11 | IMPLEMENTED (SQL 039–041) |
| Q-12 | Onboarding / applications awaiting review | `/admin/applications` list (client-derived onboarding state, newest first). **No server queue** | → onboarding decision, closure | Project owner / none | No age or threshold | PARTIAL |
| Q-13 | Email failures | [`owner_email_overview`](../supabase/migrations/20261122001000_phase7_owner_email_ledger.sql#L308) (contact, renewal) and the application ledger on `/admin/recruiting`: `failed`, `missed`, `unknown`, `resend_requested` | → `sent`, `acknowledged` | Project owner / none | 10-minute stale window (not an SLA); exact attention counts | IMPLEMENTED (SQL 071, 120). Not in the summary |
| Q-14 | Coverage interest | R0 interest on `/admin/recruiting` | Aggregate only (MPS §9) | Project owner / none | n/a | IMPLEMENTED (R0) |

### 5.2 Action, alert, audit, control and verification

| ID | Existing next action | Alert / escalation | Audit evidence | Access / replay | Gaps |
|---|---|---|---|---|---|
| Q-01 | `create_job_offer` (reason; eligibility enforced), `release_job_match` (reason) | None. Homeowner exhaustion/consent message ABSENT (N-REQ-04). Provider offer row (N-REQ-01) | `job_match_attempts` outcome; `job_events` offered/declined/expired. Expiry `responded_at` is the processing time; `expires_at` keeps the deadline. Exhaustion: `needs_admin_review` and `updated_at` only (AC-1 L-4); `offer_terms_blocks` for gate blocks | Admin; offer command logs before-state (F613-16) | G-1 no server queue or deadline; G-2 no pool record (§6.2) |
| Q-02 | `admin_retry_offer_terms_matching` (keyed, reason) | Admin row for a failed re-match (N-QTE-11, write-only) | `offer_terms_blocks`, `offer_terms_retries`, `offer_terms_rematch_failures`, `job_events` | Admin; retry key bound to actor and reason | Not in summary (DF-2) |
| Q-03 | Open request; operator send or return; close exception | **None, correctly**: CFG-015 forbids reminders and external messages | Source rows; aging and breach not recorded | Admin; close/review replay unprobed (F613-16) | G-3 breach unrecorded |
| Q-04 | Open request; start exception with reason (DEC-2026-050 A) | Payment notices ABSENT while payments are inactive (N-CXL-07) | Checkout attempts, webhook events, start exceptions | Admin | G-4 no item for "scheduled, never checked out" |
| Q-05 | Open visit; review and checkout per DEC-2026-049 | None; no notice by decision (N-REC-04) | As Q-04 | Admin | G-3 |
| Q-06 | `admin_record_fulfillment_follow_up` (keyed, reason, `40001` if closed) | Batch path only (inactive): admin row (write-only) and homeowner notice (N-FUL-06). Exceptions: N-FUL-07 | Follow-up `job_events`; batch `flagged_for_admin_review` event and `lifecycle_worker_runs` | Admin; key bound to actor, item, reason | DF-1; G-3 |
| Q-07 | Open request; follow-up per 6.9 | Cancellation notices N-CXL-01/02 | `job_operations`, assessments | Admin | No age |
| Q-08 | `admin_update_support_ticket` (versioned, keyed, reason), replies, notes | Admin row on open/reply (write-only); no requester acknowledgement message (N-SUP-01) | Append-only `support_ticket_events`, `support_ticket_messages` | Support operator; key bound to the full payload | DF-3; G-3 |
| Q-09 | `admin_decide_dispute` (keyed, stale-guarded) | N-FUL-09/10/11 | `dispute_decisions`, `dispute_appeals`, submissions | Admin | No resolution target (T-9) |
| Q-10 | Finance commands (TRACE-076–081) | **MISSING:** MTS §10 step 7 and §11 webhook, dead-letter and reconciliation alerts | Money journals and resolution rows | Finance authority | G-5 alerts |
| Q-11 | Renewal commands | No automated notice; Mercurius contacts the provider (2026-09-13 decision 4) | Evidence and renewal rows | Operator | — |
| Q-12 | Start review, decide, close | Owner email per application (ledgered) | Application and onboarding rows | Operator | G-1 no server queue |
| Q-13 | Resend with attestation; acknowledge with reason | The page is the alert; nothing pushes | Ledger rows and events | Operator; row-locked claims | Not in summary |
| Q-14 | Aggregate review | None | R0 interest rows | Operator | — |

### 5.3 Defects

| ID | Defect | Evidence | Effect |
|---|---|---|---|
| DF-1 | The summary counts fulfillment items whose `aged` is true, but `admin_fulfillment_queue` never emits `aged`. The count is always 0, and the overview prints "0 aged" | Summary tuple `('fulfillment', 'items', 'aged')` ([:338](../supabase/migrations/20261109001000_phase6_admin_operations_review_fixes.sql#L338)); item shape ([:292](../supabase/migrations/20261029001000_phase6_fulfillment.sql#L292)); `agedLabel: "aged"` ([adminOperations.ts:45](../src/lib/adminOperations.ts#L45)). SQL 108 asserts counts only | Contradicts TRACE-136 A8 (no number of its own). Every `confirmation_overdue` item is already past the approved 72 hours, so "0 aged" understates urgency |
| DF-2 | The summary omits `admin_offer_terms_queue` (added 2026-11-17, after the summary) | Summary list ([:338](../supabase/migrations/20261109001000_phase6_admin_operations_review_fixes.sql#L338)); queue on `/admin/requests` ([:406](../src/app/admin/requests/page.tsx#L406)) | The overview, described as the open work in each queue, misses `rematch_failed` items, which can arise while the gate is off (NM-1 N-QTE-11) |
| DF-3 | Support `overdue` is "open or in progress after `response_due_at`". A replied-to open ticket stays overdue; a ticket closed without a reply never is. The overview labels this "past response target" | [admin_support_queue](../supabase/migrations/20261103001000_phase6_support_disputes.sql#L692); `agedLabel` ([adminOperations.ts:47](../src/lib/adminOperations.ts#L47)) | Misstates CFG-010, a response target. The first operations reply visible to the requester is already derivable (`support_ticket_messages`, `author_role = 'operations'`, `visibility = 'participant'`) |

---

## 6. Reconciliations

### 6.1 SLA breaches: computed on read, not recorded (AC-1 O-2)

**Current.** Breach-like flags exist only at read time: Q-03/Q-05 `aged`, Q-08 `overdue`, Q-06 `confirmation_overdue`, Q-13 `missed`/`unknown`. Two durable records touch timing, and neither is a breach observation:

| Record | What it is | Why it is not a general breach observation |
|---|---|---|
| DEC-2026-006 completion escalation (`run_lifecycle_batch`) | A business action for T-5 only: sets `needs_admin_review`, logs `flagged_for_admin_review` with the 72-hour deadline, writes the admin and homeowner rows and a run record. Inactive (no scheduler) | It changes state and sends messages; it exists only if the batch runs; it covers one rule; it records when the batch acted, not when the threshold was crossed, and a job is flagged once whatever later happens |
| `needs_admin_review` on exhaustion | State, with no event (AC-1 L-4) | No rule, no deadline, no observation time |

So no general breach observation exists: for T-3, T-4, T-8 and T-10, and for T-5 on the read path, nothing records that an item crossed its threshold.

**Constraint.** Read-time computation is deliberate (DEC-2026-045 choice 8), and CFG-015 makes aging a queue item with no automatic action. A breach record must therefore be an *observation*. It must never change business state, send a message or replace the computed queue. It must also stay separate from the completion escalation: the escalation stays the T-5 business action under DEC-2026-006, and a T-5 observation, if OD-1 includes T-5, records the crossing whether or not the batch has run. Neither record is derived from the other, and neither replaces the other.

**Proposed design (for a later slice, after OD-1 and OD-2):**
- append-only `private.operations_sla_breaches`: rule ID (T-n only), queue, item kind, subject ID, `due_at` (the breach instant from source rows), `observed_at`, detector run ID; unique on (rule, subject, `due_at`) so repeated detection is idempotent;
- one detector function reads the same private item functions the queues read and inserts only new breaches;
- reported lag = `observed_at − due_at`, so a late detector is visible rather than hidden;
- operator-only aggregate readback; nothing forwarded to PostHog (AC-1 §3.2).

**Owner decisions:** OD-1 (which rules count) and OD-2 (who invokes the detector). §9.

### 6.2 Eligible-provider counts (AC-1 L-1): correction

AC-1 said `candidate_count` is "computed inside matching, then discarded" at `20260904000100:215`. That body is superseded. The live matcher, `private.offer_next_for_request_internal` (restated in [20261117001000:645](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L645)), **computes no count**. The count was used only by the Phase 1 matcher ([20260815120000:624](../supabase/migrations/20260815120000_phase1_matching_engine.sql#L624)), to choose `sourcing` over `exhausted`.

What is persisted today: offered candidates (`job_match_attempts`); for a gate-blocked one-time exhaustion only, the list of candidates skipped because the gate is off (`private.offer_terms_blocks.candidates`, [:725](../supabase/migrations/20261117001000_phase6_o10_offer_bound_terms.sql#L725)). MPS §5.2 `eligible_pool_created` and §6.2 "ranking … logged with a version" have no record, and no matching version is logged.

**Definitions needed before any migration (OD-3):** when a pool is "created" (first run only, or every run); whether the count is taken before or after excluding earlier attempts; whether gate-blocked candidates count; whether a matching or eligibility version is stored with it. Counts only, with no provider list beyond what `offer_terms_blocks` already holds.

### 6.3 "Sourced" (AC-1 L-5) and CFG-009

- CFG-009 and CFG-002 forbid claiming or implying active sourcing. MPS §9 still names a Sourcing queue ("find supply or close transparently by deadline") with no deadline set.
- The `sourcing` matching state is allowed by the check constraint but is produced by no live function. Only the superseded Phase 1 matcher set it (zero eligible candidates). Legacy rows may still carry it; hosted was not queried.
- Customer copy already treats `sourcing`, `exhausted` and `awaiting_consent` alike as "Awaiting provider" ([HomeownerJobDetailDialog.tsx:492](../src/components/dashboard/HomeownerJobDetailDialog.tsx#L492)).
- **No "sourced" outcome can be defined without OD-4.** Options (none recommended as approved): (a) no sourced outcome in beta; measure exhaustion and operator re-match only; (b) "sourced" = an exhausted request later accepted by a provider, with time to acceptance; (c) (b) plus an operator-recorded supply action. Option (a) is the smallest and keeps CFG-009 intact.

### 6.4 AC-1 D-1, D-4, D-5, D-6 (unresolved; no explicit approval exists on `main`)

| AC-1 | How this contract uses it | Still open |
|---|---|---|
| D-1 layer split | Every measure proposed here (breach records, pool counts) is an operational record (layer B). Nothing is sent to PostHog | Owner confirmation |
| D-4 sourced / pool size | Split into OD-3 (pool record definition) and OD-4 (sourced). §6.2, §6.3 | Both |
| D-5 breach recording, alerting, thresholds | Split into OD-1, OD-2, OD-5 (alert channel), OD-6 (thresholds where none exist) | All four |
| D-6 measurement surface | 7.5B repairs the existing overview's truthfulness; it creates no dashboard | Owner |

---

## 7. Staged-failure checks (Phase 7 gate)

Each check stages one failure and asserts four outcomes: **queue item**, **alert**, **audit record**, **user communication**. "Correct" follows the authority. Where an authority forbids a message (CFG-015, N-REC-04), the correct communication is **none**, and the check asserts that none was written.

### 7.1 Synthetic / local (proposed 7.5C; SQL, rolled back, synthetic `example.invalid` users)

Expected values are **current behavior**, pinned. Where a gap exists, the check asserts the gap explicitly ("alert: none"), so a later slice must change the expectation on purpose.

**These checks are characterization evidence, not Phase 7 gate acceptance.** A passing check that pins a missing alert (SF-1..SF-11, "alert: none"), a missing communication (SF-7, SF-8) or a known defect (SF-9 for DF-3, SF-12 for DF-1) proves only that current behavior is what this contract says. It does not show that the roadmap gate ("staged failures and SLA breaches create the correct alert, queue item, audit event, and user communication") is met. The gate stays open until the missing producers exist and the checks assert them. Where an authority forbids a message (CFG-015, N-REC-04), "communication: none" is already the correct outcome, but that check still does not accept the gate while its alert outcome is missing.

| ID | Stage | Queue item | Alert | Audit | Communication |
|---|---|---|---|---|---|
| SF-1 | Accepted quote-required job, no proposal, clock at 24 h − 1 µs / 24 h | none / `proposal_missing`, aged | none | acceptance row only | none (CFG-015) |
| SF-2 | Pending proposal at 4 h; sent quote at 12 h and at 24 h | `proposal_review`; `quote_decision` (`deadline_passed` at 24 h) | none | proposal / quote rows | none before expiry; N-QTE-06 on expiry via batch |
| SF-3 | Webhook `checkout_expired` unpaid; then + 24 h | `payment_failed`, aged at 24 h | none | attempt + webhook event | none (payments inactive, N-CXL-07) |
| SF-4 | Attempt in `reconcile` | `payment_unresolved`, never aged | none | attempt row | none |
| SF-5 | Accepted unpaid recurring visit at appointment − 24 h | `ready_unpaid` or `review_missing` | none | visit payment state | none (N-REC-04) |
| SF-6a | Completion notice at 72 h − 1 µs / 72 h; read path only | none / `confirmation_overdue` | none | none new | none new |
| SF-6b | Same, then `run_lifecycle_batch` twice with one run ID, then once with a new run ID | unchanged (item stays until follow-up) | admin row ×1 per admin (write-only); none added by the replay or the second run | `flagged_for_admin_review` ×1 in total. Run records: the first run inserts one; the same-run replay returns the stored summary with `replayed: true` and inserts none; the new run ID inserts a second run record (`admin_flagged` 0), because the job already has `needs_admin_review` | homeowner "under review" ×1 in total; none from the replay or the second run |
| SF-7 | Offer past 4 h with no other candidate; read via `expire_stale_matches` | none (no server queue); `needs_admin_review` | none | `match_expired` event; exhaustion has no event | none (N-REQ-04 ABSENT) |
| SF-8 | Support ticket opened Friday 16:30 ET; same-day appointment ticket at 10:00 | `response_due_at` Monday 16:30 ET / 17:00 the same day, `same_day` | admin row (write-only) | `opened` event | none (no acknowledgement message) |
| SF-9 | Operator replies before the due time; clock passes it | `overdue = true` (pins DF-3) | none | message row | N-SUP-03 |
| SF-10 | Owner email row `sending` older than 10 minutes | `unknown` in attention count | none | ledger row | n/a (operator email) |
| SF-11 | Stripe webhook row `dead_letter` | `provider_event` finance exception | **none (MISSING, MTS §10)** | webhook row | n/a |
| SF-12 | Summary after SF-6a | fulfillment count 1, aged 0 (pins DF-1 until 7.5B; then aged `null`) | — | — | — |

**Coverage note (2026-11-23 ET, revision 3; 7.5C).** SF-1..SF-12 are implemented as local characterization in `supabase/tests/128_operations_staged_failures.sql` (147 assertions, real readers and producers, rolled back); scenario-to-test map in the [7.5C record](PHASE-7-OPERATIONS-STAGED-FAILURES-7-5C.md) §3. The expectations above are unchanged and still read as written. Two differences were found and are reported there, not repaired: **SD-1** (SF-7: while the offer-terms gate is off, a one-time exhaustion is also listed as `blocked_inactive` in offers at other terms, so "queue item: none" does not hold) and **SD-2** (SF-8: the same-day branch reads `now()` inside the routing trigger, so it is exercised only by a run inside weekday hours). SF-6b matches RV-1 exactly. SF-12 is `aged: null` since 7.5B. Still characterization only, not gate acceptance.

### 7.2 Hosted (future; each needs separate owner authorization)

Preview builds share the production database (DEC-2026-037), so a hosted staged failure writes to Production. None is authorized. Each needs the same treatment as the 7.3D T-checks: named synthetic records, exact cleanup, a stop list, and an owner approval card.

| ID | Check | Gate before it can run |
|---|---|---|
| HQ-1 | Read-only: `admin_operations_summary` as the owner; every row `ready` or `restricted`; counts recorded | After 7.5B is merged and READY |
| HQ-2 | Read-only: each queue function's count (and aged count, where a rule exists) equals its summary row, **read from one consistent database snapshot**: the summary and every queue reader are called inside one `REPEATABLE READ READ ONLY` transaction as the same operator, then rolled back. Equal `checked_at` values alone are not enough: in the default `READ COMMITTED` level each statement inside these functions takes a fresh snapshot, so separate calls (or one call per request) can see different rows even at one `checked_at`. Inside one transaction `now()` is also fixed, so read-time aging is evaluated at one instant | HQ-1 |
| HQ-3 | Scheduler: one `run_lifecycle_batch` with no eligible rows returns an empty summary and one run record | DEC-2026-003 activation sequence; owner approval of cadence |
| HQ-4 | Staged synthetic completion past 72 h, flagged by the batch; four outcomes read back; cleanup | HQ-3; synthetic-record policy for Production; OD-5 for the alert outcome |
| HQ-5 | Breach record observed for HQ-4 with lag reported | OD-1, OD-2 and their slice |
| HQ-6 | Alert delivered to the named recipient | OD-5 and its provider (MTS §15 item 6) |

---

## 8. Recommended first slice — 7.5B summary truth repair

**Why this slice.** DF-1 and DF-2 contradict an approved contract (TRACE-136 A8: each summary row equals its queue, with no number of its own). The fix needs no new threshold, owner policy, scheduler or message. It is the smallest change that makes the existing operations surface truthful before anything is built on it.

**Owner decision required before the slice:** none on policy. The hosted migration push before merge needs the owner's authorization under DEC-2026-037.

**Scope (exact).**
1. One additive, function-only migration (next free version after `20261129001000`) restating `public.admin_operations_summary()` with exactly two changes:
   - fulfillment's aged key becomes `null`, so its `aged` is `null` ("no aging rule beyond entry", as for cancellation);
   - add `('offer_terms', 'items', null)` calling `public.admin_offer_terms_queue()`, inside the same per-queue `exception when others` → `error` handling.

   Grants, finance handling, ordering of the existing rows and every other function are unchanged.
2. [adminOperations.ts](../src/lib/adminOperations.ts): drop `agedLabel` from `fulfillment`; add `offer_terms: { label: "Offers at other terms", href: "/admin/requests#offer-terms-queue" }`.
3. Tests:
   - SQL 108: aged parity for every queue. A queue with an aged rule has a summary `aged` equal to its items with the flag. A queue without one returns `null`. Plus offer-terms count parity and a fixture with one `rematch_failed` item;
   - a unit test that every `SUMMARY_QUEUES` key has a summary row and the reverse;
   - `admin-operations.spec.ts`: the overview shows the "Offers at other terms" row and "—" for fulfillment aged.

**Acceptance criteria.**
- Mutation checks, each failing a named test: restore `'aged'` for fulfillment; drop the offer-terms row; swap the offer-terms list key.
- `admin_operations_summary` still writes nothing, remains admin-only (`42501`) and keeps finance `restricted` / `error` (SQL 108 Q1–Q5 unchanged).
- Clean replay of all migrations; full SQL suite; unit, lint, typecheck, secret scan and production build pass; the money fingerprint is unchanged.
- Mixed-version safe: the current client filters unknown queues ([admin/page.tsx:55](../src/app/admin/page.tsx#L55)) and renders `null` aged as "—" ([:87](../src/app/admin/page.tsx#L87)). Asserted by running the current client's spec against the new function.

**Rollout.** Codex review, then a dry run listing only the new migration and the push (owner-authorized, before merge). Then merge, so Vercel deploys. Then a READY readback and HQ-1/HQ-2.

**Rollback.** The application rolls back with `vercel promote` of the previous deployment, which is compatible with the new function as stated above. The database rolls forward: a further migration restoring the previous body, which is preserved in `20261109001000`. No data is written, so nothing needs repair.

**Out of scope.** DF-3, breach records, pool counts, alerts, scheduler, new queues (sourcing, applications), the owner-email row in the summary, thresholds, notifications.

## 9. Owner decisions

| ID | Decision | Needed before | Recommendation (proposal only) |
|---|---|---|---|
| OD-1 | Which approved rules (T-1..T-11) are recorded as SLA breaches | Breach-record slice | Only T-3, T-4 (failure aging), T-5, T-8, T-10: the rules that already define a breach instant |
| OD-2 | Who runs the breach detector: operator control (as the 7.3D-2 purge control does) or the scheduler | Breach-record slice | Operator control first; scheduler under the DEC-2026-003 activation sequence |
| OD-3 | Eligible-pool record definition (§6.2) | Pool-record slice | Count at each matching run, after excluding earlier attempts, with gate-blocked counted separately |
| OD-4 | "Sourced" (§6.3) | Any liquidity measure of it | Option (a): none in beta |
| OD-5 | Operator alert channel and recipient (admin in-app readback, owner email, external provider per MTS §15 item 6) | Any alert slice; HQ-6 | Admin in-app readback first (rows already written); external provider as a separate MTS decision |
| OD-6 | Thresholds for queues with none (§4) | Aging those queues | Keep none until the pilot baseline (MPS §2) |
| OD-7 | Delegated operations owner for R1 (CFG-010; DEC-2026-025 does not carry) | R1 gate | Record before R1 |
| CD-1 | (Codex) What counts as a support "response" for DF-3 | DF-3 repair | **Recorded as Codex's technical direction (2026-11-22 ET, 7.5A review):** the first participant-visible operations message counts as a response. Internal notes, assignment changes and status changes do not. This is technical direction for 7.5D, not an owner policy decision; it sets no new target (CFG-010 stays the target) |

## 10. Recommended sequence

| Step | Slice | Depends on |
|---|---|---|
| 1 | **7.5B** summary truth repair (§8) | Codex review; owner push authorization |
| 2 | **7.5C** staged-failure characterization tests (§7.1), tests only | 7.5B merged (SF-12 expects `null`) |
| 3 | **7.5D** DF-3 support response measure | CD-1 (direction recorded, §9) |
| 4 | **7.5E** admin in-app readback, so existing admin rows become the first alert surface | OD-5 |
| 5 | **7.5F** breach observation records and operator detector | OD-1, OD-2 |
| 6 | **7.5G** server sourcing and applications queues (no thresholds) | OD-4 for sourcing wording |
| 7 | Pool record | OD-3 |
| 8 | Scheduler activation (HQ-3, HQ-4) | DEC-2026-003 sequence; owner approval |

## 11. Validation of this slice

- Documentation only: this file, one TRACEABILITY row (TRACE-159) and the handoff entry.
- `git diff --check`, relative-link existence and `npm run scan:secrets`: results in the PR body (revision 1) and the revision 2 PR comment.
- No code, test, migration, workflow or configuration change. No hosted read or write.

## 12. Revision history

| Revision | Date (ET) | Base | Change |
|---|---|---|---|
| 1 | 2026-11-22 | `main` `63c8010` | First contract (OQ-1) |
| 2 | 2026-11-22 | `main` `83c8fea` merged | Codex's 7.5A review, below. No finding, status or recommendation changed beyond these |
| 3 | 2026-11-23 | `main` `126c85f` (7.5B merged) | §7.1 coverage note for 7.5C (SQL 128) with discrepancies SD-1 and SD-2 for Codex. No expectation, status or recommendation changed |

**Codex 7.5A review, applied in revision 2:**

| ID | Finding | Change |
|---|---|---|
| RV-1 | SF-6b overstated "one run record" | §7.1 SF-6b: a same-run replay inserts no run record; a new run ID inserts a second run record, with no second escalation, admin row or homeowner notice |
| RV-2 | HQ-2 relied on equal `checked_at` | §7.2 HQ-2: one `REPEATABLE READ READ ONLY` transaction for the summary and every reader |
| RV-3 | Queue-family total wrong; breach observation conflated with the completion escalation | §0 items 1–3: fourteen families, ten with a server reader. §6.1: the DEC-2026-006 escalation is a T-5 business action, not a general breach observation, and the two stay separate |
| RV-4 | Missing-alert pins could be read as gate evidence | §7.1: characterization only, not Phase 7 gate acceptance |
| RV-5 | CD-1 open | §9: Codex's technical direction recorded (first participant-visible operations message; notes, assignment and status changes do not count) |
