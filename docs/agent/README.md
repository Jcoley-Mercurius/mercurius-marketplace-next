# Mercurius agent workspace

This is the navigation layer for the existing Mercurius system. The approved
sources stay in their original folders so links and historical evidence remain valid.

## System map

| Folder / entry | Purpose | Start here |
|---|---|---|
| `AGENTS.md` | Automatic repository instructions and authority order | [Agent rules](../../AGENTS.md) |
| `mps/` | Product roles, lifecycle, commercial and acceptance contracts | [Approved MPS](../../mps/PROPOSED-MPS.md) |
| `mds/` | Design foundations, components, accessibility and brand | [MDS blueprint](../../mds/DESIGN-SYSTEM-BLUEPRINT.md) |
| `mts/` | Architecture, trust boundaries, data and integration contracts | [MTS blueprint](../../mts/TECHNOLOGY-BLUEPRINT.md) |
| `roadmap/` | Combined implementation order and phase gates | [Rebuild roadmap](../../roadmap/MERCURIUS-REBUILD-ROADMAP.md) |
| `governance/` | Approvals, configuration, decisions, traceability and evidence | [Approvals](../../governance/OWNER-APPROVALS.md), [configuration](../../governance/CONFIGURATION-DECISIONS.md), [traceability](../../governance/TRACEABILITY.md) |
| `src/app/` | Public routes, homeowner route group, vendor/admin portals and API routes | Route relevant to the task |
| `src/components/` | Shared UI foundations and role/domain components | `ui/` and the relevant domain |
| `src/lib/` | Shared lifecycle, auth, environment, payment and Supabase helpers | `lifecycle.ts`, `payments.ts`, `supabase/` |
| `supabase/` | Additive migrations, Edge Functions and database tests | Migration/function and corresponding SQL test |
| `tests/`, `scripts/` | Unit/browser fixtures, verification and local tooling | [Quality commands](../../README.md#quality-commands) |
| `docs/agent/` | Editor workflow and dated handoff; navigation, not policy | [Handoff](HANDOFF.md) |
| `.vscode/` | Repeatable editor tasks and extension recommendations | Run Task in VS Code |

Authority remains **MPS → MDS → MTS → implementation evidence**, with owner
approvals and configuration defining the approved baseline. `PRODUCT.md`,
`DESIGN.md`, and `matching.md` provide supporting context; they do not override it.

## Architect and implementer

Codex leads architecture, slice definition, and code review. Claude implements the
agreed slices and supplies diffs and acceptance evidence for review. Shared project
rules live in [AGENTS.md](../../AGENTS.md); [CLAUDE.md](../../CLAUDE.md) imports them
and hosts the Next.js implementation rules. The owner may adjust roles per task.

## Open and work

1. Open `mercurius.code-workspace` in VS Code. On WSL, open the repository through
   the WSL extension so terminal commands and tooling run in the same environment.
2. Enable the recommended OpenAI Codex extension, sign in, and open its sidebar.
3. Read [HANDOFF.md](HANDOFF.md), then choose one bounded roadmap slice.
4. Use Node 24 (`nvm use` if nvm is installed) and npm 11. Run `npm ci` after a
   checkout changes the lockfile. Preserve an existing `.env.local`; on a fresh
   clone, copy `.env.example` only if `.env.local` does not exist and supply local
   development values privately. See the root README for environment boundaries.
5. Use **Terminal → Run Task → Mercurius: ...** for dev, lint, typecheck, unit
   tests, secret scan, build, or the combined check. Tasks never auto-start.
6. Before opening the app, verify privately that its environment targets the
   intended non-production backend. Backend reconstruction and browser fixture
   setup follow the root README; editor setup does not establish integration readiness.

[Official Codex IDE guidance](https://learn.chatgpt.com/docs/codex/ide) covers
installation and editor context. Codex reads repository instructions through
[AGENTS.md discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

## Keep context focused

Use this task shape:

> Read AGENTS.md and docs/agent/HANDOFF.md. Work on [bounded outcome] under
> [roadmap phase / TRACE ID]. Inspect the relevant authorities and implementation,
> make the change, run its acceptance checks, and update the evidence and handoff.

Use file references and focused selections instead of pasting whole documents.
Read the governing baseline before implementation, then follow the relevant
traceability row into code and tests. Keep stable decisions in governance and a
short current checkpoint in the handoff. Reuse checks already completed on the
same unchanged code; distinguish historical evidence from checks run now.

These practices aim to reduce repeated discovery. No token reduction has been
measured, and changing from the desktop app to VS Code alone guarantees none.

## Validation and handoff

Documentation/editor changes: check JSON, links, npm task names and `git diff --check`.
Application changes: run the relevant unit/lint/type checks and required build gates.
Database or workflow changes: include SQL, concurrency and integration evidence
required by the slice. UI changes also need the applicable browser/accessibility
checks. A build alone does not prove a complete business flow.

Finish with the branch/base, changed behavior, exact verification, unresolved
acceptance gates and the next bounded task. Keep production activation separate
from implementation acceptance as required by the governing documents.
