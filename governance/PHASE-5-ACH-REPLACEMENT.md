# Phase 5 — ACH transfer withdrawal and replacement statements (TRACE-079)

**Status:** IMPLEMENTED on branch `codex/phase5-replacement-statements`, based on `main` `7f696e1`
(PR #34, TRACE-078, merged 2026-09-21). Open as a PR against `main`; awaiting CI and Codex design
and code review. Merging is not phase acceptance or production activation. No hosted project,
Stripe account, bank or real money was touched.

**Authorization (2026-09-21):** after PR #34 merged, the owner directed this slice: replacement
statements and withdrawal of a prepared attempt. The owner answered the two semantics questions
before implementation:

1. **Two operators.** A withdrawal is a reviewed request: one finance operator requests it, a
   different one approves it and the requester runs it.
2. **Prepared, failed and returned transfers can be withdrawn.** These are the transfers the bank
   does not hold. Submitted, unknown and settled transfers cannot be withdrawn.

W1–W7 below are implementer choices recorded for review. Only the two answers above are owner
decisions.

## Gap

A statement item is immutable, and `money_ach_items.obligation_id` was unique. Nothing could take
a payout off a statement. Characterized on `7f696e1` before the change (suite 046, first section):

- a prepared transfer whose provider changed bank authorization cannot be sent
  (`bank_authorization_changed`), and a failed one cannot be retried (TRACE-078 B6). Both stay
  blocked for good;
- a prepared transfer whose payable amount changed cannot be sent (`statement_stale`) and stays
  blocked for good;
- while a payout is on a statement, a refund is refused (`on_ach_statement`, and the kernel's
  `money_refund_bank_guard` trigger), a lost chargeback cannot be allocated, an operator hold is
  refused (TRACE-076 G5), and a later batch is refused;
- even the unchanged preparation kernel, if approved, fails on the unique constraint.

A payout on a statement that should not be sent therefore had no way forward.

## Design

### W1 — A withdrawal is a reviewed request bound to the transfer and its status

`money_operator_request_ach_withdrawal(attempt, reason, evidence, key)`:

- The stored command is byte for byte the object the new kernel hashes:
  `{operation: ach_withdrawal, attempt, status, reason, evidence}`, with reason and evidence
  trimmed. `status` is the transfer's bank status when the request was made.
- Evidence is required. It records what the bank shows. For a prepared transfer, that is that
  nothing went out; for a failed or returned one, the failure or return.
- TRACE-076/077's rules apply: the actor is `auth.uid()`, a different finance operator approves,
  the requester runs it, the window is 24 hours, and approvals are bound to their request.
- The request goes stale (`status_changed`) if the transfer's status changes before it runs. An
  approval to withdraw a prepared transfer can never apply after that transfer was recorded as
  submitted. It goes stale as `completed` if the transfer was retried or withdrawn meanwhile.

### W2 — What a withdrawal records

New kernel `money_withdraw_ach(attempt, status, actor, approver, reason, evidence)`, service-only
like the other ACH kernels. Under the ACH lock order it:

- refuses anything but the latest attempt of its item, a status other than the approved one, and
  a submitted, unknown or settled transfer;
- requires the failure event for a failed or returned transfer;
- inserts an immutable `money_ach_withdrawals` row naming both operators, the previous status,
  reason and evidence;
- appends a `withdrawn` bank event (`ach-withdrawal:<attempt>`) and sets the attempt status to
  `withdrawn`.

It posts no journal. A prepared or failed transfer posted none, and a returned transfer's return
already reversed its settlement. The unchanged kernels then refuse the transfer by themselves:
`money_record_ach` has no transition from `withdrawn`, and `money_retry_ach` needs `failed` or
`returned`. The gateway names the reason as `withdrawn`.

### W3 — The replacement goes on a later weekly batch through the unchanged kernel

After a withdrawal the payout returns to the ready list. It is shown there, and to the batch
approver, with the statement it replaces. The next weekly batch request prepares it through the
unchanged `money_prepare_ach`, which re-proves eligibility and takes the current amount, payee and
bank authorization. A replacement is therefore reviewed by two operators like any statement, and
never carries stale terms.

The replacement is not put into the original batch. That batch is an approved, immutable statement
for its week, and weeks cannot overlap.

To allow a second item per payout without letting a payout be on two statements:

- the unique `obligation_id` constraint is replaced by a new column, `replaces_item_id`, which is
  unique and references `money_ach_items`, plus a unique index on `obligation_id` where
  `replaces_item_id` is null;
- a `before insert` trigger (`private.money_ach_item_chain`) applies to every writer, including
  the unchanged kernel. It refuses a new item unless the payout's newest item was withdrawn, and
  sets `replaces_item_id` to it. Each payout therefore has a single chain of items, and at most
  one live (not withdrawn) statement.

### W4 — "Already on a statement" now means a live statement

`private.money_ach_on_statement` / `money_ach_live_item` replace the item-exists test in:

- the refund blocker and the kernel's `money_refund_bank_guard` trigger;
- the chargeback blocker and `money_resolve_chargeback_loss`. This is the only kernel body
  touched besides the new one, and it changes only the predicate;
- the operator hold (TRACE-076 G5 is unchanged for a live statement: withdraw first, then hold);
- the batch term blocker and the ready list;
- the reconciliation readback, which reads the live statement. It no longer takes an arbitrary
  one of several rows. Paid and returned totals still sum over every item's bank events.

Each redefinition is the latest body copied mechanically, with only the predicate substituted. The
generator asserted exactly one match per substitution.

**Deliberately not changed:** `money_reconcile_replacement` (payee reassignment) and
`private.money_guard_request_source` (commercial source changes) still refuse a payout that ever
had a statement. Both happen before completion, and a statement exists only after completion, so a
replacement never needs them. Relaxing them would allow reassigning a payout that has already been
through a statement, which nothing approves. **Review question:** confirm they stay closed.

### W5 — The double-payment risk

Withdrawing a prepared transfer that was in fact sent, without its submission being recorded
(TRACE-078 B3), and then preparing a replacement would pay the provider twice. The mitigations are:

- two operators;
- evidence of what the bank shows;
- binding to the prepared status;
- dialog wording that says to check the bank portal first.

Recording the submission before sending remains the primary control. The residual gap is the
same one B3 records: a database lock cannot span the bank session.

If the bank later shows a withdrawn transfer as paid, that outcome cannot be recorded against the
withdrawn attempt (`withdrawn`). It belongs to already-paid recovery, which remains a separate
gate. **Review question:** whether that slice should let a finance pair record a late settlement
on a withdrawn attempt, or record it as a separate recovery event.

### W6 — Locks

Withdrawal execution takes the retry's order: lifecycle, provider onboarding, obligation, attempt.
It runs under its own subject lock. A submission, retry or batch racing it is therefore seen under
the lock and refused with its reason. The chain trigger runs under the kernel's obligation lock.
The unique index and the unique `replaces_item_id` catch any writer that bypasses it.

### W7 — Readback

`money_finance_operations.ach` gains:

- per transfer: `withdraw_blocker`, `open_withdrawal_request_id`, `withdrawal` (previous status,
  reason, evidence, whether I took part), `replaced_in` and `replaces_period`;
- per batch: `withdrawn_total`;
- per ready payout: `replaces`.

A batch with a withdrawn but not yet replaced transfer stays listed. A withdrawal request's details
show the transfer, the status being withdrawn, its current status, amount, payee, week, reference
hint and the recorded failure evidence. Reconciliation adds `payout.withdrawn_statements`, and a
withdrawn payout reads `eligible` or `held` again, never `scheduled`.

## Scope

- Migration `20260921002000_money_ach_replacement.sql`:
  - schema: the `withdrawn` attempt status; `replaces_item_id` with the replacement-chain
    constraints and trigger; the immutable `money_ach_withdrawals`; the `ach_withdrawal` review
    operation;
  - commands: the kernel `money_withdraw_ach` and the gateway
    `money_operator_request_ach_withdrawal`;
  - helpers: private command builder, blocker, and live-statement helpers;
  - the W4 predicate substitutions;
  - redefinitions for the withdrawal: record and retry blockers, `money_request_blocker`,
    `money_operator_execute_review`, `money_ach_request_details`, `money_ach_operations`,
    `money_finance_operations` and `money_obligation_reconciliation`.
- `/admin/finance`:
  - a "Withdraw a transfer from its statement" form: transfer, what the bank shows, reason, and a
    ConfirmAction whose consequence depends on the status;
  - withdrawn rows with their history and replacement week;
  - replacement notes on ready payouts and batch reviews;
  - withdrawal review rows showing amount, reference hint and the bank's failure evidence;
  - blocker wording that names the withdrawal path instead of "not available yet".
- Suite 046, `scripts/phase5-ach-replacement-concurrency.mjs` (in CI after the TRACE-078 script),
  unit and browser cases, and regenerated database types. The types change is additions plus one
  relationship that is no longer one-to-one.

**Not in scope:**

- recovery of already-paid funds, or recording a late outcome on a withdrawn transfer;
- bank statement import;
- notifying providers;
- a withdrawal that also places a hold (operators can hold the payout once it is withdrawn);
- changing G5 for live statements;
- provisioning finance operators;
- hosted deployment.

## Findings

- The TRACE-078 finding "a prepared attempt cannot be withdrawn" is resolved. B6 (no retry after a
  bank authorization change) stays: the path is now withdrawal and replacement.
- The TRACE-078 G5 question (holds on statement payouts) is partly answered in practice: a transfer
  the bank does not hold can be withdrawn, and the payout then held. A hold on a live statement is
  still refused.
- Found while testing: the replacement concurrency script originally used the same future weeks
  as the TRACE-078 script. CI runs both on one database and batch weeks cannot overlap, so it would
  have failed in CI but not on a clean local run. It now starts at +140 days.
- A withdrawal-versus-retry race run without a lock holder was always won by the retry locally. It
  was made deterministic, with the withdrawal holding the lock. Suite 046 covers the retry-first
  order.

## Evidence

See the TRACE-079 section of PHASE-5-VALIDATION.md.

## Remaining gates

- Codex design and code review (W1–W7, especially W4's closed reassignment and W5's late-outcome
  question); CI.
- Already-paid recovery; bank statement reconciliation.
- Failed-refund recovery (TRACE-077); `paymentFunctionError` (TRACE-076).
- Provisioning two finance operators.
- Authorized owner bank workflow acceptance (CFG-008), now including a withdrawal and a
  replacement statement.
