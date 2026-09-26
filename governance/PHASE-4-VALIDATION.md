# Phase 4 validation and acceptance

**Current status (2026-09-26):** Phase 4 remains **not owner-accepted**. DEC-2026-017
separated its acceptance from Phase 5 closure. The owner requested review before
Phase 6 implementation (DEC-2026-018). The [Codex review](PHASE-4-CODE-REVIEW.md),
TRACE-096, requires fixes for completion evidence and lock ordering (P4-R1/P4-R2).
Next: Claude's bounded Phase 4 repair, Codex re-review, then owner acceptance/disposition.
Earlier review/combined-acceptance/PR instructions below are historical.

Status: implementation submitted for owner review; final-head CI and acceptance remain gates.
Recorded: 2026-09-03 (local) / 2026-09-04 UTC.
Branch: `coderabbit/tighten-worker-workflow-matching-safety/031ff3bf`, draft PR #5 against `main`.

PR #3 was verified open with passing CI at `91379e9` before implementation.
Its later merge `db3f4061f65f84ccd8bbb08e9c71301167bd6250` has the same tree;
this is the Phase 4 base. Owner acceptance of Phase 3 is recorded in DEC-005.
No unperformed manual checks are represented as passed.

## Implementation delivered

- Actor-safe canonical transitions, checked completion evidence, retained cancellation history, protected writes and authoritative audit fields. Generic status changes cannot bypass quote revision, completion or dispute-ticket workflows.
- One exclusive four-hour offer, immediate scheduling on acceptance, shared expiry locks, explicit selected-provider fallback consent and reason-bearing overrides. All eligible fixed and quote providers enter the pool; balanced-v1 weights and deterministic tie breaks are preserved.
- Immutable 24-hour quote revisions with stale-decision/duplicate guards; decline and expiry remain separate from cancellation. Legacy quotes require review rather than an invented deadline.
- Forty-eight-hour dispute filing from vendor completion, linked tickets and appeals of each admin resolution. Resolution history is retained; appeals restore the dispute hold flag for Phase 5 consumption.
- Rating-neutral verified reviews, correction history, reason-bearing moderation and appeal. Legacy private content stays private.
- Independent recurring visits, appointment instants displayed in Eastern Time, idempotent cancellation/reschedule/exception records and CFG-006/007 assessments. Project-owner tickets carry priority, next action and support-business-hour deadlines.
- Default-disabled atomic worker: offer/quote expiry, completion notice and 72-hour admin escalation. Run IDs, locks and committed markers prevent duplicated effects. No automatic confirmation or money operations.
- Shared MDS controls for service changes, fallback consent, quote decisions, dispute appeals and review corrections; mobile/light/dark/focus behavior preserved.

See PHASE-4-RECONCILIATION.md for the complete stored-state recovery map and scope boundaries.

## Verification evidence

| Check | Result and limits |
|---|---|
| Clean database replay | Successful isolated reset through `20260904006000_phase4_candidate_pool.sql`, including reference seed. No live data. |
| Database contracts | All 185 assertions across 12 rollback-only suites passed after that reset: roles, transitions, exact deadlines, quote revisions, consent, selection/ties, expiry, dispute appeals, review history, operations, recurrence, completion rules and Eastern support calendar. |
| Authenticated worker integration | Passed again after the final clean reset: concurrent HTTP calls, retry, notification/event deduplication and one-off pg_net transport; no confirmation or money changes. SQL rollback and handler failure cases are separately covered. |
| Inactive installer | Local synthetic transaction committed only an inactive job, rejected duplicate installation and removed only its own job. Zero active Cron jobs; no recurring execution claimed. Final CI repeats this test. |
| Unit/contract | All 63 tests passed locally after final presentation filtering and active-worker digest coverage; final typecheck also passed. CI reruns all cases. |
| Edge | Unchanged worker checkpoint: 11 frozen Deno checks and 31 synthetic handler tests passed. Final CI reruns these checks. |
| Application | Local lint/types passed; one-worker build produced the test artifact. All 55 browser cases passed, including new consent, appeal, cancellation-reason, stable retry key and error-focus tests. Final CI checks the final source, including the subsequent admin-action filtering. |
| Visual inspection | New 320px service-operation confirmation captures inspected in light/dark; controls and persistent errors were visible without clipping. Existing automated MDS reflow/theme/axe regression passed. This is not manual screen-reader, true browser-zoom or owner brand approval. |
| Credentials and diff | Staged credential scan and whitespace checks passed before commit; ignored local test environments/logs are excluded. |

Historical checkpoint [CI run 33816965540](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/33816965540)
passed the initial implementation at `2d74f81` (98 SQL, 62 unit, 31 Edge runtime,
11 Edge checks, authenticated integration and 51 browser cases). That checkpoint
is superseded by the expanded Phase 4 source and is not evidence for new code.
Final-head CI on draft PR #5 is the current acceptance evidence source.

Local verification exposed and corrected a text-encoding problem in a new label,
Windows shell-script line endings, and a Windows/Linux CLI-path mismatch. Failed
attempts are not counted as passing evidence. No production data, provider calls,
email, payment, refunds or payouts were used. CLI credentials remain in memory and
are not printed. The only enabled worker environment is an ignored synthetic local fixture.

## Explicit acceptance gates

Status on 2026-09-25 (DEC-2026-016): the CI gate's checks are all standing CI steps (Edge
checks and handler tests, lifecycle suites, authenticated worker and pg_net transport with Cron
inactive, lint, credential scan, types, unit tests, dependency audit, one-worker build and the
browser suite) and pass on `main` run 36138739942. Suites 001–012 now hold 188 assertions (185
at submission). The review gate moves to the combined Codex review; acceptance is still open.

- [ ] Final-head CI passes clean reconstruction, 185 SQL assertions, 11 Edge checks, 32 runtime tests, authenticated concurrency/retry/pg_net and inactive installation, lint, credential scan, types, 63 unit tests, dependency audit, one-worker build and 56 browser cases.
- [ ] Owner/code review accepts authority checks, locking, history preservation, legacy recovery, independent quote/dispute/review state, and Phase 3 preservation. Phase 4 owner acceptance has not yet been given.

The following are separate later gates, not claims of completed testing:

- **Phase 5:** commercial breakdown snapshots, deposits/payment failures, fees/refunds/ledger, ACH, dispute holds and provider onboarding integrity. Lifecycle policy assessments execute no money movements.
- **Phase 7 / DEC-010:** email/SMS delivery, reminder/backstop/quiet-hour timing and operational alert delivery remain inactive until configured. A separate review-management system remains future work.
- **Scheduler activation:** target Vault/JWT provisioning, approved cadence, external-scheduler duplicate check, monitoring/retention/stop procedures and explicit activation approval. No recurring scheduler or production work is authorized.
- **Phase 3 follow-ups:** human screen-reader, true zoom, owner brand/minimum-size/clear-space review and Linux/macOS visual baselines remain separately documented.

No merge or deployment. Branch Git deployment remains disabled in `vercel.json`.
The isolated Mercurius test stack was stopped after final SQL/transport verification, preserving its volume. All 11 Homeschool Haven containers remained running; none was modified.
Heavy checks are sequential; builds use MERCURIUS_BUILD_WORKERS=1.

## PR review reconciliation

The copied worker-secret placeholder is rejected and the example is empty. CI
checkout does not persist credentials; concurrency includes source repository
identity while preserving same-repository push/PR deduplication. Quoted offer
acceptance guidance now matches the control. Unavailable/fallback price displays
hide stale offer totals; historical amounts remain intact for Phase 5 reconciliation.
A new worker rejection test and vendor-offer browser case raise final CI targets
to 32 handler tests and 56 browser cases. Earlier local 31/55 checkpoints remain
accurate for their source snapshots.

The Edge inventory digest verifies the active worker source, while a separate
assertion preserves the archived Phase 2 digest. Runtime and frozen type checks
cover active worker behavior. Restoring
browser access to audit-writing functions would weaken the authority boundary;
failed invoker edits remain rejected and do not claim durable rejection logs.
The generic quote transition is now forbidden, so its historical numeric metadata
cast is unreachable. Legacy pending_review requires operator reconciliation, not
fabricated homeowner confirmation. Expired acceptance and actual prior-status audit
findings are fixed by the forward Phase 4 migrations and covered by SQL tests.
