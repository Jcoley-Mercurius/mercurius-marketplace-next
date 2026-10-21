begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-109, DEC-2026-034 (20261016001000), superseded for material changes by DEC-2026-041
-- item 4 (20261018004000): direct price corrections are refused; recorded corrections stay
-- readable. Synthetic fixtures only.
insert into auth.users(id,email,email_confirmed_at) values
 ('b7910000-0000-4000-8000-000000000001','price-operator@example.invalid',now()),
 ('b7910000-0000-4000-8000-000000000002','price-vendor@example.invalid',now()),
 ('b7910000-0000-4000-8000-000000000003','price-other-vendor@example.invalid',now());
insert into public.user_roles(user_id,role) values
 ('b7910000-0000-4000-8000-000000000001','admin'),
 ('b7910000-0000-4000-8000-000000000002','vendor'),
 ('b7910000-0000-4000-8000-000000000003','vendor');
-- 1 linked to vendor 2, 2 linked to vendor 3, 3 has no account.
insert into public.contractors(id,name,is_active,marketing_enabled,user_id) values
 ('b7920000-0000-4000-8000-000000000001','Synthetic price vendor',true,true,'b7910000-0000-4000-8000-000000000002'),
 ('b7920000-0000-4000-8000-000000000002','Synthetic other price vendor',true,true,'b7910000-0000-4000-8000-000000000003'),
 ('b7920000-0000-4000-8000-000000000003','Synthetic unlinked price vendor',true,true,null);
insert into public.service_categories(id,name) values ('synthetic-price-cat','Synthetic price category');
insert into public.services_catalog(id,name,category_id,one_time_price) values
 ('synthetic-price-svc','Synthetic price service','synthetic-price-cat',100),
 ('synthetic-price-tpl-svc','Synthetic template service','synthetic-price-cat',100);
insert into public.pricing_templates(id,service_id,name,is_active) values
 ('b7930000-0000-4000-8000-000000000001','synthetic-price-tpl-svc','Synthetic template',true);
insert into public.pricing_template_tiers(id,template_id,name,min_price,max_price) values
 ('b7940000-0000-4000-8000-000000000001','b7930000-0000-4000-8000-000000000001','Small',80,120);
insert into public.pricing_template_addons(id,template_id,addon_key,label,default_price,price_min,price_max) values
 ('b7950000-0000-4000-8000-000000000001','b7930000-0000-4000-8000-000000000001','haul','Haul away',30,20,40);
-- Packages: 1 custom fixed (vendor 1), 2 quote + deposit (vendor 1), 3 template (vendor 1),
-- 4 custom fixed (unlinked vendor 3), 5 custom fixed (vendor 2).
insert into public.vendor_packages(id,contractor_id,service_id,template_id,name,pricing_mode,default_frequency,deposit_amount,is_active) values
 ('b7960000-0000-4000-8000-000000000001','b7920000-0000-4000-8000-000000000001','synthetic-price-svc',null,'Synthetic fixed','fixed','one-time',null,true),
 ('b7960000-0000-4000-8000-000000000002','b7920000-0000-4000-8000-000000000001','synthetic-price-svc',null,'Synthetic deposit','deposit_quote','one-time',50,true),
 ('b7960000-0000-4000-8000-000000000003','b7920000-0000-4000-8000-000000000001','synthetic-price-tpl-svc','b7930000-0000-4000-8000-000000000001','Synthetic managed','fixed','one-time',null,true),
 ('b7960000-0000-4000-8000-000000000004','b7920000-0000-4000-8000-000000000003','synthetic-price-svc',null,'Synthetic unlinked','fixed','one-time',null,true),
 ('b7960000-0000-4000-8000-000000000005','b7920000-0000-4000-8000-000000000002','synthetic-price-svc',null,'Synthetic other','fixed','one-time',null,true);
insert into public.package_tiers(id,package_id,template_tier_id,name,price,frequency) values
 ('b7970000-0000-4000-8000-000000000001','b7960000-0000-4000-8000-000000000001',null,'Basic',100,'one-time'),
 ('b7970000-0000-4000-8000-000000000002','b7960000-0000-4000-8000-000000000001',null,'Plus',150,'one-time'),
 ('b7970000-0000-4000-8000-000000000003','b7960000-0000-4000-8000-000000000003','b7940000-0000-4000-8000-000000000001','Small',100,'one-time'),
 ('b7970000-0000-4000-8000-000000000004','b7960000-0000-4000-8000-000000000004',null,'Basic',100,'one-time'),
 ('b7970000-0000-4000-8000-000000000005','b7960000-0000-4000-8000-000000000005',null,'Basic',100,'one-time');
insert into public.package_addons(id,package_id,template_addon_id,name,price,is_offered) values
 ('b7980000-0000-4000-8000-000000000001','b7960000-0000-4000-8000-000000000001',null,'Synthetic extra',25,true),
 ('b7980000-0000-4000-8000-000000000002','b7960000-0000-4000-8000-000000000003','b7950000-0000-4000-8000-000000000001',null,30,true);

create function pg_temp.as_user(p_user text) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"b7910000-0000-4000-8000-00000000000'||p_user||'"}',true) $$;
create function pg_temp.pkg(p_n integer) returns uuid language sql as $$
 select ('b7960000-0000-4000-8000-00000000000'||p_n)::uuid $$;
create function pg_temp.tier(p_n integer) returns text language sql as $$
 select 'b7970000-0000-4000-8000-00000000000'||p_n $$;
create function pg_temp.correct(p_n integer, p_prices jsonb, p_reason text default 'Synthetic market correction')
returns jsonb language sql as $$
 select public.admin_correct_package_prices(pg_temp.pkg(p_n),
   (select updated_at from public.vendor_packages where id=pg_temp.pkg(p_n)), p_prices, p_reason) $$;
create function pg_temp.review(p_n integer) returns boolean language sql security definer as $$
 select needs_review from public.vendor_packages where id=pg_temp.pkg(p_n) $$;
create function pg_temp.price(p_n integer) returns numeric language sql security definer as $$
 select price from public.package_tiers where id=pg_temp.tier(p_n)::uuid $$;

-- Grants: anonymous callers cannot run any of it; the history table is private.
select ok(not has_function_privilege('anon','public.admin_correct_package_prices(uuid,timestamptz,jsonb,text)','execute'),
 'anonymous callers cannot correct prices');
select ok(not has_function_privilege('anon','public.vendor_my_package_price_corrections()','execute'),
 'anonymous callers cannot read corrections');
select ok(not has_table_privilege('authenticated','private.vendor_package_price_corrections','select'),
 'signed-in users cannot read the correction table directly');

-- A vendor cannot use the operator command, even on its own package.
select pg_temp.as_user('2');
set local role authenticated;
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',90))))$$,
 '42501','Onboarding operator required','a vendor cannot run the operator correction');
select throws_ok($$select public.admin_package_price_corrections('b7920000-0000-4000-8000-000000000001')$$,
 '42501','Onboarding operator required','a vendor cannot read operator history');
reset role;

-- DEC-2026-041 item 4: a price correction no longer changes a live package; it is proposed as a
-- replacement draft the vendor approves (SQL 085). The command is refused and changes nothing.
select pg_temp.as_user('1');
set local role authenticated;
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',120))))$$,
 '55000','A price change needs the vendor''s approval: propose it as a replacement draft','an operator cannot change a live price directly');
select throws_ok($$select pg_temp.correct(2,jsonb_build_object('deposit',40,'deposit_from',50))$$,
 '55000',null,'nor a deposit');
reset role;
select is(pg_temp.price(1),100::numeric,'the live price is unchanged');
select is((select deposit_amount from public.vendor_packages where id=pg_temp.pkg(2)),50::numeric,'the deposit is unchanged');
select is((select count(*)::int from public.notifications where user_id='b7910000-0000-4000-8000-000000000002' and type='pricing'),0,
 'no correction notice is sent');

-- Corrections recorded before DEC-2026-041 stay readable: operators see who, the vendor what and why.
insert into private.vendor_package_price_corrections(package_id, contractor_id, package_name, changes, reason, actor) values
 (pg_temp.pkg(1),'b7920000-0000-4000-8000-000000000001','Synthetic fixed',
  jsonb_build_array(jsonb_build_object('kind','tier','id',pg_temp.tier(1),'name','Basic','frequency','one-time','from',100,'to',120)),
  'Synthetic market correction','b7910000-0000-4000-8000-000000000001');
select pg_temp.as_user('1');
set local role authenticated;
select is(public.admin_package_price_corrections('b7920000-0000-4000-8000-000000000001')->0->>'actor_email',
 'price-operator@example.invalid','operator history names the operator');
reset role;
select pg_temp.as_user('2');
set local role authenticated;
select is(jsonb_array_length(public.vendor_my_package_price_corrections()),1,'the vendor reads its corrections');
select ok(not (public.vendor_my_package_price_corrections()->0 ? 'actor_email') and not (public.vendor_my_package_price_corrections()->0 ? 'actor'),
 'the vendor does not see who corrected');
select is(public.vendor_my_package_price_corrections()->0->>'reason','Synthetic market correction','the vendor sees why');
reset role;
select pg_temp.as_user('3');
set local role authenticated;
select is(public.vendor_my_package_price_corrections(),'[]'::jsonb,'another vendor sees none of them');
reset role;

select * from finish();
rollback;
