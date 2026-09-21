# Phase 5 — Finance operator commands, part 2A: refunds and chargebacks (TRACE-077)

**Status:** IMPLEMENTED on branch `codex/phase5-finance-refunds`, based on `main` `f945910`
(PR #32, TRACE-076, merged). Awaiting CI and Codex design and code review. Merging is not phase
acceptance or production activation. No hosted project, Stripe account, bank or real money was
touched.

**Authorization (2026-09-17):** the owner directed part 2A of the finance command gateway and
answered TRACE-076's review questions:

- **G3:** releasing a payout hold does **not** need a second operator.
- **G9:** reviewed requests and approvals **expire after 24 hours**.
- **Refund authorization** keeps its existing dual review (TRACE-056) **as is**.

The owner accepted the proposed split of part 2 and directed 2A: refund authorization,
chargeback allocation and recovery of stuck refunds. 2B (ACH preparation, bank outcomes, retry)
is not started. R1–R6 below are implementer choices recorded for review, except where they restate
an owner answer.

## Gap

TRACE-076 left refund authorization (standard and cancellation policy) and lost-chargeback
allocation without an operator path; their kernels are `service_role` only and trust a
caller-supplied actor and approver. It also found that a refund attempt left `prepared` for 23
hours becomes `reconcile` and can never be sent again, even after a readback proves Stripe has
no refund, so its authorization holds the payout indefinitely.

## Design

### R1 — Hold release is one operator (owner decision G3)

`money_operator_release_hold(hold, reason, evidence)` calls `money_resolve_hold` with the session
user as actor. It replays for the same operator and text and refuses any other release of a
released hold. `money_operator_request_review('hold_resolution', …)` is refused with a pointer to
the direct command. An unexpired `hold_resolution` request made before this migration still runs
only with its approval; there are none outside synthetic tests.

**Authority note for review:** MPS §6.5 says high-risk manual financial changes need
second-person approval without listing which changes are high-risk. TRACE-076 classified hold
release as high-risk; the owner has now decided it is not. The kernel never required a review,
so this restores the kernel rule rather than weakening one.

### R2 — 24-hour window for requests and their approvals (owner decision G9)

- A request expires at `created_at + 24 hours` (`private.money_review_expires_at`). At or after
  that instant it cannot be approved or run, and replaying its key is refused; the operator
  makes a new request.
- An approval now counts only if it was given **to that request, inside its window**. The new
  immutable `money_review_request_approvals` binds each gateway approval to its request.
  Previously, `money_review_approvals` was matched by command hash alone, so an old approval of
  identical text (possible for readback resolutions, event exclusions and cancellation refunds,
  whose commands carry no request key) would have carried over to a new request.
- Approvals of part 1 requests made before this migration are not bound and no longer count;
  those requests are expired in any case after 24 hours.
- Operations show `expires_at` and an `expired` state; an expired request shows no blocker.
- There is no withdrawal; expiry is the only way a request ends unrun.

### R3 — Reviewed requests for refunds and chargebacks, run through unchanged kernels

All three use the part 1 flow: request, approval by a different finance operator in their own
session, execution by the requester. The requester becomes the kernel's `p_actor` (the refund's
`created_by`) and the approver its `p_approver` (`approved_by`). That is the TRACE-056 dual review
unchanged, so after execution either of them may send the refund (existing rule).

| Command | Function | Kernel | Inputs from the operator |
|---|---|---|---|
| Refund | `money_operator_request_refund` | `money_authorize_refund` | invoice, payment, service/tax/tip cents, policy reference, reason |
| Cancellation refund | `money_operator_request_cancellation_refund` | `money_authorize_cancellation_refund` | cancellation, payment, reason — **no amounts** |
| Lost chargeback | `money_operator_request_chargeback` | `money_resolve_chargeback_loss` | dispute, service/tax/tip cents, reason |

- The stored command is byte for byte the object the kernel hashes. A refund's kernel key is
  `finance-request:<request key>`, so each request is a distinct refund.
- A cancellation refund's amounts, key and policy evidence come from
  `private.money_cancellation_refund_line` at request time. If they differ when approved or run
  (for example another refund was authorized first), the request is stale with `amount_changed`.
- Reasons and policy references are trimmed before they are stored and hashed.

### R4 — Blockers mirror the kernels

`private.money_command_blocker` gives each request's reason before anyone approves it, and is
checked again at approval and, under the kernels' locks, at execution:

- refund: `payment_not_captured`, `deposit_service_only`, `refund_exceeds_components`,
  `refund_exceeds_payment`, `on_ach_statement`, `chargeback_open` (the refund bank guard),
  `completed`;
- cancellation refund: `not_eligible` (the policy line cannot be computed: not cancelled, no
  approved assessment, no no-replacement decision), `no_refund_due`, `amount_changed`, then the
  refund blockers;
- chargeback: `dispute_not_lost`, `on_ach_statement`, `refund_pending`, `allocation_invalid`
  (parts must equal the loss and stay within `money_retained_parts`), `completed`.

Execution locks what the kernel locks, in the kernel's order: a cancellation refund takes the
job advisory lock and the service request before the obligation, as
`money_authorize_cancellation_refund` does; the others lock the obligation.

### R5 — Reissue of an uncertain refund

`money_operator_reissue_refund(authorization, reason)` lets the refund's author or approver
prepare the same approved refund again under a new Stripe idempotency key
(`mercurius:refund-v1:<id>:g<n>`). It is allowed only when all of these hold
(`private.money_reissue_blocker`):

1. the attempt is `reconcile` (it stayed `prepared` past 23 hours without a Stripe result);
2. no refund is settled and no Stripe reference is recorded;
3. the latest Stripe readback (TRACE-076 `refund-invoice` readback) **found no refund**; and
4. that readback was taken **at least 24 hours after** the current generation was prepared.

Why 24 hours: a send only starts while the attempt is `prepared` and inside 23 hours, and Stripe
keeps an idempotency key for 24 hours; a not-found readback after that shows no refund exists and
none can still be created with the old key. The readback lists the payment's refunds and matches
this authorization's metadata, and records nothing if Stripe has more refunds than one page.

Each reissue is recorded in immutable `money_refund_reissues` (generation, the readback it relies
on, previous and new key, actor, reason); a repeat from the same readback by the same operator
replays, anything else conflicts. The attempt returns to `prepared` with `prepared_at` set, and is
sent through the unchanged `refund-invoice` send path.

**Kernel change (the only one):** `money_prepare_refund` measures its 23-hour window from
`coalesce(prepared_at, created_at)`. `money_refund_attempts.prepared_at` is a new nullable column;
existing attempts keep their behavior.

**Single operator, for review:** the reissue changes no amount and no recipient of an amount
already approved by two operators, and it depends on a Stripe readback rather than operator
entry. Please confirm one of the refund's two operators is enough.

### R6 — Operator readback

`money_finance_operations` adds:

- per request: `details` (payment or dispute and exact service/tax/tip), `expires_at`, the
  `expired` state, and an approval flag read from the request binding;
- per unsettled refund: `generation` and `reissue_blocker` (only while `reconcile`);
- `cancellations`: customer cancellations, and provider cancellations or no-shows with a recorded
  no-replacement decision, whose policy line gives a refund on a captured payment not yet
  authorized — with percent, amounts, blocker and any open request;
- `chargebacks`: lost disputes not yet allocated, with retained components, blocker and any open
  request.

No operator identities, bank references or customer identities are returned.

## Scope

- Migration `20260917001000_money_finance_refunds.sql`: constraint updates on
  `money_review_requests`; immutable `money_review_request_approvals` and `money_refund_reissues`;
  `money_refund_attempts.prepared_at`; `money_prepare_refund` window change; `authenticated`
  `money_operator_release_hold`, `_request_refund`, `_request_cancellation_refund`,
  `_request_chargeback`, `_reissue_refund`; replaced `_request_review`, `_approve_review`,
  `_execute_review`, `money_finance_operations` and `private.money_review_approver`; private
  command builders and blockers.
- `/admin/finance` FinanceCommands panel: one-operator hold release; refund request form;
  cancellation refunds due list; lost chargeback allocation form with sum validation; request
  amounts and expiry in the review list; reissue action on uncertain refunds. Every action is
  behind ConfirmAction and confirmed by server readback.
- Suite 043 hold release section rewritten for R1; part 1 concurrency script races one-operator
  releases; new suite 044 and `phase5-finance-refund-concurrency.mjs` in CI.

**Not in scope:** ACH preparation, bank outcomes and retry (part 2B); reissue of a refund Stripe
reported `failed` (still stuck — see findings); scheduled Stripe readback; provisioning finance
operators; `paymentFunctionError` fix; hosted deployment.

## Findings (existing behavior, unchanged)

- A refund Stripe reports `failed` or `canceled` leaves its attempt `failed`; it cannot be sent
  again and its authorization still holds the payout. R5 covers only `reconcile`.
- `money_approve_review` remains directly callable by finance operators; such approvals no
  longer count for any gateway request (R2).
- `paymentFunctionError` still loses Edge error codes (TRACE-076 finding).

## Evidence

See the TRACE-077 section of PHASE-5-VALIDATION.md.

## Remaining gates

Codex design and code review (R1–R6, especially the R1 authority note and R5 single operator);
CI; part 2B (ACH preparation, bank outcomes, retry); failed-refund recovery; provisioning two
finance operators; authorized Stripe test-mode acceptance of send, readback and reissue.
