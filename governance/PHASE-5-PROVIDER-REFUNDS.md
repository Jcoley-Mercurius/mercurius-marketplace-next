# Phase 5: provider cancellation and no-show refunds

TRACE-057 implements the CFG-007 replacement-search evidence required after PR #9.
An authenticated operations administrator records a reason and an idempotency key.
The RPC derives the actor from the session and asks the existing matching engine
to try remaining supply under the canonical request lock.

The immutable receipt records the matching state, assignment and offer history.
An active replacement or exclusive offer produces `replacement_active`; required
homeowner fallback consent produces `awaiting_consent`. Neither enables a refund.
Only canonical exhausted supply produces `no_replacement` and transitions the
request to cancelled through the existing audited lifecycle and notifications.
A fresh key requests a new assessment; retries return the original receipt and
changed intent fails. No-show refund decisions require an operations-confirmed
no-show operation that releases the original assignment for rematching.

The existing cancellation refund preview and authorization RPCs now accept these
provider operations when a no-replacement receipt exists. They hash that receipt
into the policy evidence and use the existing 100% component allocation, separate
finance approval and refund reservation rules. Operations decisions do not create
refund authorizations or invoke Stripe. Existing bank and chargeback guards apply.
The original provider quality event and any excused-emergency reason are retained.

For captured jobs, operational rematching may change assignment/offering fields
while retaining the captured snapshot and original payee. Uncertain checkout and
existing bank statements still block reassignment. A replacement cannot collect a
new payment or obtain payout on the old agreement: both require a separate reviewed
commercial reconciliation adapter. Other scope/customer/quote changes retain the
existing source guard. This boundary prevents the cancelled provider being paid for
replacement work and keeps historical money evidence intact.

## Acceptance evidence

SQL 026 exercises exhaustion, no-show, active replacement, fallback consent,
exclusive offers, role rejection, immutable evidence, retry conflicts and separately
approved full refund authorization. The provider concurrency program verifies eight
simultaneous retries produce one receipt and one decision event, without authorizing
money. The existing CI concurrency runner invokes it alongside the payment and payout
programs.

Local verification: 409 SQL assertions across 17 suites; all three concurrency
programs; 84 unit tests; ESLint; secret scan; production build. The database is reset
after committed concurrency fixtures and its types are regenerated. GitHub CI and
manual acceptance remain review gates for this branch.

This is a backend contract slice. Finance workbench presentation, provider test-mode
execution/readback, manual operations acceptance and real bank recovery remain
separate gates. No production action or scheduler activation is performed.
