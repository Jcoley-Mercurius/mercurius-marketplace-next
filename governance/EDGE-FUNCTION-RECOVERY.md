# Deployed Edge Function recovery

**Date:** 2026-09-03
**Authority:** DEC-2026-002
**Production changes:** none

**Closeout:** DEC-2026-004 records owner acceptance of the documented live/local
differences for Phase 2. The review notes below remain deployment cautions, not
unresolved reconstruction approval. TRACE-010 assigns remaining lifecycle and
scheduler implementation to Phase 4; payment/payout integrity remains Phase 5.
The owner selected admin review rather than automatic completion confirmation;
the recovered worker still contains the old timer until that forward change.

## Recovered boundary

Read-only API export recovered all 11 deployed entrypoints and three shared
helpers into ignored staging. The eight missing entrypoints were reviewed and
added to `supabase/functions`; no existing source was overwritten. The shared
catalog, platform-fee, and soft-launch helpers match the local versions.

`EDGE-FUNCTION-INVENTORY.json` records deployed versions, observed JWT settings,
source hashes, and required environment **names**, never their values. Source
review and credential-pattern/literal checks found no embedded credentials or
customer records. The team-email fallback in the notification function is a
source-code configuration constant, not an exported customer record.

All deployed functions require gateway JWT verification except `stripe-webhook`,
which verifies Stripe signatures internally. The observed settings are now in
`supabase/config.toml`, including the worker's existing `verify_jwt = true`.

## Preserved implementation differences

| Function | Local versus deployed | Recovery decision |
|---|---|---|
| `checkout-request` | Local required/optional environment validation wrapper | Preserve local validation |
| `refund-invoice` | Local required environment validation wrapper and corresponding misconfiguration error handling | Preserve local implementation |
| `stripe-webhook` | Local environment validation; local payment success calls `start_request_matching`, while deployed success calls `transition_job_status` to `in_progress`; corresponding customer copy differs | Preserve local matching implementation; explicitly review this behavioral drift before any deployment |
| Eight recovered entrypoints | Same reviewed source apart from line endings/trailing file whitespace | Restore without redesigning behavior |

Recovery does not constitute approval to deploy either payment implementation.
The owner still controls production promotion. No Stripe, email, AI, auth-admin,
or lifecycle endpoint was invoked during this export.

## Known follow-up work, not silently repaired during recovery

- **Payment integrity (Phase 5):** `create-checkout` has legacy catalog pricing,
  request-origin return URLs, and no durable checkout idempotency. Characterize
  and consolidate the two checkout paths under the approved payment design.
- **Lifecycle (Phase 4):** the worker contains 72-hour auto-confirmation and
  review/reminder timers. Its comment describes a 15-minute schedule, but no
  scheduler command or credentials were exported. A worker-secret header alone
  must also satisfy the observed gateway JWT requirement. Confirm the actual
  scheduler contract before configuring or activating a worker.
- **Onboarding (Phase 5):** vendor provisioning is a multi-step process with
  partial-failure behavior; auth-user lookup is bounded to 4,000 accounts.
- **Communications/security:** `vendor-application-notify` retains its Lovable
  connector dependency, broad gateway-level access, logging fallback, and 200
  responses for email failures. It is not invoked by the current Next.js source.
- **Optional legacy services:** `beta-access` and `loyalty-recommend` have no
  current app invocation. Their source/settings are retained for inventory, not
  activated or replaced. Loyalty recommendations require `LOVABLE_API_KEY`.
- **Runtime verification:** per-function Deno configs now map floating Supabase
  major imports to 2.112.0 and lock dependency graphs. All 11 functions typecheck
  in Deno 2.9.6, and 26 isolated handler tests pass. Checkout/refund received
  type-only helper annotation corrections. Gateway behavior and provider
  integration are not proven by these tests and remain release checks.
- **Scheduler inspection:** a separately authorized read-only metadata SELECT
  found zero production `cron.job` rows. External scheduling remains unverified.
  No job was created, enabled, or invoked; no scheduler credentials were read.
- **Gateway rejection:** all 10 JWT-protected functions returned 401 for missing
  credentials through the reduced local Supabase gateway. Authenticated gateway
  execution and scheduler-to-worker integration remain unverified.

## Verification boundary

The Edge contract suite checks completeness, all observed JWT settings, TypeScript
syntax, relative import existence/containment, known credential patterns, and
hash equivalence of the restored files/helpers. It does not execute paid or
side-effecting function code. Together with existing unit tests, 42 assertions
pass across three files at this recovery checkpoint.
