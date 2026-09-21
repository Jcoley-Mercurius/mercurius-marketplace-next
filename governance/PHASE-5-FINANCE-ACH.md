# Phase 5 — Finance operator commands, part 2B: weekly ACH, bank outcomes and retry (TRACE-078)

**Status:** IMPLEMENTED on branch `codex/phase5-finance-ach`, based on `main` `da94fd8`
(PR #33, TRACE-077, merged 2026-09-21). Awaiting CI and Codex design and code review. Merging is
not phase acceptance or production activation. No hosted project, Stripe account, bank or real
money was touched.

**Authorization (2026-09-21):** the owner directed part 2B (preparing ACH batches, recording bank
outcomes and retrying failures) to start after PR #33 was reviewed and merged. PR #33 was merged
the same day. B1–B8 below are implementer choices recorded for review. None is presented as
pre-approved.

## Gap

The weekly ACH kernels (TRACE-054, bridged to the lifecycle in TRACE-055) are `service_role` only
and trust a caller-supplied actor and approver. After TRACE-076/077, preparing a batch, recording
what the bank shows and retrying a failed transfer were the remaining finance commands with no
operator path. CFG-008 requires ACH batch, statement, ledger, hold, failure, retry and
reconciliation scenarios to pass before real payout activation.

## Design

The owner sends each transfer from Mercurius's bank (DECISION-LOG). The database records
permission and evidence only. The three kernels are called unchanged, and TRACE-076/077's
actor rule (`auth.uid()`, never an input), 24-hour window and request-bound approvals apply.

### B1 — Batch preparation is a reviewed request bound to exact money

`money_operator_request_ach(week start, payouts, bank batch reference, reason, key)`:

- The payouts are sorted and de-duplicated. The stored command is byte for byte the object
  `money_prepare_ach` hashes: operation, period, payouts, bank reference and reason.
- That command names no amounts. The request therefore also stores **terms** (new nullable
  `money_review_requests.terms`): each payout's amount, payee and bank authorization at request
  time. The request goes stale with `payable_changed`, `payee_changed` or
  `bank_authorization_changed` if any of them differs when approved or run. The approver
  therefore approves exact money, not only a list of invoices.
- A different finance operator approves; the requester runs it. The kernel records them as the
  batch's `created_by` and `approved_by`.
- The only week rule is the kernel's: seven days, not overlapping another batch
  (`period_taken`). No weekday, cutoff or future-date rule is invented (DECISION-LOG).

### B2 — A bank outcome is recorded by one operator

`money_operator_record_ach(attempt, outcome, bank reference, evidence, key)` follows the kernel,
which takes no approver. Its transitions are unchanged: prepared → submitted; submitted or
unknown → unknown, settled or failed; settled → returned. Settlement and return post their
journals through the kernel.

**Review question:** confirm that one operator may record `settled` and `returned`. They post
ledger entries, but they record an external fact rather than make a financial decision. The
decision was the batch or retry, which two operators approved.

### B3 — Recording the submission is the pre-send check

`submitted` re-proves eligibility, as the kernel does: still payable, at the statement amount, to
the bank authorization the statement was prepared with. The panel tells the operator to record it
**immediately before** sending at the bank, and not to send if it is refused. A database lock
cannot span the bank session, so the gap between recording and sending remains (TRACE-055).

**Review question:** the kernel requires the bank reference at submission. Confirm that the
owner's bank gives a reference (trace number, batch line or similar) before the transfer is sent.
If it does not, the order of these steps needs an owner decision.

### B4 — References

- Later outcomes reuse the reference recorded at submission when none is entered. A different
  reference is refused (`bank_reference_conflict`), and so is one already used by another
  transfer (`bank_reference_used`, which the kernel would raise as a raw unique violation).
- Bank event keys are namespaced `finance-ach:<key>`. A replay with the same key and details
  replays; the same key with other details conflicts.
- Operators receive only the last four characters of a transfer reference. The batch's bank
  reference is shown in the request details while it is reviewed, because it is part of the
  command being approved. It is not returned in the batch readback.

### B5 — A retry is a reviewed request bound to the failed attempt

`money_operator_request_ach_retry(failed attempt, reason, key)`. The kernel command is only
`{operation: ach_retry, item}`, so a retry after a second failure hashes identically to the
first. The request's subject is the failed attempt and approvals are bound to their request
(TRACE-077 R2). The first retry's approval therefore never carries over: suite 045 proves it.
A superseded attempt reads `completed`, and an unknown outcome is never retried
(`bank_outcome_open`).

### B6 — Gateway guards stricter than the kernel

- **Retry after a bank authorization change is refused.** `money_retry_ach` does not check the
  bank authorization. Its new prepared attempt could never be submitted, and a prepared attempt
  cannot be withdrawn, so the payout would have no way forward.
- **Two current bank authorizations are refused** (`bank_authorization_ambiguous`) before
  `money_prepare_ach`'s strict lookup would fail with a raw "more than one row".

### B7 — Eligibility mirror and readback

- `private.money_ach_payable` mirrors `public.money_payable` and `private.money_payable` without
  writing completion evidence, then the kernel's bank lookup. It names the first reason a payout
  cannot be prepared or sent. The kernels still decide at execution. Suite 045 checks the
  mirror against the kernel for the window, holds, disputes and conflicting completion evidence.
- `money_finance_operations` adds `ach`: `next_period_start`; `ready` payouts (payable now, not on a
  statement, with amount, payee, eligibility time and any open batch request); and `batches` that
  are recent or have an unsettled transfer. Each batch item carries its latest attempt, status,
  reference hint, latest event evidence, and `submit_blocker` or `retry_blocker`.
- Request `details` for a batch list each payout with its amount, payee and live blocker. For a
  retry they show the attempt, outcome and amount. An expired request computes no live blockers.

### B8 — Locks

Batch executions serialize on one advisory lock, because different requests' weeks may overlap.
Each then takes the kernel's order: lifecycle, provider onboarding, obligations. Outcome
recording and retry take the same order for their one payout. A refund, hold or dispute racing a
batch is therefore seen under the lock and refused with its reason.

## Scope

- Migration `20260921001000_money_finance_ach.sql`: `terms` column and constraint updates on
  `money_review_requests`; `authenticated` `money_operator_request_ach`, `_request_ach_retry`,
  `_record_ach`; replaced `_approve_review`, `_execute_review`, `money_finance_operations`; a
  terms-aware request store (the TRACE-077 signature delegates to it); private command builders,
  eligibility mirror, blockers and readback builders. No kernel, kernel grant or payout predicate
  changes.
- `/admin/finance`: new `FinanceAchCommands` section with a batch form (week, ready payouts, bank
  batch reference, total), a bank outcome form (transfer, allowed outcomes, reference, evidence)
  and batch lists with next steps and retry requests. Review rows show a batch's payouts, total and
  reference. If the readback lacks `ach`, the section says not to send transfers instead of
  failing the page.
- Suite 045, `scripts/phase5-finance-ach-concurrency.mjs` (in CI after the part 2A script), unit
  and browser cases, and regenerated database types (additions only).

**Not in scope:** replacement statements for a changed amount or bank authorization; withdrawing a
prepared attempt; recovery of already-paid funds; bank statement import; notifying providers;
provisioning finance operators; hosted deployment; changing G5 (see findings).

## Findings (existing behavior, unchanged)

- **A hold cannot be placed on a payout once it is on a statement** (TRACE-076 G5, "a hold cannot
  stop it"). After this slice that reason is only true once a transfer is submitted. A hold does
  stop a prepared transfer's submission and a failed one's retry: suite 045 shows both with a
  kernel-placed hold. **Review question:** allow operator holds on statement payouts whose
  latest transfer is prepared, failed or returned.
- A prepared attempt cannot be withdrawn. If its amount or the provider's bank authorization
  changes, it stays blocked (`statement_stale`, `bank_authorization_changed`) until the
  replacement-statement workflow exists.
  *TRACE-079 (PHASE-5-ACH-REPLACEMENT.md) adds reviewed withdrawal and replacement statements.*
- An `unknown` outcome has no deadline. It holds its payout until the bank shows an outcome.
- The eligibility mirror duplicates the kernel predicates, as TRACE-075 does. A future kernel
  change must update both.
- Each operations readback evaluates every obligation without a statement. This is acceptable at
  pilot scale and will need attention with volume.
- `paymentFunctionError` still loses Edge error codes (TRACE-076 finding). Failed-refund recovery
  remains open (TRACE-077 finding).

## Evidence

See the TRACE-078 section of PHASE-5-VALIDATION.md.

## Remaining gates

Codex design and code review (B1–B8, especially the B2, B3 and G5 questions); CI; replacement
statements and prepared-attempt withdrawal; already-paid recovery; bank statement reconciliation;
provisioning two finance operators; authorized owner bank workflow acceptance of batch, failure,
return and retry (CFG-008).
