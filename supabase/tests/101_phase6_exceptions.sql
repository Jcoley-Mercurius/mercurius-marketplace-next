-- Phase 6.9A / TRACE-131: cancellation evidence, assessment, stale guard, recurring plans and visits,
-- commercial history and the cancellation outcome readback. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Fixtures ------------------------------------------------------------------------------------------
-- e1..01 homeowner, 02 provider, 03 admin, 04 second admin, 05 unrelated, 06 second provider.
insert into auth.users(id, raw_user_meta_data) select ('e1000000-0000-4000-8000-00000000000' || n)::uuid, '{}'
  from generate_series(1, 6) n;
insert into public.user_roles(user_id, role) values ('e1000000-0000-4000-8000-000000000003', 'admin'),
  ('e1000000-0000-4000-8000-000000000004', 'admin'), ('e1000000-0000-4000-8000-000000000002', 'vendor'),
  ('e1000000-0000-4000-8000-000000000006', 'vendor');
insert into public.contractors(id, user_id, name, is_active) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000002', 'Synthetic exceptions provider', true),
  ('e2000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000006', 'Synthetic second provider', true);

create function pg_temp.r(n integer) returns uuid language sql immutable as
  $$ select ('e3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.k(n integer) returns uuid language sql immutable as
  $$ select ('e4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.u(n integer) returns uuid language sql immutable as
  $$ select ('e1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- Run a statement as a signed-in user and return its result as text.
create function pg_temp.call(who integer, statement text) returns text language plpgsql as $$
declare result text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', pg_temp.u(who))::text, true);
  perform set_config('role', 'authenticated', true);
  execute statement into result;
  perform set_config('role', 'postgres', true);
  return result;
exception when others then
  perform set_config('role', 'postgres', true);
  raise;
end $$;
create function pg_temp.cancel(who integer, job integer, key integer, waived boolean default false, expected jsonb default null)
returns jsonb language sql as $$
  select pg_temp.call(who, format('select public.record_job_operation(%L, %L, ''customer_cancel'', ''Synthetic cancellation'', null, %L, %L)::text',
    pg_temp.r(job), pg_temp.k(key), waived, expected))::jsonb
$$;
create function pg_temp.op(who integer, job integer, key integer, kind text, waived boolean default false, at timestamptz default null)
returns jsonb language sql as $$
  select pg_temp.call(who, format('select public.record_job_operation(%L, %L, %L, ''Synthetic operation'', %L, %L)::text',
    pg_temp.r(job), pg_temp.k(key), kind, at, waived))::jsonb
$$;
create function pg_temp.preview(who integer, job integer, kind text default 'customer_cancel', waived boolean default false)
returns jsonb language sql as $$
  select pg_temp.call(who, format('select public.job_cancellation_preview(%L, %L, %L)::text', pg_temp.r(job), kind, waived))::jsonb
$$;
create function pg_temp.outcome(who integer, job integer) returns jsonb language sql as $$
  select pg_temp.call(who, format('select public.job_cancellation_outcome(%L)::text', pg_temp.r(job)))::jsonb
$$;
create function pg_temp.status(job integer) returns text language sql as
  $$ select status::text from public.service_requests where id = pg_temp.r(job) $$;

-- One-time requests for the homeowner. 1: pending, no appointment. 2–5: CFG-006 boundaries.
-- 6: paid, scheduled. 7: in progress. 8: open checkout. 12–16: stale, evidence, quality.
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, matching_status,
  frequency, scheduled_start_at, payment_status)
select pg_temp.r(n), pg_temp.u(1), case when n = 1 then null else 'e2000000-0000-4000-8000-000000000001'::uuid end,
  'Synthetic exception ' || n, 'Synthetic address', case when n = 1 then 'pending' when n = 7 then 'in_progress' else 'scheduled' end::public.request_status,
  case when n = 1 then 'awaiting_match' else 'matched' end, 'one-time',
  case n when 1 then null when 2 then now() + interval '72 hours 1 minute' when 3 then now() + interval '71 hours 59 minutes'
    when 4 then now() + interval '24 hours 1 minute' when 5 then now() + interval '23 hours 59 minutes'
    when 7 then now() - interval '1 hour' else now() + interval '100 hours' end,
  case when n in (6, 7) then 'captured' else 'pending' end::public.job_payment_status
from generate_series(1, 16) n where n not in (9, 10, 11);

-- Paid agreement on request 6; open checkout (session created, not paid) on request 8.
insert into public.money_obligations(id, service_request_id, customer_id, contractor_id, captured) values
  ('e5000000-0000-4000-8000-000000000006', pg_temp.r(6), pg_temp.u(1), 'e2000000-0000-4000-8000-000000000001', 11700),
  ('e5000000-0000-4000-8000-000000000008', pg_temp.r(8), pg_temp.u(1), 'e2000000-0000-4000-8000-000000000001', 0);
insert into public.money_snapshots(id, obligation_id, revision, service, addons, discount, adjustment, subtotal, tax, tip, deposit,
  total, currency, source_version, policy_version, tax_evidence, created_by, approved_by, reason, expires_at)
select ('e6000000-0000-4000-8000-00000000000' || n)::uuid, ('e5000000-0000-4000-8000-00000000000' || n)::uuid, 1, 10000, 0, 0, 0,
  10000, 700, 1000, 0, 11700, 'usd', 'synthetic-v1', 'CFG-005', 'synthetic', pg_temp.u(3), pg_temp.u(4), 'Synthetic terms',
  now() + interval '30 days'
from unnest(array[6, 8]) n;
update public.money_obligations o set current_snapshot_id = s.id from public.money_snapshots s where s.obligation_id = o.id
  and o.id in ('e5000000-0000-4000-8000-000000000006', 'e5000000-0000-4000-8000-000000000008');
insert into public.money_checkout_attempts(id, obligation_id, snapshot_id, customer_id, mode, amount, currency, business_key,
  stripe_idempotency_key, stripe_session_id, stripe_payment_id, status, expires_at, completed_at) values
  ('e7000000-0000-4000-8000-000000000006', 'e5000000-0000-4000-8000-000000000006', 'e6000000-0000-4000-8000-000000000006',
    pg_temp.u(1), 'full', 11700, 'usd', 'synthetic-e106', 'synthetic-e106', 'cs_e106', 'pi_e106', 'captured', now() + interval '1 hour', now()),
  ('e7000000-0000-4000-8000-000000000008', 'e5000000-0000-4000-8000-000000000008', 'e6000000-0000-4000-8000-000000000008',
    pg_temp.u(1), 'full', 11700, 'usd', 'synthetic-e108', 'synthetic-e108', 'cs_e108', null, 'session_created', now() + interval '1 hour', null);
insert into public.money_commercial_sources(snapshot_id, source_kind, source_hash, evidence, reviewed_terms, created_at)
select 'e6000000-0000-4000-8000-000000000008', 'offering', 'synthetic-source', jsonb_build_object('context', private.money_source_context(r)),
  '{}'::jsonb, now() from public.service_requests r where r.id = pg_temp.r(8);

-- Recurring plan 20 (accepted: it has visit 21) and plan 22 (not yet accepted). Visit 21 is paid.
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, matching_status, frequency,
  scheduled_start_at, payment_status, recurrence_parent_id, occurrence_key) values
  (pg_temp.r(20), pg_temp.u(1), 'e2000000-0000-4000-8000-000000000001', 'Synthetic plan', 'Synthetic address', 'scheduled', 'matched',
    'weekly', now() + interval '100 hours', 'pending', null, null),
  (pg_temp.r(22), pg_temp.u(1), null, 'Synthetic new plan', 'Synthetic address', 'pending', 'awaiting_match', 'weekly', null, 'pending', null, null);
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, matching_status, frequency,
  scheduled_start_at, payment_status, recurrence_parent_id, occurrence_key) values
  (pg_temp.r(21), pg_temp.u(1), 'e2000000-0000-4000-8000-000000000001', 'Synthetic visit', 'Synthetic address', 'scheduled', 'matched',
    'weekly', now() + interval '100 hours', 'pending', pg_temp.r(20), 'e8000000-0000-4000-8000-000000000021');
insert into public.money_obligations(id, service_request_id, customer_id, contractor_id, captured) values
  ('e5000000-0000-4000-8000-000000000021', pg_temp.r(21), pg_temp.u(1), 'e2000000-0000-4000-8000-000000000001', 0);

create temp table money_before as
  select 'obligations' as t, md5(string_agg(o::text, '|' order by o.id)) as h from public.money_obligations o where o.id::text like 'e5%'
  union all select 'snapshots', md5(string_agg(s::text, '|' order by s.id)) from public.money_snapshots s where s.id::text like 'e6%'
  union all select 'attempts', md5(string_agg(a::text, '|' order by a.id)) from public.money_checkout_attempts a where a.id::text like 'e7%'
  union all select 'journals', md5(coalesce(string_agg(j::text, '|' order by j.id), '')) from public.money_journals j
    where j.obligation_id::text like 'e5%';

-- Surface --------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.job_cancellation_preview(uuid,text,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.job_cancellation_outcome(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_cancellation_queue()', 'execute')
  and not has_function_privilege('anon', 'public.admin_provider_quality_events(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.record_job_operation(uuid,uuid,text,text,timestamptz,boolean,jsonb)', 'execute'),
  'anonymous visitors reach no exception command or read');
select ok(has_function_privilege('authenticated', 'public.record_job_operation(uuid,uuid,text,text,timestamptz,boolean,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.job_cancellation_preview(uuid,text,boolean)', 'execute'),
  'signed-in users reach the command and the preview');
select ok(not exists(select 1 from pg_proc where proname = 'record_job_operation' and pronargs = 6),
  'the six-argument command is replaced, not overloaded');
select ok(not has_table_privilege('authenticated', 'public.job_operations', 'insert'),
  'no client can write an operation record directly');

-- Cancellation evidence --------------------------------------------------------------------------------
select throws_ok($$select pg_temp.call(1, format('select public.transition_job_status(%L, ''cancelled'', ''Direct'')::text', pg_temp.r(1)))$$,
  '42501', 'Cancel this service through its cancellation command', 'a homeowner cannot cancel a pending request by direct transition');
select throws_ok($$select pg_temp.call(3, format('select public.transition_job_status(%L, ''cancelled'', ''Direct'')::text', pg_temp.r(14)))$$,
  '42501', 'Cancel this service through its cancellation command', 'operations cannot cancel through the generic transition');
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$select public.transition_job_status('e3000000-0000-4000-8000-000000000014', 'cancelled', 'Internal')$$,
  '42501', 'Cancel this service through its cancellation command', 'the service role cannot cancel through the transition');
select throws_ok($$update public.service_requests set status = 'cancelled' where id = 'e3000000-0000-4000-8000-000000000014'$$,
  '42501', 'Cancel this service through its cancellation command', 'the service role cannot write the status directly');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$update public.service_requests set status = 'cancelled' where id = 'e3000000-0000-4000-8000-000000000014'$$,
  '42501', 'Cancel this service through its cancellation command', 'a direct database write without owner maintenance is refused');

-- Evidence must name a record of this request, of the right kind, by this actor, written in this
-- transaction. A historical record is not reusable.
insert into public.job_operations(id, job_id, operation_key, actor_id, kind, reason, before_value, policy_assessment, created_at) values
  ('e9000000-0000-4000-8000-000000000001', pg_temp.r(14), pg_temp.k(901), pg_temp.u(1), 'customer_cancel', 'Old', '{}', '{"policy":"CFG-006/007","refund_percent":100}', now() - interval '1 second'),
  ('e9000000-0000-4000-8000-000000000002', pg_temp.r(14), pg_temp.k(902), pg_temp.u(3), 'customer_cancel', 'Other actor', '{}', '{"policy":"CFG-006/007","refund_percent":100}', now()),
  ('e9000000-0000-4000-8000-000000000003', pg_temp.r(15), pg_temp.k(903), pg_temp.u(1), 'customer_cancel', 'Other request', '{}', '{"policy":"CFG-006/007","refund_percent":100}', now()),
  ('e9000000-0000-4000-8000-000000000004', pg_temp.r(14), pg_temp.k(904), pg_temp.u(1), 'provider_cancel', 'Wrong kind', '{}', '{"policy":"CFG-006/007"}', now());
create function pg_temp.forged(record_id text) returns text language plpgsql as $$
begin
  perform set_config('mercurius.cancel_evidence', pg_temp.r(14)::text || ':operation:' || record_id, true);
  return pg_temp.call(1, format('select public.transition_job_status(%L, ''cancelled'', ''Forged'')::text', pg_temp.r(14)));
end $$;
select throws_ok($$select pg_temp.forged('e9000000-0000-4000-8000-000000000001')$$, '42501',
  'Cancel this service through its cancellation command', 'a record from an earlier transaction is not evidence');
select throws_ok($$select pg_temp.forged('e9000000-0000-4000-8000-000000000002')$$, '42501',
  'Cancel this service through its cancellation command', 'another actor''s record is not evidence');
select throws_ok($$select pg_temp.forged('e9000000-0000-4000-8000-000000000003')$$, '42501',
  'Cancel this service through its cancellation command', 'another request''s record is not evidence');
select throws_ok($$select pg_temp.forged('e9000000-0000-4000-8000-000000000004')$$, '42501',
  'Cancel this service through its cancellation command', 'a provider withdrawal record is not evidence');
select throws_ok($$select pg_temp.forged('not-a-record')$$, '42501',
  'Cancel this service through its cancellation command', 'malformed evidence is refused');
select set_config('mercurius.cancel_evidence', '', true);
select is(pg_temp.status(14), 'scheduled', 'request 14 is unchanged by every refused attempt');

-- The assessed command cancels and consumes its evidence.
select is(pg_temp.cancel(1, 1, 1)->>'basis', 'no_appointment', 'E1: no recorded appointment is assessed as such');
select is(pg_temp.status(1), 'cancelled', 'the command cancels the pending request');
select is(coalesce(current_setting('mercurius.cancel_evidence', true), ''), '', 'the evidence is consumed');
select is((select (policy_assessment->>'refund_percent')::int from public.job_operations where job_id = pg_temp.r(1)), 100,
  'E1: no recorded appointment refunds 100%');

-- Owner maintenance is explicit and transaction-local.
set local mercurius.owner_maintenance = 'on';
update public.service_requests set status = 'cancelled' where id = pg_temp.r(16);
set local mercurius.owner_maintenance = 'off';
select is(pg_temp.status(16), 'cancelled', 'owner maintenance from a direct database session can set the status');

-- CFG-006 boundaries: preview equals the recorded assessment --------------------------------------
select is(pg_temp.preview(1, 2)->'assessment'->>'refund_percent', '100', 'preview 72 h + 1 min: 100%');
select is(pg_temp.preview(1, 3)->'assessment'->>'refund_percent', '50', 'preview 72 h − 1 min: 50%');
select is(pg_temp.preview(1, 4)->'assessment'->>'refund_percent', '50', 'preview 24 h + 1 min: 50%');
select is(pg_temp.preview(1, 5)->'assessment'->>'refund_percent', '0', 'preview 24 h − 1 min: 0%');
select is(pg_temp.preview(3, 5, 'customer_cancel', true)->'assessment'->>'refund_percent', '100', 'an accepted exception waives the penalty');
select is(pg_temp.preview(1, 5, 'customer_cancel', true)->'refusal'->>'code', 'waiver_admin_only', 'only operations may preview a waiver');
select is(pg_temp.preview(1, 4, 'reschedule_request')->'assessment'->>'fee', '25', 'reschedule 24 h + 1 min: $25');
update public.service_requests set scheduled_start_at = now() + interval '48 hours 1 minute' where id = pg_temp.r(13);
select is(pg_temp.preview(1, 13, 'reschedule_request')->'assessment'->>'fee', '0', 'reschedule 48 h + 1 min: free');
update public.service_requests set scheduled_start_at = now() + interval '47 hours 59 minutes' where id = pg_temp.r(13);
select is(pg_temp.preview(1, 13, 'reschedule_request')->'assessment'->>'fee', '25', 'reschedule 48 h − 1 min: $25');
select is(pg_temp.preview(1, 5, 'reschedule_request')->'assessment'->'fee', 'null'::jsonb, 'reschedule under 24 h: case by case');
create temp table previews as select n, pg_temp.preview(1, n) as p from unnest(array[2, 3, 4, 5]) n;
select is(pg_temp.cancel(1, n, 10 + n) - 'operation_id' - 'payment_at_operation', (select p->'assessment' from previews where previews.n = x.n),
  format('request %s: the recorded assessment equals its preview', n)) from unnest(array[2, 3, 4, 5]) x(n);
select is((select string_agg(status::text, ',' order by id) from public.service_requests where id in (pg_temp.r(2), pg_temp.r(3), pg_temp.r(4), pg_temp.r(5))),
  'cancelled,cancelled,cancelled,cancelled', 'each boundary request is cancelled');

-- Started work (E1) ----------------------------------------------------------------------------------
select is(pg_temp.preview(1, 7)->'refusal'->>'code', 'work_started', 'E1: the homeowner preview names started work');
select throws_ok($$select pg_temp.cancel(1, 7, 70)$$, '22023',
  'Work has started, so this can''t be cancelled here. Report an issue and Mercurius will decide what happens next.',
  'E1: a homeowner cannot cancel started work');
select is(pg_temp.cancel(3, 7, 71)->>'refund_percent', '0', 'operations can cancel started work under the CFG-006 window');

-- Replay and stale guard ----------------------------------------------------------------------------
create temp table seen as select pg_temp.preview(1, 12)->'expected' as expected;
select pg_temp.op(2, 12, 120, 'provider_cancel');
select throws_ok($$select pg_temp.cancel(1, 12, 121, false, (select expected from seen))$$, '40001',
  'This service changed since you opened it. Review the current details and try again.', 'a cancellation from a stale read is refused');
select is(pg_temp.status(12), 'pending', 'the stale cancellation changed nothing');
select is(pg_temp.cancel(1, 12, 122, false, pg_temp.preview(1, 12)->'expected')->>'basis', 'provider_withdrawal_open',
  'E12: a fresh cancellation while the provider withdrawal is open refunds 100%');
select is(pg_temp.cancel(1, 12, 122, false, (select expected from seen))->>'basis', 'provider_withdrawal_open',
  'a retry of the recorded cancellation returns it even with an old read');
select is((select count(*)::int from public.job_operations where job_id = pg_temp.r(12) and kind = 'customer_cancel'), 1,
  'the retry records nothing new');
select throws_ok($$select pg_temp.call(1, format('select public.record_job_operation(%L, %L, ''customer_cancel'', ''Different reason'')::text', pg_temp.r(12), pg_temp.k(122)))$$,
  '22023', 'Operation key reused with different intent', 'a reused key with a different intent is refused');

-- Paid request returned to pending (P1) ---------------------------------------------------------------
select is(pg_temp.op(2, 6, 60, 'provider_cancel')->>'next_action', 'rematch_first', 'the provider withdraws from the paid request');
select is(pg_temp.status(6), 'pending', 'the paid request is back in pending');
select throws_ok($$select pg_temp.call(1, format('select public.transition_job_status(%L, ''cancelled'', ''Direct'')::text', pg_temp.r(6)))$$,
  '42501', 'Cancel this service through its cancellation command', 'P1 closed: a paid request in pending cannot be cancelled directly');
select is(pg_temp.outcome(1, 6)->'entitlement'->>'state', 'awaiting_replacement_decision', 'the outcome says a replacement decision is awaited');
select is(pg_temp.cancel(1, 6, 61)->>'refund_percent', '100', 'E12: the homeowner''s cancellation during the withdrawal refunds 100%');
select is((select before_value->'commercial'->>'captured' from public.job_operations where operation_key = pg_temp.k(61)), '11700',
  'the record keeps the captured amount at cancellation');
select is((select before_value->'commercial'->>'snapshot_id' from public.job_operations where operation_key = pg_temp.k(61)),
  'e6000000-0000-4000-8000-000000000006', 'the record keeps the accepted snapshot');
select set_eq($$select t, h from money_before where t <> 'journals'$$,
  $$select 'obligations', md5(string_agg(o::text, '|' order by o.id)) from public.money_obligations o where o.id::text like 'e5%'
    union all select 'snapshots', md5(string_agg(s::text, '|' order by s.id)) from public.money_snapshots s where s.id::text like 'e6%'
    union all select 'attempts', md5(string_agg(a::text, '|' order by a.id)) from public.money_checkout_attempts a where a.id::text like 'e7%'$$,
  'cancellation changes no obligation, snapshot or checkout attempt');
select is((select count(*)::int from public.money_journals where obligation_id::text like 'e5%'), 0, 'cancellation writes no journal');
select is((select count(*)::int from public.money_refund_authorizations where obligation_id::text like 'e5%'), 0, 'cancellation authorizes no refund');

-- Outcome layers on request 6 ------------------------------------------------------------------------
select is(pg_temp.outcome(1, 6)->'entitlement', '{"state":"refund_due","basis":"provider_withdrawal_open","amount":11700,"captured":11700,"refund_percent":100}'::jsonb,
  'entitlement: the policy refund is 100% of the paid total');
select is(pg_temp.outcome(1, 6)->'authorization'->>'state', 'none', 'authorization: nothing authorized yet');
select is(pg_temp.outcome(1, 6)->'movement'->>'state', 'none', 'movement: nothing has moved; cancellation alone is never "settled"');
select ok((pg_temp.outcome(1, 6)->'follow_up') @> '[{"code":"refund_not_authorized"}]', 'operations is told the refund is not authorized');
insert into public.money_refund_authorizations(id, obligation_id, payment_id, service, tax, tip, business_key, created_by, approved_by, policy_evidence, reason) values
  ('ea000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000006', 'pi_e106', 5000, 0, 0, 'synthetic-a1', pg_temp.u(3), pg_temp.u(4), 'synthetic', 'Synthetic part');
select is(pg_temp.outcome(1, 6)->'authorization'->>'state', 'partly_authorized', 'authorization: part of the refund is authorized');
select is(pg_temp.outcome(1, 6)->'movement'->>'state', 'not_sent', 'movement: authorized but not sent');
insert into public.money_refund_attempts(authorization_id, payment_id, amount, idempotency_key, status)
  values ('ea000000-0000-4000-8000-000000000001', 'pi_e106', 5000, 'synthetic-a1-attempt', 'pending');
select is(pg_temp.outcome(1, 6)->'movement'->>'state', 'in_flight', 'movement: sent, outcome not yet reported');
insert into public.money_webhook_events(event_id, event_type, payload, status, received_at)
  values ('evt_e106a1', 'refund', '{}'::jsonb, 'processed', now());
insert into public.money_refunds(provider_ref, authorization_id, event_id) values ('re_e106a1', 'ea000000-0000-4000-8000-000000000001', 'evt_e106a1');
select is(pg_temp.outcome(1, 6)->'movement'->>'state', 'partly_settled', 'movement: part settled by a provider refund event');
select is((pg_temp.outcome(1, 6)->'movement'->>'settled')::int, 5000, 'movement: the settled amount is the reported refund');
insert into public.money_refund_authorizations(id, obligation_id, payment_id, service, tax, tip, business_key, created_by, approved_by, policy_evidence, reason) values
  ('ea000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000006', 'pi_e106', 5000, 700, 1000, 'synthetic-a2', pg_temp.u(3), pg_temp.u(4), 'synthetic', 'Synthetic rest');
insert into public.money_refund_attempts(authorization_id, payment_id, amount, idempotency_key, status)
  values ('ea000000-0000-4000-8000-000000000002', 'pi_e106', 6700, 'synthetic-a2-attempt', 'failed');
select is(pg_temp.outcome(1, 6)->'authorization'->>'state', 'authorized', 'authorization: the full policy refund is authorized');
select is(pg_temp.outcome(1, 6)->'movement'->>'state', 'failed', 'movement: a failed refund is shown as failed, not settled');
select ok((pg_temp.outcome(1, 6)->'follow_up') @> '[{"code":"refund_failed"}]', 'operations is told a refund failed');
select throws_ok($$select pg_temp.outcome(5, 6)$$, '42501', 'Not a participant in this service', 'an unrelated user cannot read the outcome');
select is(pg_temp.outcome(2, 5) ? 'entitlement', false, 'a provider sees the service ended, not the homeowner''s money');
select is(pg_temp.outcome(1, 5)->'entitlement'->>'state', 'no_payment', 'nothing was paid on request 5');

-- Open checkout and late capture (request 8): current payment path, characterized ------------------
select is(pg_temp.cancel(1, 8, 80)->'payment_at_operation', '{"captured":0,"open_checkout":true}'::jsonb,
  'the cancellation is kept and records the open checkout');
select is(pg_temp.outcome(1, 8)->'entitlement'->>'state', 'payment_outcome_pending', 'entitlement waits for the open checkout');
select ok((pg_temp.outcome(1, 8)->'follow_up') @> '[{"code":"checkout_open_after_cancellation"}]', 'operations is told the checkout is open');
select throws_ok($$select (private.money_checkout_source_guarded('e6000000-0000-4000-8000-000000000008', 'full')).id$$,
  'P0001', 'Commercial source changed; review current terms', 'after cancellation the authoritative checkout path refuses new collection');
-- Characterization (payment-kernel scope, not changed here): a session already created can still be
-- attached and paid, and the capture is recorded on the cancelled request.
select lives_ok($$select public.money_attach_checkout('e7000000-0000-4000-8000-000000000008', 'cs_e108', 'https://checkout.stripe.com/c/pay/cs_e108')$$,
  'CHARACTERIZED: attaching an existing session after cancellation is still accepted');
insert into public.money_webhook_events(event_id, event_type, payload, status, received_at) values ('evt_e108_capture', 'capture',
  jsonb_build_object('attempt_id', 'e7000000-0000-4000-8000-000000000008', 'amount', 11700, 'currency', 'usd', 'payment_id', 'pi_e108'), 'received', now());
select is(public.money_process_event('evt_e108_capture'), 'processed', 'CHARACTERIZED: a late capture on the cancelled request is recorded');
select is((select captured from public.money_obligations where id = 'e5000000-0000-4000-8000-000000000008'), 11700::bigint,
  'CHARACTERIZED: the cancelled request now holds captured funds');
select is(pg_temp.outcome(1, 8)->'entitlement'->>'state', 'refund_due', 'the late payment is owed back under the 100% cancellation');
select ok((pg_temp.outcome(3, 8)->'follow_up') @> '[{"code":"payment_after_cancellation"},{"code":"refund_not_authorized"}]',
  'operations sees the payment after cancellation and the refund still to authorize');
select is(pg_temp.status(8), 'cancelled', 'the late capture does not reopen the request');

-- Recurring plans and visits ---------------------------------------------------------------------------
select is(pg_temp.preview(1, 20)->'refusal'->>'code', 'recurring_plan', 'an accepted plan previews as a plan');
select throws_ok($$select pg_temp.cancel(1, 20, 200)$$, '22023', 'Changes are made on each visit. Mercurius can stop future visits on the plan.',
  'a homeowner cannot cancel an accepted plan');
select throws_ok($$select pg_temp.op(2, 20, 201, 'provider_cancel')$$, '22023', 'Changes are made on each visit. Mercurius can stop future visits on the plan.',
  'a provider cannot withdraw from a whole plan');
select throws_ok($$select pg_temp.op(3, 20, 202, 'no_show')$$, '22023', 'Changes are made on each visit. Mercurius can stop future visits on the plan.',
  'operations cannot record a visit exception on the plan');
select throws_ok($$select pg_temp.call(3, format('select public.transition_job_status(%L, ''pending'', ''Rematch plan'')::text', pg_temp.r(20)))$$,
  '22023', 'A recurring plan is changed with Stop future visits; each visit is handled on its own', 'the plan cannot be sent back to matching');
select is(pg_temp.status(20), 'scheduled', 'the plan is unchanged');
select is(pg_temp.cancel(1, 22, 220)->>'basis', 'no_appointment', 'a recurring request not yet accepted cancels like any request');
-- A visit's provider withdrawal is not re-offered to other providers (DEC-2026-049 item 8).
select is(pg_temp.op(2, 21, 210, 'provider_cancel')->>'replacement_providers', 'false', 'the visit assessment says no replacement providers');
select is((select status::text || '/' || matching_status from public.service_requests where id = pg_temp.r(21)), 'pending/exhausted',
  'the visit waits for operations instead of rematching');
select is((select count(*)::int from public.job_match_attempts where service_request_id = pg_temp.r(21)), 0, 'no replacement offer is created');
select ok((select next_action from public.support_tickets where job_id = pg_temp.r(21)::text) like '%DEC-2026-049 item 8%',
  'operations is told why the visit is not rematched');
select is(pg_temp.status(20), 'scheduled', 'the plan is untouched by its visit');
select is((pg_temp.call(3, format('select (public.record_provider_replacement_decision(%L, %L, ''No replacement for a plan visit'')).outcome',
  (select id from public.job_operations where operation_key = pg_temp.k(210)), pg_temp.k(211)))), 'no_replacement',
  'the decision records no replacement without offering the visit');
select is(pg_temp.status(21), 'cancelled', 'the no-replacement decision cancels the visit with its evidence');
select is(pg_temp.outcome(1, 21)->'entitlement'->>'basis', 'no_acceptable_replacement', 'CFG-007: full refund basis');
-- A replacement reconciliation for a plan visit is refused whatever the decision.
select throws_ok($$insert into public.money_replacement_reconciliations(obligation_id, operation_id, replacement_decision_id, snapshot_id,
    original_contractor_id, replacement_contractor_id, captured, source_hash, created_by, approved_by, reason)
  select 'e5000000-0000-4000-8000-000000000021', o.id, d.id, 'e6000000-0000-4000-8000-000000000006', 'e2000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000002', 1, 'synthetic', 'e1000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000004', 'Synthetic'
  from public.job_operations o join public.money_provider_replacement_decisions d on d.operation_id = o.id where o.operation_key = 'e4000000-0000-4000-8000-000000000210'$$,
  '42501', 'A plan visit is paid only to the plan''s provider; a replacement provider is not set up (DEC-2026-049 item 8)',
  'no accepted snapshot moves to a replacement provider for a plan visit');

-- Quality events (display only) -------------------------------------------------------------------
select pg_temp.op(1, 15, 150, 'no_show');
select pg_temp.op(3, 13, 130, 'provider_cancel', true);
create temp table quality as select jsonb_array_elements(pg_temp.call(3, 'select public.admin_provider_quality_events()::text')::jsonb->'items') e;
select is((select e->>'classification' from quality where e->>'job_id' = pg_temp.r(6)::text), 'recorded', 'a provider withdrawal is a recorded quality event');
select is((select e->>'classification' from quality where e->>'job_id' = pg_temp.r(15)::text), 'reported_unconfirmed', 'a homeowner no-show report is unconfirmed');
select is((select e->>'classification' from quality where e->>'job_id' = pg_temp.r(13)::text), 'excused', 'an accepted exception is excused');
select is((select e->>'recorded_by' from quality where e->>'job_id' = pg_temp.r(6)::text), 'provider', 'the record names who reported it');
select throws_ok($$select pg_temp.call(2, 'select public.admin_provider_quality_events()::text')$$, '42501', 'Admin access required',
  'providers cannot read the quality events');

-- Operations queue ------------------------------------------------------------------------------------
create temp table queue as select jsonb_array_elements(pg_temp.call(3, 'select public.admin_cancellation_queue()::text')::jsonb->'items') e;
select ok(exists(select 1 from queue where e->>'job_id' = pg_temp.r(8)::text), 'the late payment is in the operations queue');
select ok(exists(select 1 from queue where e->>'job_id' = pg_temp.r(6)::text), 'the failed refund is in the operations queue');
select ok(not exists(select 1 from queue where e->>'job_id' = pg_temp.r(1)::text), 'a cancellation with nothing paid needs no follow-up');
select throws_ok($$select pg_temp.call(1, 'select public.admin_cancellation_queue()::text')$$, '42501', 'Admin access required',
  'a homeowner cannot read the operations queue');

select * from finish();
rollback;
