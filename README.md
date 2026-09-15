# Mercurius Marketplace

Mercurius is an owner-operated, managed home-services marketplace for Lee County, Florida. The application includes public discovery and request intake, homeowner and vendor portals, an operational admin console, Supabase-backed marketplace workflows, and customer payment handling.

The repository is undergoing an evidence-driven rebuild. Do not treat inherited behavior as approved product truth.

## Work with the agent in VS Code

Open `mercurius.code-workspace`, then start with the [agent workspace guide](./docs/agent/README.md) and [current handoff](./docs/agent/HANDOFF.md). The workspace includes development and quality tasks; all approved system documents retain their existing paths.

## Governing documents

Read these before changing product behavior or architecture:

- [Owner approvals](./governance/OWNER-APPROVALS.md)
- [Launch configuration](./governance/CONFIGURATION-DECISIONS.md)
- [Approved product system](./mps/PROPOSED-MPS.md)
- [Approved design system](./mds/DESIGN-SYSTEM-BLUEPRINT.md)
- [Approved technology blueprint](./mts/TECHNOLOGY-BLUEPRINT.md)
- [Combined rebuild roadmap](./roadmap/MERCURIUS-REBUILD-ROADMAP.md)
- [Implementation agent rules](./AGENTS.md)

## Requirements

- Node.js 24 LTS (`.nvmrc`)
- npm 11
- A non-production Supabase environment or local Supabase stack
- Stripe test-mode configuration for customer-payment work
- Supabase CLI and Stripe CLI when their roadmap phases begin

Node 24 is the pinned LTS line. The repository currently accepts Node `>=24.11 <25` and npm `>=11 <12`.

## Local setup

```powershell
npm ci
Copy-Item .env.example .env.local
```

Replace placeholders in `.env.local` with development-only values. Never paste secrets into chat, commits, fixtures, screenshots, or command history.

Run the application:

```powershell
npm run dev
```

Open `http://localhost:3000`.

### Local backend reconstruction

Use the same environment for Docker and the Supabase CLI. If Docker and CLI login
are in WSL, run the backend commands in a WSL terminal from this repository root;
Windows and WSL do not automatically share CLI credentials. Local reconstruction
does not require production credentials.

```sh
supabase start
supabase db reset --local
supabase test db
```

The isolated Mercurius stack uses API port `55421`, database port `55422`, Studio
port `55423`, and local mail port `55424`, avoiding the default ports used by other
local projects. `supabase/config.toml` pins PostgreSQL 17. Never add `--linked` or
a production `--db-url` to reset commands.

`npm run db:seed:generate` rebuilds `supabase/seed.sql` from repository catalog
metadata. It adds no customer accounts, live prices, coverage claims, or active
sample-provider proof. `npm run db:types` regenerates the TypeScript schema from
the local database. See the [Phase 2 checkpoint](./governance/PHASE-2-VALIDATION.md)
for recovered history, deployed-function source drift, and verification.

On memory-constrained machines running WSL/Docker, set
`MERCURIUS_BUILD_WORKERS=1` for a low-concurrency `npm run build`. This opt-in
uses the worker-count control verified in the pinned Next.js version and leaves
the default unchanged. It does not skip routes or TypeScript validation.

## Quality commands

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run scan:secrets
npm run audit:prod
npm run build
npm run check
```

`npm run test:unit` and the repository secret scan are active Phase 1 gates.
`npm run test:db` now runs the real database privilege and role-isolation suites
against a running local Supabase stack. Accessibility, visual-regression, and E2E
gates remain assigned to later roadmap slices. A successful build is not a
substitute for those acceptance gates.

## Environments

| Environment | Purpose | Data rule |
|---|---|---|
| Local | Development and database reconstruction | Synthetic/reference data only |
| Preview | Pull-request and integrated acceptance | Isolated, sanitized test data only |
| Production | Approved Lee County service | Real data; owner-controlled promotion only |

Production schema, data, billing, domains, secrets, and webhooks must not be changed from routine development commands.

### Environment ownership

| Variable | Boundary | Local/preview owner | Production owner |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe | Local `.env.local` / Vercel preview | Vercel production |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe | Local `.env.local` / Vercel preview | Vercel production |
| `NEXT_PUBLIC_SITE_URL` | Browser-safe | Local `.env.local` / Vercel preview | Vercel production |
| `SUPABASE_SERVICE_ROLE_KEY` | Next.js server and Edge secret | Local secret store / isolated preview | Vercel or Supabase function secrets, according to consumer |
| `VENDOR_UPLOAD_HMAC_SECRET` | Next.js server secret | Local secret store / Vercel preview | Vercel production |
| `VENDOR_UPLOAD_HMAC_VERSION` | Next.js server configuration | Local `.env.local` / Vercel preview | Vercel production |
| `OWNER_NOTIFICATION_EMAIL` | Next.js server configuration | Local `.env.local` / Vercel preview | Vercel production |
| `RESEND_API_KEY` | Next.js server secret | Local secret store / Vercel preview | Vercel production |
| `RESEND_FROM_EMAIL` | Next.js server configuration | Local `.env.local` / Vercel preview | Vercel production |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase Edge Function | Supabase local/preview | Supabase production |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Supabase Edge Function secrets | Stripe test + Supabase preview | Stripe live + Supabase production |
| `SITE_URL`, `VERCEL_URL` | Supabase Edge Function configuration | Local/preview platform | Production platform |

Copy `.env.example` locally and enter values directly in the relevant local or provider secret store. Never commit `.env.local` or paste values into issues or chat.

Secret rotation is versioned and environment-specific. Rotate preview before production, update every dependent runtime, verify the affected workflow, and then revoke the old value. Rotating `VENDOR_UPLOAD_HMAC_SECRET` also requires incrementing `VENDOR_UPLOAD_HMAC_VERSION`; this deliberately invalidates outstanding upload grants.

Geist Sans and Geist Mono are supplied by the pinned `geist` package. Production builds do not download fonts from Google.

## Current implementation order

1. Deterministic toolchain and quality signal.
2. Reconstructible Supabase backend.
3. Accessible MDS component foundation.
4. Canonical product lifecycle.
5. Customer payment and direct-ACH vendor payout integrity.
6. Role workflow rebuild.
7. Communications, analytics, and operations.
8. Security, recovery, and release automation.
9. Private beta and production evidence gates.

See the combined roadmap for dependencies and completion criteria.

## Safety

- Work on a bounded branch and preserve unrelated changes.
- Use additive database migrations and forward fixes.
- Export schema only after backup confirmation and owner authorization.
- Never export production customer rows as fixtures or seeds.
- Payment work stays in test mode until a separately approved activation gate.
- Every manual provider-dashboard change must be reflected in configuration documentation or a runbook.

## Isolated Edge verification

From the repository directory in WSL, use Deno 2.9.6:

```sh
npm exec --prefix supabase/.audit/tooling --yes --package=deno@2.9.6 -- sh scripts/check-edge.sh
npm exec --prefix supabase/.audit/tooling --yes --package=deno@2.9.6 -- sh scripts/test-edge.sh
```

Both use frozen per-function dependency lockfiles. Tests use synthetic fixtures
without network/process permissions; they do not invoke deployed functions or
prove gateway/provider integration. Package resolution may download dependencies.
Keep heavy checks sequential on memory-constrained machines. Close unused apps
and stop only development stacks you are not using; do not delete Docker volumes
or run cleanup/prune commands to address RAM pressure.

With the isolated local Supabase gateway running on port 55421,
`node scripts/test-edge-gateway.mjs` verifies missing-JWT rejection on all 10
protected functions. It uses no credentials and never targets production.

## MDS catalog checks

The local-only component catalog is documented in [COMPONENT-CATALOG.md](./mds/COMPONENT-CATALOG.md).
For isolated UI testing without a database, use placeholders and Mercurius's own
local backend port (55421), then run these checks sequentially:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:55831'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY='mds-synthetic-anon-key'
$env:MERCURIUS_BUILD_WORKERS='1'
npm run build
npx playwright install chromium
npm run test:a11y
npm run test:visual
```

Playwright starts and stops its own server on port 3103, enables the synthetic
catalog, and blocks requests outside that server. Run the same build with the
catalog disabled for normal app use. Windows screenshot baselines are included;
other operating systems need separately reviewed platform baselines.

The Phase 3 browser suite starts an isolated HTTP fixture on `127.0.0.1:55831`
and the app on `127.0.0.1:3103`. Build with the fixture public URL before running
`npm run test:a11y`. No local Supabase stack is started or reused. The fixture
never forwards requests; its mutation responses are synthetic failures.
Brand export review is available at `/mds/brand` when the catalog is enabled.
