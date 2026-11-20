# Phase 7.3C-2 — Application and price-draft correlation tags and delivery-evidence readbacks: implementation (TRACE-155)

**Status: IMPLEMENTED on draft PR #181; DORMANT.** Codex implementation review pending. **Migration `20261127001000` pushed to hosted on 2026-11-19 on the owner's instruction (§5.1)**; nothing is merged or deployed. No secret, webhook registration, receiver arming, `armed_at` write or email.
**Authority:** the owner's 7.3C-2 implementation instruction (2026-11-19), Codex review [5985392153](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/180#pullrequestreview-5985392153) on #180 (it clears the shared 7.3C-1 source for local, dormant 7.3C-2 work), the [plan](PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md) §7.1–§7.5, §8.3–§8.5, §9.1, §11.4 and §13.3, and the [7.3C-1 record](PHASE-7-EMAIL-DELIVERY-EVIDENCE-7-3C-1.md).
**Branch:** `claude/phase7-3c2-application-price-draft-tags`, in its own worktree, based on `main` `9e7fd39`.

## 1. Baseline

| Check | Result |
|---|---|
| Base | `origin/main` `9e7fd39` (the #180 merge), as the instruction names. `gh pr view 180`: merged 23:29 UTC, head `ff34e78` |
| CI | PR CI 44628358534 on `ff34e78`: success. Main CI 44638058722 on `9e7fd39`: success |
| Codex review 5985392153 | Read. D-4: keep the whole-row identity check and do not narrow it implicitly (§4 D-11). D-10: extend the migration-lock tooling deliberately (§2.4) |
| Stale records | The 7.3C-1 record, its handoff, TRACE-155 and the shared handoff said "not merged / review pending". Each now carries a dated correction; the original text is kept |
| Migration version | Hosted head `20261126001000` (read-only `supabase migration list --linked`, 2026-11-19). No local branch, worktree (including the dynamic-profile worktrees) or open PR has a migration after it, so **`20261127001000`** is free. No dry run or push |
| Isolation | Worktree `mercurius-phase7-3c2-readback`. Disposable Supabase project `mercurius-phase7-3c2` on ports 56040–56047, with its workdir in the worktree's ignored `.phase5-local/`. Browser tests ran from a generated copy on ports 3174/56841. The shared checkout, the dynamic-profile worktrees and their processes, the shared `mercurius-phase5-isolated` stack and the earlier `mercurius-phase7-3c1` stack were not touched. No `.env.local` or production credential is in the worktree |

## 2. What changed

### 2.1 Senders (no lookup is needed)

| Ledger | Tag reference | Change |
|---|---|---|
| Application (`deliverApplicationNotification`) | `application_id`, the ledger's key; the attempt is the successful claim's | After the claim, `buildCorrelationTags("application", applicationId, attempt)`. When the inputs are invalid, it sends untagged and logs `application_notification.correlation_unavailable` / `correlation_ref_unavailable` (v1, warn, still 14 keys) |
| Price draft (`deliverDraftEmail`) | The **claimed `notice_id`**. `pricing_claim_draft_email` already returns it (migration `20261018004000`); the TypeScript `Claim` now declares it | `buildCorrelationTags("package_draft", claim.notice_id, claim.attempt)`. It never uses the draft ID or a later lookup of the current revision. An invalid value sends untagged and warns with the draft ID and attempt only |

In both senders, the body without valid tags is byte-for-byte the pre-7.3C body; with them, only `tags` is added, last (the shared sender from 7.3C-1 is unchanged). Recipient, wording, `from`, `reply_to`, the per-attempt `Idempotency-Key`, the timeout, claim and record arguments, outcome classification and the single-claim, no-retry semantics are unchanged. The owner-email sender is untouched.

### 2.2 Migration `20261127001000_phase7_email_evidence_ledgers.sql` (functions and grants only)

| Function | Access | Purpose |
|---|---|---|
| `private.email_evidence_ledger_claimed_at(ledger, ref, attempt)` | Private | Claim time from existing evidence only. Application: the attempt's `sending` audit event, else the row's `claimed_at` for its current attempt. Price draft: the notice's `claimed_at` for its **current attempt only**; notices keep no per-attempt history, so an earlier attempt's time is **unknown (null)** and an empty fact set reads rule 10, never rule 9 |
| `private.email_evidence_ledger_receipts(ledger, ref)` | Private | One row's unexpired receipts, judged by 7.3C-1's `email_evidence_receipt_state`: linked ones on their attempt, stored conflicts naming the row by tag on their tag attempt, and stored conflicts naming it by recorded ID on its sent attempt. An unmatched receipt is never rematched |
| `private.email_evidence_ledger_row(ledger, ref)` | Private | The current attempt's summary (7.3C-1 `email_evidence_summary`), the conflict signal and reasons, and per-attempt history, in the owner-email shape |
| `private.email_evidence_ledger_counts(ledger)` | Private | Ledger-only `not_delivered`, `to_review`, `conflicting_rows` |
| `private.email_evidence_global_counts()` | Private | Global `receiver_armed`, conflicting reports by class, unmatched reports by type, retention backlog. Equal to `owner_email_evidence_counts()`'s global keys (asserted in SQL 124) |
| `public.application_email_evidence(uuid[])` | Operator | Recruiting rows' evidence, at most 100 per read; untracked applications are omitted |
| `public.application_email_evidence_counts()` | Operator | `{checked_at, ledger: {…}, all_emails: {…}}` |
| `public.package_draft_email_evidence(uuid[])` | Operator | Per draft, one entry per notice (one per sent revision): `current` (the notice of the draft's sent revision, joined exactly as the panel's delivery readback), `queued_at`, `state` (the existing notice view) and the row evidence. At most 100 drafts; drafts without notices are omitted |
| `public.package_draft_email_evidence_counts()` | Operator | `{checked_at, ledger: {…}, all_emails: {…}}` |

Everything is `STABLE` and nothing writes: no purge, flag, quarantine or arming write. The private helpers run as their caller with an empty `search_path` and have no grants. The four public functions are security definer and granted to `authenticated` only, behind `vendor_require_operator()`. No new function takes or returns the receipt row type. All use plain `create function`, so a name collision aborts the migration. Nothing existing is restated: not the ledgers, claim or record functions, the receiver, the 7.3C-1 functions, or any money function.

### 2.3 Operator surfaces

- `src/components/admin/DeliveryEvidence.tsx` (new) holds the row-evidence block and the counts card, **moved** from the Owner Emails page with its markup and wording. The counts are shown in two labelled scopes: this ledger's rows ("Owner emails" / "Application emails" / "Price-approval email notices") and "All Mercurius emails". Every 7.3C-1 label is kept, and the Owner Emails browser suite passes unchanged.
- `src/lib/emailEvidence/readback.ts` (new) holds the shared readback types, 100-ID batching and the split of the owner-email flat counts into the two scopes. `ownerEmails.ts` keeps its type names as aliases.
- **Recruiting.** Each visible application email shows "Delivery evidence: …", the conflict signal and the per-attempt history. Evidence is read for exactly the visible rows, in reads of at most 100, and again for newly visible rows when "Show all" is pressed. A response for an earlier load is discarded. The counts card sits above the list, and the existing attention summary is unchanged.
- **Price-draft panel** (`PackageDraftList`). Each draft shows "Email notice delivery evidence: …" for its sent revision's notice. An earlier revision's notice is shown, labelled with when it was queued, only when it has a report or a conflict. The ledger-wide counts appear only on the all-vendors view (`/admin/vendor-prices` without a vendor filter). Evidence is re-read when the listed drafts, their revision or their email state change (so after a send or resend), and a response for an earlier list is discarded.
- A failed evidence or counts read shows an alert; the list, states and actions are unchanged. Evidence never adds, removes or gates an action.
- `tests/fixtures/portal-server.mjs` answers the four new RPCs as production does until 7.3D (rule 10, unarmed, zero counts), and refuses non-operators.

### 2.4 Tests and tooling

| File | Change |
|---|---|
| `supabase/tests/124_email_evidence_ledgers.sql` | New: 244 assertions (§3.1) |
| `supabase/tests/122_email_evidence_readback.sql` | One assertion: its `email\_evidence\_%` name filter now excludes the five 7.3C-2 helpers **by exact signature**, as 7.3C-1 did for SQL 120/121. The ten 7.3C-1 functions stay pinned there; the new ones are tested in SQL 124 |
| `scripts/email-provider-events-migration-lock.mjs` | Codex D-10: it drops the nine 7.3C-2 functions (read from that migration's revoke block) before the 7.3C-1 ones. After restoring 7.3B and re-applying 7.3C-1, it re-applies the unchanged 7.3C-2 file, checks its grants, and runs one of its functions. The 7.3B lock-timeout assertions are unchanged |
| `scripts/email-provider-events-concurrency.mjs` | The S-37 race on application rows and on price-draft notices, the latter with a concurrent revision change (§3.2) |
| `tests/unit/email-evidence-ledgers.test.ts` | New (§3.3) |
| `tests/e2e/email-evidence-ledgers.spec.ts` | New (§3.4) |

## 3. Verification (local, synthetic, isolated stack `mercurius-phase7-3c2`)

### 3.1 Database

| Check | Result |
|---|---|
| SQL 124 | **244/244** |
| SQL 120, 121, 122 with 124 | Pass (122 after the one assertion change in §2.4) |
| Full SQL suite, clean replay | **116 files / 8,340 tests PASS** (three more files than 7.3C-1's 113: the two TRACE-156 files merged since, and SQL 124) |
| SQL 124 coverage | Shape, volatility, definer/invoker split, empty `search_path`, grants; exactly nine new functions; no receipt row-type dependency. 42501 for anon, service role, homeowner and vendor on all four public functions. **Exact claimed tagging on real claims and records**: application attempts 1 and 2 (after an attested resend); the price-draft claim returns the claimed revision's notice. **Revision change during delivery**: h1 is claimed, then the draft moves to h2 with a new notice. The h1-tagged report links to h1's notice, the record lands on h1's notice by its claim, and h2's notice stays pending with no evidence. A draft-ID tag and a current-revision tag would both be stored `conflict_tag_invalid`. **Callback before record (S-37 a/b/c, S-38)** on both ledgers: same ID → rule 4; different ID → `current_conflict`; unknown outcome → rule 4 on an unknown row, which still needs the attestation to resend. A future-attempt tag → stored conflict. **Same row, different attempt**: once attempt 2 records another ID, attempt 1's earlier report is excluded (whole-row check, D-4 retained). S-54 → `conflict_disagree`; attempt 2's agreeing report → rule 4; history lists each report once. **Cross-ledger**: application vs owner email, price draft vs application, and `id_only` application vs price draft. Each is excluded while the other row holds the ID and trusted again after that source is deleted, with the conflicting-row count moving +1 then back. Stored disagreements (application tag vs owner ID; price-draft tag vs application ID) stay excluded after the other row's deletion. **Unmatched**: an untagged early callback stays `unmatched`/`unlinked` after the row records the same ID, on both ledgers. **Claim times**: application attempt 1 from its event, attempt 2 from its event; price-draft current attempt from `claimed_at`, earlier attempt null; armed → rule 9 on the current attempt, rule 10 on an attempt claimed before arming and on a price-draft attempt with unknown claim time. **Expiry (S-34)**: `+1 s` visible; at and after `expires_at` excluded from summary, history and signal; an expired delivered report cannot turn rule 5 into rule 2. **Counts**: exact ledger counts (an unknown row with proven non-delivery in neither count, D-7); exact global counts; both pages' global counts equal; equal to the owner-email readback's global keys; no owner-email row counted for another ledger's reports. **Attention readbacks unchanged** with and without receipts (`r0_application_notification_overview`, `admin_package_drafts`, owner attention counts). **Output keys** allowlisted, with no provider email ID, svix-id, notice ID or revision hash; 100 accepted, 101 and null refused; deleted or unknown records omitted. **Parity**: the same seven receipts on an owner-email row, an application row and a price-draft notice give identical evidence (rule 2 with every conflict kind, history 1:10, 2:2, 3:10). **Read purity**: receipts, purge audit, arming record, all three ledgers, both event logs and the drafts are byte-identical after every read, and expired receipts are still stored |
| SQL mutations (12) | **11 caught**: an invented price-draft claim time (2 failing), ignored application events (1), the stored-conflict-by-tag branch dropped (10), unmatched rematched by ID (1), expired receipts kept on rows (4), `not_delivered` without the sent filter (1), expired counted as unmatched (2), `current` ignoring the revision (1), the summary taken from the wrong attempt (3), the 100 bound not enforced (1), and a current conflict missing from the signal (2; first missed, then the test was strengthened). **1 equivalent**: dropping the ledger filter from the stored-tag branch of the counts cannot change a result, because another ledger's IDs never join this ledger's table |
| Unchanged definitions | Application ledger `10 \| 5f14532a…`; price draft `4 \| fddc8bb9…`; 7.2C-1 `12 \| 016c0e68…`; renewal trigger `b1607618…`; `vendor_submit_renewal_document` `8c894236…`; 7.3B six `6 \| 57277a24…`; **7.3C-1 ten `10 \| 8177b42a7194ac42e22bd908558f1dff`** (first pinned here; the same digest on the 7.3C-1 stack built from `ff34e78`); ledger columns `0e06a9c7…`. Money fingerprint (`scripts/promotion-money-fingerprint.sql`): **`58 \| af0fae6e0c5b604e9073e10bc060957e`**, unchanged |

### 3.2 Concurrency (real database, separate psql sessions)

| Script | Result |
|---|---|
| `email-provider-events-concurrency.mjs` | **PASS** at load ≈3–6, alone and after the migration-lock script in CI order. The existing S-21, S-22, S-58, S-61, the locked expired replay and the 7.3C-1 S-37 race pass as before. **New S-37 race on the 7.3C-2 ledgers**, 24 rounds each: every receipt links to its own row or claimed notice, never another. On agreement it is trusted at rule 4 (application `tag_only` 9–12 and `tag_and_id` 0–3; price draft `tag_only` 7–10 and `tag_and_id` 2–5 across runs). On disagreement it is always `tag_only` and `current_conflict`. Through a **concurrent revision change**, the price-draft receipt always stays on the claimed revision's notice, and the new revision's notice stays unclaimed with no evidence. **Two earlier runs failed at S-58's forced "delete first" order** at load ≈10–18 from other sessions on this machine. That case orders two `docker exec` sessions with a 200 ms sleep; it is a 7.3B case this slice does not touch, and it passed in both quiet runs |
| `email-provider-events-migration-lock.mjs` | **PASS** (three runs). Each ledger contention aborts with 55P03 after 2.3–3.3 s with nothing applied. 7.3C-1, then the unchanged 7.3C-2 file, re-apply on top with their grants, and a 7.3C-2 function runs against the restored objects. One earlier run failed only at a new assertion written as `'false'` where psql prints `f`; corrected |
| `owner-email-concurrency`, `application-notification-concurrency`, `pricing-concurrency` | **PASS**, in CI order after a clean reset. An earlier pricing pass is not counted: it overlapped the next run's reset |

### 3.3 Application

| Check | Result |
|---|---|
| New unit file | `email-evidence-ledgers.test.ts`, 18 tests. Application: attempts 1, 2 and 37 tagged with the `application_id` and claimed attempt; the body is the legacy body plus only `tags`; the key is unchanged; tags round-trip through the 7.3B receiver parser; no RPC besides claim and record, with the record's arguments unchanged. Five invalid inputs (uppercase or non-UUID ID; attempt 0, fractional or above 10,000) send untagged, byte for byte, log exactly one allowlisted v1 warning with 14 keys, and still record. A refused tagged send records `failed`. No claim, no send. Price draft: the claimed `notice_id` (never the draft ID) and attempt, legacy body plus `tags`, recipient and key unchanged, record arguments unchanged. A revision change keeps each claim's notice. **Key characterization (D-3)**: two revisions' attempt 1 share the key while their tagged bodies differ. Four invalid `notice_id` values send untagged, byte for byte, warn without the address, and still record. An unknown result records `unknown` |
| Affected unit files | `draft-email-notices`, `application-notification-tracing`, `email-correlation-tags`, `owner-email-ledger`: unchanged and passing (196 with the new file) |
| Unit mutations (8) | **7 caught**: invalid input normalized and tagged (1), attempt off by one (4), no fallback warning (5), fallback skipping the send (5), the draft ID as `mm_ref` (7), fallback skipping recording (6), a per-notice key (7). **1 equivalent**: always passing a partial tag set leaves the body byte-identical, because the shared sender drops any invalid set whole (7.3C-1 D-3) |
| Full unit suite | **75 files / 1,150 tests** pass (run with `--exclude '.phase5-local/**'` because of the ignored local browser copy; CI has no such folder) |
| Lint, typecheck, secret scan, `audit:prod`, `git diff --check` | All pass; `audit:prod` 0 vulnerabilities |
| Build | `npm run build` with CI's environment passes; `/admin/recruiting`, `/admin/vendor-prices` and `/admin/owner-emails` are static. The browser runs used a separate build pointed at the isolated port |

### 3.4 Browser (isolated copy, ports 3174/56841)

`tests/e2e/email-evidence-ledgers.spec.ts`, 18 tests:
- **Recruiting**: unarmed rule 10 on every visible row, the not-collected notice and the scoped counts; evidence read for exactly the visible rows, then for the newly visible row on "Show all"; summaries, both conflict wordings and the attempt-2 note; per-attempt history with "Provider time not given"; actions unchanged; armed counts; S-50 over every evidence block; 230 rows read as 100 + 100 + 30; a stale response discarded after Refresh; failed evidence and counts reads; keyboard disclosure; axe and reflow in light and dark at 320 and 1440 px with every history open; non-operator sees nothing.
- **Price drafts**: the sent revision's notice and an earlier revision's notice, each with its own evidence; an earlier notice without reports hidden; existing email state and resend unchanged; one call for the listed drafts; scoped counts on the all-vendors view and none on one vendor's view; failed reads; axe and reflow in four theme/width combinations.

| Run | Result |
|---|---|
| New spec, first run (load average up to ≈18 from other sessions) | 15/18 at that point. Two dark-theme axe runs timed out at 30 s and passed alone. One real test bug: a case-insensitive substring lookup matched the visible conflict signal; fixed with exact matching |
| New spec with every existing spec on the changed pages (`owner-emails`, `vendor-readiness`, `vendor-prices`, `pricing-approval`, `light-only`), load ≈5 | **131/131 pass** in 7.4 min |
| After the price-draft panel's re-read fix, rebuilt (load average up to ≈18) | 120/131. Eleven failed, including tests on pages this slice does not change (`light-only`, the non-operator check), and the run took 19.3 min against 6–7 min normally. The machine restarted before the error detail could be read, so these are not diagnosed one by one |
| Same build after the restart, new spec alone (load ≈4–5) | **18/18 in 1.1 min** |
| **Final: same code and build, all six specs (load ≈3–4)** | **131/131 pass in 6.1 min** |
| Full `test:a11y` suite | Not run locally; CI's application job runs it |

## 4. Implementation decisions for Codex review

- **D-1 No lookup.** Neither ledger needs 7.3C-1's bounded lookup: the application ref is the key the sender already holds, and the price-draft ref comes in the claim. So there is no new public function and no timeout path. Invalid inputs fall back to an untagged send (C3C-2 semantics).
- **D-2 One generic helper for the two ledgers.** It has the same structure as the owner-email helpers, which are not restated. SQL 124's parity case shows identical output for identical receipts. Moving Owner Emails onto the generic helper would restate 7.3C-1, so it was not done.
- **D-3 Conflict to resolve: the price-draft idempotency key is per draft, not per notice.** `draftEmailKey` is `package-draft-email:<draft>:<attempt>`, so attempt 1 of revision h2's notice reuses attempt 1 of h1's key. The instruction says to preserve the per-attempt key, and it is preserved. But plan §13.3 assumes "keys stay per attempt, so no 409 from a reused key", and that does not hold here. Resend's documented behavior (plan §4.1), within its 24-hour key retention:
  - **Before 7.3C-2:** identical bodies → Resend replays the first response. The h2 notice is recorded `sent` with h1's provider ID, and **no email is sent** for h2. The two notices then share one ID, so a report for it would be `conflict_id_ambiguous`.
  - **After 7.3C-2:** the bodies differ by `mm_ref` → 409 `invalid_idempotent_request` → `unknown`. The operator sees "Email result unknown" and can resend with confirmation as attempt 2, whose key can collide in the same way if h1 had an attempt 2.

  This is a pre-existing defect that tags make visible rather than cause. It changes one existing outcome from a false `sent` to a truthful `unknown`. I did not change the key, because a new key format is a send-semantics decision. **Codex/owner:** accept as is for this dormant slice, or approve a per-notice key in a separate reviewed change before 7.3D. Characterized by the unit test in §3.3.
- **D-4 Unknown claim times stay unknown.** Price-draft notices have no attempt history, so only the current attempt has a claim time. Earlier attempts read rule 10 (never rule 9) when they have no trusted report. Applications use their existing `sending` events.
- **D-5 Count scopes.** The new count functions return `ledger` and `all_emails` separately. The global helper copies 7.3C-1's global expressions rather than calling `owner_email_evidence_counts` (an owner-named, operator-guarded function). SQL 124 asserts the two are equal on a world with every kind of global count. The Owner Emails page now shows its counts under the same two headings, with every label unchanged.
- **D-6 Price-draft readback per notice.** `current` mirrors `package_draft_delivery`'s join (`revision = sent_hash and approval_state <> 'draft'`). Earlier notices appear in the panel only with a report or conflict. The output echoes only the caller's draft ID (as 7.3C-1 D-9); never a notice ID or revision hash.
- **D-7 Shared component.** The Owner Emails evidence block and counts card were moved, not rewritten, so the three surfaces cannot drift in wording.
- **D-8 Recruiting batching.** The Recruiting overview is unbounded, so evidence is read in batches of 100 for visible rows only.
- **D-9 Price-draft counts** appear only on the all-vendors view. Ledger-wide numbers on a single vendor's page would read as that vendor's.
- **D-10 Logging.** Application sends add one v1 event name (keys unchanged at 14). The price-draft sender keeps its existing `console` pattern and logs no address, notice ID or tag.
- **D-11 Whole-row check retained** (Codex D-4), and not narrowed: SQL 124 §4 asserts an earlier attempt's report is excluded once a later attempt records another ID, on both ledgers.

## 5. Rollout and rollback

### 5.1 Hosted push (2026-11-19 ET, on the owner's instruction "Please go ahead and apply the migration please")

| Step | Result |
|---|---|
| State when authorized | Draft PR #181 at `b29ac8e`; Codex implementation review **not** yet done; exact-head CI (44669132443 / 44669184392) still running |
| Pre-check (read-only) | `supabase migration list --linked` from this worktree, which is linked to the production project: local and hosted match through `20261126001000`. Nothing is remote-only; the only local-only version is `20261127001000`. `main` was still `9e7fd39` and the worktree clean, so the push folder is this branch's own `supabase/` tree (no scratch copy needed, unlike 7.3C-1) |
| Dry run | Listed only `20261127001000_phase7_email_evidence_ledgers.sql`; no seeds or roles |
| Push | Applied 03:47:58–03:48:02 UTC (22:47 ET), with no lock timeout |
| Readback (read-only) | Migration head `20261127001000` (`phase7_email_evidence_ledgers`, 13 statements). All nine functions are present, and each `md5(prosrc)` equals the isolated build of this branch. All `STABLE`. The four public functions are security definer and executable by `authenticated` only (not `anon` or `service_role`); the five private helpers run as their caller with no grants. Every function has an empty `search_path`. Unchanged: application ledger `10 \| 5f14532a…`, price draft `4 \| fddc8bb9…`, 7.3B six `6 \| 57277a24…`, 7.3C-1 ten `10 \| 8177b42a…`, money fingerprint `58 \| af0fae6e…`. 0 receipts and an empty arming record |
| Effect | None until merge: nothing calls the functions before the new application code deploys |

### 5.2 Remaining steps

Each needs separate owner authorization:
1. Codex implementation review and **green exact-head CI**.
2. ~~Before merge: `supabase db push --linked --dry-run`, which should list only `20261127001000`, then the push and a read-only readback: nine functions with `md5(prosrc)` matching this branch, volatility, definer settings, empty `search_path`, grants, and unchanged hashes and fingerprint. The migration adds functions only, under a 2 s lock timeout.~~ **Done 2026-11-19 (§5.1).**
3. Merge = production deploy. Effects:
   - application owner emails and price-draft notices gain three opaque tags whenever the inputs are valid; recipient, content, claims and keys are unchanged, except the D-3 outcome change on a re-sent revision within 24 hours;
   - Recruiting and the price-draft panel show "Delivery evidence not available" and say reports are not being collected.
4. After deploy: operator-session readback of `application_email_evidence_counts()` and `package_draft_email_evidence_counts()`, expecting zeros with `receiver_armed` false, and the exact-commit production READY readback.
5. Rollback: promote the previous deployment. The functions stay, unused. Fix forward.

## 6. Unresolved and carried (none claimed done)

- **Codex:** D-1..D-11, especially **D-3**.
- **7.3C-1 deployment and operator checks:** exact-commit production READY readback; operator-session `owner_email_evidence_counts()` after deploy. Codex did not re-verify the hosted push or readback.
- **7.3B operational evidence:** push provenance and timing, the §7 preflight record, the post-deploy 503 probe, and record §8 (real `svix-id` and email-ID shapes, bounce strings, re-signing of late retries, payload shapes, rotation rehearsal).
- **7.3D gates:** arming waits for both 7.3C slices to be deployed, EO-1, EO-2, EO-3, EO-6, EO-7 and the §12 controlled acceptance.
- **Owner:** EO-1..EO-8, all unapproved.
- **Carried:** CFG-011; A2; the retrospective 7.2B review; the #167 review, READY readback and renewal-window reconciliation; real-email verification for 7.2C-1 and 7.2C-2; final booking-readiness checks; `request.spec.ts:837`.
- **Out of scope:** suppression, automatic retries, Cron, booking, payments, mock booking, profile changes, hosted actions, secrets, webhook registration or arming, and real email.
