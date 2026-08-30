# Phase 1 Validation

**Date:** 2026-08-29
**Branch:** `codex/rebuild-phase-0-foundation`
**Scope:** Complete the five open deterministic-platform items from the Phase 0/1 baseline
**Production/external mutation:** None; repository branch push and GitHub CI only

## Outcome

Phase 1 is implemented locally. A clean environment now has deterministic tooling, typed and separated configuration boundaries, committed-secret detection, real unit-test tooling, a production dependency audit, and a production build that does not download Google Fonts.

Database/RLS, component accessibility, visual-regression, and E2E suites remain intentionally assigned to their owning roadmap slices. They are not represented by empty scripts.

## Open-item disposition

| Item | Result | Evidence |
|---:|---|---|
| 1. Run GitHub CI | PENDING BRANCH PUSH | Workflow now runs on every branch push and pull request; remote run evidence will be added after push. |
| 2. Dedicated secret scan | COMPLETE | `scripts/scan-secrets.mjs`, two scanner tests, `npm run scan:secrets`, and a dedicated CI step. Findings report location/type without printing the credential. |
| 3. Typed browser/server/Edge environment contracts | COMPLETE | `src/lib/env/*` and `supabase/functions/_shared/env.ts`; direct environment reads were removed from application and payment-function consumers. |
| 4. Test tooling | COMPLETE | Vitest is pinned; five substantive tests pass. Database, accessibility, and E2E commands remain deferred until their real suites exist. |
| 5. Self-host Geist decision | COMPLETE — SELF-HOST | The app imports the pinned `geist` package. A sandboxed build passed without Google Fonts access. |

## Security and configuration notes

- Browser code can access only explicitly named `NEXT_PUBLIC_*` values.
- Server and Edge secrets are read through separate fail-closed contracts.
- Vendor upload grants now use a dedicated, versioned HMAC secret instead of the Supabase service-role key.
- Deploying this branch requires setting `VENDOR_UPLOAD_HMAC_SECRET` to at least 32 random characters and `VENDOR_UPLOAD_HMAC_VERSION` to `v1` in each target Vercel environment. Values must be entered directly in the provider dashboard or approved secret store.
- Rotating that secret and incrementing its version intentionally invalidates outstanding vendor upload grants.

## Local verification

| Check | Result |
|---|---|
| Missing required public environment | PASS — build failed closed with one actionable variable name |
| Valid placeholder public environment | PASS |
| Secret scan | PASS |
| ESLint | PASS |
| Strict TypeScript | PASS |
| Unit tests | PASS — 2 files, 5 tests |
| Production build | PASS — all 56 routes; no external font download |

## Phase gate

Phase 1 is complete when the branch GitHub CI run passes and its URL/conclusion are recorded here. Phase 2 still requires owner confirmation of a current Supabase backup and authorization for a sanitized, read-only schema export before any live schema inventory.
