# PR #6 combined-source checkpoint

The owner requested resolution of PR #6's five conflicts, CodeRabbit review and merge on 2026-09-04. This authorizes the repository checkpoint; the documented functional integration and external activation gates remain separate.

Main at `735df9138014a51111590ab8c780bf2aeec93cd1` includes merged PRs #4 and #5, including the forward confirmation-scheduling fix. This merge preserves their history alongside Phase 5 head `95f327b`.

## Conflict decisions

- `.env.example`: retain the Phase 5 money-mode and Phase 4 lifecycle settings, disabled by default, with an empty worker credential.
- `.github/workflows/ci.yml`: retain both backend suites and authenticated lifecycle/pg_net/inactive-installer checks. Run backend, lifecycle and application jobs sequentially. All jobs use the combined migration source.
- `scripts/edge-function-contract.test.mjs`: retain the active lifecycle-worker digest and its separate Phase 2 archive assertion; preserve the Phase 5 archived checkout/invitation export checks.
- `src/lib/supabase/database.types.ts`: preserve both public API surfaces and verify against generated types from the combined isolated database.
- `vercel.json`: retain Phase 5's global automatic-deployment disablement.

These are source integration decisions under TRACE-010 and TRACE-050–053. They do not implement the offering/quote, completion/dispute, cancellation, recurring-payment or onboarding-to-matching adapters listed in PHASE-5-HANDOFF.md. Money execution remains disabled.

## Validation

Local clean reconstruction through the combined Phase 4 and Phase 5 migrations passed all 288 SQL assertions across 13 suites. Types were regenerated using Supabase 2.116.0 against that isolated database. Local lint, credential scanning, TypeScript and all 76 unit tests passed before submission; final-head CI repeats application checks and both backend workflows. Earlier independent Phase 5 CI is historical evidence only.

## CodeRabbit review disposition

The follow-up source passed local TypeScript, lint, credential scanning, 84 unit
tests and 293 SQL assertions. Final CI repeats these checks from a clean checkout.

Confirmed follow-ups: remove stale copied migrations/tests before preparing the isolated stack; safely validate checkout review URLs in both request and dashboard paths; normalize invalid checkout modes; use neutral webhook receipt-failure wording; restrict direct homeowner reads of internal snapshot/attempt metadata while retaining the displayed policy version; allow revoking an unsent invitation; align decision references and partitioned-table permission assertions. Forward migration `20260905009000` and focused SQL/URL tests cover the relevant changes.

The migration-date suggestion is not applied: migration prefixes order execution, and the future-prefixed files were actually validated September 4. The report now states this explicitly.

The proposal to expire every reconciled checkout is not applied: matching aggregate readback does not prove a specific Stripe session is expired or cannot charge later. Verified provider expiry already permits replacement; uncertain attempts remain blocked pending the documented recovery integration.

The proposed redesign of onboarding authority is deferred to the documented bank/onboarding integration gate. Admin browser workflows record vetting evidence; they cannot call service-role-only ACH creation or settlement functions. Actual batch preparation still requires two finance authorities and separate approval of the exact command. This checkpoint does not activate bank operations or claim completion of that integration.

The pg_cron suggestion concerns an inherited historical migration, not a new Phase 5 installation. Clean resets and the zero-active-jobs assertion pass with the pinned runtime. No historical schema rewrite is introduced in this conflict-resolution checkpoint.
