-- Phase 7.5F-1 forward repair F208-1 (TRACE-159): the detector's replay reads a run's start and result
-- as one pair. Migration 20261204001000. Record: governance/PHASE-7-SLA-BREACH-OBSERVATION-7-5F-1.md §8.
-- The purge committing between the merged function's two reads needs two sessions; that race is in
-- scripts/sla-replay-purge-concurrency.mjs. Here, in one session: the contract the repair must keep
-- (C), a start without its result (I, the state the race produced), and the visible, expired, absent
-- and purged replays (V, E, A, P) unchanged from SQL 131. Synthetic example.invalid users; run keys
-- composed by the test; nothing is committed: the file ends in rollback.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 admin A, 2 admin B, 3 homeowner.
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('f7520000-0000-4000-8000-000000000001','p75r-admin-a@example.invalid',now(),'{"full_name":"P75R operator A"}'),
 ('f7520000-0000-4000-8000-000000000002','p75r-admin-b@example.invalid',now(),'{"full_name":"P75R operator B"}'),
 ('f7520000-0000-4000-8000-000000000003','p75r-home@example.invalid',now(),'{"full_name":"P75R homeowner"}');
insert into public.user_roles(user_id,role) values
 ('f7520000-0000-4000-8000-000000000001','admin'),('f7520000-0000-4000-8000-000000000002','admin'),
 ('f7520000-0000-4000-8000-000000000003','homeowner')
 on conflict do nothing;

create function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('f7520000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
-- A version-7 run key issued at `issued` (whole milliseconds), distinguished by n.
create function pg_temp.k(issued timestamptz, n int) returns uuid language sql immutable as $$
  select (lpad(to_hex(floor(extract(epoch from issued) * 1000)::bigint), 12, '0') || '7000' || '8' || lpad(to_hex(n), 15, '0'))::uuid $$;
create function pg_temp.call(n int, p_sql text) returns jsonb language plpgsql as $$
declare result jsonb; prior text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',pg_temp.u(n))::text, true);
  set local role authenticated;
  execute p_sql into result;
  reset role;
  perform set_config('request.jwt.claims', coalesce(prior, ''), true);
  return result;
end $$;
create function pg_temp.err(n int, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.call(n, p_sql);
  return 'ok';
exception when others then return sqlstate || ': ' || sqlerrm;
end $$;
create function pg_temp.owner_err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return sqlstate || ': ' || sqlerrm;
end $$;
create function pg_temp.scan(n int, key uuid, lim int default 200) returns jsonb language sql as $$
  select pg_temp.call(n, format('select public.admin_detect_sla_breaches(%L, %s)', key, coalesce(lim::text, 'null'))) $$;
create function pg_temp.scan_err(n int, key uuid, lim int default 200) returns text language sql as $$
  select pg_temp.err(n, format('select public.admin_detect_sla_breaches(%L, %s)', key, coalesce(lim::text, 'null'))) $$;
create function pg_temp.ledger() returns jsonb language sql as $$
  select jsonb_build_object('runs', (select count(*) from private.operations_sla_detector_runs),
    'results', (select count(*) from private.operations_sla_detector_run_results),
    'observations', (select count(*) from private.operations_sla_observations),
    'purges', (select count(*) from private.operations_sla_purges)) $$;
-- Rows under one key as "starts:results:observations".
create function pg_temp.rows(key uuid) returns text language sql as $$
  select (select count(*) from private.operations_sla_detector_runs where id = key)||':'||
    (select count(*) from private.operations_sla_detector_run_results where run_id = key)||':'||
    (select count(*) from private.operations_sla_observations where run_id = key) $$;
-- A start row only (actor A, limit 200), as owner: the inconsistent state.
create function pg_temp.start_only(key uuid, at timestamptz) returns void language sql as $$
  insert into private.operations_sla_detector_runs(id,actor,applied_limit,rule_set,evaluated_at,started_at) values (key, pg_temp.u(1), 200, 'synthetic', at, at) $$;
-- A complete pair (actor A, limit 200), as owner.
create function pg_temp.old_run(key uuid, at timestamptz) returns void language sql as $$
  insert into private.operations_sla_detector_runs(id,actor,applied_limit,rule_set,evaluated_at,started_at) values (key, pg_temp.u(1), 200, 'synthetic', at, at);
  insert into private.operations_sla_detector_run_results(run_id,outcome,rules,finished_at) values (key, 'complete', '[]', at) $$;

-- ------------------------------------------------------------------------------------------------
-- C  The contract the repair keeps: signature, security, search path, volatility, owner and ACL.
select is((select p.prosecdef and p.provolatile = 'v' and p.proconfig = array['search_path=""'] and pg_get_function_result(p.oid) = 'jsonb'
    and pg_get_function_arguments(p.oid) = 'p_run_key uuid, p_limit integer DEFAULT 200' and pg_get_userbyid(p.proowner) = 'postgres'
  from pg_proc p where p.oid = 'public.admin_detect_sla_breaches(uuid,integer)'::regprocedure), true,
  'C: same signature and default, security definer, volatile, search_path empty, owner postgres');
select is((select array_agg(r order by r) from unnest(array['anon','authenticated','service_role']) r
    where has_function_privilege(r, 'public.admin_detect_sla_breaches(uuid,integer)', 'execute')),
  array['authenticated'], 'C: execute for authenticated only (anon, service_role refused)');
select is((select count(*)::int from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.admin_detect_sla_breaches(uuid,integer)'::regprocedure and a.grantee = 0),
  0, 'C: no PUBLIC execute');
select is((select count(*)::int from pg_proc where proname = 'admin_detect_sla_breaches'), 1, 'C: one detector function (no overload added)');
select ok(pg_get_functiondef('public.admin_detect_sla_breaches(uuid,integer)'::regprocedure) like '%left join private.operations_sla_detector_run_results x on x.run_id = r.id%',
  'C: the replay reads start and result in one statement');
select is(pg_temp.scan_err(3, pg_temp.k(now(), 1)), '42501: Only admins can run the SLA detector', 'C: a homeowner is refused');

-- ------------------------------------------------------------------------------------------------
-- I  A start without its result (what the merged function saw when a purge committed between its
-- reads). Refused with XX000, never 'visible', nothing written, no scan; the actor and limit
-- checks still come first.
select pg_temp.start_only(pg_temp.k(now() - interval '1 hour', 10), now() - interval '1 hour');
select set_config('t.ledger', pg_temp.ledger()::text, true);
select is(pg_temp.scan_err(1, pg_temp.k(now() - interval '1 hour', 10)), 'XX000: SLA run start found without its result',
  'I: fresh key, start without result: refused (XX000), not returned as visible');
select is(pg_temp.ledger(), current_setting('t.ledger')::jsonb, 'I: and nothing is written (no result, no observation, no second run)');
select is(pg_temp.rows(pg_temp.k(now() - interval '1 hour', 10)), '1:0:0', 'I: the key still has only its start');
select is(pg_temp.scan_err(2, pg_temp.k(now() - interval '1 hour', 10)), '22023: Run key reused by another operator', 'I: another admin is refused as before (actor first)');
select is(pg_temp.scan_err(1, pg_temp.k(now() - interval '1 hour', 10), 100), '22023: Run key reused with different parameters', 'I: a different limit is refused as before');
select is(pg_temp.scan_err(1, pg_temp.k(now() - interval '1 hour', 10), null), 'XX000: SLA run start found without its result', 'I: a null limit normalizes to the stored 200 first');
select is(pg_temp.scan_err(1, pg_temp.k(now() - interval '1 hour', 10), 999), '22023: Run key reused with different parameters', 'I: 999 normalizes to 500, not the stored 200');
select pg_temp.start_only(pg_temp.k(now() - interval '100 days', 11), now() - interval '100 days');
select is(pg_temp.scan_err(1, pg_temp.k(now() - interval '100 days', 11)), 'XX000: SLA run start found without its result',
  'I: expired-age start without result: refused, neither visible nor expired nor too old');
select is(pg_temp.ledger() - 'runs', current_setting('t.ledger')::jsonb - 'runs', 'I: still nothing written');

-- ------------------------------------------------------------------------------------------------
-- V  A committed pair replays with its stored content (unchanged).
create temp table res(label text primary key, v jsonb);
insert into res values ('v1', pg_temp.scan(1, pg_temp.k(now(), 20)));
select is((select v->>'outcome' from res where label = 'v1'), 'complete', 'V: a fresh key scans (complete)');
select is((select v->>'replayed' from res where label = 'v1'), 'false', 'V: not a replay');
select is(pg_temp.rows(pg_temp.k(now(), 20)) like '1:1:%', true, 'V: one start and one result');
insert into res values ('v2', pg_temp.scan(1, pg_temp.k(now(), 20)));
select is((select v from res where label = 'v2') - 'replayed', (select v from res where label = 'v1') - 'replayed', 'V: the replay returns the stored run unchanged');
select is((select v->>'replayed' from res where label = 'v2'), 'true', 'V: marked replayed');
select is((select v->>'state' from res where label = 'v2'), 'visible', 'V: visible');
select is(pg_temp.scan(1, pg_temp.k(now(), 20), null) - 'replayed', (select v from res where label = 'v1') - 'replayed', 'V: null limit normalizes to 200 and replays');
select is(pg_temp.scan_err(2, pg_temp.k(now(), 20)), '22023: Run key reused by another operator', 'V: actor mismatch refused');
select is(pg_temp.scan_err(1, pg_temp.k(now(), 20), 100), '22023: Run key reused with different parameters', 'V: limit mismatch refused');
select is(pg_temp.rows(pg_temp.k(now(), 20)) like '1:1:%', true, 'V: still one start and one result');

-- ------------------------------------------------------------------------------------------------
-- E  An expired pair: 'expired' with content withheld; actor and limit checks first (unchanged).
select pg_temp.old_run(pg_temp.k(now() - interval '100 days', 30), now() - interval '100 days');
select is(pg_temp.scan(1, pg_temp.k(now() - interval '100 days', 30)), jsonb_build_object('run_key', pg_temp.k(now() - interval '100 days', 30), 'state', 'expired', 'replayed', true),
  'E: an expired run returns expired with no content');
select is(pg_temp.scan_err(2, pg_temp.k(now() - interval '100 days', 30)), '22023: Run key reused by another operator', 'E: actor mismatch refused (expired)');
select is(pg_temp.scan_err(1, pg_temp.k(now() - interval '100 days', 30), 100), '22023: Run key reused with different parameters', 'E: limit mismatch refused (expired)');
select pg_temp.old_run(pg_temp.k(now() - interval '30 days', 31), now() - interval '30 days');
select ok(pg_temp.scan(1, pg_temp.k(now() - interval '30 days', 31)) ? 'rules', 'E: an unexpired run past its key''s lifetime still replays with content');

-- ------------------------------------------------------------------------------------------------
-- A  No pair: an old key is refused as too old and writes nothing; a future key is refused; a key
-- within its window scans (unchanged).
select set_config('t.ledger', pg_temp.ledger()::text, true);
select is(pg_temp.scan_err(1, pg_temp.k(now() - interval '100 days', 40)), '22023: Run key is too old to start a scan', 'A: absent, 100 days old: too old');
select is(pg_temp.scan_err(1, pg_temp.k(clock_timestamp() + interval '10 minutes', 41)), '22023: Run key is issued in the future', 'A: absent, 10 minutes ahead: refused');
select is(pg_temp.scan_err(1, '00000000-0000-4000-8000-000000000042'::uuid), '22023: A version-7 run key is required', 'A: a version-4 key is refused');
select is(pg_temp.ledger(), current_setting('t.ledger')::jsonb, 'A: the refusals write nothing');
select is(pg_temp.scan(1, pg_temp.k(now() - interval '23 hours', 43))->>'outcome', 'complete', 'A: absent, 23 hours old: scans');

-- ------------------------------------------------------------------------------------------------
-- P  After the purge removes an expired pair, a same-key retry is too old: no duplicate scan, no
-- orphan, and the lookup is not_visible (unchanged; the two-session race is in the script).
select pg_temp.old_run(pg_temp.k(now() - interval '100 days', 50), now() - interval '100 days');
select is(pg_temp.owner_err(format('delete from private.operations_sla_detector_runs where id = %L', pg_temp.k(now() - interval '100 days', 11))),
  '55000: SLA observation records are deleted only by the retention purge', 'P setup: the guard refuses deleting the damaged start outside the purge');
select is(pg_temp.call(1, 'select public.admin_purge_sla_records(1000)')->>'outcome', 'complete', 'P: the purge completes');
select is(pg_temp.rows(pg_temp.k(now() - interval '100 days', 50)), '0:0:0', 'P: it removed the expired pair');
select is(pg_temp.rows(pg_temp.k(now() - interval '100 days', 30)), '0:0:0', 'P: and the other expired pair');
select is(pg_temp.scan_err(1, pg_temp.k(now() - interval '100 days', 50)), '22023: Run key is too old to start a scan', 'P: a retry after the purge is too old');
select is(pg_temp.rows(pg_temp.k(now() - interval '100 days', 50)), '0:0:0', 'P: and scans nothing under the key');
select is(pg_temp.call(1, format('select public.admin_sla_detector_run(%L)', pg_temp.k(now() - interval '100 days', 50)))->>'state', 'not_visible', 'P: the lookup is not_visible');
select is((select count(*)::int from private.operations_sla_detector_run_results x where not exists(select 1 from private.operations_sla_detector_runs r where r.id = x.run_id))
  + (select count(*)::int from private.operations_sla_observations o where not exists(select 1 from private.operations_sla_detector_run_results x where x.run_id = o.run_id)),
  0, 'P: no result without its start and no observation without its result');

select * from finish();
rollback;
