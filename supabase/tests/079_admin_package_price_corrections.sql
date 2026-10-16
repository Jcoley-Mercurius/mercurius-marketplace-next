begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
-- TRACE-109, DEC-2026-034 (20261016001000). Synthetic fixtures only: an operator corrects a
-- vendor's custom fixed, quote + deposit and managed-template package prices with a reason.
-- Every correction is recorded and notifies the linked vendor; the vendor reads what and
-- why, not who. Stale reads, non-operators and invalid amounts are refused.
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

select pg_temp.as_user('1');
set local role authenticated;

-- Refusals.
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',90))),'  ')$$,
 'P0001','Price correction reason required','a reason is required');
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',90))),repeat('x',501))$$,
 'P0001','Price correction reason too long','the reason is at most 500 characters');
select throws_ok($$select public.admin_correct_package_prices(pg_temp.pkg(1),'2000-01-01'::timestamptz,
   jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',90))),'Synthetic')$$,
 '40001','Package changed since it was read; reload before correcting prices','a stale package read is refused');
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',95,'price',90))))$$,
 '40001','Package changed since it was read; reload before correcting prices','a stale price read is refused');
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',0))))$$,
 'P0001','Each price must be a positive amount in whole cents','a zero price is refused');
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',-5))))$$,
 'P0001','Each price must be a positive amount in whole cents','a negative price is refused');
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',90.005))))$$,
 'P0001','Each price must be a positive amount in whole cents','a fraction of a cent is refused');
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',100,'price','90'))))$$,
 'P0001','Each price must be a positive amount in whole cents','a price given as text is refused');
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(5),'from',100,'price',90))))$$,
 'P0001','Tier does not belong to this package','another package''s tier is refused');
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(
   jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',90),jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',95))))$$,
 'P0001','Each price may be changed once per correction','the same tier twice is refused');
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',100))))$$,
 'P0001','No price changed','a correction that changes nothing is refused');
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('deposit',40,'deposit_from',null))$$,
 'P0001','Only a quote + deposit package has a deposit','a fixed package has no deposit');
select throws_ok($$select public.admin_correct_package_prices('b7960000-0000-4000-8000-0000000000ff',now(),'{}'::jsonb,'Synthetic')$$,
 'P0002','Package not found','an unknown package is refused');
select is(pg_temp.price(1),100::numeric,'refused corrections changed nothing');

-- Custom fixed: an in-band correction applies, a far one stays under review, all or nothing.
select is(pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(
   jsonb_build_object('id',pg_temp.tier(1),'from',100,'price',120),
   jsonb_build_object('id',pg_temp.tier(2),'from',150,'price',150)),
 'addons',jsonb_build_array(jsonb_build_object('id','b7980000-0000-4000-8000-000000000001','from',25,'price',35))))
 - 'updated_at','{"changed":2,"needs_review":false,"vendor_notified":true}'::jsonb,
 'a correction applies changed tier and add-on prices and skips unchanged ones');
select is(pg_temp.price(1),120::numeric,'the tier price is corrected');
select is(pg_temp.price(2),150::numeric,'the unchanged tier keeps its price');
select is((pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',120,'price',1000))))->>'needs_review')::boolean,
 true,'a correction outside the guardrail band stays under review (not an approval)');
select is((pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(1),'from',1000,'price',110.5))))->>'needs_review')::boolean,
 false,'a correction back inside the band clears the flag');
select throws_ok($$select pg_temp.correct(1,jsonb_build_object('tiers',jsonb_build_array(
   jsonb_build_object('id',pg_temp.tier(1),'from',110.5,'price',99),jsonb_build_object('id',pg_temp.tier(2),'from',150,'price',0))))$$,
 'P0001','Each price must be a positive amount in whole cents','one invalid price refuses the whole correction');
select is(pg_temp.price(1),110.5::numeric,'nothing from the refused correction was kept');

-- Quote + deposit.
select throws_ok($$select pg_temp.correct(2,jsonb_build_object('deposit',40,'deposit_from',45))$$,
 '40001','Package changed since it was read; reload before correcting prices','a stale deposit read is refused');
select is(pg_temp.correct(2,jsonb_build_object('deposit',40,'deposit_from',50))->>'changed','1','the deposit is corrected');
reset role;
select is((select deposit_amount from public.vendor_packages where id=pg_temp.pkg(2)),40::numeric,'the new deposit is saved');
set local role authenticated;

-- Managed template: re-evaluated against the template ranges.
select is((pg_temp.correct(3,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(3),'from',100,'price',130))))->>'needs_review')::boolean,
 true,'a template tier above its range is flagged');
select is((pg_temp.correct(3,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(3),'from',130,'price',115))))->>'needs_review')::boolean,
 false,'back inside the template range clears the flag');
select is((pg_temp.correct(3,jsonb_build_object('addons',jsonb_build_array(jsonb_build_object('id','b7980000-0000-4000-8000-000000000002','from',30,'price',45))))->>'needs_review')::boolean,
 true,'an offered template add-on above its range is flagged');

-- An unlinked provider is corrected without a notification.
select is((pg_temp.correct(4,jsonb_build_object('tiers',jsonb_build_array(jsonb_build_object('id',pg_temp.tier(4),'from',100,'price',105))))->>'vendor_notified')::boolean,
 false,'no notification without a linked vendor account');

-- Operator history.
select is(jsonb_array_length(public.admin_package_price_corrections('b7920000-0000-4000-8000-000000000001')),7,
 'operator history lists every correction for the provider');
select is(public.admin_package_price_corrections('b7920000-0000-4000-8000-000000000001')->-1->>'actor_email',
 'price-operator@example.invalid','operator history names the operator');
select is(public.admin_package_price_corrections('b7920000-0000-4000-8000-000000000001')->-1->'changes',
 jsonb_build_array(
   jsonb_build_object('kind','tier','id',pg_temp.tier(1),'name','Basic','frequency','one-time','from',100,'to',120),
   jsonb_build_object('kind','addon','id','b7980000-0000-4000-8000-000000000001','name','Synthetic extra','from',25,'to',35)),
 'the first correction records old and new values');
reset role;

select is((select count(*)::int from public.notifications where user_id='b7910000-0000-4000-8000-000000000002' and type='pricing'),7,
 'each correction notifies the linked vendor');
select is((select link from public.notifications where user_id='b7910000-0000-4000-8000-000000000002' and type='pricing'
  and body like 'Synthetic managed:%' limit 1),'/vendor/pricing','a template correction links to managed pricing');
select is((select count(*)::int from public.notifications where user_id='b7910000-0000-4000-8000-000000000002' and type='pricing'
  and link='/vendor/packages' and body='Synthetic fixed: Synthetic market correction'),3,
 'the notification gives the package and the reason');

-- The vendor reads its own corrections: what and why, not who.
select pg_temp.as_user('2');
set local role authenticated;
select is(jsonb_array_length(public.vendor_my_package_price_corrections()),7,'the vendor reads its corrections');
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
