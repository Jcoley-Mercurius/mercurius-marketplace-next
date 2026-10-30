# Phase 6.7: provider fulfillment, completion evidence and homeowner confirmation

**Status:** IMPLEMENTED; **merged** as PR #114 (`afb7c83`, 2026-10-29); hosted `20261029001000` pushed after the merge at the owner's instruction. **Acceptance incomplete:** DEC-2026-050 is still PROPOSED and the human checks in §10 were not performed. Originally implemented on branch `claude/phase6-7-fulfillment` from `main` `7502342` (the PR #113 merge). The unpaid-start rule is an open owner decision (DEC-2026-050, §5). This slice does not make a payment a condition of starting work. It pushes no hosted migration, activates nothing and merges nothing.
**Trace:** TRACE-128. **Builds on:** the accepted Phase 4 lifecycle (DEC-2026-019, TRACE-097 completion evidence), the Phase 5 confirmation receipt and payout boundary ([PHASE-5-COMPLETION-PAYOUT.md](PHASE-5-COMPLETION-PAYOUT.md)), and the 6.6 visit identities and payment state (TRACE-123–125).

**Base verification.** PR #113 (6.6c) merged into `main` as `7502342` on 2026-10-29 11:33 UTC, at head `0ebc9ef`. Its CI on that head is green (backend, lifecycle, application). **No finance sign-off is recorded.** PRICING-FINANCE-REVIEW §10 still reads "Reviewers. Two people, not yet named by the owner … No sign-off is recorded", and PHASE-6-RECURRING-PAYMENTS-BRIEF §6 item 2 is still open. The merge does not change that record, and this slice does not treat it as a sign-off (§9).

## 1. Outcome

The assigned provider, or operations with a reason, starts a one-time job or one recurring visit, but only after that provider has accepted it. The provider completes it with this job's own stored photos. The homeowner then confirms it or reports an issue, and that decision is bound to the completion they reviewed.

Every participant sees who started, completed, confirmed or reported an issue, and when. A provider's completion is never shown as acceptance or as payout eligibility. Operations get a queue of unanswered completions, service exceptions and unverified completions, and record a follow-up on each.

The recurring plan itself is never worked on. Stopping a plan leaves existing visits and their history alone. Nothing confirms, charges, refunds, releases funds or sends a message on its own.

## 2. Governing requirements

| Source | Requirement for this slice |
|---|---|
| MPS §4 | Start and complete assigned work: the vendor, or an admin correction with a reason. Role checks are server-side and at the database boundary |
| MPS §5.1, §6.4 | Only the assigned vendor or an authorized admin starts or completes work. Completion evidence is category-configurable. Confirmation, dispute and any timer are explicit. Recurring work happens on auditable occurrences. Invalid and duplicate transitions are rejected. Completion cannot release funds until evidence and payment conditions are met. No-show, unable-to-complete, customer-unavailable and partial-completion each have operator actions |
| MPS §9 | Operator overrides record actor, time, reason and before/after values |
| CFG-008 | Payout eligibility begins 48 hours after homeowner-confirmed completion; disputed work is held |
| CFG-006/007, CFG-010 | Cancellation, refund and no-show economics stay with 6.9. Support commitments are unchanged |
| Phase 4 (DEC-2026-019; TRACE-097 D1–D4) | Only the homeowner confirms. The 48-hour dispute window and the 72-hour unanswered-completion review apply, and silence never confirms. Evidence is verified and recorded per attempt. Legacy completions are not gated |
| Phase 5 completion/payout | Confirmation receipt. Payout checks: the receipt, confirmation + 48 h, full capture, and dispute, refund and payout holds |
| DEC-2026-049 items 4, 5, 8 | Stopping a plan leaves existing visits for individual handling. **Unpaid-start is a 6.7 acceptance item (open; §5).** Replacement-provider visits stay unpayable |
| DEC-2026-037 | Hosted migration pushed before merge with owner authorization; the merge is the release |

## 3. Characterization (before this slice, local stack at `20261027001000`)

### 3.1 Lifecycle and commands

| Concern | Authoritative path | Behavior found |
|---|---|---|
| Status set | `request_status` | `pending, matched, quoted, scheduled, in_progress, pending_review, vendor_completed, homeowner_confirmed, completed, review_requested, reviewed, disputed, resolved, closed, cancelled`. Fulfillment uses `scheduled → in_progress → vendor_completed → homeowner_confirmed → completed (trigger)`. Rework runs from `vendor_completed`/`disputed` back to `in_progress`. `disputed → resolved → completed/closed`. Nothing produces `pending_review`, and the kernel refuses direct moves into it |
| Kernel | `private.transition_job_status` (public wrapper adds the confirmation receipt) | Advisory lock, then `FOR UPDATE`. Resolves the actor (internal, admin, homeowner, vendor). Refuses a same-state transition (`22023`). Only the homeowner may confirm. Admins need a reason. A vendor starts only from `scheduled`. Requires `contractor_id` for work states. Runs the evidence check before `vendor_completed`. Sets the clocks: `confirmation_deadline_at = now + 72 h`, and clears them on rework |
| Start | Vendor UI → `transition_job_status(in_progress)` | No retry identity: after a lost response, the retry fails as "Duplicate job transition". **F1:** an open offer already sets `contractor_id`, so an admin or the service role could move a `pending`, `matched` (offered) or `quoted` request straight to `in_progress` |
| Evidence | `vendor_complete_job` → kernel → `private.completion_evidence_check` / `completion_evidence_record` | A photo counts only if it is distinct, stored in `job-photos` at `<uploader>/<job>/…`, owned by the folder's uploader, and that uploader is the assigned provider or an admin. The category minimum applies. Rows are immutable per attempt. Recorded objects can't be deleted. The homeowner can read recorded proof. Clients can't write evidence rows. A cancelled dialog left its uploads in Storage (**F8**; private and never counted) |
| Confirmation | `homeowner_confirm_job` → public wrapper → receipt; trigger moves the job to `completed` | Homeowner only. One receipt. Duplicates refused. **F3:** not bound to the completion the homeowner reviewed, so after a rework and resubmission a dialog loaded earlier confirms proof the homeowner never saw |
| Dispute | `homeowner_raise_dispute` (ticket + dispute + `disputed`) | Homeowner only. Open within 48 h of `vendor_completed_at`, including after confirmation. One open dispute at a time. Not bound to the reviewed completion (F3) |
| Escalation | `run_lifecycle_batch` (`job-lifecycle-worker`, service role only, disabled; no Cron) | After 72 h it sets `needs_admin_review` and notifies, and never confirms. **F7:** the worker isn't running, so nothing surfaces an unanswered completion |
| Exceptions | `record_job_operation` (`no_show`, `unable_to_complete`, `customer_unavailable`, `partial_completion`, `provider_cancel`) | Recorded with a policy assessment. Raises `needs_admin_review`, opens a support ticket and notifies the participants. Admin `no_show` and `provider_cancel` re-offer the request. **F7:** no operator list of open exceptions |
| Admin overrides | `/admin/requests` "Change status" → kernel with reason | Any state allowed by the matrix, except `homeowner_confirmed`. Reason required. No stale binding (the admin can act on a status that changed after the dialog loaded) |
| Plan guard | Trigger `guard_recurring_series_work` (6.6a) | A plan never enters a work state on any path |
| Direct writes | `guard_direct_status_writes`, `enforce_vendor/homeowner_update_scope`; table grants | Clients (admins included) can't write lifecycle fields. `job_events`, `disputes`, `job_completion_evidence`, `job_operations` and `money_lifecycle_confirmations` are SELECT-only or no-grant for clients. `log_job_event` isn't client-executable, so events are trustworthy. The `job_events` INSERT policy is inert without a grant (**F12**) |
| Payout | `private.money_ach_payable`, `money_payable` (money fingerprint) | Requires the verified receipt, no dispute/appeal, full capture (`payment_incomplete`), no chargeback, reconciliation or event hold, confirmation + 48 h (`confirmation_window`), no payout or refund hold, and onboarding. It does not re-check completion evidence (**F10**; see Phase 4 D4) |
| UI | Vendor `/vendor/jobs`; homeowner `HomeownerJobDetailDialog`, `JobFollowUp`; admin `/admin/requests` | **F4:** nobody saw who started or completed the work, or when; the provider saw only "awaiting homeowner confirmation". **F5:** "Confirm done" committed in one click with no stated consequence. **F6:** "Report an issue" and "Dispute completed service" stayed offered after 48 h and then failed on the server |

### 3.2 Duplicate paths (kept; same kernel)

- Completion: `vendor_complete_job`, or an admin kernel transition to `vendor_completed`. Both run the same evidence check.
- Confirmation: `homeowner_confirm_job`, or `transition_job_status('homeowner_confirmed')`. Both go through the receipt wrapper.
- Dispute: `homeowner_raise_dispute`. The kernel's `disputed` requires an open ticket first.

### 3.3 Hosted (read-only aggregates, 2026-10-29)

Hosted holds 11 requests, all `cancelled` (10 awaiting match, 1 sourcing). It has 0 evidence rows, 0 confirmation receipts, 0 disputes, 0 job operations and 0 money obligations. No live record is affected by the guards below.

## 4. Findings

| # | Finding | Status after 6.7 |
|---|---|---|
| F1 | Work could start without the provider's acceptance (operator or service role, from an offered, pending or quoted request) | **Fixed on every path:** trigger `guard_fulfillment_start` |
| F2 | Start had no retry identity and no stale signal | **Fixed for the provider path:** `start_job` (operation key, replay, `40001` stale). The admin "Change status" path is unchanged (reason required, duplicate refused) |
| F3 | Confirmation and dispute weren't bound to the reviewed completion | **Fixed:** `homeowner_confirm_completion` / `homeowner_dispute_completion` take the completion's `vendor_completed_at`. The old commands are kept (§8) |
| F4 | No readback of who acted and when | **Fixed:** `job_fulfillment` and `FulfillmentPanel` for all three roles |
| F5 | One-click confirmation | **Fixed:** a confirmation dialog states the payout clock and the issue deadline |
| F6 | Issue report offered after the window | **Fixed:** the deadline time is shown, and support guidance replaces the action after 48 h. The server rule is unchanged |
| F7 | Unanswered completions, exceptions and unverified completions had no operator list | **Fixed:** `admin_fulfillment_queue` reads the approved 72-hour clock; `admin_record_fulfillment_follow_up` |
| F8 | Abandoned uploads stayed in Storage | **Fixed (best effort):** a cancelled completion dialog removes its unsubmitted uploads |
| F9 | Admin no-show or provider cancel on a **recurring visit** re-offers it to other eligible providers (`offer_next_for_request_internal` has no visit binding). That replacement visit is unpayable under DEC-2026-049 item 8 | **Characterized, unchanged.** Replacement-provider policy and rematch economics belong to 6.9 |
| F10 | Payout doesn't re-verify completion evidence. Legacy completions without recorded evidence stay confirmable (Phase 4 D4) | **Unchanged.** The payout kernel is in the money fingerprint (finance review). All new completions need verified evidence, and hosted has none of these rows. They are now queued as "Completion without recorded evidence" |
| F11 | Clients hold INSERT, UPDATE and DELETE grants on `support_tickets` (RLS decides) | **Out of scope:** support and disputes belong to 6.10 |
| F12 | The `job_events` INSERT policy has no grant | Inert. Recorded for the 6.13 cleanup |

## 5. Decision checkpoint: unpaid start (DEC-2026-050, PROPOSED)

6.6c left unpaid-start unchanged and set no permanent rule (DEC-2026-049 item 5). Today any payment state permits starting, and the SQL 098 matrix characterizes this as **current behavior**:

| Payment state at start | One-time | Recurring visit | Today |
|---|---|---|---|
| Paid (captured ≥ snapshot total) | obligation | `paid` | starts |
| Processing (open checkout) | — | `processing` | starts |
| Review missing (no or expired snapshot, terms blocked) | `no_obligation` | `review_pending` | starts |
| Ready but unpaid | `unpaid` | `ready` | starts |
| Confirmed failure | — | `failed` | starts |
| Unknown outcome / partial capture | `partial` | `unknown` | starts |
| Held (dispute or refund on the obligation) | — | `review_pending` (`held`) | starts |

`start_job` now records the state in the start event, which operations see. That is an audit fact, not a rule. Payout already refuses unpaid work (`payment_incomplete`), so today the provider carries the collection risk.

**Owner decision needed:**

1. Which payment states permit starting work.
2. How each blocked state behaves: review missing, ready but unpaid, processing, failed, unknown and held.
3. Whether an operator exception is allowed, and what it records.
4. Whether the rule covers one-time jobs now, or only once TRACE-126 is fixed.

**Recommendation (A, phased):**

- **Start only when `paid`.**
- **Block** review missing, ready but unpaid, failed and held, each with its existing queue reason. **Block** processing, telling the provider to wait for the outcome. **Block** unknown until it's reconciled; never collect again.
- **Allow an operator exception** for ready, processing, failed and unknown only, never for held or terms-blocked. The operator must be an admin and give a reason. The exception records the actor, time, payment state and reason in the start event. It **does not relax payout:** capture is still required, and the operator's confirmation dialog says so. Telling the provider waits for Phase 7 notification delivery.
- **Enforce it in `guard_fulfillment_start`,** so every path is covered.
- **Apply it to recurring visits now and to one-time jobs once TRACE-126 is fixed.**

Consequences:

- **Production.** Payments aren't activated (checkout runs in test mode only; hosted has 0 finance authorities). Under A, no job could start in production until payment activation. R1 isn't open, so nothing live is affected now.
- **Alternatives.** B: keep start ungated and rely on payout's capture check and the 6.6c unpaid queue. C: gate recurring visits only, with no one-time plan.

Nothing dependent on this answer is implemented. The guard, the readback and the matrix test are where the rule would go.

## 6. Implementation

Migration `20261029001000_phase6_fulfillment.sql` is additive: one trigger, three private helpers and six public functions. It changes no table, no existing function and no grant.

| Object | Behavior |
|---|---|
| `guard_fulfillment_start` (trigger, every path) | Moving to `in_progress` needs `contractor_id` and `matching_status = 'matched'` (`42501`), from `scheduled` or a rework state (`22023`) |
| `private.fulfillment_payment_state(row)` | The 6.6c visit state, or the one-time obligation's capture. Audit only |
| `public.start_job(job, key, reason)` | Assigned provider, or admin with a reason. Plan refused. Replay by key for the same actor, otherwise `22023`. Refuses with `40001` stale unless the job is `scheduled`. Delegates to the kernel with `start_key` and `payment_at_start` in the event |
| `public.homeowner_confirm_completion(job, completed_at)` | Homeowner only. Replay if this completion is already confirmed. `40001` if the job is no longer waiting or the completion changed. Delegates to `homeowner_confirm_job` (receipt, auto-complete) |
| `public.homeowner_dispute_completion(job, completed_at, reason)` | Homeowner only. Reason required. Replay of the same open dispute. `40001` if the job is no longer waiting or the completion changed. Delegates to `homeowner_raise_dispute` (48-hour window, ticket) |
| `public.job_fulfillment(job)` | Participants only (`42501`). Plan reads as `plan: true`. Returns start (actor class, time, rework; admins also get the reason and payment at start), completion (time, attempt, photos, minimum, actor, recorded), confirmation (only if at or after the current completion), latest dispute, dispute window end, the 72-hour review time and reported exceptions. Payout goes to the provider and operations only: a state mapped from `money_ach_payable`, `eligible_at` = confirmation + 48 h, and the raw blocker for operations |
| `private.fulfillment_queue_items(at)`, `public.admin_fulfillment_queue()` | Admin only. `confirmation_overdue` (`vendor_completed` at or after confirmation notice + 72 h), `fulfillment_exception` (latest of the four reports on an active job), `evidence_unverified`. An item is hidden once a follow-up is recorded at or after it opened |
| `public.admin_record_fulfillment_follow_up(job, key, item, reason)` | Admin only. Reason required. Item must be open (`40001`). Replay by key, otherwise `22023`. Writes one event. Changes no state, flag, ticket or notification |

UI:

- **`FulfillmentPanel`:** "Work and completion" with a history list and the waiting and payout lines. Loading, error and retry states. Hidden for a plan. Shown on the homeowner, vendor and admin job details.
- **`AdminFulfillmentQueue`** on `/admin/requests`, with "Record follow-up".
- **Vendor:** "Start job" calls `start_job` with a per-job key; a stale refusal refreshes the jobs. A cancelled completion dialog removes its unsubmitted uploads.
- **Homeowner:** "Confirm done" opens a confirmation dialog. Confirmation and issue reports go through the bound commands. The issue deadline is shown, and after 48 h it is replaced with support guidance (including the post-confirmation `JobFollowUp`).
- **`src/lib/fulfillment.ts`** holds the wording.
- Types regenerated (additive).

Existing fixtures updated: SQL 003, 024 and 062 inserted "in progress" jobs with a provider but no recorded acceptance. They now set `matching_status = 'matched'`. 024's rework now goes `completed → disputed → in_progress`, the real path, instead of an invalid direct `completed → in_progress`. The assertions themselves are unchanged.

## 7. TRACE-126 and TRACE-127 dependencies

Both stay open and are not changed here.

- **TRACE-127:** an add-on visit offered before a price change can't be accepted, so under F1 it can't be started either. It stays offered and unpaid, and operations handle it individually. If the owner later allows acceptance at the bound terms, 6.7 needs no change.
- **TRACE-126:** no effect on fulfillment today. Under recommendation A, a one-time job whose published snapshot fails checkout after a package edit could never be paid, and so never started. TRACE-126 must therefore be fixed before a paid-before-start rule covers one-time jobs (§5).

## 8. Compatibility, deployment and rollback

- **Old client on the new schema** (production today): start (`transition_job_status`), confirm (`homeowner_confirm_job`) and dispute (`homeowner_raise_dispute`) are unchanged and keep working. Only starts without acceptance are now refused, and hosted has no such job. The migration can therefore be pushed before merge (DEC-2026-037).
- **New client on the old schema:** the new RPCs are missing, so the push must come first.
- **Follow-up after the deploy:** revoke client execute on `homeowner_confirm_job`, so the unbound confirmation path stays reachable only through the bound command. `homeowner_raise_dispute` stays for the post-confirmation dispute.
- **Rollback order:**
  1. Promote the previous production deployment. The old client works on the new schema.
  2. Only if the guard itself must go, add a forward migration that drops `guard_fulfillment_start`. The new functions can stay, because nothing else calls them.
  3. The migration writes no data, so there is nothing to restore.

## 9. Gates (open)

1. Codex review of this diff.
2. **Owner decision DEC-2026-050** (§5), then the guard and matrix change in a follow-up.
3. ~~Hosted push of `20261029001000`, then merge~~ — done: merged as PR #114; pushed after the merge (owner instruction, 2026-10-29).
4. **6.6c finance sign-off:** PR #113 is merged without a recorded two-person finance sign-off. The owner should record the reviewers and sign-off, or the decision to proceed without one. This slice touches no fingerprinted function.
5. Not in scope: reviews (6.8), cancellation and replacement economics (6.9, F9), dispute resolution and support (6.10, F11), Cron, notification delivery, saved cards, payment activation and prepaid bundles.

## 10. Evidence (2026-10-29, synthetic data only, local stack)

| Check | Result |
|---|---|
| SQL 098 (new) | **159/159.** Ran 3 consecutive times plus once in the full suite. Covers: role-negative start, completion, confirmation, dispute, readback, queue and follow-up (homeowner A/B, plan provider, other provider, operations); direct-write bypasses (provider, operations); unaccepted start through the lifecycle command; plan never started; keyed replay and stale refusal; evidence (too few, incomplete upload, other visit's photo, another provider's or the homeowner's upload, duplicate, unauthorized completer, direct evidence insert, recorded proof not deletable); one visit's evidence never satisfies another; provider completion records no confirmation or receipt; readback by role; rework, then a stale confirmation or dispute of the old proof refused; replays write nothing; dispute-then-confirm refused; dispute window at 48 h − 1 µs and at 48 h; payout before confirmation (`awaiting_confirmation`), after it (`confirmation_window`), and at 48 h − 1 µs, exactly 48 h and 49 h; unpaid (`payment_incomplete`); payout hold; dispute hold; **unpaid-start matrix (current behavior)** for review missing, ready, processing, failed, unknown, held, paid and one-time; stopping a plan leaves a visit workable with its full history; queue for all four exception kinds, 72 h − 1 µs versus 72 h, unverified evidence, follow-up close/replay/key reuse/reopen, no state change and no notification |
| Mutation check, SQL 098 | 6 of 6 killed: acceptance guard removed; confirmation not bound; dispute not bound; start without replay (suite aborts at the replay); follow-up never closes; payout shown to the homeowner |
| Fixture updates | SQL 003, 024 and 062 pass with accepted fixtures (only the fixture rows changed) |
| Clean replay + full SQL | `supabase db reset --local`: 203 migrations to `20261029001000`. `supabase test db`: **89 files, 5,387 assertions, PASS** |
| `scripts/fulfillment-concurrency.mjs` (new; added to CI) | 6 scenarios on separate connections, 4 consecutive passes (one after the clean replay): confirm vs dispute ×8 (exactly one effect each); same-key confirmation ×6 (one receipt); confirm vs operator rework ×4 (exactly one); provider + 3 operators starting (one start, stale refusals); same-key start ×8 (one start); same-key follow-up ×5 (one record) |
| Money fingerprint | `45 \| 34c51131e2ca18f65d3b29afd8d12e11`, the same as the 6.6c hosted readback. No fingerprinted function changed |
| Unit | `tests/unit/fulfillment.test.ts` 13/13 (timeline order, actor per viewer, separate confirmation, waiting/payout wording, queue copy, stale detection) |
| Static gates | Secret scan, lint, typecheck, `git diff --check`: clean. Full unit suite **46 files, 552/552** |
| Synthetic build | `npm run build` with the fixture's public URL and key: pass |
| Browser `fulfillment` (new) | **8/8:** homeowner light 320 px and dark 1440 px (history, issue deadline, confirmation dialog focus and consequence, bound request body, stale refusal → alert focus, reload, reason shown; axe; no horizontal overflow); dispute window closed; vendor lost-response replay with the same key, then details with payout wording (320 px, axe); vendor stale start refresh; admin dark 320 px and light 1440 px (queue, reasoned follow-up, payment at start, payout check; axe; no page overflow); readback failure and retry. The first run timed out twice under machine load and once on an alert hidden behind the open confirmation; the spec now closes the confirmation first |
| Browser regression | `homeowner`, `portals`, `phase4`, `recurring-visits`, `appointments`, `money` (non-visual): **65/65** |
| Hosted (read-only aggregates) | §3.3. Nothing written |

**Not performed:** full non-visual browser suite, `@visual`, a human screen reader, real devices, a human keyboard pass (automated focus checks only), CI (pending push), the hosted migration.
