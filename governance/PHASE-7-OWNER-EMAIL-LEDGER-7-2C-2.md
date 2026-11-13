# Phase 7.2C-2 — renewal owner-email ledger handoff (TRACE-154)

**Status: ready for Claude implementation; this initial commit is documentation only.**
**Base:** `main` `24dd455acd520a21da14b0305a92383fbedfcccf`, the #166 merge. 7.2C-1's reviewed head passed all PR CI jobs; production is READY and the fresh rollout count is zero. Main merge CI 43343682357 was still running when this handoff was prepared. Read the [release checkpoint](PHASE-7-OWNER-EMAIL-LEDGER-CODEX-REVIEW.md) before proceeding.

The owner authorized review, fixes, release, rollout reconciliation and starting this renewal slice. O-1 (DEC-2026-066) and Codex C-1..C-8 remain settled. No new owner decision is required for the scope below. This does not authorize a renewal hosted push or release.

## Prompt for Claude

Continue this draft PR on its existing branch. **Implement Phase 7.2C-2 only.**

1. Verify the current branch, working tree, `origin/main`, this PR's head and current CI. Preserve unrelated work. Before application/database edits, confirm main merge CI has succeeded; if it is still running, wait, and if it fails, diagnose and report the actual blocker rather than blindly rerunning it. Reconcile any newer main baseline explicitly.
2. Read `AGENTS.md`, `CLAUDE.md`, `docs/agent/HANDOFF.md`, the six repository authorities, the [approved plan](PHASE-7-OWNER-EMAIL-LEDGER-PLAN.md) (§0.2, §3.5.1, §4.4, §6 and §7), the [7.2C-1 record](PHASE-7-OWNER-EMAIL-LEDGER-7-2C-1.md), the [Codex checkpoint](PHASE-7-OWNER-EMAIL-LEDGER-CODEX-REVIEW.md), TRACE-154 and the booking-readiness register. Use the installed Next.js documentation for changed framework code.
3. Add **one additive migration for the renewal trigger only**. Provider inserts into `vendor_renewal_documents` create one pending ledger row and event in the same transaction. Operator uploads and existing-path replays create none. Generate with the CLI and verify migration ordering after `20261122001000`. Never edit an applied migration or restate `vendor_submit_renewal_document`, shared ledger RPCs or money-fingerprinted functions. No backfill.
4. Extend the shared delivery kind and message builder. In `src/app/api/renewal-documents/submit/route.ts`, call `deliverOwnerEmail(..., "renewal_document", document_id, "initial")` in guarded `after()` only for `recorded && submitted_as === "provider"`. Preserve validation, authorization, upload behavior, recipient, subject/body, response body/status and replay behavior. Read saved content from the claim; accepted differences are the saved timestamp and current business name. A missing name retains "A provider"; a genuine claim failure sends nothing. A lost claim response can follow a commit: never reset state or assume rollback.
5. Use `renewal-document-notification:<source-id>:<attempt>`. Extend the existing resend route to the two approved explicit kinds. Keep database authorization, passive expiry, no automatic reclaim/retry, stale-worker refusal, distinct resend/acknowledge attestations, and readback after returned errors or lost responses. Keep the truthful "No recorded attempt" label.
6. Extend the existing admin page with All / Contact form / Renewal documents filters, exact total/per-kind counts and bounded keyset paging. Reset paging on filter/action/refresh and reject stale responses. Renewal rows link to `/admin/compliance/renewals`. Contact details remain contact-only, opened on demand. Never put contact content in summaries, logs, analytics or URLs. Follow existing MDS queue and confirmation patterns.
7. Add renewal route/event names to the v2 logger allowlists and replace raw renewal-submit errors. Preserve the v1 logger's exact 14 keys and its tests unchanged; v2 keeps 16. No names, file names/paths, record content, provider bodies, claim IDs, keys, actor IDs or acknowledgement reasons in logs. Keep the shared sender and provider classifier unchanged.
8. Update this document with implementation evidence, TRACE-154 and the handoff. Preserve the dated 7.2C-1 release evidence. Rewrite the PR title/body around the actual implementation when ready for Codex.

## Acceptance evidence

Follow plan §6, including:

- Preserve the pre-change renewal route byte-for-byte as a synthetic content-parity and old-application fixture. Verify unchanged 200 success despite email/claim/logger failure, replay/operator suppression, saved time/current name and missing-name fallback.
- SQL: provider-only atomic creation and rollback through the real submit RPC; no duplicate on replay; expired claims and attested recovery; missing name versus genuine claim failure; source privacy; operator, service-only and cross-account boundaries.
- **Adapt SQL 120 to the combined schema.** It currently asserts no renewal trigger and no auto-created renewal ledger rows, then manually inserts reserved renewal fixtures. Update those assertions and remove conflicting manual inserts. Preserve contact/privacy/grants/paging/hash coverage; do not disable the new trigger or weaken checks.
- Real-database renewal concurrency: initial claims, outcome races, authorized resend attempts and stale workers. Keep contact/application regression coverage; use the existing CI step where practical.
- Unit: every provider outcome; failed/lost claims and records; per-kind/per-attempt keys and replay; route/auth/status boundaries; redaction and exact schemas.
- Browser: mixed-kind totals/filter/paging/tied cursors/stale responses; renewal destination; contact-only detail privacy; both kinds' recovery and lost-response regressions; roles, loading/error/empty, keyboard, axe and 320/1440 px light/dark. When a modal remains open, assert dialog behavior first and close it before locating background rows by role.
- Full local SQL/unit/lint/typecheck/secret/build and applicable browser checks; full exact-head backend/lifecycle/application CI. Report environment-blocked checks as blocked.
- Fingerprint unchanged: `58 | af0fae6e0c5b604e9073e10bc060957e`; renewal submit definition hash `8c8942365d8f9d34bdcd1d839f86c472`; application-ledger functions unchanged. This does not close final booking-candidate verification.

## Stop boundary

Push a reviewable implementation to this **draft PR** and return exact base/head, changed files, results, rollout/rollback plan and unresolved checks for Codex review.

**Do not push the renewal migration to hosted, merge/deploy this PR, send a real email, change hosted resources, or activate payments, booking, offer terms, promotions, Cron, retries or other automation.** The renewal push requires separate owner authorization after review. Keep CFG-011, A2, retrospective 7.2B review, final booking-readiness checks and the older intermittent accessibility failure carried. Proposed channel/reminder/retention decisions remain proposals.
