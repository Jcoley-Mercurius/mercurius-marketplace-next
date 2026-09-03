# Phase 4 handoff

Phase 3 is owner-accepted under DEC-2026-005. PR #3 was open/unmerged when Phase 4
started at its complete head `91379e9`. A later read-only check verified its merge
at 22:24:42 UTC into `main` as `db3f4061f65f84ccd8bbb08e9c71301167bd6250`.
That merge has the identical tree to the Phase 3 head. Phase 4 targets this merged
main, preserving all Phase 3 work. Never merge or deploy without later instruction.

Read AGENTS.md, approved systems/configuration, DEC-005–007,
PHASE-4-RECONCILIATION.md and PHASE-4-VALIDATION.md. The approved timing rules are:

- Vendors have four hours to accept an exclusive offer; acceptance immediately
  schedules the request, including quote-only work. No extra payment or mutual
  appointment-confirmation prerequisite was authorized for that transition.
- After an unanswered completion notice, 72 hours triggers admin review, never
  automatic homeowner confirmation. This does not create payout eligibility.
- Quote validity remains unspecified; do not reinterpret the four-hour offer
  window as quote expiry.

The draft contains bounded lifecycle safety, expiry/acceptance reconciliation,
atomic inactive worker processing, cancellation retention, quote-decision and
MDS consumer repairs. Full Phase 4 is still open at the explicit acceptance gates
in the validation report. Payment/refund/ledger/ACH integrity remains Phase 5.

No Cron job is active or installed by this implementation. The installer is a
review template outside migrations. JOB_LIFECYCLE_ENABLED defaults false; the
only true value used was in an ignored local synthetic test environment.
Do not stop or modify Homeschool Haven. Keep heavy checks sequential and set
MERCURIUS_BUILD_WORKERS=1 for builds. Carry manual Phase 3 follow-ups separately.
