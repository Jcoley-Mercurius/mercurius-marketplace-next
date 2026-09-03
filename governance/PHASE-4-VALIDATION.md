# Phase 4 validation checkpoint

Status: IN PROGRESS — bounded implementation; full Phase 4 acceptance is not claimed.
Date: 2026-09-03. Branch: `codex/lifecycle-reconciliation`.
Starting base: then-unmerged PR #3 at `91379e9ba657624fecf4c6ea7e2db39c8cfd572e`.
Draft base: verified merge on main, `db3f4061f65f84ccd8bbb08e9c71301167bd6250`,
whose tree is identical to the Phase 3 head.

## Implemented slices

1. **Caller and transition safety:** explicit service-role detection; homeowner-only
   confirmation; admin reasons; no caller-supplied photo-count bypass; duplicate
   rejection; protected direct writes; append-only browser audit history;
   metadata cannot override actor/from/to/reason; real `status_changed` events.
   Invoker triggers permit checked security-definer RPCs while rejecting browser
   edits to protected fields. Vendor start and homeowner scheduling must respect
   vendor acceptance.
2. **Matching:** shared locking and affected-row checks on expiry; no resurrection
   of terminal/accepted requests; acceptance immediately schedules under DEC-007.
   Removed the old assignment trigger that replaced canonical package snapshots
   with a second offer and advertised 24 hours. The canonical offer transaction
   now owns its four-hour notice and audit. Missing legacy JWT role claims cannot
   bypass admin authorization. Expiry is inclusive at the deadline.
3. **Worker:** default-disabled Edge handler calls one transactional SQL batch.
   Per-run IDs and committed row markers prevent repeat effects. Notices, review
   flags, job events and successful run records commit together. Database/transport
   failures return non-2xx and privacy-minimized correlation logs. At 72 hours
   after notice, flag admin review; never confirm completion or alter money state.
4. **Cancellation and quote decision:** pending cancellation retains the row and
   audit instead of deleting it. Cancellation withdraws pending offers. Declining
   a quote records its time, withdraws outstanding offers, and requests operator
   follow-up without cancelling the request. Quote approval records a decision;
   vendor acceptance controls scheduling. Quote validity is still unspecified.
   Pure CFG-006 time-boundary helpers classify cancellation/rescheduling intent;
   they do not issue refunds or charge fees.
5. **MDS consumers:** admin status corrections use shared reason-bearing
   ConfirmAction and canonical Status projection. Homeowner concern reporting
   opens a dispute with a reason instead of claiming vendor work has started.
   Existing focus/error, mobile and dark-mode patterns are retained.

Historical migrations and Phase 3 commits are preserved. The original worker is
archived at `supabase/recovered/job-lifecycle-worker.phase2.ts`; the existing
export fingerprint test now checks that immutable evidence. Current worker tests
verify the forward implementation separately.

## Recorded local evidence

| Check | Evidence |
|---|---|
| Clean replay | Two successful local resets during this work; the later replay included the first six Phase 4 migrations. The final quote-decision migration was subsequently applied and tested locally. CI run 33816965540 reconstructed all migrations successfully at implementation commit 2d74f81. |
| Database contracts | 96 assertions passed locally; CI run 33816965540 passed all 98 assertions across five rollback-only suites, including the additional vendor-start and homeowner-scheduling authorization checks. |
| Unit/contract | 62 passed, including every stored status, terminal/admin action restrictions, cancellation/rescheduling boundaries, accepted exceptions and Eastern DST elapsed time. |
| Edge check | All 11 functions passed frozen Deno 2.9.6 checks. |
| Edge runtime | All 31 synthetic handler tests passed, including nine current worker cases. No network/process permission. |
| Authenticated integration | Passed twice, including after clean replay: JWT gateway plus worker secret, two simultaneous HTTP calls, safe retry, one event/notification per business effect, and no confirmation/payment changes. |
| Scheduler transport | One-off local `pg_net` → gateway → worker → SQL succeeded. Zero `cron.job` rows before and after; no Cron activation. This does not claim a recurring Cron execution. |
| Application lint/build/browser | Lint passed without warnings; typecheck and one-worker build passed (56 routes). Initial full browser run passed all 48 existing checks and exposed three new nested-dialog focus failures. Parent error focus was corrected; all three new cases then passed, including axe. Full final-head regression remains the CI gate. |
| Screenshot inspection | Inspected new synthetic 320px admin light/dark and homeowner concern-dialog captures. No clipped controls observed. This is not human screen-reader, true zoom or owner brand approval. |
| Credential scan | Staged-file credential scan passed. No ignored local worker environment is committed. |

## CI implementation checkpoint

[CI run 33816965540](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/actions/runs/33816965540)
passed both sequential jobs at implementation commit `2d74f81`: clean reconstruction,
98 SQL assertions, 11 frozen Edge checks, 31 handler tests, authenticated concurrent
worker/retry/pg_net integration with zero Cron jobs, lint, credential scan, types,
62 unit/contract tests, production dependency audit, one-worker build and all 51
browser checks. The subsequent evidence/CI-coordination commit changes no application
or database behavior. Its current-head run remains a draft acceptance check.

Push and pull-request events now share a branch concurrency key so future pushes
cannot duplicate heavy CI runs. The initial duplicate push run was cancelled;
the passing evidence above is the PR run. Git status reported only CodeRabbit,
with success; the Phase 4 branch's Vercel Git deployments are disabled.

The first test against the restored local volume found a provider-role assertion
failure; a clean replay from committed migrations passed it. That restored-volume
attempt is not acceptance evidence. A test attempted during the final reset's
restart also failed on incomplete schema readiness; only post-reset runs count.
The matching suite first exposed the duplicate legacy offer trigger; it passed
after the forward repair. Test-source quoting mistakes were corrected before
the reported passing SQL run.

Fixtures are synthetic, use fixed local ports/container IDs, and roll back or
delete only their own test records. No production data, function calls, migrations,
secrets, charges, email or payout operations were used. Local CLI credentials are
consumed in memory and never printed by the authenticated integration runner.

## Explicit draft acceptance gates

- Final-head CI: clean reconstruction, SQL roles/lifecycle, frozen Edge checks,
  isolated runtime/transport, lint, types, unit tests, build and browser regression.
- Code review of locking, actor authority, schema compatibility and notification
  atomicity and preservation of Phase 3 through the verified main merge.
- Quote revision lineage, quote validity/extension policy, and complete immutable
  commercial snapshots (money integrity remains Phase 5). No quote-expiry value
  was approved; four hours is the vendor offer window.
- Selected-provider fallback consent, complete ranking/candidate-pool acceptance
  matrix, and reason-bearing force-assignment/release coverage beyond the tested
  status/quote actions. Existing direct database administrative capabilities are
  not certified by this checkpoint.
- Full dispute/appeal and recurring-occurrence contracts, category-specific proof,
  review moderation/eligibility consolidation, and all legacy status reconciliation.
- Notification channel/fallback, review solicitation and vendor backstop timers.
  The old worker's unapproved one-hour/two-day/quiet-hour routines are not active
  in this worker. In-app completion notice is transactional; email/SMS delivery
  is not claimed.
- Inactive installer review, target-environment Vault/JWT provisioning, approved
  cadence, external-scheduler duplicate check, alert/retention/stop procedures and
  explicit future activation approval. The installer template was not run.
- Human screen-reader, true browser zoom, brand approval and Linux/macOS visual
  baselines remain Phase 3 follow-ups, separately from its accepted closeout.

No merge or deployment is authorized. `vercel.json` disables Git deployments only
for this Phase 4 branch. Production settings are unchanged. Homeschool Haven must
remain untouched; heavy checks run sequentially and builds use one worker.
