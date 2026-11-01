-- Phase 6.5 / TRACE-121: appointment entry in Eastern Time, stale and retried saves, reschedule
-- requests versus changes, role readback and preserved history. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,raw_user_meta_data) values
 ('92100000-0000-4000-8000-000000000001','{"full_name":"Synthetic homeowner A"}'),
 ('92100000-0000-4000-8000-000000000002','{"full_name":"Synthetic homeowner B"}'),
 ('92100000-0000-4000-8000-000000000003','{"full_name":"Synthetic provider one"}'),
 ('92100000-0000-4000-8000-000000000004','{"full_name":"Synthetic provider two"}'),
 ('92100000-0000-4000-8000-000000000005','{"full_name":"Synthetic operator one"}'),
 ('92100000-0000-4000-8000-000000000006','{"full_name":"Synthetic operator two"}');
insert into public.user_roles(user_id,role) values
 ('92100000-0000-4000-8000-000000000003','vendor'),('92100000-0000-4000-8000-000000000004','vendor'),
 ('92100000-0000-4000-8000-000000000005','admin'),('92100000-0000-4000-8000-000000000006','admin');
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('92200000-0000-4000-8000-000000000001','92100000-0000-4000-8000-000000000003','Synthetic provider one',true,true),
 ('92200000-0000-4000-8000-000000000002','92100000-0000-4000-8000-000000000004','Synthetic provider two',true,true);
-- Jobs 1–8: 1 main flow, 2 pending, 3 open offer, 4 recurring, 5 in progress, 6 provider withdrawal, 7–8 DST.
insert into public.service_requests(id,customer_id,service_type,address,frequency,zip_code,preferred_date,preferred_time,
  status,matching_status,contractor_id)
 select ('92300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'92100000-0000-4000-8000-000000000001',
  'Synthetic service','Synthetic address',case when n=4 then 'weekly' else 'one-time' end,'00000',
  (now() at time zone 'America/New_York')::date + 5,'Morning',
  (case n when 2 then 'pending' when 3 then 'matched' when 5 then 'in_progress' else 'scheduled' end)::public.request_status,
  case n when 2 then 'awaiting_match' when 3 then 'offered' else 'matched' end,
  case when n=2 then null else '92200000-0000-4000-8000-000000000001'::uuid end
 from generate_series(1,8)n;

-- Eastern wall times relative to the test clock, and next year's DST boundaries.
select set_config('t.local1',((now() at time zone 'America/New_York')::date + 10 + time '09:00')::text,true);
select set_config('t.local2',((now() at time zone 'America/New_York')::date + 12 + time '14:30')::text,true);
select set_config('t.request',((now() at time zone 'America/New_York')::date + 14 + time '10:00')::text,true);
select set_config('t.spring',(m + ((7 - extract(dow from m)::int) % 7) + 7)::text,true)
 from (select make_date(extract(year from now())::int + 1,3,1) m) s;
select set_config('t.fall',(m + ((7 - extract(dow from m)::int) % 7))::text,true)
 from (select make_date(extract(year from now())::int + 1,11,1) m) s;
create function pg_temp.et(text) returns timestamptz language sql stable as
 $$ select current_setting($1)::timestamp at time zone 'America/New_York' $$;
create function pg_temp.lt(text) returns timestamp language sql stable as $$ select current_setting($1)::timestamp $$;
create function pg_temp.as_user(text) returns void language sql as
 $$ select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',$1)::text,true) $$;
create function pg_temp.history(uuid) returns jsonb language sql as
 $$ select coalesce(jsonb_agg(e - 'operation_key'),'[]') from jsonb_array_elements(public.job_schedule($1) -> 'history') e $$;

select ok(extract(dow from current_setting('t.spring')::date)=0 and extract(day from current_setting('t.spring')::date) between 8 and 14,'spring boundary is the second Sunday of March');
select is(((current_setting('t.spring')::date + time '01:59') at time zone 'America/New_York') + interval '1 minute',
  (current_setting('t.spring')::date + time '03:00') at time zone 'America/New_York','spring forward skips 2:00–2:59 Eastern');

-- Scheduled without an appointment, readable only by the job's participants.
set local role authenticated;
select pg_temp.as_user('92100000-0000-4000-8000-000000000001');
select is(public.job_schedule('92300000-0000-4000-8000-000000000001') - 'history','{"timezone":"America/New_York","status":"scheduled","matching_status":"matched","has_provider":true,"recurring":false,"appointment":null,"open_request":null,"replacement":null}'::jsonb,'homeowner reads a scheduled job with no appointment recorded');
select is(public.job_schedule('92300000-0000-4000-8000-000000000001') -> 'history','[]'::jsonb,'no schedule history yet');
select pg_temp.as_user('92100000-0000-4000-8000-000000000003');
select is(public.job_schedule('92300000-0000-4000-8000-000000000001') ->> 'status','scheduled','assigned provider reads the schedule');
select pg_temp.as_user('92100000-0000-4000-8000-000000000002');
select throws_ok($$select public.job_schedule('92300000-0000-4000-8000-000000000001')$$,'42501','Not a participant in this service','other homeowner refused');
select throws_ok($$select public.job_schedule('92300000-0000-4000-8000-0000000000ff')$$,'42501','Not a participant in this service','missing job refused like a foreign one');
select pg_temp.as_user('92100000-0000-4000-8000-000000000004');
select throws_ok($$select public.job_schedule('92300000-0000-4000-8000-000000000001')$$,'42501','Not a participant in this service','other provider refused');
reset role;
set local role anon;
select throws_ok($$select public.job_schedule('92300000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous refused');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),null,'Synthetic')$$,'42501',null,'anonymous cannot record');
reset role;

-- Only operations records the appointment, and only on an accepted one-time job before work starts.
set local role authenticated;
select pg_temp.as_user('92100000-0000-4000-8000-000000000001');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),null,'Synthetic')$$,'42501','Admin access required','homeowner cannot record an appointment');
select pg_temp.as_user('92100000-0000-4000-8000-000000000003');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),null,'Synthetic')$$,'42501','Admin access required','assigned provider cannot record an appointment');
select pg_temp.as_user('92100000-0000-4000-8000-000000000005');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000002','92400000-0000-4000-8000-000000000002',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),null,'Synthetic')$$,'22023','An appointment can be recorded only after a provider accepts and before work starts','pending request without a provider refused');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000003','92400000-0000-4000-8000-000000000003',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),null,'Synthetic')$$,'22023','An appointment can be recorded only after a provider accepts and before work starts','open offer is not an accepted provider');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000004','92400000-0000-4000-8000-000000000004',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),null,'Synthetic')$$,'22023','Recurring visits are scheduled separately','recurring work is left to its own slice');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000005','92400000-0000-4000-8000-000000000005',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),null,'Synthetic')$$,'22023','An appointment can be recorded only after a provider accepts and before work starts','work in progress refused');

-- Invalid input: missing fields, a device-shifted instant, seconds, the past, the old generic path.
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),null,'  ')$$,'22023','Appointment, Eastern time, operation key and reason required','reason required');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001',pg_temp.et('t.local1'),null,null,'Synthetic')$$,'22023','Appointment, Eastern time, operation key and reason required','Eastern wall time required');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001',pg_temp.lt('t.local1') at time zone 'America/Los_Angeles',pg_temp.lt('t.local1'),null,'Synthetic')$$,'22023','The appointment does not match the Eastern Time entered','9:00 read in a Pacific device timezone is refused, not shifted');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001',pg_temp.et('t.local1') + interval '30 seconds',pg_temp.lt('t.local1') + interval '30 seconds',null,'Synthetic')$$,'22023','The appointment does not match the Eastern Time entered','appointments are whole minutes');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001',date_trunc('minute',now()) - interval '1 day',(date_trunc('minute',now()) - interval '1 day') at time zone 'America/New_York',null,'Synthetic')$$,'22023','Choose a future appointment time','past appointment refused');
select throws_ok($$select public.record_job_operation('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001','appointment','Synthetic',pg_temp.et('t.local1'))$$,'22023','Record appointments with admin_record_appointment','generic appointment path retired');
reset role;
select is((select count(*) from public.job_operations where job_id::text like '92300000-%'),0::bigint,'refusals record nothing');

-- Record, retry after a lost response, reuse with another intent, stale and concurrent saves.
set local role authenticated;
select pg_temp.as_user('92100000-0000-4000-8000-000000000005');
select is(public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),null,'Agreed with both parties by phone') ->> 'outcome','recorded','first appointment recorded');
select is(public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),null,'Agreed with both parties by phone') ->> 'replayed','true','same key and intent replays the recorded result');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000001',pg_temp.et('t.local2'),pg_temp.lt('t.local2'),null,'Agreed with both parties by phone')$$,'22023','Operation key reused with different intent','same key with another time refused');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000011',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),pg_temp.et('t.local1'),'Synthetic')$$,'22023','This appointment is already recorded','recording the same time again is refused without a request');
select pg_temp.as_user('92100000-0000-4000-8000-000000000006');
select throws_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000012',pg_temp.et('t.local2'),pg_temp.lt('t.local2'),null,'Second operator loaded before the first save')$$,'40001','The appointment changed since you loaded it','second operator with a stale read is refused');
select throws_ok($$select public.admin_record_appointment(_job_id=>'92300000-0000-4000-8000-000000000001',_operation_key=>'92400000-0000-4000-8000-000000000018',_starts_at=>pg_temp.et('t.local2'),_local_start=>pg_temp.lt('t.local2'),_reason=>'No expected value sent')$$,'40001','The appointment changed since you loaded it','an omitted expected appointment is a stale read, not an override');
reset role;
select is((select count(*) from public.job_operations where job_id='92300000-0000-4000-8000-000000000001'),1::bigint,'one appointment operation after retry and refusals');
select is((select scheduled_start_at from public.service_requests where id='92300000-0000-4000-8000-000000000001'),pg_temp.et('t.local1'),'appointment instant stored');
select is((select preferred_date from public.service_requests where id='92300000-0000-4000-8000-000000000001'),(now() at time zone 'America/New_York')::date + 5,'homeowner preferred date preserved');
select is((select count(*) from public.notifications where related_request_id='92300000-0000-4000-8000-000000000001' and title='Appointment recorded'),2::bigint,'homeowner and provider notified once in the app');
select is((select body from public.notifications where related_request_id='92300000-0000-4000-8000-000000000001' and user_id='92100000-0000-4000-8000-000000000001'),
  to_char(pg_temp.lt('t.local1'),'Dy, Mon FMDD, YYYY, ')||'9:00 AM '||case when pg_temp.lt('t.local1') - (pg_temp.et('t.local1') at time zone 'UTC') = interval '-4 hours' then 'EDT' else 'EST' end||' (Eastern Time). Agreed with both parties by phone','notice states the Eastern time and reason');
select throws_ok($$update public.job_operations set reason='Edited' where job_id='92300000-0000-4000-8000-000000000001'$$,null,null,'history rows are immutable');
set local role authenticated;
select pg_temp.as_user('92100000-0000-4000-8000-000000000005');
select throws_ok($$update public.service_requests set scheduled_start_at=now()+interval '30 days' where id='92300000-0000-4000-8000-000000000001'$$,'42501',null,'no direct appointment writes, even for operators');
select is(public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000013',pg_temp.et('t.local2'),pg_temp.lt('t.local2'),pg_temp.et('t.local1'),'Provider asked for the afternoon') ->> 'outcome','changed','change with the current appointment loaded');

-- A reschedule request leaves the appointment in place until operations changes or keeps it.
select pg_temp.as_user('92100000-0000-4000-8000-000000000001');
select lives_ok($$select public.record_job_operation('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000014','reschedule_request','Away that week',pg_temp.et('t.request'))$$,'homeowner requests a different time');
select is((public.job_schedule('92300000-0000-4000-8000-000000000001') ->> 'appointment')::timestamptz,pg_temp.et('t.local2'),'requested time is not the appointment');
select is((public.job_schedule('92300000-0000-4000-8000-000000000001') -> 'open_request' ->> 'requested_start')::timestamptz,pg_temp.et('t.request'),'open request carries the requested time');
select is(public.job_schedule('92300000-0000-4000-8000-000000000001') -> 'open_request' ->> 'actor','homeowner','open request names the requesting role');
select pg_temp.as_user('92100000-0000-4000-8000-000000000003');
select is(public.job_schedule('92300000-0000-4000-8000-000000000001') -> 'open_request' ->> 'reason','Away that week','provider sees the open request');
select pg_temp.as_user('92100000-0000-4000-8000-000000000005');
select is(public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000015',pg_temp.et('t.local2'),pg_temp.lt('t.local2'),pg_temp.et('t.local2'),'Provider has no other opening') ->> 'outcome','kept','operations keeps the current appointment in answer to the request');
select is(public.job_schedule('92300000-0000-4000-8000-000000000001') -> 'open_request','null'::jsonb,'kept appointment answers the request');
select is((select scheduled_start_at from public.service_requests where id='92300000-0000-4000-8000-000000000001'),pg_temp.et('t.local2'),'kept appointment unchanged');
select pg_temp.as_user('92100000-0000-4000-8000-000000000003');
select lives_ok($$select public.record_job_operation('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000016','reschedule_request','Crew unavailable',pg_temp.et('t.request'))$$,'provider requests a different time');
-- TRACE-132 (DEC-2026-053 E3): a provider's proposed time moves the appointment only after the homeowner accepts it.
select pg_temp.as_user('92100000-0000-4000-8000-000000000001');
select lives_ok($$select public.respond_to_reschedule_request('92300000-0000-4000-8000-000000000001',
  (public.job_schedule('92300000-0000-4000-8000-000000000001')->'open_request'->>'id')::uuid,'92400000-0000-4000-8000-000000000018',true,
  public.job_schedule('92300000-0000-4000-8000-000000000001')->'open_request'->'expected')$$,'homeowner accepts the provider''s time');
select pg_temp.as_user('92100000-0000-4000-8000-000000000005');
select is(public.admin_record_appointment('92300000-0000-4000-8000-000000000001','92400000-0000-4000-8000-000000000017',pg_temp.et('t.request'),pg_temp.lt('t.request'),pg_temp.et('t.local2'),'Moved at the provider''s request') ->> 'answers_request',
  (select id::text from public.job_operations where operation_key='92400000-0000-4000-8000-000000000016'),'change answers the provider request');

-- The same history for every role, in order, with old and new values and the actor as a role.
select is(jsonb_path_query_array(public.job_schedule('92300000-0000-4000-8000-000000000001') -> 'history','$[*].outcome'),'["recorded","changed","requested","kept","requested","accepted","changed"]'::jsonb,'history in order');
select is(jsonb_path_query_array(public.job_schedule('92300000-0000-4000-8000-000000000001') -> 'history','$[*].actor'),'["operations","operations","homeowner","operations","provider","homeowner","operations"]'::jsonb,'actors shown as roles');
select is(((public.job_schedule('92300000-0000-4000-8000-000000000001') -> 'history' -> 1 ->> 'previous_start')::timestamptz,(public.job_schedule('92300000-0000-4000-8000-000000000001') -> 'history' -> 1 ->> 'new_start')::timestamptz),(pg_temp.et('t.local1'),pg_temp.et('t.local2')),'change keeps old and new values');
select is(public.job_schedule('92300000-0000-4000-8000-000000000001') -> 'history' -> 2 ->> 'operation_key',null,'other actors'' operation keys are not exposed');
select set_config('t.history',pg_temp.history('92300000-0000-4000-8000-000000000001')::text,true);
select pg_temp.as_user('92100000-0000-4000-8000-000000000001');
select is(public.job_schedule('92300000-0000-4000-8000-000000000001') -> 'history' -> 2 ->> 'operation_key','92400000-0000-4000-8000-000000000014','actor sees their own key for retry recognition');
select is(pg_temp.history('92300000-0000-4000-8000-000000000001'),current_setting('t.history')::jsonb,'homeowner sees the operator''s history');
select pg_temp.as_user('92100000-0000-4000-8000-000000000003');
select is(pg_temp.history('92300000-0000-4000-8000-000000000001'),current_setting('t.history')::jsonb,'provider sees the operator''s history');
select is((public.job_schedule('92300000-0000-4000-8000-000000000001') ->> 'appointment')::timestamptz,pg_temp.et('t.request'),'provider reads the same appointment instant');

-- Daylight saving: a spring-forward time does not exist; a fall-back time needs its offset.
select pg_temp.as_user('92100000-0000-4000-8000-000000000005');
select throws_ok(format($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000007','92400000-0000-4000-8000-000000000021',%L::timestamptz,%L::timestamp,null,'Synthetic')$$,
  (current_setting('t.spring')::date + time '02:30')::timestamp at time zone 'UTC' + interval '5 hours',current_setting('t.spring')::date + time '02:30'),'22023','The appointment does not match the Eastern Time entered','2:30 AM on the spring-forward date is refused (EST reading)');
select throws_ok(format($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000007','92400000-0000-4000-8000-000000000022',%L::timestamptz,%L::timestamp,null,'Synthetic')$$,
  (current_setting('t.spring')::date + time '02:30')::timestamp at time zone 'UTC' + interval '4 hours',current_setting('t.spring')::date + time '02:30'),'22023','The appointment does not match the Eastern Time entered','2:30 AM on the spring-forward date is refused (EDT reading)');
select is(public.admin_record_appointment('92300000-0000-4000-8000-000000000007','92400000-0000-4000-8000-000000000023',(current_setting('t.fall')::date + time '01:30')::timestamp at time zone 'UTC' + interval '4 hours',current_setting('t.fall')::date + time '01:30',null,'First 1:30') ->> 'outcome','recorded','fall-back 1:30 AM EDT accepted');
select is(public.admin_record_appointment('92300000-0000-4000-8000-000000000008','92400000-0000-4000-8000-000000000024',(current_setting('t.fall')::date + time '01:30')::timestamp at time zone 'UTC' + interval '5 hours',current_setting('t.fall')::date + time '01:30',null,'Second 1:30') ->> 'outcome','recorded','fall-back 1:30 AM EST accepted');
reset role;
select is((select scheduled_start_at from public.service_requests where id='92300000-0000-4000-8000-000000000008') - (select scheduled_start_at from public.service_requests where id='92300000-0000-4000-8000-000000000007'),interval '1 hour','the two fall-back readings stay one hour apart');
select matches((select body from public.notifications where related_request_id='92300000-0000-4000-8000-000000000007' and user_id='92100000-0000-4000-8000-000000000001'),'^Sun, Nov [0-9]+, [0-9]{4}, 1:30 AM EDT \(Eastern Time\)','EDT reading named in the notice');
select matches((select body from public.notifications where related_request_id='92300000-0000-4000-8000-000000000008' and user_id='92100000-0000-4000-8000-000000000001'),'^Sun, Nov [0-9]+, [0-9]{4}, 1:30 AM EST \(Eastern Time\)','EST reading named in the notice');

-- A withdrawn provider's earlier request reads as a previous provider; the appointment remains.
set local role authenticated;
select pg_temp.as_user('92100000-0000-4000-8000-000000000005');
select lives_ok($$select public.admin_record_appointment('92300000-0000-4000-8000-000000000006','92400000-0000-4000-8000-000000000031',pg_temp.et('t.local1'),pg_temp.lt('t.local1'),null,'Synthetic')$$,'appointment before withdrawal');
select pg_temp.as_user('92100000-0000-4000-8000-000000000003');
select lives_ok($$select public.record_job_operation('92300000-0000-4000-8000-000000000006','92400000-0000-4000-8000-000000000032','reschedule_request','Synthetic',pg_temp.et('t.request'))$$,'provider request before withdrawal');
select lives_ok($$select public.record_job_operation('92300000-0000-4000-8000-000000000006','92400000-0000-4000-8000-000000000033','provider_cancel','Synthetic withdrawal')$$,'provider withdraws');
select throws_ok($$select public.job_schedule('92300000-0000-4000-8000-000000000006')$$,'42501','Not a participant in this service','withdrawn provider no longer reads the schedule');
select pg_temp.as_user('92100000-0000-4000-8000-000000000001');
-- TRACE-132 (DEC-2026-053 E3): the withdrawal closes the provider's proposal; it stays in the history.
select is(public.job_schedule('92300000-0000-4000-8000-000000000006') -> 'open_request','null'::jsonb,'a withdrawn provider''s proposal is no longer open');
select ok((public.job_schedule('92300000-0000-4000-8000-000000000006') -> 'history') @> '[{"kind":"reschedule_request","actor":"previous_provider"}]','earlier provider labelled as previous');
select is(public.job_schedule('92300000-0000-4000-8000-000000000006') ->> 'has_provider','false','no provider attached after withdrawal');
reset role;

select * from finish();
rollback;
