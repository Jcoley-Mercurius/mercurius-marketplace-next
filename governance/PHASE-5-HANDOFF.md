# Phase 5 handoff — independent money and onboarding contracts

## Current follow-ups: commercial sources, direct ACH and cancellation refunds

PRs #4–7 are merged. TRACE-054 binds checkout to accepted quote revisions and
eligible fixed offerings, while TRACE-055 binds payout eligibility to authenticated
lifecycle confirmation receipts and current dispute/appeal evidence. See
PHASE-5-QUOTE-CHECKOUT.md and PHASE-5-COMPLETION-PAYOUT.md for exact behavior,
measured evidence and limitations.

TRACE-056 binds the canonical customer-cancellation assessment to deterministic
per-payment refund allocations and the existing dual-reviewed refund kernel. See
PHASE-5-CANCELLATION-REFUNDS.md. Zero-refund outcomes create no provider work;
provider cancellations remain blocked until acceptable-replacement exhaustion is
recorded.

The quote/checkout slice implements accepted
quote/eligible fixed-offering source capture, source-bound snapshot publication,
stale-source guards and idempotent checkout. See PHASE-5-QUOTE-CHECKOUT.md for exact
behavior, measured evidence and limitations. This does not close all of Phase 5.

The quote amount remains the accepted **total**. Full allocation is separately
reviewed and displayed by checkout. An already reserved agreement and its deposit
balance retain their price despite later catalog edits. New unreserved stale terms
require renewed review. Request-bound source changes remain blocked across an
uncertain provider attempt.

The completion/payout slice validates the original homeowner-confirmation clock at
preparation, submission and retry. Resolved disputes do not restart it; an appeal
after statement preparation blocks submission, while an already submitted bank
outcome remains recordable under a later hold so the ledger stays truthful. No bank
transfer, deployment or scheduler is initiated.

TRACE-057 records canonical replacement outcomes and connects exhausted provider
cancellations/no-shows to reviewed full refunds. See PHASE-5-PROVIDER-REFUNDS.md.
Paid replacements retain their original captured agreement. TRACE-058 now records a
dual-reviewed payee reassignment to the canonically accepted replacement and binds
completion and ACH to that provider; changed-price replacement checkout remains blocked.

TRACE-059 gives every recurring occurrence a distinct obligation, snapshot and payment
identity; subscription renewals remain no-effect observations rather than visit funding.
See PHASE-5-RECURRING-IDENTITIES.md.

TRACE-060 connects matching and offer acceptance to private onboarding eligibility,
with an explicit legacy cutover path only for providers without an onboarding record.
See PHASE-5-VENDOR-MATCHING-ELIGIBILITY.md. TRACE-061 adds reviewed provider cutover
and service/ZIP compliance requirements; real requirements and decisions remain an
authorized activation task. Remaining work includes tax and promotion configuration,
finance tooling, recovery and cutover, authorized provider checks, and manual acceptance.

TRACE-062 adds the provider compliance operations interface and private evidence
review/binding workflow. See PHASE-5-COMPLIANCE-OPERATIONS.md for scope, evidence
reuse, stale-review protection and remaining onboarding operations. Phase 5 remains
open; implementation of this interface does not activate provider cutover.

TRACE-063 adds durable local-only invitation dispatch, unknown-outcome reconciliation
and verified recipient acceptance receipts. See PHASE-5-VENDOR-INVITATIONS.md.
Hosted delivery, operator queue wiring and existing-account linking remain gates;
acceptance never activates a provider.

## Original independent checkpoint

Draft checkpoint, not phase acceptance. Branch `codex/phase5-money-integrity` starts
at fetched main d8cceee30a934c17804a0f507cb41c289dc8e417 in a separate worktree.
PR #4 was rechecked OPEN, draft, unmerged at 91bc94f. Its branch and worktree were
not modified. See PHASE-5-RECONCILIATION.md for approved requirements and recovered
behavior characterized before replacing the five active entrypoints.

## Delivered slices

- Both checkout entrypoints use the same authenticated snapshot/attempt contract.
  The homeowner reviews the immutable full breakdown in shared MoneySummary and
  ConfirmAction controls. Amounts originate in reviewed server evidence; Stripe
  session keys survive retries. Checkout returns do not prove payment.
- A minimized, durable Stripe inbox retains failures and supports audited replay.
  Transactional effects, distinct event/payment identities and balanced integer-cent
  journals cover deposits, earned fees, tax, tips, discounts, refunds and disputes.
  Processor costs remain Mercurius expenses. Separate authenticated approvals bind
  exact financial commands; supplying another operator UUID is not approval.
- Weekly manual ACH contracts reserve immutable statements after homeowner-confirmed
  completion plus 48 hours, with current vendor/bank evidence and independent holds.
  Unknown bank results cannot be retried; failed/returned transfers retain history.
  Only recorded settlement posts payment. There is no Connect or bank API call.
- Application revisions and version-bound compliance evidence control activation,
  suspension and renewal. Every vendor needs current licensing and insurance.
  Invitation evidence cannot grant a role, send email or activate a contractor.
- Additive migrations depend only on main's recovered schema; no Phase 4-only
  relation is assumed. Legacy source is archived for characterization, not execution.

## Acceptance gates for this draft

- [ ] Final-head CI passes sequential backend and application jobs.
- [ ] Owner/code review accepts command authority, financial allocation, concurrency,
  versioned evidence, privileges and default-disabled integration boundaries.
- [ ] Owner accepts the delegated chargeback implementation in DEC-2026-011.

## Gates before integrated activation

- [ ] Phase 4 merges and its authoritative offering/accepted quote revisions feed
  snapshots; cancellation/exception assessments feed reviewed refund allocations.
  No duplicate lifecycle implementation or hard-coded cancellation engine is added.
- [ ] Phase 4 confirmation actor/time and dispute/appeal evidence feed batch eligibility
  transactionally. Current vendor eligibility joins both matching and acceptance.
  Recurring visit generation and charge timing receive approved operating configuration;
  implemented occurrences already receive distinct commercial/payment identities.
- [ ] Versioned tax calculation/remittance and promotion funding/allocation/limits
  are approved. Synthetic values are not policy. Two finance operators are provisioned.
- [ ] Legacy sessions, subscriptions, invoices, refunds and released states are
  reconciled for cutover; legacy aggregates never become payout evidence by assumption.
- [ ] Authorized Stripe test delivery/readback proves timeout, retry and reconciliation
  behavior end to end. Gateway/JWT integration is tested in an authorized environment.
- [ ] Bank forms, authorized owner workflow, statement reconciliation and failed or
  unknown bank outcomes are demonstrated. Changed-bank/changed-amount replacement
  statements, failed-refund reservation replacement and already-paid recovery get
  reviewed operations integration; current paths block those ambiguous actions.
- [ ] Licensing/insurance sufficiency by category/jurisdiction, private evidence
  collection, Auth provisioning, delivery/acceptance receipts, renewal operations and
  CFG-011 retention/legal-hold/purge for application revisions are verified.
- [ ] Human screen-reader, true browser zoom, cross-platform and brand acceptance
  follow-ups from Phase 3 remain open; automated axe/screenshots do not satisfy them.
- [ ] Explicit later authorization covers any production migration, configuration,
  deployment, payment, refund, payout, email or scheduler activation.

## Operations and rollback boundary

No credentials, customer data or provider environment were copied. Checkout/refund/
webhook execution defaults disabled and accepts only an explicit test-mode opt-in
with test keys. Git deployment is disabled in vercel.json. No Cron job is activated.
No live financial, email, production or Homeschool Haven operation was performed.

For a local rollback, discard only this isolated synthetic database and worktree
after preserving review evidence. For a future applied database, retain immutable
financial history and use reviewed forward fixes; never delete a ledger to roll back
an application release. Never restore the archived unsafe handlers as a money recovery.

Reproduction and measured outcomes are in PHASE-5-VALIDATION.md. Database tools pin
Supabase 2.116.0 and Deno 2.9.6. Run heavy checks sequentially with
`MERCURIUS_BUILD_WORKERS=1`; the isolated project uses ports 55520–55527. Concurrency
fixtures commit only synthetic rows and must be followed by a clean local reset.
