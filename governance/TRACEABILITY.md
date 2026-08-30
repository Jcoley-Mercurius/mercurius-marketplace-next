# Mercurius Implementation Traceability

Every material rebuild item must connect approved intent to implementation and evidence.

| ID | Requirement / finding | Authority | Roadmap phase | Implementation | Automated evidence | Manual evidence | Status |
|---|---|---|---:|---|---|---|---|
| TRACE-001 | Deterministic supported Node/npm runtime | MTS Blueprint §2; Roadmap Phase 1 | 1 | `.nvmrc`, `package.json` engines/packageManager | Local locked install passes; CI workflow pins `.nvmrc` | Baseline validation report | COMPLETE |
| TRACE-002 | Build must enforce TypeScript | MTS Roadmap Slice 1 | 1 | Remove `ignoreBuildErrors`; add `typecheck` | `npm run typecheck`, `npm run build` pass | Baseline validation report | COMPLETE |
| TRACE-003 | Owned-code lint signal | MTS Roadmap Slice 1 | 1 | ESLint ignores generated/tooling and Deno function code | `npm run lint` passes with no reported warning/error | Baseline validation report | COMPLETE |
| TRACE-004 | Secret-free environment contract | MTS Blueprint; Roadmap Phase 1 | 1 | `.env.example`, README | CI uses placeholders; dedicated secret scan pending Phase 8 | Confirmed no real value added | COMPLETE |
| TRACE-005 | Approved systems govern implementation | Owner approvals; Roadmap Phase 0 | 0 | `AGENTS.md`, decision log, this matrix | Documentation link check (pending) | Owner approval record | COMPLETE |

Status values: `PLANNED`, `IN PROGRESS`, `BLOCKED`, `COMPLETE`, `DEPRECATED`.
