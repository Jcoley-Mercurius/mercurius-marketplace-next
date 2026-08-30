# Mercurius Build Roadmap

**Starting point:** Existing repository at commit `94d608a`
**Roadmap objective:** Move from working development application to a reproducible, payment-safe private beta and then production.
**Implementation rule:** Stabilization slices precede new feature slices.

## 1. How to use this roadmap

Each slice ends with a verification gate and an explicit checkpoint. Do not begin a dependent slice while its gate is red. Product behavior in `PRODUCT.md` and `matching.md`, and design behavior in `DESIGN.md`, remain authoritative.

Work classifications:

- **Agent** — repository work Codex/Claude can implement and verify.
- **Owner** — account, billing, DNS, production data, or risk-acceptance work only the project owner can perform.
- **Joint** — agent prepares evidence; owner approves or performs the external step.

## 2. Starting procedure

### Prerequisites

- Git
- The approved Node LTS version selected in Slice 1
- npm supplied with that Node version
- Docker Desktop or another supported container runtime for Supabase local development
- Supabase CLI
- Stripe CLI for payment integration tests
- Access, when the relevant slice begins, to development/test Vercel, Supabase, Stripe, Resend, DNS, and monitoring accounts

### Initial commands

From a clean clone:

```powershell
git clone https://github.com/Jcoley-Mercurius/mercurius-marketplace-next.git
Set-Location mercurius-marketplace-next
git status --short --branch
npm ci
npm run lint
npx tsc --noEmit
```

Until Slice 2 provides `.env.example`, a build requires valid non-production Supabase public values:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = 'https://YOUR-DEVELOPMENT-PROJECT.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = 'YOUR-DEVELOPMENT-ANON-KEY'
npm run build
```

Never paste a service-role, Stripe, Resend, or production secret into chat, commits, command history, screenshots, or test fixtures.

### Baseline evidence from this audit

- `npm ci`: pass in isolated validation workspace
- `npx tsc --noEmit --pretty false`: pass
- `npm run lint`: pass with 151 warnings from bundled `.claude` skill code
- `npm run build`: pass with placeholder Supabase public configuration; 56 routes generated
- `npm audit --omit=dev`: one high-severity transitive `nanoid` advisory
- Automated tests: unavailable
- Clean Supabase reset: blocked by missing baseline schema

## 3. Owner setup ledger

The agent should create checklists and exact dashboard instructions, but the owner retains authority for these actions:

| External action | When | Completion evidence |
|---|---|---|
| Confirm approved Node LTS | Slice 1 | ADR and CI runtime match |
| Provide development Supabase project access or approve local-only start | Slice 3 | Linked dev project or local reset output |
| Confirm live schema export method and maintenance window | Slice 3 | Sanitized schema artifact and backup confirmation |
| Configure Stripe test account/webhook | Slice 4 | Test endpoint secret stored in Supabase, successful signed event |
| Create Turnstile site | Slice 6 | Preview site/secret keys stored in Vercel |
| Verify Resend sending domain | Slice 7 | SPF/DKIM verified; DMARC plan recorded |
| Configure preview/production Vercel projects or environments | Slice 8 | Isolated variables and protected production promotion |
| Select monitoring/uptime provider and alert recipients | Slice 7 | Test alert acknowledged |
| Implement approved retention and recovery values | Slice 9 | 8-hour RTO, 24-hour RPO, retention jobs, and restore evidence match `governance/CONFIGURATION-DECISIONS.md` |
| Approve private beta | Slice 10 | Release checklist and residual-risk acceptance |
| Approve production activation | Slice 11 | All production gates green |

## 4. Ordered vertical slices

### Slice 0 — Protect the audit baseline

**Outcome:** The current state and intended architecture are visible before implementation changes.

**Agent work:**

1. Review `mts/MTS-AUDIT.md`, `mts/TECHNOLOGY-BLUEPRINT.md`, and this roadmap.
2. Create issue/trackable items for every P0 and P1 finding.
3. Record the current commit and live-environment unknowns.
4. Do not modify production accounts or data.

**Verification gate:** MTS artifacts are reviewed and each blocking finding has an owner.

**Checkpoint:** documentation-only commit.

---

### Slice 1 — Deterministic toolchain and clean quality signal

**Outcome:** Every developer and CI run the same supported toolchain; build validation cannot be bypassed.

**Agent work:**

1. Add `engines` and `.nvmrc` or `.node-version` for the approved Node LTS.
2. Add scripts: `typecheck`, `test`, `test:unit`, `test:db`, `test:e2e`, and `check` as they become available.
3. Remove `typescript.ignoreBuildErrors` from `next.config.ts`.
4. Restrict application ESLint to owned source/config files; ignore `.claude`, `.agents`, `.codex`, build, coverage, and generated outputs.
5. Resolve the high-severity `nanoid` advisory through a supported lockfile update; do not apply an unreviewed major upgrade.
6. Replace the generic README with setup, architecture links, commands, environments, and safety rules.

**Verification:**

```powershell
npm ci
npm run lint
npm run typecheck
npm audit --omit=dev
npm run build
git diff --check
```

**Gate:** zero lint errors; zero TypeScript errors; build performs type validation; no unapproved high/critical production advisory.

**Checkpoint:** `chore/foundation-toolchain`.

---

### Slice 2 — Environment and server-boundary contract

**Outcome:** Local, preview, and production configuration is explicit, validated, and least-privileged.

**Agent work:**

1. Add secret-free `.env.example` despite the general `.env*` ignore rule by explicitly unignoring that file.
2. Implement typed browser/server/Edge Function environment validation.
3. Replace broad service-role client use with narrow server services for vendor applications, document finalization, and coverage lookup.
4. Create a dedicated HMAC secret/version for vendor upload grants; stop reusing the service-role key.
5. Add correlation/request IDs and structured redacted error logging.
6. Document variable ownership and rotation.

**Joint work:** Populate development and preview secrets directly in their platforms.

**Verification:**

- Missing/invalid values fail with one actionable message.
- Browser bundles contain no server-only secret.
- Secret scanning reports no committed credentials.
- Build passes with documented development values.

**Gate:** `.env.example`, validation, and environment matrix approved.

**Checkpoint:** `feat/environment-contract`.

---

### Slice 3 — Reconstructible Supabase foundation

**Outcome:** A blank environment can recreate the complete database, policies, storage, functions, and safe reference data.

**Owner prerequisite:** Confirm a current Supabase backup and authorize a read-only schema export. No customer rows or secrets may be exported.

**Agent work:**

1. Export and inventory the live schema.
2. Compare live objects with all committed migrations and code references.
3. Produce a reviewed baseline migration for missing pre-existing objects.
4. Reconcile migration history without rerunning unsafe statements against production.
5. Add deterministic reference seed data.
6. Add local bucket/function configuration, including per-function `verify_jwt` settings.
7. Generate Supabase TypeScript types.
8. Add database smoke and role-negative RLS tests.

**Verification:**

```powershell
supabase start
supabase db reset
supabase test db
supabase gen types typescript --local
npm run typecheck
npm run test:db
```

Also compare canonical schema fingerprints and confirm no production customer data appears in repository artifacts.

**Gate:** clean reset passes twice; role matrix tests pass; live-to-repository drift is documented and approved.

**Rollback:** No production migration occurs in this slice. If reconciliation is uncertain, stop and preserve the live project unchanged.

**Checkpoint:** `feat/reproducible-supabase-baseline`.

---

### Slice 4 — Payment command integrity

**Outcome:** Retried checkout commands cannot create duplicate invoices or Stripe sessions.

**Agent work:**

1. Add `checkout_attempts` and a collision-safe invoice number sequence.
2. Implement an atomic create-or-reuse checkout RPC.
3. Derive a stable Stripe idempotency key from the persisted attempt.
4. Reuse an unexpired open session on retries.
5. Persist and surface failed/incomplete attempt states.
6. Add reconciliation for attempts with an invoice but no Stripe session, or a Stripe session not persisted locally.
7. Preserve existing server-authoritative price revalidation and promotion rules.

**Tests:**

- double click and concurrent request
- client timeout followed by retry
- Stripe timeout after local invoice creation
- amount/promotion changes between attempts
- recurring and one-time modes
- unauthorized request ownership

**Gate:** one business checkout produces at most one active attempt/invoice/session; tests pass in Stripe test mode.

**Checkpoint:** `fix/payment-checkout-idempotency`.

---

### Slice 5 — Durable Stripe webhook and reconciliation

**Outcome:** No Stripe event is acknowledged until every critical local mutation is confirmed.

**Agent work:**

1. Extend webhook records with processing state, attempts, timestamps, and error details.
2. Centralize Supabase result checking and throw on every critical returned error.
3. Make handlers idempotent at the invoice/request/subscription level, not only event-ID level.
4. Handle duplicate and out-of-order events explicitly.
5. Add replay tooling for failed/dead-letter events.
6. Add scheduled Stripe-to-ledger reconciliation.
7. Alert on webhook age, repeated failure, dead letters, and reconciliation differences.

**Tests:**

- signature rejection
- duplicate delivery
- injected database write failure followed by successful retry
- out-of-order success/failure/refund/dispute events
- partial refund/manual-review path
- subscription renewal and cancellation
- event replay

**Gate:** injected failures never return 2xx; retry restores consistency; reconciliation detects seeded drift.

**Checkpoint:** `fix/payment-webhook-durability`.

---

### Slice 6 — Public-edge security and file safety

**Outcome:** Public forms and upload grants resist automated abuse and excessive resource consumption.

**Agent work:**

1. Add server-verified Turnstile to contact, vendor application, and other public write flows.
2. Add rate limits by IP plus normalized email/identity where appropriate.
3. Enforce request body and document count/size limits before expensive work.
4. Add expired/orphaned vendor-document cleanup.
5. Confirm private bucket policies and signed URL durations.
6. Decide and implement malware scanning or a documented quarantine/manual-review model.
7. Add HTTP security headers and CSP report-only rollout, then enforcement.

**Tests:** valid/invalid/expired Turnstile token, burst limit, oversized request, MIME mismatch, expired grant, cross-application path, orphan cleanup, CSP smoke.

**Gate:** public abuse suite passes; file-access role tests pass; CSP produces no unexplained critical violations.

**Checkpoint:** `feat/public-edge-hardening`.

---

### Slice 7 — Observability, email reliability, and auditability

**Outcome:** Operators can detect, diagnose, and act on failures without reading raw production tables.

**Joint decision:** Select error/uptime tooling and alert recipients.

**Agent work:**

1. Add release-correlated error reporting with PII scrubbing.
2. Add uptime and synthetic checks for public site, login, API, and payment/webhook health.
3. Add structured operational metrics for matching exhaustion, checkout attempts, webhook failures, public abuse, and email failure.
4. Add an admin audit log for approvals, price actions, matching overrides, refunds, disputes, and role changes.
5. Add Resend delivery/error tracking and a retry or operator-recovery path where appropriate.
6. Create dashboards and alert playbooks.

**Owner work:** Verify SPF/DKIM; introduce DMARC monitoring and later enforcement according to the approved mail policy.

**Gate:** a staged error and staged webhook failure trigger the intended alert; logs contain correlation IDs and no prohibited PII/secrets.

**Checkpoint:** `feat/operational-observability`.

---

### Slice 8 — Automated CI/CD and isolated preview

**Outcome:** Every change receives repeatable technical and user-journey validation before production promotion.

**Agent work:**

1. Add GitHub CI for install, lint, type check, unit, database/RLS, integration, build, E2E/axe, dependency, and secret checks.
2. Cache safely without weakening `npm ci` lockfile enforcement.
3. Create isolated preview data/provider configuration.
4. Add migration dry-run and drift checks.
5. Require protected checks and explicit production promotion.
6. Document Vercel rollback and database forward-fix procedure.

**Verification:** Open a test pull request that intentionally breaks type, RLS, E2E, and audit gates one at a time, then confirm each is blocked.

**Gate:** no direct unverified production deployment path remains.

**Checkpoint:** `ci/release-gates`.

---

### Slice 9 — Backup, recovery, retention, and incident response

**Outcome:** The system can recover from deployment error, database loss, storage loss, webhook drift, and secret compromise.

**Approved inputs:** 8-hour beta RTO, 24-hour beta RPO, seven-year financial/completed-service retention, three-year support/message retention, 90-day rejected/abandoned vendor-document retention, 90-day operational-log retention, and project-owner escalation until delegated.

**Agent work:**

1. Document database and storage backup mechanisms separately.
2. Automate backup-success monitoring.
3. Restore a backup into an isolated environment and record timings/evidence.
4. Verify application behavior against restored data.
5. Create incident runbooks for payment drift, auth outage, data exposure, lost storage, bad migration, email/domain issue, and secret compromise.
6. Exercise Stripe replay/reconciliation and Vercel rollback.

**Gate:** restore drill meets approved RPO/RTO; recovery evidence is reviewed.

**Checkpoint:** `docs/operations-recovery` plus infrastructure configuration evidence.

---

### Slice 10 — Characterization tests and modularization

**Outcome:** High-risk workflows can evolve without further monolithic coupling.

**Agent work:**

1. Add characterization tests around the request wizard, vendor package manager, vendor profile, and admin applications.
2. Extract pure validation/calculation modules first.
3. Extract data/query services second.
4. Extract state machines/hooks third.
5. Split presentational sections last while preserving MDS behavior.
6. Maintain route behavior, analytics, accessibility, and visual regression evidence.

**Gate:** no targeted module remains over the agreed complexity threshold without a documented exception; characterization and E2E tests remain green.

**Checkpoint:** one commit per bounded extraction, never a single wholesale rewrite.

---

### Slice 11 — Private beta release

**Outcome:** A sanitized, controlled beta is available for approved reviewers.

**Combined validation:**

- MPS: roles, workflows, pricing, matching, and soft-launch honesty
- MDS: responsive states, accessibility, components, tokens, and copy hierarchy
- MTS: security, payments, tests, observability, recovery, deployment, and operations

**Required evidence:**

```powershell
npm ci
npm run check
npm run test:db
npm run test:e2e
npm run build
npm audit --omit=dev
```

Also attach clean database reset, Stripe test suite, RLS matrix, preview smoke, alert test, and rollback/recovery evidence.

**Owner work:** Review the beta with sanitized data and approve or reject advancement. Real payments and real customer data remain disabled unless production gates are separately approved.

**Gate:** all P0 and P1 findings closed; residual P2 items are owned and scheduled.

**Checkpoint:** signed beta release record and tagged release candidate.

---

### Slice 12 — Production activation

**Outcome:** Mercurius accepts real users and payments with verified operational safeguards.

**Owner actions:**

- Promote production Vercel/Supabase/Stripe/Resend/Turnstile settings directly in provider dashboards.
- Verify domains, email authentication, webhook destination/events, alert contacts, billing, and backup plan.
- Approve the release checklist and residual risk.

**Agent/joint verification:**

1. Apply reviewed migrations under the approved procedure.
2. Deploy Edge Functions with committed JWT settings.
3. Deploy the web application.
4. Run production-safe smoke checks.
5. Process a controlled low-value payment/refund if owner policy permits.
6. Confirm webhook, invoice, request, notification, logs, alerts, and reconciliation.
7. Confirm backup success and rollback readiness.

**Gate:** every production check is green; otherwise execute the documented rollback/forward-fix path.

## 5. Dependency map

```text
Slice 0
  → Slice 1 toolchain
  → Slice 2 environment
      → Slice 3 database baseline
          → Slice 4 checkout integrity
              → Slice 5 webhook durability
      → Slice 6 public security
      → Slice 7 observability
  → Slice 8 CI/CD (consumes tests from 3–7)
      → Slice 9 recovery
      → Slice 10 modularization
          → Slice 11 private beta
              → Slice 12 production
```

Slices 6 and 7 may run in parallel after Slice 2. Payment slices 4 and 5 must remain ordered. Production feature work that touches requests, invoices, matching, roles, or storage must wait for the relevant stabilization gate.

## 6. Commit and rollback policy

- One concern per branch/checkpoint; never mix schema repair, payment changes, and visual redesign.
- Capture baseline behavior before refactoring.
- Prefer additive database changes, backfills, then constraint enforcement.
- Never roll back a production database with destructive source-control commands.
- Use application rollback only when it remains compatible with the migrated schema.
- Payment changes require test-mode replay and reconciliation before merge.
- Every manual dashboard change must be mirrored in a runbook/config artifact and independently verified.

## 7. Progress report template

After every slice, report:

```text
Slice:
Status: complete | blocked | in progress
Repository changes:
External changes:
Automated checks and exact results:
Manual checks and evidence:
Security/data/payment impact:
Rollback status:
Open risks or decisions:
Owner action required:
Exact next slice:
```

## 8. Immediate next action

Start **Slice 0**, review the audit/blueprint, then execute **Slice 1 — Deterministic toolchain and clean quality signal**. Do not begin new marketplace features until the P0 database and payment work has accountable owners and scheduled implementation.
