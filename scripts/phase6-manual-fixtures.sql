-- Phase 6 manual acceptance fixtures (TRACE-137). LOCAL ISOLATED STACK ONLY. Synthetic data only.
-- Creates signed-in synthetic accounts and leaves each critical journey at a checkpoint a person can
-- review with a screen reader, a real device, zoom or a visual comparison
-- (governance/PHASE-6-MANUAL-ACCEPTANCE.md). It uses the same commands as SQL 109, so every state is
-- one the product itself produces. Payments are synthetic events only; nothing reaches Stripe or a
-- bank. Committed, not rolled back: reset the isolated stack afterwards (scripts/phase5-db.sh reset).
--
-- Refuses to run when any account outside @example.invalid exists, so it cannot run against a
-- database that holds real people (hosted included).
--
-- Run: docker exec -i supabase_db_mercurius-phase5-isolated psql -U postgres -v ON_ERROR_STOP=1 < scripts/phase6-manual-fixtures.sql
begin;

do $$ begin
  if exists (select 1 from auth.users where email is null or email not like '%@example.invalid') then
    raise exception 'Refusing: this database has non-synthetic accounts. Use the isolated local stack only.';
  end if;
  if exists (select 1 from auth.users where email like 'manual-%@example.invalid') then
    raise exception 'Manual fixtures already present. Reset the isolated stack first (scripts/phase5-db.sh reset).';
  end if;
end $$;

-- Accounts: the password is a local-only synthetic value, documented for the isolated stack. It is
-- not a credential for any real system.
-- 1 homeowner A, 2 homeowner B, 3 provider P, 4 provider Q, 5–6 operators with finance authority,
-- 7 operator without finance authority.
create temp table manual_accounts(n integer primary key, email text, label text);
insert into manual_accounts values
 (1,'manual-homeowner-a@example.invalid','Homeowner A'),(2,'manual-homeowner-b@example.invalid','Homeowner B'),
 (3,'manual-provider-p@example.invalid','Provider P'),(4,'manual-provider-q@example.invalid','Provider Q'),
 (5,'manual-operator-1@example.invalid','Operator 1 (finance)'),(6,'manual-operator-2@example.invalid','Operator 2 (finance)'),
 (7,'manual-operator-3@example.invalid','Operator 3 (no finance)');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,
  created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
select '00000000-0000-0000-0000-000000000000',('10a00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated',email,
  extensions.crypt('synthetic-local-only',extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}',
  jsonb_build_object('full_name','Synthetic '||label),now(),now(),'','','',''
from manual_accounts;
insert into auth.identities(id,user_id,provider_id,provider,identity_data,last_sign_in_at,created_at,updated_at)
select gen_random_uuid(),('10a00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('10a00000-0000-4000-8000-'||lpad(n::text,12,'0')),'email',
  jsonb_build_object('sub',('10a00000-0000-4000-8000-'||lpad(n::text,12,'0')),'email',email,'email_verified',true),now(),now(),now()
from manual_accounts;
delete from public.user_roles where user_id in (select ('10a00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(3,7) n);
insert into public.user_roles(user_id,role) values
 ('10a00000-0000-4000-8000-000000000003','vendor'),('10a00000-0000-4000-8000-000000000004','vendor'),
 ('10a00000-0000-4000-8000-000000000005','admin'),('10a00000-0000-4000-8000-000000000006','admin'),
 ('10a00000-0000-4000-8000-000000000007','admin');
insert into public.money_authorities(user_id,granted_by,reason) values
 ('10a00000-0000-4000-8000-000000000005','10a00000-0000-4000-8000-000000000006','Synthetic manual review'),
 ('10a00000-0000-4000-8000-000000000006','10a00000-0000-4000-8000-000000000005','Synthetic manual review');

-- Catalog, coverage and providers (as SQL 109).
insert into public.service_categories(id,name) values ('synthetic-manual-cat','Synthetic manual review');
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,monthly_price,default_frequency,available_frequencies,is_active,pricing_mode) values
 ('synthetic-manual-lawn','Synthetic lawn care','synthetic-manual-cat',60,40,120,'weekly','{one-time,weekly,monthly}',true,'fixed'),
 ('synthetic-manual-tree','Synthetic tree work','synthetic-manual-cat',0,null,0,'one-time','{one-time}',true,'custom_quote');
insert into public.coverage_areas(zip_code,city,is_active,has_waitlist) values ('00110','Synthetic',true,false);
insert into private.r0_lee_zips values ('00110');
insert into private.r0_trial_admissions(homeowner_id,zip_code,service_id,granted_by)
  select ('10a00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'00110',s,'10a00000-0000-4000-8000-000000000005'
  from unnest(array[1,2]) n, unnest(array['synthetic-manual-lawn','synthetic-manual-tree']) s;
insert into public.contractors(id,user_id,name,is_active,marketing_enabled) values
 ('10a20000-0000-4000-8000-000000000001','10a00000-0000-4000-8000-000000000003','Synthetic Provider P',true,true),
 ('10a20000-0000-4000-8000-000000000002','10a00000-0000-4000-8000-000000000004','Synthetic Provider Q',true,true);
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('10a20000-0000-4000-8000-000000000001','00110'),('10a20000-0000-4000-8000-000000000002','00110');
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review) values
 ('10a40000-0000-4000-8000-000000000001','10a20000-0000-4000-8000-000000000001','synthetic-manual-lawn','Synthetic lawn care','fixed','weekly',true,false),
 ('10a40000-0000-4000-8000-000000000002','10a20000-0000-4000-8000-000000000001','synthetic-manual-tree','Synthetic tree work quote','custom_quote','one-time',true,false);
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions) values
 ('10a50000-0000-4000-8000-000000000001','10a40000-0000-4000-8000-000000000001','Weekly',40,'weekly',0,'[]'),
 ('10a50000-0000-4000-8000-000000000002','10a40000-0000-4000-8000-000000000001','One time',60,'one-time',1,'[]');

-- Harness (as SQL 109).
create temp table fx(key text primary key, id uuid);
grant select, insert on fx to authenticated;
create function pg_temp.u(n integer) returns uuid language sql as $$ select ('10a00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.id(k text) returns uuid language sql as $$ select id from fx where key = k $$;
create function pg_temp.k() returns uuid language sql as $$ select gen_random_uuid() $$;
create function pg_temp.call(p_user integer, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb; previous text := current_setting('request.jwt.claims', true);
begin
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.u(p_user))::text,true);
  set local role authenticated;
  execute 'select to_jsonb(x) from ('||p_sql||') x limit 1' into r;
  reset role;
  -- A single-column result (a function call) is returned unwrapped.
  if jsonb_typeof(r) = 'object' and (select count(*) from jsonb_object_keys(r)) = 1 then
    r := (select value from jsonb_each(r));
  end if;
  perform set_config('request.jwt.claims',coalesce(previous,''),true);
  return r;
end $$;
create function pg_temp.submit(p_key text, p_selection jsonb) returns uuid language sql as $$
  select (pg_temp.call(1, format('select public.submit_service_requests(%L,%L::jsonb)', 'manual-'||left(md5(p_key),24), jsonb_build_object(
    'location',jsonb_build_object('address','1 Synthetic Way','city','Synthetic','state','FL','zip_code','00110'),
    'preferred_time','Synthetic window','selections',jsonb_build_array(p_selection))))#>>'{requests,0,request_id}')::uuid $$;
create function pg_temp.lawn(p_frequency text) returns jsonb language sql as $$
  select jsonb_build_object('service_id','synthetic-manual-lawn','frequency',p_frequency,'package_id','10a40000-0000-4000-8000-000000000001',
    'tier_id',case p_frequency when 'weekly' then '10a50000-0000-4000-8000-000000000001' else '10a50000-0000-4000-8000-000000000002' end,
    'preferred_contractor_id','10a20000-0000-4000-8000-000000000001',
    'expected',jsonb_build_object('pricing_mode','fixed','total',case p_frequency when 'weekly' then 40 else 60 end)) $$;
create function pg_temp.accepted(p_key text, p_frequency text default 'one-time') returns uuid language plpgsql as $$
declare r uuid := pg_temp.submit(p_key, pg_temp.lawn(p_frequency));
begin
  perform private.offer_next_for_request_internal(r);
  perform pg_temp.call(3, format('select public.vendor_accept_job(%L)', r));
  return r;
end $$;
create function pg_temp.day(n integer) returns timestamp language sql stable as $$
  select (now() at time zone 'America/New_York')::date + n + time '09:00' $$;
create function pg_temp.appointment(p_job uuid, p_day integer) returns void language sql as $$
  select pg_temp.call(5, format('select public.admin_record_appointment(%L,%L,%L,%L,null,%L)',
    p_job, pg_temp.k(), pg_temp.day(p_day) at time zone 'America/New_York', pg_temp.day(p_day), 'Synthetic: agreed by phone')) $$;
create function pg_temp.publish(request uuid, cents bigint) returns uuid language plpgsql as $$
declare terms jsonb:=jsonb_build_object('service',cents,'addons',0,'discount',0,'adjustment',0,'subtotal',cents,'tax',0,'tip',0,
    'deposit',0,'total',cents,'currency','usd','source_version',private.money_source(request)->>'version','policy_version','CFG-005',
    'tax_evidence','synthetic-tax-decision','reason','Synthetic manual review','expires_at',now()+interval '7 days');
  prior text:=current_setting('request.jwt.claims',true);
begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"10a00000-0000-4000-8000-000000000006"}',true);
  perform public.money_approve_review('10a00000-0000-4000-8000-000000000005',
    jsonb_build_object('operation','snapshot','request',request,'terms',terms),'Independent manual review');
  perform set_config('request.jwt.claims',coalesce(prior,''),true);
  return public.money_publish_snapshot(request,terms,'10a00000-0000-4000-8000-000000000005','10a00000-0000-4000-8000-000000000006');
end $$;
create function pg_temp.pay(p_job uuid, p_cents bigint) returns void language plpgsql as $$
declare attempt uuid := (pg_temp.call(1, format('select public.money_prepare_checkout(%L,''full'')', pg_temp.publish(p_job, p_cents)))->>'id')::uuid;
  event text := 'evt_manual_'||replace(p_job::text,'-','');
begin
  perform public.money_receive_event(event, 'capture', jsonb_build_object('attempt_id',attempt,'payment_id','pi_manual_'||left(replace(p_job::text,'-',''),12),'amount',p_cents,'currency','usd'));
  perform public.money_process_event(event);
end $$;
create function pg_temp.photo(p_job uuid, p_name text) returns text language plpgsql as $$
declare path text := pg_temp.u(3)::text||'/'||p_job::text||'/'||p_name;
begin
  insert into storage.objects(bucket_id, name, owner) values ('job-photos', path, pg_temp.u(3));
  return path;
end $$;
create function pg_temp.started(p_job uuid) returns void language sql as $$
  select pg_temp.call(3, format('select public.start_job(%L,%L,null)', p_job, pg_temp.k())) $$;
create function pg_temp.completed(p_job uuid) returns void language plpgsql as $$
begin
  perform pg_temp.started(p_job);
  perform pg_temp.call(3, format('select public.vendor_complete_job(%L,%L)', p_job, array[pg_temp.photo(p_job,'before.jpg'), pg_temp.photo(p_job,'after.jpg')]));
end $$;
create function pg_temp.confirmed(p_job uuid) returns void language plpgsql as $$
begin
  perform pg_temp.completed(p_job);
  perform pg_temp.call(1, format('select public.homeowner_confirm_completion(%L,%L)', p_job,
    (select vendor_completed_at from public.service_requests where id = p_job)));
end $$;

do $$ begin perform pg_temp.call(5, 'select public.set_completion_evidence_rule(''synthetic-manual-lawn'', 2, ''Synthetic two-photo rule'')'); end $$;

-- Journey checkpoints. M-numbers match governance/PHASE-6-MANUAL-ACCEPTANCE.md.
-- M2 offered to Provider P (accept/decline, four-hour window).
do $$ declare r uuid := pg_temp.submit('manual-m2-offered', pg_temp.lawn('one-time')); begin
  perform private.offer_next_for_request_internal(r); insert into fx values ('m2', r); end $$;
-- M3 appointment recorded and reviewed terms ready: homeowner sees "Review and pay" (stop before paying).
do $$ declare r uuid := pg_temp.accepted('manual-m3-pay'); begin
  perform pg_temp.appointment(r, 6); perform pg_temp.publish(r, 6000); insert into fx values ('m3', r); end $$;
-- M4 paid and scheduled: Provider P can start.
do $$ declare r uuid := pg_temp.accepted('manual-m4-start'); begin
  perform pg_temp.appointment(r, 2); perform pg_temp.pay(r, 6000); insert into fx values ('m4', r); end $$;
-- M5 in progress: Provider P completes with photos.
do $$ declare r uuid := pg_temp.accepted('manual-m5-complete'); begin
  perform pg_temp.pay(r, 6000); perform pg_temp.started(r); insert into fx values ('m5', r); end $$;
-- M6 awaiting the homeowner's confirmation (confirm or report an issue).
do $$ declare r uuid := pg_temp.accepted('manual-m6-confirm'); begin
  perform pg_temp.pay(r, 6000); perform pg_temp.completed(r); insert into fx values ('m6', r); end $$;
-- M7 confirmed and reviewable.
do $$ declare r uuid := pg_temp.accepted('manual-m7-review'); begin
  perform pg_temp.pay(r, 6000); perform pg_temp.confirmed(r); insert into fx values ('m7', r); end $$;
-- M8 disputed: evidence, operator decision, then appeal.
do $$ declare r uuid := pg_temp.accepted('manual-m8-dispute'); begin
  perform pg_temp.pay(r, 6000); perform pg_temp.completed(r);
  perform pg_temp.call(1, format('select public.homeowner_dispute_completion(%L,%L,%L)', r,
    (select vendor_completed_at from public.service_requests where id = r), 'Synthetic: the back corner was missed'));
  insert into fx values ('m8', r); end $$;
-- M9 paid with an appointment six days out: homeowner previews cancel and reschedule.
do $$ declare r uuid := pg_temp.accepted('manual-m9-cancel'); begin
  perform pg_temp.appointment(r, 6); perform pg_temp.pay(r, 6000); insert into fx values ('m9', r); end $$;
-- M10 provider withdrew: replacement decision open for the homeowner and operations.
do $$ declare r uuid := pg_temp.accepted('manual-m10-withdrawn'); begin
  perform pg_temp.appointment(r, 6); perform pg_temp.pay(r, 6000);
  perform pg_temp.call(3, format('select public.record_job_operation(%L,%L,''provider_cancel'',''Synthetic: truck broke down'',null,false)', r, pg_temp.k()));
  insert into fx values ('m10', r); end $$;
-- M11 weekly plan with two visits: visit 1 paid and awaiting confirmation; visit 2 accepted, unpaid.
do $$ declare plan uuid := pg_temp.accepted('manual-m11-plan', 'weekly'); v1 uuid; v2 uuid; begin
  v1 := (pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,%L)', plan, pg_temp.k(),
    pg_temp.day(1) at time zone 'America/New_York', pg_temp.day(1), 'Synthetic visit 1'))->>'occurrence_id')::uuid;
  v2 := (pg_temp.call(5, format('select public.admin_create_recurring_visit(%L,%L,%L,%L,%L)', plan, pg_temp.k(),
    pg_temp.day(8) at time zone 'America/New_York', pg_temp.day(8), 'Synthetic visit 2'))->>'occurrence_id')::uuid;
  perform pg_temp.call(3, format('select public.vendor_accept_job(%L)', v1));
  perform pg_temp.call(3, format('select public.vendor_accept_job(%L)', v2));
  perform pg_temp.pay(v1, 4000); perform pg_temp.completed(v1);
  insert into fx values ('m11', plan), ('m11-v1', v1), ('m11-v2', v2); end $$;
-- M12 quote sent with tax pending (approval is refused by design, Q-1).
do $$ declare r uuid := pg_temp.submit('manual-m12-quote', jsonb_build_object('service_id','synthetic-manual-tree','frequency','one-time',
    'package_id','10a40000-0000-4000-8000-000000000002','preferred_contractor_id','10a20000-0000-4000-8000-000000000001',
    'expected',jsonb_build_object('pricing_mode','quote')));
begin
  perform private.offer_next_for_request_internal(r);
  perform pg_temp.call(3, format('select public.vendor_accept_job(%L)', r));
  perform pg_temp.call(3, format('select public.vendor_propose_quote(%L,%L::jsonb,%L,0)', r, '[{"kind":"labor","description":"Limb removal","quantity":1,"unit_cents":30000}]', 'Remove one limb'));
  perform pg_temp.call(5, format('select public.admin_send_itemized_quote(%L,%L::jsonb,%L,%L,0)', r, '[{"kind":"labor","description":"Limb removal","quantity":1,"unit_cents":30000}]', 'Remove one limb', 'Synthetic send'));
  insert into fx values ('m12', r); end $$;

-- Readback for the person running the checks (no credentials printed).
select key as checkpoint, id as request_id, (select status::text from public.service_requests where id = fx.id) as status from fx order by key;
commit;
