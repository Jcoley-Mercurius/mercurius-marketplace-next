# Phase 4 handoff

**Current status (2026-09-26):** Phase 4 remains **not owner-accepted**. DEC-2026-017
separated its acceptance from Phase 5 closure. The owner requested review before
Phase 6 implementation (DEC-2026-018). The [Codex review](PHASE-4-CODE-REVIEW.md),
TRACE-096, requires fixes for completion evidence and lock ordering (P4-R1/P4-R2).
Next: Claude's bounded Phase 4 repair, Codex re-review, then owner acceptance/disposition.
Earlier review/combined-acceptance/PR instructions below are historical.

Draft PR: https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/5
Branch: `coderabbit/tighten-worker-workflow-matching-safety/031ff3bf`; target: `main`.

Phase 3 is owner-accepted (DEC-005). PR #3 was open with passing CI when Phase 4
started at `91379e9`; its later verified merge `db3f4061f65f84ccd8bbb08e9c71301167bd6250`
has the identical tree. This branch preserves that work.

Read AGENTS.md, the approved MPS/MDS/MTS, configuration decisions, DEC-005–010,
PHASE-4-RECONCILIATION.md, PHASE-4-VALIDATION.md and TRACEABILITY.md.

Approved policies now implemented:

- Four hours for vendor acceptance; acceptance immediately schedules all service modes.
- Twenty-four hours for homeowner quote approval; replacements preserve revision history.
- Forty-eight hours from vendor completion for homeowner dispute filing; admin resolutions may be appealed through tickets.
- Seventy-two hours after an unanswered completion notice triggers admin review, never automatic confirmation.
- At least one completion photo unless an approved category rule requires more.
- Recurring visits are separate jobs; cancellation applies to one visit.
- All star ratings use the same moderation rules; originals, edits and appeals remain auditable.

Full implementation is submitted for owner review; do not represent Phase 4 as
owner-accepted until that acceptance is recorded. Final CI is an explicit gate.
Phase 5 owns immutable commercial breakdowns, checkout, money execution, ledger,
ACH, holds/reconciliation and provider onboarding. Phase 4 assessments move no money.

The worker defaults disabled. No schedule is installed by migrations. Local tests
use synthetic data and include an inactive installer transaction, duplicate rejection
and cleanup; zero active Cron jobs. Email/reminder timing remains inactive under
DEC-010. Production provisioning/cadence/activation require a separate release decision.

Never merge or deploy without later instruction. Keep branch Git deployment disabled.
Do not stop or modify Homeschool Haven. Run heavy checks sequentially, with
MERCURIUS_BUILD_WORKERS=1. Preserve manual Phase 3 accessibility/brand follow-ups separately.
