# Phase 5 vendor matching eligibility

TRACE-060 connects the Phase 5 private onboarding decision to the shared Phase 4
candidate source. Candidate ranking, selected-provider offers, fallback matching,
rematching, admin reason-bearing offers and provider acceptance now consume the same
eligibility decision.

For a provider with a versioned onboarding record, matching requires active status
and all nine current evidence categories from the reviewed application version.
Suspension, expiration, supersession, an incomplete checklist or a newer application
revision removes that provider from the candidate pool. Acceptance repeats the check
so an offer cannot schedule work after eligibility changes.

Providers without an onboarding record retain the existing active-provider behavior
during evidence migration. This avoids inventing rejection decisions for existing
providers. Operations must migrate and review every participating beta provider
before integrated activation; after a provider enters onboarding, legacy flags can
never bypass the private decision.

The legacy candidate implementation remains private and has no browser or service
role execution grant. The public and private matching workflows continue to call the
original function name, which now applies the eligibility gate before returning any
candidate.

Acceptance evidence is SQL 029 plus the full Phase 4/5 database regression suite: 20 files and 454 assertions.
It covers legacy cutover behavior, incomplete review exclusion, current-evidence
activation, suspension, acceptance-time revalidation, unchanged offer/job state
after rejection, and privilege-negative bypass checks. No production provider,
document, role, notification or matching record is changed.
