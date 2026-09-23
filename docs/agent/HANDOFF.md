# Agent handoff — 2026-09-23

Each section carries its own date; the repository checkpoint below was taken on
2026-09-10 and the latest slice checkpoint is TRACE-083.

## Repository checkpoint

- GitHub checked on 2026-09-10: latest merged PR is [#15, provider compliance operations](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/15), merged 2026-09-08.
- Synced base: `d815e900b158a5a4283c0aa073f872cc57e1eeb9` (`origin/main`).
- Working branch: `codex/vscode-system-setup`, rebased 2026-09-15 onto main `0d761f3`
  (PR #27 merged) and committed for its own PR.
- Local `main` was fast-forwarded from `94d608a` to the merged base.
- Recheck `git status --short --branch` and remote state before assuming this snapshot is current.

## Preserved older work

The pre-sync vendor edits, lockfile edits and untracked vendor components/temporary
compile route are saved in the Git stash named
`pre-vscode-sync-2026-09-10 vendor WIP at 94d608a`.
It was `stash@{0}` when created; use `git stash list` to locate it by name later.
It has not been reapplied over the newer implementation. Inspect/reconcile it in
an isolated recovery branch based on `94d608a` if those changes are needed.
Do not drop the stash until its contents have been reviewed. Existing ignored
local environment files were preserved and have not been validated for runtime use.

## Product checkpoint

PR #15 implements TRACE-062: admin compliance operations, version-bound private
document review/binding, evidence reuse, and protected provider decisions.
[The slice report](../../governance/PHASE-5-COMPLIANCE-OPERATIONS.md) defines its
limits. [Phase 5 handoff](../../governance/PHASE-5-HANDOFF.md) and
[validation](../../governance/PHASE-5-VALIDATION.md) remain the detailed evidence.

Phase 5 is open. Invitation/Auth provisioning, delivery/acceptance receipts,
renewal/retention operations, tax/promotions, recurring automation, finance
operations and authorized integration/manual acceptance remain follow-ups.
Phase 6 has not started according to the combined roadmap. Merged code is not
production activation or blanket phase acceptance.

## This slice

Bring the merged system into this local folder and provide a portable VS Code
workspace, tasks, concise system map and agent entry points. No product rules,
application code, database migrations or provider configuration are changed by
the editor setup additions.

Next: choose one remaining Phase 5 item from the governing handoff and inspect
its existing contracts before implementation. Do not treat historical checklists
as current branch/merge status; reconcile them with the latest slice evidence.

## Local verification

- Workspace/extension/task JSON parses; every task maps to an existing npm script.
- Relative links in the agent guide/handoff resolve; `git diff --check` passes.
- `npm ci --cache /tmp/mercurius-npm-cache --no-audit --no-fund` passed.
- `npm run scan:secrets`, `npm run lint`, and the current-source `npm run typecheck` passed.
- `npm run test:unit` passed: 7 test files, 84 tests.
- Initial TypeScript check found stale `.next/dev/types` referencing the stashed
  temporary route. Generated type directories were archived under
  `/tmp/mercurius-pre-sync-next-ibnyrxp_`; the original build cache remains.
  A partial full-cache copy also remains in that temporary directory.
- No dev server, browser verification, database tests, production build or external
  integration acceptance was performed for this documentation/editor slice.

## Current slice — TRACE-064 (2026-09-10, awaiting Codex review)

- Branch `codex/phase5-dependency-security` at `ce5527b`, base `d815e90`, worktree
  `../mercurius-dependency-security`. PR #17 open; final-head CI passed all three jobs.
- The fix was merged into PR #16's branch (`23f1150`, owner request 2026-09-11);
  append-only governance conflicts kept both TRACE-063 and TRACE-064. PR #16
  final-head CI (run 34561827113) passed all three jobs.
- 2026-09-11 16:29 UTC: owner merged PR #16 (main `5a3bffe`, tree identical to
  `23f1150`); PR #17 closed as merged because its commit was already included.
  Governance text written before the merge still says "draft PR #16" / "must
  incorporate"; refresh it in the next slice.
- TRACE-065 (start onboarding review) has since been implemented; see its own
  section below.
- Why: post-merge advisories (critical Next.js) fail the unchanged `audit:prod`
  CI gate on main and on draft PR #16 (TRACE-063 invitations, head `65198f1`).
- Change: next/eslint-config-next 16.3.0 → 16.3.4; lockfile-only sharp 0.35.4,
  js-yaml 4.3.2, hono 4.13.7. No app, schema, Edge or configuration change.
- Evidence: `governance/PHASE-5-DEPENDENCY-SECURITY.md` and the TRACE-064 section of
  `governance/PHASE-5-VALIDATION.md`.
- Open: post-merge Codex review of TRACE-063/064; shadcn dependency-classification
  decision. Merging is not phase acceptance or production activation.
- Next: see the TRACE-065 section below.

## Current slice — TRACE-065 (2026-09-12, awaiting Codex code review)

- Branch `codex/phase5-onboarding-intake` at `b2dadf2`, base main `5a3bffe`, worktree
  `../mercurius-onboarding-intake`. PR #18 converted from the design proposal to the
  implementation PR and marked ready for review.
- Owner authorized implementation without waiting for a separate Codex design
  confirmation; both 2026-09-11 Codex design corrections are implemented as written,
  so Codex review of this slice is a code review.
- Change: migration `20260911001000` adds the private, immutable
  `vendor_onboarding_review_starts` request table and the creation-only
  `vendor_start_onboarding_review`, plus operator-only
  `vendor_onboarding_intake_status` readback. The Applications queue replaces the
  disabled legacy approve action with a reason-required ConfirmAction gated on server
  readback. No Auth user, role, email, invitation, evidence, activation or public
  listing results from the command.
- Evidence: `governance/PHASE-5-ONBOARDING-INTAKE.md` and the TRACE-065 section of
  `governance/PHASE-5-VALIDATION.md`. Locally: 582 SQL assertions across 23 suites
  (64 new), new different-key/same-key start concurrency script wired into CI, clean
  reset and replay, 84 unit tests, 58-page build, 79 browser cases (5 new).
- Final-head CI on `b2dadf2` (run 34693678032) passed all three jobs, including the
  new onboarding concurrency step. The earlier red checks on PR #18 are the
  push-triggered run cancelled by the workflow's concurrency group.
- Open: Codex code review of PR #18; decision on applications with
  no intake version (fail closed today, no backfill invented); pre-existing
  dark-theme contrast defect in the Applications table; default contractor columns at
  activation. Merging is not phase acceptance or production activation.
- Next: invitation operator UI (operator-entered expiry, no default), then
  existing-account linking.

## Current slice — TRACE-066 (2026-09-12, awaiting Codex code review)

- Branch `codex/phase5-invitation-operations` at `2540744`, base main `f47ac84`,
  worktree `../mercurius-invitation-operations`. **Merged as PR #19 on 2026-09-12
  (main `717877d`).** The "not pushed" and "awaiting review" wording below predates
  that merge.
- PR #18 merged on 2026-09-12 (main `f47ac84`), so TRACE-065 is in and this slice
  builds on it rather than on `b2dadf2`.
- Change: migration `20260912001000` adds the read-only, operator-only
  `vendor_invitation_overview` readback. The Applications dialog gains a Provider
  invitation panel wiring the existing `vendor-invite` prepare/send/reconcile/close
  commands, each behind ConfirmAction and each confirmed by re-reading the server.
  Invitation expiry is operator-entered with no default, and the preparation key is
  derived from it so a retry replays. The blocked legacy resend/sync controls are
  removed; the recovered invite columns stay as labelled history. No transport,
  Edge, environment or delivery-mode change; dispatch stays disabled by default.
- Evidence: `governance/PHASE-5-INVITATION-OPERATIONS.md` and the TRACE-066 section
  of `governance/PHASE-5-VALIDATION.md`. Locally: 626 SQL assertions across 24
  suites (44 new), all four concurrency scripts unchanged and passing, clean reset
  and replay, 84 unit tests, 58-page build, 90 browser cases (11 new), zero audit
  findings.
- Second commit `2540744` fixes a 320px reflow defect this slice surfaced and
  corrects an earlier misdiagnosis of it. `DialogContent`'s single grid track was
  `auto`, so the `datetime-local` control's 271px intrinsic minimum widened the
  whole dialog; the track is now `minmax(0,1fr)`. It is not the `DialogFooter`
  bleed first blamed — `offsetWidth` equals `clientWidth`, so no scrollbar is
  involved. Shared primitive, so every dialog is affected; all 90 browser cases
  pass. Edge gates now run locally on pinned Deno 2.9.6 (installed at
  `~/.deno/bin`): 11 functions type-check clean, 44 handler tests pass.
- Pushed as PR #19. Final-head CI on `2540744` (run 34699048634) passed all three
  jobs; the red checks on the PR are the push-triggered run cancelled by the
  workflow's concurrency group. CodeRabbit produced only a free-plan summary, not a
  line-by-line review, so it is not review evidence.
- Open: Codex code review. The TRACE-065 dark-theme contrast defect in
  the queue table is unchanged. The `@visual` suite has no Linux baselines (only
  `-win32` is tracked), so it cannot compare here; adopting baselines is a separate
  decision. Merging is not phase acceptance or production activation.
- Next: TRACE-067, implemented below.

## Current slice — TRACE-067 (2026-09-12, implemented, unpushed)

- Branch `codex/phase5-account-linking` at `105a64e`, base main `717877d`, worktree
  `../mercurius-account-linking`. **Merged as PR #20 on 2026-09-12 (main `8f4ca0d`).**
- Owner instruction 2026-09-12: implement the next Phase 5 slice; Codex reviews after
  the phase or on request rather than gating the design. The four design decisions are
  recorded in the slice report for review, not presented as pre-approved.
- Change: migration `20260912002000` adds the immutable `vendor_account_link_decisions`
  log, the reviewed `vendor_link_existing_account` and `vendor_release_linked_account`
  commands, the operator-only `vendor_account_link_overview` readback, and a partial
  unique index on `contractors(user_id)`. The identity is verified by ID against the
  recipient in the bound application snapshot; no email directory is searched anywhere
  in the slice. The legacy `admin_link_contractor_to_user` / `admin_unlink_contractor`
  lose their `authenticated` grant and fail closed, and the ungated vendor-detail card
  is replaced by the reviewed panel, mounted there and in the Applications dialog.
- Linking grants no role, accepts no evidence, activates no provider and lists nothing.
- Evidence: `governance/PHASE-5-ACCOUNT-LINKING.md` and the TRACE-067 section of
  `governance/PHASE-5-VALIDATION.md`. Locally: 704 SQL assertions across 25 suites
  (78 new), a new three-race concurrency script wired into CI, clean reset and replay,
  84 unit tests, 58-page build, 103 browser cases (13 new), 0 audit findings, Edge
  gates unchanged.
- Open: **activation grants no vendor role** — `vendor_decide_onboarding('activate')`
  never inserted one, and removing the legacy grant makes that the only path, so a
  linked and activated provider still has no vendor access. It needs its own slice and
  is the next blocking question for provider access. The TRACE-065 dark-theme contrast
  defect is unchanged. Codex code review is open.
- Next: the vendor role grant at activation.

## Current slice — TRACE-068 (2026-09-12, PR #21 open)

- Branch `codex/phase5-activation-role` at `51a9fcc`, base main `8f4ca0d`, worktree
  `../mercurius-activation-role`. PR #21 open; pull-request CI run 34718397577 passed
  all three jobs (the red push run 34718383193 was cancelled by the concurrency group).
- Owner relayed Codex's go-ahead. Owner answered two semantics questions: a provider
  with no reviewed account activates without a grant; suspension keeps the role.
- Change: migration `20260912003000` makes `vendor_decide_onboarding('activate')` grant
  `vendor` to the live reviewed link after re-proving it (refuses a changed/unconfirmed
  binding), records every outcome in immutable `vendor_role_decisions`, and makes
  `vendor_release_linked_account` withdraw only an activation-owned grant. Account panel
  reports the role state. Forward-fixes TRACE-067 live-link ordering (identity column).
- Evidence: `governance/PHASE-5-ACTIVATION-ROLE.md` and the TRACE-068 section of
  `governance/PHASE-5-VALIDATION.md`. Locally: 753 SQL assertions across 26 suites (49
  new), new concurrency script wired into CI, clean reset and replay, 84 unit tests,
  58-page build, 107 browser cases (4 new), 0 audit findings, Edge gates unchanged.
- Open: Codex code review; rejection-after-activation keeps the role (owner decision);
  invitation-path providers get no portal access until accepted invitations are bound;
  account deletion vs. role audit rows; final-head CI.
- Next: see TRACE-069 below.

## Current slice — TRACE-069 (2026-09-12, draft PR #22, stacked on #21)

- Branch `codex/phase5-onboarding-decisions` at `20f0a4c`, based on TRACE-068 `51a9fcc`,
  worktree `../mercurius-onboarding-decisions`. Draft PR #22 targets
  `codex/phase5-activation-role`; retarget to `main` after #21 merges.
- Owner decision 2026-09-12: license/insurance are recorded against a reviewed
  application document with an operator-entered expiry (the workbench's scoped binding
  needs packages, which exist only after activation).
- Change: migration `20260912004000` adds read-only `vendor_onboarding_checklist`,
  idempotent `vendor_record_checklist_evidence` with an immutable request log, and
  revokes client execute on the raw `vendor_record_evidence`. New "Activation checklist"
  panel (Applications dialog and vendor detail) records evidence and runs
  activate/suspend/renew/reject behind readback-gated ConfirmAction.
- Evidence: `governance/PHASE-5-ONBOARDING-CHECKLIST.md` and the TRACE-069 section of
  `PHASE-5-VALIDATION.md`. Locally: 811 SQL assertions across 27 suites (58 new), new
  concurrency script in CI, clean reset and replay, 84 unit tests, 58-page build, 121
  browser cases (14 new), 0 audit findings.
- Open: Codex review of #21 and #22; CI on #22; document sufficiency; structured
  evidence references (owner decision); rejection-after-activation role policy.
- Next: bind accepted invitations to the provider under review, so invited providers
  receive the vendor role at activation.

## Current slice — TRACE-070 (2026-09-12, PR #24 open)

- Branch `codex/phase5-invitation-binding` at `126fec1`, based on `20f0a4c` (TRACE-069),
  worktree `../mercurius-invitation-binding`. PR #24 targets `main`.
- **TRACE-069 landed:** PR #23 (only `20f0a4c`, CI run 34725307231 green) merged to
  `main` as `14f82fe` on 2026-09-12. PR #24 now differs from `main` only by `126fec1`;
  its pull-request CI run 34726679013 passed all three jobs (red run 34726598257 is the
  cancelled push run). **Merging #24 was refused by the agent permission classifier
  (merge without review) and awaits the owner or Codex review.**
- GitHub cleanup 2026-09-12: 21 remote `codex/*` branches fully contained in `main` were
  deleted, including the stale `codex/phase5-activation-role` (content identical to
  `main`). Kept: `codex/phase5-invitation-binding` (PR #24) and the non-codex
  `v0/*` and `coderabbit/*` branches, which are merged but were created by other tools.
  Local worktrees and their local branches are untouched.
- Change: `vendor_bind_invited_account` binds the account named by the acceptance receipt
  as a reviewed link, so activation grants invited providers `vendor` unchanged.
  Recovery fix (owner direction): re-inviting a recipient who already accepted would
  wedge an unreconcilable, unclosable `unknown` attempt; prepare and claim now refuse it
  and the panels direct the operator to link by account ID.
- Evidence: `governance/PHASE-5-INVITATION-BINDING.md` and the TRACE-070 section of
  `PHASE-5-VALIDATION.md`. Locally: 883 SQL assertions across 28 suites (72 new), all
  eight concurrency scripts in CI order, clean reset and replay, 84 unit tests, 58-page
  build, 134 browser cases (13 new), 0 audit findings.
- Open: merge #24 after review; general Auth-refusal `unknown` wedge (TRACE-063)
  for addresses with an account outside this provider's receipts; rejection-after-
  activation role policy; account deletion vs role/link audit rows.
- Next: fix the TRACE-063 Auth-refusal wedge (definitive refusals recordable as failed
  and closable). Done on `codex/phase5-auth-refusal`; see below.

## Current slice — TRACE-063 forward fix (2026-09-12, awaiting review)

- Branch `codex/phase5-auth-refusal`, base `main` `26900eb` (PR #24 merged), worktree
  `../mercurius-auth-refusal`. Commit `97a423e`; PR #25 open; pull-request CI run 34731584926 passed all three jobs (red run 34731571398 is the cancelled push run).
- Change: migration `20260912006000` records Auth's definite `422 email_exists` refusal as a
  terminal `failed` attempt through service-only `vendor_refuse_invitation` (handler report
  on a started reservation, or an account read back by ID that held the address, confirmed,
  before dispatch). Edge `send` refusal branch and `refuse` action; panel explains refusals
  and offers "Record Auth refusal" for unknown attempts. Recovery is linking the existing
  account by ID.
- Evidence: `governance/PHASE-5-INVITATION-REFUSAL.md` and the forward-fix section of
  `PHASE-5-VALIDATION.md`. Locally: 936 SQL assertions across 29 suites (53 new), new
  concurrency script in CI, all nine scripts in CI order, clean reset and replay, 13
  `vendor-invite` Edge cases (4 new), real handler round-trip against local Auth, 84 unit
  tests, 58-page build, 139 browser cases (5 new), 0 audit findings.
- **Merged as PR #25** (main `6bdcff3`); see TRACE-071 below.
- Open: commit/PR and CI; Codex review; hosted refusal contract; owner question on
  re-inviting unconfirmed existing accounts; rejection-after-activation role policy;
  account deletion vs audit rows.

## Current slice — TRACE-071 hosted invitation delivery (2026-09-12, revised 2026-09-13, uncommitted)

- Branch `codex/phase5-hosted-invitation-delivery`, base main `6bdcff3`, worktree
  `../mercurius-hosted-invitation-delivery`. Not committed or pushed.
- Change: `vendor-invite` gains a `hosted` delivery mode (`delivery.ts`) that dispatches
  only when `MERCURIUS_INVITATION_PROJECT_REF` and `MERCURIUS_INVITATION_SITE_ORIGIN`
  match `SUPABASE_URL` and `SITE_URL`; anything else stays `INVITATION_DELIVERY_DISABLED`.
  Tracked invite template `supabase/templates/provider-invitation.html`; local
  `config.toml` mirrors the subject/template/expiry/allowlist; hosted arming runbook. No
  migration, app, product-rule, hosted secret, Auth setting or deployment change.
- Owner decisions 2026-09-13, implemented: Auth email-link lifetime 3 hours
  (`otp_expiry = 10800`); the recipient link is the site's own `/set-password` with
  `token_hash` and the attempt passed as invite metadata, which `/set-password` verifies
  by POST so a mail scanner's GET cannot burn it; MTS §9 lists the three invitation
  variables. Hosted Resend/SMTP setup is owner work, deliberately not attempted.
- Findings: earlier local round-trips never had the invitation redirect on the allowlist
  (Auth falls back to the Site URL root and drops the attempt ID); and appending to
  `{{ .RedirectTo }}` renders a malformed link on that fallback, which is why the link is
  built from `{{ .SiteURL }}` plus invite metadata.
- Evidence: `governance/PHASE-5-HOSTED-INVITATION-DELIVERY.md`, TRACE-071 section of
  `PHASE-5-VALIDATION.md`. 15 `vendor-invite` Edge cases (20-config disabled table, hosted
  dispatch with invite metadata, hosted refusal/unknown), all 12 guard mutants killed,
  three local Auth/mail-sink round-trips (including the scanner GET that consumes no
  token and a refused reuse), lint/types/secrets/audit and 84 unit tests. SQL, build and
  browser suites not re-run (no code in their scope changed).
- Open: owner-authorized hosted arming and acceptance (Resend SMTP, Auth URLs/template/
  expiry, secrets, deploy, one invitation to an owner mailbox), tracked as owner work;
  whether operators need a reviewed reissue command when a link outlives its 3 hours;
  Codex review; commit/PR/CI. Owner asked to hold the commit until these updates landed.
- **Merged as PR #26** (main `d307ba0`); the "not committed" wording above predates that.

## Current slice — TRACE-072 compliance expiry (2026-09-13, merged as PR #27)

- Branch `codex/phase5-evidence-renewal`, base main `d307ba0`, worktree
  `../mercurius-evidence-renewal`. PR #27 at `f57d46d` (`b5355f5` slice, `f57d46d`
  payout forward fix). **Merged 2026-09-14 (main `0d761f3`).**
- Owner decisions 2026-09-13: 30-day notice; a lapse flags only (no status change);
  lapsed qualifications remove matching but do not hold payouts (lapsed payout onboarding
  and suspension still hold; migration `20260913002000`, `private.vendor_payout_eligible`);
  renewed-document upload outside the application is the next slice.
- Change: migration `20260913001000` adds read-only `vendor_evidence_renewal_queue`
  (operator), `vendor_own_evidence_renewal` (vendor; item/expiry/state only) and checklist
  `renewal_due`. New `/admin/compliance/renewals` queue, "Renewal due" checklist badge,
  vendor-portal notice. No write command, table or scheduler.
- Evidence: `governance/PHASE-5-EVIDENCE-RENEWAL.md` and the TRACE-072 section of
  `PHASE-5-VALIDATION.md`. 987 SQL assertions across 30 suites (51 new; window mutant
  killed; payout cases fail without the fix), clean reset/replay, all nine concurrency
  scripts, 95 unit tests (11 new), 59-page build, 152 browser cases (one unrelated
  `mds.spec.ts` Escape/focus flake, passed 3/3 on rerun), lint/types/secrets, 0 audit.
- Open: Codex review.
- Next: private renewal-document upload bound to the provider.

## Current slice — TRACE-074 renewal document retention (2026-09-16, PR open)

- TRACE-073 renewal-document upload merged as PR #29 (main `bbb0482`).
- Branch `codex/phase5-renewal-retention`, base main `bbb0482`, worktree
  `../mercurius-renewal-retention`.
- Owner decisions 2026-09-15: CFG-011 applies to declined renewal documents only, 90 days
  from the decline; operator-run queue, no scheduler; provider-level retention hold; quarantine,
  then permanent deletion after 14 days (value to confirm at review).
- Change: migration `20260915002000` (private quarantine bucket, immutable hold events and
  retention actions, prepare/record commands that record only what `storage.objects` shows,
  hold commands, retention queue). Route `/api/renewal-documents/retention`; new
  `/admin/compliance/retention`; checklist hold control and retention badges.
- Evidence: `governance/PHASE-5-RENEWAL-RETENTION.md` and the TRACE-074 section of
  `PHASE-5-VALIDATION.md`. 1182 SQL assertions (111 new, eight guard mutants killed), all
  eleven concurrency scripts, clean reset/replay, 32-check local route/Storage round trip,
  108 unit tests, build, 175/182 browser cases (six `@visual` without Linux baselines, one
  teardown flake passed 3/3 on rerun), lint/types/secrets, 0 audit.
- Open: Codex review; CI; 14-day confirmation; never-submitted uploads and application
  documents outside retention; operator `DELETE` policy on `vendor-documents`.
- Next: choose between retention for never-submitted uploads/application documents (needs a
  clock decision) and another Phase 5 gate (tax/promotions, recurring automation, finance).

## Current slice — TRACE-075 finance reconciliation (2026-09-16, PR open)

- TRACE-074 merged as PR #30 (main `d422816`).
- Branch `codex/phase5-finance-reconciliation`, base main `d422816`, worktree
  `../mercurius-finance-reconciliation`. Committed and pushed; PR open against `main`.
- Owner direction 2026-09-16: finance operations (charges, refunds, earnings, payouts). Scope
  and decisions D1–D5 are implementer choices recorded for review.
- Change: migration `20260916001000` adds read-only `money_finance_reconciliation` (finance
  authority) with 13 per-invoice ledger checks, funds state mirroring `money_payable`, Stripe
  readback state, account totals and exceptions. New `/admin/finance` page and nav entry.
- Evidence: `governance/PHASE-5-FINANCE-RECONCILIATION.md` and the TRACE-075 section of
  `PHASE-5-VALIDATION.md`. 1295 SQL assertions (113 new, 12 guard mutants killed), clean
  reset, 115 unit tests, build, 184/190 browser cases (6 `@visual` without Linux baselines),
  lint/types/secrets, 0 audit.
- Open: Codex review; CI; owner question on the global unsupported-event payout hold.
- Next: finance operator command gateway (authenticated actor, second-person approval,
  ConfirmAction) for refunds, holds, readbacks and ACH outcomes.

## Current slice — TRACE-076 finance operator commands, part 1 (2026-09-17, merged as PR #32)

- **Merged 2026-09-17 14:44 UTC as PR #32 (main `f945910`)** on owner instruction, after both
  final-head CI runs passed (the push run's one unrelated `invitation-binding` browser failure,
  "Response has been disposed", passed on rerun). "PR open" wording below predates the merge.

- TRACE-075 merged as PR #31 (main `3f98939`).
- Branch `codex/phase5-finance-commands`, base main `3f98939`, worktree
  `../mercurius-finance-commands`. Committed and pushed; PR open.
- Owner direction 2026-09-16: part 1 of the finance operator command gateway (refund send and
  readback, payout holds, Stripe readback record/resolve, event replay/exclusion) with
  ConfirmAction; propose the actor and approval design for Codex review. Owner decision: keep
  the global unsupported-event payout hold.
- Change: migration `20260916002000` adds `authenticated` gateway commands whose actor is always
  `auth.uid()`, an immutable request → different-operator approval → requester execution flow
  bound to the exact command, readback and refund-readback attribution, and
  `money_finance_operations`. `refund-invoice` gains a Stripe readback action. The
  `/admin/finance` page gains the FinanceCommands panel. Kernels are unchanged.
- Evidence: `governance/PHASE-5-FINANCE-COMMANDS.md` (design G1–G9) and the TRACE-076 section of
  `PHASE-5-VALIDATION.md`. SQL 043 has 132 assertions (14 guard mutants killed); the full
  regression passes; a new concurrency script is in CI with all twelve passing in order;
  57 Edge cases (7 new); 125 unit tests; build; 191/198 browser cases (6 `@visual` without Linux baselines, one unrelated fixture flake passing 3/3 on rerun), finance specs 16/16; 0 audit findings.
- Open: Codex design and code review (G3 two-person hold release, G9 request expiry or
  withdrawal); CI; `paymentFunctionError` loses Edge error codes (shared helper, own fix);
  a stuck `reconcile` refund cannot be re-sent; part 2 (refund authorization, chargeback
  allocation, ACH preparation, bank outcomes, retry).
- Next: CI and Codex review of the PR; then part 2.

## Current slice — TRACE-077 finance commands, part 2A (2026-09-21, PR open)

- Branch `codex/phase5-finance-refunds`, base main `f945910`, worktree `../mercurius-finance-refunds`.
- Owner direction 2026-09-17: merge PR #32 after final CI (done), then start part 2A. Answers:
  G3 hold release needs one operator; G9 requests and approvals expire after 24 hours; refund
  authorization keeps its existing dual review.
- Change: migration `20260917001000`: one-operator hold release; 24-hour request window with
  approvals bound to their request; reviewed refund, cancellation refund and chargeback requests
  through unchanged kernels; reissue of a `reconcile` refund after a not-found Stripe readback
  taken 24 hours after preparation (only kernel change: `money_prepare_refund` window). Panel
  gains release, refund form, cancellation list, chargeback form, expiry and reissue.
- Evidence: `governance/PHASE-5-FINANCE-REFUNDS.md` (R1–R6) and the TRACE-077 section of
  `PHASE-5-VALIDATION.md`. 1534 SQL assertions across 35 suites (044 new, 126), 17/18 mutants
  killed (1 equivalent), 13 concurrency scripts in CI order, 129 unit tests, build, 198/198
  non-visual browser cases, 0 audit findings.
- Open: Codex review (R1 authority note on MPS high-risk, R5 single-operator reissue); CI;
  failed-refund recovery; `paymentFunctionError`; part 2B (ACH preparation, bank outcomes, retry).
- Next: part 2B after review.

## Current slice — TRACE-078 finance commands, part 2B (2026-09-21, PR open)

- PR #33 (TRACE-077) merged 2026-09-21 (main `da94fd8`); the "PR open" wording above predates it.
- Branch `codex/phase5-finance-ach`, base main `da94fd8`, worktree `../mercurius-finance-ach`.
- Owner direction 2026-09-21: part 2B (ACH preparation, bank outcomes, retry) after #33 merged.
- Change: migration `20260921001000`: a reviewed weekly batch request bound to each payout's
  amount, payee and bank authorization; one-operator bank outcomes where submission re-proves
  eligibility before sending; a reviewed retry bound to the failed attempt; an `ach` readback
  with reference hints only. Kernels unchanged. New FinanceAchCommands section.
- Evidence: `governance/PHASE-5-FINANCE-ACH.md` (B1–B8) and the TRACE-078 section of
  `PHASE-5-VALIDATION.md`. 1708 SQL assertions across 36 suites (045 new, 174), 30/30 mutants
  killed, 14 concurrency scripts in CI order, 135 unit tests, build, 202/202 non-visual browser
  cases, 0 audit findings.
- Open: Codex review (one-operator settlement, reference before sending, G5 holds on statement
  payouts); CI; replacement statements and prepared-attempt withdrawal; already-paid recovery.
- Next: CI and Codex review of the PR.

## Current slice — TRACE-079 ACH withdrawal and replacement statements (2026-09-21, PR open)

- PR #34 (TRACE-078) merged 2026-09-21 (main `7f696e1`); the "PR open" wording above predates it.
- Branch `codex/phase5-replacement-statements`, base main `7f696e1`, worktree
  `../mercurius-replacement-statements`. Committed and pushed; PR open against `main`.
- Owner decisions 2026-09-21: a withdrawal needs two finance operators; prepared, failed and
  returned transfers can be withdrawn (never submitted, unknown or settled).
- Change: migration `20260921002000`:
  - a reviewed `money_operator_request_ach_withdrawal`, bound to the transfer and its status;
  - the service kernel `money_withdraw_ach`, which records an immutable withdrawal and a
    `withdrawn` event and posts no journal;
  - a `replaces_item_id` chain trigger, so a payout has at most one live statement and its
    replacement goes on a later weekly batch through the unchanged kernel;
  - refund, chargeback, hold and batch guards now test a live statement. Payee reassignment stays
    closed.
  - The finance page gains a withdrawal form and shows withdrawn and replacement statements.
- Evidence: `governance/PHASE-5-ACH-REPLACEMENT.md` (W1–W7) and the TRACE-079 section of
  `PHASE-5-VALIDATION.md`:
  - 1856 SQL assertions across 37 suites (046 new, 148); 25 of 26 mutants killed (1 equivalent);
  - 15 concurrency scripts in CI order;
  - 138 unit tests; build; 204/204 non-visual browser cases; 0 audit findings.
- Open: CI; Codex review (W4 closed reassignment, W5 late outcome on a withdrawn
  transfer); already-paid recovery; bank statement reconciliation; failed-refund recovery;
  `paymentFunctionError`.
- Next: CI and Codex review of the PR, then already-paid recovery.

## Current slice — TRACE-080 already-paid payout recovery (2026-09-21, PR open)

- PR #35 (TRACE-079) merged 2026-09-21 (main `68f0da3`); the "PR open" wording above predates it.
- Branch `codex/phase5-already-paid-recovery`, base main `68f0da3`, worktree
  `../mercurius-already-paid-recovery`.
- Owner decisions 2026-09-21: cover a refund and a lost chargeback after a settled payout and a
  late bank payment of a withdrawn transfer; the late payment is a separate reviewed event; an
  amount owed closes only by a reviewed repayment or write-off (two operators, part amounts); no
  hold on the provider's other payouts.
- Change: migration `20260921003000`:
  - refunds and chargeback allocation now post on a settled payout; the provider's share becomes
    the debit balance of that payout's provider payable (the amount owed);
  - a reviewed `money_operator_request_ach_late_settlement` and kernel record a withdrawn
    transfer the bank paid, without changing the attempt;
  - a proceeds guard on every statement, attempt and submission writer refuses any transfer that
    would pay more than the payout's proceeds (`already_paid`);
  - a reviewed `money_operator_request_payout_recovery` and kernel record a repayment or a
    write-off to the new `provider_recovery_loss` account, bound to the amount owed and a key;
  - reconciliation counts late payments and recoveries, and lists a `provider_owes` exception;
    the finance page gains "Amounts providers owe".
- Evidence: `governance/PHASE-5-PAYOUT-RECOVERY.md` (R1–R8) and the TRACE-080 section of
  `PHASE-5-VALIDATION.md`.
- Open: CI; Codex review (R3 late payment of a returned transfer, R4 guard, R8 `reversed`); a
  return recorded after a repayment; bank statement reconciliation; provider-facing wording;
  failed-refund recovery; `paymentFunctionError`.
- Next: CI and Codex review of the PR, then bank statement reconciliation or failed-refund
  recovery.

## Current slice — TRACE-081 bank statement reconciliation (2026-09-22, PR #37 open)

- PR #36 (TRACE-080) merged 2026-09-21 (main `5e29da3`).
- Branch `codex/phase5-bank-statements`, base main `5e29da3`, worktree `../mercurius-bank-statements`.
- Owner decisions 2026-09-22 (asked before implementation, all four as recommended): the bank's CSV
  is parsed in the browser and never uploaded; only payout-related lines are imported; a line is
  evidence only; a period is closed by a two-operator review, refused while any exception is open.
- Change: migration `20260922001000`:
  - immutable statement periods, imports, lines (posting date, debit or credit, amount, bank
    reference only), matches, dismissals and closes; periods cannot overlap;
  - a line pairs with a recorded settlement, return, late payment (TRACE-080) or repayment of the
    same direction and reference, in date order; a differing amount is an exception, not a match;
  - `money_operator_resolve_bank_line` runs the existing bank outcome and late payment commands
    with the line as their evidence; manual matches and dismissals are one operator with a reason,
    and a line naming a transfer can never be dismissed;
  - the reviewed `bank_statement_close` binds the lines and totals, is refused while the period is
    open or anything is unresolved, and stores the statement's pairings;
  - readbacks: `statements` in `money_finance_operations`; `bank_line` and `bank_unevidenced`
    exceptions in `money_finance_reconciliation`.
  - `/admin/finance` gains a Bank statements section; `src/lib/bankStatementCsv.ts` reads the file.
- Evidence: `governance/PHASE-5-BANK-STATEMENTS.md` (S1–S8) and the TRACE-081 section of
  `governance/PHASE-5-VALIDATION.md`:
  - 2212 SQL assertions across 39 suites (048 new, 206); 33 of 33 mutants killed (five survivors on
    the first run each gained a case);
  - 17 concurrency scripts in CI order, clean reset and replay;
  - 159 unit tests (17 new), build, 216/216 non-visual browser cases (8 new; the `mds.spec.ts`
    Escape/focus flake passed 3/3 on rerun), 0 audit findings.
- CI run 35801711815 on `c979900` passed all three jobs; its first attempt failed only the
  unrelated `onboarding-checklist` "Response has been disposed" fixture flake, which passes 3/3
  locally and passed on rerun. Recheck CI on the final head after this note.
- Open: Codex review (S1–S8, especially correcting an amount mismatch or a
  conflicting outcome, and releasing a match or dismissal); the owner's real bank export format;
  authorized owner bank workflow acceptance with a real statement; failed-refund recovery;
  `paymentFunctionError`.
- Next: CI and Codex review of the PR.

## Slice — TRACE-082 failed-refund recovery (2026-09-22, merged as PR #38)

- PR #37 (TRACE-081) merged 2026-09-22 (main `28c52e9`).
- Branch `codex/phase5-failed-refund-recovery`, base main `28c52e9`, worktree
  `../mercurius-failed-refund-recovery`. The `paymentFunctionError` fix (TRACE-076 finding) is
  folded in at the owner's request.
- Owner decisions 2026-09-22 (asked before implementation, all four as recommended):
  - resend or release;
  - a resend is one operator (the refund's author or approver), a release is two;
  - either needs a Stripe readback showing the current send failed or canceled;
  - a refund that fails after it succeeded is a finding.
- Change: migration `20260922002000`:
  - the immutable `money_refund_releases`, and `money_refund_reissues.failed_reference`, so a
    resend shares the reissue generations;
  - `money_operator_resend_refund`, and the reviewed `refund_release` (request, and the
    service-only `money_release_refund` kernel);
  - guard triggers: an earlier send's failed refund is never recorded as the current one, and a
    released refund is never prepared or settled;
  - released authorizations are excluded from every pending check and refund cap (fourteen
    generated substitutions);
  - readbacks: resend and release state, release details and recent releases in
    `money_finance_operations`, and `refunds.released` in reconciliation.
- Also changed:
  - `refund-invoice`'s readback skips earlier failed refunds;
  - `paymentFunctionError` reads the `Response` first, and the finance panel's workaround is gone;
  - `/admin/finance` gains Resend refund and Request release.
- Evidence: `governance/PHASE-5-FAILED-REFUND-RECOVERY.md` (F1–F8) and the TRACE-082 section of
  `governance/PHASE-5-VALIDATION.md`:
  - 2335 SQL assertions across 40 suites (049 new, 123); 37 of 39 mutants killed, the other two
    equivalent;
  - 18 concurrency scripts in CI order, clean reset and replay;
  - 169 unit tests (10 new), build, and 220/221 non-visual browser cases (4 new; the `mds.spec.ts`
    Escape/focus flake passed 3/3 on rerun), 0 audit findings.
- Open:
  - Codex review of F1–F8, especially F3's guard, F5's substitutions, and whether a released
    cancellation refund should be offered again;
  - a reviewed path for a refund that fails after it succeeded;
  - provisioning finance operators;
  - Stripe test-mode acceptance.
- CI run 35810165963 on `740eb2b` passed all three jobs on its first attempt:
  - backend and lifecycle: 2335 SQL assertions across 40 suites on the clean reset and again on
    the clean replay, and all 18 concurrency scripts including the new failed refund script;
  - application: 221 of 221 non-visual browser cases (no flake).
- Next: Codex review of PR #38.

## Current slice — TRACE-083 late reversals (2026-09-23, PR #39 open)

- PR #38 (TRACE-082) merged 2026-09-23 (main `a39abf1`).
- Branch `codex/phase5-late-reversals`, base main `a39abf1`, worktree `../mercurius-late-reversals`.
- Owner decisions 2026-09-23 (asked before implementation):
  - a refund that fails after it settled stands, and the customer is owed. The owner first said
    "the provider owes it"; the conflict with CFG-005/008 (charging the provider twice) was raised,
    and this reading was confirmed;
  - every step takes two operators;
  - a return after a repayment reverses the repayment, as a separate reviewed record.
- Change: migration `20260923001000`:
  - late failures hold what Stripe returned in `customer_refund_payable`;
  - a resend's refund event resettles it through a handler routed from `money_process_event`;
  - a release reverses the refund and restores the fee and provider share;
  - repayment reversals, with the TRACE-080 R4 received amount counting them;
  - a `reversal` bank movement;
  - fifteen generated redefinitions.
- `/admin/finance` gains "Refunds that failed after they settled" and "Repayments Mercurius owes
  back".
- Evidence: `governance/PHASE-5-LATE-REVERSALS.md` (L1–L8) and the TRACE-083 section of
  `governance/PHASE-5-VALIDATION.md`.
- Open:
  - Codex review of L1–L8 and the review questions: a provider top-up where `payout_paid` refuses a
    release; whether a chargeback should block a release;
  - a write-off made unnecessary by a later return;
  - provisioning finance operators;
  - Stripe test-mode and owner bank acceptance.
- CI: `backend` failed on main (since the PR #38 merge at 18:03 UTC) and on this branch before any
  test ran. ghcr.io refused Supabase image pulls with `toomanyrequests`, even when authenticated.
  `.github/workflows/ci.yml` now pulls the same images from public.ecr.aws, retries the stack start
  up to three times, and prints redacted start errors on failure. Skipped jobs were `lifecycle`
  and `application` waiting on `backend`.
- CI run 35915476088 on `99279d7` passed all three jobs: 2531 SQL assertions across 41 suites on the
  clean reset and the replay, all 19 concurrency scripts, lifecycle, and the application job. The
  push run of the same commit was cancelled by the workflow's concurrency group, not failed.
- Next: Codex review of PR #39.

## Workflow update — 2026-09-10

Owner assigned Codex architecture and code review, with Claude implementing the
slices. The managed Next.js block now lives in `CLAUDE.md`; its `@AGENTS.md` import
preserves shared Mercurius authority. The installed Next.js generator recognizes
this placement and retains the block there. Shared role instructions and the agent
guide reflect this workflow.
