# Phase 5 — Finance reconciliation readback (TRACE-075)

**Status:** IMPLEMENTED on branch `codex/phase5-finance-reconciliation`, based on `main`
`d422816` (PR #30, TRACE-074, merged). PR open, awaiting CI and Codex code review. Merging is not phase acceptance or production activation. No hosted project, Stripe
account, bank or real money was touched.

**Authorization (2026-09-16):** the owner directed the next Phase 5 slice, "finance
operations: reconciling charges, refunds, earnings and payouts". The bounded scope below and
decisions D1–D5 were chosen by the implementer and are recorded for review, not presented as
pre-approved.

## Gap

TRACE-050–059 built the money kernels: snapshots, durable checkout attempts, a durable Stripe
inbox, balanced integer-cent journals, dual-reviewed refunds, chargeback allocation, Stripe
readback observations and owner-operated weekly ACH statements. Every finance command is
service-role only with an explicit actor. There was no operator surface: nobody could see
whether each invoice's charges, refunds, earnings and payouts agree with the ledger, why a
payout is held, or which payment or bank outcomes need action. The "finance workbench" is an
open gate on TRACE-054/057/058, and MPS §6.5 requires ledger totals to reconcile among customer
charge, refunds, processor cost, Mercurius fee and provider payable.

## Scope

Read-only. Migration `20260916001000_money_finance_reconciliation.sql` adds:

- `public.money_finance_reconciliation()`: finance authority only (admin role plus
  `money_authorities`, through the existing `money_require_finance`). It returns per-invoice
  reconciliation, ledger-wide account debits and credits, totals, and an exceptions queue.
- Private helpers: `money_account_net`, `money_unprocessed_events`,
  `money_obligation_reconciliation`. No client grant.

New `/admin/finance` page ("Finance Reconciliation" in the admin navigation): totals, the
exceptions queue with next actions, invoices filtered by attention or funds state, and ledger
accounts, all rendered as ResponsiveDataList with PageState for loading, empty, error and
permission states.

**Not in scope:** any write command or operator gateway for refunds, holds, readbacks,
exclusions, chargeback allocation, ACH preparation or bank outcomes; scheduled Stripe
readback; bank statement import; tax/promotion configuration; already-paid recovery.

## Checks per invoice

Every expected value comes from the existing kernels:

| Area | Check (issue code) |
|---|---|
| Charges | Captured counter = captured checkout attempts (`charge_attempts`) = capture journals (`charge_ledger`) |
| Refunds | Refunded service/tax/tip = provider-settled authorizations (`refund_counters`); one refund journal per settlement, clearing credits = refunded total (`refund_ledger`) |
| Earnings | One earnings journal once the full total is captured, none before (`earnings_posting`); platform revenue = round(retained service × 15%) (`platform_fee`); tax liability = retained tax (`tax_liability`); customer advance clears on full capture (`customer_advance`) |
| Payouts | Provider payable = retained service − fee + retained tip − recorded settlements + recorded returns (`provider_payable`); bank account = returns − settlements (`bank_ledger`); the ACH statement still matches the retained amounts, snapshot and payee (`statement_stale`) |
| Chargebacks and costs | Suspense = open plus lost-unallocated disputes (`chargeback_suspense`); Stripe clearing = captured − refunded − open/lost disputes − processor costs (`stripe_clearing`) |
| Stripe readback | Latest observation: `none`, `matched`, `mismatch`, or `outdated` (money moved since) |

## Decisions for review

- **D1: readback before commands.** Operator commands need an authenticated gateway that
  turns a signed-in finance operator into the kernels' `p_actor` and runs the separate-approver
  flow. That is a trust-boundary design, so it is left to its own slice.
- **D2: finance authority, not operator role.** Reconciled money is restricted to
  `money_require_finance` (MPS §4 "restricted finance authority"). A plain admin gets the
  permission state.
- **D3: funds state (MPS §5.5).** `scheduled`/`paid`/`payout_failed` come only from the latest
  recorded bank attempt (prepared/submitted/unknown are scheduled; failed and returned are
  payout failed). `reversed` is never reported because no already-paid recovery contract
  exists. Without a statement, the state is `not_eligible` (payment incomplete, awaiting
  confirmation, replacement reconciliation, inside 48 hours, no proceeds) or `held`
  (dispute/appeal, chargeback, reconciliation, unprocessed Stripe event, payout hold, pending
  refund, payout onboarding), otherwise `eligible`. These predicates mirror `money_payable`
  without writing the completion evidence it records. That duplication is guarded by a parity
  assertion over every unscheduled fixture, and ACH preparation still re-proves eligibility.
- **D4: data minimization.** Stripe payment, refund, dispute and event IDs are returned so an
  operator can find them at Stripe. Bank references, bank authorization references, approval
  reasons, evidence text, tax evidence and customer identities are not.
- **D5: listing bound.** All invoices are evaluated for totals and exceptions; the invoice list
  shows 200, those with ledger issues first, and the page says when it is truncated.

## Finding surfaced (existing kernel behavior, unchanged)

An unprocessed `reconciliation_required` event (any Stripe event type the webhook does not
support) makes `money_payable` hold **every** payout, because that predicate is not scoped to
an obligation. The readback reports it as `global_event_holds`, flags the exception as holding
all payouts, and the page shows a banner. Whether this global hold is intended is an owner
question; this slice does not change it.

## Evidence

See the TRACE-075 section of PHASE-5-VALIDATION.md.

## Remaining gates

Codex code review; CI; finance operator command gateway (refund send, holds,
readback recording and resolution, exclusions, chargeback allocation, ACH preparation and bank
outcomes) with ConfirmAction and second-person approval; scheduled Stripe readback and bank
statement import; owner decision on the global unsupported-event hold; provisioning two
finance operators; authorized Stripe/bank acceptance.
