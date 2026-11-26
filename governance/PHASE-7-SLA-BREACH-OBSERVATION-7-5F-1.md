# Phase 7.5F-1 — SLA-breach observation: database foundation (TRACE-159)

**Status:** **IMPLEMENTED FOR REVIEW.** Migration **pushed to hosted Supabase 2026-11-26 ET** on the owner's instruction (§6.1). Not merged, not deployed, never run on production data. 7.5F-2 (operator page) not started.
**Update (2026-11-26 ET):** #208 merged as `89973fa` (15:59:55 UTC); deployment READY not verified. Codex finding **F208-1** (replay racing the purge could return an incomplete `visible` result) has a forward repair for review, migration `20261204001000`, not pushed (§8).
**Date:** 2026-11-25 (America/New_York).
**Base:** `main` `80100d3` (#207 merge, the 7.5F plan), fetched before work. Branch `claude/phase7-5f1-sla-db-foundation`.
**Authority:** owner approval 2026-11-25 ET ([DEC-2026-069](DECISION-LOG.md); verbatim in [OWNER-APPROVALS](OWNER-APPROVALS.md)); [7.5F plan](PHASE-7-SLA-BREACH-OBSERVATION-PLAN-7-5F.md) revision 4 with Codex's D-1..D-9 and F-1..F-10; [operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) §4, §6.1, §9, §10; CFG-010, CFG-011, CFG-015; DEC-2026-006.

## What this slice does not do

- No hosted query, migration push, merge, deployment, production scan or purge (plan §10.2 B–E stay unauthorized).
- No scheduler, notification, alert, email, booking, payment or offer change. The detector writes only the 7.5F tables.
- No page, client code or navigation (7.5F-2). No new threshold; no backfill (P-5); no cadence (P-6); no first-reply lateness report (P-4).
- Not Phase 7 acceptance. An observation is not an alert: HQ-5 and HQ-6 stay open.

## 1. Owner decisions applied

| Item | Decision (DEC-2026-069) | Where |
|---|---|---|
| OD-1 | T-3 (`proposal_missing`, `proposal_review`, `quote_decision`), T-4 (`payment_failed`), T-5 (`confirmation_overdue`), T-8 (first reply), T-10 (`unanswered`) | `private.operations_sla_rules()`, `private.operations_sla_rule_items(text)`, the observation kind check |
| OD-2 | Manual operator scans only | No scheduler, cron or `service_role` grant; execute for `authenticated` only |
| P-1 | Disputes and dispute appeals once under T-8 | T-8 reads every `overdue` ticket of the support queue; `subject_kind` holds the ticket kind |
| P-2 | Operational records, 90-day logical retention, manual purge | `private.operations_sla_retention` row `90 days` with its decision reference; read-time expiry; `admin_purge_sla_records` |
| P-3 / P-7 | Any authenticated admin may scan / purge | `public.has_role(auth.uid(), 'admin')` on every call |
| P-4, P-5, P-6 | Deferred; none; none | Nothing built |

## 2. What was built

| File | Content |
|---|---|
| `supabase/migrations/20261203001000_phase7_sla_breach_observations.sql` | Five `private` tables (run starts, observations, run results, retention, purge log), append-only guard trigger, retention helpers, key helpers, the detector, four readbacks, the purge, grants. Additive: no existing object altered |
| `supabase/tests/131_sla_breach_observations.sql` | Single-session groups A, B, T, M, N, Q, P, F, S, E, R, Z (§5.2) |
| `scripts/sla-detector-concurrency.mjs` | Multi-session groups K, U, F, R, L and the READ COMMITTED refusals (§5.3) |
| `.github/workflows/ci.yml` | One `backend` step after the existing concurrency steps, before the clean reset: `Concurrent SLA detector run keys, scans and purges (TRACE-159)` |

Database objects (all `search_path = ''`):

| Object | Kind | Access |
|---|---|---|
| `private.operations_sla_detector_runs`, `…_observations`, `…_detector_run_results`, `…_retention`, `…_purges` | tables, RLS on, no policies | owner only |
| `private.operations_sla_guard()` | trigger: UPDATE always refused; DELETE only inside the purge, of an expired row, a run start only after its result | owner only |
| `private.operations_sla_cutoff()`, `private.operations_sla_expired(timestamptz)` | read-time expiry | owner only |
| `private.operations_sla_key_issued_at(uuid)` | issue time of a version-7 key, else null | owner only |
| `private.operations_sla_rules()`, `private.operations_sla_rule_items(text)`, `private.operations_sla_run_json(…)` | rule set, per-rule reader call, shared run shape | owner only |
| `public.admin_sla_new_run_key()` | version-7 key on the database clock; writes nothing | authenticated (admin checked) |
| `public.admin_detect_sla_breaches(uuid, integer)` | the detector (plan §4.2 steps 1–8) | authenticated (admin checked) |
| `public.admin_sla_observations(text, bigint, integer)`, `public.admin_sla_detector_runs(integer)`, `public.admin_sla_detector_run(uuid)`, `public.admin_sla_observation_summary(timestamptz, timestamptz)` | readbacks, expired rows excluded | authenticated (admin checked) |
| `public.admin_purge_sla_records(integer)` | bounded three-phase purge | authenticated (admin checked) |

## 3. Conformance to the accepted directions

| ID | Direction | Implementation | Test |
|---|---|---|---|
| D-1 | Call the existing public readers; restate none | `operations_sla_rule_items` calls `admin_quote_queue`, `admin_fulfillment_queue`, `admin_support_queue(false)`, `admin_offer_terms_queue` as the invoking admin; reader definitions unchanged | B parity; Z definitions |
| D-2 | T-10 `due_at = since + 24 h` | `(since)::timestamptz + interval '24 hours'` | B T-10 boundaries |
| D-3 | T-4 from `admin_quote_queue` `aged` | `kind = 'payment_failed' and aged` | B T-4 (expiry and webhook sources) |
| D-4 | Different-key contention recorded `skipped`, after key serialization and replay checks | step 5 try-lock after steps 3–4 | K4 (script) |
| D-5 | Per-rule savepoints; cancellation aborts the attempt | `begin … exception when others` per rule; `57014` not caught | S partial/failed; U, L (script) |
| D-6 | First sighting while retained; re-recording after purge | anti-join on the episode key; M-10 | P; R M-10 |
| D-7 | `due_at` in the key; duplicates disclosed | unique `(rule_id, item_kind, subject_id, due_at)` | M-6 |
| D-8 | Superseded by F-5 | `evaluated_at` (run) and per-rule `observed_at` | T |
| D-9 | Database PR first | this PR; no page | — |
| F-1 | Serialize the key, then recheck replay, actor, normalized limit | `pg_advisory_xact_lock` on the key, then a new-statement lookup | K1–K3 (script), N |
| F-2 | FK order, non-deferrable, commit boundary | start → observations → result; plain FKs | F (SQL and script) |
| F-3 | Exclude recorded keys before the cap | `fresh` CTE before `order by … limit` | P |
| F-4 / F-7 | `not_visible` is unknown; `57014` settles only the attempt | lookup states `visible` / `expired` / `not_visible` + `retry_until`; never "failed" | U (script, held original and cancelled retry, both endings) |
| F-5 | Evaluation vs observation time; no coverage claim | `evaluated_at = now()`; `observed_at = clock_timestamp()` before the reader statement; summary has no coverage field | T |
| F-6 / F-8 | Read-time expiry; readback exclusion even when undeletable; bounded purge incl. its own log; refused while unset | cutoff function; every readback filters; three phases with `limit … for update skip locked`; `55000` while null | R |
| F-9 | 24 h key start window; 7-day floor; expired → `expired`; purged → too old | step 1 and 4 checks; retention check constraint | Q |
| F-10 | M-7 | first scan observes still-qualifying episodes, not ended ones | B M-7 |
| Codex clarifications | ≤ 4n physical rows, logical and physical counts; key timestamp not authorization | purge log columns and return; admin check on every call | R; Q, A |

## 4. Implementation decisions for Codex review

These are technical choices made while building; none is owner policy.

| ID | Choice | Reason |
|---|---|---|
| I-1 | T-8 `item_kind` is `first_reply_overdue`; a nullable `subject_kind` column holds the ticket's kind, required for T-8 and null otherwise. Not part of the episode key | P-1 asks for labelling by ticket kind; keeping it out of the key means a kind change cannot create a second episode |
| I-2 | `queue` values match `admin_operations_summary`: `quote`, `fulfillment`, `support`, `offer_terms` | One vocabulary for the page |
| I-3 | The purge log has an `outcome` (`complete` / `skipped`); a skipped purge logs zero deletions and null remaining counts | Plan §4.11 requires a logged skip but listed no column for it |
| I-4 | The purge clears its transaction-local permission after its deletions | Without it, later statements of the same transaction would pass the guard's first check |
| I-5 | Run-start deletion is guarded by "result already gone" and an expired `started_at` | The result row (deleted first, under its own expiry check) is no longer readable when the start is deleted |
| I-6 | Expiry cutoff = `now()` minus the retention as elapsed seconds | Independent of the session time zone (a 90-day calendar interval would shift by an hour across DST) |
| I-7 | Detector and lookup refuse a null, non-version-7 or wrong-variant key with `22023`; the lookup does not return `not_visible` for a key that could never scan | A key with no issue time has no retry lifetime to report |
| I-8 | The `REPEATABLE READ` / `SERIALIZABLE` refusals (`55000`) are tested in the script, not SQL 131 | Isolation cannot change inside the test transaction; plan §6 put case N in SQL |
| I-9 | `rules` is an ordered array (`T-3`, `T-4`, `T-5`, `T-8`, `T-10`); an errored rule has `sqlstate`, `observed_at` and null counts; a skipped run lists each rule as `skipped` | Stable order; no invented counts |
| I-10 | T-3 and T-4 each call `admin_quote_queue` (two reads per scan) | One read per rule keeps each rule's `observed_at` exact (§4.6); doubles that read's cost |
| I-11 | Summary window: runs by `evaluated_at`, observations by `observed_at`, `[from, to)`; one descriptive interval figure per rule (`descriptive_largest_interval_seconds`) | No coverage, completeness or miss-rate field (F-5) |
| I-12 | Purge returns `oldest_remaining_expired_at` = earliest expiry instant among expired rows still stored | Plan §4.11 "oldest remaining expiry" |
| I-13 | Runs readback names the actor from `profiles.full_name`, `Operator` when empty | Plan §4.3 "actor name" |
| I-14 | Test M-6 added (a moved `due_at` is a second row) | Needed to catch the "unique key without `due_at`" mutation |
| I-15 | Plan §6 U (unit) and P (page), and the mutations "`not_visible` mapped to failure" and "`57014` mapped to recorded nothing", belong to 7.5F-2 | No client code in this slice |

## 5. Evidence

### 5.1 Baseline and unchanged surfaces

Local isolated stack (`phase5-isolated`, PostgreSQL 17.6), clean replay. Query: the 7.5D record's Appendix A fingerprint, plus `scripts/promotion-money-fingerprint.sql`. "Base" is `main` `80100d3` (238 migrations); "7.5F-1" is this branch after a clean reset (239 migrations, latest `20261203001000`).

| Measure | Base | 7.5F-1 |
|---|---|---|
| Money (`scripts/promotion-money-fingerprint.sql`) | `61 \| eb3f9702d45f9f22e61f6a7da17349c4` | same |
| Functions in `public`/`private` (name, arguments, ACL, definition md5) | `849 \| f82a81e3dabe1400a6d589264388135a` | 863 in all; excluding the 14 new 7.5F functions: `849 \| f82a81e3…`, same |
| Relations / columns / triggers / indexes, excluding `operations_sla_%` | `211 \| 63cc227e…` / `2055 \| 3ba5e838…` / `222 \| 206fefe5…` / `506 \| 16ff8b73…` | same; added: 5 tables, 41 columns, 4 triggers, 10 indexes, all `operations_sla_%` |
| Policies | `154 \| f31814e7…` | same (the 7.5F tables have none) |
| `admin_quote_queue` / `admin_fulfillment_queue` / `admin_support_queue` / `admin_offer_terms_queue` | `b56a6dc0…` / `d3e94c1f…` / `c426ab1a…` / `6d3fa5f5…`, ACL `{postgres, service_role, authenticated}` | same |
| `admin_operations_summary` / `run_lifecycle_batch` | `3bc2497f…` / `82818770…` | same |
| `private.fulfillment_queue_items` / `private.money_payment_exceptions` | `d37abbd9…` / `c9a2e11a…`, owner only | same |

SQL 131 group Z also shows that a scan and a purge leave every other `public`/`private` table (row count and content md5), `net.http_request_queue` and `cron.job` unchanged, and that the reader, summary and batch definitions are unchanged inside the run.

### 5.2 SQL 131

`supabase/tests/131_sla_breach_observations.sql`: **175/175** through plain psql (CI's lifecycle runner) after a clean reset; one rolled-back transaction, fixed `now()`, staged times relative to it (7.5C method), synthetic `example.invalid` users. Real readers throughout; offer-terms items through the real submission, matching and acceptance commands (as SQL 116). Run keys are composed by the test.

| Group | What it proves |
|---|---|
| A | Execute for `authenticated` only on the seven client functions; private helpers owner only; five tables with RLS, no policy, no client privilege, in no publication; homeowner, provider and anon refused (`42501`); no direct select or delete even for an admin; retention row 90 days with its DEC-2026-069 reference |
| B | First scan on an empty ledger: per rule, absent at `due − 1 µs`, present at `due` (not T-8) and `due + 1 µs`; recorded `due_at` equals the named source (T-3 three kinds; T-4 expiry and first `checkout_expired` webhook; T-5 72 h mark; T-8 `response_due_at`, strict; T-10 acceptance + 24 h); observed set equals the qualifying set derived independently from each reader; P-1 disputes and appeals once under T-8 with their kind |
| T | `evaluated_at = now()` on every row; `due_at <= evaluated_at <= observed_at` (T-8 strict); each rule's `observed_at` later than `evaluated_at` and strictly increasing in rule order; the summary has no coverage, completeness or miss-rate field and states the lower bound |
| M | M-7: an episode overdue before the first scan and still qualifying is observed with its full lag; one that ended before it is not. M-1: due and resolved between scans: never recorded. M-3: T-10 reclassified to `not_acceptable` before a scan: never recorded. M-6 (D-7): a moved `due_at` is a second row. M-10: an expired, unpurged row still blocks; after the purge the episode is recorded again |
| N, Q | `null`/`200`, `0`/`1`, `999`/`500` replay; `100` vs `200` and another admin refused (`22023`), writing nothing. Non-admin with a valid fresh key `42501`; v4, null, wrong-variant, > 5 min ahead and absent > 24 h keys `22023`; ≤ 5 min ahead and within 24 h accepted. After the lifetime an unexpired run replays with content; at the 7-day floor a run committed in its key's lifetime replays at `retry_until`; an expired run returns `expired` with no content (actor and limit mismatches still refused); a purged key is refused as too old and the lookup is `not_visible` with `retry_until` in the past |
| P | Limit 1: with an earlier episode already recorded, runs insert p1, p2, p3 oldest first, then nothing; `already_recorded` 0, 1, 2, 3; invariant on every run and rule |
| F | No deferrable constraint; both foreign keys reference the run start; `set constraints all immediate` succeeds; every start has its result; observations copy their run's `evaluated_at` |
| S | One rule raising: `partial`, SQLSTATE only (no message), its inserts rolled back, the others recorded; every rule raising: `failed`; summary counts equal the ledger; totals are the sum of ok rules; readback order, keyset, rule filter, lag and actor name; bad window and unknown rule refused |
| E | The DEC-2026-006 batch's output, flag, events, notices and run records are identical with and without a prior scan; T-5 is observed either way |
| R | Retention null: nothing expires, the purge refuses (`55000`) and writes nothing; below 7 days refused by the check. UPDATE refused on all four tables; DELETE refused outside the purge, of an unexpired row even with the purge setting, and of a run start before its result. Expired rows (including a run still referenced by expired observations) hidden from every readback, the lookup and the summary. Purge at limit 2 with more than 2 eligible per class: exactly 2 observations, 2 runs, 2 purge-log rows, oldest first; physical 2 + 2 + 2 + 2 = 4n; log row and return match the table changes; a referenced run stays; repeated purges drain every class; never its own log row; remaining count capped at 10,000 with `over_cap` |
| Z | A scan and a purge change no other `public`/`private` table, HTTP request or cron job; reader, summary and batch definitions unchanged |

### 5.3 Concurrency script

`node scripts/sla-detector-concurrency.mjs` after a clean reset: **pass** (45.7 s locally). Four persistent psql sessions; real commits.

| Group | Result |
|---|---|
| READ COMMITTED | Detector and purge refuse `REPEATABLE READ` and `SERIALIZABLE` with `55000` (I-8) |
| K1 ×20 | Same key, same actor, overlapping: the second waits on the key lock, then replays the first's stored result; one start, one result |
| K2 ×20 | Same key, another admin: `22023` after the first commits; nothing written |
| K3 ×20 | First rolls back while the second waits: the second runs and owns the key; one run |
| K4 ×20 | Different keys: one `complete`, one `skipped` at once (no wait); the skipped call commits a start and result and no observation; no duplicate episode |
| U ×20 | Lookup `not_visible` while the original is held. Held original, cancelled retry (`statement_timeout` 300 ms on the key lock → `57014`): original commits → lookup `visible` with its result, next retry replays; original rolls back → lookup `not_visible` with `retry_until` ahead, next retry runs and owns the key; one start and one result either way |
| F | An uncommitted scan is invisible to another session; a rolled-back one leaves no start, result or observation; every committed run has exactly one result; each run's `inserted` equals its rows |
| R | Purge during a scan → logged `skipped`; scan during a purge → `skipped`; two concurrent purges → one `complete`, one `skipped`, every expired row deleted once |
| L | 5,008-item T-5 queue: `statement_timeout` 50 ms → `57014`, nothing written; normal timeout → `complete`, T-5 inserted exactly 500 (the cap), the rest `over_limit` (that scan took 4.0 s locally under load) |

The first version of the script (one process per statement) also passed every group in 20 min 53 s; it was rewritten to persistent sessions for CI time, with no assertion changed.

### 5.4 Mutations

Each mutant is the migration with one literal edit, dropped and re-applied whole; the original is restored after each. SQL mutants against SQL 131 (`ok`/`not ok` counts, or an aborting error, from the run); script mutants against the concurrency script. Unmutated control: 175/175 and the script passes.

| Mutation (plan §6 list, plus I-4) | Result | SQL 131 |
|---|---|---|
| actor check removed (K2/N) | caught | `ok=172 notok=3` |
| limit not normalized (N) | caught | `ok=54 notok=0` |
| limit not compared (N) | caught | `ok=172 notok=3` |
| deferrable foreign key (F) | caught | `ok=174 notok=1` |
| anti-join removed (P, F-3) | caught | `ok=170 notok=5` |
| observed_at := evaluated_at (T, F-5) | caught | `ok=172 notok=3` |
| expiry filter removed from observations readback (R) | caught | `ok=174 notok=1` |
| expiry filter removed from runs readback (R) | caught | `ok=174 notok=1` |
| expiry filter removed from summary (R) | caught | `ok=174 notok=1` |
| run expiry waits for unreferenced status (R, F-8) | caught | `ok=174 notok=1` |
| purge-log rows never deleted (R) | caught | `ok=167 notok=8` |
| observation phase not limited (R) | caught | `ok=170 notok=5` |
| run phase not limited (R) | caught | `ok=170 notok=5` |
| physical run rows reported as logical runs (R) | caught | `ok=173 notok=2` |
| purge allowed while retention is null (R) | caught | `ok=173 notok=2` |
| guard allows deleting an unexpired row (R) | caught | `ok=165 notok=10` |
| purge permission not cleared (I-4) | caught | `ok=172 notok=3` |
| key age check removed (Q, F-9) | caught | `ok=169 notok=6` |
| expired run replayed with content (Q) | caught | `ok=174 notok=1` |
| retention floor removed (R/Q) | caught | `ok=174 notok=1` |
| future-key bound removed (Q) | caught | `ok=173 notok=2` |
| T-8 at due (<=) instead of the reader’s overdue (B) | caught | `ok=162 notok=13` |
| T-10 without + 24 h (B, D-2) | caught | `ok=173 notok=2` |
| T-3 without aged (B) | **survived (equivalent)** | `ok=175 notok=0` |
| T-4 without aged (B, D-3) | caught | `ok=163 notok=12` |
| unique key without due_at (M-6, D-7) | caught | `ok=173 notok=2` |
| savepoint removed (S, D-5) | caught | `ok=84 notok=0` |
| detector writes a notification (Z) | caught | `ok=174 notok=1` |
| service_role granted (A, OD-2) | caught | `ok=174 notok=1` |
| error message stored instead of SQLSTATE (S) | caught | `ok=172 notok=3` |
| admin check removed: purge (A) | caught | `ok=173 notok=2` |
| admin check removed: readback (A) | caught | `ok=174 notok=1` |

| Script mutation | Result | First failing assertion |
|---|---|---|
| Key lock removed (K1/K2) | caught | "a same-key call waits on the key lock" |
| Key lock taken after the lookup (K1/K2) | caught | the waiting call gets `23505` instead of a replay |
| Purge without the shared scan lock (R) | caught | "R: a purge during a scan is skipped" |
| Detector without the scan lock (K4, D-4) | caught | "K4: the concurrent scan with another key is skipped" |

**Equivalent mutant:** removing `aged` from T-3 changes nothing, because `admin_quote_queue` lists `proposal_missing`, `proposal_review` and `quote_decision` only once due, so `aged` is always true for them. The filter stays as a statement of the rule. The T-4 counterpart is caught (`payment_failed` is listed before it ages).

**Not applicable to 7.5F-1 (I-15):** "`not_visible` mapped to failure" and "`57014` mapped to recorded nothing without a lookup" are client mappings in 7.5F-2. "Result inserted before the start" cannot be expressed with the non-deferrable foreign key (the insert fails); the deferrable-key mutation covers F-2.

### 5.5 Repository checks and CI

| Check | Result |
|---|---|
| Clean replay (`sh scripts/phase5-db.sh reset`) | 239 migrations, latest `20261203001000`. One earlier attempt was reported failed by the CLI after every migration applied (the storage container's health check timed out at host load ≈ 50, unrelated); the retry is the evidence |
| Full SQL suite (`sh scripts/phase5-db.sh test`) | in the PR body (final local run) |
| SQL 131 through plain psql | 175/175 |
| Concurrency script on a clean reset | pass (§5.3) |
| `npm run typecheck` | pass |
| `npx eslint scripts/sla-detector-concurrency.mjs` | pass, no warnings (two unused-name warnings fixed) |
| `npm run scan:secrets` | pass |
| `git diff --check` | pass |
| Unit tests, full lint, production build | not run locally: no application, page or client code changed in this slice; CI runs them |
| Final-head CI | PR body |

Numbering rechecked on `main` `80100d3` before work: latest migration `20261202001000`, latest SQL test `130`; no open PR adds a migration or SQL test.

## 6. Rollout and rollback

Each step needs its own owner authorization (plan §10.2). None is done.

**Rollout (B, C, then D and E's purge later):**

1. **Hosted dry run (B):** `npx supabase db push --linked --dry-run`. Expected: exactly one pending migration, `20261203001000_phase7_sla_breach_observations.sql`. Stop if anything else is listed.
2. **Hosted push (B), before merge (DEC-2026-037):** `npx supabase db push --linked`.
3. **Read-only hosted readback** (`npx supabase db query --linked`): `select max(version) from supabase_migrations.schema_migrations` = `20261203001000`; the five tables exist and are empty; `select retention, decision_ref from private.operations_sla_retention` = `90 days`, DEC-2026-069; `has_function_privilege` for `anon` / `service_role` false and `authenticated` true on the seven client functions; definition md5s of `admin_quote_queue`, `admin_fulfillment_queue`, `admin_support_queue`, `admin_offer_terms_queue`, `admin_operations_summary`, `run_lifecycle_batch` equal §5.1; `scripts/promotion-money-fingerprint.sql` = `61 | eb3f9702d45f9f22e61f6a7da17349c4`.
4. **Release (C):** merge the reviewed PR; Vercel deploys `main` (no client calls the new functions). Read back deployment READY.
5. 7.5F-2 (page) is a separate PR. **First hosted scan (D)** and **first hosted purge** are separate owner actions; retention is already set, so production never holds observations under an undecided value.

**Rollback (forward only):**

- Before any hosted scan: a reviewed migration may drop the 7.5F objects (the tables are empty; nothing else references them).
- After hosted scans: a reviewed migration revoking `execute` on `admin_detect_sla_breaches` (and `admin_purge_sla_records`) from `authenticated` stops new scans and keeps the records; dropping retained rows needs an owner decision.
- Application: `vercel promote <previous dpl_id>`; the database objects are inert without a caller. No business data is written, so nothing needs repair.

### 6.1 Hosted push (2026-11-26 ET)

Owner instruction (2026-11-26 ET): "Please push migration and agents MD." This authorizes step B (dry run and push) only. Merge, deployment, scans and purges remain unauthorized.

| Step | Time (UTC) | Result |
|---|---|---|
| `npx supabase db push --linked --dry-run` (CLI 2.116.0) | 2026-11-26 13:14 | Would push exactly `20261203001000_phase7_sla_breach_observations.sql`. This also shows `20261202001000` (7.5D) was already on hosted, which settles the open point in the 7.5D record |
| `npx supabase db push --linked` | 13:14:20–13:14:37 | `Applying migration 20261203001000_phase7_sla_breach_observations.sql`; finished |
| Readback: migrations | after push | latest `20261203001000`, 239 rows |
| Readback: 7.5F tables | after push | runs, observations, results and purges all 0; retention `90 days`, DEC-2026-069 reference |
| Readback: access | after push | the 7 client functions are executable by `authenticated` (7 of 7) and by `anon`/`service_role` 0 of 7; the 5 tables have RLS on and no `authenticated`/`service_role` select |
| Readback: unchanged definitions | after push | `admin_quote_queue` `b56a6dc0…`, `admin_fulfillment_queue` `d3e94c1f…`, `admin_support_queue` `c426ab1a…`, `admin_offer_terms_queue` `6d3fa5f5…`, `admin_operations_summary` `3bc2497f…`, `run_lifecycle_batch` `82818770…`, `fulfillment_queue_items` `d37abbd9…`, `money_payment_exceptions` `c9a2e11a…`, all equal to §5.1 |
| Readback: money fingerprint | after push | `61 \| eb3f9702d45f9f22e61f6a7da17349c4`, equal to §5.1 |

Readback queries read schema, privileges and counts only, never row content. Production now has the objects. With no client calling them they stay inert until the merge and 7.5F-2.

## 7. Open items

- Codex review of this PR (I-1..I-15, §3). #208 merged 2026-11-26 ET; F208-1 repair under review (§8).
- Owner authorizations C (merge; done for #208), D (first hosted scan), first hosted purge. B (dry run and push) done 2026-11-26 ET (§6.1). The repair's push is a separate authorization (§8.6).
- 7.5F-2 operator page after this merges.
- Carried unchanged: HQ-1..HQ-6 (HQ-5 open until a hosted staged breach is observed under its own authorization); OD-3..OD-7; OD-5 external channel; AC-1 D-1, D-4..D-6; SD-1, SD-2; 7.5D F-1, O-1..O-3; #203 Codex re-review; READY readbacks of `01a5dd1` and `846dd34`.

## 8. Forward repair F208-1 (2026-11-26 ET)

**Owner instruction (2026-11-26 ET):** implement a bounded forward repair for Codex's F208-1 before 7.5F-2; leave `20261203001000` unedited; no hosted query, migration push, merge, deployment, production scan or purge; do not build 7.5F-2. Branch `claude/phase7-5f1-replay-purge-repair` from `main` `89973fa`.

### 8.1 State verified before work

| Item | Evidence |
|---|---|
| #208 | merged as `89973fa` at 2026-11-26 15:59:55 UTC (`gh pr view 208`); `main` then also had `9351bb7` (#209, sitemap, unrelated) |
| `20261203001000` on hosted | §6.1 (pushed 13:14:20–13:14:37 UTC, readback matched). Not re-queried: no hosted query was made for this repair |
| Deployment of `89973fa` | not verified (DEC-2026-037 deploys `main`; no client calls the 7.5F functions) |
| Numbering | latest migration `20261203001000`, latest SQL test `131`; no open PR |

### 8.2 Defect

Step 4 of `admin_detect_sla_breaches` read the run start (`select * into v_run …`) and, in a second statement, its result. Under READ COMMITTED each statement takes its own snapshot. The retention purge deletes an expired result and its start in one transaction and takes no key lock, so its commit can fall between the two reads: the start is found, the result is not. The function then returned `state: 'visible'` because `operations_sla_expired(null)` is false. Observed on the merged function (local, synthetic, one start row 100 days old with no result):

```
{"state": "visible", "replayed": true, "outcome": null, "rules": null, "finished_at": null,
 "actor": "…", "rule_set": "synthetic", "started_at": "2026-08-18T…", "applied_limit": 200, "totals": {all 0}}
```

That is both an incomplete `visible` result and disclosure of an expired run's actor, rule set and times. The run itself was already purged, so no duplicate scan or orphan followed; a retry was refused as too old.

### 8.3 Repair

Migration `20261204001000_phase7_sla_replay_pair_read.sql`: `create or replace` of `admin_detect_sla_breaches(uuid, integer)` only. Its body is the merged body with step 4 changed (diff below); signature, owner, `security definer`, `search_path = ''`, ACL (CREATE OR REPLACE keeps it) and steps 1–3 and 5–8 are unchanged.

```diff
-  select * into v_run from private.operations_sla_detector_runs where id = p_run_key;
+  select r as run_row, x as result_row into v_pair
+    from private.operations_sla_detector_runs r
+    left join private.operations_sla_detector_run_results x on x.run_id = r.id
+   where r.id = p_run_key;
   if found then
+    v_run := v_pair.run_row;
+    v_res := v_pair.result_row;  -- all fields null when the start has no result
     (actor check, normalized-limit check: unchanged and still first)
-    select * into v_res from private.operations_sla_detector_run_results where run_id = p_run_key;
+    if v_res.run_id is null then
+      raise exception 'SLA run start found without its result' using errcode = 'XX000';
+    end if;
     (expiry → 'expired' with no content; else 'visible' replay: unchanged)
```

Outcomes of the single read:

| Pair as read | Result |
|---|---|
| start and result | as merged: actor and limit checks, then `expired` (content withheld) or `visible` replay |
| neither | as merged: the 24 h key window. A purged run's key is refused as too old (`22023`): its key was issued at most 5 min after its start, its result expired ≥ 7 days ago (retention floor), so the key is past the 24 h start window. No second scan |
| start, no result | **new:** `XX000`, after the actor and limit checks; nothing written. One statement cannot see this from a purge (start and result commit together and are purged together), so only a damaged ledger reaches it |

The key lock is still taken before the read and the scan try-lock after it, so a purge still never overlaps a scan and a replay still takes no scan lock. An `XX000` is an error, so a 7.5F-2 client treats it like any other: outcome unknown, resolve through the lookup.

**R-1 (for Codex):** `XX000` was chosen to match the purge's own consistency refusal (`SLA purge found a run without its start or result`). `55000` would also fit.

**O-1 (observation, not repaired, outside the bound):** `admin_sla_detector_run` (the lookup) also reads start and result in two statements. A purge committing between them yields `not_visible`, which its contract already includes ("the run may have been purged"); it can never return `visible` without a result, because it requires both rows. Unchanged here, as instructed.

### 8.4 Tests

| File | What |
|---|---|
| `supabase/tests/132_sla_replay_pair_read.sql` | 42 assertions, one rolled-back transaction. **C** contract: signature and default, security definer, volatile, empty search path, owner, execute for `authenticated` only, no PUBLIC, no overload, homeowner refused; the replay reads the pair in one statement (text check). **I** a start without its result (the race's state, made directly as owner): fresh key and 100-day-old key → `XX000`, nothing written, the key still holds only its start; another admin and limit 100 / 999 still refused first (`22023`); null limit normalizes to 200. **V** visible replay returns the stored run unchanged; null limit replays; mismatches refused. **E** expired → exactly `{run_key, state: expired, replayed}`; mismatches refused; unexpired after the key lifetime replays with content. **A** absent: 100-day key too old, future and v4 keys refused, nothing written; a 23-hour key scans. **P** after the real purge, a retry is too old and scans nothing; lookup `not_visible`; no result without start, no observation without result |
| `scripts/sla-replay-purge-concurrency.mjs` | Three persistent psql sessions, real commits, rerunnable (each round purges its own fixtures; refuses to start if other expired SLA rows exist). **W ×10:** the purge's transaction takes `ACCESS EXCLUSIVE` on `operations_sla_detector_run_results` (a test device; the purge is the real function); the replay is started; the script waits until `pg_locks` shows the replay holding its key lock and waiting on that table; the purge runs and commits; the replay resumes with a snapshot taken after the wait. Asserts: never `visible`, no content of the expired run, the replay is `22023` too old, the purge deleted exactly the round's run and observation, nothing remains under the key (no duplicate scan), no orphaned start, result or observation ledger-wide, a later retry is too old and starts nothing, lookup `not_visible`. **H ×10:** purge deleted but uncommitted → replay `expired`, content withheld, no wait; after commit, too old. **B ×3:** purge rolled back inside the window → replay `expired`; pair and observation remain. Baseline: an expired run replays as expired |
| `.github/workflows/ci.yml` | `backend` step `SLA detector replay racing the retention purge (TRACE-159, F208-1)` right after the existing SLA step (the earlier script's R group drains every expired row, so this one's precondition holds) |

### 8.5 Evidence

Local isolated stack (`phase5-isolated`), 2026-11-26 ET.

**Unrepaired vs repaired.** "Unrepaired" is a clean reset of `main` `89973fa` (239 migrations), detector md5 `e841593e…`, and later the same definition restored from `20261203001000` lines 260–377 as `create or replace` (md5 again `e841593e…`).

| Test | Unrepaired | Repaired |
|---|---|---|
| SQL 132 | 38/42; fails C one-statement read and I ×3 (each "have: ok": the function returned for a start without its result) | 42/42 |
| `sla-replay-purge-concurrency.mjs` | fails at W1: `W1: no 'visible' result for an expired or purged run (F208-1; got outcome null)` (baseline passed first) | pass, 1.6 s; rerun on the same database passes |

**Mutants of the repair** (one edit, applied, both tests run, repair re-applied; control passes both):

| Mutant | SQL 132 | Script |
|---|---|---|
| M1 repair reverted (the merged function) | 38/42 | fails W1 (incomplete `visible`) |
| M2 start-without-result refusal removed | 39/42 (I) | passes: unreachable from a purge in one statement |
| M3 refusal moved before the actor check | 41/42 ("another admin is refused as before") | passes (same reason) |
| M4 inner join instead of left join | 35/42 (C, I: falls through to a scan and a key conflict) | passes (same reason) |
| M5 two reads kept, null result refused with `XX000` | 41/42 (C text check only) | fails W1: `XX000` instead of too old |
| M6 expiry withholding removed | 41/42 (E) | fails at baseline: `visible` with content |

M2–M4 alter only the damaged-ledger branch, so SQL 132 is their test; M5 is caught behaviourally only by the script.

**Clean replay with the repair** (`node scripts/prepare-phase5-local.mjs`, `sh scripts/phase5-db.sh reset`): 240 migrations applied, latest `20261204001000`, seed applied; the CLI then reported `LegacyHealthCheckTimeoutError` for the storage container at host load ≈ 16 (as in §5.5); every container was healthy afterwards and `schema_migrations` held all 240.

| Measure (Appendix A query of the 7.5D record; money script) | Base (`89973fa`, 239) | Repaired (240) |
|---|---|---|
| Functions excluding `admin_detect_sla_breaches` | `862 \| 48815793e78595175daac17b34bd54bb` | same |
| Functions, all | `863 \| 0fe69d3d…` | `863 \| 01c8e87e…` (the detector only) |
| `admin_detect_sla_breaches` | `e841593e…`, `{postgres, authenticated}` | `8556973a…`, same ACL |
| Other 7.5F functions (13), the four readers, `admin_operations_summary`, `run_lifecycle_batch`, `fulfillment_queue_items`, `money_payment_exceptions` | §5.1 values (`admin_purge_sla_records` `94218dea…`, `admin_sla_detector_run` `1e6fdf53…`, …) | same, each md5 and ACL |
| Relations / columns / triggers / indexes / policies | `216 \| e47295e2…` / `2096 \| ba91a6e7…` / `226 \| 064d320b…` / `516 \| 69be4349…` / `154 \| f31814e7…` | same |
| Money (`scripts/promotion-money-fingerprint.sql`) | `61 \| eb3f9702d45f9f22e61f6a7da17349c4` | same |

| Check | Result |
|---|---|
| SQL 131 | 175/175 |
| SQL 132 | 42/42 |
| Full SQL suite (`sh scripts/phase5-db.sh test`) | 125 files, 9,191 tests, PASS (1,049 s at load ≈ 14) |
| `sla-detector-concurrency.mjs` then `sla-replay-purge-concurrency.mjs` (CI order) | both pass on the post-suite database (38.8 s; 6.9 s) |
| Fingerprints after the suite and scripts | identical to the repaired column above |
| `npx eslint scripts/sla-replay-purge-concurrency.mjs`; `npm run scan:secrets`; `git diff --check` | pass |
| Typecheck, unit, full lint, build, browser | not run locally: no application code changed; CI runs them |
| Final-head CI | PR body |

### 8.6 Rollout (each step needs the owner's authorization; none done)

1. **Dry run:** `npx supabase db push --linked --dry-run`. Expected: exactly `20261204001000_phase7_sla_replay_pair_read.sql`. Stop if anything else is listed.
2. **Push, before merge (DEC-2026-037):** `npx supabase db push --linked`.
3. **Read-only readback** (`npx supabase db query --linked`; schema and privileges only, no row content):
   - `select max(version) from supabase_migrations.schema_migrations` = `20261204001000`;
   - `select md5(pg_get_functiondef('public.admin_detect_sla_breaches(uuid,integer)'::regprocedure))` = `8556973a4224090772e873997320367a`;
   - `select proacl from pg_proc where oid = 'public.admin_detect_sla_breaches(uuid,integer)'::regprocedure` = `{postgres=X/postgres,authenticated=X/postgres}`; `has_function_privilege` false for `anon` and `service_role`;
   - md5s of `admin_purge_sla_records(integer)` `94218deabea843502cd99dcd3aa2aea7` and `admin_sla_detector_run(uuid)` `1e6fdf5357c837f55c9f5f4cd6924925`, the four readers, `admin_operations_summary`, `run_lifecycle_batch` equal §5.1 / §6.1;
   - `scripts/promotion-money-fingerprint.sql` = `61 | eb3f9702d45f9f22e61f6a7da17349c4`;
   - the five 7.5F tables still empty (counts only), retention `90 days`.
4. **Release:** merge the reviewed PR; Vercel deploys `main` (no application change). Read back deployment READY.

Order matters only weakly: until the push, hosted keeps the defect, but no client calls the detector (7.5F-2 is not built) and no hosted scan or purge has been authorized, so the window cannot occur on hosted. The push should still precede 7.5F-2's release and any first hosted scan or purge.

**Rollback:** forward only. A reviewed migration restoring the merged body would reintroduce F208-1; prefer a fix forward. `vercel promote <previous dpl_id>` is unaffected (no application change).

### 8.7 Open after the repair

- Codex review of this repair (R-1, O-1, the test device in §8.4).
- Owner authorizations: dry run and push of `20261204001000` (§8.6 steps 1–3), merge. First hosted scan and purge unchanged (§7).
- 7.5F-2 starts after this repair; not built here.
