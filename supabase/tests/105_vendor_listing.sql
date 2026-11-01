-- TRACE-134 (6.11B, 20261105001000). Synthetic fixtures only.
-- (1) DEC-2026-055 item 1: Special Offer earns no ranking points (balanced-v2); its stored text is
--     kept, operators read it and vendors can no longer change it.
-- (2) No path enables a legacy package promotion; matched prices carry no overlay.
-- (3) A version records its first publication: a never-published draft has none; pausing keeps it;
--     clients cannot write it.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users(id,email,email_confirmed_at) values
 ('c1050000-0000-4000-8000-000000000004','vl-homeowner@example.invalid',now()),
 ('c1050000-0000-4000-8000-000000000001','vl-operator@example.invalid',now()),
 ('c1050000-0000-4000-8000-000000000002','vl-vendor-a@example.invalid',now()),
 ('c1050000-0000-4000-8000-000000000003','vl-vendor-b@example.invalid',now());
delete from public.user_roles where user_id in ('c1050000-0000-4000-8000-000000000002','c1050000-0000-4000-8000-000000000003');
insert into public.user_roles(user_id,role) values
 ('c1050000-0000-4000-8000-000000000001','admin'),
 ('c1050000-0000-4000-8000-000000000002','vendor'),
 ('c1050000-0000-4000-8000-000000000003','vendor');
-- Identical profiles except A's Special Offer.
insert into public.contractors(id,name,is_active,marketing_enabled,user_id,services,location,bio,special_offer) values
 ('c1051000-0000-4000-8000-00000000000a','Synthetic listing vendor A',true,true,'c1050000-0000-4000-8000-000000000002','{synthetic-vl-svc}','Fort Myers','Synthetic bio','Synthetic 20% off'),
 ('c1051000-0000-4000-8000-00000000000b','Synthetic listing vendor B',true,true,'c1050000-0000-4000-8000-000000000003','{synthetic-vl-svc}','Fort Myers','Synthetic bio',null);
insert into public.service_categories(id,name) values ('synthetic-vl-cat','Synthetic listing');
insert into public.services_catalog(id,name,category_id,one_time_price,monthly_price,pricing_mode,default_frequency,available_frequencies,is_active) values
 ('synthetic-vl-svc','Synthetic listing service','synthetic-vl-cat',100,100,'fixed','monthly','{monthly}',true);
insert into public.coverage_areas(zip_code,city,is_active) values ('33901','Fort Myers',true) on conflict (zip_code) do update set is_active = true;
insert into public.contractor_service_zips(contractor_id,zip_code) values
 ('c1051000-0000-4000-8000-00000000000a','33901'),('c1051000-0000-4000-8000-00000000000b','33901');

create function pg_temp.as_user(p_n integer) returns void language sql as $$
 select set_config('request.jwt.claims','{"role":"authenticated","sub":"c1050000-0000-4000-8000-00000000000'||p_n||'"}',true) $$;
create function pg_temp.content(p_name text) returns jsonb language sql as $$
 select jsonb_build_object('service_id','synthetic-vl-svc','package',jsonb_build_object('name',p_name,'pricing_mode','fixed','default_frequency','monthly'),
   'tiers',jsonb_build_array(jsonb_build_object('name','Monthly','price',80,'frequency','monthly'))) $$;
create temp table saved(name text primary key, r jsonb);
grant all on saved to authenticated;

-- Both vendors publish the same price.
select pg_temp.as_user(2);
set local role authenticated;
insert into saved values ('a', public.vendor_save_package(null, null, pg_temp.content('Synthetic plan'), true, 'save-key-vl-00000000a1'));
reset role;
select pg_temp.as_user(3);
set local role authenticated;
insert into saved values ('b', public.vendor_save_package(null, null, pg_temp.content('Synthetic plan'), true, 'save-key-vl-00000000b1'));
reset role;

-- (1) Ranking.
select is((select count(distinct profile_score)::int from private.find_eligible_packages_with_answers(null,'synthetic-vl-svc','monthly','33901',null,null)
  where contractor_name like 'Synthetic listing vendor %'), 1, 'a Special Offer adds no profile points: both vendors score the same');
select is((select count(*)::int from private.find_eligible_packages_with_answers(null,'synthetic-vl-svc','monthly','33901',null,null)
  where contractor_name like 'Synthetic listing vendor %'), 2, 'both still match');
select ok((select prosrc like '%''ranking_version'',''balanced-v2''%' from pg_proc where proname = 'create_job_offer_internal'),
  'new offers record ranking balanced-v2');
select ok((select prosrc not like '%special_offer%' from pg_proc where proname = 'find_eligible_packages_with_answers'), 'matching no longer reads Special Offer');
select pg_temp.as_user(2);
set local role authenticated;
select throws_ok($$update public.contractors set special_offer = 'Changed' where user_id = auth.uid()$$, '42501', null, 'the vendor can no longer change its Special Offer');
select lives_ok($$update public.contractors set bio = 'Synthetic bio, edited' where user_id = auth.uid()$$, 'and still edits its other profile fields');
reset role;
select pg_temp.as_user(1);
set local role authenticated;
select is((select special_offer from public.contractors where id = 'c1051000-0000-4000-8000-00000000000a'), 'Synthetic 20% off', 'the operator still reads the stored text');
reset role;

-- (2) Legacy promotions.
select throws_ok($$insert into public.package_promotions(package_id,promotion_type,percent_off,label,starts_at,ends_at,is_enabled)
  values ((select (r->>'package_id')::uuid from saved where name='a'),'percent_off',50,'Half off',now() - interval '1 hour',now() + interval '1 day',true)$$,
  '55000', 'Package promotions are closed; Mercurius offers use reviewed promotion offers', 'an enabled legacy promotion is refused');
insert into public.package_promotions(id,package_id,promotion_type,percent_off,label,starts_at,ends_at,is_enabled)
  values ('c1052000-0000-4000-8000-000000000001',(select (r->>'package_id')::uuid from saved where name='a'),'percent_off',50,'Half off',now() - interval '1 hour',now() + interval '1 day',false);
select throws_ok($$update public.package_promotions set is_enabled = true where id = 'c1052000-0000-4000-8000-000000000001'$$,
  '55000', null, 'a disabled one cannot be turned on');
select is((select string_agg(contractor_name || ':' || effective_price || ':' || (promotion_id is null)::text, ',' order by contractor_name)
  from private.find_eligible_packages_with_answers(null,'synthetic-vl-svc','monthly','33901',null,null) where contractor_name like 'Synthetic listing vendor %'),
  'Synthetic listing vendor A:80:true,Synthetic listing vendor B:80:true', 'matched prices carry no overlay');

-- (3) First publication.
select pg_temp.as_user(2);
set local role authenticated;
insert into saved values ('d', public.vendor_save_package(null, null, pg_temp.content('Synthetic draft'), false, 'save-key-vl-00000000d1'));
reset role;
select is((select first_published_at from public.vendor_packages where id = (select (r->>'package_id')::uuid from saved where name='d')), null,
  'a never-published draft has no first publication');
select isnt((select first_published_at from public.vendor_packages where id = (select (r->>'package_id')::uuid from saved where name='a')), null,
  'a published version records it');
select pg_temp.as_user(2);
set local role authenticated;
select public.vendor_set_package_active((select (r->>'package_id')::uuid from saved where name='a'), false,
  (select updated_at from public.vendor_packages where id = (select (r->>'package_id')::uuid from saved where name='a')));
select throws_ok($$update public.vendor_packages set first_published_at = null where id = (select (r->>'package_id')::uuid from saved where name='d')$$,
  '42501', null, 'a client cannot write the first publication');
select isnt((select first_published_at from public.vendor_packages where id = (select (r->>'package_id')::uuid from saved where name='a')), null,
  'pausing keeps it (Paused, not Draft)');
reset role;
set local role anon;
select lives_ok($$select first_published_at from public.vendor_packages where is_active limit 1$$, 'public readers can see whether a live version was published');
reset role;
set local role anon;
select throws_ok($$select special_offer from public.contractors limit 1$$, '42501', null, 'anonymous visitors cannot read Special Offer');
select is((select special_offer from public.r0_public_providers('c1051000-0000-4000-8000-00000000000a')), null, 'the public listing does not return it');
reset role;
select pg_temp.as_user(4);
set local role authenticated;
select throws_ok($$select public.admin_vendor_special_offer('c1051000-0000-4000-8000-00000000000a')$$, '42501', null, 'only operators use the Special Offer readback');
reset role;
-- Services Offered come from live, review-cleared offerings: A offers its service, a listed service
-- with no offering is not shown.
update public.contractors set services = '{synthetic-vl-svc,synthetic-unpriced}' where id = 'c1051000-0000-4000-8000-00000000000b';
select is((select services from public.r0_public_providers('c1051000-0000-4000-8000-00000000000b')), '{synthetic-vl-svc}'::text[],
  'a listed service without a live offering is not shown as offered');

select * from finish();
rollback;
