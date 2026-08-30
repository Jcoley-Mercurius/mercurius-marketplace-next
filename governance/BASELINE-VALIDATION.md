# Phase 0/1 Baseline Validation

**Date:** 2026-08-29
**Branch:** `codex/rebuild-phase-0-foundation`
**Repository baseline:** `94d608a`
**Scope:** Governance baseline and deterministic developer-platform foundation
**Production/external mutation:** None

## Outcome

The approved MPS, MDS, MTS, launch configuration, and combined roadmap are now represented as repository authority. The local toolchain installs from the lockfile, lint and strict TypeScript pass, the production build validates TypeScript and generates all 56 routes, and the production dependency audit reports no known vulnerabilities.

No `src/` application behavior, production account, production schema, production data, DNS, billing, or webhook was changed.

## Runtime

| Item | Result |
|---|---|
| Node | `v24.15.0` locally; repository pins Node 24 LTS with `>=24.11 <25` |
| npm | `11.12.1`; repository requires `>=11 <12` |
| Lockfile | npm lockfile version 3 |
| Node support basis | Node 24 is an official LTS release line: <https://nodejs.org/en/about/previous-releases> |

## Verification

| Check | Result | Evidence |
|---|---|---|
| Locked dependency installation | PASS | `npm ci --ignore-scripts --no-audit --no-fund`; 614 packages installed |
| Owned-code lint | PASS | `npm run lint`; no warning/error output |
| Strict TypeScript | PASS | `npm run typecheck` |
| Production build with TypeScript enforcement | PASS | `npm run build`; compiled, type checked, and generated 56 routes |
| Build type bypass | REMOVED | `next.config.ts` no longer sets `typescript.ignoreBuildErrors` |
| Production dependency audit | PASS | `npm audit --omit=dev --audit-level=high`; 0 vulnerabilities |
| Advisory repair | PASS | Transitive `nanoid` updated from 3.3.17 to 3.3.18 within existing PostCSS ranges |
| Diff whitespace validation | PASS | `git diff --check`; only Windows line-ending notices reported |
| CI definition | ADDED / NOT YET RUN REMOTELY | `.github/workflows/ci.yml` installs, lints, type checks, and builds on Node 24 |
| Automated product/database/E2E/accessibility tests | NOT YET AVAILABLE | Scheduled in later roadmap phases; build success is not treated as replacement evidence |

## Environment note

The first sandboxed build could not reach Google Fonts. The same build passed with approved network access and downloaded Geist successfully. This demonstrates a network requirement in the current `next/font/google` build. The approved MDS asset/font work should consider self-hosting Geist so builds do not depend on Google Fonts availability.

## Foundation changes

- Recorded all owner configuration decisions.
- Added repository implementation authority to `AGENTS.md`.
- Replaced the starter README with project setup, governance, environments, commands, and safety rules.
- Added `.nvmrc`, npm/node engine constraints, and package-manager declaration.
- Added secret-free `.env.example` and explicitly allowed it through `.gitignore`.
- Added `typecheck` and `check` scripts.
- Removed the Next.js build type-check bypass.
- Scoped ESLint away from generated/tooling and Deno Edge Function code, which require separate checks.
- Added decision-log and traceability templates.
- Added the initial GitHub CI workflow.

## Phase 1 follow-up

The five open items recorded at this checkpoint were completed in the subsequent Phase 1 implementation commit. See `governance/PHASE-1-VALIDATION.md` for the current evidence, including the GitHub CI run.

## Next roadmap gate

Proceed to **Phase 2 — Reconstruct the real backend** only after this documentation/foundation checkpoint is committed and the owner authorizes read-only live schema inventory after confirming a backup. MDS primitive work can begin independently after the backend boundary inventory is stable.
