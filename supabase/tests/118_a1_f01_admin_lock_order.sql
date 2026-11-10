-- A1-F01 (TRACE-136; migration 20261119001000): the admin status change takes the request's lifecycle
-- advisory lock before it locks the request row, the order every caller of transition_job_status uses.
-- The behavior (authorization, stale refusal, actor-bound replay, reason, history) stays covered by
-- 108_admin_operations.sql. The deadlock itself is reproduced deterministically by A9 in
-- scripts/admin-operations-concurrency.mjs (two connections); here the definition's order and grants are checked.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

create temp table src as
  select p.prosrc as body from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_transition_job_status_expected';

select is((select count(*)::integer from src), 1, 'one admin status-change definition');
select ok((select position('pg_advisory_xact_lock(hashtextextended(p_job::text, 0))' in body) > 0 from src),
  'the admin status change takes the request advisory lock (same key as transition_job_status)');
select ok((select position('pg_advisory_xact_lock(hashtextextended(p_job::text, 0))' in body)
  < position('from public.service_requests where id = p_job for update' in body) from src),
  'the advisory lock is taken before the request row is locked');
select ok((select position('from public.service_requests where id = p_job for update' in body)
  < position('private.admin_request_action_replay' in body) from src),
  'replay and the stale check still read the request under its row lock');
select ok(has_function_privilege('authenticated', 'public.admin_transition_job_status_expected(uuid, timestamptz, uuid, public.request_status, text)', 'execute'),
  'authenticated may call it (require_admin decides)');
select ok(not has_function_privilege('anon', 'public.admin_transition_job_status_expected(uuid, timestamptz, uuid, public.request_status, text)', 'execute'),
  'anon may not call it');

select * from finish();
rollback;
