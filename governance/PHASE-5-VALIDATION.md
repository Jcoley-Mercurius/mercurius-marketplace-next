# Phase 5 validation — 2026-09-04

Migration prefixes are ordering identifiers, not execution timestamps. The
`20260905...` files were present and executed during the September 4 UTC checks;
their ordering prefix does not postpone execution or change the validation date.
For the subsequent combined-source checkpoint see PR-6-MERGE-RECONCILIATION.md.

Independent draft slices; this report does not claim phase acceptance or production
readiness. Base: remote main d8cceee30a934c17804a0f507cb41c289dc8e417. PR #4 was
verified open, draft and unmerged at 91bc94f before branching and again at closeout.
No pending Phase 4 code was included. See TRACE-050–053 and PHASE-5-HANDOFF.md.

## Measured local evidence

| Check | Observed outcome |
|---|---|
| Clean isolated reconstruction | PASS, pinned Supabase 2.116.0, all migrations through 20260905008000 and synthetic reference seed; project mercurius-phase5-isolated, ports 55520–55527 |
| SQL contracts | PASS: 138 assertions across 3 suites, including inherited security/role contracts and 100 Phase 5 assertions; tests roll back |
| Concurrent database calls | PASS: eight authenticated checkout calls return one attempt; eight deliveries/processors post once; different event IDs for one payment post once; competing over-cap refund reservations permit only one. Committed synthetic fixtures were removed by subsequent clean reset |
| Generated database types | Regenerated from the clean isolated database; no production introspection |
| Locked Edge typechecks | PASS: all 11 recovered entrypoints, including replaced handlers and shared modules |
| Isolated actual Edge handlers | PASS: 32 Deno cases; fetch replaced with synthetic transport and no network permission. Includes both checkout wrappers, stable amount/key, disabled execution and signed raw webhook retry/invalid-signature cases |
| Lint and TypeScript | PASS after final implementation and generated types |
| Unit/contracts | PASS: 84 tests in 7 files; includes integer cents, retained fees, deposits, retry windows, payout gates, webhook normalization and vendor matching eligibility |
| Production build | PASS with MERCURIUS_BUILD_WORKERS=1 and synthetic local public configuration |
| Production dependency audit | PASS: npm audit --omit=dev --audit-level=high reported zero vulnerabilities |
| Browser regression suite | First full run: 54 passed, one new test selector failed because it matched Next.js's route announcer as well as the intended error. Scoped the selector to main content; focused rerun: all 7 payment cases passed. All 48 inherited cases passed unchanged. Final-head CI must run all 55 together |
| Automated accessibility | Payment review and confirmation: zero axe violations for WCAG 2/2.1/2.2 A/AA tags at 320px and 1440px, light/dark; keyboard entry, cancel focus, persistent provider-launch error and focus return passed |
| Screenshot inspection | Agent visually inspected the four payment confirmation screenshots: readable, no clipping, clear keyboard focus and mobile stacked actions. These are synthetic fixtures, not human acceptance |
| Browser CLI gut check | Local built checkout route rendered its unavailable-invoice error with visible focus, meaningful content and no reported runtime error. Successful homeowner rendering was established by Playwright, not this separate CLI session |
| Credential and whitespace scans | Staged tracked-source credential scan and git diff --cached --check passed; ignored local logs, credentials and tools are excluded |

Clean tests caught and corrected SQL alias ambiguity in ACH processing and the new
application-version review path. The final SQL run also proves stale matching
readback cannot clear newer drift, verified expiry creates a fresh checkout key,
and reapplication invalidates earlier-version compliance. Initial failed tool setup
or readiness attempts are not reported as passes.

## Reproduction

Run heavy checks sequentially. Install the repository's pinned Node/npm dependencies
and Supabase 2.116.0 plus Deno 2.9.6. Docker must be available. Use only the isolated
project prepared below; never redirect these commands to a linked production project.

```sh
export MERCURIUS_BUILD_WORKERS=1
node scripts/prepare-phase5-local.mjs
sh scripts/phase5-db.sh start
sh scripts/phase5-db.sh test
node scripts/phase5-concurrency.mjs
sh scripts/phase5-db.sh reset
sh scripts/phase5-db.sh test
sh scripts/check-edge.sh
sh scripts/test-edge.sh
sh scripts/phase5-db.sh stop
```

The start script keeps CLI startup output in an ignored file because local Supabase
prints generated test keys. Do not publish that output. Application checks use only
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831 and the synthetic fixture anon value
already in CI. Run lint, typecheck, test:unit, build and test:a11y in that order.
Playwright refuses occupied test ports instead of reusing another task's server.
The backend CI job runs before the application job, preserving sequential heavy work.

## Unperformed checks and remaining gates

No actual Stripe SDK network call, Stripe CLI delivery, bank transfer, bank statement
integration, real email, Auth invitation delivery, real licensing/insurance review,
customer data migration or production operation was performed. Gateway/JWT end-to-end
verification, Phase 4 adapters, tax/promotion configuration, legacy cutover, failed
refund replacement, bank statement replacement and already-paid recovery remain
explicit gates. Human screen-reader, true zoom, cross-platform and brand acceptance
remain open. No inference from these automated checks closes those gates.

CI status is separate from local evidence and must be checked on the final PR head.
No merge, deployment, Cron activation or configuration activation is authorized.
Homeschool Haven remained running and was not stopped or modified.

## TRACE-060 vendor matching eligibility follow-up — 2026-09-05

A clean isolated reset applied the complete migration chain through
`20260905016000_vendor_matching_eligibility.sql`. The database suite passed 20 files
and 454 assertions. SQL 029 verifies the explicit legacy cutover boundary, incomplete
review exclusion, current-evidence activation, immediate suspension, acceptance-time
revalidation, unchanged job/offer state after rejection, and privilege-negative bypass
checks. Application secret scan, lint, typecheck, unit tests and build are recorded with
the branch validation evidence.

## TRACE-061 existing-provider compliance cutover — 2026-09-05

Clean reconstruction and all 21 SQL suites pass with 476 assertions. SQL 030 covers operator-only scoped license/insurance requirement authoring, multi-requirement evidence reuse, replacement evidence binding, reviewed provider decisions, strict finalization, post-cutover matching, suspension, immutability and RPC-only privileges. Application validation is recorded with the branch evidence.

## TRACE-062 provider compliance operations — 2026-09-08

- Clean isolated reconstruction applies migrations through
  `20260905018000_vendor_compliance_operations.sql` using Supabase 2.116.0.
- All 21 SQL suites pass with 489 assertions. Added cases cover private application
  snapshot ownership, stale evidence replacement, exact retry reuse, superseded
  binding readback and operator/anonymous/service-role access boundaries.
- Secret scan passes. Full lint found only the new page's render-time clock use;
  corrected to use the database evaluation timestamp. Final focused lint covers
  the page, navigation and browser fixtures/tests; it passes. Final secret and
  whitespace checks also pass.
- TypeScript and all 84 unit tests pass.
- Generated database bindings match a fresh generation from the clean local schema.
- Production build passes with `MERCURIUS_BUILD_WORKERS=1` and synthetic public
  configuration; all 57 static pages generate, including `/admin/compliance`.
- All six focused compliance browser cases pass against the production build:
  mobile/light (320px), desktop/dark (1440px), evidence reuse, stale-head request
  submission, failed exclusion confirmation, and successful inclusion/finalization
  after synthetic server readback.
- Both viewport/theme accessibility checks report zero WCAG A/AA axe violations;
  reflow checks pass. Agent screenshot inspection found readable controls and no
  clipping. These checks do not replace human screen-reader or browser-zoom review.
- The separate browser CLI reached the access-denied state with synthetic state;
  an initial state had expired during the pause, and refreshing it did not establish
  the client-side role check. Local fixture connectivity passed, but this CLI run
  does not count as authenticated workflow verification. The successful Playwright
  cases above remain the measured browser acceptance evidence. A fresh-session
  Playwright mobile/light rerun after the pause also passes.

No real provider document, financial action, invitation, cutover activation or
production operation was performed. Remaining Phase 5 and human acceptance gates
are listed in PHASE-5-COMPLIANCE-OPERATIONS.md.

## TRACE-063 — Provider invitation dispatch and acceptance (2026-09-10)

The isolated `codex/phase5-vendor-invitations` worktree starts at merged PR #15
(`d815e90`). Verification uses only synthetic local fixtures and substituted Auth
transport. No real invitation or Auth account provisioning was performed.

- Clean migration replay and all 22 SQL suites pass: **518 assertions**. Cases
  include authorization, duplicate reservation, uncertain outcomes, exact identity
  readback, confirmed recipient checks, expiry, suspension, revocation, stale
  applications, immutable acceptance and absence of role/link/activation effects.
- Eight simultaneous authenticated claims produce exactly one winner, one durable
  dispatch and one submitted event. The isolated database was reset afterward and
  the complete SQL suite passed again. CI includes this concurrency check and reset.
- Fresh database types were generated from the clean isolated schema.
- The invitation's locked Deno type check passes. All **9 invitation handler tests**
  pass with substituted transport and no network permission. All 11 locked Edge
  handlers subsequently passed type checks and all **44 handler tests** passed.
- Secret scan, full application lint, TypeScript and all **84 unit tests** pass.

- Production build passes with synthetic public configuration and one build worker;
  all **58 pages** generate, including `/invitation`.
- All **5 focused browser cases** pass against that build: mobile/light at 320px,
  desktop/dark at 1440px, retryable failure, invalid/unauthenticated links, and the
  password-setup handoff with no automatic acceptance. The first run exposed two
  selectors that also matched Next.js's route announcer and a navigation timeout;
  scoped selectors and a 15-second navigation assertion resolved the three cases
  on their focused rerun. No application change was needed for those failures.
- Both theme/viewport accessibility checks have zero WCAG A/AA axe violations;
  overflow checks pass. Screenshot inspection confirms readable controls and no
  clipping. Human screen-reader and browser-zoom acceptance remain separate.

- Separate browser CLI smoke check passes: the unauthenticated invitation page
  renders the sign-in control, no runtime errors or framework overlay are reported,
  and home navigation renders content. Screenshot inspection passes.

The browser, handler and SQL checks verify their respective boundaries with
synthetic fixtures. Actual gateway/JWT, Auth invitation links, mail templates,
redirect allowlists and mailbox delivery remain integration gates. Existing-account
linking and operator queue wiring remain follow-up slices. No production operation,
real email, role grant, account linking or activation was performed.

## TRACE-064 production dependency audit remediation — 2026-09-10

Base `d815e90` (origin/main). Local checks ran sequentially in an isolated worktree
with Node 24.17.0 and the CI synthetic public configuration
(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55831`, synthetic anon value,
`MERCURIUS_BUILD_WORKERS=1`).

- Before: `npm run audit:prod` on unmodified main reports 4 vulnerabilities
  (1 critical next, 2 high sharp/js-yaml, 1 moderate hono), matching PR #16's
  failed `application` job log.
- After: `npm ci --ignore-scripts` from the updated lockfile succeeds, and
  `npm run audit:prod` reports zero vulnerabilities. `npm ls` resolves next 16.3.4,
  sharp 0.35.4, js-yaml 4.3.2 and hono 4.13.7.
- Secret scan, lint, TypeScript and all 84 unit tests pass.
- Production build passes on Next.js 16.3.4 (Turbopack) and generates all 57 static
  pages without warnings.
- `npm run test:a11y`: all 69 Playwright cases pass against the production build,
  including axe WCAG A/AA, reflow, keyboard/focus, both themes and 320/1440px
  viewports.
- `git diff --check` passes; only `package.json` and `package-lock.json` change
  outside governance documentation.

Not run locally: database suites, Edge checks/handler tests and concurrency scripts
(npm-only change; Deno imports are separately locked), the `@visual` screenshot
suite (not a CI gate), and a hosted or dev-server session. CI must confirm all three
jobs on the final PR head.

## TRACE-065 — Start onboarding review for new applicants — 2026-09-12

Verified in the isolated `mercurius-phase5-isolated` stack from the
`codex/phase5-onboarding-intake` worktree, base main `5a3bffe`. Synthetic fixtures only.
No provider record, Auth account, invitation, email or activation was created anywhere
outside that local database.

- Clean migration replay and all 23 SQL suites pass: **582 assertions**, of which the new
  `032_phase5_onboarding_intake.sql` contributes **64** covering operator-only access
  (anon, service role and vendor denied before any key or application lookup; the request
  table unreadable and unwritable directly), validation (blank reason/key, missing,
  foreign and stale version, rejected and abandoned applications, unknown application),
  creation (hidden account-less contractor carrying only the business name, link,
  revision-1 review on the expected version, exactly one `review_started` event with
  trimmed reason and namespaced key, stored request identity, unchanged legacy application
  status, no new application version), effects (not onboarding-eligible, not
  match-eligible, no role, no Auth user, no invitation, no evidence, invisible to anon and
  authenticated listing reads, immutable request row), replay (exact retry, retry after an
  application edit, and conflicts on changed reason, application, actor or expected
  version), a non-creating different-key start, and rejection without mutation for active,
  suspended, rejected and older-version onboarding plus legacy-linked and cut-over
  providers. Every rejection branch asserts an unchanged fingerprint of contractors,
  applications, onboarding, events, request rows, versions and roles.
- `scripts/phase5-onboarding-concurrency.mjs`: eight **different-key** concurrent starts
  produce one contractor, link, onboarding row, revision-1 event and request row, with one
  `created: true` and the rest `created: false` on the same contractor; eight **same-key**
  concurrent starts all return the identical original result over one set of rows. Both
  raced contractors remain hidden and account-less. The isolated database was reset
  afterward and the full suite passed again. CI runs this script after the invitation
  concurrency step and before the clean reset.
- Fresh database types were generated from the clean isolated schema; the diff is additive.
- Secret scan, lint, TypeScript and all **84 unit tests** pass.
- Production build passes with synthetic public configuration and one build worker; all
  **58 pages** generate.
- `npm run test:a11y`: all **79 browser cases** pass against that build, including the
  **5 new onboarding cases**: the dialog at light/320px and
  dark/1440px with no legacy approve action, a reason-required confirmation whose failure
  keeps the dialog open and whose retry reuses the same idempotency key, success gated on
  server readback, and a readback that does not confirm the review keeping the dialog open
  with an error. Axe WCAG A/AA checks are scoped to this slice's dialog surfaces and report
  zero violations; overflow checks pass.

Pre-existing defect observed, not introduced and not fixed here: in dark theme the
Applications queue table behind the dialog uses a fixed light palette (`bg-amber-50/30`
pending rows and the light status badge styles), which axe reports as serious contrast
failures (2.7:1). It belongs to an MDS follow-up for that page; this slice's axe
assertions are scoped to its own surface rather than weakened.

Not run locally: Edge checks and handler tests (no Edge change), the `@visual` screenshot
suite (not a CI gate), and any hosted or dev-server session. Real applicants, operator
decisions, invitations and activation remain authorized operations outside this slice. CI
must confirm all three jobs on the final PR head.

## TRACE-066 — Provider invitation operator interface — 2026-09-12

Verified in the isolated `mercurius-phase5-isolated` stack from the
`codex/phase5-invitation-operations` worktree, base main `f47ac84`. Synthetic fixtures
only. No Auth call, email, invitation, role grant or activation occurred anywhere outside
that local database.

- Clean migration replay and all 24 SQL suites pass: **626 assertions**, of which the new
  `033_phase5_invitation_operations.sql` contributes **44**. It covers operator-only access
  (anon and service role denied at the function grant; a vendor denied by
  `vendor_require_operator`, including for its own provider), the missing-onboarding and
  unknown-provider cases, the pre-preparation state (no attempt, no prior attempts, the
  bound snapshot recipient reported and marked usable, account-link state for both a
  linked and an account-less provider), a stale bound version reported as such while the
  reported version stays the bound one rather than the newest, and each dispatch state in
  turn: prepared and live with a future expiry and no dispatch state; reserved and reported
  as `started` with the attempt at `submitted`; an uncertain result reported as `unknown`
  with no Auth identity; a reconciled result reported as `provider_accepted` with the
  verified identity but still not accepted; and a recipient receipt reported as accepted,
  no longer live, with no account link and no activation. Ranking is covered by a later
  live attempt outranking the newest closed one, which then appears as a prior attempt with
  its identity and closed status intact. Expiry is covered as reported, not enforced: a past
  expiry sets `expired` while the attempt keeps the live slot until it is closed. A row
  fingerprint over attempts, events, dispatches, acceptances, onboarding, contractors and
  roles is asserted unchanged across every readback, and asserted changed only where the
  dispatch command ran, so "read-only" is proved rather than stated.
- `scripts/phase5-concurrency.mjs`, `phase5-payout-concurrency.mjs`,
  `phase5-invitation-concurrency.mjs` and `phase5-onboarding-concurrency.mjs` all pass
  unchanged. The isolated database was reset afterward and the full suite passed again at
  626 assertions. No new concurrency script is added: this slice introduces no write path.
- Fresh database types were generated from the clean isolated schema; the diff is additive
  and contains only `vendor_invitation_overview`.
- Secret scan, lint, TypeScript and all **84 unit tests** pass.
- Production build passes with synthetic public configuration and one build worker; all
  **58 pages** generate.
- `npm run test:a11y`: all **90 browser cases** pass against that build, including the
  **11 new invitation cases**: the panel at light/320px and dark/1440px with the blocked
  legacy invite button absent; an expiry field that starts empty, states that there is no
  default, and keeps preparation disabled for an empty and for a past value; a preparation
  request carrying the operator expiry and a key built from it, whose failure keeps the
  confirmation open and whose retry reuses that same key; success gated on a readback
  showing a prepared attempt; a readback that does not confirm preparation keeping the
  confirmation open with an error; a disabled delivery environment surfaced verbatim with
  the attempt still only prepared; an unknown result offering reconciliation only, gated on
  an exact Auth user ID and sending it verbatim; closure requiring a reason and not offering
  an early expiry; a past expiry offering the expiry closure, an accepted receipt closing the
  attempt and freeing the slot with the earlier attempt listed; and a linked account
  explaining the block instead of offering an action. Axe WCAG A/AA checks over the dialog
  report zero violations.

- Edge gates run locally on pinned Deno 2.9.6: `scripts/check-edge.sh` type-checks all
  **11 locked functions** clean and `scripts/test-edge.sh` passes **44 handler tests, 0
  failures**. This slice changes no Edge source; the gates are recorded as run rather than
  assumed.

Dialog reflow defect found and fixed here (MDS §8). `DialogContent`'s single grid track
was `auto`, and an `auto` track is floored at its items' min-content contribution, so one
intrinsically wide control widens the whole dialog past its content box. The
`datetime-local` expiry control contributes a 271px minimum against a 256px content box,
giving `scrollWidth` 303 against `clientWidth` 288 at 320px. The track is now
`minmax(0,1fr)`: measured after the fix, `scrollWidth` 288 equals `clientWidth` 288 and the
control still renders 222px wide with `scrollWidth` 220, so nothing is clipped and no
function is lost. All 90 browser cases pass with the change, including every other dialog
surface, and this slice's reflow assertion now covers the whole dialog plus the control's
own width rather than being scoped around the defect.

Correction to an earlier reading in this slice: the blowout was first attributed to
`DialogFooter`'s `-mx-4` bleed overflowing a scrollbar. That was wrong. `offsetWidth`
equals `clientWidth` (288), so no scrollbar is present; the footer's bleed only made the
track blowout visible. The cause is grid track sizing, and `min-width:0` on the control
changes nothing.

The TRACE-065 dark-theme contrast defect in the queue table is unchanged and still open.

Not run: the `@visual` screenshot suite. It is not a CI gate and has **no Linux baselines**
— only `-win32` snapshots are tracked — so it cannot compare on this platform. The run
wrote `-linux` actuals, which were deleted rather than committed: adopting baselines is a
separate decision, not a side effect of this slice. No hosted or dev-server session was
run. Real invitations, Auth provisioning, delivery and activation remain authorized
operations outside this slice.

Final-head CI on `2540744` (PR #19, run 34699048634) passed all three jobs: backend 3m23s,
lifecycle 2m58s, application 5m22s. The earlier red checks on PR #19 are the push-triggered
run (34699026121) cancelled by the workflow's concurrency group; all three of its jobs
report `cancelled`, not `failed`. CodeRabbit reported no line-level findings — the
organization's free plan produces a summary and walkthrough only, not a line-by-line
review, so it is not review evidence. Codex code review remains the open gate.

## TRACE-067 — Reviewed existing-account linking — 2026-09-12

Branch `codex/phase5-account-linking`, base main `717877d`, isolated synthetic stack only.
Scope and design decisions are in PHASE-5-ACCOUNT-LINKING.md.

Database: 704 pgTAP assertions across 25 suites pass, 78 of them new. Suite 034 covers
operator-only access for all three functions (anon, `service_role` and a vendor are each
refused before any provider lookup), the missing-onboarding case, and every refusal by
name: absent identity, empty reason, empty key, stale onboarding revision, unknown
identity, unconfirmed account, an identity that is not the reviewed recipient, an
inherited link, a suspended provider, a superseded application version, and a live
invitation. It then asserts the properties the command must *not* have — no vendor role,
no change to the account's existing roles, no activation, no public listing, no
compliance evidence, `vendor_is_eligible` still false — followed by exact replay, two
idempotency-key conflicts, the cross-provider block, the TRACE-063 dispatch gate closing
behind a link, release gating (reason, revision, active provider), re-linking after a
release, and decision immutability. A row fingerprint taken around the readbacks proves
the overview writes nothing.

Suite 001 assertion 18 needed `vendor_account_link_decisions` added to the Phase 5
RPC-only boundary list, as TRACE-065 did for its own table. Assertion 19 then covers the
new table positively: `service_role` holds no direct INSERT/UPDATE/DELETE on it.

Concurrency: `scripts/phase5-account-link-concurrency.mjs`, new and wired into CI after
the onboarding step, proves three races on the isolated stack. Eight different-key
concurrent links of one identity to one provider record exactly once and refuse the seven
losers for a stale onboarding revision, leaving one decision, one event, one revision step
and one binding. Eight same-key concurrent links all succeed, agree on the recorded
decision, and record once. Two providers racing the *same* identity — locking different
contractor rows, so the database's own invariant is the only thing separating them —
produce exactly one binding, and the loser is told the account is already linked rather
than seeing a constraint name. That last assertion proves the outcome and the wording; it
does not isolate which of the two guards fired, the pre-check or the partial unique index.

A clean reset, the four pre-existing concurrency scripts and a replay of all 25 suites all
pass after the committed fixtures.

Application: `npm run lint`, `npm run typecheck`, `npm run scan:secrets` and
`npm run audit:prod` (0 vulnerabilities) pass. 84 unit tests pass. The production build
generates 58 pages. 103 browser cases pass, 13 of them new, including axe at
`wcag2a/2aa/21aa/22aa` and a whole-dialog reflow assertion at 320px in both themes.
`database.types.ts` was regenerated from the isolated stack; the diff is purely additive
(77 added lines, 0 removed).

Two defects this slice surfaced and fixed, both in code it wrote:

`vendor_account_link_overview` returned SQL `NULL` rather than `false` for
`link_reviewed` on an inherited link, because `true and NULL` is `NULL`. A panel reading
it as a boolean would have shown an inherited link as reviewed. Now `coalesce(...,false)`,
asserted directly.

The panel reported "Account status could not be loaded." for every failure, losing the
server's own wording — Supabase rejects with a `PostgrestError`, a plain object, so
`error instanceof Error` is false. The message is now read off the object, which is what
lets the no-onboarding case be explained in place instead of offered a retry button.
`VendorInvitation` has the same `instanceof` pattern on its load path and is unchanged
here; it is worth a look in review but is not this slice's code.

One simplification: `VendorInvitation`'s "Reviewed account" fact was removed. The account
panel now sits directly above it in the same dialog and reports the binding, so keeping
both created two copies of one fact that could diverge. The invitation panel still states
the consequence for invitations in its blocked message.

Corrected during the slice: two assertions were first written as "linking grants no role"
meaning zero `user_roles` rows. That was wrong — the recovered signup trigger gives every
new `auth.users` row a `homeowner` role, so the claim to prove is that linking changes the
account's role set not at all. Both assertions now compare the exact role set before and
after.

Edge gates pass unchanged on pinned Deno: 11 functions type-check clean, 9 handler tests
pass. No Edge, transport, environment or delivery change is in this slice.

Not run: the `@visual` screenshot suite, unchanged from TRACE-066 — it has no Linux
baselines, so it cannot compare on this platform. No hosted or dev-server session was run.
No real account, identity verification, role grant or activation is represented anywhere
in this evidence. Codex code review is the open gate.

Final-head CI on `105a64e` (PR #20, run 34707275907) passed all three jobs: backend 3m23s,
lifecycle 3m09s, application 5m17s, including the new `Concurrent existing-account links`
step, which reported the same three-race PASS in CI as locally. The red checks on PR #20
are the push-triggered run (34707251605) cancelled by the workflow's concurrency group;
all three of its jobs report `cancelled`, not `failed`. CodeRabbit remains a free-plan
summary rather than a line-by-line review, so it is not review evidence. Codex code review
is the open gate.

## TRACE-068 — Vendor role grant at reviewed activation — 2026-09-12

Branch `codex/phase5-activation-role`, base main `8f4ca0d`, isolated synthetic stack only.
Scope, owner decisions and the TRACE-067 ordering fix are in PHASE-5-ACTIVATION-ROLE.md.

Database: 753 pgTAP assertions across 26 suites pass, 49 of them new. Suite 035 covers the
private decision table (authenticated and `service_role` refused), a vendor refused
self-activation, and the full ownership cycle on one provider: no role before activation;
activation grants and records account, link decision and revision; exact replay records
nothing further; suspension and renewal keep the role and record nothing; reactivation
records `already_held` without losing ownership; release withdraws only `vendor`
(`homeowner` kept) and records `revoked`; release replay withdraws nothing further; a new
application revision, relink and activation grant again; an out-of-band removal is
recorded as `already_absent` at release. It then covers `no_account` (activates, grants
nothing, nothing granted by recipient address), `inherited_link` (activates, no promotion),
a pre-held role (`already_held`, not reported as activation-owned, kept on release, no
revoke row), a changed account address and an unconfirmed account (both refuse activation
with no event, revision, status or role change), an incomplete checklist (refused, no role
decision), rejection (no role), no contractor activated or listed, and decision
immutability.

Suite 001 assertion 18 needed `vendor_role_decisions` added to the Phase 5 RPC-only list,
as each prior slice did for its table; assertion 19 then covers it positively.

Found by suite 035 and fixed in this slice: TRACE-067 chose the live link by
`created_at, business_key`. A release and relink in one transaction tied and the release
won on key order, so the relink was reported unreviewed and refused as inherited. Ordering
is now by a new identity column; suite 035 asserts the tied case directly. Suite 034 passes
unchanged.

Concurrency: `scripts/phase5-activation-role-concurrency.mjs`, new and wired into CI after
the account-link step. Eight different-key activations of one linked provider record once
(losers refused for a stale revision) with one grant decision and one `vendor` row; eight
same-key activations all succeed, agree on the revision, and record one grant; a
reactivation racing a release of the same suspended provider applies exactly one, refuses
the other for a stale revision, and leaves the matching role state. That race exercises one
ordering per run (reactivation won locally); both outcomes are asserted deterministically in
suite 035. The five pre-existing concurrency scripts pass unchanged, and a clean reset and
replay of all 26 suites pass after the fixtures.

Application: `npm run lint`, `npm run typecheck`, `npm run scan:secrets` and
`npm run audit:prod` (0 vulnerabilities) pass. 84 unit tests pass. The production build
generates 58 pages. 107 browser cases pass, 4 of them new: the activation-granted role
state with axe (`wcag2a/2aa/21aa/22aa`) and dialog reflow at dark 320px and light 1440px,
the release confirmation stating withdrawal, and a pre-held role kept on release. One
existing assertion changed with its copy ("holds no vendor role yet"). Edge type check and
44 Edge handler tests pass; no Edge code changed. `database.types.ts` was regenerated from
the isolated stack; the diff is purely additive (57 lines).

Not performed: hosted/production verification, real accounts, manual screen-reader review,
and CI on the final head (not yet pushed). Codex code review is the open gate.

## TRACE-069 — Activation checklist and onboarding decisions — 2026-09-12

Branch `codex/phase5-onboarding-decisions`, stacked on TRACE-068 (`51a9fcc`), isolated
synthetic stack only. Scope and decisions are in PHASE-5-ONBOARDING-CHECKLIST.md.

Database: 811 pgTAP assertions across 27 suites pass, 58 of them new. Suite 036 covers
operator-only access to both functions (anon, `service_role` and a vendor refused), the
raw `vendor_record_evidence` refused to clients, the missing-onboarding case, and a
nine-item missing readback in MPS §8 order with its documents, no account and no role
decision, fingerprinted as writing nothing. Refusals by name: blank key, unknown item,
blank requirement version, blank reference, missing review time, future review time,
already expired evidence, a license document outside the application, free-text
insurance, license without expiry, a rejected provider and a superseded application
version — all proven to write nothing. It then covers recording, trimmed storage, exact
replay, two key conflicts, the stale-supersede guard and supersession, a named call
omitting optional arguments, document-bound license and insurance, a full checklist that
changes no status, revision, eligibility or role and is not reported as scoped compliance,
the readback after a reviewed link and activation (status, `granted` role outcome, role,
newest event first), `expired` and `superseded_version` item states, and private,
append-only request rows.

Suite 001 needed `vendor_checklist_evidence_requests` added to the Phase 5 RPC-only list.

Concurrency: `scripts/phase5-checklist-evidence-concurrency.mjs`, new and wired into CI
after the activation step. Eight different-key records of one item record once and refuse
the rest for a stale evidence version; eight same-key records all succeed, agree on the
evidence ID, and write one evidence row and one request; no onboarding status or revision
changes. `scripts/phase5-activation-role-concurrency.mjs` now writes fixture evidence as
the database owner, since the raw kernel is no longer a client command. All seven scripts
pass, and a clean reset and replay of all 27 suites pass after the fixtures.

Application: `npm run lint`, `npm run typecheck`, `npm run scan:secrets` and
`npm run audit:prod` (0 vulnerabilities) pass. 84 unit tests pass. The production build
generates 58 pages. 121 browser cases pass, 14 of them new: the panel at light 320px and
dark 1440px with axe (`wcag2a/2aa/21aa/22aa`) and dialog reflow; document-only license
entry with required, future expiry and no defaults; the payout bank-detail warning; the
sent payload and one replayed key on retry; readback-gated recording; supersession
naming the current evidence; activation stating the role outcome, sending the read-back
revision and key, and confirming by readback; activation with no reviewed account; an
unconfirmed decision keeping the confirmation open; the actions offered to active,
suspended and rejected providers; and the superseded-revision block.
`database.types.ts` was regenerated; the diff is purely additive (74 lines). No Edge code
changed; Edge gates were not rerun for this slice.

Found and fixed: the first command draft had no defaults for the optional arguments the
panel omits, so a real PostgREST call would not have resolved. Now defaulted and asserted.

Not performed: hosted PostgREST round-trip, real documents or accounts, manual
screen-reader review, CI on the final head. Codex code review is the open gate.

## TRACE-070 — Accepted-invitation account binding — 2026-09-12

Branch `codex/phase5-invitation-binding`, based on `20f0a4c` (TRACE-069; PR #23 carries it
to `main`), isolated synthetic stack only. Scope and decisions are in
PHASE-5-INVITATION-BINDING.md.

Database: 883 pgTAP assertions across 28 suites pass, 72 of them new (60 in the first
draft, 12 for the recovery fix). Suite 037 builds
every receipt through the real TRACE-063 prepare/claim/finish/accept commands, then
covers: a signed-in non-operator, the recipient itself, `anon` and `service_role`
refused, the replay helper not client-executable; refusals by name for a blank reason,
a missing attempt, a stale revision, a provider with no onboarding, another provider's
receipt, an unknown attempt, an unconfirmed account and a changed account address, all
proven to write nothing; the overview reporting the receipt, current version and
unbound state; the binding (account, receipt, revision, one `invited_account_bound`
event, `link_source`, `link_reviewed`, checklist `account_reviewed`, no role, no status
change); exact replay, a reason conflict, and the binding and stated-identity keys
refused as each other's replays; the same receipt bound twice; activation granting
`vendor` through the unchanged TRACE-068 path and naming the binding; release withdrawing
it with no receipt on the release row, and a release key refused as a binding replay;
a suspended provider refused; a moved address and an account linked elsewhere refused;
a live newer attempt blocking until closed; a legacy `accepted` status with no receipt
refused and not reported; a superseded application revision refused both before and
after onboarding is rebound; a fingerprint over contractors, decisions, events, roles
and onboarding proving the overview writes nothing; no listing; decision immutability;
and the check constraint refusing a receipt on a release row.

Recovery fix: suite 037 adds re-invitation of an accepted recipient refused at
preparation with no attempt recorded, the invitation readback reporting
`recipient_account_id`, a pre-existing attempt refused at dispatch with nothing reserved,
and the superseded-receipt recovery end to end (re-invitation refused, link by account
ID recorded as `stated_identity`, activation granting `vendor`). Suites 031 and 033 had
re-invited an accepted recipient; 031 now asserts that refusal and runs its revocation
and staleness cases against a second, never-accepted provider, and 033 asserts the
refusal and readback and records its later live attempt directly to keep testing
readback ordering. No prior assertion was removed. Effective execute privileges on
`vendor_prepare_invitation`, `vendor_claim_invitation` and `vendor_invitation_overview`
were captured before the change and are identical after it; the new helper is not
executable by `anon`, `authenticated` or `service_role`.

Concurrency: `scripts/phase5-invitation-binding-concurrency.mjs`, new and wired into CI
after the checklist step. Eight different-key bindings of one receipt record once and
refuse the rest for a stale revision; eight same-key bindings all succeed, agree, and
record once; four invitation bindings racing four stated-identity links for one provider
record exactly one decision of the winning path. No race grants a role or lists a
provider. All eight scripts pass in CI order, and a clean reset and replay of all 28
suites pass afterward.

Found and fixed during verification: the first draft of the script reused the
`ca000000-` fixture prefix of `phase5-activation-role-concurrency.mjs`, so whichever
ran second failed its reset guard. It now uses `cc000000-`.

Application: `npm run lint`, `npm run typecheck`, `npm run scan:secrets` and
`npm run audit:prod` (0 vulnerabilities) pass. 84 unit tests pass. The production build
(with CI's synthetic public environment) generates 58 pages. 134 browser cases pass, 13
of them new: the receipt panel at light 320px and dark 1440px with axe
(`wcag2a/2aa/21aa/22aa`) and dialog reflow; no receipt offering no action; the sent
payload carrying the receipt and no identity, with one replayed key on retry;
readback-gated success reporting the invitation source and decision; a stated-identity
readback not confirming the binding; superseded, unconfirmed and changed-address receipts
explained rather than offered; a live invitation blocking in place; and, for the recovery fix, a superseded receipt
directing the operator to link by account ID with "Use this account ID" filling the form
without submitting it, no shortcut for an unverifiable receipt, and the invitation panel
refusing to re-invite a recipient who holds an account.
`database.types.ts` gains only this slice's column and command, taken from
`supabase gen types` against the migrated stack (20 lines). No Edge code changed; Edge
gates were not rerun.

Not performed: hosted PostgREST/Auth round-trip, real invitations or accounts, manual
screen-reader review, CI on this branch. Codex code review is the open gate.

## TRACE-063 forward fix — Definite Auth refusal recorded as failed — 2026-09-12

Branch `codex/phase5-auth-refusal`, based on `main` `26900eb`, isolated synthetic stack
only. Scope and decisions are in PHASE-5-INVITATION-REFUSAL.md.

Characterization: through the locked admin client against the isolated local Auth, a
confirmed existing account returned `AuthApiError` 422 `email_exists` with no user; an
unconfirmed one was re-invited as the same user; an invalid address returned 400
`validation_failed`. Synthetic probe accounts were deleted.

Database: 936 pgTAP assertions across 29 suites pass, 53 of them new in suite 038: the
receipt guard not seeing an account from elsewhere; the command not executable by `anon`
or `authenticated` and refused for a null or non-operator actor, an unsupported or null
code, and an undispatched attempt, with nothing written; the handler report recording
dispatch and attempt `failed`, no identity, one event naming the operator, and replaying;
a late unknown report not reopening it, an identity refused on it, closure not re-closing
it, and both check constraints; the overview and status reporting the refusal; no link,
activation or vendor role; linking the existing account by ID then succeeding; for an
attempt already `unknown`, reconciliation still refused, a bare report refused, and
missing, other-address, unconfirmed, confirmed-at-or-after-dispatch and
invited-at-or-after-dispatch accounts refused with nothing written, then a pre-existing
account recording `failed` naming it, exact and bare replays, a different account
conflicting, and the slot freed for a new preparation; a `provider_accepted` dispatch
refused. Effective execute privileges on the three replaced functions were captured before
and after and are identical.

Concurrency: `scripts/phase5-invitation-refusal-concurrency.mjs`, new and wired into CI
after the binding step. Eight duplicate refusal reports record once; four refusal reports
racing four unknown reports end in exactly one consistent outcome (a refusal never lands
on an unknown outcome); four corroborated refusals racing four reconciliations with the
same pre-existing account record one failure and no identity. No race links, activates or
grants a role. Passed three consecutive runs with resets, then all nine scripts passed in
CI order, followed by a clean reset and replay of all 29 suites.

Edge: `scripts/check-edge.sh` passes; `scripts/test-edge.sh` passes for every function,
`vendor-invite` 13 cases with 4 new: the `422 email_exists` refusal recorded once and
never as unknown; a failed refusal write falling back to unknown without a retry; 422
`validation_failed`, 500 `email_exists` and 429 staying unknown; the `refuse` action
reading the exact account by ID, requiring it, reporting an unproven refusal, and never
calling the invite API.

Local round-trip: the real `vendor-invite` handler under Deno 2.9.6 in local-test mode,
against the isolated Auth and database with a synthetic operator and a synthetic confirmed
"homeowner" account: send returned 409 `INVITATION_RECIPIENT_HAS_ACCOUNT` and the database
held `failed|email_exists|failed`; a new preparation then succeeded; a claimed attempt
forced to `unknown` was refused by `reconcile` (409) and recorded by `refuse` (200) as
failed naming the account. The script's final string comparison was written wrongly
(`t` for `true`) and reported a failure after the values printed matched; the database
was reset afterwards.

Application: `npm run lint`, `npm run typecheck`, `npm run scan:secrets` and
`npm run audit:prod` (0 vulnerabilities) pass. 84 unit tests pass. The production build
(with CI's synthetic public environment) generates 58 pages. 139 browser cases pass, 5
new: the refused attempt at light 320px and dark 1440px with axe
(`wcag2a/2aa/21aa/22aa`) and reflow, explaining the refusal, naming the account and
offering only preparation; the unknown attempt's "Record Auth refusal" gated on an exact
ID with the `refuse` payload and readback-gated success; an unproven refusal keeping the
confirmation open and the attempt unknown; and a refused send reporting the refusal and
reading back the failed attempt. A full `playwright test` run also executed the six
`@visual` cases CI excludes; they failed only because no Linux baselines exist, and the
baselines that run wrote were removed. `database.types.ts` gains only this slice's columns
and command, from `supabase gen types` against the migrated stack.

Not performed: hosted Auth/PostgREST round-trip, real invitations or accounts, manual
screen-reader review, CI on this branch. Codex code review is the open gate.

## TRACE-071 — Hosted invitation delivery mode — 2026-09-12, revised 2026-09-13

Branch `codex/phase5-hosted-invitation-delivery`, based on `main` `6bdcff3`. Scope,
decisions and the hosted arming runbook are in PHASE-5-HOSTED-INVITATION-DELIVERY.md.
No hosted project, secret, Auth setting, deployment or real address was touched. The
2026-09-13 owner decisions (3-hour email link lifetime, a scanner-proof recipient link,
MTS environment entries) are implemented and re-verified below.

Edge: `scripts/check-edge.sh` passes for all 11 functions; `scripts/test-edge.sh` passes
for every function, `vendor-invite` 15 cases. The former "disabled and hosted modes never
reach Auth" case is rewritten as a table of 20 configurations that must each return
`503 INVITATION_DELIVERY_DISABLED` with no network call: unset, unknown mode, local-test
against a hosted project or site, hosted missing either pin, another project, a malformed
ref, a nonstandard project port, HTTP, a custom Auth domain, a local stack, a preview site,
an HTTP site, a site path, query or port, a pin with a trailing slash, a loopback site and
an IP site. Two new cases: pinned hosted mode claims, invites the snapshot recipient with
redirect `https://<pinned site>/set-password?invitation=<attempt>` and
`data.invitation_attempt` while ignoring caller `email`/`origin`/`redirect_to`, and records
the receipt; and hosted mode keeps the `422 email_exists` refusal (recorded failed) and
lost-response (recorded unknown, no retry) contracts. Both send cases assert the invite
metadata the template reads. The unchanged local-test cases still pass.

Guard mutation check: each of the 12 conditions in `delivery.ts` (project hostname, site
origin match, pin-is-origin, loopback, IP literal, site port, ref format, project port,
path, query, protocol, and the hosted branch itself) was disabled in turn; every mutant
failed the suite. The first pass left the ref-format, project-port and query guards
uncovered; cases were added until each mutant failed. The module was restored and compared
byte-for-byte.

Local Auth round-trips: a separate throwaway stack (Supabase CLI 2.116.0, project
`mercurius-trace071-auth`, no migrations or data) started from this branch's
`config.toml` and template; synthetic users were deleted and the stack stopped without a
backup after each run. Tokens and links were not printed.

1. First design (`{{ .ConfirmationURL }}`, allowlist-dependent): the stack's non-secret
   GoTrue environment differed from the existing isolated stack only in the invite
   subject, invite template and allowlist. Four invitations: the allowlisted
   `/set-password?invitation=<id>` landed intact; a redirect on the Site URL's own host
   landed intact without an allowlist entry; a non-allowlisted path and a hostile origin
   both fell back to the Site URL root, dropping the attempt ID.
2. Template probe: `{{ .RedirectTo }}` is the Auth-validated redirect — the hostile origin
   was replaced with the Site URL — and `{{ .TokenHash }}` is available. Appending to
   `{{ .RedirectTo }}` was therefore rejected: the fallback has no query string, so the
   rendered link was malformed (observed as an invalid URL).
3. Final design (`{{ .SiteURL }}` + `{{ .Data.invitation_attempt }}` + `{{ .TokenHash }}`):
   `GOTRUE_MAILER_OTP_EXP=10800` confirmed in the container. Three invitations —
   allowlisted, non-allowlisted and hostile-origin requested redirects — each produced the
   same well-formed link to `http://localhost:3000/set-password` carrying the attempt,
   `type=invite` and a token hash, never Auth's verify URL, so a requested redirect can no
   longer influence the recipient's link. Every email carried the reviewed subject, no
   unrendered placeholder or remote asset, the non-activation statement, and the same link
   in the button and the fallback address. The attempt was stored as invite metadata.
   Scanner simulation: a GET of the link caused no Auth request and no additional mail;
   the recipient's `verifyOtp` POST then returned a session with the email confirmed, and
   an immediate reuse was refused with `otp_expired`.

Application: `npm run scan:secrets`, `npm run lint`, `npm run typecheck`,
`npm run audit:prod` (0 vulnerabilities) and 84 unit tests (including the Edge function
contract) pass. No application, migration or browser-facing code changed, so the SQL
suites, concurrency scripts, build and browser suites were not re-run. `/set-password`
already handled `token_hash` with `type=invite`, so the new link uses an existing,
browser-tested path.

Not performed: hosted SMTP/Auth/gateway round-trip, a real invitation or mailbox, the
hosted refusal contract, a full isolated-stack start from `prepare-phase5-local.mjs` (the
script was run and copies `supabase/templates`; the same CLI version loaded the template
in the throwaway stack), CI on this branch. Codex code review is the open gate.

## TRACE-072 — Compliance expiry queue and renewal notices — 2026-09-13

Branch `codex/phase5-evidence-renewal`, based on `main` `d307ba0`, isolated synthetic
stack only. Scope and decisions are in PHASE-5-EVIDENCE-RENEWAL.md.

Database: 970 pgTAP assertions across 30 suites pass, 34 of them new, after a clean reset
and replay. Suite 039 covers access (anon and `service_role` refused both readbacks, the
private selection refused to clients, a vendor refused the operator queue, a non-vendor
account refused vendor notices); the 30-day window with the transaction-fixed clock
(evidence at exactly 30 days listed, 30 days plus one second not); lapsed and expiring
states, soonest expiry first; review and rejected providers excluded; a replaced lapsed
item not listed beside its replacement; a suspended provider listed with its status;
eligibility false for a lapse and true while only expiring; no evidence references in the
queue; a lapsed provider still `active` at the same revision; checklist `renewal_due`
(inside the window, outside it, no expiry, lapsed, and under review) and
`renewal_notice_days`; vendor notices limited to the caller's provider with only item,
expiry and state, a lapsed notice, and an empty list for a vendor without a provider;
a state fingerprint proving every readback wrote nothing; and renewal through the
existing checklist command removing the entry, restoring eligibility, and a `renew`
decision keeping the provider active at the next revision. Suite 036 passes unchanged
against the replaced checklist readback.

Mutation check: changing the window comparison from `<=` to `<` in the migration failed
three suite 039 assertions; the migration was restored and the full replay passes.

Concurrency: no write command was added. The checklist evidence, activation role, account
link and invitation binding scripts were re-run against this branch and pass.

Application: `npm run lint`, `npm run typecheck`, `npm run scan:secrets` and
`npm audit --omit=dev` (0 vulnerabilities) pass. 95 unit tests pass, 11 of them new
(day wording at hour boundaries, never "0 days" left, unreadable dates, labels). The
production build, with the CI synthetic public variables, generates 59 pages including
`/admin/compliance/renewals`. 150 browser cases pass, 11 of them new: the queue at light
320px and dark 1440px with axe (`wcag2a/2aa/21aa/22aa`), no page overflow and the
sidebar marking only Compliance Expiry current; provider links, next actions and the
Lapsed filter; the strict-matching rebinding step shown only for license and insurance;
empty and error-with-retry states; the checklist "Renewal due" badge with axe; the vendor
lapsed notice at light 320px and dark 1440px with axe and no overflow; the expiring
notice; and no notice when there is nothing to renew or the readback fails.
`database.types.ts` was regenerated; the diff is two added function signatures. Existing
vendor and admin browser cases are unchanged: the fixture's default 503 for the new
vendor readback exercises the silent path. Screenshots were reviewed; table status pills
were set not to wrap.

Payout forward fix (owner decision 2026-09-13, migration `20260913002000`): 987 pgTAP
assertions across 30 suites pass after a clean reset and replay, 17 more than above.
Suite 039 asserts `private.vendor_payout_eligible` directly: a lapsed license keeps payout
eligibility while `vendor_is_eligible` is false; current, suspended, review, rejected,
lapsed payout onboarding (and the same evidence before its lapse), a superseded
application version, and client access refused. Suite 020 asserts through the live
`money_payable`, inside savepoints so its later batch is unchanged: lapsed license and
insurance still pay 7800, then lapsed payout onboarding and suspension each refuse with
`Vendor onboarding hold`. Suite 027 asserts a replacement with a lapsed license still
reconciles as payee and one with lapsed payout onboarding refuses with
`Replacement vendor onboarding hold`, also rolled back. With the forward-fix migration
removed from the isolated copy, suites 020, 027 and 039 each fail on the old holds; the
restored replay passes. All nine concurrency scripts pass in CI order, including payout
and provider-refund, followed by a clean replay.

Wording now says a lapse removes matching and holds payouts only for payout onboarding.
Lint, typecheck, build (59 pages), 95 unit tests, secret scan and 0 audit findings pass.
Browser: 152 cases, 13 in the renewal spec (2 new: payout note only for lapsed payout
onboarding, in the queue and the vendor notice). One full run had a single failure in the
unrelated `mds.spec.ts` "sheet and dialog close on Escape and restore trigger focus"; it
passed in the previous full run and 3 of 3 isolated reruns, recorded as a timing flake.

Not performed: hosted PostgREST round-trip, real providers or documents, manual
screen-reader review, CI on this branch. Codex code review is the open gate.

## TRACE-073 — Renewal documents bound to the provider — 2026-09-15

Branch `codex/phase5-renewal-documents`, based on `main` `0d761f3`, isolated synthetic
stack only. Scope and owner decisions are in PHASE-5-RENEWAL-DOCUMENTS.md.

Baseline before change: 987 pgTAP assertions across 30 suites passed after a clean reset.

Database: 1071 pgTAP assertions across 31 suites pass after a clean reset and again after
the post-concurrency replay; 84 are new in suite 040. It covers the removed anonymous
policy (policy absent; anonymous and signed-in direct inserts refused); access (anon and
`service_role` refused, private helpers and both tables closed to clients, non-vendor,
unlinked vendor and vendor-naming-a-provider refused, review and unknown providers
refused, suspended provider and operator allowed); submission (missing object, another
provider's path, an application path, another item, a stored disallowed type, an object
over 10 MB, name/type/size taken from storage, same-submitter replay, another submitter
refused, operator on behalf); a state fingerprint proving submissions and declines change
no evidence, request, onboarding status or revision, application version, role or listing;
the five-undecided limit per item on both authorization and submission, freed by a
decline; decline (operator only, key and note required, unknown document, trimmed note,
exact replay, changed-note conflict, already decided); acceptance through the checklist
command (declined, wrong item, other provider and missing expiry refused; accepted as
current license evidence no longer due; exact replay; accepted again refused; application
documents still accepted; one decision naming the evidence under the request key; no
status, revision or application version change; eligibility kept); a stale acceptance
writing neither decision nor evidence; operator overview and queue contents; vendor
readbacks limited to the caller with no path, evidence or reviewer and with the decline
note; readbacks writing nothing; immutability and both table check constraints.
Suite 001's Phase 5 RPC-only table list gains the two new private tables, as earlier slices
did. Suite 036 passes unchanged against the replaced checklist command.

Mutation check: removing the decided check on acceptance, the open limit, the provider path
check or the stored-type check each failed suite 040 (2, 2, 1 and 1 assertions); restored
functions pass all 84.

Concurrency: new `phase5-renewal-document-concurrency.mjs`, wired into CI after the refusal
script: eight same-path submissions record once; eight different paths stop at exactly five;
an eight-way race of four acceptances and four declines records exactly one decision with
matching evidence rows and no onboarding change. Standalone runs saw both outcomes (accept
three times, decline once). All ten scripts pass in CI order, followed by a clean replay.
A first CI-order run failed because the new script's fixture IDs collided with the
invitation-binding script's; the prefix was changed and the sequence re-run.

Round trip (local only, not committed): `next dev` against the isolated stack with local
Auth and Storage, synthetic `example.invalid` accounts, 22 checks pass — 401/403/400 route
refusals; a vendor grant at the expected path; direct signed upload; submission recorded with
type and size read from Storage metadata; replay; another submitter refused; vendor cannot
read or upload directly; anonymous `applications/` upload refused by Storage; a type-lying
upload never becomes a submission; missing object refused; operator upload on behalf and
signed-link read of the submitted bytes; decline and acceptance through PostgREST named
arguments; eligibility restored with the provider still `active` at the same revision and one
application version; vendor readback of states and note without private fields. The owner
notification ran once, for the provider submission only, and logged the missing Resend
configuration; no email was sent.

Application: `npm run lint`, `npm run typecheck`, `npm run scan:secrets` and
`npm audit --omit=dev` (0 vulnerabilities) pass. 101 unit tests pass, 6 new (path shape
against the database pattern, extension from verified type, long and non-Latin names,
identifier refusal, kind guard, sizes). The production build with the CI synthetic public
variables generates 62 routes including `/vendor/compliance` and both API routes. 167
browser cases pass, 15 new: vendor page at light 320px and dark 1440px with axe, no overflow
and the sidebar entry current; the three-step upload with exact request shapes and readback
confirmation; server refusal shown; wrong file type refused before any request; the limit
message; closed uploads with Contact; load error with retry; operator section at light 320px
and dark 1440px with axe and no dialog overflow; decline requiring a provider note with the
request shape; acceptance via grouped document options with the acceptance consequence and
request shape; operator upload request shape; no upload under review; and the Compliance
Expiry awaiting-review list at 320px and 1440px with axe. Existing specs were updated for the
document label, the notice's upload link and wording, and a sidebar-scoped absence check.
`database.types.ts` was regenerated; the diff is additive only. Screenshots were reviewed.

Not performed: hosted round trip, CI on this branch, real providers or documents, email
delivery, manual screen-reader review. Codex code review is the open gate.

## TRACE-074 — Retention of declined renewal documents — 2026-09-15, completed 2026-09-16

Branch `codex/phase5-renewal-retention`, implemented on TRACE-073 `819b468` and rebased onto
`main` `bbb0482` after PR #29 merged (main added only editor and agent-navigation files, so
the results below stand); isolated synthetic stack only. Scope and owner decisions are in PHASE-5-RENEWAL-RETENTION.md.

Baseline before change: 1071 pgTAP assertions across 31 suites (TRACE-073 evidence).

Database: 1182 pgTAP assertions across 32 suites pass after a clean reset and again after the
post-concurrency replay; 111 are new in suite 041. It covers the quarantine bucket (private,
named by no storage policy; an operator client cannot list, write or move a file into it);
access (anon and `service_role` refused, helpers and both tables closed to clients, a vendor
refused on every command and the queue, the vendor readback unchanged); the queue before any
step (due at exactly 90 days and not one second earlier, quarantined list, file location
including a file removed outside the workflow, window end dates, reported periods, no holds;
reading writes nothing); prepare refusals (inside the window, undecided, accepted, unknown
document and action, reason and key required, restore or delete of a retained document,
deletion one second short of 14 days) and prepared buckets, with preparing writing nothing;
record (not before the move, missing file, window re-checked, changed size in quarantine, a
file in both buckets, then recorded; exact replay; changed reason, other document and other
operator conflict; no second quarantine; overview and queue reflect it); deletion (not while
the file exists, period re-checked even after an early removal, recorded, terminal, one
deletion per document); restore (not before the file is back, recorded, due again,
re-quarantine allowed); holds (reason, key and onboarding required, nothing to release, place,
replay, key reuse conflict, no second hold, queue and overview report it, quarantine and
deletion refused for every document of the provider, a completed quarantine and a completed
deletion recorded under hold, restore allowed, release, no second release, periods open again,
re-placement); undecided and accepted documents carry no retention fields; a fingerprint
proving no submission, decision, evidence, status, revision, application version, role or
listing changed; immutability and check constraints. Suite 001's Phase 5 RPC-only table lists
gain the two new private tables, as earlier slices did.

Mutation check (local harness, not committed): the 90-day and 14-day boundaries (`>` to `>=`),
the prepare hold refusal, the completed-step hold exception, the quarantine size check, the
deletion storage check, the latest-hold-event rule and the replay actor check each failed suite
041; restored functions pass all 111. A first harness run under-counted because psql's aligned
output hid TAP lines and aborted transactions went to stderr; it was corrected before these
results.

Concurrency: new `phase5-renewal-retention-concurrency.mjs`, wired into CI after the renewal
document script: eight same-key records of one quarantine write once; eight distinct-key
records across two operators write once; a four-hold/four-record race yields exactly one hold
and one quarantine; eight prepares under hold are all refused. All eleven scripts pass in CI
order, followed by a clean replay. An assertion comparing transaction IDs to infer commit order
was removed as unsound (IDs are assigned when a lock wait starts); suite 041 asserts
`under_hold` deterministically.

Round trip (local only, not committed): `next dev` against the isolated stack with local Auth
and Storage, synthetic `example.invalid` accounts and synthetic bytes; past decline and
quarantine times are fixture rows. 32 checks pass — 401/403/400 refusals; a 10-day-old decline
refused and unmoved; quarantine byte-for-byte in the quarantine bucket; replay without moving;
operator client can neither open the quarantined file nor reach or remove from the quarantine
bucket; deletion refused inside 14 days; restore with identical bytes readable again;
re-quarantine; permanent deletion after 15 days leaving neither bucket holding the file; replay;
no restore after deletion; hold through the API refusing quarantine (nothing moved) and
deletion; an unrecorded move shown by storage location, then recorded under hold on retry;
release reopening quarantine; overview states; vendor readback without retention or storage
fields; one ledger row per confirmed step; no decision, status, revision or application version
change. Local Storage (v1.70.3) confirmed the cross-bucket move; the route logged the expected
404 warning on the interrupted-move retry.

Application: `npm run lint`, `npm run typecheck`, `npm run scan:secrets` and `npm run
audit:prod` (0 vulnerabilities) pass; `git diff --check` is clean. 108 unit tests pass, 7 new
(storage step per action, action mismatch, no deletion from document storage or foreign
buckets, renewal paths only, action mapping, days until deletion). The production build with the
CI synthetic public variables generates 64 routes including `/admin/compliance/retention` and
the retention API route. Browser: 175 of 182 cases pass, including all 9 new (queue at light
320px and dark 1440px with axe, no overflow and the sidebar entry current; quarantine with
required reason, request shape and reread confirmation; deletion warning and refusal kept open;
an unconfirming reread reported; hold release; load error with retry; checklist retention badges
with Open only for retained files, with axe; hold placement from the checklist confirmed by
reread). The 7 failures: six `@visual` cases with no Linux baselines (pre-existing; generated
Linux images were discarded) and the TRACE-073 operator-upload case failing at teardown with a
mocked fetch still in flight. Rerunning the renewal-documents, retention and evidence-renewal
specs three times each: 110 of 111 pass, the upload case 3/3; one TRACE-072 queue case failed
once on axe contrast of the Refresh button captured while disabled during load, passing the
other two runs (this slice does not change that page). `database.types.ts` was regenerated; the
diff is additive only. Edge gates were not re-run (no Edge change).

Not performed: hosted deployment or round trip, CI on this branch, real providers or documents,
manual screen-reader review. Codex code review is the open gate.

## TRACE-075 — Finance reconciliation readback — 2026-09-16

Branch `codex/phase5-finance-reconciliation`, base `main` `d422816`; isolated synthetic stack
only. Scope and decisions are in PHASE-5-FINANCE-RECONCILIATION.md.

Baseline before change: 1182 pgTAP assertions across 32 suites (TRACE-074 evidence).

Database: 1295 pgTAP assertions across 33 suites pass after a clean reset; 113 are new in suite
042. It covers access (no user, homeowner and admin without finance authority refused; the
private row builder closed to clients; no anon grant); a clean full payment (capture counter,
attempts and journals, 15% fee excluding tax and tip, 85% plus tips proceeds, payable ledger,
eligible funds, no customer identity returned); deposit only; the 48-hour window with its
eligibility time; no confirmation; a partial refund pending, prepared and settled (fee and
proceeds on retained amounts, tax liability, hold released); Stripe readback mismatch, match,
reviewed resolution; a weekly ACH statement through prepared, submitted, unknown, failed, retry,
settled and returned (payable and bank ledgers, no bank reference anywhere in the readback);
a chargeback open, lost and allocated (suspense, clearing, retained fee); payout hold,
suspension, a flagged checkout, a failed capture event linked to its obligation, and an
unsupported event holding every payout; funds-state parity with `money_payable` for every
unscheduled fixture; ledger-wide debits equal credits; the readback writes no completion
evidence; and detection of a stray fee transfer, drifted capture and refund counters, a payout
posted without settlement and a missing earnings journal (tampering rolled back).

Mutation check (local harness, not committed, functions replaced on the running synthetic
database and restored): fee rate, payout onboarding hold, 48-hour window, global event hold,
finance authority check, bank ledger sign, unknown bank outcome treated as paid, pending refund
hold, refund counter check, chargeback hold, provider payable check and a bank reference leak
each failed suite 042; the restored functions pass all 113.

Concurrency: no script added; the slice adds only a stable read function and no write path.
Existing scripts were not re-run because no kernel they exercise changed.

Application: `npm run scan:secrets`, `lint`, `typecheck` pass; 115 unit tests (7 new); build
with CI's synthetic public variables (`/admin/finance` static); `audit:prod` 0 findings;
generated database types differ only by the new RPC. Browser: 184 cases pass, including 8 new
finance cases (light 320px and dark 1440px with axe and reflow, filters and payout detail,
global event banner, empty ledger, permission state, retry, truncation). The 6 `@visual` cases
fail for lack of Linux baselines, as in earlier slices; the auto-written Linux snapshots were
deleted, not adopted. Screenshots were reviewed; a mid-word wrap in exception detail was fixed
before the final run.

Not performed: CI, hosted or Stripe/bank verification, human screen-reader review.

## TRACE-076 — Finance operator command gateway, part 1 — 2026-09-17

Branch `codex/phase5-finance-commands`, base `main` `3f98939`; isolated synthetic stack only.
Design, scope and decisions G1–G9 are in PHASE-5-FINANCE-COMMANDS.md. Owner decision
2026-09-16: the global unsupported-event payout hold is kept.

Baseline before change: 1295 pgTAP assertions across 33 suites (TRACE-075 evidence).

Database: 1427 pgTAP assertions across 34 suites pass after a clean reset (and again as CI's
clean replay after the committed concurrency fixtures); 132 are new in suite 043.
Suite 043 runs the commands on the `authenticated` role and covers: grants (gateway callable,
kernels and refund readback functions service-only, no gateway function takes an actor or
approver); access (no user, homeowner and admin without finance authority refused, including a
browser call to the hold kernel with another operator as actor); hold placement (validation,
session actor, key replay, conflicts including another operator's key, payout stopped, refusal on
an ACH statement); hold release (evidence required, unsupported/malformed/unknown subjects,
canonical subject replay, no execution without approval, no self-approval through the gateway
or the kernel, an approval of a different reason not counting, admin without authority refused,
approver cannot execute, an approver who lost authority no longer counting, execution replay,
kernel and gateway audit rows, payout payable again, immutability, completed hold refused);
readbacks (validation, mismatch opens the hold, attribution, replay and amount/evidence
conflicts, mismatch and superseded readbacks not resolvable, recorder cannot approve even
through a direct kernel approval, a third operator approves, an approved resolution going stale
when money moves, resolution clears the hold); events (unfailed and processed events not
excludable, replay validation and attribution, the unsupported event holding every payout
until a two-person exclusion lifts it, excluded event not replayable, an event with ledger
effects not approvable); refund readback functions (finance authority, no attempt created by
the target read, not sent, not found, found with Stripe status, known reference not overwritten,
amount mismatch refused by the kernel, Stripe success not settling, attribution, send permission
per author/approver, no operator identities returned).

Mutation check (local harness, not committed; each function replaced on the running synthetic
database and restored): requester approving own command, recorder approving a resolution,
recorder approval counted at execution, approver executing, approver without authority counted,
hold on an ACH statement, another operator replaying a hold key, replay of a processed event,
outdated readback resolvable, event with effects excludable, operations without finance check,
refund target without finance check, not-found overwriting a known refund reference, and readback
replay ignoring evidence. On the first run the approver-authority and readback-evidence mutants
survived; three assertions were added, and all 14 then failed suite 043. Restored functions pass
all 132.

Concurrency: new `scripts/phase5-finance-command-concurrency.mjs`, wired into CI after the
retention script. As separate signed-in sessions: five same-key hold placements make one hold;
two approved releases of one hold, one held open by a sleeping executor, make one release and one
execution (the others refused as completed); four same-key readbacks make one attributed
observation; a resolution racing a new mismatching readback never leaves the hold closed; three
executions of one approved exclusion make one exclusion; no other event changed and no journal was
posted. Its first run found that a late readback committed between the gateway check and the
kernel lock surfaced as a raw kernel refusal; execution now locks the kernel's row before
checking. After the fix it passed three times on fresh resets (a fourth run was lost when the
session ended) and once more after the eleven existing scripts in CI order, all twelve passing on
a clean reset; both race-4 orderings were observed (resolution first once, readback first three
times).

Edge: all 11 functions type-check on Deno 2.9.6; 57 handler cases pass, including 7 new
`refund-invoice` cases (send actor from the verified token despite body fields, finance refusal
with no Stripe call, unsent refund, retrieval by reference recorded for the verified user,
not-found recorded from a payment's refund list, a refund for another payment recorded nothing,
unknown action refused before lookup).

Application: `scan:secrets`, `lint`, `typecheck` pass; 125 unit tests (10 new); build with CI's
synthetic public variables; generated database types differ only by the new tables and RPCs
(additive diff); `audit:prod` 0 findings. Browser: 191 of 198 cases pass. The 6 `@visual` cases fail for lack of Linux baselines, as in earlier slices, and the auto-written snapshots were deleted, not adopted. One unrelated account-linking case failed on a synthetic portal-fixture socket hang-up and passed 3/3 on rerun. The finance specs (8 new, 8 existing) pass: light
320px and dark 1440px with axe and reflow, approval with note and no actor field, requester run
with a refusal shown in operator words, hold placement with key reuse on retry, an unconfirmed
readback reported as not done, refund send reporting money not activated, event replay wording.
Screenshots were reviewed. Browser work found that `paymentFunctionError` loses Edge error codes
(finding recorded; the panel reads the response itself).

Not performed: CI, hosted or Stripe test-mode/bank verification, a live
`refund-invoice` round trip against local Auth and Stripe, human screen-reader review.

## TRACE-077 — Finance operator commands, part 2A: refunds and chargebacks — 2026-09-21

Branch `codex/phase5-finance-refunds`, base `main` `f945910` (PR #32 merged); isolated synthetic
stack only. Design R1–R6 and the owner decisions of 2026-09-17 (G3 one-operator hold release,
G9 24-hour expiry, refund dual review as is) are in PHASE-5-FINANCE-REFUNDS.md.

Baseline before change: 1427 pgTAP assertions across 34 suites (TRACE-076 evidence). With the
migration applied and no test changes, only suite 043's hold release section failed (it used the
retired two-person release); the other 33 suites passed unchanged.

Database: 1534 pgTAP assertions across 35 suites pass after a clean reset, and again as CI's
clean replay after all committed concurrency fixtures. Suite 044 is new (126 assertions). Suite 043
now has 113: its hold release section tests the one-operator release (retired request refused,
reason/evidence/unknown hold/authority refusals, release by an operator who did not place the
hold, same-operator replay, different or other-operator release refused, payable again); the
second-person approval mechanics it used to exercise through hold release moved to 044.
Suite 044 covers: grants (new commands callable, kernels and helpers service-only, new evidence
tables unreadable); access; refund validation and blockers (payment not captured, over
components, chargeback open) with nothing stored on refusal; the reviewed refund flow (trimmed
replay, amount conflict, details and 24-hour `expires_at`, no run without approval, no
self-approval, a direct kernel approval of the identical command not counting, authority,
approver cannot run, lost authority, request approval immutable, run and replay, kernel author
and approver, payout held, send permission); the window (approval a minute before expiry,
expired at exactly 24 hours with no blocker, approve and key replay refused, new request allowed,
an approval written after the window not an approver, an approved request expiring before it
runs); staleness when another refund takes the components; cancellation refunds (listing with
policy amounts, unknown, malformed, not eligible, no refund due, request, run bound to the
cancellation with both operators, replay, completed, `amount_changed` after an adjustment, an
expired request's approval not carrying over to an identical new request); lost chargebacks
(listing with retained components, unknown, zero, partial and over-component allocations refused,
run with both operators, hold cleared, completed); and reissue (validation, not sent, not
uncertain, readback required, readback too early, third operator refused, generation 2 by the
approver, replay, conflicts, new key and same amount, 23-hour window restarting at the reissue,
immutability, no settlement and no new authorization).

Mutation check (local harness, not committed; each mutant injected inside the suite's rolled-back
transaction): 18 guard mutants, 17 fail suites 043/044 — approver ignoring the window, approver
matching approvals by hash only, execute/approve/key replay ignoring expiry, a 25-hour window,
refund blocker ignoring disputes, cancellation ignoring amount changes, chargeback allowing a
partial allocation, reissue ignoring an early readback, reissue by any operator, reissue replay
ignoring the actor, prepare using `created_at`, release replay ignoring the actor, hold release
still reviewed, self-approval, expired state dropped. The survivor, "reissue ignores a found
readback", is equivalent: a found readback always records Stripe's reference and moves the
attempt out of `reconcile`, so the guard is a backstop that cannot be reached.

Concurrency: new `scripts/phase5-finance-refund-concurrency.mjs`, wired into CI after the part 1
script. As separate signed-in sessions: three runs of one approved refund make one authorization
and one execution; two approved refunds that together exceed the service subtotal, one held by a
sleeping executor, authorize only the holder and refuse the other with
`refund_exceeds_components`; a policy cancellation refund racing a manual refund on the same
invoice goes stale with `amount_changed` and never oversubscribes; three runs of one approved
chargeback allocation make one allocation and one journal; author and approver reissuing at once
make one reissue with the generation 2 key. The part 1 script's release race now races
one-operator releases (lock holder wins; others refused as already released). All 13 scripts
passed in CI order on a clean reset.

Application: `scan:secrets`, `lint`, `typecheck` pass; 129 unit tests (4 new: expired request,
reissue gating, chargeback allocation sums; new refusal wording); build with CI's synthetic public
variables; generated database types differ only by additions; `audit:prod` 0 findings. Browser:
198 of 198 non-visual cases pass (`test:a11y`). The finance spec has 6 new cases — one-operator
release, refund request with exact cents and policy, cancellation refund sending no amounts,
chargeback allocation sum validation, expired request with no action, reissue — and the existing
approval case now approves a refund showing its amounts and expiry. The portal fixture's
`money_finance_operations` response gained the two new lists; without them the reconciliation
spec's page failed, which is the contract change working as intended. Screenshots were reviewed;
they led to correcting the page intro (it still said releases need a second operator) and
aligning the amount inputs.

Not performed: CI, Edge checks (no Edge change), hosted or Stripe test-mode verification of send,
readback and reissue, human screen-reader review.

## TRACE-078 — Finance operator commands, part 2B: weekly ACH, bank outcomes and retry — 2026-09-21

Branch `codex/phase5-finance-ach`, base `main` `da94fd8` (PR #33 merged); isolated synthetic
stack only. Design B1–B8 and its review questions are in PHASE-5-FINANCE-ACH.md.

Baseline before change: 1534 pgTAP assertions across 35 suites (TRACE-077 evidence). With the
migration applied and no test changes, all 35 suites passed unchanged.

Database: 1708 pgTAP assertions across 36 suites pass after a clean reset, and again as CI's
clean replay after all committed concurrency fixtures. Suite 045 is new (174 assertions). It covers:

- grants: new commands callable; kernels, helpers and ACH tables closed;
- access for homeowners and admins without finance authority;
- ready payouts: the 48-hour window, holds, amounts and payee, checked against `money_payable`;
- batch validation: reason, bank reference, key, week, empty, null, over-500 and unknown payouts;
  a payout inside the window or on hold is refused with its reason; the generic review request
  refuses ACH;
- the stored command: the kernel object with sorted, distinct payouts and trimmed text; subject,
  terms, replay and conflict;
- what the approver sees: the bank batch reference, total, each payout and the week end;
- review rules: no self-approval; no run without approval; a direct kernel approval not counting;
  the approver cannot run it;
- execution: the kernel batch names requester, approver, reference and reason; items are at their
  amounts with prepared attempts; replay;
- readback: the next week, batch total, no batch bank reference, and a payout no longer ready;
- weeks: an overlapping week, a payout already on a statement, and a competing batch for the same
  week going stale;
- terms: a changed amount, payee or bank authorization makes the batch stale, and restored terms
  are actionable; an expired batch computes no live blockers;
- bank outcome validation: authority, status, evidence, blank and unknown references and
  attempts, invalid transitions, missing and reused references;
- submission: trimmed reference, operator and namespaced key, replay and conflict; only a
  four-character hint is returned. Submission is stopped by a late hold, a dispute, a stale
  statement amount and a changed bank authorization;
- later outcomes: unknown reuses the stored reference; a conflicting reference is refused; failure
  posts no journal; settlement and return post their journals; reconciliation reads the settled
  payout as paid; a returned transfer takes no further outcome;
- retries: validation, the exact kernel command, the details the approver sees, approval and
  execution with both operators, and `completed` for a retried attempt. A second retry with an
  identical kernel command does not inherit the first approval. A hold blocks a retry; a returned
  transfer retries; a changed bank authorization blocks a retry;
- two current bank authorizations; conflicting completion evidence refused with the kernel
  agreeing; no full bank reference or customer identity returned.

Mutation check (local harness, not committed; each mutant injected inside the suite's rolled-back
transaction): 30 guard mutants, and all 30 fail suite 045. They removed or bypassed:

- mirror checks: the window, hold, dispute and completion-conflict checks;
- the ready list's blocker filter;
- term checks: on-statement, bank count, amount, payee and bank authorization;
- the week overlap check;
- item checks: amount and bank authorization;
- record checks: transition, reference required, conflict and reuse, and the submission payable
  check;
- retry checks: completed, open outcome and payable;
- request construction: payout sorting, and a retry subject of item instead of attempt;
- record handling: replay evidence, key namespace and stored-reference reuse;
- the execute and approve blocker checks;
- the reference hint, and expired-request live blockers.

On the first run the expired-request mutant survived. Batch 4's terms happened to be valid again
when it expired, so the mutant was equivalent there. An assertion after its payout became
blocked now kills it.

Concurrency: new `scripts/phase5-finance-ach-concurrency.mjs`, wired into CI after the part 2A
script. Each call is a separate signed-in session:

- three runs of one approved batch make one batch and one execution;
- two approved batches for different weeks sharing a payout, one held by a sleeping executor:
  one statement, and the other is refused with `on_ach_statement`;
- a refund authorized while a batch waits: the batch is refused with `refund_hold` and nothing is
  prepared;
- a hold placed while a batch holds the lock is refused as already on a statement;
- two operators recording one submission with different references: one event, and the other is
  refused with `transition_invalid`;
- three runs of one approved retry plus a competing approved retry: one new attempt and one
  execution, with the others replaying or refused as `completed`;
- no race posted a settlement or return journal.

All 14 scripts passed in CI order on a clean reset.

Application: `scan:secrets`, `lint` and `typecheck` pass. 135 unit tests pass (6 new: allowed
outcomes, submission and retry gating, week arithmetic without time zone drift, typed request
details, ACH refusal wording). The build passes with CI's synthetic public variables. Regenerated
database types differ only by additions. `audit:prod` has 0 findings.

Browser: 202 of 202 non-visual cases pass (`test:a11y`):

- the themed layout case now checks the batch list, reference hint, retry action and a blocked
  payout checkbox;
- new cases: a batch request sends week, payouts, reference and reason with no actor field; a
  submission needs a reference and evidence, and a refusal shows the hold reason with the dialog
  open; a failed transfer is retried through a reviewed request; an approver sees each payout, the
  total and the reference.

The portal fixture's `money_finance_operations` response gained `ach`. Without it the
reconciliation spec's page failed to render. The section now shows an error state, not a page
failure, if a readback lacks `ach`. ACH section screenshots at 1440px dark and 320px light were
reviewed: no horizontal scroll, and forms and lists stack at 320px.

Not performed: CI, Edge checks (no Edge change), owner bank workflow or statement acceptance,
hosted verification, human screen-reader review.

## TRACE-079 — ACH transfer withdrawal and replacement statements — 2026-09-21

Branch `codex/phase5-replacement-statements`, base `main` `7f696e1` (PR #34 merged); isolated
synthetic stack only. Design W1–W7, the owner's two decisions and the review questions are in
PHASE-5-ACH-REPLACEMENT.md.

Baseline before change: 1708 pgTAP assertions across 36 suites passed on `7f696e1` after a clean
reset. With the migration applied and no test changes, all 36 suites passed unchanged.

Database: 1856 pgTAP assertions across 37 suites pass after a clean reset, and again as CI's clean
replay after all committed concurrency fixtures. Suite 046 is new (148 assertions). It covers:

- grants: the request callable; kernel, blocker, helpers and the withdrawal table closed; no
  service-role update on withdrawals;
- characterization of the block this slice removes: a refund, a chargeback allocation, a hold and
  a second batch refused while the payout is on a statement; the kernel and a direct insert
  refused a second live statement;
- access and validation: reason, evidence, key, unknown transfer; the generic request refuses
  withdrawals;
- refusals: submitted and unknown (`bank_outcome_open`) and settled (`paid`) transfers;
- a prepared transfer's review: the stored command bound to `prepared`, trimmed replay and
  conflict, what the approver sees, no self-approval, no unapproved run, approver cannot run,
  replay;
- what the withdrawal records: operators, previous status, reason, the `withdrawn` event and key;
  no journal; immutability;
- a withdrawn transfer refused by the unchanged record and retry kernels and by the gateway
  (`withdrawn`, `completed`);
- off the statement: ready again with the statement it replaces; reconciliation `eligible` with
  no live statement and one withdrawn; a hold placed and released;
- the replacement: the approver sees what it replaces; `replaces_item_id` set; one live item; a
  second replacement refused; readback weeks; reconciliation `scheduled`, then `paid` once with
  only the replacement counted;
- a returned transfer: withdrawal adds no journal; replacement settles; net paid is one payout;
  provider payable cleared; no reconciliation issue;
- a refund after withdrawal: allowed, settled, and the replacement pays the reduced amount
  (7800 cents against the withdrawn 9500);
- a lost chargeback allocated once the transfer is withdrawn;
- a changed bank authorization: a prepared and a failed transfer, both withdrawable, replaced with
  the new authorization and sendable;
- staleness: a retry makes a withdrawal `completed`; a submission makes one `status_changed`; an
  expired one cannot be approved;
- the kernel: refuses a submitted transfer, an approval for another status, an unapproved command,
  a different withdrawal of the same transfer and an already-retried attempt; replays a recorded
  withdrawal;
- no full bank reference or customer identity returned.

Mutation check (local harness, not committed): each mutant replaced one function body from the
migration in the isolated database, ran suites 045 and 046, and restored the original. 25 of 26
mutants were killed. They covered:

- the withdrawal blocker's checks;
- the kernel's status, state, latest-attempt, replay and review checks, and its status update;
- the chain trigger's refusal and predecessor link;
- the live-item filter;
- each W4 predicate: the refund blocker and trigger, hold, chargeback blocker and kernel, and
  batch terms;
- the record and retry `withdrawn` checks;
- the reconciliation live item and the ready-list filter;
- the request blocker branch, and the status binding at request time.

The survivor removes the blocker's failure-evidence check. It is equivalent: the unchanged
`money_record_ach` writes the matching event before setting `failed` or `returned`, so that state
cannot exist without evidence. The kernel keeps the same check.

The first harness run under-reported kills. psql prints errors to stderr and exits 0, and an
aborted transaction prints no `not ok`, so it counted crashing mutants as survivors. The corrected
harness compares passing counts with the baseline and reads stderr. The figures above are from
the corrected run.

Concurrency: new `scripts/phase5-ach-replacement-concurrency.mjs`, wired into CI after the
TRACE-078 script. Its weeks start at +140 days: both scripts share CI's database, and weeks cannot
overlap. Each call is a separate signed-in session:

- a withdrawal holding the lock while an operator records the submission: withdrawn, the
  submission refused with `withdrawn`, and no submitted event;
- a submission holding the lock while an approved withdrawal runs: submitted, and the withdrawal
  refused with `status_changed`;
- three runs each of two approved withdrawals of one transfer: one withdrawal, one `withdrawn`
  event and one execution;
- a withdrawal holding the lock while an approved retry of the same failed transfer runs: the
  retry is refused with `withdrawn` and no new attempt exists;
- after a withdrawal, two approved batches for different weeks both containing the payout, one
  holding the lock: one replacement, and the other refused with `on_ach_statement`;
- every payout has at most one live statement; no race posted a bank journal.

All 15 scripts passed in CI order on a clean reset. The new script also passed three more times
alone on clean resets.

Application: `scan:secrets`, `lint` and `typecheck` pass. 138 unit tests pass (3 new cases, plus
extended existing ones). They cover withdrawal gating by status, blocker and open request;
withdrawal where a bank change blocks sending and retry; withdrawal details typed to their
operation; and withdrawal refusal wording. The existing replacement-wording expectation was
updated. The build passes with CI's synthetic public variables (65 pages). Regenerated database
types differ by additions, plus the obligation relationship on statement items, which is no longer
one-to-one. `audit:prod` has 0 findings.

Browser: 204 of 204 non-visual cases pass (`test:a11y`):

- the themed layout cases at 320px light and 1440px dark now include a withdrawn, replaced
  transfer, a ready payout replacing a withdrawn statement, and a batch heading with its withdrawn
  total, under axe and the no-horizontal-scroll check;
- new: a withdrawal request sends transfer, evidence, reason and key with no actor field, lists
  only withdrawable transfers, and warns about paying twice; an approver sees the transfer, its
  failure evidence and reference hint before approving.

ACH section screenshots at 1440px dark and 320px light were reviewed. The withdrawal form fields
have labels distinct from the bank outcome form's.

Not performed: CI, Edge checks (no Edge change), owner bank workflow or statement acceptance,
hosted verification, human screen-reader review.

## TRACE-080 — Already-paid payout recovery — 2026-09-21

Branch `codex/phase5-already-paid-recovery`, base `main` `68f0da3` (PR #35 merged); isolated
synthetic stack only. Design R1–R8, the owner's four decisions and the review questions are in
PHASE-5-PAYOUT-RECOVERY.md.

Baseline before change: 1856 pgTAP assertions across 37 suites passed on `68f0da3` after a clean
reset. With the migration applied and no test changes, all 37 suites passed unchanged. That run
used the evidence-based proceeds guard; a first, ledger-based draft failed suites 024 and 027 (see
the slice findings).

Database: 2006 pgTAP assertions across 38 suites pass after a clean reset, and again as CI's clean
replay after all committed concurrency fixtures. Suite 047 is new (150 assertions). It covers:

- grants: both requests callable by signed-in users only; kernels service-only; helpers and both
  new tables closed; no service-role update on either table;
- unchanged blocks: a refund and a lost chargeback still wait while a transfer is prepared,
  submitted or failed, at the blocker, the refund trigger and the chargeback kernel (with its new
  message);
- a refund after the payout settled: allowed; 1700 owed (2000 less the 300 fee reduction);
  reconciliation `paid`, payable −1700, no stale statement and no issue; a `provider_owes`
  exception; the queue's paid, refunded and payee;
- no hold: the same provider's other payout stays ready while they owe;
- recovery access and validation: homeowner and plain admin refused; netting, zero, missing reason
  or evidence, unknown payout, more than owed and nothing owed refused; the generic request refuses
  recoveries;
- a part repayment: the stored command bound to the amount owed and key; trimmed replay; a
  conflicting key; what the approver sees; no self-approval or unapproved run; the row, the bank
  and payable journal, immutability, the reconciled ledger;
- staleness: a repayment run first makes an approved write-off `owed_changed`; a write-off then
  closes the rest to the recovery-loss account;
- the recovery kernel: a reused approval replays; a changed amount owed, an unapproved command and
  a recovery when nothing is owed are refused;
- a lost chargeback after payout: allocated; 850 owed; written off;
- a duplicate payment: a withdrawn transfer paid late after its replacement settled. Refusals
  cover a live transfer, a reference used elsewhere, a blank reference and an unknown transfer.
  Checked: the stored command, the approver seeing the settled replacement and only a reference
  hint, the row and journal, and the attempt still `withdrawn`. The provider owes 9500, both
  payments count as paid, it reconciles, a second late payment is refused, it is repaid, and the
  kernel replays and refuses a transfer that was not withdrawn;
- a late payment with no replacement: the payout leaves the ready list; an earlier batch request
  goes stale and a new one is refused (`already_paid`); reconciliation reads `paid` with nothing
  owed; the preparation kernel is refused by the guard;
- a late payment while a replacement waits: a mismatched reference refused; the replacement then
  reads `already_paid`, its submission is refused by the gateway and by the kernel, and it can be
  withdrawn;
- a late payment after a replacement failed: its retry is refused by the gateway and the kernel;
- totals agree between reconciliation and the queue; no full bank reference or customer identity
  is returned.

Mutation check (local harness, not committed): each mutant redefined one function from the
migration inside suite 047's transaction, which rolled it back. A mutant counts as killed when the
suite reports `not ok` or an error; the unmutated suite reports 150 `ok`, no `not ok` and no error.
All 23 mutants were killed. They covered:

- the proceeds guard, the received total and the readback mirror;
- the unpaid-statement predicate (both ways), the refund trigger and the chargeback blocker;
- each recovery blocker check;
- the recovery kernel's owed binding, amount bound, journal account and replay key;
- the late-payment blocker's withdrawn, reference-conflict and reference-reuse checks, and the
  kernel's withdrawn check;
- reconciliation's late-payment total, settled-statement staleness, late-payment funds state and
  write-off term;
- the amount owed.

The chargeback-blocker mutant first survived. Suite 047 then gained a scheduled-chargeback case,
which kills it.

Concurrency: new `scripts/phase5-payout-recovery-concurrency.mjs`, wired into CI after the
TRACE-079 script. Its weeks start at +210 days. Each call is a separate signed-in session:

- three runs each of two approved recoveries of the whole 1700 owed, one a repayment and one a
  write-off: one recovery, one execution, one journal, nothing owed;
- a late payment holding the lock while an operator records its replacement's submission: the
  late payment is recorded, and the submission is refused with `already_paid` and stays prepared;
- a late payment holding the lock while an approved replacement batch runs: the batch is refused
  with `already_paid`, and no second item or batch exists;
- no payout is on two live statements, and all three race payouts reconcile with no issue.

All 16 scripts passed in CI order on a clean reset. The new script also passed alone on an earlier
clean reset, and the 15 existing scripts passed in CI order with the migration applied.

Application: `scan:secrets`, `lint` and `typecheck` pass. 142 unit tests pass (4 new cases). They
cover recovery amount bounds, late-payment and recovery details typed to their operation,
recovery and `already_paid` refusal wording, and the owed attention rule and exception wording.
The unit reconciliation fixture gained the new payout fields. The build passes with CI's synthetic
public variables (65 pages). Regenerated database types are additions only. `audit:prod` has 0
findings.

Browser: 209 of 209 non-visual cases pass (`test:a11y`) on the final build:

- the themed layout cases at 320px light and 1440px dark now include the owed list and its total,
  under axe and the no-horizontal-scroll check;
- new: a repayment is refused above the amount owed and sends obligation, kind, cents, reason,
  evidence and key with no actor field; a late payment request sends transfer, reference, reason
  and evidence; an approver sees that a late payment duplicates a settled replacement, and the
  withdrawn batch row shows it; refund and chargeback forms warn on a paid payout; the
  reconciliation page shows the owed total, exception and invoice line.

The first full run found an existing case failing: its `Bank reference (required)` and
`Transfer (required)` label lookups also matched the new form's labels. The new labels were
renamed ("Withdrawn transfer paid late", "Reference the bank paid it under"). Recovery-section
screenshots at 1440px dark and 320px light were reviewed.

Not performed: CI, Edge checks (no Edge change), owner bank workflow or statement acceptance,
hosted verification, human screen-reader review.
