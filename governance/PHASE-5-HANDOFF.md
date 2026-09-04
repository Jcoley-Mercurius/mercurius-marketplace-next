# Phase 5 handoff — independent money and onboarding contracts

## Current follow-up: completion and direct ACH

PRs #4–6 are merged. PR #7 (quotes/checkout) was verified draft and unmerged;
`codex/phase5-completion-payout` starts independently from main 9aeed8f. TRACE-055
binds payout eligibility to authenticated lifecycle confirmation receipts and
current dispute/appeal evidence, with transaction locks at preparation, submission
and retry. See PHASE-5-COMPLETION-PAYOUT.md for characterization and validation.

The 48-hour clock uses homeowner confirmation; resolved disputes do not restart it.
Bank settlement already in flight remains recordable under a new hold. No bank
transfer, deployment or scheduler is initiated. Phase 5 remains open, including
PR #7 acceptance, cancellation/refund linkage, recurring identities, onboarding
integration, finance tooling, recovery/cutover and authorized provider/manual gates.

The original independent checkpoint and dependencies below are historical; the
current follow-up evidence supersedes the still-unconnected completion port.

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
  Recurring visits receive distinct commercial/payment identities.
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
