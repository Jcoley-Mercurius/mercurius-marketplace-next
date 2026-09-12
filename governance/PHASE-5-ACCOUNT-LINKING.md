# Phase 5 — Reviewed existing-account linking (TRACE-067)

**Status:** IMPLEMENTED on branch `codex/phase5-account-linking`, base main `717877d`
(PR #19 / TRACE-066 merged). Awaiting Codex code review. Merging is not phase
acceptance or production activation.

**Owner authorization (2026-09-12):** the owner directed implementation of the next
Phase 5 slice, with Codex reviewing after the fact rather than gating the design.
The four design decisions below were therefore taken during implementation and are
recorded here for review, not presented as pre-approved.

## Gap

TRACE-063 refuses a new-account invitation for a provider that already has an
account: `vendor_claim_invitation` raises `'Existing account requires reviewed
account linking'`. TRACE-066 reports that block in the invitation panel and offers
no action. No reviewed path existed to create such a link, so an applicant who
already holds a Mercurius login could not be onboarded at all.

## Recovered behavior, characterized before replacement

The surviving path was `VendorAccountLink` on `/admin/vendors/[id]`, calling three
recovered RPCs:

- `admin_link_contractor_to_user(contractor, email)` — scanned `auth.users` by
  lowercased email, set `contractors.user_id`, and **inserted `user_roles(vendor)`**
  in the same call. No onboarding review, no application snapshot, no compliance
  evidence, no reason, no record of who decided or why. Its one integrity rule —
  that an account belongs to a single contractor — was a `SELECT` under no lock, so
  two concurrent calls could both pass it.
- `admin_unlink_contractor(contractor)` — cleared `contractors.user_id` behind a
  bare `window.confirm`, with no reason, no record, and no check that the provider
  was live.
- `admin_get_contractor_linked_email(contractor)` — read-only; unchanged by this
  slice and no longer called.

This is the same shape of one-step legacy pipeline TRACE-066 removed from the
Applications queue, still reachable and still granting a role. It is not retained.

## Contract

1. Linking belongs to a provider already under onboarding review (TRACE-065). It is
   refused for a provider with no `vendor_onboarding` row, and for onboarding in any
   status other than `review`.
2. `public.vendor_link_existing_account(contractor, expected_revision, auth_user,
   reason, key)` binds one stated identity. It verifies that identity **by ID**
   against the recipient carried by the bound application snapshot. No email
   directory is searched from any layer of this slice, so a mistyped address cannot
   bind the wrong person — it can only fail to match.
3. The account must be confirmed (`email_confirmed_at`). An unconfirmed account is
   not evidence that anyone controls the mailbox.
4. The bound application version must still be current and its application must not
   be closed, so an identity is never bound to a superseded review.
5. Linking and the new-account invitation path are mutually exclusive: a live
   attempt blocks linking, and a link blocks dispatch at TRACE-063's own gate.
6. An inherited link — `contractors.user_id` set with no reviewed decision behind it
   — is reported as inherited and is neither adopted, replaced nor released here. It
   follows the compliance cutover path (TRACE-060/061), exactly as TRACE-065 leaves
   existing providers to it.
7. `public.vendor_release_linked_account(contractor, expected_revision, reason, key)`
   removes a binding this command created. It refuses an active provider: suspension
   comes first, so releasing an account is never what takes a live provider offline.
8. Both commands require a reason and an idempotency key, replay exactly, and record
   an immutable `vendor_account_link_decisions` row plus one `vendor_onboarding_events`
   entry at a new onboarding revision.
9. `public.vendor_account_link_overview(contractor)` is a read-only, operator-only
   readback. It declares no permission and enforces no transition: every decision
   stays in the commands above, so it cannot become a second, weaker copy of their
   predicates.

**Linking grants no role, accepts no compliance evidence, activates no provider and
publishes no listing.** The panel states this at each step, and suite 034 asserts it
rather than documenting it.

## Design decisions taken during implementation

1. **No role grant.** Legacy linking granted `vendor` as a side effect. Activation
   (`vendor_decide_onboarding`) is where the MPS §8 checklist is enforced, so the
   role belongs there. This slice deliberately leaves a gap: activation does not
   grant a role today either. See the follow-up below — that is a separate slice,
   not something to smuggle in here.
2. **Identity by ID, not by address.** Consistent with TRACE-063's rule and with
   TRACE-066's unknown-result reconciliation, the operator supplies the exact Auth
   user ID and the database proves it against the reviewed recipient.
3. **Release is retained, and gated.** Removing the legacy unlink with no
   replacement would leave no way to correct a mis-link. The reviewed release
   requires a reason, refuses an active provider, and refuses an inherited link.
4. **A real uniqueness invariant.** `contractors_one_linked_account`, a partial
   unique index on `contractors(user_id) where user_id is not null`, replaces the
   legacy unlocked `SELECT`. Two providers lock different rows, so only the index
   can decide the cross-provider race; the command maps its violation to
   `'Account already linked to another provider'` rather than surfacing a
   constraint name. The index applied cleanly to the reference seed.

## Execution boundary

No transport, Edge function, environment contract or delivery mode changes. No Auth
user is created, invited, confirmed or modified: this slice only reads `auth.users`
by ID. The two legacy write RPCs keep their signatures, lose their `authenticated`
grant, and raise `'Reviewed account linking required'` / `'Reviewed account release
required'` if reached by any other caller — two independent layers, both asserted.

## Acceptance and follow-ups

Evidence is recorded in PHASE-5-VALIDATION.md. SQL suite 034 covers permissions, the
missing-onboarding case, every refusal, the reviewed link, replay and key conflicts,
the cross-provider block, the invitation interlock in both directions, release
gating, re-linking after a release, decision immutability, and a row fingerprint
proving the readback writes nothing.

Open items for review:

- **Activation grants no role.** `vendor_decide_onboarding('activate')` does not
  insert `user_roles(vendor)`, and this slice does not add it. A provider can now be
  linked and activated and still have no vendor access. This was already true before
  the slice; removing the legacy grant makes it the only path, so it is now the next
  blocking question for provider access. It needs its own bounded slice.
- The TRACE-065 dark-theme contrast defect in the Applications queue table is
  unchanged.
- Whether the account panel should also appear in the provider compliance workbench
  rather than in the applications dialog and vendor detail page is an operations
  decision, not a page-local one.
- Real accounts, real identity verification, renewal/retention operations and
  authorized integration acceptance remain Phase 5 gates.
