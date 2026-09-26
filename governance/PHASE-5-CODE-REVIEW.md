# Phase 5 closure review — 2026-09-26

Disposition: **changes required before Phase 5 closure or Phase 6 authorization**.
Review belongs to TRACE-092 and includes the dependent Phase 4 contracts under
DEC-2026-016. This record does not accept either phase or authorize external changes.

## Reviewed checkpoint and verification

- Fetched `origin/main`: `6c41143bc18e5dbd2e6cd3cbd684a40a8f1ecca2`, PR #49.
- Reviewed checkout/source approval, retry identities, webhook normalization,
  final lifecycle transition/worker definitions, vendor matching integration,
  financial command execution, intake privileges/limits, and retention routes and
  their database preconditions against the six governing authorities.
- [Main CI 36165305771](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/36165305771)
  passed backend, lifecycle and application. Inspected job steps: database contracts,
  checkout/webhook/refund and onboarding/finance/retention concurrency checks,
  authenticated worker and pg_net with Cron inactive, lint, secrets, types, unit tests,
  dependency audit, build and browser accessibility/keyboard checks. These are
  existing CI results, not new local full-suite runs.
- The local closure branch adds documentation and suite 059 relative to main;
  application code and database migrations match main. PR #50's final-head CI also
  passed. No hosted service, production record, money or real document was touched.
- Synthetic route reproduction ran the actual document-finalization route after
  TypeScript transpilation with mocked imports/storage/database and a barrier making
  both reads finish before either write. Both responses were HTTP 200 with
  `attachedCount: 1`; the final row contained one path instead of two. Reproduction
  script for this session: `/tmp/phase5-finalization-race.cjs`. This verifies route
  interleaving, not a live Supabase integration.

## Findings

### P1 — An active retention hold can lose a file to a previously prepared deletion

Affected: `src/app/api/renewal-documents/uploads/retention/route.ts` (prepare,
Storage removal, then record), and the shared pattern in application/declined-renewal
retention. TRACE-074, TRACE-084, TRACE-090 and TRACE-091; CFG-011.

`vendor_renewal_upload_retention_prepare` is a read-only check with no durable
reservation. The route calls Storage only after that RPC commits. A valid sequence is:

1. Prepare observes no hold and approves deletion of an eligible quarantined file.
2. Another operator commits a provider retention hold while the file still exists.
3. The route uses its earlier result to remove the file with the service key.
4. Record sees the missing file and writes a deletion with `under_hold = true`.

The provider lock in record serializes ledger writes, not the intervening Storage
call. Application holds have the same separation. The documented TRACE-074 decision
allows recording a Storage action that **finished before** a hold; it does not
authorize removing an existing file **after** the hold commits. Audit attribution
cannot recover a permanently deleted file. This conflicts with CFG-011 and the
owner's rule that an in-force hold blocks quarantine and permanent deletion.

Required fix: coordinate hold placement and the destructive Storage operation using
a durable operation protocol that defines when each becomes effective and handles
interruption/unknown outcomes. A second unlocked check alone leaves the same race.
Verify both orderings with a delayed Storage call: hold wins before deletion starts;
an already completed deletion remains recordable after a later hold. Cover all
retention routes, retries and crashes without silently dropping history.

Evidence: direct route/SQL interleaving analysis; not reproduced against live Storage.

### P2 — Concurrent document finalization overwrites a successful attachment

Affected: `src/app/api/vendor-applications/documents/route.ts`, lines 90–113;
vendor application version/evidence integrity (TRACE-052/060/084/090).

The grant permits a valid subset of its paths. Two requests can read the same
`document_urls`, merge different verified paths independently, and then replace the
whole column. Both report success, but the last write drops the other attachment
from the current application. The version trigger preserves historical snapshots;
it does not merge them or repair the current application's document list.

Required fix: move the append/union into a database transaction that locks the
application row and merges against its current list, preserving the route's grant,
ownership and stored-file checks. Add a concurrent partial-finalization regression
and replay coverage. The resulting current row must contain both paths exactly once.

Evidence: confirmed by the synthetic actual-route reproduction described above.

### P2 — The closure package merged into a branch after its main merge

[PR #49](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/49)
merged `0189a76` into main at 17:09:09 UTC on 2026-09-25.
[PR #50](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/50)
merged `edc4df4` into `codex/phase5-renewal-orphan-uploads` at 17:09:24 UTC,
producing `011b2e4` on that branch. It did not merge into main.

Confirmed by fetched refs, PR base/merge metadata and tree comparison: main lacks
`PHASE-5-CLOSURE-READINESS.md`, suite 059, TRACE-092 and DEC-2026-016, with the
associated handoff/roadmap changes. A merged PR label does not establish main inclusion.

Required fix: bring the closure package and this review record to main through a
reviewed PR, correcting its stale checkpoint text. Verify CI on the resulting head
and post-merge main, including suite 059. No merge was performed in this review.

## Gate assessment and next action

The roadmap's synthetic non-production test gate has passing CI evidence. That
evidence does not exercise the two route interleavings above, so the code-review
gate is not accepted. This is a risk-focused review, not a claim that every historical
slice question or external/manual acceptance item has been independently certified.

Claude's next bounded implementation slice should fix retention/hold coordination
first, with an additive migration and delayed-Storage concurrency evidence; then
fix atomic document finalization. Codex reviews the fixes and completes the combined
Phase 4/5 acceptance recommendation on the resulting main tree. Record one owner
decision accepting Phase 4, closing Phase 5 and authorizing Phase 6 only afterward.

The closure decision's carried-forward gates remain: Phase 6 promotion UI hiding and
recurring generation/charge configuration; Phase 7 communications/schedulers and
operator runbooks; Phase 8 hosted migrations, Storage behavior, malware policy,
Stripe test delivery/readback and real bank workflow; Phase 9 category taxability,
finance operators, licensing/insurance, legacy cutover and human accessibility/brand
acceptance; Phase 10 production activation. These do not require external activation
to complete the current review, and no such activation is authorized here.

## Implementation response — 2026-09-26 (for re-review)

Recorded by Claude on branch `codex/phase5-review-fixes`; not a disposition. Details and
evidence are in [the fixes report](PHASE-5-REVIEW-FIXES.md).

- **P1 → TRACE-093.** Deletion now runs through the operator's session. A quarantine
  delete policy inside Storage's own delete transaction takes the hold locks, re-checks the
  step and the hold, and records the deletion atomically. A hold that commits first keeps the
  file, and a deletion that commits first stays recordable after the hold. Verified through the
  real Storage API for all three routes, with a delayed Storage call in both orderings, retries
  and a crash. Residual for review: quarantine moves still use the service key; that step is
  reversible.
- **P2 → TRACE-094.** Finalization appends under the application row lock in one database
  function. The actual route, replayed against the local database with a barrier, loses 5 of 6
  paths at `HEAD` and keeps all 6 after the fix.
- **Closure package.** This branch contains TRACE-092, DEC-2026-016, suite 059 and this review.
  Its pull request targets `main` directly, so merging it brings the package into `main`.

## Owner decision — 2026-09-26

PR #52 merged the fixes and this review into `main` at `417e642`. The owner closed Phase 5 and
authorized Phase 6 (DEC-2026-017). Phase 4 is not accepted; its review questions stay open for a
separate owner decision.
