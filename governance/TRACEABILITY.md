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

Status values: `PLANNED`, `IN PROGRESS`, `BLOCKED`, `COMPLETE`, `DEPRECATED`.
