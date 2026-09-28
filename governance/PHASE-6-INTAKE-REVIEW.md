# Codex review — Phase 6.2 intake / TRACE-098

Date: 2026-09-27. Reviewed branch `codex/phase6-intake`, head `634837a`;
implementation diff `c2b9b81..634837a`, with prerequisite P6-R1 inspected separately.
Disposition: **changes required**, two bounded intake recovery/presentation fixes.
This review does not close Phase 6 or authorize external activation.

Authorities: MPS §§4/6.1/6.2/6.5; MDS forms, status and accessibility contracts;
MTS trust boundaries, data and testing; CFG-001–003/009; DEC-2026-015/020/021;
[6.2 brief](PHASE-6-INTAKE-BRIEF.md), I3/I4/I6. The explicit approved authority
chain remains the one recorded in PHASE-6-SCOPE.md; its historical MTS discrepancy
is already recorded there. CLAUDE.md and installed Next.js `use-client.md` were read.
Supabase security and Impeccable frontend audit guidance were applied to the review.
No UI score or new manual accessibility result is claimed.

## Findings for Claude

### P6-R2 — P1: saved confirmation ignores the current request lifecycle

Location: `src/lib/requestConfirmation.ts:66`–94; saved-intake recovery in
`src/app/request/page.tsx:880` and confirmation rendering at 1100 onward.

`describeConfirmation` receives `row.status` but never uses it. It returns
`provider_confirmed` whenever matching is `matched` and a contractor remains assigned.
A homeowner returning to the saved intake after scheduling, starting, completing or
cancelling therefore sees the initial provider acceptance instead of the current
outcome. Without that matching combination, later states fall back to submitted or
quote-required copy. This conflicts with the confirmation's promise to show where
requests stand now, MPS lifecycle honesty and I6. Quote/payment copy also relies on
submission-time mode/amount and only recognizes captured payment; avoid stale
claims that no amount exists or nothing was charged after subsequent quote/payment
activity.

Reproduction: [phase6-intake-confirmation.repro.ts](review-evidence/phase6-intake-confirmation.repro.ts)
feeds synthetic cancelled, scheduled, in_progress and homeowner_confirmed readbacks
to the real helper. **4/4 acceptance assertions fail**, each receiving
`provider_confirmed`. This is a helper-level reproduction, not a new browser run.

Fix: give authoritative lifecycle state precedence over initial matching state,
using the shared lifecycle presentation contract. Preserve the original submission
amount as explicitly historical, or read current commercial terms through the
existing authorized readback. If the intake lacks sufficient current detail,
direct the homeowner to the request dashboard without inventing it. Render payment
state conservatively; do not equate a missing/non-captured state to no charge.
Gate checkout/matching retry actions against current state as well. No new scheduling,
quote or payment command is needed. Return helper regressions and browser reload
cases for later/terminal states, including accepted quote and refunded payment.

### P6-R3 — P2: unknown submission recovery depends on a fresh coverage lookup

Location: `src/app/request/page.tsx:975`–1000.

`submitReview` validates current editable contact/selection fields, checks coverage,
and can send coverage interest **before** replaying `draft.inFlight`. After a
committed submission whose response was lost, a coverage outage prevents the
promised same-key recovery and shows “nothing was sent.” If the ZIP becomes
uncovered (or the homeowner edits it), the path can submit interest instead of
resolving the earlier request. The database's stored replay does not require current
coverage to remain available. This finding is established by source/control-flow
inspection; no new browser reproduction was run for it.

Fix: once the actor is verified, resolve an unknown attempt first using its exact
persisted key/payload, independently of current form fields and fresh coverage or
preview. Keep any explicit new-request path distinct. Do not claim nothing was
submitted until the command authoritatively refuses it. Return browser tests for a
lost response followed by coverage failure/uncovered result and edited fields;
prove replay retains the original payload/key, creates no interest and no duplicate.

## Prerequisite P6-R1 re-review

The wrapper in migration `20260927020000` checks authenticated homeowner capability
before validation, stored replay or writes, and the private core is not callable by
browser or service roles. Dual-role homeowners retain their capability. Code review,
SQL 065 **29/29**, SQL 063 **65/65**, and real RPC script checks 5/6 close the local
P6-R1 code-review finding. Merge/CI remain separate repository gates; no hosted role
change was performed.

## D1–D9 dispositions

| Decision | Review disposition |
|---|---|
| D1, stacking | Owner-authorized stack is recorded. P6-R1 local re-review is clear above. Do not claim PR merge/CI from this local review. |
| D2, anonymous preview | Accept this bounded read-only public inventory lookup: STABLE, empty public endpoint search_path, explicit grants, private helpers revoked; no customer identity or private scoring in output. Public questions and scope are intentional. Operational abuse/performance monitoring remains a release concern; no arbitrary limit is invented here. |
| D3, duplicated evaluation | Accept for this slice with SQL parity tests. Future changes to eligibility/pricing must update preview and submission together. Do not refactor the command during 6.3 merely to remove duplication. |
| D4, eligibility wrapper | Inspected delegation and regression evidence; retains request-bound answers and the five-argument answer-blind behavior. Preserve these contracts in 6.3. |
| D5, local offering | Conforms: unbound submission already chooses eligible local supply; explicit choices remain bound. Preview is informational and submission revalidates. |
| D6, promotions | Intake fails closed as the brief requires. Direct submission still accepts promoted terms (SQL 066 parity), while checkout refuses them. This is a recorded backend dependency under DEC-2026-015, not approval to run promotions. Require a reviewed server-side refusal or approved data cutover proving no promoted supply before beta activation; preserve historical money and never silently substitute a base price. 6.3 must not add a bypass or advertise promoted offers. |
| D7, photos | Reconciliation improves sequential recovery and real Storage ownership checks pass. No database uniqueness/atomic coordination guarantees concurrent attachment exactly once; keep this limitation explicit. Orphan retention remains an unresolved release item; no vendor-document retention period is imported into homeowner photos. Do not delete linked/evidence objects or activate a purge without the governing retention decision and tests. |
| D8, signed-out hold | Accept held owner-bound drafts; account-switch and signed-out fixtures are in existing evidence. Async response isolation must remain covered when modifying recovery. |
| D9, reduced motion | Intake explicitly emulates it in tests; shared configuration discrepancy remains a test-infrastructure follow-up. Do not claim other suites establish reduced-motion behavior. |

## Verification run by Codex

All database/script work used the existing local synthetic stack
`supabase_db_vugqqyemuptlvcieihww`. No database reset or hosted operation.

- `npx vitest run tests/unit/request-intake.test.ts tests/unit/request-submission.test.ts`:
  **70/70**, two files.
- `npm run typecheck`: PASS.
- Rollback-only SQL 063/064/065/066 through local `docker exec ... psql -X -v ON_ERROR_STOP=1`:
  **65 + 16 + 29 + 68 = 178/178**, each rolled back.
- `PHASE6_DB_CONTAINER=supabase_db_vugqqyemuptlvcieihww PHASE6_SUPABASE_WORKDIR=. node scripts/phase6-request-submission.mjs`:
  **32/32**, real RPC/concurrency/Storage; synthetic fixtures removed by the script.
- Explicit review reproduction: **4 expected failures**, confirming P6-R2.
  To rerun, write `/tmp/phase6-review-vitest.config.mts` containing
  `export default { test: { include: ["governance/review-evidence/phase6-intake-confirmation.repro.ts"], maxWorkers: 1 } };`
  then run `npx vitest run --config /tmp/phase6-review-vitest.config.mts`.
  The `.repro.ts` file is outside default test discovery; Claude should turn the
  cases into permanent acceptance regressions with the fix.

The implementation report's 3244 SQL assertions, 274 unit tests, full 310-case
browser run, axe/visual matrix and owner-accepted human check are historical
implementation evidence, not repeated by this review. No fresh build, browser,
manual screen-reader or GitHub CI check was performed. The owner-closed human gate
is preserved. Checkout Edge Function integration, script CI wiring, final-head and
post-merge CI, hosted rollout/reconciliation and Phase 7 delivery remain named gates.

## Handoff order

Claude repairs P6-R2/P6-R3 under TRACE-098 in one bounded follow-up, returns exact
regressions and a reviewable diff, then Codex re-reviews. Proceed to
[6.3 / TRACE-099](PHASE-6-MATCHING-BRIEF.md) after those findings are clear and the
reviewed base is available. Keep review, merge evidence and phase acceptance separate.
