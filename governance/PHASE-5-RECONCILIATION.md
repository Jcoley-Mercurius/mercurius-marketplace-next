# Phase 5: independent money and onboarding slices

Status: implementation in progress; no activation or phase acceptance claimed.

## Verified base and authority

Remote main was fetched on 2026-09-04 UTC at
`d8cceee30a934c17804a0f507cb41c289dc8e417`. PR #4 was independently checked through
GitHub: OPEN, draft, `merged=false`, no merged timestamp, head
`91bc94f46d31255e4d5cfd771d88a3271ff8e4f2`. The merge-preview SHA is not a merge.
`codex/phase5-money-integrity` starts at main in `MercuriusMarketplace.phase5`.
No Phase 4 commit, cherry-pick, branch edit or worktree edit is part of this work.

Read authorities: AGENTS.md; OWNER-APPROVALS; CONFIGURATION-DECISIONS;
DECISION-LOG; approved MPS, MDS and MTS blueprints; combined roadmap;
TRACEABILITY; Phase 2 validation/Edge recovery; Phase 3 handoff/validation;
Phase 4 handoff, reconciliation, validation and decisions (read-only at the
above PR head). MPS §§5.3–5.5, 6.5, 7–8; MDS MoneySummary/ConfirmAction;
MTS §§7, 10, 13; CFG-004–008 and 011 are the Phase 5 requirements.

## Recovered behavior before changes

| Path | Evidence and integrity gap |
|---|---|
| checkout-request | Resolves package pricing or a hard-coded catalog; updates mutable request totals; allocates count-based invoice numbers; creates customers/sessions without durable attempts. Recurring frequency creates a Stripe subscription attached to one request. Deposits are blocked by a launch flag. |
| create-checkout | Separate invoice path; uses browser Origin as return target; quote summary fields rather than immutable terms; no stable session idempotency; unchecked persistence errors. |
| stripe-webhook | Inserts dedup marker before effects; many writes ignore errors; catch deletes event evidence. Failed events can overwrite paid state. Partial refunds are ignored. Won disputes use a new 24h timer, and lost disputes are labelled refunded. Subscription renewals share a request and count-derived invoice numbers. |
| refund-invoice | Admin-only full-refund endpoint, stable full-refund key and provider readback, but no durable local attempt or component ledger. Rejects partial histories; a reason can fall back to generic text. |
| invoice/job triggers | Legacy capture/release labels and mutable aggregate invoice amounts do not establish settled ACH or current homeowner-confirmation provenance. They must not be consumed as payout proof. |
| vendor-invite | Email-based bounded Auth scan; creates active contractor before invite succeeds; role/link/application writes are non-atomic; unchecked writes and password-email results; account sign-in is treated as activation. |
| application API/documents | Existing submission and private document upload records are intake evidence, not a versioned approved compliance checklist. Preserve private object handling and retention; never infer licence/insurance verification from uploaded files. |

## Independent boundary

New contracts retain their own commercial, financial and onboarding evidence.
They do not update lifecycle status, invoke matching, install Cron, or interpret
legacy `released` as paid. No Phase 4-only relation is referenced. Both checkout
entrypoints now delegate to `_shared/moneyCheckoutHandler.ts`; the customer reviews
an immutable snapshot before authorizing the attempt. Invoice/request IDs can only
open that review, never supply amounts. Snapshot intake is restricted, separately
reviewed manual pricing until the authoritative offering/quote adapter is connected.

Checkout, refund and webhook handlers default disabled and accept only explicit
test mode with test Stripe keys. No environment was enabled or provider invoked.
The former five payment/onboarding implementations are preserved verbatim under
`governance/recovered-edge/`; the export digest test reads those archives where
active implementations changed. Legacy vendor-invite approval/resend no longer
creates active providers or sends email; it requires the versioned review instead.
The independent invitation endpoint can prepare evidence, not provision an Auth
account or grant vendor access. Those integration steps remain explicit gates.

Phase 4 dependencies to integrate after merge/review:

1. Accepted quote revision and fixed offering validation must produce a full
   immutable commercial snapshot; a legacy quote amount is insufficient.
2. Homeowner confirmation actor/time/evidence and live dispute/appeal state must
   feed payout eligibility under the same transaction/lock as batch reservation.
3. Cancellation/reschedule/exception assessments must reference their immutable
   operation and waiver evidence. They are not executed refunds.
4. Recurring visits require separate commercial/payment identities; do not reuse
   subscription renewal payments as proof of separate fulfilled visits.
5. Current onboarding eligibility must join matching at selection AND acceptance;
   activation does not bypass exact ZIP/service/availability checks.

## Unspecified configuration: fail closed

Tax requires a versioned calculation/remittance authority, including evidence
for a zero result. Promotion terms require funding, stacking/limits, allocation
and expiry authority. No default tax rate or promotion allocation is invented.
Chargebacks retain a separate loss/suspense balance and hold until approved
allocation; they are not customer refunds. DEC-011 resolves ACH as owner-operated
bank transfers and requires all vendors to be licensed and insured. Private bank
authorization evidence is mandatory. No banking API or Connect account is needed.
Category/jurisdiction-specific licence/insurance sufficiency still requires a
reviewed requirement version. No real provider calls or emails are authorized.

## Recovery and remaining integration gates

- Failed event effects roll back, but receipt/attempt/error state persists. Replay
  requires a finance actor and reason. Reviewed no-effect exclusions require a
  second authenticated approval and provider readback evidence; they remain
  dead-letter records and are never relabelled captured/processed.
- Capture/refund readback records detect even one-cent drift. Clearing that flag
  requires current matching readback and a separately approved resolution. Other
  dispute/event/onboarding holds remain independent.
- Provider expiry evidence is required before a fresh checkout key. Uncertain
  attempts are never reissued beyond the provider idempotency window. Pending or
  failed refunds retain their reserved allocation until operator reconciliation;
  release/replacement of a failed refund authorization is a further integration gate.
- Bank outcomes are manual evidence, not bank integration proof. Unknown transfers
  cannot be retried. Changed bank authorization or changed amounts require a
  reviewed replacement statement; this slice blocks rather than silently edits
  an immutable reserved statement. Full bank statement replacement and recovery
  of already-paid funds remain an operations integration gate.
- Legacy invoice/job aggregate fields and inherited money triggers are not
  backfilled into the new ledger. Migration/cutover must reconcile outstanding
  sessions, recurring subscriptions, refunds and released invoices before use.
- Auth provisioning, private bank form collection, document sufficiency review,
  delivery receipts and live matching integration are not proven by synthetic
  evidence. Expired evidence removes eligibility at query time; no Cron is needed.
- CFG-011 retention and legal-hold/purge procedures must cover private application
  revisions and object references before activation. No purge job is installed;
  append-only audit storage is not permission to retain rejected documents forever.

Provider protocol references checked read-only on 2026-09-04:
[Stripe webhook delivery and signature rules](https://docs.stripe.com/webhooks),
[idempotency retention](https://docs.stripe.com/api/idempotent_requests), and
[dispute lifecycle](https://docs.stripe.com/disputes/how-disputes-work).
These establish protocol behavior, not Mercurius tax/legal classification or
evidence that a provider integration test was run.
