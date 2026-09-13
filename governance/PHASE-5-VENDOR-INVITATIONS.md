# Phase 5 — Durable provider invitation dispatch (TRACE-063)

## Scope and recovered behavior

PR #15 merged at `d815e90`; all backend, lifecycle and application CI checks passed.
This slice starts from that main checkpoint. The recovered `vendor-invite` path
combined email-based Auth directory scans, role grants, contractor linking and
activation before all operations succeeded. Phase 5 already disabled those legacy
`approve`, `resend` and `sync` commands and exposed only attempt preparation.

This slice supplies a bounded new-account invitation transport and verified
acceptance workflow. Existing-account linking, operator queue UI, hosted delivery
and mailbox delivery webhooks remain explicit follow-ups.

## Contract

1. An authenticated operator prepares an attempt with an explicit business key and
   expiry using the existing onboarding contract. Expiry is operational configuration,
   not a newly invented TTL or a claim about the Auth provider's link lifetime.
2. `send` reserves the attempt transactionally before contacting Auth. It checks
   current onboarding/application state, the latest application version, and the
   snapshot email. Already-linked contractors require separate account-link review.
   Eight simultaneous callers must produce one reservation and one winner.
3. The Edge adapter uses that snapshot email and a server-configured redirect to
   `/set-password?invitation=<attempt>`. Caller-supplied recipient/origin fields have
   no authority. No Auth directory scan or automatic provider retry occurs.
4. A successful Auth API response is recorded as **provider accepted**, with an
   exact Auth user ID checked against the database email and invitation timestamp.
   It is not labelled mailbox delivery. Timeouts, Auth errors and lost receipt
   writes remain unknown/reserved; another call cannot send again.
5. An operator can reconcile an uncertain result with an exact Auth user ID. The
   handler reads that user by ID; the database independently verifies identity,
   recipient and invitation timing. Unknown results cannot be closed merely to
   release a resend. A known provider result can be revoked or expired with a
   reason; expiration cannot occur early.
6. After password setup, `/invitation` asks the authenticated recipient to explicitly
   accept. The database verifies the target identity and confirmed email, current
   application/onboarding state, expiry and revocation. It appends one immutable
   receipt. A retry does not duplicate it.

Acceptance does not grant roles, link a contractor, approve compliance, prove a
notification reached a mailbox, or activate a provider. Legacy operator assertions
cannot overwrite dispatched attempts or manufacture their acceptance receipts.
The new dispatch/acceptance tables are private and writable only through invariant-
enforcing functions. No Auth token or invitation URL is stored in their evidence.

## Execution boundary

`MERCURIUS_INVITATION_MODE` is disabled by default. `local-test` accepts only HTTP
loopback/local Kong Supabase and a loopback `SITE_URL`; hosted dispatch is rejected
before any Auth call. Use only the local mail sink when subsequently authorizing
integration tests. This implementation run uses substituted HTTP transport and
synthetic SQL/browser fixtures, not actual email or Auth provisioning.

Operator actions on `vendor-invite` are `prepare`, `send`, `status`, `reconcile`
and `close`; `accept` is recipient-owned. `send/status/reconcile/close/accept` take
`attempt_id`. Reconciliation also takes `auth_user_id`; closure takes `status`
(`revoked` or `expired`) and `reason`. Preparation retains `contractor_id`,
`business_key`, and `expires_at`. Operator UI wiring is a separate bounded slice;
the old approval/resend buttons remain blocked by the existing endpoint boundary.

## Acceptance and follow-ups

Evidence is recorded in PHASE-5-VALIDATION.md. SQL 031 tests permissions, duplicate
claims, uncertain results, recipient checks, expiry, suspension, revocation, stale
applications and absence of role/activation effects. The concurrency script commits
only synthetic fixtures and is followed by a reset in CI. Real locked Deno imports
exercise the actual handler with substituted transport and no network permission.
Browser tests cover the explicit acceptance screen, failure/retry, invalid links,
authentication, password-setup handoff, reflow and automated accessibility.

Before hosted activation: review mail templates/redirect allowlists and provider TTL,
verify actual gateway/JWT and Auth/mail-sink behavior, review existing-account linking
and operator controls, and obtain explicit authorization. Actual mailbox-delivery
receipts require a provider-specific verified integration. Renewal/retention/legal
holds, finance operations, tax/promotions, recurring automation and legacy migration
remain Phase 5 gates. No production change, email, role grant, payment, payout,
scheduler, merge or deployment is performed by this slice.

## Primary integration references

- [Supabase Auth invitation API](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)
- [Supabase Auth email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase Auth redirect allowlists](https://supabase.com/docs/guides/auth/redirect-urls)

The implementation uses the repository's locked Supabase JS 2.112.0 and local SDK
source, including its non-PKCE invitation behavior. Auth template/provider behavior
remains an integration gate, not something the synthetic tests claim to prove.

## Forward fix — definite Auth refusal (2026-09-12)

Every Auth error used to be recorded as `unknown`, which wedged a provider whose recipient
already held a confirmed account elsewhere. Auth's `422 email_exists` refusal is now
recorded as a terminal `failed` attempt. See PHASE-5-INVITATION-REFUSAL.md.
