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
  event.
- Matching and offer acceptance use onboarding eligibility (TRACE-060); a contractor
  with an onboarding row never takes the legacy cutover path.

## Proposed contract

Additive migration: `vendor_start_onboarding_review(p_application uuid,
p_expected_version uuid, p_reason text, p_key text) returns jsonb`, security
definer, fixed `search_path`, executable only by authenticated callers and
enforced by `vendor_require_operator()`.

1. Lock the application row. Require status not `rejected`/`abandoned` and
   `p_expected_version` to be the latest application version (stale review fails).
2. Idempotency by `p_key`: an exact retry returns the original result; the same key
   with a different application, actor or reason fails.
3. If the application is not yet linked, insert a contractor with
   `is_active = false`, `marketing_enabled = false`, `user_id = null` and the
   application's business name only. No contact data, services, badges or public
   profile fields are copied. Link `vendor_applications.contractor_id`.
4. If already linked, reuse that contractor. No second contractor per application.
5. Call the existing `vendor_begin_review` semantics and append a
   `review_started` onboarding event (actor, reason, business key). No event
   rewriting.
6. Return `{contractor_id, onboarding_status, onboarding_revision}`.

No Auth user, role grant, email, invitation, evidence, activation or public listing
results from this command. The application's legacy `status` is not changed.

Applications UI: replace the "Approve & Send Invite" action (which the endpoint now
rejects, while its helper text still promises an invite) with a
"Start onboarding review" ConfirmAction requiring a reason, showing server readback
of onboarding status. The legacy resend button and on-load `sync` call are removed in
the following invitation UI slice.

## Acceptance (proposed)

- SQL suite: operator-only; anon/service-role/vendor denied; stale version rejected;
  rejected/abandoned rejected; exact retry idempotent; key conflict rejected; eight
  concurrent calls create one contractor, one link, one onboarding row, one event;
  created contractor is invisible to anon `/providers` reads and not match-eligible;
  no role, Auth user or invitation rows created.
- Browser: confirmation requires a reason, failure keeps the dialog open with the
  error, success reflects server readback; axe/reflow at 320/1440px, light/dark.
- Full lint, types, unit, build, SQL regression and CI.

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
