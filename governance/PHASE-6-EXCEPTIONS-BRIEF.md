# Phase 6.9: exceptions — characterization, decisions and 6.9A

**Status:** 6.9A IMPLEMENTED FOR REVIEW, 2026-10-30 (America/New_York), on `claude/phase6-9a-exceptions` from the brief branch (`4b96710`, itself from `main` `de8e802`). **Not merged, not pushed to hosted.** Migration `20261101001000_phase6_exceptions.sql` (additive). DEC-2026-053 E1, E2, E4, E6, E9, E10 and E12 **APPROVED** (owner, 2026-10-30, Codex recommendations); E3, E5, E7, E8 and E11 **approval instructed with Codex amendments whose wording is not in this record yet** (§9). No refund, charge, collection or payment activation follows from this slice.
**Trace:** TRACE-131. **Scope (PHASE-6-SCOPE):** cancellation/rescheduling, provider cancellation/no-show, rematch/refund and emergency waivers under CFG-006/007. **Not in scope:** support-ticket handling and dispute evidence/resolution/appeal (6.10); prepaid plan allocation (DEC-2026-048); unpaid start (DEC-2026-050); fee collection, supplemental refund execution and payment-kernel changes (§7).

**Baseline checks (local isolated stack, clean reset, synthetic data):** money fingerprint `45 | 34c51131e2ca18f65d3b29afd8d12e11` before and after `20261101001000` (the reviewed TRACE-125 value). `money_process_payment_event`, `money_payable`, `promotion_release_on_cancel` and `find_eligible_packages_core` are inside it and unchanged.

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

## 5. Split (as revised by the owner and Codex, 2026-10-30)

- **6.9A (TRACE-131), implemented here:** repairs required by approved rules and the seven architectural corrections in §6, plus the approved assessment answers E1 (no appointment → 100%; no homeowner self-cancel of started work) and E12 (cancellation during an open provider withdrawal → 100%), and E10 (quality events display only).
- **6.9B, after the amended wording is recorded:** reschedule initiator and fee responsibility (E3), replacement consent/time (E5), whole-plan end (E8), later waivers as appended adjustments (E11, architecture fixed by correction 6), and recurring replacement (E7, kept blocked by correction 5).
- **Separately reviewed scopes (§7):** $25 fee collection (E2), supplemental refund execution, payment-kernel changes for already-open sessions and late capture, and cancellation-retained proceeds (E4). Each needs the two-person finance review and payment activation.

## 6. 6.9A as implemented (architectural corrections 1–7)

| # | Correction | Implementation |
|---|---|---|
| 1 | Cancellation during active or uncertain checkout keeps the homeowner's request and creates an actionable reconciliation state; no new collection after cancellation where the authoritative path permits; characterize open sessions and late capture first | The cancellation is never refused for an open checkout. Its immutable record keeps captured funds, open attempts (id, status, mode, amount, expiry), snapshot and accepted quote (`before_value.commercial`) and the payment state in the assessment. `job_cancellation_outcome` and `admin_cancellation_queue` raise `checkout_open_after_cancellation` and `payment_after_cancellation` (funds captured beyond what the record captured — exact, not timestamp-based) and `refund_not_authorized`. New collection: `money_checkout_source_guarded` already refuses a cancelled request (SQL 101, C1). **Characterized, not changed (§7):** `money_attach_checkout` still attaches an existing session after cancellation, and `money_process_payment_event` still records a late capture on a cancelled request. The race is therefore surfaced and owed back, not prevented |
| 2 | Atomic evidence bound to request, actor and operation; no grace window, reusable record or direct-write bypass | `record_job_operation` and `record_provider_replacement_decision` set a transaction-local `mercurius.cancel_evidence` naming the request and the record they just wrote. Trigger `guard_cancellation_evidence` (every writer, including the service role and definer RPCs) requires a `customer_cancel` operation or `no_replacement` decision for this request, by the current actor, created in this transaction, and consumes it. The kernel's five-minute window is removed. Only a direct database session (not `authenticator`) may set `mercurius.owner_maintenance` |
| 3 | No cancellation in generic admin status editing; every entry point uses preview, stale protection and the command | `adminTransitionTargets` never offers `cancelled`. Homeowner pending cancel (`CancelPendingRequest`), `JobOperations` (homeowner, provider, admin) use `job_cancellation_preview` and send its `expected`; `record_job_operation(_expected)` refuses a changed read with `40001` after the replay check |
| 4 | Plans use the existing lifecycle controls; visits stay individually accountable | Accepted plans (terms recorded or visits exist) refuse every exception kind; `guard_recurring_plan_exceptions` refuses `cancelled`/`pending`/`matched`/`quoted` on them. Stop future visits, pause and resume are unchanged (096; C8). `JobOperations` shows plan guidance instead |
| 5 | Recurring replacement paths stay blocked, including open checkout or a commercial identity; never transfer an accepted snapshot | A plan visit's provider withdrawal is not re-offered (`exhausted`, operations ticket names DEC-2026-049 item 8); `record_provider_replacement_decision` does not offer a visit; `guard_recurring_replacement_reconciliation` refuses any replacement reconciliation for a plan visit. Checkout for the withdrawn visit stays refused (request not payable) |
| 6 | Later waivers append an adjustment; existing assessments and refunds unchanged; extra refunds separately authorized with duplicate protection | Not built in 6.9A (E11 wording pending). Preserved: `job_operations` stays immutable (`money_immutable`); 6.9A never rewrites an assessment or refund record |
| 7 | Entitlement, authorization and money movement distinct in every readback; never "completed" from cancellation status | `private.job_cancellation_state`: `entitlement` (policy percent, basis, amount), `authorization` (reviewed, unreleased authorizations), `movement` (`not_sent`, `in_flight`, `failed`, `unknown`, `partly_settled`, `settled` — settled only with a recorded `money_refunds` provider refund and no unresolved late failure). UI wording says "Refunded" only for `settled` (unit + browser) |

**A3 (revised): readbacks.** `job_cancellation_preview(job, kind, waived)` returns the same refusal and assessment as the command, the `expected` state and (homeowner/operations only) captured funds and whether a checkout is open. `job_cancellation_outcome(job)` returns the three layers to the homeowner and operations; a provider gets only that the service ended. `admin_cancellation_queue()` lists cancelled or withdrawn services with follow-up items.

**A7 (revised): quality events.** `admin_provider_quality_events(provider?)`, operations only: provider withdrawals and operations-confirmed no-shows are "Quality event"; waived ones "Excused by operations" with the reason; participant-reported no-shows "Reported, not confirmed". Shown on `/admin/quality` ("Provider Cancellations"). Display only (E10): no score, ranking, matching or penalty.

**Copy.** `/reschedule-policy` states CFG-006 windows, the $25 fee and "case by case, not guaranteed", the operations-accepted weather/emergency waiver, CFG-007, E1 and E12, and that plan visits follow the rules one by one; "We compensate the vendor" and "instantly" are removed. `AppointmentPanel` already matched.

**Compatibility (honest).** Old clients still reach `record_job_operation` (the new `_expected` defaults to null). Actions the repaired rules forbid are refused for old and new clients alike: a direct `transition_job_status(→ cancelled)` (the deployed homeowner "Cancel request" until this release, and the admin status menu), homeowner cancellation of started work, any exception on an accepted plan, and any status write to `cancelled` without evidence. Between the hosted push and the deploy, the old homeowner "Cancel request" button fails with "Cancel this service through its cancellation command" (the service-changes panel still works); this is a safe refusal, not a data change. Fixtures and owner SQL that set `cancelled` directly need `set local mercurius.owner_maintenance = 'on'`.

**Transaction boundaries and locks.** One transaction per command: advisory(request) → `service_requests FOR UPDATE` → `money_obligations FOR SHARE` → insert operation → evidence → kernel transition (same transaction) → ticket/notices. Checkout takes the same request locks before the obligation; the capture webhook takes only the obligation, so no cycle. Refund authorization stays a separate two-person transaction (TRACE-056).

## 7. Separately reviewed scopes (not in 6.9A)

| Scope | Why separate | What it would change |
|---|---|---|
| P-K1 Close the already-open-session window | Payment path; Stripe call | `money_attach_checkout` refuses a cancelled request; the cancellation flow expires open Stripe sessions (Edge). Finance review |
| P-K2 Late capture on a cancelled request | `money_process_payment_event` is fingerprinted | Mark `reconciliation_open` or a hold on capture after cancellation. Finance review, fingerprint change |
| F-1 $25 fee collection (E2) | New charge type | Assessed → separate, operations-confirmed, two-person-reviewed charge after the new time is recorded. Payment activation |
| F-2 Supplemental refund execution (E11) | Money movement | Appended adjustment → additional two-person authorization with a duplicate key; original assessment/refunds unchanged |
| F-3 Retained proceeds (E4) | Payout kernel (fingerprinted) | Kept not payable until finance approves a rule |

## 8. 6.9A acceptance criteria and evidence

| # | Criterion | Evidence |
|---|---|---|
| 1 | No path reaches `cancelled` without same-transaction evidence bound to request, actor and record | SQL 101: homeowner, admin and service-role transitions, service-role and owner direct writes, historical/other-actor/other-request/wrong-kind/malformed evidence all refused; evidence consumed; 003 updated (direct pending cancel refused, command cancels) |
| 2 | Every cancellation entry point previews and sends the read it showed | SQL 101 preview = recorded assessment at 72 h ± 1 min and 24 h ± 1 min, waiver, reschedule 48/24 h; browser `exceptions` (payload `_expected`), `phase4` |
| 3 | Commercial history unchanged by cancellation | SQL 101 row hashes of obligations, snapshots, attempts; no journal or refund authorization written; fingerprint unchanged |
| 4 | Entitlement, authorization and movement distinct; "refunded" only when settled | SQL 101 (none → partly authorized → not sent → in flight → partly settled → failed); C7; unit `cancellation`; browser `exceptions` |
| 5 | Replay and stale protection under concurrency | SQL 101; C3, C4, C5, C6 |
| 6 | Plans refuse exception commands; stop/pause/resume unchanged | SQL 101, 010, 095, 096 (updated), C8 |
| 7 | No recurring replacement path or snapshot transfer | SQL 101 (no re-offer, no reconciliation), 097 unchanged |
| 8 | Public copy matches approved rules | browser `exceptions` (320 px, light/dark, axe, no horizontal scroll) |
| 9 | Quality events visible without penalty | SQL 101, browser `exceptions` |
| 10 | Open checkout and late capture characterized and actionable | SQL 101 (prepare refused; attach and late capture CHARACTERIZED; outcome/queue items); C1, C2 both orders |

**Local results (2026-10-30, isolated stack, synthetic data):** clean reset applies `20261101001000`; full SQL 92 files / 5,620 tests PASS (101: 104/104); fingerprint `45 | 34c51131e2ca18f65d3b29afd8d12e11` unchanged; `exceptions-concurrency.mjs` C1–C8 3/3 consecutive passes with both C1 and C2 orders forced; unit 49 files / 575 passed; typecheck clean; ESLint clean on every changed file (the full-repo run did not finish on the loaded workstation; CI runs it); build passed; browser 72/72 (exceptions, phase4, homeowner, portals, appointments, fulfillment, recurring-visits). An earlier browser run failed 7: two were real axe contrast failures on the policy page's tinted rows and badge (4.18:1, 4.43:1), fixed in this slice; five were 30 s timeouts at load average 10–14 that passed unchanged at load 3.5.

## 9. Owner decision sheet (DEC-2026-053, 2026-10-30)

Questions verbatim from `567e471`; E12 added at `4b96710`. "Approved" means the owner's 2026-10-30 instruction to adopt Codex's recommendation. For E3, E5, E7, E8 and E11 the owner approved Codex's **amended** recommendations, whose text was not provided to the implementer; the earlier recommendations are withdrawn and the final wording must be recorded here before 6.9B. Corrections 4–6 in §6 already bind E8, E7 and E11's architecture.

| # | Question | Status and final wording | Dependency |
|---|---|---|---|
| E1 | What time do CFG-006 windows measure from when no appointment is recorded (request date, preferred date, or always 100%)? Is cancelling an `in_progress` job allowed, and on what terms? | **APPROVED.** With no recorded appointment, refund 100% (no provider time was reserved). Once work has started, no self-serve cancellation: the homeowner reports an issue and operations decides (partial work, 6.10). *Implemented 6.9A.* | 6.10 |
| E2 | How is the $25 reschedule fee collected (new charge, deduction, invoice), and who decides "<24 h case by case"? Finance review needed | **APPROVED.** Assess when requested; collect only as a separate, operations-confirmed, two-person-reviewed charge after the new time is recorded; never deducted from a refund. Until collection is active, show "fee assessed, not charged". <24 h: operations decides with a reason, no fee unless the owner sets one. *Not built (F-1).* | Finance review; payment activation |
| E3 | Provider-initiated rescheduling: fee to nobody, quality event, or treated as provider cancellation? (MPS §6.6 requires "either party") | **APPROVAL INSTRUCTED (Codex amendment) — wording pending.** | 6.9B |
| E4 | Retained amount after a 50%/0% cancellation: is the provider's 85% share payable without homeowner-confirmed completion, and when? (Public copy promises compensation) | **APPROVED.** Not payable during beta until finance approves a rule. *Copy promise removed in 6.9A; F-3.* | Finance review |
| E5 | "Acceptable replacement": time limit, how many attempts, whether the homeowner must accept the replacement or its appointment time, and whether the replacement inherits the appointment | **APPROVAL INSTRUCTED (Codex amendment) — wording pending.** | 6.9B |
| E6 | Replacement price: must a replacement accept the original agreed amount (fixed and quote)? What if no provider will? | **APPROVED.** The homeowner never pays more without accepting new reviewed terms; a replacement works for the original agreed amount (as TRACE-058 does for paid jobs); if none will, no acceptable replacement → full refund. *No change in 6.9A.* | TRACE-058; TRACE-126; finance review |
| E7 | DEC-2026-049 item 8 (replacement provider for a recurring visit) | **APPROVAL INSTRUCTED (Codex amendment) — wording pending.** Correction 5 keeps every recurring replacement path blocked (implemented). | 6.9B |
| E8 | Whole-plan cancellation for non-prepaid plans: homeowner self-serve or operations-only; effect on created visits and open offers | **APPROVAL INSTRUCTED (Codex amendment) — wording pending.** Correction 4: plans use the existing lifecycle controls; visits stay individually accountable (implemented). | 6.9B |
| E9 | Homeowner unavailable / homeowner no-show (`customer_unavailable`) and partial completion: consequences, or defer to 6.10 | **APPROVED.** Record only in 6.9; consequences in 6.10; no automatic fee. | 6.10 |
| E10 | Quality-event consequences (record only, matching rank, review threshold) | **APPROVED.** Record and display only during beta; any matching or suspension effect needs its own decision. *Implemented (A7).* | CFG-009 |
| E11 | Waiver after the fact: may operations accept an exception after the operation was recorded, and before/after a refund authorization? | **APPROVAL INSTRUCTED (Codex amendment) — wording pending.** Correction 6: an appended adjustment; existing assessments and refunds unchanged; additional refunds separately authorized with duplicate protection. | 6.9B; F-2 |
| E12 | A homeowner cancels while a provider's withdrawal awaits a replacement decision: which refund applies? | **APPROVED.** Full refund (treated as no acceptable replacement); no homeowner penalty. *Implemented 6.9A.* | — |

## 10. Gates

1. Codex review of the 6.9A diff and of §6/§7.
2. Owner/Codex: record the final wording of E3, E5, E7, E8, E11 in §9 and DEC-2026-053.
3. Hosted push of `20261101001000` before merge (DEC-2026-037), with owner authorization; not done.
4. Carried: DEC-2026-050 (unpaid start) PROPOSED; 6.6c two-person finance sign-off not recorded; TRACE-126 and TRACE-127 open; DEC-2026-052 PROPOSED; Codex review of 6.8 (PR #116) not recorded; payments inactive.
5. Not in 6.9A: §7 scopes; 6.10; manual screen-reader and real-device checks.
