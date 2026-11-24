# Phase 7.5B — Operations overview summary truth repair (TRACE-159, DF-1, DF-2)

**Status:** IMPLEMENTATION FOR REVIEW (Codex). Not merged. *(As written before merge; merged status reconciled in §8, 2026-11-23 ET.)* The hosted migration dry run and push, the merge (Vercel production deploy) and the hosted readbacks HQ-1/HQ-2 each need the owner's authorization (§6). Nothing is activated.
**Base:** `main` `ebc7de5` (#196 merge), fetched before work. Branch `claude/phase7-5b-summary-truth-repair`.
**Authority:** the owner's Phase 7.5B instruction (2026-11-23 ET). [Operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) (OQ-1, revision 2) §8 (scope, acceptance, rollout, rollback), §5.3 DF-1 and DF-2, §7.1 SF-12, §7.2 HQ-1/HQ-2 as corrected by Codex RV-2 (§12). TRACE-136 A8 (each summary row equals its queue, with no number of its own). DEC-2026-037 (release and migration order).

## What this slice does not do

DF-3 (support "past response target"), breach records, thresholds, alerts, a breach detector, a scheduler, email activation, new queues (sourcing, applications), the owner-email row, and any booking, payment, profile or overview page change. `src/app/admin/page.tsx` is unchanged. SQL 108 is unchanged.

## 1. What changed

| File | Change |
|---|---|
| `supabase/migrations/20261130001000_phase7_operations_summary_truth.sql` | Function-only. Restates `public.admin_operations_summary()` from `20261109001000` with two changes: fulfillment's aged key is `null` (DF-1), and `('offer_terms', 'items', null)` reads `public.admin_offer_terms_queue()` inside the same per-queue `exception when others` handling (DF-2). The body diff against `20261109001000` is those two tuple edits and one `case` arm. No grant statement: `CREATE OR REPLACE` keeps the owner and the ACL |
| `src/lib/adminOperations.ts` | `SUMMARY_QUEUES`: fulfillment loses `agedLabel`; `offer_terms: { label: "Offers at other terms", href: "/admin/requests#offer-terms-queue" }` (the wrapper id on `/admin/requests`, [page.tsx:406](../src/app/admin/requests/page.tsx#L406)) |
| `supabase/tests/127_operations_summary_truth.sql` | New. Parity on nonempty synthetic fixtures (§3.1) |
| `tests/fixtures/admin-operations-summary.json` | New. SQL 127's asserted output for both callers, `checked_at` normalized to `2026-11-23T14:00:00+00:00` |
| `scripts/derive-operations-summary-fixture.mjs` | New. Replays SQL 127's marked fixture block in a rolled-back transaction, reads the summary as both callers and writes or `--check`s the fixture |
| `tests/fixtures/portal-server.mjs` | The browser lane's summary is now the derived admin summary (live `checked_at`) instead of hand-written rows |
| `src/lib/adminOperations.test.ts` | Six tests (§3.1) |
| `tests/e2e/admin-operations.spec.ts` | Four tests (§3.1) |

**Order.** The seven existing rows keep their positions; `offer_terms` is appended after `renewal_documents`, and finance stays last. On `/admin/requests` the offer-terms queue sits after cancellation; the overview follows the server's order, so it lists it after Renewal documents. Changing that is a separate display choice (R-3).

**Rendering.** `admin/page.tsx` already prints `null` aged as "—" and filters queues it has no entry for, so no page change was needed: fulfillment now shows "—" instead of "0 aged", and offers at other terms shows its count and "—".

## 2. Function and schema evidence (local, isolated stack)

The stack was reset on `main`'s 235 migrations, measured, then `supabase migration up` applied only `20261130001000`, and measured again.

| Measure | Before (`main`) | After |
|---|---|---|
| Money fingerprint (`scripts/promotion-money-fingerprint.sql`) | `58 \| af0fae6e0c5b604e9073e10bc060957e` | identical |
| Every other `public`/`private` function: name, arguments, ACL and `pg_get_functiondef`, md5 | `843 \| 9a4a1b684de3017933138b1fe839247d` | identical |
| `public`/`private` tables and views with ACLs, md5 | `210 \| f36ba3602137759a7f52e3d0f99fbec7` | identical |
| `admin_operations_summary` ACL, `SECURITY DEFINER`, `search_path`, owner, volatility | `{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}`, true, `""`, postgres, volatile | identical |
| `admin_operations_summary` definition md5 | `e4be5855…` | `3bc2497f…` (the only change) |
| Output on an empty database (admin without finance authority) | 8 rows; fulfillment `aged: 0` | 9 rows; fulfillment `aged: null`; `offer_terms` ready, count 0 |

## 3. Verification

### 3.1 Tests

**SQL 127** (67 assertions). Fixtures are written as the owner in replica mode, each shaped to the condition its queue reads, with times relative to `now()` so nothing drifts with the clock. A guard first refuses to run on a database that already has queue items.

| Queue | Fixture | Items (aged) |
|---|---|---|
| Quote | quote-mode job with no proposal 30 h after assignment; one open `accepted_change` | 2 (1) |
| Recurring payment | two accepted visits, no payment review: started 2 h ago, starts in 10 h | 2 (1) |
| Fulfillment | completion 80 h ago, unconfirmed, no evidence; a no-show on a scheduled job | 3 (`confirmation_overdue`, `evidence_unverified`, `fulfillment_exception`) |
| Support | open tickets due 1 h ago and in 20 h | 2 (1 overdue) |
| Offers at other terms | a recorded re-match failure (`rematch_failed`); a gate block on an exhausted request (`blocked_inactive`) | 2 |
| Cancellation, compliance renewal, renewal documents, finance | none | 0 |

| ID | Assertion |
|---|---|
| S1 | Exact queue list and order for both callers |
| S2 | Each row's count equals its reader's list length, per queue, for both callers (17 assertions, finance included for the holder); every row ready except finance for the non-holder |
| S3 | Quote, recurring and support `aged` equal their flagged items; fulfillment, cancellation, compliance, renewal documents, offer terms and finance `aged` are JSON `null`. S3b: fulfillment and offer-terms items carry no `aged` field (the DF-1 premise) |
| S4 | The fixtures are nonempty where parity needs it, with both aged and not-aged items; offer terms include `rematch_failed`; fulfillment includes `confirmation_overdue` |
| S5 | Finance `restricted` for the non-holder, `ready` for the holder |
| S6 | `checked_at` = `now()` |
| S7 | Calling the summary changes no row (`pg_stat_xact_all_tables` insert/update/delete totals unchanged) |
| S8, S9 | Exact summary (`checked_at` removed) for each caller: these literals are the browser fixture |
| S10 | Homeowner, vendor, a signed-in caller without identity and `anon` are refused `42501`; ACL exactly as before; security definer, empty `search_path`, owner `postgres` |
| S11 | A failing offer-terms reader errors only its own row, with every other row (finance included) unchanged; two failing readers error exactly those two rows; the loop continues |

SQL 108 is unchanged. Its count-parity check maps unknown queues to an empty list, so it holds with the new row as long as its own fixtures have no offer-terms item, which they do not.

**Unit** (`adminOperations.test.ts`, six new):
- the fixture equals SQL 127's two literals, with `checked_at` normalized, and the marker block exists;
- every queue in the database's output has a `SUMMARY_QUEUES` entry;
- every `SUMMARY_QUEUES` entry is a queue in the output;
- `agedLabel` is present exactly where the holder's all-ready output reports a number;
- the parser keeps the database's rows unchanged;
- every anchor in a queue link resolves to an `id="…"` in `src`.

**Browser** (`admin-operations.spec.ts`, four new). The overview renders the derived summary row by row, with the expected text written out (not computed from `SUMMARY_QUEUES`): admin at light 1440 px (table) and dark 390 px (list), and the finance holder at 1440 px. Axe passes on each. Clicking "Offers at other terms" lands on `/admin/requests#offer-terms-queue` with the queue heading in the viewport. The existing overview tests now read the derived summary through the fixture server.

**Chain.** SQL 127 asserts actual output = literal. The unit test asserts literal = fixture = `SUMMARY_QUEUES` keys and aged labels. The browser tests render the fixture. `scripts/derive-operations-summary-fixture.mjs --check` re-derives the fixture from the database.

### 3.2 Results

Local, 2026-11-23 ET, implementation commit `36973fb` (the documentation commit changes no code or test).

| Check | Result |
|---|---|
| Clean replay (isolated stack, `scripts/phase5-db.sh reset`) | 236 migrations, latest `20261130001000`. The function, ACL, table and fingerprint hashes after the replay equal those after the incremental apply (§2) |
| SQL 127 | 67/67 |
| Full SQL suite (`scripts/phase5-db.sh test`) on the clean replay | 119 files, 8618 tests, PASS (includes SQL 108 unchanged and SQL 127) |
| `node scripts/derive-operations-summary-fixture.mjs --check` on the clean replay | the committed fixture equals the database output |
| Unit (`vitest run`, the untracked `.phase5-local` worktree excluded locally as in 7.4C) | 81 files, 1307/1307 |
| Typecheck | pass |
| Lint, changed files (`adminOperations.ts` and its test, the spec, the fixture server, the derivation script) | pass, 0 problems |
| Secret scan | pass |
| Production build (synthetic environment, `MERCURIUS_BUILD_WORKERS=1`) | pass |
| `admin-operations.spec.ts` on that build | 18/18 (the 14 existing tests and the 4 new ones) |
| Exact-head CI | reported on the PR for the final head (a commit cannot record its own run) |

**Host note.** This 5.6 GB host was also running another slice's Supabase stack (`phase7-3d1`, left untouched). Two earlier build attempts were killed for memory (exit 137); the passing builds ran with this slice's stack stopped. In one earlier run of the spec, under a load average of about 40, the first new overview test timed out at 30 s after rendering the correct rows (page snapshot). On a rerun, the four new tests passed 12/12 with `--repeat-each=3` (2–7 s each), and the final full run passed 18/18.

## 4. Mutation checks

Each mutation was applied alone, the named tests run, and the file restored (`git diff` clean afterwards). The SQL mutations replace the function at the start of SQL 127's transaction with the edited migration body.

| ID | Mutation | Caught by |
|---|---|---|
| M1 | Restore `'aged'` for fulfillment (contract §8) | S3 fulfillment aged is null (both callers), S8, S9: 4 failures |
| M2 | Drop the offer-terms row (contract §8) | S1, S2 offer_terms count (both), S3 offer_terms aged (both), S8, S9 and the dependent rows: 9 failures |
| M3 | Swap the offer-terms list key to `entries` (contract §8) | S2 offer_terms count = queue (both), S8, S9: 4 failures |
| M4 | The summary writes a row (a no-op `support_tickets` update) | S7: 1 failure |
| M5 | Give offer terms an aged key | S3 offer_terms aged is null (both), S8, S9: 4 failures |
| C1 | Restore fulfillment's `agedLabel` | unit "an aged label exactly where the database reports an aged count" |
| C2 | Drop the `offer_terms` entry | unit: client entry for every database queue; aged label; anchor ids (3 failures) |
| C3 | Point the link at `#offer-terms` | unit: anchor ids; aged label (exact entry) |
| C4 | Rename the key to `offer_terms_queue` | unit: coverage in both directions; aged label (3 failures) |
| C5 | Give offer terms an `agedLabel` | unit "an aged label exactly where…" |
| F1 | Change the fixture's offer-terms count to 3 | unit "the browser fixture equals SQL 127's asserted output" |
| B1 | Browser lane against `main`'s client (C1 and C2 together, §5 build) | all four new browser tests fail: the "Offers at other terms" row is missing, and the link cannot be found |

C1 and C5 cannot show in the browser with this data, because a `null` aged prints "—" whatever the label. The unit test catches them.

## 5. Previous-client compatibility

Between the hosted push and the deploy (and after any `vercel promote` rollback), the client from `main` `ebc7de5` reads the new function. Apart from `adminOperations.ts` and its unit test, `src/` is identical to `main`. So that client was built from this tree with `src/lib/adminOperations.ts` restored from `ebc7de5`, and run against the fixture server serving the SQL-derived summary. The file was then restored and the final code rebuilt.

| Check (on `main`'s client) | Result |
|---|---|
| `main`'s own `tests/e2e/admin-operations.spec.ts`, unchanged, against the new summary | 14/14. A first run hit 4 timeouts in tests that do not read the summary (finance, coverage, catalog, vendors), under the memory collapse noted in §3.2; those 4 (5 with the parameterized finance test) passed on rerun |
| A one-off spec (not committed) reading SQL 127's admin summary, at 1440 px and 390 px | 2/2: eight rows in server order, with the `offer_terms` row filtered out; fulfillment shows "3" and "—"; no "Offers at other terms" text; no page error |
| `adminOperations.test.ts` with `main`'s map | 3 of the new tests fail (C2 with C1), as expected |

The RPC name, arguments and return type are unchanged, and the row shape is unchanged. Only the row set and one `aged` value differ, and `admin/page.tsx` already handles both (it filters unknown queues and prints `null` as "—").

## 6. Prepared, not run (each needs the owner's authorization)

All hosted steps are read-only except step 2. No hosted query was run for this slice.

1. **Dry run** (after Codex review): `npx supabase db push --linked --dry-run`. Expected: exactly one pending migration, `20261130001000_phase7_operations_summary_truth.sql`. Anything else: stop.
2. **Push, before merge** (DEC-2026-037): `npx supabase db push --linked`. The previous client is compatible with the new function (§5), so the live site keeps working until the deploy lands.
3. **Post-push readback** (read-only, `npx supabase db query --linked`):
   - `select version from supabase_migrations.schema_migrations order by version desc limit 1` → `20261130001000`;
   - `select md5(pg_get_functiondef('public.admin_operations_summary()'::regprocedure)), proacl, prosecdef, proconfig from pg_proc where oid = 'public.admin_operations_summary()'::regprocedure` → md5 `3bc2497fbdc2a1bc8f1da5dccc182f7d`, ACL and settings as §2;
   - `scripts/promotion-money-fingerprint.sql` → `58 | af0fae6e…`.
4. **Merge** the reviewed PR (release approval; Vercel deploys `main`). Then confirm the production deployment is READY on the merge commit.
5. **HQ-1** (read-only, as the owner, signed in on `/admin`): every row `ready` or `restricted`; fulfillment "—"; an "Offers at other terms" row. Record the counts.
6. **HQ-2** (read-only, contract §7.2 as corrected by RV-2): one `REPEATABLE READ READ ONLY` transaction as the same operator, then rolled back:
   ```sql
   begin transaction isolation level repeatable read read only;
   set local role authenticated;
   set local request.jwt.claims = '{"role":"authenticated","sub":"<owner user id>"}';
   select public.admin_operations_summary();
   select jsonb_array_length(public.admin_quote_queue()->'items'), (select count(*) from jsonb_array_elements(public.admin_quote_queue()->'items') i where (i->>'aged')::boolean);
   select jsonb_array_length(public.admin_recurring_payment_queue()->'items'), (select count(*) from jsonb_array_elements(public.admin_recurring_payment_queue()->'items') i where (i->>'aged')::boolean);
   select jsonb_array_length(public.admin_fulfillment_queue()->'items');
   select jsonb_array_length(public.admin_cancellation_queue()->'items');
   select jsonb_array_length(public.admin_support_queue(false)->'items'), (select count(*) from jsonb_array_elements(public.admin_support_queue(false)->'items') i where (i->>'overdue')::boolean);
   select jsonb_array_length(public.vendor_evidence_renewal_queue()->'entries');
   select jsonb_array_length(public.vendor_renewal_document_queue()->'entries');
   select jsonb_array_length(public.admin_offer_terms_queue()->'items');
   rollback;
   ```
   Each count (and aged count where a rule exists) must equal its summary row; fulfillment and offer-terms `aged` must be `null`. Only counts are recorded, never row contents.

**Rollback.** Application: `vercel promote <previous dpl_id>`; that client reads the new function (§5). Database: forward only, a migration restoring the `20261109001000` body. Nothing is written, so no data needs repair.

## 7. For Codex review

| ID | Question or decision |
|---|---|
| R-1 | **Separate SQL file instead of extending SQL 108.** Contract §8 put the aged and offer-terms parity in SQL 108. The owner's 7.5B instruction keeps SQL 108's assertions as they are and adds a separate file, so the new checks are in SQL 127 and SQL 108 is unchanged. Confirm the contract text can stay as written (history), with this record as the deviation note |
| R-2 | **Fixture writes in replica mode.** SQL 127 writes its rows directly as the owner with `session_replication_role = replica` (no lifecycle triggers). Each row is shaped to its queue's read condition, and the parity compares the summary with the same readers in the same transaction. The rows are not reached through the commands. Acceptable for summary parity? |
| R-3 | **Row position.** `offer_terms` is appended after `renewal_documents`, so the existing rows keep their indices. The overview therefore lists it eighth, just before finance, while `/admin/requests` shows it after cancellation. Moving it is a display choice outside this slice |
| R-4 | **Empty queues in the fixture.** Cancellation, compliance renewal, renewal documents and finance stay empty: their summary mapping did not change, and SQL 108 covers finance states. The no-show fixture produced no cancellation follow-up (empty `follow_up`), and the other cancellation entry condition (cancelled with a money obligation) needs money rows. Say if they should be nonempty too |
| R-5 | **Clean-database guard.** SQL 127's exact summaries (S8, S9) require a database with no other queue items. The fixture block raises a clear error otherwise. CI's first SQL run (after a clean start) and the "Verify clean replay" run (after the concurrency fixtures are reset) both meet that |
| R-6 | **S7 method.** "Writes nothing" is measured by the transaction's own `pg_stat_xact_all_tables` insert, update and delete totals around two calls (M4 shows it bites). It does not detect DDL or sequence calls, which the body has none of (read in the diff) |
| R-7 | **HQ-2 query (§6).** Every reader is called inside one `REPEATABLE READ READ ONLY` transaction (RV-2). The sub is the owner's user id, supplied at run time and not recorded |

**Unresolved:** none found in this slice. Carried unchanged: DF-3 (7.5D, CD-1), OD-1..OD-7, AC-1 D-1, D-4, D-5, D-6, every 7.3D gate, O-1..O-9, CFG-011.

## 8. Merged status (dated note, 2026-11-23 ET, recorded by 7.5C)

The text above is kept as written before merge. Recorded from GitHub only; this note runs no hosted query and verifies no hosted state.

| Item | Status | Source and verification |
|---|---|---|
| Review and merge | #197 merged 2026-11-23 18:38:01 UTC as `126c85f` (head `278162b`). No GitHub review object; the release approval is the merge (DEC-2026-037) | GitHub PR record |
| Exact-head CI | 45222000868 on `278162b`: success | PR comment |
| §6 steps 1–3 (dry run, push, readback) | Recorded as done, owner-authorized, before merge: only `20261130001000` listed; pushed 17:39:29 UTC; readback md5 `3bc2497f…`, ACL and settings unchanged, money `58 \| af0fae6e…`. The same comment records 11 pre-existing hosted function bodies that differ from local only in carriage returns | #197 PR comment, 2026-11-23 17:41 UTC. Not re-verified |
| §6 step 4 (deploy) | GitHub records Production deployment `8007693849` (Vercel) for `126c85f`, status `success`. No READY readback recorded | GitHub deployments API. Not verified |
| Main CI on `126c85f` | Run 45240469564 failed: application job, one browser test, `tests/e2e/mds.spec.ts:108` (axe `color-contrast`, 2.39); backend and lifecycle succeeded. 7.5B changed no MDS component; the PR-head run passed the same test. Not rerun | GitHub run log. Owner to decide |
| §6 steps 5–6 (HQ-1, HQ-2) | Not done | — |
