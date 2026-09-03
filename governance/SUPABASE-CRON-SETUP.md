# Supabase Cron setup boundary

Date: 2026-09-03. Authority: DEC-2026-003, DEC-2026-004 / TRACE-010 (Phase 4).
State: provider selected; setup plan recorded; no production schedule installed.

The owner confirmed `pg_cron` is installed. Phase 2 is closed as reconstruction;
implementation and activation below belong to Phase 4. Unconfirmed completion
must go to admin review, not automatic confirmation. Its escalation deadline
remains open and must not be inferred from the four-hour vendor offer window.

## Target setup

- Supabase Cron invokes `job-lifecycle-worker` through `pg_net`.
- Proposed cadence: every 15 minutes, matching the inherited source comment.
  This is a proposed configuration, not evidence of an existing schedule.
- Keep `verify_jwt = true`. The request must satisfy gateway JWT validation
  and the handler's separate worker-secret check. A worker-secret header alone
  is insufficient. Do not disable JWT verification to make scheduling work.
- Keep credentials in approved server-side secret stores, never literal values
  inside cron command text, migrations, fixtures, documentation, or CLI output.
  Validate the gateway credential type against the deployed JWT configuration;
  do not assume a publishable API key is a bearer JWT.
- Use a unique, environment-specific job name. Recheck database cron metadata
  and confirm no external scheduler will duplicate the worker.
- Installation should create an inactive job transactionally. Activation is a
  separate operation after verification, not a side effect of a blank DB reset.

## Blocking behavior review

The recovered worker is not a health check. A successful call can expire matches,
update requests, write notifications/events, request reviews, and flag stale jobs.
Its 72-hour silent fallback calls `transition_job_status` with
`homeowner_confirmed` even when the homeowner has not responded.

CFG-008 ties payout eligibility to homeowner-confirmed completion. MPS section
6.4 requires any automatic confirmation timer to be explicit and notified. The
inherited timer, notification guarantees, and downstream payout meaning must be
reconciled before enabling unattended execution. Choosing Supabase Cron alone
did not settle this product-policy decision. DEC-2026-004 now directs replacement
with admin review in Phase 4, with deadline and financial consequences separately
specified and tested. The inherited behavior has not yet been changed.

## Acceptance and activation sequence

1. Reconcile the timer and other inherited transitions with Phase 4 lifecycle
   policy; resolve any effects on Phase 5 payout eligibility.
2. Verify the actual authenticated gateway-to-worker path in an isolated
   environment, with synthetic records and no production provider credentials.
3. Test repeat/concurrent runs, quiet-hour boundaries, failed database operations,
   and notification/event deduplication. The existing empty-batch test alone does
   not prove these cases.
4. Configure scoped credentials without exporting their values and install the
   reviewed inactive schedule in the intended environment.
5. Verify non-secret metadata, then obtain activation approval for the reviewed
   behavior and cadence. Observe HTTP/worker outcomes, not only cron SQL success:
   a queued `pg_net` request does not prove the function completed successfully.
6. On unexpected transitions, duplicates, auth failures, or processing failures,
   deactivate the exact job. Deactivation prevents future scheduled calls but
   does not undo a running request or already-applied lifecycle changes.

## Existing evidence

- Last read-only production inspection: zero `cron.job` rows.
- All 11 Deno function checks and 26 isolated handler tests passed.
- All 10 JWT-protected functions rejected missing credentials at the local gateway.
- No authenticated production worker call or production scheduling change made.

Reference: [Supabase scheduling documentation](https://supabase.com/docs/guides/functions/schedule-functions).

## Phase 4 forward implementation — 2026-09-03

The earlier recovered-source discussion above is historical. DEC-006 approves
72 hours after notice for admin escalation, never automatic confirmation. The
current Edge handler is disabled unless JOB_LIFECYCLE_ENABLED is exactly true.
Its one SQL batch owns expiry, in-app notice, review flags, audit and run results.
The recovered worker is retained under supabase/recovered and hash-verified.

Local authenticated gateway and one-off pg_net transport tests passed with
synthetic fixtures and zero Cron jobs. This proves transport, not recurring Cron
execution. scripts/install-inactive-lifecycle.sql is an unexecuted review template
with required cadence/job-name inputs, Vault lookups and transactional inactive
installation. It contains no activation statement. Cadence, target provisioning,
notification delivery/fallback, retention and production activation remain gates.

Use PHASE-4-VALIDATION.md for the current acceptance boundary.
