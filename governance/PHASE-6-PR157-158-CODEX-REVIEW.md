# Codex review: Phase 6 PRs #157 and #158

**2026-11-10 follow-up:** [Combined #160 review](PHASE-6-PR160-CODEX-REVIEW.md) clears source range `82b566d..df9aefb`, resolving CS5-F01 in that candidate and answering all three PR questions. Plan §5.2 records the hosted repair/readback. Main/client integration still awaits #160 merge and complete green CI; record the merge/deployment SHA afterward. The changes-required disposition below is retained as historical review evidence, not the current source-review verdict. Phase 6 is not accepted.

**Date:** 2026-11-10 (America/New_York). **Reviewer:** Codex, architect/reviewer. **Result:** #157 source review cleared; #158 changes required (CS5-F01). Phase 6 is not accepted and Phase 7 is not authorized. This is a repository source-review record, not a GitHub review submission, a backdated release approval, or authorization for production actions.

## Exact scope and integration

| Item | Reviewed range / checkpoint | Disposition |
|---|---|---|
| #157, A1-F01 / TRACE-136 | `94930170a5484f0fd64c67c8e39ee403b7978e23..99243ee8ec2309831cd53071319610b6d50a81be` | Cleared. Advisory lock is acquired before the request row; authorization, keyed/actor-bound replay, stale refusal and atomic history retained. |
| #157 integration | `82b566d758fda621d18df2b787e53aba020f10b5` on main | Verified in fetched Git history and GitHub. A1-F01 implementation/code-review gap is resolved. Hosted release/readback is recorded in the repository, not independently re-read here. |
| #158, one-time CS-5 / TRACE-145 | `99243ee8ec2309831cd53071319610b6d50a81be..f5df38da11e044b51faf58cf79ee9f596c0c3622` | Changes required below. Reviewed SQL migration, trigger/exception callers, client, test/fixture/concurrency changes and plan §5.1. |
| #158 integration | `edd7de483465923fce52d66ccbf7483b33bb76f8` | Merged into `claude/phase6-a1-f01-admin-lock-order`, **not main**, after #157 had already merged. Fetched main is still `82b566d`. No open PR was returned at this checkpoint. Do not equate closed/merged #158 with production client deployment. |

Both migration pushes are already recorded in plan §5.1 / handoff, through `20261120001000`, with fingerprint `58 | af0fae6e0c5b604e9073e10bc060957e` and gates off. Thus the database gate may already be active despite the missing main/client integration. These are dated implementation records, not a fresh hosted check by this review. Do not push applied migrations again or edit them in place.

## #157: A1-F01 disposition

The replacement adds the same per-request advisory key as the lifecycle commands before `FOR UPDATE`. The direct replay helper acquires no further locks, and the transition's repeated advisory acquisition is re-entrant. The A9 test holds the advisory lock in the provider session, observes the admin waiting, then executes the real provider start; it checks start applied, admin stale refusal, no deadlock and no admin history for the refused change. This addresses the cycle identified in A1-F01. SQL 118's source-order/grant checks complement that behavioral test; they do not replace it. The #158 update making A9's fixture paid is necessary under the new start policy and retains the concurrency assertion.

No additional blocking finding identified in #157. This retrospective review does not erase its missed pre-merge review gate.

## CS5-F01 — blocking: display-state priority is being used as exception authority

**Affected file:** `supabase/migrations/20261120001000_phase6_cs5_one_time_start_gate.sql`, particularly `one_time_job_payment` lines 82–91, `one_time_start_payment_block`, and `admin_start_visit_payment_exception`.

**Requirement:** plan §5.1 and the migration's stated policy permit reasoned exceptions for ready/processing/failed/unknown jobs, **never held, terms-blocked or unreviewed jobs**.

**Source-verified counterexample:** take an accepted, unpaid one-time job with a reviewed snapshot and an unexpired prepared/session-created checkout. Pause its offering lineage or suspend its provider so `one_time_source_problem` would report a real live-eligibility block. `one_time_job_payment` selects `processing` at line 84, before running the source check at line 88. Operations can call `admin_start_visit_payment_exception`; it accepts `processing`, records the same-transaction exception and calls `start_job`. The trigger recomputes the same label and accepts that exception. The service can start despite blocked terms. An unresolved or partial-capture label similarly outranks the held/source checks. The existence of an old checkout does not authorize overriding those hard stops.

The new SQL 098 matrix creates separate processing, held and blocked fixtures. It does not combine a processing/unknown payment with a held or blocked source, so its passing results do not establish the claimed exclusion. The operator's general authority to record a payment exception is not authority to override a held payment or invalid offering.

**Evidence limit:** identified from the exact control flow and called guards, not reproduced against a database in this environment. A deterministic database regression is required from the implementer. No claim of wrong charge, ledger mutation or live affected customer is made.

### Bounded forward-fix instructions for Claude

1. Keep queue/display payment-state priority separate from start-exception eligibility. Preserve the existing fully-paid start policy; do not silently redefine paid rework, refunds or payouts in this repair.
2. Before any **unpaid** start exception is authorized or honored, independently establish the required live-source/terms validity, reviewed snapshot validity and applicable holds. A `processing` or `unknown` label must not bypass those checks. Check again at the authoritative start boundary so direct lifecycle/admin/rework paths do not avoid the rule.
3. Retain request advisory-before-row lock ordering, admin authorization, reason, keyed append-only audit and atomic start. Do not introduce `money_source` table locks into lifecycle starts or change accepted prices/payment kernels to solve a read-only eligibility issue.
4. Add regressions combining processing and unknown/partial capture with each held/source-blocked condition. Cover the real provider pause/suspension command after checkout preparation, direct operator exception calls, ordinary start paths and exception/start races against the relevant eligibility changes. A denied attempt changes no status, exception audit or start event. Include the previously absent quote-gate and unpaid-exception rework cases below, plus positive paid/reasoned-exception controls.
5. The recurring classifier uses the same priority pattern. Inspect and report the equivalent exposure; preserve the approved recurring policy and use a shared hard-stop predicate only if its parity and scope are demonstrated. Do not treat copied behavior as policy approval.
6. Use a **new additive migration**, since 20261120001000 is recorded applied. Update plan, TRACE-145 and this finding with exact evidence. Run SQL 098/118 and fulfillment, admin, exceptions and relevant payment/eligibility races; obtain a clean full replay and explain the fingerprint. An unchanged fingerprint is not sufficient evidence for this permission boundary.

This clears the repair approach for implementation, not unbuilt code or deployment. Do not release the #158 client as “reviewed/clear” until the fix is reviewed.

## Codex readings requested in plan §5.1

1. **Quote jobs:** accept the conservative reading. No start or operator exception may bypass the existing tax/commercial-review gate. Do not invent a tax value, manual charge or special quote exception. Describe the restriction as conditional on that gate; avoid claiming quote jobs can never start after the approved payment path becomes available. Add a server-level quote test rather than relying on the absence of current snapshots.
2. **Rework:** accept rechecking the payment prerequisite on every restart, including a job whose first start used an exception. A prior transaction's exception is not reusable authorization. The current exception command is scheduled-only; do not expand it to rework under this slice. Paid rework remains possible subject to existing lifecycle/dispute rules. Add an explicit unpaid-exception → completion/rework → restart refusal test and paid-rework control.

These are technical readings of the approved paid-start policy, not new permission to lift a product or finance gate. CS5-F01 must be fixed before either reading is described as fully enforced.

## Verification

- Independently ran at #158 head: **61 unit-test files / 664 tests PASS**, and typecheck PASS. Existing installed locked dependencies were reused in an isolated review worktree; no production credentials or customer fixtures.
- Directly verified exact-commit CI: #157 run [42739250383](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/42739250383), SHA `99243ee`, and #158 run [42739273497](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/42739273497), SHA `f5df38d`. Backend, lifecycle and application jobs are successful; each backend includes a successful clean-replay step. These are inspected CI results, not local SQL/browser reruns.
- #157's reported old-definition 3/3 deadlocks and fixed-definition 5/5 passes are implementation evidence; not independently reproduced here. A9 source was reviewed.
- Fingerprint script unchanged in #158's diff; migration restates no listed function. Hosted fingerprint/grants/definitions were not re-read or recomputed by this review. The unchanged list does not cover the newly introduced permission defect.
- No Docker/psql runtime here; no local SQL/concurrency, hosted operation, migration push, merge or gate activation performed. Human A2 and visual checks were not performed.

## Integration and remaining closeout

1. Implement CS5-F01 as a bounded forward fix. Prepare one integration PR **to main** carrying #158's exact reviewed CS-5 changes plus the repair and its evidence. Do not re-merge the old #157 branch and assume it already reached main; check the resulting diff and ancestry. Codex reviews the combined final range before release. Hosted actions and merge remain owner-authorized steps, beginning with a read-only migration reconciliation.
2. Repair the reported stale `scripts/phase4-completion-integrity.mjs` fixture in a bounded test-only change: use legitimate paid/accepted lifecycle setup and preserve its original Storage/evidence/locking assertions. Do not weaken guards, skip assertions or mark the failing script passing. Run it on the final schema; this review did not run it.
3. Reconcile the owner items without inventing approvals: W-6 operator Special Offer writes; DEC-2026-059 analytics purge/invitation actions; named gates for D-6d/P-3e, T-3 and R-3. The named deferrals are not Phase 6 blockers under the recorded decision; this review does not activate them or turn carried R1 requirements into Phase 6 gates.
4. `offer_terms` remains off per the latest recorded readback; no activation authorized here. Before activation obtain explicit owner authorization and read back the reviewed code/fingerprint, deployment compatibility and gate result. Do not activate it as an automatic side effect of the CS-5 merge.
5. Freeze a final candidate only after the repairs and integration. Green exact-commit CI, full clean replay, the repaired out-of-CI integrity script and explained fingerprint precede final human A2 checks and written owner acceptance. This source review accepts no phase.
