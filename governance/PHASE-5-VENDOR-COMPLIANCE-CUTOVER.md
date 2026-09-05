# Phase 5 existing-provider compliance cutover

TRACE-061 adds the reviewed cutover from legacy provider flags to private, versioned
onboarding evidence. License and insurance requirements are configured for an exact
service and ZIP jurisdiction without embedding unapproved legal conclusions in code.

Each included provider must have current generic onboarding evidence, active onboarding,
reviewed license and insurance requirements for every active service/ZIP combination,
and immutable evidence bindings from the current application revision. Operations records
an immutable include or exclude decision for every participating provider. Strict cutover
cannot be finalized while any provider is undecided or any included provider is incomplete.

Before finalization, TRACE-060 compatibility remains in force. After finalization, legacy
flags cannot admit a provider: matching requires an included decision and current generic
and scoped evidence. Suspension or evidence expiry immediately removes the provider.

Requirement tables and cutover state have RLS and no direct client or service-role writes.
Operator RPCs enforce scope, current evidence, idempotency and immutable decisions. The
migration creates no legal requirements, migrates no production provider, and does not
activate cutover; authorized operations must supply reviewed real-world requirements and
provider decisions.

Acceptance evidence is SQL 030 and the full clean database suite: 21 files and 468
assertions. It covers missing requirements, independent license/insurance scope, binding,
inclusion, finalization, strict matching, suspension, immutability and privilege denial.
