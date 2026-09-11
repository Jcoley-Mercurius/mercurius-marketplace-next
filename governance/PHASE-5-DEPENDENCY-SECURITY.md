# Phase 5 — Production dependency audit remediation (TRACE-064)

## Why this slice

PR #15 merged at `d815e90` with every CI job passing on 2026-09-08. Advisories
published afterward make the unchanged `npm run audit:prod` gate
(`npm audit --omit=dev --audit-level=high`) fail on main and on every branch built
from it, including draft PR #16 (TRACE-063), whose `application` job failed at this
step on 2026-09-11. The Phase 5 gate "final-head CI passes" cannot be met by any
slice until the gate is green again. The MTS requires dependency scanning in CI;
this slice restores it rather than weakening it.

## Recovered behavior

`next` and `eslint-config-next` were pinned exactly at `16.3.0`. The locked tree
resolved sharp 0.35.3, js-yaml 4.3.1 and hono 4.13.0. The audit reported:

| Package | Severity | Advisories | Path |
|---|---|---|---|
| next 16.0.0–16.3.2 | critical | GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4 | direct |
| sharp < 0.35.4 | high | GHSA-rgj7-g3m4-5g8c | next optional dependency |
| js-yaml 4.0.0–4.3.1 | high | GHSA-2883-xcg3-v3hh | shadcn → cosmiconfig |
| hono ≤ 4.13.4 | moderate | GHSA-gqvv-2mrq-wpjv, GHSA-g6gw-c38x-mqfc, GHSA-crvj-82cr-hjcx | shadcn → MCP SDK |

The application uses `next/image` with the default optimizer (15 importers), so the
image-optimization advisory is relevant to this codebase. No application source
imports shadcn, hono or js-yaml; they enter the production audit scope only because
the `shadcn` CLI is listed under `dependencies`.

## Change

- Pin `next` and `eslint-config-next` to `16.3.4` (patch release, same 16.3 line;
  exact pins retained).
- Non-forced `npm audit fix` updates the lockfile only: sharp/@img 0.35.4 (libvips
  1.3.3), js-yaml 4.3.2, hono 4.13.7, and Next's `@swc/helpers` 0.5.23. Every
  resolved URL remains on registry.npmjs.org with integrity hashes.
- The installed Next.js 16.3.4 version-16 upgrade guide differs from 16.3.0 only by
  documentation clarifications (Turbopack filesystem-cache flag names, an example's
  module syntax). No new deprecation applies to this repository's configuration.

No application code, schema, migration, Edge/Deno dependency, environment contract,
product rule or provider configuration changes.

## Decisions for review

- Whether `shadcn` (a code-generation CLI) should move to `devDependencies`. That
  would remove its transitive tree from the production audit scope, but it changes
  dependency classification and is left as a separate, explicit decision.
- PR #16 must incorporate this fix (merge or rebase after this lands) before its
  final-head CI can pass. That sequencing is a reviewer/owner choice.

## Validation

See PHASE-5-VALIDATION.md (TRACE-064 section). Backend and lifecycle CI jobs are
unaffected by npm-only changes and run unchanged on the PR head. No deployment,
production dependency install, migration, email, payment, payout or scheduler
activation is performed.
