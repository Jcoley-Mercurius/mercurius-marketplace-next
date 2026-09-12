# Phase 5 — Vendor role grant at reviewed activation (TRACE-068)

**Status:** IMPLEMENTED on branch `codex/phase5-activation-role`, base main `8f4ca0d`
(PR #20 / TRACE-067 merged). Awaiting Codex code review. Merging is not phase
acceptance or production activation.

**Authorization (2026-09-12):** the owner relayed Codex's go-ahead for this slice, named
in the TRACE-067 handoff as its next blocking question. The two product-semantic choices
below were put to the owner before implementation and answered explicitly. The remaining
decisions were taken during implementation and are recorded for review, not presented as
pre-approved.

## Gap

TRACE-067 removed the legacy `admin_link_contractor_to_user`, the last path that inserted
`user_roles(vendor)`. `vendor_decide_onboarding('activate')` never granted one. So a
provider could be linked, fully vetted and activated and still have no way into the
vendor portal, which `src/proxy.ts` gates on the `vendor` role.

## Characterized before change

- **What the role gates.** Only the `/vendor` route guard in `src/proxy.ts` and
  role-based redirects in `src/lib/auth/roles.ts`. No SQL function or policy checks
  `has_role(…,'vendor')`; vendor data access is by `contractors.user_id` ownership, and
  matching/offer acceptance is gated by `vendor_is_eligible` (TRACE-060).
- **Who can hold it today.** The signup trigger `handle_new_user` has always granted
  `homeowner` only since migration `20260602172542` (client role metadata ignored).
  No surviving function grants `vendor`.
- **Which activation paths exist.** Only `vendor_decide_onboarding`. The cutover
  commands (TRACE-061) record dispositions but never change onboarding status. No UI
  calls the activation command today.
- **Which paths bind an account.** Only the TRACE-067 reviewed link sets
  `contractors.user_id`. TRACE-063 invitation acceptance records a receipt and binds
  nothing (`-- No contractor linking, role grants, compliance approval or activation`).

## Contract

1. `vendor_decide_onboarding(…,'activate',…)` grants `vendor` to the provider's bound
   account only when that binding is the live reviewed link — the same predicate the
   account panel reports as `link_reviewed`.
2. Before granting, activation re-proves the binding against what is being activated:
   the account must still exist, be confirmed, and match the current reviewed
   application recipient. Otherwise activation is refused with
   `'Bound account no longer matches the reviewed application recipient'` and nothing
   is written.
3. With no bound account, activation proceeds and records `no_account`. With an
   inherited link, it proceeds and records `inherited_link`; the unreviewed account is
   not promoted.
4. If the account already holds `vendor`, activation records `already_held` and takes no
   ownership of it.
5. Suspension, renewal and rejection change no role and record no role decision.
   Reactivation of a suspended provider records `already_held` and keeps the original
   grant's ownership.
6. `vendor_release_linked_account` withdraws `vendor` only when activation granted it to
   that binding and nothing has withdrawn it since (`revoked`, or `already_absent` if it
   was removed out of band). A role the account held before activation is kept.
7. Every outcome is an immutable `vendor_role_decisions` row naming the provider,
   onboarding revision, account, the link decision it relied on, and the actor. The
   table is private: no client or `service_role` privilege.
8. `vendor_account_link_overview` adds `vendor_role_held`, `vendor_role_from_activation`
   and `role_decisions`. It still writes nothing and enforces nothing.

**The grant creates no listing, accepts no evidence, and changes no eligibility.** A
suspended provider keeps portal access but remains ineligible for matching.

## Decisions

Owner-answered (2026-09-12):

1. **No reviewed account: activate, no grant.** Recorded as `no_account`. Binding an
   accepted invitation recipient to the provider is a separate slice; until it lands, an
   invitation-onboarded provider activates without portal access.
2. **Suspension keeps the role.** Eligibility already closes matching and offer
   acceptance, and the portal remains the provider's view of assigned work, messages and
   payout holds.

Taken during implementation, for review:

3. **Refuse activation on a stale binding** rather than activate without a grant. A
   binding that no longer matches the reviewed recipient is a contradiction in the
   evidence, not an absence of it; failing closed lets the operator release and relink
   (both allowed in `review`/`suspended`).
4. **Ownership-scoped withdrawal.** Release removes only a role this path granted, so a
   legacy or separately granted `vendor` role is never silently taken. The log is ordered
   by an identity column because an activation and a release can share a transaction
   timestamp.
5. **Release is the only withdrawal point.** Rejection after a previous activation does
   not withdraw the role (see open items).

## Forward fix to TRACE-067

The live link was selected by `order by created_at desc, business_key desc`.
`created_at` defaults to `now()`, the transaction *start* time. Two consequences: a
release and a relink in one transaction tie and fall back to key order, and a command
that waited on the onboarding lock can carry an earlier timestamp than the decision it
waited behind. Suite 035 reproduced the first: after a release keyed `role-release-1`
and a relink keyed `role-link-2`, the overview reported the relink as not reviewed and
the release command refused it as inherited. Role ownership depends on this predicate,
so the migration adds `vendor_account_link_decisions.sequence` (identity, unique) and
orders by it in the release command, the overview and the new helper. Every write happens
under the onboarding row lock, so sequence order is decision order per provider. No stored
decision is rewritten.

## Execution boundary

Migration `20260912003000_vendor_activation_role.sql` only. No Edge function, transport,
environment contract, delivery mode, Auth user or production system is changed. The
`vendor_decide_onboarding` and `vendor_release_linked_account` bodies are copied verbatim
from their previous definitions apart from the marked additions. Their grants are restated
(revoke from `public`/`anon`/`authenticated`/`service_role`, execute to `authenticated`);
checked on the isolated stack, the effective privileges are unchanged from before the
migration (`anon` and `service_role` false, `authenticated` true).

## Open items

- **Rejection after activation keeps the role.** A provider activated, suspended, sent
  back to review by a new application revision, then rejected, keeps `vendor` for its
  still-bound account, and TRACE-067 release refuses a rejected provider. Whether
  rejection or release-from-rejected should withdraw it is an owner decision.
- **Invitation-path providers get no portal access** until accepted invitations are
  bound to the provider under review (owner decision 1).
- **Account deletion** is not addressed; `user_roles` cascades on Auth user deletion
  while `vendor_role_decisions` retains the reference and would block that delete. MTS §6
  asks for role-grant audit on deletion; this needs the retention/deletion slice.
- **The activation race** in the concurrency script exercises one ordering per run and
  reports which won; both orderings are asserted in suite 035 deterministically.
- No UI invokes activation; the grant is reachable only through the existing command.
- The TRACE-065 dark-theme contrast defect in the Applications queue table is unchanged.
- Real accounts, identity verification and authorized integration acceptance remain
  Phase 5 gates.
