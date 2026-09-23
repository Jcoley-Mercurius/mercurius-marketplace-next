# Phase 5 — Already-paid payout recovery (TRACE-080)

**Status:** IMPLEMENTED on branch `codex/phase5-already-paid-recovery`, based on `main` `68f0da3`
(PR #35, TRACE-079, merged 2026-09-21). Awaiting a PR, CI and Codex design and code review.
Merging is not phase acceptance or production activation. No hosted project, Stripe account, bank
or real money was touched.

**Authorization (2026-09-21):** after PR #35 merged, the owner directed this slice. The owner
answered four semantics questions before implementation:

1. **All three cases.** A customer refund after the payout settled, a lost chargeback after the
   payout settled, and a withdrawn transfer the bank later shows as paid (TRACE-079 W5). All three
   leave what the provider owes as one kind of balance.
2. **A late payment is a separate recovery event.** The withdrawn attempt is not changed and the
   TRACE-078/079 bank state machine is not reopened.
3. **Repaid or absorbed.** An amount owed is closed by a repayment the provider sent, or by a
   write-off Mercurius absorbs. Each needs two operators, and part amounts are allowed. Netting
   against other earnings and automatic bank debit stay unauthorized (DECISION-LOG, chargeback
   policy).
4. **No automatic effect on other payouts.** An amount owed does not hold the provider's other
   payouts. Operators can still place the existing manual hold.

R1–R8 below are implementer choices recorded for review. Only the four answers above are owner
decisions.

## Gap

Characterized on `68f0da3`:

- A refund authorization, its request and the cancellation refund list refused any payout on a
  live statement (`on_ach_statement`, and the kernel's `money_refund_bank_guard` trigger). A
  settled payout could never be refunded.
- A lost chargeback on a settled payout could not be allocated ("Scheduled or paid funds require
  manual recovery review; no automatic clawback"). The payout also stayed `dispute_open`.
- A withdrawn transfer that the bank paid after all could not be recorded (`withdrawn`). A
  replacement could then be prepared and sent, paying the provider twice with nothing in the
  ledger.
- There was no record of what a provider owes, and no way to close it.

## Design

### R1 — What a provider owes is the debit balance of the payout's provider payable

The refund and chargeback kernels already debit the provider payable by the provider's share.
Once a payout settled, that debit takes the balance below zero. `private.money_payout_owed` reads
that debit balance, or zero. It is per payout (obligation), because journals are per payout and
nothing may net one payout against another.

### R2 — Refunds and chargebacks wait only for a statement the bank has not paid

`private.money_ach_unpaid_statement` is true when the live statement's latest attempt is anything
but `settled`. It replaces the TRACE-079 live-statement test in four places, copied mechanically:

- the refund blocker;
- the `money_refund_bank_guard` trigger;
- the chargeback blocker;
- `money_resolve_chargeback_loss`.

A prepared, failed or returned transfer is still withdrawn first, and a submitted or unknown one
still waits for its outcome. The chargeback kernel's refusal now reads "Scheduled funds need their
bank outcome or a withdrawal first; no automatic clawback".

Holds, batch terms and the ready list keep the live-statement test. A hold on a settled payout
stops nothing.

### R3 — A late payment of a withdrawn transfer is a reviewed event

The request is `money_operator_request_ach_late_settlement(attempt, bank_ref, reason, evidence,
key)`. The kernel is `money_record_ach_late_settlement`, service-only like the other ACH kernels.
The stored command is `{operation: ach_late_settlement, attempt, bank_ref, reason, evidence}`, and
two operators review it under TRACE-076/077's rules.

The kernel:

- requires a `withdrawn` attempt;
- requires the reference to match the one recorded at submission, if the attempt had one, and not
  to be recorded for any other transfer or late payment;
- inserts an immutable `money_ach_late_settlements` row;
- posts `ach_late_settlement`, which debits the provider payable and credits the bank for the
  statement amount, like a settlement.

The withdrawn attempt, its events and its withdrawal are not changed.

Any withdrawn transfer can take a late payment, whether it was prepared, failed or returned when
withdrawn. **Review question:** whether a late payment of a withdrawn *returned* transfer should be
refused. Its settlement and return are already recorded, so a later payment would be the bank
paying it a second time.

What the late payment means depends on what happened next:

- **A replacement also settled.** The provider was paid twice and owes the duplicate (R1).
- **No replacement.** The payout is paid, and R4 stops any replacement.
- **A replacement waits to be sent.** R4 stops it from being sent, and it can be withdrawn.

### R4 — One guard: never pay more than the proceeds

`private.money_ach_proceeds_guard` runs as a `before` trigger on every writer:

- new statement items;
- new attempts;
- the `prepared`→`submitted` update.

It refuses when what the provider has received and kept, plus the transfer, exceeds the payout's
proceeds. "Received and kept" is settled transfers less returns, plus late payments, less
repayments (`private.money_payout_received`). The proceeds are the retained service less the 15%
fee, plus the retained tip. That is `money_payable`'s amount.

The readback mirror `private.money_ach_payable` returns `already_paid` for the same condition. The
ready list, batch terms, submission and retry blockers therefore show it before any kernel refuses.

The guard reads bank evidence, not journals. On a consistent ledger both give the same answer. See
the findings for why the evidence form was chosen.

### R5 — Repayments and write-offs are reviewed and bound to the amount owed

The request is `money_operator_request_payout_recovery(obligation, kind, amount, reason, evidence,
key)`, with kind `repayment` or `write_off`. The kernel is `money_record_payout_recovery`. The
stored command names the amount owed when it was requested, and its key:

- **Amount owed.** The request goes stale (`owed_changed`) if a refund, chargeback, late payment
  or other recovery changes the balance first. Two approved recoveries of the same balance cannot
  both run.
- **Key.** Approvals are reusable (`money_require_review`), so a replayed approval replays the
  recorded recovery instead of recording it twice. A replayed request keeps the amount owed it was
  first requested against.

What each one does:

- **Repayment:** debits the bank and credits the provider payable. Record it once the bank shows
  the credit.
- **Write-off:** debits a new account, `provider_recovery_loss`, and credits the provider payable.
  `money_check_journal` gains that one account; nothing else in it changes.

The immutable `money_payout_recoveries` row names the kind, the amount, the balance before it, the
payee, both operators, the reason and the evidence.

### R6 — No hold, no netting

Owner decision 4 is implemented by adding nothing: no hold, blocker or eligibility check reads the
amount owed. Suite 047 asserts that the same provider's other payout stays ready while they owe.
The exception text and the panel say never to debit the provider's bank or hold back other
earnings.

### R7 — Locks

- **Late payment:** takes the withdrawal's order: lifecycle, provider onboarding, obligation,
  attempt. A submission or batch racing it is refused under the lock (`already_paid`).
- **Recovery:** takes lifecycle, then obligation, the order refunds and chargebacks use.
  `money_operator_execute_review` takes the same locks before checking, so a second recovery of
  the same balance sees the first and goes stale.

### R8 — Readback and reconciliation

`money_finance_operations.recoveries` has four parts:

- `owed_total`;
- `owed`: payouts with a balance owed, or a recovery or late payment in the last 30 days. Each
  shows what was paid, returned, paid late, refunded, lost to chargebacks, repaid and written off,
  its recovery history and any open request;
- `withdrawn`: withdrawn transfers without a late payment, newest 200;
- `late_settlements`: the last 30 days.

Recovery and late-payment requests read back their details. A late payment's details include the
payout's replacement statement and its status, so the approver sees a duplicate before approving.
Withdrawn batch rows show a late payment. Bank references are returned as their last four
characters only.

Changes to `money_obligation_reconciliation`:

- late payments count as paid;
- the provider payable check becomes `proceeds - paid + returned + repaid + written_off`;
- the bank check becomes `returned - paid + repaid`;
- a new `recovery_ledger` issue compares the recovery-loss account with the recorded write-offs;
- a settled statement is no longer reported stale when a refund or chargeback changes the
  retained amounts. It records what was paid, and the difference shows as owed;
- a payout with no live statement but a late payment reads `paid`;
- `payout.recovery` gives the amount owed, late payments, repayments and write-offs.

`money_finance_reconciliation` adds `totals.provider_owed` and a `provider_owes` exception.

MPS §5.5's `reversed` funds state is still never reported. **Review question:** whether a payout
whose provider owes, or has repaid, should read `reversed` rather than `paid`.

## Scope

- Migration `20260921003000_money_payout_recovery.sql`:
  - schema: the `provider_recovery_loss` account; the immutable `money_ach_late_settlements` and
    `money_payout_recoveries`; the proceeds-guard triggers; the `ach_late_settlement` and
    `payout_recovery` review operations;
  - commands: the two kernels and the two gateway requests;
  - helpers: owed, received, exceeds-proceeds and unpaid-statement helpers, command builders,
    blockers, request details and the recovery readback;
  - the R2 predicate substitutions;
  - redefinitions that learn the new operations and states:
    - `private.money_ach_payable`;
    - `private.money_request_blocker`;
    - `public.money_operator_execute_review`;
    - `public.money_finance_operations`;
    - `private.money_ach_operations`;
    - `private.money_obligation_reconciliation`;
    - `public.money_finance_reconciliation`.

  Each redefinition is the latest body copied by a generator that asserts exactly one match per
  substitution.
- `/admin/finance`:
  - a new "Amounts providers owe" section: the owed list, a repayment or write-off form, and a
    late-payment form;
  - a warning on the refund and chargeback forms when the payout was already paid;
  - review rows for both new requests. A late payment shows whether a replacement was also paid;
  - late payments on withdrawn batch rows;
  - an "Owed by providers" total, a "Provider owes Mercurius" exception, and "Provider owes" on the
    invoice row.
- Suite 047, `scripts/phase5-payout-recovery-concurrency.mjs` (in CI after the TRACE-079 script),
  unit and browser cases, and regenerated database types.

**Not in scope:**

- collecting from providers: no bank debit, no netting, no automatic hold;
- notifying providers, or showing an amount owed in the vendor portal;
- bank statement import;
- a return recorded after a repayment (see findings);
- failed-refund recovery (TRACE-077) and `paymentFunctionError` (TRACE-076);
- provisioning finance operators;
- hosted deployment.

## Findings

- **The guard reads bank evidence, not journals.** A first draft compared the transfer with the
  ledger's provider payable. Suites 024 and 027 build fully captured payouts by setting the
  `captured` counter directly, without the capture event that posts earnings, and their first
  payout was refused. The guard now uses bank evidence and retained amounts, which do not depend
  on how a fixture was built. On a consistent ledger it is equivalent. The amount owed (R1) still
  reads the ledger, because recoveries post against it.
- **A return after a repayment.** Suppose the bank returns a settled transfer after the provider
  already repaid part of it. The provider payable then shows Mercurius owing that repayment back.
  No reviewed path pays it back: the replacement statement pays the payout's proceeds, not the
  repayment. Reconciliation shows the positive payable. This is recorded for review, not solved.
- **Fixture weeks.** The concurrency script's weeks start at +210 days, after the TRACE-078 and
  TRACE-079 scripts, because CI runs all of them on one database.

## Evidence

See the TRACE-080 section of PHASE-5-VALIDATION.md.

## Remaining gates

- Codex design and code review: R1–R8, especially R3's returned-transfer question, R4's guard and
  R8's `reversed` question. CI.
- Bank statement reconciliation, which is where most late payments will be found.
  *TRACE-081 (PHASE-5-BANK-STATEMENTS.md) adds it, and resolves such a line into this slice's
  reviewed late payment request.*
- A reviewed path for a return recorded after a repayment.
  *TRACE-083 (PHASE-5-LATE-REVERSALS.md) adds it: a reviewed repayment reversal, recorded once
  Mercurius has sent the repayment back, and received amounts that count it.*
- Provider-facing wording and notification of an amount owed (MPS §6.5 "role-appropriate money
  states").
- Failed-refund recovery (TRACE-077); `paymentFunctionError` (TRACE-076).
- Provisioning two finance operators.
- Authorized owner bank workflow acceptance (CFG-008), now including a late payment, a repayment
  and a write-off.
