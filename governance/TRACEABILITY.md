# Mercurius Implementation Traceability

Every material rebuild item must connect approved intent to implementation and evidence.

| ID | Requirement / finding | Authority | Roadmap phase | Implementation | Automated evidence | Manual evidence | Status |
|---|---|---|---:|---|---|---|---|
| TRACE-001 | Deterministic supported Node/npm runtime | MTS Blueprint §2; Roadmap Phase 1 | 1 | `.nvmrc`, `package.json` engines/packageManager | Local locked install passes; CI workflow pins `.nvmrc` | Baseline validation report | COMPLETE |
| TRACE-002 | Build must enforce TypeScript | MTS Roadmap Slice 1 | 1 | Remove `ignoreBuildErrors`; add `typecheck` | `npm run typecheck`, `npm run build` pass | Baseline validation report | COMPLETE |
| TRACE-003 | Owned-code lint signal | MTS Roadmap Slice 1 | 1 | ESLint ignores generated/tooling and Deno function code | `npm run lint` passes with no reported warning/error | Baseline validation report | COMPLETE |
| TRACE-004 | Secret-free, typed environment contract | MTS Blueprint; Roadmap Phase 1 | 1 | `.env.example`, browser/server/Edge validators, README matrix | Missing values fail closed; unit tests and CI build cover the contract | No real value committed | COMPLETE |
| TRACE-005 | Approved systems govern implementation | Owner approvals; Roadmap Phase 0 | 0 | `AGENTS.md`, decision log, this matrix | Documentation link check (pending) | Owner approval record | COMPLETE |
| TRACE-006 | Dedicated committed-secret detection | MTS Blueprint; Roadmap Phase 1 | 1 | `scripts/scan-secrets.mjs`, CI gate | Scanner unit tests and `npm run scan:secrets` | GitHub run after branch push | COMPLETE |
| TRACE-007 | Real test tooling without empty gates | Roadmap Phase 1 | 1 | Vitest and unit test suite; database/E2E gates deferred to owning slices | `npm run test:unit` | Phase 1 validation report | COMPLETE |
| TRACE-008 | Deterministic self-hosted Geist | MDS Blueprint; Roadmap Phase 1 | 1 | Pinned `geist` package; no `next/font/google` import | Sandboxed build passes without Google Fonts access | Phase 1 validation report | COMPLETE |
| TRACE-009 | Reconstruct the live Supabase backend without exporting production data | MTS-P0-01; Roadmap Phase 2; DEC-2026-001; DEC-2026-002; DEC-2026-004 | 2 | Recovered migrations and Edge sources/JWT settings, reference seeds, local config/types, locked Edge dependencies | Two clean resets; identical schema/type fingerprints; 35 database assertions; 48 unit/contract tests; 11 Deno checks; 26 isolated runtime tests; 10 gateway rejection checks | Owner-approved drift and closeout; remaining lifecycle/scheduler work assigned to TRACE-010; production unchanged | COMPLETE |
| TRACE-010 | Admin review for unconfirmed completion and verified Supabase Cron lifecycle processing | MPS §6.4; CFG-008/009; DEC-2026-003/004 | 4 | Replace inherited auto-confirmation; specify escalation deadline; secure inactive schedule then reviewed activation | Required: authenticated gateway-to-worker integration, transition/timeout boundaries, concurrency, failure and notification deduplication tests | Supabase Cron installed; no job active; four-hour vendor offer window remains distinct from completion confirmation | PLANNED |
| TRACE-011 | Accessible component and navigation foundation | MDS §§3–8; Roadmap Phase 3 | 3 | Shared primitives, form/status/confirmation patterns, sheet composition, focus targets and component catalog | Playwright/axe, keyboard/focus, reflow, themes and screenshot evidence in PHASE-3-VALIDATION.md | Critical request/admin/vendor/homeowner journeys and brand review kit covered; manual screen-reader/zoom, brand approval and cross-platform visual gates remain open | IN PROGRESS |

Status values: `PLANNED`, `IN PROGRESS`, `BLOCKED`, `COMPLETE`, `DEPRECATED`.
