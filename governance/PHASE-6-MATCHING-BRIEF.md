# Phase 6.3 Claude implementation brief — TRACE-099

Date: 2026-09-27. Planning checkpoint: `634837a`, `codex/phase6-intake`.
Status: **PLANNED**, ready after the TRACE-098 P6-R2/P6-R3 follow-up and Codex
re-review in [PHASE-6-INTAKE-REVIEW.md](PHASE-6-INTAKE-REVIEW.md).
Suggested branch: `codex/phase6-matching-offers` from current merged main containing
the reviewed 6.1/role repair/6.2. Verify status and record the actual base. A stack
requires existing owner authorization; do not assume this branch is merged.

Outcome: a homeowner understands provider preference, active offer, consent and
exhaustion; the eligible offered vendor can accept or decline within the exclusive
four-hour window, and both roles recover honestly from stale or uncertain responses.
Codex scopes/reviews; Claude implements this bounded slice.

## Governing contracts

Read AGENTS.md, navigation/current handoff, the six authorities and CLAUDE.md;
read relevant installed Next.js documentation before framework changes.
Authority: MPS §§4/5/6.2, MDS Status/ConfirmAction/WorkflowStepper/form/state and
accessibility contracts, MTS §§4/6/7/13, CFG-001–003/009, roadmap area 2,
accepted Phase 4 matching/consent contracts, TRACE-060 vendor eligibility,
TRACE-095 submission and TRACE-098 preview/intake.

Selected eligible provider gets the first offer; otherwise use the approved
balanced ranking. One exclusive actionable offer at a time, four hours from the
authoritative offer timestamp. No fallback from a selected provider without
homeowner consent. Exhaustion says “Not available yet in your area.” Never claim
active sourcing, assignment or a confirmed appointment from an offer alone.
Acceptance may advance existing stored states, but an agreed appointment requires
its scheduling evidence; no new scheduling semantics in this slice.

Preserve the reviewed D4 dispatch boundary: fixed requests wait for operations;
quote requests start the existing matching command. Do not introduce automatic
fixed dispatch or change ranking/price selection without recording an authority
conflict or an owner operating decision. Public promotion prohibition remains;
no new promotion or checkout bypass. Notification delivery/scheduler activation
belongs to Phase 7, hosted rollout to Phase 8.

## Characterize before changing

Inspect current callers, latest SQL definitions and role/readback policies:

- `src/app/request/page.tsx`, `src/lib/requestConfirmation.ts` and preview modules:
  intake preferences, explicit offering identity, quote dispatch and recovery.
- `src/components/dashboard/HomeownerJobDetailDialog.tsx`, homeowner dashboard
  lists and `src/lib/lifecycle.ts` / `serviceRequestStatus.ts`: awaiting-consent,
  fallback action, status and next-action mapping.
- `src/app/vendor/jobs/page.tsx`: incoming versus active queue, offer deadline,
  accept/decline command, error/readback and focus behavior. Current accept UI tests
  for `scheduled` only; characterize accepted quote outcomes before replacing it.
- Admin matching callers only as required to prove the preserved fixed dispatch
  boundary. Full admin navigation/queue rebuild belongs to 6.13.
- `start_request_matching`, `create_job_offer`, `offer_next_for_request`,
  `consent_to_provider_fallback`, `vendor_accept_job`, `vendor_decline_job`,
  `expire_stale_matches`, eligibility wrappers, match attempts and lifecycle audit.
  Locate latest definitions rather than relying on original migration bodies.
- SQL 004/006/029 plus current lifecycle/money eligibility tests; browser
  homeowner/vendor/offer fixtures; TRACE-095/098 submission/preview regressions.

Baseline notes are investigation leads, not predeclared backend defects. Preserve
working canonical commands, commercial snapshots and data; narrow forward repairs
are allowed when characterization proves a violation.

## Bounded implementation

1. Homeowner provider/status view distinguishes preference, awaiting operations,
   exclusive offer pending, accepted provider, quote required, consent needed,
   unavailable and verification failure. Show the next action from authoritative
   state. Keep intake confirmation consistent with the repaired TRACE-098 helper.
2. Explicit pre-submit preference/correction continues using the reviewed intake
   contract. Post-submit fallback uses `consent_to_provider_fallback` with a clear
   confirmation and refresh. Never clear/overwrite preference or offering directly
   to bypass consent; preserve its audit and immutable commercial history.
3. Vendor offers show service/configuration, available permitted details, fixed
   amount versus quote requirement and an ET-labelled absolute deadline with
   readable remaining time. Use server expiry as authority; refresh on return/focus
   and after action. Avoid constantly announcing countdown updates to screen readers.
4. Accept/decline disables repeated actions, confirms consequences where required,
   handles expiry, withdrawn offers and lost responses, and reads back the actual
   result. Accepted quote work must not be mislabeled as a failed acceptance or
   a booked appointment. Decline copy must allow consent/exhaustion outcomes rather
   than promise another provider always exists. Errors remain inline and recoverable.
5. Prove exclusive pending offers, selected-provider-first, approved fallback,
   next-offer sequencing and exhaustion under concurrent actions. Backend repairs
   use additive migrations, existing lock order and role/ownership checks. Never
   trust a browser clock, contractor ID or client status mutation.
6. Apply MDS components/tokens/density, 44px customer and 40px compact portal
   targets, meaningful empty/loading/error/permission states, keyboard/focus,
   light/dark/reflow and status announcements. Apply relevant frontend skills.
   Touch adjacent fulfillment/quote UI only to preserve behavior and avoid misleading
   offer-state presentation; leave their rebuilds to 6.4–6.10.

## Acceptance Claude returns

| ID | Required evidence |
|---|---|
| M1 | Eligible preferred provider gets first offer; unselected requests use deterministic approved ranking; inactive/suspended/non-covered/ineligible vendors excluded. Explicit package/answer and preview behavior preserved. |
| M2 | One exclusive actionable offer; four-hour boundary immediately before/at/after expiry; concurrent expiry/accept/decline/retry cannot assign two providers, strand the request or duplicate audit/side effects. Prove with real local commands in addition to browser stubs. |
| M3 | Selected-provider decline/expiry/ineligibility requires owner-homeowner fallback consent; another homeowner/vendor/admin cannot impersonate that consent. Duplicate/uncertain consent recovers without duplicate offers. Exhaustion uses exact unavailable copy and no active sourcing promise. |
| M4 | Offered vendor A succeeds; vendor B, homeowner and anonymous action attempts fail; stale/unassigned offers and eligibility changes are refused safely. Confirm contact/read access at pending-offer and assigned boundaries against approved policy. |
| M5 | Fixed operation-dispatched offer versus quote offer acceptance/readback, declined/expired/withdrawn outcomes, failure before/after commit, reload/focus and concurrent tabs. Readback drives queues and copy; no invented appointment or payment claims, no promotion bypass. |
| M6 | Complete synthetic request → offer → accept/decline → homeowner status/fallback/exhaustion journey, both roles; desktop/mobile light/dark, keyboard/focus, axe, 320px reflow and 200% zoom, visual evidence and actual human screen-reader check recorded separately. Reuse unchanged valid evidence only. |

Run applicable `npm run check`, backend regression and clean reset/upgrade checks
if SQL changes, focused real RPC/concurrency tests, browser journeys and final-head
CI. Use explicit synthetic/local browser configuration. Never claim live scheduler,
notification delivery or external money integration from fixtures. Return exact
commands/results, failed/unperformed checks, fixture cleanup, migration order and
forward recovery, a TRACE-099 row/evidence report and concise handoff.

Carry forward: final-head/post-merge CI and integration gates from 6.2;
server-side promotion refusal/data cutover before beta; intake-photo uniqueness and
orphan retention decision; shared reduced-motion test configuration. Do not fold
unrelated retention or test-platform redesign into 6.3. No real messages, hosted
mutations, deployment, charges, payout or scheduler activation are authorized.
