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

## Required checkout fields — 2026-09-29, TRACE-101

Review confirmed that legacy templates and occurrences can retain NULL `zip_code`
or `service_catalog_id`. Forward migration `20260929000500` (renamed from `20260929000000` on main integration) recovers a missing
service from the linked catalog package and missing occurrence keys from a matching
same-homeowner template. It preserves existing values and requests with money
obligations. Unresolved rows retain their history and require source reconciliation;
checkout rejects either missing key with `22023` before calling the admission probe.
New occurrences inherit repaired template keys, and incomplete future rows encounter
the same checkout guard. Existing grants, revocation and commercial-source checks
still apply. A backfill that changes a quoted request requires renewed source review.

Local evidence at base `612a9ab2210eb4b89c27f1e7988880840363026d` plus this patch:

- Clean synthetic Supabase startup applied all migrations and reference seed.
- SQL 023, 028 and 068: **91 assertions passed**, covering source checkout, recurring
  identities, admission/revocation and each NULL-key combination.
- `supabase/migration-tests/r0_checkout_required_fields.sql`: **12 assertions passed**
  via `psql -v ON_ERROR_STOP=1 -f`, with the adjacent `migrations/` directory present.
  This rollback-only test replays the migration over legacy fixtures. Run it separately
  from `supabase test db`, whose test mounts omit the sibling migration directory.
- Unit tests **274/274**, secret scan and whitespace check passed.
- CodeRabbit review was unavailable: the task runtime reports review disabled.

This is local repair evidence; the existing hosted and R1 activation gates remain open.

## Main integration — 2026-09-29, TRACE-101

PR #66 merged into `codex/r0-launch-authority` after that branch had already merged to
`main` (#65), so R0.1 never reached `main`. Branch `codex/r0-admission-main` merges the
recorded #66 head `7e582e6` onto `main` `9cc4295` plus the approved-experience docs
commit `8fcf303`, keeping the evidence SHAs above reachable. It now runs with Phase 6.3
(TRACE-099, `63f1537`/`be58eee`).

- **Migration version collision:** this slice's `20260929000000_r0_checkout_required_fields`
  shared its version with 6.3's `20260929000000_trace099_vendor_request_write_scope`.
  It is renamed `20260929000500`, after 6.3 and before R0.2's `20260929001000`; the SQL
  is unchanged and neither migration touches the other's objects. Hosted has neither
  version. A local database that applied the old R0 version needs a reset.
- **Script fixture:** `phase6-request-submission.mjs` did not admit the provider who is
  also a homeowner, or `tree-trimming` for the mixed-plan check, so default-closed
  admission refused checks 6 and 15 before the behavior they test. Both are now admitted.
  The admission refusal itself remains covered by SQL 068.

Evidence on a throwaway local stack (`mercurius_r0_integration`, ports 5652x) with the
branch config; the Phase 6 stack (5542x) and earlier isolated R0 stack were not touched:

- Clean start applied all migrations in order, including 6.3 and both R0.1 migrations.
- Full SQL suite **3327/3327 across 59 files**. Per file: 023 42/42, 028 20/20,
  063 65/65, 064 16/16, 065 29/29, 066 68/68, 067 (6.3) 54/54, 068 29/29.
- `supabase/migration-tests/r0_checkout_required_fields.sql` via `psql -v ON_ERROR_STOP=1`:
  **12/12**, rolled back.
- Real REST/RPC scripts: `phase6-matching-offers.mjs` (6.3) **11/11**, fixtures cleaned;
  `phase6-request-submission.mjs` **32/32** after the fixture fix (it failed at check 6
  before it). `phase5-concurrency.mjs` including provider refunds: **PASS** after a clean
  reset, run from copies with only the container name changed.
- Unit **299/299**; typecheck, lint, secret scan and `git diff --check` pass.

Not run: CI, Playwright browser suite (no app code changed in R0.1), direct Edge
checkout call, security advisor, hosted checks. Earlier open acceptance items still apply.
