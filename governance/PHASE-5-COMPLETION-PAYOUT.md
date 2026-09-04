# Phase 5: completion and dispute evidence for direct ACH

## Baseline and authority

The owner requested the next Phase 5 slice after quotes/checkout on September 4,
2026. Remote main was fetched at 9aeed8fd16edb16b403c872c9bf403a998bd831c.
PR #7 was open, draft and unmerged at 5be8aca when this independent branch began.
It is now merged through main 1d6342a. This reconciliation combines its commercial
source contracts without changing the completion/payout boundary. Merged Phase 4
lifecycle contracts remain the authority for confirmation and dispute evidence.

Authority: AGENTS.md, OWNER-APPROVALS, MPS §6.5, MTS financial/audit separation,
MDS MoneySummary/ConfirmAction, CFG-005/008, DEC-006/009/011, and Phase 4–5
reconciliation, handoff and validation records. Weekly transfers remain initiated
by the owner directly from the bank. No banking API, Connect, new weekly cutoff,
reserve, approval deadline or payment policy is introduced.

## Characterized behavior

- The canonical Phase 4 transition authenticates the homeowner, records the server
  confirmation time and performs existing lifecycle effects. Vendor completion
  and the 72-hour unanswered-confirmation escalation cannot confirm for them.
- Dispute filing has its own 48-hour clock from vendor completion. Appeals reopen
  the dispute and create version-linked support tickets, without an appeal deadline.
  Resolution closes the relevant appeal tickets. A generic admin-review flag may
  remain after appeal resolution; that flag is not an approved payout reserve.
- The independent Phase 5 completion port accepted a caller-supplied homeowner,
  time and source label. It did not establish their lifecycle provenance.
- Existing weekly ACH kernels already validate captured/retained money, onboarding,
  bank evidence, independent money holds, refund/reconciliation holds and immutable
  statements. Submission and retries recheck payable amounts. Bank outcomes are
  recorded separately; only settlement posts payment, and unknown cannot be retried.

## Implemented boundary

The existing transition body moves to a private function. Its public wrapper
captures an immutable confirmation receipt only after a successful authenticated
homeowner confirmation. This preserves one lifecycle implementation. Receipt writes
roll back with the transition; no receipt is inferred from legacy timestamps or
event labels. Receipts also exist before a financial obligation is created.

The completion integration port now requires the exact receipt ID, homeowner and
server timestamp, plus matching current request and obligation parties. Payout
checks bind that receipt idempotently to the obligation. Historical conflicting
financial evidence is retained and blocks payout pending reviewed reconciliation.
Rework, changed parties or changed confirmation time cannot silently reuse an old
receipt. There is no automatic legacy backfill or reconfirmation replacement.

Preparation, submission and retry acquire the lifecycle advisory/request locks
before the existing vendor and money locks. Eligibility checks the current service
state, disputed flag, unresolved disputes and open appeal tickets in that transaction,
then delegates to the existing financial kernel. Dispute and appeal evidence writes
also join this lock boundary. A caller using an inverse lock order can receive a
transaction abort and must retry before taking any external action.

The original confirmation clock survives a resolved dispute; no new timer is added.
New appeals block submission of previously prepared statements and retries of
failed/returned transfers. An already submitted bank outcome must still be recorded
if a hold arrives afterward: suppressing the settlement would falsify the ledger.
Recovery of already-paid funds remains a separate reviewed operations gate.

The database records permission and evidence, not the external transfer itself.
The owner workflow must check current eligibility immediately before bank action;
a database lock cannot span a human-operated bank session. Actual bank forms,
statement reconciliation and operations acceptance remain required.

## Validation and acceptance

The new `024_phase5_completion_payout.sql` exercises public homeowner confirmation,
receipt immutability/permissions, legacy rejection, exact 48-hour boundaries,
statement provenance, canonical appeal/resolution, hold-after-preparation, bank
settlement under a later hold, return/retry, and rework/timestamp changes. Historical
time fixtures are explicitly inserted only by the isolated database owner. The
earlier 020 suite now supplies an explicit synthetic historical receipt and keeps
its complete money/onboarding/ACH scenarios.

`scripts/phase5-payout-concurrency.mjs` reuses only the synthetic SQL setup and
tests both serialization orders for appeal versus batch preparation. It commits
fixtures to the isolated database and requires a reset afterward.

Measured local outcomes on September 4: clean reconstruction and 324 SQL assertions
across 14 suites passed; 31 were completion/payout boundary assertions. Both
serialized race orders passed. Lint, TypeScript, 84 unit tests, the credential scan
and the single-worker production build passed with synthetic public configuration.
The committed CI job reruns the new race before its existing post-concurrency reset.
Final-head CI and review are
required before merge. No manual, browser, bank, Stripe or production checks are
implied; this slice changes no application controls, mobile layout or dark mode.

## Remaining Phase 5 gates

- The remaining quote presentation, finance tooling and uncertain checkout recovery
  gates remain separate. This adapter retains no runtime dependency on checkout;
  its ledger fixtures now accommodate the merged private intake kernel.
- Cancellation/refund assessment linkage, recurring commercial identities, vendor
  matching eligibility/private evidence collection and legacy cutover remain open.
- Receipt conflict/reconfirmation recovery, changed bank/amount replacement
  statements and already-paid recovery require reviewed operations workflows.
- Tax/promotion configuration, authorized provider tests, bank reconciliation and
  the outstanding manual design/accessibility acceptance gates remain open.

Phase 5 is not closed and Phase 6 is not started. No production migration,
configuration, deployment, Cron, email, charge, refund or payout is authorized here.
