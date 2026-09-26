# Phase 4 — Completion integrity repair (TRACE-097)

**Status:** IMPLEMENTED for Codex re-review, 2026-09-26, on branch
`codex/phase4-completion-integrity` (from the review branch `codex/phase4-review-phase6-scope`,
PR #54, `efb4244`). Answers findings P4-R1 and P4-R2 of the
[Phase 4 code review](PHASE-4-CODE-REVIEW.md) (TRACE-096). This is not Phase 4 acceptance,
does not release the Phase 6 hold and authorizes no hosted migration or deployment.

Scope held to the review's remediation brief: one additive migration, the completion dialog's
requirement wording, and tests. No Phase 6 (TRACE-095) work. The following are unchanged:
homeowner-only confirmation, the TRACE-055 public wrapper, dispute holds, money kernels, and
all existing history.

## P4-R1 — completion evidence (migration `20260926003000`)

**Problem.** `vendor_complete_job` and the canonical transition counted array slots. Two NULL
entries satisfied a two-photo rule, and nothing established that the named files existed or
belonged to the job.

**Fix.**

1. **Verification in the canonical kernel.** `private.transition_job_status` no longer counts
   the array. It calls `private.completion_evidence_check` on the stored `photo_proof_urls`
   before any move to `vendor_completed`, so every caller is covered: the vendor RPC, admin
   transitions and service calls. A reference counts only when all of these hold:
   - it is non-null, non-blank and distinct;
   - it names a `job-photos` object at `<uploader>/<this job>/…`;
   - the object's owner is the folder's uploader;
   - that uploader is the job's assigned provider or an admin.

   The category minimum (latest versioned rule, baseline 1) applies to the verified count.
   Refusals use `22023` for malformed or foreign references. `P0001` is kept for "too few",
   as before. Every refusal is logged and raised inside the caller's transaction, so nothing
   commits.
2. **Recorded evidence.** The verified objects are written to the new immutable
   `job_completion_evidence` table: attempt, position, object name and id, uploader, minimum
   and rule version applied, and the recording actor. The completion event's metadata adds
   `completion_evidence_attempt`. After a rework, a new completion records a new attempt and
   earlier attempts stay. Clients cannot write the table. Participants and admins can read it.
3. **Retained through confirmation.** A restrictive Storage delete policy refuses deleting any
   recorded evidence object, for providers and admins alike. The policy function takes the
   job's per-request advisory lock before it reads, which serializes deletes with completion
   in both orders. Overwrite is already refused (no `job-photos` update policy).
4. **Homeowner can see the proof.** A new select policy lets the job's homeowner and assigned
   provider open recorded evidence objects. Before this, the homeowner's only read policy
   covered `job_photos` rows, which completion never wrote. The confirmation dialog's signed
   URLs therefore could not work for provider proof. Unrecorded uploads stay private to their
   uploader.
5. **UI.** The completion dialog loads the service's current rule and says "This service
   requires at least N photos". It shows "X of N required photos attached" (polite live
   region) and keeps **Mark complete** disabled until N photos are attached. If the rule
   cannot be loaded, an alert with **Try again** keeps completion blocked. The server remains
   authoritative.

**Legacy invalid references.** Nothing is backfilled, rewritten or fabricated. A job already
past completion keeps its stored `photo_proof_urls`, history and homeowner confirmation path
unchanged. Those references are not recorded evidence, so they gain no read access and no
delete protection. `completion_evidence_unverified()` (admin only, read-only) lists open
completions (`vendor_completed`, `pending_review`, `disputed`) with no recorded evidence. Any
new move to `vendor_completed`, including after rework, needs verified proof.

## P4-R2 — lock order

`vendor_complete_job` now takes the per-request advisory lock, then `FOR UPDATE` on the
request, before reading ownership or writing proof. It authorizes under both locks. That is
the order every other lifecycle command and the kernel use, and the kernel re-takes them
re-entrantly. Validation, the proof write, the transition, evidence rows, the event and the
notice remain one transaction.

## Decisions for Codex review

- **D1 Admin uploads count.** An admin-owned object in the admin's own folder for the job
  counts as proof, matching the existing admin completion path. An admin object placed in the
  provider's folder is refused, so the evidence never names the wrong uploader. The alternative
  is provider uploads only.
- **D2 Evidence is kept indefinitely.** No retention period for completion photos is defined in
  the authorities, so recorded proof cannot be deleted through Storage at all. A future
  retention rule would need its own reviewed path.
- **D3 Homeowner read access (item 4).** This is included because "retain required proof
  through confirmation" is hollow if the homeowner cannot open it. It is one policy and can be
  split out if you want it as its own slice.
- **D4 Legacy completions are not gated.** Blocking confirmation of legacy jobs without
  verified evidence would strand their payment path. They are listed for operators instead.
- **Residual, service key.** Service-role Storage calls bypass row-level security, and so
  bypass the delete protection. No platform code deletes job photos with the service key.
- **Residual, hosted.** As with TRACE-093, the policy and check functions read
  `storage.objects` and the evidence table as their owner, which is a superuser locally.
  Hosted behavior belongs to the Phase 8 hosted Storage checks, and fails closed if the bypass
  is absent.

## Evidence (synthetic, isolated local stack)

| Check | Result |
|---|---|
| Suite 062 (new) | 56 assertions: NULL/blank/duplicate/missing/other-bucket/other-job/unassigned-provider/forged-owner/admin-in-provider-folder/homeowner-upload/under-minimum refusals with state unchanged; direct admin transitions held to the same rule; recorded evidence, event metadata, one notice; immutability; participant/non-participant reads; delete refusals; duplicate; rework attempt 2 keeps attempt 1; retention after confirmation; baseline rule; legacy readback and unchanged legacy confirmation |
| Suites 003 and 011 | Now complete with real `storage.objects` rows, not synthetic strings; assertions unchanged (36, 8) |
| Full database run on a clean reset | 3066 assertions across 53 suites pass |
| Review reproduction `phase4-null-completion.sql` | The NULL-slot probe now dies with "Each completion photo must be an uploaded file" (probe 6 now fails only because its synthetic string is not a stored photo) |
| Review reproduction `phase4-completion-locks.py` | Deadlock no longer reproduced |
| `scripts/phase4-completion-integrity.mjs` (real Storage and REST APIs, concurrent sessions) | 62 checks: Storage uploads and ownership; seven REST refusals with state unchanged; retry succeeds; homeowner opens proof but not unsubmitted uploads; provider and admin Storage deletes and overwrite of proof refused; proof retained after confirmation. Concurrency: the review's lock window (completion waits holding no row lock; no deadlock), admin-first, completion-first, simultaneous duplicate (one attempt, one event), Storage delete first (completion refused), completion first (Storage API delete waits, then removes nothing), failure then retry |
| Mutation check, suite 062 | 11 of 11 killed by their intended assertions: old array-length kernel, no NULL check, no duplicate check, no job-folder check, no uploader check, no owner/folder match (survived until the admin-in-provider-folder case was added), minimum ignored, delete always allowed, evidence visible to all, evidence not recorded, old unlocked completion |
| Mutation check, script | The old unlocked `vendor_complete_job` fails "holds no row lock"; with that check removed it fails "no deadlock" (real deadlock) |
| Lint, typecheck, unit tests, build | Pass; 204 unit tests |
| Browser | Completion dialog (rule text, count, disabled button, upload-failure focus, rule-load failure alert and retry, axe) passes; portals, phase4 and homeowner specs pass (one homeowner axe-scan timeout passed on rerun). Full `test:a11y`: 244 of 246 passed. The 2 failures were 30 s timeouts in unchanged homeowner and `mds` specs, and both passed on rerun |

Local browser runs must build with the fixture's `NEXT_PUBLIC_SUPABASE_URL` and anon key.
Otherwise `.env.local` is compiled into the client bundle and the portal specs fail.

## Open

- Codex re-review of both fixes and D1–D4.
- CI: the new script is **not yet** in `.github/workflows/ci.yml`. Adding it after
  `phase5-document-attach-concurrency.mjs` in the backend job is proposed; the owner has not
  yet approved that edit.
- CI on the pull request head.
- `database.types.ts` is not regenerated. Regenerating now would also add TRACE-093's tables,
  which were never regenerated.
- Owner decision on Phase 4 acceptance and release of the Phase 6 hold.
- Hosted migration and Storage checks (Phase 8), with owner authorization.
