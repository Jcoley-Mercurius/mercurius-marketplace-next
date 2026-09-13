# Phase 5 — Record a definite Auth refusal as a failed invitation (TRACE-063 forward fix)

**Status:** IMPLEMENTED on branch `codex/phase5-auth-refusal`, based on `main` `26900eb`
(PR #24, TRACE-070, merged). Awaiting Codex code review. Merging is not phase acceptance
or production activation.

**Authorization:** owner instruction 2026-09-12: fix the general stuck-invitation problem
found during TRACE-070 — a definite refusal from Auth should be recorded as failed and
closed instead of `unknown`. The design decisions below were taken during implementation
and are recorded for review, not presented as pre-approved.

## Defect

Inviting an address that already holds a confirmed Auth account from anywhere else — for
example a homeowner signup — wedged the provider:

1. `vendor_prepare_invitation` and `vendor_claim_invitation` accept the attempt. The
   TRACE-070 guard only sees accounts named by this provider's own acceptance receipts.
2. Auth refuses the invitation. The TRACE-063 handler recorded every Auth error as
   `unknown`.
3. Reconciliation requires the account's `invited_at` to postdate the dispatch; a
   pre-existing account never satisfies it.
4. `vendor_close_dispatched_invitation` only closes `provider_accepted` dispatches, and an
   `unknown` attempt holds the provider's one live slot, blocking another invitation and
   TRACE-067 linking by account ID.

## Characterized before change

Local isolated Auth (Supabase CLI 2.116.0 stack, synthetic accounts deleted afterwards),
through the locked `@supabase/supabase-js` 2.112.0 admin client:

| Existing account at the address | `inviteUserByEmail` result |
|---|---|
| Confirmed | `AuthApiError`, HTTP 422, code `email_exists`, no user returned |
| Unconfirmed | Success: the same user is re-invited and `invited_at` updated (already reconcilable) |
| Invalid address | HTTP 400 `validation_failed` (the claim's address check prevents this) |

Suite 038 also characterizes that the TRACE-070 guard does not catch an account from
elsewhere, and that such an unknown attempt cannot be reconciled.

## Contract

1. Migration `20260912006000` adds dispatch state `failed`, `refusal_code` and
   `refused_account_id`. A check constraint ties `failed` to a refusal code and the account
   to `failed` rows.
2. `public.vendor_refuse_invitation(attempt, code, actor, existing_account default null)` is
   **service-role only**, requires an admin actor, and accepts only `email_exists`.
3. Evidence is one of:
   - **Handler report** (no account): allowed only while the reservation is still `started`,
     i.e. as the first and only outcome for that dispatch.
   - **Corroborated account** (read back by exact ID): the account's address equals the
     dispatch recipient, it was confirmed **before** the dispatch started, and it was not
     invited at or after it. Auth refuses such an address, so the dispatch cannot have
     created or invited anyone. This is the exact complement of the reconciliation
     predicate, so no reservation can satisfy both. Required once an attempt is `unknown`.
4. It records dispatch `failed`, attempt `failed` (terminal and not live, so the slot is
   released) and one `failed` event naming the operator and, when given, the account.
   Exact and bare replays of a recorded refusal return; a different account conflicts.
5. A `provider_accepted` dispatch cannot be refused. `vendor_finish_invitation` (body
   otherwise unchanged) treats a refusal as final: a late unknown report is a no-op and
   attaching an identity is refused.
6. `vendor_invitation_overview` and `vendor_invitation_status` add `refusal_code` and
   `refused_account_id`. Still read-only.
7. Edge `vendor-invite`:
   - `send`: only `error.status === 422 && error.code === "email_exists"` calls the refusal
     command and returns 409 `INVITATION_RECIPIENT_HAS_ACCOUNT` with `status: "failed"`. If
     that write fails, the handler falls back to the existing unknown path. Every other Auth
     error, including a lost response, stays `unknown`. Auth is never retried.
   - new `refuse` action: operator supplies an Auth user ID; the handler reads it back by ID
     and calls the command with it. It never calls the invite API.
8. Panel: a refused attempt explains that nothing was sent and that the recovery is linking
   the existing account by ID, and shows the corroborating account when recorded. An
   `unknown` attempt offers "Record Auth refusal" beside "Reconcile result", using the same
   Auth user ID field, behind a readback-gated ConfirmAction.

**Recording a refusal sends nothing, links no account, grants no role and activates no
provider.**

## Decisions taken during implementation, for review

1. **Trust the handler's structured refusal without an account lookup.** The handler cannot
   learn the existing account's ID without searching the Auth directory, which these slices
   forbid. Auth's own structured 422 is the evidence; it is accepted only from the
   service role and only as a reservation's first outcome, so it cannot rewrite an
   `unknown` outcome.
2. **Allowlist of one code.** Only `email_exists` was observed to be a refusal before any
   user is created. Rate limits, validation errors and 5xx stay `unknown`.
3. **`failed` is terminal**, not a closable live state, reusing the attempt status that
   TRACE-053 already defined and the live index already excludes. The TRACE-063 closure
   command is unchanged.
4. **No foreign key on `refused_account_id`** so audit evidence neither blocks nor is
   erased by a later account deletion.
5. **Preparation after a refusal is not blocked.** The account may since have been deleted
   or changed its address; a repeat send simply records another failure. The panel warns
   that it would be refused again.
6. **Same account-ID field for reconcile and refusal.** The predicates are complementary,
   so the database decides which one the account proves.

## Execution boundary

One additive migration: one replaced check constraint, two nullable columns, one check
constraint, one new service-only command, and three replaced functions (bodies copied with
the additions above). Effective execute privileges on `vendor_finish_invitation`,
`vendor_invitation_status` and `vendor_invitation_overview` were captured before and after
on the isolated stack and are identical. Edge `vendor-invite` gains the refusal branch and
the `refuse` action; delivery remains disabled outside the explicit local-test mode.
No hosted Auth, account, email, role, activation or provider configuration is changed.

## Open items

- Codex code review; CI on this branch.
- Hosted Auth may word or version its refusal differently; the `422 email_exists` contract
  must be re-verified at the hosted integration gate before activation.
- An existing account that is unconfirmed is re-invited by Auth (existing behavior, now
  characterized). Whether inviting a homeowner's unconfirmed account is acceptable is an
  owner question, not assumed here.
- The panel still shows "Revoke invitation" for an `unknown` attempt, which the server
  refuses; pre-existing TRACE-066 behavior, unchanged.
- Rejection-after-activation role policy, account deletion versus audit rows, and the
  TRACE-065 dark-theme contrast defect remain as recorded.
