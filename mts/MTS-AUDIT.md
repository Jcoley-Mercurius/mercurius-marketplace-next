# Mercurius Technology System Audit

**Repository:** `Jcoley-Mercurius/mercurius-marketplace-next`
**Audited commit:** `94d608a` (`main`)
**Audit date:** 2026-08-29
**Mode:** Existing-repository audit
**MTS readiness:** **BLOCKED — suitable for controlled development, not production activation**

## 1. Executive assessment

Mercurius is a substantial working marketplace application, not a shell. It contains 56 Next.js routes, homeowner/vendor/admin portals, Supabase authentication and data access, a database-authoritative matching engine, Stripe checkout and webhook functions, Resend owner notifications, private document and job-photo flows, and written product/design/matching contracts.

The implementation has several strong foundations: role-aware route protection, server-side price revalidation, signed upload grants, Stripe signature verification, webhook event deduplication, RLS-oriented migrations, deterministic matching rules, and honest soft-launch product constraints.

It is not yet production-ready because critical operational truth exists only in the live Supabase project, payment mutations can acknowledge failed database writes, checkout creation is not idempotent, and the repository has no automated test or delivery gate. Production builds also skip TypeScript validation even though the current standalone type check passes.

### Readiness scorecard

| Domain | Score | Status | Summary |
|---|---:|---|---|
| Product and design alignment | 8/10 | Strong | `PRODUCT.md`, `DESIGN.md`, and `matching.md` provide useful constraints. |
| Application architecture | 6/10 | Attention | Clear role surfaces and reusable libraries, but critical UI modules exceed 1,000–2,000 lines. |
| Data architecture | 4/10 | Blocked | Additive migrations exist, but the baseline schema, seed/reference data, and generated types are absent. |
| Identity and authorization | 6/10 | Attention | Supabase Auth, role RPCs, proxy gates, and RLS patterns are present; the complete live policy set is not auditable. |
| Payment integrity | 3/10 | Blocked | Signature and refund safeguards are good; checkout and webhook persistence have correctness gaps. |
| Application security | 4/10 | Attention | Input validation is present; abuse protection, security headers, secret validation, and a complete security test suite are absent. |
| Quality engineering | 2/10 | Blocked | Type check passes, but no unit, integration, database, E2E, accessibility, or payment tests are configured. |
| Delivery and operations | 2/10 | Blocked | No CI workflow, environment contract, deployment runbook, monitoring contract, backup proof, or rollback proof. |
| Repository documentation | 3/10 | Attention | Product/design/matching docs exist, but README and technology/operations documentation are incomplete. |

**Overall MTS assessment: 4/10.** Continue development, but do not activate real customer payments or depend on repository-based disaster recovery until all P0 gates are closed.

## 2. Scope and evidence

The audit inspected:

- Next.js application routes, layouts, providers, hooks, UI components, and libraries
- Supabase browser/server clients and proxy authorization
- Four Next.js API endpoints
- Fourteen Supabase migrations and three Edge Functions
- Stripe checkout, webhook, dispute, refund, and invoice flows
- Package manifest and lockfile
- Repository instructions and product/design/matching contracts
- Environment-variable usage and secret boundaries
- Build, lint, TypeScript, and dependency-audit results

Repository size at the audited commit:

- 153 TypeScript/TSX/SQL files under `src` and `supabase`
- Approximately 28,913 lines in those files
- 56 application routes reported by the production build
- 14 committed database migrations
- 3 committed Supabase Edge Functions

## 3. Validation results

| Check | Result | Evidence |
|---|---|---|
| Locked dependency install | Pass | `npm ci` completed in an isolated copy of the audited commit. |
| TypeScript | Pass | `npx tsc --noEmit --pretty false` exited 0. |
| ESLint | Pass with noise | `npm run lint` exited 0 with 151 warnings, all emitted from bundled `.claude/skills/impeccable` files. |
| Production build without environment | Fail as configured | Build prerendering fails because Supabase public values are not defined and no environment contract is supplied. |
| Production build with non-secret placeholder Supabase values | Pass | Next.js compiled and generated all 56 routes. The build explicitly reported `Skipping validation of types`. |
| Production dependency audit | Fail | `npm audit --omit=dev` found 1 high-severity transitive advisory: `nanoid@3.3.17`, reached through Next/PostCSS. |
| Automated tests | Not available | No `test` script, test runner configuration, or test files are committed. |
| Clean database bootstrap | Not possible | The first migration references pre-existing tables/functions that are not created by any committed migration. |

The build was verified with placeholder values only. No live Supabase, Stripe, Resend, Vercel, or production data was accessed or mutated.

## 4. Priority findings

### P0 — Must close before production activation

#### MTS-P0-01: The database cannot be reconstructed from the repository

The earliest migration creates `package_promotions` but immediately references `vendor_packages`, `package_tiers`, `contractors`, `service_requests`, `invoices`, `has_role`, and `update_updated_at_column`. No committed baseline migration creates these dependencies. Later migrations depend on many more live-only tables, enums, functions, policies, triggers, buckets, and reference rows.

**Impact:** a clean local environment, preview database, disaster recovery, or new production project cannot be created from source control. The live Supabase project is an undocumented single source of truth.

**Required action:** export the authoritative schema without customer data, reconcile it into an idempotent baseline, add ordered migrations for every later change, add safe reference seed data, and prove `supabase db reset` plus schema verification from a blank database.

#### MTS-P0-02: Stripe webhook handlers can acknowledge failed database mutations

The webhook inserts its deduplication row before processing and correctly deletes it when an exception is thrown. However, many Supabase updates/inserts do not inspect their returned `error`. Supabase returns errors as values rather than throwing them. Examples include subscription status writes, renewal invoice inserts, payment/refund/dispute updates, contractor payout pauses, and fallback job updates.

**Impact:** a database write can fail, the handler can still return HTTP 200, and the dedup row can permanently suppress Stripe retries. Stripe and Mercurius can then disagree about payment, refund, dispute, subscription, or payout state.

**Required action:** wrap every event in an explicit processing transaction/state machine; check every database result; store `received`, `processing`, `processed`, and `failed` states plus attempt/error metadata; return non-2xx on incomplete critical persistence; add replay tooling and integration tests.

#### MTS-P0-03: Checkout creation is not idempotent or concurrency-safe

Both subscription and one-time checkout paths call Stripe without an idempotency key. One-time checkout creates an invoice before creating the Stripe session. Repeated requests, network retries, or double clicks can therefore create multiple invoices or sessions. Invoice numbers are generated using `count + 1`, which races under concurrency and does not survive deletion/import safely.

**Impact:** duplicate payment sessions, conflicting pending invoices, invoice-number collisions, and manual reconciliation risk.

**Required action:** create a database checkout-attempt record with a unique business key, generate invoice numbers from a sequence, pass a stable Stripe idempotency key, reuse an existing open session, and reconcile incomplete attempts.

#### MTS-P0-04: No automated release gate protects critical behavior

The repository contains no unit, integration, database/RLS, Edge Function, E2E, accessibility, or payment tests and no CI workflow. `package.json` exposes only `dev`, `build`, `start`, and `lint`.

**Impact:** matching, authorization, pricing, payment, refund, and migration regressions can reach production without machine-verifiable evidence.

**Required action:** establish the test pyramid and make install, lint, type check, tests, clean database reset, and production build required CI checks.

### P1 — Required for a safe private beta

#### MTS-P1-01: Production builds bypass TypeScript validation

`next.config.ts` sets `typescript.ignoreBuildErrors: true`. The current standalone type check passes, so the bypass has no present benefit.

**Action:** remove the bypass and make `npm run typecheck` a required independent CI gate.

#### MTS-P1-02: Public write and upload-grant endpoints lack abuse controls

Contact submissions and vendor applications are public. Vendor application submission uses the Supabase service-role key to create records and signed storage upload URLs. The inspected routes have payload limits but no rate limiting, Turnstile/CAPTCHA verification, request-size gate, IP/email throttling, or abuse alerting.

**Action:** add edge rate limits, Turnstile verification, explicit request body limits, per-identity quotas, upload cleanup, and abuse metrics before public promotion.

#### MTS-P1-03: The environment and secret contract is undocumented

The app uses Supabase, Stripe, Resend, site URL, and notification variables, but `.env*` is globally ignored and no `.env.example`, schema validator, environment ownership matrix, or startup validation exists. Browser clients use non-null assertions and fail during prerender when values are absent.

**Action:** commit a secret-free `.env.example`, validate values at build/start boundaries, document Vercel/Supabase ownership, and distinguish browser-safe from server-only variables.

#### MTS-P1-04: Supabase function deployment settings are not reproducible

`supabase/config.toml` and `supabase/functions/config.toml` contain only a project ID. The Stripe webhook requires unauthenticated delivery followed by Stripe signature verification, but the required `verify_jwt = false` function setting is not committed. Function import/deploy commands and secret ownership are also absent.

**Action:** commit per-function JWT settings and deployment commands; verify checkout/refund remain authenticated and webhook remains signature-authenticated.

#### MTS-P1-05: The public application lacks an explicit HTTP security-header policy

No Content Security Policy, HSTS, frame-ancestor/X-Frame-Options, Referrer-Policy, Permissions-Policy, or content-type header configuration was found in `next.config.ts` or a deployment file.

**Action:** define and test headers, including Stripe/Supabase/Resend/image/font allowlists. Start CSP in report-only mode, then enforce it.

#### MTS-P1-06: Dependency audit reports a high-severity transitive vulnerability

The lockfile resolves `nanoid@3.3.17` through Next/PostCSS. `npm audit --omit=dev` reports one high-severity advisory with a fix available.

**Action:** update the lockfile through the supported Next/PostCSS dependency path, rerun build/tests, and require zero high/critical production advisories or a documented time-bound exception.

#### MTS-P1-07: Runtime and toolchain versions are not pinned

The repository has no `engines`, `.nvmrc`, or `.node-version`. The audit host used Node 24.15.0 while the project declares `@types/node ^20`.

**Action:** select an approved Node LTS line, pin it for local development and CI, record npm policy, and test the build only on that line.

#### MTS-P1-08: Live authorization and storage policy coverage is unknown

The committed migrations demonstrate good RLS intent, but the missing baseline prevents a complete review of tables, grants, functions, role membership, storage buckets, and every policy. Several admin screens make direct browser-to-database mutations and therefore depend entirely on correct RLS.

**Action:** export and review the complete live schema; add role-by-role negative RLS tests; verify anon, homeowner, vendor, admin, and service-role capabilities.

### P2 — Stabilization and maintainability

#### MTS-P2-01: Critical screens are oversized and tightly coupled

Examples include `src/app/request/page.tsx` (over 2,200 lines), `VendorPackagesManager.tsx` (over 1,600), vendor profile (over 1,200), and admin applications (over 1,000).

**Action:** extract domain services, schemas, state machines, query modules, and presentational sections behind characterization tests. Do not rewrite these flows wholesale.

#### MTS-P2-02: Supabase database types are not generated

Queries rely heavily on hand-authored types, casts, string table/function names, and untyped RPC payloads.

**Action:** generate database types from the canonical schema and use typed clients in browser, server, and test code.

#### MTS-P2-03: Lint scope includes bundled agent tooling

ESLint reports 151 warnings from `.claude/skills/impeccable`, obscuring application signal and wasting CI resources.

**Action:** ignore `.claude/**`, `.agents/**`, `.codex/**`, and generated/vendor assets in application linting; lint skill packages separately only when they are intentionally maintained here.

#### MTS-P2-04: Operations and recovery are undocumented

No monitoring, alert routing, incident response, backup/restore proof, migration rollback, webhook replay, key rotation, or post-deployment verification runbook is committed.

**Action:** implement the operating model in the Technology Blueprint and prove it before real-customer activation.

## 5. Repository reconciliation

| Classification | Existing implementation |
|---|---|
| **KEEP** | Next.js App Router foundation; TypeScript strict mode; npm lockfile; Supabase SSR/browser split; server-side proxy role gate; product/design/matching contracts; database-authoritative package pricing; matching RPC direction; Stripe signature verification; signed vendor-upload grants; refund idempotency key; soft-launch honesty constraints. |
| **CONFIGURE** | Node/npm version policy; environment schema; Vercel environments; Supabase function JWT settings; security headers; rate limits; Turnstile; alerts; backups; retention; domains and webhook endpoints. |
| **EXTEND** | Database migration history; generated DB types; payment attempt ledger; webhook processing ledger; test suites; CI; observability; audit logging; deployment and recovery runbooks. |
| **INTEGRATE** | Vercel deployments, Supabase local/preview projects, Stripe test/live modes, Resend verified domain, abuse protection, error monitoring, uptime monitoring. |
| **BUILD** | MTS artifact set, `.env.example`, CI workflows, test fixtures, schema verification, operational dashboards, restore drill, webhook replay tool. |
| **REPLACE** | `ignoreBuildErrors`; count-based invoice numbers; non-idempotent checkout creation; fire-and-forget webhook database mutations. |
| **DEPRECATE** | Further growth of multi-thousand-line route/components; implicit live-database knowledge; generic create-next-app README. |
| **UNKNOWN** | Exact live schema/policy drift; Vercel settings; Supabase Auth settings; deployed Edge Function JWT flags; Stripe webhook subscriptions; secret rotation; production traffic/data; backup status; alerting; DNS/email authentication. |

## 6. Capability matrix

| Capability | Current evidence | MTS state | Next gate |
|---|---|---|---|
| Public marketing/catalog | Implemented routes and live-data hooks | Keep/verify | Content, SEO, accessibility, and soft-launch truth E2E checks |
| Homeowner authentication/portal | Supabase Auth and homeowner routes | Extend | Complete RLS and auth lifecycle tests |
| Vendor onboarding/portal | Application API, signed uploads, vendor routes | Extend | Abuse protection, cleanup, document scanning decision |
| Admin operations | Broad admin route set and proxy role gate | Extend | Full admin RLS matrix and audit log |
| Matching | Written spec and SQL engine migrations | Keep/verify | Clean-db tests for eligibility, ranking, concurrency, expiry |
| Package pricing/promotions | Database RPC price resolution | Keep/verify | Boundary/concurrency tests and migration baseline |
| Payments/subscriptions | Stripe Edge Functions | Replace critical internals | Idempotent checkout and durable webhook state machine |
| Refunds/disputes | Admin-authenticated refund and webhook flows | Extend | End-to-end test-mode scenarios and reconciliation |
| Messaging/notifications | Database UI plus Resend owner notifications | Extend | Delivery status, retry policy, privacy/retention |
| File storage | Vendor documents and job photos | Extend | Full policies, malware strategy, lifecycle, backup/restore |
| Analytics/observability | No auditable implementation | Build | Privacy-approved event/error/uptime plan |
| CI/CD | No workflow | Build | Required checks and protected promotion path |
| Backup/recovery | No repository evidence | Build | Database/storage backup and restore proof |

## 7. Release gates

### Development gate

- Locked install, lint, type check, and placeholder-configured build pass.
- Developers can create a local environment from documented prerequisites.

### Private beta gate

- P0-01 through P0-04 closed.
- All P1 security/configuration findings closed or explicitly risk-accepted with an owner and expiration date.
- Test-mode payment, refund, dispute, auth, role, upload, and matching scenarios pass.
- Preview environment contains sanitized data only.

### Production gate

- Clean database bootstrap and restore drill pass.
- Stripe reconciliation and webhook replay pass.
- RLS negative tests pass for every role.
- High/critical dependency advisories are zero or time-bound and approved.
- Security headers, rate limits, abuse protection, logging, alerts, backup, rollback, and incident response are verified.
- Real secrets and live data are never placed in source control or test fixtures.

## 8. Audit conclusion

Mercurius has enough product and implementation depth to preserve and harden. A rewrite is not justified. The correct path is a stabilization program: make infrastructure reproducible, repair payment idempotency and event persistence, establish automated gates, then modularize high-risk flows while continuing vertical product delivery.

The companion [Technology Blueprint](./TECHNOLOGY-BLUEPRINT.md) defines the target architecture. The [Mercurius Build Roadmap](./MERCURIUS-BUILD-ROADMAP.md) turns this audit into an ordered, executable plan.
