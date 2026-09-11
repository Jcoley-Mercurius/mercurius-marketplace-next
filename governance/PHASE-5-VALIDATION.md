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
