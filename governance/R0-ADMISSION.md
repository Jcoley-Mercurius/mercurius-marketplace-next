# R0.1 admission boundary — TRACE-101

**Branch:** `codex/r0-admission`, stacked on R0 authority commit `87baae7` from remote main `37d212e`.
**Status:** implementation checkpoint; independent review, CI, direct Edge/browser and hosted acceptance open.
**Owner clarification:** DEC-2026-023 blocks all new checkout after revocation, even for an older request.

## Characterized baseline

`submit_service_requests(text,jsonb)` checked authentication, homeowner role, coverage, eligibility and pricing, but no trial admission. A verified homeowner could submit directly regardless of the public UI. `money_prepare_checkout(uuid,text)` checked source and owner, but no cohort admission. Both Edge checkout entry points call the shared handler, which calls that RPC before creating a Stripe session; money mode is separately default-disabled. Direct browser INSERT on `service_requests` is already revoked by TRACE-095.

## Change and trust boundary

Migration `20260928232242_r0_trial_admission.sql` adds a private copy of the 47 approved Lee County ZIPs, an initially empty trial-operator roster, a private homeowner/ZIP/service admission table and append-only admission events. A nominated admin can grant or revoke a cell through `r0_set_trial_admission`; no browser role can read or write the private tables. Owner authorization is required to provision Josh's identity in the hosted operator roster. The request wrapper checks every active, valid selected service cell before calling the existing homeowner-role and core command. The checkout wrapper checks the snapshot's owner and request cell before calling the existing source-bound money command. Row locks serialize each grant/revocation with these checks. Invalid/uncovered requests still reach the existing diagnostic path and cannot create an active request.

An account or homeowner role alone does not grant admission. Revocation prevents new requests, exact-key replay and new checkout attempts; it leaves existing request and payment records intact. Direct private command privileges remain revoked. The release requires a separate operator readback and UI in TRACE-104.

**Limit:** A Stripe Checkout URL issued before revocation can remain usable at Stripe without an explicit provider-side expiration. R0 has money mode disabled; R1 must design, test and operate that expiration/reconciliation path before claiming immediate checkout revocation.

## Verification — isolated local stack, 2026-09-28

- A separate Supabase local project on ports 5642x applied all 171 branch migrations including R0.1. The existing Phase 6 stack on ports 5542x was neither reset nor changed.
- `supabase test db --local supabase/tests/068_r0_trial_admission.sql`: **22/22 pass**. Covers default denial, no request write, operator roster, least privilege, Lee boundary, actor and cell scoping, grant, revocation, replay denial, checkout refusal, preserved history and two audit events.
- Six affected source/request/coverage/role/intake suites: **240/240 pass** after test fixtures explicitly seed synthetic admissions.
- Full `supabase test db --local supabase/tests`: **3266/3266 pass across 58 files**.
- `supabase db advisors --local --type security --level warn --fail-on error`: **no issues**.
- `git diff --check`: pass. No production schema/data, email, Vercel deployment, DNS, Stripe or domain change.

## Open acceptance and rollback

Independent review must check the SQL privilege boundary, lock order, multi-service refusal, operator provisioning and interaction with Phase 6 PR #64. A direct REST/RPC/Edge integration and browser route matrix are still needed; the UI still points to request/checkout until TRACE-103. Concurrency and final-head CI remain open. Hosted migration requires the R0.5 rehearsal, backup and explicit external-action authorization. The rollback for code is to return to the prior deployment while keeping the additive schema; a database forward fix is required if the migration has been applied.
