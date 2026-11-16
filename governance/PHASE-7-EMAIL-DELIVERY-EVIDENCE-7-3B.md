# Phase 7.3B — dormant authenticated receipt of Resend provider events: implementation (TRACE-155)

**Status: IMPLEMENTED LOCALLY on a draft PR; DORMANT.** Codex implementation review pending. Not pushed to hosted, merged or deployed. No secret configured, no webhook registered, no email sent. Suppression, retries, Cron, booking and payments are untouched.
**Authority:** Codex plan clearance [#5920917095](https://github.com/Jcoley-Mercurius/mercurius-marketplace-next/pull/168#pullrequestreview-5920917095) at plan head `5e8b8139789aadd8d76179a1b04a4b556af6b1d8`, under [plan](PHASE-7-EMAIL-DELIVERY-EVIDENCE-PLAN.md) §13.2. Clearance covers this LOCAL, DORMANT slice only. It is not implementation acceptance, merge or deployment approval, hosted push, receiver arming, or owner-policy approval.
**Branch:** `claude/phase7-3b-dormant-email-receiver`, based on `main` `bc51c3d` (§1).

## 1. Baseline

| Check | Result |
|---|---|
| PR #168 (plan) | **Merged** 2026-11-16 14:14:08 UTC as `bc51c3d5f8961607511209e8e95c018aa0ce3506`. Its head was `5e8b813`, the cleared plan head. `git diff 5e8b813 bc51c3d` is empty, so the trees are identical |
| Plan-head CI | `5e8b813`: run 43872763779 (pull_request) **success**; run 43872434089 (push) **success** |
| Main merge CI | `bc51c3d`: run 43883598183 was **in progress** when this branch was cut: backend and lifecycle success, application running. Result in §5.6 |
| Branch base | Work began stacked on `5e8b813` while #168 was open. Once #168 merged, the branch was re-pointed to `bc51c3d` before any commit (identical tree). **Not a stack:** the base is the merged plan |
| Hosted migration head | `20261123001000` per the 7.2C-2 record (not re-queried). The new migration `20261124001000` sorts after it |
| Working tree | Clean at start; no unrelated work present |

## 2. What changed

| Area | Change |
|---|---|
| Migration `20261124001000_phase7_email_provider_events.sql` | Additive only. `private.email_provider_events` with the §8.1 columns and coherence checks, plus three narrower checks (§3 D-6); six indexes. A `BEFORE UPDATE` guard trigger (§3 D-4). `private.email_provider_event_purges` (counts-only audit). `private.email_evidence_config` (created empty). Private helpers: `email_provider_event_retention`, `email_provider_id_candidate`, `email_provider_tag_exists`. `public.email_receive_provider_event` (service role only) and `public.email_provider_events_purge` (operator-guarded, clamped). Explicit revokes. Last, three ordinary non-unique partial `provider_message_id` indexes on the existing ledgers. The whole file runs under `lock_timeout = 2s`, the ledger indexes under `statement_timeout = 5s`, and both settings are reset at the end (§7) |
| `src/lib/emailEvidence/resendWebhook.ts` | The plan §6.2 sequence, server-only, with injectable dependencies for tests. Includes the exact-pinned svix verifier wrapper, bounded headers, an advisory `Content-Length`, a counted stream read that cancels at 65,536 bytes, fatal BOM-preserving decoding with a re-encode equality check, rotation limited to the signature-mismatch path, parse only after verification, and allowlisted normalization. Then one RPC; 2xx only after it returns |
| `src/app/api/webhooks/resend/route.ts` | `runtime = "nodejs"`. `POST` wires production dependencies, and the service client is built only after authentication. `GET/HEAD/PUT/PATCH/DELETE/OPTIONS` return 405. With no `RESEND_WEBHOOK_SECRET`: 503, body unread. The proxy matcher (`/admin`, `/vendor`) does not cover this path |
| `src/lib/env/server.ts`, `.env.example`, `README.md` | `getResendWebhookEnvironment()` reads `RESEND_WEBHOOK_SECRET` and `RESEND_WEBHOOK_SECRET_PREVIOUS`, both optional and never throwing. `.env.example` and the README environment matrix get names and descriptions only (empty values; Production only, never Preview) |
| `src/lib/observability/operationalLog.ts` | v2 allowlists only: route `resend_webhook`; events `email_webhook.refused/rejected/recorded/duplicate/conflict/failed`; outcome `duplicate`; codes `webhook_headers_invalid`, `webhook_payload_too_large`, `webhook_payload_invalid_encoding`, `webhook_signature_invalid`, `webhook_payload_invalid`. `.rejected` and `.conflict` log at warn level. v1 is unchanged (14 keys); v2 keeps 16 keys |
| Dependency | `svix` **2.9.1**, exact (`package.json`), with lockfile-pinned transitive packages (§5.1) |
| Tests and CI | `supabase/tests/121_email_provider_events.sql`; `tests/unit/resend-webhook.test.ts`; `scripts/email-provider-events-concurrency.mjs`; `scripts/email-provider-events-migration-lock.mjs`. Both scripts are new backend CI steps |
| `scripts/email-provider-events-preflight.sql` | Read-only pre-push preflight: ledger counts and sizes, current ledger locks, open-transaction ages, and the absence of 7.3B objects. **Not run against hosted** |

**Not changed:** the three ledger tables' columns, constraints, triggers and grants (hashes in §5.4); every ledger function; `ownerNotifications.ts` and the senders (no tags yet); every money-fingerprinted function. No row in any ledger is read for content or changed by a receipt.

## 3. Implementation decisions for Codex review

- **D-1 Tag invalidity precedes ID ambiguity.** Plan §7.2 rows "any | ambiguous" and "invalid | any" overlap. The code evaluates the invalid tag first, so a present invalid tag is always `conflict_tag_invalid`. Both outcomes are untrusted and unlinked. The order also makes the duplicate comparison exact (D-2). A valid tag with an ambiguous ID is `conflict_id_ambiguous` (S-55).
- **D-2 Duplicate versus content conflict.** The normalized fields compared are processing, event type, provider type, provider time, email ID, bounce type and subtype, the tag triple, and whether malformed `mm_*` tags were present. That last item is derived from `identity_class = 'conflict_tag_invalid'` with no stored tag, so no extra column is needed. The secret slot and identity class are **not** compared: they depend on when a delivery arrived, not on what it says. So a retry after rotation, or after a ledger records the ID, is a duplicate. The stored receipt is never rewritten (S-57, receipt-time half).
- **D-3 Purge before insert.** The receipt-time purge runs before insert-or-detect. An expired receipt therefore never answers as a duplicate: a replay after expiry is recorded as a new receipt with its own clock (plan §11.4 item 2; SQL 121 §9).
- **D-4 Immutability is broader than the plan requires.** The guard rejects any `expires_at` change, which is the planned requirement. It also rejects any change to any other stored field, and any clearing of `content_conflict`. The one permitted update is the one-way conflict flag. This is the durable basis for §4.
- **D-5 Retention values are placeholders.** `private.email_provider_event_retention` returns the EO-2 **proposal** (linked 90 days, others 30 days). It is not owner policy. A different EO-2 decision replaces this function in a reviewed migration before arming.
- **D-6 Extra table checks.** An `other` event has no email ID, has no bounce fields and is `unmatched`. Bounce fields appear on `email.bounced` only. `provider_email_id` must match `^[A-Za-z0-9._:-]{1,100}$` (Resend IDs are UUIDs; address-shaped values are refused). The route sends a non-matching ID as null, which gives `id_missing`. The exact provider shape is still to be confirmed with a real synthetic sample in 7.3D.
- **D-7 Purge audit.** `private.email_provider_event_purges` holds actor, applied limit, deleted, remaining (capped at 10,000), over-cap flag and time. That is "audited by count only" (plan §11.4 item 4b). The actor is needed for EO-2's "accountable person" evidence.
- **D-8 Secret format.** The svix constructor accepts loosely formed base64 (for example `whsec_` plus 17 characters). The wrapper therefore first requires `^whsec_[A-Za-z0-9+/]{16,}={0,2}$`. A malformed current **or previous** secret fails closed with 503 for every request.
- **D-9 Header whitespace (deviation from the S-2 wording).** The Web `Headers` API strips surrounding whitespace, so a `" 123"` timestamp reaches the route as `"123"`. It passes the strict format, and the verifier's fixed check then rejects it: 400, no receipt. An internal space (`"12 3"`) is refused by the bounds (400, body unread).
- **D-10 S-2a 1,024-byte header.** With at most 8 entries of at most 128 bytes, a 1,024-byte header cannot also hold a matching `v1` entry (47 bytes): 7 × 128 + 47 + 7 = 950. The 1,024-byte boundary is therefore proven as "passes the bounds and reaches verification". The matching-entry-last case uses 8 entries, one of exactly 128 bytes. A 1,025-byte header is refused before verification.
- **D-11 Failure mapping.** An RPC error classified `db_unavailable`, `network_error` or `config_missing` gives 503; any other gives 500. Neither is a 2xx. A receipt deleted between conflict detection and the row lock raises 40001, which gives 500, and the provider retries.
- **D-12 Tag parsing.** Tags may arrive as an object map or as `[{name, value}]`. Any key starting `mm_` makes the set present. A set is valid only as exactly `mm_ledger`, `mm_ref` and `mm_attempt`, each once. `mm_ref` must be a lowercase canonical UUID and `mm_attempt` a decimal 1–10,000 with no leading zero. Everything else is invalid and nothing is stored. Other tags are ignored.
- **D-13 Bounce strings.** `Permanent`, `Transient`, `Temporary` (mapped to transient) and `Undetermined`, case-insensitive; other strings become `other`. Subtypes map case- and punctuation-insensitively; `OnAccountSuppressionList` maps to `suppressed`. Exact provider strings are a 7.3D synthetic check (plan §4.1).
- **D-14 Method handling.** Next.js would auto-answer `OPTIONS` (and `HEAD`, where `GET` exists), so every non-POST method is exported explicitly, returning 405 with `Allow: POST`.
- **D-15 Service client after authentication.** The route builds the Supabase client only inside `receive`, so a dormant or rejected request never touches the database or its configuration.

## 4. Clarification: permanent stored conflicts versus derived read-time conflicts (Codex clearance)

The plan uses "conflict" for two different things. This slice keeps them apart and claims stickiness only where a durable record exists.

1. **Stored, receipt-time conflicts are permanent.** These are `conflict_disagree`, `conflict_id_ambiguous`, `conflict_tag_invalid` and `id_missing` (`identity_class`), and the `content_conflict` flag. They are written once, in the receive transaction. The guard trigger (D-4) rejects any later change to `identity_class`, and any clearing of `content_conflict`, even by the table owner. SQL 121 §6 tests both. A receipt stored as a conflict therefore stays untrusted for its whole stored life. It is never linked, so it does not cascade, and it ends only at its own expiry. A retry or a replay cannot rewrite it (D-2).
2. **A derived, read-time conflict (`id_conflict`, plan §7.3) is not implemented here and is not durable.** No read path exists in 7.3B, and nothing on the read side writes. `private.email_provider_id_candidate` is the function a 7.3C recheck would use. It reads the **current** ledger snapshot only. So the condition behind a derived conflict can disappear: for example, when the conflicting source row is deleted and its ledger row cascades away. Plan S-57's "never restored to trusted" therefore **cannot** hold for a derived conflict without a durable record. 7.3B does not claim it. SQL 121 shows the receipt-time half only: the stored receipt is unchanged when another row later records its ID, and the candidate a reader would use changes.
3. **What 7.3C must decide (for Codex).** One of:
   - (a) **durable conflict quarantine**: a recorded, monotonic conflict written at a defined write point, explicitly implemented and tested, with no hidden read-side mutation; or
   - (b) **current-snapshot exclusion**, worded accurately: a receipt is excluded while a conflicting row exists, and may become trusted again if that row is deleted. The deletion case must be stated and tested.

## 5. Verification (local, synthetic, isolated Phase 5 stack)

### 5.1 Dependency review (EC-2; follows PHASE-5-DEPENDENCY-SECURITY)

| Package | Version (lockfile) | Published | License | Integrity (registry tarball) | Install script |
|---|---|---|---|---|---|
| `svix` | **2.9.1**, exact in `package.json` | 2026-10-26 | MIT | `sha512-qeIouYbC…R+UDA==` | none |
| `standardwebhooks` | 1.1.1 (svix range `^1.1.1`) | 2026-08-28 | MIT | `sha512-bCbX9ZEy…+vQGnQ==` | none |
| `fast-sha256` | 1.3.0 | 2020-01-16 | Unlicense | `sha512-n11RGP/l…UabnpPQ==` | none |
| `@stablelib/base64` | 1.0.1 | 2021-05-21 | MIT | `sha512-1bnPQqSx…jBOSQ==` | none |

- **Version choice.** `svix` 2.10.0 (2026-11-09) is still under two weeks old on 2026-11-16, so 2.9.1 remains the newest eligible version.
- **Registry checks.** `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities. `npm audit signatures`: all 669 packages have verified registry signatures, and `svix` and `standardwebhooks` also carry provenance attestations.
- **Source inspection.** The resolved `svix` `Webhook.verify` maps the `svix-*` headers and calls `standardwebhooks` `verify(…, { jsonParse: false })`, returning `undefined`. The tolerance is the fixed `5 * 60`. Comparison is a length check followed by a constant-time XOR loop. The runtime files of the four packages contain no network, process or `eval` use.
- **Scope.** The full `svix` API client is installed. Only `Webhook` and `WebhookVerificationError` are imported, server-only.
- **Not certification.** The executable tests below cover the resolved exports, error class and return value. No handwritten cryptography exists.

### 5.2 Database

| Check | Result |
|---|---|
| SQL 121 alone | **196/196** |
| Full SQL suite, clean replay | **112 files / 7,809 tests PASS** (previously 111 / 7,613; +196) |
| Cases in SQL 121 | Shape, RLS and owner-only grants; exact column list. Function privileges: receive is service-role only, purge authenticated and operator-guarded; anon, homeowner, vendor and service-role refusals (S-27). Candidate across three ledgers. S-31, S-32, S-52–S-56; `id_missing`, `other`, `invalid_payload`. Argument validation. Ledger digest unchanged by every receipt. Duplicates across slots; S-22 single-session; S-23 injected flag failure; replay with and without malformed tags. S-57 receipt-time half; S-59 (10-day duplicate, conflict update, direct update rejected, conflict permanent, identity permanent); S-62 (12 violating inserts). S-33 for a contact submission, a vendor application and a price draft (conflicted receipts remain); S-58 serial half. S-34 boundary, replay after expiry; S-35; S-36 (0, negative, null, 1,001; over-cap count; oldest remaining; audit rows); S-60. Unchanged surfaces (§5.4) |
| SQL mutations (11) | Each caught. Expiry guard removed (S-59). Invalid tag falls back to ID (run aborts on the FK). Disagreement linked to tag (6). Ambiguity resolved (run aborts on a coherence check). Purge unordered (2; fixtures are inserted in shuffled order so heap order cannot pass by chance). Purge unbounded (6). Conflict flag not set (3). Single retention (1). Purge not clamped (run aborts on the audit check). Purge without operator guard (2). Duplicate compares slot (3) |

### 5.3 Concurrency and migration lock tests (real database, separate psql sessions)

| Script | Result |
|---|---|
| `email-provider-events-migration-lock.mjs` | For each of the three ledgers, an open ROW EXCLUSIVE holder makes the exact migration file, applied as one transaction, **abort with 55P03 after ≈2.2 s** at `create table private.email_provider_events` (the FK step takes SHARE ROW EXCLUSIVE on the ledgers). Nothing is left behind. At the ledger-index statements `lock_timeout = 2s` and `statement_timeout = 5s` are in force. Afterwards both read `0`. The uncontended apply takes **224 ms** including psql transport. Mutation: without `set lock_timeout` the migration waits and applies under contention, and the script fails |
| `email-provider-events-concurrency.mjs` | **S-21:** 8 identical deliveries give 1 recorded and 7 duplicates, 1 row. **S-22:** 5 rounds × 8 deliveries with 2 contents: 1 row with the first committed content, flag set, each other caller a duplicate or conflict by content. **S-58:** forced delete-first gives the FK failure (5xx) and then an unlinked `conflict_tag_invalid` retry. Forced receipt-first commits linked and is then cascade-deleted. In 20 free races all three outcomes occurred. Never a linked receipt to a missing row, never a stored receipt after a failure. **S-61:** two receives and an operator purge, each holding its locks 1.5 s under a 1 s lock timeout, never wait. The operator purge deleted 400 and the receives 200, with 0 expired left, over 3 rounds. Mutation: removing `skip locked` makes S-61 fail with a lock timeout |
| Existing ledger scripts on the same stack | `application-notification-concurrency`, `owner-email-concurrency` and `pricing-concurrency` PASS |

### 5.4 Unchanged definitions (local; before and after the migration)

| Surface | Value |
|---|---|
| Money fingerprint (`scripts/promotion-money-fingerprint.sql`) | `58 \| af0fae6e0c5b604e9073e10bc060957e` |
| Application ledger functions | `10 \| 5f14532aa26ed5400e73e210379aa4f8` |
| 7.2C-1 owner-email functions | `12 \| 016c0e683cb19c4c68769d87f5215ff1` |
| `vendor_submit_renewal_document` | `8c8942365d8f9d34bdcd1d839f86c472` |
| 7.2C-2 renewal trigger function | `b1607618f1af59ca19d9c6e5d0d410f5` |
| Price-draft email functions (4) | `4 \| fddc8bb9fc830932a830db9d6db9c811` |
| Three ledger tables: columns / own constraints / non-internal triggers / grants | `0e06a9c7…` / `a0a3cc86…` / none / owner-only, all unchanged. The new FKs are on the receipt table; Postgres adds only internal RI triggers to the ledgers |

### 5.5 Application

| Check | Result |
|---|---|
| `tests/unit/resend-webhook.test.ts` | **83/83**. S-1 (none, malformed ×4, previous malformed, constructor throws), S-2 (13 bounds + non-ASCII + D-9), S-2a, S-3–S-7, S-8, S-8a–S-8f, S-9, S-10 (every body accessor throws), S-11–S-18, S-19, S-20, S-24, S-26, S-28, S-29, S-30 (handler and route exports, dormant POST through the real route), EC-8, normalization, tags, bounces, v2 16-key shape and levels, and a contract test that the RPC arguments equal the migration's parameter list and that the migration's timeout ordering holds |
| Unit mutations (8) | Each caught: default BOM handling (3), previous secret tried on any verification error (2), other verifier exception mapped to 400 (1), no re-encode check (2), no `reader.cancel()` (6), `request.text()` (49), parse before verify (8), body read before the configuration gate (71) |
| EC-8 measurement | The largest synthetic payload (75 tags of 256-byte values, 50 recipients, a 998-character subject, 4,000-byte bounce text) is **31,108 bytes**, a margin of 34,428 bytes (52.5%) under 65,536 |
| Full unit suite | **67 files / 973 tests** (previously 66 / 890). An ignored local `.phase5-local/wt` worktree copy has to be excluded when running locally; CI has no such directory |
| Lint, typecheck, secret scan, `git diff --check` | Pass |
| `npm run audit:prod` | 0 vulnerabilities |
| `npm run build` | Pass; `ƒ /api/webhooks/resend` (dynamic) |

### 5.6 CI

| Run | Result |
|---|---|
| Main merge `bc51c3d`, run 43883598183 | Recorded in the PR body and handoff when complete |
| Exact-head PR CI | Recorded in the PR body and handoff |

### 5.7 Acceptance criteria (plan §13.2)

| # | Criterion | Evidence |
|---|---|---|
| 1 | Dormant without the secret: 503, no body read, nothing stored | S-1, S-30 (real route) |
| 2 | Every §14 7.3B case passes with local secrets and synthetic payloads | §5.2, §5.3, §5.5. Deviations D-9 and D-10. S-57 receipt-time half only (§4) |
| 3 | One receipt per `svix-id` under concurrency, including differing payloads | S-21, S-22 |
| 4 | No 2xx before commit | The handler answers 200 only after the RPC returns; S-23, S-24; concurrency results come after commit |
| 5 | Expiry, cascade and purge enforced, with no stronger guarantee than §11.4 | S-33–S-36, S-59–S-61. **No per-row physical deadline is claimed** (S-60) |
| 5a | The exact received bytes, including a BOM, are what is verified | S-8a–S-8f |
| 5b | Independent identity across three ledgers; conflicts never linked or trusted | S-31, S-32, S-52–S-58 |
| 6 | No PII retained or logged | Exact column list; S-28, S-29; D-6 |
| 7 | v1 unchanged; v2 16 keys | Unit suite (existing v1/v2 tests and new ones) |
| 8 | Existing definitions unchanged | §5.4 |
| 9 | Dependency review recorded | §5.1 |
| 10 | Full checks and exact-head CI | §5.2–§5.6 |

## 6. Privacy

- Stored per receipt: `svix_id`, times, `secret_slot`, processing, event type, provider type, email ID, bounce category, the three validated tags, one FK, the linked attempt, class and conflict flag. There is no address, subject, Message-ID, bounce text, header, link, IP, user agent or body. SQL 121 asserts the exact column list.
- Logs carry only enumerated event, outcome and code values with a correlation ID. They never carry the secret, signature, slot, `svix-id`, email ID, tags, event type, recipient or body (S-29).
- Responses are fixed bodies: `{"received":true}` or `{"error":…}`.

## 7. Rollout and rollback

**Pre-merge hosted push (separate owner authorization; DEC-2026-037; not done here):**
1. Codex implementation review of this PR and green exact-head CI.
2. **Immediately before the push:** run `scripts/email-provider-events-preflight.sql` (read-only). Proceed only if:
   - the 7.3B objects are absent;
   - each ledger is still a few rows and pages (2026-11-16 baseline: 20 rows / 8,192 heap bytes; 0 / 0; 0 / 0);
   - no lock is held or awaited on any ledger;
   - no transaction has been open more than a few seconds.
3. `supabase db push --linked --dry-run` must list only `20261124001000`. Then `supabase db push --linked`, at a quiet time. While the migration runs, writes to the three ledgers (sender claims and records) wait for its commit; locally that took ≈0.2 s. If it waits for a lock, writers queue behind it for up to the 2 s timeout.
4. **On a 55P03 lock timeout or 57014 statement timeout:** the CLI applies the file and its history row as one implicit transaction, so the push aborts cleanly with nothing applied. **Do not retry in a loop or remove the timeouts.** Return to Codex with a nontransactional rollout. The proposal would be: the receipt objects in one migration; the three ledger indexes built with `CREATE INDEX CONCURRENTLY`. That statement cannot run inside a transaction, including the CLI's per-file implicit one, so each would be run as a separately authorized statement outside `db push`, with its own timeout and an `indisvalid` readback (a failed concurrent build leaves an invalid index to drop). The same applies if volume, contention or the measured build time differs materially from the baseline.
5. Read-only readback:
   - the migration head;
   - objects, indexes (non-unique, valid), grants (receive: `service_role` only; purge: `authenticated`);
   - `email_evidence_config` empty and 0 receipts;
   - the §5.4 hashes and the money fingerprint unchanged.
6. Merge, then deploy. After the deploy, `POST /api/webhooks/resend` answers **503** because no secret exists. A read-only probe can confirm this; it is not run here.

**Rollback:** promote the previous deployment (`vercel promote <dpl_id>`). The database objects stay, unused (additive; nothing calls them without the secret). Fix forward.

**Arming (7.3D) is not part of this rollout.** It requires 7.3C deployed (tags on every ledger send), EO-1/EO-2/EO-3/EO-6/EO-7, an EO-2 retention decision implemented (D-5) and tested, and the §12 controlled acceptance.

## 8. Unresolved items and decisions needed

- **Codex:** review D-1–D-15, the §4 clarification and the 7.3C choice it leaves open, and the S-2/S-2a deviations (D-9, D-10).
- **Owner (all unapproved):**
  - EO-1..EO-8. In particular, EO-2 (intervals, P-1/P-2 and D, the accountable purge mechanism) is still a proposal: P-2 with 14 days and a weekly operator purge.
  - No production receipt collection until retention policy and mechanism and the other activation decisions are approved and tested.
- **To prove before arming (7.3D):**
  - real `svix-id` and email-ID shapes;
  - exact bounce strings;
  - re-signing of late retries and replays under the fixed ±300 s check (EC-3);
  - payloads of `suppressed`, `failed` and `delivery_delayed`;
  - rotation rehearsal.
- **Carried (unchanged):**
  - #167 retrospective Codex review, deployment READY readback, post-deploy renewal-window reconciliation and its stale status line;
  - CFG-011;
  - A2 human verification;
  - retrospective 7.2B review;
  - real-email verification for 7.2C-1/7.2C-2;
  - final booking-readiness checks;
  - the intermittent `request.spec.ts:837` accessibility failure;
  - gates `offer_terms` and promotions off;
  - no payments, booking, Cron, retries, reminders or suppression.
- **Out of scope by instruction:** mock booking.
