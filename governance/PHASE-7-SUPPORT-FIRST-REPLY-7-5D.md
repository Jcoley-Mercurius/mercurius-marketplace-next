# Phase 7.5D — Support "overdue" means awaiting a first reply past target (TRACE-159, DF-3)

**Status:** IMPLEMENTED FOR REVIEW (Codex). Not merged. No hosted action.
**Base:** `main` `7f66d9a` (#198 merged 2026-11-24 12:43:40 UTC), fetched before work, **plus open #199 (7.5C) at `6a753f3`**. #199 is not merged: this branch is stacked on it so that SQL 128's DF-3 pin can be changed in its own file (R-1). It must merge after #199, and its PR targets #199's branch until then (§9). Branch `claude/phase7-5d-support-first-reply`, in its own worktree.
**Authority:** the owner's 7.5D instruction (2026-11-24 ET), applying Codex's 7.5D directions R-1..R-7. [Operations queues contract](PHASE-7-OPERATIONS-QUEUES-CONTRACT.md) §5.3 DF-3, §9 CD-1, T-8/T-9 (CFG-010; DEC-2026-054 items 3–4). [7.5C record](PHASE-7-OPERATIONS-STAGED-FAILURES-7-5C.md) SF-9 and M15.

## What this slice does not do

No new SLA policy or target: CFG-010 stays the target, and its calendar, routing and protections are unchanged. No breach record, late flag, alert, scheduler, email, notification or permission change. No change to `admin_operations_summary`, to SQL 127 or its derived browser fixture, or to the homeowner's support page. No hosted Supabase, Vercel, Stripe, Resend or PostHog call; no merge, deploy, booking or payment.

## 1. What changed

| File | Change |
|---|---|
| [`supabase/migrations/20261202001000_phase7_support_first_reply.sql`](../supabase/migrations/20261202001000_phase7_support_first_reply.sql) | New, forward, function-only. One private helper and two restatements (§2) |
| [`supabase/tests/129_support_first_reply.sql`](../supabase/tests/129_support_first_reply.sql) | New. R0..R18, 82 assertions, one rolled-back transaction |
| [`supabase/tests/128_operations_staged_failures.sql`](../supabase/tests/128_operations_staged_failures.sql) | SF-9's DF-3 pins changed on purpose (§5.2); 147 → 149 assertions |
| [`src/lib/support.ts`](../src/lib/support.ts) | `first_response_at` on the queue item and operator detail types; `firstReplyCell` for the "First reply" column |
| [`src/app/admin/tickets/page.tsx`](../src/app/admin/tickets/page.tsx) | Tile "Awaiting first reply — overdue"; column "First reply" |
| [`src/lib/adminOperations.ts`](../src/lib/adminOperations.ts) | Overview suffix "awaiting first reply past target" |
| `tests/unit/support.test.ts`, `src/lib/adminOperations.test.ts` | Cell and wording tests |
| `tests/e2e/support.spec.ts`, `tests/e2e/admin-operations.spec.ts` | Answered and unanswered rows, tile, column, overview wording |
| This record, the contract (revision 4 notes), `TRACEABILITY.md` (TRACE-159), `docs/agent/HANDOFF.md` | Documentation |

**Numbering (derived from `main` `7f66d9a` and #199):** latest migration on `main` is #198's `20261201001000`, so this is `20261202001000`. SQL test prefixes in use: `127` (two files: 7.5B's `127_operations_summary_truth.sql` and #198's `127_pilot_standard_commission.sql`) and `128` (#199). `129` is unused on `main`, on #199 and in every remote branch.

## 2. The rule (Codex R-1..R-7 applied)

| ID | Direction | Implemented as |
|---|---|---|
| R-1 | Start after #199; change SQL 128's DF-3 pin deliberately | Stacked on #199's head; SF-9 rewritten in its file with a dated comment (§5.2). #199 had not merged when this work was done |
| R-2 | Qualifying response = earliest message with `author_role = 'operations'` and `visibility = 'participant'` | [`private.support_first_response_at(uuid)`](../supabase/migrations/20261202001000_phase7_support_first_reply.sql#L21): `min(created_at)` over exactly that predicate. The row decides, not whether a participant can open the ticket (F-1, §4) |
| — | A recorded reply, not proof of access, delivery or reading | Stated in the migration, the type comment and the cell helper; the client says "Replied", never "read", "seen" or "delivered" (unit test) |
| R-3 | Derive `first_response_at`; expose in queue rows and operator-only detail | Queue items and the operator branch of `support_ticket_json`; the requester payload has neither key (SQL 129 R0, R14; mutation M11) |
| R-4 | Overdue only when open/in progress, no qualifying reply, original `response_due_at` past | `status in ('open','in-progress') and response_due_at < now() and support_first_response_at(id) is null`, in `counts.overdue`, `items[].overdue` and detail `overdue` |
| R-5 | Preserve deadline boundaries, routing, membership/order, grants, requester access | Strict `<` kept; no change to `support_response_deadline`, `route_support_ticket`, `protect_ticket_queue_fields`, the membership filter, the order, grants or `support_is_requester` (§6.1, SQL 129 R0/R14/R17/R18) |
| R-6 | Leave `admin_operations_summary` unchanged; prove parity | Not restated (definition md5 `3bc2497f…` asserted); it counts the queue items' `overdue`, so it follows. SQL 129 R15 for both operator kinds; SQL 128 SF-9 |
| R-7 | Reopening never resets the target or clears the first reply | Routing is insert-only and the helper reads the message table, so neither changes on reopen (SQL 129 R9, R10; mutations M9, M12) |

Restated bodies are the `20261103001000` bodies verbatim except for the lines in §6.1. The helper is `stable`, `search_path = ''`, owner-only (no `authenticated`, `anon` or `service_role` execute); it runs inside the two `security definer` readers.

**Operator wording:** tile "Awaiting first reply — overdue"; overview "N awaiting first reply past target"; column "First reply" showing "Replied [time]", or "Due [time]" with " · overdue" only when the server reports it. The " · same-day" marker is kept. A row with a recorded reply never shows "overdue", even if told so.

## 3. Source inventory

Recovered from the 7.5D preparation inventory (scratchpad of the preparation session, 2026-11-24 07:45 ET, written from `126c85f` and #199's head) and rechecked against `7f66d9a` + `6a753f3`: no later migration restates any object below, and the line references hold.

### 3.1 Where `overdue` was computed (all `20261103001000`, never restated before 7.5D)

| # | Object | Consumers | 7.5D |
|---|---|---|---|
| D1 | `admin_support_queue(boolean)` → `counts.overdue` | `/admin/tickets` tile | Restated |
| D2 | `admin_support_queue(boolean)` → `items[].overdue` | `/admin/tickets` column; D4 | Restated; `first_response_at` added |
| D3 | `private.support_ticket_json(t, operator)` → `overdue` (operator only) | `support_ticket_detail` (operator); no UI reads it | Restated; `first_response_at` added (operator only) |
| D4 | `admin_operations_summary()` (`20261130001000`, 7.5B) | Overview support row | **Unchanged**; reads D2 |

### 3.2 Inputs (unchanged)

`private.support_response_deadline` (CFG-010, `20260904005500`), `private.route_support_ticket` (BEFORE INSERT only), `private.protect_ticket_queue_fields`, `public.support_ticket_messages` (append-only; `author_role` requester/operations; `visibility` participant/internal; internal ⇒ operations; index `(ticket_id, created_at)`), `post_support_message` (operator → operations/participant + N-SUP-03 to `t.user_id`), `add_support_note` (operations/internal), `admin_update_support_ticket` (status/assignment/next action → events, no message), `private.support_ticket_version` (`closed_at` set on close, cleared on reopen; target untouched).

### 3.3 Ticket producers

| Producer | `issue_type` | `user_id` | `opened_by` | Can the requester open it? |
|---|---|---|---|---|
| `open_support_ticket` | general | caller | caller | yes |
| file / appeal dispute (`20260904002000`) | dispute, dispute_appeal | homeowner | homeowner | yes |
| review appeal (`20261031001000`) | review_appeal | author | author | yes |
| service operation (`20261102001000` L340) | schedule_exception | homeowner | **caller: provider or operator** | **no** when raised by a provider or operator |
| reschedule response (`20261102001000` L450) | schedule_exception | homeowner | homeowner | yes |
| plan stop request (`20261102001000` L1121) | plan_stop_request | homeowner | homeowner | yes |

### 3.4 Application

| File | Before | 7.5D |
|---|---|---|
| `src/app/admin/tickets/page.tsx` | tile "Overdue"; column "Response due": `{due} · overdue · same-day` | §2 wording |
| `src/lib/adminOperations.ts` | `agedLabel: "past response target"` | "awaiting first reply past target" |
| `src/lib/support.ts` | `QueueItem.overdue`; `SupportTicket.overdue?` | `first_response_at` added (optional) |
| `src/lib/support.ts` `responseDueText` → `SupportCenter.tsx` | Homeowner sees "Response expected by …" while open, even after a reply | **Deferred** (O-1) |

No Edge Function, script or other migration reads these keys.

## 4. Findings recorded, not repaired

| ID | Finding | Evidence | Disposition |
|---|---|---|---|
| F-1 | **Notification/link mismatch on provider- or operator-filed work items.** A service-operation `schedule_exception` raised by a provider or an operator has `user_id` = the homeowner and `opened_by` = the caller. `support_is_requester` requires `opened_by` = the viewer, so the homeowner cannot list, open or write on it, and neither can the provider who filed it. An operations "reply" on it is still sent to the homeowner as N-SUP-03 "Mercurius replied on …" with a `/support` link, where the ticket is not listed. Under R-2 that reply still counts as the first reply (the row, not the audience, decides) | SQL 129 R14b (pins: refusals, absence from `my_support_tickets`, the N-SUP-03 row with `/support`, refusal after the reply) | Separate decision for Codex/owner (who is the participant on these items, and what the reply control and notice should say). Permissions and notification producers unchanged here |
| O-1 | Homeowner wording after a reply: the support page keeps saying "Response expected by …" while the request is open, even after Mercurius replied | `responseDueText` ([support.ts:97](../src/lib/support.ts#L97)); `SupportCenter.tsx` L115 | **Deferred** (owner instruction). The requester payload is unchanged |
| O-2 | The operator dialog does not display the first reply; the field is in the detail payload only (as `overdue` already was) | `support_ticket_json` operator branch; no UI reads it | Recorded; displaying it is a later UI choice |
| O-3 | Client against the previous database function: a missing `first_response_at` is shown as no reply, so an answered ticket would show "Due … · overdue" exactly as today (DF-3). It cannot read worse than today, and the documented order (push before merge, DEC-2026-037) means the new client meets the new function | `firstReplyCell` | Recorded; no compatibility code added |

## 5. Tests

### 5.1 SQL 129 scenario map

Synthetic `example.invalid` users (`c75d…`), one rolled-back transaction, `now()` fixed; "the clock passes" = recorded times moved back as the owner with triggers off (7.5C method). Replies, notes, triage and reads use the real commands; dispute and service-exception tickets are inserted with their producer's columns and caller (the real stamp and routing triggers run).

| Group | Scenario | Key assertions |
|---|---|---|
| R0 | Shape | helper exists, no client execute; queue grants unchanged; item keys = 20 before + `first_response_at`; operator detail = 25 before + `first_response_at`; requester detail unchanged; counts keys unchanged |
| R1 | Reply before the target, target passes | not overdue in queue and detail; both report the message time; N-SUP-03 still sent once |
| R2 | Unanswered past target, then a late reply | overdue → not overdue at the reply; target kept; no ticket event written |
| R3/R4 | Boundaries | due +1 µs / = now / −1 µs → false / false / true; a reply at exactly the target counts |
| R5 | Internal note only | still overdue; participant count unchanged |
| R6 | Requester message only | still overdue |
| R7 | Status, assignment, next action | events recorded, no message; still overdue |
| R8 | Closed without a reply | out of the default queue; with closed: not overdue, no first reply |
| R9 | Reopened, never answered | target unchanged; overdue at once |
| R10 | Replied, resolved, reopened past target | not overdue; first reply kept; a requester follow-up changes nothing |
| R11 | Two replies, two operators | the earlier counts, in queue and detail |
| R12 | Dispute ticket | routed as before; same rule (T-9 follows T-8) |
| R13 | Same-day priority | priority and target unchanged by a reply; same rule |
| R14 | Access | homeowner, provider, anon refused on the queue; another homeowner refused on detail; requester detail and `my_support_tickets` carry neither key |
| R14b | Provider- and operator-filed work items | refusals for homeowner and filing provider; not listed; the operations reply counts; F-1 pinned |
| R15 | Summary parity | definition unchanged; support row for finance holder = operator = (open items, items overdue); aged = `counts.overdue`; this file's overdue set is exactly the unanswered past-target tickets |
| R16 | Three-reader parity | `counts.overdue` = overdue items; for all 14 tickets, queue = detail = the rule recomputed from the tables |
| R17 | CFG-010 unchanged | fixed-instant calendar; definition md5s of deadline, routing and field protection; new ticket routed to the calendar |
| R18 | Membership and order | default = open + in-progress, all = every ticket; no adjacent pair out of the function's order (ties allowed); `counts.open` |

### 5.2 SQL 128 SF-9, changed on purpose

| Assertion (7.5C) | 7.5C expectation | 7.5D expectation |
|---|---|---|
| Answered before the due time, due time passes | `overdue = true` (KNOWN DEFECT) | `false` |
| — | — | new: queue `first_response_at` = the reply time |
| The overview counts it | `aged >= 1` | `aged` = the queue's overdue items (this ticket not among them) |
| Closed without reply: leaves the open queue | null item | unchanged |
| Closed without reply: overdue | `false` ("never overdue, though never answered") | `false` (overdue applies to open work only) |
| — | — | new: `first_response_at` null (never answered) |
| No reply exists; alert and communication rows | unchanged | unchanged |

**The change was forced, as 7.5C M15 predicted:** #199's unmodified SQL 128 run against this branch's database fails exactly two assertions, 108 ("answered before the due time, yet overdue") and 110 ("the overview counts it"); the other 145 pass. The 7.5C record's SF-9 row and M15 stay as written; this section is the dated change.

### 5.3 Application tests

Unit: `firstReplyCell` (replied, never overdue even if told; due with and without overdue; same-day; missing target; unparsable time; never "read/delivered/seen"); `SUMMARY_QUEUES.support.agedLabel`. Browser: `support.spec.ts` operations test (both themes and widths) asserts the tile, the "First reply" column, exactly one "Due … · overdue" row (unanswered), exactly one "Replied …" row (answered), no "Replied … overdue", and no old labels; `admin-operations.spec.ts` asserts "1 awaiting first reply past target" from the unchanged SQL-derived fixture.

## 6. Verification

### 6.1 Baseline and unchanged surfaces

Local isolated stack (`phase5-isolated`), clean replay. Fingerprint query: functions = `public`/`private` name, identity arguments, ACL, definition md5; relations = name, kind, ACL; columns = name, type, nullability, default; triggers = `pg_get_triggerdef`; indexes = `indexdef`; policies = definition (query in Appendix A; run with `psql -v excl='<name(args)>;…'`, empty for none).

| Measure | Base (`7f66d9a` + #199, 237 migrations) | 7.5D (238, latest `20261202001000`) |
|---|---|---|
| Money (`scripts/promotion-money-fingerprint.sql` as on `main`) | `61 \| eb3f9702d45f9f22e61f6a7da17349c4` | same |
| Functions excluding the two restated (and the new helper) | `846 \| 9f63370d0eb3285a471c59fe27cd200d` | same |
| Relations / columns / triggers / indexes / policies | `211 \| 63cc227e…` / `2055 \| 3ba5e838…` / `222 \| 206fefe5…` / `506 \| 16ff8b73…` / `154 \| f31814e7…` | same |
| `admin_support_queue(boolean)` | `31dc65fa…`, `{postgres, service_role, authenticated}` | `c426ab1a…`, same ACL |
| `private.support_ticket_json(…)` | `f8bd1900…`, owner only | `cc58b82d…`, same ACL |
| `private.support_first_response_at(uuid)` | — | `377c87e6…`, owner only |
| `admin_operations_summary()` | `3bc2497f…` (= 7.5B hosted readback) | same |
| `support_response_deadline` / `route_support_ticket` / `protect_ticket_queue_fields` | `01497ca4…` / `759f5aa6…` / `b5556276…` | same |
| `support_ticket_detail`, `my_support_tickets`, `post_support_message`, `add_support_note`, `admin_update_support_ticket`, `support_is_requester`, `support_is_operator` | recorded | same |

All of the above are identical again after the full suite ran. Body diff of the restatements against `20261103001000`: `create` → `create or replace`; detail gains `first_response_at` and the repaired `overdue`; queue `counts.overdue` and `items[].overdue` repaired and items gain `first_response_at`. Nothing else.

### 6.2 Results

Local, 2026-11-24 ET.

| Check | Result |
|---|---|
| SQL 129 | 82/82 |
| SQL 128 (with SF-9 changed) | 149/149 (same-day branch: `same_day`, inside weekday hours) |
| #199's SQL 128 against this database | 2 failures, exactly the DF-3 pins (§5.2) |
| SQL 127 (both), 103, 011 | pass unchanged |
| SQL 127's browser fixture (`derive-operations-summary-fixture.mjs --check`) | equal; fixture unchanged |
| Full SQL suite (`supabase test db`, CI's step) | 122 files, 8927 tests, PASS (8843 + 2 + 82) |
| SQL mutations (§6.3) | 15/15 caught; unmutated control passes |
| Unit (`support.test.ts`, `adminOperations.test.ts`) | 28/28 |
| Typecheck; changed-file lint; secret scan | pass |
| Build; browser (`support`, `admin-operations`); client mutations | pass; 25/25; 5/5 unit and 1 browser mutation caught (§6.4) |
| #199 exact-head CI on `6a753f3` (this branch's base) | run 45428311738 success (backend, lifecycle, application) |
| Exact-head CI for this branch | on the PR for the final head |

### 6.3 SQL mutations

Each mutant re-creates the migration's functions with one edit inside SQL 129's own transaction (the harness refuses an edit that does not apply), then runs the file. Nothing is committed.

| ID | Mutation | Caught by |
|---|---|---|
| M0 | control: migration re-applied unchanged | passes 82/82 |
| M1 | internal notes count as a reply | R5, R15, R16 (3) |
| M2 | requester messages count as a reply | R6, R15, R16 (3) |
| M3 | DF-3 restored (first reply ignored) | R1, R2, R4, R10 ×2, R12, R13, R14b, R15, R16 (10) |
| M4 | `<=` instead of `<` | R4 target exactly now (1) |
| M5 | items repaired, counts not | R15, R16 (2) |
| M6 | queue repaired, detail not | R1, R2, R4, R10, R14b, R16 (6) |
| M7 | triage events count as a reply | R7, R8 ×2, R9, R15, R16 (6) |
| M8 | latest reply instead of first | R11 ×2, R16 (3) |
| M9 | closing counts as a reply | R8 ×2, R9, R15, R16 (5) |
| M10 | open-status filter dropped | R8 ×2 (2) |
| M11 | `first_response_at` exposed to the requester | R0, R14 ×2 (3) |
| M12 | reopening resets the target | R9 ×2, R15 (3) |
| M13 | helper executable by `authenticated` | R0 (1) |
| M14 | queue order changed | R18 ×2 (2) |
| M15 | queue granted to `anon` | R0 (1) |

### 6.4 Build, browser and client mutations

| Check | Result |
|---|---|
| `next build` (CI's synthetic `NEXT_PUBLIC_*` values) on `d3659e2` | pass |
| Browser `support.spec.ts` + `admin-operations.spec.ts` (Playwright, CI's config) on that build | 25/25 |
| Client unit mutations | 5/5 caught; restored code 28/28 |
| Browser mutation | caught: 7 of 25 fail, 18 pass |

| ID | Mutation | Caught by |
|---|---|---|
| C1 | a reply is ignored (cell always shows "Due") | 2 unit tests |
| C2 | a replied row is still marked overdue when the server says so | 1 unit test |
| C3 | the overdue marker shown whenever there is a target | 1 unit test |
| C4 | overview wording reverted to "past response target" | 1 unit test |
| C5 | "Read" instead of "Replied" | 3 unit tests |
| B1 | the page and overview label as before 7.5D (`6a753f3`), built and served | 7 browser tests: the 5 overview tests (`admin-operations.spec.ts` L28 ×2, L80 ×3) and both operations support tests (`support.spec.ts` L122) |

An earlier build attempt was discarded: the client mutations edited sources while it compiled. The accepted build was made from committed `d3659e2` afterwards; B1 was a separate build from `6a753f3`'s two files, restored from `d3659e2` after the run.

## 7. Rollout and rollback (each hosted step needs the owner's authorization)

1. Codex reviews this PR; #199 is reviewed and merged first, then this PR is retargeted to `main` (§9).
2. Owner authorizes the hosted step (DEC-2026-037): `supabase db push --linked --dry-run` must list only `20261202001000`; then `supabase db push --linked`; read-only readback of the three definition md5s and ACLs (§6.1), `admin_operations_summary` `3bc2497f…`, and money `61 | eb3f9702…`.
3. Merge (= Production deploy); READY readback.

Safe in either order against live clients: the function change adds one key and corrects one boolean; the previous client reads both (O-3). **Rollback:** application — `vercel promote <previous dpl_id>`. Database — a forward migration restating the `20261103001000` bodies of `admin_support_queue` and `support_ticket_json` and dropping the helper. No data is written either way.

## 8. For Codex review

| ID | Question |
|---|---|
| D-1 | F-1: who is the participant on provider- and operator-filed work items, and should a reply there notify the homeowner with a `/support` link? (Recorded; nothing changed.) |
| D-2 | O-2: show the first reply inside the operator dialog, or keep it to the queue column? |
| D-3 | O-3: is "missing key = no reply" acceptable for the client, given the push-before-merge order? |
| D-4 | SF-9 overview assertion: parity (`aged` = queue overdue items) instead of a fixed count, because SQL 128 does not require an otherwise empty support queue. Acceptable? |
| D-5 | Stacking: this branch carries #199's commits; the PR targets #199's branch and is retargeted to `main` after #199 merges. If #199 changes SQL 128 before merging, this branch is rebuilt on the merged `main` and §5.2 rechecked. |

## 9. Merge order and stacking

#199 (7.5C) was open, with CI re-running on its reconciled head `6a753f3`, when this work was done. This branch starts from `6a753f3` and adds only 7.5D changes on top. Its PR targets `claude/phase7-5c-staged-failure-characterization` so the diff shows only 7.5D. After #199 merges, the PR is retargeted to `main` (GitHub does this automatically if #199's branch is deleted on merge) and final-head CI is rerun on the result. It must not merge before #199.

**Unresolved and carried unchanged:** F-1, O-1 (deferred), O-2, O-3; OD-1..OD-7; AC-1 D-1, D-4, D-5, D-6; SD-1, SD-2; every 7.3D gate; O-1..O-9 of earlier slices; CFG-011; HQ-1..HQ-6. Not Phase 7 acceptance.

## Appendix A. Schema fingerprint query

```sql
\pset footer off
-- F: functions (name, args, ACL, definition md5) in public/private; optional exclusion list via :'excl' (comma list of name(args))
select 'functions', count(*), md5(string_agg(x, '|' order by x)) from (
  select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'||coalesce(p.proacl::text,'')||md5(pg_get_functiondef(p.oid)) x
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prokind in ('f','p')
    and not (n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' = any(string_to_array(:'excl', ';')))) s;
select 'relations', count(*), md5(string_agg(x, '|' order by x)) from (
  select n.nspname||'.'||c.relname||':'||c.relkind::text||coalesce(c.relacl::text,'') x
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','v','m','p')) s;
select 'columns', count(*), md5(string_agg(x, '|' order by x)) from (
  select table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') x
  from information_schema.columns where table_schema in ('public','private')) s;
select 'triggers', count(*), md5(string_agg(x, '|' order by x)) from (
  select n.nspname||'.'||c.relname||'.'||t.tgname||':'||pg_get_triggerdef(t.oid) x
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and n.nspname in ('public','private')) s;
select 'indexes', count(*), md5(string_agg(indexdef, '|' order by indexdef)) from pg_indexes where schemaname in ('public','private');
select 'policies', count(*), md5(string_agg(schemaname||tablename||policyname||coalesce(qual,'')||coalesce(with_check,'')||cmd||roles::text, '|' order by schemaname,tablename,policyname)) from pg_policies where schemaname in ('public','private');
```
