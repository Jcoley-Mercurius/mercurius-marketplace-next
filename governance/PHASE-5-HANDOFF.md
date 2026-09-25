# Phase 5 handoff — independent money and onboarding contracts

## Current checkpoint — PR #43 / TRACE-086

As of 2026-09-24 UTC, `main` is `1d8a27e`. PR #43 and its final-head CI passed;
post-merge [main CI run 36005291080](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/36005291080)
passed backend, lifecycle and application. TRACE-086 removes the direct applicant insert
path, so the validated service-key route is the only way to create an application.
Code review of TRACE-084 (C1–C8), TRACE-085 (A1–A5) and TRACE-086 (B1–B4) and hosted
acceptance remain open. Phase 5 is **IN PROGRESS**. DEC-2026-012 (owner, 2026-09-24)
decides the open intake items: honeypot and Postgres rate limits on both public forms, a
route-only contact insert, no application-row deletion, dropping the duplicate
`vendor-documents` read policy, and a 7-day clock for never-submitted application uploads.
Those are the next slices; use the gates below for the rest. TRACE-087 (PR #45, merged at
`0d47134`; [main CI run 36077050904](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/36077050904) passed) implements items 2 and 4. TRACE-088 (branch
`codex/phase5-intake-abuse`, PR #46, merged at `3e4236c`) implements item 1 as settled by DEC-2026-013;
TRACE-089 (PR #47, merged at `6d1a11a`) adds its per-IP limit (DEC-2026-014).
TRACE-090 (PR #48, merged at `cd0c041`) implements item 5: uploads
never attached are due 7 days after their 2-hour upload link; see PHASE-5-UNATTACHED-UPLOADS.md.
TRACE-091 (branch `codex/phase5-renewal-orphan-uploads`, awaiting review) applies the same rule to
renewal uploads never submitted (DEC-2026-015 item 2); see PHASE-5-RENEWAL-UNATTACHED-UPLOADS.md.

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
application documents were outside TRACE-074; TRACE-084 now covers rejected or
abandoned application documents. Never-submitted uploads remain outside retention. See
PHASE-5-RENEWAL-RETENTION.md and PHASE-5-APPLICATION-RETENTION.md.

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

TRACE-080 records already-paid recovery (owner decisions 2026-09-21). A customer refund or lost
chargeback on a settled payout now posts, and the provider's share becomes an amount they owe: the
debit balance of that payout's provider payable. A withdrawn transfer the bank later shows as paid
is recorded as a separate reviewed late payment; the withdrawn attempt is not changed. One guard on
every statement, attempt and submission writer stops any transfer that would pay a provider more
than the payout's proceeds, so a paid payout is never paid again. An amount owed is closed only by
a reviewed repayment or a reviewed write-off to a new recovery-loss account; nothing is netted,
debited or held. See PHASE-5-PAYOUT-RECOVERY.md.

TRACE-081 adds bank statement reconciliation. Owner decisions 2026-09-22: the bank's CSV export is
parsed in the operator's browser and never uploaded, only payout-related lines are imported, a line
is evidence only, and a period is closed by a reviewed request a second finance operator approves.
Each line holds a posting date, debit or credit, amount and bank reference — no description, payee
or account detail — and pairs with a recorded settlement, return, late payment or repayment. A line
the bank shows but nothing records is resolved through the existing commands with the line as their
evidence; a repayment or a differently referenced transfer is matched by hand; a line imported by
mistake is dismissed, never one naming a transfer. A close is refused while any line is unresolved
or any recorded movement in the period has no line, and it fixes the statement's pairings. The
reconciliation queue gains the unresolved lines and the movements missing from a statement. See
PHASE-5-BANK-STATEMENTS.md.

TRACE-082 recovers a reviewed refund Stripe reports failed or canceled (owner decisions 2026-09-22).
Once the latest Stripe readback of the current send shows the failure, the refund's author or
approver can resend it under a new Stripe key, or a finance operator can request its release, which
a second operator approves. A released authorization is off the books: it stops holding the payout
and blocking chargeback allocation, and its amount can be refunded again only through a new reviewed
refund. Nothing is posted, and guards stop an earlier send's failed refund from being recorded as the
current one and a released refund from ever being sent or settled. The slice also fixes
`paymentFunctionError`, so Edge Function callers show the function's own code and message. A refund
that fails after Stripe reported it succeeded is recorded as a finding. See
PHASE-5-FAILED-REFUND-RECOVERY.md.

TRACE-083 closes both late-reversal findings (owner decisions 2026-09-23).

A settled refund Stripe later fails stands: its fee, tax and provider share stay posted. Two finance
operators record the failure from a Stripe readback, and what Stripe returned is then held in a new
`customer_refund_payable` account as owed to the customer. It is cleared in one of two reviewed
ways:

- a resend, whose Stripe refund event pays the customer out of what was held;
- a release, which reverses the refund and restores the platform fee and the provider's share.

A release is refused when the bank has not paid the payout yet, or when the restored proceeds would
exceed what a paid payout already paid.

A bank return after a provider's repayment leaves that repayment returnable. Mercurius sends it
back by ACH, and two operators record it as a repayment reversal. The replacement statement pays
only the proceeds, and a statement line pairs with the reversal by hand. See
PHASE-5-LATE-REVERSALS.md.

TRACE-084 applies CFG-011 retention to the documents of rejected or abandoned applications
(owner decisions 2026-09-23). A reviewed closure records who rejected or abandoned an
application, when and why, and replaces the direct status update; a provider rejected in
onboarding review starts the same clock. After 90 days an operator may quarantine, restore or,
after 14 days in quarantine, permanently delete each file through the TRACE-074 mechanics. A
file that is compliance evidence is never purged. Holds can be placed on an application, and a
provider hold covers its applications. Legacy rejections with no record are not due until
recorded; never-submitted uploads stay outside retention. See PHASE-5-APPLICATION-RETENTION.md.

TRACE-085 removes the legacy admin write paths TRACE-074 and TRACE-084 left open (owner decision
2026-09-23). A signed-in admin can no longer update or delete a `vendor_applications` row, or
move, rename, overwrite or remove a file in `vendor-documents`, from a client; statuses change only
through the reviewed commands and files only through the service-key retention routes. Reads,
the applicant insert policy and other buckets are unchanged. The Document Retention totals now
count application documents too. See PHASE-5-APPLICATION-ADMIN-WRITES.md.

TRACE-086 removes the direct applicant insert path TRACE-085 left open (owner decision
2026-09-24, option A). No anonymous or signed-in client can insert a `vendor_applications` row;
the validated application route's service key is the only way to create one, and its insert
still notifies admins and records the intake version. Rate limiting or a bot check on the route
and the contact form's anonymous insert remain separate decisions. See
PHASE-5-APPLICATION-INSERT.md.

TRACE-087 applies DEC-2026-012 items 2 and 4. The contact route inserts with the service key and
no anonymous or signed-in client can insert a `contact_submissions` row; the duplicate admin
read policy on `vendor-documents` is dropped with admin access unchanged. The route must be
deployed before the migration reaches a hosted project. See PHASE-5-CONTACT-INSERT.md.

TRACE-088 applies DEC-2026-012 item 1 as settled by DEC-2026-013. The vendor application and
contact routes refuse a filled honeypot field, a form sent in under 3 seconds, and a fourth
accepted submission from one email address to one form in a rolling day, each with the same
429. Counters are email hashes in a private table that only the service key's function
writes. There is no Turnstile, and the per-IP limit waits for the production domain's proxy
path. The migration must reach a hosted project before the routes are deployed. See
PHASE-5-INTAKE-ABUSE.md.

TRACE-089 adds that limit: 5 accepted submissions per client network per form per hour,
with the network taken from Vercel's `x-real-ip` (IPv6 by /64) because the domain's GoDaddy
DNS points straight at Vercel (DEC-2026-014). An unknown IP skips only this limit. See
PHASE-5-INTAKE-IP-LIMIT.md.

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

## Acceptance gates for the original draft checkpoint

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
  unknown bank outcomes are demonstrated. TRACE-081 implements statement import,
  matching and the reviewed period close against synthetic lines only; no real bank
  export has been read. Changed-bank/changed-amount replacement
  statements, failed-refund reservation replacement and already-paid recovery get
  reviewed operations integration; current paths block those ambiguous actions.
  TRACE-083 adds a refund that fails after it settled and a return after a repayment, against
  synthetic Stripe events and bank movements only.
- [ ] Licensing/insurance sufficiency by category/jurisdiction, private evidence
  collection, Auth provisioning, delivery/acceptance receipts, renewal operations and
  CFG-011 retention/legal-hold/purge for application revisions are verified. TRACE-074
  and TRACE-084 implement operator-run retention for declined renewal documents and for
  rejected or abandoned application documents against synthetic files only;
  TRACE-090 adds never-attached application uploads (7 days after the upload link).
  TRACE-091 adds renewal uploads never submitted, on the same clock.
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
