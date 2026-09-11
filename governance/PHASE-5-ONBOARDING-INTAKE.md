# Phase 5 — Start onboarding review for new applicants (TRACE-065, design proposal)

**Status:** PLANNED. Awaiting Codex design confirmation before implementation.
Owner decisions (2026-09-11): this is a separate slice ahead of invitation operator UI;
invitation expiry stays operator-entered with no default. PR #16 (TRACE-063) has
since merged, so this branch is based on main `5a3bffe`. The owner accepted the
recommended answer (A) to all four design decisions below; Codex confirms the
technical contract before implementation.

## Gap

`vendor_prepare_invitation` (TRACE-053) and PR #16's `send` require a contractor
record linked to the application (`vendor_applications.contractor_id`) plus a
`vendor_onboarding` row created by `vendor_begin_review`. For a new applicant, no
current path creates either:

- The legacy `vendor-invite approve` created the contractor, Auth user, vendor role
  and link in one non-atomic call. Phase 5 disabled it (correctly).
- `vendor_begin_review` is granted to authenticated operators but no UI calls it,
  and it requires an existing application-contractor link.

Without this step, the approved activation checklist (MPS §8) cannot start for a
new provider, and invitation operator UI would have nothing to prepare.

## Recovered constraints

- `contractors.is_active` defaults to `true`, and `/providers` lists every contractor
  with `is_active = true` to anon/authenticated users. A record created with table
  defaults would publicly list an unvetted applicant.
- `contractors.user_id` is nullable; an account-less record is representable.
- Application intake edits create immutable `vendor_application_versions`; changing
  `contractor_id` does not create a new version.
- `vendor_onboarding_events` has `unique(contractor_id, revision)` and a unique
  `business_key`. `vendor_begin_review` creates the first onboarding row without an
  event. For an existing record on an older version, it resets status to `review`
  and increments the revision.
- Providers without an onboarding record use the explicit legacy cutover path
  (TRACE-060/061). Creating onboarding for them changes their matching eligibility.
- Matching and offer acceptance use onboarding eligibility (TRACE-060); a contractor
  with an onboarding row never takes the legacy cutover path.

## Proposed contract

Additive migration: `vendor_start_onboarding_review(p_application uuid,
p_expected_version uuid, p_reason text, p_key text) returns jsonb`, security
definer, fixed `search_path`, executable only by authenticated callers and
enforced by `vendor_require_operator()`.

The command is **creation-only**. It never calls `vendor_begin_review`, because that
function resets an existing onboarding record to `review` when the application
version changes. Revisions of existing reviews stay on their existing paths.

A private, immutable request table records the identity of each command that
created a review: `vendor_onboarding_review_starts(business_key primary key,
application_id unique, expected_version_id, contractor_id unique, actor, reason,
created_at)`. The table has RLS enabled, no table grants, and the `money_immutable`
trigger. One row per application means one creating command.

Order of evaluation:

1. **Authenticate.** `vendor_require_operator()` runs first, so unauthorized callers
   learn nothing about keys or applications.
2. **Resolve exact replays before validation.** Look up `p_key` in the request
   table. If a row exists:
   - All of application, expected version, actor and reason must match it.
     Otherwise the command fails with an idempotency conflict. That includes the
     same key with a different `p_expected_version`.
   - A match returns the stored original result: `{contractor_id,
     onboarding_status: 'review', onboarding_revision: 1, created: true}`. The
     current application version, status or onboarding state is not rechecked, so
     a retry after a later application edit still returns the original result.
3. **Lock and re-resolve.** Lock the application row `for update`. Repeat step 2
   under the lock so that same-key concurrent callers all receive the original
   result.
4. **Validate the new command.** Require non-empty `p_reason` and `p_key`,
   application status not `rejected`/`abandoned`, and `p_expected_version` equal to
   the latest application version. A stale version fails.
5. **Existing state, with no mutation in any branch:**
   - The application is linked and a review-start row exists (another key won the
     race or started earlier). Return `{contractor_id, onboarding_status,
     onboarding_revision, created: false}` from current state. Nothing is written
     and no event is appended. If the existing onboarding is no longer `review`
     on `p_expected_version`, fail with "onboarding already exists" instead.
   - The application is linked with no review-start row: a legacy or cut-over
     provider, with or without onboarding. Fail, because such providers use the
     existing-provider cutover and review paths (TRACE-060/061). Creating onboarding
     here would move a legacy provider off its explicit cutover path.
6. **Create.** Only when the application has no linked contractor, in one
   transaction:
   - Insert the contractor with `is_active = false`, `marketing_enabled = false`,
     `user_id = null` and the application's business name only. No contact data,
     services, badges or public profile fields are copied.
   - Link `vendor_applications.contractor_id`.
   - Insert `vendor_onboarding` (revision 1, `review`, `p_expected_version`).
   - Append exactly one `review_started` event at revision 1 with before/after
     status `review`, actor, reason and business key.
   - Insert the request row, then return the result with `created: true`.

Only the creating key is a stored, replayable command. A losing or non-creating
call records nothing, so repeating it recomputes the step 5 answer from current
state. No Auth user, role grant, email, invitation, evidence, activation or public
listing results from this command. The application's legacy `status` is not changed.

Applications UI: replace the "Approve & Send Invite" action (which the endpoint now
rejects, while its helper text still promises an invite) with a
"Start onboarding review" ConfirmAction requiring a reason, showing server readback
of onboarding status. The legacy resend button and on-load `sync` call are removed in
the following invitation UI slice.

## Acceptance (proposed)

- SQL access: operator-only. Anon, service-role and vendor callers are denied before
  any key or application lookup. The request table is not readable or writable
  directly.
- SQL validation: stale version, rejected/abandoned application and blank
  reason/key are rejected.
- SQL replay:
  - An exact retry returns the original result.
  - A retry **after the application is edited** (new latest version) still returns
    the original result.
  - The same key with a changed `p_expected_version`, application, actor or reason
    fails as an idempotency conflict and writes nothing.
- SQL existing state, each asserting zero changes to contractor, application,
  onboarding, events and the request table:
  - Existing `active`, `suspended` and `rejected` onboarding is rejected.
  - Existing `review` on an older application version is rejected with no reset.
  - An application linked to a legacy contractor with no onboarding is rejected, and
    its legacy matching status is unchanged.
  - A second different-key start on an unchanged review returns `created: false`
    and appends nothing.
- Concurrency (committed synthetic fixtures, reset afterward):
  - Eight **different-key** starts produce one contractor, one link, one onboarding
    row, one revision-1 event and one request row. One call returns
    `created: true` and the rest return `created: false` with the same contractor.
  - Eight **same-key** starts all return the identical original result, with the
    same single set of rows.
- Effects: the created contractor is invisible to anon/authenticated listing reads
  and is not match-eligible. No role, Auth user or invitation row is created.
- Browser: confirmation requires a reason, failure keeps the dialog open with the
  error, success reflects server readback; axe/reflow at 320/1440px, light/dark.
- Full lint, types, unit, build, SQL regression and CI.

## Design review record

Codex design review, 2026-09-11. The architecture and all four owner decisions were
accepted, with two contract corrections required before green light. No
implementation tests were run and no GitHub review was posted.

1. **Existing onboarding.** The original steps 4–5 reused linked contractors and
   called `vendor_begin_review`, which can reset an existing record, and they
   appended `review_started` unconditionally. Resolution: creation-only command
   (step 5 above) with no mutation or explicit rejection for every existing state,
   plus different-key concurrency and active/suspended/rejected tests. The
   legacy-linked-contractor rejection was added while resolving this.
2. **Retry contract.** Freshness validation ran before replay lookup. Resolution:
   authenticate, then resolve exact replays (before and under the lock) ahead of
   validation. The stored identity includes `p_expected_version`. Tests cover replay
   after an application edit and changed-version key reuse.

Awaiting Codex confirmation of these corrections before implementation.

## Decisions for Codex

Owner answered A to each (2026-09-11). Codex confirms or raises technical objections.

1. Identity anchor. **Owner: A.** Use a hidden, account-less contractor record with
   no contact data, not a separate pre-contractor table.
2. Public visibility after activation. **Owner: A (separate slice).**
   `vendor_decide_onboarding('activate')` does not set `contractors.is_active`.
   Binding the public listing to onboarding eligibility is a pre-existing gap and
   stays out of this slice.
3. Duplicate applications. **Owner: A (out of scope).** Each application gets its
   own contractor. Operators reject duplicates; no email-based identity matching.
4. Audit sequence. **Owner: A.** Record `review_started` as onboarding revision 1,
   ahead of later activate/suspend/renew events.

No production migration, provider record, email or activation is performed.
