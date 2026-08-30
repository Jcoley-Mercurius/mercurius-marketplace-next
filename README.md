# Mercurius Marketplace

Mercurius is an owner-operated, managed home-services marketplace for Lee County, Florida. The application includes public discovery and request intake, homeowner and vendor portals, an operational admin console, Supabase-backed marketplace workflows, and customer payment handling.

The repository is undergoing an evidence-driven rebuild. Do not treat inherited behavior as approved product truth.

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

`npm run test:unit` and the repository secret scan are active Phase 1 gates. Database/RLS, accessibility, visual-regression, and E2E commands will be added only when their corresponding roadmap slices supply real tests; no empty passing scripts are used. A successful build is not a substitute for those acceptance gates.

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
