# Phase 7.2C-1 — Owner-email ledger, contact-submission delivery and operator recovery (TRACE-154)

**Status:** IMPLEMENTED; **MIGRATION PUSHED TO HOSTED 2026-11-12** on the owner's instruction (§6.1). Draft PR against `main` for Codex review. Not merged, not deployed, not activated.
**Branch:** `claude/phase7-2c1-owner-email-ledger`, created from the reviewed plan head `fedaf5f419e49349371e4a183987e05d5036f722`. Plan PR #165 merged during implementation (`9b487bf4…`, documentation only), so the branch was rebased onto that `main`. The PR diff is implementation plus this slice's records.
**`main` at this checkpoint:** `9b487bf91e1420881b77579f20894edc33dd3494` (#165 merge). Previous application code base: `3eb8ff4` (#164); #165 changed documentation only.
**Plan:** [PHASE-7-OWNER-EMAIL-LEDGER-PLAN](PHASE-7-OWNER-EMAIL-LEDGER-PLAN.md), with its §0.2 clarifications.
**Authority:** the owner's 7.2C-1 implementation instruction (2026-11-12); [DEC-2026-066](DECISION-LOG.md) (O-1); Codex decisions C-1..C-8; contract G1-02; MTS §4; MPS §10; MDS ConfirmAction and OperationalQueue; DEC-2026-037 for any later push or release.

## 1. Codex clearance (recorded)

Codex reviewed plan PR #165 at `fedaf5f` and **cleared local implementation of 7.2C-1**. O-1 and C-1..C-8 are settled and were not reopened. The two binding clarifications are recorded in plan §0.2 and implemented as follows.

| Clarification | Implementation | Evidence |
|---|---|---|
| **1. Claim errors are not all confirmed rollbacks.** A raised SQL exception rolls the claim back; a timeout or lost response may follow a commit. Without a received claim result the provider is not called, and the ledger is never reset | `deliverOwnerEmail` returns `claim_failed` on any claim error, thrown exception or malformed result. It never calls the sender, never makes a second claim, and never writes to the ledger. The resend route answers 500 with "Nothing was sent from this request. Refresh to see the current state". The page always reloads from the database | SQL 120 §3a (claim committed, result discarded: stays `sending`, no second claim, `unknown` after the window, attestation required) and §3b (a forced `55P03` inside the claim leaves `pending`, 0 attempts, no event). Unit "clarification 1" and the resend-route "lost resend claim response" tests. Concurrency: a real psql client commits a claim and is killed before its output is read |
| **2. Different attestations.** Resend: "checked and found no matching email". Acknowledge: "checked the inbox and provider evidence"; the reason says what was found; works when the email was found | `owner_email_request_resend(…, p_confirm_no_email)` records `attestation = 'no_matching_email_found'`; `owner_email_acknowledge(…, p_reason, p_inbox_checked)` records `attestation = 'inbox_evidence_reviewed'` with the reason. The two dialogs show different checkbox statements; the acknowledgement reason is labelled "What you found and why no further email is needed" | SQL 120 §26.5 (acknowledged with "found in the inbox"); browser "acknowledging an uncertain email … works when the email was found" |

## 2. What changed

| Area | Change |
|---|---|
| Migration `20261122001000_phase7_owner_email_ledger.sql` | Additive. `private.owner_email_notifications` and `private.owner_email_notification_events`, checks, indexes, RLS on, all table privileges revoked; private helpers; the contact `AFTER INSERT` trigger; `owner_email_claim`/`owner_email_record` (service key only); `owner_email_request_resend`, `owner_email_acknowledge`, `owner_email_overview`, `owner_email_contact_submission` (signed-in, guarded by `vendor_require_operator()` inside). No existing object altered or dropped. No backfill |
| Contact route | Inserts with `.select("id").single()`; `after()` runs `deliverOwnerEmail(…, "initial")` inside a try/catch; v2 log events replace `console.warn`/`console.error`. Validation, intake guard, rate limits, recipient, reply-to, subject/body and status codes/bodies are unchanged |
| `src/lib/ownerEmailNotifications.ts` | New server-only helper: claim → message → send with key `contact-submission-notification:<id>:<attempt>` → record. Reuses `outcomeState`/`providerErrorCode` from `applicationNotifications.ts` (not edited) |
| `POST /api/admin/owner-emails` | Operator resend: the session requests (guard in the database), the service key claims `resend` and sends. 400/401/403/404/409/500 mapping |
| `/admin/owner-emails` | New page under Trust & Support ("Owner Emails"). Bounded keyset pages of 50 with "Load older"; exact attention count; fixed "Contact submission" label plus an eight-character reference; state and error labels with next actions; Resend and Acknowledge through ConfirmAction with attestation checkboxes for `missed`/`unknown`; on-demand "View submission" dialog |
| Logger | `mercurius.oplog.v2` (16 keys) for the new events. The schema is fixed per event name. Every v1 event keeps its exact 14 keys, values and field order; the 7.1 test is unedited |
| Shared UI | `ConfirmAction` gains an optional `attestation` checkbox (additive; existing callers unchanged) |
| Tests | SQL 120 (207 assertions), `tests/unit/owner-email-ledger.test.ts` (54), `tests/e2e/owner-emails.spec.ts` (15), `scripts/owner-email-concurrency.mjs` plus its CI step, and `tests/fixtures/legacy-contact-submission-route.ts` (the pre-7.2C route, byte-identical, used as the old application and the parity source) |

**Not changed:** the vendor-application ledger, its functions, triggers, route and `/admin/recruiting`; the renewal route and `vendor_submit_renewal_document`; `ownerNotifications.ts`; `applicationNotifications.ts`; recipients, consent, rate limits and retention. **No renewal trigger, renewal route change or renewal send (7.2C-2).** The ledger reserves the renewal shape: source kind, FK column, claim payload and overview label. With no trigger and all table privileges revoked, no renewal row can exist outside a superuser test.

## 3. Implementation decisions for Codex review

These are within the plan's intent but differ in detail from its proposed SQL or UI:

1. **Attestation column.** The events table has `attestation text` (`no_matching_email_found` | `inbox_evidence_reviewed`) instead of `inbox_checked boolean`, because clarification 2 makes the two statements different.
2. **Resend parameter name.** `p_confirm_no_email` (plan: `p_confirm_uncertain`), named for what it attests.
3. **Record function.** `owner_email_record` requires an enumerated error code for `failed`/`unknown` and none for `sent`. Anything else is refused with 22023, so provider text can never be stored.
4. **Invalid arguments** (unknown kind, mode, outcome, half cursor, empty reason) raise 22023.
5. **Untracked versus unknown.** An existing submission without a ledger row → 55000 "Not tracked…". An ID that does not exist → P0002.
6. **Overview scope in 7.2C-1.** The page calls the overview with `p_kind = 'contact_submission'` and shows no kind filter, because no renewal rows can exist yet. The filter and renewal rows arrive with 7.2C-2. The attention count object still reports per kind.
7. **"Show all" toggle.** "Show all tracked emails" lists in-window `pending`/`sending` rows as well as settled ones. The attention-only default hides them, as in plan §3.4.
8. **`contractors.name` is NOT NULL.** A "missing" renewal name can only be blank. The reserved claim returns it as stored; the overview label falls back to "A provider".
9. **Claim actor.** Claim events carry no actor; operator actors are on the request and acknowledgement events.
10. **Detail dialog.** No per-view access log (plan §5.3; not required by O-1). It shows a visible Close button instead of the corner X, and drops any response that arrives after it closes.

## 4. Privacy and retention

- The overview returns no name, email, phone, subject, message, actor ID, claim ID or provider message ID (SQL 120 §5b, browser sentinel check).
- Contact detail is fetched only when "View submission" is pressed: RPC body, not URL. It is guarded in the database and discarded on close. Nothing about it is logged, and no analytics event is added.
- Ledger identifiers, actors and acknowledgement reasons are restricted administrative data (plan §3.10). They are never logged; `source_id` is the one identifier the v2 log carries, UUID-validated.
- Retention: no new period or purge job. Ledger rows and events cascade with their contact submission (SQL 120 §7a). CFG-011's 90-day log rule applies only to the v2 log lines and stays carried to 7.6.

## 5. Verification (local, synthetic, isolated)

| Check | Result |
|---|---|
| SQL 120 alone | 207/207 |
| SQL mutation checks (6) | Each caught: no resend attestation, initial claims `missed`, no acknowledge attestation, subject in the overview, record ignores the claim, cursor without the id tie-break (the tie was moved to straddle a page boundary after this mutation first survived) |
| Full SQL suite on a clean replay | 111 files, 7,518 tests, PASS (7.2B: 110 / 7,311) |
| Money fingerprint, before and after the migration (local) | `58 \| af0fae6e0c5b604e9073e10bc060957e` both times |
| Unchanged definitions (SQL 120 §8) | Application-ledger functions `10 \| 5f14532aa26ed5400e73e210379aa4f8`; tables and triggers unchanged; `vendor_submit_renewal_document` `8c8942365d8f9d34bdcd1d839f86c472`; `contact_submissions` ACL unchanged |
| Concurrency on a clean replay | `owner-email-concurrency.mjs` PASS; `application-notification-concurrency.mjs` PASS; `phase5-intake-limit-concurrency.mjs` PASS; clean reset afterwards |
| Unit | 66 files, 861 tests (7.2B: 807). The 7.1 tracing test passes unedited |
| Unit mutation checks (5) | Each caught: send after a claim error, key without attempt, unvalidated `source_id`, v2 keys on v1 events, raw timestamp in "Submitted" |
| Browser `owner-emails.spec.ts` | 15/15 |
| Browser mutation | Resend attestation removed from the page → the attestation test fails |
| Typecheck, lint, secret scan, production build | Pass (build uses CI's synthetic public Supabase values) |
| Full local browser suite | **Not completed.** On this 5 GB WSL host it reached 48 of 702 tests in about 30 minutes, then stalled. All 34 failures seen by then were in specs this slice does not touch (account-linking, appointments), mostly "element not found" and visibility timeouts; 7.2B recorded the same local behaviour. Not diagnosed and not retried. Exact-head CI is the authority for the full suite |
| Exact-head CI | Recorded on the PR |

**Local-only notes.** The isolated stack runs from a copy in `.phase5-local`, so `node scripts/prepare-phase5-local.mjs` is needed before a reset picks up new migrations; CI does this. The local `vitest run` also collects an untracked worktree under the ignored `.phase5-local/wt/`, so it is run with `--exclude ".phase5-local/**"`; CI checkouts do not contain it.

## 6. Rollout and rollback (not performed)

1. Codex reviews this PR, and exact-head CI passes.
2. **With the owner's authorization:** `supabase db push --linked --dry-run`, then `supabase db push --linked`.
3. **Authorized read-only readback:** both tables, checks, indexes and RLS; the `owner_email_contact_create` trigger (`tgenabled`); the function definitions and `proacl`; the fingerprint `58 | af0fae6e…`; `vendor_submit_renewal_document` unchanged.
4. Merge, which deploys (DEC-2026-037).
5. **After the deploy:** an authorized read-only count of `missed` contact rows created between the push and the deploy. For each one, the operator checks the owner inbox and Resend log. If the email is there, acknowledge it with the inbox-evidence attestation and say so in the reason. If it is not, resend it with the no-email attestation. Nothing is resent automatically, and there is no bulk acknowledgement.

**Rollback.** App-only: `vercel promote` the previous deployment. Old code keeps emailing, and new contact rows become `missed` noise. If that lasts more than briefly, a forward migration drops the trigger. Ledger tables and rows are kept as evidence. A schema defect is fixed forward, never by a destructive rollback.

## 6.1 Hosted migration (performed 2026-11-12, owner-authorized)

The owner instructed the push on 2026-11-12, after exact-head CI passed on `2ddc6cb` (pull_request run 43301270388). Steps 2 and 3 of §6 were performed; nothing else was.

| Step | Result |
|---|---|
| `supabase db push --linked --dry-run` | Exactly one pending migration: `20261122001000_phase7_owner_email_ledger.sql` |
| `supabase db push --linked` | Applied `20261122001000` |
| Read-only readback | Latest migration `20261122001000`. Both tables present with RLS on, 14 checks, 7 indexes, 0 client table privileges. `owner_email_contact_create` enabled (`O`). No renewal trigger. Function ACLs: claim and record → `service_role`; resend, acknowledge, overview and contact detail → `authenticated`; private helpers owner only. Ledger and event rows: 0 at readback |
| Unchanged definitions (hosted) | Application ledger `10 \| 5f14532aa26ed5400e73e210379aa4f8`; `vendor_submit_renewal_document` `8c8942365d8f9d34bdcd1d839f86c472`; `contact_submissions` ACL unchanged. All equal to local |
| Money fingerprint (hosted) | `58 \| af0fae6e0c5b604e9073e10bc060957e` |

No row contents were read; only counts. **Push-to-deploy window now open:** the deployed (old) route keeps emailing without claims. Each contact saved before this PR deploys gets a `pending` row that reads `missed` after 10 minutes and needs per-row attested handling (§6 step 5). Not merged, not deployed.

## 7. Unresolved and carried

- Codex review of this implementation, merge and deploy. (The hosted push and readback are done, §6.1.)
- Real-email verification with the controlled mailbox (plan §6.4): separate and owner-authorized.
- 7.2C-2 (renewal trigger and route) is not started.
- Main CI run 43214230785's intermittent `request.spec.ts:837` accessibility failure is outside this slice. It is not repaired or retried here (plan §1.1).
- Carried unchanged: CFG-011 log retention (7.6), A2 human verification, final schema/grants, fingerprint and completion-integrity checks on the final candidate, the `offer_terms` and promotions gates off, and booking readiness.
