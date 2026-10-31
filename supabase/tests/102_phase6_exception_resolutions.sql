-- Phase 6.9B / TRACE-132: reschedule initiator and answers (E3), replacement consent and deadline
-- (E5/E6), plan visits kept with the plan provider (E7), plan stop requests (E8) and later waivers
-- (E11). Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Fixtures ------------------------------------------------------------------------------------------
-- f1..01 homeowner, 02 provider A, 03 admin, 04 second admin, 05 unrelated, 06 provider B, 07 provider C.
insert into auth.users(id, raw_user_meta_data) select ('f1000000-0000-4000-8000-00000000000' || n)::uuid, '{}'
  from generate_series(1, 7) n;
insert into public.user_roles(user_id, role) values ('f1000000-0000-4000-8000-000000000003', 'admin'),
  ('f1000000-0000-4000-8000-000000000004', 'admin'), ('f1000000-0000-4000-8000-000000000002', 'vendor'),
  ('f1000000-0000-4000-8000-000000000006', 'vendor'), ('f1000000-0000-4000-8000-000000000007', 'vendor');
insert into public.contractors(id, user_id, name, is_active, marketing_enabled) values
  ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000002', 'Synthetic provider A', true, true),
  ('f2000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000006', 'Synthetic provider B', true, true),
  ('f2000000-0000-4000-8000-000000000003', 'f1000000-0000-4000-8000-000000000007', 'Synthetic provider C', true, true);
insert into public.coverage_areas(zip_code, city) values ('00001', 'Synthetic resolution area') on conflict do nothing;
insert into public.contractor_service_zips(contractor_id, zip_code)
  select ('f2000000-0000-4000-8000-00000000000' || n)::uuid, '00001' from generate_series(1, 3) n;
-- One quote package per provider for one-time work, and a weekly one for plan visits.
insert into public.vendor_packages(id, contractor_id, service_id, name, pricing_mode, default_frequency, is_active)
select ('f9000000-0000-4000-8000-0000000000' || f || n)::uuid, ('f2000000-0000-4000-8000-00000000000' || n)::uuid,
  (select id from public.services_catalog order by id limit 1), 'Synthetic ' || freq || ' quote', 'custom_quote', freq, true
from generate_series(1, 3) n, (values ('1', 'one-time'), ('2', 'weekly')) v(f, freq);

create function pg_temp.r(n integer) returns uuid language sql immutable as
  $$ select ('f3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.k(n integer) returns uuid language sql immutable as
  $$ select ('f4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.u(n integer) returns uuid language sql immutable as
  $$ select ('f1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.c(n integer) returns uuid language sql immutable as
  $$ select ('f2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.pkg(contractor integer, weekly boolean default false) returns uuid language sql immutable as
  $$ select ('f9000000-0000-4000-8000-0000000000' || case when weekly then '2' else '1' end || contractor)::uuid $$;
-- A whole-minute instant some hours ahead, and its Eastern wall time.
create function pg_temp.at(hours numeric) returns timestamptz language sql stable as
  $$ select date_trunc('minute', now() + make_interval(mins => (hours * 60)::int)) $$;
create function pg_temp.lt(t timestamptz) returns timestamp language sql immutable as
  $$ select t at time zone 'America/New_York' $$;
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
create function pg_temp.op(who integer, job integer, key integer, kind text, at timestamptz default null,
  initiator text default null, waived boolean default false) returns jsonb language sql as $$
  select pg_temp.call(who, format('select public.record_job_operation(%L, %L, %L, ''Synthetic operation'', %L, %L, null, %L)::text',
    pg_temp.r(job), pg_temp.k(key), kind, at, waived, initiator))::jsonb
$$;
create function pg_temp.schedule(who integer, job integer) returns jsonb language sql as
  $$ select pg_temp.call(who, format('select public.job_schedule(%L)::text', pg_temp.r(job)))::jsonb $$;
create function pg_temp.outcome(who integer, job integer) returns jsonb language sql as
  $$ select pg_temp.call(who, format('select public.job_cancellation_outcome(%L)::text', pg_temp.r(job)))::jsonb $$;
create function pg_temp.req(job integer) returns public.service_requests language sql as
  $$ select * from public.service_requests where id = pg_temp.r(job) $$;
-- A one-time request offered to provider A and accepted by A (the ordinary path), with an appointment.
create function pg_temp.accepted(job integer, hours numeric) returns void language plpgsql as $$
begin
  insert into public.service_requests(id, customer_id, service_type, address, service_catalog_id, frequency, zip_code)
    values (pg_temp.r(job), pg_temp.u(1), 'Synthetic resolution ' || job, 'Synthetic address',
      (select id from public.services_catalog order by id limit 1), 'one-time', '00001');
  perform private.create_job_offer_internal(pg_temp.r(job), pg_temp.c(1), pg_temp.pkg(1), null, false);
  perform pg_temp.call(2, format('select public.vendor_accept_job(%L)::text', pg_temp.r(job)));
  update public.service_requests set scheduled_start_at = pg_temp.at(hours) where id = pg_temp.r(job);
end $$;
create function pg_temp.respond_reschedule(who integer, job integer, key integer, accept boolean, expected jsonb default null)
returns jsonb language sql as $$
  select pg_temp.call(who, format('select public.respond_to_reschedule_request(%L, %L, %L, %L, %L)::text', pg_temp.r(job),
    (pg_temp.schedule(1, job)->'open_request'->>'id'), pg_temp.k(key), accept,
    coalesce(expected, pg_temp.schedule(1, job)->'open_request'->'expected')))::jsonb
$$;
create function pg_temp.propose(who integer, job integer, key integer, starts timestamptz, expected jsonb default null)
returns jsonb language sql as $$
  select pg_temp.call(who, format('select public.admin_propose_replacement(%L, %L, %L, %L, %L, ''Synthetic proposal'')::text',
    pg_temp.r(job), pg_temp.k(key), starts, pg_temp.lt(starts),
    coalesce(expected, pg_temp.schedule(3, job)->'replacement'->'admin_expected')))::jsonb
$$;
create function pg_temp.answer(who integer, job integer, key integer, accept boolean, expected jsonb default null, proposal uuid default null)
returns jsonb language sql as $$
  select pg_temp.call(who, format('select public.homeowner_respond_replacement(%L, %L, %L, %L)::text',
    coalesce(proposal, (pg_temp.schedule(1, job)->'replacement'->'proposal'->>'id')::uuid), pg_temp.k(key), accept,
    coalesce(expected, pg_temp.schedule(1, job)->'replacement'->'expected')))::jsonb
$$;

-- Surface --------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.respond_to_reschedule_request(uuid,uuid,uuid,boolean,jsonb,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_propose_replacement(uuid,uuid,timestamptz,timestamp,jsonb,text)', 'execute')
  and not has_function_privilege('anon', 'public.homeowner_respond_replacement(uuid,uuid,boolean,jsonb,text)', 'execute')
  and not has_function_privilege('anon', 'public.homeowner_request_plan_stop(uuid,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_close_plan_stop_request(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.recurring_plan_stop_preview(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_waiver_preview(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_record_waiver_adjustment(uuid,uuid,text,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.record_job_operation(uuid,uuid,text,text,timestamptz,boolean,jsonb,text)', 'execute')
  and not has_function_privilege('anon', 'public.job_cancellation_preview(uuid,text,boolean,text)', 'execute'),
  'anonymous visitors reach no 6.9B command or read');
select ok(has_function_privilege('authenticated', 'public.record_job_operation(uuid,uuid,text,text,timestamptz,boolean,jsonb,text)', 'execute')
  and has_function_privilege('authenticated', 'public.homeowner_respond_replacement(uuid,uuid,boolean,jsonb,text)', 'execute'),
  'signed-in users reach the commands');
select ok(not exists(select 1 from pg_proc where proname = 'record_job_operation' and pronargs <> 8)
  and not exists(select 1 from pg_proc where proname = 'job_cancellation_preview' and pronargs <> 4),
  'the command and preview are replaced, not overloaded');
select ok(not has_table_privilege('authenticated', 'public.job_reschedule_responses', 'select')
  and not has_table_privilege('authenticated', 'public.job_replacement_proposals', 'insert')
  and not has_table_privilege('authenticated', 'public.job_replacement_responses', 'select')
  and not has_table_privilege('authenticated', 'public.recurring_plan_stop_requests', 'insert')
  and not has_table_privilege('authenticated', 'public.job_operation_adjustments', 'insert'),
  'no client reads or writes the new records directly');

-- E3: who asked, and the fee consequence -------------------------------------------------------------
select pg_temp.accepted(1, 30);
select is((pg_temp.req(1)).status::text, 'scheduled', 'an ordinary first acceptance still schedules the service');
select is(pg_temp.call(1, format('select public.job_cancellation_preview(%L, ''reschedule_request'')::text', pg_temp.r(1)))::jsonb->'assessment'->>'fee',
  '25', 'homeowner preview 30 h out: $25');
select is(pg_temp.call(2, format('select public.job_cancellation_preview(%L, ''reschedule_request'')::text', pg_temp.r(1)))::jsonb->'assessment'->>'fee',
  '0', 'provider preview: no homeowner fee');
select is(pg_temp.op(1, 1, 101, 'reschedule_request', pg_temp.at(60)) - array['new_start', 'appointment', 'hours_before', 'payment_at_operation', 'operation_id'],
  '{"basis":"notice_24_to_48_hours","fee":25,"fee_responsibility":"homeowner","fee_state":"assessed_not_charged","initiator":"homeowner","money_action":"none","policy":"CFG-006/007","requires_operations":true,"waived":false}'::jsonb,
  'E2/E3: the homeowner''s request assesses $25, not charged');
select is(pg_temp.op(2, 1, 102, 'reschedule_request', pg_temp.at(62)) - array['new_start', 'appointment', 'hours_before', 'payment_at_operation', 'operation_id'],
  '{"basis":"provider_requested","fee":0,"fee_responsibility":"none","if_not_honored":"CFG-007","initiator":"provider","money_action":"none","policy":"CFG-006/007","requires_homeowner_acceptance":true,"requires_operations":true,"waived":false}'::jsonb,
  'E3 (B10 closed): the provider''s request carries no homeowner fee and needs the homeowner''s answer');
select throws_ok($$select pg_temp.op(3, 1, 103, 'reschedule_request', pg_temp.at(64))$$, '22023',
  'Say whether the homeowner or the provider asked for the new time', 'operations must say who asked');
select is(pg_temp.op(3, 1, 104, 'reschedule_request', pg_temp.at(64), 'homeowner')->>'fee', '25', 'operations on the homeowner''s behalf: the homeowner''s fee');
select throws_ok($$select pg_temp.op(1, 1, 105, 'reschedule_request', pg_temp.at(64), 'provider')$$, '42501',
  'You can ask for a different time only for yourself', 'a homeowner cannot ask on the provider''s behalf');
select throws_ok($$select pg_temp.op(2, 1, 106, 'reschedule_request', pg_temp.at(64), 'homeowner')$$, '42501',
  'You can ask for a different time only for yourself', 'a provider cannot ask on the homeowner''s behalf');
select is(pg_temp.op(1, 1, 101, 'reschedule_request', pg_temp.at(60))->>'operation_id',
  (select id::text from public.job_operations where operation_key = pg_temp.k(101)), 'a retried request returns the recorded one');
select is(pg_temp.schedule(1, 1)->'open_request'->>'initiator', 'homeowner', 'the latest request is the open one');

-- E3: a provider's proposed time needs the homeowner -------------------------------------------------
select pg_temp.accepted(2, 100);
select pg_temp.op(2, 2, 201, 'reschedule_request', pg_temp.at(110));
select is(pg_temp.schedule(1, 2)->'open_request'->>'requires_homeowner_acceptance', 'true', 'the readback says the homeowner must answer');
select throws_ok($$select pg_temp.call(3, format('select public.admin_record_appointment(%L, %L, %L, %L, %L, ''Synthetic'')::text',
    pg_temp.r(2), pg_temp.k(202), pg_temp.at(110), pg_temp.lt(pg_temp.at(110)), (pg_temp.req(2)).scheduled_start_at))$$, '22023',
  'The homeowner hasn''t accepted this time. Keep the current appointment, or ask the provider to propose a time the homeowner accepts.',
  'operations cannot move the appointment to an unanswered provider proposal');
select throws_ok($$select pg_temp.respond_reschedule(2, 2, 203, true)$$, '42501', 'Only the homeowner can answer a provider''s proposed time',
  'the provider cannot answer its own proposal');
select throws_ok($$select pg_temp.respond_reschedule(3, 2, 203, true)$$, '42501', 'Only the homeowner can answer a provider''s proposed time',
  'operations cannot answer for the homeowner');
select throws_ok($$select pg_temp.respond_reschedule(1, 2, 203, true, '{"request_id":null}')$$, '40001', null,
  'a stale answer is refused');
select is((pg_temp.req(2)).scheduled_start_at, pg_temp.at(100), 'the appointment is unchanged before the answer');
select is(pg_temp.respond_reschedule(1, 2, 203, true)->>'accepted', 'true', 'the homeowner accepts the proposed time');
select is(pg_temp.respond_reschedule(1, 2, 203, true, '{}')->>'replayed', 'true', 'a lost-response retry replays the answer');
select throws_ok($$select pg_temp.respond_reschedule(1, 2, 203, false, '{}')$$, '22023', 'Response key reused with different intent',
  'the same key cannot change the answer');
select throws_ok($$select pg_temp.respond_reschedule(1, 2, 204, false)$$, '22023', 'You already answered this request',
  'a second answer is refused');
select is((pg_temp.req(2)).scheduled_start_at, pg_temp.at(100), 'acceptance alone does not move the appointment');
select throws_ok($$select pg_temp.call(3, format('select public.admin_record_appointment(%L, %L, %L, %L, %L, ''Synthetic'')::text',
    pg_temp.r(2), pg_temp.k(205), pg_temp.at(115), pg_temp.lt(pg_temp.at(115)), (pg_temp.req(2)).scheduled_start_at))$$, '22023', null,
  'operations cannot record a different time than the one accepted');
select is(pg_temp.call(3, format('select public.admin_record_appointment(%L, %L, %L, %L, %L, ''Synthetic'')::text',
    pg_temp.r(2), pg_temp.k(206), pg_temp.at(110), pg_temp.lt(pg_temp.at(110)), pg_temp.at(100)))::jsonb->>'outcome',
  'changed', 'operations records the accepted time');
select ok(pg_temp.schedule(1, 2)->'open_request' = 'null'::jsonb and (pg_temp.req(2)).scheduled_start_at = pg_temp.at(110),
  'the request is answered and the appointment changed');
select ok((pg_temp.schedule(1, 2)->'history') @> '[{"kind":"reschedule_response","outcome":"accepted"}]',
  'the answer is in the schedule history');

-- Declined: the appointment stays; operations keeps it or records the withdrawal (CFG-007).
select pg_temp.op(2, 2, 207, 'reschedule_request', pg_temp.at(130));
select is(pg_temp.respond_reschedule(1, 2, 208, false)->>'accepted', 'false', 'the homeowner declines');
select throws_ok($$select pg_temp.call(3, format('select public.admin_record_appointment(%L, %L, %L, %L, %L, ''Synthetic'')::text',
    pg_temp.r(2), pg_temp.k(209), pg_temp.at(130), pg_temp.lt(pg_temp.at(130)), pg_temp.at(110)))$$, '22023', null,
  'a declined time cannot become the appointment');
select is((select next_action from public.support_tickets where job_id = pg_temp.r(2)::text and subject = 'Provider''s proposed time declined'),
  'The homeowner declined. Keep the current appointment if the provider can honor it; otherwise record the provider''s withdrawal (CFG-007)',
  'operations is told what to do next');
select is(pg_temp.call(3, format('select public.admin_record_appointment(%L, %L, %L, %L, %L, ''Provider keeps it'')::text',
    pg_temp.r(2), pg_temp.k(210), pg_temp.at(110), pg_temp.lt(pg_temp.at(110)), pg_temp.at(110)))::jsonb->>'outcome',
  'kept', 'operations keeps the appointment, answering the request');

-- A withdrawal or cancellation closes the open request.
select pg_temp.accepted(3, 100);
select pg_temp.op(2, 3, 301, 'reschedule_request', pg_temp.at(110));
select pg_temp.op(2, 3, 302, 'provider_cancel');
select is(pg_temp.schedule(1, 3)->'open_request', 'null'::jsonb, 'the withdrawn provider''s proposal is no longer open');
select ok((pg_temp.schedule(1, 3)->'history') @> '[{"kind":"reschedule_request","actor":"previous_provider"}]',
  'it stays in the history as the previous provider''s');
select pg_temp.accepted(4, 100);
select pg_temp.op(2, 4, 401, 'reschedule_request', pg_temp.at(110));
create temp table r4_expected as select pg_temp.schedule(1, 4)->'open_request' as o;
select pg_temp.call(1, format('select public.record_job_operation(%L, %L, ''customer_cancel'', ''Synthetic'')::text', pg_temp.r(4), pg_temp.k(402)));
select throws_ok($$select pg_temp.call(1, format('select public.respond_to_reschedule_request(%L, %L, %L, true, %L)::text',
    pg_temp.r(4), (select o->>'id' from r4_expected), pg_temp.k(403), (select o->'expected' from r4_expected)))$$, '40001', null,
  'an answer after cancellation is refused as stale');

-- E5/E6: replacement consent ---------------------------------------------------------------------------
select pg_temp.accepted(10, 100);
select ok((select bool_and(outcome = 'accepted') from public.job_match_attempts where service_request_id = pg_temp.r(10)),
  'provider A accepted the original offer');
create temp table w10 as select pg_temp.op(2, 10, 1001, 'provider_cancel') as a;
select is((select (a->>'search_deadline')::timestamptz from w10), pg_temp.at(76), 'the search deadline is the appointment minus 24 hours');
select is((select a->>'inside_search_deadline' from w10), 'false', 'the withdrawal is outside the deadline');
select is((select before_value->'terms'->>'pricing_mode' from public.job_operations where operation_key = pg_temp.k(1001)),
  'custom_quote', 'the withdrawal keeps the agreed terms');
create temp table x10 as select (pg_temp.req(10)).contractor_id as x;
select ok((pg_temp.req(10)).status = 'matched' and (pg_temp.req(10)).matching_status = 'offered' and (select x from x10) <> pg_temp.c(1),
  'the search offers another provider');
select pg_temp.call(case when (select x from x10) = pg_temp.c(2) then 6 else 7 end, format('select public.vendor_accept_job(%L)::text', pg_temp.r(10)));
select ok((pg_temp.req(10)).status = 'matched' and (pg_temp.req(10)).matching_status = 'awaiting_homeowner',
  'E5: a replacement provider''s acceptance does not schedule the service');
select is(pg_temp.schedule(1, 10)->'replacement'->>'state', 'awaiting_proposal', 'the homeowner sees a replacement is being arranged');
select throws_ok($$select pg_temp.call(3, format('select public.admin_record_appointment(%L, %L, %L, %L, %L, ''Synthetic'')::text',
    pg_temp.r(10), pg_temp.k(1002), pg_temp.at(100), pg_temp.lt(pg_temp.at(100)), pg_temp.at(100)))$$, '22023',
  'An appointment can be recorded only after a provider accepts and before work starts', 'the earlier appointment cannot be inherited by recording it');
select is(private.offer_next_for_request_internal(pg_temp.r(10)), null, 'no other provider is offered while the homeowner decides');
select is(pg_temp.call(1, format('select public.job_cancellation_preview(%L)::text', pg_temp.r(10)))::jsonb->'assessment'->>'basis',
  'provider_withdrawal_open', 'E12 still applies until the homeowner accepts');
select throws_ok($$select pg_temp.propose(1, 10, 1003, pg_temp.at(120))$$, '42501', 'Admin access required', 'the homeowner cannot propose');
select throws_ok($$select pg_temp.propose(3, 10, 1003, pg_temp.at(120), '{"contractor_id":null,"proposal_id":null}')$$, '40001', null,
  'a stale proposal is refused');
update public.service_requests set resolved_price = 999 where id = pg_temp.r(10);
select throws_ok($$select pg_temp.propose(3, 10, 1003, pg_temp.at(120))$$, '22023', null,
  'E6: a replacement at a different price is refused');
update public.service_requests set resolved_price = null where id = pg_temp.r(10);
create temp table p10 as select pg_temp.propose(3, 10, 1003, pg_temp.at(120)) as p;
select is(pg_temp.propose(3, 10, 1003, pg_temp.at(120), '{}')->>'replayed', 'true', 'a retried proposal replays');
select is(pg_temp.schedule(1, 10)->'replacement'->>'state', 'awaiting_homeowner', 'the homeowner is asked to accept');
select is(pg_temp.schedule(1, 10)->'replacement'->'proposal'->>'provider_name',
  (select name from public.contractors where id = (select x from x10)), 'the homeowner sees which provider');
select is((pg_temp.schedule(1, 10)->'replacement'->'proposal'->>'starts_at')::timestamptz, pg_temp.at(120), 'and the proposed time');
create temp table p10b as select pg_temp.propose(3, 10, 1004, pg_temp.at(121)) as p;
select throws_ok($$select pg_temp.answer(1, 10, 1005, true, null, (select (p->>'id')::uuid from p10))$$, '40001', null,
  'an answer to a replaced proposal is refused');
select throws_ok($$select pg_temp.answer(3, 10, 1005, true)$$, '42501', 'Only the homeowner can answer this proposal',
  'operations cannot accept for the homeowner');
select throws_ok($$select pg_temp.answer(case when (select x from x10) = pg_temp.c(2) then 6 else 7 end, 10, 1005, true)$$, '42501',
  'Only the homeowner can answer this proposal', 'the replacement cannot accept for the homeowner');
select throws_ok($$select pg_temp.answer(1, 10, 1005, true, '{"proposal_id":null}')$$, '40001', null, 'a stale answer is refused');
select is(pg_temp.answer(1, 10, 1005, false)->>'accepted', 'false', 'the homeowner declines the replacement');
select is((select outcome from public.job_match_attempts where service_request_id = pg_temp.r(10) and contractor_id = (select x from x10)),
  'withdrawn', 'the declined replacement is released');
select ok((pg_temp.req(10)).contractor_id not in (pg_temp.c(1), (select x from x10)) and (pg_temp.req(10)).matching_status = 'offered',
  'the search continues with a provider not yet tried');
select ok((pg_temp.schedule(1, 10)->'history') @> '[{"kind":"replacement_proposal"},{"kind":"replacement_response","outcome":"declined"}]',
  'proposal and decline are in the history');
-- The third provider accepts, then withdraws before the homeowner answers: the proposal is stale.
select pg_temp.call(case when (pg_temp.req(10)).contractor_id = pg_temp.c(2) then 6 else 7 end, format('select public.vendor_accept_job(%L)::text', pg_temp.r(10)));
select pg_temp.propose(3, 10, 1006, pg_temp.at(122));
create temp table e10 as select pg_temp.schedule(1, 10)->'replacement' as e;
select pg_temp.call(case when (pg_temp.req(10)).contractor_id = pg_temp.c(2) then 6 else 7 end,
  format('select public.record_job_operation(%L, %L, ''provider_cancel'', ''Synthetic'')::text', pg_temp.r(10), pg_temp.k(1007)));
select throws_ok($$select pg_temp.answer(1, 10, 1008, true, (select e->'expected' from e10), (select (e->'proposal'->>'id')::uuid from e10))$$,
  '40001', null, 'provider identity: a proposal for a provider who left cannot be accepted');
select ok((pg_temp.req(10)).status = 'pending' and (pg_temp.req(10)).matching_status = 'exhausted',
  'no provider is left; operations decides (no attempt limit was applied)');

-- Accepted: the homeowner accepts both, and only then is the service scheduled at that time.
select pg_temp.accepted(11, 100);
select pg_temp.op(2, 11, 1101, 'provider_cancel');
select pg_temp.call(case when (pg_temp.req(11)).contractor_id = pg_temp.c(2) then 6 else 7 end, format('select public.vendor_accept_job(%L)::text', pg_temp.r(11)));
select pg_temp.propose(3, 11, 1102, pg_temp.at(110));
create temp table a11 as select pg_temp.answer(1, 11, 1103, true) as a;
select ok((pg_temp.req(11)).status = 'scheduled' and (pg_temp.req(11)).matching_status = 'matched'
  and (pg_temp.req(11)).scheduled_start_at = pg_temp.at(110), 'acceptance schedules the replacement at the accepted time');
select ok(not private.provider_withdrawal_open(pg_temp.req(11)), 'the withdrawal is resolved');
select is(pg_temp.answer(1, 11, 1103, true, '{}', (select (a->>'proposal_id')::uuid from a11))->>'replayed', 'true',
  'a lost-response retry replays the acceptance');
select throws_ok($$select pg_temp.answer(1, 11, 1104, false, '{}', (select (a->>'proposal_id')::uuid from a11))$$, '22023',
  'You already answered this proposal', 'the acceptance cannot be answered again');
select is(pg_temp.schedule(1, 11)->'replacement'->>'state', 'accepted', 'the readback says the replacement was accepted');
select ok((pg_temp.schedule(1, 11)->'history') @> '[{"kind":"replacement_response","outcome":"accepted"}]', 'acceptance is in the history');

-- A cancellation after the proposal makes it unanswerable; a cancelled service is never rescheduled.
select pg_temp.accepted(14, 100);
select pg_temp.op(2, 14, 1401, 'provider_cancel');
select pg_temp.call(case when (pg_temp.req(14)).contractor_id = pg_temp.c(2) then 6 else 7 end, format('select public.vendor_accept_job(%L)::text', pg_temp.r(14)));
select pg_temp.propose(3, 14, 1402, pg_temp.at(110));
create temp table e14 as select pg_temp.schedule(1, 14)->'replacement' as e;
select is(pg_temp.call(1, format('select public.record_job_operation(%L, %L, ''customer_cancel'', ''Synthetic'')::text', pg_temp.r(14), pg_temp.k(1403)))::jsonb->>'refund_percent',
  '100', 'E12: cancelling while the homeowner decides refunds in full');
select throws_ok($$select pg_temp.answer(1, 14, 1404, true, (select e->'expected' from e14), (select (e->'proposal'->>'id')::uuid from e14))$$,
  '40001', null, 'a proposal cannot be accepted after cancellation');
select is((pg_temp.req(14)).status::text, 'cancelled', 'the cancelled service stays cancelled');
select is(pg_temp.schedule(1, 14)->'replacement'->>'state', 'closed', 'the readback no longer asks for an answer');

-- Deadline: a withdrawal inside 24 hours goes straight to operations.
select pg_temp.accepted(12, 20);
select is(pg_temp.op(2, 12, 1201, 'provider_cancel')->>'inside_search_deadline', 'true', 'the withdrawal is inside the deadline');
select ok((pg_temp.req(12)).matching_status = 'exhausted' and not exists(select 1 from public.job_match_attempts
  where service_request_id = pg_temp.r(12) and outcome = 'pending'), 'no automatic offer is made');
select matches((select next_action from public.support_tickets where job_id = pg_temp.r(12)::text and subject = 'Service operation: provider cancel'),
  '^Withdrawal within 24 hours', 'operations is told to decide now');
select is(pg_temp.schedule(1, 12)->'replacement'->>'state', 'search_ended', 'the homeowner sees the search ended');
-- Deadline passing during the search: no further automatic offer.
select pg_temp.accepted(13, 100);
select pg_temp.op(2, 13, 1301, 'provider_cancel');
update public.service_requests set scheduled_start_at = pg_temp.at(10) where id = pg_temp.r(13);
select pg_temp.call(case when (pg_temp.req(13)).contractor_id = pg_temp.c(2) then 6 else 7 end, format('select public.vendor_decline_job(%L, ''Busy'')::text', pg_temp.r(13)));
select ok((pg_temp.req(13)).matching_status = 'exhausted' and (select count(*) from public.job_match_attempts
  where service_request_id = pg_temp.r(13)) = 2, 'after the deadline nothing is offered automatically');

-- E7: plan visits stay with the plan's provider --------------------------------------------------------
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, service_catalog_id, status,
  matching_status, frequency, zip_code, scheduled_start_at) values
  (pg_temp.r(20), pg_temp.u(1), pg_temp.c(1), 'Synthetic plan', 'Synthetic address', (select id from public.services_catalog order by id limit 1),
    'scheduled', 'matched', 'weekly', '00001', pg_temp.at(100));
insert into public.service_requests(id, customer_id, service_type, address, service_catalog_id, frequency, zip_code,
  recurrence_parent_id, occurrence_key, preferred_contractor_id, scheduled_start_at)
select pg_temp.r(n), pg_temp.u(1), 'Synthetic visit ' || n, 'Synthetic address', (select id from public.services_catalog order by id limit 1),
  'weekly', '00001', pg_temp.r(20), pg_temp.k(2000 + n), pg_temp.c(1), pg_temp.at(100 + n)
from generate_series(21, 22) n;
select throws_ok($$select private.create_job_offer_internal(pg_temp.r(21), pg_temp.c(2), pg_temp.pkg(2, true), null, false)$$, '42501',
  null, 'a visit cannot be offered to another provider');
select private.create_job_offer_internal(pg_temp.r(21), pg_temp.c(1), pg_temp.pkg(1, true), null, false);
select pg_temp.call(2, format('select public.vendor_accept_job(%L)::text', pg_temp.r(21)));
select is((pg_temp.req(21)).status::text, 'scheduled', 'the plan provider accepts its visit');
select pg_temp.op(2, 21, 2101, 'provider_cancel');
select is((pg_temp.req(21)).matching_status, 'exhausted', 'the withdrawn visit is not re-offered');
select pg_temp.call(1, format('select coalesce(public.consent_to_provider_fallback(%L)::text, '''')', pg_temp.r(21)));
select is((select count(*)::int from public.job_match_attempts where service_request_id = pg_temp.r(21)), 1,
  'homeowner fallback consent does not reach another provider');
select throws_ok($$select pg_temp.call(3, format('select public.create_job_offer(%L, %L, %L, null, true, ''Synthetic'')::text',
    pg_temp.r(21), pg_temp.c(2), pg_temp.pkg(2, true)))$$, '42501', 'A plan visit is offered only to the plan''s provider (DEC-2026-049 item 8)',
  'operations cannot offer the visit to a replacement provider');
select ok(pg_temp.call(3, format('select public.create_job_offer(%L, %L, %L, null, true, ''Explicit recommitment'')::text',
    pg_temp.r(21), pg_temp.c(1), pg_temp.pkg(1, true))) is not null, 'operations may explicitly re-offer the visit to the plan provider');
select pg_temp.call(2, format('select public.vendor_accept_job(%L)::text', pg_temp.r(21)));
select ok((pg_temp.req(21)).status = 'scheduled' and (pg_temp.req(21)).contractor_id = pg_temp.c(1) and not private.provider_withdrawal_open(pg_temp.req(21)),
  'the plan provider recommits by accepting');
-- With recorded plan terms, an offer at another package or price is refused (the creation path maps it to terms_changed).
insert into private.recurring_series_terms(series_id, accepted_offer_id, customer_id, contractor_id, frequency, pricing_mode, package_id,
  visit_price, visit_total, accepted_at)
  values (pg_temp.r(20), (select id from public.job_match_attempts where service_request_id = pg_temp.r(21) order by offered_at limit 1),
    pg_temp.u(1), pg_temp.c(1), 'weekly', 'fixed', pg_temp.pkg(1, true), 999, 999, now());
select throws_ok($$select private.create_job_offer_internal(pg_temp.r(22), pg_temp.c(1), pg_temp.pkg(1, true), null, false)$$, 'MR661',
  'recurring terms changed', 'an offer off the plan''s terms is refused');

-- E8: the homeowner asks to stop future visits -----------------------------------------------------
select throws_ok($$select pg_temp.call(2, format('select public.homeowner_request_plan_stop(%L, %L, ''Moving'')::text', pg_temp.r(20), pg_temp.k(2201)))$$,
  '42501', 'Only the homeowner can ask to stop this plan', 'the provider cannot ask');
select throws_ok($$select pg_temp.call(1, format('select public.homeowner_request_plan_stop(%L, %L, ''Moving'')::text', pg_temp.r(11), pg_temp.k(2201)))$$,
  '22023', 'This service isn''t an active plan', 'a one-time service is not a plan');
create temp table visits_before as select id, status, contractor_id, matching_status from public.service_requests where recurrence_parent_id = pg_temp.r(20);
select is(pg_temp.call(1, format('select public.homeowner_request_plan_stop(%L, %L, ''Moving'')::text', pg_temp.r(20), pg_temp.k(2201)))::jsonb->>'state',
  'requested', 'the homeowner''s request is recorded');
select is(pg_temp.call(1, format('select public.homeowner_request_plan_stop(%L, %L, ''Moving'')::text', pg_temp.r(20), pg_temp.k(2201)))::jsonb->>'replayed',
  'true', 'a retry replays it');
select is(pg_temp.call(1, format('select public.homeowner_request_plan_stop(%L, %L, ''Again'')::text', pg_temp.r(20), pg_temp.k(2202)))::jsonb->>'existing',
  'true', 'a second request returns the open one');
select is((select count(*)::int from public.recurring_plan_stop_requests where series_id = pg_temp.r(20)), 1, 'one open request');
select is(private.recurring_plan_state(pg_temp.r(20)), 'active', 'the request does not stop the plan');
select set_eq($$select id, status, contractor_id, matching_status from public.service_requests where recurrence_parent_id = pg_temp.r(20)$$,
  $$select * from visits_before$$, 'the request changes no visit');
select is((pg_temp.req(20)).status::text, 'scheduled', 'the plan is not cancelled');
create temp table preview20 as select pg_temp.call(1, format('select public.recurring_plan_stop_preview(%L)::text', pg_temp.r(20)))::jsonb as p;
select is((select p->'request'->>'state' from preview20), 'open', 'the preview shows the open request');
select is((select jsonb_array_length(p->'visits') from preview20), 2, 'the preview lists every visit in place');
select ok((select bool_and(v->'payment' = 'null'::jsonb) from preview20, jsonb_array_elements(p->'visits') v),
  'the homeowner preview has no payment internals');
select ok((select v->'cancellation'->>'refund_percent' = '100' from preview20, jsonb_array_elements(p->'visits') v
  where v->>'id' = pg_temp.r(21)::text), 'each visit shows what cancelling it would assess');
select throws_ok($$select pg_temp.call(2, format('select public.recurring_plan_stop_preview(%L)::text', pg_temp.r(20)))$$, '42501',
  'Not a participant in this service', 'the provider cannot read the stop preview');
select ok(pg_temp.call(3, format('select public.recurring_plan_stop_preview(%L)::text', pg_temp.r(20)))::jsonb->'visits'->0->'payment' <> 'null'::jsonb,
  'operations sees payment state per visit');
select pg_temp.call(3, format('select public.admin_set_recurring_plan_state(%L, %L, ''stop'', ''active'', ''Homeowner asked'')::text', pg_temp.r(20), pg_temp.k(2203)));
select is(pg_temp.call(1, format('select public.recurring_plan_stop_preview(%L)::text', pg_temp.r(20)))::jsonb->'request'->>'state', 'stopped',
  'after Stop future visits the request reads as stopped');
select set_eq($$select id, status, contractor_id, matching_status from public.service_requests where recurrence_parent_id = pg_temp.r(20)$$,
  $$select * from visits_before$$, 'stopping leaves every visit for individual handling');
select throws_ok($$select pg_temp.call(1, format('select public.homeowner_request_plan_stop(%L, %L, ''Again'')::text', pg_temp.r(20), pg_temp.k(2204)))$$,
  '22023', 'Future visits for this plan were already stopped', 'no new request after stopping');
select throws_ok($$select pg_temp.call(3, format('select public.admin_close_plan_stop_request(%L, ''Done'')::text',
    (select id from public.recurring_plan_stop_requests where series_id = pg_temp.r(20))))$$, '22023',
  'Future visits were already stopped; the request is complete', 'a stopped request is complete, not closed');
-- Closed without stopping, and asked again.
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, matching_status, frequency)
  values (pg_temp.r(30), pg_temp.u(1), pg_temp.c(1), 'Synthetic plan 30', 'Synthetic address', 'scheduled', 'matched', 'weekly');
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, matching_status, frequency, recurrence_parent_id, occurrence_key)
  values (pg_temp.r(31), pg_temp.u(1), pg_temp.c(1), 'Synthetic visit 31', 'Synthetic address', 'scheduled', 'matched', 'weekly', pg_temp.r(30), pg_temp.k(3100));
create temp table q30 as select (pg_temp.call(1, format('select public.homeowner_request_plan_stop(%L, %L, ''Moving'')::text', pg_temp.r(30), pg_temp.k(3001)))::jsonb->>'request_id')::uuid as q;
select throws_ok($$select pg_temp.call(1, format('select public.admin_close_plan_stop_request(%L, ''Withdrawn'')::text', (select q from q30)))$$,
  '42501', 'Admin access required', 'the homeowner cannot close it');
select is(pg_temp.call(3, format('select public.admin_close_plan_stop_request(%L, ''Homeowner withdrew the request'')::text', (select q from q30)))::jsonb->>'state',
  'closed', 'operations closes it without stopping');
select is(pg_temp.call(3, format('select public.admin_close_plan_stop_request(%L, ''Homeowner withdrew the request'')::text', (select q from q30)))::jsonb->>'replayed',
  'true', 'a retried close replays');
select throws_ok($$update public.recurring_plan_stop_requests set reason = 'Changed' where series_id = 'f3000000-0000-4000-8000-000000000030'$$,
  '42501', 'Plan stop requests are closed once and otherwise immutable', 'a closed request is history');
select is(pg_temp.call(1, format('select public.homeowner_request_plan_stop(%L, %L, ''Moving after all'')::text', pg_temp.r(30), pg_temp.k(3002)))::jsonb->>'replayed',
  'false', 'the homeowner can ask again');

-- E11: later waivers -----------------------------------------------------------------------------------
insert into public.service_requests(id, customer_id, contractor_id, service_type, address, status, matching_status, frequency,
  scheduled_start_at, payment_status)
select pg_temp.r(n), pg_temp.u(1), pg_temp.c(1), 'Synthetic waiver ' || n, 'Synthetic address', 'scheduled', 'matched', 'one-time',
  pg_temp.at(case n when 50 then 50 when 51 then 100 when 52 then 30 else 10 end), case when n = 50 then 'captured' else 'pending' end::public.job_payment_status
from generate_series(50, 53) n;
insert into public.money_obligations(id, service_request_id, customer_id, contractor_id, captured)
  values ('f5000000-0000-4000-8000-000000000050', pg_temp.r(50), pg_temp.u(1), pg_temp.c(1), 11700);
insert into public.money_snapshots(id, obligation_id, revision, service, addons, discount, adjustment, subtotal, tax, tip, deposit,
  total, currency, source_version, policy_version, tax_evidence, created_by, approved_by, reason, expires_at)
values ('f6000000-0000-4000-8000-000000000050', 'f5000000-0000-4000-8000-000000000050', 1, 10000, 0, 0, 0, 10000, 700, 1000, 0, 11700,
  'usd', 'synthetic-v1', 'CFG-005', 'synthetic', pg_temp.u(3), pg_temp.u(4), 'Synthetic terms', now() + interval '30 days');
update public.money_obligations set current_snapshot_id = 'f6000000-0000-4000-8000-000000000050' where id = 'f5000000-0000-4000-8000-000000000050';
select is(pg_temp.call(1, format('select public.record_job_operation(%L, %L, ''customer_cancel'', ''Synthetic'')::text', pg_temp.r(50), pg_temp.k(5001)))::jsonb->>'refund_percent',
  '50', 'the cancellation is assessed at 50%');
create temp table op50 as select id, md5(o::text) as h from public.job_operations o where operation_key = pg_temp.k(5001);
-- The original 50% is refunded and settled before the exception is accepted.
insert into public.money_refund_authorizations(id, obligation_id, payment_id, service, tax, tip, business_key, created_by, approved_by, policy_evidence, reason)
  values ('fa000000-0000-4000-8000-000000000050', 'f5000000-0000-4000-8000-000000000050', 'pi_f150', 5000, 350, 500, 'synthetic-f50',
    pg_temp.u(3), pg_temp.u(4), 'synthetic', 'Synthetic policy refund');
insert into public.money_refund_attempts(authorization_id, payment_id, amount, idempotency_key, status)
  values ('fa000000-0000-4000-8000-000000000050', 'pi_f150', 5850, 'synthetic-f50-attempt', 'pending');
create temp table preview50 as select pg_temp.call(3, format('select public.admin_waiver_preview(%L)::text', (select id from op50)))::jsonb as p;
select is((select p->>'allowed' from preview50), 'true', 'operations may accept a later waiver');
select is((select p->'original'->>'refund_percent' from preview50), '50', 'the preview shows the original assessment');
select throws_ok($$select pg_temp.call(1, format('select public.admin_waiver_preview(%L)::text', (select id from op50)))$$, '42501',
  'Admin access required', 'the homeowner cannot preview a waiver');
insert into public.money_webhook_events(event_id, event_type, payload, status, received_at) values ('evt_f150', 'refund', '{}'::jsonb, 'processed', now());
insert into public.money_refunds(provider_ref, authorization_id, event_id) values ('re_f150', 'fa000000-0000-4000-8000-000000000050', 'evt_f150');
select throws_ok($$select pg_temp.call(3, format('select public.admin_record_waiver_adjustment(%L, %L, ''Storm'', %L)::text',
    (select id from op50), pg_temp.k(5002), (select p->'expected' from preview50)))$$, '40001', null,
  'a refund completed since the preview makes it stale');
create temp table waiver50 as select pg_temp.call(3, format('select public.admin_record_waiver_adjustment(%L, %L, ''Storm'', %L)::text',
  (select id from op50), pg_temp.k(5002), pg_temp.call(3, format('select public.admin_waiver_preview(%L)::text', (select id from op50)))::jsonb->'expected'))::jsonb as w;
select is((select w->>'kind' from waiver50), 'waiver', 'E11: the waiver is accepted after the refund completed');
select is((select md5(o::text) from public.job_operations o where id = (select id from op50)), (select h from op50),
  'the original operation and assessment are unchanged');
select is((select count(*)::int from public.money_refund_authorizations where obligation_id = 'f5000000-0000-4000-8000-000000000050'), 1,
  'no refund is authorized by the waiver');
create temp table out50 as select pg_temp.outcome(1, 50) as o;
select is((select (o->'entitlement') - 'captured' from out50), '{"state":"refund_due","basis":"exception_accepted_later","amount":11700,"refund_percent":100}'::jsonb,
  'the revised entitlement is the full amount');
select is((select (o->'adjustment'->>'original_percent')::int from out50), 50, 'the original percent stays visible');
select is((select (o->'adjustment'->>'original_amount')::int from out50), 5850, 'and its amount');
select is((select o->'movement'->>'state' from out50), 'partly_settled', 'the completed refund is part of the revised amount');
select is((select o->'remaining' from out50), '{"state":"supplemental_review","amount":5850}'::jsonb,
  'what remains needs a separate supplemental authorization');
select ok((select (o->'follow_up') @> '[{"code":"supplemental_refund_needs_review"}]' and not (o->'follow_up') @> '[{"code":"refund_not_authorized"}]' from out50),
  'operations is told the remainder needs its own review, not the original refund');
select is(pg_temp.call(3, format('select public.admin_record_waiver_adjustment(%L, %L, ''Storm'', ''{}'')::text',
  (select id from op50), pg_temp.k(5002)))::jsonb->>'replayed', 'true', 'a lost-response retry replays the waiver');
select throws_ok($$select pg_temp.call(4, format('select public.admin_record_waiver_adjustment(%L, %L, ''Storm again'', %L)::text',
    (select id from op50), pg_temp.k(5003), pg_temp.call(4, format('select public.admin_waiver_preview(%L)::text', (select id from op50)))::jsonb->'expected'))$$,
  '22023', 'An exception was already accepted for this record', 'a second waiver on the same record is refused');
select throws_ok($$update public.job_operation_adjustments set reason = 'Changed'$$, null, null, 'adjustments are append-only');
select pg_temp.call(1, format('select public.record_job_operation(%L, %L, ''customer_cancel'', ''Synthetic'')::text', pg_temp.r(51), pg_temp.k(5101)));
select is(pg_temp.call(3, format('select public.admin_waiver_preview(%L)::text',
  (select id from public.job_operations where operation_key = pg_temp.k(5101))))::jsonb->>'refusal', 'This cancellation already refunds in full',
  'a full-refund cancellation needs no waiver');
-- Reschedule fee waived later.
select pg_temp.op(1, 52, 5201, 'reschedule_request', pg_temp.at(60));
select pg_temp.call(3, format('select public.admin_record_waiver_adjustment(%L, %L, ''Hurricane warning'', %L)::text',
  (select id from public.job_operations where operation_key = pg_temp.k(5201)), pg_temp.k(5202),
  private.waiver_expected((select o from public.job_operations o where operation_key = pg_temp.k(5201)))));
select is(pg_temp.schedule(1, 52)->'open_request'->>'fee_waived_later', 'true', 'the waived fee is shown on the request');
select pg_temp.op(2, 52, 5203, 'reschedule_request', pg_temp.at(61));
select is(pg_temp.call(3, format('select public.admin_waiver_preview(%L)::text',
  (select id from public.job_operations where operation_key = pg_temp.k(5203))))::jsonb->>'refusal', 'No rescheduling fee was assessed',
  'a provider''s request has no fee to waive');
-- Nothing paid: the entitlement is revised and nothing is owed.
select pg_temp.call(1, format('select public.record_job_operation(%L, %L, ''customer_cancel'', ''Synthetic'')::text', pg_temp.r(53), pg_temp.k(5301)));
select pg_temp.call(3, format('select public.admin_record_waiver_adjustment(%L, %L, ''Storm'', %L)::text',
  (select id from public.job_operations where operation_key = pg_temp.k(5301)), pg_temp.k(5302),
  private.waiver_expected((select o from public.job_operations o where operation_key = pg_temp.k(5301)))));
select ok(pg_temp.outcome(1, 53)->'entitlement' @> '{"state":"no_payment","refund_percent":100}'
  and pg_temp.outcome(1, 53)->'remaining'->>'state' = 'none', 'with nothing paid the revised entitlement owes nothing');
select is(pg_temp.outcome(2, 53) ? 'adjustment', false, 'the provider does not see the homeowner''s money');

select * from finish();
rollback;
