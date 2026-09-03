# Phase 2 — backend reconstruction checkpoint

**Date:** 2026-09-03
**Status:** COMPLETE — owner accepted reconstruction and documented drift; remaining lifecycle/scheduler work assigned to Phase 4 (DEC-2026-004)
**Branch:** `codex/reproducible-supabase-baseline`
**Starting checkpoint:** `564480a`
**Authority:** Roadmap Phase 2; DEC-2026-001; TRACE-009

## Access and safety

The owner confirmed a current backup and authorized read-only, schema-only
inventory. Authentication works through the owner's WSL CLI; the earlier Windows
CLI could not see that environment's credentials. Docker is also available in
WSL. No production migration, repair, reset, deployment, customer query, storage
object download, or secret export was performed.

The local stack is isolated on ports 55420–55427 and PostgreSQL 17. The unrelated
`home-school-haven` stack was left running and unchanged. The repository pins
Supabase CLI 2.116.0. Initial recovery used the existing WSL CLI 2.111.0; CLI
2.116.0 is now available through an isolated npm cache for final verification.

Raw schema audit files and generated local runtime secrets are ignored by Git.
Schema exports contained no COPY or INSERT statements. Fetched migration SQL was
reviewed for top-level DML and credential patterns: it contains historical
reference/sample seeds, bucket definitions, backfills, and runtime-generated
worker-token initialization, not a dump of current customer rows or secrets.

## Recovered database boundary

- Recovered 83 missing historical migrations from the linked project's migration
  history without modifying the original 14 repository migrations.
- Added one local-only canonical grant migration: 98 migration files total.
- All 26 literal application SQL RPC references and all referenced database
  relations now have source definitions. `job-photos` and `vendor-documents` are
  storage buckets, not missing tables.
- A schema-only public-schema comparison before the new grant migration found
  the same 310 named tables/functions/types/sequences/policies/triggers locally
  and live, with no named objects unique to either side. This is an object-name
  comparison, not proof of full semantic equivalence. Remaining SQL differences
  included comments and privileges and require final canonical fingerprinting.
- All 42 public tables have RLS enabled.
- Generated `src/lib/supabase/database.types.ts` from the reconstructed local DB.
- Added repeatable source/migration/Edge Function inventory tooling.

## Intentional local grant reconciliation

The recovered history did not recreate the effective live grants consistently.
The forward migration removes client TRUNCATE/TRIGGER/REFERENCES and sequence
UPDATE rights, closes internal worker/webhook state to browser roles, and makes
future objects closed by default. Authenticated CRUD is governed by table RLS;
anonymous grants are limited to public discovery and the two intake forms.
Contractor email/phone remain excluded from both browser roles' SELECT projection;
anonymous review reads exclude `customer_id`. Public RPC execution is an explicit
four-function allowlist; authenticated RPCs retain their actor/ownership checks.

This migration has been applied only to the disposable local database. It is not
approved for production application. The owner accepted this documented local
difference for the reconstruction checkpoint in DEC-2026-004.

## Safe reference seeds

`npm run db:seed:generate` produces six categories and 45 service references from
repository-owned catalog metadata. Stable IDs and timestamps make those reference
rows deterministic and conflict-safe. Seeds contain no accounts, production
prices, customer rows, coverage assertions, or live provider proof. The eight
explicitly labelled sample providers inherited from historical migrations are
made inactive locally, rather than presenting synthetic ratings/job counts as
active supply. Historical migrations themselves remain intact.

## Verification so far

| Check | Result |
|---|---|
| Initial clean reconstruction of the 97 recovered/original migrations | PASS |
| New grant migration applied locally | PASS |
| Earlier reset with CLI 2.111.0 | SQL replay passed; Storage health timeout, not counted toward final gate |
| Final chain with CLI 2.116.0 | PASS — two consecutive clean resets of all 98 migrations plus seed |
| Post-reset database tests | PASS — all 35 assertions after each final reset |
| Two-reset public schema fingerprint | PASS — byte-identical exports, SHA256 `4a5099ec08b42e3ebdf46edd64e67f870e89eabf925ee62ab0e08102c51a816c` |
| Database privilege and five-role isolation suites | PASS — 2 files, 35 assertions |
| Reference seed generation/application | PASS — 6 categories, 45 services, 8 demo providers deactivated |
| Local TypeScript binding generation | PASS |
| Pinned-CLI regenerated binding | PASS — byte-identical, SHA256 `05593f996d8e2c0e717b28c69706100671afd8dfcb915cb81b33bb6ed326ad37` |
| TypeScript check | PASS |
| Production build with local placeholders and one worker | PASS — all 56 static pages generated; TypeScript enabled |
| Lint | PASS after excluding generated Supabase runtime/cache directories |
| Unit, Edge source/JWT, and worker-limit tests | PASS — 4 files, 48 assertions |
| Reference seed regeneration | PASS — byte-identical output |
| Repository credential-pattern scan | PASS; not a guarantee that all possible secrets can be detected |
| Tracked-file whitespace check | PASS |
| Edge dependency resolution and Deno type checks | PASS — all 11 functions, Deno 2.9.6; per-function configs and lockfiles |
| Isolated Edge handler runtime tests | PASS — 26 tests across all 11 functions; synthetic fixtures, no network/process permission |
| Read-only production scheduler metadata | OBSERVED — zero rows in `cron.job`; external scheduler not yet identified |
| Local gateway missing-JWT rejection | PASS — all 10 JWT-protected functions return 401 before handler execution |

Role tests cover anonymous private-table/contact denial, homeowner cross-account
read/write denial and privilege-escalation denial, vendor assignment isolation,
admin read access without worker-secret access, service-role processing access,
and rejection of admin role injection through signup metadata. All fixtures roll
back and use synthetic identities.

## Deployed Edge Function recovery

The owner granted source/JWT export authorization in DEC-2026-002. All 11 deployed
functions and their JWT settings were exported read-only, and the eight missing
entrypoints below are now restored. No app-invoked function remains without
local source. See `EDGE-FUNCTION-RECOVERY.md` and `EDGE-FUNCTION-INVENTORY.json`
for exact provenance, preserved implementation differences, and runtime limits.

### Original gap (now recovered)

At the start of recovery, read-only metadata showed 11 active deployed functions,
but only three had repository source (`checkout-request`, `refund-invoice`, and
`stripe-webhook`). No prior local copy of the other sources was found.

| Missing deployed source | Evidence of dependency |
|---|---|
| `create-checkout` | Homeowner dashboard invocation |
| `customer-portal` | Homeowner dashboard invocation |
| `list-payment-methods` | Homeowner dashboard invocation |
| `vendor-invite` | Admin application invocations |
| `job-lifecycle-worker` | Worker-token initialization in recovered migration; full scheduling contract not yet reconciled |
| `beta-access` | Deployed metadata; current necessity not yet classified |
| `loyalty-recommend` | Deployed metadata; current necessity not yet classified |
| `vendor-application-notify` | Deployed metadata; current necessity not yet classified |

The recovered source has not been invoked against production, redeployed, or
deleted. The three existing local implementations were preserved. In particular,
the local Stripe webhook starts provider matching while the live version moves
paid jobs directly to `in_progress`; the owner accepted this documented difference
for the checkpoint, not for production deployment (DEC-2026-004).

## Closeout and follow-up ownership

1. The owner approved documented function/grant drift for this checkpoint and
   authorized commit, push, and PR creation (DEC-2026-004).
2. TRACE-010 / Phase 4 owns the remaining authenticated gateway and actual
   scheduler-to-worker integration, policy corrections, duplicate-run protection,
   failure tests, secure configuration, and activation planning. These are
   explicitly deferred, not represented as verified or production-ready.
3. Unconfirmed completion must escalate to admin review instead of automatic
   homeowner confirmation. Phase 4 must define its deadline separately from the
   four-hour vendor offer window. The recovered worker is not yet changed.
4. The two-reset, database-test, schema-fingerprint, and generated-type gates
   passed. Phase 5 owns provider/payment/payout integration and integrity work;
   optional legacy integrations remain inactive pending their owning slices.

This report accompanies the owner-authorized Phase 2 commit and pull request.
Production remains unchanged; PR creation does not authorize merge or deployment.

## Edge runtime and scheduler follow-up

`scripts/check-edge.sh` and `scripts/test-edge.sh` use Deno 2.9.6 and frozen
per-function lockfiles. Floating Supabase major imports resolve explicitly to
2.112.0; existing exact 2.45.0 and Stripe 17.5.0 imports remain unchanged. Two
existing helper annotations in checkout/refund now use `SupabaseClient` rather
than generic `ReturnType<typeof createClient>`; these are type-only corrections.

The runtime suite loads actual handlers and SDKs, captures `Deno.serve`, substitutes
synthetic environment values, and intercepts HTTP with allowlisted fixtures.
It checks boot/preflight, missing credentials/signatures, beta token issuance and
tamper rejection, non-admin invitation denial, invalid worker-secret denial, and
an empty valid worker batch. No customer data, email, payment, AI, account creation,
or production lifecycle calls are involved. The legacy notification handler's
unauthenticated 200/unemailed fallback is characterized, not security-approved.

The owner's scheduler-verification request authorized a read-only metadata SELECT
using `scripts/inspect-worker-schedule.sql`. The linked result was
`total_job_count=0`, `worker_job_count=0`, `worker_jobs=[]`. No command text,
headers, secret values, customer rows, or execution output was selected. This
establishes no database cron jobs at inspection time, not absence of an external
scheduler. The owner was asked to identify any existing external scheduler.
The reduced local database/Kong/Edge stack also passed all 10 missing-JWT
rejection checks using `node scripts/test-edge-gateway.mjs`. The initial probe
during startup returned ECONNRESET; after health readiness, the full suite passed.
This proves the unauthenticated gateway boundary, not authenticated SDK execution,
Stripe signature success, or an actual scheduler-to-worker run. The local stack
was then stopped with data preserved; the unrelated project was left untouched.

No scheduler has been created or enabled. Activation would execute inherited
lifecycle policies and needs a separately reviewed plan and authorization.

## Local resource constraint

The default Windows build compiled and passed TypeScript but crashed a static
generation worker with exit code 3221226505. A read-only memory check observed
about 138 MB free physical memory while two local Supabase stacks were running.
This supports memory pressure as a likely contributor, not a proven sole cause.
After database verification, only the Mercurius stack was stopped; its data were
preserved in Docker volumes and the unrelated stack was left alone.

The Next.js skill and pinned implementation guided an opt-in
`MERCURIUS_BUILD_WORKERS` setting (1–16, default unchanged). It limits concurrency
without skipping routes or TypeScript. Six tests cover default, valid, and invalid
settings. Build verification uses local URLs and placeholder credentials.
The retry passed compilation, TypeScript, and all 56 static pages with one worker.
