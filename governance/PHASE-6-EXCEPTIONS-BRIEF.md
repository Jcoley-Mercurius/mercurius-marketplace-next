# Phase 6.9 starting brief: exceptions (characterization only)

**Status:** BRIEF, 2026-10-30 (America/New_York). Characterization of `main` at `de8e802` (PR #116 merge) for Codex to bound 6.9. **Nothing here is implemented or approved.** No migration, hosted change or payment activation follows from this document.
**Scope (PHASE-6-SCOPE):** cancellation/rescheduling, provider cancellation/no-show, rematch/refund and emergency waivers under CFG-006/007. **Not in scope:** support-ticket handling, dispute evidence/resolution/appeal (6.10); prepaid plans (DEC-2026-048, own slice); unpaid start (DEC-2026-050).

## 1. Approved rules (not reopened)

| Source | Rule |
|---|---|
| CFG-006 / MPS §6.6 | Customer cancellation: ≥72 h full refund; 24–<72 h 50%; <24 h none. Customer rescheduling: ≥48 h free; 24–<48 h $25; <24 h case by case, not guaranteed. Operations waives applicable fees/penalties for accepted severe weather, emergency or uncontrollable event, recording the reason and the resulting communication. Acceptance: boundary-time and waiver tests give the same outcome in policy copy, UI, ledger, notifications and admin tools |
| CFG-007 / MPS §6.6 | Provider cancellation or no-show: rematch first; if no acceptable replacement, full customer refund. Recorded as a quality event unless operations records an accepted exception with a reason |
| CFG-005 / CFG-008 | Fee on the retained service subtotal after refunds; provider proceeds 85% subject to refunds; payout 48 h after homeowner-confirmed completion; disputed work held |
| DEC-2026-049 item 4 | Cancelled/missed/skipped visits create no make-up visit and do not move the anchor. Pause/resume/"Stop future visits" are operations-only; stopping leaves existing visits and open offers for individual handling and does not change the plan's status |
| DEC-2026-048 rules 2, 6, 7 | (Prepaid only, not implemented) CFG-006 per visit share; plan cancellation evaluates each remaining visit; provider cancellation of a visit follows CFG-007 with no homeowner penalty |
| DEC-2026-049 items 7–8 | **PROPOSED, kept blocked:** quote/promotional plan visits; a replacement provider's acceptance of a recurring visit is not payable |
| Phase 4 (DEC-2026-019) / TRACE-056–058 | Assessment without money movement; customer-cancellation refunds only through the two-person reviewed refund kernel; provider-cancel refunds only after an immutable no-replacement decision; replacement reconciliation before checkout and payout |

## 2. Existing authoritative commands

| Concern | Command / path | Behavior on `main` |
|---|---|---|
| Exception record | `record_job_operation(job, key, kind, reason, scheduled_at, waived)` (Phase 4; restated by 6.5, `appointment` kind retired) | Idempotent per key; advisory lock + `FOR UPDATE`; statuses `pending`…`in_progress` only; writes an immutable `job_operations` row with a CFG-006/007 `policy_assessment` and `money_action: none`; notifies participants and admins in-app; non-cancel kinds open a `schedule_exception` support ticket and set `needs_admin_review` |
| Customer cancel | `kind = customer_cancel` (homeowner or admin) | `refund_percent` 100/50/0 from `scheduled_start_at`; **null when no appointment is recorded**; `waived` (admin only) forces 100. Then `transition_job_status(→ cancelled)` |
| Reschedule | `kind = reschedule_request` (any participant) + `admin_record_appointment` (6.5) | Request stores the proposed time and `fee` 0/25/null (<24 h); never moves the appointment or charges; operations applies a new time with reason, stale guard and Eastern wall-time check |
| Provider cancel / no-show | `kind = provider_cancel` (provider/admin), `no_show` (any participant; only an admin's record acts) | Withdraws pending offers, clears `contractor_id`, returns the request to `pending/awaiting_match`, calls `offer_next_for_request_internal`; assessment `rematch_first`, `refund_if_no_acceptable_replacement: 100`, `quality_event: not waived`. `scheduled_start_at` kept ("Appointment on hold") |
| Rematch | `private.offer_next_for_request_internal` | Excludes providers already accepted/declined/expired/withdrawn; candidates from `find_eligible_packages_core` (current eligibility); fallback consent via `fallback_permitted` parks at `awaiting_consent` |
| Replacement decision | `record_provider_replacement_decision` (TRACE-057) | Operations only; outcomes `replacement_active`, `awaiting_consent`, `no_replacement`; a no-show must be operations-confirmed |
| Replacement money | `money_reconcile_replacement` (TRACE-058) | Keeps the paid customer agreement, assigns proceeds to a canonically accepted, eligible replacement; required before checkout and payout; refused after refund or existing ACH statement |
| Cancellation refund | `money_preview_cancellation_refund`, `money_authorize_cancellation_refund`, `money_operator_request_cancellation_refund` (TRACE-056) | Service role, recorded finance authority plus separate second approver; percentage applied to captured service/tax/tip; provider kinds need the no-replacement decision; 0% records nothing |
| Payout holds | `private.money_payable` | Blocks on dispute/reconciliation, unresolved `money_holds`, pending refund authorization, missing replacement reconciliation, vendor ineligibility and the 48 h confirmation rule |
| Recurring plan | `admin_set_recurring_plan_state`, `admin_resolve_cadence_date` (6.6b) | Plan pause/resume/stop and per-date skip/replace; operations-only; no money effect |
| Recurring visit | `record_job_operation` on the visit row | Same as one-time; `JobOperations` says "applies to this visit only" |

## 3. Bypasses and inconsistencies found (characterize with tests before changing)

1. **Pending cancel without assessment.** The homeowner dialog calls `transition_job_status(→ cancelled)` directly; the kernel allows it from `pending` with no `customer_cancel` operation. After a `provider_cancel` the request is back in `pending` and may hold a captured payment, so a paid job can be cancelled with no CFG-006/007 record or refund path.
2. **Plan row not guarded for exceptions.** `guard_recurring_series_work` blocks work statuses only; `customer_cancel` and `provider_cancel` on the plan row are accepted. A plan `provider_cancel` would unassign and rematch the plan itself, against the provider bound in `recurring_series_terms`.
3. **Recurring rematch is not payable.** `provider_cancel` on a visit rematches to other providers, but DEC-2026-049 item 8 keeps a replacement's visit unpayable, so a visit can be re-accepted and then stall.
4. **Provider-initiated reschedule** receives the customer `fee` assessment (recorded in PHASE-6-APPOINTMENTS §"Not done" 2); CFG-006 prices customer rescheduling only.
5. **Waiver only at record time.** `_waived` is fixed when the operation is recorded (admin only); there is no command to accept a weather/emergency exception after a homeowner's cancellation or a provider's report, and no field for the resulting communication CFG-006 requires.
6. **Quality event is a flag only.** `policy_assessment.quality_event` is not written to any quality record or metric.
7. **Customer cancel during `in_progress`** is accepted and assessed by hours (normally 0%).
8. **No appointment, no assessment.** With `scheduled_start_at` null the refund is null and the bridge refuses; there is no defined outcome.
9. **$25 fee has no collection path.** Assessment only; no charge, deduction or ledger line exists.
10. **Public copy diverges** (`/reschedule-policy`): says the vendor is compensated from a 50% cancellation, "reschedule or cancel instantly" (reschedule is a request operations applies), omits the weather/emergency waiver and provider cancellation/no-show. CFG-006 acceptance requires copy and behavior to match.
11. **Accepted price on replacement.** TRACE-058 keeps the customer's agreed amount and pays the replacement from it; matching offers a replacement at its own package/revision. Quote-priced jobs have no rule for a replacement's quote.
12. Interacting open issues: TRACE-126 (one-time accepted price can change via package edits) and TRACE-127 (offered visit with add-ons cannot be accepted after a price change) affect what a rematch or reschedule can preserve; DEC-2026-050 decides whether a rematched, unpaid job may start.

## 4. Missing owner decisions (new; none approved)

| # | Question | Why it is needed |
|---|---|---|
| E1 | What time do CFG-006 windows measure from when no appointment is recorded (request date, preferred date, or always 100%)? Is cancelling an `in_progress` job allowed, and on what terms? | §3.7–3.8 |
| E2 | How is the $25 reschedule fee collected (new charge, deduction, invoice), and who decides "<24 h case by case"? Finance review needed | §3.9 |
| E3 | Provider-initiated rescheduling: fee to nobody, quality event, or treated as provider cancellation? (MPS §6.6 requires "either party") | §3.4 |
| E4 | Retained amount after a 50%/0% cancellation: is the provider's 85% share payable without homeowner-confirmed completion, and when? (Public copy promises compensation) | CFG-008 ties payout to completion |
| E5 | "Acceptable replacement": time limit, how many attempts, whether the homeowner must accept the replacement or its appointment time, and whether the replacement inherits the appointment | CFG-007 has no definition; PHASE-6-APPOINTMENTS item 3 |
| E6 | Replacement price: must a replacement accept the original agreed amount (fixed and quote)? What if no provider will? | §3.11 |
| E7 | DEC-2026-049 item 8 (replacement provider for a recurring visit) | §3.3; blocks CFG-007 on visits |
| E8 | Whole-plan cancellation for non-prepaid plans: homeowner self-serve or operations-only; effect on created visits and open offers | DEC-2026-049 item 4 leaves them for individual handling |
| E9 | Homeowner unavailable / homeowner no-show (`customer_unavailable`) and partial completion: consequences, or defer to 6.10 | MPS §6.6 lists them; no CFG rule |
| E10 | Quality-event consequences (record only, matching rank, review threshold) | CFG-007 says record; consequence undefined |
| E11 | Waiver after the fact: may operations accept an exception after the operation was recorded, and before/after a refund authorization? | §3.5 |

## 5. Suggested boundaries for Codex

- Characterize first (SQL + browser): §3 items 1–3 and 7–8 as current behavior.
- Candidate split: (a) cancellation/reschedule commands and readbacks with waiver and copy alignment; (b) provider cancel/no-show, rematch consent, replacement decision and quality record; (c) recurring visit vs plan exceptions after E7/E8. Money-moving parts stay behind the two-person finance review and inactive payments.
- Every change keeps `job_operations` append-only, idempotent keys, stale guards and the existing refund/payout kernels.

## 6. Gates carried

DEC-2026-050 (unpaid start) PROPOSED; 6.6c two-person finance sign-off not recorded; TRACE-126 and TRACE-127 open; DEC-2026-052 PROPOSED; payments inactive; no hosted change without owner authorization.
