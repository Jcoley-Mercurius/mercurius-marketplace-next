# Phase 5 — Failed-refund recovery (TRACE-082)

**Status:** IMPLEMENTED on branch `codex/phase5-failed-refund-recovery`, based on `main` `28c52e9`
(PR #37, TRACE-081, merged 2026-09-22). Awaiting a PR, CI and Codex design and code review.
Merging is not phase acceptance or production activation. No hosted project, Stripe account, bank
or real money was touched.

**Authorization (2026-09-22):** after PR #37 merged, the owner directed this slice, with the
`paymentFunctionError` fix (TRACE-076 finding) folded in. The owner answered four questions before
implementation:

1. **Resend or release.** Finance can send the same reviewed refund again under a new Stripe
   idempotency key, or release the authorization so it stops holding the payout and frees its
   amount for a new reviewed refund request.
2. **Resend is one operator; release is two.** A resend is done by the refund's author or approver,
   as the TRACE-077 reissue is. A release drops the customer's refund from the books and lifts the
   hold, so it is a reviewed request a second finance operator approves.
3. **A Stripe readback is the evidence.** Either step needs the latest recorded Stripe readback of
   this refund to show it failed or canceled. The send response alone is not enough.
4. **A refund that fails after it succeeded is a finding.** A refund Stripe fails after reporting it
   succeeded, when its journal is already posted, needs a ledger reversal design. It is recorded
   below and not handled here.

F1–F8 below are implementer choices recorded for review. Only the four answers above are owner
decisions.

## Gap

Characterized on `28c52e9`:

- A refund Stripe reports `failed` or `canceled` sets its attempt to `failed`. That status arrives
  only through the send response or an operator readback; the webhook keeps a non-succeeded refund
  event as a no-effect observation.
- A `failed` attempt could not be sent again. `money_prepare_refund` returned it unsent, and the
  TRACE-077 reissue accepts only an uncertain (`reconcile`) attempt.
- Authorizations are immutable, and every "pending refund" check meant "an authorization with no
  settled refund". A failed authorization therefore held its payout (`refund_hold`, `Pending refund
  hold`), blocked chargeback allocation (`refund_pending`) and counted against the payment and
  component caps for ever. Reconciliation listed it as `refund_pending` with nothing that could
  clear it.
- `paymentFunctionError` checked `context.body` before `context.json()`. On a real Edge Function
  error the context is the fetch `Response`, whose `body` is a stream, so every caller showed its
  fallback text instead of the function's code and message. The finance panel read the response
  itself as a workaround.

## Design

### F1 — A failure is proved by the latest readback of the current send

`private.money_refund_failure_readback` returns the latest readback when it:

- found the refund;
- names the Stripe refund the attempt recorded;
- shows `failed` or `canceled`;
- was taken no earlier than the current send was prepared.

Otherwise it returns null. `private.money_failed_refund_blocker` gives the resend's reasons, in
order: `refund_not_sent`, `refund_settled`, `refund_released`, `refund_not_failed`,
`readback_required`.

A readback always runs `money_record_refund_result`, so a readback showing the refund pending puts
the attempt back to pending. A later failed send response over a pending readback is still not
proof (suite 049 covers that ordering).

### F2 — A resend is a new send generation

`money_operator_resend_refund(authorization, reason)` is for the refund's author or approver.

- It takes the obligation and then the attempt lock, the order `money_prepare_refund` and the
  reissue take.
- It inserts a `money_refund_reissues` row with the new `failed_reference` column set to the Stripe
  refund that failed. Resends and TRACE-077 reissues therefore share one generation sequence and
  the `(authorization, generation)` key.
- It prepares the attempt under `mercurius:refund-v1:<id>:g<n>`, restarts its 23-hour window and
  clears `provider_reference`, so the new send's refund can be recorded.
- It never changes the amount and never settles anything.

A resend is keyed by the readback it relied on. Until the next readback, the same operator and
reason replays it, and anything else conflicts.

### F3 — An earlier send's failed refund is never the current send's refund

A `before update` trigger on `money_refund_attempts`, `private.money_refund_attempt_guard`, applies
to every writer, including the unchanged kernels. It refuses to record a Stripe refund named as the
failed refund of an earlier generation.

Without it, a readback made while a resend is in flight could list the old failed refund at Stripe,
mark the attempt failed and allow a second resend. That would leave two live sends.

`refund-invoice` also skips those refunds when it lists refunds for a readback. `money_refund_readback_target`
returns them as `failed_references`.

### F4 — A release is a reviewed, immutable record

- **Request:** `money_operator_request_refund_release(authorization, reason, evidence, key)`, open
  to any finance operator.
- **Kernel:** `money_release_refund`, service-only.
- **Stored command:** `{operation: refund_release, authorization, reference, reason, evidence}`.
  `reference` is the Stripe refund that failed, so a release approved before a resend cannot apply
  to a later failure (`refund_changed`). A replayed request keeps the reference it was first made
  against.
- **Kernel checks:** the TRACE-076/077 two-operator review, a failed attempt, the same reference,
  and the failure readback. It then inserts `money_refund_releases` naming the readback, both
  operators, the reason and the evidence.
- **Nothing is posted.** A failed refund never reached the ledger.

`money_operator_execute_review` runs the release under the obligation lock, like a refund.

### F5 — A released authorization is neither pending nor reserved

Each redefinition is the latest body, copied by a generator that asserts exactly one match per
substitution. Each one adds "and not released":

- **Holds:** `private.money_payable` (the ACH kernel's check) and `private.money_ach_payable` (its
  readback mirror).
- **Chargebacks:** `private.money_chargeback_state_blocker` and `money_resolve_chargeback_loss`.
- **Caps:** `money_authorize_refund` (kernel), `private.money_refund_blocker`, and the three sums in
  `private.money_cancellation_refund_line`. Those three are the policy target, earlier payments'
  capacity and this payment's reservation.
- **Reconciliation:** the pending count in `private.money_obligation_reconciliation` (which also
  gains `refunds.released`), and the `refund_pending` exception in `money_finance_reconciliation`.
- **Readback:** the unsettled refund list in `money_finance_operations`.

### F6 — A released refund can never move money

- The attempt guard refuses to prepare a released refund again.
- A `before insert` trigger on `money_refunds`, `private.money_refund_release_guard`, refuses to
  settle a released refund.

Stripe's `failed` and `canceled` are final, so a settled event for a released refund should not
happen. If one does, the event does not process. It holds that payout as an unprocessed event and
is listed for reconciliation.

### F7 — Readback and page

`money_finance_operations` changes in three ways:

- **Each unsettled refund** gains `resend_blocker`, `release_blocker` (set only when the attempt
  failed) and `open_release_request_id`. A released refund leaves the list.
- **Release requests** read back the refund, its components, the failed Stripe refund and the last
  readback's status.
- **`refund_releases`** lists releases from the last 30 days.

`/admin/finance` changes:

- **Resend refund:** one operator, with a reason, for the refund's author or approver.
- **Request release:** evidence and a reason, then a second operator.
- The reason when neither is allowed yet.
- The release review row.
- Recent releases.
- "failed and released" on the invoice row.

### F8 — `paymentFunctionError` reads the Response first

The helper now reads a clone of a `Response` context as JSON before looking at `body`. The
`Response` stays readable for the caller. A plain string or object body is still read.

The finance panel's workaround is removed. The checkout review, request page, homeowner dashboard
and admin invoices now show the Edge Function's own message where they used a fallback. Unit tests
show the old helper failed both `Response` cases.

## Scope

- **Migration** `20260922002000_money_failed_refund_recovery.sql`:
  - schema: the immutable `money_refund_releases`; `money_refund_reissues.failed_reference`; the
    `refund_release` review operation; the attempt and settlement guard triggers;
  - commands: the resend, the release request and the release kernel;
  - helpers: the failure readback, blockers, command builder, request details and release list;
  - the F5 substitutions and the redefinitions that learn the new operation.
- **`refund-invoice`:** the readback skips earlier failed refunds, and a failed refund's send
  response says to read it back and resend or release it.
- **`src/lib/payments.ts`:** the F8 fix.
- **`/admin/finance`:** the F7 page changes.
- **Tests:** suite 049; `scripts/phase5-failed-refund-concurrency.mjs` (in CI after the TRACE-081
  script); unit and browser cases; regenerated database types.

**Not in scope:**

- a refund Stripe fails after reporting it succeeded (owner decision 4);
- making the customer whole outside Stripe. A release records nothing about that; a new reviewed
  refund is the only in-system path;
- automatic or scheduled readback;
- provisioning finance operators;
- hosted deployment.

## Findings

- **A refund that fails after it succeeded (owner decision 4).** The webhook maps any
  non-succeeded refund event to a no-effect observation. A `refund.updated` to `failed` after a
  posted refund is kept, holds nothing and changes nothing. The ledger then shows the customer
  refunded while Stripe returned the money to Mercurius's balance. A later slice needs a reviewed
  reversal and, until then, at least an exception.
- **A released cancellation refund stays recorded as the cancellation's refund.** The cancellation
  list does not offer that cancellation again (its refund source exists). If the customer is still
  owed, the replacement is a plain reviewed refund, with the cancellation as its policy reference.
  **Review question:** whether a cancellation whose refund was released should be offered again.
- **Payee reassignment still refuses any refunded agreement.** `money_reconcile_replacement` refuses
  when any authorization exists, released or not. This is left conservative.
- **The reissue and a resend share a table.** A TRACE-077 reissue call, while the latest readback is
  the one a resend used, reports that resend as a replay if actor and reason match. Nothing changes.
- **Equivalent mutants.** In F1, the `found` check is implied by the reference match (the table
  requires a found readback to have a reference). The timing check is implied by F3: after any new
  send the attempt has no reference, and an earlier failed reference can never be recorded again.
  Both are kept as explicit guards.

## Evidence

See the TRACE-082 section of PHASE-5-VALIDATION.md.

## Remaining gates

- **Codex design and code review:** F1–F8, especially F3's guard, F5's substitutions and the
  cancellation review question. CI.
- **A reviewed path for a refund that fails after it succeeded.**
- **Provisioning two finance operators.**
- **Authorized Stripe test-mode acceptance:** a failed refund (for example Stripe's test card that
  fails refunds), its readback, a resend and a release.
