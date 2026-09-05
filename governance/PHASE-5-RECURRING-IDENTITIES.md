# Phase 5 recurring visit commercial identities

TRACE-059 binds every recurring service occurrence to its own financial identity.
The Phase 4 occurrence request remains the lifecycle authority; this slice does not
create another scheduler, recurrence engine or subscription lifecycle.

When reviewed commercial terms are published for a recurring visit, an immutable
identity binds the parent template, occurrence key, appointment, occurrence request,
obligation, snapshot, source hash and frequency. A recurring template cannot receive
a commercial snapshot. Each occurrence therefore receives its own checkout attempt,
capture, refund/dispute state, completion evidence and ACH eligibility through the
existing money contracts.

Subscription and renewal webhook types continue through the minimized no-effect
observation path. They cannot name an occurrence obligation or mark a visit paid.
A future automated recurring charge flow must explicitly create and fund a specific
occurrence using a reviewed snapshot and durable attempt.

The migration does not generate future visits, create a Stripe subscription, charge
a customer, activate Cron, or alter production data. Scheduling cadence, advance
notice, authorization and automatic charge timing still require approved operating
configuration.

Acceptance evidence is SQL 028 plus the full Phase 4/5 database regression suite:
19 files and 435 assertions. Cases cover template rejection, two distinct visit
identities, independent obligations/snapshots/checkout attempts, publication replay,
immutable/private evidence, and no-effect subscription renewal processing.
