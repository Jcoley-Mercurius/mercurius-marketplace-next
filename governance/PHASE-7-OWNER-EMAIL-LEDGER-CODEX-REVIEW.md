# Phase 7.2C-1 — Codex review and release checkpoint

Date: 2026-11-12 (America/New_York). PR #166, base `9b487bf91e1420881b77579f20894edc33dd3494`, reviewed implementation head `3eafbad2e761dff4d7d92499886fbf022b36f274` plus the bounded corrections in this commit. The owner instructed Codex to carry out review, corrections, release, rollout reconciliation and then start 7.2C-2. This is not Phase 7 acceptance or booking/payment activation.

## Review

Read the migration, contact and resend routes, shared delivery helper, logger, operator page and detail dialog, shared confirmation changes, SQL 120, concurrency script, unit/browser evidence and the plan. Read the installed Next.js 16.4.3 `after` and client-boundary documentation. No remaining blocking ledger authorization or concurrency issue was identified in this source review.

Two findings were corrected without changing the hosted migration:

1. **Refresh after a lost operator-action response.** `fetch` could reject before the resend handler reached its reload. Both resend and acknowledgement now perform the readback in `finally`; a thrown transport error reports uncertainty and never claims success. Supabase can also return a transport error without throwing: acknowledgement errors say "Acknowledgement not confirmed", never assert rollback. Browser regressions simulate a committed command whose response is lost and verify fresh state, truthful wording and no automatic repeat command.
2. **Truthful missed-state label.** The inherited label "Never sent" was false for an old-release send during the migration-to-deploy window. Owner emails now say "No recorded attempt"; the vendor-application label remains unchanged. Browser evidence asserts the corrected label and rejects the old one.

## Independent verification

- Local unit suite: 66 files / 861 tests passed. Typecheck, lint, secret scan, `git diff --check` and production build passed (synthetic public Supabase configuration only).
- Local browser execution: **not performed successfully**. The pinned browser download was invalid and installed system Chromium could not launch because the workspace denies its singleton socket. The 17 browser tests, including the two new transport regressions, must pass in final-head CI; browser-launch errors are not application test results.
- No local SQL/concurrency rerun: Docker/Postgres are unavailable here. The reviewed original head's CI backend completed successfully, including SQL and the owner-email concurrency step; final-head CI remains the release requirement.
- Hosted read-only verification: migration head `20261122001000`; all 12 new function bodies match the migration source; fixed empty search paths and function ACLs match the intended owner/service/operator boundaries. Both private tables have RLS and no direct anon, authenticated or service-role table access. Contact trigger enabled; no renewal-email trigger.
- Hosted money fingerprint: `58 | af0fae6e0c5b604e9073e10bc060957e`.
- Hosted ledger/event row count at review: **0 / 0**. No record contents, mailbox or provider evidence were read; no delivery or acknowledgement was performed.

## Release boundary

CI run 43324010996, attempt 1 at `7949b7a`, passed backend and lifecycle and 703/704 application browser tests. The new lost-resend test queried the background row by role while its alert dialog was still open. The test now checks the error, new attestation, disabled confirm button and single command with the dialog open, then closes it before checking the refreshed row. No assertion was removed. Attempt 2 of that old head was already running when this correction was prepared; only a full passing run on the corrected head can authorize release.

Final-head CI, unchanged head/main and hosted compatibility must be checked before merge. The migration is already hosted: do not apply it again. Record the merge/deployment SHA and perform a fresh rollout-window count after production is READY. Any uncertain row requires actual per-row inbox/provider evidence and the appropriate attestation; counts alone never authorize acknowledgement or resend. Real-email verification is separate and has not been performed.

The prior intermittent main accessibility failure remains historical and undiagnosed; newer green runs do not establish a repair. A2, CFG-011 retention and final booking-readiness schema/grants, fingerprint and completion-integrity checks remain carried. No payments, booking, offer-terms/promotions gate or automation activation.
