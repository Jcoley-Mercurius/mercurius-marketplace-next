# Phase 3 — MDS foundation and critical journey validation

Date: 2026-09-03. Status: **IN PROGRESS**, not full Phase 3 acceptance.
Traceability: TRACE-011. Authorities: AGENTS.md, approved MPS/MDS/MTS,
configuration decisions, Phase 2 validation/handoff, and combined roadmap.

## Initial starting point (historical)

Read-only GitHub inspection confirmed PR #2 is open, unmerged, non-draft and
mergeable. Its base is `main`; its latest head is
`5707300267405cbbe90e1618c0d92ec162a7fd76` on
`codex/reproducible-supabase-baseline`. That head includes the dependency fix after
the owner's `fad91b1` checkpoint. GitHub CI run 33800711638 completed successfully;
CodeRabbit and Vercel status contexts were successful at inspection.

The local checkout was clean and matched the PR head. Created
`codex/mds-foundation` directly from it. PR #2 was not merged or modified.

## Bounded concerns implemented

1. Navigation and primitive repairs: single-element sheet triggers in public,
   homeowner, vendor and admin navigation; named mobile menu; sheet titles and
   descriptions; scrollable overlays; skip link and existing main focus targets;
   nested vendor-detail main removed; scrollable sidebar navigation; control
   minimum sizes; correct Base UI tab orientation selectors.
2. MDS foundation: commitment action, fixed semantic action/status pairs in both
   themes, opaque focus indication, native form controls, linked field validation,
   typed request-status presentation, page headers/states, guarded confirmation
   dialog, reduced-motion CSS, Geist documentation, and reversible dark-logo
   rendering. No lifecycle transitions or legacy-state remapping.
3. Evidence tooling: opt-in synthetic `/mds` catalog; Playwright/axe with one
   Chromium worker; theme/viewport, keyboard/focus, zoom, forced-color and motion
   scenarios; platform-specific screenshots; CI accessibility gate and artifacts;
   component API/maturity and remaining-work documentation.

## Validation record

Builds and browser suites run sequentially; final lint cleanup briefly overlapped unit-test startup. Builds use `MERCURIUS_BUILD_WORKERS=1`, a local
Supabase URL and placeholder public key. The initial setup used a placeholder local API URL; the current
fixture setup below uses dedicated port 55831, not either Supabase stack. Browser tests intercept every request and abort origins
other than the local catalog server at 127.0.0.1:3103. No database is required.

| Check | Evidence |
|---|---|
| Lint | Passed |
| TypeScript | Standalone check and production build passed |
| Existing unit/contract tests | All 48 passed |
| Production build | Passed all 56 static pages with one worker; catalog is dynamic |
| axe and reflow | Zero violations in catalog at 320, 390, 768, 1024 and 1440px, light/dark; actual element overflow checked |
| Keyboard/focus | Skip link, named mobile menu, sheet/dialog Escape and focus restoration, form errors, native controls, tabs, confirmation success/failure |
| Other accessibility | 200% CSS content zoom, reduced motion, forced-color focus, theme persistence |
| Visual baselines | Four Windows Chromium catalog captures: 320/1440px × light/dark; all four repeat comparisons passed |
| Secret scan | Repository scanner; not a guarantee that every possible secret pattern is detectable |

Initial browser runs exposed test assumptions about Base UI's manual tab
activation and temporary exiting panel. Tests now use Enter after arrow focus
and the named Details panel. Screenshot inspection also found the inherited
tab-orientation selector mismatch; the implementation was repaired and a layout
assertion added. These are not waived failures.

One sandboxed Playwright run stalled during Windows server cleanup. Only the
verified test server command on port 3103 was terminated. Later test runs used
normal process permissions and cleaned up their own server successfully. No
unrelated process was stopped.

## Initial foundation evidence (historical)

- Final combined browser run: **23/23 passed** (19 interaction/accessibility cases
  plus four final baseline captures); separate unchanged screenshot comparison:
  **4/4 passed**.
- All four light/dark desktop/mobile screenshots were visually inspected.
  Labels, controls and statuses remain readable and the corrected tab panel is
  below its tab list. Captures live under
  `tests/e2e/mds.spec.ts-snapshots/`.
- Agent-browser smoke check rendered the catalog, listed expected accessible
  controls, and reported no page errors. The repaired account menu navigated to
  the local homeowner sign-in page without submitting credentials. Browser and the dedicated local server closed.
- Final lint, 48 unit tests, secret scan, and one-worker build passed. The build
  enforced TypeScript and generated all 56 static pages.
- Git whitespace checks passed for current changes. No backend/lifecycle diff.
- Changes remain local and uncommitted; no branch push, PR creation, merge or
  deployment was performed. The Phase 3 CI additions have local evidence only.

## Initial remaining scope (superseded by the slices below)

Components remain **beta**. The foundation does not establish WCAG conformance
for all existing routes. Remaining Phase 3 gates include:

- Migrate critical request/payment, vendor-job and admin action forms to the new
  patterns with synthetic authenticated fixtures and role-aware browser tests.
- Reconcile route-local raw colors, statuses and small text; complete responsive
  data-list/table patterns and longer-form error summaries.
- Provide reviewed standalone light/dark and simplified small-size logo assets.
  Current CSS inversion preserves the inherited artwork as an interim repair.
- Complete screenshot coverage of authenticated journeys, true browser zoom and
  human screen-reader checks. CSS content zoom is not a replacement for those.
- Review Linux/macOS visual baselines separately; only Windows captures exist.
- Obtain remote CI evidence for this branch after an authorized push/PR.

## External effects and rollback

No production configuration, data, schema, function, deployment or scheduler was
changed. No Cron job was created or activated. Recovered lifecycle code and
TRACE-010 remain unchanged for Phase 4. Payment/payout integrity stays in Phase 5.
Neither local Supabase stack was started/stopped; Homeschool Haven was untouched.
Tooling downloads installed only test/browser dependencies and browser binaries.

Changes are application UI, test/tooling and documentation only. Rollback requires
reverting the Phase 3 changes; no database rollback or external reversal is needed.
The catalog stays unavailable unless `MDS_CATALOG_ENABLED=1` is explicitly set.

## Request-form slice — 2026-09-03

TRACE-011. Reconciled `codex/mds-foundation` with merged main `b9e3444`,
including PR #2 final head `b05beea`. GitHub CI run 33801891661 succeeded on
that final head. Existing Phase 3 UI changes were preserved during the fast-forward.

The homeowner request wizard now uses shared fields, native selects/textareas,
SMS checkbox, persistent error summaries and field descriptions. Errors focus
the summary; its links focus the affected field. Next/back navigation focuses
the next heading. Enter validates the current step. Existing validation rules,
date defaults, coverage decisions, matching, pricing and backend submissions
remain unchanged. Controls and photo-removal targets meet the 44px design
minimum; request-page text below 12px was raised. A light-mode banner contrast
failure (4.49:1) and a rotating spinner's mobile overflow were repaired.

Evidence: all 10 request browser cases passed against the production build,
using synthetic session drafts, intercepted coverage responses and blocked
external traffic. Includes the error/focus journey, malformed email, retained
values after Back, Enter, details at 320/1440px in both themes, and services/review
at 320px in both themes. axe found no violations in these tested states and
container reflow checks passed. Screenshots of light details/services and dark
review were visually inspected. This is not evidence of real authentication,
payment processing, booking, or screen-reader acceptance. Lint and one-worker
56-page build passed. Portal migration and the remaining manual gates stay open.

## Portal list and action slice — 2026-09-03

TRACE-011. Foundation/request checkpoint: `b5a61ef` (local).
Admin requests now share a responsive data-list pattern: labelled mobile records
and a native desktop table with column/row headers and keyboard scrolling.
Admin quote validation is associated with its field; operation failures persist
and receive focus. Admin release and vendor decline use ConfirmAction with
explicit entity/consequence, initial Cancel focus and focus restoration.
Vendor tabs reflow, active navigation announces the current page, status colors
use semantic light/dark pairs, and completion upload errors persist with focus.
Backend operation names, arguments, timing and state labels were preserved.

The dedicated fixture HTTP service binds only 127.0.0.1:55831, fails if that port
is occupied, and does not forward requests or access any database. Synthetic
sessions exercise the existing server proxy and client role gates. Mutation
requests return controlled errors; these tests do not establish real backend
authorization, storage, lifecycle or payment correctness. The app remains on
3103. CI browser-build public URL is now the same dedicated fixture port.

All 11 portal cases passed (10 in the combined run; the final vendor case passed
on its focused rerun after correcting the test's button name). Includes
admin/vendor light/dark at 320/1440px, axe, reflow, nested dialogs, error focus,
upload failure, and absent/wrong-role rejection. Mobile admin and vendor
screenshots were visually inspected. Tests exposed and repaired vendor active
navigation contrast and a confirmation-error focus timing race. Lint and the
one-worker production build passed. No real Supabase stack was started/stopped.

## Homeowner payment and service-action slice — 2026-09-03

TRACE-011. Portal checkpoint: `25f8dba` (local). Payment-launch and card-management
failures persist and receive focus; a UI in-flight guard prevents duplicate
checkout launches. Buttons preserve caller-provided busy state. Cancellation
uses the shared named confirmation with initial Cancel focus. Service-action
failures remain visible after the existing optimistic rollback. Review controls
have 44px targets and labelled native multiline input. Homeowner status styles
and action surfaces use semantic color pairs; status names and backend calls
are unchanged. No payment, cancellation, completion or review policy was changed.

All six homeowner browser cases passed: 16 route/theme/viewport combinations
(overview, upcoming, invoices, cards; light/dark; 320/1440px), checkout/card launch
failures and retry availability, quote failure, cancellation focus, and keyboard
review submission failure. axe/reflow passed in the tested states. Existing
application role checks run against isolated synthetic accounts; all writes fail
in the fixture service. No Stripe navigation, real payment or data mutation occurs.
Lint and the one-worker 56-page build passed. The rendered checks found and
repaired a dark-mode quote surface and low-contrast review helper text.


## Current checkpoint — brand review and final regression

The request, portal and homeowner slices above are implemented. The brand kit
adds deterministic dark/light exports that preserve the original PNG, embedded
licensed Geist lockups, and a separately labelled simplified-mark proposal.
Neither the proposed mark nor exports replace public navigation artwork.
The native switch now has a visible track/thumb and keyboard focus treatment.

The combined 54-case browser run passed 52 cases and exposed a brand-panel
heading contrast failure. After making that heading inherit its panel color,
all four brand cases passed on the rebuilt application. All six current Windows
baseline screenshots (catalog and brand, mobile and desktop) were visually
inspected; brand artwork renders correctly on both backgrounds. Baselines were
updated intentionally for the switch, catalog link and corrected brand heading.

Current Phase 3 acceptance remains **IN PROGRESS**. Remaining gates:

- Human screen-reader testing and true browser zoom (CSS content zoom is covered).
- Owner review of simplified mark, clear space, minimum sizes and export use.
- Separate Linux/macOS visual baseline review; CI runs functional/axe tests,
  while the six committed screenshot comparisons target Windows Chromium.
- Remote CI and code review of the draft PR before acceptance/merge.

Critical request, homeowner service/payment, vendor jobs and admin requests now
have synthetic browser coverage. This is bounded foundation evidence, not an
all-route WCAG claim or verification of real payment/lifecycle operations.
Existing backend calls and status policies remain unchanged. Lifecycle and
scheduler reconciliation stay in Phase 4; no Cron or production changes, and
Homeschool Haven remains untouched.

Final local checks: lint passed; all 48 unit/contract tests passed; secret scan
and whitespace checks passed; production build passed with one worker. All six
unchanged Windows screenshot comparisons passed after the visual review.
