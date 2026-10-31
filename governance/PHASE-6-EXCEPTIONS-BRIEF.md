# Phase 6.9 brief: exceptions — characterization, split and 6.9A design

**Status:** BRIEF FOR CODEX REVIEW, 2026-10-30 (America/New_York). Revision 2 of the characterization published at `567e471`. Baseline `main` `de8e802` (PR #116 merge). **Nothing here is implemented or approved.** Owner questions are DEC-2026-053 (PROPOSED). No migration, hosted change, refund, collection or payment activation follows from this document.
**Trace:** TRACE-131 (6.9A, planned). **Scope (PHASE-6-SCOPE):** cancellation/rescheduling, provider cancellation/no-show, rematch/refund and emergency waivers under CFG-006/007. **Not in scope:** support-ticket handling and dispute evidence/resolution/appeal (6.10); prepaid plan allocation (DEC-2026-048, own slice); unpaid start (DEC-2026-050).

**Baseline checks (local isolated stack, clean reset to `20261031001000`, synthetic data):** money fingerprint `45 | 34c51131e2ca18f65d3b29afd8d12e11` (the reviewed TRACE-125 value). `money_process_payment_event`, `money_payable`, `promotion_release_on_cancel` and `find_eligible_packages_core` are inside it; 6.9A changes none of them.

## 1. Approved rules (not reopened)

| Source | Rule |
|---|---|
| CFG-006 / MPS §6.6 | Customer cancellation: ≥72 h full refund; 24–<72 h 50%; <24 h none. Customer rescheduling: ≥48 h free; 24–<48 h $25; <24 h case by case, not guaranteed. Operations waives applicable fees/penalties for accepted severe weather, emergency or uncontrollable event, recording the reason and the resulting communication. Acceptance: boundary-time and waiver tests give the same outcome in policy copy, UI, ledger, notifications and admin tools |
| CFG-007 / MPS §6.6 | Provider cancellation or no-show: rematch first; if no acceptable replacement, full customer refund. Recorded as a quality event unless operations records an accepted exception with a reason |
| CFG-005 / CFG-008 | Fee on the retained service subtotal after refunds; provider proceeds 85% subject to refunds; payout 48 h after homeowner-confirmed completion; disputed work held |
| DEC-2026-049 item 4 | Cancelled/missed/skipped visits create no make-up visit and do not move the anchor. Pause/resume/"Stop future visits" are operations-only; stopping is final, leaves existing visits and open offers for individual handling and does not change the plan's status |
| DEC-2026-049 item 8 | **PROPOSED, kept blocked:** only the plan provider's own acceptance of a visit is payable |
| DEC-2026-048 rules 2, 6, 7 | (Prepaid only, not implemented, out of scope) |
| Phase 4 (DEC-2026-019) / TRACE-056–058 | Assessment without money movement; customer-cancellation refunds only through the two-person reviewed refund kernel; provider-cancel refunds only after an immutable no-replacement decision; replacement reconciliation before checkout and payout. `job_operations` is immutable (`money_immutable` trigger: "append a correction") |
| MPS §1 / §6.6 | Never imply an outcome that has not happened; one policy matrix controls UI, money, notifications and operations |

## 2. Existing authoritative commands

| Concern | Command / path | Behavior on `main` |
|---|---|---|
| Exception record | `record_job_operation(job, key, kind, reason, scheduled_at, waived)` (Phase 4; restated by 6.5) | Idempotent per key; advisory lock + request `FOR UPDATE`; statuses `pending`…`in_progress`; immutable `job_operations` row with `policy_assessment` (`money_action: none`); in-app notices; non-cancel kinds open a `schedule_exception` ticket |
| Cancellation kernel | `private.transition_job_status` via `public.transition_job_status` | Homeowner and admin may move to `cancelled`. From any status but `pending`, needs a `customer_cancel` operation by the same actor in the last 5 minutes. **From `pending`, nothing is required** |
| Customer cancel | `kind = customer_cancel` | `refund_percent` 100/50/0 from `scheduled_start_at`; null with no appointment; `waived` (admin only) forces 100 |
| Reschedule | `reschedule_request` + `admin_record_appointment` (6.5) | Request stores a time and `fee` 0/25/null; nothing moves or is charged until operations records a time |
| Provider cancel / no-show | `provider_cancel`; `no_show` (only an admin's record acts) | Unassigns, returns to `pending/awaiting_match`, rematches; assessment `rematch_first`, refund 100 if no replacement, `quality_event = not waived` |
| Rematch | `offer_next_for_request_internal` | Excludes earlier providers; eligibility from `find_eligible_packages_core`; consent through `fallback_permitted` (`awaiting_consent`) |
| Replacement decision | `record_provider_replacement_decision` | Operations only; `no_replacement` cancels through the kernel from `pending` |
| Replacement money | `money_reconcile_replacement` (TRACE-058, not fingerprinted) | Keeps the paid agreement; assigns proceeds to an accepted, eligible replacement. **No recurring-visit check** |
| Refund | `money_preview/authorize_cancellation_refund`, `money_operator_request_cancellation_refund` | Service role; finance authority + separate approver; percent of captured service/tax/tip at authorization |
| Refund state | `money_refund_authorizations` → `money_refund_attempts` (`prepared`, `pending`, `succeeded`, `failed`, `reconcile`) → `money_refunds`; readbacks, reissues, late failures, releases | No participant readback of a cancellation's refund state exists |
| Checkout | `money_checkout_source_guarded` → `private.money_prepare_checkout` | Request advisory lock + `FOR UPDATE`, then obligation; refuses `cancelled` (status not in the payable list) |
| Capture | `money_process_payment_event` (fingerprinted) | Locks the obligation only; never reads the request status. A capture on an `expired` attempt fails into reconciliation |
| Recurring plan | `admin_set_recurring_plan_state`, `admin_resolve_cadence_date` | Operations-only pause/resume/stop and per-date skip/replace |

## 3. Characterization evidence (one rolled-back transaction, synthetic fixtures)

| Probe | Action | Result on `main` |
|---|---|---|
| P1a | Provider `provider_cancel` on a scheduled, paid one-time request (obligation captured 11,700) | `pending / exhausted`, provider cleared, `payment_status` still `captured` |
| P1b | Homeowner `transition_job_status(→ cancelled)` on that request | **Cancelled.** 0 `customer_cancel` operations; obligation still captured 11,700. The CFG-007 decision can no longer be recorded ("Service no longer accepts replacement decisions"), so neither refund adapter has a source |
| P2 | Homeowner `customer_cancel` on an accepted weekly **plan** row | Plan `cancelled`, assessed `refund_percent = 100` as if it were one visit |
| P3 | Homeowner `customer_cancel` on an `in_progress` job | Cancelled, `refund_percent = 0` |
| P4 | Provider `provider_cancel` on the plan row | Plan unassigned and rematched (`pending / exhausted`) |
| P5 | Provider `reschedule_request` 30 h before the appointment | Assessment `fee = 25` (the customer fee) |

## 4. Bypass inventory (every path)

| # | Bypass | RPCs | Direct writes | Triggers | UI entry points |
|---|---|---|---|---|---|
| B1 | Cancel from `pending` with no assessment, including a paid request returned to `pending` (P1) | `transition_job_status` (homeowner; admin with a reason); `record_provider_replacement_decision` (legitimate, decision-backed) | None: `guard_direct_status_writes` refuses lifecycle columns for `authenticated`/`anon`, admins included; no client DELETE grant (the delete policies are inert) | `trg_promotion_release_on_cancel` (fingerprinted) and `trg_sync_invoice_on_request_change` run on any cancel | `HomeownerJobDetailDialog.cancelPendingRequest`; `/admin/requests` status menu (`changeStatus`, includes `cancelled`) |
| B2 | Paths that put commercial history back in `pending` | `record_job_operation` (`provider_cancel`, admin `no_show`), `vendor_decline_job` and `release_job_match` during a rematch | none | `guard_accepted_quote_request`, `money_guard_request_source` (allow it) | Vendor jobs `JobOperations`; `/admin/requests` release |
| B3 | Accepted plan row takes visit commands (P2, P4) | `record_job_operation` (all kinds); `transition_job_status` (`cancelled` and `pending` are not guarded) | none | `guard_recurring_series_work` covers work statuses only | `JobOperations` on homeowner dialog and `/admin/requests` for plan rows |
| B4 | Paid recurring visit reassigned to a replacement | `money_reconcile_replacement` (no recurring check) → `money_effective_contractor` → payout | none | none | Finance operations |
| B5 | Cancellation readback absent; copy implies outcomes | none (no readback) | none | none | `JobOperations` ("No charge or refund is processed by this action", no result shown); success toast; `/reschedule-policy` |
| B6 | Capture after cancellation | `money_process_payment_event` lands a capture on a cancelled request if the attempt was still `session_created` | none | none | Stripe return page |
| B7 | Public copy differs from CFG-006/007 | n/a | n/a | n/a | `/reschedule-policy` ("We compensate the vendor", "Reschedule or cancel instantly", no waiver, no provider cancellation); `/faq` and `/terms` defer to it |
| B8 | Quality event is a flag only | `record_job_operation` writes `quality_event` into the assessment | none | none | none |
| B9 | Customer cancel during an open provider withdrawal is assessed by hours (penalty possible after the provider left) | `record_job_operation` | none | none | `JobOperations` |
| B10 | Provider-initiated reschedule takes the customer fee (P5) | `record_job_operation` | none | none | `AppointmentPanel` |

B9 and B10 have no approved answer (E12, E3); see §6.

## 5. Split

- **6.9A (TRACE-131): repairs supported by approved rules.** B1–B8, plus B9 recorded without a computed penalty (no decision). No new money movement, no fingerprinted function changed, one additive migration.
- **6.9B: owner-dependent behavior**, after DEC-2026-053 answers: reschedule initiator and fee responsibility (E3), assessment vs $25 collection (E2), waivers after the original assessment (E11), replacement consent, price and commercial identity (E5, E6, E7), and E1, E4, E8, E9, E10, E12. Money-moving parts need the two-person finance review and payment activation.
- **Out:** prepaid allocation; support/dispute resolution (6.10); unpaid start (DEC-2026-050).

## 6. 6.9A design

### A1. One authoritative cancellation path (B1, B2)
- The kernel moves a request to `cancelled` only with evidence **in the same transaction**: a `customer_cancel` operation for this job created in this transaction (`created_at = now()`, operation id in metadata), or a `no_replacement` decision for this job created in this transaction. This replaces the 5-minute same-actor window for every source status, `pending` included. There are no other cancellers on `main`.
- `HomeownerJobDetailDialog` pending cancel and `/admin/requests` (remove `cancelled` from the generic status menu) move to `record_job_operation` with the preview (A3).
- `record_job_operation` adds `_expected` (default null): status, provider, `scheduled_start_at` and the latest operation `seq` the actor saw. A mismatch is refused `40001` ("This service changed; review the current terms"). Replay by key is checked **before** the stale guard, so a retried success returns its recorded assessment.

### A2. Commercial history preserved (B1, B6)
- Lock order: advisory(job) → `service_requests FOR UPDATE` → `money_obligations FOR SHARE` (same order as checkout and `money_lock_lifecycle`; the capture webhook takes only the obligation, so no cycle).
- `customer_cancel` is refused while a checkout attempt is `prepared`/`session_created`/`reconcile` and unexpired ("A payment is in progress; try again once it finishes"). Past `expires_at`, the cancel proceeds and the readback shows "payment outcome unknown" until reconciliation.
- `before_value` gains the commercial references: obligation, current snapshot, captured, refunded, open attempts, accepted quote. No obligation, snapshot, attempt, journal or quote is written by any 6.9A command.

### A3. Assessment and refund-state readback (B5)
- `private.job_operation_assessment(request, kind, waived, at)` is the single assessment source for `record_job_operation` and a new `job_cancellation_preview(job)`. The CFG-006/007 rules are unchanged.
- `job_cancellation_outcome(job)` (participant/admin readback; amounts only to the homeowner and operations) derives one state from immutable records: `no_payment`, `payment_pending`, `payment_unknown`, `no_refund_under_policy`, `awaiting_operations` (null percent, no appointment, open withdrawal), `refund_owed` (target > authorized), `refund_requested` (authorization with no attempt or `prepared`), `refund_processing` (`pending`), `refund_failed` (`failed` or late failure with no reissue), `refund_unknown` (`reconcile` or a readback that found nothing), `refunded` (every authorization has `money_refunds` and authorized = target), `partly_refunded`. The target is the existing cancellation preview applied to current captured funds. The words "refunded" or "returned" appear only for `refunded`.
- Cancellation success copy says "Cancelled. Refund: <state>", never that money was returned.

### A4. Plan rows protected (B3)
- An accepted plan (series terms recorded) refuses every `record_job_operation` kind ("Changes are made on each visit; Mercurius can stop future visits") and `guard_recurring_series_work` also refuses `cancelled`/`pending`/`matched`/`quoted` on it. A pre-acceptance recurring request keeps one-time behavior. "Stop future visits", pause/resume and per-date resolution are unchanged; plan status stays unchanged by them.
- `JobOperations` is not rendered for plan rows. The homeowner sees the visit list and "Contact Mercurius to stop future visits" (E8 decides self-serve).

### A5. DEC-2026-049 item 8 explicit (B4)
- `money_reconcile_replacement` refuses an obligation whose request is a recurring visit (`replacement_provider`). Restriction only, outside the fingerprint; Codex to confirm whether the finance review must cover it.
- `provider_cancel`/`no_show` on a visit still rematch (CFG-007). The ticket and readback say a replacement's acceptance of a visit is not payable (item 8), and the payment queue keeps its `replacement_provider` reason.

### A6. Copy (B7)
- `/reschedule-policy`, `/faq`, `JobOperations`, `AppointmentPanel`: the CFG-006 windows and fee; "<24 h: case by case, not guaranteed"; the weather/emergency waiver accepted by operations; reschedules are requests that Mercurius confirms; provider cancellation/no-show → replacement first, otherwise a full refund. Remove "We compensate the vendor" (E4) and "instantly".

### A7. Quality events visible (B8)
- `admin_provider_quality_events(provider?)`, read-only: `provider_cancel` and operations-confirmed `no_show` operations; waived ones shown as "Excused" with the reason; participant-reported no-shows shown as "Reported, not confirmed". On `/admin/quality` and the vendor record. No score, rank, matching or penalty effect.

### A8. Open withdrawal (B9)
- A `customer_cancel` while a `provider_cancel`/`no_show` has no replacement decision records `refund_percent: null`, `basis: provider_withdrawal_open`, `requires_operations: true`. No penalty is computed; E12 decides.

## 7. Concurrency and replay tests (`scripts/exceptions-concurrency.mjs`, added as a CI step)

| # | Race | Expected |
|---|---|---|
| C1 | `customer_cancel` ∥ `money_checkout_source_guarded` | Serialized on the request; cancel first → checkout refused ("Commercial source changed"); checkout first → cancel refused (payment in progress) |
| C2 | `customer_cancel` ∥ capture event (attempt `session_created`) | Cancel refused until the capture commits; then succeeds with `refund_owed` on the captured amount. Capture on an attempt marked `expired` after cancel → event `failed`, readback `payment_unknown` |
| C3 | Same key ×5 | One operation, identical assessment returned to all |
| C4 | Two keys from one read | One applies; the other `40001` stale |
| C5 | `customer_cancel` ∥ `provider_cancel` | Serialized; customer second → stale `40001` (or, with fresh read, `awaiting_operations` per A8); provider second → refused (cancelled) |
| C6 | `provider_cancel` ∥ replacement `vendor_accept_job` ∥ `record_provider_replacement_decision` | One consistent outcome; homeowner direct cancel during rematch refused |
| C7 | Cancellation refund authorization ∥ refund event ∥ outcome readback | States only move forward; never `refunded` before `money_refunds` |
| C8 | Visit `customer_cancel` ∥ "Stop future visits" ∥ plan-row `customer_cancel` | Visit cancels; stop applies; plan-row command refused; plan status unchanged |

Each scenario runs three consecutive passes on the isolated stack.

## 8. 6.9A acceptance criteria (proposed)

1. No path moves a request to `cancelled` without a same-transaction `customer_cancel` operation or `no_replacement` decision; SQL proves it for every source status, every actor (homeowner, provider, admin, service role) and both legacy `payment_status` and money-obligation history. P1–P4 become refusals or the routed path.
2. Every cancellation UI entry point (homeowner dialog, `JobOperations`, `/admin/requests`) uses `record_job_operation` with a server preview, and the preview equals the recorded assessment at 72/48/24 h ± 1 minute, with and without a waiver.
3. Cancellation changes no obligation, snapshot, checkout attempt, journal, refund record or accepted quote (row hashes before/after), and the fingerprint stays `45 | 34c51131…`.
4. `job_cancellation_outcome` returns each of its states from fixtures; homeowner, provider and admin readbacks agree; no copy says refunded/returned except `refunded`; providers see no amounts.
5. Replay returns the recorded assessment; same-read conflicts are `40001`; C1–C8 pass 3/3.
6. Accepted plan rows refuse all exception kinds and the cancel/pending transitions; pre-acceptance recurring requests unchanged; existing stop/pause/resume tests (096) unchanged.
7. `money_reconcile_replacement` refuses recurring visits; one-time replacement reconciliation (027) unchanged.
8. Public copy matches CFG-006/007 word for word on the windows, fee and waiver; browser specs at 320/1440, light/dark, axe clean.
9. Quality events listed for operations with excused/reported distinctions; no other table or ranking changes.
10. Full SQL replay, unit, browser, lint, typecheck, build green; migration additive; old clients keep working (new parameters default).

## 9. Owner decision sheet (DEC-2026-053, PROPOSED; no answer approved)

Questions E1–E11 are verbatim from the `567e471` characterization; E12 is new from B9.

| # | Question | Recommendation (not approved) | Dependency |
|---|---|---|---|
| E1 | What time do CFG-006 windows measure from when no appointment is recorded (request date, preferred date, or always 100%)? Is cancelling an `in_progress` job allowed, and on what terms? | With no recorded appointment, refund 100% (no provider time was reserved). Once work has started, no self-serve cancellation: the homeowner reports an issue and operations decides (partial work, 6.10) | 6.9A `awaiting_operations` state; 6.10 |
| E2 | How is the $25 reschedule fee collected (new charge, deduction, invoice), and who decides "<24 h case by case"? Finance review needed | Assess when requested; collect only as a separate, operations-confirmed, two-person-reviewed charge after the new time is recorded; never deducted from a refund. Until collection is active, show "fee assessed, not charged". <24 h: operations decides with a reason, no fee unless the owner sets one | New money charge type (fingerprint, finance review, payment activation) |
| E3 | Provider-initiated rescheduling: fee to nobody, quality event, or treated as provider cancellation? (MPS §6.6 requires "either party") | No homeowner fee. If the homeowner declines the new time, treat as provider cancellation under CFG-007 (quality event unless excused) | E5; A7 quality read |
| E4 | Retained amount after a 50%/0% cancellation: is the provider's 85% share payable without homeowner-confirmed completion, and when? (Public copy promises compensation) | Not payable during beta until finance approves a rule; alternative: 85% of the retained service subtotal, eligible 48 h after the scheduled time, subject to holds | CFG-008 amendment; payout kernel (fingerprint); finance review |
| E5 | "Acceptable replacement": time limit, how many attempts, whether the homeowner must accept the replacement or its appointment time, and whether the replacement inherits the appointment | Replacement search until 24 h before the appointment (or 2 business days if none); homeowner must accept the replacement provider (existing consent) and its time, which is recorded anew; declining = no acceptable replacement → full refund | TRACE-099 consent; `record_provider_replacement_decision` |
| E6 | Replacement price: must a replacement accept the original agreed amount (fixed and quote)? What if no provider will? | The homeowner never pays more without accepting new reviewed terms; a replacement works for the original agreed amount (as TRACE-058 does for paid jobs); if none will, no acceptable replacement → full refund | TRACE-058; TRACE-126; finance review |
| E7 | DEC-2026-049 item 8 (replacement provider for a recurring visit) | Keep blocked in beta: offer the visit back to the plan provider on another date or cancel it with a full refund under CFG-007 | A5 guard; DEC-2026-049 item 8 |
| E8 | Whole-plan cancellation for non-prepaid plans: homeowner self-serve or operations-only; effect on created visits and open offers | Homeowner may request it in the app; operations runs "Stop future visits"; each existing visit is cancelled individually by its own CFG-006 window; open offers withdrawn | DEC-2026-049 item 4; A4; DEC-2026-048 separate |
| E9 | Homeowner unavailable / homeowner no-show (`customer_unavailable`) and partial completion: consequences, or defer to 6.10 | Record only in 6.9; consequences in 6.10; no automatic fee | 6.10 |
| E10 | Quality-event consequences (record only, matching rank, review threshold) | Record and display only during beta; any matching or suspension effect needs its own decision | A7; CFG-009 |
| E11 | Waiver after the fact: may operations accept an exception after the operation was recorded, and before/after a refund authorization? | Yes, as an appended adjustment referencing the original assessment (which stays); allowed until the refund completes; a higher refund creates an additional two-person authorization; never after payout without finance | Immutable `job_operations`; TRACE-056 kernel; finance review |
| E12 | (new) A homeowner cancels while a provider's withdrawal awaits a replacement decision: which refund applies? | Full refund (treated as no acceptable replacement); no homeowner penalty | E5; A8 |

## 10. Codex review points (design, not policy)

1. Refusing cancellation during an open, unexpired checkout attempt (A2) versus allowing it and relying on reconciliation.
2. Whether the restrictive `money_reconcile_replacement` guard (A5) needs the two-person finance review.
3. Removing `cancelled` from the admin generic status menu (A1) — operators then cancel only through `JobOperations`.
4. Plan-row refusal wording and the "contact Mercurius" path until E8.

## 11. Gates carried

DEC-2026-050 (unpaid start) PROPOSED; 6.6c two-person finance sign-off not recorded; TRACE-126 and TRACE-127 open; DEC-2026-052 PROPOSED; DEC-2026-053 PROPOSED; Codex review of 6.8 not recorded; payments inactive; no hosted change, refund or collection without owner authorization.
