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
npm run build
npm run check
```

The test, database, accessibility, and E2E commands will be added with their corresponding roadmap slices. A successful build is not a substitute for those acceptance gates.

## Environments

| Environment | Purpose | Data rule |
|---|---|---|
| Local | Development and database reconstruction | Synthetic/reference data only |
| Preview | Pull-request and integrated acceptance | Isolated, sanitized test data only |
| Production | Approved Lee County service | Real data; owner-controlled promotion only |

Production schema, data, billing, domains, secrets, and webhooks must not be changed from routine development commands.

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
