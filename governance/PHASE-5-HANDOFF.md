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

TRACE-064 restores the production dependency-audit CI gate after post-merge
advisories (critical Next.js) made it fail on main and on PR #16, which the owner
merged to main at `5a3bffe` on 2026-09-11 carrying both slices. See
PHASE-5-DEPENDENCY-SECURITY.md. It changes dependency versions only.

TRACE-065 starts onboarding review for a new applicant without creating an account,
invitation or public listing. Merged in PR #18 at main `f47ac84`. See
PHASE-5-ONBOARDING-INTAKE.md.

TRACE-066 wires the invitation operator interface onto the TRACE-063 commands with a
read-only operator readback and an operator-entered expiry that has no default. See
PHASE-5-INVITATION-OPERATIONS.md. Hosted delivery, existing-account linking and
renewal/retention operations remain open gates; nothing here activates a provider.

TRACE-071 lets `vendor-invite` dispatch from a hosted project once the owner arms
`MERCURIUS_INVITATION_MODE=hosted` with project-ref and site-origin pins that must match
the running environment, and tracks the invite email template, its 3-hour link lifetime
and the redirect allowlist. The recipient link is the site's own `/set-password` carrying
`token_hash`, so mail scanners cannot consume it. See
PHASE-5-HOSTED-INVITATION-DELIVERY.md. Hosted arming (Resend SMTP, Auth URLs/template,
secrets, deploy) and hosted acceptance are owner-authorized steps not yet performed.

TRACE-072 adds the MPS §9 compliance expiry queue: operators see live providers' evidence
expiring within 30 days or lapsed, the activation checklist flags items due for renewal,
and vendors see their own notices. A lapse is flagged only and changes no status (owner
decisions 2026-09-13); a lapsed provider leaves matching, but payouts are held only when
payout onboarding lapses (forward fix `20260913002000`, owner decision 2026-09-13). Renewed documents
arriving outside the application are the next slice. See PHASE-5-EVIDENCE-RENEWAL.md.

TRACE-073 lets a provider (vendor portal) or an operator (on the provider's behalf) submit a
renewed license or insurance document bound to the provider rather than the application.
The database verifies the stored object and caps undecided submissions; an operator
accepts one by recording it as checklist evidence, or declines it with a note the provider
sees. No application revision, re-review, status or role change follows. The slice also
removes the legacy policy that let anyone upload into the private bucket (owner decisions
2026-09-15). File retention and malware scanning remain gates. See
PHASE-5-RENEWAL-DOCUMENTS.md.

TRACE-074 applies CFG-011 retention to declined renewal documents: 90 days after the decline
an operator may move the file to a private quarantine bucket, restore it, or after 14 days in
quarantine delete it permanently, each step recorded only once storage confirms it. A
provider-level retention hold stops quarantine and deletion. Never-submitted uploads and
application documents remain outside retention (owner decisions 2026-09-15). See
PHASE-5-RENEWAL-RETENTION.md.

TRACE-075 adds the finance reconciliation readback: finance operators see each invoice's
charges, refunds, earnings and payouts checked against the journals, the MPS §5.5 funds state
with every hold reason, Stripe readback state and an exceptions queue at `/admin/finance`.
Read-only; operator commands, scheduled readback and bank statement import remain. It surfaces
that an unsupported Stripe event holds every payout. See PHASE-5-FINANCE-RECONCILIATION.md.

TRACE-076 adds part 1 of the finance operator command gateway on `/admin/finance`: payout hold
placement and two-person release, Stripe readback record and two-person resolution, event
replay and two-person exclusion, and reviewed refund send and Stripe readback. The actor is the
signed-in session (or the Auth-verified token in `refund-invoice`), never an input; second-person
commands bind a stored exact command approved by a different finance operator in their own
session. The owner kept the global unsupported-event payout hold (2026-09-16). Refund
authorization, chargeback allocation and ACH commands remain for part 2. See
PHASE-5-FINANCE-COMMANDS.md.

TRACE-077 adds part 2A. Owner decisions 2026-09-17: one finance operator releases a payout hold;
reviewed requests and their approvals expire after 24 hours; refund authorization keeps its
existing dual review. Finance operators request reviewed refunds, CFG-006/007 cancellation
refunds (amounts from the recorded cancellation) and lost-chargeback allocations, which a
different operator approves and the requester runs through the unchanged kernels. A refund
stuck with an uncertain Stripe outcome can be reissued under a new key once a Stripe readback
taken 24 hours after preparation finds no refund. ACH preparation, bank outcomes and retry
remain for part 2B. See PHASE-5-FINANCE-REFUNDS.md.

TRACE-078 adds part 2B. Finance operators request a weekly ACH batch whose stored command is the
kernel's exact object and whose terms bind each payout's amount, payee and bank authorization; a
different operator approves and the requester runs it. One operator records bank outcomes;
recording the submission re-proves the payout is payable at its statement amount and is the step
before sending at the bank. A failed or returned transfer is retried through a reviewed request
bound to the failed attempt, and never after its bank authorization changed. Replacement
statements, withdrawal of a prepared attempt and already-paid recovery remain open. See
PHASE-5-FINANCE-ACH.md.

TRACE-079 lets finance operators withdraw a transfer the bank does not hold (prepared, failed or
returned) from its statement. A different operator approves the withdrawal, which is bound to the
transfer's status, and the requester runs it. The payout then goes on a replacement statement in a
later weekly batch through the unchanged preparation kernel, which re-proves amount, payee and bank
authorization. A payout is on at most one live statement, and refunds, chargeback allocation and
holds work once its transfer is withdrawn. Payee reassignment stays closed. Already-paid recovery
remains open. See PHASE-5-ACH-REPLACEMENT.md.

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
