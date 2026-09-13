# Phase 5 — Bind an accepted invitation to the provider under review (TRACE-070)

**Status:** IMPLEMENTED on branch `codex/phase5-invitation-binding`, based on `20f0a4c`
(TRACE-069, carried to `main` by PR #23). Awaiting Codex code review. Merging is not phase
acceptance or production activation.

**Base note (2026-09-12):** PR #22 was merged into its stacked base branch
`codex/phase5-activation-role` *after* PR #21 had already merged that branch into
`main`, so TRACE-069 never reached `main` (`0f408be`). Owner decision: land it on its own.
PR #23 carries only `20f0a4c` to `main`; its CI passed on all three jobs. This branch is
based on `20f0a4c`, so once #23 merges its pull request contains only TRACE-070.

**Authorization:** owner instruction 2026-09-12 to implement the next Phase 5 slice,
named in the TRACE-069 handoff. The design decisions below were taken during
implementation and are recorded for review, not presented as pre-approved.

## Gap

TRACE-063 acceptance appends an immutable receipt proving the verified recipient
explicitly accepted, and binds nothing. TRACE-068 grants `vendor` at activation only to
a *reviewed* binding and records `no_account` otherwise (owner decision 1 of TRACE-068).
So a provider onboarded through the invitation path — the new-account path — always
activated without portal access.

## Characterized before change

- **Acceptance evidence.** `vendor_invitation_acceptances` holds one row per accepted
  attempt: attempt, application version, Auth user, time. Written only by
  `vendor_accept_invitation`, which requires the caller to be the dispatch's recorded
  Auth user with a confirmed, matching address, a current application version and
  onboarding not suspended/rejected.
- **Attempt status is not evidence.** The legacy operator assertion
  `vendor_record_invitation` can still move an *undispatched* attempt through
  `submitted → delivered → accepted` with no receipt. Suite 037 reproduces this.
- **The stated-identity link already accepts the invited account.** After acceptance
  the attempt is not live, the provider is unlinked, and the invited account is
  confirmed at the recipient address, so `vendor_link_existing_account` would bind it
  if an operator typed its Auth user ID. That binding rests on the operator's
  transcription rather than the receipt, and nothing offered it.
- **The reviewed-link predicate** (`private.vendor_reviewed_link`) is shared by the
  activation grant, the release command, the account overview and the TRACE-069
  checklist.

## Contract

1. `public.vendor_bind_invited_account(contractor, expected_revision, attempt, reason,
   key)` is operator-only, requires a reason and key, and replays exactly.
2. It binds the Auth user named by the **acceptance receipt** for that attempt. No
   identity is accepted from the caller and no email directory is searched.
3. The receipt must belong to this provider (another provider's receipt is reported as
   `'Accepted invitation required'`, exactly like a missing one) and answer the
   application version onboarding is currently bound to
   (`'Accepted invitation is for a superseded application version'`).
4. Onboarding must be in `review` at the expected revision, and the bound application
   version current and open (the TRACE-067 freshness helper).
5. The account is re-proven by ID at binding time: it exists, is confirmed, and its
   address still equals both the dispatch recipient and the reviewed snapshot recipient.
6. The provider must be unlinked, the account unlinked elsewhere (partial unique index
   decides races), and no newer invitation attempt live.
7. The binding is one `vendor_account_link_decisions` row with `action='link'` and the
   new `invitation_attempt_id`, plus one `invited_account_bound` onboarding event at a
   new revision.
8. Because it is a reviewed link, the **unchanged** TRACE-068 activation grants `vendor`
   to it (`granted`, naming this decision), the unchanged release withdraws that grant,
   and the TRACE-069 checklist reports `account_reviewed`.
9. `vendor_account_link_overview` adds `link_source` (`stated_identity` /
   `accepted_invitation`), `invitation_attempt_id` per decision, and
   `accepted_invitation` — the newest receipt with the facts the command checks. Still
   facts only.

**Binding grants no role, accepts no compliance evidence, activates no provider and
publishes no listing.**

## Decisions taken during implementation, for review

1. **Operator-reviewed binding, not automatic.** Binding at acceptance would change
   TRACE-063's explicit "no contractor linking" contract and let a recipient action
   bind an identity without review. Binding silently at activation would make activation
   a second place identities are chosen. A separate reviewed step matches TRACE-067 and
   keeps activation's grant logic untouched.
2. **Reuse the TRACE-067 decision log** with a nullable receipt column rather than a
   parallel table, so there is still exactly one live-link predicate and one release
   path. A check constraint keeps the column on `link` rows only.
3. **Receipt, not status.** Only `vendor_invitation_acceptances` counts.
4. **Superseded receipts are refused** rather than accepted with a warning: acceptance
   answered a specific application revision. Owner agreed 2026-09-12, with recovery by a
   new invitation or by account ID, and directed that the recovery be fixed if it did
   not work. It did not — see the recovery fix below.
5. **Cross-path key isolation.** The TRACE-067 replay helper (same signature, replaced)
   now treats a key recorded by an invitation binding as a conflict, and the new replay
   helper treats a stated-identity link or release key as a conflict, so no key can
   replay as the other path's decision.
6. **The stated-identity link stays available** alongside the receipt action; the
   panel does not hide it.

## Recovery fix (owner direction 2026-09-12)

**Defect.** The first implementation told operators a superseded acceptance could be
recovered by sending a new invitation. That wedges the provider. The recipient's Auth
account already exists, so:

1. `vendor_prepare_invitation` and `vendor_claim_invitation` accepted the new attempt;
2. Auth refuses an invitation to a registered address, and the TRACE-063 handler records
   every Auth error as `unknown`;
3. reconciliation requires the account's `invited_at` to postdate the dispatch, which the
   original invitation's timestamp does not, so it can never be reconciled;
4. an `unknown` attempt cannot be closed and occupies the one live slot, which blocks
   another invitation *and* TRACE-067 linking by account ID.

Suites 031 and 033 had exercised re-inviting an accepted recipient only because their
fixtures set `invited_at` freely.

**Fix.** `private.vendor_invitation_recipient_account` finds, by ID from this provider's
own acceptance receipts, an existing account at the reviewed recipient address. Both
`vendor_prepare_invitation` and `vendor_claim_invitation` (bodies otherwise copied
verbatim) refuse with `'Recipient already holds an account; link it by account ID'`
before any attempt or dispatch is recorded — the claim check also covers an attempt
prepared before this migration. `vendor_invitation_overview` reports
`recipient_account_id`. The invitation panel states the refusal instead of offering
Prepare; the account panel's superseded-receipt message directs the operator to link by
account ID and offers "Use this account ID", which fills the stated-identity form only —
the operator still confirms with a reason and `vendor_link_existing_account` still
verifies the account. Suite 037 proves the full recovery: re-invitation refused, link by
ID recorded, activation grants `vendor`.

**Recovery that remains working:** linking by account ID. A new invitation is now the
recovery only when the recipient holds no account.

## Execution boundary

Migration `20260912005000_vendor_invitation_binding.sql` only: one nullable column, one
check constraint, one replaced private helper (same signature), two new private helpers,
one new command, the account and invitation overviews replaced with added keys, and the
recovery guard in `vendor_prepare_invitation` and `vendor_claim_invitation`. Effective
execute privileges on the three replaced public functions were compared before and
after on the isolated stack and are unchanged (`authenticated` only). No Edge function,
transport, environment contract, delivery mode, Auth user, activation or release body
is changed. Grants restated: new command and overview `authenticated` only; helpers
no client or `service_role` privilege.

## Open items

- **PR #23 (TRACE-069 to `main`) awaits merge** (see base note).
- **The general `unknown` wedge remains for other existing accounts.** An invitation to
  an address that already has an Auth account from outside this provider's receipts —
  for example a homeowner signup — still becomes an unreconcilable, unclosable `unknown`
  attempt. That predates this slice (TRACE-063) and needs its own fix: a definitive Auth
  refusal should be recordable as failed and closable. *Addressed by the TRACE-063
  forward fix in PHASE-5-INVITATION-REFUSAL.md (branch `codex/phase5-auth-refusal`).*
- Rejection-after-activation role policy and account deletion versus role/link audit
  rows remain as recorded in TRACE-068.
- An invitation accepted for an earlier application revision cannot be bound; whether
  operators need a reviewed way to carry acceptance across a revision is an owner
  question, not assumed here.
- Hosted Auth/mail round-trip, real accounts and authorized integration acceptance
  remain Phase 5 gates. The TRACE-065 dark-theme contrast defect in the Applications
  queue table is unchanged.
