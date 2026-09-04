# Phase 3 handoff

Phase 2 reconstruction is accepted by the owner under DEC-2026-004. The checkpoint
branch is `codex/reproducible-supabase-baseline`; confirm its PR review/merge status
before choosing the Phase 3 starting branch. Do not assume it is merged into main.

Start with `AGENTS.md`, approved MPS/MDS/MTS, the roadmap, and
`PHASE-2-VALIDATION.md`. Phase 3 is the MDS component/accessibility foundation:
accessible primitives, focus/keyboard behavior, control sizes, semantic colors,
dark mode, mobile/reflow, shared status and form patterns, and visual verification.

Do not expand Phase 3 into lifecycle or production operations. TRACE-010 / Phase 4
owns admin review instead of automatic completion confirmation, its yet-undefined
deadline, authenticated gateway/scheduler integration, concurrency/failure tests,
and Supabase Cron configuration/activation. The four-hour vendor offer window is
separate. Keep Cron unscheduled and preserve recovered source until its owning
slice makes a tested forward change. Phase 5 owns payment/payout integrity.

No production migration or function deployment was performed. The local Mercurius
stack is stopped with data preserved. Homeschool Haven is actively in use and
must not be stopped or modified. Keep resource-heavy checks sequential; use
`MERCURIUS_BUILD_WORKERS=1` for constrained local builds. Never copy live customer
data or secrets into tests, logs, documentation, or commits.

Prior evidence: two clean resets with identical schema/types; 35 SQL assertions;
48 unit/contract assertions; 11 frozen Deno checks; 26 isolated handler tests;
10 local missing-JWT gateway checks; successful 56-page one-worker build.
These do not constitute production readiness or provider integration coverage.

## Owner acceptance update — 2026-09-03

Phase 3 is **COMPLETE / OWNER ACCEPTED** under DEC-2026-005. Earlier in-progress
statements above describe the pre-acceptance checkpoint. Human screen-reader,
true browser zoom, brand approval and Linux/macOS visual baseline follow-ups
remain open separately; acceptance does not assert those checks were performed.
Phase 4 starting evidence and requirements are in PHASE-4-RECONCILIATION.md.
