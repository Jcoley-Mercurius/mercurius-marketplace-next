begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-118, DEC-2026-044: operators add services to the catalog from Service Catalog, and
-- hide them to take them away. No migration: this pins the existing policies the page
-- relies on. Only an admin writes the catalog; a shown service is public, a hidden one is not.
insert into auth.users(id,email,email_confirmed_at) values
 ('b8910000-0000-4000-8000-000000000001','catalog-operator@example.invalid',now()),
 ('b8910000-0000-4000-8000-000000000002','catalog-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b8910000-0000-4000-8000-000000000001','admin'),
 ('b8910000-0000-4000-8000-000000000002','vendor');
insert into public.service_categories(id,name,is_active) values ('synthetic-catalog-cat','Synthetic catalog category',true);

create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b8910000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;

-- The row the page inserts.
select pg_temp.as_user('1');
set local role authenticated;
select lives_ok($$
 insert into public.services_catalog(id,name,descriptor,category_id,icon,tags,weekly_price,monthly_price,one_time_price,
   default_frequency,available_frequencies,pricing_mode,default_deposit_amount,is_active,is_popular,sort_order)
 values ('synthetic-roof-replacement','Synthetic Roof Replacement','Shingle, metal & tile roof replacement','synthetic-catalog-cat',
   'HardHat','{roof,shingles}',null,0,0,'one-time','{one-time}','custom_quote',null,true,false,1000) $$,
 'an admin adds a service');
select throws_ok($$
 insert into public.services_catalog(id,name,category_id) values ('synthetic-roof-replacement','Synthetic duplicate','synthetic-catalog-cat') $$,
 '23505', null, 'a service id cannot be reused');
select throws_ok($$
 insert into public.services_catalog(id,name,category_id) values ('synthetic-orphan','Synthetic orphan','synthetic-missing-cat') $$,
 '23503', null, 'a service needs an existing category');
reset role;

select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$
 insert into public.services_catalog(id,name,category_id) values ('synthetic-vendor-service','Synthetic vendor service','synthetic-catalog-cat') $$,
 '42501', null, 'a vendor cannot add a service');
update public.services_catalog set is_active = false where id = 'synthetic-roof-replacement';
reset role;
select is((select is_active from public.services_catalog where id = 'synthetic-roof-replacement'), true, 'a vendor cannot hide a service');

set local role anon;
select is((select name from public.services_catalog where id = 'synthetic-roof-replacement'), 'Synthetic Roof Replacement',
 'a shown service is public as soon as it is added');
select is((select tags from public.services_catalog where id = 'synthetic-roof-replacement'), array['roof','shingles'],
 'its search tags are stored');
select throws_ok($$ insert into public.services_catalog(id,name,category_id) values ('synthetic-anon','Synthetic anon','synthetic-catalog-cat') $$,
 '42501', null, 'a visitor cannot add a service');
reset role;

-- Taking a service away hides it and keeps the row.
select pg_temp.as_user('1');
set local role authenticated;
update public.services_catalog set is_active = false where id = 'synthetic-roof-replacement';
select is((select is_active from public.services_catalog where id = 'synthetic-roof-replacement'), false, 'an admin hides a service and still sees it');
reset role;
set local role anon;
select is((select count(*)::int from public.services_catalog where id = 'synthetic-roof-replacement'), 0, 'a hidden service is not public');
reset role;

select * from finish();
rollback;
