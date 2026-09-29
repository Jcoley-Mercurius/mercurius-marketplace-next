# R0.1 admission boundary — TRACE-101

**Branch:** `codex/r0-admission`, stacked on R0 authority commit `87baae7` from remote main `37d212e`.
**Status:** implementation checkpoint; independent review finding fixed locally. CI, direct Edge/browser, concurrency and hosted acceptance remain open.
**Owner clarification:** DEC-2026-023 blocks all new checkout after revocation, even for an older request.

## Characterized baseline

`submit_service_requests(text,jsonb)` checked authentication, homeowner role, coverage, eligibility and pricing, but no trial admission. A verified homeowner could submit directly regardless of the public UI. `money_prepare_checkout(uuid,text)` checked source and owner, but no cohort admission. Both Edge checkout entry points call the shared handler, which calls that RPC before creating a Stripe session; money mode is separately default-disabled. Direct browser INSERT on `service_requests` is already revoked by TRACE-095.

## Change and trust boundary

Migration `20260928232242_r0_trial_admission.sql` adds a private copy of the 47 approved Lee County ZIPs, an initially empty trial-operator roster, a private homeowner/ZIP/service admission table and append-only admission events. A nominated admin can grant or revoke a cell through `r0_set_trial_admission`; no browser role can read or write the private tables. Owner authorization is required to provision Josh's identity in the hosted operator roster. The request wrapper checks every recognized selected service cell, including a deactivated cell on replay, before calling the existing homeowner-role and core command. The checkout wrapper checks the snapshot's owner and request cell before calling the existing source-bound money command. Row locks serialize each grant/revocation with these checks. Invalid/uncovered requests still reach the existing diagnostic path and cannot create an active request.

An account or homeowner role alone does not grant admission. Revocation prevents new requests, exact-key replay and new checkout attempts; it leaves existing request and payment records intact. Direct private command privileges remain revoked. The release requires a separate operator readback and UI in TRACE-104.

**Limit:** Independent review found that checkout admission and Stripe session creation are separate transactions. A revocation between them can issue a new Stripe URL; a previously issued URL may also remain usable without provider-side expiration. R0 has money mode disabled. R1 must design, test and operate an atomic/equivalent admission fence plus expiration/reconciliation before claiming the owner’s checkout revocation rule.

## Verification — isolated local stack, 2026-09-28

- A separate Supabase local project on ports 5642x applied all 171 branch migrations including R0.1. The existing Phase 6 stack on ports 5542x was neither reset nor changed.
- `supabase test db --local supabase/tests/068_r0_trial_admission.sql`: **23/23 pass** at `e7ccb07`. Covers default denial, no request write, operator roster, least privilege, Lee boundary, actor and cell scoping, grant, revocation, replay denial after coverage/service deactivation, checkout refusal, preserved history and two audit events.
- Six affected source/request/coverage/role/intake suites: **240/240 pass** and full suite **3266/3266 across 58 files**, both recorded before the `e7ccb07` replay fix.
- **Regression found and fixed (2026-09-28, R0.2 preparation):** `e7ccb07` made every *known* coverage/service cell admission-gated, so a never-admitted homeowner asking about an inactive or waitlist cell got “Trial invitation required” instead of the core waitlist/unavailable diagnostic. SQL 063 aborted at assertion 18. CI did not reach the SQL step because the image pull from public.ecr.aws was rate-limited. The fix gates an active cell always, and an inactive cell whenever the homeowner has any grant or revocation for it, so the revoked-replay denial remains. SQL 068 adds three cases and moves the deactivation step after the two active-cell refusals it had been masking: **27/27**. Full suite with the fix, one rolled-back transaction per file on the isolated R0 stack (ports 5642x, unchanged): **3270/3270 across 58 files, 0 errors**; 063 **65/65**. CI then reached the concurrency step, where `phase5-concurrency.mjs` built a checkout source with no request cell or admission and was correctly refused. Its fixture now names a Lee cell and seeds a synthetic admission (verified in a rolled-back transaction: prepared with the admission, refused without). `phase6-request-submission.mjs`, run manually, seeds and cleans its synthetic admissions the same way.
- `supabase db advisors --local --type security --level warn --fail-on error`: **no issues**.
- `git diff --check`: pass. No production schema/data, email, Vercel deployment, DNS, Stripe or domain change.

## Open acceptance and rollback

Independent review must check the SQL privilege boundary, lock order, multi-service refusal, operator provisioning and interaction with Phase 6 PR #64. Independent review found the deactivated-cell replay gap, which is fixed and covered by the focused test. The isolated migration replay applied all branch migrations, although the CLI reset ended on a local Storage health failure after schema application. A direct REST/RPC/Edge integration and browser route matrix are still needed; the UI still points to request/checkout until TRACE-103. Concurrency and final-head CI remain open. Hosted migration requires the R0.5 rehearsal, backup and explicit external-action authorization. The rollback for code is to return to the prior deployment while keeping the additive schema; a database forward fix is required if the migration has been applied.
