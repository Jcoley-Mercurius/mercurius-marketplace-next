# Phase 4 code review — 2026-09-26

Disposition: **CHANGES REQUIRED before Phase 4 acceptance**.
Review: TRACE-096; P4-1–P4-7 under DEC-2026-016/017. Owner requested this review
before Phase 6 implementation and authorized committing, pushing and opening its PR.
Reviewed base: `origin/main` `1baf270cd28bd45b57e720cdf9f1aed9d9c1bef2` (PR #53).
This review does not accept Phase 4, reopen Phase 5 or authorize external activation.

## Findings

### P4-R1 / P1 — Completion counts array slots rather than required photo evidence

Effective definitions: `public.vendor_complete_job` in
`20260729105449_3c75a7ae-4756-4635-8581-c9cd74dc235c.sql`, lines 263–291;
completion check in `20260904004500_phase4_completion_rules.sql`, lines 152–160.
TRACE-055 subsequently moved the transition kernel to `private` and wrapped it in
`20260905011000_completion_payout_bridge.sql`; its evidence check is unchanged.
Authorities: MPS §6.4 (required completion evidence), DEC-2026-006 and Phase 4's
versioned category evidence rule; MTS browser/database trust boundary.

The public completion RPC writes the caller's `_photo_urls` into the request and
checks array length. The transition likewise checks array length against the
category minimum. Neither check rejects NULL entries or establishes that distinct
photos actually exist for this job. The UI uploads photos first, but an authenticated
assigned vendor can call the RPC directly.

Confirmed against the real isolated database: with an approved two-photo rule,
`vendor_complete_job(job, array[null,null]::text[])` succeeds, marks the job
`vendor_completed`, sends the completion notice and records the rule version.
There are no photos in those two slots. This undermines the required evidence
prerequisite; it does not itself manufacture homeowner confirmation or execute payout.
The existing SQL 011 suite uses two synthetic strings, so it cannot detect this bypass.

Reproduction: `governance/review-evidence/phase4-null-completion.sql` is a rollback-only
copy of suite 011 with the successful two-photo input replaced by two NULL entries.
All eight assertions pass on the vulnerable implementation; assertion 7 explicitly
labels the bypass. This artifact demonstrates a defect, not a passing acceptance gate.

Required fix: validate distinct, non-null, non-blank photo references against stored
completion objects for the correct job and authorized uploader before completion.
Enforce the category minimum on verified evidence in the canonical transition path,
including direct transition callers. Preserve existing history and define legacy
invalid-reference handling without fabricating evidence. The UI must explain the
current category minimum rather than always promising that one photo is sufficient.
Add rejection cases for NULL/blank/duplicate/nonexistent/cross-job references and
positive real local Storage cases; prove rejected calls leave status, evidence,
notices and audit unchanged. Retain required proof through confirmation.

### P4-R2 / P2 — Completion reverses the shared lifecycle lock order

Effective definition: `public.vendor_complete_job`, same migration, lines 267–291;
canonical transition lock order in `20260904004500_phase4_completion_rules.sql`,
lines 45–53, consumed by the TRACE-055 wrapper.
Authority: P4-2, MTS transactional/concurrent lifecycle acceptance.

Most lifecycle commands take the per-request advisory lock before the request row
lock. Completion reads/authenticates without either lock, updates `photo_proof_urls`
(taking the row lock), then calls the transition that acquires the advisory lock.
A concurrent admin correction can hold the advisory lock and wait for that row,
while completion holds the row and waits for the advisory lock. PostgreSQL aborts
one action with a deadlock error; the vendor UI reports the failed completion and
provides no automatic recovery. Rollback prevents partial commitment, but an ordinary
concurrent pair of supported actions should not require a database deadlock victim.

Confirmed with two sessions executing the actual completion and admin-transition RPCs.
The reproduction pre-acquires session A's normal advisory lock to control interleaving,
waits until session B's real completion waits on that advisory lock, then lets A's
real transition proceed. PostgreSQL reports `deadlock detected`, naming the private
transition and `vendor_complete_job`. Both action transactions roll back; all uniquely
named temporary synthetic records are removed afterward.

Reproduction: `python3 governance/review-evidence/phase4-completion-locks.py`.
The container is fixed to `supabase_db_mercurius-phase5-isolated`; it does not load
credentials or connect to a hosted database. Setup refuses existing fixture IDs.

Required fix: take the same per-request advisory lock and row lock before reading
ownership or updating proof; revalidate actor and state under those locks. Cover
completion versus admin correction, duplicate completion and failure/retry. Evidence
validation and completion effects must remain one atomic transaction. Retain the
Phase 5 wrapper and homeowner-only confirmation contract.

## P4-1–P4-7 disposition

| Question | Reviewed evidence and disposition |
|---|---|
| P4-1 authority and workflow bypass | Reviewed final private transition + public wrapper, direct-write guards, quote/dispute/review commands and category completion. Own-role checks, admin reasons and generic quote/dispute bypass rejection have SQL evidence. **Changes required: P4-R1.** |
| P4-2 locking and concurrency | Matching/expiry share advisory → row order; one pending-offer uniqueness; quote expected-revision/current-ID guards; worker batch lock, run IDs and effect markers. **Changes required: P4-R2 in completion.** |
| P4-3 history preservation | Immutable quote terms and revision lineage; retained job operations and before values; prior dispute resolutions in job events and version-bound appeals; original review content and correction/moderation history. No additional finding on reviewed paths; suites 007–010 pass. |
| P4-4 legacy recovery | Stored-state mapping in PHASE-4-RECONCILIATION.md and src/lib/lifecycle.ts covers every request enum. Legacy quoted/pending_review remain operator-reconciled with reasons, without fabricated notice/consent. Future notice due times are honored; no general request expiry is invented. No additional finding; suites 003/007 and lifecycle unit mapping pass. |
| P4-5 independent state | Quote decisions preserve service scheduling; decline/expiry do not cancel. Dispute resolution/appeal and review moderation retain their independent records. No additional finding; suites 007–009 pass. |
| P4-6 Phase 5 integration | TRACE-060 wraps the candidate function with current onboarding eligibility, which vendor acceptance rechecks. Legacy active-vendor exception remains an explicit Phase 9 cutover boundary. TRACE-059 uniquely binds each occurrence to its own snapshot/obligation; templates cannot substitute for funded visits. TRACE-055 keeps homeowner confirmation authoritative and open disputes/appeals held. No additional finding on reviewed paths; suites 024/028/029 pass. |
| P4-7 MDS and inactive worker | Reviewed ConfirmAction/reason/stable-retry callers, canonical status mapping, existing light/dark/mobile/focus browser assertions, worker JWT configuration/default-disabled handler, bounded final batch and inactive installer outside migrations. No new scheduler activation or automatic confirmation. Human screen-reader/zoom/brand checks are not claimed. Required-evidence UI wording needs the P4-R1 fix. |

This is the requested focused review of the seven questions, not certification of
all historical roadmap issues or hosted/manual release gates.

## Verification and limits

New local checks on this review's unchanged application/database source:

- Fixed isolated database migration checkpoint: `20260926002000`; zero active Cron jobs.
- Suites 001–012, 024, 028 and 029: **251 assertions across 15 suites passed**,
  validating TAP plans/counts and rejecting `not ok`/bailouts. Each suite rolls back.
- `npm run test:unit -- src/lib/lifecycle.test.ts`: **14 tests passed**.
- NULL-photo reproduction: **confirmed**, eight characterization assertions.
- Two-session completion/admin lock reproduction: **confirmed deadlock**; fixture cleanup completed.

Existing CI inspected: main run **36263730879** at `1baf270` passed backend and lifecycle,
including clean database reconstruction/replay, concurrency, authenticated worker/pg_net
and inactive installer. Its application job initially passed 244 of 245 browser cases
and failed the invitation-operations fixture with `apiResponse.json: Response has been
disposed` at its route-fetch handler. The failed application job passed on rerun; main run
[36263730879](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/36263730879)
now reports **success for backend, lifecycle and application**. The initial fixture
failure remains recorded rather than described as a clean first attempt. All Phase 4
browser cases passed in the inspected initial run.
Earlier main run 36256537232 at `417e642` passed all three jobs; changes from that tree
to this review base are governance documentation only.

No new full build, browser run, hosted verification or manual screen-reader/zoom/brand
acceptance is claimed. Existing unchanged CI is evidence for those automated checks.
No production data, real email, charges, payouts, provider accounts or hosted schema
were touched. Application code and migrations are unchanged by this review PR.

## Claude remediation before Phase 6

Implement one bounded Phase 4 completion-integrity repair answering P4-R1 and P4-R2,
with an additive migration and targeted UI category-requirement wording if needed.
Do not begin TRACE-095 or broader Phase 6 UI work. Preserve homeowner-only confirmation,
TRACE-055's wrapper, dispute holds, money kernels and all evidence/history.

Return: actual Storage-backed evidence tests, malformed/foreign proof rejection,
completion/correction concurrency in both orderings, duplicate/retry and rollback
checks, existing Phase 4/5 regressions, relevant UI accessibility checks and exact CI
results. Record the repair under its own new trace entry. Codex re-reviews the fixes;
then the owner decides Phase 4 acceptance and release of the Phase 6 hold. Scheduler,
communication and external/manual activation gates retain their existing phases.
