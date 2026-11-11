# Codex review — PR #160, CS-5 integration and CS5-F01 repair

**Owner closeout follow-up, 2026-11-10:** #160 merged as `88d4e09`; exact-head PR CI passed. Josh accepted Phase 6 and authorized Phase 7 in [PHASE-6-ACCEPTANCE](PHASE-6-ACCEPTANCE.md), with unperformed A2 and pending merge-CI/deployment verification explicitly carried forward. Earlier release/acceptance-pending statements below are the historical source-review checkpoint. This follow-up does not assert A2 pass or activate booking/features.

**Date:** 2026-11-10, America/New_York. **Reviewer:** Codex, architect/reviewer.
**Disposition:** SOURCE REVIEW CLEARED at `df9aefb8994d5cacc3e27bde3a578d172798bc3f`; no new blocking finding identified. Release remains conditional on complete green CI at that exact commit and the owner's merge authorization. This is not Phase 6 acceptance, gate activation or a backdated production approval.

## Exact coverage

- Requested combined range: `82b566d758fda621d18df2b787e53aba020f10b5..df9aefb8994d5cacc3e27bde3a578d172798bc3f` (17 changed files).
- Original CS-5 source: `99243ee..f5df38d`, reviewed previously and rechecked in this integration, including the admin client and its command boundary.
- New repair: `c8c40a4..c1186f9`, plus final hosted-readback documentation at `df9aefb`. Reviewed the additive `20261121001000` migration, SQL 098/109 additions, concurrency C14–C18, completion-integrity fixture repair, plan §5.2 and traceability records.
- Fetched main at review start: `48d1bba360d40c77d95d7c14847c6a7bb11ab33c` (#159). #160 targets main. The old #158 merge `edd7de4` is not an ancestor of this candidate; the integration brings its changes through `c8c40a4` rather than re-merging the old #157 branch.

## CS5-F01 disposition

**The source defect is addressed by the reviewed repair.** `start_exception_hard_stop` directly checks the obligation's dispute/refund hold, the existing lock-free source-validity helper, and the presence/expiry of the reviewed snapshot. A processing/unknown display label no longer substitutes for those checks. The admin command checks before inserting an exception; the authoritative start boundary checks again before honoring a same-transaction exception, covering direct lifecycle/admin/rework paths. Both one-time jobs and recurring visits use the predicate. Fully paid starts retain their prior rule. No new table locks, silent repricing, payment capture, refund or payout behavior is introduced.

The tests now combine processing/unresolved/partial capture with held or blocked terms, check the real pause/suspension commands after checkout, assert no status/audit/start changes on refusal, and include restored positive controls. Same-transaction exception rows cannot bypass a hard stop. C14–C16 cover forced orders and races against pause/suspension; C17/C18 cover unpaid exception rework refusal and paid rework success. SQL 109 covers the real quote gate. These address the previously missing regression dimensions.

**Status wording:** CS5-F01 is source-reviewed and resolved in this candidate. Plan §5.2 records the authorized hosted push and matching definition hashes. I did not independently re-read hosted. Main/client integration is pending #160's merge. After that merge, record its SHA/deployment in the closeout checkpoint and mark the release portion complete; do not continue listing the repair as unreviewed or unbuilt. Earlier changes-required statements in the #157/#158 report are historical.

## Answers to the three PR questions

1. **Retry after a later hold/block: acceptable.** An exception command is a request for authority to start work under current conditions, not permission to override a newly established hard stop. Refusing a retried call is acceptable under the existing fail-closed policy. The earlier start event and audit remain authoritative evidence of what already happened; refusal must not be described as undoing that start. No duplicate start, exception or payment is created. Existing actor/key authorization and transaction boundaries are retained.
2. **Expiry predicate test: acceptable for this slice.** The helper takes `p_at`, and both production call sites pass `now()`. Testing the helper at a future time establishes the boundary without changing PostgreSQL's transaction clock or an immutable snapshot. Current-time integration tests exercise command/trigger refusal for the other hard stops. This is not a claim that an end-to-end real-time expiry test was run, but it is sufficient alongside the inspected wiring and unchanged expiry semantics.
3. **Recurring scope: acceptable.** The same display-priority exposure existed in the recurring exception path. Applying the same independently checked exclusions enforces the already-approved recurring rule; it does not change that rule, display priority, paid start, or scheduled-only exception/rework restrictions. One-time and recurring parity/positive controls are present.

## Verification and limits

- Independently run on the candidate in an isolated source checkout: 61 unit files / **664 tests PASS**. Typecheck, lint and secret scan also PASS.
- Directly inspected CI run [42875556384](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/42875556384), SHA `df9aefb`. Backend and lifecycle jobs passed. Backend logs show initial suite and post-concurrency clean replay each **109 files / 7,225 tests PASS**, including the bound-terms concurrency success message for C14–C18. Application/browser job was still running at this recording checkpoint; the PR must not be called fully green until it finishes successfully.
- The completion-integrity diff changes synthetic setup to matched/paid jobs and adds an independent snapshot approver; existing assertions are unchanged. Its reported **62/62** is implementation evidence, not an independent local run by Codex. It must pass against the frozen final schema/candidate as part of final evidence.
- The fingerprint list is unchanged, and no listed money function is restated by either new migration. Recorded fingerprint remains `58 | af0fae6e0c5b604e9073e10bc060957e`. Source review explicitly covers the permission boundary outside that fingerprint. Hosted definition hashes, grants, migration history and gates are dated readbacks in plan §5.2, not newly verified by me.
- No local Docker/psql runtime: SQL/concurrency results above are independently inspected CI evidence. No local browser, hosted SQL, migration push, deployment, merge, activation or human acceptance was performed by this review. Conditional owner finance approval is not broadened; unrelated deferred finance, tax, promotion, payment-kernel or dark-mode work stays deferred under its own recorded gates.

## Remaining closeout

1. Complete exact-head CI and owner-authorized #160 merge/deployment; record the resulting main SHA and migration reconciliation. Both migrations are already recorded hosted, so do not blindly push them again.
2. Record actual owner answers or explicit deferrals for W-6/O-3, O-9 and the unnamed deferral gates. Do not invent approval or make them new Phase 6 blockers without owner authority.
3. Keep `offer_terms` off unless separately authorized. Activation is optional/separate and requires the prescribed code/fingerprint/gate readback.
4. Freeze the final candidate after integration and record green CI, a clean full replay, explained fingerprint and completion-integrity evidence. Run A2 on that commit (screen reader, real devices, zoom/reflow, keyboard and approved visual baselines).
5. Josh's written Phase 6 acceptance authorizes Phase 7. This review does not supply it.
