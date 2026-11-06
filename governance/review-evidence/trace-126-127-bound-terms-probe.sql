-- TRACE-126/127 bound-terms characterization probe (closeout packet, 2026-11-05). Synthetic data only;
-- one transaction, rolled back. Reuses SQL 097's fixtures (lines 8-141 of that file, copied below) and
-- makes each catalog change through the real vendor command vendor_save_package, not owner
-- maintenance. Run on the isolated local stack only:
--   docker exec -i supabase_db_mercurius-phase5-isolated psql -U postgres -At < this-file
-- Results: trace-126-127-bound-terms-probe.txt. Plan: ../PHASE-6-BOUND-TERMS-PLAN.md.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- TRACE-134 (6.11A): a price version that is live or in use is not edited in place on any path.
-- Edits below that the guard refuses are applied under owner maintenance (version guards disabled for
-- that statement) so this file keeps characterizing what an in-place change would do (TRACE-126/127).
create function pg_temp.edit_in_place(p_sql text) returns text language plpgsql as $f$
begin
  begin
    execute p_sql;
    return 'applied';
  exception when sqlstate '55000' then null;
  end;
  alter table public.vendor_packages disable trigger trg_vendor_package_version_guard;
  alter table public.package_tiers disable trigger trg_package_tiers_version_guard;
  alter table public.package_addons disable trigger trg_package_addons_version_guard;
  alter table public.package_qualifying_questions disable trigger trg_package_questions_version_guard;
  execute p_sql;
  alter table public.vendor_packages enable trigger trg_vendor_package_version_guard;
  alter table public.package_tiers enable trigger trg_package_tiers_version_guard;
  alter table public.package_addons enable trigger trg_package_addons_version_guard;
  alter table public.package_qualifying_questions enable trigger trg_package_questions_version_guard;
  return 'refused';
end $f$;

-- Users: 1 homeowner A, 2 homeowner B, 3 plan provider, 4 other provider, 5–6 operators and the two
-- finance actors.
insert into auth.users(id,email) select ('97100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'payments-'||n||'@example.invalid'
  from generate_series(1,6) n;
delete from public.user_roles where user_id in ('97100000-0000-4000-8000-000000000003','97100000-0000-4000-8000-000000000004','97100000-0000-4000-8000-000000000005','97100000-0000-4000-8000-000000000006');
insert into public.user_roles(user_id,role) values
 ('97100000-0000-4000-8000-000000000003','vendor'),('97100000-0000-4000-8000-000000000004','vendor'),
 ('97100000-0000-4000-8000-000000000005','admin'),('97100000-0000-4000-8000-000000000006','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('97100000-0000-4000-8000-000000000005','97100000-0000-4000-8000-000000000006','Synthetic'),
 ('97100000-0000-4000-8000-000000000006','97100000-0000-4000-8000-000000000005','Synthetic');
insert into public.service_categories(id,name) values ('synthetic-rp-cat','Synthetic recurring payments');
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,monthly_price,default_frequency,available_frequencies,is_active)
  values ('synthetic-rp-lawn','Synthetic payment lawn','synthetic-rp-cat',60,40,120,'weekly','{one-time,weekly,monthly}',true);
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00097','Synthetic',true,false);
insert into private.r0_lee_zips values ('00097');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
  select ('97100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00097','synthetic-rp-lawn','97100000-0000-4000-8000-000000000005'
  from unnest(array[1,2]) n;
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('97200000-0000-4000-8000-000000000001','97100000-0000-4000-8000-000000000003','Synthetic plan provider',true,true),
 ('97200000-0000-4000-8000-000000000002','97100000-0000-4000-8000-000000000004','Synthetic other provider',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('97200000-0000-4000-8000-000000000001','00097'),('97200000-0000-4000-8000-000000000002','00097');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('97400000-0000-4000-8000-000000000001','97200000-0000-4000-8000-000000000001','synthetic-rp-lawn','Synthetic plan lawn','fixed','weekly',true,false);
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('97500000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000001','Weekly',40,'weekly',0,'[]'),
 ('97500000-0000-4000-8000-000000000003','97400000-0000-4000-8000-000000000001','One time',60,'one-time',1,'[]');
insert into public.package_addons(id,package_id,name,price,price_kind,unit_label,min_quantity,max_quantity,is_required,frequencies,sort_order) values
 ('97600000-0000-4000-8000-000000000001','97400000-0000-4000-8000-000000000001','Edge trimming',5,'exact','visit',0,1,false,'{weekly}',0);

create temp table fx(key text primary key, id uuid);
grant select, insert on fx to authenticated;
create function pg_temp.u(n integer) returns uuid language sql as $$ select ('97100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from fx where key = k $$;
create function pg_temp.k(n integer) returns uuid language sql as $$ select ('97700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
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
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00097'),
    'preferred_time','Synthetic window','selections',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'service_id','synthetic-rp-lawn','frequency',p_frequency,'package_id','97400000-0000-4000-8000-000000000001','tier_id',p_tier,
      'preferred_contractor_id','97200000-0000-4000-8000-000000000001',
      'addons',case when p_addon then jsonb_build_array(jsonb_build_object('id','97600000-0000-4000-8000-000000000001','quantity',1)) end,
      'expected',jsonb_build_object('pricing_mode','fixed','total',p_total)))))))#>>'{requests,0,request_id}')::uuid $$;
create function pg_temp.accept_plan(p_request uuid) returns void language plpgsql as $$
begin
  perform private.offer_next_for_request_internal(p_request);
  perform pg_temp.call(3, format('select to_jsonb(public.vendor_accept_job(%L))', p_request));
end $$;
create function pg_temp.day(n integer, t time default '09:00') returns timestamp language sql stable as $$
  select (now() at time zone 'America/New_York')::date + n + t $$;
-- An operator adds a visit; returns the visit id (null when blocked).
create function pg_temp.visit(p_series uuid, p_key integer, p_local timestamp) returns uuid language sql as $$
  select (pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,%L)',
    p_series, pg_temp.k(p_key), p_local at time zone 'America/New_York', p_local, 'Synthetic payment visit'))->>'occurrence_id')::uuid $$;
create function pg_temp.accept(p_visit uuid) returns void language sql as $$
  select pg_temp.call(3, format('select to_jsonb(public.vendor_accept_job(%L))', p_visit)) $$;
create function pg_temp.src(p_request uuid) returns jsonb language sql as $$ select private.money_source(p_request) $$;
create function pg_temp.terms(request uuid, service bigint, addons bigint, expires interval default interval '2 days') returns jsonb language sql as $$
  select jsonb_build_object('service',service,'addons',addons,'discount',0,'adjustment',0,'subtotal',service+addons,'tax',0,'tip',0,
    'deposit',0,'total',service+addons,'currency','usd','source_version',private.money_source(request)->>'version','policy_version','CFG-005',
    'tax_evidence','synthetic-tax-decision','reason','Synthetic visit review','expires_at',now()+expires) $$;
create function pg_temp.publish(request uuid, service bigint, addons bigint, expires interval default interval '2 days') returns uuid language plpgsql as $$
declare terms jsonb:=pg_temp.terms(request, service, addons, expires); prior text:=current_setting('request.jwt.claims',true);
begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"97100000-0000-4000-8000-000000000006"}',true);
  perform public.money_approve_review('97100000-0000-4000-8000-000000000005',
    jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Independent visit review');
  perform set_config('request.jwt.claims',coalesce(prior,''),true);
  return public.money_publish_snapshot(request,terms,'97100000-0000-4000-8000-000000000005','97100000-0000-4000-8000-000000000006');
end $$;
create function pg_temp.checkout(p_user integer, p_snapshot uuid) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select to_jsonb(public.money_prepare_checkout(%L,''full''))', p_snapshot)) $$;
create function pg_temp.pay(p_visit uuid, p_at timestamptz default now()) returns jsonb language sql as $$
  select private.recurring_visit_payment(v, p_at) from public.service_requests v where v.id = p_visit $$;
create function pg_temp.q(p_visit uuid, p_at timestamptz default now()) returns jsonb language sql as $$
  select i from jsonb_array_elements(private.recurring_payment_queue(p_at)->'items') i where i->>'request_id' = p_visit::text $$;
create function pg_temp.event(p_id text, p_type text, p_payload jsonb) returns text language plpgsql as $$
begin
  perform public.money_receive_event(p_id, p_type, p_payload);
  return public.money_process_event(p_id);
end $$;
create function pg_temp.money_rows() returns text language sql as $$
  select concat_ws(',', (select count(*) from public.money_obligations), (select count(*) from public.money_snapshots),
    (select count(*) from public.money_checkout_attempts), (select count(*) from public.money_journals),
    (select count(*) from public.invoices), (select count(*) from public.money_review_approvals)) $$;

-- Plans: S1 weekly $40 with a $5 add-on (homeowner A); S2 weekly $40 (homeowner A); S3 weekly $40
-- (homeowner B). R1: a one-time request at $60, the regression for the unchanged one-time path.
insert into fx values ('s1', pg_temp.submit(1,'rp-s1-000000000001','weekly','97500000-0000-4000-8000-000000000001',true,45));
insert into fx values ('s2', pg_temp.submit(1,'rp-s2-000000000001','weekly','97500000-0000-4000-8000-000000000001',false,40));
insert into fx values ('s3', pg_temp.submit(2,'rp-s3-000000000001','weekly','97500000-0000-4000-8000-000000000001',false,40));
insert into fx values ('r1', pg_temp.submit(1,'rp-r1-000000000001','one-time','97500000-0000-4000-8000-000000000003',false,60));
select pg_temp.accept_plan(pg_temp.id('s1'));
select pg_temp.accept_plan(pg_temp.id('s2'));
select pg_temp.accept_plan(pg_temp.id('s3'));
select pg_temp.accept_plan(pg_temp.id('r1'));
-- ===== CS-4 / CS-3 characterization probe (synthetic, rolled back) =====
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok';
exception when others then return 'ERR ' || sqlstate || ': ' || sqlerrm; end $$;
create function pg_temp.req(p uuid) returns text language sql as $$
  select concat_ws(' | ', status, matching_status, 'pkg='||left(package_id::text,8), 'total='||total_amount, 'resolved='||resolved_price)
  from public.service_requests where id = p $$;
create function pg_temp.offer(p uuid) returns text language sql as $$
  select string_agg(outcome::text||':'||effective_price, ',' order by offered_at) from public.job_match_attempts where service_request_id = p $$;
create function pg_temp.plan_content(p_weekly numeric, p_name text) returns jsonb language sql as $$
  select jsonb_build_object('service_id','synthetic-rp-lawn',
    'package', jsonb_build_object('name',p_name,'description',null,'pricing_mode','fixed','default_frequency','weekly'),
    'questions','[]'::jsonb,
    'tiers', jsonb_build_array(
      jsonb_build_object('name','Weekly','price',p_weekly,'frequency','weekly'),
      jsonb_build_object('name','One time','price',60,'frequency','one-time')),
    'addons', jsonb_build_array(jsonb_build_object('name','Edge trimming','price',5,'frequencies',jsonb_build_array('weekly')))) $$;

insert into fx values ('vadd', pg_temp.visit(pg_temp.id('s1'), 1, pg_temp.day(10)));
insert into fx values ('vplain', pg_temp.visit(pg_temp.id('s2'), 2, pg_temp.day(10)));
insert into fx values ('vpaid', pg_temp.visit(pg_temp.id('s3'), 3, pg_temp.day(10)));
select pg_temp.accept(pg_temp.id('vpaid'));
insert into fx values ('vpaidsnap', pg_temp.publish(pg_temp.id('vpaid'), 4000, 0));
insert into fx values ('vpaida', (pg_temp.checkout(2, pg_temp.id('vpaidsnap'))->>'id')::uuid);
select pg_temp.event('evt_cs4_probe_cap','capture',jsonb_build_object('attempt_id',pg_temp.id('vpaida'),'payment_id','pi_cs4_probe','amount',4000,'currency','usd'));
insert into fx values ('vready', pg_temp.visit(pg_temp.id('s3'), 4, pg_temp.day(11)));
select pg_temp.accept(pg_temp.id('vready'));
insert into fx values ('vreadysnap', pg_temp.publish(pg_temp.id('vready'), 4000, 0));
create function pg_temp.startblock(p uuid) returns text language sql as $$
  select coalesce(private.visit_start_payment_block(v), 'startable') from public.service_requests v where v.id = p $$;
insert into fx values ('r2', pg_temp.submit(2,'rp-r2-000000000001','one-time','97500000-0000-4000-8000-000000000003',false,60));
select private.offer_next_for_request_internal(pg_temp.id('r2'));

select 'BEFORE vadd' k, pg_temp.req(pg_temp.id('vadd')) v, pg_temp.offer(pg_temp.id('vadd')) o
union all select 'BEFORE vplain', pg_temp.req(pg_temp.id('vplain')), pg_temp.offer(pg_temp.id('vplain'))
union all select 'BEFORE r2', pg_temp.req(pg_temp.id('r2')), pg_temp.offer(pg_temp.id('r2'))
union all select 'BEFORE vpaid pay', pg_temp.pay(pg_temp.id('vpaid'))->>'state', pg_temp.pay(pg_temp.id('vpaid'))#>>'{problem,code}'
union all select 'BEFORE vpaid start', pg_temp.startblock(pg_temp.id('vpaid')), null
union all select 'BEFORE vready pay', pg_temp.pay(pg_temp.id('vready'))->>'state', null
union all select 'BEFORE r1 source', pg_temp.try('select private.money_source('''||pg_temp.id('r1')||''')'), null;

savepoint price_change;
-- The plan provider raises its weekly price through the real vendor command (new revision; old paused).
select 'SAVE price' k, (pg_temp.call(3, format('select public.vendor_save_package(%L,%L,%L::jsonb,true,%L)',
  '97400000-0000-4000-8000-000000000001', private.package_revision_hash('97400000-0000-4000-8000-000000000001'),
  pg_temp.plan_content(44,'Synthetic plan lawn'), 'cs4-probe-save-000001')) - 'package')::text v;
select 'old package live?' k, is_active::text v from public.vendor_packages where id='97400000-0000-4000-8000-000000000001';
select 'AFTER accept vadd (add-on visit)' k, pg_temp.try(format('select pg_temp.accept(%L)', pg_temp.id('vadd'))) v
union all select 'AFTER accept vplain (no add-on visit)', pg_temp.try(format('select pg_temp.accept(%L)', pg_temp.id('vplain')))
union all select 'AFTER accept r2 (one-time offered)', pg_temp.try(format('select pg_temp.accept(%L)', pg_temp.id('r2')))
union all select 'AFTER vpaid payment state', (pg_temp.pay(pg_temp.id('vpaid'))->>'state')||' / '||coalesce(pg_temp.pay(pg_temp.id('vpaid'))#>>'{problem,code}','-')
union all select 'AFTER vpaid start block', pg_temp.startblock(pg_temp.id('vpaid'))
union all select 'AFTER vready payment state', (pg_temp.pay(pg_temp.id('vready'))->>'state')||' / '||coalesce(pg_temp.pay(pg_temp.id('vready'))#>>'{problem,code}','-')
union all select 'AFTER vready checkout (homeowner 2)', pg_temp.try(format('select pg_temp.checkout(2, %L)', pg_temp.id('vreadysnap')))
union all select 'AFTER r1 source (one-time accepted)', pg_temp.try('select private.money_source('''||pg_temp.id('r1')||''')')
union all select 'AFTER new visit s2', coalesce(pg_temp.visit(pg_temp.id('s2'), 9, pg_temp.day(17))::text, 'null (blocked)');
select 'AFTER vadd' k, pg_temp.req(pg_temp.id('vadd')) v, pg_temp.offer(pg_temp.id('vadd')) o
union all select 'AFTER vplain', pg_temp.req(pg_temp.id('vplain')), pg_temp.offer(pg_temp.id('vplain'))
union all select 'AFTER r2', pg_temp.req(pg_temp.id('r2')), pg_temp.offer(pg_temp.id('r2'));
rollback to price_change;

-- A non-price edit (rename only) through the same command.
select 'SAVE rename' k, (pg_temp.call(3, format('select public.vendor_save_package(%L,%L,%L::jsonb,true,%L)',
  '97400000-0000-4000-8000-000000000001', private.package_revision_hash('97400000-0000-4000-8000-000000000001'),
  pg_temp.plan_content(40,'Synthetic plan lawn renamed'), 'cs4-probe-save-000002')) - 'package')::text v;
select 'RENAME accept vadd' k, pg_temp.try(format('select pg_temp.accept(%L)', pg_temp.id('vadd'))) v
union all select 'RENAME accept vplain', pg_temp.try(format('select pg_temp.accept(%L)', pg_temp.id('vplain')))
union all select 'RENAME accept r2', pg_temp.try(format('select pg_temp.accept(%L)', pg_temp.id('r2')))
union all select 'RENAME vpaid payment state', (pg_temp.pay(pg_temp.id('vpaid'))->>'state')||' / '||coalesce(pg_temp.pay(pg_temp.id('vpaid'))#>>'{problem,code}','-')
union all select 'RENAME vready checkout', pg_temp.try(format('select pg_temp.checkout(2, %L)', pg_temp.id('vreadysnap')))
union all select 'RENAME r1 source', pg_temp.try('select private.money_source('''||pg_temp.id('r1')||''')');
rollback;
