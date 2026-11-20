# Phase 7.3C-1 — Owner Emails correlation tags and delivery-evidence readback: implementation (TRACE-155)

> **Correction (2026-11-19 ET; the record below is kept as written before merge):** the status line and §5.2 item 1 are stale.
> - #180 **merged** on 2026-11-19 at 23:29 UTC as `main` `9e7fd39` (PR head `ff34e78`). PR CI 44628358534 on `ff34e78` and main CI 44638058722 on `9e7fd39` both succeeded (verified 2026-11-19 with `gh run view`).
> - **Codex reviewed it** retrospectively: [5985392153](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/180#pullrequestreview-5985392153) at `ff34e78`, no blocking finding. D-1..D-3, D-5, D-6, D-7 and D-9 accepted. D-4: keep the conservative whole-row identity check; do not narrow it implicitly in 7.3C-2. D-8 is an arming-record read, not proof of provider registration. D-10 must be extended deliberately when 7.3C-2 adds dependencies.
> - Codex did not re-verify the hosted push or readback, and did not certify deployment. Still open: exact-commit production READY readback and the operator-session `owner_email_evidence_counts()` readback after deploy (§5.2 item 3). Every item in §6 stays open.
>
> Application and price-draft tagging and readbacks: [7.3C-2 record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3C-2.md).
>
> **Status (2026-11-20, read-only; the correction above is kept as written):**
> - **Exact-commit production READY readback: done.** `dpl_4pSMR5HxeVZ3G6fxSyhCambJAQxB`, Vercel commit field `9e7fd39`, ready 2026-11-19 23:29:53 UTC; GitHub deployment 7928715364 `success`. Read back by Claude on 2026-11-20 at 15:48–15:49 UTC. At 15:49 UTC, `www` resolved to the #181 deployment (`d44342b`).
> - **Still open:** the operator-session `owner_email_evidence_counts()` readback, and every §6 item.
>
> Details: [7.3D readiness](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3D-READINESS.md) §1.3 and §2.

**Status: IMPLEMENTED on a draft PR; DORMANT.** Codex implementation review pending. **Migration `20261125002000` pushed to hosted on 2026-11-19 on the owner's instruction (§5.1)**; not merged or deployed. No secret, webhook registration, receiver arming, `armed_at` write or email. Application and price-draft tagging is 7.3C-2.
**Authority:** Codex review [5926523770](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/170#pullrequestreview-5926523770) on the [handoff](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3C-1-HANDOFF.md) (C3C-1..C3C-6 accepted, five integration requirements) and the owner's 7.3C-1 implementation instruction (2026-11-18), under the [plan](PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md) §7.1–§7.5, §8.3–§8.4, §9.1, §11.4 and §13.3. Clearance covers this local, dormant slice only.
**Branch:** `claude/phase7-3c1-correlation-readback`, in its own worktree, based on `main` `1327a58` (§1).

## 1. Baseline

| Check | Result |
|---|---|
| Starting point named in the instruction | `main` `ba7db9c`; verified as `origin/main` on 2026-11-18, with #169 and documentation-only #170 merged |
| Base at implementation | `main` moved overnight to **`1327a58`** (#175, #176, #177: dynamic-profile P2B, P2C and gallery fixes). The branch had no commits, so it fast-forwarded. No Phase 7 file changed in those merges apart from the shared `TRACEABILITY.md` |
| Codex reviews | [5926513941](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/169#pullrequestreview-5926513941) on #169: retrospective source review, no blocking finding, one carried correction (§2.6). [5926523770](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/170#pullrequestreview-5926523770) on #170: handoff cleared. The stale "no Codex review" and "decisions pending" statements now carry dated corrections in the 7.3B record and the handoff |
| CI time limit | The agreed application-job repair (20 → 30 minutes) landed on `main` in `11f459f` (#175). This branch consumes it; it makes no workflow edit |
| Hosted migration head | `20261124001000` per the handoff (not re-queried; no hosted query in this slice) |
| Isolation | Separate worktree `mercurius-phase7-3c1-readback`; the shared checkout and the dynamic-profile worktrees were not switched, edited or stopped. Disposable Supabase project `mercurius-phase7-3c1` on ports 56020–56027, workdir in the worktree's ignored `.phase5-local/` (the shared `mercurius-phase5-isolated` stack was left running and untouched). Browser tests ran from a generated copy on ports 3173/56831, so ports 3103/55831 stayed free for other sessions. No `.env.local` and no production credential exists in the worktree |

## 2. What changed

### 2.1 Migration `20261125002000_phase7_email_evidence_readback.sql` (functions and grants only)

| Function | Access | Purpose |
|---|---|---|
| `public.owner_email_correlation_ref(kind, source) → uuid` | Service role only | The exact owner-email ledger row ID for that pair. An unknown or null kind, the other kind's source, or a source without a row returns null; no other row can be selected (C3C-1). `owner_email_claim` is not restated |
| `private.email_evidence_fact(event_type, bounce_type)` | Private, immutable | Event → §5 fact. A bounce of unknown category is `bounced_undetermined`, so it can never prove non-delivery |
| `private.email_evidence_identity_holds(receipt)` | Private | All three §7.3 checks against the current snapshot: I′ none or exactly the linked ledger, row and attempt; for tag links, the linked row's own provider ID equals the receipt's, **even when I′ is none**; for `id_only`, I′ is still exactly the linked row |
| `private.email_evidence_receipt_state(receipt)` | Private | **The single trust and expiry predicate**: `expired`, `stored_conflict`, `content_conflict`, `unlinked`, `current_conflict` or `trusted`. Every summary, history, count and conflict signal reads receipts only through it |
| `private.email_evidence_summary(facts, claimed_at)` | Private | Fact set F and first-match rules 1–10 (§8.3) with the three flags and `reported` (the non-delivery facts behind rules 2 and 5). Rules 9 and 10 apply only to an empty F (Codex item 4) |
| `private.email_evidence_owner_claimed_at`, `…_owner_receipts`, `…_owner_row` | Private | One row's unexpired receipts (linked; stored conflicts naming it by tag or by recorded ID), the current-attempt summary, the conflict signal and reasons, and the per-attempt history |
| `public.owner_email_evidence(kind, sources uuid[])` | Operator (`vendor_require_operator()`) | The visible page's evidence; at most 100 sources (the overview's ceiling); null kind reads both |
| `public.owner_email_evidence_counts()` | Operator | §9.1 additive counts, `receiver_armed`, and the retention backlog |

Everything is `STABLE` except the immutable fact map, and nothing writes: no purge, flag, quarantine or arming write. Private helpers run as their caller with an empty `search_path` and have no grants; the three public functions are security definer. All are created with plain `create function`, so a name collision with any existing function would abort the migration instead of replacing it. The header corrects the shipped 7.3B comment (§2.6) without restating that migration.

### 2.2 Sender and lookup

- `src/lib/emailEvidence/correlationTags.ts` (new): `buildCorrelationTags(ledger, ref, attempt)` gives exactly `mm_ledger`, `mm_ref`, `mm_attempt`, or null for any invalid part. `validCorrelationTags` accepts only a set that rebuilds to the same values.
- `src/lib/ownerNotifications.ts`: optional `tags`. Without a valid set the body is byte-for-byte the pre-7.3C body. With one, only `tags` is added, last. Recipient, `from`, subject, text, `reply_to`, headers, `Idempotency-Key`, timeout and classification are unchanged.
- `src/lib/ownerEmailNotifications.ts`: after a successful claim only, one lookup bounded at 1,500 ms (`CORRELATION_REF_TIMEOUT_MS`). An error, throw, timeout, null or non-string answer sends untagged and logs `owner_email.correlation_unavailable` / `correlation_ref_unavailable` (v2, warn). Claim and record arguments, the per-attempt key, outcome recording and the single-claim, no-retry semantics are unchanged (C3C-2). A late lookup answer is ignored, and no request is ever repeated with a different body under the same key.
- `src/lib/observability/operationalLog.ts`: that one v2 event and code, plus its warn level. v1 keeps 14 keys and v2 keeps 16.

### 2.3 Owner Emails page

`src/lib/emailEvidence/labels.ts` (new) maps SQL rules, facts and reasons to the §5/§8.3 wording (C3C-4). `src/lib/ownerEmails.ts` holds the readback types. `src/app/admin/owner-emails/page.tsx` now does the following:
- After each overview page, it reads evidence for exactly the visible rows, and on each reload it reads the counts. Stale responses are discarded with the existing generation guard.
- Each row shows "Delivery evidence: <summary>", with the attempt number when it is above 1, and the conflict signal in the stored or current wording.
- A native `<details>` "Provider report history" lists, per attempt, each report's fact, bounce category, provider time as received ("not given" when absent) and any exclusion.
- A "Delivery evidence from Resend" card shows the additive counts, beside the unchanged attention card. When the receiver is unarmed, it says reports are not being collected yet.
- A failed evidence or counts read shows an alert. The list, states and actions are unaffected, and evidence never adds or removes an action.

### 2.4 Tests and scripts

| File | Change |
|---|---|
| `supabase/tests/122_email_evidence_readback.sql` | New: 169 assertions (§3.1) |
| `supabase/tests/120_owner_email_ledger.sql`, `121_email_provider_events.sql` | Codex item 3: every `owner\_email\_%` name-filter assertion now uses the **13 original exact signatures**. The original digest `12 \| 016c0e68…` is kept, not updated. The new functions are tested only in SQL 122 |
| `supabase/tests/121_email_provider_events.sql` §9 | The corrected expired-replay comment, and a regression with a backlog over 100 rows (§2.6) |
| `scripts/email-provider-events-concurrency.mjs` | The locked-target replay and the S-37 race (§3.2) |
| `scripts/email-provider-events-migration-lock.mjs` | It drops and re-creates the 7.3B objects, and two 7.3C-1 functions take the receipt table's row type, so the drop failed (found locally; CI would have failed). It now drops the ten 7.3C-1 functions first, reading them from that migration's own `revoke` block, and re-applies the unchanged 7.3C-1 file at the end, checking functions and grants. The 7.3B lock-timeout assertions are unchanged |
| `tests/unit/email-correlation-tags.test.ts` (new), `tests/unit/owner-email-ledger.test.ts` | §3.3. The fake ledger records lookups in a separate `refCalls`, so every existing claim/record assertion stays exactly as written |
| `tests/e2e/owner-emails.spec.ts` | The store serves both evidence RPCs (rule 10 and unarmed by default) and adds 10 tests (§3.4) |

### 2.5 Governing documents

- Plan: §7.3 (durability of the two conflict kinds, and item 2's whole-row effect), §7.5 (an untagged early callback is still possible after 7.3C, stays `unmatched`, and is never rematched), §13.3 (tagged "whenever its reference is available"), and S-57. Each change is dated, and §18.3 keeps the superseded wording (Codex items 2 and C3C-3).
- 7.3B record and 7.3C-1 handoff: dated corrections at the top. The text written then is kept.
- `TRACEABILITY.md` TRACE-155 and `docs/agent/HANDOFF.md`: appended. The parallel TRACE-156 profile rows and `DYNAMIC-PROFILES-HANDOFF.md` are untouched.

### 2.6 Carried 7.3B correction (review 5926513941)

The shipped receive-function comment and SQL 121's example said an expired receipt "never answers as a duplicate". That holds only when the target is among the 100 oldest unlocked expired rows. SQL 121 now records the actual behavior:
- With 250 older expired rows, an identical replay answers `duplicate`, and a changed one answers `conflict`.
- The receipt keeps its passed expiry and sets the flag.
- No new receipt or clock is created.

The concurrency script adds the locked-target case: the replay waits for the lock and answers `duplicate`. In both cases the readback excludes the receipt (SQL 122 §7). The shipped migration and receiver functions are not restated; the new migration's header carries the correction.

## 3. Verification (local, synthetic, isolated stack `mercurius-phase7-3c1`)

### 3.1 Database

| Check | Result |
|---|---|
| SQL 122 alone | **169/169** |
| SQL 120 and 121 after the freeze and the backlog regression | Pass (120 and 121 on the same run as 122: 595 assertions in the three files at that point) |
| Full SQL suite, clean replay | **113 files / 7,982 tests PASS** (one more file than 7.3B's 112) |
| SQL 122 coverage | Shape, volatility, definer/invoker split, empty `search_path`, grants and 42501 refusals (anon, service role, homeowner, vendor; operators cannot call the lookup). Exactly ten new functions. The lookup for both kinds and five no-select cases. **S-37 (a)(b)(c) on real claims and records**: (b) is `current_conflict` while I′ is none, because the row's own ID differs. S-38 and S-51. **S-57 as amended**: a tag link and an `id_only` link are excluded while a competing row holds the ID, then trusted again after that source is deleted, with `not_delivered` / `conflicting_rows` moving 1/0 → 0/1 → 1/0. A tag_only receipt excluded when an application records its ID. Same row with a different attempt. S-47. Item 2 after a later sent attempt. Stored conflicts signalled on both named rows and kept after deletion; S-45; S-46. Rules 1–8 (S-39 to S-43, unknown bounce category, rule 2 before 3). S-42 provider times as received. **S-44** (all 24 orders of two four-fact sets give one summary). S-48 no rematch. S-49 (9 versus 10 from the attempt's `sending` event; rules never override facts). Counts by row, class and type, with attention counts identical with and without receipts. **S-34 expiry** (`−1 s` visible; at and after `expires_at` excluded from summary, history, counts and signal, backlog only, nothing purged). Output keys allowlisted at every level, with no email ID, svix-id or ledger row ID. 100 sources accepted, 101 / null / unknown kind refused. **Read purity**: receipts, purge audit, arming record, all three ledgers and the owner-email event log are byte-identical after every read |
| SQL mutations (9) | **All caught.** Item 2 dropped (2 failing). Attempt ignored in the same-row check (1). Expiry ignored (5). `<` instead of `<=` (5). Rule 9 overriding facts (1; this was first missed, and the test was strengthened). Unmatched rematched by ID (1). A complaint counted as non-delivery (4). Unsent rows counted as not delivered (1). A derived conflict treated as permanent (6) |
| Unchanged definitions | 7.2C-1 by original signature `12 \| 016c0e683cb19c4c68769d87f5215ff1`; renewal trigger `b1607618…`; `vendor_submit_renewal_document` `8c894236…`; application ledger `10 \| 5f14532a…`; price draft `4 \| fddc8bb9…`; the six 7.3B functions `6 \| 57277a24ac11744bde74a0be96cbd79d` (first recorded here; their `md5(prosrc)` values are in the PR body); ledger columns `0e06a9c7…`. Money fingerprint (`scripts/promotion-money-fingerprint.sql`): **`58 \| af0fae6e0c5b604e9073e10bc060957e`**, unchanged |

### 3.2 Concurrency (real database, separate psql sessions, each after a clean reset)

| Script | Result |
|---|---|
| `email-provider-events-concurrency.mjs` | PASS. S-21, S-22, S-58 (`{"fk_failure_then_retry_unlinked":3,"linked_then_cascaded":3,"unlinked_after_delete":16}`) and S-61 as before. **Locked expired replay**: the purge skips the held row, the replay waits and answers `duplicate`, the expiry is unchanged, and the readback counts it only as backlog. **S-37 race**, 24 rounds: the 12 agreeing rounds all linked to their own row (11 `tag_only`, 1 `tag_and_id`) and were trusted at rule 4; the 12 differing rounds were always `tag_only` and `current_conflict`. No receipt was ever linked to another row |
| `email-provider-events-migration-lock.mjs` | PASS. Each ledger contention aborts with 55P03 after 2.3–3.0 s with nothing applied. The uncontended apply takes 334 ms. The 7.3C-1 file re-applies on top with its grants |
| `owner-email-concurrency`, `application-notification-concurrency`, `pricing-concurrency` | PASS |

### 3.3 Application

| Check | Result |
|---|---|
| New and affected unit files | 212/212, including the following. Tags are built and validated (round trip through 7.3B's `correlationTags` in both payload shapes). The legacy body matches byte for byte for absent, undefined, null, empty and invalid tags. A tagged body is the legacy body plus only `tags`. Price-draft vendor sends are unchanged. Each lookup failure (error, throw, null, invalid) and a hang past the bound sends untagged once, logs one allowlisted code and still records. There is no lookup without a claim. A resend is attempt 2 with its own key and tag. Renewal emails are tagged. S-51. S-50 labels |
| Unit mutations (4) | **All caught**: tags key added when absent (12), attempt off by one (2), lookup not bounded (1), fallback skipping outcome recording (6) |
| Full unit suite | **72 files / 1,105 tests** pass (run with `--exclude '.phase5-local/**'` because of the ignored local browser copy; CI has no such folder) |
| Lint, typecheck, secret scan, `audit:prod`, `git diff --check` | All pass; `audit:prod` 0 vulnerabilities |
| Build | `npm run build` with CI's environment passes; `/admin/owner-emails` is static, `/api/admin/owner-emails` dynamic. The browser runs used a separate build pointed at the isolated port |

### 3.4 Browser (isolated copy, ports 3173/56831; `tests/e2e/owner-emails.spec.ts`)

New tests:
- the row summaries, disclaimer, both conflict wordings, the per-attempt history, actions unchanged, and S-50 over the whole page text;
- the counts beside the unchanged attention counts;
- unarmed: rule 10 on every row, plus the not-collected notice;
- evidence read for exactly the visible rows, page by page, and on reload;
- a failed evidence or counts read;
- the keyboard-operable disclosure;
- axe and reflow in light and dark at 320 and 1440 px, with history open.

| Run | Result |
|---|---|
| First full run (load average ≈ 10 from other sessions) | 32/34. Two **existing** tests timed out (lost-resend refresh; dark 320 px axe); both passed when rerun alone |
| Second full run, overlapping my own full SQL suite, Vitest and typecheck (load ≈ 12) | 27/34; 7 timed out at 30 s. Not counted as evidence |
| Quiet full run (load ≈ 2.5–3) | **34/34 pass in 2.1 min**, including all 10 new tests and every existing Owner Emails test. The earlier failures were load timeouts |
| Full `test:a11y` suite | **Not run locally** (CI's application job runs it). Only `owner-emails.spec.ts` covers the changed page |

## 4. Implementation decisions for Codex review

- **D-1** The lookup returns null, rather than raising, for an unknown or null kind. The sender treats null like any failure, so a bad kind can never select another row and never blocks a send.
- **D-2** The lookup bound is 1.5 s, with one code (`correlation_ref_unavailable`) and no error detail. An untagged send is the accepted degradation (plan §7.5 as amended).
- **D-3** The sender drops an invalid tag set whole and sends the legacy body. It never sends a partial set: the receiver would class a partial set `conflict_tag_invalid`.
- **D-4 Literal §7.3 item 2.** Once a later attempt of the same row records a provider ID, an earlier attempt's tagged report with a different ID is excluded as `current_conflict`, even though it described a real email (SQL 122, "item 2" case). The plan and Codex item 1 say "its own linked row", so this is implemented literally and stated in §7.3. **Codex may prefer to narrow item 2** to receipts whose linked attempt is the row's current attempt. That would be a one-line change with a test.
- **D-5 Current-conflict wording.** The handoff proposed "…while another email record holds the same provider ID". That is false for an item 2 conflict, where no other record exists. The page says "…excluded while current email records disagree with it. If the conflicting record is removed, this report can count again." Stored and content conflicts say "…excluded from this summary." with no recovery claim.
- **D-6 Where named stored conflicts appear.** A stored conflict naming a row by tag sits under its tag attempt; that number can exceed the row's attempts for `conflict_tag_invalid`, and is shown as received. One naming the row by recorded ID sits under the row's sent attempt. A receipt is never listed twice for one row.
- **D-7 Counts, literal §9.1.** An `unknown` or `missed` row whose current attempt proves non-delivery is in neither "Not delivered" (sent rows only, S-47) nor "to review" (which excludes proven rows). It remains in the existing attention counts. The global conflicting-reports count adds a `content_conflict` key beside the three identity classes.
- **D-8** The page learns `receiver_armed` from the arming record (read only), to explain why every row reads rule 10.
- **D-9** `owner_email_evidence` echoes `source_id`, which the caller passed and the overview already returns, so rows can be joined. It returns no ledger row ID, provider email ID, tag, svix-id or secret slot (tested).
- **D-10** The migration-lock script change in §2.4 is test tooling only.

## 5. Rollout and rollback

### 5.1 Hosted push (2026-11-19, on the owner's instruction "Please go ahead and push migration")

| Step | Result |
|---|---|
| State when authorized | Codex implementation review of #180 had **not** happened. PR CI 44591952614 on `0eabd63`: backend and lifecycle passed; application failed only at `request.spec.ts:837`, the carried intermittent contrast failure on a page this PR does not touch (873 other browser tests passed). Not rerun (owner handles reruns) |
| **Version collision found** | Hosted already recorded `20261125001000` as `trace156_gallery_photo_services`. That migration came from #178, which merged into a TRACE-156 side branch; it is carried by open #179, not by `main`. Pushing this file under that version would have read as applied and never run. None of the ten 7.3C-1 functions existed on hosted |
| Renumber | Moved to **`20261125002000`** (commit `77e153a`), content unchanged. That sorts after the hosted head and before #179's `20261126001000`, so neither workstream is pushed out of order. Replayed locally after the profile migration: SQL 120–122 671/671, migration-lock PASS |
| Push directory | `supabase db push` refuses when hosted has a version the local folder lacks. The push ran from a scratch copy of this branch's `supabase/` folder, plus a byte copy of the hosted profile migration from `origin/codex/trace156-gallery-management`. Neither branch's content changed; the 7.3C-1 file in it is identical to the branch (`cmp`) |
| Dry run | Listed only `20261125002000_phase7_email_evidence_readback.sql` |
| Push | Applied 21:41:14–21:41:18 UTC, with no lock timeout |
| Readback (read-only) | Migration head `20261125002000` (`phase7_email_evidence_readback`, 15 statements). All ten functions are present; their `md5(prosrc)` equals the local build; volatility, definer settings, empty `search_path` and grants are as designed (lookup: service role only; readback and counts: authenticated only; private helpers: no grants). Unchanged: 7.2C-1 `12 \| 016c0e68…`, 7.3B six `6 \| 57277a24…`, renewal trigger `b1607618…`, money fingerprint `58 \| af0fae6e…`. 0 receipts and an empty arming record |
| Effect | None until merge: nothing calls the functions before the new application code deploys |
| **Consequence for #179** | Hosted now holds `20261125002000`, which #179's branch lacks. Its `db push` will refuse until its local folder contains this file: after #180 merges and #179 rebases, or with the same scratch-folder approach. Its `20261126001000` still sorts after this one, so `--include-all` is not needed |

### 5.1a After #179 merged (2026-11-19, investigated on the owner's request)

| Finding | Detail |
|---|---|
| PR conflict | #179 merged into `main` (`39d48a5`), carrying both TRACE-156 migrations (`20261125001000`, `20261126001000`). The only conflict was in `TRACEABILITY.md`: `main` changed the TRACE-156 row and this PR changed the TRACE-155 row. After the rebase, the TRACE-155 row is this PR's and the TRACE-156 row is byte-identical to `main`'s. The PR is mergeable again (head `adea05e`) |
| Combined tree, local | Migrations apply in the order `20261125001000` → `20261125002000` → `20261126001000`. Full SQL replay **115 files / 8,096 PASS**; unit 74 / 1,132, typecheck and lint pass |
| "Supabase Preview" on this PR | Failed with "Remote migration versions not found in local migrations directory". This PR's preview database (`with_data=false`) had applied this migration under its first number, `20261125001000`, before the renumber. After the rebase it failed as expected: `function "owner_email_correlation_ref" already exists` (42723). On the owner's approval, only the PR 180 preview branch (`jfejzftjtdsqkoouhjmt`, not production) was deleted at about 22:25 UTC, so the next push rebuilds it from the current branch |
| "Supabase Preview" on `main` | Already failing at `1327a58`, before this PR's push, because production held the TRACE-156 `20261125001000` that `main` lacked. Since #179 merged, the only version production has and `main` lacks is this PR's `20261125002000`. Merging #180 removes that difference |
| **Production gap (TRACE-156, not this PR)** | #179's `20261126001000_trace156_gallery_management.sql` is **not on production**, but its code deployed (GitHub Production deployment 7926745674, 21:49 UTC). Missing: `contractor_gallery_pairs` and five gallery RPCs. Gallery editing (bulk services, captions, reorder, pairs) fails. The public profile treats the unreadable pairs table as "no pairs" and still renders. Its push would likely have been refused because production held this PR's `20261125002000`, which #179's branch lacked. **Pushed on the owner's authorization at 22:23:19–22:23:25 UTC.** The push folder was `main`'s exact `supabase/` tree (`39d48a5`) plus this PR's already-applied `20261125002000`. The dry run listed only `20261126001000` (byte-identical to `main`). Readback: head `20261126001000` (28 statements); `contractor_gallery_pairs` has RLS, its one public-read policy, select for anon and authenticated, all for the service role, and 0 rows; the five commands are security definer with an empty `search_path`, granted to authenticated only; the guard has no grants; 103 existing gallery photos; money fingerprint `58 \| af0fae6e…` unchanged |

### 5.2 Remaining steps (each needs separate owner authorization)

1. Codex implementation review and **green exact-head CI** (the application job now has 30 minutes).
2. ~~Before merge: dry run and push~~ **Done 2026-11-19 (§5.1).**
3. ~~Read-only hosted readback~~ **Done (§5.1).** Not yet done: calling `owner_email_evidence_counts()` as an operator session after deploy, expecting all zero with `receiver_armed` false.
4. Merge = production deploy. Effects:
   - production owner-email sends gain three opaque tags whenever the lookup answers in time; recipient, content, claims and keys are unchanged;
   - Owner Emails shows "Delivery evidence not available" on every row and says reports are not being collected.
5. Rollback: promote the previous deployment. The functions stay, unused. Fix forward.

## 6. Unresolved and carried

- **Codex:** review D-1..D-10, especially D-4 and D-5.
- **7.3B open items, not done here:** push provenance and timing, the §7 preflight record, the post-deploy 503 probe, and record §8 (real `svix-id` and email-ID shapes, bounce strings, re-signing of late retries, payload shapes, rotation rehearsal).
- **7.3C-2:** application and price-draft tags and readbacks. Arming waits for both slices, EO-1, EO-2, EO-3, EO-6 and EO-7, and the §12 controlled acceptance.
- **Owner:** EO-1..EO-8, all unapproved.
- **Carried:**
  - CFG-011;
  - A2;
  - the retrospective 7.2B review;
  - the #167 review, READY readback and renewal-window reconciliation;
  - real-email verification for 7.2C-1 and 7.2C-2;
  - final booking-readiness checks;
  - `request.spec.ts:837`.
- **Out of scope:** retries, suppression, Cron, booking, payments, mock booking and dynamic-profile changes.
