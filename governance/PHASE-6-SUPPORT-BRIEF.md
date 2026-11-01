# Phase 6.10 — support tickets, disputes, evidence, resolution and appeals

**Status:** characterization complete and first implementation for review, 2026-10-31 (America/New_York), on `claude/phase6-10-support`.
**Base (stacked):** 6.9B head `c2318f5` (PR #119). 6.9A (`a864df5`) and 6.9B are **not on `main`**: PR #117 merged to `main` (`737474f`), but PR #118 merged afterwards into the already-merged brief branch (`fee2811`), and PR #119 merged into `claude/phase6-9a-exceptions` (`a1855f2`, tree identical to `c2318f5`); PR #120 targets that branch. 6.10 depends on 6.9 ticket kinds (`schedule_exception`, `plan_stop_request`), so it stacks on `c2318f5`; its own diff is `c2318f5..HEAD`. Rebase onto `main` once 6.9A/6.9B land there.
**Trace:** TRACE-133. **Decisions:** DEC-2026-054 (PROPOSED, §7). **Hosted:** both 6.9 migrations confirmed applied (history re-read 2026-10-31 ends at `20261102001000`). Hosted aggregates 2026-10-31: 0 support tickets, 0 disputes, 0 appeals, 0 `job_photos`, 0 `job-photos` objects.

## 1. Approved rules

| Source | Rule |
|---|---|
| MPS §3 role matrix | Disputes/refunds: homeowner and provider *participate*, operations has restricted resolution authority. Support records: homeowner own, provider own job threads, operations least privilege. Release/hold funds: restricted finance authority |
| MPS §5.1, §5.4, §5.5 | `disputed → resolved`. Payment and provider-funds states are separate; capture, revenue and payout never share "released" |
| MPS §6.6 | Disputes have filing windows, reason categories, evidence, response times, payout holds, resolution types, notifications and appeal handling. Every open dispute and support request has an owner, age, priority and next action |
| DEC-2026-009 | 48-hour dispute window from the provider's completion. Homeowners appeal operator resolutions through tickets. No appeal deadline |
| DEC-2026-006 | 72-hour unanswered-completion review, separate; silence never confirms |
| CFG-008 | Disputed work stays held until resolution; no general reserve |
| CFG-010 | Mon–Fri 9–5 ET; response within one business day; same-day priority for an appointment that day; escalation owner is the project owner |
| CFG-011 | Support tickets and platform messages kept 3 years |
| DEC-2026-052 item 7 (implemented, proposed) | One review appeal per moderation decision; a retry returns the same ticket |
| MPS §6.5 | Manual financial changes need a reason, an immutable audit record and a restricted role |

**Not approved (decision sheet §7):** dispute reason categories, resolution types and their money consequences, dispute response times beyond CFG-010, a provider response window, post-window disputes, provider appeals, reopening rules, general-support categories, partial-work/no-show penalties.

## 2. Observed behavior (characterized locally on a clean 6.9B schema, then probed)

| Area | Observed |
|---|---|
| `support_tickets` | Columns: requester `user_id`, `ticket_number`, `subject`, `description`, `issue_type` (free text), `job_id` (**text, no FK**), `status` (free text; admin page uses `open/in-progress/resolved/closed`), Phase 4 queue fields (`queue_owner`, `next_action`, `priority`, `response_due_at`). No assignee, no messages, no notes, no version, no history |
| Grants and RLS | `authenticated`: SELECT, INSERT, UPDATE, DELETE. Policies: requester SELECT/INSERT (`user_id = auth.uid()`) and UPDATE (no column limit); admin SELECT/UPDATE; **no DELETE policy**. Triggers: `route_support_ticket` (CFG-010 routing; same-day only when the requester is the job's homeowner), `protect_ticket_queue` (blocks client edits of queue fields), `money_appeal_ticket_lock` |
| Ticket writers | Commands: `homeowner_raise_dispute` (`dispute`), `appeal_dispute_resolution` (`dispute_appeal`), `appeal_job_review` (`review_appeal`), `record_job_operation` and the 6.9B reschedule answer (`schedule_exception`), `homeowner_request_plan_stop` (`plan_stop_request`). Browser: only `/admin/tickets`, a direct `UPDATE … SET status`. No homeowner or provider support intake exists in the app |
| Generated tickets | `schedule_exception` and `plan_stop_request` tickets are owned by the **homeowner** even when the provider or operations filed them, so the homeowner could read the operator `next_action` and rewrite the ticket |
| General vs formal | One table, distinguished only by free-text `issue_type`. The formal dispute is `disputes` (+ `dispute_appeals`); its ticket is a queue item |
| Disputes | `homeowner_raise_dispute` / 6.7 `homeowner_dispute_completion` (bound to `vendor_completed_at`). `admin_resolve_dispute(dispute, status, notes)`: no stale guard, no retry key, history only in `job_events`. `appeal_dispute_resolution`: one appeal per `resolution_version`, retry returns the ticket, but the version the homeowner saw is not checked. Provider reads `disputes` on its jobs and cannot add anything |
| Evidence | `job_photos` (homeowner or current provider inserts own rows; requester deletes own; UPDATE grant without policy is inert). Storage read policy *Job participants can view job photos* matches `job_photos.photo_url LIKE '%' || object_name`; `photo_url` is never checked against the uploader's folder. 6.7 completion evidence uses exact matching and is not deletable. No dispute-bound evidence |
| Holds | Payout `dispute_hold` (fingerprinted `money_ach_payable` / `money_payable`): `service_requests.disputed`, any unresolved `disputes` row, or an appeal whose **ticket status** ≠ `resolved` |
| Review appeals | Operator decides through `moderate_job_review`; the appeal ticket is never closed |

## 3. Bypasses and findings (rollback-only probes, synthetic data)

| ID | Finding | Evidence |
|---|---|---|
| S1 (F11) | Homeowner A inserted a ticket typed `dispute_appeal`, status `resolved`, linked to homeowner B's job | Probe P1: accepted |
| S2 (F11) | The requester rewrote `issue_type`, `status` and `job_id` on their own tickets, including dispute, appeal and operator-filed tickets | Probe P2: accepted |
| S3 (F11) | DELETE grant is **inert** (no policy): 0 rows deleted | Probe P3 |
| S4 | Admin browser writes `status` directly, so an appeal ticket can be marked `resolved` outside the dispute decision; payout `dispute_hold` reads that ticket status (today an escalated dispute row still holds, so no release was demonstrated, but the record is forged) | Probe P5; payout predicate |
| S5 | Provider (or homeowner) reads **any** `job-photos` object whose path it knows by inserting a `job_photos` row naming it; the suffix `LIKE` also matches `<own-folder>/<victim-path>` | Probe P6: 1 row visible |
| S6 | `admin_resolve_dispute` has no stale or retry protection; two operators can overwrite each other's decision | Code |
| S7 | An appeal does not bind to the decision the homeowner read | Code |
| S8 | Review appeal tickets stay open after the decision | Code |
| S9 | Homeowners see operator-filed queue items (internal `next_action`) | Code + grants |

## 4. Implementation in this slice (authority-backed only)

Migration `20261103001000_phase6_support_disputes.sql` (additive):

1. **Tickets closed to direct writes.** Revoke client INSERT/UPDATE/DELETE and requester SELECT; drop the requester insert/update and admin update policies (admin SELECT kept for the deployed admin page until this deploys). New columns: `opened_by`, `request_key`, `version`, `assigned_to`, `closed_at`; status check `open | in-progress | resolved | closed`. Append-only `support_ticket_messages` (participant replies and **internal notes**) and `support_ticket_events` (opened, status, assignment, next action; actor, from/to, reason). Same-day routing also covers the job's provider (CFG-010).
2. **Commands.** `open_support_ticket` (general support only; keyed; optional job link only for that job's homeowner or current provider; changes no service, money or hold). `post_support_message` (requester while open, operations any time; keyed). `add_support_note` (operations; internal). `admin_update_support_ticket` (operations; reason; `_expected_version` → `40001`; keyed; dispute and dispute-appeal tickets follow the dispute decision and cannot be set directly; a review-appeal ticket closes only after the appeal is decided; assignee must be an operator).
3. **Reads.** `my_support_tickets` (tickets the caller opened, participant messages only, no queue internals); `support_ticket_detail` (requester view or operations view with notes, history and linked dispute/appeal/review state); `admin_support_queue` (owner/assignee, age, priority, response due and overdue, next action, linked kind, decision-recorded flag).
4. **Disputes.** `disputes.completion_at` bound at filing. Append-only `dispute_decisions` written by a trigger on every dispute status change (old and new paths). `admin_decide_dispute(dispute, key, expected_status, expected_version, status, notes)` (stale `40001`, keyed replay, then the existing `admin_resolve_dispute` effects). `appeal_dispute_resolution(dispute, reason, expected_version)` (stale `40001`; retry returns the same ticket). Append-only `dispute_submissions` and `add_dispute_submission` (homeowner or the dispute's current provider; statement and/or a photo **they uploaded to this job**; only while unresolved). `dispute_detail(job)` with role-appropriate decision history (no operator identity for participants), submissions, and **separate** resolution, refund authorization, refund movement and payout states.
5. **Evidence access.** `job_photos` rows must name an object in the uploader's own folder; the storage read policy matches the exact path.

No fingerprinted function changes; no money moves; no notification delivery; no Cron. Resolving a dispute clears only its own dispute hold (CFG-008), exactly as before; every other hold and payout check stays.

## 5. Acceptance criteria

- Anonymous, unrelated homeowner/provider and operator callers are refused or see nothing on every ticket, message, note, dispute, submission and read.
- Direct INSERT/UPDATE/DELETE on tickets, messages, events, decisions and submissions fail for clients; append-only tables refuse UPDATE/DELETE for everyone except owner maintenance.
- Forged links refused: job not yours, photo not yours, photo from another job/visit, dispute not yours.
- Internal notes and `next_action` never appear in requester or provider reads.
- Same-key retries return one ticket/message/submission/decision; a reused key with a different payload is refused.
- Stale ticket version, stale dispute status/version and stale appeal version return `40001`; concurrent decisions/appeals produce exactly one effect.
- Opening support, messaging, closing a ticket and adding evidence change no service state, money row or hold. An appeal ticket cannot be resolved except by the dispute decision. Payout stays held while a dispute or appeal is unresolved.
- 48-hour filing window and the 72-hour review unchanged; no auto-confirm, auto-resolve or appeal deadline.
- UI: role-appropriate loading, empty, error, permission, retry and history states; operations queue with owner, age, priority, response due and next action.

## 6. Out of scope

Payment activation, real refunds/payouts, refund execution from a dispute, notification delivery, Cron, retention jobs (CFG-011 deletion), prepaid bundles, pricing repairs, 6.9 money scopes F-1/F-2/F-3/P-K1/P-K2.

## 7. Decision sheet (DEC-2026-054, PROPOSED)

Current behavior is kept until each is answered.

1. **Dispute reason categories** (MPS §6.6). *Now:* free-text reason. *Recommend:* work not done / not as agreed / quality / damage / no-show / other, for reporting only.
2. **Resolution types and money.** *Now:* free-text notes; resolution records no refund and releases only the dispute hold. *Recommend:* types (no change, rework, partial refund, full refund, provider excused) where a refund type opens the existing two-person refund authorization, never executes it.
3. **Dispute response times.** *Now:* the dispute ticket uses CFG-010 (one business day). *Recommend:* keep CFG-010 for acknowledgement; set a resolution target after pilot data.
4. **Provider response window.** *Now:* provider can add statements/evidence until resolution; no deadline. *Recommend:* no deadline in beta.
5. **After the 48-hour window.** *Now:* homeowner opens general support; no formal dispute can be opened (by anyone). *Recommend:* allow operations to open a formal dispute on the homeowner's behalf with a recorded reason.
6. **Provider appeals.** *Now:* homeowner only (DEC-2026-009). *Recommend:* providers ask through general support; no formal appeal in beta.
7. **Reopening.** *Now:* the requester can't reply to a resolved/closed ticket (opens a new one); operations can reopen with a reason. *Recommend:* keep.
8. **General support categories.** *Now:* one `general` kind with a subject. *Recommend:* keep until volume justifies categories.
9. **Partial work and no-show penalties** in dispute outcomes. *Now:* none. Needs an owner policy (MPS §6.6); not recommended for beta without finance review.
10. **Support visibility of the provider's own job tickets.** *Now:* a provider sees only tickets it opened. *Recommend:* keep (homeowner support stays private).

## 8. As implemented and verified (2026-10-31, isolated stack, synthetic data)

**Diff:** `c2318f5..HEAD` on `claude/phase6-10-support`. Migration `20261103001000_phase6_support_disputes.sql`; UI `/support`, `/vendor/support`, rebuilt `/admin/tickets`, `DisputePanel` in the homeowner job dialog (`JobFollowUp`), provider job details and `/admin/disputes` (decision now through `admin_decide_dispute`); `src/lib/support.ts`; regenerated `database.types.ts`.

| Check | Result |
|---|---|
| Clean reset (`scripts/phase5-db.sh reset`) | Applies through `20261103001000` |
| SQL 103 (new) | **142/142**: grants; S1–S5 direct-write and forgery probes; intake keyed replay and reuse refusal; forged/unknown/unrelated-provider links; no service, dispute or money effect; requester and provider reads without internals; operator-filed items hidden; replies, notes, append-only; triage reason, assignee, no-op, unknown status, stale `40001`, replay, key reuse, history, resolve/reopen; dispute completion binding (immutable); dispute ticket locked to decision; evidence (own folder, other visit, other party, duplicate, empty, deletion of attached photo, storage visibility for provider/unrelated/unlinked); decisions (role, stale status, stale version, follow-up, replay, second operator stale, history append-only); no submissions after a decision; appeal stale/version/retry/two-argument path; escalation keeps decision and restores the hold input; appeal ticket locked; appeal decided as version 2; participant vs operator attribution; provider sees no appeal text; money tables unchanged; review-appeal ticket waits for the decision; queue role checks, overdue, closed filter |
| Full SQL suite | **94 files / 5,897 tests PASS** (008, 024, 100, 102 unchanged and passing) |
| Mutation check on 103 | **8/8 killed** (stale ticket, closable dispute ticket, job-link check, stale dispute, cross-visit photo, note leak, suffix storage policy, stale appeal) |
| Money fingerprint | 45 functions, `34c51131e2ca18f65d3b29afd8d12e11`, before and after (unchanged) |
| `scripts/support-concurrency.mjs` (new, CI step added) | **3/3** consecutive: S1 open ×8 → 1; S2 reply ×6 → 1; S3 three operators × 4 rounds → 1 + 2 stale; S4 three decisions × 4 disputes → 1 + 2 stale; S5 appeal ×6 → 1 ticket; S6 appeal vs decision → exactly one; S7 evidence ×6 → 1. Existing `fulfillment`, `review` and `phase5-payout` concurrency still pass |
| Unit | `tests/unit/support.test.ts` 7/7. Full suite: 51 files / 594 tests passed. An earlier run under load reported 3 failures in 552 collected tests; failing names weren't captured, and the rerun passed |
| Typecheck / ESLint (changed files) / build | Clean / clean / passed (synthetic fixture env) |
| Browser `support` (new) | **9/9**: homeowner light 320 and dark 1440 (empty state, separation copy, CFG-010 wording, validation focus, keyed request body, reply, axe, no horizontal scroll); load failure → retry; resolved request without reply; provider dark 1440 job link and permission refusal; operations light 1440 and dark 320 (counts, overdue, internal note, reason required, stale refusal, version sent, dispute ticket status locked, axe); non-operator permission state |
| Browser, full non-visual | Full non-visual browser suite 631 tests: 499 passed with 2 workers under load and 132 failed; the 18 affected spec files were rerun with 1 worker: 322 passed and 3 failed. Those 3 were real and are fixed, and the three specs rerun at 33/33: the waiting-home navigation expectation now includes Support (HOMEOWNER-EARLY-ACCESS-RECONCILIATION allows support actions); the Phase 4 appeal spec mocks `dispute_detail` and checks `_expected_version`; the support reply axe check waits for Refresh's fade to finish |

**Hosted push (owner-authorized, 2026-10-31 21:08 ET / 2026-11-01 01:08 UTC):** `20261103001000` was dry-run and pushed to production `vugqqyemuptlvcieihww`; it was the only pending migration. Before the push hosted had 0 tickets, disputes, job photos and `job-photos` objects. Read-only checks after the push: migration recorded; 4 new tables; 10 new functions; anon cannot execute `open_support_ticket`; the storage policy uses the exact path; clients keep only SELECT on `support_tickets` (admin policy only); money fingerprint unchanged (45, `34c51131…`). The app is not deployed until PR #120 reaches `main`. Until then the deployed `/admin/tickets` status change is refused (no tickets exist).

**Not performed:** screen reader, real devices, `@visual`, CI on this branch. Axe covers automated WCAG checks only.

**Compatibility (old client on the new schema, between a hosted push and the deploy):** the deployed `/admin/tickets` direct status update is refused (permission denied) — hosted has 0 tickets; the deployed `/admin/disputes` still decides through `admin_resolve_dispute` (unchanged; its decisions are now also recorded in `dispute_decisions`); the deployed homeowner appeal (two-argument) still works; existing vendor completion and intake photo uploads already use `<uid>/…` paths and pass the own-folder rule. Nothing reads tickets as a requester in the deployed app. Payout `dispute_hold` semantics are unchanged.

**Migration order and rollback:** `20261103001000` requires `20261102001000` (already on hosted). Per DEC-2026-037 it is dry-run and pushed before merge with owner authorization. Rollback is forward-fix: promote the previous deployment if the UI misbehaves; the additive tables and columns can stay. Restoring the old grants and policies would reopen S1–S5 and is not recommended. Follow-up after the deploy: revoke client execute on `admin_resolve_dispute` so decisions go only through `admin_decide_dispute`, and drop the transitional admin SELECT policy on `support_tickets` once nothing reads it directly.

**Unresolved:** DEC-2026-054 (all items PROPOSED); `contractors.payouts_paused` is still toggled by a direct browser update on `/admin/disputes` (characterized, not changed here; money-path hold, belongs with finance review); retention jobs for tickets/messages (CFG-011) not built; 6.9 money scopes F-1/F-2/F-3/P-K1/P-K2 unchanged.
