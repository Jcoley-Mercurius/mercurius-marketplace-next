#!/bin/sh
# Lock-order demonstration for TRACE-126/127 (F-B4). Isolated local stack only; committed synthetic
# rows; reset the stack afterwards. Session A takes checkout locks in a given order; session B runs
# the real vendor_save_package on the same package in between.
set -u
P="docker exec -i supabase_db_mercurius-phase5-isolated psql -U postgres -At -v ON_ERROR_STOP=1"
$P <<'SQL' >/dev/null
insert into auth.users(id,email) values ('b0b00000-0000-4000-8000-000000000001','lock-order-vendor@example.invalid') on conflict do nothing;
delete from public.user_roles where user_id='b0b00000-0000-4000-8000-000000000001';
insert into public.user_roles(user_id,role) values ('b0b00000-0000-4000-8000-000000000001','vendor');
insert into public.service_categories(id,name) values ('synthetic-lo-cat','Synthetic lock order') on conflict do nothing;
insert into public.services_catalog(id,name,category_id,one_time_price,weekly_price,default_frequency,available_frequencies,is_active)
  values ('synthetic-lo-svc','Synthetic lock order','synthetic-lo-cat',60,40,'weekly','{one-time,weekly}',true) on conflict do nothing;
insert into public.contractors(id,user_id,name,is_active,marketing_enabled)
  values ('b0b20000-0000-4000-8000-000000000001','b0b00000-0000-4000-8000-000000000001','Synthetic lock-order vendor',true,true) on conflict do nothing;
SQL
run() { # $1 label, $2 lock statements for session A (before the sleep), $3 after the sleep
  $P -c "set mercurius.package_maintenance = 'on'; delete from public.package_tiers where package_id in (select id from public.vendor_packages where contractor_id='b0b20000-0000-4000-8000-000000000001'); delete from public.vendor_packages where contractor_id='b0b20000-0000-4000-8000-000000000001'" >/dev/null 2>&1
  $P <<'SQL' | sed "s/^/  fixture: /"
insert into public.vendor_packages(id,contractor_id,service_id,name,pricing_mode,default_frequency,is_active,needs_review)
  values ('b0b40000-0000-4000-8000-000000000001','b0b20000-0000-4000-8000-000000000001','synthetic-lo-svc','Synthetic lock plan','fixed','weekly',false,false)
  on conflict do nothing;
insert into public.package_tiers(id,package_id,name,price,frequency,sort_order,rule_conditions)
  values ('b0b50000-0000-4000-8000-000000000001','b0b40000-0000-4000-8000-000000000001','Weekly',40,'weekly',0,'[]') on conflict do nothing;
update public.vendor_packages set is_active = true where id='b0b40000-0000-4000-8000-000000000001';
select 'fixture tier rows: ' || count(*) from public.package_tiers where package_id='b0b40000-0000-4000-8000-000000000001';
SQL
  ( $P <<SQL 2>&1 | sed "s/^/  A: /" ) &
begin; $2 select pg_sleep(3); $3 select 'A committed'; commit;
SQL
  sleep 1
  $P <<SQL 2>&1 | sed "s/^/  B: /"
begin;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b0b00000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select 'B saved revision ' || (public.vendor_save_package('b0b40000-0000-4000-8000-000000000001',
  (select x.package_revision from public.vendor_package_revisions(array['b0b40000-0000-4000-8000-000000000001']::uuid[]) x),
  jsonb_build_object('service_id','synthetic-lo-svc','package',jsonb_build_object('name','Synthetic lock plan','pricing_mode','fixed','default_frequency','weekly'),
    'questions','[]'::jsonb,'tiers',jsonb_build_array(jsonb_build_object('name','Weekly','price',44,'frequency','weekly')),'addons','[]'::jsonb),
  true, 'lock-order-' || md5(clock_timestamp()::text)) ->> 'revision_number');
rollback;
SQL
  wait
}
echo "1. Current money_source visit-branch order (tier, package, then provider):"
run visit "select 1 from public.package_tiers where id='b0b50000-0000-4000-8000-000000000001' for share; select 1 from public.vendor_packages where id='b0b40000-0000-4000-8000-000000000001' for share;" "select 1 from public.contractors where id='b0b20000-0000-4000-8000-000000000001' for share;"
echo "2. Current one-time order (table SHARE on promotions/questions, package, tier, then provider):"
run onetime "lock table public.package_promotions, public.package_qualifying_questions in share mode; select 1 from public.vendor_packages where id='b0b40000-0000-4000-8000-000000000001' for share; select 1 from public.package_tiers where id='b0b50000-0000-4000-8000-000000000001' for share;" "select 1 from public.contractors where id='b0b20000-0000-4000-8000-000000000001' for share;"
echo "3. Proposed R-5 order (provider, package, tier):"
run proposed "select 1 from public.contractors where id='b0b20000-0000-4000-8000-000000000001' for share; select 1 from public.vendor_packages where id='b0b40000-0000-4000-8000-000000000001' for share;" "select 1 from public.package_tiers where id='b0b50000-0000-4000-8000-000000000001' for share;"
