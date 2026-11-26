# Phase 7.5F-1 — SLA-breach observation: database foundation (TRACE-159)

**Status:** **IMPLEMENTED FOR REVIEW** (local evidence only). Not pushed to hosted Supabase, not merged, not deployed, never run on production data. 7.5F-2 (operator page) not started.
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

EVIDENCE-PLACEHOLDER-5.2

### 5.3 Concurrency script

EVIDENCE-PLACEHOLDER-5.3

### 5.4 Mutations

EVIDENCE-PLACEHOLDER-5.4

### 5.5 Repository checks and CI

EVIDENCE-PLACEHOLDER-5.5

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

## 7. Open items

- Codex review of this PR (I-1..I-15, §3).
- Owner authorizations B (dry run and push, before merge), C (merge), D (first hosted scan), first hosted purge.
- 7.5F-2 operator page after this merges.
- Carried unchanged: HQ-1..HQ-6 (HQ-5 open until a hosted staged breach is observed under its own authorization); OD-3..OD-7; OD-5 external channel; AC-1 D-1, D-4..D-6; SD-1, SD-2; 7.5D F-1, O-1..O-3; #203 Codex re-review; READY readbacks of `01a5dd1` and `846dd34`.
