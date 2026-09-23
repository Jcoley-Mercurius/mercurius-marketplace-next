# Phase 5 — Late reversals (TRACE-083)

**Status:** IMPLEMENTED on branch `codex/phase5-late-reversals`, based on `main` `a39abf1` (PR #38,
TRACE-082, merged 2026-09-23). Awaiting a PR, CI and Codex design and code review. Merging is not
phase acceptance or production activation. No hosted project, Stripe account, bank or real money
was touched.

**Authorization (2026-09-23):** after PR #38 merged, the owner directed this slice. It takes two
findings left open: a refund Stripe fails after reporting it succeeded (TRACE-082), and a bank
return recorded after the provider repaid part of the payout (TRACE-080). The owner answered these
questions before implementation:

1. **A refund that fails after it succeeded stands.** The owner first said the provider should owe
   it. A posted refund already charges the provider their share, so literally that would charge them
   twice and move Mercurius's fee and the tax onto them, against CFG-005/CFG-008. Asked to choose,
   the owner confirmed this: the fee, tax and provider share stay posted, and what Stripe returned
   is held as owed to the customer. It is cleared when a resend reaches the customer, or when a
   release reverses the refund, which restores the provider's share.
2. **Two operators.** Recording the failure, the resend and the release each need a second finance
   operator.
3. **A return after a repayment reverses the repayment.** Mercurius sends it back by manual ACH, and
   two operators record that separately once the bank shows the debit. The replacement statement
   still pays only the payout's proceeds.

L1–L8 below are implementer choices recorded for review. Only the answers above are owner
decisions.

## Gap

Characterized on `a39abf1`:

- **The webhook ignores a late failure.** It maps every refund event that is not `succeeded` to a
  no-effect observation. A `refund.updated` to `failed` after the refund posted changed nothing:
  the ledger showed the customer refunded while Stripe returned the money to Mercurius.
- **A readback only records the failure.** A readback of a settled refund showing `failed` was
  recorded, but `money_record_refund_result` kept the attempt `succeeded` because the refund had
  settled.
- **Every recovery path refused a settled refund.** The TRACE-077 reissue, the TRACE-082 resend and
  the TRACE-082 release all refuse it (`refund_settled`).
- **A second refund event could not settle.** The payment kernel refuses an event naming a
  different refund for an authorization that already settled ("Refund identity conflict").
- **Nothing sends a repayment back.** When the bank returned a settled transfer after the provider
  repaid, the provider payable showed Mercurius owing that repayment back, with no reviewed path to
  pay it. The TRACE-080 R4 guard, which counts repayments as money the provider no longer holds,
  would have let a replacement pay the proceeds plus the repayment.

## Design

### L1 — Evidence of a late failure is a readback of the refund that delivered it

- **Delivered.** `private.money_refund_delivered(authorization)` is true when all three hold:
  - Stripe settled the refund;
  - it is not released;
  - no late failure is open.
- **The delivering refund.** `private.money_refund_delivered_reference` names the Stripe refund that
  delivered it: the latest resend that settled (L4), or the first settlement.
- **The evidence.** `private.money_refund_late_failure_readback` is the latest readback when it
  names that refund and shows `failed` or `canceled`.

It has no timing clause. Stripe's `failed` and `canceled` are final for a refund, so a readback taken
before a stale settlement event processed still proves the failure (suite 050 covers that order).

Stripe's `refund.updated` observation is shown as a signal to read the refund back, never as
evidence. This follows TRACE-082 decision 3.

### L2 — Recording the failure holds what Stripe returned for the customer

The reviewed operation is `refund_late_failure`:

- **Kernel:** `money_record_refund_late_failure`.
- **Command:** `{operation, authorization, reference, key, reason, evidence}`. `reference` is the
  refund that delivered it, and `key` is the attempt's idempotency key.

The kernel:

- checks the review and the blocker;
- inserts an immutable `money_refund_late_failures` row, keyed by the Stripe refund that failed and
  naming its readback and both operators;
- posts `refund_late_failure`: it debits `stripe_clearing` and credits a new account,
  `customer_refund_payable`, by the refund's amount;
- marks the attempt `failed`.

The refund counters, platform fee, tax and provider share do not change (owner decision 1).
`money_check_journal` gains the one account.

The attempt readers that meant "Stripe settled it" now read "delivered":

- `money_prepare_refund` no longer reports a late-failed refund as already refunded;
  `refund-invoice` then says it failed and to read it back;
- `money_record_refund_result` keeps a late-failed attempt `failed` on a later readback;
- `money_refund_readback_target` gains `delivered` and `late_failure_open`.

Pending, hold and cap checks still read "settled". A late failure does not hold the payout: the
provider's share is already charged.

### L3 — A resend is a reviewed send generation

The reviewed operation is `refund_late_resend`, with the kernel `money_resend_late_refund`. It takes
a reason and no evidence (the evidence shape constraint learns it).

The kernel adds a `money_refund_reissues` generation under a new idempotency key. The row names the
Stripe refund that failed, and the new `approved_by` column names the second operator. The TRACE-082
F3 guard then stops any readback from recording that refund again, and `refund-invoice` skips it
when it lists refunds.

The send blocker, `private.money_refund_late_send_blocker`, shared with the release, allows three
states:

- the late failure itself: the attempt is `failed` on the refund that failed late;
- a resend Stripe failed before it settled, proven by the TRACE-082 F1 readback;
- an uncertain resend Stripe has no refund for, read back at least 24 hours after it was prepared
  (the TRACE-077 rule).

Anything else is `refund_in_flight`.

An open or lost chargeback on the invoice blocks a resend (`chargeback_open`): the customer may be
repaid through the dispute. The command binds the attempt's key, so any resend makes an older request
stale.

The one-operator TRACE-077 reissue and TRACE-082 resend and release still refuse a settled refund.

### L4 — A resend's settlement pays the customer out of what was held

`money_process_event` gains one line before the payment kernel. A refund event is sent to
`private.money_process_refund_resettlement` when it names a refund other than the one that first
settled its authorization. The payment kernel is unchanged.

The handler follows the kernel's receipt, retry and dead-letter handling. It:

- checks the amount, currency, payment and reference;
- requires an open late failure;
- inserts an immutable `money_refund_resettlements` row, one per late failure;
- posts `refund_resettlement`: it debits `customer_refund_payable` and credits `stripe_clearing`;
- marks the attempt `succeeded`.

A replayed or duplicate delivery of the same refund is a no-op. An event for a released refund, or
one with no open failure, fails and is kept for reconciliation, as TRACE-082 F6 does.

### L5 — A release reverses the refund against what was held

The reviewed operation is `refund_late_release`, with the kernel `money_release_late_refund`. It
needs evidence and takes the lifecycle, obligation and attempt locks.

`private.money_refund_reversal` computes the reversal:

- **Journal:** `refund_reversal` debits `customer_refund_payable` by the refund's amount.
- **A full-capture refund:** it credits back the fee difference, the provider share and the tax. The
  fee is recomputed on the retained service, as refunds and chargebacks compute it, so the fee and
  proceeds match what reconciliation expects.
- **A deposit (advance) refund:** it credits the advance.

The obligation's refund counters drop by the refund. The authorization gets a `money_refund_releases`
row, so every TRACE-082 F5 exclusion applies: it frees the caps, and the attempt guard stops it ever
being sent again.

The blockers are:

- **The send state:** the L3 send blocker.
- **`on_ach_statement`:** an unpaid statement on the payout; wait for the bank, as a refund does
  (TRACE-080 R2).
- **`payout_paid`:** the bank already paid this payout, and the restored proceeds would exceed what
  it paid and kept. A paid payout is never paid again, and nothing pays a provider outside a
  statement except L6 for a repayment. See findings.
- **`advance_captured`:** a deposit refund whose invoice has since been paid in full.

When the refund came after the payout, a release clears what the provider owed. If they had
already repaid it, the repayment becomes returnable (L6).

### L6 — A repayment reversal returns what the provider no longer owes

What Mercurius owes back is `private.money_repayment_returnable(payout)`:

> repayments − reversals − max(0, what the bank paid and kept − proceeds)

Here "what the bank paid and kept" is settled less returned transfers, plus late payments. The
result is positive once a return, or a release, leaves a repayment covering an amount the provider no
longer owes. Before the return, the overpayment the provider repaid still exists, so nothing is
returnable.

The reviewed operation is `repayment_reversal`:

- **Kernel:** `money_record_repayment_reversal`.
- **Gateway:** `money_operator_request_repayment_reversal`.
- **Command:** `{operation, obligation, amount, returnable, reason, evidence, key}`.

It mirrors the TRACE-080 R5 recovery. A part amount is allowed. The request is bound to the amount
returnable when it was made, so two approved reversals cannot both run (`returnable_changed`).

The kernel inserts an immutable `money_repayment_reversals` row and posts `payout_repayment_reversal`,
which debits the provider payable and credits the bank.

The TRACE-080 R4 received amount (`private.money_payout_received`) adds reversals back. The
replacement statement therefore pays exactly the proceeds, before or after the reversal.

A reversal is a TRACE-081 bank movement (`reversal`): a debit with no bank reference, like a
repayment. A debit line with no transfer suggests `match_reversal`, and the operator matches it by
hand. The `money_bank_line_matches` movement check learns the kind.

### L7 — Readbacks and reconciliation

`private.money_obligation_reconciliation`:

- a released-after-settlement refund leaves the settled counters. Its refund journal and its
  `refund_reversal` journal are both checked;
- a new `customer_refund_payable` issue compares the account with the open late failures;
- Stripe clearing's expected balance and the readback state add what is held for customers;
- the provider payable and bank checks subtract repayment reversals;
- `refunds` gains `late_failed`, `reversed` and `customer_owed`;
- `payout.recovery` gains `repayment_reversed` and `repayment_returnable`.

`money_record_reconciliation` expects Stripe to hold captured less refunded plus what customers are
owed. A late failure therefore does not open a false readback hold.

`money_finance_reconciliation`:

- **Totals:** `customer_refunds_owed` and `repayments_returnable`.
- **Exceptions:**
  - `customer_refund_owed`: an open late failure;
  - `refund_failed_late`: a delivered refund a readback or Stripe event shows failed, not yet
    recorded;
  - `repayment_returnable`.

`money_finance_operations`:

- `late_refunds`: signals, open late failures and those resolved in the last 30 days, each with
  its state, signal, last readback, blockers, open requests and whether this operator can send it;
- `repayment_returns`;
- request details for the four operations: the release shows the provider share it restores;
- `net_collected` includes what customers are owed;
- recent releases mark a reversed refund.

### L8 — Locks

- **Late failure and resend:** obligation, then attempt, the order `money_prepare_refund` and the
  refund event take.
- **Release and reversal:** lifecycle, then obligation (and attempt), the order recoveries,
  refunds and ACH take.
- **The review runner:** `money_operator_execute_review` takes the same locks before checking.
- **The resettlement handler:** obligation, then attempt, as the payment kernel does.

## Scope

- **Migration** `20260923001000_money_late_reversals.sql`:
  - schema: three immutable tables; `money_refund_reissues.approved_by`; four review operations;
    the evidence shape; the `customer_refund_payable` account; the `reversal` bank movement;
  - commands: four kernels, two gateways (`money_operator_request_late_refund` takes the step:
    `failure`, `resend` or `release`) and the resettlement handler;
  - helpers: blockers, command builders, request details and the two readbacks;
  - fifteen redefinitions of the latest bodies, each copied by a generator that asserts one match
    per substitution.
- **`/admin/finance`:**
  - "Refunds that failed after they settled": read back, request the failure record, send a
    prepared resend, request a resend or a release;
  - "Repayments Mercurius owes back", in the recovery panel;
  - review rows for the four operations;
  - totals and invoice notes for what customers are owed and what is owed back;
  - bank statement wording for returned repayments.
- **Tests:**
  - suite 050;
  - `scripts/phase5-late-reversal-concurrency.mjs`, in CI after the TRACE-082 script;
  - unit and browser cases;
  - regenerated database types;
  - three existing expectations updated for the new fields and wording (see the validation).

`refund-invoice` and the webhook are unchanged. The readback already retrieves the current send and
skips earlier failed refunds, and the late failure's evidence is that readback.

**Not in scope:**

- paying a provider outside a statement for anything but a returned repayment (see `payout_paid`);
- reversing a write-off a later return made unnecessary;
- telling the customer or provider;
- automatic or scheduled readback;
- provisioning finance operators;
- hosted deployment.

## Findings

- **`payout_paid` leaves only a resend.** Suppose a refund was made before the payout, so the payout
  paid the reduced proceeds, and the refund then fails late. Releasing it would owe the provider
  their share with no way to pay it. The release is refused and the refund can only be resent.
  **Review question:** whether a reviewed provider top-up outside a statement should exist, which
  would need an owner decision under CFG-008.
- **A write-off before a return.** If Mercurius wrote off what the provider owed and the bank then
  returns the payout, the replacement pays the proceeds and the write-off stays as a recovery loss.
  The provider payable is left crediting the written-off amount, which nothing pays or reverses.
  Reconciliation still balances, because the payable check includes write-offs. It is recorded, not
  solved.
- **A chargeback blocks a resend but not a release.** A release does not move money to anyone.
  **Review question:** whether an open chargeback should block it too.
- **A returned statement reads stale.** A returned statement older than a later refund reads
  `statement_stale` until it is withdrawn and replaced. That is TRACE-080 behavior, and suite 050
  asserts it before the replacement.
- **Equivalent mutants.** Three are kept as explicit guards:
  - the send key in the failure blocker: the delivering reference changes whenever the key does;
  - the send key in the resend blocker: the `completed` check sees a used key first;
  - the resettlement's open-failure check: without it, the insert fails on its not-null failed
    reference.
- **Detection relies on Stripe's event.** A late failure is found through Stripe's `refund.updated`
  observation or an operator's readback; nothing reads settled refunds back on a schedule.

## Evidence

See the TRACE-083 section of PHASE-5-VALIDATION.md.

## Remaining gates

- **Codex design and code review:** L1–L8, especially:
  - L4's routing line and handler;
  - L5's reversal amounts and `payout_paid`;
  - L6's returnable formula and the R4 change;
  - the review questions above;
  - CI.
- **Provisioning two finance operators.**
- **Authorized Stripe test-mode acceptance:** a refund that fails after it succeeded, its readback,
  a resend that settles and a release.
- **Authorized owner bank workflow acceptance (CFG-008):** now including a repayment sent back after
  a return.
- **Notices:** customer- and provider-facing wording and notification of a refund owed or a
  repayment returned.
