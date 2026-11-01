-- Phase 6.6 / TRACE-123: recurring plan terms recorded at acceptance, duplicate-safe visit
-- creation at an explicit Eastern wall time, honest blocked outcomes without substitution,
-- visit-specific acceptance and work, commercial identities per visit, append-only history and
-- role readback. Synthetic data only; amounts are test examples, not prices.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 homeowner A, 2 homeowner B, 3 plan provider, 4 other provider, 5–6 operators (also the
-- two finance actors for one snapshot).
insert into auth.users(id,email) select ('95100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'recurring-'||n||'@example.invalid'
  from generate_series(1,6) n;
delete from public.user_roles where user_id in ('95100000-0000-4000-8000-000000000003','95100000-0000-4000-8000-000000000004','95100000-0000-4000-8000-000000000005','95100000-0000-4000-8000-000000000006');
insert into public.user_roles(user_id,role) values
 ('95100000-0000-4000-8000-000000000003','vendor'),('95100000-0000-4000-8000-000000000004','vendor'),
 ('95100000-0000-4000-8000-000000000005','admin'),('95100000-0000-4000-8000-000000000006','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('95100000-0000-4000-8000-000000000005','95100000-0000-4000-8000-000000000006','Synthetic'),
 ('95100000-0000-4000-8000-000000000006','95100000-0000-4000-8000-000000000005','Synthetic');
insert into public.service_categories(id,name) values ('synthetic-rv-cat','Synthetic recurring');
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,monthly_price,default_frequency,available_frequencies,is_active)
  values ('synthetic-rv-lawn','Synthetic recurring lawn','synthetic-rv-cat',60,40,120,'weekly','{one-time,weekly,monthly}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00095','Synthetic',true,false);
insert into private.r0_lee_zips values ('00095');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
  select ('95100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00095','synthetic-rv-lawn','95100000-0000-4000-8000-000000000005'
  from unnest(array[1,2]) n;
-- Provider 2 is cheaper; it must never be offered a visit of provider 1's plan.
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('95200000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000003','Synthetic plan provider',true,true),
 ('95200000-0000-4000-8000-000000000002','95100000-0000-4000-8000-000000000004','Synthetic cheaper provider',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('95200000-0000-4000-8000-000000000001','00095'),('95200000-0000-4000-8000-000000000002','00095');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('95400000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001','synthetic-rv-lawn','Synthetic plan lawn','fixed','weekly',true,false),
 ('95400000-0000-4000-8000-000000000002','95200000-0000-4000-8000-000000000002','synthetic-rv-lawn','Synthetic cheaper lawn','fixed','weekly',true,false);
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('95500000-0000-4000-8000-000000000001','95400000-0000-4000-8000-000000000001','Weekly',40,'weekly',0,'[]'),
 ('95500000-0000-4000-8000-000000000002','95400000-0000-4000-8000-000000000001','Monthly',120,'monthly',1,'[]'),
 ('95500000-0000-4000-8000-000000000003','95400000-0000-4000-8000-000000000002','Weekly',30,'weekly',0,'[]'),
 ('95500000-0000-4000-8000-000000000004','95400000-0000-4000-8000-000000000002','Monthly',100,'monthly',1,'[]');
insert into public.package_addons(id,package_id,name,price,price_kind,unit_label,min_quantity,max_quantity,is_required,frequencies,sort_order) values
 ('95600000-0000-4000-8000-000000000001','95400000-0000-4000-8000-000000000001','Edge trimming',5,'exact','visit',0,1,false,'{weekly}',0);

create temp table fx(key text primary key, id uuid);
grant select, insert on fx to authenticated;
create function pg_temp.u(n integer) returns uuid language sql as $$ select ('95100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from fx where key = k $$;
create function pg_temp.k(n integer) returns uuid language sql as $$ select ('95700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.call(p_user integer, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb; previous text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.u(p_user))::text,true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
  return r;
end $$;
create function pg_temp.submit(p_user integer, p_key text, p_frequency text, p_tier uuid, p_addon boolean, p_total numeric) returns uuid language sql as $$
  select (pg_temp.call(p_user, format('select public.submit_service_requests(%L,%L::jsonb)', p_key, jsonb_build_object(
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00095'),
    'preferred_time','Synthetic window','selections',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'service_id','synthetic-rv-lawn','frequency',p_frequency,'package_id','95400000-0000-4000-8000-000000000001','tier_id',p_tier,
      'preferred_contractor_id','95200000-0000-4000-8000-000000000001',
      'addons',case when p_addon then jsonb_build_array(jsonb_build_object('id','95600000-0000-4000-8000-000000000001','quantity',1)) end,
      'expected',jsonb_build_object('pricing_mode','fixed','total',p_total)))))))#>>'{requests,0,request_id}')::uuid $$;
-- The real acceptance path: the matching offer, then the provider accepts it.
create function pg_temp.accept(p_request uuid, p_vendor integer default 3) returns void language plpgsql as $$
begin
  perform private.offer_next_for_request_internal(p_request);
  perform pg_temp.call(p_vendor, format('select to_jsonb(public.vendor_accept_job(%L))', p_request));
end $$;
-- An operator adds a visit at an Eastern wall time; p_zone says how the instant is computed.
create function pg_temp.visit(p_user integer, p_series uuid, p_key uuid, p_local timestamp, p_reason text default 'Synthetic visit',
  p_zone text default 'America/New_York') returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,%L)',
    p_series, p_key, p_local at time zone p_zone, p_local, p_reason)) $$;
create function pg_temp.visits(p_series uuid) returns bigint language sql as $$
  select count(*) from public.service_requests where recurrence_parent_id = p_series $$;
create function pg_temp.offers_to(p_contractor uuid) returns bigint language sql as $$
  select count(*) from public.job_match_attempts a join public.service_requests r on r.id = a.service_request_id
  where a.contractor_id = p_contractor and r.recurrence_parent_id is not null $$;
create function pg_temp.generations(p_series uuid) returns bigint language sql as $$
  select count(*) from private.recurring_visit_generations where series_id = p_series $$;
create function pg_temp.day(n integer, t time default '09:00') returns timestamp language sql stable as $$
  select (now() at time zone 'America/New_York')::date + n + t $$;
select set_config('t.spring',(m + ((7 - extract(dow from m)::int) % 7) + 7)::text,true)
 from (select make_date(extract(year from now())::int + 1,3,1) m) s;
select set_config('t.fall',(m + ((7 - extract(dow from m)::int) % 7))::text,true)
 from (select make_date(extract(year from now())::int + 1,11,1) m) s;
select set_config('t.year',(extract(year from now())::int + 1)::text,true);

-- Plans --------------------------------------------------------------------------------------
-- S1: homeowner A, weekly at $40 with one add-on ($45 a visit). S2: homeowner A, monthly, no
-- add-ons. S3: homeowner B, weekly. R1: a one-time request.
insert into fx values ('s1', pg_temp.submit(1,'rv-s1-000000000001','weekly','95500000-0000-4000-8000-000000000001',true,45));
insert into fx values ('s2', pg_temp.submit(1,'rv-s2-000000000001','monthly','95500000-0000-4000-8000-000000000002',false,120));
insert into fx values ('s3', pg_temp.submit(2,'rv-s3-000000000001','weekly','95500000-0000-4000-8000-000000000001',false,40));
insert into public.service_requests(id,customer_id,service_type,service_catalog_id,address,city,state,zip_code,frequency,status)
  values ('95300000-0000-4000-8000-000000000003',pg_temp.u(1),'Synthetic','synthetic-rv-lawn','1 Synthetic Way','Synthetic','FL','00095','one-time','pending');
insert into fx values ('r1', '95300000-0000-4000-8000-000000000003');
select isnt(pg_temp.id('s1'), null, 'the weekly plan is submitted');

select is((select count(*) from private.recurring_series_terms), 0::bigint, 'no terms before a provider accepts');
select pg_temp.accept(pg_temp.id('s1'));
select pg_temp.accept(pg_temp.id('s2'));
select pg_temp.accept(pg_temp.id('s3'));
select is((select row(contractor_id, package_id, package_tier_id, frequency, pricing_mode, visit_price::numeric(12,2), visit_total::numeric(12,2), pricing_inputs is not null,
    package_revision = private.package_revision_hash(package_id))::text
  from private.recurring_series_terms where series_id = pg_temp.id('s1')),
  '(95200000-0000-4000-8000-000000000001,95400000-0000-4000-8000-000000000001,95500000-0000-4000-8000-000000000001,weekly,fixed,40.00,45.00,t,t)',
  'acceptance records the plan terms: provider, package, level, revision, visit price and add-on total');
select is((select row(visit_price::numeric(12,2), visit_total::numeric(12,2), pricing_inputs is null)::text from private.recurring_series_terms where series_id = pg_temp.id('s2')),
  '(120.00,120.00,t)', 'a plan without add-ons records its visit price');
select is((select count(*) from private.recurring_series_terms), 3::bigint, 'one terms record per accepted plan');
select is((select count(*) from public.job_visits where service_request_id in (pg_temp.id('s1'), pg_temp.id('s2'), pg_temp.id('s3'))), 0::bigint,
  'the legacy generator adds no shadow visits to an accepted plan');
select is((select count(*) from private.recurring_series_terms where series_id = pg_temp.id('r1')), 0::bigint, 'a one-time request is not a plan');

-- Access -------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon','public.admin_create_recurring_visit(uuid,uuid,timestamptz,timestamp,text)','execute')
  and has_function_privilege('authenticated','public.admin_create_recurring_visit(uuid,uuid,timestamptz,timestamp,text)','execute'),
  'visit creation is callable by signed-in callers only, and checks the role itself');
select ok(not has_function_privilege('anon','public.recurring_series(uuid)','execute'), 'anonymous cannot read a plan');
select ok(not has_table_privilege('authenticated','private.recurring_series_terms','select')
  and not has_table_privilege('authenticated','private.recurring_visit_generations','insert')
  and not has_table_privilege('authenticated','private.recurring_visit_generations','select'), 'plan records have no direct client access');
select throws_ok($$select pg_temp.visit(1, pg_temp.id('s1'), pg_temp.k(1), pg_temp.day(10))$$, '42501', 'Admin access required', 'the homeowner cannot add a visit');
select throws_ok($$select pg_temp.visit(3, pg_temp.id('s1'), pg_temp.k(1), pg_temp.day(10))$$, '42501', 'Admin access required', 'the plan provider cannot add a visit');
select is(pg_temp.generations(pg_temp.id('s1')), 0::bigint, 'refused callers record nothing');

-- Input that is not a visit time is refused, and records nothing.
select throws_ok($$select pg_temp.visit(5, pg_temp.id('r1'), pg_temp.k(1), pg_temp.day(10))$$, '22023', 'Recurring plan required', 'a one-time request has no visits');
select throws_ok($$select pg_temp.visit(5, '95300000-0000-4000-8000-0000000000ff', pg_temp.k(1), pg_temp.day(10))$$, '22023', 'Service not found', 'a missing plan is refused');
select throws_ok($$select pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(1), pg_temp.day(10), 'Synthetic', 'America/Los_Angeles')$$, '22023',
  'The visit time does not match the Eastern Time entered', 'a device-shifted instant is refused');
select throws_ok($$select pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,''Synthetic'')',
  pg_temp.id('s1'), pg_temp.k(1), (pg_temp.day(10) at time zone 'America/New_York') + interval '30 seconds', pg_temp.day(10) + interval '30 seconds'))$$,
  '22023', 'The visit time does not match the Eastern Time entered', 'seconds are refused');
select throws_ok($$select pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(1), pg_temp.day(-1))$$, '22023', 'Choose a future visit time', 'a past visit is refused');
select throws_ok($$select pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(1), pg_temp.day(10), ' ')$$, '22023', null, 'a reason is required');
select throws_ok($$select pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(1), (current_setting('t.spring')::date + time '02:30'))$$, '22023',
  'The visit time does not match the Eastern Time entered', 'a spring-forward time that does not exist is refused');
select throws_ok($$select pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,''Synthetic'')',
  pg_temp.id('s1'), pg_temp.k(1), (current_setting('t.spring')::date + time '02:30') at time zone 'UTC' + interval '4 hours', current_setting('t.spring')::date + time '02:30'))$$,
  '22023', 'The visit time does not match the Eastern Time entered', '... under either offset');
select is(pg_temp.generations(pg_temp.id('s1')), 0::bigint, 'invalid input records nothing');

-- Creation, replay and the same visit from another operator -----------------------------------
insert into fx values ('v1', (pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(1), pg_temp.day(10), 'First visit agreed')->>'occurrence_id')::uuid);
select is((select row(recurrence_parent_id, occurrence_key = private.recurring_visit_key(pg_temp.id('s1'), pg_temp.day(10)::date),
    (scheduled_start_at at time zone 'America/New_York'), timezone, preferred_date, preferred_contractor_id, contractor_id, status::text,
    matching_status, package_id, package_tier_id, frequency, total_amount, pricing_inputs = (select pricing_inputs from public.service_requests where id = pg_temp.id('s1')))::text
  from public.service_requests where id = pg_temp.id('v1')),
  row(pg_temp.id('s1'), true, pg_temp.day(10), 'America/New_York', pg_temp.day(10)::date, '95200000-0000-4000-8000-000000000001'::uuid,
    '95200000-0000-4000-8000-000000000001'::uuid, 'matched', 'offered', '95400000-0000-4000-8000-000000000001'::uuid,
    '95500000-0000-4000-8000-000000000001'::uuid, 'weekly', 45.00, true)::text,
  'the visit is its own request: plan, date-derived identity, Eastern time, plan provider, package, level and add-on total');
select is((select row(contractor_id, package_id, package_tier_id, base_price::numeric(12,2), effective_price::numeric(12,2), outcome)::text from public.job_match_attempts where service_request_id = pg_temp.id('v1')),
  '(95200000-0000-4000-8000-000000000001,95400000-0000-4000-8000-000000000001,95500000-0000-4000-8000-000000000001,40.00,45.00,pending)',
  'the visit has its own exclusive offer to the plan provider on the plan terms');
select is(pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(1), pg_temp.day(10), 'First visit agreed') - 'generation_id' - 'visit_key' - 'starts_at' - 'local_start',
  jsonb_build_object('code', null, 'outcome', 'created', 'replayed', true, 'timezone', 'America/New_York', 'occurrence_id', pg_temp.id('v1'),
    'source', 'manual', 'cadence_date', null),
  'a retry with the same key and intent returns the recorded result');
select throws_ok($$select pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(1), pg_temp.day(10, '10:00'), 'First visit agreed')$$, '22023',
  'Operation key reused with different intent', 'the same key with another time is refused');
select throws_ok($$select pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(1), pg_temp.day(10), 'Another reason')$$, '22023',
  'Operation key reused with different intent', 'the same key with another reason is refused');
select throws_ok($$select pg_temp.visit(6, pg_temp.id('s1'), pg_temp.k(1), pg_temp.day(10), 'First visit agreed')$$, '22023',
  'Operation key reused with different intent', 'another operator cannot reuse the key');
select is((pg_temp.visit(6, pg_temp.id('s1'), pg_temp.k(2), pg_temp.day(10), 'Same visit, second operator')->>'outcome'), 'existing',
  'another key for the same visit reaches the existing visit');
select is((pg_temp.visit(6, pg_temp.id('s1'), pg_temp.k(2), pg_temp.day(10), 'Same visit, second operator')->>'occurrence_id')::uuid, pg_temp.id('v1'), '... the same one');
select is((pg_temp.visit(6, pg_temp.id('s1'), pg_temp.k(3), pg_temp.day(10, '15:00'), 'Same day, other time')->>'code'), 'visit_date_taken',
  'a second visit on the same Eastern date is blocked');
select is((pg_temp.visit(6, pg_temp.id('s1'), pg_temp.k(3), pg_temp.day(10, '15:00'), 'Same day, other time')->>'occurrence_id')::uuid, pg_temp.id('v1'),
  '... naming the visit already there');
select is(pg_temp.visits(pg_temp.id('s1')), 1::bigint, 'one visit for the intended date');
select is((select count(*) from public.job_match_attempts where service_request_id = pg_temp.id('v1')), 1::bigint, 'one offer for it');
select is(pg_temp.generations(pg_temp.id('s1')), 3::bigint, 'three attempts recorded: created, existing, blocked');

insert into fx values ('v2', (pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(4), pg_temp.day(17), 'Second visit')->>'occurrence_id')::uuid);
select isnt(pg_temp.id('v2'), pg_temp.id('v1'), 'the next week is a separate visit');
select isnt((select occurrence_key from public.service_requests where id = pg_temp.id('v2')), (select occurrence_key from public.service_requests where id = pg_temp.id('v1')),
  'with its own identity');
select is((select count(*) from public.notifications where user_id = pg_temp.u(1) and title = 'Recurring visit added'), 2::bigint,
  'the homeowner is told once per created visit, not per attempt');
select is((select count(*) from public.notifications n where n.user_id = pg_temp.u(3) and n.type = 'job_offer'
  and n.related_request_id in (pg_temp.id('v1'), pg_temp.id('v2'))), 2::bigint, 'the provider receives one offer notice per visit');
select is((select body from public.notifications where user_id = pg_temp.u(1) and related_request_id = pg_temp.id('v1') and title = 'Recurring visit added'),
  to_char(pg_temp.day(10), 'Dy, Mon FMDD, YYYY') || ', 9:00 AM ' || case when extract(timezone_hour from (pg_temp.day(10) at time zone 'America/New_York')) = -4 then 'EDT' else 'EST' end
  || ' (Eastern Time). The provider accepts each visit separately. First visit agreed', 'the notice names the Eastern time and the reason');

-- Daylight saving and month ends: the visit keeps its Eastern wall time; each date is its own visit.
insert into fx values ('dst-before', (pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(10), current_setting('t.spring')::date - 7 + time '09:00', 'Week before spring forward')->>'occurrence_id')::uuid);
insert into fx values ('dst-after', (pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(11), current_setting('t.spring')::date + time '09:00', 'Spring forward day')->>'occurrence_id')::uuid);
select is((select scheduled_start_at from public.service_requests where id = pg_temp.id('dst-after')) - (select scheduled_start_at from public.service_requests where id = pg_temp.id('dst-before')),
  interval '7 days' - interval '1 hour', 'across spring forward the visits are a week apart at 9:00 AM Eastern, 167 hours');
select is((select (scheduled_start_at at time zone 'UTC')::time from public.service_requests where id = pg_temp.id('dst-after')), time '13:00', '9:00 AM EDT is 13:00 UTC');
select is((pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,''Fall back, first 1:30'')', pg_temp.id('s1'), pg_temp.k(12),
  ((current_setting('t.fall')::date + time '01:30') at time zone 'UTC') + interval '4 hours', current_setting('t.fall')::date + time '01:30'))->>'outcome'),
  'created', 'on the fall-back date the first 1:30 AM (EDT, 05:30 UTC) is a visit');
select is((pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,''Fall back, second 1:30'')', pg_temp.id('s1'), pg_temp.k(13),
  ((current_setting('t.fall')::date + time '01:30') at time zone 'UTC') + interval '5 hours', current_setting('t.fall')::date + time '01:30'))->>'code'),
  'visit_date_taken', 'the repeated 1:30 AM (EST) is the same Eastern date, so it is not a second visit');
insert into fx select 'month-' || n, (pg_temp.visit(5, pg_temp.id('s2'), pg_temp.k(20 + n), d + time '10:00', 'Month end')->>'occurrence_id')::uuid
  from (values (1, make_date(current_setting('t.year')::int, 1, 31)), (2, make_date(current_setting('t.year')::int, 2, 28)),
    (3, make_date(current_setting('t.year')::int, 3, 31)), (4, make_date(current_setting('t.year')::int, 4, 30))) m(n, d);
select is((select array_agg((scheduled_start_at at time zone 'America/New_York')::date order by scheduled_start_at) from public.service_requests where recurrence_parent_id = pg_temp.id('s2')),
  array[make_date(current_setting('t.year')::int, 1, 31), make_date(current_setting('t.year')::int, 2, 28), make_date(current_setting('t.year')::int, 3, 31),
    make_date(current_setting('t.year')::int, 4, 30)], 'month-end dates are kept exactly as entered; nothing is shifted');
select is((select count(distinct occurrence_key) from public.service_requests where recurrence_parent_id = pg_temp.id('s2')), 4::bigint, 'four dates, four identities');

-- Visit-specific acceptance, work and the plan itself ----------------------------------------
select lives_ok($$select pg_temp.call(3, format('select to_jsonb(public.vendor_accept_job(%L))', pg_temp.id('v1')))$$, 'the provider accepts visit 1');
select is((select row(r1.status, r2.status, r2.matching_status)::text from public.service_requests r1, public.service_requests r2
  where r1.id = pg_temp.id('v1') and r2.id = pg_temp.id('v2')), '(scheduled,matched,offered)', 'accepting one visit does not accept the next');
select is((select count(*) from private.recurring_series_terms where series_id in (pg_temp.id('v1'), pg_temp.id('v2'))), 0::bigint,
  'accepting a visit does not create plan terms');
select lives_ok($$select pg_temp.call(3, format('select to_jsonb(public.transition_job_status(%L,''in_progress''))', pg_temp.id('v1')))$$, 'work starts on visit 1');
select is((select status::text from public.service_requests where id = pg_temp.id('v2')), 'matched', 'visit 2 is untouched');
select throws_ok($$select pg_temp.call(3, format('select to_jsonb(public.transition_job_status(%L,''in_progress''))', pg_temp.id('s1')))$$, '22023',
  'Work is recorded on each recurring visit, not on the plan', 'the plan itself cannot be started');
select throws_ok($$update public.service_requests set status = 'vendor_completed' where id = pg_temp.id('s2')$$, '22023',
  'Work is recorded on each recurring visit, not on the plan', 'not even by a direct write');
select is((select count(*) from public.job_visits where service_request_id in (select id from public.service_requests where recurrence_parent_id = pg_temp.id('s1'))), 0::bigint,
  'no shadow visits for accepted visits');

-- Commercial identity per visit: snapshot publication binds visit 1 only; nothing was invoiced or charged by creation.
select is((select count(*) from public.money_obligations where service_request_id in (select id from public.service_requests where recurrence_parent_id is not null and customer_id::text like '95100000-%')), 0::bigint,
  'creating visits creates no payment obligation');
select is((select count(*) from public.invoices where service_request_id in (select id from public.service_requests where recurrence_parent_id is not null and customer_id::text like '95100000-%')), 0::bigint,
  'or invoice');
select is((select count(*) from public.money_checkout_attempts), 0::bigint, 'or checkout attempt');
create function pg_temp.terms(request uuid) returns jsonb language sql as $$ select jsonb_build_object(
 'service',4000,'addons',500,'discount',0,'adjustment',0,'subtotal',4500,'tax',0,'tip',0,'deposit',0,'total',4500,'currency','usd',
 'source_version',private.money_source(request)->>'version','policy_version','CFG-005','tax_evidence','synthetic-tax-decision',
 'reason','Synthetic recurring visit','expires_at',now()+interval '1 day') $$;
create function pg_temp.publish(request uuid) returns uuid language plpgsql as $$
declare terms jsonb:=pg_temp.terms(request); prior text:=current_setting('request.jwt.claims',true);
begin
 perform set_config('request.jwt.claims','{"role":"authenticated","sub":"95100000-0000-4000-8000-000000000006"}',true);
 perform public.money_approve_review('95100000-0000-4000-8000-000000000005',
   jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Independent visit review');
 perform set_config('request.jwt.claims',coalesce(prior,''),true);
 return public.money_publish_snapshot(request,terms,'95100000-0000-4000-8000-000000000005','95100000-0000-4000-8000-000000000006');
end $$;
-- Visit 1 is in progress; the source needs a scheduled visit, so publish on a second accepted visit.
select lives_ok($$select pg_temp.call(3, format('select to_jsonb(public.vendor_accept_job(%L))', pg_temp.id('v2')))$$, 'the provider accepts visit 2 separately');
select lives_ok($$select pg_temp.publish(pg_temp.id('v2'))$$, 'visit 2 receives its own reviewed commercial snapshot');
select is((select row(template_request_id, occurrence_key, scheduled_at, frequency)::text from public.money_recurring_occurrence_identities where occurrence_request_id = pg_temp.id('v2')),
  (select row(pg_temp.id('s1'), occurrence_key, scheduled_start_at, 'weekly')::text from public.service_requests where id = pg_temp.id('v2')),
  'the commercial identity binds the plan, the visit identity and its appointment');
select is((select (private.money_source(pg_temp.id('v2'))->>'addons')::bigint), 500::bigint, 'the add-on is part of the visit''s commercial source');
select is((select count(*) from public.money_recurring_occurrence_identities where occurrence_request_id = pg_temp.id('v1')), 0::bigint,
  'visit 1 has no commercial identity until its own snapshot');
select throws_ok($$select pg_temp.publish(pg_temp.id('s1'))$$, 'P0001', null, 'the plan itself still cannot be charged');

-- Honest blocked outcomes: no visit, no offer, no substitution, a recorded reason --------------
create function pg_temp.blocked(p_series uuid, p_key integer, p_day integer) returns text language sql as $$
  select pg_temp.visit(5, p_series, pg_temp.k(p_key), pg_temp.day(p_day), 'Synthetic blocked case')->>'code' $$;
select set_config('t.visits', pg_temp.visits(pg_temp.id('s1'))::text, true);
select set_config('t.offers', (select count(*) from public.job_match_attempts)::text, true);
select set_config('t.notices', (select count(*) from public.notifications where user_id = pg_temp.u(1))::text, true);

update public.package_tiers set price = 42 where id = '95500000-0000-4000-8000-000000000001';
select is(pg_temp.blocked(pg_temp.id('s1'), 30, 24), 'terms_changed', 'a price change after acceptance blocks the visit');
update public.package_tiers set price = 40 where id = '95500000-0000-4000-8000-000000000001';
update public.package_addons set price = 6 where id = '95600000-0000-4000-8000-000000000001';
select is(pg_temp.blocked(pg_temp.id('s1'), 31, 24), 'terms_changed', 'so does an add-on change (a new package revision)');
update public.package_addons set price = 5 where id = '95600000-0000-4000-8000-000000000001';
delete from public.contractor_service_zips where contractor_id = '95200000-0000-4000-8000-000000000001';
select is(pg_temp.blocked(pg_temp.id('s1'), 32, 24), 'provider_ineligible', 'a provider who no longer serves the ZIP is not offered the visit');
insert into public.contractor_service_zips(contractor_id,zip_code) values ('95200000-0000-4000-8000-000000000001','00095');
update private.r0_trial_admissions set is_active = false, revoked_at = now(), revoked_by = pg_temp.u(5) where homeowner_id = pg_temp.u(1);
select is(pg_temp.blocked(pg_temp.id('s1'), 33, 24), 'homeowner_not_admitted', 'a homeowner whose admission ended gets no new visit');
update private.r0_trial_admissions set is_active = true, revoked_at = null, revoked_by = null where homeowner_id = pg_temp.u(1);
update public.service_requests set address = '2 Synthetic Way' where id = pg_temp.id('s1');
select is(pg_temp.blocked(pg_temp.id('s1'), 34, 24), 'terms_changed', 'a changed property is not the accepted plan');
update public.service_requests set address = '1 Synthetic Way' where id = pg_temp.id('s1');
insert into public.package_promotions(id,package_id,promotion_type,percent_off,starts_at,ends_at,is_enabled)
  values ('95800000-0000-4000-8000-000000000001','95400000-0000-4000-8000-000000000001','percent_off',10,now()-interval '1 day',now()-interval '1 hour',false);
update public.service_requests set promotion_id = '95800000-0000-4000-8000-000000000001' where id = pg_temp.id('s2');
select is(pg_temp.blocked(pg_temp.id('s2'), 35, 24), 'promotion_decision', 'a plan with a promotion waits for the per-visit promotion decision');
update public.service_requests set promotion_id = null where id = pg_temp.id('s2');
select is(pg_temp.visits(pg_temp.id('s1'))::text, current_setting('t.visits'), 'blocked attempts create no visit');
select is((select count(*) from public.job_match_attempts)::text, current_setting('t.offers'), 'and no offer');
select is(pg_temp.offers_to('95200000-0000-4000-8000-000000000002'), 0::bigint, 'the cheaper provider was never offered a plan visit');
select is((select count(*) from public.notifications where user_id = pg_temp.u(1))::text, current_setting('t.notices'), 'and the homeowner is not told of a visit');
select is((select array_agg(block_code order by seq) from private.recurring_visit_generations where operation_key in (pg_temp.k(30), pg_temp.k(31), pg_temp.k(32), pg_temp.k(33), pg_temp.k(34))),
  array['terms_changed','terms_changed','provider_ineligible','homeowner_not_admitted','terms_changed'], 'each blocked attempt is recorded with its reason');
select is(pg_temp.blocked(pg_temp.id('s1'), 32, 24), 'provider_ineligible', 'retrying a blocked key returns its recorded outcome, even after the cause is fixed');
select is(pg_temp.visit(5, pg_temp.id('s1'), pg_temp.k(36), pg_temp.day(24), 'Recovered after the ZIP was restored')->>'outcome', 'created',
  'operations recovers with a new attempt once the cause is fixed');

-- A cancelled plan, a plan never accepted, a quote plan.
select throws_ok($$select pg_temp.call(2, format('select public.record_job_operation(%L,%L,''customer_cancel'',''Synthetic plan ended'')', pg_temp.id('s3'), pg_temp.k(90)))$$,
  '22023', 'Changes are made on each visit. Mercurius can stop future visits on the plan.', 'TRACE-131: homeowner B cannot cancel accepted plan S3; plans use Stop future visits');
-- A plan cancelled before TRACE-131 (owner maintenance stands in for the old path).
set local mercurius.owner_maintenance = 'on';
update public.service_requests set status = 'cancelled' where id = pg_temp.id('s3');
set local mercurius.owner_maintenance = 'off';
select is(pg_temp.blocked(pg_temp.id('s3'), 37, 12), 'series_not_active', 'a cancelled plan gets no new visit');
insert into public.service_requests(id,customer_id,contractor_id,service_type,service_catalog_id,address,city,state,zip_code,frequency,status,matching_status,pricing_mode,package_id,package_tier_id)
  values ('95300000-0000-4000-8000-000000000001',pg_temp.u(1),'95200000-0000-4000-8000-000000000001','Synthetic','synthetic-rv-lawn','1 Synthetic Way','Synthetic','FL','00095',
   'weekly','scheduled','matched','fixed','95400000-0000-4000-8000-000000000001','95500000-0000-4000-8000-000000000001'),
   ('95300000-0000-4000-8000-000000000002',pg_temp.u(1),'95200000-0000-4000-8000-000000000001','Synthetic','synthetic-rv-lawn','1 Synthetic Way','Synthetic','FL','00095',
   'weekly','scheduled','matched','custom_quote',null,null);
insert into public.job_match_attempts(id,service_request_id,contractor_id,outcome,accepted_at,offer_path,frequency)
  values ('95900000-0000-4000-8000-000000000001','95300000-0000-4000-8000-000000000002','95200000-0000-4000-8000-000000000001','accepted',now(),'quote','weekly');
insert into private.recurring_series_terms(series_id,accepted_offer_id,customer_id,contractor_id,service_catalog_id,frequency,pricing_mode,address,city,state,zip_code,accepted_at)
  values ('95300000-0000-4000-8000-000000000002','95900000-0000-4000-8000-000000000001',pg_temp.u(1),'95200000-0000-4000-8000-000000000001','synthetic-rv-lawn','weekly','custom_quote',
   '1 Synthetic Way','Synthetic','FL','00095',now());
select is(pg_temp.blocked('95300000-0000-4000-8000-000000000001', 38, 12), 'terms_missing', 'a plan with no recorded acceptance gets no visit');
select is(pg_temp.blocked('95300000-0000-4000-8000-000000000002', 39, 12), 'quote_terms', 'a quoted plan waits for the per-visit quote decision');
select throws_ok($$select pg_temp.visit(5, pg_temp.id('v1'), pg_temp.k(40), pg_temp.day(12))$$, '22023', 'Recurring plan required', 'a visit is not a plan');

-- History is append-only --------------------------------------------------------------------
select throws_ok($$update private.recurring_visit_generations set reason = 'rewritten'$$, '55000', 'Recurring plan history is append-only', 'history cannot be rewritten');
select throws_ok($$delete from private.recurring_visit_generations$$, '55000', 'Recurring plan history is append-only', 'or deleted');
select throws_ok($$update private.recurring_series_terms set visit_price = 1$$, '55000', 'Recurring plan history is append-only', 'accepted terms cannot be rewritten');

-- Readback -----------------------------------------------------------------------------------
select is(pg_temp.call(1, format('select public.recurring_series(%L)', pg_temp.id('s1'))) -> 'terms',
  jsonb_build_object('provider','Synthetic plan provider','package','Synthetic plan lawn','price_level','Weekly','pricing_mode','fixed','frequency','weekly',
    'visit_price',40.00,'visit_total',45.00,'has_addons',true,'accepted_at',(select accepted_at from private.recurring_series_terms where series_id = pg_temp.id('s1'))),
  'the homeowner reads the accepted plan terms');
select is((select array_agg(v->>'status' order by v->>'starts_at') from jsonb_array_elements(pg_temp.call(1, format('select public.recurring_series(%L)', pg_temp.id('s1'))) -> 'visits') v
  where (v->>'id')::uuid in (pg_temp.id('v1'), pg_temp.id('v2'))), array['in_progress','scheduled'], 'and each visit''s own status');
select is((select v->>'payment' from jsonb_array_elements(pg_temp.call(1, format('select public.recurring_series(%L)', pg_temp.id('s1'))) -> 'visits') v
  where (v->>'id')::uuid = pg_temp.id('v2')), 'awaiting_payment', 'the homeowner sees visit 2 awaiting payment');
select is((select v->>'payment' from jsonb_array_elements(pg_temp.call(1, format('select public.recurring_series(%L)', pg_temp.id('s1'))) -> 'visits') v
  where (v->>'id')::uuid = pg_temp.id('v1')), 'none', 'and visit 1 not invoiced');
select is((select count(*) from jsonb_array_elements(pg_temp.call(3, format('select public.recurring_series(%L)', pg_temp.id('s1'))) -> 'visits') v
  where v ? 'payment' and v->'payment' <> 'null'::jsonb), 0::bigint, 'the provider does not see payment state');
select is(pg_temp.call(3, format('select public.recurring_series(%L)', pg_temp.id('v1'))) ->> 'series_id', pg_temp.id('s1')::text,
  'a visit resolves to its plan');
select throws_ok($$select pg_temp.call(2, format('select public.recurring_series(%L)', pg_temp.id('s1')))$$, '42501', 'Not a participant in this service', 'another homeowner is refused');
select throws_ok($$select pg_temp.call(4, format('select public.recurring_series(%L)', pg_temp.id('s1')))$$, '42501', 'Not a participant in this service', 'another provider is refused');
select throws_ok($$select pg_temp.call(1, 'select public.recurring_series(''95300000-0000-4000-8000-0000000000ff'')')$$, '42501', 'Not a participant in this service', 'a missing plan is refused alike');
select throws_ok($$select pg_temp.call(1, format('select public.recurring_series(%L)', pg_temp.id('r1')))$$, '22023', 'Recurring plan required', 'a one-time request has no plan view');
select is((select array_agg(h->>'outcome' order by ord) from jsonb_array_elements(pg_temp.call(5, format('select public.recurring_series(%L)', pg_temp.id('s1'))) -> 'history')
  with ordinality h(h, ord) where ord <= 3), array['created','existing','blocked'], 'history is in recorded order');
select is((select count(*) from jsonb_array_elements(pg_temp.call(6, format('select public.recurring_series(%L)', pg_temp.id('s1'))) -> 'history') h
  where h->>'operation_key' is not null), 2::bigint, 'an operator sees only their own operation keys');
select is((select count(*) from jsonb_array_elements(pg_temp.call(1, format('select public.recurring_series(%L)', pg_temp.id('s1'))) -> 'history') h
  where h->>'operation_key' is not null), 0::bigint, 'the homeowner sees none');
reset role;
set local role anon;
select throws_ok($$select public.recurring_series('95300000-0000-4000-8000-000000000001')$$, '42501', null, 'anonymous refused');
reset role;

-- The retired path ------------------------------------------------------------------------
select throws_ok($$select pg_temp.call(5, format('select to_jsonb(public.create_service_occurrence(%L,%L,%L,''Synthetic''))', pg_temp.id('s1'), gen_random_uuid(), now() + interval '40 days'))$$,
  '22023', 'Create recurring visits with admin_create_recurring_visit', 'caller-keyed occurrence creation is retired');

select * from finish();
rollback;
