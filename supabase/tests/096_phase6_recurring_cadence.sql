-- Phase 6.6b / TRACE-124: recurring cadence anchors, proposals, skipped and replaced cadence dates,
-- pause/resume/stop future visits (DEC-2026-049 items 1–4 and 9, owner decision 2026-10-26).
-- Proposals are read at fixed instants; commands run at the real time against future dates.
-- Synthetic data only; amounts are test examples, not prices.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Users: 1 homeowner A, 2 homeowner B, 3 plan provider, 5–6 operators.
insert into auth.users(id,email) select ('96100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cadence-'||n||'@example.invalid'
  from generate_series(1,6) n;
delete from public.user_roles where user_id in ('96100000-0000-4000-8000-000000000003','96100000-0000-4000-8000-000000000005','96100000-0000-4000-8000-000000000006');
insert into public.user_roles(user_id,role) values
 ('96100000-0000-4000-8000-000000000003','vendor'),('96100000-0000-4000-8000-000000000005','admin'),('96100000-0000-4000-8000-000000000006','admin');
insert into public.service_categories(id,name) values ('synthetic-rc-cat','Synthetic cadence');
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,monthly_price,default_frequency,available_frequencies,is_active)
  values ('synthetic-rc-lawn','Synthetic cadence lawn','synthetic-rc-cat',60,40,120,'weekly','{one-time,weekly,monthly}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00096','Synthetic',true,false);
insert into private.r0_lee_zips values ('00096');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
  select ('96100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00096','synthetic-rc-lawn','96100000-0000-4000-8000-000000000005'
  from unnest(array[1,2]) n;
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('96200000-0000-4000-8000-000000000001','96100000-0000-4000-8000-000000000003','Synthetic cadence provider',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values ('96200000-0000-4000-8000-000000000001','00096');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('96400000-0000-4000-8000-000000000001','96200000-0000-4000-8000-000000000001','synthetic-rc-lawn','Synthetic cadence lawn','fixed','weekly',true,false);
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('96500000-0000-4000-8000-000000000001','96400000-0000-4000-8000-000000000001','Weekly',40,'weekly',0,'[]'),
 ('96500000-0000-4000-8000-000000000002','96400000-0000-4000-8000-000000000001','Monthly',120,'monthly',1,'[]');

create temp table fx(key text primary key, id uuid);
grant select, insert on fx to authenticated;
create function pg_temp.u(n integer) returns uuid language sql as $$ select ('96100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from fx where key = k $$;
create function pg_temp.k(n integer) returns uuid language sql as $$ select ('96700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.p(n integer) returns uuid language sql as $$ select ('96300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
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
create function pg_temp.submit(p_user integer, p_key text, p_frequency text, p_tier uuid, p_total numeric) returns uuid language sql as $$
  select (pg_temp.call(p_user, format('select public.submit_service_requests(%L,%L::jsonb)', p_key, jsonb_build_object(
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00096'),
    'preferred_time','Synthetic window','selections',jsonb_build_array(jsonb_build_object(
      'service_id','synthetic-rc-lawn','frequency',p_frequency,'package_id','96400000-0000-4000-8000-000000000001','tier_id',p_tier,
      'preferred_contractor_id','96200000-0000-4000-8000-000000000001',
      'expected',jsonb_build_object('pricing_mode','fixed','total',p_total))))))#>>'{requests,0,request_id}')::uuid $$;
create function pg_temp.accept(p_request uuid) returns void language plpgsql as $$
begin
  perform private.offer_next_for_request_internal(p_request);
  perform pg_temp.call(3, format('select to_jsonb(public.vendor_accept_job(%L))', p_request));
end $$;
create function pg_temp.day(n integer, t time default '09:00') returns timestamp language sql stable as $$
  select (now() at time zone 'America/New_York')::date + n + t $$;
-- Commands. Instants are computed from the Eastern wall time unless p_zone says otherwise.
create function pg_temp.anchor(p_user integer, p_series uuid, p_key integer, p_local timestamp, p_expected uuid,
  p_basis text default 'Homeowner and provider agreed by phone', p_reason text default 'First visit agreed', p_zone text default 'America/New_York')
  returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.admin_record_recurring_anchor(%L,%L,%L,%L,%L,%L,%L)',
    p_series, pg_temp.k(p_key), p_expected, p_local at time zone p_zone, p_local, p_basis, p_reason)) $$;
create function pg_temp.cadence(p_user integer, p_series uuid, p_key integer, p_anchor uuid, p_date date, p_local timestamp,
  p_reason text default 'Proposed visit') returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.admin_create_cadence_visit(%L,%L,%L,%L,%L,%L,%L)',
    p_series, pg_temp.k(p_key), p_anchor, p_date, p_local at time zone 'America/New_York', p_local, p_reason)) $$;
create function pg_temp.manual(p_user integer, p_series uuid, p_key integer, p_local timestamp, p_reason text default 'Manual visit')
  returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,%L)',
    p_series, pg_temp.k(p_key), p_local at time zone 'America/New_York', p_local, p_reason)) $$;
create function pg_temp.resolve(p_user integer, p_series uuid, p_key integer, p_anchor uuid, p_date date, p_kind text, p_visit uuid,
  p_reason text default 'Synthetic decision') returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.admin_resolve_cadence_date(%L,%L,%L,%L,%L,%L,%L)',
    p_series, pg_temp.k(p_key), p_anchor, p_date, p_kind, p_visit, p_reason)) $$;
create function pg_temp.lifecycle(p_user integer, p_series uuid, p_key integer, p_action text, p_expected text,
  p_reason text default 'Synthetic plan change') returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.admin_set_recurring_plan_state(%L,%L,%L,%L,%L)',
    p_series, pg_temp.k(p_key), p_action, p_expected, p_reason)) $$;
create function pg_temp.read(p_user integer, p_series uuid) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select public.recurring_series(%L)', p_series)) $$;
create function pg_temp.current_anchor(p_series uuid) returns uuid language sql as $$
  select id from private.recurring_series_anchors where series_id = p_series order by seq desc limit 1 $$;
create function pg_temp.visits(p_series uuid) returns bigint language sql as $$
  select count(*) from public.service_requests where recurrence_parent_id = p_series $$;
create function pg_temp.visit_on(p_series uuid, p_date date) returns uuid language sql as $$
  select id from public.service_requests where recurrence_parent_id = p_series and occurrence_key = private.recurring_visit_key(p_series, p_date) $$;
-- Proposed cadence dates (comma-separated) as of an instant.
create function pg_temp.proposed(p_series uuid, p_at timestamptz) returns text language sql as $$
  select coalesce(string_agg(x.value->>'cadence_date', ',' order by x.ordinality), '')
  from jsonb_array_elements(private.recurring_cadence_preview(p_series, p_at)->'proposals') with ordinality x $$;
-- Every row in the money tables and invoices: creation previews and lifecycle actions add none.
create function pg_temp.money_rows() returns bigint language plpgsql as $$
declare total bigint := 0; n bigint; t record;
begin
  for t in select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
    and (table_name like 'money\_%' or table_name = 'invoices') and table_name <> 'money_authorities' loop
    execute format('select count(*) from public.%I', t.table_name) into n;
    total := total + n;
  end loop;
  return total;
end $$;

-- Plans that only the preview reads (fixed dates in 2031–2032), inserted directly with a provider.
create function pg_temp.plan(p_n integer, p_frequency text, p_status text default 'scheduled') returns uuid language sql as $$
  insert into public.service_requests(id,customer_id,contractor_id,service_type,service_catalog_id,address,city,state,zip_code,frequency,status,matching_status)
  values (pg_temp.p(p_n),pg_temp.u(1),case when p_status = 'scheduled' then '96200000-0000-4000-8000-000000000001'::uuid end,'Synthetic','synthetic-rc-lawn',
    '1 Synthetic Way','Synthetic','FL','00096',p_frequency,p_status::request_status,case when p_status = 'scheduled' then 'matched' else 'awaiting_match' end)
  returning id $$;
create function pg_temp.set_anchor(p_series uuid, p_local timestamp) returns uuid language sql as $$
  insert into private.recurring_series_anchors(series_id,replaces_anchor_id,operation_key,actor_id,starts_at,local_start,basis,reason)
  values (p_series, pg_temp.current_anchor(p_series), gen_random_uuid(), pg_temp.u(5), p_local at time zone 'America/New_York', p_local, 'Synthetic basis', 'Synthetic')
  returning id $$;
create function pg_temp.add_visit(p_series uuid, p_local timestamp, p_status text default 'pending') returns uuid language sql as $$
  insert into public.service_requests(customer_id,service_type,service_catalog_id,address,city,state,zip_code,frequency,status,
    recurrence_parent_id,occurrence_key,scheduled_start_at,preferred_date,timezone)
  values (pg_temp.u(1),'Synthetic','synthetic-rc-lawn','1 Synthetic Way','Synthetic','FL','00096','weekly',p_status::request_status,
    p_series,private.recurring_visit_key(p_series,p_local::date),p_local at time zone 'America/New_York',p_local::date,'America/New_York')
  returning id $$;
create function pg_temp.set_state(p_series uuid, p_action text, p_from text, p_to text) returns void language sql as $$
  insert into private.recurring_series_lifecycle(series_id,previous_id,operation_key,actor_id,action,from_state,to_state,reason)
  values (p_series,(select id from private.recurring_series_lifecycle where series_id = p_series order by seq desc limit 1),
    gen_random_uuid(),pg_temp.u(5),p_action,p_from,p_to,'Synthetic') $$;

-- Cadence arithmetic -------------------------------------------------------------------------
select is((select string_agg(private.recurring_cadence_date('2031-01-07','weekly',n)::text, ',' order by n) from generate_series(0,3) n),
  '2031-01-07,2031-01-14,2031-01-21,2031-01-28', 'weekly adds seven calendar days');
select is((select string_agg(private.recurring_cadence_date('2031-01-07','bi-monthly',n)::text, ',' order by n) from generate_series(0,2) n),
  '2031-01-07,2031-01-21,2031-02-04', 'every two weeks adds fourteen calendar days');
select is((select string_agg(private.recurring_cadence_date('2031-01-31','monthly',n)::text, ',' order by n) from generate_series(0,4) n),
  '2031-01-31,2031-02-28,2031-03-31,2031-04-30,2031-05-31', 'monthly keeps the 31st, clamping shorter months without drifting');
select is((select string_agg(private.recurring_cadence_date('2032-01-31','monthly',n)::text, ',' order by n) from generate_series(0,2) n),
  '2032-01-31,2032-02-29,2032-03-31', 'a leap year clamps to 29 February');
select is((select string_agg(private.recurring_cadence_date('2030-12-31','every-two-months',n)::text, ',' order by n) from generate_series(0,3) n),
  '2030-12-31,2031-02-28,2031-04-30,2031-06-30', 'every two months counts from the anchor');
select is((select string_agg(private.recurring_cadence_date('2028-02-29','quarterly',n)::text, ',' order by n) from generate_series(0,4) n),
  '2028-02-29,2028-05-29,2028-08-29,2028-11-29,2029-02-28', 'quarterly from a leap day, clamped in a common year');
select is(array[private.recurring_cadence_index('2031-01-31','monthly','2031-02-28'), private.recurring_cadence_index('2031-01-31','monthly','2031-03-31'),
  private.recurring_cadence_index('2031-01-07','bi-monthly','2031-01-21'), private.recurring_cadence_index('2028-02-29','quarterly','2029-02-28')],
  array[1,2,1,4], 'cadence dates are recognised');
select is(array[private.recurring_cadence_index('2031-01-31','monthly','2031-03-28'), private.recurring_cadence_index('2031-01-07','bi-monthly','2031-01-14'),
  private.recurring_cadence_index('2031-01-07','weekly','2031-01-06'), private.recurring_cadence_index('2031-01-31','quarterly','2031-02-28')],
  array[null,null,null,null]::integer[], 'other dates, and dates before the anchor, are not cadence dates');
select is((select count(*) from private.eastern_instants('2031-03-09 02:30')), 0::bigint, 'a spring-forward 2:30 AM has no instant');
select is((select string_agg(abbreviation, ',' order by starts_at) from private.eastern_instants('2031-11-02 01:30')), 'EDT,EST', 'a fall-back 1:30 AM has two');

-- Proposals at fixed instants -------------------------------------------------------------------
-- Weekly plan, anchored Tue 7 Jan 2031 09:00 EST.
select pg_temp.plan(11,'weekly');
insert into fx values ('a11', pg_temp.set_anchor(pg_temp.p(11),'2031-01-07 09:00'));
select is(pg_temp.proposed(pg_temp.p(11),'2031-01-06 13:00Z'), '2031-01-07,2031-01-14', 'the anchor itself is the first proposal; two are proposed');
select is(private.recurring_cadence_preview(pg_temp.p(11),'2031-01-06 13:00Z')->>'horizon_end', '2031-03-07', 'the horizon ends today + 60 Eastern days');
select is(pg_temp.proposed(pg_temp.p(11),'2031-01-06 14:00Z'), '2031-01-07,2031-01-14', 'a visit exactly 24 hours away is proposed');
select is(pg_temp.proposed(pg_temp.p(11),'2031-01-06 14:01Z'), '2031-01-14,2031-01-21', 'one under 24 hours away is not');
select is((private.recurring_cadence_preview(pg_temp.p(11),'2031-01-06 13:00Z')->'proposals'->0->>'starts_at')::timestamptz, '2031-01-07 14:00Z'::timestamptz,
  'a proposal carries its resolved instant');
insert into fx values ('pv14', pg_temp.add_visit(pg_temp.p(11),'2031-01-14 09:00','cancelled'));
select is(pg_temp.proposed(pg_temp.p(11),'2031-01-06 13:00Z'), '2031-01-07,2031-01-21',
  'a cancelled visit keeps its date handled (no make-up) but does not use up the two');
insert into fx values ('pv10', pg_temp.add_visit(pg_temp.p(11),'2031-01-10 11:00'));
select is(pg_temp.proposed(pg_temp.p(11),'2031-01-06 13:00Z'), '2031-01-07', 'an off-cadence future visit counts toward the two');
insert into fx values ('pv11', pg_temp.add_visit(pg_temp.p(11),'2031-01-11 11:00'));
select is(pg_temp.proposed(pg_temp.p(11),'2031-01-06 13:00Z'), '', 'two future visits: nothing more is proposed');
select is(private.recurring_cadence_preview(pg_temp.p(11),'2031-01-06 13:00Z')#>>'{next,cadence_date}', '2031-01-07',
  'the next cadence date is still shown');
select is((private.recurring_cadence_preview(pg_temp.p(11),'2031-01-06 13:00Z')->>'upcoming')::int, 2, 'and the visits it counted');
delete from public.service_requests where id = pg_temp.id('pv11');
insert into private.recurring_cadence_resolutions(series_id,anchor_id,cadence_date,kind,operation_key,actor_id,reason)
  values (pg_temp.p(11),pg_temp.id('a11'),'2031-01-07','skipped',gen_random_uuid(),pg_temp.u(5),'Synthetic');
select is(pg_temp.proposed(pg_temp.p(11),'2031-01-06 13:00Z'), '2031-01-21', 'a skipped date is not proposed');
insert into fx values ('a11b', pg_temp.set_anchor(pg_temp.p(11),'2031-01-08 10:00'));
select is(pg_temp.proposed(pg_temp.p(11),'2031-01-06 13:00Z'), '2031-01-08', 'a new anchor changes the proposals');
select pg_temp.set_state(pg_temp.p(11),'pause','active','paused');
select is(private.recurring_cadence_preview(pg_temp.p(11),'2031-01-06 13:00Z')->>'unavailable', 'paused', 'a paused plan proposes nothing');
select is(pg_temp.proposed(pg_temp.p(11),'2031-01-06 13:00Z'), '', 'not even the next date');
select pg_temp.set_state(pg_temp.p(11),'resume','paused','active');
select is(pg_temp.proposed(pg_temp.p(11),'2031-02-10 15:00Z'), '2031-02-12,2031-02-19', 'after resuming, dates that passed are not backfilled');
select is(pg_temp.proposed(pg_temp.p(11),'2031-02-12 14:00Z'), '2031-02-19,2031-02-26', 'a cadence time on the resume date under 24 hours away is not proposed');
select pg_temp.set_state(pg_temp.p(11),'stop','active','ended');
select is(private.recurring_cadence_preview(pg_temp.p(11),'2031-02-10 15:00Z')->>'unavailable', 'ended', 'a stopped plan proposes nothing');

-- Horizon: quarterly can have nothing inside 60 days.
select pg_temp.plan(12,'quarterly');
select pg_temp.set_anchor(pg_temp.p(12),'2031-01-15 09:00');
select is(pg_temp.proposed(pg_temp.p(12),'2031-01-20 14:00Z'), '', 'quarterly: nothing inside the horizon');
select is((private.recurring_cadence_preview(pg_temp.p(12),'2031-01-20 14:00Z')->'next') - array['choices','index','kind','local_start','starts_at'],
  '{"cadence_date": "2031-04-15", "opens_on": "2031-02-14"}'::jsonb, 'the empty state names the next date and when it enters the horizon');
select is(pg_temp.proposed(pg_temp.p(12),'2031-02-13 14:00Z'), '', 'the day before, it is still outside');
select is(pg_temp.proposed(pg_temp.p(12),'2031-02-14 14:00Z'), '2031-04-15', 'today + 60 is inside (inclusive), and only that one');
select pg_temp.plan(13,'every-two-months');
select pg_temp.set_anchor(pg_temp.p(13),'2030-12-31 09:00');
select is(pg_temp.proposed(pg_temp.p(13),'2031-01-05 14:00Z'), '2031-02-28', 'every two months: one proposal, clamped to 28 February');
select pg_temp.plan(14,'bi-monthly');
select pg_temp.set_anchor(pg_temp.p(14),'2031-01-07 09:00');
select is(pg_temp.proposed(pg_temp.p(14),'2031-01-08 14:00Z'), '2031-01-21,2031-02-04', 'every two weeks');
select pg_temp.plan(15,'monthly');
select pg_temp.set_anchor(pg_temp.p(15),'2031-01-31 09:00');
select is(pg_temp.proposed(pg_temp.p(15),'2031-02-01 14:00Z'), '2031-02-28,2031-03-31', 'monthly month-end, returning to the 31st');
select pg_temp.plan(16,'monthly');
select pg_temp.set_anchor(pg_temp.p(16),'2032-01-31 09:00');
select is(pg_temp.proposed(pg_temp.p(16),'2032-02-01 14:00Z'), '2032-02-29,2032-03-31', 'monthly in a leap year');
select pg_temp.plan(17,'monthly');
select pg_temp.set_anchor(pg_temp.p(17),'2031-01-01 09:00');
select is(pg_temp.proposed(pg_temp.p(17),'2031-01-02 14:00Z'), '2031-02-01,2031-03-01', 'monthly is a day of the month; Saturdays are not shifted');

-- Daylight saving: the wall time is kept; skipped and repeated times need an operator choice.
select pg_temp.plan(18,'weekly');
select pg_temp.set_anchor(pg_temp.p(18),'2031-03-02 02:30');
select is((select string_agg(x->>'kind', ',') from jsonb_array_elements(private.recurring_cadence_preview(pg_temp.p(18),'2031-03-03 12:00Z')->'proposals') x),
  'nonexistent,ok', 'a spring-forward 2:30 AM is proposed as needing a time');
select is(private.recurring_cadence_preview(pg_temp.p(18),'2031-03-03 12:00Z')#>'{proposals,0,choices}', '[]'::jsonb, 'with no instant chosen for it');
select pg_temp.plan(19,'weekly');
select pg_temp.set_anchor(pg_temp.p(19),'2031-10-26 01:30');
select is((select string_agg(x->>'kind', ',') from jsonb_array_elements(private.recurring_cadence_preview(pg_temp.p(19),'2031-10-27 12:00Z')->'proposals') x),
  'ambiguous,ok', 'a fall-back 1:30 AM needs EDT or EST chosen');
select is(jsonb_array_length(private.recurring_cadence_preview(pg_temp.p(19),'2031-10-27 12:00Z')#>'{proposals,0,choices}'), 2, 'both offered');
select pg_temp.plan(20,'weekly');
select pg_temp.set_anchor(pg_temp.p(20),'2031-03-02 09:00');
select is((private.recurring_cadence_preview(pg_temp.p(20),'2031-03-03 12:00Z')#>>'{proposals,0,starts_at}')::timestamptz, '2031-03-09 13:00Z'::timestamptz,
  '9:00 AM stays 9:00 AM across spring forward (EDT)');
select pg_temp.plan(21,'weekly','pending');
select pg_temp.set_anchor(pg_temp.p(21),'2031-03-02 09:00');
select is(private.recurring_cadence_preview(pg_temp.p(21),'2031-03-03 12:00Z')->>'unavailable', 'not_active', 'a plan without an accepted provider proposes nothing');
select pg_temp.plan(22,'weekly');
select is(private.recurring_cadence_preview(pg_temp.p(22),'2031-03-03 12:00Z')->>'unavailable', 'no_anchor', 'nor does a plan with no anchor');
select is(pg_temp.visits(pg_temp.p(18)) + pg_temp.visits(pg_temp.p(12)), 0::bigint, 'previews create no visit');

-- Accepted plans for the commands ---------------------------------------------------------------
-- W: homeowner A weekly; M: homeowner A monthly; W2: homeowner B weekly.
insert into fx values ('w', pg_temp.submit(1,'rc-w-0000000000001','weekly','96500000-0000-4000-8000-000000000001',40));
insert into fx values ('m', pg_temp.submit(1,'rc-m-0000000000001','monthly','96500000-0000-4000-8000-000000000002',120));
insert into fx values ('w2', pg_temp.submit(2,'rc-w2-000000000001','weekly','96500000-0000-4000-8000-000000000001',40));
select pg_temp.accept(pg_temp.id('w'));
select pg_temp.accept(pg_temp.id('m'));
select pg_temp.accept(pg_temp.id('w2'));
select is((select count(*) from private.recurring_series_terms where series_id in (pg_temp.id('w'), pg_temp.id('m'), pg_temp.id('w2'))), 3::bigint, 'three accepted plans');
select set_config('t.money', pg_temp.money_rows()::text, true);

-- Access
select ok(not has_function_privilege('anon','public.admin_record_recurring_anchor(uuid,uuid,uuid,timestamptz,timestamp,text,text)','execute')
  and not has_function_privilege('anon','public.admin_create_cadence_visit(uuid,uuid,uuid,date,timestamptz,timestamp,text)','execute')
  and not has_function_privilege('anon','public.admin_resolve_cadence_date(uuid,uuid,uuid,date,text,uuid,text)','execute')
  and not has_function_privilege('anon','public.admin_set_recurring_plan_state(uuid,uuid,text,text,text)','execute'),
  'anonymous callers cannot run the cadence commands');
select ok(has_function_privilege('authenticated','public.admin_set_recurring_plan_state(uuid,uuid,text,text,text)','execute')
  and not has_function_privilege('authenticated','private.create_recurring_visit_core(uuid,uuid,timestamptz,timestamp,text,text,uuid,date)','execute')
  and not has_function_privilege('authenticated','private.recurring_cadence_preview(uuid,timestamptz)','execute'),
  'signed-in callers reach the commands (which check the role), never the private core');
select ok(not has_table_privilege('authenticated','private.recurring_series_anchors','select')
  and not has_table_privilege('authenticated','private.recurring_series_lifecycle','insert')
  and not has_table_privilege('authenticated','private.recurring_cadence_resolutions','select'), 'cadence records have no direct client access');
select throws_ok($$select pg_temp.anchor(1, pg_temp.id('w'), 1, pg_temp.day(3), null)$$, '42501', 'Admin access required', 'the homeowner cannot set the anchor');
select throws_ok($$select pg_temp.anchor(3, pg_temp.id('w'), 1, pg_temp.day(3), null)$$, '42501', 'Admin access required', 'nor can the provider');
select throws_ok($$select pg_temp.lifecycle(2, pg_temp.id('w2'), 1, 'pause', 'active')$$, '42501', 'Admin access required', 'the homeowner cannot pause in 6.6b');
select throws_ok($$select pg_temp.lifecycle(3, pg_temp.id('w2'), 1, 'stop', 'active')$$, '42501', 'Admin access required', 'nor can the provider stop the plan');
select throws_ok($$select pg_temp.resolve(1, pg_temp.id('w'), 1, gen_random_uuid(), pg_temp.day(10)::date, 'skipped', null)$$, '42501', 'Admin access required',
  'nor skip a date');
select throws_ok($$select pg_temp.cadence(1, pg_temp.id('w'), 1, gen_random_uuid(), pg_temp.day(3)::date, pg_temp.day(3))$$, '42501', 'Admin access required',
  'nor create a proposed visit');

-- Anchor
select throws_ok($$select pg_temp.anchor(5, pg_temp.id('w'), 1, pg_temp.day(3), null, ' ')$$, '22023', null, 'the basis for the agreed time is required');
select throws_ok($$select pg_temp.anchor(5, pg_temp.id('w'), 1, pg_temp.day(3), null, 'Phone', ' ')$$, '22023', null, 'so is a reason');
select throws_ok($$select pg_temp.anchor(5, pg_temp.id('w'), 1, pg_temp.day(3), null, 'Phone', 'Agreed', 'America/Los_Angeles')$$, '22023',
  'The anchor time does not match the Eastern Time entered', 'a device-shifted instant is refused');
select throws_ok($$select pg_temp.anchor(5, pg_temp.id('w2'), 1, null::timestamp, null)$$, '22023', null, 'a missing time is refused');
select throws_ok($$select pg_temp.anchor(5, pg_temp.p(22), 1, '2031-03-09 02:30', null)$$, '22023', 'The anchor time does not match the Eastern Time entered',
  'an anchor at a time the clocks skip is refused');
select is((select count(*) from private.recurring_series_anchors where series_id = pg_temp.id('w')), 0::bigint, 'refused anchors record nothing');
insert into fx values ('aw', (pg_temp.anchor(5, pg_temp.id('w'), 1, pg_temp.day(3), null)->>'anchor_id')::uuid);
select is((select row(starts_at = pg_temp.day(3) at time zone 'America/New_York', local_start = pg_temp.day(3), basis, reason, actor_id, replaces_anchor_id is null)::text
  from private.recurring_series_anchors where id = pg_temp.id('aw')),
  '(t,t,"Homeowner and provider agreed by phone","First visit agreed",96100000-0000-4000-8000-000000000005,t)', 'the anchor records time, basis, reason and operator');
select is(pg_temp.anchor(5, pg_temp.id('w'), 1, pg_temp.day(3), null)->>'replayed', 'true', 'a retried key replays');
select throws_ok($$select pg_temp.anchor(5, pg_temp.id('w'), 1, pg_temp.day(3), null, 'Email')$$, '22023', 'Operation key reused with different intent',
  'the same key with another basis is refused');
select throws_ok($$select pg_temp.anchor(5, pg_temp.id('w'), 2, pg_temp.day(4), null)$$, '40001', 'The cadence changed since you loaded it',
  'a second first anchor from a stale read is refused');
select is((select count(*) from private.recurring_series_anchors where series_id = pg_temp.id('w')), 1::bigint, 'one anchor');
select is(pg_temp.visits(pg_temp.id('w')), 0::bigint, 'recording an anchor creates no visit');

-- Readback
select is((select string_agg(x->>'cadence_date', ',') from jsonb_array_elements(pg_temp.read(5, pg_temp.id('w'))#>'{cadence,proposals}') x),
  pg_temp.day(3)::date || ',' || pg_temp.day(10)::date, 'operations reads two proposals from the anchor');
select is(pg_temp.read(5, pg_temp.id('w'))->>'anchor_id', pg_temp.id('aw')::text, 'and the current anchor id');
select is((select row(r->>'plan_state', r#>>'{anchor,local_start}', r ? 'cadence', r ? 'anchors', r ? 'lifecycle', r ? 'resolutions', r ? 'anchor_id')::text
  from pg_temp.read(1, pg_temp.id('w')) r), '(active,' || to_char(pg_temp.day(3), 'YYYY-MM-DD"T"HH24:MI:SS') || ',f,f,f,f,f)',
  'the homeowner sees the plan state and anchor time, not proposals, basis or history');
select is((select row(r->>'plan_state', r ? 'cadence', r ? 'anchors')::text from pg_temp.read(3, pg_temp.id('w')) r), '(active,f,f)', 'so does the provider');

-- Creating a proposed visit
select set_config('t.notices', (select count(*) from public.notifications where user_id = pg_temp.u(1))::text, true);
insert into fx values ('c1', (pg_temp.cadence(5, pg_temp.id('w'), 10, pg_temp.id('aw'), pg_temp.day(3)::date, pg_temp.day(3))->>'occurrence_id')::uuid);
select isnt(pg_temp.id('c1'), null, 'a proposed visit is created');
select is((select row(outcome, source, anchor_id = pg_temp.id('aw'), cadence_date = pg_temp.day(3)::date)::text from private.recurring_visit_generations
  where operation_key = pg_temp.k(10)), '(created,cadence,t,t)', 'recorded as created from the cadence, with its anchor and date');
select is((select row(a.contractor_id, a.package_tier_id, a.base_price::numeric(12,2), a.outcome)::text from public.job_match_attempts a where a.service_request_id = pg_temp.id('c1')),
  '(96200000-0000-4000-8000-000000000001,96500000-0000-4000-8000-000000000001,40.00,pending)', 'offered to the plan provider on the accepted terms (6.6a path)');
select is((select occurrence_key from public.service_requests where id = pg_temp.id('c1')), private.recurring_visit_key(pg_temp.id('w'), pg_temp.day(3)::date),
  'with the plan + Eastern date identity');
select is((select count(*) from public.notifications where user_id = pg_temp.u(1))::text, (current_setting('t.notices')::int + 1)::text, 'and one homeowner notice');
select is(pg_temp.cadence(5, pg_temp.id('w'), 10, pg_temp.id('aw'), pg_temp.day(3)::date, pg_temp.day(3))->>'replayed', 'true', 'a retried key replays');
select is(pg_temp.visits(pg_temp.id('w')), 1::bigint, 'one visit');
select throws_ok($$select pg_temp.cadence(5, pg_temp.id('w'), 10, pg_temp.id('aw'), pg_temp.day(3)::date, pg_temp.day(3), 'Other reason')$$, '22023',
  'Operation key reused with different intent', 'the same key with another reason is refused');
select throws_ok($$select pg_temp.manual(5, pg_temp.id('w'), 10, pg_temp.day(3), 'Proposed visit')$$, '22023', 'Operation key reused with different intent',
  'and a cadence key cannot be replayed as a manual visit');
select throws_ok($$select pg_temp.cadence(5, pg_temp.id('w'), 11, pg_temp.id('aw'), pg_temp.day(10)::date, pg_temp.day(10, '10:00'))$$, '22023',
  'A proposed visit keeps the plan''s Eastern time; add a different time manually', 'a proposal keeps the anchor time');
select throws_ok($$select pg_temp.cadence(5, pg_temp.id('w'), 11, pg_temp.id('aw'), pg_temp.day(10)::date, pg_temp.day(11))$$, '22023',
  'A proposed visit stays on its cadence date', 'and its date');
select throws_ok($$select pg_temp.cadence(5, pg_temp.id('w'), 11, pg_temp.id('aw'), pg_temp.day(17)::date, pg_temp.day(17))$$, '40001',
  'This proposed visit is no longer current', 'a date beyond the two-visit capacity is not a current proposal');
select throws_ok($$select pg_temp.cadence(5, pg_temp.id('w'), 11, pg_temp.id('aw'), pg_temp.day(11)::date, pg_temp.day(11))$$, '40001',
  'This proposed visit is no longer current', 'nor is an off-cadence date');
select throws_ok($$select pg_temp.cadence(5, pg_temp.id('w'), 11, pg_temp.p(11), pg_temp.day(10)::date, pg_temp.day(10))$$, '22023',
  'Cadence anchor not found for this plan', 'another plan''s anchor is refused');
select is(pg_temp.visits(pg_temp.id('w')), 1::bigint, 'refused proposals create nothing');
select is((select count(*) from private.recurring_visit_generations where series_id = pg_temp.id('w')), 1::bigint, 'and record nothing');

-- The 24-hour lead is rechecked at creation: an anchor 23 hours away is never a current proposal.
insert into fx values ('m_soon', (pg_temp.anchor(5, pg_temp.id('m'), 20,
  date_trunc('minute', now() at time zone 'America/New_York') + interval '23 hours', null)->>'anchor_id')::uuid);
select throws_ok($$select pg_temp.cadence(5, pg_temp.id('m'), 21, pg_temp.id('m_soon'), (date_trunc('minute', now() at time zone 'America/New_York') + interval '23 hours')::date,
  date_trunc('minute', now() at time zone 'America/New_York') + interval '23 hours')$$, '40001', 'This proposed visit is no longer current',
  'a cadence visit under 24 hours away is refused');
insert into fx values ('am', (pg_temp.anchor(5, pg_temp.id('m'), 22, pg_temp.day(5), pg_temp.id('m_soon'), 'Agreed with the homeowner', 'Moved to give notice')->>'anchor_id')::uuid);

-- Eligibility and terms still apply on the cadence path (recorded, nothing substituted).
update public.package_tiers set price = 125 where id = '96500000-0000-4000-8000-000000000002';
select is(pg_temp.cadence(5, pg_temp.id('m'), 23, pg_temp.id('am'), pg_temp.day(5)::date, pg_temp.day(5))->>'code', 'terms_changed',
  'a price change blocks a proposed visit');
update public.package_tiers set price = 120 where id = '96500000-0000-4000-8000-000000000002';
update private.r0_trial_admissions set is_active = false, revoked_at = now(), revoked_by = pg_temp.u(5) where homeowner_id = pg_temp.u(1);
select is(pg_temp.cadence(5, pg_temp.id('m'), 24, pg_temp.id('am'), pg_temp.day(5)::date, pg_temp.day(5))->>'code', 'homeowner_not_admitted',
  'so does an ended admission');
update private.r0_trial_admissions set is_active = true, revoked_at = null, revoked_by = null where homeowner_id = pg_temp.u(1);
select is(pg_temp.visits(pg_temp.id('m')), 0::bigint, 'blocked proposals create no visit');
select is((select array_agg(source order by seq) from private.recurring_visit_generations where series_id = pg_temp.id('m')), array['cadence','cadence'],
  'and are recorded as cadence attempts');
select is(pg_temp.cadence(5, pg_temp.id('m'), 25, pg_temp.id('am'), pg_temp.day(5)::date, pg_temp.day(5))->>'outcome', 'created', 'recovered with a new key');

-- Manual creation is unchanged: no horizon and no 24-hour rule, off-cadence allowed.
select is(pg_temp.manual(5, pg_temp.id('m'), 26, pg_temp.day(75), 'Booked early by request')->>'outcome', 'created', 'a manual visit beyond 60 days');
select is(pg_temp.manual(5, pg_temp.id('m'), 27, date_trunc('minute', now() at time zone 'America/New_York') + interval '2 hours', 'Same-day make-up')->>'outcome',
  'created', 'and one 2 hours away');
select is((select array_agg(source order by seq) from private.recurring_visit_generations where series_id = pg_temp.id('m') and outcome = 'created'),
  array['cadence','manual','manual'], 'manual visits are recorded as manual');

-- Skipped and replaced cadence dates (plan W: visit on day 3 from the cadence) ----------------
insert into fx values ('v12', (pg_temp.manual(5, pg_temp.id('w'), 30, pg_temp.day(12, '14:00'), 'Moved to Thursday afternoon')->>'occurrence_id')::uuid);
select is(pg_temp.resolve(5, pg_temp.id('w'), 31, pg_temp.id('aw'), pg_temp.day(10)::date, 'skipped', null, 'Homeowner away')->>'kind', 'skipped', 'a date is skipped');
select is(pg_temp.resolve(5, pg_temp.id('w'), 31, pg_temp.id('aw'), pg_temp.day(10)::date, 'skipped', null, 'Homeowner away')->>'replayed', 'true', 'a retried key replays');
select throws_ok($$select pg_temp.resolve(5, pg_temp.id('w'), 32, pg_temp.id('aw'), pg_temp.day(10)::date, 'skipped', null)$$, '22023',
  'This cadence date was already skipped or replaced', 'a date is skipped once');
select throws_ok($$select pg_temp.resolve(5, pg_temp.id('w'), 32, pg_temp.id('aw'), pg_temp.day(3)::date, 'skipped', null)$$, '22023',
  'This cadence date already has a visit', 'a date with a visit cannot be skipped');
select throws_ok($$select pg_temp.resolve(5, pg_temp.id('w'), 32, pg_temp.id('aw'), pg_temp.day(11)::date, 'skipped', null)$$, '22023',
  'That date is not a cadence date of this plan', 'only cadence dates are skipped');
select throws_ok($$select pg_temp.resolve(5, pg_temp.id('w'), 32, pg_temp.id('aw'), pg_temp.day(17)::date, 'skipped', pg_temp.id('v12'))$$, '22023', null,
  'a skip names no visit');
select set_config('t.v12', (select md5(row(r.*)::text) from public.service_requests r where id = pg_temp.id('v12')), true);
select is(pg_temp.resolve(5, pg_temp.id('w'), 33, pg_temp.id('aw'), pg_temp.day(17)::date, 'replaced', pg_temp.id('v12'), 'Moved to Thursday')->>'kind', 'replaced',
  'an off-cadence visit replaces a cadence date');
select is((select md5(row(r.*)::text) from public.service_requests r where id = pg_temp.id('v12')), current_setting('t.v12'),
  'linking does not change the visit''s appointment, provider, price or identity');
select throws_ok($$select pg_temp.resolve(5, pg_temp.id('w'), 34, pg_temp.id('aw'), pg_temp.day(24)::date, 'replaced', pg_temp.id('v12'))$$, '22023',
  'This visit already replaces a cadence date', 'one visit cannot satisfy two cadence dates');
select throws_ok($$select pg_temp.resolve(5, pg_temp.id('w'), 34, pg_temp.id('aw'), pg_temp.day(24)::date, 'replaced', pg_temp.id('c1'))$$, '22023',
  'This visit is on a cadence date of its own', 'a visit on a cadence date cannot replace another');
select throws_ok($$select pg_temp.resolve(5, pg_temp.id('w'), 34, pg_temp.id('aw'), pg_temp.day(24)::date, 'replaced', pg_temp.visit_on(pg_temp.id('m'), pg_temp.day(5)::date))$$,
  '22023', 'The replacement must be a visit of this plan', 'nor can another plan''s visit');
insert into fx values ('vx', pg_temp.add_visit(pg_temp.id('w'), pg_temp.day(19, '15:00'), 'cancelled'));
select throws_ok($$select pg_temp.resolve(5, pg_temp.id('w'), 34, pg_temp.id('aw'), pg_temp.day(24)::date, 'replaced', pg_temp.id('vx'))$$, '22023',
  'A cancelled visit cannot replace a cadence date', 'nor a cancelled visit');
select throws_ok($$select pg_temp.resolve(5, pg_temp.id('w'), 34, pg_temp.p(11), pg_temp.day(24)::date, 'skipped', null)$$, '40001',
  'The cadence changed since you loaded it', 'a stale anchor is refused');
select is((pg_temp.read(5, pg_temp.id('w'))#>>'{cadence,next,cadence_date}')::date, pg_temp.day(24)::date,
  'the next open cadence date passes the visit, skip and replacement');
select is((select x->>'replaces' is not null from jsonb_array_elements(pg_temp.read(5, pg_temp.id('w'))->'visits') x where x->>'id' = pg_temp.id('v12')::text), true,
  'operations sees which date the visit replaces');

-- Re-anchoring keeps visits, earlier anchors and decisions, which do not carry to the new dates.
insert into fx values ('aw2', (pg_temp.anchor(5, pg_temp.id('w'), 40, pg_temp.day(4, '10:00'), pg_temp.id('aw'), 'Phone call with homeowner and provider',
  'Homeowner asked for a different weekday')->>'anchor_id')::uuid);
select is((select replaces_anchor_id from private.recurring_series_anchors where id = pg_temp.id('aw2')), pg_temp.id('aw'), 're-anchoring records the anchor it replaces');
select throws_ok($$select pg_temp.anchor(5, pg_temp.id('w'), 41, pg_temp.day(5), pg_temp.id('aw'))$$, '40001', 'The cadence changed since you loaded it',
  'a re-anchor from a stale read is refused');
select throws_ok($$select pg_temp.anchor(5, pg_temp.id('w'), 41, pg_temp.day(4, '10:00'), pg_temp.id('aw2'))$$, '22023', 'That is already the plan''s anchor',
  'the same anchor twice is refused');
select throws_ok($$select pg_temp.cadence(5, pg_temp.id('w'), 42, pg_temp.id('aw'), pg_temp.day(10)::date, pg_temp.day(10))$$, '40001',
  'The cadence changed since you loaded it', 'a proposal from the earlier anchor is stale');
select is((select jsonb_agg(jsonb_build_array(x->>'kind', x->>'current_anchor') order by x->>'kind') from jsonb_array_elements(pg_temp.read(5, pg_temp.id('w'))->'resolutions') x),
  '[["replaced", "false"], ["skipped", "false"]]'::jsonb, 'earlier decisions stay listed, marked as under the earlier anchor');
select is((select jsonb_agg(x->>'basis' order by x->>'at', x->>'id') from jsonb_array_elements(pg_temp.read(5, pg_temp.id('w'))->'anchors') x) @> '["Homeowner and provider agreed by phone", "Phone call with homeowner and provider"]'::jsonb,
  true, 'both anchors stay in the history with their basis');
select is(pg_temp.visits(pg_temp.id('w')), 3::bigint, 'visits are untouched by re-anchoring');
select is((pg_temp.read(5, pg_temp.id('w'))#>>'{cadence,next,cadence_date}')::date, pg_temp.day(4)::date, 'the next cadence date follows the new anchor');

-- Pause, resume, stop future visits (plan W2) --------------------------------------------------
insert into fx values ('aw2p', (pg_temp.anchor(5, pg_temp.id('w2'), 50, pg_temp.day(6), null)->>'anchor_id')::uuid);
insert into fx values ('vw2', (pg_temp.manual(5, pg_temp.id('w2'), 51, pg_temp.day(8), 'Before the pause')->>'occurrence_id')::uuid);
select set_config('t.vw2', (select md5(row(r.*)::text) from public.service_requests r where id = pg_temp.id('vw2')), true);
select set_config('t.vw2offer', (select md5(row(a.*)::text) from public.job_match_attempts a where a.service_request_id = pg_temp.id('vw2')), true);
select set_config('t.notices2', (select count(*) from public.notifications where user_id = pg_temp.u(2))::text, true);
select is((select row(r->>'action', r->>'from_state', r->>'to_state', r->>'visits_in_place')::text from pg_temp.lifecycle(5, pg_temp.id('w2'), 52, 'pause', 'active', 'Homeowner travelling') r),
  '(pause,active,paused,1)', 'operations pauses the plan');
select is(pg_temp.lifecycle(5, pg_temp.id('w2'), 52, 'pause', 'active', 'Homeowner travelling')->>'replayed', 'true', 'a retried key replays');
select throws_ok($$select pg_temp.lifecycle(5, pg_temp.id('w2'), 52, 'pause', 'active', 'Another reason')$$, '22023', 'Operation key reused with different intent',
  'the same key with another reason is refused');
select throws_ok($$select pg_temp.lifecycle(6, pg_temp.id('w2'), 53, 'pause', 'active')$$, '40001', 'The plan changed since you loaded it',
  'a second operator pausing from a stale read is refused');
select throws_ok($$select pg_temp.lifecycle(6, pg_temp.id('w2'), 53, 'pause', 'paused')$$, '22023', 'This plan is already paused', 'pausing twice is refused');
select is((select count(*) from private.recurring_series_lifecycle where series_id = pg_temp.id('w2')), 1::bigint, 'one lifecycle record');
select is(pg_temp.manual(5, pg_temp.id('w2'), 54, pg_temp.day(9))->>'code', 'series_paused', 'a manual visit is refused while paused');
select is(pg_temp.cadence(5, pg_temp.id('w2'), 55, pg_temp.id('aw2p'), pg_temp.day(6)::date, pg_temp.day(6))->>'code', 'series_paused', 'so is a proposed visit');
select is((select array_agg(row(source, outcome, block_code)::text order by seq) from private.recurring_visit_generations where series_id = pg_temp.id('w2')),
  array['(manual,created,)', '(manual,blocked,series_paused)', '(cadence,blocked,series_paused)'], 'both refusals are recorded');
select is(pg_temp.visits(pg_temp.id('w2')), 1::bigint, 'no visit is added while paused');
select is((select md5(row(r.*)::text) from public.service_requests r where id = pg_temp.id('vw2')), current_setting('t.vw2'), 'the existing visit is unchanged');
select is((select md5(row(a.*)::text) from public.job_match_attempts a where a.service_request_id = pg_temp.id('vw2')), current_setting('t.vw2offer'), 'and its open offer');
select is((select status::text from public.service_requests where id = pg_temp.id('w2')), 'scheduled', 'the plan''s request status is not changed');
select is(pg_temp.read(5, pg_temp.id('w2'))#>>'{cadence,unavailable}', 'paused', 'operations sees no proposals while paused');
select is(pg_temp.read(2, pg_temp.id('w2'))->>'plan_state', 'paused', 'the homeowner sees the plan is paused');
select is(pg_temp.lifecycle(5, pg_temp.id('w2'), 56, 'resume', 'paused', 'Homeowner back')->>'to_state', 'active', 'operations resumes');
select is(pg_temp.anchor(5, pg_temp.id('w2'), 50, pg_temp.day(6), null)->>'anchor_id', pg_temp.id('aw2p')::text, 'resuming keeps the anchor');
select is(pg_temp.cadence(5, pg_temp.id('w2'), 57, pg_temp.id('aw2p'), pg_temp.day(6)::date, pg_temp.day(6))->>'outcome', 'created',
  'a proposed visit is created again after resuming');
select set_config('t.w2visits', (select string_agg(md5(row(r.*)::text), ',' order by r.id) from public.service_requests r where recurrence_parent_id = pg_temp.id('w2')), true);
select is((select row(r->>'to_state', r->>'visits_in_place')::text from pg_temp.lifecycle(5, pg_temp.id('w2'), 58, 'stop', 'active', 'Homeowner ending service') r),
  '(ended,2)', 'operations stops future visits; two visits stay in place');
select throws_ok($$select pg_temp.lifecycle(5, pg_temp.id('w2'), 59, 'resume', 'ended')$$, '22023', 'Future visits for this plan were already stopped',
  'stopping is final');
select throws_ok($$select pg_temp.lifecycle(5, pg_temp.id('w2'), 59, 'stop', 'ended')$$, '22023', 'Future visits for this plan were already stopped',
  'and is not repeated');
select throws_ok($$select pg_temp.lifecycle(5, pg_temp.id('w2'), 59, 'resume', 'paused')$$, '40001', 'The plan changed since you loaded it',
  'a resume from a stale read is refused');
select is(pg_temp.manual(5, pg_temp.id('w2'), 60, pg_temp.day(9))->>'code', 'series_ended', 'a manual visit is refused after stopping');
select is(pg_temp.cadence(5, pg_temp.id('w2'), 61, pg_temp.id('aw2p'), pg_temp.day(13)::date, pg_temp.day(13))->>'code', 'series_ended', 'and a proposed one');
select throws_ok($$select pg_temp.anchor(5, pg_temp.id('w2'), 62, pg_temp.day(7), pg_temp.id('aw2p'))$$, '22023', 'Future visits for this plan were stopped',
  'the cadence cannot be changed after stopping');
select throws_ok($$select pg_temp.resolve(5, pg_temp.id('w2'), 62, pg_temp.id('aw2p'), pg_temp.day(13)::date, 'skipped', null)$$, '22023',
  'Future visits for this plan were stopped', 'nor dates skipped');
select is((select string_agg(md5(row(r.*)::text), ',' order by r.id) from public.service_requests r where recurrence_parent_id = pg_temp.id('w2')),
  current_setting('t.w2visits'), 'stopping changes no visit (each is handled individually)');
select is((select status::text from public.service_requests where id = pg_temp.id('w2')), 'scheduled', 'nor the plan''s request status');
select is((select count(*) from public.notifications where user_id = pg_temp.u(2))::text, (current_setting('t.notices2')::int + 1)::text,
  'the homeowner is told only of the one created visit; lifecycle actions send nothing');
select is(pg_temp.read(5, pg_temp.id('w2'))#>>'{cadence,unavailable}', 'ended', 'no proposals after stopping');
select is((select jsonb_agg(x->>'action' order by x->>'at', x->>'id') from jsonb_array_elements(pg_temp.read(5, pg_temp.id('w2'))->'lifecycle') x) @> '["pause","resume","stop"]'::jsonb,
  true, 'the lifecycle history is read back');

select is(pg_temp.money_rows()::text, current_setting('t.money'), 'no obligation, snapshot, invoice, checkout, charge, refund or payout row was written by proposals, anchors, skips, links or lifecycle actions');

-- Resuming never reactivates a cancelled plan.
select lives_ok($$select pg_temp.call(1, format('select public.record_job_operation(%L,%L,''customer_cancel'',''Synthetic plan ended'')', pg_temp.id('m'), pg_temp.k(70)))$$,
  'homeowner A cancels plan M');
select pg_temp.lifecycle(5, pg_temp.id('m'), 71, 'pause', 'active');
select pg_temp.lifecycle(5, pg_temp.id('m'), 72, 'resume', 'paused');
select is(pg_temp.manual(5, pg_temp.id('m'), 73, pg_temp.day(40))->>'code', 'series_not_active', 'a resumed but cancelled plan still gets no visit');

-- Records are append-only; nothing touched money ---------------------------------------------
select throws_ok($$update private.recurring_series_anchors set reason = 'x' where id = pg_temp.id('aw')$$, '55000', 'Recurring plan history is append-only', 'anchors are append-only');
select throws_ok($$delete from private.recurring_series_lifecycle where series_id = pg_temp.id('w2')$$, '55000', 'Recurring plan history is append-only', 'so is the lifecycle');
select throws_ok($$update private.recurring_cadence_resolutions set reason = 'x'$$, '55000', 'Recurring plan history is append-only', 'and skip/replacement decisions');
select throws_ok($$insert into private.recurring_series_anchors(series_id,replaces_anchor_id,operation_key,actor_id,starts_at,local_start,basis,reason)
  values (pg_temp.id('w'), pg_temp.id('aw'), gen_random_uuid(), pg_temp.u(5), now(), now(), 'Fork', 'Fork')$$, '23505', null, 'the anchor chain cannot fork');
select is((select count(*) from public.job_visits where service_request_id in (select id from public.service_requests where customer_id in (pg_temp.u(1), pg_temp.u(2)))),
  0::bigint, 'no legacy shadow visits');

select * from finish();
rollback;
