# Phase 5 paid replacement commercial reconciliation

TRACE-058 preserves the customer’s reviewed and captured agreement after a provider
cancellation or no-show, while assigning provider proceeds to the replacement that
the canonical matching flow records as accepted.

A service-role operation can append a reconciliation receipt only after two
authenticated finance operators approve the exact command. The receipt binds the
provider operation, replacement decision, accepted provider, snapshot, captured
amount, source hash and reason. The original obligation party and snapshot remain
unchanged. Refund reservations, uncertain checkout attempts and existing ACH
statements block reassignment.

Completion evidence must name the current reconciled provider. The existing
homeowner-confirmed completion, 48-hour delay, dispute/appeal, hold and vendor
eligibility checks still apply. ACH preparation resolves the effective provider,
uses that provider’s current bank authorization and creates one statement for the
obligation. Repeated provider failures can form an immutable payee chain before an
ACH statement exists.

The slice does not initiate a payment, refund, bank transfer, deployment or
scheduler. It does not permit another checkout or alter the captured price.
Replacement scope or price differences need a separately approved adjustment
policy and reviewed commercial terms.

Acceptance evidence is SQL 027 plus the full Phase 5 database regression suite:
18 files and 421 assertions after a clean migration replay. The focused cases cover
separate approval, accepted-match evidence, immutable/idempotent receipts, preserved
customer amount and original obligation, replacement completion, replacement bank
evidence, and a single ACH statement.
